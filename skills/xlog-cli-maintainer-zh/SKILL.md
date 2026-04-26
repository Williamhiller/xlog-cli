---
name: xlog-cli-maintainer-zh
description: 用于维护和扩展 xlog-cli 仓库（CLI、daemon/server API、runtime 拦截、storage/index、viewer UI）。当任务涉及 bugpack 驱动排障、capture/session 分组、日志查询与存储变更、插件注入链路，或需要修改 bin/、src/、viewer/、viewer-react/ 时使用此中文 skill。
---

# xlog-cli 维护助手（中文）

## 目标

让对 xlog-cli 的改动始终围绕本地优先日志链路：采集浏览器日志、归并 capture、导出 bugpack、在 viewer 中核对结果。

## 执行流程

1. 先复现并缩小范围。  
先跑 [references/command-playbook.md](references/command-playbook.md) 的最小命令集，确认问题落在 daemon 健康、日志入库、capture 分组、query 过滤还是 viewer 渲染。

2. 改动前先定位模块归属。  
通过 [references/module-map.md](references/module-map.md) 选择最小可修改边界，避免跨层误改。

3. 保留兼容别名。  
涉及公开接口时，除非任务明确要求移除，否则保留 `xlog*` 与 `xlogger*` 双前缀导出和 API 兼容。

4. 按行为验证，不只看静态代码。  
至少覆盖受影响层的一个真实命令或 API 路径（runtime、server/storage、viewer 构建）。

5. 用 bugpack 视角汇报结果。  
输出优先描述 `capture`、`logs`、`session`、`summary` 和 viewer 表现，便于继续交给 AI 接力。

## 约束

- 非明确要求时，不改默认地址行为（`127.0.0.1:2718`）。
- 保持存储兼容：`.xlog/projects/<project>/sessions/<date>/<session>.jsonl`。
- 保持 SQLite 不可用时的 JSONL fallback 行为。
- 保持当前 capture/session 的排序语义（通常是最新优先）。

## 常见任务模板

### 调整 CLI 行为

优先修改 `bin/xlog.js`，只联动其直接调用的 server/runtime 模块。完成后至少验证 `daemon status`、`query`、`bugpack`。

### 调整日志采集或过滤

修改 `src/runtime/` 以及必要的 `src/server/storage.js`、`src/server/sqlite-index.js`。同时验证写入链路（`POST /api/x-log`）和读取链路（`query`、`sessions`、`bugpack`）。

### 调整 capture 分组

修改 `src/server/captures.js`，并确认 `bugpack` 导出的 capture id、时间窗口和分组结果符合预期。

### 调整 viewer 渲染

现代 UI 优先改 `viewer-react/src/`；仅在需要兼容时改 `viewer/`。改动后运行 `npm run build:viewer` 并通过 `/viewer/` 访问验证。

## 参考

- 先读 [references/module-map.md](references/module-map.md) 了解文件归属与边界。
- 先读 [references/command-playbook.md](references/command-playbook.md) 使用可复现命令序列。
