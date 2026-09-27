import { z } from "zod";
import {
  HashRefSchema,
  SemverSchema,
  type JsonValue,
} from "./schema.js";
import {
  CampaignCellSchema,
  CampaignSlugSchema,
  CampaignVaryKeySchema,
  type CampaignCell,
  type CampaignVaryKey,
} from "./campaign.js";
import { canonicalJson, sha256Canonical } from "./identity.js";
import {
  PLAY_DEFAULT_EPISODES,
  PlaySeedCommitmentSchema,
  type PlaySeedCommitment,
} from "./play-schema.js";

/**
 * Campaign v2 is single-suite. A Build campaign keeps the preregistered
 * primary endpoint `build.score`; a Play campaign preregisters both native
 * endpoints (`play.2048.mean_score`, `play.minesweeper.win_rate`). Execution
 * bindings carry the suite/protocol, and a Play campaign commits a private
 * seed bundle. v1 plan hashes and validators are never rewritten.
 */

export const CampaignSuiteV2Schema = z.enum(["build", "play"]);
export type CampaignSuiteV2 = z.infer<typeof CampaignSuiteV2Schema>;

export const CampaignExecutionProtocolSchema = z.enum([
  "build-campaign-v1",
  "play-visual-v1",
]);
export type CampaignExecutionProtocol = z.infer<typeof CampaignExecutionProtocolSchema>;

/** The one allowed endpoint set per suite, in preregistered order. */
export const CAMPAIGN_SUITE_ENDPOINTS: Record<CampaignSuiteV2, readonly string[]> = {
  build: ["build.score"],
  play: ["play.2048.mean_score", "play.minesweeper.win_rate"],
};

const CAMPAIGN_SUITE_PROTOCOL: Record<
  CampaignSuiteV2,
  CampaignExecutionProtocol
> = {
  build: "build-campaign-v1",
  play: "play-visual-v1",
};

export const CampaignComparisonV2Schema = z.strictObject({
  unit: z.literal("system"),
  primary_endpoints: z.array(z.string().min(1)).min(1),
  comparability: z.literal("within-release-only"),
  vary: z.array(CampaignVaryKeySchema),
  order_policy: z.literal("preregistered"),
});
export type CampaignComparisonV2 = z.infer<typeof CampaignComparisonV2Schema>;

const CAMPAIGN_VARY_KEYS: readonly CampaignVaryKey[] = [
  "agent",
  "adapter",
  "provider",
  "model",
  "parameters",
  "prompt_language",
];

const CAMPAIGN_EXECUTION_PROPERTIES: readonly (CampaignVaryKey | "isolation")[] = [
  ...CAMPAIGN_VARY_KEYS,
  "isolation",
];

function cellExecutionValueV2(
  cell: CampaignCell,
  property: CampaignVaryKey | "isolation",
): JsonValue {
  switch (property) {
    case "agent":
      return { id: cell.agent.id, version: cell.agent.version };
    case "adapter":
      return { path: cell.adapter.path, hash: cell.adapter.hash };
    case "provider":
      return cell.provider;
    case "model":
      return cell.model;
    case "parameters":
      return cell.parameters;
    case "prompt_language":
      return cell.prompt_language;
    case "isolation":
      return {
        session: cell.isolation.session,
        context_files: cell.isolation.context_files,
        extensions: cell.isolation.extensions,
        skills: cell.isolation.skills,
      };
  }
}

export const CampaignPlanV2Schema = z
  .strictObject({
    schema_version: z.literal(2),
    campaign_id: CampaignSlugSchema,
    benchmark_version: SemverSchema,
    release_hash: HashRefSchema,
    suite: CampaignSuiteV2Schema,
    protocol: CampaignExecutionProtocolSchema,
    comparison: CampaignComparisonV2Schema,
    cells: z.array(CampaignCellSchema).min(1),
    seed_commitment: PlaySeedCommitmentSchema.optional(),
  })
  .superRefine((plan, context) => {
    const expectedEndpoints = CAMPAIGN_SUITE_ENDPOINTS[plan.suite];
    if (
      plan.comparison.primary_endpoints.length !== expectedEndpoints.length ||
      plan.comparison.primary_endpoints.some(
        (endpoint, index) => endpoint !== expectedEndpoints[index],
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["comparison", "primary_endpoints"],
        message: `${plan.suite} campaign requires primary_endpoints [${expectedEndpoints.join(", ")}]`,
      });
    }

    if (plan.protocol !== CAMPAIGN_SUITE_PROTOCOL[plan.suite]) {
      context.addIssue({
        code: "custom",
        path: ["protocol"],
        message: `${plan.suite} campaign requires protocol ${CAMPAIGN_SUITE_PROTOCOL[plan.suite]}`,
      });
    }

    if (plan.suite === "build" && plan.seed_commitment !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["seed_commitment"],
        message: "a build campaign may not commit a play seed bundle",
      });
    }
    if (plan.suite === "play") {
      if (!plan.seed_commitment) {
        context.addIssue({
          code: "custom",
          path: ["seed_commitment"],
          message: "a play campaign must commit a seed bundle",
        });
      } else {
        const committed = new Set(
          plan.seed_commitment.tasks.map((task) => task.task_id),
        );
        if (plan.seed_commitment.tasks.some((task) => task.episodes !== PLAY_DEFAULT_EPISODES)) {
          context.addIssue({
            code: "custom",
            path: ["seed_commitment", "tasks"],
            message: `play campaigns require ${PLAY_DEFAULT_EPISODES} episodes per committed task`,
          });
        }
        if (committed.size !== plan.seed_commitment.tasks.length) {
          context.addIssue({
            code: "custom",
            path: ["seed_commitment", "tasks"],
            message: "committed seed bundle tasks must be unique",
          });
        }
      }
    }

    const isMeasurement = plan.comparison.vary.length === 0;
    if (isMeasurement && plan.cells.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["cells"],
        message: "an empty vary set is valid only for exactly one measurement cell",
      });
    }
    if (!isMeasurement && plan.cells.length < 2) {
      context.addIssue({
        code: "custom",
        path: ["cells"],
        message: "a comparison Campaign requires at least two cells",
      });
    }
    if (new Set(plan.comparison.vary).size !== plan.comparison.vary.length) {
      context.addIssue({
        code: "custom",
        path: ["comparison", "vary"],
        message: "vary properties must be unique",
      });
    }

    const cellIds = new Set<string>();
    const seriesIds = new Set<string>();
    for (const [index, cell] of plan.cells.entries()) {
      if (cellIds.has(cell.cell_id)) {
        context.addIssue({
          code: "custom",
          path: ["cells", index, "cell_id"],
          message: `duplicate cell_id: ${cell.cell_id}`,
        });
      }
      cellIds.add(cell.cell_id);
      if (seriesIds.has(cell.series_id)) {
        context.addIssue({
          code: "custom",
          path: ["cells", index, "series_id"],
          message: `duplicate series_id: ${cell.series_id}`,
        });
      }
      seriesIds.add(cell.series_id);
    }

    const vary = new Set<string>(plan.comparison.vary);
    for (const property of CAMPAIGN_EXECUTION_PROPERTIES) {
      const distinct = new Set(
        plan.cells.map((cell) => canonicalJson(cellExecutionValueV2(cell, property))),
      );
      if (vary.has(property)) {
        if (distinct.size < 2) {
          context.addIssue({
            code: "custom",
            path: ["comparison", "vary"],
            message: `declared vary property ${property} must differ across at least two cells`,
          });
        }
      } else if (distinct.size > 1) {
        context.addIssue({
          code: "custom",
          path: ["comparison"],
          message: `non-varied cell property ${property} differs across cells`,
        });
      }
    }
  });

export type CampaignPlanV2 = z.infer<typeof CampaignPlanV2Schema>;

/** Represent a v2 plan as an order-independent JSON value for canonical hashing. */
function campaignV2Projection(plan: CampaignPlanV2): JsonValue {
  return JSON.parse(JSON.stringify(plan)) as JsonValue;
}

/**
 * Canonical v2 campaign plan hash. Kept distinct from the v1 plan hash so the
 * v1 hashes and their validators are never rewritten.
 */
export function campaignPlanV2Hash(plan: CampaignPlanV2): `sha256:${string}` {
  return sha256Canonical(campaignV2Projection(plan));
}

export interface CampaignCellExecutionSpecV2 {
  suite: CampaignSuiteV2;
  protocol: CampaignExecutionProtocol;
  agent: { id: string; version: string };
  adapter: { path: string; hash: string };
  provider: string;
  model: string;
  parameters: Record<string, JsonValue>;
  prompt_language: "en" | "zh";
  isolation: {
    session: boolean;
    context_files: boolean;
    extensions: boolean;
    skills: boolean;
  };
}

/** Secret-free per-cell execution spec for v2, including suite/protocol. */
export function campaignCellExecutionSpecV2(
  cell: CampaignCell,
  suite: CampaignSuiteV2,
  protocol: CampaignExecutionProtocol,
): CampaignCellExecutionSpecV2 {
  return {
    suite,
    protocol,
    agent: { id: cell.agent.id, version: cell.agent.version },
    adapter: { path: cell.adapter.path, hash: cell.adapter.hash },
    provider: cell.provider,
    model: cell.model,
    parameters: cell.parameters,
    prompt_language: cell.prompt_language,
    isolation: {
      session: cell.isolation.session,
      context_files: cell.isolation.context_files,
      extensions: cell.isolation.extensions,
      skills: cell.isolation.skills,
    },
  };
}

export function campaignCellExecutionSpecV2Hash(
  cell: CampaignCell,
  suite: CampaignSuiteV2,
  protocol: CampaignExecutionProtocol,
): `sha256:${string}` {
  const spec = campaignCellExecutionSpecV2(cell, suite, protocol);
  return sha256Canonical(JSON.parse(JSON.stringify(spec)) as JsonValue);
}

export interface CampaignV2Release {
  benchmark_version: string;
  release_hash: `sha256:${string}`;
  suite: CampaignSuiteV2;
}

/** Assert that a v2 campaign targets exactly one release and suite. */
export function assertCampaignV2Release(
  plan: CampaignPlanV2,
  release: CampaignV2Release,
): void {
  if (plan.benchmark_version !== release.benchmark_version) {
    throw new Error(
      `campaign benchmark version ${plan.benchmark_version} does not match release ${release.benchmark_version}`,
    );
  }
  if (plan.release_hash !== release.release_hash) {
    throw new Error(
      `campaign release hash ${plan.release_hash} does not match release ${release.release_hash}`,
    );
  }
  if (plan.suite !== release.suite) {
    throw new Error(
      `campaign suite ${plan.suite} does not match release suite ${release.suite}`,
    );
  }
}

/** Campaign-level invariant, shared by execution, publication and static readers.
 * Empty membership is a preregistered, not-yet-measured campaign. Schema/hash
 * generations and per-row qualification remain the caller's responsibility.
 */
export function assertCampaignCommitConsistency(
  results: readonly { git_commit: string }[],
  expectedCommit?: string,
): void {
  const commit = expectedCommit ?? results[0]?.git_commit;
  if (commit === undefined) return;
  if (!/^[a-f0-9]{40}$/.test(commit) || results.some((result) => result.git_commit !== commit)) {
    throw new Error("campaign cells must use the same recorded Git commit");
  }
}

/** Convenience accessor for the committed seed bundle hash of a play campaign. */
export function campaignPlaySeedCommitment(
  plan: CampaignPlanV2,
): PlaySeedCommitment | undefined {
  return plan.suite === "play" ? plan.seed_commitment : undefined;
}
