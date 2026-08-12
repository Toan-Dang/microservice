import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { ConsumerService } from './consumer.service';

@Module({
  imports: [EmailModule],
  providers: [ConsumerService],
})
export class ConsumerModule {}
