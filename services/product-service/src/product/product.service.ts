import { status } from '@grpc/grpc-js';
import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CheckStockResponse,
  CreateProductRequest,
  DecrementStockResponse,
  ProductList,
  ProductMessage,
  ReleaseStockResponse,
} from './product.interface';
import { Product } from '../entities/product.entity';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
  ) {}

  async create(data: CreateProductRequest): Promise<ProductMessage> {
    const name = (data.name ?? '').trim();
    if (!name) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Tên sản phẩm không được để trống',
      });
    }
    if (data.price === undefined || data.price < 0) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Giá sản phẩm phải >= 0',
      });
    }
    if (data.stock === undefined || data.stock < 0) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Tồn kho phải >= 0',
      });
    }

    const saved = await this.products.save(
      this.products.create({ name, price: data.price, stock: data.stock }),
    );
    return this.toMessage(saved);
  }

  async findOne(id: string): Promise<ProductMessage> {
    const product = await this.products.findOne({ where: { id } });
    if (!product) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Sản phẩm không tồn tại',
      });
    }
    return this.toMessage(product);
  }

  async findMany(page?: number, limit?: number): Promise<ProductList> {
    const safePage = page && page > 0 ? Math.floor(page) : DEFAULT_PAGE;
    const rawLimit = limit && limit > 0 ? Math.floor(limit) : DEFAULT_LIMIT;
    const safeLimit = Math.min(rawLimit, MAX_LIMIT);

    const [items, total] = await this.products.findAndCount({
      // `id` là tie-breaker BẮT BUỘC: nhiều sản phẩm có thể trùng `createdAt`
      // (vd 5 bản ghi seed insert cùng 1 batch → cùng timestamp). Khi giá trị
      // sort trùng nhau, Postgres KHÔNG đảm bảo thứ tự, nên phân trang có thể
      // trả trùng hoặc bỏ sót bản ghi giữa các page. Thêm 1 cột unique vào
      // ORDER BY làm thứ tự trở nên tất định.
      order: { createdAt: 'ASC', id: 'ASC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return {
      products: items.map((p) => this.toMessage(p)),
      total,
    };
  }

  /**
   * CheckStock — order-service gọi trước khi tạo đơn.
   * available = còn đủ hàng cho `quantity`; price = giá hiện tại;
   * remaining = tồn kho hiện tại (KHÔNG trừ, vì CheckStock chỉ kiểm tra).
   */
  async checkStock(
    productId: string,
    quantity: number,
  ): Promise<CheckStockResponse> {
    const product = await this.products.findOne({ where: { id: productId } });
    if (!product) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Sản phẩm không tồn tại',
      });
    }

    const qty = quantity ?? 0;
    return {
      available: qty > 0 && product.stock >= qty,
      price: product.price,
      remaining: product.stock,
    };
  }

  /**
   * DecrementStock — trừ kho ATOMIC ở tầng SQL: điều kiện `stock >= :qty`
   * nằm trong WHERE của câu UPDATE nên 2 request trừ kho cùng lúc không thể
   * cùng "thấy đủ hàng" rồi cùng trừ (khác với đọc-rồi-ghi 2 bước, vẫn race).
   * affected=0 nghĩa là HOẶC không tồn tại HOẶC không đủ hàng; findOne phụ ở
   * đây chỉ để phân biệt 2 case cho đúng message lỗi, KHÔNG ảnh hưởng tính
   * atomic (điều kiện chặn race đã nằm trong WHERE ở trên).
   */
  async decrementStock(
    productId: string,
    quantity: number,
  ): Promise<DecrementStockResponse> {
    const result = await this.products
      .createQueryBuilder()
      .update(Product)
      .set({ stock: () => 'stock - :qty' })
      .where('id = :id AND stock >= :qty', { id: productId, qty: quantity })
      .setParameters({ qty: quantity })
      .execute();

    if (result.affected === 0) {
      const product = await this.products.findOne({
        where: { id: productId },
      });
      if (!product) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: 'Sản phẩm không tồn tại',
        });
      }
      return { success: false, remaining: product.stock };
    }

    const updated = await this.products.findOne({ where: { id: productId } });
    return { success: true, remaining: updated?.stock ?? 0 };
  }

  /**
   * ReleaseStock — hoàn kho, dùng trong nhánh rollback khi 1 phần đơn thất
   * bại giữa chừng. Luôn cộng lại, không điều kiện. Nếu productId không tồn
   * tại thì chỉ log warning, KHÔNG throw — đang chạy trong nhánh dọn dẹp lỗi,
   * ném lỗi mới ở đây sẽ đè mất lỗi gốc khiến caller khó debug hơn.
   */
  async releaseStock(
    productId: string,
    quantity: number,
  ): Promise<ReleaseStockResponse> {
    const result = await this.products
      .createQueryBuilder()
      .update(Product)
      .set({ stock: () => 'stock + :qty' })
      .where('id = :id', { id: productId })
      .setParameters({ qty: quantity })
      .execute();

    if (result.affected === 0) {
      this.logger.warn(
        `ReleaseStock: sản phẩm ${productId} không tồn tại, bỏ qua hoàn kho`,
      );
      return { remaining: 0 };
    }

    const updated = await this.products.findOne({ where: { id: productId } });
    return { remaining: updated?.stock ?? 0 };
  }

  private toMessage(product: Product): ProductMessage {
    return {
      id: product.id,
      name: product.name,
      price: product.price,
      stock: product.stock,
    };
  }
}
