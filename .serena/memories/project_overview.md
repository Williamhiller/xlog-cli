# xlog-cli overview
- Purpose: local-first browser/dev logging with runtime interception, capture grouping, bugpack export, MCP integration, and a React viewer served at `/viewer/`.
- Stack: Node.js >=18, ESM JavaScript/TypeScript-adjacent codebase, React 18 + Vite for `viewer-react`, no dedicated CSS framework in viewer UI.
- Structure: `bin/` CLI entrypoints, `src/runtime/` browser/runtime interception, `src/server/` HTTP server/storage/viewer serving, `src/mcp/` MCP server, `src/shared/` shared helpers, `viewer-react/` modern viewer UI, `viewer/` legacy static assets, `test/` node test suite.
- Viewer serving: server resolves built assets from `viewer-react/dist` and serves them under `/viewer/`.
- Current UI convention: most UI styling is centralized in `viewer-react/src/styles.css`; React page structure is primarily in `viewer-react/src/App.jsx` and `viewer-react/src/components/DetailDrawer.jsx`.