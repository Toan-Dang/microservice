import { status } from '@grpc/grpc-js';
import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CheckStockResponse,
  CreateProductRequest,
  ProductList,
  ProductMessage,
} from './product.interface';
import { Product } from '../entities/product.entity';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

@Injectable()
export class ProductService {
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

  private toMessage(product: Product): ProductMessage {
    return {
      id: product.id,
      name: product.name,
      price: product.price,
      stock: product.stock,
    };
  }
}
