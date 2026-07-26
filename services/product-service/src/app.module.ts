import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeedModule } from './database/seeds/seed.module';
import { ProductController } from './product/product.controller';
import { ProductService } from './product/product.service';
import { ENTITIES, Product } from './entities';

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
    // forFeature khai riêng từng entity: đây là những Repository mà module NÀY
    // được phép inject — khác mục đích với `entities` ở trên.
    TypeOrmModule.forFeature([Product]),
    // Seed dữ liệu mẫu khi boot, chỉ chạy nếu SEED_ON_BOOT=true.
    SeedModule,
  ],
  controllers: [ProductController],
  providers: [ProductService],
})
export class AppModule {}
