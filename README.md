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

### Vite

```js
// vite.config.js
import { xlogVitePlugin } from "xlog-cli/vite";

export default {
  plugins: [xlogVitePlugin()]
};
```

### Webpack

```js
// webpack.config.js
import { XLogWebpackPlugin } from "xlog-cli/webpack";

export default {
  plugins: [new XLogWebpackPlugin()]
};
```

Start your dev server. View logs at `http://127.0.0.1:2718/viewer/`

## CLI

CLI reads logs directly from local files — no server or MCP needed.

```bash
npx xlog-cli query --limit 20    # Query logs
npx xlog-cli sessions            # List sessions
npx xlog-cli bugpack             # Export bugpack for AI
npx xlog-cli serve               # Start HTTP server (optional)
```

## Claude Code Skill

Use `/xlog` in Claude Code to query logs directly:

```
/xlog                    # Analyze recent logs
/xlog query              # Query with filters
/xlog sessions           # List sessions
/xlog bugpack            # Export bugpack
```

## MCP (AI Integration)

Optional: MCP server lets AI assistants query logs directly.

```json
{
  "mcpServers": {
    "xlog": {
      "command": "npx",
      "args": ["xlog-cli", "mcp"]
    }
  }
}
```

**Auto-discovery**: MCP and Vite/Webpack plugins automatically discover each other.

### MCP Tools

| Tool | Purpose |
|------|---------|
| `xlog_analyze` | Analyze recent logs, return errors and bugpack |
| `xlog_query` | Query logs with filters |
| `xlog_capture` | Capture a time window for reproduction |

### AI Workflow

1. `xlog_analyze` — examine existing logs
2. `xlog_capture` — reproduce bug if needed
3. AI suggests fix based on logs

## Standalone (No Install)

```html
<script src="xlog.min.js"></script>
```

## Storage

Logs: `.xlog/projects/<project>/sessions/<date>/<session>.jsonl`
