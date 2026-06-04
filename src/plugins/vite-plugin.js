import path from "node:path";
import { fileURLToPath } from "node:url";

const AUTO_SERVER_VIRTUAL_MODULE_ID = "virtual:xlog-client";
const RESOLVED_AUTO_SERVER_VIRTUAL_MODULE_ID = `\0${AUTO_SERVER_VIRTUAL_MODULE_ID}`;
const CLIENT_ONLY_VIRTUAL_MODULE_ID = "virtual:xlog-client-only";
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

function createRuntimeDefines({ serverUrl, projectName, tool, debugDomSnapshots, interceptMethods }) {
  const define = {
    __XLOG_PROJECT_NAME__: JSON.stringify(projectName),
    __XLOG_TOOL__: JSON.stringify(tool),
    __XLOG_DEBUG_DOM_SNAPSHOTS__: JSON.stringify(debugDomSnapshots === true)
  };

  if (serverUrl) {
    define.__XLOG_SERVER_URL__ = JSON.stringify(serverUrl);
  }

  if (interceptMethods) {
    define.__XLOG_INTERCEPT_METHODS__ = JSON.stringify(interceptMethods);
  }

  return {
    define
  };
}

function createRuntimeInstallSnippet({ serverUrl, projectName, tool, source, debugDomSnapshots, interceptMethods }) {
  return [
    `import { installXLog } from "xlog-cli/runtime";`,
    "",
    "installXLog({",
    `  serverUrl: ${JSON.stringify(serverUrl)},`,
    `  projectName: ${JSON.stringify(projectName)},`,
    `  tool: ${JSON.stringify(tool)},`,
    `  source: ${JSON.stringify(source ?? undefined)},`,
    `  debugDomSnapshots: ${JSON.stringify(debugDomSnapshots === true)},`,
    `  interceptMethods: ${JSON.stringify(interceptMethods)}`,
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
        if (code.includes("installXLog(") || code.includes(`from "xlog-cli/runtime"`)) {
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

      if (code.includes(virtualModuleId) || code.includes(`from "xlog-cli/runtime"`)) {
        return null;
      }

      return {
        code: `import "${virtualModuleId}";\n${code}`,
        map: null
      };
    },

    transformIndexHtml(html, ctx) {
      if (html.includes(`from "xlog-cli/runtime"`)) {
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

export function xlogVitePlugin(options = {}) {
  let configRoot = process.cwd();
  const serverUrl = options.serverUrl || "http://127.0.0.1:2718";

  return {
    ...createRuntimeInjectionPlugin({
      virtualModuleId: AUTO_SERVER_VIRTUAL_MODULE_ID,
      resolvedVirtualModuleId: RESOLVED_AUTO_SERVER_VIRTUAL_MODULE_ID,
      name: "xlog",
      loadRuntimeOptions() {
        return {
          serverUrl,
          projectName: options.projectName || path.basename(configRoot),
          tool: "vite",
          debugDomSnapshots: options.debugDomSnapshots === true,
          interceptMethods: options.interceptMethods || null
        };
      }
    }),
    config(config) {
      const root = config.root || process.cwd();
      return createRuntimeDefines({
        serverUrl,
        projectName: options.projectName || path.basename(root),
        tool: "vite",
        debugDomSnapshots: options.debugDomSnapshots === true,
        interceptMethods: options.interceptMethods || null
      });
    },
    configResolved(config) {
      configRoot = config.root || process.cwd();
    }
  };
}

export function xlogViteClientPlugin(options = {}) {
  let configRoot = process.cwd();

  return {
    ...createRuntimeInjectionPlugin({
      virtualModuleId: CLIENT_ONLY_VIRTUAL_MODULE_ID,
      resolvedVirtualModuleId: RESOLVED_CLIENT_ONLY_VIRTUAL_MODULE_ID,
      name: "xlog-client",
      loadRuntimeOptions() {
        return {
          serverUrl: options.serverUrl,
          projectName: options.projectName || path.basename(configRoot),
          tool: options.tool || "vite",
          debugDomSnapshots: options.debugDomSnapshots === true,
          interceptMethods: options.interceptMethods || null
        };
      }
    }),
    config(config) {
      const root = config.root || process.cwd();
      return createRuntimeDefines({
        serverUrl: options.serverUrl,
        projectName: options.projectName || path.basename(root),
        tool: options.tool || "vite",
        debugDomSnapshots: options.debugDomSnapshots === true,
        interceptMethods: options.interceptMethods || null
      });
    },
    configResolved(config) {
      configRoot = config.root || process.cwd();
    }
  };
}

export default xlogVitePlugin;
