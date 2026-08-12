import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { getProtoPath } from '../common/proto-path.util';
import { AuthClientModule } from '../auth-client/auth-client.module';
import { OrderController } from './order.controller';
import { ORDER_CLIENT, ORDER_PACKAGE_NAME } from './order-client.constants';
import { OrderClientService } from './order-client.service';

@Module({
  imports: [
    // AuthClientModule export JwtAuthGuard (mọi route /orders cần JWT).
    AuthClientModule,
    ClientsModule.registerAsync([
      {
        name: ORDER_CLIENT,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: ORDER_PACKAGE_NAME,
            protoPath: getProtoPath('order.proto'),
            url: config.get<string>('ORDER_GRPC_URL', 'localhost:50053'),
          },
        }),
      },
    ]),
  ],
  controllers: [OrderController],
  providers: [OrderClientService],
  exports: [OrderClientService],
})
export class OrderClientModule {}
