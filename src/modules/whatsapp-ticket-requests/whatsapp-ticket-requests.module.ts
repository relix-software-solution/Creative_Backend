import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { DigitalTicketsModule } from '../digital-tickets/digital-tickets.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WhatsappTicketRequestsService } from './whatsapp-ticket-requests.service';

@Module({
  imports: [PrismaModule, DigitalTicketsModule, NotificationsModule],
  providers: [WhatsappTicketRequestsService],
  exports: [WhatsappTicketRequestsService],
})
export class WhatsappTicketRequestsModule {}
