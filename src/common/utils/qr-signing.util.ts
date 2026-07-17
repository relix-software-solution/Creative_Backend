import { createHmac, timingSafeEqual } from 'crypto';
import { Logger } from '@nestjs/common';

const logger = new Logger('QrSigningUtil');

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

export function createSignedQrToken(payload: QrPayload, secret: string): string {
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

  if (!encodedPayload || !signature || extra !== undefined) {
    logger.debug(
      `QR signature debug: parts=${parts.length} payloadLength=${encodedPayload?.length ?? 0} signatureLength=${signature?.length ?? 0} expectedSignatureLength=0 signaturesEqual=false`,
    );
    throw new Error('Invalid QR token format');
  }

  const expectedSignature = signEncodedPayload(encodedPayload, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);
  const signaturesEqual =
    signatureBuffer.length === expectedSignatureBuffer.length &&
    timingSafeEqual(signatureBuffer, expectedSignatureBuffer);

  logger.debug(
    `QR signature debug: parts=${parts.length} payloadLength=${encodedPayload.length} signatureLength=${signature.length} expectedSignatureLength=${expectedSignature.length} signaturesEqual=${signaturesEqual}`,
  );

  if (!signaturesEqual) {
    throw new Error('Invalid QR token signature');
  }

  return JSON.parse(decodeBase64Url(encodedPayload)) as QrPayload;
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

  const payload = JSON.parse(decodeBase64Url(encodedPayload)) as CompactQrPayload;

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
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}
