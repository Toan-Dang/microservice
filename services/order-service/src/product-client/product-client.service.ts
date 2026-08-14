import { status } from '@grpc/grpc-js';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import {
  CheckStockResponse,
  DecrementStockResponse,
  PRODUCT_CLIENT,
  PRODUCT_SERVICE_NAME,
  ProductGrpcService,
  ReleaseStockResponse,
} from './product-client.constants';

@Injectable()
export class ProductClientService implements OnModuleInit {
  private readonly logger = new Logger(ProductClientService.name);
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
    const timeoutMs = this.config.get<number>('PRODUCT_GRPC_TIMEOUT_MS', 3000);
    try {
      return await firstValueFrom(
        this.productService
          .checkStock({ productId, quantity })
          .pipe(timeout(timeoutMs)),
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        this.logger.error(
          `CheckStock(${productId}) quá thời gian chờ (${timeoutMs}ms)`,
        );
        throw new RpcException({
          code: status.DEADLINE_EXCEEDED,
          message: `product-service.CheckStock quá thời gian chờ (${timeoutMs}ms)`,
        });
      }
      throw error;
    }
  }

  /** Gọi product-service.DecrementStock (gRPC, sync) để trừ kho atomic. */
  async decrementStock(
    productId: string,
    quantity: number,
  ): Promise<DecrementStockResponse> {
    const timeoutMs = this.config.get<number>('PRODUCT_GRPC_TIMEOUT_MS', 3000);
    try {
      return await firstValueFrom(
        this.productService
          .decrementStock({ productId, quantity })
          .pipe(timeout(timeoutMs)),
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        this.logger.error(
          `DecrementStock(${productId}) quá thời gian chờ (${timeoutMs}ms)`,
        );
        throw new RpcException({
          code: status.DEADLINE_EXCEEDED,
          message: `product-service.DecrementStock quá thời gian chờ (${timeoutMs}ms)`,
        });
      }
      throw error;
    }
  }

  /** Gọi product-service.ReleaseStock (gRPC, sync) để hoàn kho khi rollback. */
  async releaseStock(
    productId: string,
    quantity: number,
  ): Promise<ReleaseStockResponse> {
    const timeoutMs = this.config.get<number>('PRODUCT_GRPC_TIMEOUT_MS', 3000);
    try {
      return await firstValueFrom(
        this.productService
          .releaseStock({ productId, quantity })
          .pipe(timeout(timeoutMs)),
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        this.logger.error(
          `ReleaseStock(${productId}) quá thời gian chờ (${timeoutMs}ms)`,
        );
        throw new RpcException({
          code: status.DEADLINE_EXCEEDED,
          message: `product-service.ReleaseStock quá thời gian chờ (${timeoutMs}ms)`,
        });
      }
      throw error;
    }
  }
}
