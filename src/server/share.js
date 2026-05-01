import { groupRecordsIntoCaptures } from "./captures.js";
import { toEpochMs } from "../shared/time.js";
import { isToolingNoise as _isToolingNoise } from "../shared/noise.js";

const DEFAULT_LIMITS = {
  keyLogLimit: 18,
  maxTextLength: 280,
  maxArgsLength: 220,
  maxStackLines: 4,
  maxStackLineLength: 180
};

const MCP_LIMITS = {
  keyLogLimit: 30,
  maxTextLength: 600,
  maxArgsLength: 500,
  maxStackLines: 8,
  maxStackLineLength: 300
};

export const PROFILES = { default: DEFAULT_LIMITS, mcp: MCP_LIMITS };

function getLimits(profile) {
  return PROFILES[profile] || DEFAULT_LIMITS;
}

function truncateText(value, limit) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export const isToolingNoise = _isToolingNoise;

function compareLogsAsc(left, right) {
  const timeDelta =
    (Number(left.occurredAtMs || 0) || toEpochMs(left.occurredAt)) -
    (Number(right.occurredAtMs || 0) || toEpochMs(right.occurredAt));

  if (timeDelta !== 0) {
    return timeDelta;
  }

  return Number(left.sequence || 0) - Number(right.sequence || 0);
}

export function scoreLog(log) {
  const level = String(log?.level || "").toLowerCase();
  const kind = String(log?.kind || "").toLowerCase();
  const text = String(log?.text || "").toLowerCase();
  let score = 0;

  if (kind === "window.error" || kind === "unhandledrejection") {
    score += 120;
  }

  if (level === "error") {
    score += 100;
  } else if (level === "warn") {
    score += 70;
  } else if (level === "info") {
    score += 16;
  } else if (level === "debug" || level === "trace") {
    score += 10;
  } else if (level === "log") {
    score += 8;
  }

  if (Array.isArray(log?.args) && log.args.some((arg) => arg?.type === "error")) {
    score += 35;
  }

  if (Array.isArray(log?.stack?.frames) && log.stack.frames.length) {
    score += 24;
  }

  if (/error|fail|failed|exception|reject|cannot|undefined|missing/i.test(text)) {
    score += 18;
  }

  if (isToolingNoise(log)) {
    score -= 60;
  }

  return score;
}

function addSelectedIndex(selected, index, priority, total) {
  if (index < 0 || index >= total) {
    return;
  }

  const current = selected.get(index) || -Infinity;
  if (priority > current) {
    selected.set(index, priority);
  }
}

function addContextWindow(selected, centerIndex, radius, basePriority, total) {
  for (let offset = -radius; offset <= radius; offset += 1) {
    const index = centerIndex + offset;
    const priority = basePriority - Math.abs(offset) * 6;
    addSelectedIndex(selected, index, priority, total);
  }
}

function selectKeyLogs(logs, limits) {
  if (!Array.isArray(logs) || !logs.length) {
    return [];
  }

  const keyLogLimit = limits.keyLogLimit;
  const scored = logs.map((log, index) => ({
    log,
    index,
    score: scoreLog(log)
  }));
  const selected = new Map();
  const total = logs.length;

  addSelectedIndex(selected, 0, 55, total);
  if (total > 1) {
    addSelectedIndex(selected, total - 1, 55, total);
  }

  for (const item of scored) {
    if (item.score >= 100) {
      addContextWindow(selected, item.index, 1, item.score + 20, total);
    } else if (item.score >= 70) {
      addSelectedIndex(selected, item.index, item.score, total);
    }
  }

  if (selected.size < keyLogLimit) {
    const remaining = scored
      .filter((item) => !selected.has(item.index) && item.score > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index);

    for (const item of remaining) {
      addSelectedIndex(selected, item.index, item.score, total);
      if (selected.size >= keyLogLimit) {
        break;
      }
    }
  }

  return [...selected.entries()]
    .map(([index, priority]) => ({
      index,
      priority,
      score: scored[index]?.score || 0
    }))
    .sort((left, right) => right.priority - left.priority || right.score - left.score || left.index - right.index)
    .slice(0, keyLogLimit)
    .sort((left, right) => left.index - right.index)
    .map((item) => logs[item.index]);
}

function compactLocation(callsite) {
  if (!callsite || typeof callsite !== "object" || !callsite.file) {
    return "";
  }

  return [callsite.file, callsite.line, callsite.column].filter(Boolean).join(":");
}

function summarizeSerializedValue(value, depth = 0) {
  if (!value || typeof value !== "object") {
    return truncateText(String(value ?? ""), 60);
  }

  switch (value.type) {
    case "string":
      return `"${truncateText(value.value, depth === 0 ? 80 : 36)}"`;
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
    case "regexp":
    case "url":
      return String(value.value);
    case "undefined":
      return "undefined";
    case "null":
      return "null";
    case "function":
      return `fn ${value.name || "anonymous"}`;
    case "date":
      return String(value.value || "Invalid Date");
    case "error":
      return truncateText(`${value.name || "Error"}: ${value.message || ""}`.trim(), 100);
    case "array":
      return `Array(${Array.isArray(value.items) ? value.items.length : 0})`;
    case "object":
      return value.ctor && value.ctor !== "Object" ? `${value.ctor}` : "Object";
    case "map":
      return `Map(${value.size ?? 0})`;
    case "set":
      return `Set(${value.size ?? 0})`;
    case "typed-array":
      return `${value.ctor || "TypedArray"}(${value.length ?? 0})`;
    case "array-buffer":
      return `ArrayBuffer(${value.byteLength ?? 0})`;
    case "dom":
      return `<${String(value.tagName || "element").toLowerCase()}>`;
    default:
      return truncateText(value.value || value.name || value.ctor || value.type || "value", 80);
  }
}

function summarizeArgs(args, messageText = "", limits) {
  if (!Array.isArray(args) || !args.length) {
    return "";
  }

  const preview = args
    .slice(0, 3)
    .map((item) => summarizeSerializedValue(item))
    .filter(Boolean)
    .join(" ");

  const normalizedMessage = String(messageText || "").trim();
  const normalizedPreview = preview.replace(/^"(.*)"$/, "$1").trim();
  if (!preview || (normalizedMessage && normalizedPreview === normalizedMessage)) {
    return "";
  }

  return truncateText(preview, limits.maxArgsLength);
}

function findSerializedErrorStack(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") {
    return "";
  }

  if (seen.has(value)) {
    return "";
  }

  seen.add(value);

  if (value.type === "error" && typeof value.stack === "string" && value.stack.trim()) {
    return value.stack.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findSerializedErrorStack(item, seen);
      if (nested) {
        return nested;
      }
    }

    return "";
  }

  for (const nestedValue of Object.values(value)) {
    const nested = findSerializedErrorStack(nestedValue, seen);
    if (nested) {
      return nested;
    }
  }

  return "";
}

function compactStackLines(input, limits) {
  const lines = String(input || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limits.maxStackLines)
    .map((line) => truncateText(line, limits.maxStackLineLength));

  return lines.length ? lines : null;
}

function buildStackPreview(log, limits) {
  const errorStack =
    findSerializedErrorStack(log?.args) || findSerializedErrorStack(log?.extra);

  if (errorStack) {
    return compactStackLines(errorStack, limits);
  }

  if (Array.isArray(log?.stack?.frames) && log.stack.frames.length) {
    return compactStackLines(
      log.stack.frames
        .slice(0, limits.maxStackLines)
        .map((frame) => {
          const location = [frame.file || frame.url, frame.line, frame.column].filter(Boolean).join(":");
          return frame.functionName ? `at ${frame.functionName} (${location})` : `at ${location}`;
        })
        .join("\n"),
      limits
    );
  }

  return null;
}

export function compactShareLog(log, { includeSessionId = false, limits = DEFAULT_LIMITS } = {}) {
  const output = {
    ts: log.occurredAt,
    lvl: log.level,
    kind: log.kind,
    src: log.source || null,
    msg: truncateText(log.text, limits.maxTextLength)
  };

  if (log.sequence) {
    output.seq = log.sequence;
  }

  const location = compactLocation(log.callsite);
  if (location) {
    output.site = location;
  }

  if (log?.callsite?.functionName) {
    output.fn = truncateText(log.callsite.functionName, 80);
  }

  const argsPreview = summarizeArgs(log.args, log.text, limits);
  if (argsPreview) {
    output.args = argsPreview;
  }

  const stackPreview = buildStackPreview(log, limits);
  if (stackPreview) {
    output.stack = stackPreview;
  }

  if (includeSessionId && log?.session?.id) {
    output.session = log.session.id;
  }

  if (Array.isArray(log?.extra?.networkFailures) && log.extra.networkFailures.length) {
    output.net = log.extra.networkFailures.slice(0, 3).map((nf) => ({
      url: nf.url,
      status: nf.status,
      method: nf.method
    }));
  }

  if (isToolingNoise(log)) {
    output.noise = true;
  }

  return output;
}

function compactCapture(capture, totalLogs, sharedLogs) {
  const output = {
    id: capture?.id || "capture",
    project: capture?.project?.name || "unknown-project",
    tool: capture?.project?.tool || "browser",
    startedAt: capture?.startedAt || capture?.firstSeen || null,
    firstSeen: capture?.firstSeen || null,
    lastSeen: capture?.lastSeen || null,
    totalLogs: Number(capture?.count || totalLogs || 0),
    sharedLogs,
    sessionCount: Number(capture?.sessionCount || 0),
    levels: capture?.levels || {},
    kinds: Array.isArray(capture?.kinds) ? capture.kinds : []
  };

  const pages = Array.isArray(capture?.pageTitles)
    ? capture.pageTitles.filter(Boolean).slice(0, 2)
    : [];
  if (pages.length) {
    output.pages = pages;
  }

  return output;
}

function sanitizeFileName(value) {
  return String(value || "capture")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "capture";
}

export function buildCaptureSharePayload({ capture = null, logs = [], profile = "default" } = {}) {
  const limits = getLimits(profile);
  const sortedLogs = [...logs].filter(Boolean).sort(compareLogsAsc);
  const captureSummary = capture || groupRecordsIntoCaptures(sortedLogs)[0] || null;
  const includeSessionId = Number(captureSummary?.sessionCount || 0) > 1;
  const keyLogs = selectKeyLogs(sortedLogs, limits).map((log) =>
    compactShareLog(log, { includeSessionId, limits })
  );

  return {
    v: 1,
    type: "xlog.capture.share",
    capture: compactCapture(captureSummary, sortedLogs.length, keyLogs.length),
    keyLogs
  };
}

export function buildCaptureShareFileName(capture) {
  const projectName = sanitizeFileName(capture?.project?.name || capture?.project || "xlog");
  const captureId = sanitizeFileName(capture?.id || "capture");
  return `${projectName}-${captureId}.json`;
}
