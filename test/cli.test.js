import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin/xlog-cli.js");

function waitForOutput(stream, matcher, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for output: ${matcher}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      stream.off("data", handleData);
    }

    function handleData(chunk) {
      buffer += chunk;
      const match = buffer.match(matcher);
      if (!match) {
        return;
      }

      cleanup();
      resolve(match);
    }

    stream.setEncoding("utf8");
    stream.on("data", handleData);
  });
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGINT");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2000);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe("xlog-cli env config", () => {
  it("enables debug DOM snapshots for serve via environment variable", async () => {
    const tmpDir = path.join(os.tmpdir(), `xlog-cli-serve-env-test-${Date.now()}`);
    const child = spawn(process.execPath, [
      CLI_PATH,
      "serve",
      "--root",
      tmpDir,
      "--data-dir",
      ".xlog-test",
      "--port",
      "2729",
      "--strict-port"
    ], {
      env: {
        ...process.env,
        XLOG_DEBUG_DOM_SNAPSHOTS: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    try {
      const match = await waitForOutput(child.stdout, /\[xlog\] listening on (http:\/\/\S+)/);
      const response = await fetch(`${match[1]}/api/health`);
      const payload = await response.json();
      assert.equal(payload.debugDomSnapshots, true);
    } finally {
      await stopProcess(child);
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("enables debug DOM snapshots for MCP-managed server via environment variable", async () => {
    const tmpDir = path.join(os.tmpdir(), `xlog-cli-mcp-env-test-${Date.now()}`);
    const child = spawn(process.execPath, [
      CLI_PATH,
      "mcp",
      "--root",
      tmpDir,
      "--data-dir",
      ".xlog-test",
      "--port",
      "2730",
      "--strict-port"
    ], {
      env: {
        ...process.env,
        XLOG_DEBUG_DOM_SNAPSHOTS: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    try {
      const match = await waitForOutput(child.stderr, /serve=(http:\/\/\S+)/);
      const response = await fetch(`${match[1]}/api/health`);
      const payload = await response.json();
      assert.equal(payload.debugDomSnapshots, true);
    } finally {
      await stopProcess(child);
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
