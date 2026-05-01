import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCaptureSharePayload, scoreLog, isToolingNoise, compactShareLog, PROFILES } from "../src/server/share.js";

function makeLog(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: `log-${Math.random().toString(36).slice(2)}`,
    occurredAt: now,
    occurredAtMs: Date.now(),
    level: "log",
    kind: "console",
    text: "hello",
    source: "page",
    sequence: 1,
    project: { name: "test", tool: "browser" },
    session: { id: "s1", startedAt: now },
    capture: null,
    callsite: null,
    args: [{ type: "string", value: "hello" }],
    stack: null,
    tags: ["browser"],
    extra: {},
    ...overrides
  };
}

describe("scoreLog", () => {
  it("scores errors highest", () => {
    const errorLog = makeLog({ level: "error" });
    const warnLog = makeLog({ level: "warn" });
    const logLog = makeLog({ level: "log" });
    assert.ok(scoreLog(errorLog) > scoreLog(warnLog));
    assert.ok(scoreLog(warnLog) > scoreLog(logLog));
  });

  it("scores window.error and unhandledrejection extra high", () => {
    const windowError = makeLog({ kind: "window.error", level: "error" });
    const plainError = makeLog({ kind: "console", level: "error" });
    assert.ok(scoreLog(windowError) > scoreLog(plainError));
  });

  it("scores logs with error args higher", () => {
    const withErrorArg = makeLog({
      args: [{ type: "error", name: "TypeError", message: "bad" }]
    });
    const withoutErrorArg = makeLog({
      args: [{ type: "string", value: "info" }]
    });
    assert.ok(scoreLog(withErrorArg) > scoreLog(withoutErrorArg));
  });

  it("scores logs with stack frames higher", () => {
    const withStack = makeLog({
      stack: { frames: [{ file: "app.js", line: 10 }] }
    });
    const withoutStack = makeLog({ stack: null });
    assert.ok(scoreLog(withStack) > scoreLog(withoutStack));
  });

  it("penalizes tooling noise", () => {
    const noise = makeLog({ text: "vite connected" });
    const normal = makeLog({ text: "user message" });
    assert.ok(scoreLog(noise) < scoreLog(normal));
  });

  it("boosts error-keyword text", () => {
    const errorText = makeLog({ text: "Cannot read property 'map' of undefined" });
    const normalText = makeLog({ text: "component mounted" });
    assert.ok(scoreLog(errorText) > scoreLog(normalText));
  });
});

describe("isToolingNoise", () => {
  it("detects vite HMR noise", () => {
    assert.ok(isToolingNoise(makeLog({ text: "[vite] hot updated /src/App.jsx" })));
  });

  it("detects react refresh noise", () => {
    assert.ok(isToolingNoise(makeLog({ callsite: { file: "/@react-refresh" } })));
  });

  it("does not flag normal logs", () => {
    assert.ok(!isToolingNoise(makeLog({ text: "User clicked button" })));
  });
});

describe("compactShareLog", () => {
  it("includes basic fields", () => {
    const log = makeLog({ level: "error", text: "bad thing", kind: "window.error" });
    const compact = compactShareLog(log);
    assert.equal(compact.lvl, "error");
    assert.equal(compact.msg, "bad thing");
    assert.equal(compact.kind, "window.error");
  });

  it("includes callsite location", () => {
    const log = makeLog({
      callsite: { file: "src/App.jsx", line: 42, column: 10 }
    });
    const compact = compactShareLog(log);
    assert.equal(compact.site, "src/App.jsx:42:10");
  });

  it("includes stack preview for errors", () => {
    const log = makeLog({
      args: [{
        type: "error",
        name: "TypeError",
        message: "bad",
        stack: "TypeError: bad\n    at render (App.jsx:10)\n    at commit (react.js:100)"
      }]
    });
    const compact = compactShareLog(log);
    assert.ok(Array.isArray(compact.stack));
    assert.ok(compact.stack.length > 0);
  });

  it("includes network failures when present", () => {
    const log = makeLog({
      level: "error",
      extra: {
        networkFailures: [
          { url: "/api/users", status: 500, method: "GET" }
        ]
      }
    });
    const compact = compactShareLog(log);
    assert.ok(Array.isArray(compact.net));
    assert.equal(compact.net[0].url, "/api/users");
    assert.equal(compact.net[0].status, 500);
  });

  it("respects MCP profile limits for longer text", () => {
    const longText = "x".repeat(500);
    const log = makeLog({ text: longText });
    const defaultCompact = compactShareLog(log, { limits: PROFILES.default });
    const mcpCompact = compactShareLog(log, { limits: PROFILES.mcp });
    assert.ok(mcpCompact.msg.length > defaultCompact.msg.length);
    assert.ok(mcpCompact.msg.length <= 600);
  });
});

describe("buildCaptureSharePayload", () => {
  it("returns valid payload structure", () => {
    const logs = [makeLog(), makeLog({ level: "error", text: "oops" })];
    const payload = buildCaptureSharePayload({ logs });
    assert.equal(payload.v, 1);
    assert.equal(payload.type, "xlog.capture.share");
    assert.ok(payload.capture);
    assert.ok(Array.isArray(payload.keyLogs));
  });

  it("selects error logs as key logs", () => {
    const logs = [
      makeLog({ level: "log", text: "info" }),
      makeLog({ level: "error", text: "bad error" }),
      makeLog({ level: "warn", text: "warning" })
    ];
    const payload = buildCaptureSharePayload({ logs });
    const keyLevels = payload.keyLogs.map((l) => l.lvl);
    assert.ok(keyLevels.includes("error"));
  });

  it("uses MCP profile when specified", () => {
    const longText = "x".repeat(500);
    const logs = [makeLog({ text: longText, level: "error" })];
    const defaultPayload = buildCaptureSharePayload({ logs, profile: "default" });
    const mcpPayload = buildCaptureSharePayload({ logs, profile: "mcp" });
    assert.ok(mcpPayload.keyLogs[0].msg.length > defaultPayload.keyLogs[0].msg.length);
  });

  it("handles empty logs", () => {
    const payload = buildCaptureSharePayload({ logs: [] });
    assert.equal(payload.v, 1);
    assert.equal(payload.keyLogs.length, 0);
  });
});
