import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CampaignPlanV2Schema, FlatSeriesResultPlayV3Schema, aggregatePlayEpisodes,
  campaignCellExecutionSpecV2Hash, campaignPlanV2Hash, createReleaseLockV4,
  flatBuildV3FromLite, listTasks, loadPlayTasks, playSeedBundleHash,
  playTrajectoryHash, sha256Canonical,
} from "@carrick/gamebench-core";

export const repository = fileURLToPath(new URL("../../../", import.meta.url));
export const json = async (relative) => JSON.parse(await readFile(path.join(repository, relative), "utf8"));
export const hash = (label) => sha256Canonical(label);
export const bytesHash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export const seriesId = (i) => `01K${String(i).padStart(23, "0")}`;
const resources = Promise.all([listTasks(repository), loadPlayTasks(repository)]);

export async function playFixture({ scores = [100, 80], wins = [], version = "0.7.0" } = {}) {
  const [build, play] = await resources;
  const release = createReleaseLockV4(version, build, play);
  const lockBytes = `${JSON.stringify(release, null, 2)}\n`;
  const fileHash = bytesHash(lockBytes);
  const cells = scores.map((_, i) => ({
    cell_id: `cell-${i}`, series_id: seriesId(i), agent: { id: "pi", version: "0.84.3" },
    adapter: { path: "tools/agents/pi-play.mjs", hash: hash("adapter") },
    provider: "fixture", model: `fixture-${i}`, parameters: { thinking: "off" }, prompt_language: "en",
    isolation: { session: false, context_files: false, extensions: false, skills: false },
  }));
  const bundle = { schema_version: 1, benchmark_version: version, tasks: release.suites.play.tasks.map((task) => ({
    task_id: task.id, seeds: Array.from({ length: 10 }, (_, i) => i + 1),
  })) };
  const plan = CampaignPlanV2Schema.parse({
    schema_version: 2, campaign_id: "site-fixture", benchmark_version: version, release_hash: fileHash,
    suite: "play", protocol: "play-visual-v1",
    comparison: { unit: "system", primary_endpoints: ["play.2048.mean_score", "play.minesweeper.win_rate"], comparability: "within-release-only", vary: cells.length > 1 ? ["model"] : [], order_policy: "preregistered" },
    cells, seed_commitment: { schema_version: 1, benchmark_version: version, seed_bundle_hash: playSeedBundleHash(bundle), tasks: bundle.tasks.map((task) => ({ task_id: task.task_id, episodes: 10 })) },
  });
  const results = cells.map((cell, cellIndex) => FlatSeriesResultPlayV3Schema.parse({
    schema_version: 3, suite: "play", benchmark_version: version, release_hash: fileHash,
    series_id: cell.series_id, git_commit: "a".repeat(40), source_tree_clean: true, profile: "official",
    configuration: { agent: { ...cell.agent, model: cell.model, harness: cell.agent.id, parameters: { ...cell.parameters, provider: cell.provider } }, prompt_language: cell.prompt_language },
    campaign: { id: plan.campaign_id, cell_id: cell.cell_id, suite: "play", plan_hash: campaignPlanV2Hash(plan), execution_hash: campaignCellExecutionSpecV2Hash(cell, plan.suite, plan.protocol) },
    started_at: "2026-09-01T00:00:00.000Z", finished_at: "2026-09-01T01:00:00.000Z",
    games: release.suites.play.tasks.map((task) => {
      const episodes = Array.from({ length: 10 }, (_, i) => ({
        episode_index: i, seed: i + 1, status: "complete", action_count: 3,
        termination: task.game === "minesweeper" && i < (wins[cellIndex] ?? 0)
          ? { kind: "game-over" } : { kind: "invalid-response-stop", consecutive_invalid: 3 },
        outcome: task.game === "2048"
          ? { terminal: false, won: false, score: scores[cellIndex], max_tile: 2, effective_moves: 0 }
          : { terminal: i < (wins[cellIndex] ?? 0), won: i < (wins[cellIndex] ?? 0), score: 0, revealed_safe: i < (wins[cellIndex] ?? 0) ? 90 : 0, safe_cells: 90 },
        trajectory_hash: hash(`episode-${task.game}-${cellIndex}-${i}`),
      }));
      return {
        task_id: task.id, task_version: task.version, game: task.game, game_hash: task.hash,
        artifact_manifest_hash: hash("evidence"), protocol: "play-visual-v1",
        trajectory_hash: playTrajectoryHash(task.id, episodes), episodes,
        coverage: { completed: 10, required: 10 }, metrics: aggregatePlayEpisodes(task.game, episodes).metrics,
      };
    }),
  }));
  return { release, lockBytes, context: { lock: release, file_hash: fileHash }, plan, results };
}

export function partialGame(result, game = "minesweeper") {
  const copy = structuredClone(result);
  const task = copy.games.find((row) => row.game === game);
  task.episodes.pop();
  task.coverage.completed = 9;
  delete task.metrics;
  task.trajectory_hash = playTrajectoryHash(task.task_id, task.episodes);
  return FlatSeriesResultPlayV3Schema.parse(copy);
}

export async function historicalLite() {
  const index = await json("results/lite/index.json");
  return json(index.results.find((row) => row.benchmark_version === "0.6.0").path);
}

export async function buildFixture(fixture) {
  const lite = await historicalLite();
  delete lite.campaign;
  return flatBuildV3FromLite({ ...lite, benchmark_version: fixture.release.benchmark_version,
    release_hash: fixture.context.file_hash, series_id: seriesId(99) });
}

/** Disposable fixture data stays under the owned site directory. */
export async function fixtureFiles(t, fixture, indexed = fixture.results) {
  const root = await mkdtemp(path.join(fileURLToPath(new URL("./", import.meta.url)), ".build-play-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const save = async (relative, value, raw = false) => {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, raw ? value : `${JSON.stringify(value, null, 2)}\n`);
  };
  await save(`benchmark/releases/${fixture.release.benchmark_version}.json`, fixture.lockBytes, true);
  await save(`benchmark/campaigns/${fixture.release.benchmark_version}/${fixture.plan.campaign_id}.json`, fixture.plan);
  await save("benchmark/releases/0.6.0.json", await readFile(path.join(repository, "benchmark/releases/0.6.0.json"), "utf8"), true);
  for (const result of indexed) await save(`results/lite/${result.benchmark_version}/${result.series_id}.json`, result);
  await save("results/lite/index.json", { schema_version: 1, results: indexed.map((result) => ({
    benchmark_version: result.benchmark_version, series_id: result.series_id,
    path: `results/lite/${result.benchmark_version}/${result.series_id}.json`,
  })) });
  return { root, save, options: { repositoryRoot: root, resultsRoot: path.join(root, "results") } };
}
