import { Module } from '@nestjs/common';
import { RabbitmqPublisher } from './rabbitmq.publisher';

@Module({
  providers: [RabbitmqPublisher],
  exports: [RabbitmqPublisher],
})
export class MessagingModule {}
