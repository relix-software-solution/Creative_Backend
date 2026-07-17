import { Module } from '@nestjs/common';
import { BadgeTemplatesModule } from '../badge-templates/badge-templates.module';
import { DigitalTicketsModule } from '../digital-tickets/digital-tickets.module';
import { DigitalTicketTemplatesController } from './digital-ticket-templates.controller';
import { DigitalTicketTemplatesService } from './digital-ticket-templates.service';

@Module({
  imports: [BadgeTemplatesModule, DigitalTicketsModule],
  controllers: [DigitalTicketTemplatesController],
  providers: [DigitalTicketTemplatesService],
  exports: [DigitalTicketTemplatesService],
})
export class DigitalTicketTemplatesModule {}
