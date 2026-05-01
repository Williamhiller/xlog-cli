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

export function isToolingNoise(log) {
  const haystack = [
    log?.text || "",
    log?.callsite?.file || "",
    log?.callsite?.url || "",
    log?.stack?.raw || "",
    log?.page?.url || ""
  ]
    .join(" ")
    .toLowerCase();

  return TOOLING_NOISE_PATTERNS.some((pattern) => haystack.includes(pattern));
}
