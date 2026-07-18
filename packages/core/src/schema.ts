import { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const TrackSchema = z.enum(["build", "reproduce"]);
export const LanguageSchema = z.enum(["en", "zh"]);
export const NetworkPolicySchema = z.enum([
  "full",
  "model-api-only",
  "offline",
]);

export const TestCategorySchema = z.enum([
  "build",
  "mechanics",
  "state",
  "input",
  "stability",
  "feel",
  "visual",
]);

export const TestDefinitionSchema = z.strictObject({
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*$/),
  category: TestCategorySchema,
  points: z.number().positive().max(100),
  case: z.string().min(1),
});

export const ReferenceSchema = z.strictObject({
  project: z.string().min(1),
  repository: z.url(),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  license: z.string().min(1),
  build_digest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  capture_pack: z.string().min(1),
  source_release: z.literal("after-retirement"),
});

export const ThirdPartyManifestSchema = z.strictObject({
  schema_version: z.literal(1),
  project: z.string().min(1),
  upstream: z.url(),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  license: z.string().min(1),
  copyright: z.array(z.string().min(1)).min(1),
  distributed_material: z
    .array(
      z.strictObject({
        path: z.string().min(1),
        source: z.string().min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .min(1),
  notes: z.array(z.string().min(1)).default([]),
});

export type ThirdPartyManifest = z.infer<typeof ThirdPartyManifestSchema>;

export const TaskManifestSchema = z.strictObject({
  schema_version: z.literal(1),
  id: z
    .string()
    .min(1)
    .regex(/^(build|reproduce)\.[a-z0-9-]+(?:\.[a-z0-9-]+)*\.v[1-9]\d*$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  title: z.strictObject({
    en: z.string().min(1),
    zh: z.string().min(1),
  }),
  track: TrackSchema,
  level: z.number().int().min(1).max(3),
  prompt: z.strictObject({
    en: z.string().min(1),
    zh: z.string().min(1),
  }),
  starter: z.string().min(1),
  budget_seconds: z.number().int().positive(),
  network_policy: NetworkPolicySchema,
  runtime: z.strictObject({
    node: z.literal("22"),
    package_manager: z.literal("pnpm"),
    port: z.number().int().min(1024).max(65535),
    viewport: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    device_scale_factor: z.literal(1),
  }),
  test_suite: z.string().min(1),
  bridge: z.strictObject({
    version: z.literal("1"),
    state_schema: z.string().min(1),
    scenarios: z.array(z.string().min(1)).min(1),
  }),
  reference: ReferenceSchema.optional(),
  tests: z.array(TestDefinitionSchema).min(1),
});

export type TaskManifest = z.infer<typeof TaskManifestSchema>;
export type TestDefinition = z.infer<typeof TestDefinitionSchema>;
export type Track = z.infer<typeof TrackSchema>;

export const BrowserStepSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("reset"),
    seed: z.number().int().optional(),
    scenario: z.string().optional(),
  }),
  z.strictObject({
    op: z.literal("act"),
    action: z.string().min(1),
    payload: JsonValueSchema.optional(),
  }),
  z.strictObject({
    op: z.literal("advance"),
    ms: z.number().nonnegative(),
  }),
  z.strictObject({
    op: z.literal("key"),
    key: z.string().min(1),
  }),
  z.strictObject({
    op: z.literal("click"),
    selector: z.string().min(1).optional(),
    x: z.number().nonnegative().optional(),
    y: z.number().nonnegative().optional(),
    button: z.enum(["left", "right", "middle"]).default("left"),
  }),
  z.strictObject({
    op: z.literal("select"),
    selector: z.string().min(1),
    value: z.string().min(1),
  }),
  z.strictObject({
    op: z.literal("expect"),
    path: z.string().min(1),
    equals: JsonValueSchema.optional(),
    one_of: z.array(JsonValueSchema).min(1).optional(),
    greater_than: z.number().optional(),
    less_than: z.number().optional(),
    approximately: z
      .strictObject({
        value: z.number(),
        tolerance: z.number().nonnegative(),
      })
      .optional(),
  }),
  z.strictObject({
    op: z.literal("expect-visible"),
    selector: z.string().min(1),
    text: z.string().optional(),
  }),
  z.strictObject({
    op: z.literal("screenshot"),
    name: z.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*\.png$/),
    selector: z.string().min(1).optional(),
    max_diff_pixels: z.number().int().nonnegative().optional(),
    threshold: z.number().min(0).max(1).optional(),
  }),
]);

export const SourceAssertionSchema = z.discriminatedUnion("assert", [
  z.strictObject({
    assert: z.literal("file-exists"),
    path: z.string().min(1),
  }),
  z.strictObject({
    assert: z.literal("contains"),
    path: z.string().min(1),
    pattern: z.string().min(1),
  }),
  z.strictObject({
    assert: z.literal("not-contains"),
    path: z.string().min(1),
    pattern: z.string().min(1),
  }),
]);

export const BrowserCaseSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.literal("browser"),
  description: z.string().min(1),
  steps: z.array(BrowserStepSchema),
});

export const BuildCaseSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.literal("build"),
  description: z.string().min(1),
});

export const SourceCaseSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.literal("source"),
  description: z.string().min(1),
  assertions: z.array(SourceAssertionSchema).min(1),
});

export const TestCaseSchema = z.discriminatedUnion("kind", [
  BrowserCaseSchema,
  BuildCaseSchema,
  SourceCaseSchema,
]);

export const TestSuiteSchema = z.strictObject({
  schema_version: z.literal(1),
  cases: z.array(TestCaseSchema).min(1),
});

export type BrowserStep = z.infer<typeof BrowserStepSchema>;
export type TestCase = z.infer<typeof TestCaseSchema>;
export type TestSuite = z.infer<typeof TestSuiteSchema>;

export const AgentIdentitySchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1).default("unknown"),
  model: z.string().min(1).default("unknown"),
  harness: z.string().min(1).default("shell"),
});

export const RunManifestSchema = z.strictObject({
  schema_version: z.literal(1),
  benchmark_version: z.string().min(1),
  run_id: z.string().min(1),
  task_id: z.string().min(1),
  task_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  attempt: z.number().int().positive(),
  seed: z.number().int(),
  official: z.boolean(),
  verified: z.boolean(),
  prompt_language: LanguageSchema,
  network_policy: NetworkPolicySchema,
  agent: AgentIdentitySchema,
  environment: z.strictObject({
    platform: z.string(),
    architecture: z.string(),
    node: z.string(),
    container_image: z.string().optional(),
  }),
  started_at: z.iso.datetime(),
  finished_at: z.iso.datetime().optional(),
  exit_reason: z
    .enum(["completed", "timeout", "agent-error", "evaluation-error"])
    .optional(),
});

export type RunManifest = z.infer<typeof RunManifestSchema>;

export const TestOutcomeSchema = z.strictObject({
  id: z.string().min(1),
  passed: z.boolean(),
  duration_ms: z.number().nonnegative(),
  message: z.string().optional(),
  artifacts: z.array(z.string()).default([]),
});

export type TestOutcome = z.infer<typeof TestOutcomeSchema>;

export const ScoreResultSchema = z.strictObject({
  schema_version: z.literal(1),
  task_id: z.string(),
  task_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  earned: z.number().nonnegative(),
  available: z.number().positive(),
  percent: z.number().min(0).max(100),
  hard_gate_failed: z.boolean(),
  categories: z.record(
    z.string(),
    z.strictObject({
      earned: z.number().nonnegative(),
      available: z.number().nonnegative(),
    }),
  ),
  tests: z.array(
    z.strictObject({
      id: z.string(),
      category: TestCategorySchema,
      points: z.number().positive(),
      passed: z.boolean(),
      duration_ms: z.number().nonnegative(),
      message: z.string().optional(),
      artifacts: z.array(z.string()),
    }),
  ),
});

export type ScoreResult = z.infer<typeof ScoreResultSchema>;

export const VoteSchema = z.strictObject({
  schema_version: z.literal(1),
  benchmark_version: z.string().min(1),
  task_id: z.string().min(1),
  task_version: z.string().min(1),
  prompt_language: LanguageSchema,
  reviewer_id: z.string().min(1),
  session_id: z.string().min(1),
  candidate_a_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  candidate_b_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  left_candidate: z.enum(["a", "b"]),
  choice: z.enum(["a", "b", "tie", "both-bad"]),
  tags: z.array(
    z.enum(["controls", "playability", "correctness", "visual", "polish"]),
  ),
  created_at: z.iso.datetime(),
});

export type Vote = z.infer<typeof VoteSchema>;

export interface CarrickGameBenchBridge {
  version: "1";
  ready: Promise<void>;
  reset(input: { seed: number; scenario?: string }): Promise<void>;
  act(input: { type: string; payload?: JsonValue }): Promise<void>;
  advance(ms: number): Promise<void>;
  snapshot(): Promise<{
    status: "menu" | "running" | "paused" | "won" | "lost";
    tick: number;
    score?: number;
    state: JsonObject;
    events: Array<{
      seq: number;
      type: string;
      data?: JsonValue;
    }>;
  }>;
}

export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length === 0 ? "<root>" : issue.path.join(".");
    return `${path}: ${issue.message}`;
  });
}
