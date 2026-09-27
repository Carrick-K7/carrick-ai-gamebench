#!/usr/bin/env node
/**
 * GameBench Play — trusted external no-tools Pi RPC adapter (hardened against
 * the installed Pi 0.84.3 source).
 *
 *   tools/agents/pi-play.mjs <provider> <model> <thinking>
 *   tools/agents/pi-play.mjs --doctor [provider model thinking]
 *
 * The adapter is a model-external process the parent host drives over a
 * JSON-Lines envelope on stdin/stdout (outer protocol). It owns no engine or
 * game source, never emits raw chain-of-thought or provider errors/keys in
 * outer packets, and runs Pi under a private 0700 temp PI_CODING_AGENT_DIR with
 * a seeded 0600 settings.json. The user's real agent dir and global settings are
 * never written.
 *
 * OUTER protocol (parent -> adapter): init / observe / finish.
 * OUTER protocol (adapter -> parent): ready / content / action / error / finished.
 *
 * INNER protocol: the real Pi `--mode rpc` JSONL protocol (strict LF framing).
 * The adapter spawns `<pi> --mode rpc --system-prompt ... --provider ... --model
 * ... --thinking ... --no-tools --no-session --no-context-files --no-extensions
 * --no-skills --no-prompt-templates --no-themes --no-approve --offline` and
 * validates the *effective* selected configuration with model-free control RPC
 * before it reports `ready`:
 *   - get_available_models   -> exact provider/model exists and input includes "image"
 *   - get_state              -> effective provider/model/thinking + autoCompaction disabled
 *   - get_available_thinking_levels -> the selected level is supported
 *   - get_commands           -> no extension/skill/prompt commands are loaded
 *
 * Confirmed 0.84.3 settings keys (docs/settings.md) seeded into the private dir:
 *   defaultProjectTrust:"never", defaultTools:[], enableInstallTelemetry:false,
 *   compaction.enabled:false, retry.enabled:false, retry.maxRetries:0,
 *   retry.provider.maxRetries:0, images.autoResize:false.
 */

import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { rmSync, constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

const PROTOCOL_VERSION = 1;
const ADAPTER_VERSION = "1.1.0";
const AGENT = "pi";
/**
 * The ONLY audited Pi releases. This adapter's flags, settings keys, and RPC
 * contract were audited against these exact builds (docs/play-operations.md:
 * "The initial adapter targets Pi 0.84.3"), so any other release — NEWER OR
 * OLDER — is an unaudited SPI and an unscored configuration failure. Accepting
 * an arbitrary future version would silently assume the retry/image/RPC
 * contracts still hold. Adding a version requires re-auditing settings.md,
 * rpc-types.d.ts, and the live event list first.
 */
const SUPPORTED_PI_VERSIONS = Object.freeze(["0.84.3"]);
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const MAX_QUEUE = 256;
/** Bounded deadline for model-free CONTROL commands only, never inference. */
const CONTROL_TIMEOUT_MS = 15_000;

const PIN_FLAGS = [
  "--offline",
  "--no-tools",
  "--no-session",
  "--no-context-files",
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--no-themes",
  "--no-approve",
];

/** Confirmed Pi 0.84.3 settings keys (docs/settings.md) for a sealed harness. */
const ISOLATED_SETTINGS = {
  defaultProjectTrust: "never",
  defaultTools: [],
  enableInstallTelemetry: false,
  compaction: { enabled: false },
  retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
  images: { autoResize: false },
};
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

let activeAdapter; // set inside main() so a fatal error can still clean up

/** Strict player system prompt: emit exactly one action+memo JSON object. */
const SYSTEM_PROMPT = [
  "You are the player of a benchmark game. You are given one current screenshot.",
  "You must reply with exactly one JSON object and nothing else, matching this schema:",
  '  {"action": <one native action>, "memo": <optional short string>}',
  'The "action" must be exactly one of these native actions:',
  '  {"type":"key","key":"ArrowUp"}  {"type":"key","key":"ArrowDown"}',
  '  {"type":"key","key":"ArrowLeft"}  {"type":"key","key":"ArrowRight"}',
  '  {"type":"click","button":"left"|"right","x":<integer 0..1279>,"y":<integer 0..719>}',
  "Choose the single move that best advances the game from the screenshot.",
  "Do not output any explanation, commentary, or repeated text.",
].join("\n");

class AdapterError extends Error {
  constructor(kind, code, message) {
    super(message);
    this.name = "AdapterError";
    this.kind = kind; // "transport" | "adapter"
    this.code = code;
  }
}

/** LF-only, UTF-8-safe JSONL reader with a bounded queue (never Readline). */
class LineReader {
  constructor(stream, maxBytes = MAX_LINE_BYTES, maxQueue = MAX_QUEUE) {
    this.stream = stream;
    this.decoder = new StringDecoder("utf8");
    this.buffer = "";
    this.maxBytes = maxBytes;
    this.maxQueue = maxQueue;
    this.failed = null;
    this.queue = [];
    this.waiting = [];
    this.ended = false;
    this.onEnd = [];
    stream.on("data", (chunk) => this.consume(this.decoder.write(chunk)));
    stream.on("end", () => {
      this.consume(this.decoder.end());
      this.ended = true;
      for (const pending of this.waiting.splice(0)) pending.reject(new Error("input ended"));
      for (const handler of this.onEnd.splice(0)) handler();
    });
    stream.on("error", (error) => this.fail(error));
  }
  consume(text) {
    if (this.failed) return;
    this.buffer += text;
    for (;;) {
      const boundary = this.buffer.indexOf("\n");
      if (boundary < 0) break;
      const line = this.buffer.slice(0, boundary).replace(/\r$/, "");
      this.buffer = this.buffer.slice(boundary + 1);
      if (!line) continue;
      if (Buffer.byteLength(line, "utf8") > this.maxBytes) {
        this.fail(new AdapterError("transport", "line_too_long", "JSONL line exceeds the byte limit"));
        return;
      }
      let message;
      try { message = JSON.parse(line); }
      catch {
        this.fail(new AdapterError("transport", "malformed_json", "JSONL record is not valid JSON"));
        return;
      }
      this.push(message);
    }
    if (Buffer.byteLength(this.buffer, "utf8") > this.maxBytes) {
      this.fail(new AdapterError("transport", "line_too_long", "JSONL buffer exceeds the byte limit"));
    }
  }
  push(message) {
    const pending = this.waiting.shift();
    if (pending) pending.resolve(message);
    else if (this.queue.length >= this.maxQueue) {
      this.fail(new AdapterError("transport", "queue_overflow", "JSONL queue exceeded the bound"));
    } else this.queue.push(message);
  }
  fail(error) {
    this.failed ??= error;
    for (const pending of this.waiting.splice(0)) pending.reject(this.failed);
  }
  async read(timeoutMs = 0) {
    if (this.failed) throw this.failed;
    if (this.queue.length) return this.queue.shift();
    if (this.waiting.length) throw new AdapterError("transport", "concurrent_read", "concurrent reads are not allowed");
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject };
      this.waiting.push(entry);
      let timer;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          const index = this.waiting.indexOf(entry);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new AdapterError("transport", "rpc_timeout", "Pi RPC response deadline exceeded"));
        }, timeoutMs);
      }
      entry.resolve = (m) => { if (timer) clearTimeout(timer); resolve(m); };
      entry.reject = (e) => { if (timer) clearTimeout(timer); reject(e); };
    });
  }
}

function signalTree(child, signal) {
  try {
    if (child.pid && process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

/**
 * Graceful window for Pi to exit after SIGTERM, kept comfortably under the
 * parent JSONL process's 1000ms SIGTERM->SIGKILL grace so this adapter always
 * finishes its own cleanup first (killed Pi tree, removed auth copy).
 * `PI_GAMEBENCH_TEST_GRACE_MS` exists ONLY for the low-level lifecycle test;
 * a formal run never sets it.
 */
function killGraceMs() {
  const override = Number(process.env.PI_GAMEBENCH_TEST_GRACE_MS);
  return Number.isFinite(override) && override > 0 ? override : 400;
}

function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Terminate a Pi process tree within a bounded window. It waits on `exit` and
 * NEVER on `close`: a surviving grandchild that inherits Pi's stdio keeps the
 * pipe open, so `close` may never fire and an unbounded wait would hand the
 * parent a SIGKILL while the private agent dir still holds the auth copy.
 * Escalates to SIGKILL on the process group, then always returns.
 */
async function terminateTree(child, graceMs = killGraceMs(), killWaitMs = 150) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => { child.once("exit", resolve); });
  signalTree(child, "SIGTERM");
  if (await Promise.race([exited.then(() => true), delay(graceMs).then(() => false)])) return;
  signalTree(child, "SIGKILL");
  // Direct kill too, in case the child left its original process group.
  try { child.kill("SIGKILL"); } catch { /* already gone */ }
  await Promise.race([exited, delay(killWaitMs)]);
}

async function fileExists(p) {
  try { return (await stat(p)).isFile(); }
  catch { return false; }
}

/**
 * Static diagnostics for every failure this adapter can report. Untrusted Pi or
 * provider error text is NEVER turned into an outer code/message: `safeCode`
 * regex allowlists and length-clipped "scrubbing" both leak an opaque value
 * (an all-lowercase API key passes `^[a-z0-9_]+$` untouched), so RPC failures
 * collapse to a local code with a fixed message instead.
 */
const DIAGNOSTIC_MESSAGES = Object.freeze({
  pi_not_found: "the Pi executable was not found",
  pi_version_unknown: "could not read the Pi installed version",
  unsupported_pi_version: "the installed Pi release is not audited by this adapter",
  settings_seed_failed: "could not seed the private agent dir",
  rpc_command_failed: "Pi rejected an RPC command",
  rpc_timeout: "a Pi control command exceeded its deadline",
  rpc_write_failed: "could not write to Pi RPC",
  packet_too_large: "an RPC packet exceeded the byte limit",
  model_query_failed: "the Pi model query failed",
  model_not_available: "the selected provider/model is not available in Pi",
  unsupported_image: "the selected Pi model does not accept image input",
  model_mismatch: "the effective Pi model differs from the requested provider/model",
  compaction_enabled: "auto-compaction is not disabled in the effective Pi state",
  thinking_unavailable: "the effective Pi thinking level differs from the requested level",
  resources_loaded: "Pi loaded extension/skill/prompt resources despite isolation",
  pi_closed: "Pi RPC closed mid-prompt",
  pi_failed: "the Pi run failed",
  provider_error: "Pi reported a provider error",
  aborted: "Pi reported an aborted run",
  unexpected_tool_use: "Pi executed a tool while tools are disabled",
  unexpected_retry: "Pi performed an automatic retry",
  unexpected_compaction: "Pi compacted the session",
  queued_continuation: "Pi queued an unmeasured continuation",
  no_assistant_text: "Pi produced no final assistant text",
  new_session_cancelled: "Pi cancelled the new session",
  context_not_empty: "Pi did not start a fresh bounded context",
  not_initialized: "the adapter received a request before init",
  overlapping_observe: "an observe is already in progress",
  bad_turn_id: "the observe had no usable turn_id",
  config_invalid: "the Pi configuration could not be validated",
});

function diagnosticMessage(code) {
  return DIAGNOSTIC_MESSAGES[code] ?? "unclassified adapter failure";
}

/** The only thinking level names that may ever be echoed from Pi into output. */
const THINKING_NAMES = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/**
 * Pi's own inline/bundled resources are not an isolation failure: `llama` is
 * always registered from `<inline:llama.cpp>` even with --no-extensions. A
 * command backed by a real filesystem path, or sourced from a skill/prompt
 * template, is a foreign resource and does fail isolation.
 */
function isPiInlineResource(command) {
  const info = command?.sourceInfo ?? {};
  const source = String(info.source ?? "");
  const inline = source === "inline" || String(info.path ?? "").startsWith("<inline:");
  const kind = String(command?.source ?? "");
  return inline && kind !== "skill" && kind !== "prompt" && kind !== "template";
}

function writeOuter(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function resolvePiBin() {
  const explicit = process.env.PI_BIN;
  if (explicit) {
    if (!(await fileExists(explicit))) throw new AdapterError("adapter", "pi_not_found", `PI_BIN ${explicit} is not an executable file`);
    return explicit;
  }
  const found = new Promise((resolve) => {
    const child = spawn("bash", ["-lic", "command -v pi || true"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk.toString("utf8"); });
    child.on("close", () => resolve(out.trim() || null));
    child.on("error", () => resolve(null));
  });
  const resolved = await found;
  if (!resolved || !(await fileExists(resolved))) {
    throw new AdapterError("adapter", "pi_not_found", "Pi Agent executable was not found");
  }
  return resolved;
}

/** Verify the installed Pi version (model-free; never a paid call). */
/**
 * Read the ACTUAL installed Pi version and fail closed unless it is an audited
 * release. `--version` is the agent's own echo (not OS attestation), so it is
 * matched EXACTLY against the supported set rather than compared with `>=`.
 */
async function verifyPiVersion(piBin) {
  const result = await new Promise((resolve) => {
    const child = spawn(piBin, ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk.toString("utf8"); });
    child.on("close", (code) => resolve({ code, version: out.trim() }));
    child.on("error", () => resolve({ code: -1, version: "" }));
  });
  if (result.code !== 0 || !result.version) {
    throw new AdapterError("adapter", "pi_version_unknown", "could not read the Pi installed version");
  }
  const version = result.version.split("\n")[0].trim().replace(/^v/, "");
  if (!SUPPORTED_PI_VERSIONS.includes(version)) {
    const error = new AdapterError("adapter", "unsupported_pi_version", diagnosticMessage("unsupported_pi_version"));
    // Structural validation (not scrubbing): only a semver-shaped echo is kept
    // for diagnostics; any other text is discarded outright.
    error.observedVersion = /^\d+\.\d+\.\d+$/.test(version) ? version : null;
    throw error;
  }
  return version;
}

async function originalAgentDir() {
  return process.env.PI_CODING_AGENT_DIR_ORIGINAL
    ?? path.join(process.env.HOME ?? os.homedir(), ".pi", "agent");
}

async function createPrivateAgentDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-gamebench-"));
  await chmod(dir, 0o700);
  return dir;
}

/** Seed the exact confirmed settings keys at 0600. Global settings untouched. */
async function seedSettings(dir) {
  const file = path.join(dir, "settings.json");
  await writeFile(file, `${JSON.stringify(ISOLATED_SETTINGS, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  return file;
}

async function copyAuthInto(dir) {
  const source = await originalAgentDir();
  const copied = [];
  for (const name of ["auth.json", "models.json"]) {
    const from = path.join(source, name);
    let present = true;
    try { await access(from, fsConstants.R_OK); } catch { present = false; }
    if (!present) continue;
    const to = path.join(dir, name);
    await copyFile(from, to);
    await chmod(to, 0o600);
    copied.push(name);
  }
  return copied;
}

/**
 * Real Pi event types that mean a hidden resample happened (or is about to):
 * an automatic retry, compaction, tool execution, or a queued continuation.
 * Confirmed against the installed 0.85.1 RPC event list (docs/rpc.md).
 */
const VIOLATION_EVENTS = new Map([
  ["auto_retry_start", "unexpected_retry"],
  ["auto_retry_end", "unexpected_retry"],
  ["summarization_retry_scheduled", "unexpected_retry"],
  ["compaction_start", "unexpected_compaction"],
  ["compaction_end", "unexpected_compaction"],
  ["tool_execution_start", "unexpected_tool_use"],
  ["tool_execution_update", "unexpected_tool_use"],
  ["tool_execution_end", "unexpected_tool_use"],
  ["bash_execution_update", "unexpected_tool_use"],
]);

/** Classify a Pi event as an isolation violation, or return undefined. */
function violationCodeFor(event) {
  const direct = VIOLATION_EVENTS.get(event.type);
  if (direct) return direct;
  // `agent_end.willRetry:true` announces a retry that has not been emitted yet.
  if (event.type === "agent_end" && event.willRetry === true) return "unexpected_retry";
  if (event.type === "queue_update") {
    const steering = Array.isArray(event.steering) ? event.steering.length : 0;
    const followUp = Array.isArray(event.followUp) ? event.followUp.length : 0;
    if (steering > 0 || followUp > 0) return "queued_continuation";
  }
  return undefined;
}

/** Best-effort abort of an in-flight run; never awaited on the failure path. */
function abortInFlight(client) {
  const id = client.nextId++;
  client.send({ id, type: "abort" }).catch(() => {});
}

/** Real Pi `--mode rpc` client. Control commands are bounded; inference is not. */
class PiRpcClient {
  constructor(reader, writer) {
    this.reader = reader;
    this.writer = writer;
    this.nextId = 1;
    this.pending = new Map();
    this.onEvent = null;
    this.closed = false;
    this._drainLoop();
  }
  _drainLoop() {
    const step = async () => {
      for (;;) {
        let message;
        try { message = await this.reader.read(0); }
        catch (error) {
          this.closed = true;
          for (const pending of this.pending.values()) pending.reject(error);
          this.pending.clear();
          this.onEvent?.({ type: "eof" });
          return;
        }
        this._dispatch(message);
      }
    };
    void step();
  }
  _dispatch(message) {
    if (message.type === "response") {
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        if (message.success) pending.resolve(message.data);
        // Untrusted Pi error text is discarded: it can carry credentials and
        // does not cross the adapter boundary as a code or message.
        else pending.reject(new AdapterError("adapter", "rpc_command_failed", diagnosticMessage("rpc_command_failed")));
      }
      return;
    }
    if (this.onEvent) this.onEvent(message);
  }
  send(command) {
    const line = `${JSON.stringify(command)}\n`;
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
      throw new AdapterError("adapter", "packet_too_large", "outgoing Pi RPC request exceeds the byte limit");
    }
    return new Promise((resolve, reject) => {
      this.writer.write(line, (error) => {
        if (error) reject(new AdapterError("transport", "rpc_write_failed", "could not write to Pi RPC"));
        else resolve();
      });
    });
  }
  /** Bounded model-free control request. */
  request(command, timeoutMs = CONTROL_TIMEOUT_MS) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AdapterError("adapter", "rpc_timeout", "Pi control command deadline exceeded"));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (data) => { clearTimeout(timer); resolve(data); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.send({ id, ...command }).catch((error) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }
  /**
   * Streams a prompt and resolves once Pi emits `agent_settled` (the session is
   * fully settled; no retry/compaction-queue continuation remains). There is NO
   * adapter-imposed inference deadline: the parent owns the 60s decision slot.
   */
  prompt({ message, images, onContent }) {
    const id = this.nextId++;
    let contentSent = false;
    let usage;
    let lastAssistant;
    let willRetry = false;
    let resolveSettled;
    let rejectSettled;
    const settled = new Promise((resolve, reject) => { resolveSettled = resolve; rejectSettled = reject; });
    const accepted = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.onEvent = (event) => {
      if (event.type === "eof") {
        this.onEvent = null;
        rejectSettled(new AdapterError("transport", "pi_closed", "Pi RPC closed mid-prompt"));
        return;
      }
      // Isolation policy: an automatic retry, compaction, tool execution, or
      // queued steering/follow-up is a HIDDEN RESAMPLE. It is never an allowable
      // substitute for the single measured decision, so it terminates the
      // observe as an adapter failure: no action, no scoring, no new prompt.
      const violation = violationCodeFor(event);
      if (violation) {
        this.onEvent = null;
        abortInFlight(this);
        rejectSettled(new AdapterError("adapter", violation, diagnosticMessage(violation)));
        return;
      }
      if (event.type === "message_update") {
        if (event.usage) usage = event.usage;
        const delta = event.assistantMessageEvent;
        // Any model content forbids resampling, INCLUDING thinking. Only a
        // boolean marker crosses the boundary; never copy/log the thinking.
        if (!contentSent && delta && typeof delta.type === "string" && /^(text|thinking|toolcall)_/.test(delta.type)) {
          contentSent = true;
          onContent();
        }
        return;
      }
      if ((event.type === "message_end" || event.type === "turn_end") && event.message?.role === "assistant") {
        if (!contentSent && Array.isArray(event.message.content) && event.message.content.length > 0) { contentSent = true; onContent(); }
        lastAssistant = event.message;
        if (event.message.usage) usage = event.message.usage;
        return;
      }
      if (event.type === "agent_end") {
        willRetry = event.willRetry === true;
        return;
      }
      if (event.type === "agent_settled") {
        this.onEvent = null;
        resolveSettled({ usage, lastAssistant, willRetry });
      }
    };
    return this.send({ id, type: "prompt", message, images })
      .then(() => accepted)
      .then(() => settled);
  }
}

class PiAdapter {
  constructor({ provider, model, thinking, game }) {
    this.provider = provider;
    this.model = model;
    this.thinking = thinking;
    this.game = game;
    this.pi = undefined;
    this.rpc = undefined;
    this.reader = undefined;
    this.tempDir = undefined;
    this.workDir = undefined;
    this.stderr = "";
    this.initialized = false;
    this.currentTurnId = undefined;
    this.contentSent = false;
    this.piVersion = undefined;
    this.config = undefined;
  }

  async startPi() {
    if (this.pi) return this.pi;
    const piBin = await resolvePiBin();
    this.piVersion = await verifyPiVersion(piBin);
    this.tempDir = await createPrivateAgentDir();
    try {
      this.settingsPath = await seedSettings(this.tempDir);
      this.copiedAuth = await copyAuthInto(this.tempDir);
      // Pi appends cwd to its system prompt: never point it at credentials,
      // source, private seeds or evidence. This is a separate empty directory.
      this.workDir = await mkdtemp(path.join(os.tmpdir(), "gamebench-player-work-"));
      await chmod(this.workDir, 0o700);
    } catch {
      await this.cleanupTemp();
      throw new AdapterError("adapter", "settings_seed_failed", "could not seed the private agent dir");
    }
    const env = {
      ...process.env,
      PI_CODING_AGENT_DIR: this.tempDir,
      PI_OFFLINE: "1",
      PI_SKIP_VERSION_CHECK: "1",
      PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
    };
    this.pi = spawn(piBin, ["--mode", "rpc", "--system-prompt", SYSTEM_PROMPT,
      "--provider", this.provider, "--model", this.model, "--thinking", this.thinking,
      ...PIN_FLAGS], {
      cwd: this.workDir,
      env, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32",
    });
    this.pi.stderr?.on("data", (chunk) => { this.stderr = (this.stderr + chunk.toString("utf8")).slice(-4096); });
    this.pi.on("error", () => {});
    this.pi.once("exit", () => { if (this.rpc) this.rpc.closed = true; });
    this.reader = new LineReader(this.pi.stdout);
    this.rpc = new PiRpcClient(this.reader, this.pi.stdin);
    return this.pi;
  }

  /**
   * Model-free RPC validation of the EFFECTIVE selected configuration, before
   * any measured prompt. Throws (no `ready`) when the selected model, image
   * capability, thinking level, or isolation is not what was requested.
   */
  async validateConfig() {
    let models;
    try {
      models = await this.rpc.request({ type: "get_available_models" });
    } catch (error) {
      throw new AdapterError("adapter", "model_query_failed", diagnosticMessage("model_query_failed"));
    }
    const list = Array.isArray(models?.models) ? models.models : [];
    const target = list.find((m) => m && m.provider === this.provider && m.id === this.model);
    if (!target) {
      throw new AdapterError("adapter", "model_not_available", "the selected provider/model is not available in Pi");
    }
    if (!Array.isArray(target.input) || !target.input.includes("image")) {
      throw new AdapterError("adapter", "unsupported_image", "the selected Pi model does not accept image input");
    }
    const state = await this.rpc.request({ type: "get_state" });
    if (!state?.model || state.model.provider !== this.provider || state.model.id !== this.model) {
      throw new AdapterError("adapter", "model_mismatch", "the effective Pi model differs from the requested provider/model");
    }
    if (state.autoCompactionEnabled !== false) {
      throw new AdapterError("adapter", "compaction_enabled", "auto-compaction is not disabled in the effective Pi state");
    }
    // The available levels are PER MODEL (they follow the model's
    // thinkingLevelMap plus "off"), and Pi silently COERCES an unsupported
    // request to the nearest level it supports (measured on real 0.85.1:
    // minimal -> low, medium -> high, xhigh -> max). Compare the EFFECTIVE
    // level with the request so a coerced run is never reported as ready.
    const levels = await this.rpc.request({ type: "get_available_thinking_levels" });
    // Only known level NAMES may be echoed; anything else from Pi is dropped
    // rather than copied into output.
    const available = Array.isArray(levels?.levels) ? levels.levels.filter((l) => THINKING_NAMES.has(l)) : [];
    if (state.thinkingLevel !== this.thinking || !available.includes(this.thinking)) {
      const error = new AdapterError("adapter", "thinking_unavailable", diagnosticMessage("thinking_unavailable"));
      // Structured details from validated enums only: the operator can see the
      // supported set without any untrusted text crossing the boundary.
      error.details = {
        requested: THINKING_NAMES.has(this.thinking) ? this.thinking : null,
        effective: THINKING_NAMES.has(state.thinkingLevel) ? state.thinkingLevel : null,
        available,
      };
      throw error;
    }
    // Pi always registers its OWN inline extensions (measured on real 0.85.1:
    // `llama`, sourceInfo.path "<inline:llama.cpp>", source "inline", scope
    // "temporary") even under --no-extensions. Only resources sourced from
    // outside Pi's own bundle mean isolation failed.
    const commands = await this.rpc.request({ type: "get_commands" });
    const loaded = Array.isArray(commands?.commands) ? commands.commands : [];
    const foreign = loaded.filter((command) => !isPiInlineResource(command));
    if (foreign.length !== 0) {
      throw new AdapterError("adapter", "resources_loaded", diagnosticMessage("resources_loaded"));
    }
    return {
      provider: state.model.provider,
      model: state.model.id,
      thinking: state.thinkingLevel,
      image: true,
      tools: "none",
      context_window: state.model.contextWindow ?? null,
    };
  }

  async initAndReady() {
    // Validate the REAL effective configuration with model-free control RPC
    // before declaring ready; never assert the CLI identity unverified.
    await this.startPi();
    try {
      this.config = await this.validateConfig();
    } catch (error) {
      await this.cleanupTemp();
      throw error;
    }
    writeOuter({
      type: "ready",
      protocol_version: PROTOCOL_VERSION,
      identity: {
        agent: AGENT,
        version: this.piVersion,
        provider: this.config.provider,
        model: this.config.model,
        thinking: this.config.thinking,
      },
      config: { ...this.config, adapter_version: ADAPTER_VERSION, settings: SETTINGS_KEYS },
    });
    this.initialized = true;
  }

  async configureSession() {
    // Fresh session per observe, then re-assert the sealed policy.
    const result = await this.rpc.request({ type: "new_session" });
    if (result?.cancelled) throw new AdapterError("adapter", "new_session_cancelled", "Pi cancelled the new session");
    await this.rpc.request({ type: "set_auto_compaction", enabled: false });
    await this.rpc.request({ type: "set_auto_retry", enabled: false });
    await this.rpc.request({ type: "set_thinking_level", level: this.thinking });
    const state = await this.rpc.request({ type: "get_state" });
    if (state?.messageCount !== 0 || state.pendingMessageCount !== 0 || state.isStreaming !== false || state.isCompacting !== false || state.autoCompactionEnabled !== false) throw new AdapterError("adapter", "context_not_empty", diagnosticMessage("context_not_empty"));
    if (state.model?.id !== this.model || state.model?.provider !== this.provider || state.thinkingLevel !== this.thinking) throw new AdapterError("adapter", "model_mismatch", diagnosticMessage("model_mismatch"));
  }

  async handleObserve(observe) {
    if (!this.initialized) throw new AdapterError("adapter", "not_initialized", "adapter received observe before init");
    const turnId = observe.turn_id;
    if (this.currentTurnId !== undefined) throw new AdapterError("adapter", "overlapping_observe", "an observe is already in progress");
    if (typeof turnId !== "string" && typeof turnId !== "number") {
      throw new AdapterError("adapter", "bad_turn_id", "observe has no usable turn_id");
    }
    this.currentTurnId = turnId;
    this.contentSent = false;
    let beforeContent = true;
    try {
      await this.configureSession();
      const { message, images } = buildUserContext(observe);
      const result = await this.rpc.prompt({
        message,
        images,
        onContent: () => {
          if (!this.contentSent) {
            writeOuter({ type: "content", turn_id: turnId });
            this.contentSent = true;
            beforeContent = false;
          }
        },
      });
      // Abort/error settlement must not be scored as an empty invalid answer.
      const stop = result.lastAssistant?.stopReason;
      if (stop === "error") throw new AdapterError("adapter", "provider_error", "Pi reported a provider error");
      if (stop === "aborted") throw new AdapterError("adapter", "aborted", "Pi reported an aborted run");
      if (stop === "toolUse") throw new AdapterError("adapter", "unexpected_tool_use", "Pi attempted a tool call while tools are disabled");
      const lastText = await this.rpc.request({ type: "get_last_assistant_text" });
      const responseText = lastText?.text;
      if (typeof responseText !== "string") {
        throw new AdapterError("adapter", "no_assistant_text", "Pi produced no final assistant text");
      }
      writeOuter({ type: "action", turn_id: turnId, response_text: responseText, usage: toOuterUsage(result.usage) });
    } catch (error) {
      const adapterError = error instanceof AdapterError
        ? error
        : new AdapterError("transport", "pi_failed", diagnosticMessage("pi_failed"));
      writeOuter({
        type: "error",
        turn_id: turnId,
        kind: adapterError.kind,
        before_content: beforeContent,
        retryable: adapterError.kind === "transport" && beforeContent,
        code: adapterError.code,
      });
    } finally {
      this.currentTurnId = undefined;
      this.contentSent = false;
    }
  }

  async handleFinish() {
    await this.shutdown();
    writeOuter({ type: "finished" });
    process.exit(0);
  }

  /**
   * Bounded, tree-wide teardown that also works mid-inference: it never waits
   * for a prompt to settle and never waits unbounded on Pi. The private agent
   * dir is removed even when the child had to be SIGKILLed.
   */
  async shutdown() {
    const child = this.pi;
    this.pi = undefined;
    try {
      if (child) {
        try { child.stdin.end(); } catch { /* ignore */ }
        await terminateTree(child);
      }
    } finally {
      await this.cleanupTemp();
    }
  }

  async cleanupTemp() {
    for (const key of ["workDir", "tempDir"]) if (this[key]) {
      const dir = this[key];
      await rm(dir, { recursive: true, force: true });
      this[key] = undefined;
    }
  }

  /** Last-resort synchronous removal: async work cannot finish in `exit`. */
  cleanupTempSync() {
    if (this.pi && this.pi.exitCode === null) { try { signalTree(this.pi, "SIGKILL"); } catch { /* process is exiting */ } }
    for (const key of ["workDir", "tempDir"]) if (this[key]) {
      const dir = this[key];
      this[key] = undefined;
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* process is exiting */ }
    }
  }
}

function buildUserContext(observe) {
  // Bounded, whitelisted model context only: rules, remaining budget, the last
  // action records (status + native_action), the bounded memo, and the frame.
  const lastActions = Array.isArray(observe.last_actions) ? observe.last_actions : [];
  const lines = [
    "[GAME RULES]",
    String(observe.rules ?? ""),
    "",
    "[BOUNDED CONTEXT]",
    `Remaining decisions: ${Number(observe.remaining_decisions)}`,
    `Recent actions (oldest to newest): ${JSON.stringify(lastActions)}`,
    `Your previous memo: ${String(observe.memo ?? "")}`,
    "",
    "Decide the next action and reply with only the JSON object described in your instructions.",
  ].join("\n");
  const images = observe.frame?.data
    ? [{ type: "image", data: String(observe.frame.data), mimeType: "image/png" }]
    : undefined;
  return { message: lines, images };
}

function toOuterUsage(usage) {
  if (!usage) return undefined;
  const inputTokens = typeof usage.input === "number" ? usage.input : undefined;
  const outputTokens = typeof usage.output === "number" ? usage.output : undefined;
  let cost;
  const finite = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (finite(usage.cost?.total)) cost = usage.cost.total;
  else if (usage.cost) {
    const components = [usage.cost.input, usage.cost.output, usage.cost.cacheRead, usage.cost.cacheWrite];
    if (components.every(finite)) cost = components.reduce((sum, value) => sum + value, 0);
  }
  return inputTokens !== undefined || outputTokens !== undefined || cost !== undefined
    ? { input_tokens: inputTokens, output_tokens: outputTokens, cost }
    : undefined;
}

function usageText() {
  return "usage: tools/agents/pi-play.mjs <provider> <model> <thinking>";
}

/**
 * `--doctor` is model-free: no prompt and no paid call. With no arguments it is
 * a structural probe; with `<provider> <model> <thinking>` it actually starts Pi
 * RPC and validates the effective configuration.
 */
async function doctor(args) {
  const report = {
    adapter: ADAPTER_VERSION,
    node: process.version,
    agentDir: await originalAgentDir(),
    invariants: { protocol: PROTOCOL_VERSION, maxLineBytes: MAX_LINE_BYTES, supportedPiVersions: SUPPORTED_PI_VERSIONS, controlTimeoutMs: CONTROL_TIMEOUT_MS, settingsKeys: SETTINGS_KEYS },
    provider: args[0] ?? null,
    model: args[1] ?? null,
    thinking: args[2] ?? null,
  };
  let piBin;
  try {
    piBin = await resolvePiBin();
    report.pi = piBin;
    report.piVersion = await verifyPiVersion(piBin);
  } catch (error) {
    const code = error instanceof AdapterError ? error.code : "pi_not_found";
    // Keep the resolved path visible; the failing field is the version.
    const observed = error instanceof AdapterError && error.observedVersion ? { observed: error.observedVersion } : {};
    if (piBin) report.piVersion = { error: code, ...observed };
    else report.pi = { error: code };
  }
  let temp;
  try {
    temp = await createPrivateAgentDir();
    report.settingsPath = await seedSettings(temp);
    report.authCopied = await copyAuthInto(temp);
    report.settings = JSON.parse(await readFile(report.settingsPath, "utf8"));
    report.tempDir = "ok";
  } catch (error) {
    report.tempDir = { error: error instanceof AdapterError ? error.code : "settings_seed_failed" };
  }
  if (piBin && temp && args.length === 3) {
    // Full model-free validation against the effective configuration.
    const adapter = new PiAdapter({ provider: args[0], model: args[1], thinking: args[2] });
    try {
      await adapter.startPi();
      report.config = await adapter.validateConfig();
      await adapter.configureSession(); // control-plane freshness proof; never prompt
    } catch (error) {
      const code = error instanceof AdapterError ? error.code : "config_invalid";
      const details = error instanceof AdapterError && error.details ? { details: error.details } : {};
      report.config = { error: code, message: diagnosticMessage(code), ...details };
    } finally {
      await adapter.shutdown();
    }
  }
  if (temp) await rm(temp, { recursive: true, force: true }).catch(() => {});
  // A doctor that found a broken configuration must fail loudly so it can gate
  // CI/CLI startup; only a fully verified probe exits 0.
  report.ok = typeof report.pi === "string"
    && typeof report.piVersion === "string"
    && report.tempDir === "ok"
    && !report.config?.error
    && (args.length === 0 || report.config !== undefined);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return report.ok ? 0 : 70;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--doctor") {
    const rest = args.slice(1);
    // A partial provider/model/thinking triple is a usage error, never a
    // silently-clean structural probe.
    if (rest.length !== 0 && rest.length !== 3) {
      process.stderr.write(`${usageText()}\n       tools/agents/pi-play.mjs --doctor [provider model thinking]\n`);
      process.exit(64);
    }
    process.exitCode = await doctor(rest);
    return;
  }
  if (args.length !== 3) {
    process.stderr.write(`${usageText()}\n       tools/agents/pi-play.mjs --doctor [provider model thinking]\n`);
    process.exit(64);
  }
  const [provider, model, thinking] = args;
  if (!process.versions.node.startsWith("22.22")) {
    process.stderr.write(`node ${process.versions.node} is not the pinned 22.22.0\n`);
  }

  const adapter = new PiAdapter({ provider, model, thinking });
  activeAdapter = adapter;
  const stdin = new LineReader(process.stdin);
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    try { await adapter.shutdown(); }
    finally { if (signal === "SIGTERM" || signal === "SIGINT") process.exit(0); }
  };
  process.on("SIGTERM", () => { void stop("SIGTERM"); });
  process.on("SIGINT", () => { void stop("SIGINT"); });
  process.on("exit", () => { adapter.cleanupTempSync(); });
  stdin.onEnd.push(async () => { if (!stopping) await adapter.shutdown(); });

  for (;;) {
    let message;
    try { message = await stdin.read(0); }
    catch { await stop("EOF"); break; }
    if (!message) continue;
    if (message.type === "init") {
      if (message.protocol_version !== PROTOCOL_VERSION) {
        process.stderr.write(`unsupported outer protocol_version ${message.protocol_version}\n`);
        await adapter.shutdown();
        process.exit(65);
      }
      if (!["2048", "minesweeper"].includes(message.game)) {
        process.stderr.write(`unsupported game ${String(message.game)}\n`);
        await adapter.shutdown();
        process.exit(66);
      }
      adapter.game = message.game;
      await adapter.initAndReady();
    } else if (message.type === "observe") {
      await adapter.handleObserve(message);
    } else if (message.type === "finish") {
      await adapter.handleFinish();
      break;
    } else {
      process.stderr.write(`unknown outer message type: ${String(message.type)}\n`);
    }
  }
}

main().catch(async (error) => {
  // AdapterError messages are authored locally (static or built from validated
  // enums), never derived from Pi/provider text; anything else is reported with
  // a fixed message so untrusted text cannot reach stderr.
  const isAdapter = error instanceof AdapterError;
  const code = isAdapter ? error.code : "unclassified_failure";
  const message = isAdapter ? diagnosticMessage(error.code) : "the adapter failed with an unclassified error";
  process.stderr.write(`fatal [${code}]: ${message}\n`);
  if (activeAdapter) await activeAdapter.shutdown();
  process.exit(70);
});
