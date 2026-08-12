import { ConfigService } from '@nestjs/config';
import { EmailService } from '../../../src/email/email.service';
import { OrderCreatedEvent } from '../../../src/messaging.constants';

function configMock(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

function event(over: Partial<OrderCreatedEvent> = {}): OrderCreatedEvent {
  return {
    orderId: 'o1',
    userId: 'u1',
    email: 'buyer@example.com',
    items: [{ productId: 'p1', quantity: 2, price: 500 }],
    total: 1000,
    ...over,
  };
}

describe('EmailService (mock mode)', () => {
  it('SES_FROM_EMAIL rỗng -> chỉ log "Email sent to ...", không gọi SES', async () => {
    const service = new EmailService(configMock({ SES_FROM_EMAIL: '' }));
    const logSpy = jest
      .spyOn((service as unknown as { logger: { log: (msg: string) => void } }).logger, 'log')
      .mockImplementation(() => undefined);

    await service.sendOrderConfirmation(event({ email: 'a@b.com' }));

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('Email sent to a@b.com');
    expect(logSpy.mock.calls[0][0]).toContain('(MOCK)');
  });

  it('coi khoảng trắng như rỗng -> vẫn mock', async () => {
    const service = new EmailService(configMock({ SES_FROM_EMAIL: '   ' }));
    const logSpy = jest
      .spyOn((service as unknown as { logger: { log: (msg: string) => void } }).logger, 'log')
      .mockImplementation(() => undefined);

    await service.sendOrderConfirmation(event());

    expect(logSpy.mock.calls[0][0]).toContain('(MOCK)');
  });
});
