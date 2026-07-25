import {
  CanActivate,
  ExecutionContext,
  Injectable,
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
  constructor(private readonly authClientService: AuthClientService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Thiếu Bearer token');
    }

    let result: { valid: boolean; userId: string; email: string };
    try {
      result = await this.authClientService.validateToken(token);
    } catch {
      throw new UnauthorizedException('Không xác thực được token');
    }

    if (!result.valid) {
      throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
    }

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
