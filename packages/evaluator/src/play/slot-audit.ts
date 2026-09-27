import { canonicalJson, type JsonValue } from "@carrick/gamebench-core";
import { parsePlayerDecision, type PlayerSlotResult } from "./player.js";

export function playEqual(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return canonicalJson(JSON.parse(JSON.stringify(left)) as JsonValue) === canonicalJson(JSON.parse(JSON.stringify(right)) as JsonValue);
}

/** Validate controller claims against the original final answer and retry audit. */
export function validatePlayerSlot(slot: PlayerSlotResult, deadlineMs: number): void {
  if (!["action", "invalid", "timeout", "infrastructure-failure"].includes(slot.status) ||
    !Number.isInteger(slot.elapsed_ms) || slot.elapsed_ms < 0 ||
    !Array.isArray(slot.attempts) || slot.attempts.length < 1 || slot.attempts.length > 2) throw new Error("invalid player slot audit");
  let measured = 0;
  for (const [index, attempt] of slot.attempts.entries()) {
    if (attempt.attempt !== index || !["action", "invalid", "timeout", "transport-error", "adapter-error"].includes(attempt.status) ||
      typeof attempt.received_content !== "boolean" || !Number.isInteger(attempt.elapsed_ms) || attempt.elapsed_ms < 0) throw new Error("invalid player attempt audit");
    measured += attempt.elapsed_ms;
  }
  if (measured > slot.elapsed_ms + 2) throw new Error("attempt durations exceed the decision duration");
  if (slot.attempts.length === 2 &&
    (slot.attempts[0]!.status !== "transport-error" || slot.attempts[0]!.received_content)) throw new Error("retry without an explicit pre-content transport failure");
  const final = slot.attempts.at(-1)!;
  if (slot.status === "action" || slot.status === "invalid") {
    if (typeof slot.response_text !== "string" || final.status !== slot.status || !final.received_content) throw new Error("missing final answer evidence");
    const decision = parsePlayerDecision(slot.response_text);
    if (slot.status === "action") {
      if (!decision || !playEqual(decision.action, slot.action ?? null) || decision.memo !== slot.memo) throw new Error("native action differs from final answer");
    } else if (decision || slot.action || slot.memo !== undefined) throw new Error("incorrect invalid-response classification");
    // Integer rounding may place an on-time sub-millisecond boundary at deadlineMs.
    if (slot.elapsed_ms > deadlineMs) throw new Error("late model answer accepted as a decision");
  } else {
    if (slot.action || slot.memo !== undefined || slot.response_text !== undefined) throw new Error("non-action slot must not invent an action");
    if (slot.status === "timeout" && (final.status !== "timeout" || slot.attempts.length !== 1 || slot.elapsed_ms + 1 < deadlineMs)) throw new Error("incorrect decision-timeout classification");
    if (slot.status === "infrastructure-failure" && !["transport-error", "adapter-error", "timeout"].includes(final.status)) throw new Error("incorrect infrastructure classification");
  }
}
