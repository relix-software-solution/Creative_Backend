import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BadgeTemplatesModule } from '../badge-templates/badge-templates.module';
import { AdminSettingsModule } from '../admin-settings/admin-settings.module';
import { OfflineModule } from '../offline/offline.module';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { QrModule } from '../qr/qr.module';
import { StaffAccessModule } from '../staff-access/staff-access.module';
import { ScanTrackingController } from './scan-tracking.controller';
import { ScanTrackingService } from './scan-tracking.service';
import { ScansController } from './scans.controller';
import { ScansService } from './scans.service';

@Module({
  imports: [
    AdminSettingsModule,
    BadgeTemplatesModule,
    OfflineModule,
    QrModule,
    StaffAccessModule,
    BullModule.registerQueue({
      name: QUEUE_NAMES.SCAN_PROCESSING,
    }),
  ],
  controllers: [ScansController, ScanTrackingController],
  providers: [ScansService, ScanTrackingService],
  exports: [ScansService],
})
export class ScansModule {}
