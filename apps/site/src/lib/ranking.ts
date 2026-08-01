export type RankingTier = "official" | "experimental";

export function rankingTierOrder(officialResultCount: number): RankingTier[] {
  return officialResultCount > 0
    ? ["official", "experimental"]
    : ["experimental", "official"];
}
