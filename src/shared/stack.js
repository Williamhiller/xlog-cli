import { INTERNAL_STACK_HINTS } from "./constants.js";

const CHROME_STACK_RE = /^\s*at (?:(.*?)\s+\()?(.+):(\d+):(\d+)\)?$/;
const FIREFOX_STACK_RE = /^(.*?)@(.*):(\d+):(\d+)$/;
const MAX_CAPTURED_FRAMES = 12;

function normalizeUrl(url) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost");

    if (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "chrome-extension:" ||
      parsed.protocol === "moz-extension:" ||
      parsed.protocol === "safari-web-extension:"
    ) {
      return parsed.pathname;
    }

    return url;
  } catch {
    return url;
  }
}

export function compactFilePath(filePath) {
  if (!filePath) {
    return null;
  }

  const normalized = String(filePath).replace(/\\/g, "/");
  const anchors = ["/src/", "/app/", "/pages/", "/components/", "/packages/", "/node_modules/", "/chunks/", "/@vite/"];

  for (const anchor of anchors) {
    const index = normalized.lastIndexOf(anchor);
    if (index !== -1) {
      return normalized.slice(index + 1);
    }
  }

  return normalized.startsWith("/") ? normalized.slice(1) : normalized;
}

function shouldSkipFrame(frame, skipPatterns) {
  const haystack = `${frame.functionName || ""} ${frame.url || ""}`.toLowerCase();
  return skipPatterns.some((pattern) => haystack.includes(pattern.toLowerCase()));
}

function createFrame(functionName, url, line, column) {
  return {
    functionName: functionName || null,
    url: url || null,
    file: normalizeUrl(url),
    line: Number(line),
    column: Number(column)
  };
}

function parseStackLine(line) {
  if (!line) {
    return null;
  }

  const chromeMatch = line.match(CHROME_STACK_RE);
  if (chromeMatch) {
    return createFrame(chromeMatch[1], chromeMatch[2], chromeMatch[3], chromeMatch[4]);
  }

  const firefoxMatch = line.match(FIREFOX_STACK_RE);
  if (firefoxMatch) {
    return createFrame(firefoxMatch[1], firefoxMatch[2], firefoxMatch[3], firefoxMatch[4]);
  }

  return null;
}

function formatFrame(frame) {
  const location = [frame.file || frame.url, frame.line, frame.column].filter(Boolean).join(":");
  if (!location) {
    return "";
  }

  return frame.functionName ? `at ${frame.functionName} (${location})` : `at ${location}`;
}

function stringifyFrames(frames, truncatedCount = 0) {
  const lines = frames.map((frame) => formatFrame(frame)).filter(Boolean);

  if (truncatedCount > 0) {
    lines.push(`... ${truncatedCount} more frame${truncatedCount === 1 ? "" : "s"}`);
  }

  return lines.join("\n");
}

export function parseStack(rawStack, skipPatterns = INTERNAL_STACK_HINTS) {
  const lines = String(rawStack || "")
    .split(/\r?\n/)
    .slice(1);

  const frames = [];
  let truncatedCount = 0;
  for (const line of lines) {
    const frame = parseStackLine(line);
    if (!frame) {
      continue;
    }

    if (shouldSkipFrame(frame, skipPatterns)) {
      continue;
    }

    if (frames.length >= MAX_CAPTURED_FRAMES) {
      truncatedCount += 1;
      continue;
    }

    frames.push(frame);
  }

  return {
    raw: stringifyFrames(frames, truncatedCount),
    frames,
    truncated: truncatedCount > 0
  };
}

export function captureStack(skipPatterns = INTERNAL_STACK_HINTS) {
  const error = new Error();
  return parseStack(error.stack || "", skipPatterns);
}

export function resolveCallsite(meta, stack) {
  if (meta && typeof meta === "object" && meta.file) {
    return {
      source: "transform",
      file: compactFilePath(meta.file),
      line: Number(meta.line || 0),
      column: Number(meta.column || 0),
      functionName: meta.functionName || null,
      url: meta.url || null
    };
  }

  const frame = stack && stack.frames ? stack.frames[0] : null;
  if (!frame) {
    return null;
  }

  return {
    source: "stack",
    file: frame.file,
    line: frame.line,
    column: frame.column,
    functionName: frame.functionName,
    url: frame.url
  };
}
