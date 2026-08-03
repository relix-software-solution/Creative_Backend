# Realtime Visitors and Durable Delta Sync

## What changed

The staff scanner no longer needs to download the full visitor stock whenever one visitor is added or edited.

The backend now provides three coordinated data paths:

1. `GET /api/v1/staff/visitors/offline-snapshot`
   - Full stock bootstrap only.
   - Stable cursor pagination.
   - Returns the durable `changeCursor` captured at snapshot start.

2. `GET /api/v1/staff/visitors/changes?after=<cursor>`
   - Returns only visitor UPSERT/DELETE changes after the device cursor.
   - The cursor is a monotonic `VisitorChange.id`.
   - Safe after disconnects, browser restarts, and missed SSE messages.

3. `GET /api/v1/staff/visitors/realtime`
   - Authenticated Server-Sent Events stream.
   - Sends an immediate notification when the durable change journal advances.
   - The frontend then reads the delta endpoint; the SSE message itself is not the source of truth.

The database migration also backfills every existing registration into the change journal. Existing staff devices can therefore repair an older or incomplete IndexedDB stock through delta sync instead of downloading the complete list again.

## Deployment order

Run the backend migration before deploying the updated frontend:

```bash
pnpm install
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm build
pnpm start:prod
```

The database account used by `prisma migrate deploy` must have permission to create tables, indexes, and triggers. The migration creates `VisitorChange` and triggers on `Registration` and `QrToken`.

Then deploy the frontend:

```bash
pnpm install
pnpm build
pnpm start
```

Do not delete browser IndexedDB during deployment. Pending offline registrations, scans, and visitor edits are preserved and continue syncing.

## Reverse proxy configuration

SSE must not be buffered. For Nginx, apply the equivalent of:

```nginx
location /api/v1/staff/visitors/realtime {
    proxy_pass http://backend_upstream;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Authorization $http_authorization;

    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;

    add_header X-Accel-Buffering no;
}
```

Keep normal API CORS configuration allowing the frontend origin and the `Authorization` header.

## QR signing requirement

`QR_SIGNING_SECRET` must remain stable:

- across backend restarts;
- across production deployments;
- across all backend instances behind a load balancer.

Changing it makes previously printed signed and compact QR codes fail signature validation. Never generate a new random value during each deployment.

QR image filenames now include a fingerprint of the exact compact token. This prevents an old PNG from being reused after QR rotation or after switching from a dense full token to the compact `Q2` token.

## Expected behavior

- Initial device preparation downloads the full visitor snapshot once.
- A public registration increments the staff stock without page refresh, normally within about one second.
- Only the new/changed visitor is downloaded after initial preparation.
- Online search queries the server first, so a newly registered visitor is searchable even before the local delta finishes.
- Missed SSE events are recovered from the durable delta cursor.
- Reconnect after hours offline applies all UPSERT/DELETE changes in pages.
- Existing full signed QR, compact `Q2`, and offline `O2` formats remain supported.

## Production verification checklist

1. Open the staff scanner with an existing stock, for example 800 visitors.
2. Confirm the browser has one open request to `/staff/visitors/realtime` with content type `text/event-stream`.
3. Register a new visitor from the public page.
4. Confirm the stock becomes 801 without refresh or login again.
5. Search for the visitor immediately by name or phone.
6. Scan the generated badge and confirm the response is allowed or gives a precise business reason, not `INVALID_QR`.
7. Disconnect the scanner, create/update/delete visitors, reconnect, and confirm only deltas are applied.
8. Create an offline staff registration and scan, reconnect, and confirm registration synchronization happens before its dependent scan.
9. Restart the backend and confirm existing printed QR codes still scan; this verifies that `QR_SIGNING_SECRET` remained unchanged.
