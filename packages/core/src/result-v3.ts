import { z } from "zod";
import {
  AgentIdentityV2Schema,
  HashRefSchema,
  LanguageSchema,
  SemverSchema,
  UlidSchema,
} from "./schema.js";
import {
  PLAY_DEFAULT_EPISODES,
  PlayGameMetricsSchema,
  PlayGameSchema,
  PlayEpisodeSummarySchema,
  PlayProtocolSchema,
  PlayTaskIdSchema,
  playTaskGameSegment,
  type PlayGame,
} from "./play-schema.js";
import {
  aggregatePlayEpisodes,
  assertPlayMetrics,
} from "./play-metrics.js";
import {
  LiteSeriesResultSchema,
  LiteTaskResultSchema,
  type LiteSeriesResult,
} from "./lite.js";

/**
 * Flat series result v3 is a discriminated `suite: build | play` union. Each
 * series belongs to exactly one suite. The Build variant is a faithful
 * projection of the v0.6 Lite result (full per-task provenance, evaluation seed
 * and status, artifact manifest hash, one equal-weight score at complete
 * coverage) with only schema_version, suite and the Campaign v2 binding
 * changed. The Play variant never carries a synthetic `play.score`.
 */

const SeriesCampaignBindingSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  cell_id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  plan_hash: HashRefSchema,
  execution_hash: HashRefSchema,
  suite: z.enum(["build", "play"]),
});
export type SeriesCampaignBinding = z.infer<typeof SeriesCampaignBindingSchema>;

const ScopeSchema = z.strictObject({
  agent: AgentIdentityV2Schema,
  prompt_language: LanguageSchema,
});

const EnvelopeFields = {
  benchmark_version: SemverSchema,
  release_hash: HashRefSchema,
  series_id: UlidSchema,
  git_commit: z.union([
    z.string().regex(/^[a-f0-9]{40}$/),
    z.literal("unknown"),
  ]),
  source_tree_clean: z.boolean(),
  profile: z.enum(["official", "local"]),
  configuration: ScopeSchema,
  campaign: SeriesCampaignBindingSchema.optional(),
  started_at: z.iso.datetime(),
  finished_at: z.iso.datetime(),
};

export type SeriesCampaignBindingValue = SeriesCampaignBinding;

/**
 * The v3 Build series result preserves the entire v0.6 Lite result semantics:
 * full `LiteTaskResult` provenance (agent invocation, wall time, exit reason,
 * evaluation seed/status, artifact manifest hash) and the equal-weight Build
 * summary at complete coverage. Only schema_version, suite and the Campaign v2
 * binding (which now records its suite) differ from the Lite v2 record.
 */
export const FlatSeriesResultBuildV3Schema = z
  .strictObject({
    schema_version: z.literal(3),
    suite: z.literal("build"),
    benchmark: z.literal("carrick-ai-gamebench"),
    ...EnvelopeFields,
    tasks: z.array(LiteTaskResultSchema).length(4),
    build: z.strictObject({
      completed: z.number().int().min(0).max(4),
      required: z.literal(4),
      score: z.number().min(0).max(100).optional(),
    }),
  })
  .superRefine((result, context) => {
    const ids = new Set<string>();
    for (const [index, task] of result.tasks.entries()) {
      if (ids.has(task.task_id)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "task_id"],
          message: `duplicate build task result: ${task.task_id}`,
        });
      }
      ids.add(task.task_id);
    }
    const scored = result.tasks.filter(
      (task) => task.evaluation.status === "scored",
    );
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
      const expected =
        Math.round(
          (scored.reduce(
            (sum, task) => sum + (task.evaluation.score?.percent ?? 0),
            0,
          ) /
            scored.length) *
            10_000,
        ) / 10_000;
      if (result.build.score !== expected) {
        context.addIssue({
          code: "custom",
          path: ["build", "score"],
          message: `complete build result must report the equal-weight score ${expected}`,
        });
      }
    } else if (result.build.score !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["build", "score"],
        message: "incomplete build result may not report a score",
      });
    }
    if (result.campaign && result.campaign.suite !== "build") {
      context.addIssue({
        code: "custom",
        path: ["campaign", "suite"],
        message: "a build series result must bind a build campaign",
      });
    }
  });
export type FlatSeriesResultBuildV3 = z.infer<typeof FlatSeriesResultBuildV3Schema>;

/** Lossless projection of a v0.6 Lite result into the v3 Build variant. */
export function flatBuildV3FromLite(
  lite: LiteSeriesResult,
): FlatSeriesResultBuildV3 {
  return {
    schema_version: 3,
    suite: "build",
    benchmark: lite.benchmark,
    benchmark_version: lite.benchmark_version,
    release_hash: lite.release_hash,
    series_id: lite.series_id,
    git_commit: lite.git_commit,
    source_tree_clean: lite.source_tree_clean,
    profile: lite.profile,
    configuration: lite.configuration,
    started_at: lite.started_at,
    finished_at: lite.finished_at,
    tasks: lite.tasks,
    build: { ...lite.build },
    ...(lite.campaign
      ? {
          campaign: {
            id: lite.campaign.id,
            cell_id: lite.campaign.cell_id,
            plan_hash: lite.campaign.plan_hash,
            execution_hash: lite.campaign.execution_hash,
            suite: "build" as const,
          },
        }
      : {}),
  };
}

/** Inverse projection of a v3 Build variant back to the v0.6 Lite result. */
export function flatBuildV3ToLite(
  result: FlatSeriesResultBuildV3,
): LiteSeriesResult {
  return {
    schema_version: 2,
    benchmark: result.benchmark,
    benchmark_version: result.benchmark_version,
    release_hash: result.release_hash,
    series_id: result.series_id,
    git_commit: result.git_commit,
    source_tree_clean: result.source_tree_clean,
    profile: result.profile,
    configuration: result.configuration,
    started_at: result.started_at,
    finished_at: result.finished_at,
    tasks: result.tasks,
    build: { ...result.build },
    ...(result.campaign
      ? {
          campaign: {
            id: result.campaign.id,
            cell_id: result.campaign.cell_id,
            plan_hash: result.campaign.plan_hash,
            execution_hash: result.campaign.execution_hash,
          },
        }
      : {}),
  };
}

export const PlaySeriesTaskResultSchema = z
  .strictObject({
    task_id: PlayTaskIdSchema,
    task_version: SemverSchema,
    game: PlayGameSchema,
    game_hash: HashRefSchema,
    artifact_manifest_hash: HashRefSchema,
    protocol: PlayProtocolSchema,
    trajectory_hash: HashRefSchema,
    episodes: z.array(PlayEpisodeSummarySchema).max(PLAY_DEFAULT_EPISODES),
    coverage: z.strictObject({
      completed: z.number().int().min(0).max(PLAY_DEFAULT_EPISODES),
      required: z.literal(PLAY_DEFAULT_EPISODES),
    }),
    metrics: PlayGameMetricsSchema.optional(),
  })
  .superRefine((task, context) => {
    if (playTaskGameSegment(task.task_id) !== task.game) {
      context.addIssue({
        code: "custom",
        path: ["task_id"],
        message: `play task id ${task.task_id} does not match game ${task.game}`,
      });
    }
    if (task.coverage.required !== PLAY_DEFAULT_EPISODES) {
      context.addIssue({
        code: "custom",
        path: ["coverage", "required"],
        message: `${task.game} requires ${PLAY_DEFAULT_EPISODES} episodes`,
      });
    }
    if (task.coverage.completed !== task.episodes.filter((episode) => episode.status === "complete").length) {
      context.addIssue({
        code: "custom",
        path: ["coverage", "completed"],
        message: "completed must equal the number of scored complete episodes",
      });
    }
    const indices = new Set<number>();
    const seeds = new Set<number>();
    for (const [index, episode] of task.episodes.entries()) {
      if (episode.episode_index !== index) context.addIssue({ code: "custom", path: ["episodes", index, "episode_index"], message: "episodes must follow the preregistered sequential order" });
      if (indices.has(episode.episode_index)) {
        context.addIssue({
          code: "custom",
          path: ["episodes", index, "episode_index"],
          message: `duplicate episode_index: ${episode.episode_index}`,
        });
      }
      indices.add(episode.episode_index);
      if (seeds.has(episode.seed)) {
        context.addIssue({
          code: "custom",
          path: ["episodes", index, "seed"],
          message: `duplicate seed: ${episode.seed}`,
        });
      }
      seeds.add(episode.seed);
    }

    const aggregate = aggregatePlayEpisodes(task.game, task.episodes);
    if (task.metrics) {
      if (!aggregate.complete || !aggregate.metrics) {
        context.addIssue({
          code: "custom",
          path: ["metrics"],
          message: "a non-complete play series may not report metrics",
        });
      } else {
        try {
          assertPlayMetrics(task.game, task.episodes, task.metrics);
        } catch (error) {
          context.addIssue({
            code: "custom",
            path: ["metrics"],
            message:
              error instanceof Error ? error.message : String(error),
          });
        }
      }
    } else if (aggregate.complete) {
      context.addIssue({
        code: "custom",
        path: ["metrics"],
        message: "a complete play series requires metrics",
      });
    }
  });
export type PlaySeriesTaskResult = z.infer<typeof PlaySeriesTaskResultSchema>;

export const FlatSeriesResultPlayV3Schema = z
  .strictObject({
    schema_version: z.literal(3),
    suite: z.literal("play"),
    ...EnvelopeFields,
    games: z.array(PlaySeriesTaskResultSchema).max(2),
  })
  .superRefine((result, context) => {
    const ids = new Set<string>();
    const games = new Set<PlayGame>();
    for (const [index, game] of result.games.entries()) {
      if (ids.has(game.task_id)) {
        context.addIssue({
          code: "custom",
          path: ["games", index, "task_id"],
          message: `duplicate play game result: ${game.task_id}`,
        });
      }
      ids.add(game.task_id);
      if (games.has(game.game)) {
        context.addIssue({
          code: "custom",
          path: ["games", index, "game"],
          message: `duplicate play game: ${game.game}`,
        });
      }
      games.add(game.game);
    }
    if (result.campaign && result.campaign.suite !== "play") {
      context.addIssue({
        code: "custom",
        path: ["campaign", "suite"],
        message: "a play series result must bind a play campaign",
      });
    }
  });
export type FlatSeriesResultPlayV3 = z.infer<typeof FlatSeriesResultPlayV3Schema>;

export const FlatSeriesResultV3Schema = z.discriminatedUnion("suite", [
  FlatSeriesResultBuildV3Schema,
  FlatSeriesResultPlayV3Schema,
]);
export type FlatSeriesResultV3 = z.infer<typeof FlatSeriesResultV3Schema>;

/** Dispatch by the literal record version, then by suite for v3. */
export type AnyFlatSeriesResult =
  | z.infer<typeof LiteSeriesResultSchema>
  | FlatSeriesResultV3;

export const AnyFlatSeriesResultSchema = z.union([
  LiteSeriesResultSchema,
  FlatSeriesResultV3Schema,
]);

/** Reader that dispatches on the exact schema_version, never the installed lock. */
export function readFlatSeriesResult(data: unknown): AnyFlatSeriesResult {
  if (typeof data !== "object" || data === null) {
    throw new Error("flat series result must be an object");
  }
  const record = data as Record<string, unknown>;
  if (record.schema_version === 2) {
    return LiteSeriesResultSchema.parse(data);
  }
  if (record.schema_version === 3) {
    return FlatSeriesResultV3Schema.parse(data);
  }
  throw new Error(
    `Unrecognized flat series result schema_version: ${String(record.schema_version)}`,
  );
}
