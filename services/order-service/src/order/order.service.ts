import { status } from '@grpc/grpc-js';
import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderItemData } from '../entities';
import { ProductClientService } from '../product-client/product-client.service';
import { RabbitmqPublisher } from '../messaging/rabbitmq.publisher';
import { CreateOrderRequest, OrderList, OrderMessage } from './order.interface';

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
      this.logger.warn('Tạo đơn thất bại: đơn hàng rỗng');
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Đơn hàng phải có ít nhất 1 sản phẩm',
      });
    }
    if (!data.userId) {
      this.logger.warn('Tạo đơn thất bại: thiếu userId');
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Thiếu userId',
      });
    }
    if (!data.email) {
      this.logger.warn(`Tạo đơn thất bại: thiếu email (userId=${data.userId})`);
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
        this.logger.warn(
          `Tạo đơn thất bại: số lượng sản phẩm ${item.productId} không hợp lệ (${quantity})`,
        );
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
        this.logger.warn(
          `Tạo đơn thất bại: sản phẩm ${item.productId} không đủ hàng (còn ${stock.remaining}, cần ${quantity})`,
        );
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

    // Trừ kho THẬT SỰ, tuần tự từng item (không Promise.all — cần biết chính
    // xác item nào fail để rollback đúng phần đã trừ). CheckStock ở loop trên
    // chỉ là snapshot, không atomic, nên dù đã pass vẫn có thể hết hàng ở đây
    // do race với đơn khác — decrementStock mới là điểm chặn race thật (SQL
    // atomic UPDATE ... WHERE stock >= qty).
    for (let k = 0; k < orderItems.length; k++) {
      const item = orderItems[k];
      const decremented = await this.productClient.decrementStock(
        item.productId,
        item.quantity,
      );
      if (!decremented.success) {
        this.logger.warn(
          `Tạo đơn thất bại: sản phẩm ${item.productId} vừa hết hàng lúc trừ kho (race với đơn khác)`,
        );
        await this.rollbackDecrements(orderItems.slice(0, k));
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: `Sản phẩm ${item.productId} vừa hết hàng, không thể tạo đơn`,
        });
      }
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
      this.logger.warn(`FindOne thất bại: đơn hàng ${id} không tồn tại`);
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

  /**
   * Hoàn kho cho các item đã decrement thành công trước khi 1 item giữa
   * chừng hết hàng. Lỗi releaseStock (vd network) chỉ log nghiêm trọng, KHÔNG
   * throw đè lên lỗi gốc (hết hàng) — kho có thể bị lệch thật, đây là hạn chế
   * đã biết của cách làm không có saga/outbox, sẽ vá ở phase 2.
   */
  private async rollbackDecrements(items: OrderItemData[]): Promise<void> {
    for (const item of items) {
      try {
        await this.productClient.releaseStock(item.productId, item.quantity);
      } catch (error) {
        this.logger.error(
          `Rollback releaseStock thất bại cho productId=${item.productId}, quantity=${item.quantity} — kho có thể bị lệch`,
          error as Error,
        );
      }
    }
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
