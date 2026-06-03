---
name: xlog
description: 查询浏览器日志，分析错误，导出 bugpack
---

# xlog Skill

查询和分析 xlog-cli 收集的浏览器日志。

## 使用方式

```
/xlog                    # 分析最近日志
/xlog query              # 查询日志
/xlog sessions           # 列出会话
/xlog bugpack            # 导出 bugpack
```

## 实现

当用户调用 `/xlog` 时，执行以下命令：

### 无参数（分析模式）

```bash
bash .claude/skills/xlog-query.sh analyze
```

分析输出，总结：
1. 错误数量和类型
2. 关键错误的堆栈
3. 修复建议

### `query`

```bash
bash .claude/skills/xlog-query.sh query --limit 20
```

可选参数：
- `--level error` - 按级别
- `--file src/App.tsx` - 按文件
- `--q "fetch failed"` - 搜索

### `sessions`

```bash
bash .claude/skills/xlog-query.sh sessions
```

### `bugpack`

```bash
bash .claude/skills/xlog-query.sh bugpack
```

## 输出处理

1. 解析 JSON 输出
2. 按错误类型分组
3. 提取关键堆栈信息
4. 给出修复方向
