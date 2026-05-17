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

export function isToolingNoise(log) {
  const level = String(log?.level || "").toLowerCase();
  if (level === "error" || level === "warn") {
    return false;
  }

  const haystack = [
    log?.text || "",
    log?.callsite?.file || "",
    log?.callsite?.url || "",
    log?.stack?.raw || "",
    log?.page?.url || ""
  ]
    .join(" ")
    .toLowerCase();

  return (
    TOOLING_NOISE_PATTERNS.some((pattern) => haystack.includes(pattern)) ||
    LOW_SIGNAL_LOG_PATTERNS.some((pattern) => pattern.test(haystack))
  );
}
