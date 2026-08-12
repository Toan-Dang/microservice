import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SendEmailCommand, SESClient } from '@aws-sdk/client-ses';
import { OrderCreatedEvent } from '../messaging.constants';

/**
 * Gửi email xác nhận đơn hàng.
 * - SES_FROM_EMAIL rỗng  -> MOCK: chỉ console.log 'Email sent to ...'.
 * - SES_FROM_EMAIL có giá trị -> gửi thật qua AWS SES.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly fromEmail: string;
  private readonly region: string;
  private sesClient: SESClient | null = null;

  constructor(private readonly config: ConfigService) {
    this.fromEmail = (this.config.get<string>('SES_FROM_EMAIL') ?? '').trim();
    this.region = (this.config.get<string>('AWS_REGION') ?? '').trim();
  }

  async sendOrderConfirmation(event: OrderCreatedEvent): Promise<void> {
    const to = event.email;
    const subject = `Xác nhận đơn hàng ${event.orderId}`;
    const body =
      `Cảm ơn bạn đã đặt hàng!\n` +
      `Mã đơn: ${event.orderId}\n` +
      `Số mặt hàng: ${event.items?.length ?? 0}\n` +
      `Tổng tiền: ${event.total}`;

    // Chế độ mock: không cấu hình SES thì chỉ log (đủ để demo local).
    if (!this.fromEmail) {
      this.logger.log(
        `Email sent to ${to} (MOCK) — đơn ${event.orderId}, tổng ${event.total}`,
      );
      return;
    }

    await this.getClient().send(
      new SendEmailCommand({
        Source: this.fromEmail,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Text: { Data: body, Charset: 'UTF-8' } },
        },
      }),
    );
    this.logger.log(`Email sent to ${to} qua SES — đơn ${event.orderId}`);
  }

  /** Khởi tạo SESClient lười (chỉ khi thực sự gửi thật). */
  private getClient(): SESClient {
    if (!this.sesClient) {
      this.sesClient = new SESClient(
        this.region ? { region: this.region } : {},
      );
    }
    return this.sesClient;
  }
}
