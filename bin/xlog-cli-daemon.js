#!/usr/bin/env node

import process from "node:process";
import { createXLogServer } from "../src/server/server.js";
import { removeDaemonState, writeDaemonStateFile } from "../src/server/daemon.js";

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

const args = process.argv.slice(2);
const port = Number(readOption(args, "--port", "2718"));
const host = readOption(args, "--host", "127.0.0.1");
const silent = hasFlag(args, "--silent");

let closing = false;
let serverState = null;

async function shutdown(exitCode = 0) {
  if (closing) {
    return;
  }

  closing = true;

  try {
    if (serverState) {
      await serverState.close();
    }
  } finally {
    await removeDaemonState();
    process.exit(exitCode);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shutdown(0);
  });
}

try {
  serverState = await createXLogServer({
    host,
    port,
    allowFallbackPort: false,
    silent,
    sharedDaemon: true
  });

  await writeDaemonStateFile(
    {
      host,
      port
    },
    {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      host: serverState.host,
      port: serverState.port,
      serverUrl: serverState.serverUrl,
      viewerUrl: serverState.viewerUrl
    }
  );

  process.stdin.resume();
} catch (error) {
  console.error("[xlog] failed to start daemon", error);
  await removeDaemonState();
  process.exit(1);
}
