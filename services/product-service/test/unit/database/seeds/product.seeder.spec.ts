import { DataSource } from 'typeorm';
import { Product } from '../../../../src/entities/product.entity';
import { ProductSeeder } from '../../../../src/database/seeds/product.seeder';

/** DataSource giả lập: chỉ cần getRepository(Product) trả repo in-memory. */
function createDataSourceMock(existing: Partial<Product>[] = []) {
  const store: Partial<Product>[] = [...existing];
  const repo = {
    find: jest.fn(async () => store.map((p) => ({ name: p.name }))),
    create: jest.fn((data: Partial<Product>) => ({ ...data })),
    save: jest.fn(async (rows: Partial<Product>[]) => {
      store.push(...rows);
      return rows;
    }),
  };
  return {
    dataSource: { getRepository: () => repo } as unknown as DataSource,
    repo,
    store,
  };
}

describe('ProductSeeder', () => {
  it('chèn đủ 5 sản phẩm mẫu khi bảng rỗng', async () => {
    const { dataSource, repo, store } = createDataSourceMock();

    const result = await new ProductSeeder().run(dataSource);

    expect(store).toHaveLength(5);
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(result).toBe('thêm 5, bỏ qua 0');
  });

  it('idempotent — chạy lần 2 không nhân đôi dữ liệu', async () => {
    const { dataSource, store } = createDataSourceMock();
    const seeder = new ProductSeeder();

    await seeder.run(dataSource);
    const result = await seeder.run(dataSource);

    expect(store).toHaveLength(5);
    expect(result).toBe('thêm 0, bỏ qua 5');
  });

  it('chỉ bổ sung sản phẩm mẫu còn thiếu, không đụng dữ liệu có sẵn', async () => {
    const { dataSource, store } = createDataSourceMock([
      { name: 'Bàn phím cơ', price: 111, stock: 7 },
      { name: 'Sản phẩm do user tạo', price: 222, stock: 3 },
    ]);

    const result = await new ProductSeeder().run(dataSource);

    expect(result).toBe('thêm 4, bỏ qua 1');
    // 2 bản ghi cũ + 4 bản ghi seed còn thiếu
    expect(store).toHaveLength(6);
    // Giá của 'Bàn phím cơ' có sẵn KHÔNG bị ghi đè bằng giá seed
    expect(store.find((p) => p.name === 'Bàn phím cơ')?.price).toBe(111);
  });
});
