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
