import { NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationProvider } from '@prisma/client';
import { FakeWhatsAppProvider } from './fake-whatsapp.provider';
import { WasenderWhatsAppProvider } from './wasender-whatsapp.provider';
import { WhatsAppProvider } from './whatsapp-provider.interface';

export class WhatsAppProviderFactory {
  constructor(private readonly configService: ConfigService) {}

  create(): WhatsAppProvider {
    const provider = this.configService.get<NotificationProvider>(
      'WHATSAPP_PROVIDER',
      NotificationProvider.FAKE,
    );

    if (provider === NotificationProvider.WASENDER) {
      return new WasenderWhatsAppProvider(
        this.configService.get<string>(
          'WASENDER_API_URL',
          'https://wasenderapi.com/api',
        ),
        this.configService.get<string>('WASENDER_API_KEY'),
        this.configService.get<number>('WHATSAPP_HTTP_TIMEOUT_MS', 15000),
      );
    }

    if (provider === NotificationProvider.META_CLOUD) {
      throw new NotImplementedException('META_CLOUD provider is not implemented');
    }

    return new FakeWhatsAppProvider();
  }
}
