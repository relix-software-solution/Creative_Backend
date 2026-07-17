import { Module } from '@nestjs/common';
import { BadgeTemplatesModule } from '../badge-templates/badge-templates.module';
import { QrModule } from '../qr/qr.module';
import { RegistrationsModule } from '../registrations/registrations.module';
import { AdminVisitorsController } from './admin-visitors.controller';
import { StaffVisitorsController } from './staff-visitors.controller';
import { VisitorsService } from './visitors.service';

@Module({
  imports: [BadgeTemplatesModule, QrModule, RegistrationsModule],
  controllers: [AdminVisitorsController, StaffVisitorsController],
  providers: [VisitorsService],
})
export class VisitorsModule {}
