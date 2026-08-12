// Các message khớp proto/order.proto. proto-loader (keepCase mặc định = false)
// tự chuyển snake_case -> camelCase, nên `user_id`/`product_id` thành
// `userId`/`productId`, và `created_at` thành `createdAt`.

export interface OrderItemInput {
  productId: string;
  quantity: number;
}

export interface CreateOrderRequest {
  userId: string;
  items: OrderItemInput[];
  email: string;
}

export interface OrderItemMessage {
  productId: string;
  quantity: number;
  price: number;
}

export interface OrderMessage {
  id: string;
  userId: string;
  items: OrderItemMessage[];
  total: number;
  status: string;
  createdAt: string;
}

export interface FindOneRequest {
  id: string;
}

export interface FindByUserRequest {
  userId: string;
}

export interface OrderList {
  orders: OrderMessage[];
}
