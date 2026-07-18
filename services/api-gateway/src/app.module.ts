import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthClientModule } from './auth-client/auth-client.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), AuthClientModule],
  controllers: [HealthController],
})
export class AppModule {}
