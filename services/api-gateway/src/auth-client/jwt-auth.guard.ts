import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthClientService } from './auth-client.service';

export interface AuthUser {
  userId: string;
  email: string;
}

/**
 * Guard bảo vệ route REST: lấy Bearer token, gọi ValidateToken (gRPC) của
 * auth-service. Hợp lệ thì gắn req.user; ngược lại trả 401.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private readonly authClientService: AuthClientService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) {
      this.logger.warn(`${request.method} ${request.originalUrl}: thiếu Bearer token`);
      throw new UnauthorizedException('Thiếu Bearer token');
    }

    let result: { valid: boolean; userId: string; email: string };
    try {
      result = await this.authClientService.validateToken(token);
    } catch (error) {
      this.logger.error(
        `${request.method} ${request.originalUrl}: gọi ValidateToken thất bại`,
        error as Error,
      );
      throw new UnauthorizedException('Không xác thực được token');
    }

    if (!result.valid) {
      this.logger.warn(
        `${request.method} ${request.originalUrl}: token không hợp lệ hoặc đã hết hạn`,
      );
      throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
    }

    this.logger.log(
      `${request.method} ${request.originalUrl}: token hợp lệ (userId=${result.userId}, email=${result.email})`,
    );

    (request as Request & { user: AuthUser }).user = {
      userId: result.userId,
      email: result.email,
    };
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return undefined;
    }
    const [scheme, token] = authHeader.split(' ');
    return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
  }
}
