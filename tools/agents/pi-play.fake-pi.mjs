#!/usr/bin/env node
/**
 * Fake Pi RPC server for adapter tests only. It mirrors the REAL 0.85.1
 * (and 0.84.3) `--mode rpc` JSONL protocol shapes (Model.input,
 * agent_end/agent_settled, message_update.assistantMessageEvent,
 * RpcSessionState, per-model thinking levels) so the adapter can be exercised
 * end-to-end with no real Pi, credentials, or paid calls.
 *
 * Fault-injection switches:
 *   PI_FAKE_NO_IMAGE=1        model input is ["text"] -> unsupported_image
 *   PI_FAKE_MODEL_LIST_OMIT=1 get_available_models omits the requested model
 *   PI_FAKE_THINKING_MAP=a,b  per-model levels (e.g. "low,high,max"); an
 *                             unsupported request is COERCED like real Pi
 *   PI_FAKE_PROMPT_ERROR=1    prompt response success:false (adapter/before_content)
 *   PI_FAKE_STOP_REASON=...   assistant stopReason: "error" | "aborted" | "toolUse"
 *   PI_FAKE_CLOSE_MID=1       close stdout after the first content event
 *   PI_FAKE_RETRY=1           agent_end(willRetry:true) + auto_retry_start
 *   PI_FAKE_COMPACT=1         compaction_start/compaction_end
 *   PI_FAKE_QUEUE=1           queue_update with a pending follow-up
 *   PI_FAKE_TOOL=1            tool_execution_start
 *   PI_FAKE_STUBBORN=1        ignore SIGTERM and hold stdout open via a
 *                             grandchild in Pi's own process group
 *   PI_FAKE_DELAY_MS=<n>      delay before the first content event
 *   PI_FAKE_LOG=<path>        append each received command JSON
 *   PI_FAKE_RPC_ERROR=<text>  fail control RPCs with this untrusted error text
 *   PI_FAKE_VERSION=<v>       report a different `--version`
 *   PI_FAKE_SETTINGS_LOG=<p>  copy the seeded settings.json here
 *   PI_FAKE_ISOLATION_LOG=<p> write {cwd, cwdEntries, agentDir, agentDirMode}
 */

import { createWriteStream, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

const VERSION = process.env.PI_FAKE_VERSION ?? "0.84.3";
const logPath = process.env.PI_FAKE_LOG;
const log = logPath ? createWriteStream(logPath, { flags: "a" }) : null;

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined;
}

const provider = argValue("--provider") ?? process.env.PI_FAKE_PROVIDER ?? "deepseek";
const modelId = argValue("--model") ?? process.env.PI_FAKE_MODEL ?? "deepseek-v4-flash";
const thinking = argValue("--thinking") ?? "medium";

function output(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

if (process.argv.includes("--version")) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

// Emit the isolation/settings evidence once at startup (model-free).
if (process.env.PI_FAKE_SETTINGS_LOG) {
  try {
    writeFileSync(process.env.PI_FAKE_SETTINGS_LOG, readFileSync(path.join(process.env.PI_CODING_AGENT_DIR ?? "", "settings.json"), "utf8"));
  } catch { /* the test asserts the file exists */ }
}
const stubborn = process.env.PI_FAKE_STUBBORN === "1";
let grandchildPid = null;
if (stubborn) {
  // A child of Pi that stays in Pi's process group, ignores SIGTERM, and holds
  // Pi's stdout open. Only a process-GROUP kill reaches it, and `close` never
  // fires while it lives: cleanup must wait on `exit` and escalate to SIGKILL.
  const grandchild = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);"], {
    stdio: ["ignore", "inherit", "inherit"],
    detached: false,
  });
  grandchildPid = grandchild.pid ?? null;
  process.on("SIGTERM", () => { /* ignore: force the SIGKILL escalation */ });
}

if (process.env.PI_FAKE_ISOLATION_LOG) {
  try {
    const agentDir = process.env.PI_CODING_AGENT_DIR ?? null;
    let settingsMode = null;
    if (agentDir) {
      try { settingsMode = (statSync(path.join(agentDir, "settings.json")).mode & 0o777).toString(8); } catch { settingsMode = null; }
    }
    writeFileSync(process.env.PI_FAKE_ISOLATION_LOG, JSON.stringify({
      cwd: process.cwd(),
      cwdEntries: readdirSync(process.cwd()),
      agentDir,
      agentDirMode: agentDir ? (statSync(agentDir).mode & 0o777).toString(8) : null,
      settingsMode,
      offline: process.env.PI_OFFLINE ?? null,
      pid: process.pid,
      grandchildPid,
    }));
  } catch { /* the test asserts the file exists */ }
}

const noImage = process.env.PI_FAKE_NO_IMAGE === "1";
const modelListOmit = process.env.PI_FAKE_MODEL_LIST_OMIT === "1";
const promptError = process.env.PI_FAKE_PROMPT_ERROR === "1";
const stopReason = process.env.PI_FAKE_STOP_REASON;
const closeMid = process.env.PI_FAKE_CLOSE_MID === "1";
const delayMs = Number(process.env.PI_FAKE_DELAY_MS ?? "0");
// A hidden resample: retry, compaction, queued continuation, or tool execution.
const violation = process.env.PI_FAKE_RETRY === "1" ? "retry"
  : process.env.PI_FAKE_COMPACT === "1" ? "compaction"
    : process.env.PI_FAKE_QUEUE === "1" ? "queue"
      : process.env.PI_FAKE_TOOL === "1" ? "tool"
        : null;

/**
 * Real Pi exposes a PER-MODEL thinking level list: the model's thinkingLevelMap
 * keys with a non-null value, plus "off" (measured on real 0.85.1: the deepseek
 * vision models report ["off","low","high","max"]). An unsupported request is
 * silently COERCED to the nearest supported level (minimal->low, medium->high,
 * xhigh->max), which is exactly what the adapter must refuse to accept.
 */
const THINKING_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const supportedThinking = process.env.PI_FAKE_THINKING_MAP === undefined
  ? ["off", "minimal", "low", "medium", "high"]
  : ["off", ...process.env.PI_FAKE_THINKING_MAP.split(",").map((s) => s.trim()).filter(Boolean)];

function effectiveThinking() {
  if (supportedThinking.includes(thinking)) return thinking;
  const want = THINKING_ORDER.indexOf(thinking);
  const above = supportedThinking.filter((level) => THINKING_ORDER.indexOf(level) >= want);
  return above[0] ?? supportedThinking[supportedThinking.length - 1] ?? "off";
}

function model() {
  return {
    id: modelId,
    name: "Fake Model",
    api: "openai-completions",
    provider,
    baseUrl: "https://example.invalid",
    reasoning: true,
    input: noImage ? ["text"] : ["text", "image"],
    cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  };
}

function usage() {
  return {
    input: 12, output: 34, cacheRead: 0, cacheWrite: 0, totalTokens: 46,
    cost: process.env.PI_FAKE_COST ? JSON.parse(process.env.PI_FAKE_COST) : { input: 0.0003, output: 0.0021, cacheRead: 0, cacheWrite: 0, total: 0.0024 },
  };
}

let FINAL_TEXT = JSON.stringify({ action: { type: "key", key: "ArrowUp" }, memo: "move up" });
const scriptedResponses = process.env.PI_FAKE_RESPONSES ? JSON.parse(process.env.PI_FAKE_RESPONSES) : undefined;
let promptNumber = 0;
let lastAssistantText = null;

function assistantMessage(text, reason) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider, model: modelId,
    usage: usage(),
    stopReason: reason ?? "stop",
    timestamp: Date.now(),
  };
}

function emitPromptEvents() {
  output({ type: "agent_start" });
  const finish = () => {
    output({ type: "message_start", message: assistantMessage("", "stop") });
    // Thinking is model content for retry policy, but is never logged/exported.
    output({ type: "message_update", usage: usage(), assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "private-thinking-canary" } });
    if (process.env.PI_FAKE_THINKING_CLOSE === "1") { setTimeout(() => process.exit(0), 5); return; }
    output({ type: "message_update", usage: usage(), assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: FINAL_TEXT } });
    if (closeMid) { setTimeout(() => process.exit(0), 5); return; }
    // Isolation violations: the adapter must terminate the observe, so the fake
    // stops here exactly as a real policy-aborting run would.
    if (violation === "retry") {
      output({ type: "agent_end", messages: [], willRetry: true });
      output({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 0, errorMessage: "overloaded" });
      return;
    }
    if (violation === "compaction") {
      output({ type: "compaction_start", reason: "threshold" });
      output({ type: "compaction_end", reason: "threshold", willRetry: true });
      return;
    }
    if (violation === "queue") {
      output({ type: "queue_update", steering: [], followUp: ["and then keep going"] });
      return;
    }
    if (violation === "tool") {
      output({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "bash", args: { command: "echo hi" } });
      return;
    }
    const final = assistantMessage(FINAL_TEXT, stopReason);
    if (stopReason !== "error" && stopReason !== "aborted") lastAssistantText = FINAL_TEXT;
    output({ type: "message_end", message: final });
    output({ type: "turn_end", message: final, toolResults: [] });
    output({ type: "agent_end", messages: [final], willRetry: false });
    output({ type: "agent_settled" });
  };
  if (delayMs > 0) setTimeout(finish, delayMs);
  else finish();
}

function handle(command) {
  const id = command.id;
  if (log) log.write(`${JSON.stringify(command)}\n`);
  const success = (data) => output({ id, type: "response", command: command.type, success: true, ...(data === undefined ? {} : { data }) });
  const failure = (message) => output({ id, type: "response", command: command.type, success: false, error: message });
  // Untrusted provider/SDK text injected into an RPC failure response.
  if (process.env.PI_FAKE_RPC_ERROR && command.type !== "prompt") {
    return failure(process.env.PI_FAKE_RPC_ERROR);
  }
  switch (command.type) {
    case "prompt":
      if (promptError) { failure("provider unavailable"); return; }
      if (scriptedResponses) FINAL_TEXT = scriptedResponses[Math.min(promptNumber++, scriptedResponses.length - 1)];
      // Real Pi emits the acceptance response BEFORE streaming events.
      success();
      emitPromptEvents();
      return;
    case "new_session":
      if (process.env.PI_FAKE_STALE_CONTEXT !== "1") lastAssistantText = "";
      return success({ cancelled: false });
    case "set_auto_compaction":
    case "set_auto_retry":
    case "set_thinking_level":
    case "abort_retry":
    case "set_steering_mode":
    case "set_follow_up_mode":
    case "set_session_name":
    case "abort":
    case "compact":
      return success();
    case "get_available_models":
      return success({ models: modelListOmit ? [] : [model()] });
    case "get_available_thinking_levels":
      // Per-model: follows the model's thinkingLevelMap plus "off".
      return success({ levels: supportedThinking });
    case "get_state": {
      const effective = process.env.PI_FAKE_MODEL_MISMATCH === "1"
        ? { ...model(), id: "different-model" }
        : model();
      return success({
        model: effective, thinkingLevel: effectiveThinking(), isStreaming: false, isCompacting: false,
        steeringMode: "all", followUpMode: "one-at-a-time", sessionId: "fake",
        autoCompactionEnabled: false, messageCount: lastAssistantText ? 1 : 0, pendingMessageCount: 0,
      });
    }
    case "get_last_assistant_text":
      return success({ text: lastAssistantText });
    case "get_session_stats":
      return success({ sessionId: "fake", userMessages: 1, assistantMessages: 1, toolCalls: 0, toolResults: 0, totalMessages: 2, tokens: { input: 12, output: 34, cacheRead: 0, cacheWrite: 0, total: 46 }, cost: 0.0024 });
    case "get_commands":
      // Real Pi always registers its own inline extension even with
      // --no-extensions (measured: "llama" from "<inline:llama.cpp>").
      if (process.env.PI_FAKE_FOREIGN_COMMAND === "1") {
        return success({ commands: [{ name: "leak", description: "user skill", source: "skill", sourceInfo: { path: "/home/user/.pi/agent/skills/leak/SKILL.md", source: "file", scope: "user", origin: "top-level" } }] });
      }
      return success({ commands: [{ name: "llama", description: "Manage llama.cpp router models", source: "extension", sourceInfo: { path: "<inline:llama.cpp>", source: "inline", scope: "temporary", origin: "top-level" } }] });
    default:
      return failure(`Unknown command: ${command.type}`);
  }
}

const decoder = new StringDecoder("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += decoder.write(chunk);
  for (;;) {
    const i = buffer.indexOf("\n");
    if (i < 0) break;
    const line = buffer.slice(0, i).replace(/\r$/, "");
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    let command;
    try { command = JSON.parse(line); }
    catch {
      output({ type: "response", command: "parse", success: false, error: "Failed to parse command" });
      continue;
    }
    if (command.type === "extension_ui_response") continue;
    try { handle(command); }
    catch (error) { output({ type: "response", command: command.type, success: false, error: String(error && error.message || error) }); }
  }
});
process.stdin.on("end", () => { if (log) log.end(); process.exit(0); });
process.stdin.resume();
