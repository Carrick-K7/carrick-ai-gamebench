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

export const TaskRelativePathSchema = z.string().min(1).superRefine(
  (value, context) => {
    const segments = value.split("/");
    if (
      value.startsWith("/") ||
      value.includes("\\") ||
      value.includes("\0") ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      context.addIssue({
        code: "custom",
        message: "must be a normalized relative path inside the task directory",
      });
    }
  },
);

export const TestCategorySchema = z.enum([
  "build",
  "mechanics",
  "state",
  "input",
  "stability",
  "feel",
  "visual",
]);

const TestCaseIdSchema = z.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*$/);

export const TestDefinitionSchema = z.strictObject({
  id: TestCaseIdSchema,
  category: TestCategorySchema,
  points: z.number().positive().max(100),
  case: TestCaseIdSchema,
});

export const ReferenceSchema = z.strictObject({
  project: z.string().min(1),
  repository: z.url(),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  license: z.string().min(1),
  capture_pack: TaskRelativePathSchema,
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
    en: TaskRelativePathSchema,
    zh: TaskRelativePathSchema,
  }),
  starter: z.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*$/),
  budget_seconds: z.number().int().positive(),
  network_policy: NetworkPolicySchema,
  runtime: z.strictObject({
    node: z.literal("22"),
    package_manager: z.literal("pnpm"),
    port: z.number().int().min(1024).max(65535),
    viewport: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    device_scale_factor: z.literal(1),
  }),
  test_suite: TaskRelativePathSchema,
  bridge: z.strictObject({
    version: z.literal("1"),
    state_schema: TaskRelativePathSchema,
    // Retained only to parse and hash immutable v0.1.0 task snapshots.
    scenarios: z.array(z.string().min(1)).min(1).optional(),
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
  id: TestCaseIdSchema,
  kind: z.literal("browser"),
  description: z.string().min(1),
  steps: z.array(BrowserStepSchema).min(1),
});

export const BuildCaseSchema = z.strictObject({
  id: TestCaseIdSchema,
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
  const caseIds = new Set<string>();
  suite.cases.forEach((testCase, caseIndex) => {
    if (caseIds.has(testCase.id)) {
      context.addIssue({
        code: "custom",
        path: ["cases", caseIndex, "id"],
        message: `duplicate case id: ${testCase.id}`,
      });
    }
    caseIds.add(testCase.id);
    if (testCase.kind !== "browser") {
      return;
    }
    if (!testCase.steps.some((step) => step.op === "expect" || step.op === "screenshot")) {
      context.addIssue({
        code: "custom",
        path: ["cases", caseIndex, "steps"],
        message: "browser case must include an expect or screenshot assertion",
      });
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

export const ExecutionProfileSchema = z.enum(["local", "official-candidate"]);

export const UsageSchema = z.strictObject({
  input_tokens: z.number().int().nonnegative().optional(),
  cached_input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  cost_usd: z.number().nonnegative().optional(),
  source: z.enum(["provider", "harness", "estimated", "not-reported"]),
});

export const ConfigurationV2Schema = z.strictObject({
  agent: AgentIdentityV2Schema,
  prompt_language: LanguageSchema,
  execution_profile: ExecutionProfileSchema,
  environment: z.strictObject({
    platform: z.string().min(1),
    architecture: z.string().min(1),
    node: z.string().min(1),
    runner_protocol: z.literal("2"),
    git_commit: z.string().regex(/^(?:[a-f0-9]{40}|unknown)$/),
    source_tree_dirty: z.boolean(),
    working_tree_hash: HashRefSchema.optional(),
    evaluator_image_digest: HashRefSchema.optional(),
    browser: z.string().min(1).optional(),
  }),
});

export type ConfigurationV2 = z.infer<typeof ConfigurationV2Schema>;

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

export const RunEnvironmentV3Schema = z.strictObject({
  platform: z.string().min(1),
  architecture: z.string().min(1),
  node: z.string().min(1),
  runner_protocol: z.literal("3"),
  git_commit: z.string().regex(/^(?:[a-f0-9]{40}|unknown)$/),
  source_tree_dirty: z.boolean(),
  working_tree_hash: HashRefSchema.optional(),
  evaluator_image_digest: HashRefSchema.optional(),
  browser: z.string().min(1).optional(),
});

export const ConfigurationV3Schema = z.strictObject({
  agent: AgentIdentityV2Schema,
  prompt_language: LanguageSchema,
  execution_profile: ExecutionProfileSchema,
  environment: RunEnvironmentV3Schema,
});

export const ConfigurationSchema = z.union([
  ConfigurationV2Schema,
  ConfigurationV3Schema,
]);
export type ConfigurationV3 = z.infer<typeof ConfigurationV3Schema>;
export type Configuration = z.infer<typeof ConfigurationSchema>;

export const DevelopmentParametersSchema = z
  .object({ agent_command_hash: HashRefSchema })
  .catchall(JsonValueSchema);
export type DevelopmentParameters = z.infer<typeof DevelopmentParametersSchema>;

export const SubmissionManifestV1Schema = z.strictObject({
  schema_version: z.literal(1),
  benchmark_version: SemverSchema,
  benchmark_release_hash: HashRefSchema,
  series_id: UlidSchema,
  submission_id: UlidSchema,
  configuration_id: HashRefSchema,
  development_input_fingerprint: HashRefSchema,
  agent_command_hash: HashRefSchema,
  development_parameters: DevelopmentParametersSchema,
  task_id: z.string().min(1),
  task_version: SemverSchema,
  task_hash: HashRefSchema,
  agent_invocation_index: z.number().int().positive(),
  execution_profile: ExecutionProfileSchema,
  prompt_language: LanguageSchema,
  network_policy: NetworkPolicySchema,
  agent: AgentIdentityV2Schema,
  environment: RunEnvironmentV3Schema,
  started_at: z.iso.datetime(),
  finished_at: z.iso.datetime(),
  development_exit_reason: z.enum([
    "completed",
    "timeout",
    "agent-error",
    "preparation-error",
  ]),
  source_snapshot_hash: HashRefSchema,
  usage: UsageSchema.optional(),
}).superRefine((submission, context) => {
  if (
    submission.development_parameters.agent_command_hash !==
    submission.agent_command_hash
  ) {
    context.addIssue({
      code: "custom",
      path: ["development_parameters", "agent_command_hash"],
      message: "development_parameters agent command hash must match agent_command_hash",
    });
  }
});

export type SubmissionManifestV1 = z.infer<typeof SubmissionManifestV1Schema>;
export const SubmissionManifestSchema = SubmissionManifestV1Schema;
export type SubmissionManifest = SubmissionManifestV1;

export type RunEnvironmentV3 = z.infer<typeof RunEnvironmentV3Schema>;

export const RunManifestV3Schema = z.strictObject({
  schema_version: z.literal(3),
  benchmark_version: SemverSchema,
  benchmark_release_hash: HashRefSchema,
  series_id: UlidSchema,
  run_id: UlidSchema,
  submission_id: UlidSchema,
  configuration_id: HashRefSchema,
  input_fingerprint: HashRefSchema,
  task_id: z.string().min(1),
  task_version: SemverSchema,
  task_hash: HashRefSchema,
  evaluation_seed: z.number().int(),
  environment: RunEnvironmentV3Schema,
  started_at: z.iso.datetime(),
  finished_at: z.iso.datetime().optional(),
  exit_reason: z.enum(["completed", "evaluation-error"]).optional(),
  wall_time_ms: z.number().nonnegative().optional(),
});

export const EvaluationManifestSchema = RunManifestV3Schema;
export type RunManifestV3 = z.infer<typeof RunManifestV3Schema>;
export type EvaluationManifest = RunManifestV3;

export const RunManifestSchema = z.discriminatedUnion("schema_version", [
  RunManifestV1Schema,
  RunManifestV2Schema,
]);
export const AnyRunManifestSchema = z.discriminatedUnion("schema_version", [
  RunManifestV1Schema,
  RunManifestV2Schema,
  RunManifestV3Schema,
]);

export type RunManifestV2 = z.infer<typeof RunManifestV2Schema>;
export type RunManifest = z.infer<typeof RunManifestSchema>;
export type AnyRunManifest = z.infer<typeof AnyRunManifestSchema>;

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

export const EvaluationResultV1Schema = z.strictObject({
  schema_version: z.literal(1),
  run_id: UlidSchema,
  submission_id: UlidSchema,
  evaluation_seed: z.number().int(),
  score: ScoreResultSchema,
});
export type EvaluationResultV1 = z.infer<typeof EvaluationResultV1Schema>;
export const EvaluationResultSchema = EvaluationResultV1Schema;
export type EvaluationResult = EvaluationResultV1;

export const AggregateTaskResultSchema = z.strictObject({
  task_id: z.string().min(1),
  track: TrackSchema,
  attempts: z.number().int().positive(),
  mean: z.number().min(0).max(100),
  standard_deviation: z.number().nonnegative(),
});

export const AggregateTaskResultV3Schema = z.strictObject({
  task_id: z.string().min(1),
  track: TrackSchema,
  submission_id: UlidSchema,
  evaluation_count: z.number().int().positive(),
  required_evaluation_count: z.number().int().positive(),
  mean: z.number().min(0).max(100),
  standard_deviation: z.number().nonnegative(),
});

const CoverageSchema = z.strictObject({
  completed: z.number().int().nonnegative(),
  required: z.number().int().nonnegative(),
});

const LeaderboardsSchema = z.strictObject({
  build: z.number().min(0).max(100).optional(),
  reproduce: z.number().min(0).max(100).optional(),
  core: z.number().min(0).max(100).optional(),
});

const AggregateResultFields = {
  tasks: z.array(AggregateTaskResultSchema),
  coverage: z.strictObject({
    build: CoverageSchema,
    reproduce: CoverageSchema,
    core: CoverageSchema,
  }),
  leaderboards: LeaderboardsSchema,
};

export const AggregateResultV1Schema = z.strictObject({
  schema_version: z.literal(1),
  ...AggregateResultFields,
});

export const AggregateResultV2Schema = z.strictObject({
  schema_version: z.literal(2),
  ...AggregateResultFields,
});

export const AggregateResultV3Schema = z.strictObject({
  schema_version: z.literal(3),
  primary_board: z.literal("build"),
  tasks: z.array(AggregateTaskResultV3Schema),
  coverage: z.strictObject({
    build: CoverageSchema,
    reproduce: CoverageSchema,
  }),
  evaluation_coverage: z.strictObject({
    build: CoverageSchema,
    reproduce: CoverageSchema,
  }),
  leaderboards: z.strictObject({
    build: z.number().min(0).max(100).optional(),
    reproduce: z.number().min(0).max(100).optional(),
  }),
}).superRefine((aggregate, context) => {
  const ids = new Set<string>();
  for (const [index, task] of aggregate.tasks.entries()) {
    if (ids.has(task.task_id)) {
      context.addIssue({
        code: "custom",
        path: ["tasks", index, "task_id"],
        message: `duplicate aggregate task: ${task.task_id}`,
      });
    }
    ids.add(task.task_id);
    if (task.evaluation_count > task.required_evaluation_count) {
      context.addIssue({
        code: "custom",
        path: ["tasks", index, "evaluation_count"],
        message: "evaluation_count may not exceed required_evaluation_count",
      });
    }
  }
  const tracks = ["build", "reproduce"] as const;
  for (const track of tracks) {
    const taskRows = aggregate.tasks.filter((task) => task.track === track);
    const completedTasks = taskRows.filter(
      (task) => task.evaluation_count === task.required_evaluation_count,
    ).length;
    const completedEvaluations = taskRows.reduce(
      (sum, task) => sum + task.evaluation_count,
      0,
    );
    const coverage = aggregate.coverage[track];
    const evaluationCoverage = aggregate.evaluation_coverage[track];
    if (
      coverage.completed !== completedTasks ||
      coverage.completed > coverage.required
    ) {
      context.addIssue({
        code: "custom",
        path: ["coverage", track],
        message: "task coverage is inconsistent with aggregate task rows",
      });
    }
    if (
      evaluationCoverage.completed !== completedEvaluations ||
      evaluationCoverage.completed > evaluationCoverage.required
    ) {
      context.addIssue({
        code: "custom",
        path: ["evaluation_coverage", track],
        message: "evaluation coverage is inconsistent with aggregate task rows",
      });
    }
    if (
      coverage.completed === coverage.required &&
      coverage.required > 0
    ) {
      const expected = Math.round(
        (taskRows.reduce((sum, task) => sum + task.mean, 0) / taskRows.length) *
          10_000,
      ) / 10_000;
      if (aggregate.leaderboards[track] !== expected) {
        context.addIssue({
          code: "custom",
          path: ["leaderboards", track],
          message: `complete ${track} coverage requires leaderboard ${expected}`,
        });
      }
    } else if (aggregate.leaderboards[track] !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["leaderboards", track],
        message: `incomplete ${track} coverage may not publish a leaderboard`,
      });
    }
  }
});

export const AggregateResultLegacySchema = z.discriminatedUnion("schema_version", [
  AggregateResultV1Schema,
  AggregateResultV2Schema,
]);

export const AggregateResultSchema = AggregateResultLegacySchema;
export const AnyAggregateResultSchema = z.discriminatedUnion("schema_version", [
  AggregateResultV1Schema,
  AggregateResultV2Schema,
  AggregateResultV3Schema,
]);

export type AggregateTaskResult = z.infer<typeof AggregateTaskResultSchema>;
export type AggregateTaskResultV3 = z.infer<typeof AggregateTaskResultV3Schema>;
export type AggregateResultV1 = z.infer<typeof AggregateResultV1Schema>;
export type AggregateResultV2 = z.infer<typeof AggregateResultV2Schema>;
export type AggregateResultV3 = z.infer<typeof AggregateResultV3Schema>;
export type AggregateResult = z.infer<typeof AggregateResultSchema>;
export type AnyAggregateResult = z.infer<typeof AnyAggregateResultSchema>;

export const SeriesRunReferenceSchema = z.strictObject({
  run_id: UlidSchema,
  task_id: z.string().min(1),
  task_hash: HashRefSchema,
  seed: z.number().int(),
  attempt: z.number().int().positive(),
  included: z.boolean(),
  exclusion_reason: z.string().min(1).optional(),
});

export const SeriesManifestV1Schema = z.strictObject({
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

export const SeriesSubmissionReferenceV2Schema = z.strictObject({
  submission_id: UlidSchema,
  task_id: z.string().min(1),
  task_hash: HashRefSchema,
  agent_invocation_index: z.number().int().positive(),
  included: z.boolean(),
  exclusion_reason: z.string().min(1).optional(),
});

export const SeriesEvaluationReferenceV2Schema = z.strictObject({
  run_id: UlidSchema,
  submission_id: UlidSchema,
  task_id: z.string().min(1),
  task_hash: HashRefSchema,
  evaluation_seed: z.number().int(),
  included: z.boolean(),
  exclusion_reason: z.string().min(1).optional(),
});

export const SeriesManifestV2Schema = z.strictObject({
  schema_version: z.literal(2),
  series_id: UlidSchema,
  benchmark_version: SemverSchema,
  benchmark_release_hash: HashRefSchema,
  git_commit: z.string().regex(/^(?:[a-f0-9]{40}|unknown)$/),
  configuration_id: HashRefSchema,
  configuration: ConfigurationV3Schema,
  created_at: z.iso.datetime(),
  submissions: z.array(SeriesSubmissionReferenceV2Schema),
  evaluations: z.array(SeriesEvaluationReferenceV2Schema),
}).superRefine((series, context) => {
  const submissions = new Map<string, (typeof series.submissions)[number]>();
  const runIds = new Set<string>();
  const includedCells = new Set<string>();
  for (const [index, submission] of series.submissions.entries()) {
    if (submissions.has(submission.submission_id)) {
      context.addIssue({
        code: "custom",
        path: ["submissions", index, "submission_id"],
        message: `duplicate submission_id: ${submission.submission_id}`,
      });
    }
    if (submission.included === (submission.exclusion_reason !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["submissions", index],
        message: "included submissions must omit exclusion_reason and excluded submissions must provide it",
      });
    }
    submissions.set(submission.submission_id, submission);
  }
  for (const [index, evaluation] of series.evaluations.entries()) {
    if (runIds.has(evaluation.run_id)) {
      context.addIssue({
        code: "custom",
        path: ["evaluations", index, "run_id"],
        message: `duplicate run_id: ${evaluation.run_id}`,
      });
    }
    runIds.add(evaluation.run_id);
    const submission = submissions.get(evaluation.submission_id);
    if (!submission) {
      context.addIssue({
        code: "custom",
        path: ["evaluations", index, "submission_id"],
        message: `unknown submission_id: ${evaluation.submission_id}`,
      });
    } else if (
      submission.task_id !== evaluation.task_id ||
      submission.task_hash !== evaluation.task_hash
    ) {
      context.addIssue({
        code: "custom",
        path: ["evaluations", index],
        message: "evaluation task identity does not match its submission",
      });
    } else if (evaluation.included && !submission.included) {
      context.addIssue({
        code: "custom",
        path: ["evaluations", index, "included"],
        message: "an included evaluation requires an included submission",
      });
    }
    if (evaluation.included === (evaluation.exclusion_reason !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["evaluations", index],
        message: "included evaluations must omit exclusion_reason and excluded evaluations must provide it",
      });
    }
    if (evaluation.included) {
      const cell = `${evaluation.submission_id}\0${evaluation.evaluation_seed}`;
      if (includedCells.has(cell)) {
        context.addIssue({
          code: "custom",
          path: ["evaluations", index],
          message: `duplicate included submission/seed cell: ${evaluation.evaluation_seed}`,
        });
      }
      includedCells.add(cell);
    }
  }
});

export const SeriesManifestSchema = SeriesManifestV1Schema;
export const AnySeriesManifestSchema = z.discriminatedUnion("schema_version", [
  SeriesManifestV1Schema,
  SeriesManifestV2Schema,
]);

export type SeriesManifestV1 = z.infer<typeof SeriesManifestV1Schema>;
export type SeriesManifestV2 = z.infer<typeof SeriesManifestV2Schema>;
export type SeriesManifest = SeriesManifestV1;
export type AnySeriesManifest = z.infer<typeof AnySeriesManifestSchema>;

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

export const ReproductionRecordV2Schema = z.strictObject({
  schema_version: z.literal(2),
  prepared_at: z.iso.datetime(),
  benchmark_release_hash: HashRefSchema,
  submission_id: UlidSchema,
  clean_source_artifact_id: HashRefSchema,
  evaluation_set_hash: HashRefSchema,
});

export const VerificationRecordV2Schema = z.strictObject({
  schema_version: z.literal(2),
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
  submission_id: UlidSchema,
  clean_source_artifact_id: HashRefSchema,
  evaluation_set_hash: HashRefSchema,
});

export type ReproductionRecordV2 = z.infer<typeof ReproductionRecordV2Schema>;
export type VerificationRecordV2 = z.infer<typeof VerificationRecordV2Schema>;

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

export const PublicationManifestV1Schema = z.strictObject({
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
  aggregate: AggregateResultLegacySchema,
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

export type PublicationManifestV1 = z.infer<typeof PublicationManifestV1Schema>;

export const PublishedEvaluationV2Schema = z.strictObject({
  run_id: UlidSchema,
  input_fingerprint: HashRefSchema,
  evaluation_seed: z.number().int(),
  included: z.boolean(),
  exit_reason: z.enum(["completed", "evaluation-error"]),
  score: ScoreResultSchema.optional(),
  wall_time_ms: z.number().nonnegative().optional(),
  artifacts: z.array(ArtifactRefSchema),
});

export const PublishedSubmissionV2Schema = z.strictObject({
  submission_id: UlidSchema,
  development_input_fingerprint: HashRefSchema,
  agent_command_hash: HashRefSchema,
  development_parameters: z.record(z.string(), JsonValueSchema),
  source_snapshot_hash: HashRefSchema,
  task_id: z.string().min(1),
  task_version: SemverSchema,
  task_hash: HashRefSchema,
  agent_invocation_index: z.number().int().positive(),
  included: z.boolean(),
  network_policy: NetworkPolicySchema,
  development_exit_reason: z.enum([
    "completed",
    "timeout",
    "agent-error",
    "preparation-error",
  ]),
  usage: UsageSchema.optional(),
  artifacts: z.array(ArtifactRefSchema),
  reproduction: ReproductionRecordV2Schema.optional(),
  verification: VerificationRecordV2Schema.optional(),
  evaluations: z.array(PublishedEvaluationV2Schema).min(1),
}).superRefine((submission, context) => {
  if (
    submission.development_parameters.agent_command_hash !==
    submission.agent_command_hash
  ) {
    context.addIssue({
      code: "custom",
      path: ["development_parameters", "agent_command_hash"],
      message: "development_parameters agent command hash must match agent_command_hash",
    });
  }
});

export const PublicationManifestV2Schema = z.strictObject({
  schema_version: z.literal(2),
  publication_id: HashRefSchema,
  created_at: z.iso.datetime(),
  tier: z.enum(["experimental", "official"]),
  board: TrackSchema,
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
    execution_profile: ExecutionProfileSchema,
    environment: RunEnvironmentV3Schema,
  }),
  aggregate: AggregateResultV3Schema,
  submissions: z.array(PublishedSubmissionV2Schema).min(1),
  review_summaries: z.array(ReviewSummarySchema).default([]),
}).superRefine((publication, context) => {
  const otherBoard = publication.board === "build" ? "reproduce" : "build";
  if (
    publication.aggregate.coverage[otherBoard].required !== 0 ||
    publication.aggregate.evaluation_coverage[otherBoard].required !== 0 ||
    publication.aggregate.leaderboards[otherBoard] !== undefined
  ) {
    context.addIssue({
      code: "custom",
      path: ["aggregate"],
      message: `${otherBoard} must have zero required coverage and no leaderboard in a ${publication.board} publication`,
    });
  }
  for (const [index, task] of publication.aggregate.tasks.entries()) {
    if (task.track !== publication.board) {
      context.addIssue({
        code: "custom",
        path: ["aggregate", "tasks", index, "track"],
        message: `aggregate task must belong to the ${publication.board} board`,
      });
    }
  }
  const submissionIds = new Set<string>();
  const runIds = new Set<string>();
  const includedTaskIds = new Set<string>();
  const matchedAggregateTasks = new Set<string>();
  const aggregateByTask = new Map(
    publication.aggregate.tasks.map((task) => [task.task_id, task]),
  );
  for (const [submissionIndex, submission] of publication.submissions.entries()) {
    if (submissionIds.has(submission.submission_id)) {
      context.addIssue({
        code: "custom",
        path: ["submissions", submissionIndex, "submission_id"],
        message: `duplicate submission_id: ${submission.submission_id}`,
      });
    }
    submissionIds.add(submission.submission_id);
    if (!submission.task_id.startsWith(`${publication.board}.`)) {
      context.addIssue({
        code: "custom",
        path: ["submissions", submissionIndex, "task_id"],
        message: `submission task must belong to the ${publication.board} board`,
      });
    }
    if (
      submission.reproduction &&
      submission.reproduction.submission_id !== submission.submission_id
    ) {
      context.addIssue({
        code: "custom",
        path: ["submissions", submissionIndex, "reproduction", "submission_id"],
        message: "reproduction does not match submission",
      });
    }
    if (
      submission.verification &&
      submission.verification.submission_id !== submission.submission_id
    ) {
      context.addIssue({
        code: "custom",
        path: ["submissions", submissionIndex, "verification", "submission_id"],
        message: "verification does not match submission",
      });
    }
    if (submission.reproduction && (
      submission.reproduction.benchmark_release_hash !== publication.benchmark.release_hash ||
      !submission.artifacts.some(
        (artifact) =>
          artifact.role === "clean-source" &&
          artifact.artifact_id === submission.reproduction?.clean_source_artifact_id,
      )
    )) {
      context.addIssue({
        code: "custom",
        path: ["submissions", submissionIndex, "reproduction"],
        message: "reproduction must bind this release and a published clean source",
      });
    }
    if (submission.verification && (
      submission.verification.benchmark_release_hash !== publication.benchmark.release_hash ||
      !submission.reproduction ||
      submission.verification.clean_source_artifact_id !==
        submission.reproduction.clean_source_artifact_id ||
      submission.verification.evaluation_set_hash !==
        submission.reproduction.evaluation_set_hash
    )) {
      context.addIssue({
        code: "custom",
        path: ["submissions", submissionIndex, "verification"],
        message: "verification must bind the submission reproduction set",
      });
    }
    const seeds = new Set<number>();
    for (const [evaluationIndex, evaluation] of submission.evaluations.entries()) {
      if (runIds.has(evaluation.run_id)) {
        context.addIssue({
          code: "custom",
          path: ["submissions", submissionIndex, "evaluations", evaluationIndex, "run_id"],
          message: `duplicate run_id: ${evaluation.run_id}`,
        });
      }
      runIds.add(evaluation.run_id);
      if (evaluation.included && !submission.included) {
        context.addIssue({
          code: "custom",
          path: ["submissions", submissionIndex, "evaluations", evaluationIndex, "included"],
          message: "an included evaluation requires an included submission",
        });
      }
      if (evaluation.included && !evaluation.score) {
        context.addIssue({
          code: "custom",
          path: ["submissions", submissionIndex, "evaluations", evaluationIndex, "score"],
          message: "an included evaluation requires a score",
        });
      }
      if (evaluation.score && (
        evaluation.score.task_id !== submission.task_id ||
        evaluation.score.task_hash !== submission.task_hash
      )) {
        context.addIssue({
          code: "custom",
          path: ["submissions", submissionIndex, "evaluations", evaluationIndex, "score"],
          message: "evaluation score does not match submission task",
        });
      }
      if (evaluation.included) {
        if (seeds.has(evaluation.evaluation_seed)) {
          context.addIssue({
            code: "custom",
            path: ["submissions", submissionIndex, "evaluations", evaluationIndex],
            message: `duplicate included evaluation seed: ${evaluation.evaluation_seed}`,
          });
        }
        seeds.add(evaluation.evaluation_seed);
      }
    }
    if (submission.included) {
      if (includedTaskIds.has(submission.task_id)) {
        context.addIssue({
          code: "custom",
          path: ["submissions", submissionIndex, "task_id"],
          message: `multiple included submissions for task ${submission.task_id}`,
        });
      }
      includedTaskIds.add(submission.task_id);
      const includedScores = submission.evaluations
        .filter((evaluation) => evaluation.included && evaluation.score)
        .map((evaluation) => evaluation.score?.percent ?? 0);
      const aggregateTask = aggregateByTask.get(submission.task_id);
      if (includedScores.length === 0 || !aggregateTask) {
        context.addIssue({
          code: "custom",
          path: ["submissions", submissionIndex],
          message: "an included submission requires scored evaluations and an aggregate task",
        });
      } else {
        matchedAggregateTasks.add(submission.task_id);
        const mean = includedScores.reduce((sum, score) => sum + score, 0) /
          includedScores.length;
        const standardDeviation = Math.sqrt(
          includedScores.reduce(
            (sum, score) => sum + (score - mean) ** 2,
            0,
          ) / includedScores.length,
        );
        const roundedMean = Math.round(mean * 10_000) / 10_000;
        const roundedDeviation = Math.round(standardDeviation * 10_000) / 10_000;
        if (
          aggregateTask.submission_id !== submission.submission_id ||
          aggregateTask.evaluation_count !== includedScores.length ||
          aggregateTask.mean !== roundedMean ||
          aggregateTask.standard_deviation !== roundedDeviation ||
          aggregateTask.track !== submission.task_id.split(".", 1)[0]
        ) {
          context.addIssue({
            code: "custom",
            path: ["aggregate", "tasks"],
            message: `aggregate task does not match included evaluations for ${submission.task_id}`,
          });
        }
      }
    }
  }
  for (const [index, aggregateTask] of publication.aggregate.tasks.entries()) {
    if (!matchedAggregateTasks.has(aggregateTask.task_id)) {
      context.addIssue({
        code: "custom",
        path: ["aggregate", "tasks", index],
        message: `aggregate task has no included submission: ${aggregateTask.task_id}`,
      });
    }
  }
});

export const PublicationManifestSchema = PublicationManifestV1Schema;
export const AnyPublicationManifestSchema = z.discriminatedUnion("schema_version", [
  PublicationManifestV1Schema,
  PublicationManifestV2Schema,
]);

export type PublicationManifestV2 = z.infer<typeof PublicationManifestV2Schema>;
export type PublicationManifest = PublicationManifestV1;
export type AnyPublicationManifest = z.infer<typeof AnyPublicationManifestSchema>;

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
  aggregate: AggregateResultLegacySchema,
});

export const ResultIndexV1Schema = z.strictObject({
  schema_version: z.literal(1),
  generated_at: z.iso.datetime(),
  benchmark_versions: z.array(SemverSchema),
  entries: z.array(ResultIndexEntrySchema),
});

const ResultIndexEntryV2Fields = {
  publication_id: HashRefSchema,
  created_at: z.iso.datetime(),
  tier: z.enum(["experimental", "official"]),
  status: z.enum(["active", "superseded", "withdrawn"]),
  superseded_by: HashRefSchema.optional(),
  benchmark_version: SemverSchema,
  series_id: UlidSchema,
  configuration_id: HashRefSchema,
  agent: AgentIdentityV2Schema,
};

export const ResultIndexLegacyEntryV2Schema = z.strictObject({
  publication_schema_version: z.literal(1),
  ...ResultIndexEntryV2Fields,
  aggregate: AggregateResultLegacySchema,
});

export const ResultIndexPublicationV2EntrySchema = z.strictObject({
  publication_schema_version: z.literal(2),
  ...ResultIndexEntryV2Fields,
  board: TrackSchema,
  aggregate: AggregateResultV3Schema,
}).superRefine((entry, context) => {
  const otherBoard = entry.board === "build" ? "reproduce" : "build";
  if (
    entry.aggregate.tasks.some((task) => task.track !== entry.board) ||
    entry.aggregate.coverage[otherBoard].required !== 0 ||
    entry.aggregate.evaluation_coverage[otherBoard].required !== 0 ||
    entry.aggregate.leaderboards[otherBoard] !== undefined
  ) {
    context.addIssue({
      code: "custom",
      path: ["aggregate"],
      message: `aggregate must be scoped to the ${entry.board} board`,
    });
  }
});

export const ResultIndexEntryV2Schema = z.discriminatedUnion(
  "publication_schema_version",
  [ResultIndexLegacyEntryV2Schema, ResultIndexPublicationV2EntrySchema],
);

export const ResultIndexV2Schema = z.strictObject({
  schema_version: z.literal(2),
  generated_at: z.iso.datetime(),
  benchmark_versions: z.array(SemverSchema),
  entries: z.array(ResultIndexEntryV2Schema),
});

export const ResultIndexSchema = ResultIndexV1Schema;
export const AnyResultIndexSchema = z.discriminatedUnion("schema_version", [
  ResultIndexV1Schema,
  ResultIndexV2Schema,
]);

export type ResultIndexV1 = z.infer<typeof ResultIndexV1Schema>;
export type ResultIndexLegacyEntryV2 = z.infer<typeof ResultIndexLegacyEntryV2Schema>;
export type ResultIndexPublicationV2Entry = z.infer<typeof ResultIndexPublicationV2EntrySchema>;
export type ResultIndexEntryV2 = z.infer<typeof ResultIndexEntryV2Schema>;
export type ResultIndexV2 = z.infer<typeof ResultIndexV2Schema>;
export type ResultIndex = ResultIndexV1;
export type AnyResultIndex = z.infer<typeof AnyResultIndexSchema>;

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
