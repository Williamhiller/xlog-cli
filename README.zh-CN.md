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

### Vite

```js
// vite.config.js
import { xlogVitePlugin } from "xlog-cli/vite";

export default {
  plugins: [xlogVitePlugin()]
};
```

### Webpack

```js
// webpack.config.js
import { XLogWebpackPlugin } from "xlog-cli/webpack";

export default {
  plugins: [new XLogWebpackPlugin()]
};
```

启动开发服务器，访问 `http://127.0.0.1:2718/viewer/` 查看日志。

## CLI

CLI 直接读取本地文件，不需要启动服务器或 MCP。

```bash
npx xlog-cli query --limit 20    # 查询日志
npx xlog-cli sessions            # 列出会话
npx xlog-cli bugpack             # 导出 bugpack 给 AI
npx xlog-cli serve               # 启动 HTTP 服务器（可选）
```

## Claude Code Skill

在 Claude Code 中使用 `/xlog` 直接查询日志：

```
/xlog                    # 分析最近日志
/xlog query              # 按条件查询
/xlog sessions           # 列出会话
/xlog bugpack            # 导出 bugpack
```

## MCP（AI 集成）

可选：MCP server 让 AI 助手直接查询日志。

```json
{
  "mcpServers": {
    "xlog": {
      "command": "npx",
      "args": ["xlog-cli", "mcp"]
    }
  }
}
```

**自动发现**：MCP 和 Vite/Webpack 插件会自动互相发现。

### MCP 工具

| 工具 | 用途 |
|------|------|
| `xlog_analyze` | 分析最近日志，返回错误和 bugpack |
| `xlog_query` | 按条件查询日志 |
| `xlog_capture` | 捕获时间窗口用于复现 |

### AI 调试流程

1. `xlog_analyze` — 检查已有日志
2. `xlog_capture` — 如需复现
3. AI 给出修复建议

## 免安装集成

```html
<script src="xlog.min.js"></script>
```

## 存储

日志路径：`.xlog/projects/<project>/sessions/<date>/<session>.jsonl`
