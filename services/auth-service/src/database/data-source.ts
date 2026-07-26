import 'reflect-metadata';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { ENTITIES } from '../entities';

/**
 * DataSource riêng cho TypeORM CLI (migration:generate / run / revert) và cho
 * `npm run seed`. Đọc DATABASE_URL từ env — giống app runtime. Chạy trong
 * container auth-service (đã có sẵn env) hoặc từ host với DATABASE_URL
 * trỏ về localhost:5433.
 */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ENTITIES,
  migrations: [join(__dirname, 'migrations', '*.{js,ts}')],
});
