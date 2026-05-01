# xlog-cli 命令手册（中文）

## 基础健康检查

```bash
npx xlog-cli serve --silent
npx xlog-cli query --limit 20
npx xlog-cli sessions
```

先确认 server 是否能启动，以及当前是否已有日志和会话数据。

## Bugpack 优先排障

```bash
npx xlog-cli bugpack
npx xlog-cli bugpack --capture <captureId>
npx xlog-cli bugpack --session <sessionId>
```

改代码前，先用 bugpack 观察 `capture`、`logs`、`session`、`summary`。

## Server 生命周期

```bash
npx xlog-cli serve --silent
curl -sS http://127.0.0.1:2718/api/health
```

用于排查 server 启动失败或 API 可用性问题。

## Viewer 开发与构建

```bash
npm run dev:viewer
npm run dev:viewer:ui
npm run build:viewer
```

`dev:viewer` 用于端到端联调，`dev:viewer:ui` 用于 React UI 快速迭代。涉及静态产物时必须执行 `build:viewer`。

## API 快速核对

- `GET /api/health`: 服务可用性。
- `GET /api/captures`: capture 列表。
- `GET /api/x-log`: 日志查询结果。
- `POST /api/x-log`: 日志上报入口。
- `GET /api/captures/:captureId/share.json`: capture 分享/bugpack 数据。

当 CLI 输出和 viewer 表现不一致时，优先用 API 交叉定位。

## 变更后的最小验证

- 改 runtime/server 入库：至少验证 server health + `query` + `bugpack`。
- 改 query/storage/index：至少验证带过滤的 `query` 和 `sessions`。
- 改 capture 分组：至少验证一次 `bugpack --capture`。
- 改 viewer：执行 `npm run build:viewer` 并在 `/viewer/` 打开确认。
