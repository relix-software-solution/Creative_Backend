# Frontend Handoff

This document summarizes the backend contracts needed by web, admin, visitor, and scanner frontends.

## Base URL And Auth

Use the Postman environment variable `baseUrl`, normally:

```text
http://localhost:3000/api/v1
```

Auth modes:

| Surface | Auth |
| --- | --- |
| Admin dashboard | `Authorization: Bearer {{accessToken}}` from `POST /auth/login` |
| Staff dashboard/scanner setup | STAFF JWT from `POST /auth/login` |
| Device scanner submit/sync | `X-Device-Api-Key: {{deviceApiKey}}` |
| Public registration | No JWT |

Roles:

- `SUPER_ADMIN`: admin CRUD, imports, notifications, cleanup, reports, templates.
- `STAFF`: staff assignment/session, staff visitors, scans/sync where allowed.
- `CLIENT_VIEWER`: schema role; current frontend surface should not assume broad controller access.

## Common Response And Error Patterns

Common errors:

| Status | Meaning |
| --- | --- |
| `400` | Validation error, malformed JSON, unsupported multipart field, invalid query/body. |
| `401` | Missing/invalid JWT or device API key. |
| `403` | Role or event/device boundary violation. |
| `404` | Requested resource not found or intentionally hidden across boundaries. |
| `409` | Duplicate, conflict, or protected delete. |
| `500` | Unhandled server/provider/queue failure. |

List endpoints generally support `page` and `limit` and return `items`, `total`, `page`, `limit`, and `pages` or a module-specific wrapper containing those values.

## Authentication APIs

| Method | Route | Body | Notes |
| --- | --- | --- | --- |
| `POST` | `/auth/login` | `{ "identifier": "admin@example.com", "password": "..." }` | Returns access/refresh tokens and user. |
| `POST` | `/auth/refresh` | `{ "refreshToken": "..." }` | Returns fresh tokens. |
| `POST` | `/auth/logout` | `{ "refreshToken": "..." }` | Revokes refresh token. |
| `GET` | `/auth/me` | None | Requires JWT. |

## Public Registration Flow

1. Load public event:

```http
GET /public/events/:id
```

Response includes:

- `event`
- `branding`
- `badgeTemplate`
- `digitalTicketTemplates`
- `attendeeTypes`
- `registrationFields`

2. Render fixed fields:

- `fullName` required
- `phone` required
- `email` optional

3. Render dynamic fields from `registrationFields`.

4. Submit registration:

```http
POST /public/events/:id/register
Content-Type: application/json
```

```json
{
  "attendeeTypeId": "{{attendeeTypeId}}",
  "fullName": "Visitor Name",
  "phone": "+963900000000",
  "email": "visitor@example.com",
  "customFields": {
    "company": "Example Co"
  }
}
```

The response returns registration data, Digital Ticket status, and a user-initiated WhatsApp request object. QR generation remains internal/scanner-facing; frontend must not generate QR itself and must not wait synchronously for ticket PNG rendering.

```json
{
  "registration": {
    "publicId": "...",
    "eventId": "...",
    "fullName": "Visitor Name",
    "phone": "+963900000000",
    "email": "visitor@example.com",
    "status": "ACTIVE"
  },
  "digitalTicket": {
    "status": "PENDING",
    "imageUrl": null,
    "relativePath": null,
    "generatedAt": null,
    "templateVersion": null,
    "pollUrl": "/api/v1/public/registrations/REG_.../digital-ticket?token=..."
  },
  "whatsappRequest": {
    "enabled": true,
    "url": "https://wa.me/...",
    "expiresAt": "..."
  }
}
```

Frontend behavior:

1. Submit registration.
2. Read `digitalTicket.status`.
3. If `READY`, display or download `digitalTicket.imageUrl`.
4. If `PENDING`, poll `digitalTicket.pollUrl` every 1.5-3 seconds and stop after 30-60 seconds.
5. If `NOT_CONFIGURED`, show registration success without a ticket image.
6. If `FAILED`, show retry/contact guidance.
7. Show "Request ticket via WhatsApp" whenever `whatsappRequest.enabled=true` and open `whatsappRequest.url` directly.
8. Do not build the WhatsApp message manually when `whatsappRequest.url` is available. Never place an internal registration ID or QR token in the message.

The prepared WhatsApp message contains `registration.publicId`, for example:

```text
طلب بطاقة الدخول
REG_CC49508E58A7E4CA
```

The visitor sends the prepared message. The backend accepts only incoming one-to-one messages whose sender phone matches the phone used during registration, then sends the existing Digital Ticket image back to that same WhatsApp sender. A different phone cannot request the visitor's ticket.

Polling endpoint:

```http
GET /public/registrations/:publicId/digital-ticket?token=...
```

The polling response contains only Digital Ticket status metadata. It does not expose phone, email, QR token, or private registration fields.

## Visitor Management

Admin visitor list:

```http
GET /admin/visitors?page=1&limit=20&eventId={{eventId}}&search=REG
```

Staff visitor list:

```http
GET /staff/visitors?page=1&limit=20&search=Visitor
```

Staff visitor updates:

```http
PATCH /staff/visitors/:registrationId
```

Allowed staff update fields:

- `fullName`
- `phone`
- `email`
- `companyName`
- `jobTitle`
- `customFields`
- `notes`

Staff cannot submit `eventId`, `attendeeTypeId`, status fields, QR internals, source, public ID, external ID, or timestamps.

## Scanner Flow

Admin setup:

1. Create STAFF user.
2. Create event device.
3. Create checkpoint.
4. Create staff assignment with `eventId`, `userId`, `checkpointId`, and `deviceId`.

Staff startup:

```http
POST /auth/login
GET /staff-assignments/me
POST /staff-sessions/start-my-session
```

Device scanner submit:

```http
POST /device/scans
X-Device-Api-Key: {{deviceApiKey}}
```

```json
{
  "eventId": "{{eventId}}",
  "checkpointId": "{{checkpointId}}",
  "staffSessionId": "{{staffSessionId}}",
  "qrToken": "{{qrToken}}",
  "type": "ENTRY",
  "scannedAtDevice": "2026-07-15T10:00:00.000Z",
  "operationId": "device-op-001"
}
```

Scan modes:

| Endpoint | Behavior |
| --- | --- |
| `POST /device/scans` | Inline processing and enriched result. |
| `POST /device/scans/fast` | Persists raw scan and returns `202 Accepted`. |
| `POST /device/scans/redis-fast` | Pushes raw scan to Redis and returns `202 Accepted`. |
| `POST /scans` | JWT scan submit for STAFF or SUPER_ADMIN. |

Important: `ACCEPTED` means accepted for processing, not entry allowed. Use movement `result` and `allowed` fields for the gate decision.

## Offline Scanner Contract

Provision public offline key:

```http
POST /devices/:id/offline-key
```

```json
{
  "publicKey": "base64url-ed25519-public-key",
  "validUntil": "2026-12-31T23:59:59.000Z"
}
```

Fetch trust bundle:

```http
GET /device/offline-trust-bundle
X-Device-Api-Key: {{deviceApiKey}}
```

Signed offline QR format:

```text
base64url(payloadJson).base64url(ed25519Signature)
```

Payload keys used by the backend:

- `v`
- `type: OFFLINE_REGISTRATION`
- `eventId`
- `issuerDeviceId`
- `issuerKeyVersion`
- `offlineRegistrationOperationId`
- `offlineRegistrationId`
- `offlineQrToken`
- `attendeeTypeId`
- `displayName`
- `issuedAt`
- `validUntil`

Submit offline batches:

```http
POST /device/sync/batches
X-Device-Api-Key: {{deviceApiKey}}
```

The backend accepts offline scan before registration sync and stores it as `PENDING_LINK`. Reconciliation runs after the offline registration mapping links to a canonical registration.

## Digital Ticket Editor Contract

Template endpoints require SUPER_ADMIN JWT.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/digital-ticket-templates` | Create template with multipart form-data. |
| `GET` | `/digital-ticket-templates?eventId={{eventId}}` | List templates. |
| `GET` | `/digital-ticket-templates/events/:eventId` | Get event-wide template. |
| `GET` | `/digital-ticket-templates/events/:eventId/:attendeeTypeId` | Get attendee-specific template. |
| `PATCH` | `/digital-ticket-templates/events/:eventId` | Update event-wide template. |
| `PATCH` | `/digital-ticket-templates/events/:eventId/:attendeeTypeId` | Update attendee-specific template. |
| `DELETE` | `/digital-ticket-templates/events/:eventId/background-image` | Remove event-wide template background only. |
| `DELETE` | `/digital-ticket-templates/events/:eventId/:attendeeTypeId/background-image` | Remove attendee-specific template background only. |
| `DELETE` | `/digital-ticket-templates/events/:eventId` | Delete event-wide template. |
| `DELETE` | `/digital-ticket-templates/events/:eventId/:attendeeTypeId` | Delete attendee-specific template. |
| `GET` | `/digital-ticket-templates/events/:eventId/available-fields` | Field picker contract. |
| `POST` | `/digital-ticket-templates/events/:eventId/preview` | Render preview PNG without creating a ticket image row. |

Create/update multipart fields:

- `eventId`
- `attendeeTypeId` optional
- `name`
- `widthPx`
- `heightPx`
- `theme` JSON object string
- `elements` JSON array string
- `selectedFields` JSON array string
- `backgroundImage` file optional

Background and layout rules:

- `backgroundImage` is decorative only. It may contain colors, gradients, patterns, logos, or decorative shapes.
- Do not upload a completed ticket screenshot that already contains empty QR, name, description, date, or time boxes. Those pixels are baked into the bitmap and cannot be conditionally hidden by the backend.
- The backend renderer draws all functional ticket content dynamically: localized title, visitor name, QR container/QR, optional description, optional date, and optional time.
- `elements` and `selectedFields` remain part of the template contract for compatibility and field validation, but the generated Digital Ticket uses the fixed backend layout for functional content.

Legacy element shape:

```json
[
  {
    "id": "title",
    "type": "TEXT",
    "text": "Welcome",
    "x": 40,
    "y": 40,
    "width": 500,
    "height": 60,
    "style": {
      "fontSize": 32,
      "fontWeight": 700,
      "color": "#111111",
      "fontFamily": "Cairo",
      "align": "center",
      "direction": "rtl"
    }
  },
  {
    "id": "name",
    "type": "FIELD",
    "fieldKey": "fullName",
    "x": 40,
    "y": 140,
    "width": 500,
    "height": 52,
    "style": {
      "fontSize": 28,
      "color": "#000000"
    }
  },
  {
    "id": "logo",
    "type": "IMAGE",
    "src": "/uploads/event-branding/logo.png",
    "x": 32,
    "y": 32,
    "width": 96,
    "height": 96
  },
  {
    "id": "qr",
    "type": "QR",
    "x": 360,
    "y": 360,
    "width": 180,
    "height": 180
  }
]
```

Manual ticket APIs:

| Method | Route | Body |
| --- | --- | --- |
| `POST` | `/digital-tickets/registrations/:registrationId/generate` | `{ "requestBaseUrl": "{{publicBaseUrl}}" }` optional |
| `POST` | `/digital-tickets/registrations/:registrationId/regenerate` | Same body; sets `forceRegenerate` internally |
| `GET` | `/digital-tickets/registrations/:registrationId` | None |

Generated images are reused for the same `registrationId`, `templateId`, and `templateVersion`.

## Branding And Badge Templates

Branding uses multipart form-data:

```http
POST /event-branding
PATCH /event-branding/:eventId
```

Fields:

- `eventId`
- `theme.primary`
- `theme.primaryHover`
- `theme.background`
- `theme.text`
- `theme.radius`
- files: `logo`, `backgroundImage`, `certificateImage`

Image removal endpoints:

- `DELETE /event-branding/:eventId/logo`
- `DELETE /event-branding/:eventId/background-image`
- `DELETE /event-branding/:eventId/certificate-image`

Badge templates use multipart form-data:

```http
POST /badge-templates
PATCH /badge-templates/events/:eventId
```

Fields:

- `eventId`
- `name`
- `widthMm`
- `heightMm`
- `colors` JSON or `colors.primary`, `colors.text`, `colors.background`
- `selectedFields` JSON array string
- `layout` JSON object string
- file: `backgroundImage`

Image removal endpoint:

- `DELETE /badge-templates/events/:eventId/background-image`

## Upload Handling

All returned upload URLs are relative `/uploads/...` paths unless a service constructs an absolute public media URL. The API serves `/uploads` statically.

Uploads must be sent as `multipart/form-data`; Base64 image uploads are not supported. Replacing an uploaded image saves the new file, commits the DB update, then safely deletes the previous trusted DB path. If the DB write fails after upload, the newly uploaded orphan is removed when safe. Repeating an image delete is safe and returns success metadata with `alreadyMissing: true`.

Upload roots:

- `uploads/event-branding`
- `uploads/badge-templates`
- `uploads/certificates`
- `uploads/qr`
- `uploads/digital-tickets/templates`
- `uploads/digital-tickets/generated`
- `uploads/digital-tickets/previews`

Uploaded template assets are individually removable. Generated QR PNGs and generated digital ticket PNGs are system artifacts managed by regeneration, event cleanup, and storage cleanup; they are not ordinary user-removable uploaded assets.

For WhatsApp media, `APP_PUBLIC_BASE_URL` must be externally reachable when using a real provider.

## Notifications And WhatsApp

Notification template CRUD:

- `POST /notifications/templates`
- `GET /notifications/templates`
- `GET /notifications/templates/:id`
- `PATCH /notifications/templates/:id`
- `DELETE /notifications/templates/:id`

Registration send:

```http
POST /notifications/send-registration-qr
```

```json
{
  "registrationId": "{{registrationId}}",
  "locale": "AR",
  "forceResend": false
}
```

Logs/retry:

- `GET /notifications/logs`
- `GET /notifications/logs/:id`
- `GET /notifications/failed-summary`
- `POST /notifications/logs/:id/retry`
- `POST /notifications/retry-failed`
- `GET /admin/queues/whatsapp`

Digital ticket WhatsApp sends reuse the existing notification log, BullMQ WhatsApp queue, provider, retries, and rate limiter. Visitor requests use `DIGITAL_TICKET_REQUEST:{registrationId}:{providerMessageId}` so duplicate webhook delivery cannot resend while a distinct later message can. The request includes `metadata.imageUrl`; no QR fallback is sent when a Digital Ticket template or image is unavailable.

## Imports

```http
POST /imports/registrations
Content-Type: multipart/form-data
```

Fields:

- file upload
- `eventId`
- `attendeeTypeId` optional
- `generateQr` as `"true"` or omitted
- `source` optional, default `EXCEL_IMPORT`
- `mapping` optional JSON string

Inspect:

- `GET /imports`
- `GET /imports/:id`
- `GET /imports/:id/rows`

Imports are chunk processed. WhatsApp notification enqueueing can pause and resume based on queue depth.

## Pagination And Filters

Common query fields:

- `page`
- `limit`
- `search`
- `eventId`
- `status`
- `attendeeTypeId`
- date fields where supported by the module

Visitor search supports `search`, `fullName`, `phone`, `email`, `status`, `attendeeTypeId`, `page`, and `limit`. Admin visitor search also supports `eventId`; staff visitor search must not submit `eventId`.

## Frontend Checklist

- Store access and refresh tokens securely.
- Use STAFF token only for staff assignment/session/visitor flows.
- Use device API key only for device scan/sync endpoints.
- Render public forms from `registrationFields`; do not hard-code dynamic fields.
- Treat QR and ticket image generation as asynchronous after public registration.
- Show clear retry states for WhatsApp and import operations.
- Use returned `qrToken` for immediate public confirmation.
- For real WhatsApp media, verify image URLs are publicly reachable.
- Do not expose device offline private keys to the backend.
