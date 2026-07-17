import { check, fail } from 'k6';
import http from 'k6/http';
import { ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL } from './config.js';

export function loginAdmin() {
  const response = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({
      identifier: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    }),
    { headers: jsonHeaders() },
  );

  check(response, {
    'admin login succeeded': (res) => res.status >= 200 && res.status < 300,
  });

  if (response.status < 200 || response.status >= 300) {
    fail(`Admin login failed: ${response.status} ${response.body}`);
  }

  const body = response.json();
  return body.data?.accessToken || body.accessToken;
}

export function authHeaders(token) {
  return {
    ...jsonHeaders(),
    Authorization: `Bearer ${token}`,
  };
}

export function jsonHeaders() {
  return {
    'Content-Type': 'application/json',
  };
}

export function deviceHeaders(apiKey) {
  return {
    ...jsonHeaders(),
    'X-Device-Api-Key': apiKey,
  };
}

export function randomPhone() {
  return `+9639${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`;
}

export function randomEmail(prefix = 'load') {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1000000)}@example.com`;
}

export function checkJsonOk(response) {
  return check(response, {
    'status is 2xx': (res) => res.status >= 200 && res.status < 300,
    'response is json': (res) =>
      String(res.headers['Content-Type'] || '').includes('application/json'),
  });
}

export function makeOperationId(prefix) {
  return `${prefix}_${Date.now()}_${__VU}_${__ITER}_${Math.floor(Math.random() * 1000000)}`;
}

export function requireEnv(name, value) {
  if (!value) {
    fail(`${name} env var is required`);
  }
}
