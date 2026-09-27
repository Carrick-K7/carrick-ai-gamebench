import assert from "node:assert/strict";
import test from "node:test";
import {
  CampaignPlanV2Schema, FlatSeriesResultPlayV3Schema, aggregatePlayEpisodes,
  campaignCellExecutionSpecV2Hash, campaignPlanV2Hash, createReleaseLockV4,
  listTasks, loadPlayTasks, playSeedBundleHash, playTrajectoryHash,
  qualifyFlatSeriesV3, sha256Canonical,
  type PlayEpisodeSummary, type PlaySeriesTaskResult,
} from "../src/index.js";

const hash = (label: string) => sha256Canonical(label);
const resources = Promise.all([listTasks(), loadPlayTasks()]);

async function fixture() {
  const [build, play] = await resources;
  const release = createReleaseLockV4("0.7.0", build, play);
  const games: PlaySeriesTaskResult[] = play.map((task) => {
    const episodes: PlayEpisodeSummary[] = Array.from({ length: 10 }, (_, index) => ({
      episode_index: index, seed: index + 1, status: "complete", action_count: 3,
      termination: { kind: "invalid-response-stop", consecutive_invalid: 3 },
      outcome: task.manifest.game === "2048"
        ? { terminal: false, won: false, score: 0, max_tile: 2, effective_moves: 0 }
        : { terminal: false, won: false, score: 0, revealed_safe: 0, safe_cells: 90 },
      trajectory_hash: hash(`episode-${task.manifest.game}-${index}`),
    }));
    return {
      task_id: task.manifest.id, task_version: task.manifest.version, game: task.manifest.game,
      game_hash: task.hash, artifact_manifest_hash: hash("sealed-evidence"), protocol: "play-visual-v1",
      trajectory_hash: playTrajectoryHash(task.manifest.id, episodes), episodes,
      coverage: { completed: 10, required: 10 }, metrics: aggregatePlayEpisodes(task.manifest.game, episodes).metrics!,
    };
  });
  const bundle = { schema_version: 1 as const, benchmark_version: "0.7.0", tasks: games.map((game) => ({ task_id: game.task_id, seeds: game.episodes.map((episode) => episode.seed) })) };
  const plan = CampaignPlanV2Schema.parse({
    schema_version: 2, campaign_id: "fixture", benchmark_version: "0.7.0", release_hash: hash("lock-file-bytes"),
    suite: "play", protocol: "play-visual-v1",
    comparison: { unit: "system", primary_endpoints: ["play.2048.mean_score", "play.minesweeper.win_rate"], comparability: "within-release-only", vary: [], order_policy: "preregistered" },
    seed_commitment: { schema_version: 1, benchmark_version: "0.7.0", seed_bundle_hash: playSeedBundleHash(bundle), tasks: games.map((game) => ({ task_id: game.task_id, episodes: 10 })) },
    cells: [{ cell_id: "first", series_id: "01K00000000000000000000000", agent: { id: "pi", version: "0.84.3" },
      adapter: { path: "tools/agents/pi-play.mjs", hash: hash("adapter") }, provider: "fixture", model: "fixture",
      parameters: { thinking: "off" }, prompt_language: "en",
      isolation: { session: false, context_files: false, extensions: false, skills: false } }],
  });
  const result = FlatSeriesResultPlayV3Schema.parse({
    schema_version: 3, suite: "play", benchmark_version: "0.7.0", release_hash: plan.release_hash,
    series_id: plan.cells[0]!.series_id, git_commit: "a".repeat(40), source_tree_clean: true, profile: "official",
    configuration: { agent: { id: "pi", version: "0.84.3", model: "fixture", harness: "pi", parameters: { thinking: "off", provider: "fixture" } }, prompt_language: "en" },
    campaign: { id: plan.campaign_id, cell_id: "first", suite: "play", plan_hash: campaignPlanV2Hash(plan), execution_hash: campaignCellExecutionSpecV2Hash(plan.cells[0]!, plan.suite, plan.protocol) },
    started_at: "2026-09-01T00:00:00.000Z", finished_at: "2026-09-01T01:00:00.000Z", games,
  });
  return { result, release, plan };
}

test("complete paired Play data qualifies independently of the native score value", async () => {
  const { result, release, plan } = await fixture();
  assert.deepEqual(qualifyFlatSeriesV3(result, release, plan.release_hash, plan), { complete: true, tier: "official", reasons: [] });
  assert.ok(result.games.every((game) => game.metrics !== undefined));
});

test("an incomplete other game cannot leave a surviving game's ranking eligible", async () => {
  const { result, release, plan } = await fixture();
  result.games.pop();
  const qualification = qualifyFlatSeriesV3(result, release, plan.release_hash, plan);
  assert.equal(qualification.complete, false);
  assert.equal(qualification.tier, "experimental");
});

test("qualification binds release bytes, policy, configuration and committed seed order", async () => {
  const { result, release, plan } = await fixture();
  assert.throws(() => qualifyFlatSeriesV3(result, release, hash("another-lock"), plan), /release lock/);
  const config = structuredClone(result);
  config.configuration.agent.parameters.thinking = "high";
  assert.throws(() => qualifyFlatSeriesV3(config, release, plan.release_hash, plan), /configuration/);
  const changed = structuredClone(result);
  changed.games[0]!.episodes[0]!.seed = 987;
  changed.games[0]!.trajectory_hash = playTrajectoryHash(changed.games[0]!.task_id, changed.games[0]!.episodes);
  assert.throws(() => qualifyFlatSeriesV3(changed, release, plan.release_hash, plan), /seeds\/order/);
  assert.throws(() => qualifyFlatSeriesV3(result, release, plan.release_hash), /campaign plan/);
});

test("publication data cannot lose evidence binding, fake completion or corrupt aggregates", async () => {
  const { result } = await fixture();
  const missing = JSON.parse(JSON.stringify(result));
  delete missing.games[0].artifact_manifest_hash;
  assert.equal(FlatSeriesResultPlayV3Schema.safeParse(missing).success, false);
  const failed = structuredClone(result);
  const first = failed.games[0]!.episodes[0]!;
  first.status = "infrastructure-failure";
  first.termination = { kind: "infrastructure-failure", reason: "browser-failure" };
  delete first.outcome;
  delete failed.games[0]!.metrics;
  assert.equal(FlatSeriesResultPlayV3Schema.safeParse(failed).success, false, "10/10 must not count an infrastructure episode");
  failed.games[0]!.coverage.completed = 9;
  assert.equal(FlatSeriesResultPlayV3Schema.safeParse(failed).success, true);
  const aggregate = JSON.parse(JSON.stringify(result));
  aggregate.games[0].metrics.mean_score = 123;
  assert.equal(FlatSeriesResultPlayV3Schema.safeParse(aggregate).success, false);
});
