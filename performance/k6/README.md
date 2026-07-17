# k6 performance tests

These scripts are standalone k6 tests. They do not install k6 as an npm dependency.

Default base URL:

```bash
http://localhost:3000/api/v1
```

Run registration load:

```bash
k6 run performance/k6/registration-load.js
k6 run -e BASE_URL=http://localhost:3000/api/v1 -e VUS=50 -e DURATION=2m performance/k6/registration-load.js
```

Run scan load through JWT:

```bash
k6 run -e ACCESS_TOKEN=... -e EVENT_ID=... -e DEVICE_ID=... -e STAFF_SESSION_ID=... -e CHECKPOINT_ID=... -e QR_TOKEN=... performance/k6/scan-load.js
```

Run device scan load:

```bash
k6 run -e DEVICE_API_KEY=... -e EVENT_ID=... -e STAFF_SESSION_ID=... -e CHECKPOINT_ID=... -e QR_TOKEN=... performance/k6/device-scan-load.js
```

Run fast device scan load:

```bash
k6 run -e DEVICE_API_KEY=... -e EVENT_ID=... -e STAFF_SESSION_ID=... -e CHECKPOINT_ID=... -e QR_TOKEN=... performance/k6/device-fast-scan-load.js
k6 run -e NO_SLEEP=true -e DEVICE_API_KEY=... -e EVENT_ID=... -e STAFF_SESSION_ID=... -e CHECKPOINT_ID=... -e QR_TOKEN=... performance/k6/device-fast-scan-load.js
```

Run fast device scan stress:

```bash
k6 run -e DEVICE_API_KEY=... -e EVENT_ID=... -e STAFF_SESSION_ID=... -e CHECKPOINT_ID=... -e QR_TOKEN=... performance/k6/device-fast-scan-stress.js
```

Run Redis-first fast device scan load:

```bash
k6 run -e DEVICE_API_KEY=... -e EVENT_ID=... -e STAFF_SESSION_ID=... -e CHECKPOINT_ID=... -e QR_TOKEN=... performance/k6/device-redis-fast-scan-load.js
```

Run sync batch load:

```bash
k6 run -e DEVICE_API_KEY=... -e EVENT_ID=... -e STAFF_SESSION_ID=... -e CHECKPOINT_ID=... -e QR_TOKEN=... -e BATCH_SIZE=10 performance/k6/sync-batch-load.js
```

Run reports read load:

```bash
k6 run -e ACCESS_TOKEN=... -e EVENT_ID=... performance/k6/reports-read-load.js
```

Run a first smoke test:

```bash
k6 run -e EVENT_ID=... -e ATTENDEE_TYPE_ID=... performance/k6/mixed-smoke.js
```

Useful env vars:

- `BASE_URL`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ACCESS_TOKEN`
- `DEVICE_API_KEY`
- `EVENT_ID`
- `ATTENDEE_TYPE_ID`
- `DEVICE_ID`
- `STAFF_SESSION_ID`
- `CHECKPOINT_ID`
- `QR_TOKEN`
- `VUS`
- `DURATION`
- `BATCH_SIZE`
- `NO_SLEEP`

Thresholds:

- Load tests target `http_req_failed < 1%`.
- Load tests target `http_req_duration p95 < 1000ms`.
- Fast scan load targets `http_req_duration p95 < 500ms`.
- Fast scan stress defaults to no sleep and targets `http_req_duration p95 < 1000ms`.
- Redis-first fast scan defaults to no sleep and targets `http_req_duration p95 < 300ms`.
- Smoke/stress-style scripts use `p95 < 2000ms` where appropriate.
