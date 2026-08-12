import { status } from '@grpc/grpc-js';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import {
  CheckStockResponse,
  PRODUCT_CLIENT,
  PRODUCT_SERVICE_NAME,
  ProductGrpcService,
} from './product-client.constants';

@Injectable()
export class ProductClientService implements OnModuleInit {
  private productService: ProductGrpcService;

  constructor(
    @Inject(PRODUCT_CLIENT) private readonly client: ClientGrpc,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.productService =
      this.client.getService<ProductGrpcService>(PRODUCT_SERVICE_NAME);
  }

  /** Gọi product-service.CheckStock (gRPC, sync) trước khi tạo đơn. */
  async checkStock(
    productId: string,
    quantity: number,
  ): Promise<CheckStockResponse> {
    const timeoutMs = this.config.get<number>(
      'PRODUCT_GRPC_TIMEOUT_MS',
      3000,
    );
    try {
      return await firstValueFrom(
        this.productService
          .checkStock({ productId, quantity })
          .pipe(timeout(timeoutMs)),
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        throw new RpcException({
          code: status.DEADLINE_EXCEEDED,
          message: `product-service.CheckStock quá thời gian chờ (${timeoutMs}ms)`,
        });
      }
      throw error;
    }
  }
}
