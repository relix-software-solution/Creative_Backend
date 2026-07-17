import { Module } from '@nestjs/common';
import { EventBrandingController } from './event-branding.controller';
import { EventBrandingService } from './event-branding.service';

@Module({
  controllers: [EventBrandingController],
  providers: [EventBrandingService],
  exports: [EventBrandingService],
})
export class EventBrandingModule {}
