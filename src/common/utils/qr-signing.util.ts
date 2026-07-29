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

/*
 * الصيغة المختصرة الجديدة:
 *
 * Q2.<tokenId>.<signature>
 *
 * مثال تقريبي:
 * Q2.QRT_0123456789ABCDEF.xxxxxxxxxxxxxxxxxxxxxx
 *
 * هذه الصيغة أقصر بكثير من:
 * base64url({"tokenId":"..."}).fullHmacSignature
 */
const COMPACT_QR_PREFIX = 'Q2';

/*
 * 16 bytes = 128-bit MAC.
 *
 * طول جيد جدًا من ناحية الأمان،
 * وفي نفس الوقت يقلل كثافة QR بشكل واضح.
 */
const COMPACT_QR_SIGNATURE_BYTES = 16;

export function createSignedQrToken(
  payload: QrPayload,
  secret: string,
): string {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signEncodedPayload(encodedPayload, secret);

  return `${encodedPayload}.${signature}`;
}

export function createCompactQrToken(tokenId: string, secret: string): string {
  const normalizedTokenId = tokenId.trim();

  if (!normalizedTokenId) {
    throw new Error('QR token ID is required');
  }

  const signature = signCompactTokenId(normalizedTokenId, secret);

  return `${COMPACT_QR_PREFIX}.${normalizedTokenId}.${signature}`;
}

export function verifySignedQrToken(
  qrToken: string,
  secret: string,
): QrPayload {
  const parts = qrToken.trim().split('.');
  const [encodedPayload, signature, extra] = parts;

  if (!encodedPayload || !signature || extra !== undefined) {
    throw new Error('Invalid signed QR token format');
  }

  const expectedSignature = signEncodedPayload(encodedPayload, secret);

  if (!signaturesEqual(signature, expectedSignature)) {
    throw new Error('Invalid QR token signature');
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(decodeBase64Url(encodedPayload)) as unknown;
  } catch {
    throw new Error('Invalid signed QR token payload');
  }

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
  const normalizedToken = qrToken.trim();

  /*
   * الصيغة الجديدة الخفيفة Q2.
   */
  if (normalizedToken.startsWith(`${COMPACT_QR_PREFIX}.`)) {
    return verifyCompactQrTokenV2(normalizedToken, secret);
  }

  /*
   * دعم الصيغة القديمة.
   *
   * بذلك جميع البادجات المطبوعة سابقًا
   * تبقى قابلة للقراءة.
   */
  return verifyLegacyCompactQrToken(normalizedToken, secret);
}

function verifyCompactQrTokenV2(
  qrToken: string,
  secret: string,
): CompactQrPayload {
  const [prefix, tokenId, signature, extra] = qrToken.split('.');

  if (
    prefix !== COMPACT_QR_PREFIX ||
    !tokenId ||
    !signature ||
    extra !== undefined
  ) {
    throw new Error('Invalid compact QR token format');
  }

  if (tokenId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(tokenId)) {
    throw new Error('Invalid compact QR token ID');
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(signature)) {
    throw new Error('Invalid compact QR token signature');
  }

  const expectedSignature = signCompactTokenId(tokenId, secret);

  if (!signaturesEqual(signature, expectedSignature)) {
    throw new Error('Invalid compact QR token signature');
  }

  return {
    tokenId,
  };
}

function verifyLegacyCompactQrToken(
  qrToken: string,
  secret: string,
): CompactQrPayload {
  const [encodedPayload, signature, extra] = qrToken.split('.');

  if (!encodedPayload || !signature || extra !== undefined) {
    throw new Error('Invalid compact QR token format');
  }

  const expectedSignature = signEncodedPayload(encodedPayload, secret);

  if (!signaturesEqual(signature, expectedSignature)) {
    throw new Error('Invalid compact QR token signature');
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(decodeBase64Url(encodedPayload)) as unknown;
  } catch {
    throw new Error('Invalid compact QR token payload');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid compact QR token payload');
  }

  const payload = parsed as Record<string, unknown>;

  if (
    typeof payload.tokenId !== 'string' ||
    payload.tokenId.trim().length === 0
  ) {
    throw new Error('Invalid compact QR token payload');
  }

  return {
    tokenId: payload.tokenId.trim(),
  };
}

export function reconstructSignedQrToken(
  payload: QrPayload,
  signature: string,
): string {
  return `${encodeBase64Url(JSON.stringify(payload))}.${signature}`;
}

function signCompactTokenId(tokenId: string, secret: string): string {
  /*
   * نوقّع الـprefix مع tokenId حتى تكون
   * صيغة Q2 جزءًا من البيانات الموقعة.
   */
  return createHmac('sha256', secret)
    .update(`${COMPACT_QR_PREFIX}.${tokenId}`, 'utf8')
    .digest()
    .subarray(0, COMPACT_QR_SIGNATURE_BYTES)
    .toString('base64url');
}

function signEncodedPayload(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
}

function signaturesEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}
