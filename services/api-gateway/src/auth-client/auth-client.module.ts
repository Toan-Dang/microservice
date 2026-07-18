import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { getProtoPath } from '../common/proto-path.util';
import { AuthController } from './auth.controller';
import { AUTH_CLIENT, AUTH_PACKAGE_NAME } from './auth-client.constants';
import { AuthClientService } from './auth-client.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: AUTH_CLIENT,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: AUTH_PACKAGE_NAME,
            protoPath: getProtoPath('auth.proto'),
            url: config.get<string>('AUTH_GRPC_URL', 'localhost:50051'),
          },
        }),
      },
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthClientService],
})
export class AuthClientModule {}
