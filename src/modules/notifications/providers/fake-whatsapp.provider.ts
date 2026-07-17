import { NotificationProvider } from '@prisma/client';
import {
  SendWhatsAppMessageInput,
  SendWhatsAppMessageResult,
  WhatsAppProvider,
} from './whatsapp-provider.interface';

export class FakeWhatsAppProvider implements WhatsAppProvider {
  async sendWhatsAppMessage(
    input: SendWhatsAppMessageInput,
  ): Promise<SendWhatsAppMessageResult> {
    return {
      provider: NotificationProvider.FAKE,
      providerMessageId: `fake_${Date.now()}`,
      raw: { ok: true, imageUrl: input.imageUrl },
    };
  }
}
