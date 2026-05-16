import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { installXLog, xlogConsole } from "../src/runtime/interceptor.js";

function createMockElement({
  tagName = "BUTTON",
  id = "save",
  className = "primary cta",
  textContent = "Save changes",
  outerHTML = '<button id="save" class="primary cta" onclick="secret()">Save changes</button>',
  attributes = [
    { name: "id", value: id },
    { name: "class", value: className },
    { name: "onclick", value: "secret()" }
  ]
} = {}) {
  const ElementBase = typeof globalThis.Element === "function" ? globalThis.Element : class {};

  class MockElement extends ElementBase {
    constructor() {
      super();
      this.nodeType = 1;
      this.tagName = tagName;
      this.id = id;
      this.className = className;
      this.textContent = textContent;
      this.outerHTML = outerHTML;
      this.attributes = attributes;
      this.children = [];
      this.childNodes = [];
      this.parentElement = null;
      this.parentNode = null;
    }

    getAttributeNames() {
      return this.attributes.map((attribute) => attribute.name);
    }

    getAttribute(name) {
      const found = this.attributes.find((attribute) => attribute.name === name);
      return found ? found.value : null;
    }
  }

  return new MockElement();
}

describe("installXLog runtime flushing", () => {
  function installBrowserGlobals() {
    const originalWindow = globalThis.window;
    const originalLocation = globalThis.location;
    const originalDocument = globalThis.document;
    const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const originalFetch = globalThis.fetch;
    const originalConsoleLog = console.log;
    const originalElement = globalThis.Element;
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
    globalThis.Element = class Element {};
    console.log = () => {};

    return {
      listeners,
      restore() {
        try {
          const installed = installXLog();
          installed?.uninstall?.();
        } catch {
          // Ignore cleanup errors in tests.
        }
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
        if (originalElement === undefined) {
          delete globalThis.Element;
        } else {
          globalThis.Element = originalElement;
        }
        globalThis.fetch = originalFetch;
      }
    };
  }

  it("requeues failed project logs instead of dropping logs", async () => {
    const globals = installBrowserGlobals();
    let calls = 0;

    globalThis.fetch = async () => {
      calls += 1;
      return { ok: calls > 1 };
    };

    try {
      const api = installXLog({
        serverUrl: "http://127.0.0.1:2718",
        projectName: "runtime-test",
        flushInterval: 100000,
        maxBatchSize: 10
      });

      xlogConsole("log", { file: "src/App.jsx", line: 1, column: 1 }, "first");
      await api.flush();

      assert.equal(api.getState().queued, 1);

      await api.flush();
      assert.equal(api.getState().queued, 0);
      assert.equal(calls, 2);

      api.uninstall();
    } finally {
      globals.restore();
    }
  });

  it("echoes injected console calls with a source suffix without persisting it in args", async () => {
    const globals = installBrowserGlobals();
    const echoed = [];
    const payloads = [];

    console.log = (...args) => {
      echoed.push(args);
    };
    globalThis.fetch = async (_url, options) => {
      payloads.push(JSON.parse(options.body));
      return { ok: true };
    };

    try {
      const api = installXLog({
        serverUrl: "http://127.0.0.1:2718",
        projectName: "runtime-test",
        flushInterval: 100000,
        maxBatchSize: 10
      });

      xlogConsole("log", { file: "src/foo/bar.js", line: 12, column: 8 }, "hello");
      await api.flush();

      assert.deepEqual(echoed[0], ["hello", "[src/foo/bar.js:12:8]"]);
      assert.deepEqual(payloads[0].logs[0].args, [{ type: "string", value: "hello" }]);
      assert.equal(payloads[0].logs[0].text, "hello");

      api.uninstall();
    } finally {
      globals.restore();
    }
  });

  it("captures debug DOM snapshots with sanitized HTML when enabled", async () => {
    const globals = installBrowserGlobals();
    const payloads = [];

    globalThis.fetch = async (_url, options) => {
      payloads.push(JSON.parse(options.body));
      return { ok: true };
    };

    try {
      const api = installXLog({
        serverUrl: "http://127.0.0.1:2718",
        projectName: "runtime-test",
        flushInterval: 100000,
        maxBatchSize: 10,
        debugDomSnapshots: true
      });

      const element = createMockElement();
      xlogConsole("log", { file: "src/foo/bar.js", line: 12, column: 8 }, "clicked", element);
      await api.flush();

      const domArg = payloads[0].logs[0].args[1];
      assert.equal(domArg.type, "dom");
      assert.equal(domArg.captureMode, "debug");
      assert.equal(domArg.selector, "button#save.cta.primary");
      assert.ok(domArg.outerHTMLSanitized.includes("<button"));
      assert.ok(!domArg.outerHTMLSanitized.includes("onclick="));
      assert.ok(payloads[0].logs[0].text.includes("button#save"));

      api.uninstall();
    } finally {
      globals.restore();
    }
  });

  it("omits oversized sanitized HTML while keeping DOM metadata", async () => {
    const globals = installBrowserGlobals();
    const payloads = [];

    globalThis.fetch = async (_url, options) => {
      payloads.push(JSON.parse(options.body));
      return { ok: true };
    };

    try {
      const api = installXLog({
        serverUrl: "http://127.0.0.1:2718",
        projectName: "runtime-test",
        flushInterval: 100000,
        maxBatchSize: 10,
        debugDomSnapshots: true
      });

      const largeText = "x".repeat(70 * 1024);
      const element = createMockElement({
        textContent: largeText,
        outerHTML: `<div id="save">${largeText}</div>`,
        tagName: "DIV",
        attributes: [{ name: "id", value: "save" }]
      });
      xlogConsole("log", { file: "src/foo/bar.js", line: 12, column: 8 }, element);
      await api.flush();

      const domArg = payloads[0].logs[0].args[0];
      assert.equal(domArg.tooLarge, true);
      assert.equal(domArg.truncated, true);
      assert.equal(domArg.outerHTMLSanitized, null);
      assert.ok(domArg.hash);
      assert.ok(domArg.text.startsWith("x"));

      api.uninstall();
    } finally {
      globals.restore();
    }
  });

  it("loads debug DOM snapshot mode from server health when not explicitly configured", async () => {
    const globals = installBrowserGlobals();
    const payloads = [];

    globalThis.fetch = async (url, options = {}) => {
      if (String(url).endsWith("/api/health")) {
        return {
          ok: true,
          json: async () => ({ debugDomSnapshots: true })
        };
      }

      payloads.push(JSON.parse(options.body));
      return { ok: true };
    };

    try {
      const api = installXLog({
        serverUrl: "http://127.0.0.1:2718",
        projectName: "runtime-test",
        flushInterval: 100000,
        maxBatchSize: 10
      });

      const element = createMockElement();
      xlogConsole("log", { file: "src/foo/bar.js", line: 12, column: 8 }, element);
      await Promise.resolve();
      await Promise.resolve();
      await api.flush();

      const domArg = payloads[0].logs[0].args[0];
      assert.equal(domArg.captureMode, "debug");
      assert.ok(domArg.outerHTMLSanitized);

      api.uninstall();
    } finally {
      globals.restore();
    }
  });

  it("echoes source suffix when xlogConsole falls back before runtime install", () => {
    const originalConsoleLog = console.log;
    const echoed = [];

    console.log = (...args) => {
      echoed.push(args);
    };

    try {
      xlogConsole("log", { file: "src/foo/bar.js", line: 12, column: 8 }, "hello");
      assert.deepEqual(echoed[0], ["hello", "[src/foo/bar.js:12:8]"]);
    } finally {
      console.log = originalConsoleLog;
    }
  });

  it("does not persist global console calls by default", async () => {
    const globals = installBrowserGlobals();
    let calls = 0;

    globalThis.fetch = async () => {
      calls += 1;
      return { ok: true };
    };

    try {
      const api = installXLog({
        serverUrl: "http://127.0.0.1:2718",
        projectName: "runtime-test",
        flushInterval: 100000,
        maxBatchSize: 10
      });

      console.log("third-party warning");
      await api.flush();

      assert.equal(api.getState().queued, 0);
      assert.equal(calls, 0);

      api.uninstall();
    } finally {
      globals.restore();
    }
  });
});
