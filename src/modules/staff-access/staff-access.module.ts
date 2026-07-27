import { Module } from '@nestjs/common';
import { OfflineModule } from '../offline/offline.module';
import { StaffAccessService } from './staff-access.service';
import { StaffOfflineController } from './staff-offline.controller';
import { StaffOfflineService } from './staff-offline.service';

@Module({
  imports: [OfflineModule],
  controllers: [StaffOfflineController],
  providers: [StaffAccessService, StaffOfflineService],
  exports: [StaffAccessService, StaffOfflineService],
})
export class StaffAccessModule {}
