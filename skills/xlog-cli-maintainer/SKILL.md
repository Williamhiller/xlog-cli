---
name: xlog-cli-maintainer
description: Maintain and extend the xlog-cli repository across CLI commands, daemon/server APIs, runtime interception, storage/indexing, and viewer UI assets. Use when tasks in this project involve bugpack-driven debugging, capture/session grouping behavior, log query/storage changes, plugin/runtime integration, or edits in bin/, src/, viewer/, and viewer-react/.
---

# xlog-cli Maintainer

## Goal

Keep xlog-cli changes aligned with the repository's local-first logging flow: capture browser logs, group captures, export bugpacks, and inspect data in the viewer.

## Use This Workflow

1. Reproduce and bound scope first.
Run the minimum command set from [references/command-playbook.md](references/command-playbook.md) to confirm whether the issue is in daemon health, log ingestion, capture grouping, query filtering, or viewer rendering.

2. Locate ownership before editing.
Use [references/module-map.md](references/module-map.md) to pick the smallest module boundary that can hold the change.

3. Remove compatibility aliases when requested.
Use only the current `xlog` / `xlog-cli` naming unless the task explicitly asks to keep legacy exports/apis.

4. Validate from behavior, not only static reads.
Exercise the affected command path or API path and include at least one command from each impacted layer (runtime, server/storage, viewer build when UI changed).

5. Report with bugpack-first framing.
Describe impact in terms of `capture`, `logs`, `session`, `summary`, and viewer behavior so the result can be consumed by another AI agent quickly.

## Design Constraints

- Keep default host/port behavior (`127.0.0.1:2718`) unchanged unless explicitly requested.
- Keep log storage compatibility under `.xlog/projects/<project>/sessions/<date>/<session>.jsonl`.
- Keep query fallback behavior intact when SQLite is unavailable.
- Keep capture ordering semantics stable (newest capture/session first where currently expected).

## Task Recipes

### Adjust CLI behavior

Edit `bin/xlog-cli.js` and only the targeted server/runtime helpers it dispatches to. Verify with `daemon status`, `query`, and `bugpack`.

### Change log ingestion or filtering

Edit `src/runtime/` plus `src/server/storage.js` and `src/server/sqlite-index.js` as needed. Verify both ingestion (`POST /api/x-log`) and retrieval (`query`, `sessions`, `bugpack`).

### Change capture grouping behavior

Edit `src/server/captures.js` and confirm capture IDs and time windows still generate sensible `bugpack` output.

### Change viewer rendering

Edit `viewer-react/src/` for modern UI behavior, or `viewer/` for legacy static assets. Rebuild with `npm run build:viewer` and verify served assets via `/viewer/`.

## References

- Read [references/module-map.md](references/module-map.md) for file ownership and boundaries.
- Read [references/command-playbook.md](references/command-playbook.md) for reproducible command sequences.
