# xlog-cli Command Playbook

## Baseline Health

```bash
npx xlog-cli daemon status
npx xlog-cli query --limit 20
npx xlog-cli sessions
```

Use this set to confirm daemon health and whether any logs/sessions are available.

## Bugpack-First Debug Loop

```bash
npx xlog-cli bugpack
npx xlog-cli bugpack --capture <captureId>
npx xlog-cli bugpack --session <sessionId>
```

Use `bugpack` output to reason about `capture`, `logs`, `session`, and `summary` before broad code edits.

## Daemon Lifecycle Checks

```bash
npx xlog-cli daemon start
npx xlog-cli daemon status
npx xlog-cli daemon stop
```

Run this sequence when diagnosing orphan daemon state, stale PID files, or startup regressions.

## Viewer Development

```bash
npm run dev:viewer
npm run dev:viewer:ui
npm run build:viewer
```

Use `dev:viewer` for served integration behavior and `dev:viewer:ui` for direct React iteration. Rebuild after UI changes that affect served static output.

## API Smoke Checks

- `GET /api/health`: daemon/server liveness.
- `GET /api/runtime/status`: active runtime registrations.
- `GET /api/captures`: capture listing sanity.
- `GET /api/x-log`: filtered logs.
- `POST /api/x-log`: ingestion path.
- `GET /api/captures/:captureId/share.json`: capture share payload.

Use API checks when behavior diverges between CLI output and viewer output.

## Validation Guidance

- Touching runtime/server ingestion: verify `daemon status` + `query` + `bugpack`.
- Touching query/storage/indexing: verify `query` with filters and `sessions`.
- Touching capture grouping: verify at least one `bugpack --capture`.
- Touching viewer code: run `npm run build:viewer` and load `/viewer/` from a running daemon.
