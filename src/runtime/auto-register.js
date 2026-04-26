import { installXLogger } from "./interceptor.js";

installXLogger({
  serverUrl: typeof __XLOGGER_SERVER_URL__ !== "undefined" ? __XLOGGER_SERVER_URL__ : undefined,
  projectName:
    typeof __XLOGGER_PROJECT_NAME__ !== "undefined" ? __XLOGGER_PROJECT_NAME__ : undefined,
  tool: typeof __XLOGGER_TOOL__ !== "undefined" ? __XLOGGER_TOOL__ : undefined
});
