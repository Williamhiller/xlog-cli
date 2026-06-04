# xlog-cli

English | [简体中文](README.zh-CN.md)

Local-first browser logging for AI workflows. Collect logs, build bugpacks, feed to LLMs.

npm: [xlog-cli](https://www.npmjs.com/package/xlog-cli)

## Install

```bash
npm install xlog-cli
# or global
npm install -g xlog-cli
```

## Quick Start

### 1. Start the server

```bash
npx xlog-cli serve
# → listening on http://127.0.0.1:2718
```

The server receives browser logs and serves the viewer. Start it first.

### 2. Add the plugin

**Vite**

```js
// vite.config.js
import { xlogVitePlugin } from "xlog-cli/vite";

export default {
  plugins: [xlogVitePlugin()]
};
```

**Webpack**

```js
// webpack.config.js
import { XLogWebpackPlugin } from "xlog-cli/webpack";

export default {
  plugins: [new XLogWebpackPlugin()]
};
```

Start your dev server. View logs at `http://127.0.0.1:2718/`

## CLI

CLI reads logs directly from local files — no server or MCP needed.

```bash
npx xlog-cli query --limit 20    # Query logs
npx xlog-cli sessions            # List sessions
npx xlog-cli bugpack             # Export bugpack for AI
```

## MCP (AI Integration)

Optional: MCP server lets AI assistants query logs via tools.

```bash
# Start MCP (connects to server at 127.0.0.1:2718)
npx xlog-mcp

# Or specify a custom server
npx xlog-mcp --server-url http://127.0.0.1:3000
```

Claude Code config:

```json
{
  "mcpServers": {
    "xlog": {
      "command": "npx",
      "args": ["xlog-mcp"]
    }
  }
}
```

### MCP Tools

| Tool | Purpose |
|------|---------|
| `xlog_status` | Check MCP and server connection status |
| `xlog_analyze` | Analyze recent logs, return errors and bugpack |
| `xlog_query` | Query logs with filters |
| `xlog_capture` | Capture a time window for reproduction |
| `xlog_context` | Get surrounding context for a specific log |
| `xlog_diff` | Compare two captures for regression debugging |
| `xlog_insights` | AI-powered pattern analysis |
| `xlog_patterns` | Detect error bursts and repeated errors |
| `xlog_anomalies` | Detect unusual patterns |
| `xlog_trends` | Analyze error rate trends |

### AI Workflow

1. `xlog_analyze` — examine existing logs
2. `xlog_capture` — reproduce bug if needed
3. AI suggests fix based on logs

## Architecture

```
xlog-cli serve          ← HTTP server (receives browser logs, serves viewer)
xlog-mcp                ← MCP server (connects to HTTP server, exposes tools to AI)
Vite/Webpack plugin     ← Injects runtime into browser (sends logs to server)
```

**Server-first**: the HTTP server is independent infrastructure. MCP and plugins are clients that connect to it.

```
Browser → POST /api/x-log → xlog-cli serve → .xlog/ (JSONL + SQLite)
                                    ↑
                              xlog-mcp → AI assistant
```

## Configuration

### Server

```bash
xlog-cli serve --port 3000 --host 127.0.0.1
```

By default, the server fails if the port is occupied. Use `--no-strict-port` to allow fallback to nearby ports.

### Plugin

```js
xlogVitePlugin({
  serverUrl: "http://127.0.0.1:3000",  // default: http://127.0.0.1:2718
  projectName: "my-app",
  debugDomSnapshots: false
})
```

### MCP

```bash
xlog-mcp --server-url http://127.0.0.1:3000 --project my-app
```

Environment variables: `XLOG_SERVER_URL`, `XLOG_PROJECT_NAME`, `XLOG_RETENTION_MS`, `XLOG_CAPTURE_DURATION_MS`, `XLOG_CAPTURE_GAP_MS`.

## Claude Code Skill

Use `/xlog` in Claude Code to query logs directly:

```
/xlog                    # Analyze recent logs
/xlog query              # Query with filters
/xlog sessions           # List sessions
/xlog bugpack            # Export bugpack
```

## Standalone (No Install)

```html
<script src="xlog.min.js"></script>
```

## Storage

Logs: `.xlog/projects/<project>/sessions/<date>/<session>.jsonl`
