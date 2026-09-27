export type RankingTier = "official" | "experimental";

export function rankingTierOrder(officialResultCount: number): RankingTier[] {
  return officialResultCount > 0
    ? ["official", "experimental"]
    : ["experimental", "official"];
}

export interface VersionedRelease {
  benchmark_version: string;
}

export interface VersionedResult {
  entry: {
    benchmark_version: string;
    status: "active" | "superseded" | "withdrawn";
  };
}

export function latestResultBearingVersion(
  releases: VersionedRelease[],
  records: VersionedResult[],
): string | undefined {
  const activeVersions = new Set(
    records
      .filter(({ entry }) => entry.status === "active")
      .map(({ entry }) => entry.benchmark_version),
  );
  return releases.find((release) => activeVersions.has(release.benchmark_version))
    ?.benchmark_version;
}

export function rankingMetricForVersion(
  aggregate: {
    primary_board: "core" | "build" | "reproduce";
    leaderboards: {
      build?: number | undefined;
      reproduce?: number | undefined;
      core?: number | undefined;
    };
  },
): number | undefined {
  return aggregate.primary_board === "build"
    ? aggregate.leaderboards.build
    : aggregate.primary_board === "reproduce"
      ? aggregate.leaderboards.reproduce
      : aggregate.leaderboards.core;
}

type RankingEntry =
  | { build: { score?: number | undefined } }
  | { aggregate: Parameters<typeof rankingMetricForVersion>[0] };

/** Flat Build observations expose their native summary, not a legacy aggregate. */
export function rankingMetricForEntry(entry: RankingEntry): number | undefined {
  return "build" in entry ? entry.build.score : rankingMetricForVersion(entry.aggregate);
}

export function rankingBoardForEntry(entry: RankingEntry): "build" | "reproduce" | "core" {
  return "build" in entry ? "build" : entry.aggregate.primary_board;
}

/** Select every public observation for a version, not just Experimental rows. */
export function publicOverviewRecords<T extends VersionedResult & {
  entry: { tier: RankingTier } & RankingEntry;
}>(records: T[], version: string | undefined): T[] {
  const metric = (record: T): number => {
    const value = rankingMetricForEntry(record.entry);
    return value !== undefined && Number.isFinite(value) ? value : -1;
  };
  return records.filter(({ entry }) => entry.status === "active" && entry.benchmark_version === version)
    .sort((left, right) =>
      Number(right.entry.tier === "official") - Number(left.entry.tier === "official") ||
      metric(right) - metric(left),
    );
}

/**
 * Competition ("1,2,2,4") ranking for a set of metrics. Returns one rank per
 * input metric, in the same order as `metrics`; a `number | undefined` where
 * `undefined` means "no rank".
 *
 * Ties (equal numeric scores) share a rank and the next distinct score skips
 * the tied count. A missing value (`undefined`) or a non-finite value
 * (`NaN`/`Infinity`) produces `undefined` ("no rank") — it is an observation
 * that does not receive a position, so it is never tied with a scored entry
 * (including a real `0`). A real `0` is a normal, valid score and is ranked.
 *
 * Order-independent: a scored metric's rank is `1 + (# of finite scored
 * metrics strictly greater than it)`.
 */
export function assignCompetitionRanks(
  metrics: Array<number | undefined>,
): Array<number | undefined> {
  const scored = metrics.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  return metrics.map((value) =>
    typeof value === "number" && Number.isFinite(value)
      ? scored.filter((candidate) => candidate > value).length + 1
      : undefined,
  );
}
