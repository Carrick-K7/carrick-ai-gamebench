import { z } from "zod";
import {
  HashRefSchema,
  JsonValueSchema,
  LanguageSchema,
  SemverSchema,
  UlidSchema,
  type JsonValue,
} from "./schema.js";
import { canonicalJson, sha256Canonical } from "./identity.js";

/**
 * Campaign plan schema v1 (docs/campaign-architecture.md, section 4).
 *
 * A campaign preregisters one experiment: models, providers, the Agent
 * harness, parameters, execution order, and the primary endpoint are all
 * committed before an Official run. The plan carries a single release
 * (`benchmark_version` + `release_hash`) so a campaign can never mix releases,
 * and it is intentionally hashable as a whole. The canonical plan hash is NOT
 * stored inside the plan (see `campaignPlanHash`), avoiding a self-hash.
 */

/** Normalized lowercase NFC slug used for campaign and cell identifiers. */
export const CampaignSlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "must be a normalized lowercase NFC slug");

/** A repository-relative path that may not escape the tracked tree. */
export const RepositoryRelativePathSchema = z.string().min(1).superRefine(
  (value, context) => {
    const segments = value.split("/");
    if (
      value.startsWith("/") ||
      value.includes("\\") ||
      value.includes("\0") ||
      segments.some(
        (segment) => segment === "" || segment === "." || segment === "..",
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "must be a normalized relative path inside the repository",
      });
    }
  },
);

export const CampaignIsolationSchema = z.strictObject({
  session: z.literal(false).default(false),
  context_files: z.literal(false).default(false),
  extensions: z.literal(false).default(false),
  skills: z.literal(false).default(false),
});
export type CampaignIsolation = z.infer<typeof CampaignIsolationSchema>;

export const CampaignAgentSchema = z.strictObject({
  id: CampaignSlugSchema,
  version: SemverSchema,
});
export type CampaignAgent = z.infer<typeof CampaignAgentSchema>;

export const CampaignAdapterSchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  hash: HashRefSchema,
});
export type CampaignAdapter = z.infer<typeof CampaignAdapterSchema>;

export const CampaignCellSchema = z.strictObject({
  cell_id: CampaignSlugSchema,
  series_id: UlidSchema,
  agent: CampaignAgentSchema,
  adapter: CampaignAdapterSchema,
  provider: CampaignSlugSchema,
  model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
  parameters: z.record(z.string(), JsonValueSchema).default({}),
  prompt_language: LanguageSchema,
  isolation: CampaignIsolationSchema.default({
    session: false,
    context_files: false,
    extensions: false,
    skills: false,
  }),
}).superRefine((cell, context) => {
  for (const key of Object.keys(cell.parameters)) {
    if (/api[_-]?key|token|secret|password|authorization|credential|bearer|access[_-]?key|private[_-]?key/i.test(key)) {
      context.addIssue({
        code: "custom",
        path: ["parameters", key],
        message: "campaign parameters may not contain credential fields",
      });
    }
  }
  const text = JSON.stringify(cell.parameters);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}\b|\bAIza[0-9A-Za-z_-]{30,}\b|\bAKIA[0-9A-Z]{16}\b|\bxox[baprs]-[0-9A-Za-z-]{20,}\b|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(text)) {
    context.addIssue({
      code: "custom",
      path: ["parameters"],
      message: "campaign parameters contain credential-like material",
    });
  }
});
export type CampaignCell = z.infer<typeof CampaignCellSchema>;

/**
 * Execution properties that can be declared as the comparison's `vary` set.
 * `isolation` is intentionally omitted: the documented isolation is fully
 * disabled (all false) and a campaign must not confound it.
 */
const CAMPAIGN_VARY_KEYS = [
  "agent",
  "adapter",
  "provider",
  "model",
  "parameters",
  "prompt_language",
] as const;

/** Every secret-free cell execution property participating in confound checks. */
const CAMPAIGN_EXECUTION_PROPERTIES = [
  ...CAMPAIGN_VARY_KEYS,
  "isolation",
] as const;

export const CampaignVaryKeySchema = z.enum(CAMPAIGN_VARY_KEYS);
export type CampaignVaryKey = z.infer<typeof CampaignVaryKeySchema>;
export type CampaignExecutionProperty =
  (typeof CAMPAIGN_EXECUTION_PROPERTIES)[number];

export const CampaignComparisonSchema = z.strictObject({
  unit: z.literal("system"),
  primary_endpoint: z.literal("build.score"),
  comparability: z.literal("within-release-only"),
  // An empty vary set is reserved for a one-cell Official measurement. A
  // multi-cell Campaign remains a comparison and must declare what varies.
  vary: z.array(CampaignVaryKeySchema),
  order_policy: z.literal("preregistered"),
});
export type CampaignComparison = z.infer<typeof CampaignComparisonSchema>;

function cellExecutionValue(
  cell: CampaignCell,
  property: CampaignExecutionProperty,
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

export const CampaignPlanV1Schema = z
  .strictObject({
    schema_version: z.literal(1),
    campaign_id: CampaignSlugSchema,
    benchmark_version: SemverSchema,
    release_hash: HashRefSchema,
    comparison: CampaignComparisonSchema,
    cells: z.array(CampaignCellSchema).min(1),
  })
  .superRefine((plan, context) => {
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
        plan.cells.map((cell) => canonicalJson(cellExecutionValue(cell, property))),
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

export const CampaignPlanSchema = CampaignPlanV1Schema;
export type CampaignPlan = z.infer<typeof CampaignPlanSchema>;

/** Represent a plan as an order-independent JSON value for canonical hashing. */
function campaignPlanProjection(plan: CampaignPlan): JsonValue {
  return JSON.parse(JSON.stringify(plan)) as JsonValue;
}

/**
 * Canonical campaign plan hash (SHA-256 over canonical JSON). The hash is never
 * stored inside the plan, so it cannot be a self-hash.
 */
export function campaignPlanHash(plan: CampaignPlan): `sha256:${string}` {
  return sha256Canonical(campaignPlanProjection(plan));
}

/**
 * Secret-free canonical execution specification for one cell. This is the
 * attestation surface the runner hashes: agent identity/version, tracked
 * adapter path/hash, provider, model, parameters, prompt language, and the
 * isolation flags.
 */
export function campaignCellExecutionSpec(cell: CampaignCell): JsonValue {
  return {
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

/** Canonical per-cell execution-spec hash (SHA-256 over canonical JSON). */
export function campaignCellExecutionSpecHash(
  cell: CampaignCell,
): `sha256:${string}` {
  return sha256Canonical(campaignCellExecutionSpec(cell));
}

/**
 * Runner-facing alias for the canonical campaign plan hash. The trusted
 * runner records `hashCampaignPlan(plan)` in every cell result so a result's
 * plan binding can be re-derived from the committed plan.
 */
export const hashCampaignPlan = campaignPlanHash;

/**
 * Runner-facing alias for the per-cell execution-spec hash. Used to attest
 * that a result was produced by exactly one preregistered cell.
 */
export const hashCampaignCellExecution = campaignCellExecutionSpecHash;

export interface CampaignRelease {
  benchmark_version: string;
  release_hash: `sha256:${string}`;
}

/**
 * Assert that a campaign plan targets exactly one release. `release_hash` is
 * the instrument digest the runner computes; a campaign mixes releases when
 * either the benchmark version or the release hash no longer matches.
 */
export function assertCampaignRelease(
  plan: CampaignPlan,
  release: CampaignRelease,
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
}
