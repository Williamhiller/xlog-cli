#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { groupRecordsIntoCaptures } from "../src/server/captures.js";
import {
  ensureXLogDaemon,
  getXLogDaemonStatus,
  startXLogDaemon,
  stopXLogDaemon
} from "../src/server/daemon.js";
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

async function runDaemon(args, options) {
  const subcommand = args[1] || "status";
  const daemonOptions = {
    projectRoot: options.root,
    dataDir: options.dataDir,
    projectName: options.projectName,
    host: options.host,
    port: options.port,
    silent: options.silent
  };

  if (subcommand === "start") {
    const result = await startXLogDaemon(daemonOptions);
    printJson({
      ok: true,
      action: result.started ? "started" : "reused",
      daemon: result.state,
      paths: result.paths
    });
    return;
  }

  if (subcommand === "ensure") {
    const result = await ensureXLogDaemon(daemonOptions);
    printJson({
      ok: true,
      action: result.started ? "started" : "reused",
      daemon: result.state,
      paths: result.paths
    });
    return;
  }

  if (subcommand === "stop") {
    const result = await stopXLogDaemon();
    printJson({
      ok: true,
      action: result.alreadyStopped ? "already-stopped" : "stopped",
      forced: Boolean(result.forced),
      daemon: result.state,
      paths: result.paths
    });
    return;
  }

  if (subcommand === "status") {
    const result = await getXLogDaemonStatus({
      ...daemonOptions,
      cleanupStale: true
    });
    printJson({
      ok: true,
      running: result.running,
      healthy: result.healthy,
      stale: result.stale,
      daemon: result.state,
      paths: result.paths
    });
    return;
  }

  console.error(`Unknown daemon command: ${subcommand}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const command = args[0] || "serve";
const options = readBaseOptions(args);

if (!["serve", "query", "sessions", "bugpack", "daemon"].includes(command)) {
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
} else if (command === "daemon") {
  await runDaemon(args, options);
}
