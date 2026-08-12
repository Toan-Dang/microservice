import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import {
  ORDER_CREATED_ROUTING_KEY,
  ORDER_EXCHANGE,
  OrderCreatedEvent,
} from './messaging.constants';

// Kiểu suy ra từ chính amqplib để không phụ thuộc tên type (Connection /
// ChannelModel đổi giữa các minor version của thư viện).
type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>;
type AmqpChannel = Awaited<ReturnType<AmqpConnection['createChannel']>>;

/**
 * Publisher RabbitMQ dùng amqplib trực tiếp (không qua Nest RMQ transport) để
 * chủ động khai báo topic exchange + routing key theo đúng hợp đồng event.
 *
 * Kết nối 1 lần lúc boot, tự mở lại nếu connection rớt (publish sẽ reconnect).
 */
@Injectable()
export class RabbitmqPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqPublisher.name);
  private connection: AmqpConnection | null = null;
  private channel: AmqpChannel | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    // Không để lỗi RabbitMQ làm sập service lúc khởi động — publish sẽ thử lại.
    try {
      await this.connect();
    } catch (error) {
      this.logger.error(
        'Không kết nối được RabbitMQ lúc khởi động (sẽ thử lại khi publish)',
        error as Error,
      );
    }
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
    this.connection.on('close', () => {
      this.channel = null;
      this.connection = null;
    });
    this.channel = await this.connection.createChannel();
    await this.channel.assertExchange(ORDER_EXCHANGE, 'topic', {
      durable: true,
    });
    this.logger.log(
      `Đã kết nối RabbitMQ, exchange '${ORDER_EXCHANGE}' (topic) sẵn sàng`,
    );
  }

  /**
   * Phát event "order.created". Tách khỏi transaction lưu đơn: đơn đã lưu ở DB,
   * event là bước async báo cho notification-worker gửi mail.
   */
  async publishOrderCreated(event: OrderCreatedEvent): Promise<void> {
    if (!this.channel) {
      await this.connect();
    }
    const payload = Buffer.from(JSON.stringify(event));
    this.channel!.publish(ORDER_EXCHANGE, ORDER_CREATED_ROUTING_KEY, payload, {
      persistent: true,
      contentType: 'application/json',
    });
    this.logger.log(
      `Published '${ORDER_CREATED_ROUTING_KEY}' orderId=${event.orderId} email=${event.email}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch (error) {
      this.logger.warn(
        `Đóng kết nối RabbitMQ lỗi: ${(error as Error).message}`,
      );
    }
  }
}
