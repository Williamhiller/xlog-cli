import { useEffect, useMemo, useRef, useState } from "react";
import DetailDrawer from "./components/DetailDrawer.jsx";
import { Icon } from "./icons.jsx";
import { showToast } from "./toast.js";

const DEFAULT_LOG_LIMIT = 600;
const UI_STORAGE_KEY = "xlog.viewer.ui";
const SELF_TEST_SESSION_KEY = "xlog.viewer.self-test.v1";
const QUICK_FILTERS = [
  { key: "all", label: "All" },
  { key: "warn", label: "Warnings" },
  { key: "error", label: "Errors" }
];

function padMilliseconds(value) {
  return String(value).padStart(3, "0");
}

function toEpochMs(value) {
  const date = new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "unknown";
  }

  return `${date.toLocaleString([], {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })}.${padMilliseconds(date.getMilliseconds())}`;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "--:--:--.000";
  }

  return `${date.toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })}.${padMilliseconds(date.getMilliseconds())}`;
}

function formatClockTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "--:--:--";
  }

  return date.toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatCaptureSubtitle(capture) {
  if (!capture) {
    return "";
  }

  const startedAt = capture.startedAt || capture.firstSeen;
  const startMs = toEpochMs(startedAt);
  const lastSeenMs = capture.lastSeenMs || toEpochMs(capture.lastSeen);
  const startLabel = formatClockTime(startedAt);

  if (
    startMs !== null &&
    lastSeenMs !== null &&
    lastSeenMs > startMs &&
    Date.now() - lastSeenMs > 15000
  ) {
    return `${startLabel} · ${formatDuration(lastSeenMs - startMs)}`;
  }

  return startLabel;
}

function formatSource(log) {
  if (!log || !log.callsite || !log.callsite.file) {
    return "unknown source";
  }

  const rawFile = String(log.callsite.file || "").replace(/\\/g, "/");
  const anchors = ["/src/", "/app/", "/pages/", "/components/", "/packages/", "/node_modules/", "/chunks/", "/@vite/"];
  let displayFile = rawFile;

  for (const anchor of anchors) {
    const index = rawFile.lastIndexOf(anchor);
    if (index !== -1) {
      displayFile = rawFile.slice(index + 1);
      break;
    }
  }

  if (displayFile.startsWith("/")) {
    displayFile = displayFile.slice(1);
  }

  return [displayFile, log.callsite.line, log.callsite.column].filter(Boolean).join(":");
}

function getCallsiteSource(log) {
  return log?.callsite?.source || "none";
}

function getRuntimeSource(log) {
  if (log?.source) {
    return log.source;
  }

  const pageUrl = String(log?.page?.url || "").toLowerCase();

  if (pageUrl.includes("sidepanel")) {
    return "sidepanel";
  }

  if (pageUrl.includes("popup")) {
    return "popup";
  }

  if (pageUrl.includes("options")) {
    return "options";
  }

  if (pageUrl.includes("dashboard")) {
    return "dashboard";
  }

  if (pageUrl.includes("background")) {
    return "background";
  }

  if (pageUrl.startsWith("http://") || pageUrl.startsWith("https://")) {
    return "page";
  }

  return "unknown";
}

function getRuntimeSourceLabel(log) {
  return getRuntimeSource(log);
}

function getCallsiteSourceLabel(log) {
  const source = getCallsiteSource(log);

  if (source === "transform") {
    return "transform";
  }

  if (source === "stack") {
    return "stack";
  }

  return "no-callsite";
}

function getCaptureName(capture) {
  return capture?.project?.name || "Unknown project";
}

function buildCaptureShareUrl(captureId) {
  return new URL(`/api/captures/${encodeURIComponent(captureId)}/share.json`, window.location.origin).toString();
}

function buildLogQuery(filters, options = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(DEFAULT_LOG_LIMIT));

  for (const [key, value] of Object.entries(filters)) {
    if (Array.isArray(value)) {
      const joined = value.join(",");
      if (joined) {
        params.set(key, joined);
      }
      continue;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        params.set(key, trimmed);
      }
      continue;
    }

    if (value) {
      params.set(key, value);
    }
  }

  if (options.project) {
    params.set("project", options.project);
  }

  if (options.sessionIds && options.sessionIds.length) {
    params.set("sessionIds", options.sessionIds.join(","));
  }

  if (options.from) {
    params.set("from", options.from);
  }

  if (options.to) {
    params.set("to", options.to);
  }

  return params.toString();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}`);
  }

  return response.json();
}

function loadStoredUi(initialThemeMode) {
  try {
    const parsed = JSON.parse(localStorage.getItem(UI_STORAGE_KEY) || "{}");
    return {
      sessionsCollapsed: false,
      detailOpen: false,
      themeMode: parsed.themeMode || initialThemeMode || "auto"
    };
  } catch {
    return {
      sessionsCollapsed: false,
      detailOpen: false,
      themeMode: initialThemeMode || "auto"
    };
  }
}

function persistUi(ui) {
  localStorage.setItem(
    UI_STORAGE_KEY,
    JSON.stringify({
      themeMode: ui.themeMode
    })
  );
}

function getQuickFilterKey(filters) {
  const levels = filters.level || [];
  if (levels.length === 1 && levels[0] === "error") {
    return "error";
  }

  if (levels.length === 1 && levels[0] === "warn") {
    return "warn";
  }

  return "all";
}

function buildContextLines(log) {
  return [
    `callsite: ${formatSource(log)}`,
    `runtime: ${getRuntimeSourceLabel(log)}`,
    `callsite origin: ${getCallsiteSourceLabel(log)}`,
    `function: ${log?.callsite?.functionName || "unknown"}`,
    `occurred: ${formatDateTime(log?.occurredAtMs || log?.occurredAt)}`,
    `received: ${formatDateTime(log?.receivedAtMs || log?.receivedAt)}`,
    `sequence: ${log?.sequence || 0}`,
    `session: ${log?.session?.id || "unknown"}`,
    `page: ${log?.page?.url || "unknown"}`
  ];
}

function truncateText(value, maxLength = 160) {
  const text = String(value ?? "");
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

function isSerializedValue(value) {
  return Boolean(value && typeof value === "object" && typeof value.type === "string");
}

function formatArgValue(value, depth = 0) {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "string") {
    return `"${truncateText(value, depth === 0 ? 44 : 20)}"`;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  if (typeof value === "function") {
    return `ƒ ${value.name || "anonymous"}()`;
  }

  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }

  if (isSerializedValue(value)) {
    switch (value.type) {
      case "string":
        return `"${truncateText(value.value ?? "", depth === 0 ? 44 : 20)}"`;
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
        return `ƒ ${value.name || "anonymous"}()`;
      case "date":
        return String(value.value || "Invalid Date");
      case "error":
        return `${value.name || "Error"}: ${value.message || ""}`.trim();
      case "array": {
        const items = Array.isArray(value.items) ? value.items : [];
        const preview = items.slice(0, 3).map((item) => formatArgValue(item, depth + 1)).join(", ");
        return `[${preview}${value.truncated ? ", …" : ""}]`;
      }
      case "object": {
        const entries = Array.isArray(value.entries) ? value.entries : [];
        if (!entries.length) {
          return value.ctor && value.ctor !== "Object" ? `${value.ctor} {}` : "{}";
        }

        const preview = entries
          .slice(0, 3)
          .map((entry) => `${entry.key}: ${formatArgValue(entry.value, depth + 1)}`)
          .join(", ");
        const prefix = value.ctor && value.ctor !== "Object" ? `${value.ctor} ` : "";
        return `${prefix}{ ${preview}${value.truncated ? ", …" : ""} }`;
      }
      case "map": {
        const entries = Array.isArray(value.entries) ? value.entries : [];
        const preview = entries
          .slice(0, 3)
          .map((entry) => `${entry.key} => ${formatArgValue(entry.value, depth + 1)}`)
          .join(", ");
        return `Map(${value.size ?? entries.length}) { ${preview}${value.truncated ? ", …" : ""} }`;
      }
      case "set": {
        const values = Array.isArray(value.values) ? value.values : [];
        const preview = values.slice(0, 3).map((item) => formatArgValue(item, depth + 1)).join(", ");
        return `Set(${value.size ?? values.length}) { ${preview}${value.truncated ? ", …" : ""} }`;
      }
      case "typed-array":
        return `${value.ctor || "TypedArray"}(${value.length ?? 0})`;
      case "array-buffer":
        return `ArrayBuffer(${value.byteLength ?? 0})`;
      case "dom": {
        const id = value.id ? `#${value.id}` : "";
        const className = value.className ? `.${String(value.className).trim().replace(/\s+/g, ".")}` : "";
        return `<${String(value.tagName || "element").toLowerCase()}${id}${className}>`;
      }
      case "summary":
        return value.value || value.ctor || "summary";
      case "circular":
        return `[Circular ${value.ctor || "Object"}]`;
      case "thrown":
        return `[Thrown ${value.value || "error"}]`;
      default:
        break;
    }
  }

  if (Array.isArray(value)) {
    if (depth > 0) {
      return `Array(${value.length})`;
    }

    const items = value.slice(0, 3).map((item) => formatArgValue(item, depth + 1)).join(", ");
    return `[${items}${value.length > 3 ? ", …" : ""}]`;
  }

  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (!keys.length) {
      return "{}";
    }

    if (depth > 0) {
      return `{${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", …" : ""}}`;
    }

    const entries = keys.slice(0, 3).map((key) => {
      try {
        return `${key}: ${formatArgValue(value[key], depth + 1)}`;
      } catch {
        return `${key}: ?`;
      }
    });
    return `{ ${entries.join(", ")}${keys.length > 3 ? ", …" : ""} }`;
  }

  return String(value);
}

function getArgsPreview(log, skipLeadingString = false) {
  const args = Array.isArray(log?.args) ? log.args : [];
  if (!args.length) {
    return "";
  }

  const normalizedArgs = skipLeadingString && args[0]?.type === "string" ? args.slice(1) : args;
  if (!normalizedArgs.length) {
    return "";
  }

  return truncateText(
    normalizedArgs
      .map((item) => {
        try {
          return formatArgValue(item);
        } catch {
          return "[unrenderable]";
        }
      })
      .filter(Boolean)
      .join(" "),
    180
  );
}

function getMessageParts(log) {
  const args = Array.isArray(log?.args) ? log.args : [];
  const firstArg = args[0];
  const hasLeadingString = firstArg?.type === "string" && String(firstArg.value || "").trim();
  const stringHeadline = hasLeadingString ? String(firstArg.value || "").trim() : "";
  const fallbackHeadline = (log?.text || "").trim();
  const headline = stringHeadline || fallbackHeadline;
  const argsPreview = getArgsPreview(log, Boolean(stringHeadline));
  const dedupedArgsPreview =
    argsPreview &&
    headline &&
    argsPreview.replace(/^"(.*)"$/, "$1").trim() === headline.trim()
      ? ""
      : argsPreview;

  if (headline) {
    return {
      headline,
      tail: dedupedArgsPreview
    };
  }

  return {
    headline: dedupedArgsPreview || "(empty)",
    tail: ""
  };
}

function getMessagePreviewText(parts) {
  return [parts?.headline, parts?.tail].filter(Boolean).join(" ").trim();
}

function isExpandableLog(log, parts) {
  const preview = getMessagePreviewText(parts);

  if (!preview) {
    return false;
  }

  if (preview.length > 240) {
    return true;
  }

  if (/[\r\n]/.test(preview)) {
    return true;
  }

  if ((log?.level === "error" || log?.kind === "unhandledrejection") && preview.length > 140) {
    return true;
  }

  return /\bat\s+\S+|\bhttps?:\/\/|\bError:/.test(preview) && preview.length > 120;
}

function getLevelIconName(level) {
  switch (level) {
    case "error":
      return "ri-close-circle-line";
    case "warn":
      return "ri-error-warning-line";
    case "info":
      return "ri-information-line";
    case "debug":
      return "ri-bug-line";
    case "trace":
      return "ri-route-line";
    default:
      return "ri-terminal-box-line";
  }
}

function buildSelfTestContext(trigger) {
  return {
    trigger,
    at: new Date().toISOString(),
    href: window.location.href,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    selectedText: window.getSelection?.()?.toString() || "",
    userAgent: navigator.userAgent
  };
}

function emitSyntheticWindowError(trigger) {
  const error = new Error(`viewer synthetic window error (${trigger})`);

  window.setTimeout(() => {
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: error.message,
        filename: window.location.href,
        error
      })
    );
  }, 80);
}

function emitSyntheticUnhandledRejection(trigger) {
  const error = new Error(`viewer synthetic unhandled rejection (${trigger})`);

  window.setTimeout(() => {
    if (typeof PromiseRejectionEvent === "function") {
      window.dispatchEvent(
        new PromiseRejectionEvent("unhandledrejection", {
          promise: Promise.resolve(),
          reason: error
        })
      );
      return;
    }

    Promise.reject(error);
  }, 140);
}

function runViewerSelfTest(trigger = "manual") {
  const context = buildSelfTestContext(trigger);

  console.log("viewer sample log", context);
  console.info("viewer sample info", {
    ...context,
    activeTheme: document.documentElement.dataset.theme || "unknown"
  });
  console.warn("viewer sample warning", {
    ...context,
    streamStateHint: "dev-self-test",
    tags: ["sample", "warning", "viewer"]
  });
  console.debug("viewer sample debug", {
    ...context,
    filters: {
      q: "",
      level: "",
      kind: ""
    }
  });
  console.trace("viewer sample trace", context);
  console.table?.([
    { type: "tab", title: "Inbox", active: true },
    { type: "tab", title: "Docs", active: false }
  ]);
  console.assert?.(false, "viewer sample assert", context);

  try {
    throw new Error(`viewer sample caught error (${trigger})`);
  } catch (error) {
    console.error("viewer sample caught error", error, context);
  }

  console.error("viewer sample structured error", {
    ...context,
    nested: {
      panel: "viewer",
      action: "self-test",
      states: ["log", "warn", "error", "trace"]
    }
  });

  emitSyntheticWindowError(trigger);
  emitSyntheticUnhandledRejection(trigger);
}


function useDebouncedValue(value, delay) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

function FilterMultiSelect({ options, selected, placeholder, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function toggleOption(option) {
    const next = selected.includes(option)
      ? selected.filter((item) => item !== option)
      : [...selected, option];
    onChange(next);
  }

  const summary = selected.length === 0
    ? placeholder
    : selected.join(", ");

  return (
    <div className="viewer-multiselect" ref={ref}>
      <button
        type="button"
        className={`viewer-multiselect-trigger ${selected.length ? "has-selection" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="viewer-multiselect-label">{summary}</span>
        <Icon name="ri-arrow-down-s-line" />
      </button>
      {open ? (
        <div className="viewer-multiselect-dropdown">
          {options.map((option) => (
            <label key={option} className="viewer-multiselect-option">
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={() => toggleOption(option)}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function App({ initialThemeMode }) {
  const [ui, setUi] = useState(() => loadStoredUi(initialThemeMode));
  const [filters, setFilters] = useState({
    q: "",
    level: [],
    kind: [],
    file: ""
  });
  const [storage, setStorage] = useState(null);
  const [captures, setCaptures] = useState([]);
  const [logs, setLogs] = useState([]);
  const [selectedCaptureId, setSelectedCaptureId] = useState("");
  const [selectedLogId, setSelectedLogId] = useState("");
  const [expandedLogIds, setExpandedLogIds] = useState(() => new Set());
  const [streamState, setStreamState] = useState("connecting");
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [deletingCaptureId, setDeletingCaptureId] = useState("");
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const filterPanelRef = useRef(null);
  const filterButtonRef = useRef(null);
  const debouncedQuery = useDebouncedValue(filters.q, 250);

  const resolvedTheme = useMemo(() => {
    if (ui.themeMode === "auto") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }

    return ui.themeMode;
  }, [ui.themeMode]);

  function closeSelectedLog() {
    setSelectedLogId("");
    setUi((current) => (current.detailOpen ? { ...current, detailOpen: false } : current));
  }

  function applyFetchedData(sessionData, logData) {
    setCaptures(sessionData.captures || []);
    setLogs(logData.logs || []);
    setStorage(logData.storage || sessionData.storage || null);
  }

  async function readCurrentData(activeFilters = filters, activeCaptureId = selectedCaptureId) {
    const captureData = await fetchJson("/api/captures");
    const activeCapture = (captureData.captures || []).find((capture) => capture.id === activeCaptureId) || null;

    const logQuery = activeCapture
      ? buildLogQuery(activeFilters, {
          project: activeCapture.project?.name || "",
          sessionIds: activeCapture.sessionIds || [],
          from: activeCapture.firstSeen,
          to: activeCapture.lastSeen
        })
      : buildLogQuery(activeFilters);

    const logData = await fetchJson(`/api/x-log?${logQuery}`);

    return { sessionData: captureData, logData };
  }

  function updateFilters(nextPatch) {
    closeSelectedLog();
    setFilters((current) => ({ ...current, ...nextPatch }));
  }

  function clearFilters() {
    closeSelectedLog();
    setFilters({
      q: "",
      level: [],
      kind: [],
      file: ""
    });
  }

  function applyQuickFilter(nextKey) {
    closeSelectedLog();
    setFilters((current) => {
      if (nextKey === "warn") {
        return { ...current, level: ["warn"], kind: [] };
      }

      if (nextKey === "error") {
        return { ...current, level: ["error"], kind: [] };
      }

      return { ...current, level: [], kind: [] };
    });
  }

  function openLogDetails(logId) {
    setSelectedLogId(logId);
    setUi((current) => ({ ...current, detailOpen: true }));
  }

  useEffect(() => {
    document.documentElement.dataset.themeMode = ui.themeMode;
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    persistUi(ui);
  }, [ui, resolvedTheme]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const activeFilters = { ...filters, q: debouncedQuery };
      const { sessionData, logData } = await readCurrentData(activeFilters, selectedCaptureId);

      if (cancelled) {
        return;
      }

      applyFetchedData(sessionData, logData);
    }

    load().catch((error) => {
      if (!cancelled) {
        showToast(error.message, "error");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [filters.level, filters.kind, filters.file, debouncedQuery, selectedCaptureId]);

  useEffect(() => {
    if (!isFilterPanelOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      const panelNode = filterPanelRef.current;
      const triggerNode = filterButtonRef.current;

      if (panelNode?.contains(event.target) || triggerNode?.contains(event.target)) {
        return;
      }

      setIsFilterPanelOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsFilterPanelOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFilterPanelOpen]);

  useEffect(() => {
    if (!isThemeMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      const wrap = event.target.closest(".viewer-theme-select-wrap");
      if (wrap) return;
      setIsThemeMenuOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsThemeMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isThemeMenuOpen]);

  useEffect(() => {
    const scrollNodes = [
      ...document.querySelectorAll(".viewer-log-surface-scroll")
    ];

    if (!scrollNodes.length) {
      return undefined;
    }

    const timers = new Map();

    function markScrolling(node) {
      node.classList.add("is-scroll-active");

      const previousTimer = timers.get(node);
      if (previousTimer) {
        window.clearTimeout(previousTimer);
      }

      const nextTimer = window.setTimeout(() => {
        node.classList.remove("is-scroll-active");
        timers.delete(node);
      }, 480);

      timers.set(node, nextTimer);
    }

    function handleScroll(event) {
      markScrolling(event.currentTarget);
    }

    for (const node of scrollNodes) {
      node.addEventListener("scroll", handleScroll, { passive: true });
    }

    return () => {
      for (const node of scrollNodes) {
        node.removeEventListener("scroll", handleScroll);
        node.classList.remove("is-scroll-active");
      }

      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/stream");

    source.addEventListener("open", () => {
      setStreamState("live");
    });

    source.addEventListener("message", () => {
      setStreamState("live");
    readCurrentData({ ...filters, q: debouncedQuery }, selectedCaptureId)
      .then(({ sessionData, logData }) => {
        applyFetchedData(sessionData, logData);
      })
        .catch(() => {
          setStreamState("stale");
        });
    });

    source.addEventListener("error", () => {
      setStreamState("reconnecting");
    });

    return () => {
      source.close();
    };
  }, [filters.level, filters.kind, filters.file, debouncedQuery, selectedCaptureId]);

  const visibleLogs = logs;
  const expandedLogIdSet = expandedLogIds;
  const selectedLog = visibleLogs.find((log) => log.id === selectedLogId) || null;
  const detailVisible = ui.detailOpen && Boolean(selectedLog);
  const logCountLabel = `${visibleLogs.length} ${visibleLogs.length === 1 ? "entry" : "entries"}`;
  const activeQuickFilter = getQuickFilterKey(filters);

  useEffect(() => {
    if (!selectedLogId) {
      return;
    }

    if (!visibleLogs.some((log) => log.id === selectedLogId)) {
      closeSelectedLog();
    }
  }, [visibleLogs, selectedLogId]);

  useEffect(() => {
    const visibleIds = new Set(visibleLogs.map((log) => log.id));

    setExpandedLogIds((current) => {
      let changed = false;
      const next = new Set();
      for (const id of current) {
        if (visibleIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [visibleLogs]);

  useEffect(() => {
    if (!selectedCaptureId) {
      if (captures.length) {
        setSelectedCaptureId(captures[0].id);
      }
      return;
    }

    if (!captures.some((capture) => capture.id === selectedCaptureId)) {
      setSelectedCaptureId("");
      closeSelectedLog();
    }
  }, [captures, selectedCaptureId]);

  async function handleCopy(text) {
    try {
      await navigator.clipboard.writeText(text || "");
      showToast("Copied", "success");
    } catch {
      showToast("Copy failed", "error");
    }
  }

  async function copyShareLink(capture) {
    if (!capture?.id) {
      return;
    }

    try {
      await navigator.clipboard.writeText(buildCaptureShareUrl(capture.id));
      showToast("Share link copied", "success");
    } catch {
      showToast("Share copy failed", "error");
    }
  }

  async function deleteCapture(capture) {
    if (!capture?.id || deletingCaptureId) {
      return;
    }

    const wasSelected = selectedCaptureId === capture.id;
    setDeletingCaptureId(capture.id);

    try {
      const response = await fetch(`/api/captures/${encodeURIComponent(capture.id)}`, {
        method: "DELETE"
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || "Delete failed");
      }

      const nextCaptures = payload?.captures || [];
      setCaptures(nextCaptures);
      setStorage(payload?.storage || null);

      if (wasSelected) {
        closeSelectedLog();
        setLogs([]);
        setExpandedLogIds(new Set());
        setSelectedCaptureId(nextCaptures[0]?.id || "");
      }

      showToast("Capture deleted", "success");
    } catch (error) {
      showToast(error?.message || "Delete failed", "error");
    } finally {
      setDeletingCaptureId((current) => (current === capture.id ? "" : current));
    }
  }

  async function clearAllLogs() {
    if (clearingLogs) {
      return;
    }

    const confirmed = window.confirm("Clear all logs? This cannot be undone.");
    if (!confirmed) {
      return;
    }

    setClearingLogs(true);

    try {
      const response = await fetch("/api/x-log", {
        method: "DELETE"
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || "Clear failed");
      }

      const { sessionData, logData } = await readCurrentData(filters, "");
      applyFetchedData(sessionData, logData);
      closeSelectedLog();
      setExpandedLogIds(new Set());
      setSelectedCaptureId("");
      showToast("All logs cleared", "success");
    } catch (error) {
      showToast(error?.message || "Clear failed", "error");
    } finally {
      setClearingLogs(false);
    }
  }

  const themeMenuItems = [
    { key: "auto", label: "Auto" },
    { key: "dark", label: "Dark" },
    { key: "light", label: "Light" }
  ];
  const isDevViewer = import.meta.env.DEV;
  const toggleSidebar = () => {
    setUi((current) => ({ ...current, sessionsCollapsed: !current.sessionsCollapsed }));
  };
  const toggleLogExpanded = (logId) => {
    setExpandedLogIds((current) => {
      const next = new Set(current);
      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!isDevViewer) {
      return;
    }

    if (sessionStorage.getItem(SELF_TEST_SESSION_KEY)) {
      return;
    }

    sessionStorage.setItem(SELF_TEST_SESSION_KEY, new Date().toISOString());
    const timer = window.setTimeout(() => {
      runViewerSelfTest("auto");
    }, 320);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isDevViewer]);

  return (
      <div className={`viewer-shell ${ui.sessionsCollapsed ? "is-sidebar-collapsed" : ""}`}>
        <aside className="viewer-sidebar">
          <div className="viewer-sidebar-top">
              <button
                type="button"
                className="viewer-sidebar-brand-button"
                onClick={toggleSidebar}
                aria-label={ui.sessionsCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded={!ui.sessionsCollapsed}
                title={ui.sessionsCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                <div className="viewer-sidebar-brand">
                  <div className="viewer-sidebar-brand-mark">
                    <Icon name="ri-pulse-ai-line" />
                  </div>
                  <div className={`viewer-sidebar-brand-copy ${ui.sessionsCollapsed ? "is-collapsed" : ""}`}>
                    <div className="viewer-sidebar-brand-title">xlog</div>
                    <div className="viewer-sidebar-brand-subtitle">
                      {storage ? storage.queryDriver : "booting"}
                    </div>
                  </div>
                </div>
              </button>
          </div>

          <div className="viewer-sidebar-group viewer-sidebar-group--sessions">
            {ui.sessionsCollapsed ? (
              <div className="viewer-sidebar-mini-list">
                {captures.slice(0, 8).map((capture) => (
                  <button
                    key={capture.id}
                    className={`viewer-session-mini ${selectedCaptureId === capture.id ? "is-active" : ""}`}
                    type="button"
                    onClick={() => {
                      closeSelectedLog();
                      setSelectedCaptureId((current) => (current === capture.id ? "" : capture.id));
                    }}
                    title={getCaptureName(capture)}
                  >
                    {getCaptureName(capture).slice(0, 1).toUpperCase()}
                  </button>
                ))}
              </div>
            ) : (
              <div className="viewer-sidebar-session-list">
                {captures.length ? (
                  captures.map((capture) => (
                    <div
                      key={capture.id}
                      className={`viewer-session-item ${selectedCaptureId === capture.id ? "is-active" : ""}`}
                    >
                      <button
                        type="button"
                        className="viewer-session-item-main"
                        onClick={() => {
                          closeSelectedLog();
                          setSelectedCaptureId((current) => (current === capture.id ? "" : capture.id));
                        }}
                      >
                        <div className="viewer-session-item-top">
                          <span>{getCaptureName(capture)}</span>
                          <strong>{capture.count}</strong>
                        </div>
                        <div className="viewer-session-item-meta">{formatCaptureSubtitle(capture)}</div>
                      </button>
                      <div className="viewer-session-actions">
                        <button
                          type="button"
                          className="viewer-session-action-button viewer-session-share-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void copyShareLink(capture);
                          }}
                          aria-label="Copy share link"
                          title="Copy share link"
                        >
                          <Icon name="ri-share-line" />
                        </button>
                        <button
                          type="button"
                          className={`viewer-session-action-button viewer-session-delete-button ${deletingCaptureId === capture.id ? "is-loading" : ""}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void deleteCapture(capture);
                          }}
                          aria-label="Delete capture"
                          title="Delete capture"
                        >
                          <Icon name="ri-delete-bin-6-line" />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="viewer-sidebar-empty">No captures yet.</div>
                )}
              </div>
            )}
          </div>

          <div className="viewer-sidebar-footer">
            <div className="viewer-sidebar-footer-actions">
              <button
                type="button"
                className={`viewer-sidebar-footer-button viewer-sidebar-clear-button ${clearingLogs ? "is-loading" : ""}`}
                onClick={() => {
                  void clearAllLogs();
                }}
                aria-label="Clear all logs"
                title="Clear all logs"
              >
                <Icon name="ri-delete-bin-6-line" />
              </button>

              <div className="viewer-theme-select-wrap">
                <button
                  type="button"
                  className="viewer-sidebar-footer-button viewer-sidebar-theme-button"
                  onClick={() => setIsThemeMenuOpen((v) => !v)}
                  aria-label="Appearance"
                  title="Appearance"
                >
                  <Icon name="ri-contrast-2-line" />
                </button>
                {isThemeMenuOpen ? (
                  <div className="viewer-theme-dropdown">
                    {themeMenuItems.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className={`viewer-theme-option ${ui.themeMode === item.key ? "is-selected" : ""}`}
                        onClick={() => {
                          setUi((current) => ({ ...current, themeMode: item.key }));
                          setIsThemeMenuOpen(false);
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </aside>

        <main className="viewer-content">
          <section className="viewer-board">
            <div className="viewer-workspace">
	          <section className="viewer-feed-panel">
	            <div className="viewer-feed-toolbar">
	              <div className="viewer-feed-toolbar-top">
	                <div className="viewer-issue-tabs" role="tablist" aria-label="Log presets">
	                  {QUICK_FILTERS.map((tab) => (
	                    <button
	                      key={tab.key}
	                      type="button"
	                      role="tab"
	                      aria-selected={activeQuickFilter === tab.key}
	                      className={`viewer-issue-tab ${activeQuickFilter === tab.key ? "is-active" : ""}`}
	                      onClick={() => applyQuickFilter(tab.key)}
	                    >
	                      {tab.label}
	                    </button>
	                  ))}
	                </div>

	                <div className="viewer-search-input viewer-search-input--toolbar">
	                  <span className="viewer-search-prefix"><Icon name="ri-search-2-line" /></span>
	                  <input
	                    type="text"
	                    placeholder="Search logs, args, source or session"
	                    value={filters.q}
	                    onChange={(event) => updateFilters({ q: event.target.value })}
	                  />
	                  {filters.q ? (
	                    <button
	                      type="button"
	                      className="viewer-search-clear"
	                      onClick={() => updateFilters({ q: "" })}
	                      aria-label="Clear search"
	                    >
	                      <Icon name="ri-close-line" />
	                    </button>
	                  ) : null}
	                </div>

	                <div className="viewer-toolbar-right">
	                  <div className="viewer-toolbar-status" aria-live="polite">
	                    <div className="viewer-surface-count">{logCountLabel}</div>
	                    <div className={`viewer-stream-pill is-${streamState}`}>{streamState}</div>
	                  </div>

	                  <div className="viewer-toolbar-actions">
	                      <button
	                        ref={filterButtonRef}
	                        type="button"
	                        className={`viewer-icon-button ${isFilterPanelOpen ? "is-active" : ""} ${(filters.kind && filters.kind.length) || filters.file ? "has-accent" : ""}`}
	                        aria-label="Open filters"
	                        aria-haspopup="dialog"
	                        aria-expanded={isFilterPanelOpen}
	                        onClick={() => setIsFilterPanelOpen((current) => !current)}
	                        title={isFilterPanelOpen ? "Close filters" : "Open filters"}
	                      >
	                        <Icon name="ri-filter-3-line" />
	                      </button>
	                  </div>
	                </div>
	              </div>

	              {isFilterPanelOpen ? (
	                <div
	                  ref={filterPanelRef}
	                  className="viewer-filter-popover"
	                  role="dialog"
	                  aria-label="Advanced filters"
	                >
	                  <div className="viewer-filter-popover-head">
	                    <div>
	                      <div className="viewer-filter-popover-kicker">Advanced filters</div>
	                      <div className="viewer-filter-popover-title">Scope the current log stream</div>
	                    </div>
	                    <button
	                      type="button"
	                      className="viewer-filter-reset"
	                      onClick={() => {
	                        clearFilters();
	                        setIsFilterPanelOpen(false);
	                      }}
	                    >
	                      Reset
	                    </button>
	                  </div>

	                  <div className="viewer-filter-popover-grid">
	                    <label className="viewer-filter-field">
	                      <span>Level</span>
	                      <FilterMultiSelect
	                        options={["error", "warn", "info", "log", "debug", "trace"]}
	                        selected={filters.level}
	                        placeholder="All levels"
	                        onChange={(next) => updateFilters({ level: next })}
	                      />
	                    </label>

	                    <label className="viewer-filter-field">
	                      <span>Kind</span>
	                      <FilterMultiSelect
	                        options={["console", "window.error", "unhandledrejection"]}
	                        selected={filters.kind}
	                        placeholder="All kinds"
	                        onChange={(next) => updateFilters({ kind: next })}
	                      />
	                    </label>

	                    <label className="viewer-filter-field viewer-filter-field--wide">
	                      <span>File or module</span>
	                      <div className="viewer-filter-input-wrap">
	                        <input
	                          type="text"
	                          placeholder="src/components/..."
	                          value={filters.file}
	                          onChange={(event) => updateFilters({ file: event.target.value })}
	                        />
	                        {filters.file ? (
	                          <button
	                            type="button"
	                            className="viewer-filter-input-clear"
	                            onClick={() => updateFilters({ file: "" })}
	                            aria-label="Clear file filter"
	                          >
	                            <Icon name="ri-close-line" />
	                          </button>
	                        ) : null}
	                      </div>
	                    </label>
	                  </div>

	                  <div className="viewer-filter-popover-footer">
	                    {isDevViewer ? (
	                      <button
	                        type="button"
	                        className="viewer-filter-toggle"
	                        onClick={() => runViewerSelfTest("manual-burst")}
	                      >
	                        <Icon name="ri-flask-line" />
	                        Sample Logs
	                      </button>
	                    ) : null}
	                  </div>
	                </div>
	              ) : null}
	            </div>

	            <div className="viewer-log-surface">
	              <div className="viewer-log-surface-scroll">
	                  {visibleLogs.length ? (
	                      <div className="viewer-console-list">
                        {visibleLogs.map((log) => {
                          const parts = getMessageParts(log);
                          const sourceLabel = getCallsiteSourceLabel(log);
                          const runtimeSourceLabel = getRuntimeSourceLabel(log);
                          const source = formatSource(log);
                          const expandable = isExpandableLog(log, parts);
                          const expanded = expandedLogIdSet.has(log.id);
                          return (
                            <div
                              key={log.id}
                              className={`viewer-console-row is-${log.level} ${selectedLog?.id === log.id ? "is-selected" : ""}`}
                            >
                              <div className="viewer-console-leading">
                                <span className="viewer-console-icon"><Icon name={getLevelIconName(log.level)} /></span>
                              </div>

                              <div className="viewer-console-body">
                                {expandable ? (
                                  <button
                                    type="button"
                                    className={`viewer-console-message-toggle ${expanded ? "is-expanded" : ""}`}
                                    onClick={() => toggleLogExpanded(log.id)}
                                    aria-expanded={expanded}
                                  >
                                    <div
                                      className={`viewer-console-message-row ${expanded ? "is-expanded" : "is-collapsed"}`}
                                    >
                                      <span className="viewer-console-message">{parts.headline}</span>
                                      {parts.tail ? (
                                        <span className="viewer-console-args">{parts.tail}</span>
                                      ) : null}
                                    </div>
                                    <span className="viewer-console-expand-hint">
                                      <i
                                        
                                        aria-hidden="true"
                                      />
                                      {expanded ? "Collapse" : "Expand"}
                                    </span>
                                  </button>
                                ) : (
                                  <div className="viewer-console-message-block">
                                    <div className="viewer-console-message-row">
                                      <span className="viewer-console-message">{parts.headline}</span>
                                      {parts.tail ? (
                                        <span className="viewer-console-args">{parts.tail}</span>
                                      ) : null}
                                    </div>
                                  </div>
                                )}

                                <div className="viewer-console-subline">
                                  <span>{log.kind || "console"}</span>
                                  <span>{runtimeSourceLabel}</span>
                                  <span>{sourceLabel}</span>
                                  <span>{log.session?.id || "global"}</span>
                                  <span>{log.callsite?.functionName || "anonymous"}</span>
                                </div>
                              </div>

                              <div className="viewer-console-side">
                                <div className="viewer-console-meta">
                                  <span className="viewer-console-time">{formatTime(log.occurredAtMs || log.occurredAt)}</span>
                                  <span className="viewer-console-file" title={source}>
                                    {source}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className="viewer-console-detail-button"
                                  onClick={() => openLogDetails(log.id)}
                                  aria-label="View details"
                                  title="View details"
                                >
                                  <Icon name="ri-eye-line" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
	                  ) : (
	                    <div className="viewer-empty-state">
	                      <div className="viewer-empty-icon">&#x1F4ED;</div>
	                      <div className="viewer-empty-text">
	                        No logs match the current filters.
	                      </div>
	                    </div>
	                  )}
	              </div>
	            </div>
	              </section>

            </div>
          </section>
        </main>

        <DetailDrawer
          visible={detailVisible}
          log={selectedLog}
          onClose={closeSelectedLog}
          onCopy={handleCopy}
          buildContextLines={buildContextLines}
          getRuntimeSourceLabel={getRuntimeSourceLabel}
          getCallsiteSourceLabel={getCallsiteSourceLabel}
        />
      </div>
  );
}
