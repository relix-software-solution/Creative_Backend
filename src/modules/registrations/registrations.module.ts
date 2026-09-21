import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DigitalTicketsModule } from '../digital-tickets/digital-tickets.module';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { AdminRegistrationExportService } from './export/admin-registration-export.service';
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
  providers: [RegistrationsService, AdminRegistrationExportService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
