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
        package: 'auth',
        protoPath: getProtoPath('auth.proto'),
        url: process.env.GRPC_URL ?? '0.0.0.0:50051',
      },
    },
  );
  await app.listen();
}
bootstrap();
