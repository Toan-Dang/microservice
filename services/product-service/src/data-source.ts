import 'reflect-metadata';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { Product } from './product/product.entity';

/**
 * DataSource riêng cho TypeORM CLI (migration:generate / run / revert).
 * Đọc DATABASE_URL từ env — giống app runtime. Chạy trong container product-service
 * (đã có sẵn env) hoặc từ host với DATABASE_URL trỏ về postgres của product_db.
 */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [Product],
  migrations: [join(__dirname, 'migrations', '*.{js,ts}')],
});
