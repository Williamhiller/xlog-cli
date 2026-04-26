const MAX_DEPTH = 4;
const MAX_ITEMS = 24;
const MAX_TEXT_LENGTH = 6000;

function isObjectLike(value) {
  return value !== null && typeof value === "object";
}

function truncateText(value, limit = MAX_TEXT_LENGTH) {
  if (typeof value !== "string") {
    return value;
  }

  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function readProperty(target, key) {
  try {
    return {
      ok: true,
      value: target[key]
    };
  } catch (error) {
    return {
      ok: false,
      error
    };
  }
}

function serializeError(error, depth, seen) {
  const props = {};

  for (const key of Object.keys(error)) {
    const result = readProperty(error, key);
    props[key] = result.ok
      ? serializeValue(result.value, depth + 1, seen)
      : {
          type: "thrown",
          value: truncateText(String(result.error))
        };
  }

  return {
    type: "error",
    name: error.name,
    message: error.message,
    stack: truncateText(error.stack || ""),
    props
  };
}

function serializeEntries(entries, depth, seen) {
  const output = [];
  let count = 0;

  for (const [key, value] of entries) {
    if (count >= MAX_ITEMS) {
      break;
    }

    output.push({
      key: String(key),
      value: serializeValue(value, depth + 1, seen)
    });
    count += 1;
  }

  return {
    items: output,
    truncated: count >= MAX_ITEMS
  };
}

export function serializeValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null) {
    return { type: "null", value: null };
  }

  const valueType = typeof value;

  if (valueType === "string") {
    return { type: "string", value: truncateText(value) };
  }

  if (valueType === "number") {
    if (Number.isNaN(value)) {
      return { type: "number", value: "NaN" };
    }

    if (!Number.isFinite(value)) {
      return { type: "number", value: String(value) };
    }

    return { type: "number", value };
  }

  if (valueType === "boolean") {
    return { type: "boolean", value };
  }

  if (valueType === "undefined") {
    return { type: "undefined" };
  }

  if (valueType === "bigint") {
    return { type: "bigint", value: value.toString() };
  }

  if (valueType === "symbol") {
    return { type: "symbol", value: String(value) };
  }

  if (valueType === "function") {
    return {
      type: "function",
      name: value.name || "anonymous"
    };
  }

  if (depth >= MAX_DEPTH) {
    return {
      type: "summary",
      ctor: value && value.constructor ? value.constructor.name : "Object",
      value: truncateText(String(value))
    };
  }

  if (isObjectLike(value)) {
    if (seen.has(value)) {
      return {
        type: "circular",
        ctor: value.constructor ? value.constructor.name : "Object"
      };
    }

    seen.add(value);
  }

  if (value instanceof Error) {
    return serializeError(value, depth, seen);
  }

  if (value instanceof Date) {
    return { type: "date", value: value.toISOString() };
  }

  if (value instanceof RegExp) {
    return { type: "regexp", value: String(value) };
  }

  if (typeof URL !== "undefined" && value instanceof URL) {
    return { type: "url", value: value.toString() };
  }

  if (typeof Element !== "undefined" && value instanceof Element) {
    return {
      type: "dom",
      tagName: value.tagName,
      id: value.id || null,
      className: value.className || null,
      text: truncateText(value.textContent || "", 240)
    };
  }

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      items: value.slice(0, MAX_ITEMS).map((item) => serializeValue(item, depth + 1, seen)),
      truncated: value.length > MAX_ITEMS
    };
  }

  if (value instanceof Map) {
    const entries = serializeEntries(value.entries(), depth, seen);
    return {
      type: "map",
      size: value.size,
      entries: entries.items,
      truncated: entries.truncated
    };
  }

  if (value instanceof Set) {
    return {
      type: "set",
      size: value.size,
      values: Array.from(value.values())
        .slice(0, MAX_ITEMS)
        .map((item) => serializeValue(item, depth + 1, seen)),
      truncated: value.size > MAX_ITEMS
    };
  }

  if (ArrayBuffer.isView(value)) {
    const preview = Array.from(value instanceof DataView ? [] : value).slice(0, MAX_ITEMS);
    return {
      type: "typed-array",
      ctor: value.constructor ? value.constructor.name : "TypedArray",
      length: "length" in value ? value.length : value.byteLength,
      preview
    };
  }

  if (value instanceof ArrayBuffer) {
    return {
      type: "array-buffer",
      byteLength: value.byteLength
    };
  }

  const ctor = value && value.constructor ? value.constructor.name : "Object";
  const keys = Object.keys(value);
  const entries = keys.slice(0, MAX_ITEMS).map((key) => {
    const result = readProperty(value, key);
    return {
      key,
      value: result.ok
        ? serializeValue(result.value, depth + 1, seen)
        : {
            type: "thrown",
            value: truncateText(String(result.error))
          }
    };
  });

  return {
    type: "object",
    ctor,
    entries,
    truncated: keys.length > MAX_ITEMS
  };
}

export function stringifyForSearch(value, depth = 0, seen = new WeakSet()) {
  if (value === null) {
    return "null";
  }

  const valueType = typeof value;

  if (valueType === "string") {
    return truncateText(value);
  }

  if (valueType === "number" || valueType === "boolean" || valueType === "bigint") {
    return String(value);
  }

  if (valueType === "undefined") {
    return "undefined";
  }

  if (valueType === "symbol") {
    return String(value);
  }

  if (valueType === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }

  if (value instanceof Error) {
    return truncateText(`${value.name}: ${value.message} ${value.stack || ""}`);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof RegExp) {
    return String(value);
  }

  if (depth >= MAX_DEPTH) {
    return truncateText(String(value));
  }

  if (isObjectLike(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ITEMS)
      .map((item) => stringifyForSearch(item, depth + 1, seen))
      .join(" ");
  }

  if (value instanceof Map) {
    return Array.from(value.entries())
      .slice(0, MAX_ITEMS)
      .map(([key, item]) => `${key}:${stringifyForSearch(item, depth + 1, seen)}`)
      .join(" ");
  }

  if (value instanceof Set) {
    return Array.from(value.values())
      .slice(0, MAX_ITEMS)
      .map((item) => stringifyForSearch(item, depth + 1, seen))
      .join(" ");
  }

  if (typeof Element !== "undefined" && value instanceof Element) {
    return truncateText(value.outerHTML || value.textContent || String(value), 400);
  }

  return Object.keys(value)
    .slice(0, MAX_ITEMS)
    .map((key) => {
      const result = readProperty(value, key);
      return result.ok
        ? `${key}:${stringifyForSearch(result.value, depth + 1, seen)}`
        : `${key}:[Thrown ${truncateText(String(result.error), 120)}]`;
    })
    .join(" ");
}

export function serializeArgs(args) {
  return args.map((item) => serializeValue(item));
}

export function argsToText(args) {
  return truncateText(
    args
      .map((item) => stringifyForSearch(item))
      .filter(Boolean)
      .join(" ")
  );
}
