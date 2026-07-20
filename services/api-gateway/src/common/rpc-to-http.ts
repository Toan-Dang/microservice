import { HttpException, HttpStatus } from '@nestjs/common';

// gRPC status code -> HTTP status. Tham chiếu @grpc/grpc-js status enum.
const GRPC_TO_HTTP: Record<number, HttpStatus> = {
  3: HttpStatus.BAD_REQUEST, // INVALID_ARGUMENT
  5: HttpStatus.NOT_FOUND, // NOT_FOUND
  6: HttpStatus.CONFLICT, // ALREADY_EXISTS
  7: HttpStatus.FORBIDDEN, // PERMISSION_DENIED
  16: HttpStatus.UNAUTHORIZED, // UNAUTHENTICATED
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
  return new HttpException(message, httpStatus);
}
