import http from 'k6/http';
import { sleep } from 'k6';
import { ACCESS_TOKEN, BASE_URL, DURATION, EVENT_ID, VUS } from './config.js';
import { authHeaders, checkJsonOk, loginAdmin, requireEnv } from './helpers.js';

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

  return {
    token: ACCESS_TOKEN || loginAdmin(),
  };
}

export default function (data) {
  const response = http.get(`${BASE_URL}/reports/events/${EVENT_ID}/overview`, {
    headers: authHeaders(data.token),
  });

  checkJsonOk(response);
  sleep(1);
}
