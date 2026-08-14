import { HttpException, HttpStatus, Logger } from '@nestjs/common';

const logger = new Logger('RpcError');

// gRPC status code -> HTTP status. Tham chiếu @grpc/grpc-js status enum.
const GRPC_TO_HTTP: Record<number, HttpStatus> = {
  3: HttpStatus.BAD_REQUEST, // INVALID_ARGUMENT
  5: HttpStatus.NOT_FOUND, // NOT_FOUND
  6: HttpStatus.CONFLICT, // ALREADY_EXISTS
  7: HttpStatus.FORBIDDEN, // PERMISSION_DENIED
  9: HttpStatus.CONFLICT, // FAILED_PRECONDITION (vd đặt hàng khi hết kho)
  16: HttpStatus.UNAUTHORIZED, // UNAUTHENTICATED
  4: HttpStatus.GATEWAY_TIMEOUT, // DEADLINE_EXCEEDED
};

interface GrpcError {
  code?: number;
  details?: string;
  message?: string;
}

/**
 * Chuyển lỗi từ gRPC (RpcException phía service) thành HttpException để client
 * REST nhận đúng status code + message.
 */
export function rpcToHttp(raw: unknown): HttpException {
  const err = (raw ?? {}) as GrpcError;
  const httpStatus =
    (err.code !== undefined && GRPC_TO_HTTP[err.code]) ||
    HttpStatus.INTERNAL_SERVER_ERROR;
  const message = err.details || err.message || 'Lỗi không xác định';

  // 5xx (service sập, timeout, lỗi gRPC không map được) → error kèm nguyên
  // nhân object gốc để có stack/context; 4xx (lỗi nghiệp vụ do client) → warn.
  if (httpStatus >= HttpStatus.INTERNAL_SERVER_ERROR) {
    logger.error(`[${httpStatus}] ${message}`, raw as Error);
  } else {
    logger.warn(`[${httpStatus}] ${message}`);
  }

  return new HttpException(message, httpStatus);
}
