import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import {
  ORDER_CLIENT,
  ORDER_SERVICE_NAME,
  Order,
  OrderGrpcService,
  OrderList,
} from './order-client.constants';

@Injectable()
export class OrderClientService implements OnModuleInit {
  private orderService: OrderGrpcService;

  constructor(@Inject(ORDER_CLIENT) private readonly client: ClientGrpc) {}

  onModuleInit() {
    this.orderService =
      this.client.getService<OrderGrpcService>(ORDER_SERVICE_NAME);
  }

  createOrder(
    userId: string,
    email: string,
    items: { productId: string; quantity: number }[],
  ): Promise<Order> {
    return firstValueFrom(
      this.orderService.createOrder({ userId, email, items }),
    );
  }

  findByUser(userId: string): Promise<OrderList> {
    return firstValueFrom(this.orderService.findByUser({ userId }));
  }
}
