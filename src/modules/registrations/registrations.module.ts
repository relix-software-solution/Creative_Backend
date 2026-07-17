import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DigitalTicketsModule } from '../digital-tickets/digital-tickets.module';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: QUEUE_NAMES.REGISTRATION_PIPELINE,
    }),
    DigitalTicketsModule,
  ],
  controllers: [RegistrationsController],
  providers: [RegistrationsService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
