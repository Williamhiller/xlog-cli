import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createXLogMcpServer } from "../src/mcp/server.js";
import { createXLogServer } from "../src/server/server.js";
import os from "node:os";
import path from "node:path";
import { rm } from "node:fs/promises";

describe("createXLogMcpServer", () => {
  it("creates server and store", async () => {
    const tmpDir = path.join(os.tmpdir(), `xlog-mcp-test-${Date.now()}`);
    const { server, store } = createXLogMcpServer({
      root: tmpDir,
      dataDir: ".xlog-test",
      retentionMs: 60000
    });
    assert.ok(server);
    assert.ok(store);
    await store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("passes debug DOM snapshot config to the managed HTTP server", async () => {
    const tmpDir = path.join(os.tmpdir(), `xlog-mcp-test-${Date.now()}-debug`);
    const { store, httpServerReady } = createXLogMcpServer({
      root: tmpDir,
      dataDir: ".xlog-test",
      retentionMs: 60000,
      debugDomSnapshots: true
    });

    const httpServer = await httpServerReady;
    assert.equal(httpServer.debugDomSnapshots, true);

    await store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });
});

describe("createXLogServer", () => {
  it("exposes debug DOM snapshot mode in server state", async () => {
    const tmpDir = path.join(os.tmpdir(), `xlog-server-test-${Date.now()}`);
    const server = await createXLogServer({
      projectRoot: tmpDir,
      dataDir: ".xlog-test",
      silent: true,
      debugDomSnapshots: true
    });

    assert.equal(server.debugDomSnapshots, true);
    await server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });
});
