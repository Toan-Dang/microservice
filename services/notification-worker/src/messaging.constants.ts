// Hợp đồng (async) khớp với order-service. KHÔNG nằm trong proto (proto chỉ
// mô tả gRPC sync). Đổi thì phải cập nhật cả 2 phía.

/** Exchange topic order-service publish vào. */
export const ORDER_EXCHANGE = 'orders';

/** Routing key của event tạo đơn. */
export const ORDER_CREATED_ROUTING_KEY = 'order.created';

/** Queue của notification-worker, bind vào ORDER_EXCHANGE với routing key trên. */
export const NOTIFICATION_QUEUE = 'notifications.order-created';

/** Dead-letter exchange + queue: nơi message đi vào sau khi hết lượt retry. */
export const DEAD_LETTER_EXCHANGE = 'orders.dlx';
export const DEAD_LETTER_QUEUE = 'notifications.order-created.dlq';

/** Số lần requeue tối đa trước khi đẩy message sang DLQ. */
export const MAX_RETRIES = 3;

/** Header mang số lần đã retry (amqplib không tự đếm requeue). */
export const RETRY_HEADER = 'x-retry-count';

export interface OrderItemData {
  productId: string;
  quantity: number;
  price: number;
}

export interface OrderCreatedEvent {
  orderId: string;
  userId: string;
  items: OrderItemData[];
  total: number;
  email: string;
}
