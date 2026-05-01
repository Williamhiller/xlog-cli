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

Vite 和 Webpack 插件会在开发期间启动一个当前进程内的 xlog server。可以打开：

```text
http://127.0.0.1:2718/viewer/
```

默认本地 server 使用 `http://127.0.0.1:2718`，端口被占用时会自动尝试后续端口。手动安装 runtime 时，可以用 `npx xlog-cli serve` 启动 server。

如果你是全局安装，直接用 `xlog-cli ...`。如果是本地安装，使用 `npx xlog-cli ...`。

## 快速集成（无需安装）

将单个 JS 文件拷贝到项目中即可使用，不需要 `npm install`。支持全部 18 个 `console.*` 方法，包含完整序列化、堆栈解析、捕获分组和错误监听。

### 普通网页

下载 `standalone/xlog.min.js`（或 `xlog-plugin.js`），添加 script 标签：

```html
<script src="xlog.min.js"></script>
```

或自定义 server 地址：

```html
<script>window.__xlog_config__ = { server: "http://127.0.0.1:2718" };</script>
<script src="xlog.min.js"></script>
```

### 浏览器扩展 — Background Script（MV3 Service Worker）

```js
// background.js（service worker）
importScripts("xlog.min.js");
```

脚本会自动检测 `background` 环境，使用 `chrome.storage.session` 协调捕获，并立即刷新日志（不批量），因为 service worker 随时可能被终止。

### 浏览器扩展 — Popup / Sidepanel / Options

```html
<!-- popup.html, sidepanel.html, options.html -->
<script src="xlog.min.js"></script>
```

环境通过页面路径名自动检测（`popup`、`sidepanel`、`options`）。

### 浏览器扩展 — Content Script

```json
// manifest.json
{
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["xlog.min.js"],
    "run_at": "document_start"
  }]
}
```

### Web Worker / Service Worker

```js
// worker.js
importScripts("xlog.min.js");
```

自动检测为 `worker` 环境，日志立即刷新。

### 编程式注入（Puppeteer / Playwright）

使用精简版 `standalone/xlog.inject.js`：

```js
// Puppeteer
const page = await browser.newPage();
await page.addScriptTag({ path: "xlog.inject.js" });

// Playwright
const page = await browser.newPage();
await page.addScriptTag({ path: "xlog.inject.js" });

// chrome.scripting API
chrome.scripting.executeScript({
  target: { tabId },
  files: ["xlog.inject.js"]
});
```

### 复制粘贴到控制台

快速一次性调试，直接粘贴到浏览器控制台：

```js
var s=document.createElement("script");
s.src="http://127.0.0.1:2718/viewer/xlog.inject.js";
document.head.appendChild(s);
```

### Vite 插件（无需安装）

将 `xlog-plugin.js` 拷贝到项目中并引用：

```js
// vite.config.js
import xlogPlugin from "./xlog-plugin.js";

export default {
  plugins: [xlogPlugin()]
};
```

同时也支持作为 Babel 插件使用——它会为每个 `console.*` 调用注入源文件、行号、列号元数据，实现精确调用位置追踪。

## 给 AI 用

### MCP（推荐）

xlog-cli 内置 MCP server，AI 助手可以直接查询浏览器日志。

```bash
npx xlog-cli mcp
npx xlog-cli mcp --root /path/to/project
```

**MCP 客户端配置（Claude Desktop、Cursor 等）：**

```json
{
  "mcpServers": {
    "xlog": {
      "command": "npx",
      "args": ["xlog-cli", "mcp", "--root", "/path/to/project"]
    }
  }
}
```

**MCP 工具：**

| 工具 | 用途 |
|------|------|
| `xlog_analyze` | 分析最近的日志，返回错误、警告和紧凑的 bugpack。默认分析最近 5 分钟。 |
| `xlog_capture` | 为用户手动复现的 bug 捕获干净的时间窗口。先 `start`，再 `stop`。 |
| `xlog_query` | 原始日志查询，支持完整过滤（级别、文件、时间范围等）。 |

**配置选项：**

| 标志 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| `--retention` | `XLOG_RETENTION_MS` | 300000（5分钟） | 自动清理超过此时长的日志 |
| `--capture-duration` | `XLOG_CAPTURE_DURATION_MS` | 60000（1分钟） | 建议的单次捕获最大时长 |
| `--capture-gap` | `XLOG_CAPTURE_GAP_MS` | 10000（10秒） | 连续无新日志自动切分捕获 |

**典型 AI 调试流程：**

1. AI 通过 `xlog_analyze` 检查已有日志（无需用户操作）。
2. 如果 bug 需要手动复现，AI 调用 `xlog_capture({ action: "start" })`，让用户复现，再调用 `xlog_capture({ action: "stop" })`。
3. 需要进一步调查时，AI 使用 `xlog_query` 按条件过滤。

### 手动 Bugpack

1. 在出问题的应用里接入 `xlog-cli`。
2. 用 `npx xlog-cli bugpack` 导出最小可用上下文。
3. 把 bugpack JSON 直接交给你的 AI 工具或 agent。

最佳实践：

- 一次只分析一个 capture。
- 保持 `projectName` 稳定。
- 只保留故障窗口附近的日志。
- 给 AI 喂 bugpack JSON，不要喂截图或零散控制台输出。

## CLI

```bash
npx xlog-cli serve                           # 启动服务（默认）
npx xlog-cli mcp                             # 启动 MCP server 供 AI 助手使用
npx xlog-cli query --limit 20                # 查询日志
npx xlog-cli sessions                        # 列出会话
npx xlog-cli bugpack                         # 导出 bugpack
npx xlog-cli bugpack --capture <captureId>
npx xlog-cli bugpack --session <sessionId>
```

**MCP 选项：**

```bash
npx xlog-cli mcp --root /path/to/project --retention 180000 --capture-duration 30000
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
- `GET /api/captures`
- `GET /api/x-log`
- `POST /api/x-log`
- `GET /api/captures/:captureId/share.json`

## 包导出

- `xlog-cli`
- `xlog-cli/server`
- `xlog-cli/mcp`
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
- 如果 runtime 需要发送到已经运行的 xlog server，请显式配置 `serverUrl`。
