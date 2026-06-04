# xlog-cli

[English](README.md) | 简体中文

本地优先的浏览器日志工具，为 AI 工作流设计。收集日志、构建 bugpack、喂给 LLM。

npm 包地址：[xlog-cli](https://www.npmjs.com/package/xlog-cli)

## 安装

```bash
npm install xlog-cli
# 或全局安装
npm install -g xlog-cli
```

## 快速开始

### 1. 启动服务器

```bash
npx xlog-cli serve
# → listening on http://127.0.0.1:2718
```

服务器负责接收浏览器日志并提供 viewer。需要先启动。

### 2. 添加插件

**Vite**

```js
// vite.config.js
import { xlogVitePlugin } from "xlog-cli/vite";

export default {
  plugins: [xlogVitePlugin()]
};
```

**Webpack**

```js
// webpack.config.js
import { XLogWebpackPlugin } from "xlog-cli/webpack";

export default {
  plugins: [new XLogWebpackPlugin()]
};
```

启动开发服务器，访问 `http://127.0.0.1:2718/` 查看日志。

## CLI

CLI 直接读取本地文件，不需要启动服务器或 MCP。

```bash
npx xlog-cli query --limit 20    # 查询日志
npx xlog-cli sessions            # 列出会话
npx xlog-cli bugpack             # 导出 bugpack 给 AI
```

## MCP（AI 集成）

可选：MCP server 让 AI 助手通过工具查询日志。

```bash
# 启动 MCP（连接到 127.0.0.1:2718 的服务器）
npx xlog-mcp

# 或指定自定义服务器
npx xlog-mcp --server-url http://127.0.0.1:3000
```

Claude Code 配置：

```json
{
  "mcpServers": {
    "xlog": {
      "command": "npx",
      "args": ["xlog-mcp"]
    }
  }
}
```

### MCP 工具

| 工具 | 用途 |
|------|------|
| `xlog_status` | 检查 MCP 和服务器连接状态 |
| `xlog_analyze` | 分析最近日志，返回错误和 bugpack |
| `xlog_query` | 按条件查询日志 |
| `xlog_capture` | 捕获时间窗口用于复现 |
| `xlog_context` | 获取某条日志的上下文 |
| `xlog_diff` | 对比两个 capture 排查回归 |
| `xlog_insights` | AI 驱动的模式分析 |
| `xlog_patterns` | 检测错误突发和重复错误 |
| `xlog_anomalies` | 检测异常模式 |
| `xlog_trends` | 分析错误率趋势 |

### AI 调试流程

1. `xlog_analyze` — 检查已有日志
2. `xlog_capture` — 如需复现
3. AI 给出修复建议

## 架构

```
xlog-cli serve          ← HTTP 服务器（接收浏览器日志，提供 viewer）
xlog-mcp                ← MCP 服务器（连接 HTTP 服务器，向 AI 暴露工具）
Vite/Webpack 插件       ← 向浏览器注入 runtime（发送日志到服务器）
```

**Server-first**：HTTP 服务器是独立基础设施，MCP 和插件是连接它的客户端。

```
浏览器 → POST /api/x-log → xlog-cli serve → .xlog/（JSONL + SQLite）
                                    ↑
                              xlog-mcp → AI 助手
```

## 配置

### 服务器

```bash
xlog-cli serve --port 3000 --host 127.0.0.1
```

默认 strict port：端口被占用时直接报错。使用 `--no-strict-port` 允许自动选择附近端口。

### 插件

```js
xlogVitePlugin({
  serverUrl: "http://127.0.0.1:3000",  // 默认 http://127.0.0.1:2718
  projectName: "my-app",
  debugDomSnapshots: false
})
```

### MCP

```bash
xlog-mcp --server-url http://127.0.0.1:3000 --project my-app
```

环境变量：`XLOG_SERVER_URL`、`XLOG_PROJECT_NAME`、`XLOG_RETENTION_MS`、`XLOG_CAPTURE_DURATION_MS`、`XLOG_CAPTURE_GAP_MS`。

## Claude Code Skill

在 Claude Code 中使用 `/xlog` 直接查询日志：

```
/xlog                    # 分析最近日志
/xlog query              # 按条件查询
/xlog sessions           # 列出会话
/xlog bugpack            # 导出 bugpack
```

## 免安装集成

```html
<script src="xlog.min.js"></script>
```

## 存储

日志路径：`.xlog/projects/<project>/sessions/<date>/<session>.jsonl`
