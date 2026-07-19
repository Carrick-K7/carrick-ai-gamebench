import { createHash, randomBytes } from "node:crypto";
import type { JsonValue } from "./schema.js";

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function assertJsonValue(value: unknown, path = "<root>"): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must be a finite JSON number`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) {
        throw new TypeError(`${path}.${key} must not be undefined`);
      }
      assertJsonValue(item, `${path}.${key}`);
    }
    return;
  }
  throw new TypeError(`${path} is not a JSON value`);
}

/**
 * RFC 8785-compatible canonical JSON for the JSON types used by GameBench.
 */
export function canonicalJson(value: JsonValue): string {
  assertJsonValue(value);
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`)
    .join(",")}}`;
}

export function sha256Canonical(value: JsonValue): `sha256:${string}` {
  const digest = createHash("sha256").update(canonicalJson(value)).digest("hex");
  return `sha256:${digest}`;
}

export function sha256Buffer(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function createUlid(timestamp = Date.now()): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 0xffffffffffff) {
    throw new RangeError("ULID timestamp must fit in 48 bits");
  }
  let entropy = 0n;
  for (const byte of randomBytes(10)) {
    entropy = (entropy << 8n) | BigInt(byte);
  }
  let value = (BigInt(timestamp) << 80n) | entropy;
  let output = "";
  for (let index = 0; index < 26; index += 1) {
    output = CROCKFORD_BASE32[Number(value & 31n)] + output;
    value >>= 5n;
  }
  return output;
}
