const { animate = () => ({}), stagger = () => 0 } = window.Motion || {};
const {
  autoUpdate = () => () => {},
  computePosition = async () => ({ x: 0, y: 0 }),
  flip = () => ({}),
  offset = () => ({}),
  shift = () => ({})
} = window.FloatingUIDOM || {};

const DEFAULT_LOG_LIMIT = 600;
const UI_STORAGE_KEY = "xlogger.viewer.ui";
const THEME_MEDIA = window.matchMedia("(prefers-color-scheme: dark)");

const state = {
  sessions: [],
  logs: [],
  selectedSessionId: "",
  selectedLogId: "",
  storage: null,
  lastAnimatedDetailId: "",
  tooltipCleanup: null,
  settingsOpen: false,
  ui: {
    sessionsCollapsed: false,
    detailOpen: false,
    ultraCompact: false,
    themeMode: "auto"
  },
  filters: {
    q: "",
    level: "",
    kind: "",
    file: ""
  }
};

const els = {
  appShell: document.getElementById("app-shell"),
  searchInput: document.getElementById("search-input"),
  levelSelect: document.getElementById("level-select"),
  kindSelect: document.getElementById("kind-select"),
  fileInput: document.getElementById("file-input"),
  stats: document.getElementById("stats"),
  sessions: document.getElementById("sessions"),
  sessionsPanel: document.getElementById("sessions-panel"),
  sessionCount: document.getElementById("session-count"),
  logs: document.getElementById("logs"),
  logCount: document.getElementById("log-count"),
  viewerUrl: document.getElementById("viewer-url"),
  storePath: document.getElementById("store-path"),
  liveState: document.getElementById("live-state"),
  storageDriver: document.getElementById("storage-driver"),
  densityToggle: document.getElementById("density-toggle"),
  densityToggleText: document.getElementById("density-toggle-text"),
  sessionsToggle: document.getElementById("sessions-toggle"),
  sessionsToggleIcon: document.getElementById("sessions-toggle-icon"),
  detailClose: document.getElementById("detail-close"),
  detailPanel: document.getElementById("detail-panel"),
  detailTitle: document.getElementById("detail-title"),
  detailMeta: document.getElementById("detail-meta"),
  detailMessage: document.getElementById("detail-message"),
  detailContext: document.getElementById("detail-context"),
  detailArgs: document.getElementById("detail-args"),
  detailStack: document.getElementById("detail-stack"),
  tooltip: document.getElementById("floating-tooltip"),
  settingsToggle: document.getElementById("settings-toggle"),
  settingsPanel: document.getElementById("settings-panel"),
  themeOptions: document.getElementById("theme-options"),
  detailCopyButtons: [...document.querySelectorAll(".detail-copy")]
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function padMilliseconds(value) {
  return String(value).padStart(3, "0");
}

function getDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(value) {
  const date = getDate(value);
  if (!date) {
    return value || "--:--:--.000";
  }

  try {
    return `${date.toLocaleTimeString([], {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })}.${padMilliseconds(date.getMilliseconds())}`;
  } catch {
    return value || "--:--:--.000";
  }
}

function formatDateTime(value) {
  const date = getDate(value);
  if (!date) {
    return value || "unknown";
  }

  try {
    return `${date.toLocaleString([], {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })}.${padMilliseconds(date.getMilliseconds())}`;
  } catch {
    return value || "unknown";
  }
}

function formatTimeWithSequence(log) {
  const sequence = Number(log.sequence || 0);
  const sequenceLabel = sequence > 0 ? ` #${String(sequence).padStart(3, "0")}` : "";
  return `${formatTime(log.occurredAtMs || log.occurredAt)}${sequenceLabel}`;
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

  const parts = [displayFile, log.callsite.line, log.callsite.column].filter(Boolean);
  return parts.join(":");
}

function getRuntimeSourceLabel(log) {
  if (log && log.source) {
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

function setInlineText(element, value) {
  const innerTextEl = element.querySelector("span:last-child");
  if (innerTextEl && innerTextEl !== element) {
    innerTextEl.textContent = value;
    return;
  }

  element.textContent = value;
}

function animateElements(targets, keyframes, options) {
  if (!targets || (Array.isArray(targets) && !targets.length)) {
    return;
  }

  try {
    animate(targets, keyframes, options);
  } catch {}
}

function bindTooltips(root = document) {
  for (const element of root.querySelectorAll("[data-tooltip]")) {
    if (element.dataset.tooltipBound === "1") {
      continue;
    }

    const show = () => showTooltip(element, element.dataset.tooltip || "");
    const hide = () => hideTooltip();

    element.addEventListener("mouseenter", show);
    element.addEventListener("mouseleave", hide);
    element.addEventListener("focus", show);
    element.addEventListener("blur", hide);
    element.dataset.tooltipBound = "1";
  }
}

function showTooltip(target, text) {
  if (!text || !els.tooltip) {
    return;
  }

  els.tooltip.textContent = text;
  els.tooltip.hidden = false;

  if (state.tooltipCleanup) {
    state.tooltipCleanup();
  }

  state.tooltipCleanup = autoUpdate(target, els.tooltip, async () => {
    const { x, y } = await computePosition(target, els.tooltip, {
      placement: "top",
      middleware: [offset(8), flip(), shift({ padding: 8 })]
    });

    Object.assign(els.tooltip.style, {
      left: `${x}px`,
      top: `${y}px`
    });
  });

  animateElements(els.tooltip, { opacity: [0, 1], y: [4, 0] }, { duration: 0.12 });
}

function hideTooltip() {
  if (state.tooltipCleanup) {
    state.tooltipCleanup();
    state.tooltipCleanup = null;
  }

  if (!els.tooltip || els.tooltip.hidden) {
    return;
  }

  animateElements(els.tooltip, { opacity: [1, 0], y: [0, 4] }, { duration: 0.08 });
  window.setTimeout(() => {
    els.tooltip.hidden = true;
  }, 80);
}

function loadUiState() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(UI_STORAGE_KEY) || "{}");
    state.ui.sessionsCollapsed = false;
    state.ui.detailOpen = false;
    state.ui.ultraCompact = Boolean(parsed.ultraCompact);
    state.ui.themeMode = parsed.themeMode || "auto";
  } catch {
    state.ui.sessionsCollapsed = false;
    state.ui.detailOpen = false;
    state.ui.ultraCompact = false;
    state.ui.themeMode = "auto";
  }
}

function persistUiState() {
  try {
    window.localStorage.setItem(
      UI_STORAGE_KEY,
      JSON.stringify({
        ultraCompact: state.ui.ultraCompact,
        themeMode: state.ui.themeMode
      })
    );
  } catch {}
}

function getResolvedTheme() {
  if (state.ui.themeMode === "auto") {
    return THEME_MEDIA.matches ? "dark" : "light";
  }

  return state.ui.themeMode;
}

function applyTheme() {
  const resolvedTheme = getResolvedTheme();
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themeMode = state.ui.themeMode;

  for (const button of els.themeOptions.querySelectorAll("[data-theme-mode]")) {
    button.classList.toggle("is-active", button.dataset.themeMode === state.ui.themeMode);
  }
}

function openSettingsPanel() {
  state.settingsOpen = true;
  els.settingsPanel.hidden = false;
  els.settingsToggle.setAttribute("aria-expanded", "true");
  animateElements(els.settingsPanel, { opacity: [0, 1], y: [10, 0] }, { duration: 0.16 });
}

function closeSettingsPanel() {
  state.settingsOpen = false;
  els.settingsToggle.setAttribute("aria-expanded", "false");
  animateElements(els.settingsPanel, { opacity: [1, 0], y: [0, 8] }, { duration: 0.12 });
  window.setTimeout(() => {
    if (!state.settingsOpen) {
      els.settingsPanel.hidden = true;
    }
  }, 120);
}

async function copyText(text) {
  if (!text) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();

    try {
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      return copied;
    } catch {
      document.body.removeChild(textarea);
      return false;
    }
  }
}

function flashCopyState(button, copied) {
  const label = button.querySelector("span");
  if (!label) {
    return;
  }

  button.classList.toggle("is-copied", copied);
  label.textContent = copied ? "Copied" : "Copy";

  if (button.dataset.copyResetTimer) {
    clearTimeout(Number(button.dataset.copyResetTimer));
  }

  const timer = window.setTimeout(() => {
    button.classList.remove("is-copied");
    label.textContent = "Copy";
    delete button.dataset.copyResetTimer;
  }, copied ? 1200 : 800);

  button.dataset.copyResetTimer = String(timer);
}

function syncLayoutState() {
  const hasSelectedLog = Boolean(getSelectedLog());
  const detailVisible = state.ui.detailOpen && hasSelectedLog;

  els.appShell.classList.toggle("is-sessions-collapsed", state.ui.sessionsCollapsed);
  els.appShell.classList.toggle("is-detail-closed", !detailVisible);
  els.appShell.classList.toggle("is-ultra-compact", state.ui.ultraCompact);
  els.detailPanel.hidden = !hasSelectedLog;
  els.detailPanel.setAttribute("aria-hidden", String(!detailVisible));

  els.sessionsToggle.setAttribute("aria-expanded", String(!state.ui.sessionsCollapsed));
  els.sessionsToggle.setAttribute(
    "aria-label",
    state.ui.sessionsCollapsed ? "Expand sessions" : "Collapse sessions"
  );
  els.sessionsToggleIcon.className = state.ui.sessionsCollapsed
    ? "ri-sidebar-unfold-line"
    : "ri-sidebar-fold-line";

  els.densityToggle.setAttribute("aria-pressed", String(state.ui.ultraCompact));
  els.densityToggle.setAttribute(
    "aria-label",
    state.ui.ultraCompact ? "Switch to standard density" : "Switch to ultra compact density"
  );
  setInlineText(els.densityToggle, state.ui.ultraCompact ? "Normal" : "Ultra");

  applyTheme();
  persistUiState();
}

function animateSessionsPanel(isOpen) {
  if (!isOpen) {
    animateElements(els.sessions, { opacity: [1, 0], x: [0, -8] }, { duration: 0.12 });
    return;
  }

  animateElements(els.sessions, { opacity: [0, 1], x: [-12, 0] }, { duration: 0.18 });
}

function getSelectedLog() {
  if (!state.selectedLogId) {
    return null;
  }

  return state.logs.find((log) => log.id === state.selectedLogId) || null;
}

function clearSelectedLog() {
  state.selectedLogId = "";
  state.ui.detailOpen = false;
  state.lastAnimatedDetailId = "";
  updateLogSelection();
  renderDetails();
  syncLayoutState();
}

function updateStorage(storage) {
  if (!storage) {
    return;
  }

  state.storage = storage;
  setInlineText(els.storageDriver, `query ${storage.queryDriver}`);
  els.viewerUrl.textContent = window.location.host;
  els.viewerUrl.title = window.location.href;
  els.viewerUrl.closest(".meta-chip")?.setAttribute("data-tooltip", window.location.href);

  const storeValue = storage.sqliteEnabled ? storage.sqlitePath : storage.rawDir;
  els.storePath.textContent = storeValue;
  els.storePath.title = storeValue;
  els.storePath.closest(".meta-chip")?.setAttribute("data-tooltip", storeValue);

  bindTooltips(document);
}

function renderStats() {
  const totals = {
    visible: state.logs.length,
    error: state.logs.filter((item) => item.level === "error").length,
    warn: state.logs.filter((item) => item.level === "warn").length,
    files: new Set(
      state.logs
        .map((item) => (item.callsite && item.callsite.file ? item.callsite.file : ""))
        .filter(Boolean)
    ).size
  };

  const chips = [
    ["Visible", totals.visible],
    ["Errors", totals.error],
    ["Warn", totals.warn],
    ["Files", totals.files]
  ];

  els.stats.innerHTML = chips
    .map(
      ([label, value]) =>
        `<div class="metric-chip" data-tooltip="${escapeHtml(`${label}: ${value}`)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
    )
    .join("");
}

function renderSessions() {
  els.sessionCount.textContent = String(state.sessions.length);

  if (!state.sessions.length) {
    els.sessions.innerHTML = '<div class="empty-block"><i class="ri-database-2-line"></i> No session files found yet.</div>';
    return;
  }

  els.sessions.innerHTML = state.sessions
    .map((session) => {
      const active = session.id === state.selectedSessionId ? " is-active" : "";
      const levelSummary = Object.entries(session.levels || {})
        .map(([level, count]) => `${level}:${count}`)
        .join(" ");

      return `
        <button class="session-item${active}" type="button" data-session-id="${escapeHtml(session.id)}">
          <div class="session-title">
            <span>${escapeHtml(session.project.name)}</span>
            <span class="panel-count">${escapeHtml(session.count)}</span>
          </div>
          <div class="session-subtitle">${escapeHtml(formatDateTime(session.lastSeen))}</div>
          <div class="session-footer">${escapeHtml(levelSummary || "no levels")}</div>
        </button>
      `;
    })
    .join("");

  for (const button of els.sessions.querySelectorAll("[data-session-id]")) {
    button.addEventListener("click", () => {
      const nextSessionId = button.dataset.sessionId || "";
      state.selectedSessionId = state.selectedSessionId === nextSessionId ? "" : nextSessionId;
      clearSelectedLog();
      renderSessions();
      void loadLogs();
    });
  }

  animateElements(
    [...els.sessions.querySelectorAll(".session-item")],
    { opacity: [0, 1], x: [-8, 0] },
    { duration: 0.16, delay: stagger(0.02) }
  );
}

function updateLogSelection() {
  for (const button of els.logs.querySelectorAll("[data-log-id]")) {
    const isSelected = button.dataset.logId === state.selectedLogId;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  }
}

function renderLogs() {
  els.logCount.textContent = String(state.logs.length);

  if (!state.logs.length) {
    clearSelectedLog();
    els.logs.innerHTML =
      '<div class="empty-block"><i class="ri-search-eye-line"></i> No logs match the current filters. Clear filters or start your app with xlogger attached.</div>';
    renderStats();
    renderDetails();
    return;
  }

  const selected = getSelectedLog();
  if (!selected) {
    clearSelectedLog();
  }

  els.logs.innerHTML = state.logs
    .map((log) => {
      const selectedClass = log.id === state.selectedLogId ? " is-selected" : "";
      const source = `${getRuntimeSourceLabel(log)} · ${formatSource(log)}`;

      return `
        <button class="log-row${selectedClass}" type="button" data-log-id="${escapeHtml(log.id)}" aria-pressed="${selectedClass ? "true" : "false"}">
          <span class="log-time">${escapeHtml(formatTimeWithSequence(log))}</span>
          <span class="level-badge level-${escapeHtml(log.level)}">${escapeHtml(log.level)}</span>
          <span class="log-message">${escapeHtml(log.text || "(empty)")}</span>
          <span class="log-source">${escapeHtml(source)}</span>
        </button>
      `;
    })
    .join("");

  for (const button of els.logs.querySelectorAll("[data-log-id]")) {
    button.addEventListener("click", () => {
      const wasDetailOpen = state.ui.detailOpen && Boolean(getSelectedLog());
      state.selectedLogId = button.dataset.logId || "";
      state.ui.detailOpen = Boolean(state.selectedLogId);
      syncLayoutState();
      if (!wasDetailOpen && state.ui.detailOpen) {
        animateElements(els.detailPanel, { opacity: [0, 1], x: [14, 0] }, { duration: 0.22 });
      }
      updateLogSelection();
      renderDetails();
    });
  }

  bindTooltips(els.logs);
  updateLogSelection();

  renderStats();
  renderDetails();
}

function renderDetails() {
  const log = getSelectedLog();

  if (!log) {
    els.detailTitle.textContent = "No log selected";
    els.detailMeta.innerHTML = "";
    els.detailMessage.textContent =
      "Select a row to inspect the payload, stack, and source location.";
    els.detailContext.textContent = "No source metadata yet.";
    els.detailArgs.textContent = "[]";
    els.detailStack.textContent = "No stack";
    state.lastAnimatedDetailId = "";
    return;
  }

  const callsite = log.callsite || {};
  const page = log.page || {};
  const session = log.session || {};

  els.detailTitle.textContent = log.text || "(empty)";
  els.detailMeta.innerHTML = [
    log.level,
    log.kind,
    getRuntimeSourceLabel(log),
    formatDateTime(log.occurredAtMs || log.occurredAt),
    session.id
  ]
    .filter(Boolean)
    .map((item) => `<span class="detail-pill" data-tooltip="${escapeHtml(item)}">${escapeHtml(item)}</span>`)
    .join("");

  els.detailMessage.textContent = log.text || "(empty)";
  els.detailContext.textContent = [
    `callsite: ${formatSource(log)}`,
    `runtime: ${getRuntimeSourceLabel(log)}`,
    `function: ${callsite.functionName || "unknown"}`,
    `occurred: ${formatDateTime(log.occurredAtMs || log.occurredAt)}`,
    `received: ${formatDateTime(log.receivedAtMs || log.receivedAt)}`,
    `sequence: ${log.sequence || 0}`,
    `session: ${session.id || "unknown"}`,
    `started: ${session.startedAt || "unknown"}`,
    `page: ${page.url || "unknown"}`,
    `title: ${page.title || "unknown"}`
  ].join("\n");
  els.detailArgs.textContent = JSON.stringify(log.args || [], null, 2);
  els.detailStack.textContent = (log.stack && log.stack.raw) || "No stack";

  bindTooltips(els.detailMeta);

  if (state.lastAnimatedDetailId !== log.id) {
    state.lastAnimatedDetailId = log.id;
    animateElements(
      [...els.detailPanel.querySelectorAll(".detail-card")],
      { opacity: [0, 1], y: [6, 0] },
      { duration: 0.16, delay: stagger(0.02) }
    );
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}`);
  }

  return response.json();
}

async function loadSessions() {
  const data = await fetchJson("/api/sessions");
  state.sessions = data.sessions || [];
  updateStorage(data.storage);
  renderSessions();
}

function buildLogQuery() {
  const params = new URLSearchParams();
  params.set("limit", String(DEFAULT_LOG_LIMIT));

  for (const [key, value] of Object.entries(state.filters)) {
    if (value) {
      params.set(key, value);
    }
  }

  if (state.selectedSessionId) {
    params.set("sessionId", state.selectedSessionId);
  }

  return params.toString();
}

async function loadLogs() {
  const data = await fetchJson(`/api/x-log?${buildLogQuery()}`);
  state.logs = data.logs || [];
  updateStorage(data.storage);
  renderLogs();
}

async function bootstrap() {
  els.viewerUrl.textContent = window.location.host;
  els.viewerUrl.title = window.location.href;
  loadUiState();
  syncLayoutState();
  bindTooltips(document);

  try {
    await Promise.all([loadSessions(), loadLogs()]);
  } catch (error) {
    els.logs.innerHTML = `<div class="empty-block">${escapeHtml(error.message)}</div>`;
  }
}

function connectStream() {
  const source = new EventSource("/api/stream");

  source.addEventListener("open", () => {
    setInlineText(els.liveState, "stream online");
  });

  source.addEventListener("message", async () => {
    try {
      await Promise.all([loadSessions(), loadLogs()]);
      setInlineText(els.liveState, "stream online");
    } catch {
      setInlineText(els.liveState, "refresh failed");
    }
  });

  source.addEventListener("error", () => {
    setInlineText(els.liveState, "reconnecting");
  });
}

const scheduleRefresh = (() => {
  let timer = null;

  return () => {
    if (timer) {
      clearTimeout(timer);
    }

    timer = window.setTimeout(() => {
      void loadLogs();
    }, 140);
  };
})();

els.searchInput.addEventListener("input", (event) => {
  state.filters.q = event.target.value.trim();
  clearSelectedLog();
  scheduleRefresh();
});

els.levelSelect.addEventListener("change", (event) => {
  state.filters.level = event.target.value;
  clearSelectedLog();
  scheduleRefresh();
});

els.kindSelect.addEventListener("change", (event) => {
  state.filters.kind = event.target.value;
  clearSelectedLog();
  scheduleRefresh();
});

els.fileInput.addEventListener("input", (event) => {
  state.filters.file = event.target.value.trim();
  clearSelectedLog();
  scheduleRefresh();
});

els.sessionsToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  const nextState = !state.ui.sessionsCollapsed;
  animateSessionsPanel(nextState);
  state.ui.sessionsCollapsed = nextState;
  syncLayoutState();
});

els.sessionsPanel.addEventListener("click", (event) => {
  if (!state.ui.sessionsCollapsed) {
    return;
  }

  if (event.target.closest("#sessions-toggle")) {
    return;
  }

  state.ui.sessionsCollapsed = false;
  syncLayoutState();
  animateSessionsPanel(true);
});

els.detailClose.addEventListener("click", () => {
  state.ui.detailOpen = false;
  syncLayoutState();
  animateElements(els.detailPanel, { opacity: [1, 0], x: [0, 10] }, { duration: 0.12 });
});

els.densityToggle.addEventListener("click", () => {
  state.ui.ultraCompact = !state.ui.ultraCompact;
  syncLayoutState();
});

els.settingsToggle.addEventListener("click", () => {
  if (state.settingsOpen) {
    closeSettingsPanel();
  } else {
    openSettingsPanel();
  }
});

els.themeOptions.addEventListener("click", (event) => {
  const target = event.target.closest("[data-theme-mode]");
  if (!target) {
    return;
  }

  state.ui.themeMode = target.dataset.themeMode || "auto";
  syncLayoutState();
});

document.addEventListener("click", (event) => {
  if (!state.settingsOpen) {
    return;
  }

  if (els.settingsPanel.contains(event.target) || els.settingsToggle.contains(event.target)) {
    return;
  }

  closeSettingsPanel();
});

for (const button of els.detailCopyButtons) {
  button.addEventListener("click", async () => {
    const targetId = button.dataset.copyTarget;
    const target = targetId ? document.getElementById(targetId) : null;
    const text = target ? target.textContent || "" : "";
    const copied = await copyText(text);
    flashCopyState(button, copied);
  });
}

THEME_MEDIA.addEventListener("change", () => {
  if (state.ui.themeMode === "auto") {
    applyTheme();
  }
});

void bootstrap().finally(() => {
  connectStream();
});
