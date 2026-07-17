import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { WhatsappTicketRequestsService } from '../whatsapp-ticket-requests/whatsapp-ticket-requests.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly whatsappTicketRequestsService: WhatsappTicketRequestsService,
  ) {}

  @Post('wasender')
  @HttpCode(200)
  wasender(
    @Headers()
    headers: Record<string, string | string[] | undefined>,
    @Body()
    body: Record<string, unknown>,
  ) {
    return this.whatsappTicketRequestsService.handleWasenderWebhook(
      headers,
      body,
    );
  }
}
