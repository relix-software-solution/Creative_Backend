import QRCode from 'qrcode';
import {
  createCompactQrToken,
  createSignedQrToken,
  verifyCompactQrToken,
} from './qr-signing.util';

describe('QR signing utilities', () => {
  const secret = 'test-secret';
  const payload = {
    tokenId: 'QRT_0011223344556677',
    eventId: 'event-1',
    registrationId: 'registration-secret',
    registrationPublicId: 'REG_001',
    attendeeTypeId: 'attendee-1',
    attendeeTypeCode: 'VIP',
    issuedAt: '2026-08-02T09:00:00.000Z',
    validFrom: '2026-08-02T08:00:00.000Z',
    validUntil: '2026-08-02T20:00:00.000Z',
    nonce: 'nonce-value',
  };

  it('creates a compact signed token that contains only the canonical token id', () => {
    const full = createSignedQrToken(payload, secret);
    const compact = createCompactQrToken(payload.tokenId, secret);

    expect(verifyCompactQrToken(compact, secret)).toEqual({
      tokenId: payload.tokenId,
    });
    expect(compact.length).toBeLessThan(full.length);
    expect(compact).not.toContain('registration-secret');
    expect(compact).not.toContain('REG_001');
    expect(compact).not.toContain('whatsapp');
  });

  it('uses fewer QR modules than the full signed JSON token', () => {
    const full = createSignedQrToken(payload, secret);
    const compact = createCompactQrToken(payload.tokenId, secret);
    const fullQr = QRCode.create(full, { errorCorrectionLevel: 'H' });
    const compactQr = QRCode.create(compact, { errorCorrectionLevel: 'H' });

    expect(compactQr.modules.size).toBeLessThan(fullQr.modules.size);
  });
});
