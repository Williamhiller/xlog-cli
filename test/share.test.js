import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collapseRepeatedLogs } from "../src/shared/repeated-logs.js";
import {
  buildCaptureSharePayload,
  scoreLog,
  isToolingNoise,
  compactShareLog,
  compactAiLog,
  compactAiLogs,
  PROFILES
} from "../src/server/share.js";

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

  it("detects repeated crawl health-check logs", () => {
    assert.ok(isToolingNoise(makeLog({ text: "[crawl] isDegraded false \"\"" })));
  });

  it("keeps warning and error logs even when text looks noisy", () => {
    assert.ok(!isToolingNoise(makeLog({ level: "warn", text: "[crawl] isDegraded false \"\"" })));
    assert.ok(!isToolingNoise(makeLog({ level: "error", text: "vite connected" })));
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

  it("keeps DOM debug snapshots compact in share payloads", () => {
    const log = makeLog({
      args: [
        { type: "string", value: "clicked" },
        {
          type: "dom",
          tagName: "BUTTON",
          selector: "button#save.primary[id=save]",
          text: "Save changes",
          hash: "fnv1a-12345678",
          tooLarge: true,
          outerHTMLSanitized: '<button id="save">Save changes</button>',
          captureMode: "debug"
        }
      ]
    });

    const compact = compactShareLog(log);
    assert.deepEqual(compact.dom, {
      selector: "button#save.primary[id=save]",
      text: "Save changes",
      hash: "fnv1a-12345678",
      tooLarge: true
    });
    assert.equal(compact.outerHTMLSanitized, undefined);
  });

  it("includes compact DOM debug snapshots in AI payloads without raw HTML", () => {
    const log = makeLog({
      args: [
        {
          type: "dom",
          tagName: "BUTTON",
          selector: "button#save.primary[id=save]",
          text: "Save changes",
          hash: "fnv1a-12345678",
          outerHTMLSanitized: '<button id="save">Save changes</button>',
          captureMode: "debug"
        }
      ]
    });

    const compact = compactAiLog(log);
    assert.deepEqual(compact.dom, {
      selector: "button#save.primary[id=save]",
      text: "Save changes",
      hash: "fnv1a-12345678"
    });
    assert.equal(compact.outerHTMLSanitized, undefined);
  });
});

describe("compactAiLog", () => {
  it("keeps identity and compact previews without raw serialized args", () => {
    const largeArgs = [
      {
        type: "object",
        ctor: "Object",
        entries: Array.from({ length: 40 }, (_, index) => ({
          key: `field${index}`,
          value: { type: "string", value: "x".repeat(1000) }
        })),
        truncated: true
      }
    ];
    const log = makeLog({
      id: "large-log",
      text: "large object",
      args: largeArgs,
      callsite: { file: "src/App.jsx", line: 9 }
    });

    const compact = compactAiLog(log);

    assert.equal(compact.id, "large-log");
    assert.equal(compact.msg, "large object");
    assert.equal(compact.site, "src/App.jsx:9");
    assert.equal(compact.args, "Object");
    assert.equal(compact.entries, undefined);
  });

  it("compacts arrays of logs", () => {
    const logs = compactAiLogs([
      makeLog({ id: "one" }),
      makeLog({ id: "two", level: "error", text: "bad" })
    ]);

    assert.deepEqual(logs.map((log) => log.id), ["one", "two"]);
    assert.equal(logs[1].lvl, "error");
  });
});

describe("collapseRepeatedLogs", () => {
  it("collapses adjacent identical logs and records repeat metadata", () => {
    const logs = [
      makeLog({ id: "a", text: "activityInfoReady false", sequence: 1, callsite: { file: "src/View.jsx", line: 68, column: 5 } }),
      makeLog({ id: "b", text: "activityInfoReady false", sequence: 2, callsite: { file: "src/View.jsx", line: 68, column: 5 } }),
      makeLog({ id: "c", text: "different", sequence: 3, callsite: { file: "src/View.jsx", line: 68, column: 5 } })
    ];

    const collapsed = collapseRepeatedLogs(logs);
    assert.equal(collapsed.length, 2);
    assert.equal(collapsed[0].repeatCount, 2);
    assert.deepEqual(collapsed[0].duplicateIds, ["a", "b"]);
  });

  it("tracks first and last occurrence timestamps in ascending order", () => {
    const logs = [
      makeLog({ id: "a", text: "same", sequence: 1, occurredAt: "2026-01-01T00:00:01.000Z", occurredAtMs: 1, callsite: { file: "src/View.jsx", line: 68, column: 5 } }),
      makeLog({ id: "b", text: "same", sequence: 2, occurredAt: "2026-01-01T00:00:02.000Z", occurredAtMs: 2, callsite: { file: "src/View.jsx", line: 68, column: 5 } })
    ];

    const collapsed = collapseRepeatedLogs(logs);
    assert.equal(collapsed[0].firstOccurredAt, "2026-01-01T00:00:01.000Z");
    assert.equal(collapsed[0].lastOccurredAt, "2026-01-01T00:00:02.000Z");
    assert.equal(collapsed[0].firstOccurredAtMs, 1);
    assert.equal(collapsed[0].lastOccurredAtMs, 2);
  });

  it("does not collapse non-adjacent duplicates", () => {
    const repeated = makeLog({ text: "same", callsite: { file: "src/View.jsx", line: 1 } });
    const collapsed = collapseRepeatedLogs([
      repeated,
      makeLog({ text: "other", callsite: { file: "src/View.jsx", line: 1 } }),
      { ...repeated, id: "later" }
    ]);

    assert.equal(collapsed.length, 3);
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

  it("collapses repeated key logs for AI payloads", () => {
    const logs = Array.from({ length: 4 }, (_, index) =>
      makeLog({
        id: `repeat-${index}`,
        text: "activityInfoReady false",
        sequence: index + 1,
        occurredAtMs: Date.now() + index,
        callsite: { file: "src/component/event/automatic/View.jsx", line: 68, column: 5 }
      })
    );

    const payload = buildCaptureSharePayload({ logs });
    assert.equal(payload.capture.totalLogs, 4);
    assert.equal(payload.capture.collapsedLogs, 1);
    assert.equal(payload.keyLogs[0].repeat, 4);
  });
});
