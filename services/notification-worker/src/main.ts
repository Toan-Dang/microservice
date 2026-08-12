import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Worker không mở HTTP/gRPC — chỉ là consumer RabbitMQ. Dùng
 * ApplicationContext (không có server nào lắng nghe cổng). ConsumerService
 * khởi động listener trong OnApplicationBootstrap.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  Logger.log('notification-worker đã khởi động', 'Bootstrap');
}
bootstrap();
