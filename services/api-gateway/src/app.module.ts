import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthClientModule } from './auth-client/auth-client.module';
import { ProductClientModule } from './product-client/product-client.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthClientModule,
    ProductClientModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
