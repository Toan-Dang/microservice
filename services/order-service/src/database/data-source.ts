import 'reflect-metadata';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { ENTITIES } from '../entities';

/**
 * DataSource riêng cho TypeORM CLI (migration:generate / run / revert). Đọc
 * DATABASE_URL từ env — giống app runtime. Chạy trong container order-service
 * (đã có sẵn env) hoặc từ host với DATABASE_URL trỏ về postgres của order_db.
 */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ENTITIES,
  migrations: [join(__dirname, 'migrations', '*.{js,ts}')],
});
