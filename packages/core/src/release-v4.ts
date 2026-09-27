import { z } from "zod";
import {
  HashRefSchema,
  SemverSchema,
} from "./schema.js";
import {
  AnyReleaseLockSchema,
} from "./releases.js";
import {
  createLiteReleaseLock,
  LiteReleaseLockSchema,
} from "./lite.js";
import {
  PLAY_DEFAULT_EPISODES,
  PLAY_INVALID_RESPONSE_STOP,
  PLAY_MAX_DECISIONS,
  PLAY_MEMO_MAX_BYTES,
  PLAY_PRIMARY_METRIC,
  PLAY_SLOT_SECONDS,
  PlayGameSchema,
  PlayPrimaryMetricSchema,
  PlayTaskIdSchema,
  playTaskGameSegment,
} from "./play-schema.js";
import type { LoadedPlayTask } from "./play-tasks.js";
import type { LoadedTask } from "./tasks.js";

/**
 * ReleaseLock v4 declares both `suites.build` and `suites.play` under a single
 * benchmark_version. Build's instrument is an exact projection of the current
 * v0.6 Lite instrument: four Build tasks, one seed (104729), equal task
 * weighting and one agent invocation per task. There is no Reproduce track and
 * no v0.5-style three-seed evaluation set. Play is the new maintainer-owned
 * visual player suite.
 */

export const ReleaseLockV4BuildSuiteSchema = z
  .strictObject({
    evaluation_seed: z.literal(104729),
    agent_invocations_per_task: z.literal(1),
    scoring: z.strictObject({
      primary_board: z.literal("build"),
      task_weighting: z.literal("equal"),
    }),
    tasks: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          version: SemverSchema,
          hash: HashRefSchema,
        }),
      )
      .length(4),
  })
  .superRefine((suite, context) => {
    const ids = new Set<string>();
    let previous = "";
    for (const [index, task] of suite.tasks.entries()) {
      if (!task.id.startsWith("build.")) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "id"],
          message: `build suite task id ${task.id} must start with build.`,
        });
      }
      if (ids.has(task.id)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "id"],
          message: `duplicate build task id: ${task.id}`,
        });
      }
      ids.add(task.id);
      if (index > 0 && previous.localeCompare(task.id) >= 0) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "id"],
          message: "build suite tasks must be sorted by unique task id",
        });
      }
      previous = task.id;
    }
  });
export type ReleaseLockV4BuildSuite = z.infer<typeof ReleaseLockV4BuildSuiteSchema>;

export const ReleaseLockV4PlaySuiteSchema = z.strictObject({
  config: z.strictObject({
    protocol: z.literal("play-visual-v1"),
    observation: z.literal("screenshot-png"),
    action_space: z.literal("native-keyboard-mouse"),
    viewport: z.tuple([z.literal(1280), z.literal(720)]),
    device_scale_factor: z.literal(1),
    history_length: z.literal(8),
    transport_retries: z.literal(1),
    seed_policy: z.literal("committed-distinct-uint32-per-game"),
    episodes: z.literal(PLAY_DEFAULT_EPISODES),
    slot_seconds: z.literal(PLAY_SLOT_SECONDS),
    memo_max_bytes: z.literal(PLAY_MEMO_MAX_BYTES),
    invalid_response_stop: z.literal(PLAY_INVALID_RESPONSE_STOP),
  }),
  task_count: z.literal(2),
  tasks: z.array(
    z.strictObject({
      id: PlayTaskIdSchema,
      version: SemverSchema,
      game: PlayGameSchema,
      hash: HashRefSchema,
      episodes: z.literal(PLAY_DEFAULT_EPISODES),
      max_decisions: z.number().int().positive(),
      primary_metric: PlayPrimaryMetricSchema,
    }),
  ),
});
export type ReleaseLockV4PlaySuite = z.infer<typeof ReleaseLockV4PlaySuiteSchema>;

function assertSortedUnique(
  ids: string[],
  context: z.RefinementCtx,
  path: (string | number)[],
  label: string,
): void {
  const seen = new Set<string>();
  let previous = "";
  for (const [index, id] of ids.entries()) {
    if (seen.has(id)) {
      context.addIssue({
        code: "custom",
        path: [...path, index, "id"],
        message: `duplicate ${label} id: ${id}`,
      });
    }
    seen.add(id);
    if (index > 0 && previous.localeCompare(id) >= 0) {
      context.addIssue({
        code: "custom",
        path: [...path, index, "id"],
        message: `${label} tasks must be sorted by unique task id`,
      });
    }
    previous = id;
  }
}

export const ReleaseLockV4Schema = z
  .strictObject({
    schema_version: z.literal(4),
    benchmark: z.literal("carrick-ai-gamebench"),
    benchmark_version: SemverSchema,
    protocols: z.strictObject({
      task_manifest: z.literal(1),
      play_task_manifest: z.literal(1),
      bridge: z.literal(1),
      runner_protocol: z.literal(4),
    }),
    suites: z.strictObject({
      build: ReleaseLockV4BuildSuiteSchema,
      play: ReleaseLockV4PlaySuiteSchema,
    }),
  })
  .superRefine((lock, context) => {
    if (lock.suites.play.task_count !== lock.suites.play.tasks.length) {
      context.addIssue({
        code: "custom",
        path: ["suites", "play", "task_count"],
        message: "play task_count must equal play tasks.length",
      });
    }
    if (new Set(lock.suites.play.tasks.map((task) => task.game)).size !== 2) context.addIssue({ code: "custom", path: ["suites", "play", "tasks"], message: "Play v1 requires both 2048 and Minesweeper, once each" });
    const playIds: string[] = [];
    for (const [index, task] of lock.suites.play.tasks.entries()) {
      const gameSegment = playTaskGameSegment(task.id);
      if (gameSegment !== task.game) {
        context.addIssue({
          code: "custom",
          path: ["suites", "play", "tasks", index, "id"],
          message: `play task id ${task.id} does not match game ${task.game}`,
        });
      }
      if (task.max_decisions !== PLAY_MAX_DECISIONS[task.game]) {
        context.addIssue({
          code: "custom",
          path: ["suites", "play", "tasks", index, "max_decisions"],
          message: `${task.game} requires ${PLAY_MAX_DECISIONS[task.game]} maximum decisions`,
        });
      }
      if (task.primary_metric !== PLAY_PRIMARY_METRIC[task.game]) {
        context.addIssue({
          code: "custom",
          path: ["suites", "play", "tasks", index, "primary_metric"],
          message: `${task.game} requires ${PLAY_PRIMARY_METRIC[task.game]} as its primary metric`,
        });
      }
      if (task.episodes !== PLAY_DEFAULT_EPISODES) {
        context.addIssue({
          code: "custom",
          path: ["suites", "play", "tasks", index, "episodes"],
          message: `${task.game} requires ${PLAY_DEFAULT_EPISODES} episodes`,
        });
      }
      playIds.push(task.id);
    }
    assertSortedUnique(playIds, context, ["suites", "play", "tasks"], "play");

    const buildIds = lock.suites.build.tasks.map((task) => task.id);
    const overlap = buildIds.find((id) => playIds.includes(id));
    if (overlap !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["suites"],
        message: `task id ${overlap} is declared in both suites`,
      });
    }
  });

export type ReleaseLockV4 = z.infer<typeof ReleaseLockV4Schema>;

/**
 * The union of every release-lock generation, including the current v0.6 Lite
 * lock, so a reader can dispatch by the exact record schema_version and shape
 * rather than the currently installed lock.
 */
export const AnyReleaseLockWithPlaySchema = z.union([
  LiteReleaseLockSchema,
  AnyReleaseLockSchema,
  ReleaseLockV4Schema,
]);
export type AnyReleaseLockWithPlay = z.infer<typeof AnyReleaseLockWithPlaySchema>;

/**
 * Dispatch a release-lock record. v1 is shared by the legacy v0.1 lock (with
 * `tracks`) and the current v0.6 Lite lock (with `evaluation_seed`/`scoring`),
 * so we discriminate by shape as well as schema_version.
 */
export function readReleaseLock(data: unknown): AnyReleaseLockWithPlay {
  if (typeof data !== "object" || data === null) {
    throw new Error("release lock must be an object");
  }
  const record = data as Record<string, unknown>;
  if (record.schema_version === 1) {
    if ("tracks" in record) {
      const parsed = AnyReleaseLockSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error(`Unrecognized release lock: ${formatIssues(parsed.error)}`);
      }
      return parsed.data;
    }
    return LiteReleaseLockSchema.parse(data);
  }
  const parsed = AnyReleaseLockWithPlaySchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Unrecognized release lock: ${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
}

export function createReleaseLockV4(
  benchmarkVersion: string,
  buildTasks: LoadedTask[],
  playTasks: LoadedPlayTask[],
): ReleaseLockV4 {
  // Project the build suite exactly from the v0.6 Lite instrument so its seed,
  // weighting, invocation count and four-task Build set are never re-derived.
  const lite = createLiteReleaseLock(benchmarkVersion, buildTasks);
  const play = playTasks
    .map((task) => ({
      id: task.manifest.id,
      version: task.manifest.version,
      game: task.manifest.game,
      hash: task.hash,
      episodes: task.manifest.episodes,
      max_decisions: task.manifest.max_decisions,
      primary_metric: task.manifest.primary_metric,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return ReleaseLockV4Schema.parse({
    schema_version: 4,
    benchmark: "carrick-ai-gamebench",
    benchmark_version: benchmarkVersion,
    protocols: {
      task_manifest: 1,
      play_task_manifest: 1,
      bridge: 1,
      runner_protocol: 4,
    },
    suites: {
      build: {
        evaluation_seed: lite.evaluation_seed,
        agent_invocations_per_task: lite.agent_invocations_per_task,
        scoring: {
          primary_board: lite.scoring.primary_board,
          task_weighting: lite.scoring.task_weighting,
        },
        tasks: lite.tasks.map((task) => ({
          id: task.id,
          version: task.version,
          hash: task.hash,
        })),
      },
      play: {
        config: {
          protocol: "play-visual-v1", observation: "screenshot-png", action_space: "native-keyboard-mouse",
          viewport: [1280, 720], device_scale_factor: 1, history_length: 8,
          transport_retries: 1, seed_policy: "committed-distinct-uint32-per-game",
          episodes: PLAY_DEFAULT_EPISODES,
          slot_seconds: PLAY_SLOT_SECONDS,
          memo_max_bytes: PLAY_MEMO_MAX_BYTES,
          invalid_response_stop: PLAY_INVALID_RESPONSE_STOP,
        },
        task_count: play.length,
        tasks: play,
      },
    },
  });
}
