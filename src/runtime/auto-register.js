import { installXLog } from "./interceptor.js";

installXLog({
  serverUrl: typeof __XLOG_SERVER_URL__ !== "undefined" ? __XLOG_SERVER_URL__ : undefined,
  projectName:
    typeof __XLOG_PROJECT_NAME__ !== "undefined" ? __XLOG_PROJECT_NAME__ : undefined,
  tool: typeof __XLOG_TOOL__ !== "undefined" ? __XLOG_TOOL__ : undefined
});
