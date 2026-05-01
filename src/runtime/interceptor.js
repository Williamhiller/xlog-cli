import {
  CAPTURED_CONSOLE_METHODS,
  DEFAULT_HOST,
  DEFAULT_PORT,
  INTERNAL_STACK_HINTS
} from "../shared/constants.js";
import { serializeArgs, serializeValue, argsToText } from "../shared/serialize.js";
import { captureStack, resolveCallsite } from "../shared/stack.js";
import { isToolingNoise } from "../shared/noise.js";

const GLOBAL_KEY = "__xlog_state__";
const KEEPALIVE_BODY_LIMIT = 60 * 1024;
const AUTO_INSTALL_GUARD_KEY = "__xlog_auto_installing__";
const DEFAULT_CAPTURE_TTL_MS = 5 * 60 * 1000;
const NETWORK_FAILURE_RING_SIZE = 20;
const NETWORK_FAILURE_WINDOW_MS = 5000;
const MAX_RETRY_COUNT = 5;
const RETRY_COOLDOWN_MS = 30000;
const MAX_QUEUE_SIZE = 1000;

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `xlog-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeServerUrl(input) {
  return input || `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
}

function normalizeProjectName(input) {
  if (!input) {
    return undefined;
  }

  const value = String(input).trim();
  if (!value) {
    return undefined;
  }

  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function getCaptureStorageKey(projectName) {
  return `__xlog_capture__:${String(projectName || "unknown-project").trim().toLowerCase()}`;
}

function getInstalledState() {
  return globalThis[GLOBAL_KEY] || null;
}

function setInstalledState(value) {
  if (value) {
    globalThis[GLOBAL_KEY] = value;
    return;
  }

  delete globalThis[GLOBAL_KEY];
}

function getAutoInstallGuard() {
  return globalThis[AUTO_INSTALL_GUARD_KEY] || false;
}

function setAutoInstallGuard(value) {
  if (value) {
    globalThis[AUTO_INSTALL_GUARD_KEY] = true;
    return;
  }

  delete globalThis[AUTO_INSTALL_GUARD_KEY];
}

function byteLength(value) {
  if (typeof TextEncoder === "function") {
    return new TextEncoder().encode(String(value)).length;
  }

  return String(value).length;
}

function getGlobalConfig(name) {
  return typeof globalThis[name] !== "undefined" ? globalThis[name] : undefined;
}

function getInjectedConfig(name) {
  switch (name) {
    case "__XLOG_SERVER_URL__":
      return typeof __XLOG_SERVER_URL__ !== "undefined"
        ? __XLOG_SERVER_URL__
        : undefined;
    case "__XLOG_PROJECT_NAME__":
      return typeof __XLOG_PROJECT_NAME__ !== "undefined"
        ? __XLOG_PROJECT_NAME__
        : undefined;
    case "__XLOG_TOOL__":
      return typeof __XLOG_TOOL__ !== "undefined"
        ? __XLOG_TOOL__
        : undefined;
    case "__XLOG_SOURCE__":
      return typeof __XLOG_SOURCE__ !== "undefined"
        ? __XLOG_SOURCE__
        : undefined;
    default:
      return undefined;
  }
}

function getResolvedConfig(name) {
  return getInjectedConfig(name) ?? getGlobalConfig(name);
}

function hasRuntimeScope() {
  return typeof window !== "undefined" || typeof self !== "undefined";
}

function normalizeSource(input) {
  const value = String(input || "").trim().toLowerCase();
  return value || null;
}

function detectRuntimeSource(explicitSource) {
  const source = normalizeSource(explicitSource);
  if (source) {
    return source;
  }

  const pathname = typeof location !== "undefined" ? String(location.pathname || "").toLowerCase() : "";

  if (typeof window === "undefined") {
    if (pathname.includes("background")) {
      return "background";
    }

    return "worker";
  }

  if (pathname.includes("sidepanel")) {
    return "sidepanel";
  }

  if (pathname.includes("popup")) {
    return "popup";
  }

  if (pathname.includes("options")) {
    return "options";
  }

  if (pathname.includes("dashboard")) {
    return "dashboard";
  }

  if (pathname.includes("content")) {
    return "content";
  }

  if (typeof document !== "undefined" && document.title) {
    return "page";
  }

  return "page";
}

function getExtensionStorageArea() {
  if (globalThis.browser?.storage?.session) {
    return {
      area: globalThis.browser.storage.session,
      mode: "promise"
    };
  }

  if (globalThis.chrome?.storage?.session) {
    return {
      area: globalThis.chrome.storage.session,
      mode: "callback"
    };
  }

  if (globalThis.browser?.storage?.local) {
    return {
      area: globalThis.browser.storage.local,
      mode: "promise"
    };
  }

  if (globalThis.chrome?.storage?.local) {
    return {
      area: globalThis.chrome.storage.local,
      mode: "callback"
    };
  }

  return null;
}

async function readSharedCapture(key) {
  const storage = getExtensionStorageArea();

  if (storage) {
    try {
      if (storage.mode === "promise") {
        const result = await storage.area.get(key);
        return result ? result[key] || null : null;
      }

      return await new Promise((resolve) => {
        storage.area.get(key, (result) => {
          resolve(result ? result[key] || null : null);
        });
      });
    } catch {
      return null;
    }
  }

  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  return null;
}

async function writeSharedCapture(key, value) {
  const storage = getExtensionStorageArea();

  if (storage) {
    try {
      if (storage.mode === "promise") {
        await storage.area.set({ [key]: value });
        return true;
      }

      await new Promise((resolve, reject) => {
        storage.area.set({ [key]: value }, () => {
          const error = globalThis.chrome?.runtime?.lastError;
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      return true;
    } catch {
      return false;
    }
  }

  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

async function readCapture(projectName) {
  return await readSharedCapture(getCaptureStorageKey(projectName));
}

async function writeCapture(projectName, value) {
  await writeSharedCapture(getCaptureStorageKey(projectName), value);
}

function isCaptureActive(capture, nowMs, ttlMs) {
  if (!capture || !capture.id) {
    return false;
  }

  const updatedAtMs = Number(capture.updatedAtMs || 0);
  if (!updatedAtMs) {
    return false;
  }

  return nowMs - updatedAtMs <= ttlMs;
}

function assignCapture(state, capture) {
  state.captureId = capture?.id || null;
  state.captureStartedAt = capture?.startedAt || null;
  state.captureUpdatedAtMs = Number(capture?.updatedAtMs || 0) || 0;
}

async function resolveSharedCapture(state, { forceRotate = false } = {}) {
  const nowMs = Date.now();
  const existing = await readCapture(state.projectName);

  if (!forceRotate && isCaptureActive(existing, nowMs, state.captureTtlMs)) {
    assignCapture(state, existing);
    return existing;
  }

  const candidate = {
    id: createId(),
    startedAt: new Date(nowMs).toISOString(),
    updatedAtMs: nowMs,
    projectName: state.projectName
  };

  await writeCapture(state.projectName, candidate);
  const stored = (await readCapture(state.projectName)) || candidate;
  assignCapture(state, stored);
  return stored;
}

async function ensureCapture(state) {
  const nowMs = Date.now();

  if (state.captureId && nowMs - state.captureUpdatedAtMs <= state.captureTtlMs) {
    const updatedCapture = {
      id: state.captureId,
      startedAt: state.captureStartedAt || new Date(nowMs).toISOString(),
      updatedAtMs: nowMs,
      projectName: state.projectName
    };

    assignCapture(state, updatedCapture);
    await writeCapture(state.projectName, updatedCapture);
    return updatedCapture;
  }

  return resolveSharedCapture(state, {
    forceRotate: Boolean(state.captureId)
  });
}

function buildPageMeta() {
  const hasLocation = typeof location !== "undefined";
  const hasDocument = typeof document !== "undefined";
  const hasNavigator = typeof navigator !== "undefined";

  if (!hasLocation && !hasDocument && !hasNavigator) {
    return {};
  }

  return {
    url: hasLocation ? location.href : null,
    origin: hasLocation ? location.origin : null,
    title: hasDocument ? document.title : null,
    referrer: hasDocument ? document.referrer : null,
    userAgent: hasNavigator ? navigator.userAgent : null
  };
}

function getDefaultProjectName() {
  if (typeof document !== "undefined" && document.title) {
    return normalizeProjectName(document.title) || document.title;
  }

  if (typeof location !== "undefined" && location.pathname) {
    const lastSegment = location.pathname.split("/").filter(Boolean).pop();
    if (lastSegment) {
      return normalizeProjectName(lastSegment) || lastSegment;
    }
  }

  return "unknown-project";
}

function inferProjectNameFromMetaFile(file) {
  if (!file || typeof file !== "string") {
    return undefined;
  }

  const normalized = file.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  const srcIndex = segments.lastIndexOf("src");

  if (srcIndex > 0) {
    return normalizeProjectName(segments[srcIndex - 1]) || undefined;
  }

  const fallback = segments.length > 1 ? segments[segments.length - 2] : segments[0];
  return normalizeProjectName(fallback) || undefined;
}

function hasSerializableStack(value, seen = new WeakSet(), depth = 0) {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (typeof value.stack === "string" && value.stack.trim()) {
    return true;
  }

  if (depth >= 2 || seen.has(value)) {
    return false;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => hasSerializableStack(item, seen, depth + 1));
  }

  for (const key of Object.keys(value).slice(0, 8)) {
    try {
      if (hasSerializableStack(value[key], seen, depth + 1)) {
        return true;
      }
    } catch {
      // Ignore getters that throw.
    }
  }

  return false;
}

function shouldPersistCapturedStack(args, stack) {
  if (!stack || !Array.isArray(stack.frames) || !stack.frames.length) {
    return false;
  }

  return !args.some((arg) => hasSerializableStack(arg));
}

function buildPayload(state, logs) {
  return {
    project: {
      name: state.projectName,
      tool: state.tool
    },
    source: state.source,
    capture: state.captureId
      ? {
          id: state.captureId,
          startedAt: state.captureStartedAt || state.startedAt
        }
      : null,
    session: {
      id: state.sessionId,
      startedAt: state.startedAt
    },
    page: buildPageMeta(),
    logs
  };
}

function nowTimestamp() {
  const value = Date.now();

  return {
    iso: new Date(value).toISOString(),
    ms: value
  };
}

function maybeAutoInstallFromConsole(meta) {
  if (getInstalledState() || getAutoInstallGuard()) {
    return getInstalledState();
  }

  setAutoInstallGuard(true);

  try {
    const inferredProjectName =
      getResolvedConfig("__XLOG_PROJECT_NAME__") || inferProjectNameFromMetaFile(meta?.file);

    installXLog({
      serverUrl: getResolvedConfig("__XLOG_SERVER_URL__"),
      projectName: inferredProjectName,
      tool: getResolvedConfig("__XLOG_TOOL__")
    });
  } catch {
    // Fall through to the native console path below.
  } finally {
    setAutoInstallGuard(false);
  }

  return getInstalledState();
}

export function xlogConsole(level, meta, ...args) {
  const state = getInstalledState() || maybeAutoInstallFromConsole(meta);

  if (state && typeof state.captureEntry === "function") {
    return state.captureEntry({
      level,
      method: level,
      kind: "console",
      args,
      meta,
      echoConsole: true
    });
  }

  const fallback = console[level] || console.log;
  return fallback.apply(console, args);
}

function createNetworkRingBuffer() {
  const buffer = [];
  return {
    push(entry) {
      buffer.push(entry);
      if (buffer.length > NETWORK_FAILURE_RING_SIZE) {
        buffer.shift();
      }
    },
    getRecentFailures() {
      const cutoff = Date.now() - NETWORK_FAILURE_WINDOW_MS;
      return buffer.filter((e) => e.occurredAtMs >= cutoff && e.failed);
    },
    getAll() {
      return buffer.slice();
    }
  };
}

function interceptFetch(state) {
  if (typeof globalThis.fetch !== "function") return;

  const originalFetch = globalThis.fetch.bind(globalThis);
  state.originalFetch = originalFetch;

  globalThis.fetch = async (...args) => {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || String(args[0]);
    const method = args[1]?.method || "GET";
    const startMs = Date.now();

    try {
      const response = await originalFetch(...args);
      const durationMs = Date.now() - startMs;

      if (!response.ok) {
        state.networkFailures.push({
          url: url.slice(0, 200),
          method,
          status: response.status,
          statusText: response.statusText,
          durationMs,
          failed: true,
          occurredAtMs: Date.now()
        });
      }

      return response;
    } catch (err) {
      state.networkFailures.push({
        url: url.slice(0, 200),
        method,
        status: 0,
        statusText: err.message || "Network Error",
        durationMs: Date.now() - startMs,
        failed: true,
        occurredAtMs: Date.now()
      });
      throw err;
    }
  };
}

function interceptXHR(state) {
  if (typeof XMLHttpRequest === "undefined") return;

  const OriginalXHR = XMLHttpRequest;
  state.OriginalXHR = OriginalXHR;

  function PatchedXHR() {
    const xhr = new OriginalXHR();
    const originalOpen = xhr.open.bind(xhr);
    const originalSend = xhr.send.bind(xhr);

    let method = "";
    let url = "";
    let startMs = 0;

    xhr.open = (m, u, ...rest) => {
      method = m;
      url = typeof u === "string" ? u : String(u);
      return originalOpen(m, u, ...rest);
    };

    xhr.send = (...args) => {
      startMs = Date.now();

      xhr.addEventListener("loadend", () => {
        const durationMs = Date.now() - startMs;
        const failed = xhr.status === 0 || xhr.status >= 400;

        if (failed) {
          state.networkFailures.push({
            url: url.slice(0, 200),
            method,
            status: xhr.status,
            statusText: xhr.statusText,
            durationMs,
            failed: true,
            occurredAtMs: Date.now()
          });
        }
      });

      return originalSend(...args);
    };

    return xhr;
  }

  PatchedXHR.prototype = OriginalXHR.prototype;
  PatchedXHR.UNSENT = 0;
  PatchedXHR.OPENED = 1;
  PatchedXHR.HEADERS_RECEIVED = 2;
  PatchedXHR.LOADING = 3;
  PatchedXHR.DONE = 4;

  globalThis.XMLHttpRequest = PatchedXHR;
}

export function installXLog(options = {}) {
  if (!hasRuntimeScope() || typeof console === "undefined") {
    return {
      flush: async () => {},
      uninstall: () => {},
      getState: () => null
    };
  }

  if (getInstalledState() && getInstalledState().installed) {
    return getInstalledState().api;
  }

  const startedAt = new Date().toISOString();
  const state = {
    installed: true,
    startedAt,
    sessionId: options.sessionId || createId(),
    captureId: null,
    captureStartedAt: null,
    captureUpdatedAtMs: 0,
    captureTtlMs: Number(options.captureTtlMs || DEFAULT_CAPTURE_TTL_MS),
    source: detectRuntimeSource(
      options.source || getResolvedConfig("__XLOG_SOURCE__")
    ),
    projectName:
      normalizeProjectName(options.projectName) ||
      normalizeProjectName(getResolvedConfig("__XLOG_PROJECT_NAME__")) ||
      getDefaultProjectName(),
    tool:
      options.tool ||
      getResolvedConfig("__XLOG_TOOL__") ||
      (typeof document !== "undefined" ? "browser" : "worker"),
    serverUrl: normalizeServerUrl(
      options.serverUrl || getResolvedConfig("__XLOG_SERVER_URL__")
    ),
    flushInterval: Number(options.flushInterval || 500),
    maxBatchSize: Number(options.maxBatchSize || 20),
    maxQueueSize: Number(options.maxQueueSize || MAX_QUEUE_SIZE),
    originalConsole: {},
    queue: [],
    sequence: 0,
    flushing: false,
    flushTimer: null,
    listeners: [],
    loggingDisabled: false,
    loggingDisabledAt: null,
    retryCount: 0,
    retryTimer: null,
    networkFailures: createNetworkRingBuffer()
  };

  state.captureReady = resolveSharedCapture(state);

  // Intercept network requests to correlate with errors
  interceptFetch(state);
  interceptXHR(state);

  function trimQueue(currentState) {
    if (currentState.queue.length > currentState.maxQueueSize) {
      currentState.queue.splice(0, currentState.queue.length - currentState.maxQueueSize);
    }
  }

  function handleFlushFailure(currentState, failedLogs = []) {
    currentState.retryCount += 1;

    if (failedLogs.length) {
      currentState.queue.unshift(...failedLogs);
      trimQueue(currentState);
    }

    if (currentState.retryCount < MAX_RETRY_COUNT) {
      // Will retry on next flush cycle
      return;
    }

    // Disable temporarily, then re-enable after cooldown
    currentState.loggingDisabled = true;
    currentState.loggingDisabledAt = new Date().toISOString();
    trimQueue(currentState);

    if (!currentState.retryTimer && typeof globalThis.setTimeout === "function") {
      currentState.retryTimer = globalThis.setTimeout(() => {
        currentState.retryTimer = null;
        currentState.loggingDisabled = false;
        currentState.loggingDisabledAt = null;
        currentState.retryCount = 0;
      }, RETRY_COOLDOWN_MS);
    }
  }

  function scheduleFlush() {
    if (state.loggingDisabled) {
      state.queue.length = 0;
      return;
    }

    if (state.flushTimer) {
      return;
    }

    if (typeof globalThis.setTimeout !== "function") {
      void flush();
      return;
    }

    state.flushTimer = globalThis.setTimeout(() => {
      state.flushTimer = null;
      void flush();
    }, state.flushInterval);
  }

  async function flush({ beacon = false } = {}) {
    if (state.loggingDisabled) {
      state.queue.length = 0;
      return;
    }

    if (!state.queue.length || state.flushing) {
      return;
    }

    state.flushing = true;
    await state.captureReady;
    await ensureCapture(state);
    const logs = state.queue.splice(0, state.maxBatchSize);
    const payload = buildPayload(state, logs);
    const endpoint = new URL("/api/x-log", state.serverUrl).toString();
    const body = JSON.stringify(payload);

    try {
      if (beacon && typeof navigator.sendBeacon === "function") {
        const blob = new Blob([body], { type: "application/json" });
        const sent = navigator.sendBeacon(endpoint, blob);

        if (!sent) {
          handleFlushFailure(state, logs);
        }
      } else {
        const canUseKeepalive =
          beacon &&
          typeof navigator !== "undefined" &&
          byteLength(body) <= KEEPALIVE_BODY_LIMIT;
        const response = await fetch(endpoint, {
          method: "POST",
          mode: "cors",
          keepalive: canUseKeepalive,
          headers: {
            "content-type": "application/json"
          },
          body
        });

        if (!response.ok) {
          handleFlushFailure(state, logs);
        } else {
          // Success — reset retry count
          state.retryCount = 0;
        }
      }
    } catch {
      handleFlushFailure(state, logs);
    } finally {
      state.flushing = false;

      if (state.queue.length) {
        scheduleFlush();
      }
    }
  }

  function enqueue(record) {
    if (state.loggingDisabled) {
      return;
    }

    state.queue.push(record);
    trimQueue(state);

    if (state.source === "background" || state.source === "worker") {
      void flush();
      return;
    }

    if (state.queue.length >= state.maxBatchSize) {
      void flush();
      return;
    }

    scheduleFlush();
  }

  function captureEntry({
    level,
    method = level,
    kind = "console",
    args = [],
    meta = null,
    echoConsole = false,
    extra = {}
  }) {
    if (echoConsole) {
      const original = state.originalConsole[method] || state.originalConsole[level] || console.log;
      original.apply(console, args);
    }

    const stack = captureStack(INTERNAL_STACK_HINTS);
    const callsite = resolveCallsite(meta, stack);
    const persistedStack = shouldPersistCapturedStack(args, stack) ? stack : null;
    const timestamp = nowTimestamp();

    // Attach recent network failures to error-level records
    const enrichedExtra = extra;
    if ((level === "error" || kind === "window.error" || kind === "unhandledrejection") && state.networkFailures) {
      const recentFailures = state.networkFailures.getRecentFailures();
      if (recentFailures.length > 0) {
        enrichedExtra.networkFailures = recentFailures;
      }
    }

    const record = {
      kind,
      level: level || "log",
      method,
      source: state.source,
      sequence: (state.sequence += 1),
      occurredAt: timestamp.iso,
      occurredAtMs: timestamp.ms,
      receivedAt: timestamp.iso,
      receivedAtMs: timestamp.ms,
      args: serializeArgs(args),
      text: argsToText(args),
      callsite,
      stack: persistedStack,
      tags: ["browser", state.source && `source:${state.source}`, kind, method].filter(Boolean),
      extra: enrichedExtra
    };

    if (isToolingNoise(record)) {
      return record;
    }

    enqueue(record);
    return record;
  }

  state.captureEntry = captureEntry;

  for (const method of CAPTURED_CONSOLE_METHODS) {
    if (typeof console[method] !== "function") {
      continue;
    }

    state.originalConsole[method] = console[method].bind(console);

    console[method] = (...args) => {
      if (method === "assert" && args[0]) {
        return state.originalConsole.assert(...args);
      }

      return captureEntry({
        level: method === "assert" ? "error" : method,
        method,
        kind: "console",
        args,
        echoConsole: true
      });
    };
  }

  const onError = (event) => {
    captureEntry({
      level: "error",
      method: "error",
      kind: "window.error",
      args: [
        event.message,
        event.error ||
          {
            name: "ErrorEvent",
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno
          }
      ],
      echoConsole: false,
      extra: {
        filename: event.filename || null,
        line: event.lineno || null,
        column: event.colno || null
      }
    });
  };

  const onUnhandledRejection = (event) => {
    captureEntry({
      level: "error",
      method: "error",
      kind: "unhandledrejection",
      args: [event.reason],
      echoConsole: false,
      extra: {
        reason: serializeValue(event.reason)
      }
    });
  };

  const onPageHide = () => {
    void flush({ beacon: true });
  };

  const runtimeTarget =
    typeof globalThis.addEventListener === "function" &&
    typeof globalThis.removeEventListener === "function"
      ? globalThis
      : null;

  if (runtimeTarget) {
    runtimeTarget.addEventListener("error", onError);
    runtimeTarget.addEventListener("unhandledrejection", onUnhandledRejection);
    state.listeners.push([runtimeTarget, "error", onError]);
    state.listeners.push([runtimeTarget, "unhandledrejection", onUnhandledRejection]);
  }

  const pageTarget =
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function" &&
    typeof window.removeEventListener === "function"
      ? window
      : null;

  if (pageTarget) {
    pageTarget.addEventListener("pagehide", onPageHide);
    pageTarget.addEventListener("beforeunload", onPageHide);
    state.listeners.push([pageTarget, "pagehide", onPageHide]);
    state.listeners.push([pageTarget, "beforeunload", onPageHide]);
  }

  const api = {
    flush,
    uninstall() {
      for (const [target, eventName, listener] of state.listeners) {
        target.removeEventListener(eventName, listener);
      }

      for (const method of Object.keys(state.originalConsole)) {
        console[method] = state.originalConsole[method];
      }

      // Restore network interceptors
      if (state.originalFetch) {
        globalThis.fetch = state.originalFetch;
      }
      if (state.OriginalXHR) {
        globalThis.XMLHttpRequest = state.OriginalXHR;
      }

      if (state.flushTimer) {
        if (typeof globalThis.clearTimeout === "function") {
          globalThis.clearTimeout(state.flushTimer);
        }
      }

      if (state.retryTimer) {
        if (typeof globalThis.clearTimeout === "function") {
          globalThis.clearTimeout(state.retryTimer);
        }
      }

      setInstalledState(null);
    },
    getState() {
      return {
        captureId: state.captureId,
        sessionId: state.sessionId,
        source: state.source,
        projectName: state.projectName,
        tool: state.tool,
        serverUrl: state.serverUrl,
        queued: state.queue.length,
        loggingDisabled: state.loggingDisabled,
        loggingDisabledAt: state.loggingDisabledAt,
        retryCount: state.retryCount,
        recentNetworkFailures: state.networkFailures ? state.networkFailures.getRecentFailures().length : 0
      };
    }
  };

  state.api = api;
  setInstalledState(state);
  return api;
}
