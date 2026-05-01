#!/usr/bin/env node

import path from "node:path";
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
const root = path.resolve(readOption(args, "--root", process.env.XLOG_ROOT || process.cwd()));
const dataDir = readOption(args, "--data-dir", process.env.XLOG_DATA_DIR || ".xlog");
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

const { server, store } = createXLogMcpServer({
  root, dataDir, retentionMs, captureDurationMs, captureGapMs
});

const transport = new StdioServerTransport();
await server.connect(transport);

console.error(`[xlog-mcp] started | retention=${retentionMs / 1000}s capture=${captureDurationMs / 1000}s gap=${captureGapMs / 1000}s`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await store.close();
    process.exit(0);
  });
}
