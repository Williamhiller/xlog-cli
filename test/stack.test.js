import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseStack, resolveCallsite } from "../src/shared/stack.js";

describe("stack callsite resolution", () => {
  it("prefers webpack source module frames over xlog and warning wrappers", () => {
    const rawStack = `Error
    at captureStack (chrome-extension://abc/vendor.js:252762:17)
    at captureEntry (chrome-extension://abc/vendor.js:251977:81)
    at console.<computed> [as error] (chrome-extension://abc/vendor.js:252031:14)
    at printWarning (chrome-extension://abc/vendor.js:130768:15)
    at Object.createUnionTypeChecker [as oneOfType] (chrome-extension://abc/vendor.js:131122:9)
    at ./src/component/content/automatic/popover/united-at/testing/index.jsx (chrome-extension://abc/components.js:102637:70)
    at __webpack_require__ (chrome-extension://abc/content.js:143384:42)
    at ./src/component/content/automatic/popover/united-at/index.js (chrome-extension://abc/components.js:101594:66)`;

    const stack = parseStack(rawStack);
    const callsite = resolveCallsite(null, stack);

    assert.equal(stack.frames[0].functionName, "./src/component/content/automatic/popover/united-at/testing/index.jsx");
    assert.equal(callsite.source, "stack-module");
    assert.equal(callsite.file, "src/component/content/automatic/popover/united-at/testing/index.jsx");
    assert.equal(callsite.line, 102637);
    assert.equal(callsite.column, 70);
    assert.equal(callsite.url, "chrome-extension://abc/components.js");
  });
});
