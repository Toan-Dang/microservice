import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * Log mỗi request REST đi qua gateway (method, path, status, thời gian).
 * Dùng để đối chiếu với log của service phía sau (auth/product/order) khi
 * chạy `docker compose logs -f`, thấy rõ request "nhảy" từ process này
 * sang process kia.
 */
@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl } = req;
    const start = Date.now();
    res.on('finish', () => {
      this.logger.log(
        `${method} ${originalUrl} ${res.statusCode} +${Date.now() - start}ms`,
      );
    });
    next();
  }
}
