import { status } from '@grpc/grpc-js';
import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderItemData } from '../entities';
import { ProductClientService } from '../product-client/product-client.service';
import { RabbitmqPublisher } from '../messaging/rabbitmq.publisher';
import {
  CreateOrderRequest,
  OrderList,
  OrderMessage,
} from './order.interface';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    private readonly productClient: ProductClientService,
    private readonly publisher: RabbitmqPublisher,
  ) {}

  /**
   * Tạo đơn: với MỖI item gọi product-service.CheckStock (gRPC sync). Thiếu
   * hàng -> lỗi FAILED_PRECONDITION. Đủ hàng -> chốt giá, tính total, lưu đơn
   * (PENDING), rồi publish event "order.created" cho notification-worker.
   */
  async create(data: CreateOrderRequest): Promise<OrderMessage> {
    const items = data.items ?? [];
    if (items.length === 0) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Đơn hàng phải có ít nhất 1 sản phẩm',
      });
    }
    if (!data.userId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Thiếu userId',
      });
    }
    if (!data.email) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Thiếu email',
      });
    }

    const orderItems: OrderItemData[] = [];
    let total = 0;

    for (const item of items) {
      const quantity = item.quantity ?? 0;
      if (quantity <= 0) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: `Số lượng của sản phẩm ${item.productId} phải > 0`,
        });
      }

      // SYNC: chặn tạo đơn nếu bất kỳ item nào không đủ hàng.
      const stock = await this.productClient.checkStock(
        item.productId,
        quantity,
      );
      if (!stock.available) {
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: `Sản phẩm ${item.productId} không đủ hàng (còn ${stock.remaining}, cần ${quantity})`,
        });
      }

      orderItems.push({
        productId: item.productId,
        quantity,
        // Chốt giá lấy từ CheckStock — không tin giá client gửi lên.
        price: stock.price,
      });
      total += stock.price * quantity;
    }

    const saved = await this.orders.save(
      this.orders.create({
        userId: data.userId,
        email: data.email,
        items: orderItems,
        total,
        status: 'PENDING',
      }),
    );

    // Async: báo notification-worker gửi mail. Lỗi publish không rollback đơn
    // (đơn đã được ghi nhận PENDING), chỉ log để còn thấy nguyên nhân.
    try {
      await this.publisher.publishOrderCreated({
        orderId: saved.id,
        userId: saved.userId,
        items: orderItems,
        total,
        email: data.email,
      });
    } catch (error) {
      this.logger.error(
        `Publish order.created thất bại cho orderId=${saved.id}`,
        error as Error,
      );
    }

    return this.toMessage(saved);
  }

  async findOne(id: string): Promise<OrderMessage> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Đơn hàng không tồn tại',
      });
    }
    return this.toMessage(order);
  }

  async findByUser(userId: string): Promise<OrderList> {
    const orders = await this.orders.find({
      where: { userId },
      // `id` là tie-breaker BẮT BUỘC: nhiều đơn có thể trùng `createdAt`, thêm
      // cột unique vào ORDER BY để thứ tự tất định (tránh trùng/sót khi phân trang).
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return { orders: orders.map((o) => this.toMessage(o)) };
  }

  private toMessage(order: Order): OrderMessage {
    return {
      id: order.id,
      userId: order.userId,
      items: (order.items ?? []).map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        price: i.price,
      })),
      total: order.total,
      status: order.status,
      createdAt: order.createdAt?.toISOString() ?? '',
    };
  }
}
