import { WasenderWhatsAppProvider } from './wasender-whatsapp.provider';

describe('WasenderWhatsAppProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('classifies 400 as permanent', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'bad request' }), {
        status: 400,
      }),
    );
    const provider = new WasenderWhatsAppProvider(
      'https://wasender.test',
      'secret',
    );

    await expect(
      provider.sendWhatsAppMessage({ to: '+963900000000', message: 'hello' }),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_PERMANENT_FAILURE',
      permanent: true,
      retryable: false,
    });
  });

  it('classifies 429 as retryable with retryAfterMs', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'rate' }), {
        status: 429,
        headers: { 'retry-after': '2' },
      }),
    );
    const provider = new WasenderWhatsAppProvider(
      'https://wasender.test',
      'secret',
    );

    await expect(
      provider.sendWhatsAppMessage({ to: '+963900000000', message: 'hello' }),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_RATE_LIMITED',
      retryable: true,
      permanent: false,
      retryAfterMs: 2000,
    });
  });

  it('classifies timeout as retryable', async () => {
    global.fetch = jest.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), {
        name: 'AbortError',
      }),
    );
    const provider = new WasenderWhatsAppProvider(
      'https://wasender.test',
      'secret',
      1,
    );

    await expect(
      provider.sendWhatsAppMessage({ to: '+963900000000', message: 'hello' }),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_TIMEOUT',
      retryable: true,
      permanent: false,
    });
  });
});
