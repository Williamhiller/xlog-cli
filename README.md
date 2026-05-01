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

The Vite and Webpack plugins start an in-process xlog server during development. Open the viewer at:

```text
http://127.0.0.1:2718/viewer/
```

By default the local server uses `http://127.0.0.1:2718` and falls back to the next available port when needed. For manual runtime installs, start it with `npx xlog-cli serve`.

If you installed globally, use `xlog-cli ...`. If you installed locally, use `npx xlog-cli ...`.

## Quick Integration (No Install)

Copy a single JS file into your project — no `npm install` required. All 18 `console.*` methods are intercepted with full serialization, stack traces, capture grouping, and error listeners.

### Regular Web Page

Download `standalone/xlog.min.js` (or `xlog-plugin.js`) and add a script tag:

```html
<script src="xlog.min.js"></script>
```

Or inline a custom server URL:

```html
<script>window.__xlog_config__ = { server: "http://127.0.0.1:2718" };</script>
<script src="xlog.min.js"></script>
```

### Browser Extension — Background Script (MV3 Service Worker)

```js
// background.js (service worker)
importScripts("xlog.min.js");
```

The script auto-detects the `background` environment, uses `chrome.storage.session` for capture coordination, and flushes logs immediately (no batching) since the service worker can terminate at any time.

### Browser Extension — Popup / Sidepanel / Options

```html
<!-- popup.html, sidepanel.html, options.html -->
<script src="xlog.min.js"></script>
```

Environment is auto-detected from the page pathname (`popup`, `sidepanel`, `options`).

### Browser Extension — Content Script

```json
// manifest.json
{
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["xlog.min.js"],
    "run_at": "document_start"
  }]
}
```

### Web Workers / Service Workers

```js
// worker.js
importScripts("xlog.min.js");
```

Auto-detected as `worker` environment. Logs flush immediately.

### Programmatic Injection (Puppeteer / Playwright)

Use the minimal `standalone/xlog.inject.js`:

```js
// Puppeteer
const page = await browser.newPage();
await page.addScriptTag({ path: "xlog.inject.js" });

// Playwright
const page = await browser.newPage();
await page.addScriptTag({ path: "xlog.inject.js" });

// chrome.scripting API
chrome.scripting.executeScript({
  target: { tabId },
  files: ["xlog.inject.js"]
});
```

### Copy-Paste Console Snippet

For quick one-off debugging, paste this directly into the browser console:

```js
var s=document.createElement("script");
s.src="http://127.0.0.1:2718/viewer/xlog.inject.js";
document.head.appendChild(s);
```

### Vite Plugin (No Install)

Copy `xlog-plugin.js` into your project and reference it:

```js
// vite.config.js
import xlogPlugin from "./xlog-plugin.js";

export default {
  plugins: [xlogPlugin()]
};
```

This also works as a Babel plugin — it injects source file/line/column metadata into every `console.*` call for precise callsite tracking.

## For AI

### MCP (Recommended)

xlog-cli ships an MCP server so AI assistants can query browser logs directly.

```bash
npx xlog-cli mcp
npx xlog-cli mcp --root /path/to/project
```

**MCP client config (Claude Desktop, Cursor, etc.):**

```json
{
  "mcpServers": {
    "xlog": {
      "command": "npx",
      "args": ["xlog-cli", "mcp", "--root", "/path/to/project"]
    }
  }
}
```

**MCP Tools:**

| Tool | Purpose |
|------|---------|
| `xlog_analyze` | Analyze recent logs. Returns errors, warnings, and a compact bugpack. Default: last 5 minutes. |
| `xlog_capture` | Capture a clean time window for user-driven reproduction. Use `start` then `stop`. |
| `xlog_query` | Raw log query with full filtering (level, file, time range, etc.). |

**Configuration flags:**

| Flag | Env Var | Default | Description |
|------|---------|---------|-------------|
| `--retention` | `XLOG_RETENTION_MS` | 300000 (5min) | Auto-cleanup logs older than this |
| `--capture-duration` | `XLOG_CAPTURE_DURATION_MS` | 60000 (1min) | Suggested max capture window |
| `--capture-gap` | `XLOG_CAPTURE_GAP_MS` | 10000 (10s) | Inactivity gap to split captures |

**Typical AI workflow:**

1. AI examines existing logs via `xlog_analyze` (no user action needed).
2. If the bug requires manual reproduction, AI uses `xlog_capture({ action: "start" })`, asks the user to reproduce, then calls `xlog_capture({ action: "stop" })`.
3. For deeper investigation, AI uses `xlog_query` with specific filters.

### Manual Bugpack

1. Capture the bug with `xlog-cli` in the app you are debugging.
2. Export the smallest useful context with `npx xlog-cli bugpack`.
3. Pass the bugpack JSON to your AI tool or agent.

Best results:

- Prefer one capture per issue.
- Keep `projectName` stable.
- Include only the logs around the failure window.
- Feed the AI the bugpack JSON instead of a screenshot or raw console dump.

## CLI

```bash
npx xlog-cli serve                           # Start server (default)
npx xlog-cli mcp                             # Start MCP server for AI assistants
npx xlog-cli query --limit 20                # Query logs
npx xlog-cli sessions                        # List sessions
npx xlog-cli bugpack                         # Export bugpack
npx xlog-cli bugpack --capture <captureId>
npx xlog-cli bugpack --session <sessionId>
```

**MCP options:**

```bash
npx xlog-cli mcp --root /path/to/project --retention 180000 --capture-duration 30000
```

## Integrate In An App

### Vite

```js
import { xlogVitePlugin } from "xlog-cli/vite";

export default {
  plugins: [xlogVitePlugin()]
};
```

### Webpack

```js
import { XLogWebpackPlugin } from "xlog-cli/webpack";

export default {
  plugins: [new XLogWebpackPlugin()]
};
```

### Manual runtime install

```js
import { installXLog } from "xlog-cli/runtime";

installXLog({
  serverUrl: "http://127.0.0.1:2718",
  projectName: "my-app",
  tool: "browser"
});
```

### Manual logging

```js
import { xlogConsole } from "xlog-cli/runtime";

xlogConsole("error", { file: import.meta.url, line: 12, column: 3 }, "Request failed", error);
```

## AI Bugpacks

```bash
npx xlog-cli bugpack
npx xlog-cli bugpack --capture <captureId>
npx xlog-cli bugpack --session <sessionId>
```

## Storage

Logs are written under:

```text
.xlog/projects/<project>/sessions/<date>/<session>.jsonl
```

If available, xlog-cli also maintains a SQLite index for faster queries.

## API

- `GET /api/health`
- `GET /api/captures`
- `GET /api/x-log`
- `POST /api/x-log`
- `GET /api/captures/:captureId/share.json`

## Package Exports

- `xlog-cli`
- `xlog-cli/server`
- `xlog-cli/mcp`
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
- Use `serverUrl` when you want the runtime to send logs to an already-running xlog server.
