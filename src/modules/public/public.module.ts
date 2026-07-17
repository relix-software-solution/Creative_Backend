import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { BadgeTemplatesModule } from '../badge-templates/badge-templates.module';
import { DigitalTicketTemplatesModule } from '../digital-ticket-templates/digital-ticket-templates.module';
import { DigitalTicketsModule } from '../digital-tickets/digital-tickets.module';
import { RegistrationsModule } from '../registrations/registrations.module';
import { WhatsappTicketRequestsModule } from '../whatsapp-ticket-requests/whatsapp-ticket-requests.module';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

@Module({
  imports: [
    PrismaModule,
    BadgeTemplatesModule,
    DigitalTicketTemplatesModule,
    DigitalTicketsModule,
    RegistrationsModule,
    WhatsappTicketRequestsModule,
  ],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
