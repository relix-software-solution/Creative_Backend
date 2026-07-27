import { createHmac, timingSafeEqual } from 'crypto';

export type QrPayload = {
  tokenId: string;
  eventId: string;
  registrationId: string;
  registrationPublicId: string;
  attendeeTypeId: string;
  attendeeTypeCode: string;
  issuedAt: string;
  validFrom: string;
  validUntil: string;
  nonce: string;
};

export type CompactQrPayload = {
  tokenId: string;
};

export function createSignedQrToken(
  payload: QrPayload,
  secret: string,
): string {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signEncodedPayload(encodedPayload, secret);

  return `${encodedPayload}.${signature}`;
}

export function createCompactQrToken(tokenId: string, secret: string): string {
  const encodedPayload = encodeBase64Url(JSON.stringify({ tokenId }));
  const signature = signEncodedPayload(encodedPayload, secret);

  return `${encodedPayload}.${signature}`;
}

export function verifySignedQrToken(
  qrToken: string,
  secret: string,
): QrPayload {
  const parts = qrToken.split('.');
  const [encodedPayload, signature, extra] = parts;

  const expectedSignature = signEncodedPayload(encodedPayload, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);
  const signaturesEqual =
    signatureBuffer.length === expectedSignatureBuffer.length &&
    timingSafeEqual(signatureBuffer, expectedSignatureBuffer);

  if (!signaturesEqual) {
    throw new Error('Invalid QR token signature');
  }

  const parsed = JSON.parse(decodeBase64Url(encodedPayload)) as unknown;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid signed QR token payload');
  }

  const payload = parsed as Record<string, unknown>;

  const requiredFields: Array<keyof QrPayload> = [
    'tokenId',
    'eventId',
    'registrationId',
    'registrationPublicId',
    'attendeeTypeId',
    'attendeeTypeCode',
    'issuedAt',
    'validFrom',
    'validUntil',
    'nonce',
  ];

  const invalidPayload = requiredFields.some((key) => {
    const value = payload[key];

    return typeof value !== 'string' || value.trim().length === 0;
  });

  if (invalidPayload) {
    throw new Error('Invalid signed QR token payload');
  }

  return payload as QrPayload;
}

export function verifyCompactQrToken(
  qrToken: string,
  secret: string,
): CompactQrPayload {
  const parts = qrToken.split('.');
  const [encodedPayload, signature, extra] = parts;

  if (!encodedPayload || !signature || extra !== undefined) {
    throw new Error('Invalid compact QR token format');
  }

  const expectedSignature = signEncodedPayload(encodedPayload, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);
  const signaturesEqual =
    signatureBuffer.length === expectedSignatureBuffer.length &&
    timingSafeEqual(signatureBuffer, expectedSignatureBuffer);

  if (!signaturesEqual) {
    throw new Error('Invalid compact QR token signature');
  }

  const payload = JSON.parse(
    decodeBase64Url(encodedPayload),
  ) as CompactQrPayload;

  if (!payload.tokenId || typeof payload.tokenId !== 'string') {
    throw new Error('Invalid compact QR token payload');
  }

  return payload;
}

export function reconstructSignedQrToken(
  payload: QrPayload,
  signature: string,
): string {
  return `${encodeBase64Url(JSON.stringify(payload))}.${signature}`;
}

function signEncodedPayload(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}
