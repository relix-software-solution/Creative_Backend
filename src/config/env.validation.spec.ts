import { envValidationSchema } from './env.validation';

describe('envValidationSchema WhatsApp public URL rules', () => {
  const baseEnv = {
    DATABASE_URL: 'mysql://user:pass@localhost:3306/db',
    JWT_ACCESS_SECRET: 'access',
    JWT_REFRESH_SECRET: 'refresh',
    QR_SIGNING_SECRET: 'qr',
  };

  it('rejects localhost public URLs for real providers in production', () => {
    const result = envValidationSchema.validate({
      ...baseEnv,
      NODE_ENV: 'production',
      WHATSAPP_PROVIDER: 'WASENDER',
      APP_PUBLIC_BASE_URL: 'http://localhost:3000',
      WASENDER_API_KEY: 'secret',
    });

    expect(result.error).toBeDefined();
  });

  it('allows FAKE provider without public base URL', () => {
    const result = envValidationSchema.validate({
      ...baseEnv,
      WHATSAPP_PROVIDER: 'FAKE',
    });

    expect(result.error).toBeUndefined();
  });
});
