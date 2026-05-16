import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons.jsx";

const DRAWER_ANIMATION_MS = 220;

function findSerializedErrorStack(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") {
    return "";
  }

  if (seen.has(value)) {
    return "";
  }

  seen.add(value);

  if (value.type === "error" && typeof value.stack === "string" && value.stack.trim()) {
    return value.stack.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nestedStack = findSerializedErrorStack(item, seen);
      if (nestedStack) {
        return nestedStack;
      }
    }

    return "";
  }

  for (const nestedValue of Object.values(value)) {
    const nestedStack = findSerializedErrorStack(nestedValue, seen);
    if (nestedStack) {
      return nestedStack;
    }
  }

  return "";
}

function collectDebugDomSnapshots(value, snapshots = [], seen = new WeakSet()) {
  if (!value || typeof value !== "object") {
    return snapshots;
  }

  if (seen.has(value)) {
    return snapshots;
  }

  seen.add(value);

  if (value.type === "dom" && value.captureMode === "debug") {
    snapshots.push(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectDebugDomSnapshots(item, snapshots, seen);
    }
    return snapshots;
  }

  for (const nestedValue of Object.values(value)) {
    collectDebugDomSnapshots(nestedValue, snapshots, seen);
  }

  return snapshots;
}

function formatFrame(frame) {
  if (!frame || typeof frame !== "object") {
    return "";
  }

  const location = [frame.file || frame.url, frame.line, frame.column].filter(Boolean).join(":");
  if (!location) {
    return "";
  }

  return frame.functionName ? `at ${frame.functionName} (${location})` : `at ${location}`;
}

function buildFilteredStackText(stack) {
  const frames = Array.isArray(stack?.frames) ? stack.frames : [];
  if (!frames.length) {
    return "";
  }

  return frames.map((frame) => formatFrame(frame)).filter(Boolean).join("\n");
}

function getPreferredStackInfo(log) {
  const errorStack =
    findSerializedErrorStack(log?.args) || findSerializedErrorStack(log?.extra);

  if (errorStack) {
    return {
      title: "Error Stack",
      text: errorStack
    };
  }

  const filteredStack = buildFilteredStackText(log?.stack);
  if (filteredStack) {
    return {
      title: "Captured Stack",
      text: filteredStack
    };
  }

  if (typeof log?.stack?.raw === "string" && log.stack.raw.trim()) {
    return {
      title: "Raw Stack",
      text: log.stack.raw.trim()
    };
  }

  return {
    title: "Stack",
    text: "No stack"
  };
}

function truncateText(value, maxLength = 160) {
  const text = String(value ?? "");
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

function formatDomSnapshotSummary(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return "";
  }

  const attrs = snapshot.attrs && typeof snapshot.attrs === "object"
    ? Object.entries(snapshot.attrs)
        .slice(0, 6)
        .map(([name, value]) => `${name}=${value}`)
        .join(" ")
    : "";
  const text = truncateText(snapshot.text || "", 180);

  return [snapshot.selector, attrs, text].filter(Boolean).join("\n");
}

export default function DetailDrawer({
  visible,
  log,
  onClose,
  onCopy,
  buildContextLines,
  getRuntimeSourceLabel,
  getCallsiteSourceLabel
}) {
  const drawerRef = useRef(null);
  const [isRendered, setIsRendered] = useState(() => Boolean(visible && log));
  const [isClosing, setIsClosing] = useState(false);
  const [activeLog, setActiveLog] = useState(log);
  const [expandedDomSnapshotIndexes, setExpandedDomSnapshotIndexes] = useState(() => new Set());

  useEffect(() => {
    if (visible && log) {
      setActiveLog(log);
      setIsRendered(true);
      setExpandedDomSnapshotIndexes(new Set());

      const frameId = window.requestAnimationFrame(() => {
        setIsClosing(false);
      });

      return () => {
        window.cancelAnimationFrame(frameId);
      };
    }

    if (!isRendered) {
      return undefined;
    }

    setIsClosing(true);
    const timeoutId = window.setTimeout(() => {
      setIsRendered(false);
      setIsClosing(false);
    }, DRAWER_ANIMATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [visible, log, isRendered]);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    function handlePointerDown(event) {
      const drawerNode = drawerRef.current;
      if (!drawerNode || drawerNode.contains(event.target)) {
        return;
      }

      onClose();
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [visible, onClose]);

  const domSnapshots = useMemo(() => collectDebugDomSnapshots(activeLog?.args), [activeLog]);

  if (!isRendered || !activeLog) {
    return null;
  }

  const contextText = buildContextLines(activeLog).join("\n");
  const argsText = JSON.stringify(activeLog.args || [], null, 2);
  const stackInfo = getPreferredStackInfo(activeLog);
  const toggleDomSnapshotExpanded = (index) => {
    setExpandedDomSnapshotIndexes((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <div className={`viewer-detail-layer ${isClosing ? "is-exit" : "is-enter"}`}>
      <div className="viewer-detail-backdrop" />

      <aside
        ref={drawerRef}
        className="viewer-detail-drawer"
        role="dialog"
        aria-modal="false"
        aria-label="Log details"
      >
        <div className="viewer-detail-head">
          <div>
            <div className="viewer-detail-kicker">Selected Entry</div>
            <div className="viewer-detail-title">{activeLog.text || "No log selected"}</div>
          </div>

          <button type="button" className="viewer-ghost-button viewer-close-button" onClick={onClose}>
            <Icon name="ri-close-line" />
            Close
          </button>
        </div>

        <div className="viewer-detail-scroll">
          <div className="viewer-detail-scroll-inner">
            <div className="viewer-detail-meta">
              <span className={`viewer-level-pill is-${activeLog.level}`}>{activeLog.level}</span>
              <span className="viewer-log-chip">{activeLog.kind || "console"}</span>
              <span className="viewer-log-chip">{getRuntimeSourceLabel(activeLog)}</span>
              <span className="viewer-log-chip">{getCallsiteSourceLabel(activeLog)}</span>
              <span className="viewer-log-chip">{activeLog.session?.id || "unknown session"}</span>
              {Number(activeLog.repeatCount || 1) > 1 ? (
                <span className="viewer-log-chip">repeated × {activeLog.repeatCount}</span>
              ) : null}
            </div>

            <div className="viewer-detail-grid">
              <section className="viewer-card">
                <div className="viewer-card-head">
                  <span>Summary</span>
                  <button type="button" className="viewer-ghost-button" onClick={() => onCopy(activeLog.text || "")}>
                    Copy
                  </button>
                </div>
                <pre>{activeLog.text || "No log selected"}</pre>
              </section>

              <section className="viewer-card">
                <div className="viewer-card-head">
                  <span>Callsite + Session</span>
                  <button type="button" className="viewer-ghost-button" onClick={() => onCopy(contextText)}>
                    Copy
                  </button>
                </div>
                <pre>{contextText}</pre>
              </section>

              <section className="viewer-card">
                <div className="viewer-card-head">
                  <span>Args</span>
                  <button type="button" className="viewer-ghost-button" onClick={() => onCopy(argsText)}>
                    Copy
                  </button>
                </div>
                <pre>{argsText}</pre>
              </section>

              {domSnapshots.map((snapshot, index) => {
                const expanded = expandedDomSnapshotIndexes.has(index);
                const summaryText = formatDomSnapshotSummary(snapshot);
                const detailText = [
                  snapshot.outerHTMLSanitized || "[outerHTML omitted: too large]",
                  "",
                  `hash: ${snapshot.hash || "n/a"}`,
                  `path: ${snapshot.path || "n/a"}`,
                  `size: ${snapshot.byteLength || 0} bytes`,
                  `tooLarge: ${snapshot.tooLarge ? "true" : "false"}`,
                  "",
                  JSON.stringify(snapshot.attrs || {}, null, 2)
                ].join("\n");

                return (
                  <section className="viewer-card" key={`${snapshot.hash || snapshot.selector || "dom"}-${index}`}>
                    <div className="viewer-card-head viewer-card-head--dom">
                      <span>DOM Snapshot {domSnapshots.length > 1 ? index + 1 : ""}</span>
                      <div className="viewer-card-head-actions">
                        {snapshot.tooLarge ? <span className="viewer-dom-badge">too large</span> : null}
                        <button
                          type="button"
                          className="viewer-ghost-button"
                          onClick={() => onCopy(expanded ? detailText : summaryText)}
                        >
                          Copy
                        </button>
                        <button
                          type="button"
                          className="viewer-ghost-button"
                          onClick={() => toggleDomSnapshotExpanded(index)}
                          aria-expanded={expanded}
                        >
                          {expanded ? "Collapse" : "Expand"}
                        </button>
                      </div>
                    </div>
                    <div className="viewer-dom-summary">
                      <pre>{summaryText || "No summary"}</pre>
                    </div>
                    {expanded ? (
                      <div className="viewer-dom-detail">
                        <pre>{detailText}</pre>
                      </div>
                    ) : null}
                  </section>
                );
              })}

              <section className="viewer-card">
                <div className="viewer-card-head">
                  <span>{stackInfo.title}</span>
                  <button type="button" className="viewer-ghost-button" onClick={() => onCopy(stackInfo.text)}>
                    Copy
                  </button>
                </div>
                <pre>{stackInfo.text}</pre>
              </section>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
