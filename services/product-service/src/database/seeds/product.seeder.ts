import { DataSource } from 'typeorm';
import { Product } from '../../product/product.entity';
import { Seeder } from './seeder.interface';

/**
 * 5 sản phẩm mẫu để thử `GET /products` và `CheckStock` ngay sau khi dựng DB.
 * Cố tình để 1 sản phẩm stock = 0 nhằm test nhánh hết hàng.
 */
const SEED_PRODUCTS: Pick<Product, 'name' | 'price' | 'stock'>[] = [
  { name: 'Bàn phím cơ', price: 990000, stock: 50 },
  { name: 'Chuột không dây', price: 450000, stock: 120 },
  { name: 'Tai nghe Bluetooth', price: 1290000, stock: 30 },
  { name: 'Màn hình 27 inch', price: 4590000, stock: 15 },
  { name: 'Ổ cứng SSD 1TB', price: 1890000, stock: 0 },
];

export class ProductSeeder implements Seeder {
  readonly name = 'products';

  async run(dataSource: DataSource): Promise<string> {
    const repo = dataSource.getRepository(Product);

    // Idempotent theo từng `name`: chỉ chèn sản phẩm mẫu còn thiếu, nên nếu
    // sau này thêm sản phẩm vào SEED_PRODUCTS thì lần seed sau vẫn bổ sung
    // được mà không đụng vào dữ liệu đang có.
    const existingNames = new Set(
      (await repo.find({ select: { name: true } })).map((p) => p.name),
    );
    const missing = SEED_PRODUCTS.filter((p) => !existingNames.has(p.name));

    if (missing.length > 0) {
      await repo.save(missing.map((p) => repo.create(p)));
    }

    const skipped = SEED_PRODUCTS.length - missing.length;
    return `thêm ${missing.length}, bỏ qua ${skipped}`;
  }
}
