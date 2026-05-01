# xlog-cli Module Map

## Entry Points

- `bin/xlog-cli.js`: CLI router for `serve`, `query`, `sessions`, `bugpack`, and `mcp`.
- `bin/xlog-mcp.js`: MCP stdio server entry point.
- `src/index.js`: Package export surface and compatibility aliases.

## Runtime Capture Layer

- `src/runtime/interceptor.js`: Browser/runtime interception, log serialization, capture state, retry buffering, extension context handling.
- `src/runtime/auto-register.js`: Automatic install/registration helpers.
- `src/shared/serialize.js`: Argument/value serialization and text normalization.
- `src/shared/stack.js`: Stack parsing and callsite extraction helpers.
- `src/shared/constants.js`: Shared defaults (`host`, `port`, schema, levels, method lists).

## Server and Query Layer

- `src/server/server.js`: HTTP server, API routes, SSE, and viewer asset serving.
- `src/server/storage.js`: JSONL persistence, filtering, capture lookup, SQLite fallback policy.
- `src/server/sqlite-index.js`: SQLite schema, FTS search, query acceleration.
- `src/server/captures.js`: Capture grouping algorithm and capture metadata generation.
- `src/server/share.js`: Share/bugpack payload construction.

## Plugin Integration Layer

- `src/plugins/vite-plugin.js`: Vite integration, in-process xlog server startup, and runtime injection.
- `src/plugins/webpack-plugin.js`: Webpack integration, in-process xlog server startup, and runtime injection.
- `src/plugins/babel-plugin.js`: Babel transform support.

## Viewer Layer

- `viewer/`: Legacy static viewer assets.
- `viewer-react/src/`: React viewer source.
- `viewer-react/dist/`: Build output served by `src/server/viewer.js` when present.
- `src/server/viewer.js`: Viewer asset resolution and fallback between `viewer-react/dist` and `viewer/`.

## Change Targeting Guide

- For CLI behavior changes: edit `bin/xlog-cli.js` first.
- For ingestion/state bugs: start in `src/runtime/interceptor.js` and `src/server/server.js`.
- For query/filter bugs: start in `src/server/storage.js`, then `src/server/sqlite-index.js`.
- For capture boundary bugs: start in `src/server/captures.js`.
- For UI-only bugs: prefer `viewer-react/src/`; avoid touching legacy `viewer/` unless required.
