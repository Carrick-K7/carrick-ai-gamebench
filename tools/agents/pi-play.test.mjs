import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, chmod, readFile, rm, stat, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import test from "node:test";

const ADAPTER = new URL("./pi-play.mjs", import.meta.url).pathname;
const FAKE_PI = new URL("./pi-play.fake-pi.mjs", import.meta.url).pathname;
const PROVIDER = "deepseek";
const MODEL = "deepseek-v4-flash";
const THINKING = "medium";
const SETTINGS_KEYS = [
  "defaultProjectTrust",
  "defaultTools",
  "enableInstallTelemetry",
  "compaction.enabled",
  "retry.enabled",
  "retry.maxRetries",
  "retry.provider.maxRetries",
  "images.autoResize",
];

/** LF-only, UTF-8-safe JSONL reader for driving the adapter under test. */
class LineReader {
  constructor(stream) {
    this.decoder = new StringDecoder("utf8");
    this.buffer = "";
    this.queue = [];
    this.waiting = [];
    stream.on("data", (chunk) => this.consume(this.decoder.write(chunk)));
    stream.on("end", () => {
      this.consume(this.decoder.end());
      for (const pending of this.waiting.splice(0)) pending.reject(new Error("child ended"));
    });
    stream.on("error", (error) => { for (const pending of this.waiting.splice(0)) pending.reject(error); });
  }
  consume(text) {
    this.buffer += text;
    for (;;) {
      const i = this.buffer.indexOf("\n");
      if (i < 0) break;
      const line = this.buffer.slice(0, i).replace(/\r$/, "");
      this.buffer = this.buffer.slice(i + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); }
      catch { for (const pending of this.waiting.splice(0)) pending.reject(new Error("malformed child JSONL")); return; }
      const waiting = this.waiting.shift();
      if (waiting) waiting.resolve(message);
      else this.queue.push(message);
    }
  }
  async read(timeoutMs = 6_000) {
    if (this.queue.length) return this.queue.shift();
    if (this.waiting.length) throw new Error("concurrent reads");
    return new Promise((resolve, reject) => {
      const entry = { resolve: null, reject: null };
      const timer = setTimeout(() => {
        const index = this.waiting.indexOf(entry);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new Error("child read timed out"));
      }, timeoutMs);
      entry.resolve = (m) => { clearTimeout(timer); resolve(m); };
      entry.reject = (e) => { clearTimeout(timer); reject(e); };
      this.waiting.push(entry);
    });
  }
}

class AdapterUnderTest {
  constructor(env, faultEnv = {}) {
    this.child = spawn(process.execPath, [ADAPTER, PROVIDER, MODEL, THINKING], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: env.playerCwd,
      env: {
        ...process.env,
        PI_BIN: FAKE_PI,
        PI_CODING_AGENT_DIR_ORIGINAL: env.auth,
        PI_FAKE_LOG: env.log,
        PI_FAKE_SETTINGS_LOG: env.settingsLog,
        PI_FAKE_ISOLATION_LOG: env.isolationLog,
        ...faultEnv,
      },
    });
    this.reader = new LineReader(this.child.stdout);
    this.stderr = "";
    this.child.stderr.on("data", (chunk) => { this.stderr += chunk.toString("utf8"); });
    this.exit = new Promise((resolve) => { this.child.on("close", (code) => resolve(code)); });
  }
  send(msg) { this.child.stdin.write(`${JSON.stringify(msg)}\n`); }
  read() { return this.reader.read(); }
  async close() {
    try { this.child.stdin.end(); } catch { /* ignore */ }
    return this.exit;
  }
}

async function makeAuthDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-auth-"));
  await writeFile(path.join(dir, "auth.json"), JSON.stringify({ provider: PROVIDER, credentials: "fake" }), { mode: 0o600 });
  await writeFile(path.join(dir, "models.json"), JSON.stringify({ models: [] }), { mode: 0o600 });
  await chmod(path.join(dir, "auth.json"), 0o600);
  await chmod(path.join(dir, "models.json"), 0o600);
  return dir;
}

async function newTestEnv() {
  const auth = await makeAuthDir();
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-test-"));
  const playerCwd = await mkdtemp(path.join(os.tmpdir(), "pi-cwd-"));
  return {
    auth, root, playerCwd,
    log: path.join(root, "pi.log"),
    settingsLog: path.join(root, "settings.json"),
    isolationLog: path.join(root, "isolation.json"),
  };
}

async function initReady(adapter) {
  adapter.send({ type: "init", protocol_version: 1, game: "2048" });
  const ready = await adapter.read();
  assert.equal(ready.type, "ready");
  return ready;
}

function makeObserve(turnId, overrides = {}) {
  return {
    type: "observe",
    turn_id: turnId,
    rules: "2048: merge equal tiles. Use arrow keys.",
    frame: { media_type: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" },
    remaining_decisions: 199,
    last_actions: [{ status: "action", native_action: { type: "key", key: "ArrowLeft" } }],
    memo: "keep big tile in the corner",
    ...overrides,
  };
}

async function initFailure(adapter) {
  adapter.send({ type: "init", protocol_version: 1, game: "2048" });
  const code = await Promise.race([
    adapter.exit,
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 6_000)),
  ]);
  return code;
}

/** Poll the fake's command log until a command of `type` appears (bounded). */
async function waitForCommand(logPath, type, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let commands = [];
    try {
      commands = (await readFile(logPath, "utf8")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch { /* the log may not exist yet */ }
    if (commands.some((c) => c.type === type)) return commands;
    if (Date.now() > deadline) throw new Error(`the adapter never sent ${type}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function cleanup(env) {
  await rm(env.auth, { recursive: true, force: true }).catch(() => {});
  await rm(env.root, { recursive: true, force: true }).catch(() => {});
  await rm(env.playerCwd, { recursive: true, force: true }).catch(() => {});
}

test("pi adapter: --doctor (no args) is a model-free structural probe", async () => {
  const env = await newTestEnv();
  try {
    const child = spawn(process.execPath, [ADAPTER, "--doctor"], {
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, PI_BIN: FAKE_PI, PI_CODING_AGENT_DIR_ORIGINAL: env.auth },
    });
    const report = await new LineReader(child.stdout).read();
    assert.equal(report.piVersion, "0.84.3");
    assert.ok(typeof report.pi === "string" && report.pi.endsWith("pi-play.fake-pi.mjs"));
    assert.equal(report.tempDir, "ok");
    assert.deepEqual(report.authCopied.sort(), ["auth.json", "models.json"]);
    // Confirmed settings keys seeded (no invented/unknown retry settings).
    assert.deepEqual(Object.keys(report.settings).sort(), ["compaction", "defaultProjectTrust", "defaultTools", "enableInstallTelemetry", "images", "retry"].sort());
    assert.deepEqual(report.settings.retry, { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } });
    assert.equal(report.settings.compaction.enabled, false);
    assert.equal(report.settings.images.autoResize, false);
    assert.equal(report.settings.enableInstallTelemetry, false);
    assert.deepEqual(report.invariants.settingsKeys, SETTINGS_KEYS);
    assert.equal(report.config, undefined, "no-args doctor does not start inference");
    assert.equal(await new Promise((resolve) => child.on("close", resolve)), 0);
  } finally {
    await cleanup(env);
  }
});

test("pi adapter: --doctor <provider> <model> <thinking> validates over RPC with no prompt", async () => {
  const env = await newTestEnv();
  try {
    const child = spawn(process.execPath, [ADAPTER, "--doctor", PROVIDER, MODEL, THINKING], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PI_BIN: FAKE_PI, PI_CODING_AGENT_DIR_ORIGINAL: env.auth, PI_FAKE_LOG: env.log },
    });
    const report = await new LineReader(child.stdout).read();
    assert.deepEqual(report.config, {
      provider: PROVIDER, model: MODEL, thinking: THINKING, image: true, tools: "none", context_window: 128000,
    });
    // No prompt was ever sent (model-free validation).
    const commands = (await readFile(env.log, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(commands.some((c) => c.type === "get_available_models"));
    assert.ok(commands.some((c) => c.type === "get_state"));
    assert.ok(!commands.some((c) => c.type === "prompt"));
    assert.equal(await new Promise((resolve) => child.on("close", resolve)), 0);
  } finally {
    await cleanup(env);
  }
});

test("pi adapter: init validates real config, observe gives one content + action, finish cleans up", async () => {
  const env = await newTestEnv();
  const adapter = new AdapterUnderTest(env);
  try {
    const ready = await initReady(adapter);
    assert.deepEqual(ready.identity, { agent: "pi", version: "0.84.3", provider: PROVIDER, model: MODEL, thinking: THINKING });
    assert.equal(ready.config.image, true);
    assert.equal(ready.config.tools, "none");

    adapter.send(makeObserve("turn-1"));
    const content = await adapter.read();
    assert.deepEqual(content, { type: "content", turn_id: "turn-1" });
    const action = await adapter.read();
    assert.equal(action.type, "action");
    assert.equal(action.turn_id, "turn-1");
    assert.ok(JSON.parse(action.response_text).action, "response_text is the verbatim action+memo JSON");
    assert.equal(action.usage.output_tokens, 34);

    // Per-observe sealed-session control commands.
    const commands = (await readFile(env.log, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(commands.some((c) => c.type === "new_session"));
    assert.ok(commands.some((c) => c.type === "set_auto_compaction" && c.enabled === false));
    assert.ok(commands.some((c) => c.type === "set_auto_retry" && c.enabled === false));
    assert.ok(commands.some((c) => c.type === "set_thinking_level" && c.level === THINKING));

    // Bounded model context is a strict whitelist (no turn_id, no extra fields).
    const prompt = commands.find((c) => c.type === "prompt");
    assert.ok(prompt);
    assert.match(prompt.message, /Remaining decisions: 199/);
    assert.match(prompt.message, /keep big tile in the corner/);
    assert.match(prompt.message, /"native_action"/);
    assert.ok(!prompt.message.includes("turn-1"), "turn_id must never reach the model context");
    assert.equal(prompt.images.length, 1);
    assert.equal(prompt.images[0].mimeType, "image/png");

    // Confirmed settings were seeded at 0600 inside a 0700 private agent dir.
    const settings = JSON.parse(await readFile(env.settingsLog, "utf8"));
    assert.deepEqual(settings.retry, { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } });
    assert.equal(settings.compaction.enabled, false);
    assert.equal(settings.images.autoResize, false);
    assert.equal(settings.enableInstallTelemetry, false);
    assert.equal(settings.defaultProjectTrust, "never");
    const isolation = JSON.parse(await readFile(env.isolationLog, "utf8"));
    assert.equal(isolation.agentDirMode, "700");
    assert.equal(isolation.settingsMode, "600");
    assert.equal(isolation.offline, "1");
    assert.deepEqual(isolation.cwdEntries, []);
    assert.notEqual(isolation.cwd, isolation.agentDir, "Pi's model-visible cwd must not point at credentials");
    assert.equal(isolation.cwd.startsWith(`${isolation.agentDir}${path.sep}`), false);

    // The private agent dir is removed on finish.
    const agentDir = isolation.agentDir;
    adapter.send({ type: "finish" });
    assert.deepEqual(await adapter.read(), { type: "finished" });
    assert.equal(await adapter.close(), 0);
    await assert.rejects(stat(agentDir), "private agent dir must be cleaned up");
    await assert.rejects(stat(isolation.cwd), "isolated model cwd must be cleaned up");
  } finally {
    await cleanup(env);
  }
});

test("pi adapter: usage includes cache charges and never invents missing costs as zero", async () => {
  for (const [cost, expected] of [[{ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 }, 10], [{ input: 1 }, undefined]]) {
    const env = await newTestEnv();
    const adapter = new AdapterUnderTest(env, { PI_FAKE_COST: JSON.stringify(cost) });
    try {
      await initReady(adapter); adapter.send(makeObserve("usage")); await adapter.read();
      const action = await adapter.read();
      assert.equal(action.type, "action");
      assert.equal(action.usage.cost, expected);
      adapter.send({ type: "finish" }); await adapter.read(); await adapter.close();
    } finally { await adapter.close(); await cleanup(env); }
  }
});

test("pi adapter: thinking forbids a transport retry without exposing the thinking", async () => {
  const env = await newTestEnv();
  const adapter = new AdapterUnderTest(env, { PI_FAKE_THINKING_CLOSE: "1" });
  try {
    await initReady(adapter);
    adapter.send(makeObserve("thinking-stop"));
    const content = await adapter.read();
    const error = await adapter.read();
    assert.equal(content.type, "content");
    assert.equal(error.type, "error");
    assert.equal(error.before_content, false);
    assert.equal(error.retryable, false);
    assert.equal(JSON.stringify([content, error]).includes("private-thinking-canary"), false);
    adapter.send({ type: "finish" });
    assert.equal((await adapter.read()).type, "finished");
    await adapter.close();
    assert.equal(adapter.stderr.includes("private-thinking-canary"), false);
  } finally { await adapter.close(); await cleanup(env); }
});

test("pi adapter: stale SDK context is rejected before the next model prompt", async () => {
  const env = await newTestEnv();
  const adapter = new AdapterUnderTest(env, { PI_FAKE_STALE_CONTEXT: "1" });
  try {
    await initReady(adapter);
    adapter.send(makeObserve("first")); await adapter.read(); assert.equal((await adapter.read()).type, "action");
    adapter.send(makeObserve("second"));
    const failed = await adapter.read();
    assert.equal(failed.type, "error");
    assert.equal(failed.code, "context_not_empty");
    assert.equal(failed.retryable, false);
    const commands = (await readFile(env.log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(commands.filter((command) => command.type === "prompt").length, 1);
    adapter.send({ type: "finish" }); await adapter.read(); await adapter.close();
  } finally { await adapter.close(); await cleanup(env); }
});

test("pi adapter: unsupported image is rejected at init before any ready", async () => {
  const env = await newTestEnv();
  const adapter = new AdapterUnderTest(env, { PI_FAKE_NO_IMAGE: "1" });
  try {
    assert.notEqual(await initFailure(adapter), 0);
    assert.match(adapter.stderr, /unsupported_image/);
  } finally {
    await cleanup(env);
  }
});

test("pi adapter: an effective model mismatch is rejected at init", async () => {
  const env = await newTestEnv();
  const adapter = new AdapterUnderTest(env, { PI_FAKE_MODEL_MISMATCH: "1" });
  try {
    assert.notEqual(await initFailure(adapter), 0);
    assert.match(adapter.stderr, /model_mismatch/);
  } finally {
    await cleanup(env);
  }
});

test("pi adapter: prompt preflight failure -> adapter error before content", async () => {
  const env = await newTestEnv();
  const adapter = new AdapterUnderTest(env, { PI_FAKE_PROMPT_ERROR: "1" });
  try {
    await initReady(adapter);
    adapter.send(makeObserve("turn-2"));
    const error = await adapter.read();
    assert.equal(error.type, "error");
    assert.equal(error.kind, "adapter");
    assert.equal(error.before_content, true);
    assert.equal(error.retryable, false);
    assert.equal(error.turn_id, "turn-2");
  } finally {
    await adapter.close();
    await cleanup(env);
  }
});

for (const [reason, code] of [["error", "provider_error"], ["aborted", "aborted"]]) {
  test(`pi adapter: a ${reason} settlement becomes an adapter error, not an empty invalid answer`, async () => {
    const env = await newTestEnv();
    const adapter = new AdapterUnderTest(env, { PI_FAKE_STOP_REASON: reason });
    try {
      await initReady(adapter);
      adapter.send(makeObserve("turn-3"));
      const content = await adapter.read();
      assert.equal(content.type, "content");
      const error = await adapter.read();
      assert.equal(error.type, "error");
      assert.equal(error.kind, "adapter");
      assert.equal(error.code, code);
      assert.equal(error.before_content, false);
      assert.equal(error.retryable, false);
    } finally {
      await adapter.close();
      await cleanup(env);
    }
  });
}

test("pi adapter: transport close after content -> transport error, not retryable", async () => {
  const env = await newTestEnv();
  const adapter = new AdapterUnderTest(env, { PI_FAKE_CLOSE_MID: "1" });
  try {
    await initReady(adapter);
    adapter.send(makeObserve("turn-4"));
    assert.equal((await adapter.read()).type, "content");
    const error = await adapter.read();
    assert.equal(error.type, "error");
    assert.equal(error.kind, "transport");
    assert.equal(error.before_content, false);
    assert.equal(error.retryable, false);
  } finally {
    await adapter.close();
    await cleanup(env);
  }
});

// A hidden resample (retry, compaction, tool execution, or queued continuation)
// is never an allowable substitute for the single measured decision: it must
// terminate the observe as an adapter failure with no action and no scoring.
for (const [fault, faultEnv, code] of [
  ["retry", { PI_FAKE_RETRY: "1" }, "unexpected_retry"],
  ["compaction", { PI_FAKE_COMPACT: "1" }, "unexpected_compaction"],
  ["tool execution", { PI_FAKE_TOOL: "1" }, "unexpected_tool_use"],
  ["queued continuation", { PI_FAKE_QUEUE: "1" }, "queued_continuation"],
]) {
  test(`pi adapter: a hidden ${fault} is an adapter failure, never a salvaged action`, async () => {
    const env = await newTestEnv();
    const adapter = new AdapterUnderTest(env, faultEnv);
    try {
      await initReady(adapter);
      adapter.send(makeObserve("turn-5"));
      const packets = [];
      for (;;) {
        const packet = await adapter.read();
        packets.push(packet);
        if (packet.type === "error" || packet.type === "action") break;
      }
      const error = packets.at(-1);
      assert.equal(error.type, "error", "a hidden resample must not produce an action");
      assert.equal(error.kind, "adapter");
      assert.equal(error.code, code);
      assert.equal(error.retryable, false, "the parent must not be told to resample");
      assert.equal(error.before_content, false, "the fake streams text before the violation");
      assert.ok(!packets.some((p) => p.type === "action"), "no action may be scored from a hidden resample");
      // The adapter also aborts the in-flight run instead of letting it continue.
      await waitForCommand(env.log, "abort");
    } finally {
      await adapter.close();
      await cleanup(env);
    }
  });
}

test("pi adapter: a delayed response is not cut off by an adapter deadline", async () => {
  const env = await newTestEnv();
  const adapter = new AdapterUnderTest(env, { PI_FAKE_DELAY_MS: "500" });
  try {
    await initReady(adapter);
    adapter.send(makeObserve("turn-6"));
    assert.equal((await adapter.read()).type, "content");
    assert.equal((await adapter.read()).type, "action");
  } finally {
    await adapter.close();
    await cleanup(env);
  }
});

test("pi adapter: unknown outer message type does not crash the loop", async () => {
  const env = await newTestEnv();
  const adapter = new AdapterUnderTest(env);
  try {
    await initReady(adapter);
    adapter.send({ type: "bogus" });
    adapter.send(makeObserve("turn-7"));
    assert.equal((await adapter.read()).type, "content");
    assert.equal((await adapter.read()).type, "action");
    adapter.send({ type: "finish" });
    assert.deepEqual(await adapter.read(), { type: "finished" });
    assert.equal(await adapter.close(), 0);
  } finally {
    await cleanup(env);
  }
});

// --- Compatibility gate: only an audited Pi release may be used -------------

test("pi adapter: an unaudited Pi release is rejected at init before any ready", async () => {
  const env = await newTestEnv();
  const adapter = new AdapterUnderTest(env, { PI_FAKE_VERSION: "0.85.1" });
  try {
    assert.notEqual(await initFailure(adapter), 0);
    assert.match(adapter.stderr, /unsupported_pi_version/);
  } finally {
    await cleanup(env);
  }
});

test("pi adapter: --doctor fails closed on an unaudited Pi release", async () => {
  const env = await newTestEnv();
  try {
    const child = spawn(process.execPath, [ADAPTER, "--doctor"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PI_BIN: FAKE_PI, PI_CODING_AGENT_DIR_ORIGINAL: env.auth, PI_FAKE_VERSION: "0.85.1" },
    });
    const report = await new LineReader(child.stdout).read();
    assert.deepEqual(report.piVersion, { error: "unsupported_pi_version", observed: "0.85.1" });
    assert.equal(report.ok, false);
    assert.deepEqual(report.invariants.supportedPiVersions, ["0.84.3"]);
    assert.equal(await new Promise((resolve) => child.on("close", resolve)), 70);
  } finally {
    await cleanup(env);
  }
});

test("pi adapter: an audited release with a partial doctor triple is a usage error", async () => {
  const env = await newTestEnv();
  try {
    const child = spawn(process.execPath, [ADAPTER, "--doctor", PROVIDER, MODEL], {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, PI_BIN: FAKE_PI, PI_CODING_AGENT_DIR_ORIGINAL: env.auth },
    });
    assert.equal(await new Promise((resolve) => child.on("close", resolve)), 64);
  } finally {
    await cleanup(env);
  }
});

// --- Effective thinking level: Pi coerces, the adapter must not accept it ----

test("pi adapter: a coerced thinking level is rejected at init before any ready", async () => {
  const env = await newTestEnv();
  // Real deepseek vision models report ["off","low","high","max"]: "medium"
  // is silently coerced to "high" by Pi, which must never be reported as ready.
  const adapter = new AdapterUnderTest(env, { PI_FAKE_THINKING_MAP: "low,high,max" });
  try {
    assert.notEqual(await initFailure(adapter), 0);
    assert.match(adapter.stderr, /thinking_unavailable/);
  } finally {
    await cleanup(env);
  }
});

test("pi adapter: --doctor reports the supported thinking set for a coerced level", async () => {
  const env = await newTestEnv();
  try {
    const child = spawn(process.execPath, [ADAPTER, "--doctor", PROVIDER, MODEL, THINKING], {
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, PI_BIN: FAKE_PI, PI_CODING_AGENT_DIR_ORIGINAL: env.auth, PI_FAKE_THINKING_MAP: "low,high,max" },
    });
    const report = await new LineReader(child.stdout).read();
    assert.equal(report.config.error, "thinking_unavailable");
    assert.deepEqual(report.config.details, { requested: "medium", effective: "high", available: ["off", "low", "high", "max"] });
    assert.equal(report.ok, false);
    assert.equal(await new Promise((resolve) => child.on("close", resolve)), 70);
  } finally {
    await cleanup(env);
  }
});

test("pi adapter: a model missing from Pi's list is rejected at init", async () => {
  const env = await newTestEnv();
  const adapter = new AdapterUnderTest(env, { PI_FAKE_MODEL_LIST_OMIT: "1" });
  try {
    assert.notEqual(await initFailure(adapter), 0);
    assert.match(adapter.stderr, /model_not_available/);
  } finally {
    await cleanup(env);
  }
});

// --- Untrusted Pi/provider error text must never reach any output -----------

const OPAQUE_CREDENTIAL = "opaquecredential12345";

test("pi adapter: an opaque credential in an RPC error never reaches doctor stdout", async () => {
  const env = await newTestEnv();
  try {
    const child = spawn(process.execPath, [ADAPTER, "--doctor", PROVIDER, MODEL, THINKING], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PI_BIN: FAKE_PI, PI_CODING_AGENT_DIR_ORIGINAL: env.auth, PI_FAKE_RPC_ERROR: OPAQUE_CREDENTIAL },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c.toString("utf8"); });
    child.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
    const code = await new Promise((resolve) => child.on("close", resolve));
    const report = JSON.parse(stdout.trim().split("\n")[0]);
    // The failure is reported with a local enumerated code and a static message.
    assert.equal(report.config.error, "model_query_failed");
    assert.equal(report.config.message, "the Pi model query failed");
    assert.equal(report.ok, false);
    assert.equal(code, 70);
    assert.ok(!stdout.includes(OPAQUE_CREDENTIAL), "doctor stdout leaked the credential");
    assert.ok(!stderr.includes(OPAQUE_CREDENTIAL), "doctor stderr leaked the credential");
  } finally {
    await cleanup(env);
  }
});

test("pi adapter: an opaque credential in an RPC error never reaches init stderr", async () => {
  const env = await newTestEnv();
  const adapter = new AdapterUnderTest(env, { PI_FAKE_RPC_ERROR: OPAQUE_CREDENTIAL });
  try {
    assert.notEqual(await initFailure(adapter), 0);
    // The untrusted text is replaced by a local code and a fixed message.
    assert.match(adapter.stderr, /fatal \[model_query_failed\]: the Pi model query failed/);
    assert.ok(!adapter.stderr.includes(OPAQUE_CREDENTIAL), "init stderr leaked the credential");
  } finally {
    await cleanup(env);
  }
});

test("pi adapter: the isolated auth copy is never echoed into doctor evidence or logs", async () => {
  const env = await newTestEnv();
  const secret = "opaquecredential12345";
  await writeFile(path.join(env.auth, "auth.json"), JSON.stringify({ provider: PROVIDER, credentials: secret }), { mode: 0o600 });
  try {
    // The 3-arg probe starts Pi, so the fake also copies the seeded settings.
    const child = spawn(process.execPath, [ADAPTER, "--doctor", PROVIDER, MODEL, THINKING], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PI_BIN: FAKE_PI, PI_CODING_AGENT_DIR_ORIGINAL: env.auth, PI_FAKE_SETTINGS_LOG: env.settingsLog },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c.toString("utf8"); });
    child.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
    assert.equal(await new Promise((resolve) => child.on("close", resolve)), 0);
    const report = JSON.parse(stdout.trim().split("\n")[0]);
    // Only the copied FILE NAMES are evidence; contents stay in the temp dir.
    assert.deepEqual(report.authCopied.sort(), ["auth.json", "models.json"]);
    assert.ok(!stdout.includes(secret) && !stderr.includes(secret));
    assert.ok(!(await readFile(env.settingsLog, "utf8")).includes(secret));
    // The doctor's own private agent dir (with its auth copy) is removed too.
    assert.ok(!existsSync(path.dirname(report.settingsPath)), `doctor left ${report.settingsPath} behind`);
  } finally {
    await cleanup(env);
  }
});

// --- Lifecycle: SIGTERM/EOF cleanup inside the parent's 1000ms grace --------

function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

async function waitUntil(predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("pi adapter: SIGTERM during ongoing inference kills the Pi tree and removes the agent dir", async () => {
  const env = await newTestEnv();
  // A stubborn fault: Pi and a grandchild in its process group ignore SIGTERM and
  // hold stdout open (so `close` never fires) while inference is still running.
  const adapter = new AdapterUnderTest(env, {
    PI_FAKE_STUBBORN: "1",
    PI_FAKE_DELAY_MS: "60000",
    PI_FAKE_ISOLATION_LOG: env.isolationLog,
  });
  try {
    await initReady(adapter);
    const evidence = JSON.parse(await readFile(env.isolationLog, "utf8"));
    assert.ok(evidence.pid > 0);
    assert.ok(evidence.grandchildPid > 0);
    assert.ok(isAlive(evidence.pid), "Pi is running");
    assert.match(evidence.agentDir, /pi-gamebench-/);

    // Start a measured inference, then terminate mid-run exactly as the parent does.
    adapter.send(makeObserve("turn-lifecycle"));
    const started = Date.now();
    adapter.child.kill("SIGTERM");
    const code = await adapter.exit;
    const elapsed = Date.now() - started;

    assert.equal(code, 0);
    assert.ok(elapsed < 2_500, `cleanup took ${elapsed}ms; it must fit inside the parent grace`);
    // The private agent dir (with the copied auth) is gone.
    assert.ok(await waitUntil(() => !existsSync(evidence.agentDir)), `agent dir survived: ${evidence.agentDir}`);
    // Neither Pi nor the grandchild that only a group kill could reach survives.
    assert.ok(await waitUntil(() => !isAlive(evidence.pid)), `Pi process survived: ${evidence.pid}`);
    assert.ok(await waitUntil(() => !isAlive(evidence.grandchildPid)), `grandchild survived: ${evidence.grandchildPid}`);
  } finally {
    await adapter.close().catch(() => {});
    await cleanup(env);
  }
});

test("pi adapter: EOF cleanup also kills the Pi tree and removes the agent dir", async () => {
  const env = await newTestEnv();
  const adapter = new AdapterUnderTest(env, {
    PI_FAKE_STUBBORN: "1",
    PI_FAKE_DELAY_MS: "60000",
    PI_FAKE_ISOLATION_LOG: env.isolationLog,
  });
  try {
    await initReady(adapter);
    const evidence = JSON.parse(await readFile(env.isolationLog, "utf8"));
    adapter.send(makeObserve("turn-eof"));
    // Parent closes the outer JSONL stdin instead of signalling.
    adapter.child.stdin.end();
    const code = await adapter.exit;
    assert.equal(code, 0);
    assert.ok(await waitUntil(() => !existsSync(evidence.agentDir)), `agent dir survived: ${evidence.agentDir}`);
    assert.ok(await waitUntil(() => !isAlive(evidence.pid)), `Pi process survived: ${evidence.pid}`);
    assert.ok(await waitUntil(() => !isAlive(evidence.grandchildPid)), `grandchild survived: ${evidence.grandchildPid}`);
  } finally {
    await adapter.close().catch(() => {});
    await cleanup(env);
  }
});

test("pi adapter: Pi's own inline extension is not an isolation failure", async () => {
  const env = await newTestEnv();
  const adapter = new AdapterUnderTest(env);
  try {
    // The fake mirrors real Pi, which always registers "<inline:llama.cpp>".
    const ready = await initReady(adapter);
    assert.equal(ready.config.tools, "none");
  } finally {
    await adapter.close();
    await cleanup(env);
  }
});

test("pi adapter: a foreign skill/extension resource is rejected at init", async () => {
  const env = await newTestEnv();
  const adapter = new AdapterUnderTest(env, { PI_FAKE_FOREIGN_COMMAND: "1" });
  try {
    assert.notEqual(await initFailure(adapter), 0);
    assert.match(adapter.stderr, /resources_loaded/);
  } finally {
    await cleanup(env);
  }
});
