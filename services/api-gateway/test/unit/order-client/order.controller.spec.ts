import { Request } from 'express';
import { AuthUser } from '../../../src/auth-client/jwt-auth.guard';
import { OrderController } from '../../../src/order-client/order.controller';
import { OrderClientService } from '../../../src/order-client/order-client.service';

function reqWith(user: AuthUser): Request & { user: AuthUser } {
  return { user } as Request & { user: AuthUser };
}

describe('OrderController', () => {
  let client: {
    createOrder: jest.Mock;
    findByUser: jest.Mock;
  };
  let controller: OrderController;

  beforeEach(() => {
    client = { createOrder: jest.fn(), findByUser: jest.fn() };
    controller = new OrderController(
      client as unknown as OrderClientService,
    );
  });

  it('create: lấy userId & email từ req.user (JWT), items từ body', async () => {
    client.createOrder.mockResolvedValue({ id: 'o1', status: 'PENDING' });
    const req = reqWith({ userId: 'u1', email: 'u1@example.com' });

    const res = await controller.create(req, {
      items: [{ productId: 'p1', quantity: 2 }],
    });

    expect(client.createOrder).toHaveBeenCalledWith('u1', 'u1@example.com', [
      { productId: 'p1', quantity: 2 },
    ]);
    expect(res).toEqual({ id: 'o1', status: 'PENDING' });
  });

  it('listMine: chỉ lấy đơn của user hiện tại', async () => {
    client.findByUser.mockResolvedValue({ orders: [{ id: 'o1' }] });
    const req = reqWith({ userId: 'u1', email: 'u1@example.com' });

    const res = await controller.listMine(req);

    expect(client.findByUser).toHaveBeenCalledWith('u1');
    expect(res).toEqual({ data: [{ id: 'o1' }] });
  });

  it('map lỗi gRPC sang HttpException', async () => {
    client.createOrder.mockRejectedValue({ code: 5, message: 'not found' });
    const req = reqWith({ userId: 'u1', email: 'u1@example.com' });

    await expect(
      controller.create(req, { items: [{ productId: 'p1', quantity: 1 }] }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
