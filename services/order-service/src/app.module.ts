import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderController } from './order/order.controller';
import { OrderService } from './order/order.service';
import { ProductClientModule } from './product-client/product-client.module';
import { MessagingModule } from './messaging/messaging.module';
import { ENTITIES, Order } from './entities';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        // ENTITIES = toàn bộ entity của service (cho connection).
        entities: ENTITIES,
        migrations: [join(__dirname, 'database', 'migrations', '*.{js,ts}')],
        // Chạy migration đang chờ mỗi khi service khởi động (idempotent).
        migrationsRun: true,
        // Dùng migration làm nguồn thay đổi schema, KHÔNG auto-sync (an toàn cho prod).
        synchronize: false,
      }),
    }),
    // forFeature khai riêng từng entity: đây là Repository mà module NÀY inject.
    TypeOrmModule.forFeature([Order]),
    // gRPC client gọi product-service.CheckStock (sync) trước khi tạo đơn.
    ProductClientModule,
    // Publisher RabbitMQ: phát event order.created (async).
    MessagingModule,
  ],
  controllers: [OrderController],
  providers: [OrderService],
})
export class AppModule {}
