import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { rm } from "node:fs/promises";
import { FileLogStore } from "../src/server/storage.js";

async function withStore(options, fn) {
  const root = path.join(os.tmpdir(), `xlog-storage-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const store = new FileLogStore({
    projectRoot: root,
    dataDir: ".xlog-test",
    enableSqliteIndex: options.enableSqliteIndex
  });

  try {
    await fn(store);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
}

function makePayload({ sessionId = "s1", projectName = "test-project", startedAt, logs }) {
  const baseTime = startedAt || "2026-01-01T00:00:00.000Z";
  return {
    project: { name: projectName, tool: "test" },
    session: { id: sessionId, startedAt: baseTime },
    page: { url: "http://localhost:3000", title: "Test" },
    logs
  };
}

function makeLog(index, overrides = {}) {
  const ms = Date.parse("2026-01-01T00:00:00.000Z") + index * 1000;
  return {
    occurredAt: new Date(ms).toISOString(),
    occurredAtMs: ms,
    level: "log",
    kind: "console",
    text: `message ${index}`,
    args: [{ type: "string", value: `message ${index}` }],
    callsite: { file: `src/file-${index}.js`, line: index + 1, column: 1 },
    search: { text: `message ${index}` },
    ...overrides
  };
}

describe("FileLogStore", () => {
  it("finds synthetic captures by id in JSONL fallback", async () => {
    await withStore({ enableSqliteIndex: false }, async (store) => {
      await store.appendLogs(makePayload({
        logs: [makeLog(0), makeLog(1)]
      }));

      const captures = await store.listCaptures();
      assert.equal(captures.length, 1);

      const found = await store.getCaptureById(captures[0].id);
      assert.equal(found.id, captures[0].id);
      assert.equal(found.count, 2);
    });
  });

  it("returns old capture logs even when newer logs exceed the default limit", async () => {
    await withStore({ enableSqliteIndex: false }, async (store) => {
      await store.appendLogs(makePayload({
        sessionId: "old",
        logs: [makeLog(0), makeLog(1)]
      }));

      await store.appendLogs(makePayload({
        sessionId: "new",
        startedAt: "2026-01-02T00:00:00.000Z",
        logs: Array.from({ length: 40 }, (_, index) =>
          makeLog(100 + index, {
            occurredAt: new Date(Date.parse("2026-01-02T00:00:00.000Z") + index * 1000).toISOString(),
            occurredAtMs: Date.parse("2026-01-02T00:00:00.000Z") + index * 1000
          })
        )
      }));

      const captures = await store.listCaptures();
      const oldCapture = captures.find((capture) => capture.sessionIds.includes("old"));
      const logs = await store.getLogsForCapture(oldCapture, { limit: 1 });

      assert.equal(logs.length, 2);
      assert.deepEqual(logs.map((log) => log.session.id), ["old", "old"]);
    });
  });

  it("normalizes invalid query limits to the default limit", async () => {
    await withStore({ enableSqliteIndex: false }, async (store) => {
      await store.appendLogs(makePayload({
        logs: [makeLog(0), makeLog(1), makeLog(2)]
      }));

      const logs = await store.queryLogs({ limit: "not-a-number" });
      assert.equal(logs.length, 3);
    });
  });

  it("removes whole expired files from the SQLite index during retention cleanup", async () => {
    await withStore({ enableSqliteIndex: true }, async (store) => {
      const oldMs = Date.now() - 10 * 60 * 1000;
      await store.appendLogs(makePayload({
        startedAt: new Date(oldMs).toISOString(),
        logs: [
          makeLog(0, {
            occurredAt: new Date(oldMs).toISOString(),
            occurredAtMs: oldMs,
            text: "old log"
          })
        ]
      }));

      const before = await store.queryLogs({ q: "old log" });
      assert.equal(before.length, 1);

      await store.cleanupByRetention(60 * 1000, 5 * 60 * 1000);
      const after = await store.queryLogs({ q: "old log" });
      assert.equal(after.length, 0);
    });
  });
});
