import { z } from "zod";
import type { LoadedTask } from "./tasks.js";
import {
  AgentIdentityV2Schema,
  HashRefSchema,
  ScoreResultSchema,
  SemverSchema,
  UlidSchema,
} from "./schema.js";

export const LITE_BENCHMARK_VERSION = "0.6.0";
export const LITE_EVALUATION_SEED = 104729;

export const LiteReleaseLockSchema = z.strictObject({
  schema_version: z.literal(1),
  benchmark: z.literal("carrick-ai-gamebench"),
  benchmark_version: SemverSchema,
  evaluation_seed: z.literal(LITE_EVALUATION_SEED),
  agent_invocations_per_task: z.literal(1),
  scoring: z.strictObject({
    primary_board: z.literal("build"),
    task_weighting: z.literal("equal"),
  }),
  tasks: z.array(
    z.strictObject({
      id: z.string().min(1),
      version: SemverSchema,
      hash: HashRefSchema,
    }),
  ).length(4),
}).superRefine((release, context) => {
  const ids = new Set<string>();
  for (const [index, task] of release.tasks.entries()) {
    if (!task.id.startsWith("build.")) {
      context.addIssue({
        code: "custom",
        path: ["tasks", index, "id"],
        message: "GameBench Lite supports Build tasks only",
      });
    }
    if (ids.has(task.id)) {
      context.addIssue({
        code: "custom",
        path: ["tasks", index, "id"],
        message: `duplicate task id: ${task.id}`,
      });
    }
    ids.add(task.id);
    if (index > 0 && (release.tasks[index - 1]?.id ?? "").localeCompare(task.id) >= 0) {
      context.addIssue({
        code: "custom",
        path: ["tasks", index, "id"],
        message: "tasks must be sorted by unique task id",
      });
    }
  }
});

export type LiteReleaseLock = z.infer<typeof LiteReleaseLockSchema>;

export function createLiteReleaseLock(
  benchmarkVersion: string,
  tasks: LoadedTask[],
): LiteReleaseLock {
  return LiteReleaseLockSchema.parse({
    schema_version: 1,
    benchmark: "carrick-ai-gamebench",
    benchmark_version: benchmarkVersion,
    evaluation_seed: LITE_EVALUATION_SEED,
    agent_invocations_per_task: 1,
    scoring: {
      primary_board: "build",
      task_weighting: "equal",
    },
    tasks: tasks
      .map((task) => ({
        id: task.manifest.id,
        version: task.manifest.version,
        hash: task.hash,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

export const LiteTaskResultSchema = z.strictObject({
  task_id: z.string().min(1),
  task_version: SemverSchema,
  task_hash: HashRefSchema,
  source_hash: HashRefSchema,
  agent: z.strictObject({
    invocation: z.literal(1),
    started_at: z.iso.datetime(),
    finished_at: z.iso.datetime(),
    wall_time_ms: z.number().int().nonnegative(),
    exit_reason: z.enum(["completed", "timeout-delivery", "agent-error"]),
  }),
  evaluation: z.strictObject({
    seed: z.literal(LITE_EVALUATION_SEED),
    status: z.enum(["scored", "infrastructure-error", "not-run"]),
    score: ScoreResultSchema.optional(),
    message: z.string().optional(),
  }).superRefine((evaluation, context) => {
    if (evaluation.status === "scored" && !evaluation.score) {
      context.addIssue({
        code: "custom",
        path: ["score"],
        message: "a scored evaluation requires score",
      });
    }
    if (evaluation.status !== "scored" && evaluation.score) {
      context.addIssue({
        code: "custom",
        path: ["score"],
        message: "an unscored evaluation may not contain score",
      });
    }
  }),
  artifact_manifest_hash: HashRefSchema,
}).superRefine((task, context) => {
  if (
    task.evaluation.score &&
    (task.evaluation.score.task_id !== task.task_id ||
      task.evaluation.score.task_hash !== task.task_hash)
  ) {
    context.addIssue({
      code: "custom",
      path: ["evaluation", "score"],
      message: "score identity must match its task result",
    });
  }
});

export type LiteTaskResult = z.infer<typeof LiteTaskResultSchema>;

export const LiteSeriesResultSchema = z.strictObject({
  schema_version: z.literal(2),
  benchmark: z.literal("carrick-ai-gamebench"),
  benchmark_version: SemverSchema,
  release_hash: HashRefSchema,
  series_id: UlidSchema,
  git_commit: z.union([z.string().regex(/^[a-f0-9]{40}$/), z.literal("unknown")]),
  source_tree_clean: z.boolean(),
  profile: z.enum(["official", "local"]),
  configuration: z.strictObject({
    agent: AgentIdentityV2Schema,
    prompt_language: z.enum(["en", "zh"]),
  }),
  campaign: z.strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
    cell_id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
    plan_hash: HashRefSchema,
    execution_hash: HashRefSchema,
  }).optional(),
  started_at: z.iso.datetime(),
  finished_at: z.iso.datetime(),
  tasks: z.array(LiteTaskResultSchema).length(4),
  build: z.strictObject({
    completed: z.number().int().min(0).max(4),
    required: z.literal(4),
    score: z.number().min(0).max(100).optional(),
  }),
}).superRefine((result, context) => {
  const ids = new Set<string>();
  for (const [index, task] of result.tasks.entries()) {
    if (ids.has(task.task_id)) {
      context.addIssue({
        code: "custom",
        path: ["tasks", index, "task_id"],
        message: `duplicate task result: ${task.task_id}`,
      });
    }
    ids.add(task.task_id);
  }
  const scored = result.tasks.filter((task) => task.evaluation.status === "scored");
  if (result.build.completed !== scored.length) {
    context.addIssue({
      code: "custom",
      path: ["build", "completed"],
      message: "completed must equal the number of scored tasks",
    });
  }
  if (result.build.required < result.tasks.length) {
    context.addIssue({
      code: "custom",
      path: ["build", "required"],
      message: "required may not be smaller than the recorded task count",
    });
  }
  if (scored.length === result.build.required) {
    const expected = scored.reduce(
      (sum, task) => sum + (task.evaluation.score?.percent ?? 0),
      0,
    ) / result.build.required;
    if (result.build.score === undefined || Math.abs(result.build.score - expected) > 0.0001) {
      context.addIssue({
        code: "custom",
        path: ["build", "score"],
        message: `complete result must report the equal-weight score ${expected}`,
      });
    }
  } else if (result.build.score !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["build", "score"],
      message: "incomplete result may not report a Build score",
    });
  }
});

export type LiteSeriesResult = z.infer<typeof LiteSeriesResultSchema>;

export const LiteResultIndexSchema = z.strictObject({
  schema_version: z.literal(1),
  results: z.array(z.strictObject({
    benchmark_version: SemverSchema,
    series_id: UlidSchema,
    path: z.string().min(1),
  })),
}).superRefine((index, context) => {
  const ids = new Set<string>();
  for (const [position, entry] of index.results.entries()) {
    const identity = `${entry.benchmark_version}/${entry.series_id}`;
    if (ids.has(identity)) {
      context.addIssue({
        code: "custom",
        path: ["results", position],
        message: `duplicate lightweight result: ${identity}`,
      });
    }
    ids.add(identity);
    const expected = `results/lite/${entry.benchmark_version}/${entry.series_id}.json`;
    if (entry.path !== expected) {
      context.addIssue({
        code: "custom",
        path: ["results", position, "path"],
        message: `result path must be ${expected}`,
      });
    }
  }
});

export type LiteResultIndex = z.infer<typeof LiteResultIndexSchema>;

export function summarizeLiteBuild(
  tasks: LiteTaskResult[],
  required: 4 = 4,
): LiteSeriesResult["build"] {
  const scored = tasks.filter((task) => task.evaluation.status === "scored");
  if (scored.length !== required) {
    return { completed: scored.length, required };
  }
  return {
    completed: scored.length,
    required,
    score: scored.reduce(
      (sum, task) => sum + (task.evaluation.score?.percent ?? 0),
      0,
    ) / required,
  };
}
