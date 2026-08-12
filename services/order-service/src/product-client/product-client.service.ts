import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import {
  CheckStockResponse,
  PRODUCT_CLIENT,
  PRODUCT_SERVICE_NAME,
  ProductGrpcService,
} from './product-client.constants';

@Injectable()
export class ProductClientService implements OnModuleInit {
  private productService: ProductGrpcService;

  constructor(@Inject(PRODUCT_CLIENT) private readonly client: ClientGrpc) {}

  onModuleInit() {
    this.productService =
      this.client.getService<ProductGrpcService>(PRODUCT_SERVICE_NAME);
  }

  /** Gọi product-service.CheckStock (gRPC, sync) trước khi tạo đơn. */
  checkStock(productId: string, quantity: number): Promise<CheckStockResponse> {
    return firstValueFrom(
      this.productService.checkStock({ productId, quantity }),
    );
  }
}
