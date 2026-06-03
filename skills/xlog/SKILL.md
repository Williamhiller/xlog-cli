---
name: xlog
description: Query and analyze browser logs collected by xlog-cli
---

# xlog

Query browser logs, analyze errors, export bugpacks.

## Usage

```
/xlog              # Analyze recent logs
/xlog query        # Query logs
/xlog sessions     # List sessions
/xlog bugpack      # Export bugpack
```

## Commands

```bash
# Query (run in project directory)
npx xlog-cli query --limit 20
npx xlog-cli query --level error
npx xlog-cli query --file src/App.tsx

# Or specify project root
npx xlog-cli query --root /path/to/project

# Sessions
npx xlog-cli sessions

# Bugpack
npx xlog-cli bugpack

# Server
npx xlog-cli serve
```

## Notes

- Logs stored in `.xlog/` under project directory
- Run commands in project directory, or use `--root` to specify path
- `npm install xlog-cli` vs `npx xlog-cli` - same functionality

## Analyze Mode

When `/xlog` is called without arguments:
1. Fetch errors and warnings
2. Group by type
3. Extract stack traces
4. Suggest fixes
