import { createHash, randomBytes } from 'crypto';

export function generateApiKey(prefix?: string): string {
  const apiKey = randomBytes(32).toString('hex');

  return prefix ? `${prefix}${apiKey}` : apiKey;
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}
