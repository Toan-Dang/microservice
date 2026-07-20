import 'reflect-metadata';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { User } from './auth/user.entity';

/**
 * DataSource riêng cho TypeORM CLI (migration:generate / run / revert).
 * Đọc DATABASE_URL từ env — giống app runtime. Chạy trong container auth-service
 * (đã có sẵn env) hoặc từ host với DATABASE_URL trỏ về localhost:5433.
 */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [User],
  migrations: [join(__dirname, 'migrations', '*.{js,ts}')],
});
