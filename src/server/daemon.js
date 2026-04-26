import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATA_DIR, DEFAULT_HOST, DEFAULT_PORT } from "../shared/constants.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DAEMON_BIN_PATH = path.join(PACKAGE_ROOT, "bin", "xlogger-daemon.js");
const HEALTH_TIMEOUT_MS = 1500;
const START_TIMEOUT_MS = 12000;
const STOP_TIMEOUT_MS = 5000;
const WAIT_INTERVAL_MS = 150;
const HEARTBEAT_INTERVAL_MS = 10000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAbortSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
    }
  };
}

async function readJsonFile(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readLogExcerpt(filePath, maxChars = 4000) {
  try {
    const content = await readFile(filePath, "utf8");
    return content.slice(-maxChars).trim();
  } catch {
    return "";
  }
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EPERM") {
      return true;
    }

    return false;
  }
}

function createProjectKey(projectRoot) {
  return path.resolve(projectRoot || process.cwd());
}

function buildRegistrationPayload(options = {}) {
  return {
    pid: options.pid || process.pid,
    projectRoot: createProjectKey(options.projectRoot),
    projectName: options.projectName || path.basename(createProjectKey(options.projectRoot)),
    tool: options.tool || "unknown",
    dataDir: path.resolve(options.projectRoot || process.cwd(), options.dataDir || DEFAULT_DATA_DIR)
  };
}

async function postJson(serverUrl, pathname, payload, timeoutMs = HEALTH_TIMEOUT_MS) {
  const { signal, dispose } = createAbortSignal(timeoutMs);

  try {
    const response = await fetch(new URL(pathname, serverUrl), {
      method: "POST",
      signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        payload: null
      };
    }

    return {
      ok: true,
      status: response.status,
      payload: await response.json()
    };
  } catch {
    return {
      ok: false,
      status: 0,
      payload: null
    };
  } finally {
    dispose();
  }
}

async function fetchJson(serverUrl, pathname, timeoutMs = HEALTH_TIMEOUT_MS) {
  const { signal, dispose } = createAbortSignal(timeoutMs);

  try {
    const response = await fetch(new URL(pathname, serverUrl), {
      method: "GET",
      signal,
      headers: {
        accept: "application/json"
      }
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        payload: null
      };
    }

    return {
      ok: true,
      status: response.status,
      payload: await response.json()
    };
  } catch {
    return {
      ok: false,
      status: 0,
      payload: null
    };
  } finally {
    dispose();
  }
}

function toPublicState(state, health = null) {
  if (!state) {
    return null;
  }

  return {
    pid: state.pid,
    startedAt: state.startedAt,
    host: state.host,
    port: state.port,
    serverUrl: state.serverUrl,
    viewerUrl: state.viewerUrl,
    health
  };
}

export function resolveDaemonPaths() {
  const root = path.join(os.homedir(), ".xlogger");

  return {
    root,
    statePath: path.join(root, "daemon.json"),
    logPath: path.join(root, "daemon.log")
  };
}

export async function readDaemonState() {
  const paths = resolveDaemonPaths();
  const state = await readJsonFile(paths.statePath);
  return {
    paths,
    state
  };
}

export async function removeDaemonState() {
  const { paths } = await readDaemonState();
  await rm(paths.statePath, { force: true });
  return paths;
}

export async function getDaemonStatus(options = {}) {
  const { paths, state } = await readDaemonState();

  if (!state) {
    return {
      ok: true,
      running: false,
      healthy: false,
      stale: false,
      paths,
      state: null,
      health: null
    };
  }

  const running = isProcessRunning(Number(state.pid));
  const health = running ? await fetchJson(state.serverUrl, "/api/health") : { ok: false, payload: null };
  const healthy = running && health.ok;
  const stale = !healthy;

  if (stale && options.cleanupStale) {
    await rm(paths.statePath, { force: true });
  }

  return {
    ok: true,
    running,
    healthy,
    stale,
    paths,
    state: toPublicState(state, health.payload),
    health: health.payload
  };
}

async function waitForHealthyDaemon(timeoutMs = START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;

  while (Date.now() < deadline) {
    lastStatus = await getDaemonStatus();
    if (lastStatus.healthy) {
      return lastStatus;
    }

    await delay(WAIT_INTERVAL_MS);
  }

  return lastStatus;
}

function buildSpawnArgs(options = {}) {
  const args = [
    DAEMON_BIN_PATH,
    "--host",
    options.host || DEFAULT_HOST,
    "--port",
    String(Number(options.port || DEFAULT_PORT))
  ];

  if (options.silent) {
    args.push("--silent");
  }

  return args;
}

export async function startXLoggerDaemon(options = {}) {
  const paths = resolveDaemonPaths();
  const existing = await waitForHealthyDaemon(1200);
  if (existing && existing.healthy) {
    return {
      ...existing,
      started: false
    };
  }

  await mkdir(paths.root, { recursive: true });
  await rm(paths.statePath, { force: true });

  const logFd = openSync(paths.logPath, "a");
  const child = spawn(process.execPath, buildSpawnArgs(options), {
    cwd: PACKAGE_ROOT,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: process.env
  });

  closeSync(logFd);
  child.unref();

  const status = await waitForHealthyDaemon(START_TIMEOUT_MS);
  if (status && status.healthy) {
    return {
      ...status,
      started: true
    };
  }

  const logExcerpt = await readLogExcerpt(paths.logPath);
  throw new Error(logExcerpt || `xlogger daemon did not become ready at ${paths.statePath}`);
}

export async function ensureXLoggerDaemon(options = {}) {
  const existing = await waitForHealthyDaemon(3000);
  if (existing && existing.healthy) {
    return {
      ...existing,
      started: false
    };
  }

  await removeDaemonState();
  return startXLoggerDaemon(options);
}

export async function stopXLoggerDaemon() {
  const { paths, state } = await readDaemonState();

  if (!state) {
    return {
      ok: true,
      stopped: false,
      alreadyStopped: true,
      paths,
      state: null
    };
  }

  const pid = Number(state.pid);
  if (!isProcessRunning(pid)) {
    await rm(paths.statePath, { force: true });
    return {
      ok: true,
      stopped: false,
      alreadyStopped: true,
      paths,
      state: toPublicState(state)
    };
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    await rm(paths.statePath, { force: true });
    return {
      ok: true,
      stopped: false,
      alreadyStopped: true,
      paths,
      state: toPublicState(state)
    };
  }

  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      await rm(paths.statePath, { force: true });
      return {
        ok: true,
        stopped: true,
        alreadyStopped: false,
        paths,
        state: toPublicState(state)
      };
    }

    await delay(WAIT_INTERVAL_MS);
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Ignore.
  }

  await delay(150);
  await rm(paths.statePath, { force: true });

  return {
    ok: true,
    stopped: true,
    alreadyStopped: false,
    forced: true,
    paths,
    state: toPublicState(state)
  };
}

export async function writeDaemonStateFile(options = {}, state = {}) {
  const paths = resolveDaemonPaths();
  const payload = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    host: state.host || options.host || DEFAULT_HOST,
    port: Number(state.port || options.port || DEFAULT_PORT),
    serverUrl: state.serverUrl,
    viewerUrl: state.viewerUrl || state.serverUrl,
    ...state
  };

  await writeJsonFile(paths.statePath, payload);
  return {
    paths,
    state: toPublicState(payload)
  };
}

export async function registerProjectRuntime(serverUrl, options = {}) {
  return postJson(serverUrl, "/api/runtime/register", buildRegistrationPayload(options));
}

export async function heartbeatProjectRuntime(serverUrl, options = {}) {
  return postJson(serverUrl, "/api/runtime/heartbeat", buildRegistrationPayload(options));
}

export async function unregisterProjectRuntime(serverUrl, options = {}) {
  return postJson(serverUrl, "/api/runtime/unregister", buildRegistrationPayload(options));
}

export async function getRuntimeStatus(serverUrl) {
  return fetchJson(serverUrl, "/api/runtime/status");
}

export function startRuntimeHeartbeat(serverUrl, options = {}) {
  let timer = null;
  let stopped = false;

  const tick = async () => {
    if (stopped) {
      return;
    }

    const result = await heartbeatProjectRuntime(serverUrl, options);
    if (!result.ok) {
      stopped = true;
      return;
    }

    timer = setTimeout(tick, options.heartbeatIntervalMs || HEARTBEAT_INTERVAL_MS);
  };

  timer = setTimeout(tick, options.heartbeatIntervalMs || HEARTBEAT_INTERVAL_MS);

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    }
  };
}
