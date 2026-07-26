import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { getProtoPath } from '../common/proto-path.util';
import { AuthClientModule } from '../auth-client/auth-client.module';
import { ProductController } from './product.controller';
import {
  PRODUCT_CLIENT,
  PRODUCT_PACKAGE_NAME,
} from './product-client.constants';
import { ProductClientService } from './product-client.service';

@Module({
  imports: [
    // AuthClientModule export JwtAuthGuard (dùng cho POST /products).
    AuthClientModule,
    ClientsModule.registerAsync([
      {
        name: PRODUCT_CLIENT,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: PRODUCT_PACKAGE_NAME,
            protoPath: getProtoPath('product.proto'),
            url: config.get<string>('PRODUCT_GRPC_URL', 'localhost:50052'),
          },
        }),
      },
    ]),
  ],
  controllers: [ProductController],
  providers: [ProductClientService],
  exports: [ProductClientService],
})
export class ProductClientModule {}
