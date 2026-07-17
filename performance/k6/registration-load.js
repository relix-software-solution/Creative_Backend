import http from 'k6/http';
import { sleep } from 'k6';
import {
  ACCESS_TOKEN,
  ATTENDEE_TYPE_ID,
  BASE_URL,
  DURATION,
  EVENT_ID,
  VUS,
} from './config.js';
import {
  authHeaders,
  checkJsonOk,
  loginAdmin,
  randomEmail,
  randomPhone,
  requireEnv,
} from './helpers.js';

export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
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
  const phone = randomPhone();
  const response = http.post(
    `${BASE_URL}/registrations`,
    JSON.stringify({
      eventId: EVENT_ID,
      attendeeTypeId: ATTENDEE_TYPE_ID,
      fullName: `Load User ${__VU}-${__ITER}`,
      phone,
      email: randomEmail('registration'),
      companyName: 'Load Test',
      jobTitle: 'Tester',
      externalId: `load-${Date.now()}-${__VU}-${__ITER}`,
    }),
    { headers: authHeaders(data.token) },
  );

  checkJsonOk(response);
  sleep(1);
}
