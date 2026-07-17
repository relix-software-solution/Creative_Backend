import http from 'k6/http';
import { sleep } from 'k6';
import {
  ACCESS_TOKEN,
  ATTENDEE_TYPE_ID,
  BASE_URL,
  CHECKPOINT_ID,
  DEVICE_ID,
  EVENT_ID,
  QR_TOKEN,
  STAFF_SESSION_ID,
} from './config.js';
import {
  authHeaders,
  checkJsonOk,
  loginAdmin,
  makeOperationId,
  randomEmail,
  randomPhone,
  requireEnv,
} from './helpers.js';

export const options = {
  vus: 5,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
  },
};

export function setup() {
  requireEnv('EVENT_ID', EVENT_ID);
  requireEnv('ATTENDEE_TYPE_ID', ATTENDEE_TYPE_ID);

  return {
    token: ACCESS_TOKEN || loginAdmin(),
  };
}

export default function (data) {
  const headers = authHeaders(data.token);

  checkJsonOk(
    http.post(
      `${BASE_URL}/registrations`,
      JSON.stringify({
        eventId: EVENT_ID,
        attendeeTypeId: ATTENDEE_TYPE_ID,
        fullName: `Smoke User ${__VU}-${__ITER}`,
        phone: randomPhone(),
        email: randomEmail('smoke'),
      }),
      { headers },
    ),
  );

  checkJsonOk(
    http.get(`${BASE_URL}/reports/events/${EVENT_ID}/overview`, { headers }),
  );

  if (QR_TOKEN && DEVICE_ID && STAFF_SESSION_ID && CHECKPOINT_ID) {
    checkJsonOk(
      http.post(
        `${BASE_URL}/scans`,
        JSON.stringify({
          operationId: makeOperationId('smoke_scan'),
          eventId: EVENT_ID,
          deviceId: DEVICE_ID,
          staffSessionId: STAFF_SESSION_ID,
          checkpointId: CHECKPOINT_ID,
          qrToken: QR_TOKEN,
          type: 'ENTRY',
          scannedAtDevice: new Date().toISOString(),
        }),
        { headers },
      ),
    );
  }

  sleep(1);
}
