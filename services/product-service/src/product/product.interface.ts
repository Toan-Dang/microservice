// Các message khớp proto/product.proto. proto-loader (keepCase mặc định = false)
// tự chuyển snake_case -> camelCase, nên `product_id` phía proto thành `productId`.

export interface ProductMessage {
  id: string;
  name: string;
  price: number;
  stock: number;
}

export interface CreateProductRequest {
  name: string;
  price: number;
  stock: number;
}

export interface FindOneRequest {
  id: string;
}

export interface FindManyRequest {
  page: number;
  limit: number;
}

export interface ProductList {
  products: ProductMessage[];
  total: number;
}

export interface CheckStockRequest {
  productId: string;
  quantity: number;
}

export interface CheckStockResponse {
  available: boolean;
  price: number;
  remaining: number;
}

export interface DecrementStockRequest {
  productId: string;
  quantity: number;
}

export interface DecrementStockResponse {
  success: boolean;
  remaining: number;
}

export interface ReleaseStockRequest {
  productId: string;
  quantity: number;
}

export interface ReleaseStockResponse {
  remaining: number;
}
