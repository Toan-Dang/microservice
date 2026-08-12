import { Observable } from 'rxjs';

export const PRODUCT_PACKAGE_NAME = 'product';
export const PRODUCT_SERVICE_NAME = 'ProductService';
export const PRODUCT_CLIENT = 'PRODUCT_CLIENT';

export interface CheckStockResponse {
  available: boolean;
  price: number;
  remaining: number;
}

// order-service chỉ cần CheckStock của ProductService (proto/product.proto).
// proto-loader trả snake_case -> camelCase nên product_id thành productId.
export interface ProductGrpcService {
  checkStock(data: {
    productId: string;
    quantity: number;
  }): Observable<CheckStockResponse>;
}
