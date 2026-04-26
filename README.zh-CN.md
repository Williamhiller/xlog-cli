# xlog-cli

[English](README.md) | 简体中文

本地优先的浏览器日志工具，支持捕获分组、查看器和可直接交给 AI 分析的 bugpack。

它是为 AI 工作流设计的：先在本地收集日志，再把最小且足够的捕获打包成 bugpack，直接喂给 LLM 或 agent。

npm 包地址： [xlog-cli](https://www.npmjs.com/package/xlog-cli)

## 安装

```bash
npm install xlog-cli
```

可选的全局 CLI：

```bash
npm install -g xlog-cli
```

## 快速开始

1. 在你的应用里安装 `xlog-cli`。
2. 添加 Vite 或 Webpack 插件，或者手动安装 runtime。
3. 启动你的正常开发服务。

共享 daemon 运行后，可以打开：

```text
http://127.0.0.1:2718/viewer/
```

`xlog-cli` 会自动确保本地共享 daemon 运行在 `http://127.0.0.1:2718`，注册项目，在开发进程存活期间保持心跳，并在退出时注销。

如果你是全局安装，直接用 `xlog-cli ...`。如果是本地安装，使用 `npx xlog-cli ...`。

## 给 AI 用

1. 在出问题的应用里接入 `xlog-cli`。
2. 用 `npx xlog-cli bugpack` 导出最小可用上下文。
3. 把 bugpack JSON 直接交给你的 AI 工具或 agent。
4. 让 AI 优先查看 `logs`、`capture`、`session` 和 `summary` 字段。

最佳实践：

- 一次只分析一个 capture。
- 保持 `projectName` 稳定。
- 只保留故障窗口附近的日志。
- 给 AI 喂 bugpack JSON，不要喂截图或零散控制台输出。

## CLI

```bash
npx xlog-cli daemon start
npx xlog-cli daemon status
npx xlog-cli daemon stop
npx xlog-cli serve
npx xlog-cli query --limit 20
npx xlog-cli sessions
npx xlog-cli bugpack
npx xlog-cli bugpack --capture <captureId>
npx xlog-cli bugpack --session <sessionId>
```

## 集成到应用

### Vite

```js
import { xlogVitePlugin } from "xlog-cli/vite";

export default {
  plugins: [xlogVitePlugin()]
};
```

### Webpack

```js
import { XLogWebpackPlugin } from "xlog-cli/webpack";

export default {
  plugins: [new XLogWebpackPlugin()]
};
```

### 手动安装 runtime

```js
import { installXLog } from "xlog-cli/runtime";

installXLog({
  serverUrl: "http://127.0.0.1:2718",
  projectName: "my-app",
  tool: "browser"
});
```

### 手动记录日志

```js
import { xlogConsole } from "xlog-cli/runtime";

xlogConsole("error", { file: import.meta.url, line: 12, column: 3 }, "Request failed", error);
```

## AI Bugpack

```bash
npx xlog-cli bugpack
npx xlog-cli bugpack --capture <captureId>
npx xlog-cli bugpack --session <sessionId>
```

## 存储

日志会写入：

```text
.xlog/projects/<project>/sessions/<date>/<session>.jsonl
```

如果可用，xlog-cli 还会维护 SQLite 索引以加快查询。

## API

- `GET /api/health`
- `GET /api/runtime/status`
- `POST /api/runtime/register`
- `POST /api/runtime/heartbeat`
- `POST /api/runtime/unregister`
- `GET /api/captures`
- `GET /api/x-log`
- `POST /api/x-log`
- `GET /api/captures/:captureId/share.json`

## 包导出

- `xlog-cli`
- `xlog-cli/server`
- `xlog-cli/runtime`
- `xlog-cli/vite`
- `xlog-cli/webpack`
- `xlog-cli/babel-plugin`

## 查看器开发

```bash
npm run dev:viewer
npm run dev:viewer:ui
npm run build:viewer
```

## 注意

- 每个应用尽量使用稳定的 `projectName`。
- 如果要喂给 AI，尽量保持 capture 体积较小。
- 共享 daemon 默认使用固定端口，并会在多个项目之间复用。
