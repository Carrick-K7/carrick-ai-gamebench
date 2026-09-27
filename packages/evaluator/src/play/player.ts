import { performance } from "node:perf_hooks";
import {
  PLAY_MEMO_MAX_BYTES, PLAY_SLOT_SECONDS, PlayNativeActionSchema,
  type PlayGame, type PlayNativeAction,
} from "@carrick/gamebench-core";
import { JsonlProcess, JsonlProcessError } from "./jsonl-process.js";

export interface PlayPlayerIdentity {
  agent: string;
  version: string;
  provider: string;
  model: string;
  thinking: string;
}

/** The entire model-visible channel. Deliberately excludes seed/state/commands. */
export interface PlayObservation {
  turn_id: string;
  rules: string;
  frame: { media_type: "image/png"; data: string };
  remaining_decisions: number;
  last_actions: Array<{ status: "action" | "invalid"; native_action?: PlayNativeAction }>;
  memo: string;
}

export interface PlayUsage {
  input_tokens?: number;
  output_tokens?: number;
  cost_estimate?: number;
  cost_source?: "adapter-estimate";
}

export interface PlayerAttempt {
  attempt: number;
  status: "action" | "invalid" | "timeout" | "transport-error" | "adapter-error";
  received_content: boolean;
  elapsed_ms: number;
  usage?: PlayUsage;
}

export interface PlayerSlotResult {
  status: "action" | "invalid" | "timeout" | "infrastructure-failure";
  action?: PlayNativeAction;
  memo?: string;
  attempts: PlayerAttempt[];
  elapsed_ms: number;
  /** Final answer only, for private decision validation; never internal thinking. */
  response_text?: string;
  /** Safe code only, never raw provider stderr or response headers. */
  reason?: string;
}

function object(input: unknown): Record<string, unknown> | undefined {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown> : undefined;
}

export function parsePlayerDecision(text: string): { action: PlayNativeAction; memo?: string } | undefined {
  if (Buffer.byteLength(text, "utf8") > 4096) return undefined;
  let data: Record<string, unknown> | undefined;
  try { data = object(JSON.parse(text) as unknown); } catch { return undefined; }
  if (!data || Object.keys(data).some((key) => key !== "action" && key !== "memo")) return undefined;
  const action = PlayNativeActionSchema.safeParse(data.action);
  if (!action.success) return undefined;
  if (data.memo !== undefined && (typeof data.memo !== "string" || Buffer.byteLength(data.memo, "utf8") > PLAY_MEMO_MAX_BYTES)) return undefined;
  return { action: action.data, ...(typeof data.memo === "string" ? { memo: data.memo } : {}) };
}

function usage(input: unknown): PlayUsage | undefined {
  if (input === undefined) return undefined;
  const data = object(input);
  if (!data || Object.keys(data).some((key) => !["input_tokens", "output_tokens", "cost"].includes(key))) {
    throw new JsonlProcessError("protocol", "invalid adapter usage packet");
  }
  for (const value of Object.values(data)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new JsonlProcessError("protocol", "invalid adapter usage value");
    }
  }
  return {
    ...(typeof data.input_tokens === "number" ? { input_tokens: data.input_tokens } : {}),
    ...(typeof data.output_tokens === "number" ? { output_tokens: data.output_tokens } : {}),
    ...(typeof data.cost === "number" ? { cost_estimate: data.cost, cost_source: "adapter-estimate" as const } : {}),
  };
}

export class RpcPlayPlayer {
  private readonly transport: JsonlProcess;
  private busy = false;
  private initialized = false;
  private allowForcedClose = false;
  private closed = false;
  private readonly seenTurns = new Set<string>();
  readonly slotMilliseconds: number;

  constructor(options: {
    command: string;
    cwd: string;
    stderrPath: string;
    /** Test-only override. Official runner must use the release's 60s value. */
    slotMilliseconds?: number;
  }) {
    this.slotMilliseconds = options.slotMilliseconds ?? PLAY_SLOT_SECONDS * 1000;
    if (!Number.isFinite(this.slotMilliseconds) || this.slotMilliseconds <= 0) throw new Error("invalid decision deadline");
    this.transport = new JsonlProcess(options.command, { cwd: options.cwd, stderrPath: options.stderrPath });
  }

  async init(game: PlayGame, expected?: PlayPlayerIdentity): Promise<PlayPlayerIdentity> {
    if (this.initialized || this.closed) throw new Error("player cannot be initialized twice or reused after closing");
    await this.transport.send({ type: "init", protocol_version: 1, game });
    const response = object(await this.transport.read(15_000));
    const identity = object(response?.identity);
    if (response?.type !== "ready" || response.protocol_version !== 1 || !identity ||
      !["agent", "version", "provider", "model", "thinking"].every((key) => typeof identity[key] === "string" && identity[key] !== "")) {
      throw new JsonlProcessError("protocol", "invalid player initialization reply");
    }
    const result: PlayPlayerIdentity = {
      agent: identity.agent as string, version: identity.version as string,
      provider: identity.provider as string, model: identity.model as string, thinking: identity.thinking as string,
    };
    if (expected && Object.keys(result).some((key) => result[key as keyof PlayPlayerIdentity] !== expected[key as keyof PlayPlayerIdentity])) {
      throw new JsonlProcessError("protocol", "player identity does not match the preregistered configuration");
    }
    this.initialized = true;
    return result;
  }

  async observe(observation: PlayObservation): Promise<PlayerSlotResult> {
    if (!this.initialized || this.busy || this.closed) throw new JsonlProcessError("protocol", "player is not ready for a decision");
    if (this.seenTurns.has(observation.turn_id)) throw new JsonlProcessError("protocol", "duplicate player turn id");
    if (observation.last_actions.length > 8 || Buffer.byteLength(observation.memo, "utf8") > PLAY_MEMO_MAX_BYTES) {
      throw new JsonlProcessError("protocol", "observation exceeds bounded player context");
    }
    this.seenTurns.add(observation.turn_id);
    this.busy = true;
    // Never spread caller objects into the model-visible packet.
    const request = {
      type: "observe", turn_id: observation.turn_id, rules: observation.rules,
      frame: { media_type: "image/png", data: observation.frame.data },
      remaining_decisions: observation.remaining_decisions,
      last_actions: observation.last_actions.map((entry) => ({
        status: entry.status,
        ...(entry.native_action ? { native_action: PlayNativeActionSchema.parse(entry.native_action) } : {}),
      })),
      memo: observation.memo,
    };
    const started = performance.now();
    const elapsed = (): number => Math.round(performance.now() - started);
    const attempts: PlayerAttempt[] = [];
    let transportFailureSeen = false;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const attemptStart = performance.now();
        let contentReceived = false;
        try {
          await this.transport.send(request, Math.min(5_000, this.slotMilliseconds - (performance.now() - started)));
          for (;;) {
            const remaining = this.slotMilliseconds - (performance.now() - started);
            if (remaining <= 0) throw new JsonlProcessError("timeout", "player response deadline exceeded");
            const response = object(await this.transport.read(remaining));
            if (performance.now() - started >= this.slotMilliseconds) throw new JsonlProcessError("timeout", "player response deadline exceeded");
            if (!response || response.turn_id !== observation.turn_id) {
              throw new JsonlProcessError("protocol", "stale or uncorrelated player response");
            }
            if (response.type === "content") {
              if (contentReceived) throw new JsonlProcessError("protocol", "duplicate content notification");
              contentReceived = true;
              continue;
            }
            if (response.type === "action") {
              if (typeof response.response_text !== "string") throw new JsonlProcessError("protocol", "missing model action text");
              const parsed = parsePlayerDecision(response.response_text);
              const measuredUsage = usage(response.usage);
              attempts.push({
                attempt, status: parsed ? "action" : "invalid", received_content: true,
                elapsed_ms: Math.round(performance.now() - attemptStart),
                ...(measuredUsage ? { usage: measuredUsage } : {}),
              });
              return {
                status: parsed ? "action" : "invalid", ...(parsed ?? {}), attempts, elapsed_ms: elapsed(), response_text: response.response_text,
                ...(!parsed ? { reason: "invalid-model-response" } : {}),
              };
            }
            if (response.type === "error" && (response.kind === "transport" || response.kind === "adapter") &&
              typeof response.before_content === "boolean" && typeof response.retryable === "boolean") {
              const received = contentReceived || !response.before_content;
              attempts.push({
                attempt, status: response.kind === "transport" ? "transport-error" : "adapter-error",
                received_content: received, elapsed_ms: Math.round(performance.now() - attemptStart),
              });
              transportFailureSeen ||= response.kind === "transport";
              if (response.kind === "transport" && response.retryable && !received && attempt === 0 && elapsed() < this.slotMilliseconds) break;
              this.allowForcedClose = true;
              return { status: "infrastructure-failure", attempts, elapsed_ms: elapsed(), reason: response.kind === "transport" ? "provider-service-failure" : "adapter-failure" };
            }
            throw new JsonlProcessError("protocol", "unexpected player response type");
          }
        } catch (error) {
          const timedOut = error instanceof JsonlProcessError && error.kind === "timeout";
          this.allowForcedClose = true;
          attempts.push({
            attempt, status: timedOut ? "timeout" : "adapter-error", received_content: contentReceived,
            elapsed_ms: Math.round(performance.now() - attemptStart),
          });
          return {
            status: timedOut && !transportFailureSeen ? "timeout" : "infrastructure-failure",
            attempts, elapsed_ms: elapsed(),
            reason: timedOut ? (transportFailureSeen ? "transport-recovery-deadline" : "decision-deadline") : "adapter-protocol-or-process-failure",
          };
        }
      }
      this.allowForcedClose = true;
      return { status: "infrastructure-failure", attempts, elapsed_ms: elapsed(), reason: "transport-retries-exhausted" };
    } finally { this.busy = false; }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const intentionalCancellation = this.allowForcedClose || this.busy || !this.initialized;
    let finishError: unknown;
    try {
      if (this.initialized && !this.busy) {
        await this.transport.send({ type: "finish" });
        const response = object(await this.transport.read(2_000));
        if (response?.type !== "finished") throw new Error("invalid player finish reply");
      }
    } catch (error) { finishError = error; }
    finally { await this.transport.close(); }
    // An intentional deadline cancellation retains its measured outcome. A
    // healthy episode must not silently ignore a broken adapter/log closure.
    if (finishError && !intentionalCancellation) throw finishError;
  }
}
