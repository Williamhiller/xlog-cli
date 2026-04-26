export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 2718;
export const DEFAULT_DATA_DIR = ".xlogger";
export const SCHEMA_VERSION = 1;

export const CAPTURED_CONSOLE_METHODS = [
  "log",
  "info",
  "warn",
  "error",
  "debug",
  "trace",
  "table",
  "dir",
  "dirxml",
  "group",
  "groupCollapsed",
  "groupEnd",
  "assert",
  "count",
  "countReset",
  "time",
  "timeLog",
  "timeEnd"
];

export const INTERNAL_STACK_HINTS = [
  "xlogger",
  "installXLogger",
  "xloggerConsole",
  "__xlogger",
  "virtual:xlogger"
];
