import { RpcException } from '@nestjs/microservices';
import { Repository } from 'typeorm';
import { ProductService } from '../../../src/product/product.service';
import { Product } from '../../../src/entities/product.entity';

/**
 * Repo Product giả lập bằng Map trong bộ nhớ — đủ cho unit test logic.
 * `createQueryBuilder` giả lập đủ chuỗi update/set/where/setParameters/execute
 * mà decrementStock/releaseStock dùng: áp điều kiện `stock >= :qty` (nếu where
 * có) rồi cộng/trừ thẳng vào store, trả `{ affected }` giống TypeORM thật.
 */
function createProductRepoMock(seed: Product[] = []): Repository<Product> {
  const store = new Map<string, Product>();
  seed.forEach((p) => store.set(p.id, p));
  let seq = 0;
  return {
    count: jest.fn(async () => store.size),
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => {
      return store.get(where.id) ?? null;
    }),
    findAndCount: jest.fn(async () => [[...store.values()], store.size]),
    create: jest.fn((data: Partial<Product>) => ({ ...data }) as Product),
    save: jest.fn(async (input: Product | Product[]) => {
      const list = Array.isArray(input) ? input : [input];
      list.forEach((p) => {
        p.id = p.id ?? `prod-${++seq}`;
        p.createdAt = p.createdAt ?? new Date();
        store.set(p.id, p);
      });
      return input;
    }),
    createQueryBuilder: jest.fn(() => {
      let isDecrement = false;
      let whereClause = '';
      let params: Record<string, unknown> = {};
      const builder: {
        update: jest.Mock;
        set: jest.Mock;
        where: jest.Mock;
        setParameters: jest.Mock;
        execute: jest.Mock;
      } = {
        update: jest.fn(() => builder),
        set: jest.fn((setObj: Record<string, () => string>) => {
          isDecrement = (setObj.stock?.() ?? '').includes('-');
          return builder;
        }),
        where: jest.fn(
          (clause: string, whereParams: Record<string, unknown>) => {
            whereClause = clause;
            params = { ...params, ...whereParams };
            return builder;
          },
        ),
        setParameters: jest.fn((p: Record<string, unknown>) => {
          params = { ...params, ...p };
          return builder;
        }),
        execute: jest.fn(async () => {
          const id = params.id as string;
          const qty = params.qty as number;
          const product = store.get(id);
          if (!product) return { affected: 0 };
          if (whereClause.includes('stock >=') && product.stock < qty) {
            return { affected: 0 };
          }
          product.stock = isDecrement
            ? product.stock - qty
            : product.stock + qty;
          store.set(id, product);
          return { affected: 1 };
        }),
      };
      return builder;
    }),
  } as unknown as Repository<Product>;
}

function makeProduct(over: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    name: 'Test',
    price: 1000,
    stock: 10,
    createdAt: new Date(),
    ...over,
  } as Product;
}

describe('ProductService.findMany', () => {
  /** Lấy object option đã truyền vào findAndCount để kiểm tra query dựng đúng. */
  function optionsOf(repo: Repository<Product>): Record<string, unknown> {
    const mock = repo.findAndCount as unknown as jest.Mock;
    return mock.mock.calls[0][0] as Record<string, unknown>;
  }

  it('sort có tie-breaker `id` để phân trang tất định khi createdAt trùng nhau', async () => {
    const repo = createProductRepoMock([makeProduct({ id: 'p1' })]);

    await new ProductService(repo).findMany(1, 10);

    // Chỉ `createdAt` là KHÔNG đủ: các bản ghi seed insert cùng batch có cùng
    // timestamp, Postgres không đảm bảo thứ tự → page có thể trùng/bỏ sót.
    expect(optionsOf(repo).order).toEqual({ createdAt: 'ASC', id: 'ASC' });
  });

  it('skip/take tính đúng theo page và limit', async () => {
    const repo = createProductRepoMock([]);

    await new ProductService(repo).findMany(3, 20);

    expect(optionsOf(repo)).toMatchObject({ skip: 40, take: 20 });
  });

  it('mặc định page=1 và clamp limit về tối đa 100', async () => {
    const repo = createProductRepoMock([]);

    await new ProductService(repo).findMany(undefined, 5000);

    expect(optionsOf(repo)).toMatchObject({ skip: 0, take: 100 });
  });
});

describe('ProductService.checkStock', () => {
  it('available=true khi tồn kho >= quantity, trả đúng price và remaining', async () => {
    const repo = createProductRepoMock([
      makeProduct({ id: 'p1', price: 1500, stock: 10 }),
    ]);
    const service = new ProductService(repo);

    const res = await service.checkStock('p1', 3);

    expect(res.available).toBe(true);
    expect(res.price).toBe(1500);
    expect(res.remaining).toBe(10); // remaining = tồn kho hiện tại, không trừ
  });

  it('available=true khi quantity đúng bằng tồn kho (biên)', async () => {
    const repo = createProductRepoMock([makeProduct({ id: 'p1', stock: 5 })]);
    const service = new ProductService(repo);

    const res = await service.checkStock('p1', 5);

    expect(res.available).toBe(true);
    expect(res.remaining).toBe(5);
  });

  it('available=false khi tồn kho < quantity', async () => {
    const repo = createProductRepoMock([makeProduct({ id: 'p1', stock: 2 })]);
    const service = new ProductService(repo);

    const res = await service.checkStock('p1', 5);

    expect(res.available).toBe(false);
    expect(res.remaining).toBe(2);
  });

  it('available=false khi hết hàng (stock=0)', async () => {
    const repo = createProductRepoMock([makeProduct({ id: 'p1', stock: 0 })]);
    const service = new ProductService(repo);

    const res = await service.checkStock('p1', 1);

    expect(res.available).toBe(false);
    expect(res.remaining).toBe(0);
  });

  it('available=false khi quantity <= 0', async () => {
    const repo = createProductRepoMock([makeProduct({ id: 'p1', stock: 10 })]);
    const service = new ProductService(repo);

    const res = await service.checkStock('p1', 0);

    expect(res.available).toBe(false);
  });

  it('ném RpcException NOT_FOUND khi sản phẩm không tồn tại', async () => {
    const repo = createProductRepoMock([]);
    const service = new ProductService(repo);

    await expect(service.checkStock('missing', 1)).rejects.toBeInstanceOf(
      RpcException,
    );
  });
});

describe('ProductService.decrementStock', () => {
  it('đủ hàng → success true, trừ đúng stock và trả remaining mới', async () => {
    const repo = createProductRepoMock([makeProduct({ id: 'p1', stock: 10 })]);
    const service = new ProductService(repo);

    const res = await service.decrementStock('p1', 3);

    expect(res).toEqual({ success: true, remaining: 7 });
    const product = await repo.findOne({ where: { id: 'p1' } } as never);
    expect(product?.stock).toBe(7);
  });

  it('không đủ hàng → success false, KHÔNG thay đổi stock', async () => {
    const repo = createProductRepoMock([makeProduct({ id: 'p1', stock: 2 })]);
    const service = new ProductService(repo);

    const res = await service.decrementStock('p1', 5);

    expect(res.success).toBe(false);
    expect(res.remaining).toBe(2);
    const product = await repo.findOne({ where: { id: 'p1' } } as never);
    expect(product?.stock).toBe(2); // stock giữ nguyên, không bị trừ hụt
  });

  it('ném NOT_FOUND khi sản phẩm không tồn tại', async () => {
    const repo = createProductRepoMock([]);
    const service = new ProductService(repo);

    await expect(service.decrementStock('missing', 1)).rejects.toBeInstanceOf(
      RpcException,
    );
  });
});

describe('ProductService.releaseStock', () => {
  it('cộng lại đúng số lượng vào stock và trả remaining mới', async () => {
    const repo = createProductRepoMock([makeProduct({ id: 'p1', stock: 5 })]);
    const service = new ProductService(repo);

    const res = await service.releaseStock('p1', 3);

    expect(res.remaining).toBe(8);
    const product = await repo.findOne({ where: { id: 'p1' } } as never);
    expect(product?.stock).toBe(8);
  });
});
