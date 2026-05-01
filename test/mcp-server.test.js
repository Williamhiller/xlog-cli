import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createXLogMcpServer } from "../src/mcp/server.js";
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
});
