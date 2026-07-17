import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),
  DATABASE_URL: Joi.string().required(),
  JWT_ACCESS_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  QR_SIGNING_SECRET: Joi.string().required(),
  WHATSAPP_PROVIDER: Joi.string()
    .valid('FAKE', 'WASENDER', 'META_CLOUD')
    .default('FAKE'),
  WHATSAPP_SEND_RATE_PER_SECOND: Joi.number().default(3),
  WHATSAPP_SEND_MAX_ATTEMPTS: Joi.number().default(5),
  WHATSAPP_SEND_RETRY_BACKOFF_MS: Joi.number().default(5000),
  WHATSAPP_SEND_FAILED_ALERT_THRESHOLD: Joi.number().default(10),
  WHATSAPP_SEND_FAILED_ALERT_WINDOW_MINUTES: Joi.number().default(15),
  WHATSAPP_HTTP_TIMEOUT_MS: Joi.number().default(15000),
  WHATSAPP_QUEUE_BACKPRESSURE_ENABLED: Joi.boolean().default(true),
  WHATSAPP_QUEUE_MAX_WAITING: Joi.number().default(10000),
  WHATSAPP_QUEUE_RESUME_THRESHOLD: Joi.number().default(5000),
  WHATSAPP_IMPORT_ENQUEUE_BATCH_SIZE: Joi.number().default(500),
  WASENDER_API_URL: Joi.string().default('https://wasenderapi.com/api'),
  WASENDER_API_KEY: Joi.string().optional(),
  WASENDER_WEBHOOK_SECRET: Joi.string().optional(),
  WHATSAPP_REQUEST_PHONE: Joi.string().allow('').optional(),
  WHATSAPP_TICKET_REQUEST_EXPIRES_HOURS: Joi.number().default(24),
  DIGITAL_TICKET_FONT_REGULAR_PATH: Joi.string().default(
    'assets/fonts/Almarai-Regular.ttf',
  ),
  DIGITAL_TICKET_FONT_BOLD_PATH: Joi.string().default(
    'assets/fonts/Almarai-Bold.ttf',
  ),
  APP_PUBLIC_BASE_URL: Joi.string().allow('').optional(),
  ALLOW_LOCAL_PUBLIC_BASE_URL: Joi.boolean().default(false),
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().optional(),
  REDIS_DB: Joi.number().default(0),
  QUEUE_PREFIX: Joi.string().default('event_ops'),
  REGISTRATION_PIPELINE_ENABLED: Joi.boolean().default(true),
  IMPORT_QUEUE_ENABLED: Joi.boolean().default(true),
  SCAN_PROCESSING_ENABLED: Joi.boolean().default(true),
  REDIS_SCAN_INGEST_ENABLED: Joi.boolean().default(true),
  REDIS_SCAN_FLUSH_ENABLED: Joi.boolean().default(true),
  REDIS_SCAN_FLUSH_BATCH_SIZE: Joi.number().default(500),
  STORAGE_CLEANUP_ENABLED: Joi.boolean().default(true),
  STORAGE_CLEANUP_MAX_ATTEMPTS: Joi.number().default(5),
  STORAGE_CLEANUP_RETRY_BACKOFF_MS: Joi.number().default(5000),
  QR_IMAGE_RETENTION_DAYS: Joi.number().default(30),
}).custom((value, helpers) => {
  const provider = value.WHATSAPP_PROVIDER;

  if (provider === 'FAKE') {
    return value;
  }

  const publicBaseUrl = value.APP_PUBLIC_BASE_URL;
  if (!publicBaseUrl) {
    return helpers.error('any.custom', {
      message: 'APP_PUBLIC_BASE_URL is required for real WhatsApp providers',
    });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(publicBaseUrl);
  } catch {
    return helpers.error('any.custom', {
      message: 'APP_PUBLIC_BASE_URL must be an absolute http/https URL',
    });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return helpers.error('any.custom', {
      message: 'APP_PUBLIC_BASE_URL must use http or https',
    });
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  const localAllowed =
    value.NODE_ENV === 'development' && value.ALLOW_LOCAL_PUBLIC_BASE_URL === true;

  if (localHosts.has(hostname) && !localAllowed) {
    return helpers.error('any.custom', {
      message:
        'APP_PUBLIC_BASE_URL cannot be localhost for real WhatsApp providers',
    });
  }

  return value;
});
