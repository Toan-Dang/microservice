import { Observable } from 'rxjs';

export const ORDER_PACKAGE_NAME = 'order';
export const ORDER_SERVICE_NAME = 'OrderService';
export const ORDER_CLIENT = 'ORDER_CLIENT';

export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

export interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  total: number;
  status: string;
  createdAt: string;
}

export interface OrderList {
  orders: Order[];
}

// Interface khớp gRPC OrderService (proto/order.proto). proto-loader trả
// snake_case -> camelCase, nên user_id/product_id thành userId/productId.
export interface OrderGrpcService {
  createOrder(data: {
    userId: string;
    email: string;
    items: { productId: string; quantity: number }[];
  }): Observable<Order>;
  findOne(data: { id: string }): Observable<Order>;
  findByUser(data: { userId: string }): Observable<OrderList>;
}
