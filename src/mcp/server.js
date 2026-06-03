import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { FileLogStore } from "../server/storage.js";
import { HttpLogStore } from "./http-client.js";
import { buildCaptureSharePayload, compactAiLogs, scoreLog } from "../server/share.js";
import { groupRecordsIntoCaptures } from "../server/captures.js";
import { DEFAULT_DATA_DIR } from "../shared/constants.js";
import { createXLogServer } from "../server/server.js";
import { collapseRepeatedLogs } from "../shared/repeated-logs.js";
import { createLogAnalyzer, analyzeLogsForInsights, detectLogPatterns, detectLogAnomalies, analyzeLogTrends, generateLogRecommendations } from "./log-analyzer.js";

// ── Defaults ───────────────────────────────────────────────────────

const DEFAULT_RETENTION_MS = 15 * 60 * 1000;      // 15 min (up from 5)
const DEFAULT_CAPTURE_DURATION_MS = 60 * 1000;     // 1 min
const DEFAULT_CAPTURE_GAP_MS = 10 * 1000;          // 10s inactivity → new capture
const CLEANUP_INTERVAL_MS = 30 * 1000;             // cleanup every 30s
const ERROR_RETENTION_MS = 60 * 60 * 1000;         // 1 hour for error-level logs

export function createXLogMcpServer(options = {}) {
  const projectRoot = options.root || process.cwd();
  const dataDir = options.dataDir || DEFAULT_DATA_DIR;
  const serverUrl = options.serverUrl || null;

  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  const captureDurationMs = options.captureDurationMs ?? DEFAULT_CAPTURE_DURATION_MS;
  const captureGapMs = options.captureGapMs ?? DEFAULT_CAPTURE_GAP_MS;
  const debugDomSnapshots = options.debugDomSnapshots === true;

  // 根据是否提供 serverUrl 决定使用哪种存储
  // - 如果提供了 serverUrl，使用 HttpLogStore 连接到远程服务器
  // - 否则使用本地 FileLogStore
  const store = serverUrl
    ? new HttpLogStore(serverUrl)
    : new FileLogStore({ projectRoot, dataDir });

  const server = new McpServer({ name: "xlog-mcp", version: "0.6.0" });

  // 如果使用 HTTP 客户端，不启动本地 HTTP 服务器
  // 如果是主实例（没有 serverUrl），根据配置决定是否启动 HTTP 服务器
  const startHttpServer = options.startHttpServer !== false && !serverUrl;
  const httpServerReady = startHttpServer
    ? createXLogServer({
        projectRoot,
        projectName: options.projectName,
        dataDir,
        host: options.host,
        port: options.port,
        allowFallbackPort: options.strictPort !== true,
        silent: true,
        debugDomSnapshots
      })
    : Promise.resolve(null);

  // ── Periodic cleanup ──────────────────────────────────────────────

  let cleanupTimer = null;

  async function cleanupOldLogs() {
    try {
      return await store.cleanupByRetention(retentionMs, ERROR_RETENTION_MS);
    } catch {
      return 0;
    }
  }

  // Start periodic cleanup
  cleanupTimer = setInterval(() => cleanupOldLogs(), CLEANUP_INTERVAL_MS);

  // ── Capture state ─────────────────────────────────────────────────

  let capture = null; // { startTime, message }

  // ── Dedup helpers ─────────────────────────────────────────────────

  function dedupErrors(logs) {
    const errors = logs.filter((l) => l.level === "error");
    const groups = new Map();

    for (const log of errors) {
      const key = [
        log.text || "",
        log.callsite?.file || "",
        log.callsite?.line || "",
        log.kind || ""
      ].join("|");

      if (!groups.has(key)) {
        groups.set(key, { ...log, _count: 1, _firstOccurrence: log.occurredAt });
      } else {
        groups.get(key)._count += 1;
      }
    }

    return {
      uniqueErrors: groups.size,
      totalErrors: errors.length,
      repeatedCount: errors.length - groups.size,
      deduped: [...groups.values()]
        .sort((a, b) => (b._count - a._count) || scoreLog(b) - scoreLog(a))
        .slice(0, 10)
        .map((g) => ({
          text: g.text,
          kind: g.kind,
          count: g._count,
          file: g.callsite?.file || null,
          line: g.callsite?.line || null,
          firstOccurrence: g._firstOccurrence,
          argsPreview: summarizeArgsPreview(g.args),
          stack: g.stack?.raw ? g.stack.raw.split("\n").slice(0, 3).join("\n") : null
        }))
    };
  }

  function summarizeArgsPreview(args) {
    if (!Array.isArray(args) || !args.length) return null;
    return args.slice(0, 2).map((a) => {
      if (!a || typeof a !== "object") return String(a ?? "");
      if (a.type === "error") return `${a.name || "Error"}: ${a.message || ""}`;
      if (a.type === "string") return `"${(a.value || "").slice(0, 80)}"`;
      return a.value ?? a.type ?? "";
    }).join(" ");
  }

  // ── Tool 1: xlog_analyze ──────────────────────────────────────────

  server.registerTool(
    "xlog_status",
    {
      description:
        "Report xlog MCP status and the HTTP ingest server used by browser runtimes. " +
        "Use this to confirm whether browser logs can be received.",
      inputSchema: z.object({})
    },
    async () => {
      try {
        const storage = await store.describeStorage();
        const httpServer = await httpServerReady;

        return ok({
          mcp: {
            ok: true,
            root: projectRoot,
            dataDir,
            retentionMs,
            captureDurationMs,
            captureGapMs,
            debugDomSnapshots
          },
          httpServer: httpServer
            ? {
                ok: true,
                serverUrl: httpServer.serverUrl,
                viewerUrl: httpServer.viewerUrl,
                host: httpServer.host,
                port: httpServer.port,
                dataDir: httpServer.dataDir,
                debugDomSnapshots: httpServer.debugDomSnapshots === true
              }
            : {
                ok: false,
                disabled: true
              },
          storage
        });
      } catch (err) {
        return error(err.message);
      }
    }
  );

  server.registerTool(
    "xlog_analyze",
    {
      description:
        "Analyze browser console logs. The primary tool for debugging — xLogger records logs " +
        "continuously, so most issues can be found by examining existing data.\n\n" +
        "Returns recent errors/warnings (with deduplication), a compact bugpack for AI analysis, " +
        "and optional raw logs for deeper inspection.\n\n" +
        "Logs are automatically filtered to the retention window (default: last 15 minutes). " +
        "Error-level logs are retained for 1 hour. Old logs are cleaned up periodically.",
      inputSchema: z.object({
        level: z.string().optional().describe("Filter by log level, comma-separated (error, warn, info, log, debug, trace)"),
        file: z.string().optional().describe("Filter by source file path (substring match)"),
        q: z.string().optional().describe("Full-text search across log text and stack traces"),
        from: z.string().optional().describe("Start of time range (ISO 8601). Overrides retention default."),
        to: z.string().optional().describe("End of time range (ISO 8601)"),
        project: z.string().optional().describe("Filter by project name"),
        limit: z.number().optional().describe("Max logs to analyze (default: 200)"),
        includeRaw: z.boolean().optional().describe("Include full raw logs in response (default: false; can be large)")
      })
    },
    async (params) => {
      try {
        const limit = params.limit ?? 200;

        // Default `from` to retention window if not specified
        const from = params.from || new Date(Date.now() - retentionMs).toISOString();

        const logs = await store.queryLogs({
          project: params.project || "",
          level: params.level || "",
          file: params.file || "",
          q: params.q || "",
          from,
          to: params.to || "",
          limit: String(limit)
        });

        if (!logs.length) {
          return ok({
            total: 0,
            errors: 0,
            warnings: 0,
            config: { retentionMs, captureDurationMs, captureGapMs, errorRetentionMs: ERROR_RETENTION_MS },
            message: "没有找到匹配的日志。浏览器可能未连接，或者没有产生控制台输出。"
          });
        }

        const collapsedLogs = collapseRepeatedLogs(logs);
        const stats = computeStats(logs);
        const dedup = dedupErrors(logs);
        const pages = new Set();
        for (const log of logs) {
          if (log.page?.url) pages.add(log.page.url);
        }

        // Build bugpack using captureGapMs for segmentation, MCP profile for relaxed limits
        const ordered = [...logs].reverse();
        const captures = groupRecordsIntoCaptures(ordered, { gapMs: captureGapMs });
        const cp = captures[0] || null;

        let bugpack = null;
        if (cp) {
          const captureLogs = await store.getLogsForCapture(cp, { limit });
          bugpack = buildCaptureSharePayload({
            capture: cp,
            logs: [...captureLogs].reverse(),
            profile: "mcp"
          });
        }

        const result = {
          total: logs.length,
          collapsedTotal: collapsedLogs.length,
          errors: stats.errorCount,
          warnings: stats.warnCount,
          dedup,
          pages: [...pages],
          recentErrors: stats.errors,
          bugpack,
          config: { retentionMs, captureDurationMs, captureGapMs, errorRetentionMs: ERROR_RETENTION_MS }
        };

        if (params.includeRaw) {
          result.logs = collapsedLogs;
        }

        return ok(result);
      } catch (err) {
        return error(err.message);
      }
    }
  );

  // ── Tool 2: xlog_capture ──────────────────────────────────────────

  server.registerTool(
    "xlog_capture",
    {
      description:
        "Capture a clean time window for user-driven bug reproduction. " +
        "ONLY use this when the bug requires manual reproduction steps.\n\n" +
        "For code-logic bugs, use xlog_analyze instead.\n\n" +
        "Actions:\n" +
        "  start — Mark the beginning of a capture window. Ask user to reproduce.\n" +
        "  stop  — End capture and get a clean bugpack.\n\n" +
        "Capture auto-segments at " + (DEFAULT_CAPTURE_DURATION_MS / 1000) + "s. " +
        "Logs older than " + (DEFAULT_RETENTION_MS / 60000) + "min are auto-cleaned (errors kept for 1hr).",
      inputSchema: z.object({
        action: z.enum(["start", "stop"]).describe("'start' to begin, 'stop' to end and analyze"),
        message: z.string().optional().describe("For 'start': what you're testing"),
        clear: z.boolean().optional().describe("For 'start': clear existing logs first (default: false)")
      })
    },
    async (params) => {
      try {
        if (params.action === "start") {
          if (params.clear) {
            await store.clearLogs();
          }

          const startTime = new Date().toISOString();
          capture = { startTime, message: params.message || "" };

          return ok({
            state: "capturing",
            startTime,
            message: capture.message,
            cleared: Boolean(params.clear),
            maxDuration: `${captureDurationMs / 1000}s`,
            instruction: "请用户现在复现 bug。复现完成后告诉我，我会停止捕获并分析。"
          });
        }

        if (params.action === "stop") {
          if (!capture) {
            return ok({
              state: "idle",
              instruction: "没有活跃的捕获。使用 action=start 开始。"
            });
          }

          const startTime = capture.startTime;
          const message = capture.message;
          capture = null;

          const stopTime = new Date().toISOString();
          const allLogs = await store.queryLogs({ from: startTime, to: stopTime, limit: "5000" });

          if (!allLogs.length) {
            return ok({
              state: "no_logs",
              message,
              total: 0,
              instruction: "没有捕获到日志。浏览器可能未连接。"
            });
          }

          const collapsedLogs = collapseRepeatedLogs(allLogs);
          const stats = computeStats(allLogs);
          const dedup = dedupErrors(allLogs);
          const pages = new Set();
          for (const log of allLogs) {
            if (log.page?.url) pages.add(log.page.url);
          }

          const ordered = [...allLogs].reverse();
          const captures = groupRecordsIntoCaptures(ordered, { gapMs: captureGapMs });
          const cp = captures[0] || null;

          let bugpack = null;
          if (cp) {
            const captureLogs = await store.getLogsForCapture(cp, { limit: 5000 });
            bugpack = buildCaptureSharePayload({
              capture: cp,
              logs: [...captureLogs].reverse(),
              profile: "mcp"
            });
          }

          const durationMs = allLogs[0].occurredAtMs - allLogs[allLogs.length - 1].occurredAtMs;
          const duration = `${(durationMs / 1000).toFixed(1)}s`;
          const overLimit = durationMs > captureDurationMs;

          return ok({
            state: stats.errorCount > 0 ? "errors_found" : "clean",
            message,
            startTime,
            stopTime,
            duration,
            overLimit,
            total: allLogs.length,
            collapsedTotal: collapsedLogs.length,
            errors: stats.errorCount,
            warnings: stats.warnCount,
            dedup,
            pages: [...pages],
            recentErrors: stats.errors,
            bugpack,
            instruction: overLimit
              ? `捕获时长 ${duration} 超过建议的 ${captureDurationMs / 1000}s。${stats.errorCount > 0 ? `发现 ${stats.errorCount} 个错误（${dedup.uniqueErrors} 个唯一）。` : "没有发现错误。"}`
              : stats.errorCount > 0
                ? `捕获完成。发现 ${stats.errorCount} 个错误（${dedup.uniqueErrors} 个唯一）。`
                : "捕获完成，没有发现错误。"
          });
        }

        return error(`Unknown action: ${params.action}`);
      } catch (err) {
        return error(err.message);
      }
    }
  );

  // ── Tool 3: xlog_query ────────────────────────────────────────────

  server.registerTool(
    "xlog_query",
    {
      description:
        "Query logs with full filtering. Returns compact AI-safe logs by default; " +
        "set includeRaw=true only when full serialized args are necessary.",
      inputSchema: z.object({
        level: z.string().optional().describe("Filter by log level, comma-separated"),
        kind: z.string().optional().describe("Filter by log kind"),
        file: z.string().optional().describe("Filter by source file path"),
        q: z.string().optional().describe("Full-text search"),
        from: z.string().optional().describe("Start of time range (ISO 8601)"),
        to: z.string().optional().describe("End of time range (ISO 8601)"),
        session: z.string().optional().describe("Filter by session ID"),
        capture: z.string().optional().describe("Filter by capture ID"),
        project: z.string().optional().describe("Filter by project name"),
        limit: z.number().optional().describe("Max results (default: 20)"),
        includeRaw: z.boolean().optional().describe("Include full raw logs with serialized args (default: false; can be large)")
      })
    },
    async (params) => {
      try {
        const logs = await store.queryLogs({
          project: params.project || "",
          captureId: params.capture || "",
          sessionId: params.session || "",
          level: params.level || "",
          kind: params.kind || "",
          file: params.file || "",
          q: params.q || "",
          from: params.from || "",
          to: params.to || "",
          limit: String(params.limit ?? 20)
        });
        const storage = await store.describeStorage();
        const collapsedLogs = collapseRepeatedLogs(logs);
        return ok({
          storage,
          count: logs.length,
          collapsedCount: collapsedLogs.length,
          logs: params.includeRaw ? collapsedLogs : compactAiLogs(collapsedLogs),
          compact: !params.includeRaw
        });
      } catch (err) {
        return error(err.message);
      }
    }
  );

  // ── Tool 4: xlog_context ──────────────────────────────────────────

  server.registerTool(
    "xlog_context",
    {
      description:
        "Get surrounding context for a specific log entry. " +
        "Given a log ID, returns logs before and after it within a time window. " +
        "Useful for understanding what happened around an error.",
      inputSchema: z.object({
        logId: z.string().describe("The ID of the log entry to get context for"),
        windowMs: z.number().optional().describe("Time window in ms before/after the log (default: 5000)"),
        limit: z.number().optional().describe("Max surrounding logs to return (default: 30)"),
        includeRaw: z.boolean().optional().describe("Include full raw context logs with serialized args (default: false; can be large)")
      })
    },
    async (params) => {
      try {
        const windowMs = params.windowMs ?? 5000;
        const limit = params.limit ?? 30;

        const target = await store.getLogById(params.logId);

        if (!target) {
          return error(`Log not found: ${params.logId}`);
        }

        const targetMs = target.occurredAtMs || new Date(target.occurredAt).getTime();
        const fromMs = targetMs - windowMs;
        const toMs = targetMs + windowMs;

        const contextLogs = await store.queryLogs({
          project: target.project?.name || "",
          sessionId: target.session?.id || "",
          from: new Date(fromMs).toISOString(),
          to: new Date(toMs).toISOString(),
          limit: String(limit)
        });

        // Sort ascending for context view
        contextLogs.sort((a, b) => (a.occurredAtMs || 0) - (b.occurredAtMs || 0));

        const collapsedContextLogs = collapseRepeatedLogs(contextLogs);

        return ok({
          target: {
            id: target.id,
            level: target.level,
            kind: target.kind,
            text: target.text,
            file: target.callsite?.file || null,
            line: target.callsite?.line || null,
            occurredAt: target.occurredAt
          },
          windowMs,
          total: contextLogs.length,
          collapsedTotal: collapsedContextLogs.length,
          logs: params.includeRaw ? collapsedContextLogs : compactAiLogs(collapsedContextLogs),
          compact: !params.includeRaw
        });
      } catch (err) {
        return error(err.message);
      }
    }
  );

  // ── Tool 5: xlog_diff ─────────────────────────────────────────────

  server.registerTool(
    "xlog_diff",
    {
      description:
        "Compare two captures to find differences. " +
        "Useful for regression debugging — compare a 'good' capture with a 'bad' one. " +
        "Returns differences in error counts, error types, level distributions, and new/removed stack frames.",
      inputSchema: z.object({
        captureA: z.string().describe("ID of the baseline (good) capture"),
        captureB: z.string().describe("ID of the comparison (bad) capture")
      })
    },
    async (params) => {
      try {
        const capA = await store.getCaptureById(params.captureA);
        const capB = await store.getCaptureById(params.captureB);

        if (!capA) return error(`Capture not found: ${params.captureA}`);
        if (!capB) return error(`Capture not found: ${params.captureB}`);

        const logsA = await store.getLogsForCapture(capA, { limit: 2000 });
        const logsB = await store.getLogsForCapture(capB, { limit: 2000 });

        const errorsA = logsA.filter((l) => l.level === "error");
        const errorsB = logsB.filter((l) => l.level === "error");

        // Unique error fingerprints
        const fpA = new Map();
        const fpB = new Map();
        for (const e of errorsA) {
          const key = `${e.text || ""}|${e.callsite?.file || ""}|${e.callsite?.line || ""}`;
          fpA.set(key, (fpA.get(key) || 0) + 1);
        }
        for (const e of errorsB) {
          const key = `${e.text || ""}|${e.callsite?.file || ""}|${e.callsite?.line || ""}`;
          fpB.set(key, (fpB.get(key) || 0) + 1);
        }

        const newErrors = [];
        const removedErrors = [];
        const increasedErrors = [];
        const decreasedErrors = [];

        for (const [key, countB] of fpB) {
          const countA = fpA.get(key) || 0;
          if (countA === 0) {
            const parts = key.split("|");
            newErrors.push({ text: parts[0], file: parts[1] || null, line: parts[2] || null, count: countB });
          } else if (countB > countA) {
            const parts = key.split("|");
            increasedErrors.push({ text: parts[0], file: parts[1] || null, line: parts[2] || null, from: countA, to: countB });
          } else if (countB < countA) {
            const parts = key.split("|");
            decreasedErrors.push({ text: parts[0], file: parts[1] || null, line: parts[2] || null, from: countA, to: countB });
          }
        }

        for (const [key, countA] of fpA) {
          if (!fpB.has(key)) {
            const parts = key.split("|");
            removedErrors.push({ text: parts[0], file: parts[1] || null, line: parts[2] || null, count: countA });
          }
        }

        return ok({
          captureA: { id: capA.id, totalLogs: capA.count, levels: capA.levels },
          captureB: { id: capB.id, totalLogs: capB.count, levels: capB.levels },
          diff: {
            newErrors,
            removedErrors,
            increasedErrors,
            decreasedErrors,
            summary: {
              totalA: logsA.length,
              totalB: logsB.length,
              errorsA: errorsA.length,
              errorsB: errorsB.length,
              uniqueErrorsA: fpA.size,
              uniqueErrorsB: fpB.size
            }
          }
        });
      } catch (err) {
        return error(err.message);
      }
    }
  );

  // ── Tool 6: xlog_insights ─────────────────────────────────────────

  server.registerTool(
    "xlog_insights",
    {
      description:
        "Generate AI-powered insights from browser logs. " +
        "Analyzes patterns, detects anomalies, and provides recommendations for debugging.",
      inputSchema: z.object({
        level: z.string().optional().describe("Filter by log level, comma-separated"),
        file: z.string().optional().describe("Filter by source file path"),
        q: z.string().optional().describe("Full-text search"),
        from: z.string().optional().describe("Start of time range (ISO 8601)"),
        to: z.string().optional().describe("End of time range (ISO 8601)"),
        project: z.string().optional().describe("Filter by project name"),
        limit: z.number().optional().describe("Max logs to analyze (default: 200)")
      })
    },
    async (params) => {
      try {
        const limit = params.limit ?? 200;
        const from = params.from || new Date(Date.now() - retentionMs).toISOString();

        const logs = await store.queryLogs({
          project: params.project || "",
          level: params.level || "",
          file: params.file || "",
          q: params.q || "",
          from,
          to: params.to || "",
          limit: String(limit)
        });

        if (!logs.length) {
          return ok({
            total: 0,
            insights: [],
            message: "没有找到匹配的日志。"
          });
        }

        // Generate insights
        const insights = analyzeLogsForInsights(logs);
        const patterns = detectLogPatterns(logs);
        const anomalies = detectLogAnomalies(logs);
        const trends = analyzeLogTrends(logs);
        const recommendations = generateLogRecommendations(logs);

        return ok({
          total: logs.length,
          insights,
          patterns: patterns.slice(0, 10),
          anomalies: anomalies.slice(0, 10),
          trends,
          recommendations: recommendations.slice(0, 10),
          summary: {
            errorCount: logs.filter(l => l.level === 'error').length,
            warningCount: logs.filter(l => l.level === 'warn').length,
            patternCount: patterns.length,
            anomalyCount: anomalies.length,
            recommendationCount: recommendations.length
          }
        });
      } catch (err) {
        return error(err.message);
      }
    }
  );

  // ── Tool 7: xlog_patterns ─────────────────────────────────────────

  server.registerTool(
    "xlog_patterns",
    {
      description:
        "Detect patterns in browser logs. " +
        "Identifies error bursts, repeated errors, and other recurring patterns.",
      inputSchema: z.object({
        level: z.string().optional().describe("Filter by log level"),
        from: z.string().optional().describe("Start of time range (ISO 8601)"),
        to: z.string().optional().describe("End of time range (ISO 8601)"),
        project: z.string().optional().describe("Filter by project name"),
        limit: z.number().optional().describe("Max logs to analyze (default: 500)")
      })
    },
    async (params) => {
      try {
        const limit = params.limit ?? 500;
        const from = params.from || new Date(Date.now() - retentionMs).toISOString();

        const logs = await store.queryLogs({
          project: params.project || "",
          level: params.level || "",
          from,
          to: params.to || "",
          limit: String(limit)
        });

        if (!logs.length) {
          return ok({
            total: 0,
            patterns: [],
            message: "没有找到匹配的日志。"
          });
        }

        const patterns = detectLogPatterns(logs);

        return ok({
          total: logs.length,
          patterns,
          summary: {
            errorBursts: patterns.filter(p => p.type === 'error_burst').length,
            repeatedErrors: patterns.filter(p => p.type === 'repeated_error').length,
            networkFailures: patterns.filter(p => p.type === 'network_failures').length,
            consoleErrors: patterns.filter(p => p.type === 'console_errors').length
          }
        });
      } catch (err) {
        return error(err.message);
      }
    }
  );

  // ── Tool 8: xlog_anomalies ────────────────────────────────────────

  server.registerTool(
    "xlog_anomalies",
    {
      description:
        "Detect anomalies in browser logs. " +
        "Identifies unusual patterns, spikes, and deviations from normal behavior.",
      inputSchema: z.object({
        level: z.string().optional().describe("Filter by log level"),
        from: z.string().optional().describe("Start of time range (ISO 8601)"),
        to: z.string().optional().describe("End of time range (ISO 8601)"),
        project: z.string().optional().describe("Filter by project name"),
        limit: z.number().optional().describe("Max logs to analyze (default: 500)")
      })
    },
    async (params) => {
      try {
        const limit = params.limit ?? 500;
        const from = params.from || new Date(Date.now() - retentionMs).toISOString();

        const logs = await store.queryLogs({
          project: params.project || "",
          level: params.level || "",
          from,
          to: params.to || "",
          limit: String(limit)
        });

        if (!logs.length) {
          return ok({
            total: 0,
            anomalies: [],
            message: "没有找到匹配的日志。"
          });
        }

        const anomalies = detectLogAnomalies(logs);

        return ok({
          total: logs.length,
          anomalies,
          summary: {
            highErrorRate: anomalies.filter(a => a.type === 'high_error_rate').length,
            highLogVolume: anomalies.filter(a => a.type === 'high_log_volume').length,
            errorTypeSpikes: anomalies.filter(a => a.type === 'error_type_spike').length,
            severityHigh: anomalies.filter(a => a.severity === 'high').length,
            severityMedium: anomalies.filter(a => a.severity === 'medium').length
          }
        });
      } catch (err) {
        return error(err.message);
      }
    }
  );

  // ── Tool 9: xlog_trends ───────────────────────────────────────────

  server.registerTool(
    "xlog_trends",
    {
      description:
        "Analyze trends in browser logs. " +
        "Identifies increasing/decreasing patterns in error rates and log volume.",
      inputSchema: z.object({
        level: z.string().optional().describe("Filter by log level"),
        from: z.string().optional().describe("Start of time range (ISO 8601)"),
        to: z.string().optional().describe("End of time range (ISO 8601)"),
        project: z.string().optional().describe("Filter by project name"),
        limit: z.number().optional().describe("Max logs to analyze (default: 1000)")
      })
    },
    async (params) => {
      try {
        const limit = params.limit ?? 1000;
        const from = params.from || new Date(Date.now() - retentionMs).toISOString();

        const logs = await store.queryLogs({
          project: params.project || "",
          level: params.level || "",
          from,
          to: params.to || "",
          limit: String(limit)
        });

        if (!logs.length) {
          return ok({
            total: 0,
            trends: {},
            message: "没有找到匹配的日志。"
          });
        }

        const trends = analyzeLogTrends(logs);

        return ok({
          total: logs.length,
          trends,
          summary: {
            errorRateDirection: trends.errorRate?.direction || 'stable',
            logVolumeDirection: trends.logVolume?.direction || 'stable',
            emergingPatterns: trends.emergingPatterns?.length || 0
          }
        });
      } catch (err) {
        return error(err.message);
      }
    }
  );

  // ── Cleanup on close ──────────────────────────────────────────────

  const originalClose = store.close.bind(store);
  store.close = async () => {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
    const httpServer = await httpServerReady.catch(() => null);
    if (httpServer) {
      await httpServer.close();
    }
    await originalClose();
  };

  return { server, store, httpServerReady, serverUrl };
}

// ── Helpers ─────────────────────────────────────────────────────────

function computeStats(logs) {
  let errorCount = 0;
  let warnCount = 0;
  const errors = [];

  for (const log of logs) {
    if (log.level === "error") {
      errorCount++;
      if (errors.length < 8) {
        errors.push({
          id: log.id,
          text: log.text,
          kind: log.kind || "console",
          file: log.callsite?.file || null,
          line: log.callsite?.line || null,
          argsPreview: summarizeArgsPreview(log.args),
          stack: log.stack?.raw ? log.stack.raw.split("\n").slice(0, 4).join("\n") : null
        });
      }
    } else if (log.level === "warn") {
      warnCount++;
    }
  }

  return { totalCount: logs.length, errorCount, warnCount, errors };
}

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function error(message) {
  return {
    content: [{ type: "text", text: message }],
    isError: true
  };
}
