import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { AuthService } from './auth.service';
import {
  AuthResponse,
  LoginRequest,
  RefreshTokenRequest,
  RegisterRequest,
  ValidateTokenRequest,
  ValidateTokenResponse,
} from './auth.interface';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @GrpcMethod('AuthService', 'Register')
  register(data: RegisterRequest): Promise<AuthResponse> {
    return this.authService.register(data.email, data.password);
  }

  @GrpcMethod('AuthService', 'Login')
  login(data: LoginRequest): Promise<AuthResponse> {
    return this.authService.login(data.email, data.password);
  }

  @GrpcMethod('AuthService', 'ValidateToken')
  validateToken(data: ValidateTokenRequest): Promise<ValidateTokenResponse> {
    return this.authService.validateToken(data.accessToken);
  }

  @GrpcMethod('AuthService', 'RefreshToken')
  refreshToken(data: RefreshTokenRequest): Promise<AuthResponse> {
    return this.authService.refreshToken(data.refreshToken);
  }
}
