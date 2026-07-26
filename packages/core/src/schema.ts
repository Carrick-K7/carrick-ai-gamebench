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
export const NetworkPolicySchema = z.enum(["full", "model-api-only"]);
export const HashRefSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const UlidSchema = z
  .string()
  .regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
export const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

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
    op: z.literal("expect"),
    path: z.string().min(1),
    equals: JsonValueSchema.optional(),
    equals_run_seed: z.literal(true).optional(),
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
    op: z.literal("screenshot"),
    name: z.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*\.png$/),
    selector: z.string().min(1).optional(),
    max_diff_pixels: z.number().int().nonnegative().optional(),
    max_diff_ratio: z.number().min(0).max(1).optional(),
    threshold: z.number().min(0).max(1).optional(),
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

export const TestCaseSchema = z.discriminatedUnion("kind", [
  BrowserCaseSchema,
  BuildCaseSchema,
]);

export const TestSuiteSchema = z.strictObject({
  schema_version: z.literal(1),
  cases: z.array(TestCaseSchema).min(1),
}).superRefine((suite, context) => {
  suite.cases.forEach((testCase, caseIndex) => {
    if (testCase.kind !== "browser") {
      return;
    }
    testCase.steps.forEach((step, stepIndex) => {
      const path = ["cases", caseIndex, "steps", stepIndex];
      if (step.op === "expect") {
        const comparisons = [
          step.equals !== undefined,
          step.equals_run_seed === true,
          step.one_of !== undefined,
          step.greater_than !== undefined,
          step.less_than !== undefined,
          step.approximately !== undefined,
        ].filter(Boolean).length;
        if (comparisons !== 1) {
          context.addIssue({
            code: "custom",
            path,
            message: "expect must declare exactly one comparison",
          });
        }
      }
      if (
        step.op === "screenshot" &&
        step.max_diff_pixels !== undefined &&
        step.max_diff_ratio !== undefined
      ) {
        context.addIssue({
          code: "custom",
          path,
          message: "screenshot may declare only one diff allowance",
        });
      }
      if (step.op === "click") {
        const selectorOnly =
          step.selector !== undefined &&
          step.x === undefined &&
          step.y === undefined;
        const coordinatePair =
          step.selector === undefined &&
          step.x !== undefined &&
          step.y !== undefined;
        if (!selectorOnly && !coordinatePair) {
          context.addIssue({
            code: "custom",
            path,
            message: "click requires either a selector or an x/y coordinate pair",
          });
        }
      }
    });
  });
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

export const AgentIdentityV2Schema = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1),
  model: z.string().min(1),
  harness: z.string().min(1),
  parameters: z.record(z.string(), JsonValueSchema).default({}),
});

export const RunManifestV1Schema = z.strictObject({
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

export type RunManifestV1 = z.infer<typeof RunManifestV1Schema>;

export const RunEnvironmentV2Schema = z.strictObject({
  platform: z.string().min(1),
  architecture: z.string().min(1),
  node: z.string().min(1),
  runner_protocol: z.literal("2"),
  git_commit: z.string().regex(/^(?:[a-f0-9]{40}|unknown)$/),
  source_tree_dirty: z.boolean(),
  working_tree_hash: HashRefSchema.optional(),
  evaluator_image_digest: HashRefSchema.optional(),
  browser: z.string().min(1).optional(),
});
export type RunEnvironmentV2 = z.infer<typeof RunEnvironmentV2Schema>;

export const RunManifestV2Schema = z.strictObject({
  schema_version: z.literal(2),
  benchmark_version: SemverSchema,
  benchmark_release_hash: HashRefSchema,
  series_id: UlidSchema,
  run_id: UlidSchema,
  configuration_id: HashRefSchema,
  input_fingerprint: HashRefSchema,
  task_id: z.string().min(1),
  task_version: SemverSchema,
  task_hash: HashRefSchema,
  attempt: z.number().int().positive(),
  seed: z.number().int(),
  execution_profile: z.enum(["local", "official-candidate"]),
  prompt_language: LanguageSchema,
  network_policy: NetworkPolicySchema,
  agent: AgentIdentityV2Schema,
  environment: RunEnvironmentV2Schema,
  started_at: z.iso.datetime(),
  finished_at: z.iso.datetime().optional(),
  exit_reason: z
    .enum(["completed", "timeout", "agent-error", "evaluation-error"])
    .optional(),
  usage: z
    .strictObject({
      input_tokens: z.number().int().nonnegative().optional(),
      cached_input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
      cost_usd: z.number().nonnegative().optional(),
      source: z.enum(["provider", "harness", "estimated", "not-reported"]),
    })
    .optional(),
});

export const RunManifestSchema = z.discriminatedUnion("schema_version", [
  RunManifestV1Schema,
  RunManifestV2Schema,
]);

export type RunManifestV2 = z.infer<typeof RunManifestV2Schema>;
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

export const AggregateTaskResultSchema = z.strictObject({
  task_id: z.string().min(1),
  track: TrackSchema,
  attempts: z.number().int().positive(),
  mean: z.number().min(0).max(100),
  standard_deviation: z.number().nonnegative(),
});

const CoverageSchema = z.strictObject({
  completed: z.number().int().nonnegative(),
  required: z.number().int().nonnegative(),
});

const AggregateResultFields = {
  tasks: z.array(AggregateTaskResultSchema),
  coverage: z.strictObject({
    build: CoverageSchema,
    reproduce: CoverageSchema,
    core: CoverageSchema,
  }),
  leaderboards: z.strictObject({
    build: z.number().min(0).max(100).optional(),
    reproduce: z.number().min(0).max(100).optional(),
    core: z.number().min(0).max(100).optional(),
  }),
};

export const AggregateResultV1Schema = z.strictObject({
  schema_version: z.literal(1),
  ...AggregateResultFields,
});

export const AggregateResultV2Schema = z.strictObject({
  schema_version: z.literal(2),
  ...AggregateResultFields,
});

export const AggregateResultSchema = z.discriminatedUnion("schema_version", [
  AggregateResultV1Schema,
  AggregateResultV2Schema,
]);

export type AggregateTaskResult = z.infer<typeof AggregateTaskResultSchema>;
export type AggregateResult = z.infer<typeof AggregateResultSchema>;

export const SeriesRunReferenceSchema = z.strictObject({
  run_id: UlidSchema,
  task_id: z.string().min(1),
  task_hash: HashRefSchema,
  seed: z.number().int(),
  attempt: z.number().int().positive(),
  included: z.boolean(),
  exclusion_reason: z.string().min(1).optional(),
});

export const SeriesManifestSchema = z.strictObject({
  schema_version: z.literal(1),
  series_id: UlidSchema,
  benchmark_version: SemverSchema,
  benchmark_release_hash: HashRefSchema,
  git_commit: z.string().regex(/^(?:[a-f0-9]{40}|unknown)$/),
  configuration_id: HashRefSchema,
  configuration: z.strictObject({
    agent: AgentIdentityV2Schema,
    prompt_language: LanguageSchema,
    execution_profile: z.enum(["local", "official-candidate"]),
    environment: RunEnvironmentV2Schema,
  }),
  created_at: z.iso.datetime(),
  runs: z.array(SeriesRunReferenceSchema),
}).superRefine((series, context) => {
  const seen = new Set<string>();
  for (const run of series.runs) {
    if (seen.has(run.run_id)) {
      context.addIssue({
        code: "custom",
        path: ["runs"],
        message: `duplicate run_id: ${run.run_id}`,
      });
    }
    seen.add(run.run_id);
  }
});

export type SeriesManifest = z.infer<typeof SeriesManifestSchema>;

export const ArtifactRoleSchema = z.enum([
  "clean-source",
  "playable",
  "screenshot",
  "evidence",
  "license",
]);
export type ArtifactRole = z.infer<typeof ArtifactRoleSchema>;

export const ArtifactRefSchema = z.strictObject({
  artifact_id: HashRefSchema,
  role: ArtifactRoleSchema,
  file_name: z.string().min(1).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  size_bytes: z.number().int().nonnegative(),
  media_type: z.string().min(1),
  url: z.string().min(1),
});

export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

export const VerificationRecordSchema = z.strictObject({
  schema_version: z.literal(1),
  status: z.literal("operator-reproduced"),
  verifier: z.strictObject({
    id: z.string().min(1),
    organization: z.string().min(1).optional(),
  }),
  verified_at: z.iso.datetime(),
  benchmark_release_hash: HashRefSchema,
  git_commit: z.string().regex(/^(?:[a-f0-9]{40}|unknown)$/),
  evaluator_image_digest: HashRefSchema,
  network_attestation: z.enum([
    "not-required",
    "operator-attested-model-api-only",
    "unverified",
  ]),
  evidence_manifest_hash: HashRefSchema,
  clean_source_artifact_id: HashRefSchema,
  recomputed_score_hash: HashRefSchema,
});

export type VerificationRecord = z.infer<typeof VerificationRecordSchema>;

export const ReproductionRecordSchema = z.strictObject({
  schema_version: z.literal(1),
  prepared_at: z.iso.datetime(),
  benchmark_release_hash: HashRefSchema,
  clean_source_artifact_id: HashRefSchema,
  recomputed_score_hash: HashRefSchema,
});

export type ReproductionRecord = z.infer<typeof ReproductionRecordSchema>;

export const ReviewSummarySchema = z.strictObject({
  schema_version: z.literal(1),
  methodology_version: SemverSchema,
  task_id: z.string().min(1),
  task_hash: HashRefSchema,
  artifact_id: HashRefSchema,
  sample_count: z.number().int().nonnegative(),
  outcomes: z.strictObject({
    wins: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    ties: z.number().int().nonnegative(),
    both_bad: z.number().int().nonnegative(),
  }),
  tags: z.record(z.string(), z.number().int().nonnegative()),
});

export type ReviewSummary = z.infer<typeof ReviewSummarySchema>;

export const PublishedRunSchema = z.strictObject({
  run_id: UlidSchema,
  input_fingerprint: HashRefSchema,
  task_id: z.string().min(1),
  task_version: SemverSchema,
  task_hash: HashRefSchema,
  seed: z.number().int(),
  attempt: z.number().int().positive(),
  included: z.boolean(),
  network_policy: NetworkPolicySchema,
  exit_reason: z.enum([
    "completed",
    "timeout",
    "agent-error",
    "evaluation-error",
  ]),
  score: ScoreResultSchema.optional(),
  wall_time_ms: z.number().nonnegative().optional(),
  usage: RunManifestV2Schema.shape.usage,
  artifacts: z.array(ArtifactRefSchema),
  reproduction: ReproductionRecordSchema.optional(),
  verification: VerificationRecordSchema.optional(),
});

export const PublicationManifestSchema = z.strictObject({
  schema_version: z.literal(1),
  publication_id: HashRefSchema,
  created_at: z.iso.datetime(),
  tier: z.enum(["experimental", "official"]),
  series_id: UlidSchema,
  benchmark: z.strictObject({
    version: SemverSchema,
    release_hash: HashRefSchema,
    git_commit: z.string().regex(/^(?:[a-f0-9]{40}|unknown)$/),
  }),
  configuration: z.strictObject({
    configuration_id: HashRefSchema,
    agent: AgentIdentityV2Schema,
    prompt_language: LanguageSchema,
    execution_profile: z.enum(["local", "official-candidate"]),
    environment: RunEnvironmentV2Schema,
  }),
  aggregate: AggregateResultSchema,
  runs: z.array(PublishedRunSchema).min(1),
  review_summaries: z.array(ReviewSummarySchema).default([]),
}).superRefine((publication, context) => {
  const runIds = new Set<string>();
  const includedCells = new Set<string>();
  for (const run of publication.runs) {
    if (runIds.has(run.run_id)) {
      context.addIssue({
        code: "custom",
        path: ["runs"],
        message: `duplicate run_id: ${run.run_id}`,
      });
    }
    runIds.add(run.run_id);
    if (publication.tier === "official" && run.included) {
      const cell = `${run.task_id}\0${run.seed}`;
      if (includedCells.has(cell)) {
        context.addIssue({
          code: "custom",
          path: ["runs"],
          message: `duplicate official task/seed cell: ${run.task_id} ${run.seed}`,
        });
      }
      includedCells.add(cell);
    }
  }
});

export type PublicationManifest = z.infer<typeof PublicationManifestSchema>;

export const ResultIndexEntrySchema = z.strictObject({
  publication_id: HashRefSchema,
  created_at: z.iso.datetime(),
  tier: z.enum(["experimental", "official"]),
  status: z.enum(["active", "superseded", "withdrawn"]),
  superseded_by: HashRefSchema.optional(),
  benchmark_version: SemverSchema,
  series_id: UlidSchema,
  configuration_id: HashRefSchema,
  agent: AgentIdentityV2Schema,
  aggregate: AggregateResultSchema,
});

export const ResultIndexSchema = z.strictObject({
  schema_version: z.literal(1),
  generated_at: z.iso.datetime(),
  benchmark_versions: z.array(SemverSchema),
  entries: z.array(ResultIndexEntrySchema),
});

export type ResultIndex = z.infer<typeof ResultIndexSchema>;

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
