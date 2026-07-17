import { Module } from '@nestjs/common';
import { OfflineModule } from '../offline/offline.module';
import { QueueModule } from '../queue/queue.module';
import { ScansModule } from '../scans/scans.module';
import { SyncModule } from '../sync/sync.module';
import { DeviceController, DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  imports: [OfflineModule, QueueModule, ScansModule, SyncModule],
  controllers: [DevicesController, DeviceController],
  providers: [DevicesService],
})
export class DevicesModule {}
