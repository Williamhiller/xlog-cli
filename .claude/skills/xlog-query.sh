#!/bin/bash
# xlog-query.sh - 查询 xlog 日志的辅助脚本

set -e

# 默认参数
LIMIT=20
LEVEL=""
FILE=""
QUERY=""
ACTION="query"

# 解析参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --limit)
      LIMIT="$2"
      shift 2
      ;;
    --level)
      LEVEL="$2"
      shift 2
      ;;
    --file)
      FILE="$2"
      shift 2
      ;;
    --q|--query)
      QUERY="$2"
      shift 2
      ;;
    analyze|query|sessions|bugpack)
      ACTION="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# 执行命令
case $ACTION in
  analyze)
    echo "## 最近日志分析"
    echo ""
    echo "### 错误日志"
    npx xlog-cli query --limit 50 --level error 2>/dev/null || echo "无错误日志"
    echo ""
    echo "### 警告日志"
    npx xlog-cli query --limit 20 --level warn 2>/dev/null || echo "无警告日志"
    ;;
  query)
    CMD="npx xlog-cli query --limit $LIMIT"
    [ -n "$LEVEL" ] && CMD="$CMD --level $LEVEL"
    [ -n "$FILE" ] && CMD="$CMD --file $FILE"
    [ -n "$QUERY" ] && CMD="$CMD --q $QUERY"
    eval $CMD
    ;;
  sessions)
    npx xlog-cli sessions
    ;;
  bugpack)
    npx xlog-cli bugpack
    ;;
  *)
    echo "未知操作: $ACTION"
    exit 1
    ;;
esac
