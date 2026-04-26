import http from "node:http";
import net from "node:net";
import path from "node:path";
import { FileLogStore } from "./storage.js";
import { buildCaptureShareFileName, buildCaptureSharePayload } from "./share.js";
import {
  buildViewerHtml,
  getBuiltViewerAsset,
  getVendorAsset,
  getViewerTextAsset,
  hasBuiltReactViewer
} from "./viewer.js";
import { DEFAULT_DATA_DIR, DEFAULT_HOST, DEFAULT_PORT } from "../shared/constants.js";

const SERVER_KEY = "__xlogger_server_singleton__";
const REGISTRATION_TTL_MS = 30 * 1000;
const IDLE_SHUTDOWN_DELAY_MS = 15 * 1000;

function getState() {
  return globalThis[SERVER_KEY] || null;
}

function setState(value) {
  globalThis[SERVER_KEY] = value;
}

function parseJsonBody(req, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }

      body += chunk.toString("utf8");
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function writeJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function writeText(res, statusCode, contentType, body) {
  res.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  res.end(body);
}

function writeBuffer(res, statusCode, contentType, body) {
  res.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  res.end(body);
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".woff2":
      return "font/woff2";
    case ".woff":
      return "font/woff";
    case ".ttf":
      return "font/ttf";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function applyCors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

function createSseMessage(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function projectNameFromRoot(projectRoot) {
  return path.basename(projectRoot || process.cwd()) || "unknown-project";
}

async function portAvailable(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();

    probe.on("error", () => resolve(false));

    probe.listen({ port, host }, () => {
      probe.close(() => resolve(true));
    });
  });
}

async function resolvePort(preferredPort, host, allowFallback = true) {
  if (!allowFallback) {
    return preferredPort;
  }

  for (let offset = 0; offset < 12; offset += 1) {
    const candidate = preferredPort + offset;
    if (await portAvailable(candidate, host)) {
      return candidate;
    }
  }

  return preferredPort;
}

function toRegistrationKey(payload = {}) {
  return `${String(payload.projectRoot || "").trim()}::${String(payload.pid || "")}`;
}

function toRegistrationRecord(payload = {}) {
  const now = new Date().toISOString();
  return {
    key: toRegistrationKey(payload),
    pid: Number(payload.pid || 0) || 0,
    projectRoot: String(payload.projectRoot || "").trim(),
    projectName: String(payload.projectName || "unknown-project").trim() || "unknown-project",
    tool: String(payload.tool || "unknown").trim() || "unknown",
    dataDir: payload.dataDir || null,
    registeredAt: payload.registeredAt || now,
    lastHeartbeatAt: now
  };
}

function pruneRegistrations(registrations) {
  const now = Date.now();

  for (const [key, registration] of registrations.entries()) {
    const lastHeartbeatMs = new Date(registration.lastHeartbeatAt || registration.registeredAt || 0).getTime();
    if (!Number.isFinite(lastHeartbeatMs) || now - lastHeartbeatMs > REGISTRATION_TTL_MS) {
      registrations.delete(key);
    }
  }
}

function serializeRegistrations(registrations) {
  return [...registrations.values()].sort((left, right) => {
    return String(left.projectName).localeCompare(String(right.projectName)) || Number(left.pid) - Number(right.pid);
  });
}

export async function createXLoggerServer(options = {}) {
  const existing = getState();
  if (existing && existing.ready) {
    return existing.ready;
  }

  const host = options.host || DEFAULT_HOST;
  const preferredPort = Number(options.port || DEFAULT_PORT);
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const dataDir = options.dataDir || DEFAULT_DATA_DIR;
  const projectName = options.projectName || projectNameFromRoot(projectRoot);
  const store = new FileLogStore({ projectRoot, dataDir });
  const sseClients = new Set();
  const registrations = new Map();
  let idleShutdownTimer = null;
  let state = null;

  const scheduleIdleShutdown = () => {
    if (!options.sharedDaemon) {
      return;
    }

    pruneRegistrations(registrations);
    if (registrations.size > 0 || idleShutdownTimer || !state) {
      return;
    }

    idleShutdownTimer = setTimeout(() => {
      idleShutdownTimer = null;
      pruneRegistrations(registrations);
      if (!registrations.size) {
        void state.close();
      }
    }, IDLE_SHUTDOWN_DELAY_MS);
  };

  const cancelIdleShutdown = () => {
    if (!idleShutdownTimer) {
      return;
    }

    clearTimeout(idleShutdownTimer);
    idleShutdownTimer = null;
  };

  const ready = (async () => {
    const port = await resolvePort(preferredPort, host, options.allowFallbackPort !== false);

    const server = http.createServer(async (req, res) => {
      applyCors(res);

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);

      if (req.method === "GET" && url.pathname === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/viewer")) {
        writeText(
          res,
          200,
          "text/html; charset=utf-8",
          await buildViewerHtml({ title: `xlogger | ${projectName}` })
        );
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/viewer/")) {
        const builtViewerEnabled = await hasBuiltReactViewer();
        const assetPath = url.pathname.slice("/viewer/".length);

        if (builtViewerEnabled) {
          const builtAsset = await getBuiltViewerAsset(assetPath);
          if (builtAsset) {
            writeBuffer(res, 200, getContentType(assetPath), builtAsset);
            return;
          }
        }

        if (assetPath === "viewer.css" || assetPath === "viewer.js") {
          writeText(
            res,
            200,
            getContentType(assetPath),
            await getViewerTextAsset(assetPath)
          );
          return;
        }
      }

      if (req.method === "GET" && url.pathname.startsWith("/vendor/")) {
        const vendorPath = url.pathname.slice("/vendor/".length);
        const slashIndex = vendorPath.indexOf("/");
        const vendor = slashIndex === -1 ? vendorPath : vendorPath.slice(0, slashIndex);
        const assetPath = slashIndex === -1 ? "" : vendorPath.slice(slashIndex + 1);
        const body = await getVendorAsset(vendor, assetPath);

        if (!body) {
          writeJson(res, 404, {
            ok: false,
            error: "Vendor asset not found"
          });
          return;
        }

        writeBuffer(res, 200, getContentType(assetPath), body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/health") {
        pruneRegistrations(registrations);
        const storage = await store.describeStorage();
        writeJson(res, 200, {
          ok: true,
          projectName,
          dataDir: path.resolve(projectRoot, dataDir),
          storage,
          sharedDaemon: Boolean(options.sharedDaemon),
          registrations: serializeRegistrations(registrations)
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/runtime/status") {
        pruneRegistrations(registrations);
        writeJson(res, 200, {
          ok: true,
          registrations: serializeRegistrations(registrations)
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runtime/register") {
        const payload = toRegistrationRecord(await parseJsonBody(req));
        if (!payload.projectRoot || !payload.pid) {
          writeJson(res, 400, {
            ok: false,
            error: "Invalid registration"
          });
          return;
        }

        registrations.set(payload.key, payload);
        cancelIdleShutdown();
        writeJson(res, 200, {
          ok: true,
          registration: payload,
          registrations: serializeRegistrations(registrations)
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runtime/heartbeat") {
        const payload = toRegistrationRecord(await parseJsonBody(req));
        if (!payload.projectRoot || !payload.pid) {
          writeJson(res, 400, {
            ok: false,
            error: "Invalid heartbeat"
          });
          return;
        }

        const current = registrations.get(payload.key);
        registrations.set(payload.key, {
          ...payload,
          registeredAt: current?.registeredAt || payload.registeredAt,
          lastHeartbeatAt: new Date().toISOString()
        });
        cancelIdleShutdown();
        writeJson(res, 200, {
          ok: true
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runtime/unregister") {
        const payload = toRegistrationRecord(await parseJsonBody(req));
        registrations.delete(payload.key);
        scheduleIdleShutdown();
        writeJson(res, 200, {
          ok: true,
          registrations: serializeRegistrations(registrations)
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/stream") {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive"
        });

        res.write(createSseMessage({ type: "connected", at: new Date().toISOString() }));
        sseClients.add(res);

        const keepAlive = setInterval(() => {
          res.write(": ping\n\n");
        }, 15000);

        req.on("close", () => {
          clearInterval(keepAlive);
          sseClients.delete(res);
        });

        return;
      }

      if (req.method === "GET" && url.pathname === "/api/sessions") {
        const sessions = await store.listSessions({
          project: url.searchParams.get("project") || ""
        });
        const storage = await store.describeStorage();

        writeJson(res, 200, {
          sessions,
          storage
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/captures") {
        const captures = await store.listCaptures({
          project: url.searchParams.get("project") || ""
        });
        const storage = await store.describeStorage();

        writeJson(res, 200, {
          captures,
          storage
        });
        return;
      }

      const captureMatch = url.pathname.match(/^\/api\/captures\/([^/]+)$/);
      if (req.method === "DELETE" && captureMatch) {
        const captureId = decodeURIComponent(captureMatch[1] || "");
        const capture = await store.getCaptureById(captureId);

        if (!capture) {
          writeJson(res, 404, {
            ok: false,
            error: "Capture not found"
          });
          return;
        }

        const deletion = await store.deleteCapture(capture);
        const captures = await store.listCaptures({
          project: url.searchParams.get("project") || ""
        });
        const storage = await store.describeStorage();

        writeJson(res, 200, {
          ok: true,
          captureId,
          deletedCount: deletion.deletedCount,
          captures,
          storage
        });
        return;
      }

      const captureShareMatch = url.pathname.match(/^\/api\/captures\/([^/]+)\/share\.json$/);
      if (req.method === "GET" && captureShareMatch) {
        const captureId = decodeURIComponent(captureShareMatch[1] || "");
        const capture = await store.getCaptureById(captureId);
        const logs = await store.getLogsForCapture(capture, {
          limit: "5000"
        });

        if (!capture && !logs.length) {
          writeJson(res, 404, {
            ok: false,
            error: "Capture not found"
          });
          return;
        }

        const sharePayload = buildCaptureSharePayload({
          capture,
          logs,
          shareUrl: `${url.origin}${url.pathname}`
        });

        writeJson(
          res,
          200,
          sharePayload,
          {
            "content-disposition": `inline; filename="${buildCaptureShareFileName(sharePayload.capture)}"`
          }
        );
        return;
      }

      if (req.method === "GET" && (url.pathname === "/api/x-log" || url.pathname === "/api/logs")) {
        const logs = await store.queryLogs({
          project: url.searchParams.get("project") || "",
          captureId: url.searchParams.get("captureId") || "",
          sessionId: url.searchParams.get("sessionId") || "",
          sessionIds: url.searchParams.get("sessionIds") || "",
          level: url.searchParams.get("level") || "",
          kind: url.searchParams.get("kind") || "",
          file: url.searchParams.get("file") || "",
          q: url.searchParams.get("q") || "",
          from: url.searchParams.get("from") || "",
          to: url.searchParams.get("to") || "",
          limit: url.searchParams.get("limit") || "200"
        });
        const storage = await store.describeStorage();

        writeJson(res, 200, {
          logs,
          storage
        });
        return;
      }

      if (req.method === "POST" && (url.pathname === "/api/x-log" || url.pathname === "/api/logs")) {
        try {
          const payload = await parseJsonBody(req);
          const result = await store.appendLogs(payload);

          if (result.records.length) {
            const message = createSseMessage({
              type: "logs",
              records: result.records
            });

            for (const client of sseClients) {
              client.write(message);
            }
          }

          writeJson(res, 201, {
            ok: true,
            stored: result.records.length,
            indexed: result.indexed,
            indexDriver: result.indexDriver,
            filePath: result.filePath,
            sqlitePath: result.sqlitePath
          });
        } catch (error) {
          writeJson(res, 400, {
            ok: false,
            error: error instanceof Error ? error.message : "Invalid payload"
          });
        }

        return;
      }

      if (req.method === "DELETE" && (url.pathname === "/api/x-log" || url.pathname === "/api/logs")) {
        try {
          await store.clearLogs();
          const storage = await store.describeStorage();
          const message = createSseMessage({
            type: "logs-cleared",
            at: new Date().toISOString()
          });

          for (const client of sseClients) {
            client.write(message);
          }

          writeJson(res, 200, {
            ok: true,
            storage
          });
        } catch (error) {
          writeJson(res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : "Failed to clear logs"
          });
        }

        return;
      }

      writeJson(res, 404, {
        ok: false,
        error: "Not found"
      });
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });

    state = {
      host,
      port,
      server,
      projectName,
      projectRoot,
      dataDir: path.resolve(projectRoot, dataDir),
      serverUrl: `http://${host}:${port}`,
      viewerUrl: `http://${host}:${port}/`,
      close: async () => {
        cancelIdleShutdown();
        registrations.clear();
        await store.close();
        await new Promise((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        });
        delete globalThis[SERVER_KEY];
      }
    };

    if (!options.silent) {
      console.log(
        `[xlogger] listening on ${state.serverUrl} | viewer ${state.viewerUrl} | store ${state.dataDir}`
      );
    }

    return state;
  })();

  setState({ ready });
  return ready;
}
