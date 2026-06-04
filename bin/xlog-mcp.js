#!/usr/bin/env node

import process from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createXLogMcpServer } from "../src/mcp/server.js";

function readOption(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) {
    return fallback;
  }
  return args[index + 1];
}

function parseMs(value, fallback) {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const args = process.argv.slice(2);
const serverUrl = readOption(args, "--server-url", process.env.XLOG_SERVER_URL || "http://127.0.0.1:2718");
const projectName = readOption(args, "--project", process.env.XLOG_PROJECT_NAME || "unknown");
const retentionMs = parseMs(
  readOption(args, "--retention", null) || process.env.XLOG_RETENTION_MS,
  5 * 60 * 1000
);
const captureDurationMs = parseMs(
  readOption(args, "--capture-duration", null) || process.env.XLOG_CAPTURE_DURATION_MS,
  60 * 1000
);
const captureGapMs = parseMs(
  readOption(args, "--capture-gap", null) || process.env.XLOG_CAPTURE_GAP_MS,
  10 * 1000
);

// ── Health check ──────────────────────────────────────────────────

let serverReachable = false;
try {
  const res = await fetch(`${serverUrl}/api/health`, {
    signal: AbortSignal.timeout(3000)
  });
  serverReachable = res.ok;
} catch {
  serverReachable = false;
}

if (!serverReachable) {
  console.error(`[xlog-mcp] warning: server at ${serverUrl} is not reachable`);
  console.error(`[xlog-mcp] start it with: xlog-cli serve`);
}

// ── 创建 MCP 服务器 ────────────────────────────────────────────────

const { server, store } = createXLogMcpServer({
  serverUrl,
  projectName,
  retentionMs,
  captureDurationMs,
  captureGapMs
});

// ── 连接 MCP 传输层 ────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

console.error(`[xlog-mcp] started | server=${serverUrl} | retention=${retentionMs / 1000}s capture=${captureDurationMs / 1000}s gap=${captureGapMs / 1000}s`);

// ── 优雅退出 ───────────────────────────────────────────────────────

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await store.close();
    process.exit(0);
  });
}
