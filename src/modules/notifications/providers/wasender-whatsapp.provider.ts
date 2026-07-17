import { NotificationProvider } from '@prisma/client';
import {
  SendWhatsAppMessageInput,
  SendWhatsAppMessageResult,
  WhatsAppProvider,
} from './whatsapp-provider.interface';
import { WhatsAppProviderError } from './whatsapp-provider.error';

export class WasenderWhatsAppProvider implements WhatsAppProvider {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey?: string,
    private readonly timeoutMs = 15000,
  ) {}

  async sendWhatsAppMessage(
    input: SendWhatsAppMessageInput,
  ): Promise<SendWhatsAppMessageResult> {
    if (!this.apiKey) {
      throw new WhatsAppProviderError(
        'WASENDER_API_KEY is required when using WASENDER',
        'WHATSAPP_PROVIDER_CONFIG_ERROR',
        { permanent: true, retryable: false },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;

    try {
      response = await fetch(`${this.apiUrl}/send-message`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: input.to,
          text: input.message,
          ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
        }),
      });
    } catch (error) {
      throw this.toNetworkError(error);
    } finally {
      clearTimeout(timeout);
    }

    const raw = await this.parseResponse(response);

    if (!response.ok) {
      const classification = this.classifyStatus(response.status);
      throw new WhatsAppProviderError(
        `Wasender request failed with status ${response.status}`,
        response.status === 429
          ? 'WHATSAPP_RATE_LIMITED'
          : classification.code,
        {
          ...classification,
          statusCode: response.status,
          retryAfterMs:
            response.status === 429 ? this.getRetryAfterMs(response) : undefined,
          safeDetails: this.sanitizeRaw(raw),
        },
      );
    }

    return {
      provider: NotificationProvider.WASENDER,
      providerMessageId: this.extractProviderMessageId(raw),
      raw: this.sanitizeRaw(raw),
    };
  }

  private async parseResponse(response: Response): Promise<unknown> {
    const text = (await response.text()).slice(0, 4000);

    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private extractProviderMessageId(raw: unknown): string | undefined {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }

    const body = raw as Record<string, unknown>;
    const data = body.data as Record<string, unknown> | undefined;
    const value =
      body.id ??
      body.messageId ??
      body.message_id ??
      data?.id ??
      data?.messageId;

    return typeof value === 'string' ? value : undefined;
  }

  private getRetryAfterMs(response: Response): number | undefined {
    const retryAfter = response.headers.get('retry-after');
    const reset = response.headers.get('x-ratelimit-reset');

    if (retryAfter) {
      const retryAfterSeconds = Number(retryAfter);

      if (!Number.isNaN(retryAfterSeconds)) {
        return retryAfterSeconds * 1000;
      }

      const retryAfterDate = Date.parse(retryAfter);

      if (!Number.isNaN(retryAfterDate)) {
        return Math.max(retryAfterDate - Date.now(), 0);
      }
    }

    if (reset) {
      const resetNumber = Number(reset);
      const resetMs = resetNumber > 10_000_000_000
        ? resetNumber
        : resetNumber * 1000;

      if (!Number.isNaN(resetMs)) {
        return Math.max(resetMs - Date.now(), 0);
      }
    }

    return undefined;
  }

  private classifyStatus(statusCode: number) {
    if ([400, 401, 403, 404].includes(statusCode)) {
      return {
        code: 'WHATSAPP_PERMANENT_FAILURE',
        permanent: true,
        retryable: false,
      };
    }

    if ([408, 425, 429, 500, 502, 503, 504].includes(statusCode)) {
      return {
        code: 'WHATSAPP_RETRYABLE_FAILURE',
        permanent: false,
        retryable: true,
      };
    }

    return {
      code: 'WHATSAPP_SEND_FAILED',
      permanent: false,
      retryable: true,
    };
  }

  private toNetworkError(error: unknown) {
    const message = error instanceof Error ? error.message : 'Network error';
    const aborted =
      error instanceof Error &&
      (error.name === 'AbortError' || message.toLowerCase().includes('abort'));

    return new WhatsAppProviderError(
      aborted ? 'Wasender request timed out' : 'Wasender network request failed',
      aborted ? 'WHATSAPP_TIMEOUT' : 'WHATSAPP_NETWORK_ERROR',
      {
        retryable: true,
        permanent: false,
        safeDetails: {
          message: this.truncate(message),
          name: error instanceof Error ? error.name : undefined,
        },
      },
    );
  }

  private sanitizeRaw(raw: unknown): unknown {
    if (typeof raw === 'string') {
      return this.truncate(raw);
    }

    if (!raw || typeof raw !== 'object') {
      return raw;
    }

    const serialized = JSON.stringify(raw);

    return serialized.length > 2000 ? this.truncate(serialized) : raw;
  }

  private truncate(value: string) {
    return value.length > 2000 ? `${value.slice(0, 2000)}...` : value;
  }
}
