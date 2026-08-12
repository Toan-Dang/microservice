import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { getProtoPath } from '../common/proto-path.util';
import {
  PRODUCT_CLIENT,
  PRODUCT_PACKAGE_NAME,
} from './product-client.constants';
import { ProductClientService } from './product-client.service';

@Module({
  imports: [
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
  providers: [ProductClientService],
  exports: [ProductClientService],
})
export class ProductClientModule {}
