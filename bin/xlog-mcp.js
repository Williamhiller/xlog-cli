#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createXLogMcpServer } from "../src/mcp/server.js";
import { resolveInstance } from "../src/mcp/single-instance.js";

function readOption(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) {
    return fallback;
  }
  return args[index + 1];
}

function hasFlag(args, name) {
  return args.includes(name);
}

function parseMs(value, fallback) {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const args = process.argv.slice(2);
const root = path.resolve(readOption(args, "--root", process.env.XLOG_ROOT || process.cwd()));
const dataDir = readOption(args, "--data-dir", process.env.XLOG_DATA_DIR || ".xlog");
const projectName = readOption(args, "--project", process.env.XLOG_PROJECT_NAME || path.basename(root));
const host = readOption(args, "--host", process.env.XLOG_HOST || "127.0.0.1");
const startPort = Number(readOption(args, "--port", process.env.XLOG_PORT || "2718"));
const strictPort = hasFlag(args, "--strict-port");
const startHttpServer = !hasFlag(args, "--no-serve");
const explicitServerUrl = readOption(args, "--server-url", process.env.XLOG_SERVER_URL || null);
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

// ── 单实例管理 ─────────────────────────────────────────────────────

let instanceInfo = null;
let serverUrl = explicitServerUrl;

// 如果没有显式指定 serverUrl，尝试单实例选举
if (!serverUrl && startHttpServer) {
  try {
    instanceInfo = await resolveInstance(projectName, root, { startPort, host });

    if (instanceInfo.role === "secondary") {
      // 次实例：连接到已有的 MCP 服务器
      serverUrl = instanceInfo.serverUrl;
      console.error(`[xlog-mcp] connecting to existing server at ${serverUrl}`);
    } else {
      // 主实例：将使用本地 FileLogStore 并启动 HTTP 服务器
      console.error(`[xlog-mcp] primary instance, port=${instanceInfo.port}`);
    }
  } catch (err) {
    console.error(`[xlog-mcp] single-instance resolution failed: ${err.message}`);
    // 回退到普通模式
  }
}

// ── 创建 MCP 服务器 ────────────────────────────────────────────────

const { server, store, httpServerReady } = createXLogMcpServer({
  root,
  dataDir,
  projectName,
  host,
  port: instanceInfo?.port || startPort,
  strictPort,
  startHttpServer: startHttpServer && !serverUrl,
  serverUrl,
  retentionMs,
  captureDurationMs,
  captureGapMs
});

// ── 连接 MCP 传输层 ────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

const httpServer = await httpServerReady.catch(() => null);
const httpStatus = httpServer ? ` | serve=${httpServer.serverUrl}` : (serverUrl ? ` | remote=${serverUrl}` : " | serve=disabled");
console.error(`[xlog-mcp] started${httpStatus} | retention=${retentionMs / 1000}s capture=${captureDurationMs / 1000}s gap=${captureGapMs / 1000}s`);

// ── 优雅退出 ───────────────────────────────────────────────────────

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    // 释放单实例锁
    if (instanceInfo?.release) {
      await instanceInfo.release();
    }

    await store.close();
    process.exit(0);
  });
}
