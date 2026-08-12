import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import {
  CreateOrderRequest,
  FindByUserRequest,
  FindOneRequest,
  OrderList,
  OrderMessage,
} from './order.interface';
import { OrderService } from './order.service';

@Controller()
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @GrpcMethod('OrderService', 'CreateOrder')
  createOrder(data: CreateOrderRequest): Promise<OrderMessage> {
    return this.orderService.create(data);
  }

  @GrpcMethod('OrderService', 'FindOne')
  findOne(data: FindOneRequest): Promise<OrderMessage> {
    return this.orderService.findOne(data.id);
  }

  @GrpcMethod('OrderService', 'FindByUser')
  findByUser(data: FindByUserRequest): Promise<OrderList> {
    return this.orderService.findByUser(data.userId);
  }
}
