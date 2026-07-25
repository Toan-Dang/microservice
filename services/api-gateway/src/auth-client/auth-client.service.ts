import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import {
  AUTH_CLIENT,
  AUTH_SERVICE_NAME,
  AuthGrpcService,
  AuthResponse,
  ValidateTokenResponse,
} from './auth-client.constants';

@Injectable()
export class AuthClientService implements OnModuleInit {
  private authService: AuthGrpcService;

  constructor(@Inject(AUTH_CLIENT) private readonly client: ClientGrpc) {}

  onModuleInit() {
    this.authService =
      this.client.getService<AuthGrpcService>(AUTH_SERVICE_NAME);
  }

  register(email: string, password: string): Promise<AuthResponse> {
    return firstValueFrom(this.authService.register({ email, password }));
  }

  login(email: string, password: string): Promise<AuthResponse> {
    return firstValueFrom(this.authService.login({ email, password }));
  }

  refresh(refreshToken: string): Promise<AuthResponse> {
    return firstValueFrom(this.authService.refreshToken({ refreshToken }));
  }

  validateToken(accessToken: string): Promise<ValidateTokenResponse> {
    return firstValueFrom(this.authService.validateToken({ accessToken }));
  }
}
