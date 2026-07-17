import http from 'k6/http';
import { sleep } from 'k6';
import {
  BASE_URL,
  BATCH_SIZE,
  CHECKPOINT_ID,
  DEVICE_API_KEY,
  DURATION,
  EVENT_ID,
  QR_TOKEN,
  STAFF_SESSION_ID,
  VUS,
} from './config.js';
import { checkJsonOk, deviceHeaders, makeOperationId, requireEnv } from './helpers.js';

export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
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
  const operations = [];

  for (let index = 0; index < BATCH_SIZE; index += 1) {
    operations.push({
      operationId: makeOperationId(`sync_scan_${index}`),
      type: 'SCAN_EVENT',
      payload: {
        qrToken: QR_TOKEN,
        type: 'ENTRY',
        checkpointId: CHECKPOINT_ID,
        scannedAtDevice: new Date().toISOString(),
        payload: { source: 'k6-sync', index },
      },
    });
  }

  const response = http.post(
    `${BASE_URL}/device/sync/batches`,
    JSON.stringify({
      batchId: makeOperationId('batch'),
      eventId: EVENT_ID,
      staffSessionId: STAFF_SESSION_ID,
      operations,
    }),
    { headers: deviceHeaders(DEVICE_API_KEY) },
  );

  checkJsonOk(response);
  sleep(1);
}
