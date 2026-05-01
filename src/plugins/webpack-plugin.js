import path from "node:path";
import { fileURLToPath } from "node:url";
import { createXLogServer } from "../server/server.js";

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

export class XLogWebpackPlugin {
  constructor(options = {}) {
    this.options = options;
    this.defineApplied = false;
    this.serverUrl = null;
    this.serverState = null;
    this.releaseProcessCleanup = null;
  }

  async stopRegistration(compiler) {
    if (this.serverState && !this.options.serverUrl) {
      await this.serverState.close();
      this.serverState = null;
    }
  }

  apply(compiler) {
    const runtimeEntry = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../runtime/auto-register.js"
    );

    compiler.options.entry = prependEntry(compiler.options.entry, runtimeEntry);

    const ensureServer = async () => {
      if (this.options.serverUrl) {
        this.serverUrl = this.options.serverUrl;
      } else {
        this.serverState = await createXLogServer({
          projectRoot: this.options.projectRoot || compiler.context || process.cwd(),
          projectName: this.options.projectName || path.basename(compiler.context || process.cwd()),
          dataDir: this.options.dataDir,
          host: this.options.host,
          port: this.options.port,
          allowFallbackPort: this.options.strictPort !== true,
          silent: this.options.silent
        });
        this.serverUrl = this.serverState.serverUrl;
      }

      this.releaseProcessCleanup?.();
      this.releaseProcessCleanup = bindProcessCleanup(() => this.stopRegistration(compiler));

      if (!this.defineApplied) {
        const definePlugin = new compiler.webpack.DefinePlugin({
          __XLOG_SERVER_URL__: JSON.stringify(this.serverUrl),
          __XLOG_PROJECT_NAME__: JSON.stringify(
            this.options.projectName || path.basename(compiler.context || process.cwd())
          ),
          __XLOG_TOOL__: JSON.stringify("webpack")
        });

        definePlugin.apply(compiler);
        this.defineApplied = true;
      }
    };

    const stopServer = async () => {
      this.releaseProcessCleanup?.();
      this.releaseProcessCleanup = null;
      await this.stopRegistration(compiler);
    };

    compiler.hooks.beforeRun.tapPromise("XLogWebpackPlugin", ensureServer);
    compiler.hooks.watchRun.tapPromise("XLogWebpackPlugin", ensureServer);
    compiler.hooks.watchClose.tap("XLogWebpackPlugin", () => {
      void stopServer();
    });
    compiler.hooks.failed.tap("XLogWebpackPlugin", () => {
      void stopServer();
    });

    if (compiler.hooks.shutdown?.tapPromise) {
      compiler.hooks.shutdown.tapPromise("XLogWebpackPlugin", stopServer);
    }
  }
}

export default XLogWebpackPlugin;
