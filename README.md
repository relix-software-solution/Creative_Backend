# Event Ops Backend

Production backend for event operations, public registrations, QR issuance, staff scanning, offline sync, imports, WhatsApp delivery, badge templates, digital ticket generation, and storage cleanup.

## Project Overview

Event Ops Backend is a NestJS 11 API for exhibitions, conferences, and on-site operations. It supports:

- Admin configuration for clients, events, venues, zones, checkpoints, attendee types, dynamic registration fields, devices, staff assignments, notification templates, branding, badge templates, and digital ticket templates.
- Public registration pages that create registrations and return a signed QR token immediately.
- Asynchronous registration pipelines that generate QR images, generate digital ticket PNGs when an active template exists, and queue WhatsApp delivery.
- Scanner APIs for online, fast persisted, and Redis-first scan ingestion.
- Offline registration and offline scan sync using device-provisioned Ed25519 public keys.
- Excel/CSV imports with chunk processing, duplicate tracking, backpressure, and per-recipient WhatsApp enqueueing.
- Transactional event cleanup plus safe retryable storage cleanup.

## Architecture

The codebase is organized as Nest modules under `src/modules`. Prisma 7.8 defines the database contract for MySQL. Redis and BullMQ handle asynchronous work.

High-level flow:

```text
Client/Event setup -> registration fields/templates -> registration/import/offline sync
  -> QR generation -> digital ticket generation when configured -> notification log
  -> whatsapp queue -> scan/sync/reporting -> event cleanup/storage cleanup
```

Authentication uses JWT access/refresh tokens for admin and staff workflows. Scanner device workflows use `X-Device-Api-Key` through `DeviceAuthGuard`; scanner apps should not use admin JWTs for device scan APIs.

## Tech Stack

| Area | Technology |
| --- | --- |
| Runtime | Node.js, NestJS 11 |
| HTTP adapter | Fastify |
| Database | MySQL |
| ORM | Prisma 7.8 |
| Queues | BullMQ |
| Queue store/cache | Redis |
| Auth | JWT, Passport |
| Uploads/static files | Fastify multipart/static |
| Images | QRCode, Sharp |
| Imports | xlsx, csv-parse |
| Tests | Jest |

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Runtime environment. |
| `PORT` | HTTP port. |
| `API_PREFIX` | API prefix, for example `api/v1`. |
| `APP_PUBLIC_BASE_URL` | Public absolute base URL used for WhatsApp media URLs. Required for real providers. |
| `ALLOW_LOCAL_PUBLIC_BASE_URL` | Allows localhost media URLs in development only. |
| `DATABASE_URL` | MySQL connection string. |
| `JWT_ACCESS_SECRET` | Access token signing secret. |
| `JWT_REFRESH_SECRET` | Refresh token signing secret. |
| `QR_SIGNING_SECRET` | HMAC secret for canonical online QR tokens. Keep stable after QR issuance. |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB` | Redis connection settings. |
| `QUEUE_PREFIX` | BullMQ key prefix. |
| `REGISTRATION_PIPELINE_ENABLED` | Enables asynchronous registration-created processing. |
| `IMPORT_QUEUE_ENABLED` | Enables import processing queue. |
| `SCAN_PROCESSING_ENABLED` | Enables scan processing workers. |
| `REDIS_SCAN_INGEST_ENABLED` | Enables Redis-first scan ingestion. |
| `REDIS_SCAN_FLUSH_ENABLED` | Enables Redis scan flush worker. |
| `STORAGE_CLEANUP_ENABLED` | Enables queued storage cleanup; disabled mode uses safe synchronous fallback. |
| `STORAGE_CLEANUP_MAX_ATTEMPTS` | Storage cleanup retry attempts. |
| `STORAGE_CLEANUP_RETRY_BACKOFF_MS` | Storage cleanup retry backoff. |
| `QR_IMAGE_RETENTION_DAYS` | Age threshold for old regenerable QR image cleanup. |
| `WHATSAPP_PROVIDER` | `FAKE`, `WASENDER`, or future provider value. |
| `WASENDER_API_URL`, `WASENDER_API_KEY` | Wasender provider config. |
| `WHATSAPP_HTTP_TIMEOUT_MS` | Provider HTTP timeout. |
| `WHATSAPP_SEND_RATE_PER_SECOND` | BullMQ worker limiter rate. |
| `WHATSAPP_SEND_MAX_ATTEMPTS` | Max WhatsApp delivery attempts. |
| `WHATSAPP_SEND_RETRY_BACKOFF_MS` | WhatsApp retry backoff. |
| `WHATSAPP_SEND_FAILED_ALERT_THRESHOLD` | Failed-summary threshold. |
| `WHATSAPP_SEND_FAILED_ALERT_WINDOW_MINUTES` | Failed-summary time window. |
| `WHATSAPP_QUEUE_BACKPRESSURE_ENABLED` | Enables import backpressure from WhatsApp queue depth. |
| `WHATSAPP_QUEUE_MAX_WAITING` | Queue depth at which imports pause. |
| `WHATSAPP_QUEUE_RESUME_THRESHOLD` | Queue depth at which imports resume. |
| `WHATSAPP_IMPORT_ENQUEUE_BATCH_SIZE` | Import enqueue chunk size. |

## Local Setup

```bash
pnpm install
pnpm prisma generate
pnpm prisma migrate dev
pnpm prisma db seed
pnpm start:dev
```

The default Postman environment uses `http://localhost:3000/api/v1`.

## Database Setup

Prisma schema lives at `prisma/schema.prisma`. Use:

```bash
pnpm prisma validate
pnpm prisma generate
pnpm prisma migrate dev --name <migration_name>
pnpm prisma db seed
```

For production deployments:

```bash
pnpm prisma migrate deploy
pnpm build
pnpm start:prod
```

Do not change `QR_SIGNING_SECRET` after QR tokens are issued unless all issued QR codes are intentionally invalidated.

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm build` | Compile Nest app. |
| `pnpm start:dev` | Run local dev server. |
| `pnpm start:prod` | Run compiled app. |
| `pnpm test --runInBand` | Run Jest suite serially. |
| `pnpm prisma:seed` | Seed database through `tsx prisma/seed.ts`. |
| `pnpm offline:qr:test-helper` | Generate local offline test key material and sample signed QR. |
| `pnpm perf:prepare` | Prepare k6 performance data. |

## Authentication Flow

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `POST /auth/login` | Public | Login by email/phone identifier and password. |
| `POST /auth/refresh` | Public | Exchange refresh token for new tokens. |
| `POST /auth/logout` | Public body token | Revoke refresh token. |
| `GET /auth/me` | JWT | Return current authenticated user. |

Admin APIs use `Authorization: Bearer {{accessToken}}`. Device APIs use `X-Device-Api-Key: {{deviceApiKey}}`.

## Roles

| Role | Access |
| --- | --- |
| `SUPER_ADMIN` | Full admin CRUD, queues, imports, cleanup, templates, reports, notification tools. |
| `STAFF` | Assigned scanner workflow, staff session, staff visitor list/update, scan submit, sync submit. |
| `CLIENT_VIEWER` | Read-oriented role in schema; current controller surface is mostly SUPER_ADMIN/STAFF. |

## Modules

| Module | Responsibility |
| --- | --- |
| Auth/Users/RBAC | Login, refresh, user lifecycle, guards, role checks. |
| Clients/Events | Client and event setup, event cascade delete, event-owned file cleanup. |
| Venues/Zones/Checkpoints | Event location hierarchy and checkpoint access rules. |
| Attendee Types/Registration Fields | Dynamic registration form contract. |
| Registrations/Public | Admin and public registration creation and status changes. |
| QR | Canonical online QR token generation, validation, revocation, PNG cache generation. |
| Scanner/Visitors/Staff | Staff assignment, session, visitor search/update, scan ingestion, movement logs. |
| Offline/Sync | Offline QR verification, offline registration/scan operation tracking, reconciliation. |
| Branding/Badge Templates | Public page branding and badge template metadata/resolution. |
| Digital Ticket Templates | Admin template CRUD, available fields, preview rendering. |
| Digital Tickets | PNG rendering, generated image records, manual generate/regenerate/get. |
| Notifications/WhatsApp | Notification templates/logs, idempotent WhatsApp queueing, retries, media delivery. |
| Imports | Excel/CSV upload, row validation, chunk processing, duplicate tracking. |
| Queue | BullMQ config, processors, WhatsApp queue metrics, Redis helpers. |
| Storage Cleanup | Safe cleanup manifests and queued file deletion. |
| Reports/Health | Reporting aggregates and service/queue health checks. |

## API Overview

All routes are under `{{baseUrl}}` from the Postman environment, usually `/api/v1`.

| Group | Routes |
| --- | --- |
| Auth | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` |
| Public APIs | `GET /public/events`, `GET /public/events/:id`, `POST /public/events/:id/register` |
| Clients | `POST/GET /clients`, `GET/PATCH/DELETE /clients/:id` |
| Events | `POST/GET /events`, `GET/PATCH/DELETE /events/:id`, `POST /events/:id/cleanup-files` |
| Branding | `POST/GET /event-branding`, `GET/PATCH/DELETE /event-branding/:eventId`, `DELETE /event-branding/:eventId/certificate-image` |
| Badge Templates | `POST/GET /badge-templates`, event template CRUD, available fields, resolved badge data |
| Digital Ticket Templates | `POST/GET /digital-ticket-templates`, event/attendee template CRUD, `available-fields`, `preview` |
| Digital Tickets | `POST /digital-tickets/registrations/:registrationId/generate`, `POST .../regenerate`, `GET .../:registrationId` |
| Registrations | `POST/GET /registrations`, `GET/PATCH/DELETE /registrations/:id`, `activate`, `cancel`, `block` |
| Visitors | `GET /admin/visitors`, `GET/PATCH /staff/visitors` |
| Scanner | `POST /scans`, `POST /device/scans`, `POST /device/scans/fast`, `POST /device/scans/redis-fast`, raw scan and movement lists |
| Offline/Sync | `POST /sync/batches`, `POST /device/sync/batches`, sync batch list/detail, `GET /device/offline-trust-bundle` |
| Devices | Device CRUD/status/API key rotation/offline key provisioning, `GET /device/me` |
| Staff | Staff assignments, `GET /staff-assignments/me`, staff sessions, `start-my-session` |
| Notifications/WhatsApp | Notification template CRUD, send registration QR, logs, retry, failed summary, `GET /admin/queues/whatsapp` |
| Imports | `POST /imports/registrations`, import list/detail/rows |
| Storage Cleanup | `POST /admin/storage/cleanup`, `GET /admin/storage/cleanup/:jobId`, `POST /events/:id/cleanup-files` |
| Reports/Health | `GET /reports/events/:eventId/*`, `GET /health`, `GET /health/queues` |

Use `postman/event-ops-backend.postman_collection.json` for concrete bodies, variables, and test scripts.

## Public Registration Flow

1. Visitor opens the public registration page.
2. Frontend calls `GET /public/events/:id`.
3. Frontend renders branding, attendee types, and active registration fields.
4. Visitor submits `POST /public/events/:id/register`.
5. Backend creates a registration with source `PUBLIC` and returns registration data, `digitalTicket` status, and `whatsappRequest`.
6. Registration pipeline generates or reuses the canonical QR image internally for scanning.
7. If an active digital ticket template exists for the attendee type or event, a digital ticket generation job is queued.
8. Digital ticket generation renders a PNG and stores `DigitalTicketImage`; public registration does not wait synchronously for PNG rendering.
9. Frontend treats `digitalTicket` as the primary media result and polls when status is `PENDING`.

Public fixed fields are `fullName`, `phone`, and optional `email`. Additional frontend fields must come from `registrationFields` and be submitted inside `customFields`.

## Queue Architecture

| Queue | Purpose |
| --- | --- |
| `registration-pipeline` | Registration-created QR/ticket/notification orchestration. |
| `digital-ticket-generation` | Render ticket PNGs and queue ticket-image WhatsApp sends. |
| `whatsapp-notifications` | Provider delivery with limiter, retries, and deterministic job IDs. |
| `import-processing` | Chunked import row processing and downstream notification enqueueing. |
| `scan-processing` | Async processing for fast persisted scan ingestion. |
| `offline-reconciliation` | Link pending offline scans after registration sync. |
| `event-storage-cleanup` | Delete approved event-owned upload files after DB commit. |

WhatsApp queue rate limiting is handled by the BullMQ worker limiter from `WHATSAPP_SEND_RATE_PER_SECOND`.

## Offline Architecture

Devices generate and keep their Ed25519 private key locally. The backend stores public keys only through:

- `POST /devices/:id/offline-key`
- `POST /devices/:id/offline-key/rotate`

Scanner devices fetch same-event trusted public keys with `GET /device/offline-trust-bundle`.

Offline QR format:

```text
base64url(payloadJson).base64url(ed25519Signature)
```

Payload includes `v`, `type: OFFLINE_REGISTRATION`, `eventId`, `issuerDeviceId`, `issuerKeyVersion`, `offlineRegistrationOperationId`, `offlineRegistrationId`, `offlineQrToken`, `attendeeTypeId`, optional `displayName`, `issuedAt`, and `validUntil`.

Offline scans can sync before registrations. They are stored as `PENDING_LINK` and reconciled after the offline registration mapping creates or links the canonical registration.

## QR Lifecycle

Online QR tokens are canonical database records in `QrToken`. QR PNGs under `uploads/qr` are regenerable cache artifacts named from the registration public ID. Revoking a QR changes token status; deleting a PNG does not revoke the QR.

`POST /qr/registrations/:registrationId/image` generates image metadata. `GET /qr/registrations/:registrationId/image` returns existing image metadata or generates it if missing.

QR remains internal/scanner-facing for registration creation flows. Public frontend code must not generate QR itself and must not treat raw QR tokens as the primary registration response.

## Digital Ticket Lifecycle

Digital ticket templates define dimensions, theme, selected fields, optional background, and elements JSON, but final ticket rendering uses the backend's fixed visual layout.

Newly generated or regenerated tickets render only:

- Localized Digital Entry Ticket title
- Prominent visitor name
- Camera-friendly QR code inside a centered white rounded box
- Event description, when available
- Compact localized event date card, when available
- Compact localized event time card, when available

The renderer uses Almarai as the default Arabic font family. When licensed project-owned font files are present, configure them with `DIGITAL_TICKET_FONT_REGULAR_PATH` and `DIGITAL_TICKET_FONT_BOLD_PATH`; defaults are `assets/fonts/Almarai-Regular.ttf` and `assets/fonts/Almarai-Bold.ttf`. Missing font files do not fail ticket generation: the renderer logs a safe warning and falls back. The QR is rendered square at the final ticket size with a visible quiet zone and no overflow from its white container. Digital ticket QR images encode the compact signed canonical online scan token, not registration JSON, WhatsApp request tokens, image URLs, or visitor metadata. ISO timestamps, registration IDs, public IDs, notes, validity footers, and location fields are not rendered. Event location is not stored, so the previous location area is replaced by Event Description.

`backgroundImage` is decorative only. It may include colors, gradients, patterns, logos, or decorative shapes, but it must not contain completed ticket UI, empty QR/name/description/date/time boxes, labels, or fixed placeholders. The backend draws all functional ticket sections dynamically so optional sections can collapse. A predesigned screenshot with baked empty boxes cannot support conditional hiding; replace it with a decorative background and let the backend render the functional layout.

Optional description/date/time boxes collapse completely when their values are empty. Preview rendering uses the same fixed layout as generated tickets.

Generation resolves the attendee-specific active template first, then falls back to the event-wide template. Generated records are unique by `(registrationId, templateId, templateVersion)`, so repeated non-force generation for the same version may reuse a valid existing image. Registrations affected by visual renderer changes should use the regenerate endpoint with `forceRegenerate` to replace the same-version output without creating duplicate database rows.

Public registration response shape:

```json
{
  "registration": {
    "id": "...",
    "publicId": "...",
    "eventId": "...",
    "fullName": "...",
    "phone": "...",
    "email": null,
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

`digitalTicket.status` is `READY`, `PENDING`, `NOT_CONFIGURED`, or `FAILED`. `READY` includes `imageUrl`, `relativePath`, `generatedAt`, and `templateVersion`; `PENDING` includes `pollUrl` when a secure access token is available. `FAILED` is returned only when generation failure can be reliably determined; otherwise in-flight/unknown generation remains `PENDING`.

Recommended frontend behavior: submit registration, read `digitalTicket.status`, display the image immediately when `READY`, poll `pollUrl` every 1.5-3 seconds when `PENDING` and stop after 30-60 seconds, show success without a ticket image for `NOT_CONFIGURED`, show retry/contact guidance for `FAILED`, and always show the WhatsApp request button when `whatsappRequest.enabled=true`.

## WhatsApp Lifecycle

Notification statuses are `PENDING`, `SENT`, `DELIVERED`, `FAILED`, and `CANCELLED`. The service-level lifecycle is queued, sending, sent/delivered, failed, then retry or force resend if requested.

Public registration no longer sends WhatsApp automatically. It returns `registration.publicId` and `whatsappRequest.url`; the prepared URL contains an Arabic ticket request followed by the public ID, for example `REG_CC49508E58A7E4CA`. Legacy ticket request token columns remain for backward-compatible internal polling but are not included in the WhatsApp message or public response.

The frontend displays "Request ticket via WhatsApp" and opens `whatsappRequest.url`; it must not rebuild the message when that URL is available and must never send an internal registration ID or QR token. The visitor sends the prepared message, and Wasender posts `messages.received` to `POST /webhooks/wasender`. The backend validates `WASENDER_WEBHOOK_SECRET`, ignores outgoing/group/duplicate deliveries, extracts `registration.publicId` from the message, and requires the normalized sender phone to match the registered phone.

After validation, the backend resolves a non-empty Digital Ticket image, safely regenerates it through the existing service if its current file is missing, and queues the existing WhatsApp worker to send the image to the webhook sender phone. If there is no active Digital Ticket template, no QR fallback is sent.

Registration QR/digital ticket WhatsApp idempotency uses:

```text
REGISTRATION_QR:{eventId}:{registrationId}
```

Visitor-requested Digital Ticket resends use one dedupe key per inbound provider message:

```text
DIGITAL_TICKET_REQUEST:{registrationId}:{providerMessageId}
```

Duplicate delivery of the same provider message does not resend; a distinct later inbound message may request another delivery.

Normal sends reuse existing `PENDING`, `SENT`, or `DELIVERED` logs. `FAILED` logs are retried via retry endpoints. Force resend creates a new dedupe key with a `:resend:{timestamp}` suffix.

Digital ticket delivery stores `metadata.imageUrl` and `metadata.mediaType: "DIGITAL_TICKET"` on the notification log. The user-initiated Digital Ticket request always supplies this image URL and never uses the QR fallback.

## Storage Cleanup

Approved upload roots:

| Root | Purpose | Cleanup behavior | Access |
| --- | --- | --- | --- |
| `uploads/event-branding` | Logo, background, certificate images | Event cleanup and replace/delete handlers | Public static `/uploads` |
| `uploads/badge-templates` | Badge template backgrounds | Event cleanup and template background delete | Public static `/uploads` |
| `uploads/certificates` | Certificate-related generated assets | Safe cleanup root | Public static `/uploads` |
| `uploads/qr` | Regenerable QR PNG cache | Event cleanup, orphan/old cleanup | Public static `/uploads` |
| `uploads/digital-tickets/templates` | Ticket template backgrounds | Event cleanup | Public static `/uploads` |
| `uploads/digital-tickets/generated` | Generated ticket PNGs | Event cleanup | Public static `/uploads` |
| `uploads/digital-tickets/previews` | Preview PNGs | Operational/lifecycle cleanup only | Public static `/uploads` |

Uploaded images use `multipart/form-data`; Base64 image uploads are not supported. Replacement saves the new file, commits the DB update, then safely deletes the old trusted DB path. If the DB write fails after a multipart upload, the new orphan file is removed when safe. Repeated image deletion is idempotent.

Individual uploaded-asset removal endpoints:

- `DELETE /event-branding/:eventId/logo`
- `DELETE /event-branding/:eventId/background-image`
- `DELETE /event-branding/:eventId/certificate-image`
- `DELETE /badge-templates/events/:eventId/background-image`
- `DELETE /digital-ticket-templates/events/:eventId/background-image`
- `DELETE /digital-ticket-templates/events/:eventId/:attendeeTypeId/background-image`

Generated QR PNGs and generated digital ticket PNGs are system artifacts managed by regenerate/event cleanup/storage cleanup, not ordinary user-removable uploaded assets.

Cleanup rejects absolute paths, path traversal, and unknown roots. `DELETE /events/:id` builds the manifest before the DB transaction, commits the cascade, then queues `event.cleanup-files` or runs safe fallback cleanup when queuing is disabled/unavailable.

## Import Flow

1. Admin uploads Excel/CSV to `POST /imports/registrations` as multipart form data.
2. API creates an `ImportJob` and rows.
3. Import processor validates rows in chunks.
4. Duplicate and validation errors are stored per row.
5. Successful rows create registrations and enqueue registration pipelines when QR generation is requested.
6. WhatsApp queue backpressure can pause/resume import enqueueing based on waiting+delayed job depth.

## Event Cleanup Flow

1. Admin calls `DELETE /events/:id`.
2. Service collects event-owned file paths.
3. Database-owned records are deleted transactionally, including registrations, QR tokens, movements, scans, sync/import data, notifications, branding, badge templates, digital ticket images, and digital ticket templates.
4. Storage cleanup is queued after commit.
5. Response includes deletion counts and storage cleanup job information.

## Testing

Requested verification commands:

```bash
pnpm prisma validate
pnpm test --runInBand
pnpm build
```

Postman collection and environment live in `postman/`.

## Deployment Notes

- Run `pnpm prisma migrate deploy` before starting production instances.
- Run API and worker-capable processes with Redis reachable for BullMQ.
- Configure `APP_PUBLIC_BASE_URL` to an externally reachable HTTP/HTTPS URL before using a real WhatsApp provider.
- Keep JWT, QR, database, Redis, and provider secrets private and stable.
- Monitor queue depth, failed jobs, disk usage under `uploads`, and failed notification summaries.
- Prefer object storage plus lifecycle policies as generated QR/ticket volume grows.

## Security Notes

- Public endpoints expose event registration data only.
- Admin endpoints use JWT and role guards.
- Staff endpoints are limited to the user's active assignment.
- Device endpoints are limited to the device event and require `X-Device-Api-Key`.
- Offline private keys are never stored by the backend.
- QR signing secrets and provider credentials are never returned by APIs.
- Upload cleanup only deletes approved relative upload paths.
