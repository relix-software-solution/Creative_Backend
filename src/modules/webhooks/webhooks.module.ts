import { Module } from '@nestjs/common';
import { WhatsappTicketRequestsModule } from '../whatsapp-ticket-requests/whatsapp-ticket-requests.module';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [WhatsappTicketRequestsModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
