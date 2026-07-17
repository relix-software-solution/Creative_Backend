import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OfflineModule } from '../offline/offline.module';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { QrModule } from '../qr/qr.module';
import { RegistrationsModule } from '../registrations/registrations.module';
import { ScansModule } from '../scans/scans.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [
    RegistrationsModule,
    OfflineModule,
    QrModule,
    ScansModule,
    BullModule.registerQueue({
      name: QUEUE_NAMES.OFFLINE_RECONCILIATION,
    }),
  ],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
