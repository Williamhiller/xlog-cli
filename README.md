# xLogger

Local-first browser logging with capture grouping, a viewer, and AI-ready bugpacks.

## What It Does

- Captures `console.*`, `window.error`, and `unhandledrejection`
- Stores logs locally in `.xlogger`
- Runs a local viewer at `/viewer`
- Groups logs into captures automatically
- Exposes compact JSON bugpacks for AI analysis
- Uses one shared local daemon for all active projects

## Quick Start

1. Install xLogger in your app.
2. Enable the Vite or Webpack plugin.
3. Start your normal dev process.

xLogger will automatically ensure a shared local daemon on `http://127.0.0.1:2718`, register the project, keep a heartbeat alive while the dev process runs, and unregister on exit.

If all projects exit, the daemon shuts itself down.

## AI Analysis

Get the latest bugpack:

```bash
node ./bin/xlogger.js bugpack --latest
```

Get a specific capture:

```bash
node ./bin/xlogger.js bugpack --capture <captureId>
```

Get the latest capture inside a session:

```bash
node ./bin/xlogger.js bugpack --session <sessionId>
```

## CLI

### Shared daemon

```bash
node ./bin/xlogger.js daemon start
node ./bin/xlogger.js daemon status
node ./bin/xlogger.js daemon stop
```

Normal development does not require manual `daemon start`.

Global daemon state is stored in:

```text
~/.xlogger/daemon.json
```

Global daemon logs are stored in:

```text
~/.xlogger/daemon.log
```

### Foreground server

```bash
node ./bin/xlogger.js serve
```

Use `serve` for direct foreground debugging.

### Raw queries

```bash
node ./bin/xlogger.js query --limit 20
node ./bin/xlogger.js sessions
```

## Viewer Dev

```bash
npm run dev:viewer
npm run dev:viewer:ui
npm run build:viewer
```

## Integrate In An App

### Vite

Use the plugin so the project auto-registers with the shared daemon.

```js
import { xloggerVitePlugin } from "xlogger/vite";

export default {
  plugins: [xloggerVitePlugin()]
};
```

### Webpack

Use the plugin so the project auto-registers with the shared daemon.

```js
import { XLoggerWebpackPlugin } from "xlogger/webpack";

export default {
  plugins: [new XLoggerWebpackPlugin()]
};
```

### Manual runtime install

```js
import { installXLogger } from "xlogger/runtime";

installXLogger({
  serverUrl: "http://127.0.0.1:2718",
  projectName: "my-app",
  tool: "browser"
});
```

If the shared daemon disappears, runtime logging stops sending network logs and leaves the native `console` behavior intact.

## Manual Logging

```js
import { xloggerConsole } from "xlogger/runtime";

xloggerConsole("error", { file: import.meta.url, line: 12, column: 3 }, "Request failed", error);
```

## API

- `GET /api/health`
- `GET /api/runtime/status`
- `POST /api/runtime/register`
- `POST /api/runtime/heartbeat`
- `POST /api/runtime/unregister`
- `GET /api/captures`
- `GET /api/x-log`
- `POST /api/x-log`
- `GET /api/captures/:captureId/share.json`

## Storage

Logs are written under:

```text
.xlogger/projects/<project>/sessions/<date>/<session>.jsonl
```

If available, xLogger also maintains a SQLite index for faster queries.

## Package Exports

- `xlogger`
- `xlogger/server`
- `xlogger/runtime`
- `xlogger/vite`
- `xlogger/webpack`
- `xlogger/babel-plugin`

## Notes

- Use a stable `projectName` per app.
- Keep capture payloads small if you plan to feed them to AI.
- The shared daemon uses a fixed port by default and is reused across projects.
