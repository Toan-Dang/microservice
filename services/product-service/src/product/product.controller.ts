import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import {
  CheckStockRequest,
  CheckStockResponse,
  CreateProductRequest,
  FindManyRequest,
  FindOneRequest,
  ProductList,
  ProductMessage,
} from './product.interface';
import { ProductService } from './product.service';

@Controller()
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @GrpcMethod('ProductService', 'Create')
  create(data: CreateProductRequest): Promise<ProductMessage> {
    return this.productService.create(data);
  }

  @GrpcMethod('ProductService', 'FindOne')
  findOne(data: FindOneRequest): Promise<ProductMessage> {
    return this.productService.findOne(data.id);
  }

  @GrpcMethod('ProductService', 'FindMany')
  findMany(data: FindManyRequest): Promise<ProductList> {
    return this.productService.findMany(data.page, data.limit);
  }

  @GrpcMethod('ProductService', 'CheckStock')
  checkStock(data: CheckStockRequest): Promise<CheckStockResponse> {
    return this.productService.checkStock(data.productId, data.quantity);
  }
}
