#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { groupRecordsIntoCaptures } from "../src/server/captures.js";
import { buildCaptureSharePayload } from "../src/server/share.js";
import { createXLogServer } from "../src/server/server.js";
import { FileLogStore } from "../src/server/storage.js";

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

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function readBaseOptions(args) {
  const root = path.resolve(readOption(args, "--root", process.cwd()));
  const port = Number(readOption(args, "--port", "2718"));
  const host = readOption(args, "--host", "127.0.0.1");
  const dataDir = readOption(args, "--data-dir", ".xlog");
  const projectName = readOption(args, "--project", path.basename(root));
  const strictPort = hasFlag(args, "--strict-port");
  const silent = hasFlag(args, "--silent");

  return {
    root,
    port,
    host,
    dataDir,
    projectName,
    strictPort,
    silent
  };
}

function createStore(options) {
  return new FileLogStore({
    projectRoot: options.root,
    dataDir: options.dataDir
  });
}

async function runServe(options) {
  await createXLogServer({
    projectRoot: options.root,
    projectName: options.projectName,
    port: options.port,
    host: options.host,
    dataDir: options.dataDir,
    allowFallbackPort: !options.strictPort,
    silent: options.silent
  });

  process.stdin.resume();
}

async function runQuery(args, options) {
  const store = createStore(options);

  try {
    const logs = await store.queryLogs({
      project: readOption(args, "--project", ""),
      captureId: readOption(args, "--capture", ""),
      sessionId: readOption(args, "--session", ""),
      level: readOption(args, "--level", ""),
      kind: readOption(args, "--kind", ""),
      file: readOption(args, "--file", ""),
      q: readOption(args, "--q", ""),
      from: readOption(args, "--from", ""),
      to: readOption(args, "--to", ""),
      limit: readOption(args, "--limit", "20")
    });
    const storage = await store.describeStorage();

    printJson({
      storage,
      count: logs.length,
      logs
    });
  } finally {
    await store.close();
  }
}

async function runSessions(args, options) {
  const store = createStore(options);

  try {
    const sessions = await store.listSessions({
      project: readOption(args, "--project", "")
    });
    const storage = await store.describeStorage();

    printJson({
      storage,
      count: sessions.length,
      sessions
    });
  } finally {
    await store.close();
  }
}

async function resolveBugpackCapture(args, store) {
  const project = readOption(args, "--project", "");
  const explicitCaptureId = readOption(args, "--capture", "");
  const sessionId = readOption(args, "--session", "");
  const limit = readOption(args, "--limit", "5000");

  if (explicitCaptureId) {
    const capture = await store.getCaptureById(explicitCaptureId, { project });
    const logs = await store.getLogsForCapture(capture, {
      project,
      limit
    });
    return { capture, logs };
  }

  if (sessionId) {
    const sessionLogs = await store.queryLogs({
      project,
      sessionId,
      limit
    });
    const orderedSessionLogs = [...sessionLogs].reverse();
    const sessionCaptures = groupRecordsIntoCaptures(orderedSessionLogs, {
      project
    });
    const capture = sessionCaptures[0] || null;
    const logs = capture
      ? await store.getLogsForCapture(capture, {
          project,
          sessionId,
          limit
        })
      : orderedSessionLogs;
    return { capture, logs };
  }

  const captures = await store.listCaptures({ project });
  const capture = captures[0] || null;
  const logs = await store.getLogsForCapture(capture, {
    project,
    limit
  });
  return { capture, logs };
}

async function runBugpack(args, options) {
  const store = createStore(options);

  try {
    const { capture, logs } = await resolveBugpackCapture(args, store);
    const storage = await store.describeStorage();

    if (!capture && !logs.length) {
      printJson({
        ok: false,
        error: "No capture found",
        storage
      });
      process.exitCode = 1;
      return;
    }

    const payload = buildCaptureSharePayload({
      capture,
      logs: [...logs].reverse()
    });

    printJson({
      ok: true,
      storage,
      ...payload
    });
  } finally {
    await store.close();
  }
}

function parseMs(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function runMcp(args, options) {
  const { createXLogMcpServer } = await import("../src/mcp/server.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");

  const retentionMs = parseMs(readOption(args, "--retention", ""), 5 * 60 * 1000);
  const captureDurationMs = parseMs(readOption(args, "--capture-duration", ""), 60 * 1000);
  const captureGapMs = parseMs(readOption(args, "--capture-gap", ""), 10 * 1000);

  const { server, store, httpServerReady } = createXLogMcpServer({
    root: options.root,
    dataDir: options.dataDir,
    projectName: options.projectName,
    host: options.host,
    port: options.port,
    strictPort: options.strictPort,
    startHttpServer: !hasFlag(args, "--no-serve"),
    retentionMs,
    captureDurationMs,
    captureGapMs
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const httpServer = await httpServerReady;
  const httpStatus = httpServer ? ` | serve=${httpServer.serverUrl}` : " | serve=disabled";
  console.error(`[xlog-mcp] started${httpStatus} | retention=${retentionMs / 1000}s capture=${captureDurationMs / 1000}s gap=${captureGapMs / 1000}s`);

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      await store.close();
      process.exit(0);
    });
  }
}

const args = process.argv.slice(2);
const command = args[0] || "serve";
const options = readBaseOptions(args);

if (!["serve", "query", "sessions", "bugpack", "mcp"].includes(command)) {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

if (command === "serve") {
  await runServe(options);
} else if (command === "query") {
  await runQuery(args, options);
} else if (command === "sessions") {
  await runSessions(args, options);
} else if (command === "bugpack") {
  await runBugpack(args, options);
} else if (command === "mcp") {
  await runMcp(args, options);
}
