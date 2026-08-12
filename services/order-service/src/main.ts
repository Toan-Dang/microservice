import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { getProtoPath } from './common/proto-path.util';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.GRPC,
      options: {
        package: 'order',
        protoPath: getProtoPath('order.proto'),
        url: process.env.GRPC_URL ?? '0.0.0.0:50053',
      },
    },
  );
  app.enableShutdownHooks();
  await app.listen();
}
bootstrap();
