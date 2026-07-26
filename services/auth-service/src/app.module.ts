import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeedModule } from './database/seeds/seed.module';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { User } from './auth/user.entity';
import { RedisService } from './redis/redis.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities: [User],
        migrations: [join(__dirname, 'database', 'migrations', '*.{js,ts}')],
        // Chạy migration đang chờ mỗi khi service khởi động (idempotent).
        migrationsRun: true,
        // Dùng migration làm nguồn thay đổi schema, KHÔNG auto-sync (an toàn cho prod).
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature([User]),
    // Seed user dev khi boot, chỉ chạy nếu SEED_ON_BOOT=true.
    SeedModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'dev-secret-change-me'),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, RedisService],
})
export class AppModule {}
