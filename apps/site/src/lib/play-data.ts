import {
  compareSemanticVersions,
  findRepositoryRoot,
  type FlatSeriesResultPlayV3,
  type PlaySeriesTaskResult,
  type SuiteQualification,
} from "@carrick/gamebench-core";
import {
  canonicalFlatResults,
  flatCampaignPlans,
  qualifyIndexedFlatResults,
  siteReleaseContexts,
  siteResultsRoot,
  type QualifiedFlatSeries,
  type SiteReleaseContext,
} from "./flat-data.ts";
import { assignCompetitionRanks, type RankingTier } from "./ranking.ts";

export type PlayGameId = "2048" | "minesweeper";
export const PLAY_GAMES: PlayGameId[] = ["2048", "minesweeper"];

export interface PlayReleaseTask {
  id: string;
  version: string;
  game: PlayGameId;
  hash: string;
  episodes: number;
  max_decisions: number;
  primary_metric: "mean_score" | "win_rate";
}

export interface PlayReleaseView {
  benchmark_version: string;
  release_hash: string;
  task_count: number;
  tasks: PlayReleaseTask[];
}

export interface QualifiedPlaySeries extends Omit<QualifiedFlatSeries, "result"> {
  result: FlatSeriesResultPlayV3;
}

/** One per-game observation. Qualification always comes from shared Core, not
 * the self-declared profile; the whole series AND campaign gate its rank.
 */
export interface PlayGameObservation {
  series_id: string;
  created_at: string;
  configuration: FlatSeriesResultPlayV3["configuration"];
  protocol: string;
  game_hash: string;
  trajectory_hash: string;
  artifact_manifest_hash: string;
  episode_count: number;
  required_episodes: number;
  metric: number | undefined;
  metrics: PlaySeriesTaskResult["metrics"];
  rankable: boolean;
  incomplete: boolean;
  campaign_complete: boolean;
  campaign: FlatSeriesResultPlayV3["campaign"];
  tier: SuiteQualification["tier"];
  reasons: string[];
}

export interface PlayGameRanking {
  version: string;
  game: PlayGameId;
  tier: RankingTier;
  primary_metric: "mean_score" | "win_rate";
  rows: PlayGameObservation[];
  /** Exact competition ranks within this game/version/tier. */
  ranks: Array<number | undefined>;
}

export function playGamePrimaryMetric(game: PlayGameId): "mean_score" | "win_rate" {
  return game === "2048" ? "mean_score" : "win_rate";
}

export function playVersionSelect(releases: PlayReleaseView[], version: string): PlayReleaseView | undefined {
  return releases.find((release) => release.benchmark_version === version);
}

/** Play selects result-bearing versions independently of Build, with no fake
 * measured result when only an unreleased instrument lock exists.
 */
export function latestPlayResultBearingVersion(
  releases: PlayReleaseView[],
  results: QualifiedPlaySeries[],
): string | undefined {
  const versions = new Set(results.map(({ result }) => result.benchmark_version));
  return [...releases].sort((a, b) => compareSemanticVersions(b.benchmark_version, a.benchmark_version))
    .find((release) => versions.has(release.benchmark_version))?.benchmark_version;
}

export function playMetricForGame(game: PlayGameId, gameResult: PlaySeriesTaskResult): number | undefined {
  const metrics = gameResult.metrics;
  if (game === "2048") return metrics?.primary_metric === "mean_score" ? metrics.mean_score : undefined;
  return metrics?.primary_metric === "win_rate" ? metrics.win_rate : undefined;
}

/** No cross-game, cross-version, or cross-tier ranking. Missing metrics and
 * surviving games/cells never receive positions; a real zero ranks normally.
 */
export function buildPlayGameRanking(
  game: PlayGameId,
  version: string,
  results: QualifiedPlaySeries[],
  tier: RankingTier,
): PlayGameRanking {
  const observations = results.filter(({ result, qualification }) =>
    result.benchmark_version === version && qualification.tier === tier,
  ).flatMap(({ result, qualification, campaign_complete, rankable }): PlayGameObservation[] => {
    const task = result.games.find((candidate) => candidate.game === game);
    if (!task) return [];
    const metric = playMetricForGame(game, task);
    return [{
      series_id: result.series_id,
      created_at: result.finished_at,
      configuration: result.configuration,
      protocol: task.protocol,
      game_hash: task.game_hash,
      trajectory_hash: task.trajectory_hash,
      artifact_manifest_hash: task.artifact_manifest_hash,
      episode_count: task.coverage.completed,
      required_episodes: task.coverage.required,
      metric,
      metrics: task.metrics,
      rankable: rankable && metric !== undefined && Number.isFinite(metric),
      incomplete: !qualification.complete,
      campaign_complete,
      campaign: result.campaign,
      tier: qualification.tier,
      reasons: [...qualification.reasons, ...(!campaign_complete ? ["incomplete campaign publication"] : [])],
    }];
  });
  const ranks = assignCompetitionRanks(observations.map((row) => row.rankable ? row.metric : undefined));
  const ordered = observations.map((observation, index) => ({ observation, rank: ranks[index] })).sort((a, b) =>
    (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) ||
    a.observation.series_id.localeCompare(b.observation.series_id),
  );
  return {
    version, game, tier, primary_metric: playGamePrimaryMetric(game),
    rows: ordered.map(({ observation }) => observation),
    ranks: ordered.map(({ rank }) => rank),
  };
}

export function formatPlayMetric(game: PlayGameId, metric: number | undefined): string {
  if (metric === undefined || !Number.isFinite(metric)) return "—";
  const value = Number.isInteger(metric) ? String(metric) : metric.toFixed(1);
  return game === "minesweeper" ? `${value}%` : value;
}

export function agentLabel(observation: PlayGameObservation): string {
  const agent = observation.configuration.agent;
  const model = agent.model && agent.model !== "unknown" ? agent.model : agent.id;
  const suffix = observation.configuration.prompt_language === "zh" ? " · 中文" : "";
  return `${agent.id} · ${model}${suffix}`;
}

export function projectPlayReleases(contexts: SiteReleaseContext[]): PlayReleaseView[] {
  return contexts.flatMap(({ lock, file_hash }) => lock.schema_version === 4 ? [{
    benchmark_version: lock.benchmark_version,
    release_hash: file_hash,
    task_count: lock.suites.play.task_count,
    tasks: lock.suites.play.tasks,
  }] : []);
}

/** Instrument locks are not an assertion that a tag/deployment exists. */
export async function playReleases(): Promise<PlayReleaseView[]> {
  return projectPlayReleases(await siteReleaseContexts(await findRepositoryRoot()));
}

/** Only canonical results/lite/index.json publications enter this loader.
 * GAMEBENCH_RESULTS_ROOT is the results ROOT, not a Play directory. There is no
 * legacy status lookup, file scan, second ledger, or canonical-JSON lock hash.
 */
export async function playResults(options: { repositoryRoot?: string; resultsRoot?: string } = {}): Promise<QualifiedPlaySeries[]> {
  const root = options.repositoryRoot ?? await findRepositoryRoot();
  const indexed = (await canonicalFlatResults(options.resultsRoot ?? siteResultsRoot(root)))
    .filter((result): result is FlatSeriesResultPlayV3 => result.schema_version === 3 && result.suite === "play");
  const qualified = qualifyIndexedFlatResults(
    indexed, await siteReleaseContexts(root), await flatCampaignPlans(root, indexed),
  );
  return qualified.filter((row): row is QualifiedPlaySeries => row.result.suite === "play")
    .sort((a, b) => compareSemanticVersions(b.result.benchmark_version, a.result.benchmark_version) ||
      a.result.series_id.localeCompare(b.result.series_id));
}
