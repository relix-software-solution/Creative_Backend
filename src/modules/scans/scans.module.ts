import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BadgeTemplatesModule } from '../badge-templates/badge-templates.module';
import { OfflineModule } from '../offline/offline.module';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { QrModule } from '../qr/qr.module';
import { ScansController } from './scans.controller';
import { ScansService } from './scans.service';

@Module({
  imports: [
    BadgeTemplatesModule,
    OfflineModule,
    QrModule,
    BullModule.registerQueue({
      name: QUEUE_NAMES.SCAN_PROCESSING,
    }),
  ],
  controllers: [ScansController],
  providers: [ScansService],
  exports: [ScansService],
})
export class ScansModule {}
