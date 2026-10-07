import { Module } from '@nestjs/common';
import { AdminSettingsModule } from '../admin-settings/admin-settings.module';
import { ReportsController } from './reports.controller';
import { ReportsExcelService } from './reports-excel.service';
import { ReportsService } from './reports.service';

@Module({
  imports: [AdminSettingsModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsExcelService],
})
export class ReportsModule {}
