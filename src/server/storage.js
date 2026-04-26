import { appendFile, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_DATA_DIR, SCHEMA_VERSION } from "../shared/constants.js";
import { compactFilePath } from "../shared/stack.js";
import { createSQLiteLogIndex } from "./sqlite-index.js";
import { groupRecordsIntoCaptures } from "./captures.js";

function slugify(value) {
  const output = String(value || "unknown-project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return output || "project";
}

function toArray(input) {
  if (!input) {
    return [];
  }

  return Array.isArray(input) ? input : [input];
}

async function walkFiles(dir) {
  let entries = [];

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const output = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      output.push(...(await walkFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      output.push(fullPath);
    }
  }

  return output;
}

async function readJsonLines(filePath) {
  const contents = await readFile(filePath, "utf8");
  const records = [];

  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      records.push(JSON.parse(line));
    } catch {
      continue;
    }
  }

  return records;
}

function toEpochMs(value) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeFilters(filters = {}) {
  const sessionIds = String(filters.sessionIds || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    project: filters.project || "",
    captureId: filters.captureId || "",
    sessionId: filters.sessionId || "",
    sessionIds,
    kind: filters.kind || "",
    levels: String(filters.level || filters.levels || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    file: filters.file || "",
    q: filters.q || "",
    from: filters.from ? new Date(filters.from).getTime() : null,
    to: filters.to ? new Date(filters.to).getTime() : null,
    limit: Number(filters.limit || 200)
  };
}

function matchesFilter(record, filters) {
  if (filters.project && record.project.name !== filters.project) {
    return false;
  }

  if (filters.sessionId && record.session.id !== filters.sessionId) {
    return false;
  }

  if (filters.captureId && record.capture?.id !== filters.captureId) {
    return false;
  }

  if (filters.sessionIds.length && !filters.sessionIds.includes(record.session.id)) {
    return false;
  }

  if (filters.kind && record.kind !== filters.kind) {
    return false;
  }

  if (filters.levels.length && !filters.levels.includes(record.level)) {
    return false;
  }

  if (filters.file) {
    const fileName = record.callsite && record.callsite.file ? record.callsite.file : "";
    if (!fileName.toLowerCase().includes(filters.file.toLowerCase())) {
      return false;
    }
  }

  if (filters.from && new Date(record.occurredAt).getTime() < filters.from) {
    return false;
  }

  if (filters.to && new Date(record.occurredAt).getTime() > filters.to) {
    return false;
  }

  if (filters.q) {
    const haystack = String(record.search && record.search.text ? record.search.text : "").toLowerCase();
    if (!haystack.includes(filters.q.toLowerCase())) {
      return false;
    }
  }

  return true;
}

function selectLogsForCapture(logs, capture) {
  if (!capture || !Array.isArray(logs) || !logs.length) {
    return [];
  }

  const explicitMatches = logs.filter((record) => record.capture?.id === capture.id);
  if (explicitMatches.length) {
    return explicitMatches;
  }

  const sessionIds = new Set(Array.isArray(capture.sessionIds) ? capture.sessionIds : []);
  const firstSeenMs = Number(capture.firstSeenMs || 0) || toEpochMs(capture.firstSeen);
  const lastSeenMs = Number(capture.lastSeenMs || 0) || toEpochMs(capture.lastSeen);

  return logs.filter((record) => {
    const occurredAtMs = Number(record.occurredAtMs || 0) || toEpochMs(record.occurredAt);
    const inWindow = occurredAtMs >= firstSeenMs && occurredAtMs <= lastSeenMs;
    const inSession = !sessionIds.size || sessionIds.has(record.session?.id);
    return inWindow && inSession;
  });
}

async function rewriteJsonlFile(filePath, records) {
  if (!records.length) {
    await unlink(filePath).catch(() => {});
    return;
  }

  await writeFile(
    filePath,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8"
  );
}

export class FileLogStore {
  constructor({
    projectRoot = process.cwd(),
    dataDir = DEFAULT_DATA_DIR,
    enableSqliteIndex = true
  } = {}) {
    this.rootDir = path.resolve(projectRoot, dataDir);
    this.enableSqliteIndex = enableSqliteIndex;
    this.sqlitePromise = null;
    this.sqliteDisabledReason = null;
    this.sqliteBackfilled = false;
  }

  get projectDir() {
    return path.join(this.rootDir, "projects");
  }

  get sqlitePath() {
    return path.join(this.rootDir, "index.sqlite");
  }

  sessionFilePath(projectName, sessionId, startedAt) {
    const projectSlug = slugify(projectName);
    const dateKey = String(startedAt || new Date().toISOString()).slice(0, 10);
    return path.join(this.projectDir, projectSlug, "sessions", dateKey, `${sessionId}.jsonl`);
  }

  async backfillSqliteIndex(index) {
    if (this.sqliteBackfilled) {
      return;
    }

    if (index.countLogs() > 0) {
      this.sqliteBackfilled = true;
      return;
    }

    const files = await walkFiles(this.projectDir);
    for (const filePath of files) {
      const records = await readJsonLines(filePath);
      if (!records.length) {
        continue;
      }

      index.appendRecords(records);
    }

    this.sqliteBackfilled = true;
  }

  disableSqliteIndex(error) {
    this.sqliteDisabledReason = error instanceof Error ? error.message : String(error || "Unknown error");
    this.sqlitePromise = Promise.resolve(null);
  }

  async getSqliteIndex() {
    if (!this.enableSqliteIndex || this.sqliteDisabledReason) {
      return null;
    }

    if (!this.sqlitePromise) {
      this.sqlitePromise = (async () => {
        const index = await createSQLiteLogIndex({
          rootDir: this.rootDir,
          sessionFilePath: this.sessionFilePath.bind(this)
        });

        if (!index) {
          this.sqliteDisabledReason =
            "node:sqlite is unavailable in this Node runtime; using JSONL scan fallback";
          return null;
        }

        await this.backfillSqliteIndex(index);
        return index;
      })().catch((error) => {
        this.disableSqliteIndex(error);
        return null;
      });
    }

    return this.sqlitePromise;
  }

  async describeStorage() {
    const sqlite = await this.getSqliteIndex();
    return {
      rawDir: this.projectDir,
      sqlitePath: this.sqlitePath,
      queryDriver: sqlite ? "sqlite" : "jsonl",
      sqliteEnabled: Boolean(sqlite),
      sqliteDisabledReason: this.sqliteDisabledReason
    };
  }

  normalizeRecord(payload, log, index) {
    const receivedAt = new Date().toISOString();
    const occurredAt = log.occurredAt || log.ts || receivedAt;
    const occurredAtMs = Number(log.occurredAtMs || 0) || toEpochMs(occurredAt);
    const receivedAtMs = Number(log.receivedAtMs || 0) || toEpochMs(receivedAt);
    const project = payload.project || {};
    const session = payload.session || {};
    const page = payload.page || {};
    const source = payload.source || log.source || null;
    const tags = toArray(log.tags);
    if (source && !tags.includes(`source:${source}`)) {
      tags.push(`source:${source}`);
    }
    const normalizedCallsite =
      log.callsite && typeof log.callsite === "object"
        ? {
            ...log.callsite,
            file: compactFilePath(log.callsite.file)
          }
        : null;
    const file = normalizedCallsite && normalizedCallsite.file ? normalizedCallsite.file : "";
    const text = log.text || "";
    const searchText = [
      source,
      project.name,
      project.tool,
      log.level,
      log.kind,
      file,
      text,
      log.stack && log.stack.raw ? log.stack.raw : ""
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return {
      schemaVersion: SCHEMA_VERSION,
      id: crypto.randomUUID(),
      receivedAt,
      receivedAtMs,
      occurredAt,
      occurredAtMs,
      level: log.level || "log",
      method: log.method || log.level || "log",
      kind: log.kind || "console",
      source,
      sequence: log.sequence || index + 1,
      project: {
        name: project.name || "unknown-project",
        tool: project.tool || "browser",
        key: project.key || null
      },
      capture: payload.capture
        ? {
            id: payload.capture.id || null,
            startedAt: payload.capture.startedAt || occurredAt
          }
        : null,
      session: {
        id: session.id || crypto.randomUUID(),
        startedAt: session.startedAt || occurredAt
      },
      page: {
        url: page.url || null,
        title: page.title || null,
        origin: page.origin || null,
        referrer: page.referrer || null,
        userAgent: page.userAgent || null
      },
      callsite: normalizedCallsite,
      args: toArray(log.args),
      text,
      stack: log.stack || null,
      tags,
      search: {
        text: searchText
      },
      extra: log.extra || {}
    };
  }

  async appendLogs(payload) {
    const session = payload.session || {};
    const project = payload.project || {};
    const sessionId = session.id || crypto.randomUUID();
    const startedAt = session.startedAt || new Date().toISOString();
    const filePath = this.sessionFilePath(project.name, sessionId, startedAt);

    await mkdir(path.dirname(filePath), { recursive: true });

    const records = toArray(payload.logs).map((log, index) =>
      this.normalizeRecord(
        {
          ...payload,
          session: {
            ...session,
            id: sessionId,
            startedAt
          }
        },
        log,
        index
      )
    );

    if (!records.length) {
      return {
        filePath,
        records: []
      };
    }

    await appendFile(
      filePath,
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8"
    );

    let indexResult = {
      driver: "jsonl",
      indexed: 0
    };

    const sqlite = await this.getSqliteIndex();
    if (sqlite) {
      try {
        indexResult = sqlite.appendRecords(records);
      } catch (error) {
        this.disableSqliteIndex(error);
      }
    }

    return {
      filePath,
      sqlitePath: this.sqlitePath,
      indexDriver: indexResult.driver,
      indexed: indexResult.indexed,
      records
    };
  }

  async clearLogs() {
    await rm(this.projectDir, { recursive: true, force: true });
    await mkdir(this.projectDir, { recursive: true });

    const sqlite = await this.getSqliteIndex();
    if (sqlite) {
      sqlite.clear();
    }
  }

  async queryLogs(filters = {}) {
    const normalizedFilters = normalizeFilters(filters);
    const sqlite = await this.getSqliteIndex();
    if (sqlite) {
      try {
        return sqlite.queryLogs(normalizedFilters);
      } catch (error) {
        this.disableSqliteIndex(error);
      }
    }

    const files = await walkFiles(this.projectDir);
    const output = [];

    for (const filePath of files) {
      const records = await readJsonLines(filePath);

      for (const record of records) {
        if (!matchesFilter(record, normalizedFilters)) {
          continue;
        }

        output.push(record);
      }
    }

    output.sort((a, b) => {
      const timeDelta =
        (Number(b.occurredAtMs || 0) || toEpochMs(b.occurredAt)) -
        (Number(a.occurredAtMs || 0) || toEpochMs(a.occurredAt));

      if (timeDelta !== 0) {
        return timeDelta;
      }

      return Number(b.sequence || 0) - Number(a.sequence || 0);
    });

    return output.slice(0, normalizedFilters.limit);
  }

  async listSessions(filters = {}) {
    const sqlite = await this.getSqliteIndex();
    if (sqlite) {
      try {
        return sqlite.listSessions(filters);
      } catch (error) {
        this.disableSqliteIndex(error);
      }
    }

    const files = await walkFiles(this.projectDir);
    const sessions = new Map();

    for (const filePath of files) {
      const records = await readJsonLines(filePath);
      if (!records.length) {
        continue;
      }

      const latest = records[records.length - 1];
      const sessionId = latest.session.id;

      if (filters.project && latest.project.name !== filters.project) {
        continue;
      }

      const summary =
        sessions.get(sessionId) ||
        {
          id: sessionId,
          project: latest.project,
          count: 0,
          firstSeen: records[0].occurredAt,
          lastSeen: latest.occurredAt,
          levels: {},
          filePath
        };

      for (const record of records) {
        summary.count += 1;
        summary.levels[record.level] = (summary.levels[record.level] || 0) + 1;
      }

      summary.firstSeen =
        new Date(summary.firstSeen).getTime() < new Date(records[0].occurredAt).getTime()
          ? summary.firstSeen
          : records[0].occurredAt;

      summary.lastSeen =
        new Date(summary.lastSeen).getTime() > new Date(latest.occurredAt).getTime()
          ? summary.lastSeen
          : latest.occurredAt;

      sessions.set(sessionId, summary);
    }

    return Array.from(sessions.values()).sort((a, b) => {
      return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime();
    });
  }

  async listCaptures(filters = {}) {
    const normalizedFilters = normalizeFilters(filters);
    const sqlite = await this.getSqliteIndex();
    if (sqlite) {
      try {
        return sqlite.listCaptures(normalizedFilters);
      } catch (error) {
        this.disableSqliteIndex(error);
      }
    }

    const files = await walkFiles(this.projectDir);
    const records = [];

    for (const filePath of files) {
      const fileRecords = await readJsonLines(filePath);
      for (const record of fileRecords) {
        if (!matchesFilter(record, normalizedFilters)) {
          continue;
        }

        records.push(record);
      }
    }

    return groupRecordsIntoCaptures(records, {
      project: normalizedFilters.project,
      gapMs: filters.gapMs || undefined
    });
  }

  async deleteCapture(captureOrId) {
    const capture =
      typeof captureOrId === "string"
        ? await this.getCaptureById(captureOrId)
        : captureOrId;

    if (!capture?.id) {
      return {
        capture: null,
        deletedCount: 0
      };
    }

    const projectSlug = slugify(capture.project?.name || "unknown-project");
    const files = await walkFiles(path.join(this.projectDir, projectSlug));
    const deletedRecords = [];
    const affectedSessionIds = new Set();

    for (const filePath of files) {
      const records = await readJsonLines(filePath);
      if (!records.length) {
        continue;
      }

      const matches = selectLogsForCapture(records, capture);
      if (!matches.length) {
        continue;
      }

      const matchedIds = new Set(matches.map((record) => record.id));
      const keptRecords = records.filter((record) => !matchedIds.has(record.id));

      for (const record of matches) {
        deletedRecords.push(record);
        if (record.session?.id) {
          affectedSessionIds.add(record.session.id);
        }
      }

      await rewriteJsonlFile(filePath, keptRecords);
    }

    if (!deletedRecords.length) {
      return {
        capture,
        deletedCount: 0
      };
    }

    const sqlite = await this.getSqliteIndex();
    if (sqlite) {
      try {
        await sqlite.deleteRecords(deletedRecords, affectedSessionIds);
      } catch (error) {
        this.disableSqliteIndex(error);
      }
    }

    return {
      capture,
      deletedCount: deletedRecords.length
    };
  }

  async getCaptureById(captureId, filters = {}) {
    if (!captureId) {
      return null;
    }

    const captures = await this.listCaptures({
      ...filters,
      captureId
    });

    return captures.find((item) => item.id === captureId) || null;
  }

  async getLogsForCapture(capture, filters = {}) {
    if (!capture) {
      return [];
    }

    const candidateLogs = await this.queryLogs({
      ...filters,
      limit: filters.limit || "5000"
    });

    return selectLogsForCapture([...candidateLogs].reverse(), capture);
  }

  async close() {
    const sqlite = await this.sqlitePromise;
    if (sqlite) {
      sqlite.close();
    }
  }
}
