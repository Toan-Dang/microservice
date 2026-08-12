import { ConfigService } from '@nestjs/config';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { NEVER } from 'rxjs';
import { ProductClientService } from '../../../src/product-client/product-client.service';

/** Client gRPC giả lập: getService trả về stub có checkStock không bao giờ emit. */
function createClientMock(checkStock: jest.Mock): ClientGrpc {
  return {
    getService: jest.fn(() => ({ checkStock })),
  } as unknown as ClientGrpc;
}

function createConfigMock(timeoutMs?: number): ConfigService {
  return {
    get: jest.fn((_key: string, fallback?: number) => timeoutMs ?? fallback),
  } as unknown as ConfigService;
}

describe('ProductClientService.checkStock', () => {
  it('ném RpcException DEADLINE_EXCEEDED khi product-service không phản hồi trước timeout', async () => {
    const checkStock = jest.fn(() => NEVER);
    const client = createClientMock(checkStock);
    const config = createConfigMock(20);
    const service = new ProductClientService(client, config);
    service.onModuleInit();

    expect.assertions(2);
    try {
      await service.checkStock('p1', 1);
    } catch (error) {
      expect(error).toBeInstanceOf(RpcException);
      expect((error as RpcException).getError()).toMatchObject({
        code: 4, // DEADLINE_EXCEEDED
      });
    }
  });
});
