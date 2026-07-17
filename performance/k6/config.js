export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api/v1';
export const ADMIN_EMAIL = __ENV.ADMIN_EMAIL || 'admin@example.com';
export const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || 'Admin123456';
export const ACCESS_TOKEN = __ENV.ACCESS_TOKEN;
export const DEVICE_API_KEY = __ENV.DEVICE_API_KEY;
export const EVENT_ID = __ENV.EVENT_ID;
export const ATTENDEE_TYPE_ID = __ENV.ATTENDEE_TYPE_ID;
export const DEVICE_ID = __ENV.DEVICE_ID;
export const STAFF_SESSION_ID = __ENV.STAFF_SESSION_ID;
export const CHECKPOINT_ID = __ENV.CHECKPOINT_ID;
export const QR_TOKEN = __ENV.QR_TOKEN;

export const VUS = Number(__ENV.VUS || 20);
export const DURATION = __ENV.DURATION || '1m';
export const BATCH_SIZE = Number(__ENV.BATCH_SIZE || 10);
export const NO_SLEEP = String(__ENV.NO_SLEEP || 'false').toLowerCase() === 'true';
