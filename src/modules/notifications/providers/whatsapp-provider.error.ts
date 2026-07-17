export class WhatsAppProviderError extends Error {
  constructor(
    message: string,
    readonly code = 'WHATSAPP_SEND_FAILED',
    readonly options: {
      retryable?: boolean;
      permanent?: boolean;
      retryAfterMs?: number;
      statusCode?: number;
      safeDetails?: unknown;
    } = {},
  ) {
    super(message);
  }

  get retryable() {
    return this.options.retryable === true;
  }

  get permanent() {
    return this.options.permanent === true;
  }

  get retryAfterMs() {
    return this.options.retryAfterMs;
  }

  get statusCode() {
    return this.options.statusCode;
  }

  get safeDetails() {
    return this.options.safeDetails;
  }
}
