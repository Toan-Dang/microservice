import { Injectable } from '@nestjs/common';
import { AuthResponse, ValidateTokenResponse } from './auth.interface';

/**
 * Bước Day 1: chỉ trả giá trị giả để test kết nối gRPC end-to-end.
 * Logic thật (hash password, JWT, Redis refresh token...) làm ở Day 2.
 */
@Injectable()
export class AuthService {
  register(email: string): AuthResponse {
    return {
      userId: 'stub-user-id',
      email,
      accessToken: 'stub-access-token',
      refreshToken: 'stub-refresh-token',
    };
  }

  login(email: string): AuthResponse {
    return {
      userId: 'stub-user-id',
      email,
      accessToken: 'stub-access-token',
      refreshToken: 'stub-refresh-token',
    };
  }

  validateToken(accessToken: string): ValidateTokenResponse {
    return {
      valid: accessToken.length > 0,
      userId: 'stub-user-id',
      email: 'stub@example.com',
    };
  }

  refreshToken(refreshToken: string): AuthResponse {
    return {
      userId: 'stub-user-id',
      email: 'stub@example.com',
      accessToken: 'stub-access-token-refreshed',
      refreshToken,
    };
  }
}
