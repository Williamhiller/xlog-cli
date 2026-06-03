# xlog-cli 模块地图（中文）

## 入口层

- `bin/xlog.js`: CLI 路由，处理 `serve`、`query`、`sessions`、`bugpack`、`daemon`。
- `bin/xlog-daemon.js`: 常驻 daemon 启动入口。
- `src/index.js`: 包导出面和兼容别名。

## Runtime 采集层

- `src/runtime/interceptor.js`: 浏览器/runtime 拦截、参数序列化、capture 状态、心跳与上报。
- `src/runtime/auto-register.js`: 自动注册逻辑。
- `src/shared/serialize.js`: 参数和值序列化。
- `src/shared/stack.js`: 调用栈和 callsite 解析。
- `src/shared/constants.js`: 默认端口、级别、schema 等共享常量。

## Server 与查询层

- `src/server/server.js`: HTTP API、SSE、viewer 静态资源分发、runtime 注册生命周期。
- `src/server/daemon.js`: daemon 启停、健康检查、状态文件与 pid 管理。
- `src/server/storage.js`: JSONL 持久化、过滤查询、capture 定位、SQLite fallback。
- `src/server/sqlite-index.js`: SQLite schema、FTS、查询加速。
- `src/server/captures.js`: capture 分组算法和元数据生成。
- `src/server/share.js`: share/bugpack 结构组装。

## 插件注入层

- `src/plugins/vite-plugin.js`: Vite 注入逻辑。
- `src/plugins/webpack-plugin.js`: Webpack 注入逻辑。
- `src/plugins/babel-plugin.js`: Babel 转换注入逻辑。

## Viewer 层

- `viewer/`: 旧版静态 viewer 资源。
- `viewer-react/src/`: React viewer 源码。
- `viewer-react/dist/`: 构建产物，优先由 server 提供。
- `src/server/viewer.js`: `viewer-react/dist` 与 `viewer/` 的资产选择与兜底。

## 改动落点建议

- CLI 行为变更：优先改 `bin/xlog.js`。
- 入库/状态问题：从 `src/runtime/interceptor.js` 和 `src/server/server.js` 开始。
- 查询过滤问题：从 `src/server/storage.js` 开始，必要时再改 `src/server/sqlite-index.js`。
- capture 边界问题：从 `src/server/captures.js` 开始。
- 纯 UI 问题：优先改 `viewer-react/src/`，尽量不触碰 `viewer/`。
