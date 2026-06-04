import path from "node:path";
import { fileURLToPath } from "node:url";

function prependEntry(entry, runtimeEntry) {
  if (!entry) {
    return [runtimeEntry];
  }

  if (typeof entry === "string") {
    return [runtimeEntry, entry];
  }

  if (Array.isArray(entry)) {
    return [runtimeEntry, ...entry];
  }

  if (typeof entry === "function") {
    return async () => prependEntry(await entry(), runtimeEntry);
  }

  if (typeof entry === "object") {
    if ("import" in entry) {
      return {
        ...entry,
        import: prependEntry(entry.import, runtimeEntry)
      };
    }

    return Object.fromEntries(
      Object.entries(entry).map(([key, value]) => [key, prependEntry(value, runtimeEntry)])
    );
  }

  return entry;
}

export class XLogWebpackPlugin {
  constructor(options = {}) {
    this.options = options;
    this.defineApplied = false;
    this.serverUrl = options.serverUrl || "http://127.0.0.1:2718";
  }

  apply(compiler) {
    const runtimeEntry = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../runtime/auto-register.js"
    );

    compiler.options.entry = prependEntry(compiler.options.entry, runtimeEntry);

    const applyDefines = () => {
      if (this.defineApplied) return;

      const definePlugin = new compiler.webpack.DefinePlugin({
        __XLOG_SERVER_URL__: JSON.stringify(this.serverUrl),
        __XLOG_PROJECT_NAME__: JSON.stringify(
          this.options.projectName || path.basename(compiler.context || process.cwd())
        ),
        __XLOG_TOOL__: JSON.stringify("webpack"),
        __XLOG_DEBUG_DOM_SNAPSHOTS__: JSON.stringify(this.options.debugDomSnapshots === true)
      });

      definePlugin.apply(compiler);
      this.defineApplied = true;
    };

    compiler.hooks.beforeRun.tapPromise("XLogWebpackPlugin", async () => {
      applyDefines();
    });
    compiler.hooks.watchRun.tapPromise("XLogWebpackPlugin", async () => {
      applyDefines();
    });
  }
}

export default XLogWebpackPlugin;
