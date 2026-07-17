import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { SuccessResponseInterceptor } from './common/interceptors/success-response.interceptor';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './database/prisma.module';
import { AttendeeTypesModule } from './modules/attendee-types/attendee-types.module';
import { AuthModule } from './modules/auth/auth.module';
import { BadgeTemplatesModule } from './modules/badge-templates/badge-templates.module';
import { CheckpointsModule } from './modules/checkpoints/checkpoints.module';
import { ClientsModule } from './modules/clients/clients.module';
import { DevicesModule } from './modules/devices/devices.module';
import { DigitalTicketTemplatesModule } from './modules/digital-ticket-templates/digital-ticket-templates.module';
import { DigitalTicketsModule } from './modules/digital-tickets/digital-tickets.module';
import { EventBrandingModule } from './modules/event-branding/event-branding.module';
import { EventsModule } from './modules/events/events.module';
import { HealthModule } from './modules/health/health.module';
import { ImportsModule } from './modules/imports/imports.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PublicModule } from './modules/public/public.module';
import { QrModule } from './modules/qr/qr.module';
import { QueueModule } from './modules/queue/queue.module';
import { RegistrationFieldsModule } from './modules/registration-fields/registration-fields.module';
import { RegistrationsModule } from './modules/registrations/registrations.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ScansModule } from './modules/scans/scans.module';
import { StaffAssignmentsModule } from './modules/staff-assignments/staff-assignments.module';
import { StaffSessionsModule } from './modules/staff-sessions/staff-sessions.module';
import { StorageCleanupModule } from './modules/storage-cleanup/storage-cleanup.module';
import { SyncModule } from './modules/sync/sync.module';
import { UsersModule } from './modules/users/users.module';
import { VenuesModule } from './modules/venues/venues.module';
import { VisitorsModule } from './modules/visitors/visitors.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ZonesModule } from './modules/zones/zones.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
    PrismaModule,
    QueueModule,
    HealthModule,
    UsersModule,
    AuthModule,
    BadgeTemplatesModule,
    ClientsModule,
    EventsModule,
    DevicesModule,
    DigitalTicketTemplatesModule,
    DigitalTicketsModule,
    EventBrandingModule,
    VenuesModule,
    ZonesModule,
    CheckpointsModule,
    ImportsModule,
    NotificationsModule,
    PublicModule,
    AttendeeTypesModule,
    RegistrationFieldsModule,
    RegistrationsModule,
    ReportsModule,
    QrModule,
    ScansModule,
    StaffAssignmentsModule,
    StaffSessionsModule,
    StorageCleanupModule,
    SyncModule,
    VisitorsModule,
    WebhooksModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: SuccessResponseInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule {}
