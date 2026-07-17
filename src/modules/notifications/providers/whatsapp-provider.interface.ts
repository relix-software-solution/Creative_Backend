import { NotificationProvider } from '@prisma/client';

export type SendWhatsAppMessageInput = {
  to: string;
  message: string;
  imageUrl?: string;
  metadata?: Record<string, unknown>;
};

export type SendWhatsAppMessageResult = {
  provider: NotificationProvider;
  providerMessageId?: string;
  raw?: unknown;
};

export interface WhatsAppProvider {
  sendWhatsAppMessage(
    input: SendWhatsAppMessageInput,
  ): Promise<SendWhatsAppMessageResult>;
}
