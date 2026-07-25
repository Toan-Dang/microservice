import { status } from '@grpc/grpc-js';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CheckStockResponse,
  CreateProductRequest,
  ProductList,
  ProductMessage,
} from './product.interface';
import { Product } from './product.entity';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

// 5 sản phẩm mẫu seed khi bảng rỗng.
const SEED_PRODUCTS: CreateProductRequest[] = [
  { name: 'Bàn phím cơ', price: 990000, stock: 50 },
  { name: 'Chuột không dây', price: 450000, stock: 120 },
  { name: 'Tai nghe Bluetooth', price: 1290000, stock: 30 },
  { name: 'Màn hình 27 inch', price: 4590000, stock: 15 },
  { name: 'Ổ cứng SSD 1TB', price: 1890000, stock: 0 },
];

@Injectable()
export class ProductService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
  ) {}

  /** Seed dữ liệu mẫu khi khởi động nếu bảng products đang rỗng. */
  async onApplicationBootstrap(): Promise<void> {
    const count = await this.products.count();
    if (count > 0) {
      return;
    }
    await this.products.save(
      SEED_PRODUCTS.map((p) => this.products.create(p)),
    );
    this.logger.log(`Đã seed ${SEED_PRODUCTS.length} sản phẩm mẫu`);
  }

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
      order: { createdAt: 'ASC' },
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

  private toMessage(product: Product): ProductMessage {
    return {
      id: product.id,
      name: product.name,
      price: product.price,
      stock: product.stock,
    };
  }
}
