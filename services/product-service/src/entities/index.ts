import { Product } from './product.entity';

export { Product } from './product.entity';

/**
 * Danh sách entity của product-service — khai 1 chỗ duy nhất, dùng cho cả
 * `app.module.ts` (TypeOrmModule.forRootAsync) và `database/data-source.ts`
 * (TypeORM CLI). Thêm entity mới chỉ cần sửa ở đây.
 */
export const ENTITIES = [Product];
