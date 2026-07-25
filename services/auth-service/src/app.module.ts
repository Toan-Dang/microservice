import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
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
        migrations: [join(__dirname, 'migrations', '*.{js,ts}')],
        // Chạy migration đang chờ mỗi khi service khởi động (idempotent).
        migrationsRun: true,
        // Dùng migration làm nguồn thay đổi schema, KHÔNG auto-sync (an toàn cho prod).
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature([User]),
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
