import { installXLog } from "./interceptor.js";

installXLog({
  serverUrl: typeof __XLOG_SERVER_URL__ !== "undefined" ? __XLOG_SERVER_URL__ : undefined,
  projectName:
    typeof __XLOG_PROJECT_NAME__ !== "undefined" ? __XLOG_PROJECT_NAME__ : undefined,
  tool: typeof __XLOG_TOOL__ !== "undefined" ? __XLOG_TOOL__ : undefined,
  debugDomSnapshots:
    typeof __XLOG_DEBUG_DOM_SNAPSHOTS__ !== "undefined"
      ? __XLOG_DEBUG_DOM_SNAPSHOTS__
      : undefined,
  captureConsole:
    typeof __XLOG_CAPTURE_CONSOLE__ !== "undefined"
      ? __XLOG_CAPTURE_CONSOLE__
      : undefined,
  captureErrors:
    typeof __XLOG_CAPTURE_ERRORS__ !== "undefined"
      ? __XLOG_CAPTURE_ERRORS__
      : undefined
});
