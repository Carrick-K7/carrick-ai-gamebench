import assert from "node:assert/strict";
import test from "node:test";
import { evaluatorEnvironment } from "../src/process.js";
import { isAllowedRuntimeUrl } from "../src/runtime-security.js";

test("evaluator environment excludes provider credentials and code injection", () => {
  const result = evaluatorEnvironment({
    PATH: "/bin",
    LANG: "C.UTF-8",
    OPENAI_API_KEY: "secret",
    NODE_OPTIONS: "--require=/tmp/inject.js",
  });
  assert.deepEqual(result, { PATH: "/bin", LANG: "C.UTF-8" });
});

test("runtime network policy allows only the evaluated local origin", () => {
  const baseUrl = "http://127.0.0.1:4173";
  assert.equal(isAllowedRuntimeUrl(baseUrl, `${baseUrl}/assets/game.js`), true);
  assert.equal(isAllowedRuntimeUrl(baseUrl, "data:text/plain,game"), true);
  assert.equal(isAllowedRuntimeUrl(baseUrl, "https://example.com/game.js"), false);
  assert.equal(isAllowedRuntimeUrl(baseUrl, "http://127.0.0.1:9999/sidecar"), false);
});
