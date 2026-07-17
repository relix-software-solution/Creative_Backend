import http from 'k6/http';
import { sleep } from 'k6';
import {
  ACCESS_TOKEN,
  BASE_URL,
  CHECKPOINT_ID,
  DEVICE_ID,
  DURATION,
  EVENT_ID,
  QR_TOKEN,
  STAFF_SESSION_ID,
  VUS,
} from './config.js';
import { authHeaders, checkJsonOk, loginAdmin, makeOperationId, requireEnv } from './helpers.js';

export const options = {
  vus: VUS || 50,
  duration: DURATION,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
  },
};

export function setup() {
  requireEnv('EVENT_ID', EVENT_ID);
  requireEnv('DEVICE_ID', DEVICE_ID);
  requireEnv('STAFF_SESSION_ID', STAFF_SESSION_ID);
  requireEnv('CHECKPOINT_ID', CHECKPOINT_ID);
  requireEnv('QR_TOKEN', QR_TOKEN);

  return {
    token: ACCESS_TOKEN || loginAdmin(),
  };
}

export default function (data) {
  const response = http.post(
    `${BASE_URL}/scans`,
    JSON.stringify({
      operationId: makeOperationId('scan'),
      eventId: EVENT_ID,
      deviceId: DEVICE_ID,
      staffSessionId: STAFF_SESSION_ID,
      checkpointId: CHECKPOINT_ID,
      qrToken: QR_TOKEN,
      type: 'ENTRY',
      scannedAtDevice: new Date().toISOString(),
      payload: { source: 'k6' },
    }),
    { headers: authHeaders(data.token) },
  );

  checkJsonOk(response);
  sleep(1);
}
