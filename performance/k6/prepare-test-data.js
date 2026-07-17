const BASE_URL = process.env.BASE_URL || 'http://localhost:3000/api/v1';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin123456';

const CLIENT_NAME = 'K6 Test Client';
const EVENT_TITLE = 'K6 Load Test Event';
const STAFF_EMAIL = 'staff-k6@example.com';
const STAFF_PASSWORD = 'Staff123456';

async function main() {
  const token = await loginAdmin();
  const client = await findOrCreateClient(token);
  const event = await findOrCreateEvent(token, client.id);
  const attendeeType = await findOrCreateAttendeeType(token, event.id);
  const venue = await findOrCreateVenue(token, event.id);
  const zone = await findOrCreateZone(token, event.id, venue.id);
  const checkpoint = await findOrCreateCheckpoint(token, event.id, venue.id, zone.id);
  const { device, rawApiKey } = await findOrCreateDevice(token, event.id);
  const staff = await findOrCreateStaffUser(token);

  await findOrCreateStaffAssignment(token, event.id, staff.id);
  const staffSession = await startStaffSession(
    token,
    event.id,
    staff.id,
    device.id,
    checkpoint.id,
  );
  const registration = await createRegistration(token, event.id, attendeeType.id);
  const qr = await api(
    'POST',
    `/qr/registrations/${registration.id}/generate`,
    undefined,
    token,
  );

  const envArgs = [
    `-e EVENT_ID=${event.id}`,
    `-e ATTENDEE_TYPE_ID=${attendeeType.id}`,
    `-e DEVICE_ID=${device.id}`,
    `-e DEVICE_API_KEY=${rawApiKey}`,
    `-e STAFF_SESSION_ID=${staffSession.id}`,
    `-e CHECKPOINT_ID=${checkpoint.id}`,
    `-e QR_TOKEN='${qr.qrToken}'`,
  ].join(' ');

  console.log('\nReady-to-copy device scan command:\n');
  console.log(`k6 run ${envArgs} performance/k6/device-scan-load.js`);
  console.log('\nReady-to-copy mixed smoke command:\n');
  console.log(`k6 run ${envArgs} performance/k6/mixed-smoke.js`);
}

async function loginAdmin() {
  const response = await rawApi('POST', '/auth/login', {
    identifier: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });

  return unwrap(response).accessToken;
}

async function findOrCreateClient(token) {
  const existing = await findItem(token, '/clients?search=K6%20Test%20Client', (client) => client.name === CLIENT_NAME);

  if (existing) {
    return existing;
  }

  return api('POST', '/clients', { name: CLIENT_NAME }, token);
}

async function findOrCreateEvent(token, clientId) {
  const existing = await findItem(token, `/events?clientId=${clientId}&search=K6%20Load%20Test%20Event`, (event) => event.titleAr === EVENT_TITLE);

  if (existing) {
    return existing;
  }

  const startsAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  return api(
    'POST',
    '/events',
    {
      clientId,
      type: 'EXHIBITION',
      titleAr: EVENT_TITLE,
      titleEn: EVENT_TITLE,
      startsAt,
      endsAt,
      qrValidFrom: startsAt,
      qrValidUntil: endsAt,
      allowReEntry: true,
      duplicateStrategy: 'PHONE_OR_EMAIL',
    },
    token,
  );
}

async function findOrCreateAttendeeType(token, eventId) {
  const existing = await findItem(token, `/attendee-types?eventId=${eventId}&search=VISITOR`, (type) => type.code === 'VISITOR');

  if (existing) {
    return existing;
  }

  return api(
    'POST',
    '/attendee-types',
    {
      eventId,
      code: 'VISITOR',
      nameAr: 'Visitor',
      nameEn: 'Visitor',
      isDefault: true,
      isActive: true,
      sortOrder: 0,
    },
    token,
  );
}

async function findOrCreateVenue(token, eventId) {
  const existing = await findItem(token, `/venues?eventId=${eventId}&search=K6`, (venue) => venue.nameAr === 'K6 Venue');

  if (existing) {
    return existing;
  }

  return api(
    'POST',
    '/venues',
    {
      eventId,
      nameAr: 'K6 Venue',
      nameEn: 'K6 Venue',
      city: 'Damascus',
      country: 'Syria',
    },
    token,
  );
}

async function findOrCreateZone(token, eventId, venueId) {
  const existing = await findItem(token, `/zones?eventId=${eventId}&search=K6_MAIN`, (zone) => zone.code === 'K6_MAIN');

  if (existing) {
    return existing;
  }

  return api(
    'POST',
    '/zones',
    {
      eventId,
      venueId,
      nameAr: 'K6 Main Zone',
      nameEn: 'K6 Main Zone',
      code: 'K6_MAIN',
      sortOrder: 0,
    },
    token,
  );
}

async function findOrCreateCheckpoint(token, eventId, venueId, zoneId) {
  const existing = await findItem(token, `/checkpoints?eventId=${eventId}&search=MAIN_GATE`, (checkpoint) => checkpoint.code === 'MAIN_GATE');

  if (existing) {
    return existing;
  }

  return api(
    'POST',
    '/checkpoints',
    {
      eventId,
      venueId,
      zoneId,
      type: 'ENTRY',
      nameAr: 'Main Gate',
      nameEn: 'Main Gate',
      code: 'MAIN_GATE',
      allowedAttendeeTypes: ['VISITOR'],
      isActive: true,
      sortOrder: 0,
    },
    token,
  );
}

async function findOrCreateDevice(token, eventId) {
  const existing = await findItem(token, `/devices?eventId=${eventId}&search=K6_DEVICE_01`, (device) => device.code === 'K6_DEVICE_01');

  if (existing) {
    const rotated = await api(
      'POST',
      `/devices/${existing.id}/rotate-api-key`,
      undefined,
      token,
    );

    return {
      device: rotated.device,
      rawApiKey: rotated.rawApiKey,
    };
  }

  const created = await api(
    'POST',
    '/devices',
    {
      eventId,
      name: 'K6 Scanner Device',
      code: 'K6_DEVICE_01',
      metadata: { purpose: 'k6' },
    },
    token,
  );

  return {
    device: created.device,
    rawApiKey: created.rawApiKey,
  };
}

async function findOrCreateStaffUser(token) {
  const existing = await findItem(token, `/users?role=STAFF&search=${encodeURIComponent(STAFF_EMAIL)}`, (user) => user.email === STAFF_EMAIL);

  if (existing) {
    return existing;
  }

  return api(
    'POST',
    '/users',
    {
      fullName: 'K6 Staff User',
      email: STAFF_EMAIL,
      phone: '+963000009999',
      password: STAFF_PASSWORD,
      role: 'STAFF',
    },
    token,
  );
}

async function findOrCreateStaffAssignment(token, eventId, userId) {
  const existing = await findItem(token, `/staff-assignments?eventId=${eventId}&userId=${userId}`, (assignment) => assignment.eventId === eventId && assignment.userId === userId);

  if (existing) {
    if (!existing.isActive) {
      return api('POST', `/staff-assignments/${existing.id}/activate`, undefined, token);
    }

    return existing;
  }

  return api('POST', '/staff-assignments', { eventId, userId }, token);
}

async function startStaffSession(token, eventId, staffUserId, deviceId, checkpointId) {
  return api(
    'POST',
    '/staff-sessions/start',
    {
      eventId,
      staffUserId,
      deviceId,
      checkpointId,
      mode: 'ENTRY',
      metadata: { purpose: 'k6' },
    },
    token,
  );
}

async function createRegistration(token, eventId, attendeeTypeId) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 100000)}`;

  return api(
    'POST',
    '/registrations',
    {
      eventId,
      attendeeTypeId,
      fullName: 'K6 QR Seed User',
      phone: `+9638${suffix.slice(-8)}`,
      email: `k6.seed.${suffix}@example.com`,
      companyName: 'K6',
      jobTitle: 'Seed',
      externalId: `k6-seed-${suffix}`,
    },
    token,
  );
}

async function findItem(token, path, predicate) {
  const response = await api('GET', path, undefined, token);
  const items = response.items || response.data?.items || [];

  return items.find(predicate);
}

async function api(method, path, body, token) {
  const response = await rawApi(method, path, body, token);
  return unwrap(response);
}

async function rawApi(method, path, body, token) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
  }

  return parsed;
}

function unwrap(response) {
  return response?.data ?? response;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
