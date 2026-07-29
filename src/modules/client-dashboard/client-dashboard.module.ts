import { Module } from '@nestjs/common';
import { ClientAnalyticsController } from './client-analytics.controller';
import { ClientAnalyticsService } from './client-analytics.service';
import { ClientDashboardController } from './client-dashboard.controller';
import { ClientDashboardQueryService } from './client-dashboard-query.service';
import { ClientDashboardService } from './client-dashboard.service';
import { ClientEventsController } from './client-events.controller';
import { ClientEventsService } from './client-events.service';
import { ClientRegistrationsController } from './client-registrations.controller';
import { ClientRegistrationsService } from './client-registrations.service';
import { ClientRegistrationExportService } from './export/client-registration-export.service';

@Module({
  controllers: [
    ClientDashboardController,
    ClientEventsController,
    ClientRegistrationsController,
    ClientAnalyticsController,
  ],

  providers: [
    ClientDashboardService,
    ClientDashboardQueryService,
    ClientEventsService,
    ClientRegistrationsService,
    ClientAnalyticsService,
    ClientRegistrationExportService,
  ],
})
export class ClientDashboardModule {}
