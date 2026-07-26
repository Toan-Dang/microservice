import { User } from './user.entity';

export { User } from './user.entity';

/**
 * Danh sách entity của auth-service — khai 1 chỗ duy nhất, dùng cho cả
 * `app.module.ts` (TypeOrmModule.forRootAsync) và `database/data-source.ts`
 * (TypeORM CLI). Thêm entity mới chỉ cần sửa ở đây.
 */
export const ENTITIES = [User];
