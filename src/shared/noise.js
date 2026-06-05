export const TOOLING_NOISE_PATTERNS = [
  "/@vite/client",
  "/@react-refresh",
  "reload-html-",
  "[wxt]",
  "vite connected",
  "vite connecting",
  "vite ping",
  "hmr",
  "hot updated"
];

const LOW_SIGNAL_LOG_PATTERNS = [
  /\[crawl\]\s+isdegraded\s+false\b/i
];

// 扩展环境常见噪音（error/warn 级别也会过滤）
const EXTENSION_NOISE_PATTERNS = [
  "receiving end does not exist",
  "the message port closed before a response was received",
  "could not establish connection",
  "extension context invalidated",
  "the extensions directory could not be found",
  "chrome.runtime.sendMessage",
  "browser.runtime.sendMessage",
  "listener indicated an asynchronous response",
  "a listener indicated an asynchronous response by returning true"
];

export function isToolingNoise(log) {
  const level = String(log?.level || "").toLowerCase();

  const haystack = [
    log?.text || "",
    log?.callsite?.file || "",
    log?.callsite?.url || "",
    log?.stack?.raw || "",
    log?.page?.url || ""
  ]
    .join(" ")
    .toLowerCase();

  // 扩展环境噪音：error/warn 也过滤
  if (EXTENSION_NOISE_PATTERNS.some((pattern) => haystack.includes(pattern))) {
    return true;
  }

  if (level === "error" || level === "warn") {
    return false;
  }

  return (
    TOOLING_NOISE_PATTERNS.some((pattern) => haystack.includes(pattern)) ||
    LOW_SIGNAL_LOG_PATTERNS.some((pattern) => pattern.test(haystack))
  );
}
