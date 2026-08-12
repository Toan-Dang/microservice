import { Order } from './order.entity';

export { Order } from './order.entity';
export type { OrderItemData, OrderStatus } from './order.entity';

/**
 * Danh sách entity của order-service — khai 1 chỗ duy nhất, dùng cho cả
 * `app.module.ts` (TypeOrmModule.forRootAsync) và `database/data-source.ts`
 * (TypeORM CLI). Thêm entity mới chỉ cần sửa ở đây.
 */
export const ENTITIES = [Order];
