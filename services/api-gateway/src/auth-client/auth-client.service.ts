import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_CLIENT,
  AUTH_SERVICE_NAME,
  AuthGrpcService,
} from './auth-client.constants';

@Injectable()
export class AuthClientService implements OnModuleInit {
  private authService: AuthGrpcService;

  constructor(@Inject(AUTH_CLIENT) private readonly client: ClientGrpc) {}

  onModuleInit() {
    this.authService =
      this.client.getService<AuthGrpcService>(AUTH_SERVICE_NAME);
  }

  ping() {
    return this.authService.validateToken({ accessToken: 'ping' });
  }
}
