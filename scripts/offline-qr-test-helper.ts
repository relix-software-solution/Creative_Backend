import { generateKeyPairSync, sign } from 'crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const now = new Date();
const validUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);
const payload = {
  v: 1,
  type: 'OFFLINE_REGISTRATION',
  eventId: process.env.EVENT_ID ?? 'evt_test',
  issuerDeviceId: process.env.DEVICE_ID ?? 'device_test',
  issuerKeyVersion: Number(process.env.KEY_VERSION ?? '1'),
  offlineRegistrationOperationId:
    process.env.OFFLINE_REGISTRATION_OPERATION_ID ?? 'OFFREG-device-0001',
  offlineRegistrationId:
    process.env.OFFLINE_REGISTRATION_ID ?? 'OFFREGLOCAL-device-0001',
  offlineQrToken: process.env.OFFLINE_QR_TOKEN ?? 'evt_offline_test_token',
  attendeeTypeId: process.env.ATTENDEE_TYPE_ID ?? 'attendee_type_test',
  displayName: process.env.DISPLAY_NAME ?? 'Offline Test Visitor',
  issuedAt: now.toISOString(),
  validUntil: validUntil.toISOString(),
} as const;
const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
  'base64url',
);
const signature = sign(null, Buffer.from(encodedPayload), privateKey).toString(
  'base64url',
);

console.log(
  'LOCAL TEST ONLY: do not store this private key in the backend or Postman.',
);
console.log('');
console.log('publicKey:');
console.log(
  publicKey.export({ type: 'spki', format: 'pem' }).toString().trim(),
);
console.log('');
console.log('privateKey:');
console.log(
  privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim(),
);
console.log('');
console.log('payload:');
console.log(JSON.stringify(payload, null, 2));
console.log('');
console.log('signedOfflineQr:');
console.log(`${encodedPayload}.${signature}`);
