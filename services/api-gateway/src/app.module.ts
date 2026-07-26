import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthClientModule } from './auth-client/auth-client.module';
import { ProductClientModule } from './product-client/product-client.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      // Rate-limit theo IP, áp cho MỌI route REST — chống bot/script quét
      // liên tục (vd GET /products không có JWT, ai cũng gọi được).
      // Default: 20 request / 10s / IP. Override qua env khi cần siết chặt hơn.
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('THROTTLE_TTL_MS', 10_000),
            limit: config.get<number>('THROTTLE_LIMIT', 20),
          },
        ],
      }),
    }),
    AuthClientModule,
    ProductClientModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
