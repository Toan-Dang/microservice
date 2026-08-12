import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { EmailService } from '../email/email.service';
import {
  DEAD_LETTER_EXCHANGE,
  DEAD_LETTER_QUEUE,
  MAX_RETRIES,
  NOTIFICATION_QUEUE,
  ORDER_CREATED_ROUTING_KEY,
  ORDER_EXCHANGE,
  OrderCreatedEvent,
  RETRY_HEADER,
} from '../messaging.constants';
import { readRetryCount, shouldRetry } from './retry.util';

type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>;
type AmqpChannel = Awaited<ReturnType<AmqpConnection['createChannel']>>;

/**
 * Consumer RabbitMQ (amqplib trực tiếp): subscribe 'order.created' từ topic
 * exchange 'orders', gọi EmailService. Cấu hình DLQ + retry cơ bản:
 * xử lý lỗi -> requeue (kèm đếm số lần) tối đa MAX_RETRIES, hết thì đẩy DLQ.
 */
@Injectable()
export class ConsumerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ConsumerService.name);
  private connection: AmqpConnection | null = null;
  private channel: AmqpChannel | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.connect();
  }

  private async connect(): Promise<void> {
    const url = this.config.get<string>(
      'RABBITMQ_URL',
      'amqp://localhost:5672',
    );
    this.connection = await amqp.connect(url);
    this.connection.on('error', (err) =>
      this.logger.error('RabbitMQ connection error', err as Error),
    );
    const channel = await this.connection.createChannel();
    this.channel = channel;

    // Topic exchange chính (order-service publish vào).
    await channel.assertExchange(ORDER_EXCHANGE, 'topic', { durable: true });

    // DLX + DLQ: message hết lượt retry sẽ được nack -> rơi vào đây.
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'topic', {
      durable: true,
    });
    await channel.assertQueue(DEAD_LETTER_QUEUE, { durable: true });
    await channel.bindQueue(
      DEAD_LETTER_QUEUE,
      DEAD_LETTER_EXCHANGE,
      ORDER_CREATED_ROUTING_KEY,
    );

    // Queue chính, gắn DLX để message bị nack (không requeue) tự sang DLQ.
    await channel.assertQueue(NOTIFICATION_QUEUE, {
      durable: true,
      deadLetterExchange: DEAD_LETTER_EXCHANGE,
    });
    await channel.bindQueue(
      NOTIFICATION_QUEUE,
      ORDER_EXCHANGE,
      ORDER_CREATED_ROUTING_KEY,
    );

    await channel.prefetch(10);
    await channel.consume(NOTIFICATION_QUEUE, (msg) => {
      void this.handle(msg);
    });

    this.logger.log(
      `Đang lắng nghe '${ORDER_CREATED_ROUTING_KEY}' trên queue '${NOTIFICATION_QUEUE}'`,
    );
  }

  private async handle(msg: amqp.ConsumeMessage | null): Promise<void> {
    const channel = this.channel;
    if (!msg || !channel) {
      return;
    }

    const retries = readRetryCount(msg.properties.headers?.[RETRY_HEADER]);

    try {
      const event = JSON.parse(msg.content.toString()) as OrderCreatedEvent;
      this.logger.log(
        `Nhận order.created orderId=${event.orderId} email=${event.email}`,
      );
      await this.email.sendOrderConfirmation(event);
      channel.ack(msg);
    } catch (error) {
      this.logger.error(
        `Xử lý order.created thất bại (đã retry ${retries} lần)`,
        error as Error,
      );

      if (shouldRetry(retries)) {
        // Requeue: publish lại vào exchange chính với counter tăng thêm 1, rồi
        // ack bản gốc (tránh vòng lặp requeue tức thời vô hạn của nack).
        channel.publish(ORDER_EXCHANGE, ORDER_CREATED_ROUTING_KEY, msg.content, {
          persistent: true,
          headers: { [RETRY_HEADER]: retries + 1 },
        });
        channel.ack(msg);
        this.logger.warn(`Requeue lần ${retries + 1}/${MAX_RETRIES}`);
      } else {
        // Hết lượt retry -> nack không requeue -> DLX -> DLQ.
        channel.nack(msg, false, false);
        this.logger.error(
          `Hết ${MAX_RETRIES} lần retry, đẩy sang DLQ '${DEAD_LETTER_QUEUE}'`,
        );
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch (error) {
      this.logger.warn(`Đóng kết nối RabbitMQ lỗi: ${(error as Error).message}`);
    }
  }
}
