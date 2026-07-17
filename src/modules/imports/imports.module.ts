import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { RegistrationsModule } from '../registrations/registrations.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [
    RegistrationsModule,
    BullModule.registerQueue({
      name: QUEUE_NAMES.IMPORT_PROCESSING,
    }),
    BullModule.registerQueue({
      name: QUEUE_NAMES.WHATSAPP_NOTIFICATIONS,
    }),
  ],
  controllers: [ImportsController],
  providers: [ImportsService],
  exports: [ImportsService],
})
export class ImportsModule {}
