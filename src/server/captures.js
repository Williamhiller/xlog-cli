const DEFAULT_CAPTURE_GAP_MS = 90 * 1000;

function toEpochMs(value) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function slugify(value) {
  const output = String(value || "project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return output || "project";
}

function sortRecordsAsc(left, right) {
  const timeDelta =
    (Number(left.occurredAtMs || 0) || toEpochMs(left.occurredAt)) -
    (Number(right.occurredAtMs || 0) || toEpochMs(right.occurredAt));

  if (timeDelta !== 0) {
    return timeDelta;
  }

  return Number(left.sequence || 0) - Number(right.sequence || 0);
}

function createSeedCapture(record) {
  const occurredAtMs = Number(record.occurredAtMs || 0) || toEpochMs(record.occurredAt);

  return {
    captureId: record.capture?.id || null,
    captureStartedAt: record.capture?.startedAt || record.occurredAt,
    project: record.project || { name: "unknown-project", tool: "browser" },
    firstSeen: record.occurredAt,
    firstSeenMs: occurredAtMs,
    lastSeen: record.occurredAt,
    lastSeenMs: occurredAtMs,
    count: 0,
    levels: {},
    sessionIds: new Set(),
    kinds: new Set(),
    pageTitles: new Set(),
    pageUrls: new Set()
  };
}

function appendRecord(capture, record) {
  const occurredAtMs = Number(record.occurredAtMs || 0) || toEpochMs(record.occurredAt);

  capture.firstSeenMs = Math.min(capture.firstSeenMs, occurredAtMs);
  capture.lastSeenMs = Math.max(capture.lastSeenMs, occurredAtMs);
  capture.firstSeen =
    capture.firstSeenMs === occurredAtMs ? record.occurredAt || capture.firstSeen : capture.firstSeen;
  capture.lastSeen =
    capture.lastSeenMs === occurredAtMs ? record.occurredAt || capture.lastSeen : capture.lastSeen;
  capture.count += 1;
  capture.levels[record.level] = (capture.levels[record.level] || 0) + 1;

  if (record.session?.id) {
    capture.sessionIds.add(record.session.id);
  }

  if (record.kind) {
    capture.kinds.add(record.kind);
  }

  if (record.page?.title) {
    capture.pageTitles.add(record.page.title);
  }

  if (record.page?.url) {
    capture.pageUrls.add(record.page.url);
  }
}

function finalizeCapture(capture, index) {
  const projectName = capture.project?.name || "unknown-project";

  return {
    id: capture.captureId || `${slugify(projectName)}-${capture.firstSeenMs}-${index}`,
    project: capture.project,
    count: capture.count,
    sessionCount: capture.sessionIds.size,
    sessionIds: Array.from(capture.sessionIds),
    kinds: Array.from(capture.kinds),
    startedAt: capture.captureStartedAt,
    firstSeen: capture.firstSeen,
    firstSeenMs: capture.firstSeenMs,
    lastSeen: capture.lastSeen,
    lastSeenMs: capture.lastSeenMs,
    levels: capture.levels,
    pageTitles: Array.from(capture.pageTitles),
    pageUrls: Array.from(capture.pageUrls)
  };
}

export function groupRecordsIntoCaptures(records, filters = {}) {
  const gapMs = Number(filters.gapMs || DEFAULT_CAPTURE_GAP_MS) || DEFAULT_CAPTURE_GAP_MS;
  const projectFilter = filters.project || "";
  const sortedRecords = records
    .filter(Boolean)
    .filter((record) => !projectFilter || record.project?.name === projectFilter)
    .sort(sortRecordsAsc);

  const keyedCaptures = new Map();
  const captures = [];
  let currentCapture = null;

  for (const record of sortedRecords) {
    const occurredAtMs = Number(record.occurredAtMs || 0) || toEpochMs(record.occurredAt);
    const recordProject = record.project?.name || "unknown-project";
    const recordCaptureId = record.capture?.id || null;

    if (recordCaptureId) {
      const existingCapture =
        keyedCaptures.get(recordCaptureId) ||
        createSeedCapture(record);

      appendRecord(existingCapture, record);
      keyedCaptures.set(recordCaptureId, existingCapture);
      continue;
    }

    if (
      !currentCapture ||
      currentCapture.project?.name !== recordProject ||
      occurredAtMs - currentCapture.lastSeenMs > gapMs
    ) {
      if (currentCapture) {
        captures.push(finalizeCapture(currentCapture, captures.length));
      }

      currentCapture = createSeedCapture(record);
    }

    appendRecord(currentCapture, record);
  }

  if (currentCapture) {
    captures.push(finalizeCapture(currentCapture, captures.length));
  }

  for (const capture of keyedCaptures.values()) {
    captures.push(finalizeCapture(capture, captures.length));
  }

  return captures.sort((left, right) => right.lastSeenMs - left.lastSeenMs);
}

export { DEFAULT_CAPTURE_GAP_MS };
