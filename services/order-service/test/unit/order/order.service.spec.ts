import { RpcException } from '@nestjs/microservices';
import { Repository } from 'typeorm';
import { Order } from '../../../src/entities';
import { OrderService } from '../../../src/order/order.service';
import { ProductClientService } from '../../../src/product-client/product-client.service';
import { RabbitmqPublisher } from '../../../src/messaging/rabbitmq.publisher';
import { CheckStockResponse } from '../../../src/product-client/product-client.constants';

/** Repo Order giả lập bằng Map trong bộ nhớ — đủ cho unit test logic. */
function createOrderRepoMock(seed: Order[] = []): Repository<Order> {
  const store = new Map<string, Order>();
  seed.forEach((o) => store.set(o.id, o));
  let seq = 0;
  return {
    find: jest.fn(async ({ where }: { where: { userId: string } }) =>
      [...store.values()].filter((o) => o.userId === where.userId),
    ),
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => {
      return store.get(where.id) ?? null;
    }),
    create: jest.fn((data: Partial<Order>) => ({ ...data }) as Order),
    save: jest.fn(async (input: Order) => {
      input.id = input.id ?? `order-${++seq}`;
      input.createdAt = input.createdAt ?? new Date();
      store.set(input.id, input);
      return input;
    }),
  } as unknown as Repository<Order>;
}

function stock(over: Partial<CheckStockResponse> = {}): CheckStockResponse {
  return { available: true, price: 1000, remaining: 100, ...over };
}

function makeDeps(checkStock: jest.Mock) {
  const productClient = { checkStock } as unknown as ProductClientService;
  const publisher = {
    publishOrderCreated: jest.fn(async () => undefined),
  } as unknown as RabbitmqPublisher;
  return { productClient, publisher };
}

describe('OrderService.create', () => {
  it('gọi CheckStock cho từng item, tính total theo giá từ CheckStock', async () => {
    const repo = createOrderRepoMock();
    const checkStock = jest
      .fn()
      .mockResolvedValueOnce(stock({ price: 1000 }))
      .mockResolvedValueOnce(stock({ price: 250 }));
    const { productClient, publisher } = makeDeps(checkStock);
    const service = new OrderService(repo, productClient, publisher);

    const res = await service.create({
      userId: 'u1',
      email: 'u1@example.com',
      items: [
        { productId: 'p1', quantity: 2 },
        { productId: 'p2', quantity: 4 },
      ],
    });

    // 1000*2 + 250*4 = 3000
    expect(res.total).toBe(3000);
    expect(res.status).toBe('PENDING');
    expect(checkStock).toHaveBeenCalledTimes(2);
    expect(checkStock).toHaveBeenNthCalledWith(1, 'p1', 2);
    expect(checkStock).toHaveBeenNthCalledWith(2, 'p2', 4);
    // Giá trong item được chốt từ CheckStock, không phải client gửi.
    expect(res.items).toEqual([
      { productId: 'p1', quantity: 2, price: 1000 },
      { productId: 'p2', quantity: 4, price: 250 },
    ]);
  });

  it('publish event order.created với payload đúng sau khi lưu đơn', async () => {
    const repo = createOrderRepoMock();
    const checkStock = jest.fn().mockResolvedValue(stock({ price: 500 }));
    const { productClient, publisher } = makeDeps(checkStock);
    const service = new OrderService(repo, productClient, publisher);

    const res = await service.create({
      userId: 'u1',
      email: 'buyer@example.com',
      items: [{ productId: 'p1', quantity: 3 }],
    });

    expect(publisher.publishOrderCreated).toHaveBeenCalledTimes(1);
    expect(publisher.publishOrderCreated).toHaveBeenCalledWith({
      orderId: res.id,
      userId: 'u1',
      items: [{ productId: 'p1', quantity: 3, price: 500 }],
      total: 1500,
      email: 'buyer@example.com',
    });
  });

  it('ném FAILED_PRECONDITION và KHÔNG lưu/không publish khi thiếu hàng', async () => {
    const repo = createOrderRepoMock();
    const checkStock = jest
      .fn()
      .mockResolvedValue(stock({ available: false, remaining: 1 }));
    const { productClient, publisher } = makeDeps(checkStock);
    const service = new OrderService(repo, productClient, publisher);

    await expect(
      service.create({
        userId: 'u1',
        email: 'u1@example.com',
        items: [{ productId: 'p1', quantity: 5 }],
      }),
    ).rejects.toBeInstanceOf(RpcException);

    expect(repo.save).not.toHaveBeenCalled();
    expect(publisher.publishOrderCreated).not.toHaveBeenCalled();
  });

  it('ném INVALID_ARGUMENT khi đơn không có item', async () => {
    const repo = createOrderRepoMock();
    const checkStock = jest.fn();
    const { productClient, publisher } = makeDeps(checkStock);
    const service = new OrderService(repo, productClient, publisher);

    await expect(
      service.create({ userId: 'u1', email: 'u1@example.com', items: [] }),
    ).rejects.toBeInstanceOf(RpcException);
    expect(checkStock).not.toHaveBeenCalled();
  });

  it('ném INVALID_ARGUMENT khi email rỗng', async () => {
    const repo = createOrderRepoMock();
    const checkStock = jest.fn();
    const { productClient, publisher } = makeDeps(checkStock);
    const service = new OrderService(repo, productClient, publisher);

    await expect(
      service.create({
        userId: 'u1',
        email: '',
        items: [{ productId: 'p1', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(RpcException);
    expect(checkStock).not.toHaveBeenCalled();
  });

  it('ném INVALID_ARGUMENT khi quantity <= 0', async () => {
    const repo = createOrderRepoMock();
    const checkStock = jest.fn();
    const { productClient, publisher } = makeDeps(checkStock);
    const service = new OrderService(repo, productClient, publisher);

    await expect(
      service.create({
        userId: 'u1',
        email: 'u1@example.com',
        items: [{ productId: 'p1', quantity: 0 }],
      }),
    ).rejects.toBeInstanceOf(RpcException);
    expect(checkStock).not.toHaveBeenCalled();
  });
});

describe('OrderService.findByUser', () => {
  it('chỉ trả đơn của user và sort có tie-breaker id', async () => {
    const now = new Date();
    const repo = createOrderRepoMock([
      {
        id: 'o1',
        userId: 'u1',
        email: 'u1@example.com',
        items: [],
        total: 10,
        status: 'PENDING',
        createdAt: now,
      } as Order,
      {
        id: 'o2',
        userId: 'u2',
        email: 'u2@example.com',
        items: [],
        total: 20,
        status: 'PENDING',
        createdAt: now,
      } as Order,
    ]);
    const { productClient, publisher } = makeDeps(jest.fn());
    const service = new OrderService(repo, productClient, publisher);

    const res = await service.findByUser('u1');

    expect(res.orders).toHaveLength(1);
    expect(res.orders[0].id).toBe('o1');
    const opts = (repo.find as jest.Mock).mock.calls[0][0];
    expect(opts.order).toEqual({ createdAt: 'ASC', id: 'ASC' });
  });
});

describe('OrderService.findOne', () => {
  it('ném NOT_FOUND khi đơn không tồn tại', async () => {
    const repo = createOrderRepoMock();
    const { productClient, publisher } = makeDeps(jest.fn());
    const service = new OrderService(repo, productClient, publisher);

    await expect(service.findOne('missing')).rejects.toBeInstanceOf(
      RpcException,
    );
  });
});
