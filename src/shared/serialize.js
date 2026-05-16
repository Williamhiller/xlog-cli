const MAX_DEPTH = 4;
const MAX_ITEMS = 24;
const MAX_TEXT_LENGTH = 6000;
const DOM_TEXT_PREVIEW_LENGTH = 240;
const DOM_SEARCH_TEXT_LIMIT = 240;
const DOM_PATH_MAX_DEPTH = 8;
const DOM_SNAPSHOT_MAX_BYTES = 64 * 1024;
const DOM_BLOCKED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);
const DOM_ALLOWED_ATTRS = new Set([
  "id",
  "class",
  "role",
  "name",
  "type",
  "href",
  "src",
  "alt",
  "title",
  "placeholder",
  "checked",
  "selected",
  "disabled"
]);
const DOM_ALLOWED_DATA_ATTRS = new Set(["data-testid", "data-test", "data-qa"]);
const DOM_ALLOWED_ATTR_PREFIXES = ["aria-"];
const DOM_URL_ATTRS = new Set(["href", "src"]);
const DOM_BOOLEAN_ATTRS = new Set(["checked", "selected", "disabled"]);
const DOM_FORM_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "OPTION"]);
const DOM_SENSITIVE_ATTR_RE = /(token|auth|secret|passw(?:or)?d|cookie|session|credential|api[-_]?key|key)/i;

function isObjectLike(value) {
  return value !== null && typeof value === "object";
}

function truncateText(value, limit = MAX_TEXT_LENGTH) {
  if (typeof value !== "string") {
    return value;
  }

  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function byteLength(value) {
  if (typeof TextEncoder === "function") {
    return new TextEncoder().encode(String(value || "")).length;
  }

  return String(value || "").length;
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeDomToken(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeClassName(value) {
  const tokens = String(value || "")
    .split(/\s+/)
    .map((item) => sanitizeDomToken(item))
    .filter(Boolean)
    .sort();

  return tokens.length ? tokens.join(" ") : null;
}

export function isDomElement(value) {
  return typeof Element !== "undefined" && value instanceof Element;
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

function sanitizeUrlValue(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  if (/^data:/i.test(text)) {
    return "data:";
  }

  try {
    const baseHref = typeof location !== "undefined" && location?.href ? location.href : "http://localhost/";
    const url = new URL(text, baseHref);
    if (url.protocol === "data:") {
      return "data:";
    }

    return `${url.origin}${url.pathname}${url.hash || ""}`;
  } catch {
    return text.replace(/[?#].*$/, "");
  }
}

function shouldKeepDomAttribute(name) {
  const normalizedName = String(name || "").toLowerCase();
  if (!normalizedName) {
    return false;
  }

  if (normalizedName === "style" || normalizedName === "srcdoc") {
    return false;
  }

  if (normalizedName.startsWith("on")) {
    return false;
  }

  if (DOM_ALLOWED_ATTRS.has(normalizedName) || DOM_ALLOWED_DATA_ATTRS.has(normalizedName)) {
    return true;
  }

  if (DOM_ALLOWED_ATTR_PREFIXES.some((prefix) => normalizedName.startsWith(prefix))) {
    return true;
  }

  return DOM_SENSITIVE_ATTR_RE.test(normalizedName);
}

function sanitizeAttributeValue(name, value, tagName) {
  const normalizedName = String(name || "").toLowerCase();
  const normalizedTag = String(tagName || "").toUpperCase();
  const text = normalizeWhitespace(value);

  if (!text && !DOM_BOOLEAN_ATTRS.has(normalizedName)) {
    return "";
  }

  if (normalizedName === "class") {
    return normalizeClassName(text) || "";
  }

  if (normalizedName === "srcdoc") {
    return "[redacted]";
  }

  if (DOM_SENSITIVE_ATTR_RE.test(normalizedName)) {
    return "[redacted]";
  }

  if (DOM_FORM_TAGS.has(normalizedTag) && normalizedName === "value") {
    return "[redacted]";
  }

  if (DOM_URL_ATTRS.has(normalizedName)) {
    return sanitizeUrlValue(text);
  }

  if (DOM_BOOLEAN_ATTRS.has(normalizedName)) {
    return text === "false" ? "" : "true";
  }

  return text;
}

function getAttributeEntries(element) {
  if (!element) {
    return [];
  }

  if (typeof element.getAttributeNames === "function") {
    return element.getAttributeNames().map((name) => ({
      name,
      value: typeof element.getAttribute === "function" ? element.getAttribute(name) : ""
    }));
  }

  if (Array.isArray(element.attributes)) {
    return element.attributes.map((attribute) => ({
      name: attribute?.name,
      value: attribute?.value
    }));
  }

  if (element.attributes && typeof element.attributes.length === "number") {
    return Array.from(element.attributes).map((attribute) => ({
      name: attribute?.name,
      value: attribute?.value
    }));
  }

  if (element.attributes && typeof element.attributes === "object") {
    return Object.entries(element.attributes).map(([name, value]) => ({ name, value }));
  }

  return [];
}

function extractDomAttributes(element) {
  const tagName = String(element?.tagName || "").toUpperCase();
  const attributes = {};
  const entries = getAttributeEntries(element)
    .filter((attribute) => shouldKeepDomAttribute(attribute?.name))
    .sort((left, right) => String(left?.name || "").localeCompare(String(right?.name || "")));

  for (const attribute of entries) {
    const name = String(attribute?.name || "").toLowerCase();
    const value = sanitizeAttributeValue(name, attribute?.value ?? "", tagName);
    if (!value && !DOM_BOOLEAN_ATTRS.has(name)) {
      continue;
    }

    attributes[name] = value || "true";
  }

  const propertyClassName = normalizeClassName(element?.className || "");
  if (propertyClassName) {
    attributes.class = propertyClassName;
  }

  const propertyId = sanitizeDomToken(element?.id || "");
  if (propertyId) {
    attributes.id = propertyId;
  }

  return attributes;
}

function buildSelectorFromParts(tagName, id, className, attrs = {}) {
  const normalizedTag = String(tagName || "element").toLowerCase();
  const normalizedId = sanitizeDomToken(id || "");
  const normalizedClassName = normalizeClassName(className || attrs.class || "");
  const classTokens = normalizedClassName ? normalizedClassName.split(" ").slice(0, 3) : [];
  let selector = normalizedTag;

  if (normalizedId) {
    selector += `#${normalizedId}`;
  }

  for (const token of classTokens) {
    selector += `.${token}`;
  }

  const preferredAttrs = ["data-testid", "data-test", "data-qa", "role", "name", "type"];
  for (const name of preferredAttrs) {
    const value = attrs?.[name];
    if (!value) {
      continue;
    }

    selector += `[${name}=${sanitizeDomToken(value)}]`;
  }

  return truncateText(selector, 160);
}

function getParentElement(node) {
  if (!node || typeof node !== "object") {
    return null;
  }

  return node.parentElement || (node.parentNode && node.parentNode.nodeType === 1 ? node.parentNode : null);
}

function getChildren(node) {
  if (!node || typeof node !== "object") {
    return [];
  }

  if (Array.isArray(node.children)) {
    return node.children;
  }

  if (node.children && typeof node.children.length === "number") {
    return Array.from(node.children);
  }

  if (Array.isArray(node.childNodes)) {
    return node.childNodes.filter((child) => child && child.nodeType === 1);
  }

  if (node.childNodes && typeof node.childNodes.length === "number") {
    return Array.from(node.childNodes).filter((child) => child && child.nodeType === 1);
  }

  return [];
}

function getNthOfTypeIndex(element) {
  const parent = getParentElement(element);
  if (!parent) {
    return null;
  }

  const tagName = String(element?.tagName || "").toUpperCase();
  const siblings = getChildren(parent).filter(
    (child) => String(child?.tagName || "").toUpperCase() === tagName
  );

  if (siblings.length <= 1) {
    return null;
  }

  const index = siblings.indexOf(element);
  return index >= 0 ? index + 1 : null;
}

function buildPathSegment(element) {
  const attrs = extractDomAttributes(element);
  const selector = buildSelectorFromParts(element?.tagName, element?.id, element?.className, attrs);
  if (sanitizeDomToken(element?.id || "")) {
    return selector;
  }

  const nthIndex = getNthOfTypeIndex(element);
  return nthIndex ? `${selector}:nth-of-type(${nthIndex})` : selector;
}

function buildDomPath(element) {
  const segments = [];
  let current = element;
  let depth = 0;

  while (current && depth < DOM_PATH_MAX_DEPTH) {
    segments.unshift(buildPathSegment(current));
    current = getParentElement(current);
    depth += 1;
  }

  return segments.join(" > ");
}

function hashText(value) {
  let hash = 2166136261;
  const input = String(value || "");

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function removeNode(node) {
  if (!node) {
    return;
  }

  if (typeof node.remove === "function") {
    node.remove();
    return;
  }

  if (node.parentNode && typeof node.parentNode.removeChild === "function") {
    node.parentNode.removeChild(node);
  }
}

function clearTextChildren(node) {
  if (!node || !node.childNodes) {
    return;
  }

  const children = Array.from(node.childNodes);
  for (const child of children) {
    removeNode(child);
  }
}

function sanitizeClonedElementNode(node) {
  if (!node || typeof node !== "object" || node.nodeType !== 1) {
    return;
  }

  const tagName = String(node.tagName || "").toUpperCase();
  const sanitizedAttrs = extractDomAttributes(node);
  const attributeNames = getAttributeEntries(node).map((attribute) => String(attribute?.name || ""));

  if (typeof node.removeAttribute === "function") {
    for (const name of attributeNames) {
      if (name) {
        node.removeAttribute(name);
      }
    }

    for (const [name, value] of Object.entries(sanitizedAttrs)) {
      if (!value && !DOM_BOOLEAN_ATTRS.has(name)) {
        continue;
      }

      if (DOM_BOOLEAN_ATTRS.has(name)) {
        node.setAttribute(name, value === "true" ? "" : value);
        continue;
      }

      node.setAttribute(name, value);
    }
  }

  if (tagName === "TEXTAREA") {
    clearTextChildren(node);
  }

  if (tagName === "INPUT") {
    try {
      node.value = "";
    } catch {
      // Ignore read-only inputs in sanitized clones.
    }
  }

  if (tagName === "OPTION" && typeof node.removeAttribute === "function") {
    node.removeAttribute("value");
  }
}

function sanitizeClonedTree(root) {
  const childNodes = Array.from(root?.childNodes || []);

  for (const child of childNodes) {
    if (!child) {
      continue;
    }

    if (child.nodeType === 8) {
      removeNode(child);
      continue;
    }

    if (child.nodeType !== 1) {
      continue;
    }

    const tagName = String(child.tagName || "").toUpperCase();
    if (DOM_BLOCKED_TAGS.has(tagName)) {
      removeNode(child);
      continue;
    }

    sanitizeClonedElementNode(child);
    sanitizeClonedTree(child);
  }
}

function sanitizeHtmlString(html, tagName) {
  let output = String(html || "");
  output = output.replace(/<!--[\s\S]*?-->/g, "");
  output = output.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  output = output.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  output = output.replace(/\son[a-z0-9:_-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  output = output.replace(/\s([a-zA-Z0-9:_-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g, (_full, rawName, rawValue) => {
    const name = String(rawName || "").toLowerCase();
    if (!shouldKeepDomAttribute(name)) {
      return "";
    }

    const unquoted = String(rawValue || "").replace(/^['"]|['"]$/g, "");
    const sanitizedValue = sanitizeAttributeValue(name, unquoted, tagName);
    if (!sanitizedValue && !DOM_BOOLEAN_ATTRS.has(name)) {
      return "";
    }

    if (DOM_BOOLEAN_ATTRS.has(name)) {
      return sanitizedValue === "true" ? ` ${name}` : "";
    }

    return ` ${name}="${sanitizedValue.replace(/"/g, "&quot;")}"`;
  });

  if (String(tagName || "").toUpperCase() === "TEXTAREA") {
    output = output.replace(/(<textarea\b[^>]*>)[\s\S]*?(<\/textarea>)/i, "$1$2");
  }

  return output;
}

function getSanitizedOuterHTML(element) {
  if (element && typeof element.cloneNode === "function") {
    try {
      const clone = element.cloneNode(true);
      sanitizeClonedElementNode(clone);
      sanitizeClonedTree(clone);
      if (typeof clone.outerHTML === "string") {
        return clone.outerHTML;
      }
    } catch {
      // Fall back to string-based sanitization below.
    }
  }

  return sanitizeHtmlString(element?.outerHTML || "", element?.tagName);
}

function buildDomSearchText(element, attrs = null) {
  const domAttrs = attrs || extractDomAttributes(element);
  const selector = buildSelectorFromParts(element?.tagName, element?.id, element?.className, domAttrs);
  const text = truncateText(normalizeWhitespace(element?.textContent || ""), DOM_SEARCH_TEXT_LIMIT);
  const attrsText = Object.entries(domAttrs)
    .slice(0, 8)
    .map(([name, value]) => `${name}:${truncateText(String(value || ""), 80)}`)
    .join(" ");

  return [selector, text, attrsText].filter(Boolean).join(" ");
}

function serializeDomValue(value, options = {}) {
  const tagName = String(value?.tagName || "ELEMENT").toUpperCase();
  const id = sanitizeDomToken(value?.id || "") || null;
  const className = normalizeClassName(value?.className || "") || null;
  const base = {
    type: "dom",
    tagName,
    id,
    className,
    text: truncateText(normalizeWhitespace(value?.textContent || ""), DOM_TEXT_PREVIEW_LENGTH)
  };

  if (!options.debugDomSnapshots) {
    return base;
  }

  const attrs = extractDomAttributes(value);
  const selector = buildSelectorFromParts(tagName, id, className, attrs);
  const path = buildDomPath(value);
  const text = normalizeWhitespace(value?.textContent || "");
  const outerHTMLSanitized = getSanitizedOuterHTML(value);
  const htmlByteLength = byteLength(outerHTMLSanitized);
  const tooLarge = htmlByteLength > DOM_SNAPSHOT_MAX_BYTES;
  const storedHtml = tooLarge ? null : outerHTMLSanitized;
  const hash = hashText(storedHtml || outerHTMLSanitized || `${selector}\n${text}\n${JSON.stringify(attrs)}`);

  return {
    ...base,
    selector,
    attrs,
    path,
    text,
    outerHTMLSanitized: storedHtml,
    hash,
    byteLength: htmlByteLength,
    tooLarge,
    truncated: tooLarge,
    captureMode: "debug"
  };
}

function serializeError(error, depth, seen, options) {
  const props = {};

  for (const key of Object.keys(error)) {
    const result = readProperty(error, key);
    props[key] = result.ok
      ? serializeValue(result.value, depth + 1, seen, options)
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

function serializeEntries(entries, depth, seen, options) {
  const output = [];
  let count = 0;

  for (const [key, value] of entries) {
    if (count >= MAX_ITEMS) {
      break;
    }

    output.push({
      key: String(key),
      value: serializeValue(value, depth + 1, seen, options)
    });
    count += 1;
  }

  return {
    items: output,
    truncated: count >= MAX_ITEMS
  };
}

export function serializeValue(value, depth = 0, seen = new WeakSet(), options = {}) {
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
    return serializeError(value, depth, seen, options);
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

  if (isDomElement(value)) {
    return serializeDomValue(value, options);
  }

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      items: value.slice(0, MAX_ITEMS).map((item) => serializeValue(item, depth + 1, seen, options)),
      truncated: value.length > MAX_ITEMS
    };
  }

  if (value instanceof Map) {
    const entries = serializeEntries(value.entries(), depth, seen, options);
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
        .map((item) => serializeValue(item, depth + 1, seen, options)),
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
        ? serializeValue(result.value, depth + 1, seen, options)
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

export function stringifyForSearch(value, depth = 0, seen = new WeakSet(), options = {}) {
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

  if (isDomElement(value)) {
    return buildDomSearchText(value);
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ITEMS)
      .map((item) => stringifyForSearch(item, depth + 1, seen, options))
      .join(" ");
  }

  if (value instanceof Map) {
    return Array.from(value.entries())
      .slice(0, MAX_ITEMS)
      .map(([key, item]) => `${key}:${stringifyForSearch(item, depth + 1, seen, options)}`)
      .join(" ");
  }

  if (value instanceof Set) {
    return Array.from(value.values())
      .slice(0, MAX_ITEMS)
      .map((item) => stringifyForSearch(item, depth + 1, seen, options))
      .join(" ");
  }

  return Object.keys(value)
    .slice(0, MAX_ITEMS)
    .map((key) => {
      const result = readProperty(value, key);
      return result.ok
        ? `${key}:${stringifyForSearch(result.value, depth + 1, seen, options)}`
        : `${key}:[Thrown ${truncateText(String(result.error), 120)}]`;
    })
    .join(" ");
}

export function serializeArgs(args, options = {}) {
  return args.map((item) => serializeValue(item, 0, new WeakSet(), options));
}

export function argsToText(args, options = {}) {
  return truncateText(
    args
      .map((item) => stringifyForSearch(item, 0, new WeakSet(), options))
      .filter(Boolean)
      .join(" ")
  );
}
