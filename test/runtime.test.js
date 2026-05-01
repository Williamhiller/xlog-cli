import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { installXLog } from "../src/runtime/interceptor.js";

describe("installXLog runtime flushing", () => {
  it("requeues failed batches instead of dropping logs", async () => {
    const originalWindow = globalThis.window;
    const originalLocation = globalThis.location;
    const originalDocument = globalThis.document;
    const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const originalFetch = globalThis.fetch;
    const originalConsoleLog = console.log;

    let calls = 0;
    const listeners = new Map();

    globalThis.window = {
      addEventListener(name, listener) {
        listeners.set(name, listener);
      },
      removeEventListener(name) {
        listeners.delete(name);
      }
    };
    globalThis.window.window = globalThis.window;
    globalThis.location = {
      href: "http://localhost:3000/",
      origin: "http://localhost:3000",
      pathname: "/"
    };
    globalThis.document = {
      title: "Runtime Test",
      referrer: "",
      addEventListener() {},
      removeEventListener() {}
    };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "node-test" }
    });
    globalThis.fetch = async () => {
      calls += 1;
      return { ok: calls > 1 };
    };
    console.log = () => {};

    try {
      const api = installXLog({
        serverUrl: "http://127.0.0.1:2718",
        projectName: "runtime-test",
        flushInterval: 100000,
        maxBatchSize: 10
      });

      console.log("first");
      await api.flush();

      assert.equal(api.getState().queued, 1);

      await api.flush();
      assert.equal(api.getState().queued, 0);
      assert.equal(calls, 2);

      api.uninstall();
    } finally {
      console.log = originalConsoleLog;
      if (originalWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = originalWindow;
      }
      if (originalLocation === undefined) {
        delete globalThis.location;
      } else {
        globalThis.location = originalLocation;
      }
      if (originalDocument === undefined) {
        delete globalThis.document;
      } else {
        globalThis.document = originalDocument;
      }
      if (originalNavigatorDescriptor) {
        Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
      } else {
        delete globalThis.navigator;
      }
      globalThis.fetch = originalFetch;
    }
  });
});
