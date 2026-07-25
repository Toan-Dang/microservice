import { Observable } from 'rxjs';

export const PRODUCT_PACKAGE_NAME = 'product';
export const PRODUCT_SERVICE_NAME = 'ProductService';
export const PRODUCT_CLIENT = 'PRODUCT_CLIENT';

export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
}

export interface ProductList {
  products: Product[];
  total: number;
}

export interface CheckStockResponse {
  available: boolean;
  price: number;
  remaining: number;
}

// Interface khớp gRPC ProductService (proto/product.proto). proto-loader trả
// snake_case -> camelCase, nên CheckStockRequest.product_id thành productId.
export interface ProductGrpcService {
  create(data: {
    name: string;
    price: number;
    stock: number;
  }): Observable<Product>;
  findOne(data: { id: string }): Observable<Product>;
  findMany(data: { page: number; limit: number }): Observable<ProductList>;
  checkStock(data: {
    productId: string;
    quantity: number;
  }): Observable<CheckStockResponse>;
}
