import { mkdir } from "node:fs/promises";
import path from "node:path";
import { groupRecordsIntoCaptures } from "./captures.js";

let sqliteModulePromise = null;

function toEpochMs(value) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function toJson(value, fallback = null) {
  return JSON.stringify(value ?? fallback);
}

function parseRecordRows(rows) {
  return rows
    .map((row) => {
      try {
        return JSON.parse(row.raw_json);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function escapeLike(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function buildFtsQuery(input) {
  const terms = String(input || "")
    .trim()
    .match(/[\p{L}\p{N}_./:-]+/gu);

  if (!terms || !terms.length) {
    return null;
  }

  return terms
    .map((term) => {
      const escaped = term.replaceAll('"', '""');
      if (/^[\p{L}\p{N}_]+$/u.test(term)) {
        return `${escaped}*`;
      }

      return `"${escaped}"`;
    })
    .join(" AND ");
}

function compactLevels(row) {
  const pairs = Object.entries({
    error: Number(row.error_count || 0),
    warn: Number(row.warn_count || 0),
    info: Number(row.info_count || 0),
    log: Number(row.log_count || 0),
    debug: Number(row.debug_count || 0),
    trace: Number(row.trace_count || 0)
  });

  return Object.fromEntries(pairs.filter(([, count]) => count > 0));
}

async function loadSqliteModule() {
  if (!sqliteModulePromise) {
    sqliteModulePromise = import("node:sqlite").catch(() => null);
  }

  return sqliteModulePromise;
}

function buildLogQueryParts(filters) {
  const clauses = [];
  const params = {
    limit: Number(filters.limit || 200)
  };
  let joinSql = "";

  if (filters.project) {
    clauses.push("logs.project_name = :project");
    params.project = filters.project;
  }

  if (filters.sessionId) {
    clauses.push("logs.session_id = :sessionId");
    params.sessionId = filters.sessionId;
  }

  if (filters.captureId) {
    clauses.push("logs.capture_id = :captureId");
    params.captureId = filters.captureId;
  }

  if (filters.sessionIds && filters.sessionIds.length) {
    const placeholders = filters.sessionIds.map((sessionId, index) => {
      const key = `sessionId${index}`;
      params[key] = sessionId;
      return `:${key}`;
    });

    clauses.push(`logs.session_id IN (${placeholders.join(", ")})`);
  }

  if (filters.kind) {
    clauses.push("logs.kind = :kind");
    params.kind = filters.kind;
  }

  if (filters.levels && filters.levels.length) {
    const placeholders = filters.levels.map((level, index) => {
      const key = `level${index}`;
      params[key] = level;
      return `:${key}`;
    });

    clauses.push(`logs.level IN (${placeholders.join(", ")})`);
  }

  if (filters.file) {
    clauses.push("logs.callsite_file LIKE :file ESCAPE '\\'");
    params.file = `%${escapeLike(filters.file)}%`;
  }

  if (filters.from) {
    clauses.push("logs.occurred_at_ms >= :fromMs");
    params.fromMs = Number(filters.from);
  }

  if (filters.to) {
    clauses.push("logs.occurred_at_ms <= :toMs");
    params.toMs = Number(filters.to);
  }

  if (filters.q) {
    const ftsQuery = buildFtsQuery(filters.q);
    if (ftsQuery) {
      joinSql = " JOIN logs_fts ON logs_fts.log_id = logs.id ";
      clauses.push("logs_fts MATCH :ftsQuery");
      params.ftsQuery = ftsQuery;
    } else {
      clauses.push("logs.search_text LIKE :textQuery ESCAPE '\\'");
      params.textQuery = `%${escapeLike(filters.q.toLowerCase())}%`;
    }
  }

  return {
    joinSql,
    params,
    whereSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
  };
}

export class SQLiteLogIndex {
  constructor({ db, dbPath, sessionFilePath }) {
    this.db = db;
    this.dbPath = dbPath;
    this.sessionFilePath = sessionFilePath;
    this.bootstrap();
    this.prepareStatements();
  }

  static async create({ rootDir, dbFileName = "index.sqlite", sessionFilePath }) {
    const sqliteModule = await loadSqliteModule();
    if (!sqliteModule || !sqliteModule.DatabaseSync) {
      return null;
    }

    await mkdir(rootDir, { recursive: true });

    const dbPath = path.join(rootDir, dbFileName);
    const db = new sqliteModule.DatabaseSync(dbPath);

    return new SQLiteLogIndex({
      db,
      dbPath,
      sessionFilePath
    });
  }

  bootstrap() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = MEMORY;

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_name TEXT NOT NULL,
        project_tool TEXT NOT NULL,
        started_at TEXT NOT NULL,
        page_url TEXT,
        page_title TEXT,
        page_origin TEXT,
        page_referrer TEXT,
        page_user_agent TEXT,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        project_name TEXT NOT NULL,
        project_tool TEXT NOT NULL,
        capture_id TEXT,
        capture_started_at TEXT,
        session_id TEXT NOT NULL,
        session_started_at TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        occurred_at_ms INTEGER NOT NULL,
        received_at TEXT NOT NULL,
        received_at_ms INTEGER NOT NULL,
        level TEXT NOT NULL,
        kind TEXT NOT NULL,
        method TEXT NOT NULL,
        source TEXT,
        sequence INTEGER NOT NULL,
        page_url TEXT,
        page_title TEXT,
        page_origin TEXT,
        page_referrer TEXT,
        page_user_agent TEXT,
        callsite_source TEXT,
        callsite_file TEXT,
        callsite_line INTEGER,
        callsite_column INTEGER,
        callsite_function_name TEXT,
        callsite_url TEXT,
        text TEXT NOT NULL,
        stack_raw TEXT,
        args_json TEXT NOT NULL,
        stack_json TEXT,
        tags_json TEXT NOT NULL,
        extra_json TEXT NOT NULL,
        search_text TEXT NOT NULL,
        raw_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_logs_session_time
        ON logs(session_id, occurred_at_ms DESC, sequence DESC);
      CREATE INDEX IF NOT EXISTS idx_logs_capture_time
        ON logs(capture_id, occurred_at_ms DESC, sequence DESC);
      CREATE INDEX IF NOT EXISTS idx_logs_project_time
        ON logs(project_name, occurred_at_ms DESC, sequence DESC);
      CREATE INDEX IF NOT EXISTS idx_logs_level_time
        ON logs(level, occurred_at_ms DESC);
      CREATE INDEX IF NOT EXISTS idx_logs_kind_time
        ON logs(kind, occurred_at_ms DESC);
      CREATE INDEX IF NOT EXISTS idx_logs_file_time
        ON logs(callsite_file, occurred_at_ms DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_project_last_seen
        ON sessions(project_name, last_seen DESC);

      CREATE VIRTUAL TABLE IF NOT EXISTS logs_fts USING fts5(
        log_id UNINDEXED,
        text,
        file,
        stack_raw,
        search_text,
        tokenize = 'unicode61'
      );
    `);

    for (const statement of [
      "ALTER TABLE logs ADD COLUMN capture_id TEXT",
      "ALTER TABLE logs ADD COLUMN capture_started_at TEXT",
      "ALTER TABLE logs ADD COLUMN source TEXT"
    ]) {
      try {
        this.db.exec(statement);
      } catch {
        // Column already exists on upgraded stores.
      }
    }
  }

  prepareStatements() {
    this.upsertSessionStmt = this.db.prepare(`
      INSERT INTO sessions (
        id,
        project_name,
        project_tool,
        started_at,
        page_url,
        page_title,
        page_origin,
        page_referrer,
        page_user_agent,
        first_seen,
        last_seen,
        created_at,
        updated_at
      ) VALUES (
        :id,
        :projectName,
        :projectTool,
        :startedAt,
        :pageUrl,
        :pageTitle,
        :pageOrigin,
        :pageReferrer,
        :pageUserAgent,
        :firstSeen,
        :lastSeen,
        :createdAt,
        :updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        project_name = excluded.project_name,
        project_tool = excluded.project_tool,
        page_url = COALESCE(excluded.page_url, sessions.page_url),
        page_title = COALESCE(excluded.page_title, sessions.page_title),
        page_origin = COALESCE(excluded.page_origin, sessions.page_origin),
        page_referrer = COALESCE(excluded.page_referrer, sessions.page_referrer),
        page_user_agent = COALESCE(excluded.page_user_agent, sessions.page_user_agent),
        first_seen = CASE
          WHEN excluded.first_seen < sessions.first_seen THEN excluded.first_seen
          ELSE sessions.first_seen
        END,
        last_seen = CASE
          WHEN excluded.last_seen > sessions.last_seen THEN excluded.last_seen
          ELSE sessions.last_seen
        END,
        updated_at = excluded.updated_at
    `);

    this.insertLogStmt = this.db.prepare(`
      INSERT OR REPLACE INTO logs (
        id,
        project_name,
        project_tool,
        capture_id,
        capture_started_at,
        session_id,
        session_started_at,
        occurred_at,
        occurred_at_ms,
        received_at,
        received_at_ms,
        level,
        kind,
        method,
        source,
        sequence,
        page_url,
        page_title,
        page_origin,
        page_referrer,
        page_user_agent,
        callsite_source,
        callsite_file,
        callsite_line,
        callsite_column,
        callsite_function_name,
        callsite_url,
        text,
        stack_raw,
        args_json,
        stack_json,
        tags_json,
        extra_json,
        search_text,
        raw_json
      ) VALUES (
        :id,
        :projectName,
        :projectTool,
        :captureId,
        :captureStartedAt,
        :sessionId,
        :sessionStartedAt,
        :occurredAt,
        :occurredAtMs,
        :receivedAt,
        :receivedAtMs,
        :level,
        :kind,
        :method,
        :source,
        :sequence,
        :pageUrl,
        :pageTitle,
        :pageOrigin,
        :pageReferrer,
        :pageUserAgent,
        :callsiteSource,
        :callsiteFile,
        :callsiteLine,
        :callsiteColumn,
        :callsiteFunctionName,
        :callsiteUrl,
        :text,
        :stackRaw,
        :argsJson,
        :stackJson,
        :tagsJson,
        :extraJson,
        :searchText,
        :rawJson
      )
    `);

    this.deleteFtsStmt = this.db.prepare("DELETE FROM logs_fts WHERE log_id = :logId");
    this.clearFtsStmt = this.db.prepare("DELETE FROM logs_fts");
    this.clearLogsStmt = this.db.prepare("DELETE FROM logs");
    this.clearSessionsStmt = this.db.prepare("DELETE FROM sessions");
    this.insertFtsStmt = this.db.prepare(`
      INSERT INTO logs_fts (
        log_id,
        text,
        file,
        stack_raw,
        search_text
      ) VALUES (
        :logId,
        :text,
        :file,
        :stackRaw,
        :searchText
      )
    `);
    this.deleteLogStmt = this.db.prepare("DELETE FROM logs WHERE id = :logId");
    this.deleteSessionStmt = this.db.prepare("DELETE FROM sessions WHERE id = :sessionId");
    this.selectSessionLogsStmt = this.db.prepare(`
      SELECT raw_json
      FROM logs
      WHERE session_id = :sessionId
      ORDER BY occurred_at_ms ASC, sequence ASC
    `);
    this.countLogsStmt = this.db.prepare("SELECT COUNT(*) AS count FROM logs");
  }

  createSessionParams(record) {
    return {
      id: record.session.id,
      projectName: record.project.name,
      projectTool: record.project.tool,
      startedAt: record.session.startedAt,
      pageUrl: record.page.url,
      pageTitle: record.page.title,
      pageOrigin: record.page.origin,
      pageReferrer: record.page.referrer,
      pageUserAgent: record.page.userAgent,
      firstSeen: record.occurredAt,
      lastSeen: record.occurredAt,
      createdAt: record.receivedAt,
      updatedAt: record.receivedAt
    };
  }

  createLogParams(record) {
    return {
      id: record.id,
      projectName: record.project.name,
      projectTool: record.project.tool,
      captureId: record.capture ? record.capture.id || null : null,
      captureStartedAt: record.capture ? record.capture.startedAt || null : null,
      sessionId: record.session.id,
      sessionStartedAt: record.session.startedAt,
      occurredAt: record.occurredAt,
      occurredAtMs: toEpochMs(record.occurredAt),
      receivedAt: record.receivedAt,
      receivedAtMs: toEpochMs(record.receivedAt),
      level: record.level,
      kind: record.kind,
      method: record.method,
      source: record.source || null,
      sequence: Number(record.sequence || 0),
      pageUrl: record.page.url,
      pageTitle: record.page.title,
      pageOrigin: record.page.origin,
      pageReferrer: record.page.referrer,
      pageUserAgent: record.page.userAgent,
      callsiteSource: record.callsite ? record.callsite.source : null,
      callsiteFile: record.callsite ? record.callsite.file : null,
      callsiteLine: record.callsite ? Number(record.callsite.line || 0) || null : null,
      callsiteColumn: record.callsite ? Number(record.callsite.column || 0) || null : null,
      callsiteFunctionName: record.callsite ? record.callsite.functionName : null,
      callsiteUrl: record.callsite ? record.callsite.url : null,
      text: record.text || "",
      stackRaw: record.stack ? record.stack.raw || "" : "",
      argsJson: toJson(record.args, []),
      stackJson: toJson(record.stack, null),
      tagsJson: toJson(record.tags, []),
      extraJson: toJson(record.extra, {}),
      searchText: record.search ? record.search.text || "" : "",
      rawJson: JSON.stringify(record)
    };
  }

  countLogs() {
    const row = this.countLogsStmt.get();
    return Number(row ? row.count : 0);
  }

  refreshSessions(sessionIds) {
    const uniqueSessionIds = [...new Set([...sessionIds].filter(Boolean))];
    if (!uniqueSessionIds.length) {
      return;
    }

    for (const sessionId of uniqueSessionIds) {
      const rows = this.selectSessionLogsStmt.all({ sessionId });
      const records = parseRecordRows(rows);

      if (!records.length) {
        this.deleteSessionStmt.run({ sessionId });
        continue;
      }

      const firstRecord = records[0];
      const lastRecord = records[records.length - 1];
      this.deleteSessionStmt.run({ sessionId });
      const params = {
        ...this.createSessionParams(firstRecord),
        pageUrl: lastRecord.page?.url || firstRecord.page?.url || null,
        pageTitle: lastRecord.page?.title || firstRecord.page?.title || null,
        pageOrigin: lastRecord.page?.origin || firstRecord.page?.origin || null,
        pageReferrer: lastRecord.page?.referrer || firstRecord.page?.referrer || null,
        pageUserAgent: lastRecord.page?.userAgent || firstRecord.page?.userAgent || null,
        firstSeen: firstRecord.occurredAt,
        lastSeen: lastRecord.occurredAt,
        createdAt: firstRecord.receivedAt,
        updatedAt: lastRecord.receivedAt
      };

      this.upsertSessionStmt.run(params);
    }
  }

  deleteRecords(records, sessionIds = []) {
    const uniqueRecords = [...new Map(records.map((record) => [record.id, record])).values()].filter(
      (record) => record?.id
    );

    if (!uniqueRecords.length) {
      return {
        driver: "sqlite",
        deleted: 0
      };
    }

    const affectedSessionIds = new Set(sessionIds);
    for (const record of uniqueRecords) {
      if (record.session?.id) {
        affectedSessionIds.add(record.session.id);
      }
    }

    this.db.exec("BEGIN");

    try {
      for (const record of uniqueRecords) {
        this.deleteFtsStmt.run({ logId: record.id });
        this.deleteLogStmt.run({ logId: record.id });
      }

      this.refreshSessions(affectedSessionIds);

      this.db.exec("COMMIT");
      return {
        driver: "sqlite",
        deleted: uniqueRecords.length
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  appendRecords(records) {
    if (!records.length) {
      return {
        driver: "sqlite",
        indexed: 0
      };
    }

    this.db.exec("BEGIN");

    try {
      for (const record of records) {
        this.upsertSessionStmt.run(this.createSessionParams(record));
        this.insertLogStmt.run(this.createLogParams(record));
        this.deleteFtsStmt.run({ logId: record.id });
        this.insertFtsStmt.run({
          logId: record.id,
          text: record.text || "",
          file: record.callsite ? record.callsite.file || "" : "",
          stackRaw: record.stack ? record.stack.raw || "" : "",
          searchText: record.search ? record.search.text || "" : ""
        });
      }

      this.db.exec("COMMIT");
      return {
        driver: "sqlite",
        indexed: records.length
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  clear() {
    this.db.exec("BEGIN");

    try {
      this.clearFtsStmt.run();
      this.clearLogsStmt.run();
      this.clearSessionsStmt.run();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  queryLogs(filters = {}) {
    const parts = buildLogQueryParts(filters);
    const statement = this.db.prepare(`
      SELECT logs.raw_json
      FROM logs
      ${parts.joinSql}
      ${parts.whereSql}
      ORDER BY logs.occurred_at_ms DESC, logs.sequence DESC
      LIMIT :limit
    `);

    const rows = statement.all(parts.params);
    return parseRecordRows(rows);
  }

  listCaptures(filters = {}) {
    const params = {};
    const clauses = [];

    if (filters.project) {
      clauses.push("project_name = :project");
      params.project = filters.project;
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`
        SELECT raw_json
        FROM logs
        ${whereSql}
        ORDER BY occurred_at_ms ASC, sequence ASC
      `)
      .all(params);

    const records = parseRecordRows(rows);
    return groupRecordsIntoCaptures(records, {
      project: filters.project || "",
      gapMs: filters.gapMs || undefined
    });
  }

  listSessions(filters = {}) {
    const params = {};
    const clauses = [];

    if (filters.project) {
      clauses.push("sessions.project_name = :project");
      params.project = filters.project;
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const sessionRows = this.db
      .prepare(`
        SELECT
          sessions.id,
          sessions.project_name,
          sessions.project_tool,
          sessions.started_at,
          sessions.first_seen,
          sessions.last_seen,
          sessions.page_url,
          sessions.page_title,
          COUNT(logs.id) AS count,
          SUM(CASE WHEN logs.level = 'error' THEN 1 ELSE 0 END) AS error_count,
          SUM(CASE WHEN logs.level = 'warn' THEN 1 ELSE 0 END) AS warn_count,
          SUM(CASE WHEN logs.level = 'info' THEN 1 ELSE 0 END) AS info_count,
          SUM(CASE WHEN logs.level = 'log' THEN 1 ELSE 0 END) AS log_count,
          SUM(CASE WHEN logs.level = 'debug' THEN 1 ELSE 0 END) AS debug_count,
          SUM(CASE WHEN logs.level = 'trace' THEN 1 ELSE 0 END) AS trace_count
        FROM sessions
        LEFT JOIN logs ON logs.session_id = sessions.id
        ${whereSql}
        GROUP BY sessions.id
        ORDER BY sessions.last_seen DESC
      `)
      .all(params);

    return sessionRows.map((row) => ({
      id: row.id,
      project: {
        name: row.project_name,
        tool: row.project_tool
      },
      count: Number(row.count || 0),
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      levels: compactLevels(row),
      filePath: this.sessionFilePath(row.project_name, row.id, row.started_at),
      page: {
        url: row.page_url || null,
        title: row.page_title || null
      }
    }));
  }

  close() {
    this.db.close();
  }
}

export async function createSQLiteLogIndex(options) {
  return SQLiteLogIndex.create(options);
}
