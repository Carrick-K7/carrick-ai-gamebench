import { createHash, randomBytes } from "node:crypto";
import type {
  AgentIdentityV2Schema,
  JsonObject,
  JsonValue,
  LanguageSchema,
  NetworkPolicySchema,
  RunEnvironmentV2,
  RunEnvironmentV3,
} from "./schema.js";
import type { z } from "zod";

type AgentIdentityV2 = z.infer<typeof AgentIdentityV2Schema>;
type Language = z.infer<typeof LanguageSchema>;
type NetworkPolicy = z.infer<typeof NetworkPolicySchema>;

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

function jsonProjection(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export interface ConfigurationIdentityInput {
  benchmark_version: string;
  benchmark_release_hash: `sha256:${string}`;
  agent: AgentIdentityV2;
  prompt_language: Language;
  execution_profile: "local" | "official-candidate";
  environment: RunEnvironmentV2 | RunEnvironmentV3;
}

export function configurationIdentity(
  input: ConfigurationIdentityInput,
): JsonValue {
  return jsonProjection({
    benchmark_version: input.benchmark_version,
    benchmark_release_hash: input.benchmark_release_hash,
    agent: {
      ...input.agent,
      parameters: input.agent.parameters ?? {},
    },
    prompt_language: input.prompt_language,
    execution_profile: input.execution_profile,
    environment: input.environment,
  });
}

export function computeConfigurationId(
  input: ConfigurationIdentityInput,
): `sha256:${string}` {
  return sha256Canonical(configurationIdentity(input));
}

export interface SubmissionInputIdentityInput {
  configuration_id: `sha256:${string}`;
  agent_command_hash: `sha256:${string}`;
  task_id: string;
  task_version: string;
  task_hash: `sha256:${string}`;
  prompt_language: Language;
  budget_seconds: number;
  network_policy: NetworkPolicy;
  development_parameters: JsonObject & {
    agent_command_hash: `sha256:${string}`;
  };
}

export function submissionInputIdentity(
  input: SubmissionInputIdentityInput,
): JsonValue {
  if (
    input.development_parameters.agent_command_hash !==
    input.agent_command_hash
  ) {
    throw new Error(
      "development_parameters agent command hash must match agent_command_hash",
    );
  }
  return jsonProjection({
    configuration_id: input.configuration_id,
    agent_command_hash: input.agent_command_hash,
    task_id: input.task_id,
    task_version: input.task_version,
    task_hash: input.task_hash,
    prompt_language: input.prompt_language,
    budget_seconds: input.budget_seconds,
    network_policy: input.network_policy,
    development_parameters: input.development_parameters,
  });
}

export function computeSubmissionInputFingerprint(
  input: SubmissionInputIdentityInput,
): `sha256:${string}` {
  return sha256Canonical(submissionInputIdentity(input));
}

export function assertSubmissionInputFingerprint(
  input: SubmissionInputIdentityInput,
  claimed: `sha256:${string}`,
): void {
  const expected = computeSubmissionInputFingerprint(input);
  if (claimed !== expected) {
    throw new Error(
      `submission input fingerprint mismatch: expected ${expected}, received ${claimed}`,
    );
  }
}

export interface EvaluationInputIdentityInput {
  benchmark_release_hash: `sha256:${string}`;
  configuration_id: `sha256:${string}`;
  submission_id: string;
  source_snapshot_hash: `sha256:${string}`;
  task_id: string;
  task_version: string;
  task_hash: `sha256:${string}`;
  evaluation_seed: number;
  evaluator_image_digest?: `sha256:${string}`;
}

export function evaluationInputIdentity(
  input: EvaluationInputIdentityInput,
): JsonValue {
  return jsonProjection({
    benchmark_release_hash: input.benchmark_release_hash,
    configuration_id: input.configuration_id,
    submission_id: input.submission_id,
    source_snapshot_hash: input.source_snapshot_hash,
    task_id: input.task_id,
    task_version: input.task_version,
    task_hash: input.task_hash,
    evaluation_seed: input.evaluation_seed,
    ...(input.evaluator_image_digest
      ? { evaluator_image_digest: input.evaluator_image_digest }
      : {}),
  });
}

export function computeEvaluationInputFingerprint(
  input: EvaluationInputIdentityInput,
): `sha256:${string}` {
  return sha256Canonical(evaluationInputIdentity(input));
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
