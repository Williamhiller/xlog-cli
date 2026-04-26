import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureXLoggerDaemon,
  registerProjectRuntime,
  startRuntimeHeartbeat,
  unregisterProjectRuntime
} from "../server/daemon.js";

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

export class XLoggerWebpackPlugin {
  constructor(options = {}) {
    this.options = options;
    this.defineApplied = false;
    this.serverUrl = null;
    this.heartbeat = null;
    this.releaseProcessCleanup = null;
  }

  async stopRegistration(compiler) {
    this.heartbeat?.stop();
    this.heartbeat = null;

    if (this.serverUrl) {
      await unregisterProjectRuntime(this.serverUrl, {
        projectRoot: this.options.projectRoot || compiler.context || process.cwd(),
        projectName: this.options.projectName || path.basename(compiler.context || process.cwd()),
        dataDir: this.options.dataDir,
        tool: "webpack"
      });
    }
  }

  apply(compiler) {
    const runtimeEntry = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../runtime/auto-register.js"
    );

    compiler.options.entry = prependEntry(compiler.options.entry, runtimeEntry);

    const ensureServer = async () => {
      const daemon = await ensureXLoggerDaemon({
        host: this.options.host,
        port: this.options.port,
        silent: this.options.silent
      });
      this.serverUrl = daemon.state?.serverUrl;

      await registerProjectRuntime(this.serverUrl, {
        projectRoot: this.options.projectRoot || compiler.context || process.cwd(),
        projectName: this.options.projectName || path.basename(compiler.context || process.cwd()),
        dataDir: this.options.dataDir,
        tool: "webpack"
      });

      this.heartbeat?.stop();
      this.heartbeat = startRuntimeHeartbeat(this.serverUrl, {
        projectRoot: this.options.projectRoot || compiler.context || process.cwd(),
        projectName: this.options.projectName || path.basename(compiler.context || process.cwd()),
        dataDir: this.options.dataDir,
        tool: "webpack"
      });

      this.releaseProcessCleanup?.();
      this.releaseProcessCleanup = bindProcessCleanup(() => this.stopRegistration(compiler));

      if (!this.defineApplied) {
        const definePlugin = new compiler.webpack.DefinePlugin({
          __XLOGGER_SERVER_URL__: JSON.stringify(this.serverUrl),
          __XLOGGER_PROJECT_NAME__: JSON.stringify(
            this.options.projectName || path.basename(compiler.context || process.cwd())
          ),
          __XLOGGER_TOOL__: JSON.stringify("webpack")
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

    compiler.hooks.beforeRun.tapPromise("XLoggerWebpackPlugin", ensureServer);
    compiler.hooks.watchRun.tapPromise("XLoggerWebpackPlugin", ensureServer);
    compiler.hooks.watchClose.tap("XLoggerWebpackPlugin", () => {
      void stopServer();
    });
    compiler.hooks.failed.tap("XLoggerWebpackPlugin", () => {
      void stopServer();
    });

    if (compiler.hooks.shutdown?.tapPromise) {
      compiler.hooks.shutdown.tapPromise("XLoggerWebpackPlugin", stopServer);
    }
  }
}

export default XLoggerWebpackPlugin;
