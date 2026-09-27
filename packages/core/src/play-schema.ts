import { Buffer } from "node:buffer";
import { z } from "zod";
import { HashRefSchema, SemverSchema, TaskRelativePathSchema } from "./schema.js";

/**
 * Play is the dual-suite instrument that measures a visual player system
 * (model + player harness + configuration) against immutable maintainer-owned
 * games. These are additive schemas only: they do not alter or re-interpret
 * any existing Build record, validator, hash or view.
 *
 * The engine contract and native action payloads below are the authoritative
 * integration boundary from docs/build-play-implementation.md. The reference
 * game implementation (engine.mjs / renderer.mjs) is owned independently and
 * is not elaborated here; core only describes and validates the coordination
 * manifest, evidence and metrics surfaces that the runner consumes.
 */

export const PLAY_GAMES = ["2048", "minesweeper"] as const;
export type PlayGame = (typeof PLAY_GAMES)[number];
export const PlayGameSchema = z.enum(PLAY_GAMES);

export const PLAY_TASK_SUITE = "play" as const;

export const PLAY_DEFAULT_EPISODES = 10;
export const PLAY_SLOT_SECONDS = 60;
export const PLAY_MEMO_MAX_BYTES = 1024;
export const PLAY_INVALID_RESPONSE_STOP = 3;
export const PLAY_DEVICE_SCALE_FACTOR = 1;
export const PLAY_VIEWPORT = [1280, 720] as const;
export const PLAY_LICENSE = "Apache-2.0" as const;

/** The frozen visual player measurement protocol bound at task/series level. */
export const PLAY_VISUAL_PROTOCOL_V1 = "play-visual-v1" as const;
export const PlayProtocolSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export type PlayProtocol = z.infer<typeof PlayProtocolSchema>;

/** Engine command orientation is not part of the public scoring surface. */
export const PLAY_MAX_DECISIONS: Record<PlayGame, number> = {
  "2048": 200,
  minesweeper: 128,
};

/** The single primary metric per game (never a synthetic `play.score`). */
export const PLAY_PRIMARY_METRIC: Record<
  PlayGame,
  "mean_score" | "win_rate"
> = {
  "2048": "mean_score",
  minesweeper: "win_rate",
};

/** The preregistered primary endpoint per game for Campaign v2. */
export const PLAY_PRIMARY_ENDPOINTS: Record<PlayGame, string> = {
  "2048": "play.2048.mean_score",
  minesweeper: "play.minesweeper.win_rate",
};

/** An unsigned 32-bit seed is the only valid engine seed. */
export const PlaySeedSchema = z.number().int().min(0).max(0xffffffff);
export type PlaySeed = z.infer<typeof PlaySeedSchema>;

export const PlayTaskIdSchema = z
  .string()
  .regex(/^play\.[a-z0-9][a-z0-9.-]*\.v[1-9]\d*$/);
export type PlayTaskId = z.infer<typeof PlayTaskIdSchema>;

export const PlayPrimaryMetricSchema = z.enum(["mean_score", "win_rate"]);
export type PlayPrimaryMetric = z.infer<typeof PlayPrimaryMetricSchema>;

export function playTaskGameSegment(id: string): string | undefined {
  return /^play\.([a-z0-9][a-z0-9.-]*)\.v[1-9]\d*$/.exec(id)?.[1];
}

function playTaskVersionMajor(id: string): number | undefined {
  return Number(/\.v(\d+)$/.exec(id)?.[1]);
}

/**
 * The coordination manifest for one immutable Play game package. File paths
 * are all task-relative; validation also enforces the canonical names and the
 * per-game decision budget and primary metric from the approved instrument.
 */
export const PlayTaskManifestSchema = z
  .strictObject({
    schema_version: z.literal(1),
    id: PlayTaskIdSchema,
    version: SemverSchema,
    title: z.strictObject({
      en: z.string().min(1),
      zh: z.string().min(1),
    }),
    suite: z.literal(PLAY_TASK_SUITE),
    game: PlayGameSchema,
    engine: TaskRelativePathSchema,
    renderer: TaskRelativePathSchema,
    prompt: z.strictObject({
      en: TaskRelativePathSchema,
      zh: TaskRelativePathSchema,
    }),
    episodes: z.literal(PLAY_DEFAULT_EPISODES),
    max_decisions: z.number().int().positive(),
    viewport: z.tuple([z.literal(1280), z.literal(720)]),
    device_scale_factor: z.literal(PLAY_DEVICE_SCALE_FACTOR),
    primary_metric: PlayPrimaryMetricSchema,
    license: z.string().min(1),
  })
  .superRefine((manifest, context) => {
    const gameSegment = playTaskGameSegment(manifest.id);
    if (gameSegment !== manifest.game) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: `id game segment ${gameSegment ?? "(none)"} does not match game ${manifest.game}`,
      });
    }
    const idMajor = playTaskVersionMajor(manifest.id);
    const versionMajor = Number(manifest.version.split(".")[0]);
    if (idMajor !== versionMajor) {
      context.addIssue({
        code: "custom",
        path: ["version"],
        message: `task ID major v${idMajor} does not match manifest version ${manifest.version}`,
      });
    }
    if (manifest.max_decisions !== PLAY_MAX_DECISIONS[manifest.game]) {
      context.addIssue({
        code: "custom",
        path: ["max_decisions"],
        message: `${manifest.game} requires ${PLAY_MAX_DECISIONS[manifest.game]} maximum decisions`,
      });
    }
    if (manifest.primary_metric !== PLAY_PRIMARY_METRIC[manifest.game]) {
      context.addIssue({
        code: "custom",
        path: ["primary_metric"],
        message: `${manifest.game} requires ${PLAY_PRIMARY_METRIC[manifest.game]} as its primary metric`,
      });
    }
    if (manifest.engine !== "engine.mjs") {
      context.addIssue({
        code: "custom",
        path: ["engine"],
        message: "engine must be engine.mjs",
      });
    }
    if (manifest.renderer !== "renderer.mjs") {
      context.addIssue({
        code: "custom",
        path: ["renderer"],
        message: "renderer must be renderer.mjs",
      });
    }
    if (
      manifest.prompt.en !== "prompt.en.md" ||
      manifest.prompt.zh !== "prompt.zh.md"
    ) {
      context.addIssue({
        code: "custom",
        path: ["prompt"],
        message: "prompt must be prompt.en.md and prompt.zh.md",
      });
    }
    if (
      manifest.viewport[0] !== PLAY_VIEWPORT[0] ||
      manifest.viewport[1] !== PLAY_VIEWPORT[1]
    ) {
      context.addIssue({
        code: "custom",
        path: ["viewport"],
        message: "viewport must be [1280, 720]",
      });
    }
    if (manifest.device_scale_factor !== PLAY_DEVICE_SCALE_FACTOR) {
      context.addIssue({
        code: "custom",
        path: ["device_scale_factor"],
        message: "device_scale_factor must be 1",
      });
    }
    if (manifest.license !== PLAY_LICENSE) {
      context.addIssue({
        code: "custom",
        path: ["license"],
        message: "license must be Apache-2.0",
      });
    }
  });

export type PlayTaskManifest = z.infer<typeof PlayTaskManifestSchema>;

/** The engine's native command surface, not a model/player interface. */
export const PlayEngineCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("move"),
    direction: z.enum(["up", "down", "left", "right"]),
  }),
  z.strictObject({
    type: z.literal("reveal"),
    row: z.number().int().min(0).max(9),
    col: z.number().int().min(0).max(9),
  }),
  z.strictObject({
    type: z.literal("flag"),
    row: z.number().int().min(0).max(9),
    col: z.number().int().min(0).max(9),
  }),
]);
export type PlayEngineCommand = z.infer<typeof PlayEngineCommandSchema>;

/** One native action the player system is allowed to submit per decision. */
export const PlayNativeActionSchema = z
  .discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("key"),
      key: z.enum(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]),
    }),
    z.strictObject({
      type: z.literal("click"),
      button: z.enum(["left", "right"]),
      x: z.number().int(),
      y: z.number().int(),
    }),
  ])
  .superRefine((action, context) => {
    if (
      action.type === "click" &&
      (action.x < 0 || action.x >= PLAY_VIEWPORT[0])
    ) {
      context.addIssue({
        code: "custom",
        path: ["x"],
        message: `click x must be within the ${PLAY_VIEWPORT[0]}-wide viewport`,
      });
    }
    if (
      action.type === "click" &&
      (action.y < 0 || action.y >= PLAY_VIEWPORT[1])
    ) {
      context.addIssue({
        code: "custom",
        path: ["y"],
        message: `click y must be within the ${PLAY_VIEWPORT[1]}-tall viewport`,
      });
    }
  });
export type PlayNativeAction = z.infer<typeof PlayNativeActionSchema>;

/** Why an episode ended. The first four are valid complete terminations. */
export const PlayTerminationKindSchema = z.enum([
  "game-over",
  "decision-limit",
  "invalid-response-stop",
  "slot-timeout",
  "infrastructure-failure",
]);
export type PlayTerminationKind = z.infer<typeof PlayTerminationKindSchema>;

export const PlayTerminationSchema = z
  .strictObject({
    kind: PlayTerminationKindSchema,
    consecutive_invalid: z.number().int().min(1).optional(),
    reason: z.string().min(1).optional(),
  })
  .superRefine((termination, context) => {
    if (
      termination.kind === "invalid-response-stop" &&
      termination.consecutive_invalid === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["consecutive_invalid"],
        message: "invalid-response-stop requires consecutive_invalid",
      });
    }
    if (
      termination.kind === "infrastructure-failure" &&
      termination.reason === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "infrastructure-failure requires a reason",
      });
    }
  });
export type PlayTermination = z.infer<typeof PlayTerminationSchema>;

/** The private engine outcome; the only authoritative source of Play scoring. */
export const PlayOutcomeSchema = z
  .strictObject({
    terminal: z.boolean(),
    won: z.boolean(),
    score: z.number().nonnegative(),
    max_tile: z.number().int().nonnegative().optional(),
    effective_moves: z.number().int().nonnegative().optional(),
    revealed_safe: z.number().int().nonnegative().optional(),
    safe_cells: z.number().int().nonnegative().optional(),
  })
  .superRefine((outcome, context) => {
    if (outcome.won && !outcome.terminal) {
      context.addIssue({
        code: "custom",
        path: ["won"],
        message: "a won outcome requires terminal",
      });
    }
    if (
      outcome.safe_cells !== undefined &&
      outcome.revealed_safe === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["revealed_safe"],
        message: "safe_cells requires revealed_safe",
      });
    }
    if (
      outcome.revealed_safe !== undefined &&
      outcome.safe_cells !== undefined &&
      outcome.revealed_safe > outcome.safe_cells
    ) {
      context.addIssue({
        code: "custom",
        path: ["revealed_safe"],
        message: "revealed_safe may not exceed safe_cells",
      });
    }
  });
export type PlayOutcome = z.infer<typeof PlayOutcomeSchema>;

/** How a single decision slot resolved for the player system. */
export const PlayDecisionStatusSchema = z.enum([
  "action",
  "invalid",
  "timeout",
  "infrastructure-failure",
]);
export type PlayDecisionStatus = z.infer<typeof PlayDecisionStatusSchema>;

/**
 * One decision slot. A slot is either a valid `action` (with a recorded
 * native_action and at most one engine command, possibly none for a no-op) or
 * a non-action outcome (`invalid`, `timeout`, `infrastructure-failure`) which
 * never carries a native_action or engine command. We never fabricate a key or
 * command for a slot that did not emit one.
 */
export const PlayDecisionRecordSchema = z
  .strictObject({
    turn_id: z.string().min(1),
    /** The 0-based decision slot index; strictly increasing across an episode. */
    dispatch_index: z.number().int().nonnegative(),
    status: PlayDecisionStatusSchema,
    /** Present only for a valid `action` slot; never fabricated otherwise. */
    native_action: PlayNativeActionSchema.optional(),
    /** At most one engine command per slot; empty for a no-op or non-action. */
    engine_commands: z.array(PlayEngineCommandSchema).max(1),
    /** Hash of the input PNG observation presented to the player. */
    frame_hash: HashRefSchema,
    /** Hash of the private engine state after the slot. */
    private_state_hash: HashRefSchema,
    /** Wall-clock milliseconds elapsed in this slot. */
    elapsed_ms: z.number().int().nonnegative(),
    /** Attempts for this slot (>=1); recorded transport retries are attempts-1. */
    attempts: z.number().int().min(1).max(2),
    memo: z.string().optional(),
  })
  .superRefine((record, context) => {
    if (record.status === "action") {
      if (!record.native_action) {
        context.addIssue({
          code: "custom",
          path: ["native_action"],
          message: "an action decision requires a native_action",
        });
      }
    } else {
      if (record.native_action !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["native_action"],
          message: "non-action decisions may not carry a native_action",
        });
      }
      if (record.engine_commands.length !== 0) {
        context.addIssue({
          code: "custom",
          path: ["engine_commands"],
          message: "non-action decisions require empty engine_commands",
        });
      }
    }
    if (
      record.memo !== undefined &&
      Buffer.byteLength(record.memo, "utf8") > PLAY_MEMO_MAX_BYTES
    ) {
      context.addIssue({
        code: "custom",
        path: ["memo"],
        message: `memo must be at most ${PLAY_MEMO_MAX_BYTES} UTF-8 bytes`,
      });
    }
  });
export type PlayDecisionRecord = z.infer<typeof PlayDecisionRecordSchema>;

/** Whether one episode contributes to the per-game metric. */
export const PlayEpisodeStatusSchema = z.enum([
  "complete",
  "infrastructure-failure",
  "partial",
]);
export type PlayEpisodeStatus = z.infer<typeof PlayEpisodeStatusSchema>;

function assertPlayEpisodeStatus(
  status: PlayEpisodeStatus,
  termination: PlayTermination | undefined,
  outcome: PlayOutcome | undefined,
  context: z.RefinementCtx,
): void {
  if (status === "complete") {
    if (!termination || !outcome) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "complete episodes require termination and a native outcome",
      });
    }
    if (termination?.kind === "infrastructure-failure") {
      context.addIssue({
        code: "custom",
        path: ["termination", "kind"],
        message: "a complete episode may not terminate as infrastructure-failure",
      });
    }
  } else if (status === "infrastructure-failure") {
    if (outcome !== undefined) context.addIssue({ code: "custom", path: ["outcome"], message: "infrastructure failures have no scored outcome" });
    if (termination?.kind !== "infrastructure-failure") {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message:
          "infrastructure-failure episodes require an infrastructure-failure termination",
      });
    }
  } else if (termination || outcome) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "partial episodes may not report termination or an outcome",
    });
  }
}

/** The per-episode identity and metric-facing summary vector. */
export const PlayEpisodeSummarySchema = z
  .strictObject({
    episode_index: z.number().int().min(0).max(PLAY_DEFAULT_EPISODES - 1),
    seed: PlaySeedSchema,
    status: PlayEpisodeStatusSchema,
    termination: PlayTerminationSchema.optional(),
    outcome: PlayOutcomeSchema.optional(),
    action_count: z.number().int().nonnegative(),
    trajectory_hash: HashRefSchema.optional(),
  })
  .superRefine((episode, context) => {
    assertPlayEpisodeStatus(episode.status, episode.termination, episode.outcome, context);
  });
export type PlayEpisodeSummary = z.infer<typeof PlayEpisodeSummarySchema>;

/** Full per-episode evidence sealed below tasks/<task-id>/episodes/. */
export const PlayEpisodeSchema = z
  .strictObject({
    ...PlayEpisodeSummarySchema.shape,
    /** Private engine state hash at episode start, for replay linkage. */
    initial_private_state_hash: HashRefSchema,
    /** Private engine state hash and final frame hash at episode end. */
    final_private_state_hash: HashRefSchema,
    final_frame_hash: HashRefSchema,
    decisions: z.array(PlayDecisionRecordSchema),
    started_at: z.iso.datetime(),
    finished_at: z.iso.datetime().optional(),
    evidence_manifest_hash: HashRefSchema.optional(),
  })
  .superRefine((episode, context) => {
    // Re-run every summary invariant on the full episode.
    assertPlayEpisodeStatus(episode.status, episode.termination, episode.outcome, context);
    for (const [index, decision] of episode.decisions.entries()) {
      if (decision.dispatch_index !== index) {
        context.addIssue({
          code: "custom",
          path: ["decisions", index, "dispatch_index"],
          message: `decisions must be sequential by dispatch_index; expected ${index}`,
        });
      }
    }
    if (episode.action_count !== episode.decisions.length) {
      context.addIssue({
        code: "custom",
        path: ["action_count"],
        message: "action_count must equal the number of decision records",
      });
    }
    if (
      (episode.status === "complete" ||
        episode.status === "infrastructure-failure") &&
      !episode.finished_at
    ) {
      context.addIssue({
        code: "custom",
        path: ["finished_at"],
        message: "terminal episodes require a finished_at timestamp",
      });
    }
    if (episode.status === "partial" && episode.finished_at) {
      context.addIssue({
        code: "custom",
        path: ["finished_at"],
        message: "partial episodes may not report finished_at",
      });
    }
  });
export type PlayEpisode = z.infer<typeof PlayEpisodeSchema>;

/** Secondary 2048 metrics: every raw score, sample SD, max tile, effective moves. */
export const PlayMeanScoreMetricsSchema = z.strictObject({
  primary_metric: z.literal("mean_score"),
  mean_score: z.number().nonnegative(),
  episode_scores: z.array(z.number().nonnegative()),
  score_standard_deviation: z.number().nonnegative(),
  max_tile: z.number().int().nonnegative(),
  effective_moves: z.number().nonnegative(),
});
export type PlayMeanScoreMetrics = z.infer<typeof PlayMeanScoreMetricsSchema>;

/** Secondary Minesweeper metrics: every win/loss, safe-cell coverage, actions. */
export const PlayWinRateMetricsSchema = z.strictObject({
  primary_metric: z.literal("win_rate"),
  win_rate: z.number().min(0).max(100),
  episode_wins: z.array(z.boolean()),
  safe_cell_coverage: z.number().min(0).max(100),
  action_count: z.number().nonnegative(),
});
export type PlayWinRateMetrics = z.infer<typeof PlayWinRateMetricsSchema>;

export const PlayGameMetricsSchema = z.discriminatedUnion("primary_metric", [
  PlayMeanScoreMetricsSchema,
  PlayWinRateMetricsSchema,
]);
export type PlayGameMetrics = z.infer<typeof PlayGameMetricsSchema>;

/** A private seed bundle committed before any measured call. */
export const PlaySeedEntrySchema = z.strictObject({
  task_id: PlayTaskIdSchema,
  seeds: z.array(PlaySeedSchema).length(PLAY_DEFAULT_EPISODES),
});
export type PlaySeedEntry = z.infer<typeof PlaySeedEntrySchema>;

export const PlaySeedBundleSchema = z
  .strictObject({
    schema_version: z.literal(1),
    benchmark_version: SemverSchema,
    tasks: z.array(PlaySeedEntrySchema).min(1),
  })
  .superRefine((bundle, context) => {
    const ids = new Set<string>();
    for (const [taskIndex, task] of bundle.tasks.entries()) {
      if (ids.has(task.task_id)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", taskIndex, "task_id"],
          message: `duplicate task_id: ${task.task_id}`,
        });
      }
      ids.add(task.task_id);
      const seen = new Set<number>();
      for (const [seedIndex, seed] of task.seeds.entries()) {
        if (seen.has(seed)) {
          context.addIssue({
            code: "custom",
            path: ["tasks", taskIndex, "seeds", seedIndex],
            message: `duplicate seed ${seed} for ${task.task_id}`,
          });
        }
        seen.add(seed);
      }
    }
  });
export type PlaySeedBundle = z.infer<typeof PlaySeedBundleSchema>;

/** The opaque release-scoped reference a Campaign v2 commits for Play. */
export const PlaySeedCommitmentSchema = z.strictObject({
  schema_version: z.literal(1),
  benchmark_version: SemverSchema,
  seed_bundle_hash: HashRefSchema,
  tasks: z.array(
    z.strictObject({
      task_id: PlayTaskIdSchema,
      episodes: z.literal(PLAY_DEFAULT_EPISODES),
    }),
  ),
});
export type PlaySeedCommitment = z.infer<typeof PlaySeedCommitmentSchema>;
