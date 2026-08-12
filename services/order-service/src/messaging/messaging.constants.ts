import type { OrderItemData } from '../entities';

/** Exchange topic dùng chung cho các event vòng đời đơn hàng. */
export const ORDER_EXCHANGE = 'orders';

/** Routing key của event phát khi tạo đơn thành công. */
export const ORDER_CREATED_ROUTING_KEY = 'order.created';

/**
 * Payload event "order.created" — hợp đồng (async) giữa order-service và
 * notification-worker. KHÔNG nằm trong proto (proto chỉ mô tả gRPC sync).
 */
export interface OrderCreatedEvent {
  orderId: string;
  userId: string;
  items: OrderItemData[];
  total: number;
  email: string;
}
