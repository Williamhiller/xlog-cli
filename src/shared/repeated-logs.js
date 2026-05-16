function normalizeValue(value) {
  return String(value ?? "").trim();
}

export function getLogRepeatKey(log) {
  if (!log || typeof log !== "object") {
    return "";
  }

  return [
    normalizeValue(log.level),
    normalizeValue(log.kind),
    normalizeValue(log.source),
    normalizeValue(log.text),
    normalizeValue(log.callsite?.file),
    normalizeValue(log.callsite?.line),
    normalizeValue(log.callsite?.column),
    normalizeValue(log.callsite?.functionName)
  ].join("\u001f");
}

export function collapseRepeatedLogs(logs) {
  if (!Array.isArray(logs) || !logs.length) {
    return [];
  }

  const collapsed = [];

  for (const log of logs) {
    if (!log) {
      continue;
    }

    const key = getLogRepeatKey(log);
    const previous = collapsed[collapsed.length - 1];

    if (previous && previous._repeatKey === key) {
      previous.repeatCount += 1;
      previous.duplicateIds.push(log.id);
      previous.lastOccurredAt = log.occurredAt;
      previous.lastOccurredAtMs = log.occurredAtMs;
      continue;
    }

    collapsed.push({
      ...log,
      repeatCount: 1,
      duplicateIds: log.id ? [log.id] : [],
      firstOccurredAt: log.occurredAt,
      firstOccurredAtMs: log.occurredAtMs,
      lastOccurredAt: log.occurredAt,
      lastOccurredAtMs: log.occurredAtMs,
      _repeatKey: key
    });
  }

  return collapsed.map(({ _repeatKey, ...log }) => log);
}
