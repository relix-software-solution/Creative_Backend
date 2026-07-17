import http from 'k6/http';
import {
  BASE_URL,
  CHECKPOINT_ID,
  DEVICE_API_KEY,
  EVENT_ID,
  QR_TOKEN,
  STAFF_SESSION_ID,
} from './config.js';
import { checkJsonOk, deviceHeaders, makeOperationId, requireEnv } from './helpers.js';

export const options = {
  vus: Number(__ENV.VUS || 100),
  duration: __ENV.DURATION || '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<300'],
  },
};

export function setup() {
  requireEnv('DEVICE_API_KEY', DEVICE_API_KEY);
  requireEnv('EVENT_ID', EVENT_ID);
  requireEnv('STAFF_SESSION_ID', STAFF_SESSION_ID);
  requireEnv('CHECKPOINT_ID', CHECKPOINT_ID);
  requireEnv('QR_TOKEN', QR_TOKEN);
}

export default function () {
  const response = http.post(
    `${BASE_URL}/device/scans/redis-fast`,
    JSON.stringify({
      operationId: makeOperationId('device_redis_fast_scan'),
      eventId: EVENT_ID,
      staffSessionId: STAFF_SESSION_ID,
      checkpointId: CHECKPOINT_ID,
      qrToken: QR_TOKEN,
      type: 'ENTRY',
      scannedAtDevice: new Date().toISOString(),
      payload: { source: 'k6-device-redis-fast' },
    }),
    { headers: deviceHeaders(DEVICE_API_KEY) },
  );

  checkJsonOk(response);
}
