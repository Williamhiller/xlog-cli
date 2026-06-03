import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import lockfile from "proper-lockfile";

const LOCK_STALE_MS = 30000;      // 30 秒未更新 → 认为锁过期
const LOCK_UPDATE_MS = 10000;     // 每 10 秒更新一次锁
const HEALTH_CHECK_TIMEOUT = 2000; // 健康检查超时 2 秒
const MAX_PORT_ATTEMPTS = 100;     // 最多尝试 100 个端口

/**
 * 检查端口是否可用
 */
async function isPortAvailable(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", () => resolve(false));
    probe.listen({ port, host }, () => {
      probe.close(() => resolve(true));
    });
  });
}

/**
 * 从指定端口开始，找到第一个可用端口
 */
async function allocatePort(startPort = 2718, host = "127.0.0.1") {
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset++) {
    const port = startPort + offset;
    if (await isPortAvailable(port, host)) {
      return port;
    }
  }
  throw new Error(`No available ports found starting from ${startPort}`);
}

/**
 * 检查进程是否存活
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 = 检测进程是否存在
    return true;
  } catch {
    return false;
  }
}

/**
 * 检查 HTTP 服务器是否响应
 */
async function isServerAlive(url) {
  try {
    const res = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT)
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 解析 MCP 实例
 *
 * 返回值：
 * - { role: "primary", port, release } - 主实例，负责启动 HTTP 服务器
 * - { role: "secondary", serverUrl } - 次实例，连接到已有的服务器
 */
export async function resolveInstance(projectName, projectRoot, options = {}) {
  const xlogDir = path.join(projectRoot, ".xlog");
  const lockPath = path.join(xlogDir, ".mcp-lock");
  const infoPath = path.join(xlogDir, "mcp-info.json");
  const startPort = options.startPort || 2718;
  const host = options.host || "127.0.0.1";

  // 确保 .xlog 目录存在
  fs.mkdirSync(xlogDir, { recursive: true });

  // 清理过期的 mcp-info.json（如果存在）
  cleanExpiredInfo(infoPath);

  // 尝试成为主实例
  try {
    const release = await lockfile.lock(lockPath, {
      retries: 0, // 不重试，快速失败
      stale: LOCK_STALE_MS,
      update: {
        mtime: LOCK_UPDATE_MS
      },
      realpath: false
    });

    // 成为主实例
    const port = await allocatePort(startPort, host);
    const info = {
      port,
      host,
      pid: process.pid,
      projectName,
      projectRoot,
      startedAt: Date.now()
    };
    fs.writeFileSync(infoPath, JSON.stringify(info, null, 2));

    return {
      role: "primary",
      port,
      host,
      infoPath,
      release: async () => {
        try {
          await release();
        } catch {}
        try {
          fs.unlinkSync(infoPath);
        } catch {}
      }
    };
  } catch {
    // 获取锁失败，尝试连接到已有的主实例
    return await connectToExisting(infoPath, lockPath, projectName, projectRoot, options);
  }
}

/**
 * 连接到已有的主实例
 */
async function connectToExisting(infoPath, lockPath, projectName, projectRoot, options) {
  try {
    const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));

    // 验证主实例是否存活
    const alive = await verifyInstanceAlive(info);

    if (alive) {
      return {
        role: "secondary",
        serverUrl: `http://${info.host || "127.0.0.1"}:${info.port}`
      };
    }

    // 主实例已死，清理过期信息，重试
    cleanExpiredInfo(infoPath);
    await forceUnlock(lockPath);

    // 递归重试
    return await resolveInstance(projectName, projectRoot, options);
  } catch {
    // mcp-info.json 不存在或损坏，重试
    cleanExpiredInfo(infoPath);
    await forceUnlock(lockPath);
    return await resolveInstance(projectName, projectRoot, options);
  }
}

/**
 * 验证实例是否存活
 */
async function verifyInstanceAlive(info) {
  // 检查 PID 是否存在
  if (!isProcessAlive(info.pid)) {
    return false;
  }

  // 检查 HTTP 服务器是否响应
  const url = `http://${info.host || "127.0.0.1"}:${info.port}`;
  return await isServerAlive(url);
}

/**
 * 清理过期的 mcp-info.json
 */
function cleanExpiredInfo(infoPath) {
  try {
    const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));

    // 如果进程不存在，删除过期信息
    if (!isProcessAlive(info.pid)) {
      fs.unlinkSync(infoPath);
    }
  } catch {
    // 文件不存在或损坏，尝试删除
    try {
      fs.unlinkSync(infoPath);
    } catch {}
  }
}

/**
 * 强制释放锁
 */
async function forceUnlock(lockPath) {
  try {
    await lockfile.unlock(lockPath, { realpath: false });
  } catch {}
}

/**
 * 发现已有的 MCP 服务器
 *
 * 用于 Vite 插件等场景，检查是否有 MCP 管理的服务器
 */
export async function discoverMcpServer(projectRoot) {
  const infoPath = path.join(projectRoot, ".xlog", "mcp-info.json");

  try {
    const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));

    // 验证主实例是否存活
    const alive = await verifyInstanceAlive(info);

    if (alive) {
      return `http://${info.host || "127.0.0.1"}:${info.port}`;
    }

    // 主实例已死，清理过期信息
    cleanExpiredInfo(infoPath);
    return null;
  } catch {
    return null;
  }
}
