# xlog-cli Command Playbook

## Baseline Health

```bash
npx xlog-cli serve --silent
npx xlog-cli query --limit 20
npx xlog-cli sessions
```

Use this set to confirm server startup and whether any logs/sessions are available.

## Bugpack-First Debug Loop

```bash
npx xlog-cli bugpack
npx xlog-cli bugpack --capture <captureId>
npx xlog-cli bugpack --session <sessionId>
```

Use `bugpack` output to reason about `capture`, `logs`, `session`, and `summary` before broad code edits.

## Server Lifecycle Checks

```bash
npx xlog-cli serve --silent
curl -sS http://127.0.0.1:2718/api/health
```

Run this sequence when diagnosing server startup or API regressions.

## Viewer Development

```bash
npm run dev:viewer
npm run dev:viewer:ui
npm run build:viewer
```

Use `dev:viewer` for served integration behavior and `dev:viewer:ui` for direct React iteration. Rebuild after UI changes that affect served static output.

## API Smoke Checks

- `GET /api/health`: server liveness.
- `GET /api/captures`: capture listing sanity.
- `GET /api/x-log`: filtered logs.
- `POST /api/x-log`: ingestion path.
- `GET /api/captures/:captureId/share.json`: capture share payload.

Use API checks when behavior diverges between CLI output and viewer output.

## Validation Guidance

- Touching runtime/server ingestion: verify server health + `query` + `bugpack`.
- Touching query/storage/indexing: verify `query` with filters and `sessions`.
- Touching capture grouping: verify at least one `bugpack --capture`.
- Touching viewer code: run `npm run build:viewer` and load `/viewer/` from a running server.
