# xlog-cli

English | [简体中文](README.zh-CN.md)

Local-first browser logging with capture grouping, a viewer, and AI-ready bugpacks.

Built for AI workflows: collect logs locally, package the right capture into a compact bugpack, and feed that payload directly into an LLM or agent.

npm package: [xlog-cli](https://www.npmjs.com/package/xlog-cli)

## Install

```bash
npm install xlog-cli
```

Optional global CLI:

```bash
npm install -g xlog-cli
```

## Quick Start

1. Install `xlog-cli` in your app.
2. Add the Vite or Webpack plugin, or install the runtime manually.
3. Start your normal dev server.

When the shared daemon is running, open the viewer at:

```text
http://127.0.0.1:2718/viewer/
```

`xlogger` automatically ensures a shared local daemon on `http://127.0.0.1:2718`, registers the project, keeps heartbeats alive while your dev process runs, and unregisters on exit.

If you installed globally, use `xlogger ...`. If you installed locally, use `npx xlogger ...`.

## For AI

1. Capture the bug with `xlog-cli` in the app you are debugging.
2. Export the smallest useful context with `npx xlogger bugpack`.
3. Pass the bugpack JSON to your AI tool or agent.
4. Ask the AI to inspect `logs`, `capture`, `session`, and the `summary` fields first.

Best results:

- Prefer one capture per issue.
- Keep `projectName` stable.
- Include only the logs around the failure window.
- Feed the AI the bugpack JSON instead of a screenshot or raw console dump.

## CLI

```bash
npx xlogger daemon start
npx xlogger daemon status
npx xlogger daemon stop
npx xlogger serve
npx xlogger query --limit 20
npx xlogger sessions
npx xlogger bugpack
npx xlogger bugpack --capture <captureId>
npx xlogger bugpack --session <sessionId>
```

## Integrate In An App

### Vite

```js
import { xloggerVitePlugin } from "xlog-cli/vite";

export default {
  plugins: [xloggerVitePlugin()]
};
```

### Webpack

```js
import { XLoggerWebpackPlugin } from "xlog-cli/webpack";

export default {
  plugins: [new XLoggerWebpackPlugin()]
};
```

### Manual runtime install

```js
import { installXLogger } from "xlog-cli/runtime";

installXLogger({
  serverUrl: "http://127.0.0.1:2718",
  projectName: "my-app",
  tool: "browser"
});
```

### Manual logging

```js
import { xloggerConsole } from "xlog-cli/runtime";

xloggerConsole("error", { file: import.meta.url, line: 12, column: 3 }, "Request failed", error);
```

## AI Bugpacks

```bash
npx xlogger bugpack
npx xlogger bugpack --capture <captureId>
npx xlogger bugpack --session <sessionId>
```

## Storage

Logs are written under:

```text
.xlogger/projects/<project>/sessions/<date>/<session>.jsonl
```

If available, xlog-cli also maintains a SQLite index for faster queries.

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

## Package Exports

- `xlog-cli`
- `xlog-cli/server`
- `xlog-cli/runtime`
- `xlog-cli/vite`
- `xlog-cli/webpack`
- `xlog-cli/babel-plugin`

## Viewer Dev

```bash
npm run dev:viewer
npm run dev:viewer:ui
npm run build:viewer
```

## Notes

- Use a stable `projectName` per app.
- Keep capture payloads small if you plan to feed them to AI.
- The shared daemon uses a fixed port by default and is reused across projects.
