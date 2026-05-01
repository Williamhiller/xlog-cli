import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupRecordsIntoCaptures } from "../src/server/captures.js";

function makeRecord(overrides = {}) {
  const now = overrides.occurredAt || new Date().toISOString();
  return {
    occurredAt: now,
    occurredAtMs: new Date(now).getTime(),
    level: "log",
    kind: "console",
    project: { name: "test-project", tool: "browser" },
    session: { id: "session-1", startedAt: now },
    capture: null,
    page: { url: "http://localhost:3000", title: "Test" },
    ...overrides
  };
}

describe("groupRecordsIntoCaptures", () => {
  it("returns empty array for empty input", () => {
    assert.deepEqual(groupRecordsIntoCaptures([]), []);
  });

  it("groups a single record into one capture", () => {
    const records = [makeRecord()];
    const captures = groupRecordsIntoCaptures(records);
    assert.equal(captures.length, 1);
    assert.equal(captures[0].count, 1);
    assert.equal(captures[0].project.name, "test-project");
  });

  it("groups records within the gap into one capture", () => {
    const t0 = Date.now();
    const records = [
      makeRecord({ occurredAtMs: t0, occurredAt: new Date(t0).toISOString() }),
      makeRecord({ occurredAtMs: t0 + 5000, occurredAt: new Date(t0 + 5000).toISOString() }),
      makeRecord({ occurredAtMs: t0 + 10000, occurredAt: new Date(t0 + 10000).toISOString() })
    ];
    const captures = groupRecordsIntoCaptures(records, { gapMs: 15000 });
    assert.equal(captures.length, 1);
    assert.equal(captures[0].count, 3);
  });

  it("splits records that exceed the gap into separate captures", () => {
    const t0 = Date.now();
    const records = [
      makeRecord({ occurredAtMs: t0, occurredAt: new Date(t0).toISOString() }),
      makeRecord({ occurredAtMs: t0 + 100000, occurredAt: new Date(t0 + 100000).toISOString() })
    ];
    const captures = groupRecordsIntoCaptures(records, { gapMs: 10000 });
    assert.equal(captures.length, 2);
    assert.equal(captures[0].count, 1);
    assert.equal(captures[1].count, 1);
  });

  it("groups by explicit capture ID", () => {
    const t0 = Date.now();
    const records = [
      makeRecord({
        occurredAtMs: t0,
        occurredAt: new Date(t0).toISOString(),
        capture: { id: "cap-1", startedAt: new Date(t0).toISOString() }
      }),
      makeRecord({
        occurredAtMs: t0 + 200000,
        occurredAt: new Date(t0 + 200000).toISOString(),
        capture: { id: "cap-1", startedAt: new Date(t0).toISOString() }
      })
    ];
    const captures = groupRecordsIntoCaptures(records, { gapMs: 10000 });
    assert.equal(captures.length, 1);
    assert.equal(captures[0].id, "cap-1");
    assert.equal(captures[0].count, 2);
  });

  it("tracks level distribution", () => {
    const t0 = Date.now();
    const records = [
      makeRecord({ occurredAtMs: t0, occurredAt: new Date(t0).toISOString(), level: "error" }),
      makeRecord({ occurredAtMs: t0 + 100, occurredAt: new Date(t0 + 100).toISOString(), level: "warn" }),
      makeRecord({ occurredAtMs: t0 + 200, occurredAt: new Date(t0 + 200).toISOString(), level: "error" })
    ];
    const captures = groupRecordsIntoCaptures(records);
    assert.equal(captures[0].levels.error, 2);
    assert.equal(captures[0].levels.warn, 1);
  });

  it("tracks session IDs", () => {
    const t0 = Date.now();
    const records = [
      makeRecord({ occurredAtMs: t0, occurredAt: new Date(t0).toISOString(), session: { id: "s1" } }),
      makeRecord({ occurredAtMs: t0 + 100, occurredAt: new Date(t0 + 100).toISOString(), session: { id: "s2" } })
    ];
    const captures = groupRecordsIntoCaptures(records);
    assert.equal(captures[0].sessionCount, 2);
    assert.deepEqual(captures[0].sessionIds.sort(), ["s1", "s2"]);
  });

  it("tracks page titles and URLs", () => {
    const t0 = Date.now();
    const records = [
      makeRecord({
        occurredAtMs: t0,
        occurredAt: new Date(t0).toISOString(),
        page: { url: "http://a.com", title: "Page A" }
      }),
      makeRecord({
        occurredAtMs: t0 + 100,
        occurredAt: new Date(t0 + 100).toISOString(),
        page: { url: "http://b.com", title: "Page B" }
      })
    ];
    const captures = groupRecordsIntoCaptures(records);
    assert.deepEqual(captures[0].pageTitles, ["Page A", "Page B"]);
    assert.deepEqual(captures[0].pageUrls, ["http://a.com", "http://b.com"]);
  });

  it("returns captures sorted by lastSeen descending", () => {
    const t0 = Date.now();
    const records = [
      makeRecord({ occurredAtMs: t0, occurredAt: new Date(t0).toISOString() }),
      makeRecord({ occurredAtMs: t0 + 200000, occurredAt: new Date(t0 + 200000).toISOString() })
    ];
    const captures = groupRecordsIntoCaptures(records, { gapMs: 10000 });
    assert.equal(captures.length, 2);
    assert.ok(captures[0].lastSeenMs >= captures[1].lastSeenMs);
  });

  it("filters by project name", () => {
    const t0 = Date.now();
    const records = [
      makeRecord({ occurredAtMs: t0, occurredAt: new Date(t0).toISOString(), project: { name: "a" } }),
      makeRecord({ occurredAtMs: t0 + 100, occurredAt: new Date(t0 + 100).toISOString(), project: { name: "b" } })
    ];
    const captures = groupRecordsIntoCaptures(records, { project: "a" });
    assert.equal(captures.length, 1);
    assert.equal(captures[0].project.name, "a");
  });
});
