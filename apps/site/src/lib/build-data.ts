import {
  readFlatSeriesResult,
  sha256Canonical,
  type FlatSeriesResultBuildV3,
  type JsonValue,
  type LiteSeriesResult,
} from "@carrick/gamebench-core";
import type { QualifiedFlatSeries } from "./flat-data.ts";

export type FlatBuildResult = LiteSeriesResult | FlatSeriesResultBuildV3;

/** Display metadata only. The original flat observation remains the evidence;
 * no legacy publication, submission, run, or cross-track aggregate is invented.
 * publication_id retains the existing result URL's canonical content identity.
 */
export interface FlatBuildEntry {
  publication_id: string;
  configuration_id: string;
  created_at: string;
  benchmark_version: string;
  series_id: string;
  board: "build";
  status: "active";
  tier: "official" | "experimental";
  agent: FlatBuildResult["configuration"]["agent"];
  build: FlatBuildResult["build"];
  campaign?: { id: string; cell_id: string };
  rankable?: boolean;
  qualification_reasons?: string[];
}

export interface FlatBuildRecord {
  entry: FlatBuildEntry;
  result: FlatBuildResult;
}

function hash(value: unknown): string {
  return sha256Canonical(JSON.parse(JSON.stringify(value)) as JsonValue);
}

/** V2 keeps its historical qualification and identity. V3 requires the shared
 * ledger qualification, not the result's self-declared Official profile.
 */
export function projectFlatBuildResult(
  input: unknown,
  qualified?: QualifiedFlatSeries,
): FlatBuildRecord | undefined {
  const result = readFlatSeriesResult(input);
  if (result.schema_version === 3 && result.suite === "play") return undefined;
  if (result.schema_version === 2) {
    if (result.profile !== "official" || !result.source_tree_clean || result.git_commit === "unknown" ||
      result.build.completed !== 4 || result.build.required !== 4 || result.build.score === undefined) {
      throw new Error(`non-Official lightweight result: ${result.series_id}`);
    }
  } else if (!qualified || hash(qualified.result) !== hash(result)) {
    throw new Error(`Build V3 requires its shared qualification: ${result.series_id}`);
  }
  // Never apply new qualification semantics retroactively to historical V2.
  const current = result.schema_version === 3 ? qualified : undefined;
  return {
    result,
    entry: {
      publication_id: hash(result),
      configuration_id: hash(result.configuration),
      created_at: result.finished_at,
      benchmark_version: result.benchmark_version,
      series_id: result.series_id,
      board: "build",
      status: "active",
      tier: current?.qualification.tier ?? "official",
      agent: result.configuration.agent,
      build: result.build,
      ...(result.campaign ? { campaign: { id: result.campaign.id, cell_id: result.campaign.cell_id } } : {}),
      ...(current ? {
        rankable: current.rankable,
        qualification_reasons: [
          ...current.qualification.reasons,
          ...(!current.campaign_complete ? ["incomplete campaign publication"] : []),
        ],
      } : {}),
    },
  };
}
