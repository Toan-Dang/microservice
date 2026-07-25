import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import {
  PRODUCT_CLIENT,
  PRODUCT_SERVICE_NAME,
  Product,
  ProductGrpcService,
  ProductList,
} from './product-client.constants';

@Injectable()
export class ProductClientService implements OnModuleInit {
  private productService: ProductGrpcService;

  constructor(@Inject(PRODUCT_CLIENT) private readonly client: ClientGrpc) {}

  onModuleInit() {
    this.productService =
      this.client.getService<ProductGrpcService>(PRODUCT_SERVICE_NAME);
  }

  create(name: string, price: number, stock: number): Promise<Product> {
    return firstValueFrom(this.productService.create({ name, price, stock }));
  }

  findOne(id: string): Promise<Product> {
    return firstValueFrom(this.productService.findOne({ id }));
  }

  findMany(page: number, limit: number): Promise<ProductList> {
    return firstValueFrom(this.productService.findMany({ page, limit }));
  }
}
