import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureXLoggerDaemon,
  registerProjectRuntime,
  startRuntimeHeartbeat,
  unregisterProjectRuntime
} from "../server/daemon.js";

const AUTO_SERVER_VIRTUAL_MODULE_ID = "virtual:xlogger-client";
const RESOLVED_AUTO_SERVER_VIRTUAL_MODULE_ID = `\0${AUTO_SERVER_VIRTUAL_MODULE_ID}`;
const CLIENT_ONLY_VIRTUAL_MODULE_ID = "virtual:xlogger-client-only";
const RESOLVED_CLIENT_ONLY_VIRTUAL_MODULE_ID = `\0${CLIENT_ONLY_VIRTUAL_MODULE_ID}`;
const SCRIPT_EXT_RE = /\.[cm]?[jt]sx?$/;
const KNOWN_HTML_SOURCES = new Set(["popup", "sidepanel", "options", "dashboard"]);
const WXT_VIRTUAL_SOURCE_PATTERNS = [
  {
    pattern: /^\0?virtual:wxt-background-entrypoint\?/,
    source: "background"
  },
  {
    pattern: /^\0?virtual:wxt-content-script-(?:main-world|isolated-world)-entrypoint\?/,
    source: "content"
  },
  {
    pattern: /^\0?virtual:wxt-unlisted-script-entrypoint\?/,
    source: "unlisted-script"
  }
];
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..").replace(
  /\\/g,
  "/"
);

function createRuntimeInstallCode({ serverUrl, projectName, tool }) {
  return createRuntimeInstallSnippet({ serverUrl, projectName, tool });
}

function createRuntimeDefines({ serverUrl, projectName, tool }) {
  const define = {
    __XLOGGER_PROJECT_NAME__: JSON.stringify(projectName),
    __XLOGGER_TOOL__: JSON.stringify(tool)
  };

  if (serverUrl) {
    define.__XLOGGER_SERVER_URL__ = JSON.stringify(serverUrl);
  }

  return {
    define
  };
}

function createRuntimeInstallSnippet({ serverUrl, projectName, tool, source }) {
  return [
    `import { installXLogger } from "xlogger/runtime";`,
    "",
    "installXLogger({",
    `  serverUrl: ${JSON.stringify(serverUrl)},`,
    `  projectName: ${JSON.stringify(projectName)},`,
    `  tool: ${JSON.stringify(tool)},`,
    `  source: ${JSON.stringify(source ?? undefined)}`,
    "});"
  ].join("\n");
}

function normalizeModuleId(id) {
  return String(id || "")
    .split("?")[0]
    .replace(/\\/g, "/");
}

function getWxtEntrypointSource(id) {
  const rawId = String(id || "");

  for (const entry of WXT_VIRTUAL_SOURCE_PATTERNS) {
    if (entry.pattern.test(rawId)) {
      return entry.source;
    }
  }

  return null;
}

function inferHtmlSource(ctx) {
  const candidates = [ctx?.path, ctx?.filename]
    .filter(Boolean)
    .map((value) => normalizeModuleId(value));

  for (const candidate of candidates) {
    const basename = path.posix.basename(candidate).replace(/\.html$/i, "").toLowerCase();
    const parent = path.posix.basename(path.posix.dirname(candidate)).toLowerCase();

    if (KNOWN_HTML_SOURCES.has(basename)) {
      return basename;
    }

    if (basename === "index" && KNOWN_HTML_SOURCES.has(parent)) {
      return parent;
    }
  }

  return "page";
}

function shouldInjectRuntimeModule(id) {
  if (!id) {
    return false;
  }

  if (getWxtEntrypointSource(id)) {
    return false;
  }

  if (String(id).startsWith("\0")) {
    return false;
  }

  const cleanId = normalizeModuleId(id);

  if (!SCRIPT_EXT_RE.test(cleanId)) {
    return false;
  }

  if (cleanId.includes("/node_modules/")) {
    return false;
  }

  if (cleanId.startsWith(PACKAGE_ROOT)) {
    return false;
  }

  return true;
}

function bindProcessCleanup(cleanup) {
  const handleExit = () => {
    void cleanup();
  };

  process.once("SIGINT", handleExit);
  process.once("SIGTERM", handleExit);
  process.once("exit", handleExit);

  return () => {
    process.off("SIGINT", handleExit);
    process.off("SIGTERM", handleExit);
    process.off("exit", handleExit);
  };
}

function createRuntimeInjectionPlugin({
  virtualModuleId,
  resolvedVirtualModuleId,
  name,
  apply = "serve",
  loadRuntimeOptions
}) {
  return {
    name,
    apply,

    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }

      return null;
    },

    load(id) {
      if (id !== resolvedVirtualModuleId) {
        return null;
      }

      return createRuntimeInstallCode(loadRuntimeOptions());
    },

    transform(code, id) {
      const wxtEntrypointSource = getWxtEntrypointSource(id);
      if (wxtEntrypointSource) {
        if (code.includes("installXLogger(") || code.includes(`from "xlogger/runtime"`)) {
          return null;
        }

        return {
          code: `${createRuntimeInstallSnippet({
            ...loadRuntimeOptions(),
            source: wxtEntrypointSource
          })}\n${code}`,
          map: null
        };
      }

      if (!shouldInjectRuntimeModule(id)) {
        return null;
      }

      if (code.includes(virtualModuleId) || code.includes(`from "xlogger/runtime"`)) {
        return null;
      }

      return {
        code: `import "${virtualModuleId}";\n${code}`,
        map: null
      };
    },

    transformIndexHtml(html, ctx) {
      if (html.includes(`from "xlogger/runtime"`)) {
        return null;
      }

      return [
        {
          tag: "script",
          attrs: { type: "module" },
          children: createRuntimeInstallSnippet({
            ...loadRuntimeOptions(),
            source: inferHtmlSource(ctx)
          }),
          injectTo: "head-prepend"
        }
      ];
    }
  };
}

export function xloggerVitePlugin(options = {}) {
  let configRoot = process.cwd();
  let serverUrl = options.serverUrl;
  let heartbeat = null;
  let releaseProcessCleanup = null;

  const stopRegistration = async () => {
    heartbeat?.stop();
    heartbeat = null;

    if (serverUrl) {
      await unregisterProjectRuntime(serverUrl, {
        projectRoot: options.projectRoot || configRoot,
        projectName: options.projectName || path.basename(configRoot),
        dataDir: options.dataDir,
        tool: "vite"
      });
    }
  };

  return {
    ...createRuntimeInjectionPlugin({
      virtualModuleId: AUTO_SERVER_VIRTUAL_MODULE_ID,
      resolvedVirtualModuleId: RESOLVED_AUTO_SERVER_VIRTUAL_MODULE_ID,
      name: "xlogger",
      loadRuntimeOptions() {
        return {
          serverUrl,
          projectName: options.projectName || path.basename(configRoot),
          tool: "vite"
        };
      }
    }),
    config(config) {
      const root = config.root || process.cwd();
      return createRuntimeDefines({
        serverUrl: options.serverUrl,
        projectName: options.projectName || path.basename(root),
        tool: "vite"
      });
    },
    async configResolved(config) {
      configRoot = config.root || process.cwd();
      const daemon = await ensureXLoggerDaemon({
        host: options.host,
        port: options.port,
        silent: options.silent
      });
      serverUrl = daemon.state?.serverUrl || options.serverUrl;

      await registerProjectRuntime(serverUrl, {
        projectRoot: options.projectRoot || configRoot,
        projectName: options.projectName || path.basename(configRoot),
        dataDir: options.dataDir,
        tool: "vite"
      });

      heartbeat?.stop();
      heartbeat = startRuntimeHeartbeat(serverUrl, {
        projectRoot: options.projectRoot || configRoot,
        projectName: options.projectName || path.basename(configRoot),
        dataDir: options.dataDir,
        tool: "vite"
      });

      releaseProcessCleanup?.();
      releaseProcessCleanup = bindProcessCleanup(stopRegistration);
    },
    configureServer(viteServer) {
      viteServer.httpServer?.once("close", () => {
        releaseProcessCleanup?.();
        releaseProcessCleanup = null;
        void stopRegistration();
      });
    }
  };
}

export function xloggerViteClientPlugin(options = {}) {
  let configRoot = process.cwd();

  return {
    ...createRuntimeInjectionPlugin({
      virtualModuleId: CLIENT_ONLY_VIRTUAL_MODULE_ID,
      resolvedVirtualModuleId: RESOLVED_CLIENT_ONLY_VIRTUAL_MODULE_ID,
      name: "xlogger-client",
      loadRuntimeOptions() {
        return {
          serverUrl: options.serverUrl,
          projectName: options.projectName || path.basename(configRoot),
          tool: options.tool || "vite"
        };
      }
    }),
    config(config) {
      const root = config.root || process.cwd();
      return createRuntimeDefines({
        serverUrl: options.serverUrl,
        projectName: options.projectName || path.basename(root),
        tool: options.tool || "vite"
      });
    },
    configResolved(config) {
      configRoot = config.root || process.cwd();
    }
  };
}

export default xloggerVitePlugin;
