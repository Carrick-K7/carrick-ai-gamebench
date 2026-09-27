import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CampaignPlanV2Schema, createReleaseLockV4, findRepositoryRoot, listTasks, loadPlayTasks, sha256File, writeJson } from "@carrick/gamebench-core";
import { assertCampaignV2MayStart, campaignV2ExecutionOptions } from "../src/campaign-v2-io.js";
import { checkSuitePublishedResults, publishCampaignsV2, publishSuiteRun } from "../src/suite-publication.js";
import { checkPlaySeries } from "../src/play/check-series.js";
import { createPlaySeedBundle, createPlaySeedCommitment, readPrivatePlaySeedBundle, writePrivatePlaySeedBundle } from "../src/play/seeds.js";
import { runPlaySeries } from "../src/play/series.js";

const identity = { agent: "fixture", version: "1.0.0", provider: "fixture", model: "fixture", thinking: "off" };
const configuration = { agent: { id: identity.agent, version: identity.version, model: identity.model, harness: "fixture", parameters: { provider: identity.provider, thinking: identity.thinking } }, prompt_language: "en" as const };

async function fixture() {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "cagb-play-series-"));
  await cp(path.join(await findRepositoryRoot(), "benchmark"), path.join(repositoryRoot, "benchmark"), { recursive: true });
  await writeJson(path.join(repositoryRoot, "package.json"), { version: "0.7.0" });
  const release = createReleaseLockV4("0.7.0", await listTasks(repositoryRoot), await loadPlayTasks(repositoryRoot));
  await writeJson(path.join(repositoryRoot, "benchmark", "releases", "0.7.0.json"), release);
  const agent = path.join(repositoryRoot, "fake-agent.mjs");
  await writeFile(agent, `#!${process.execPath}
import { readdirSync } from 'node:fs';
const defaults = ${JSON.stringify(identity)};
const identity = process.argv.length === 5 ? { ...defaults, provider: process.argv[2], model: process.argv[3], thinking: process.argv[4] } : defaults;
let buffer = ''; process.stdin.setEncoding('utf8');
function send(body) { process.stdout.write(JSON.stringify(body) + '\\n'); }
process.stdin.on('data', chunk => { buffer += chunk; let end;
  while ((end = buffer.indexOf('\\n')) >= 0) {
    const request = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    if (request.type === 'init') {
      if (readdirSync(process.cwd()).length !== 0) throw new Error('not an empty player cwd');
      send({type:'ready', protocol_version:1, identity});
    } else if (request.type === 'observe') {
      if ('seed' in request || 'snapshot' in request || 'path' in request.frame) throw new Error('private context leaked');
      if (process.argv[2] === 'infra') send({type:'error',turn_id:request.turn_id,kind:'adapter',before_content:true,retryable:false,code:'fixture'});
      else send({type:'action', turn_id:request.turn_id, response_text:'invalid fixture answer'});
    } else if (request.type === 'finish') process.stdout.write(JSON.stringify({type:'finished'}) + '\\n', () => process.exit(0));
  }
});`);
  await chmod(agent, 0o755);
  await writeJson(path.join(repositoryRoot, "results", "lite", "index.json"), { schema_version: 1, results: [] });
  return { repositoryRoot, release, agent, outputRoot: path.join(repositoryRoot, "runs", "0.7.0") };
}

for (const infra of [false, true]) {
  test(`Play series ${infra ? "stops without resampling or ranking on infrastructure failure" : "runs all 20 episodes with fresh bounded contexts and native replay"}`, async () => {
    const f = await fixture();
    try {
      const seedBundle = createPlaySeedBundle(f.release);
      const recorded = await runPlaySeries({ ...f, official: false, agentCommand: `${JSON.stringify(process.execPath)} ${JSON.stringify(f.agent)}${infra ? " infra" : ""}`, identity, configuration, seedBundle });
      assert.equal((await stat(recorded.runDir)).mode & 0o077, 0);
      assert.equal((await stat(path.join(recorded.runDir, "seeds.private.json"))).mode & 0o077, 0);
      assert.deepEqual(await readPrivatePlaySeedBundle(path.join(recorded.runDir, "seeds.private.json")), seedBundle);
      const checked = await checkPlaySeries({ ...f, runDir: recorded.runDir, replayMode: "engine" });
      assert.equal(checked.qualification.complete, !infra);
      assert.equal(checked.qualification.tier, "experimental");
      if (infra) {
        assert.equal(recorded.result.games.length, 1);
        assert.equal(recorded.result.games[0]?.episodes.length, 1);
        assert.equal(recorded.result.games[0]?.episodes[0]?.action_count, 1);
        assert.equal(recorded.result.games[0]?.metrics, undefined);
        await assert.rejects(checkPlaySeries({ ...f, runDir: recorded.runDir, requireComplete: true }), /incomplete/);
        await assert.rejects(publishSuiteRun(f.repositoryRoot, recorded.runDir), /incomplete/);
        assert.deepEqual(await readdir(path.join(f.repositoryRoot, "results", "lite")), ["index.json"]);
      } else {
        assert.equal(recorded.result.games.length, 2);
        assert.equal(recorded.result.games.reduce((sum, game) => sum + game.episodes.length, 0), 20);
        assert.equal(recorded.result.games.reduce((sum, game) => sum + game.episodes.reduce((count, episode) => count + episode.action_count, 0), 0), 60);
        for (const game of recorded.result.games) {
          assert.ok(game.metrics);
          for (const episode of game.episodes) {
            const first = JSON.parse(await readFile(path.join(recorded.runDir, "tasks", game.task_id, "episodes", String(episode.episode_index).padStart(3, "0"), "observations", "0000.json"), "utf8"));
            assert.equal(first.memo, "");
            assert.deepEqual(first.last_actions, []);
          }
        }
        assert.equal("score" in recorded.result, false);
        const published = await publishSuiteRun(f.repositoryRoot, recorded.runDir);
        assert.equal(published, path.join(f.repositoryRoot, "results", "lite", "0.7.0", `${recorded.result.series_id}.json`));
        assert.deepEqual(await checkSuitePublishedResults(f.repositoryRoot), { results: 1, campaigns: 0 });
        const partial = structuredClone(recorded.result);
        partial.games.pop();
        await writeJson(published, partial);
        await assert.rejects(checkSuitePublishedResults(f.repositoryRoot), /incomplete suite/);
      }
      await assert.rejects(runPlaySeries({ ...f, official: false, agentCommand: "must-not-start", identity, configuration, seedBundle, seriesId: recorded.result.series_id }), /already exists/);
    } finally { await rm(f.repositoryRoot, { recursive: true, force: true }); }
  });
}

test("a two-cell campaign reveals no seeds publicly until both complete and publishes atomically", async () => {
  const f = await fixture();
  try {
    const bundle = createPlaySeedBundle(f.release);
    const plan = CampaignPlanV2Schema.parse({
      schema_version: 2, campaign_id: "paired", benchmark_version: "0.7.0", suite: "play", protocol: "play-visual-v1",
      release_hash: `sha256:${await sha256File(path.join(f.repositoryRoot, "benchmark", "releases", "0.7.0.json"))}`,
      comparison: { unit: "system", primary_endpoints: ["play.2048.mean_score", "play.minesweeper.win_rate"], comparability: "within-release-only", vary: ["model"], order_policy: "preregistered" },
      seed_commitment: createPlaySeedCommitment(bundle),
      cells: await Promise.all([0, 1].map(async (index) => ({
        cell_id: index ? "second" : "first", series_id: `01K0000000000000000000000${index}`,
        agent: { id: "fixture", version: "1.0.0" }, adapter: { path: "fake-agent.mjs", hash: `sha256:${await sha256File(f.agent)}` },
        provider: "fixture", model: `fixture-${index}`, parameters: { thinking: "off" }, prompt_language: "en",
        isolation: { session: false, context_files: false, extensions: false, skills: false },
      }))),
    });
    await writeJson(path.join(f.repositoryRoot, "benchmark", "campaigns", "0.7.0", "paired.json"), plan);
    await writeFile(path.join(f.repositoryRoot, ".gitignore"), "runs/\nresults/\n");
    for (const args of [["init", "--quiet"], ["add", "."], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "synthetic preregistration"]]) {
      const git = spawnSync("git", args, { cwd: f.repositoryRoot, encoding: "utf8" });
      assert.equal(git.status, 0, git.stderr);
    }
    await assert.rejects(assertCampaignV2MayStart(f.repositoryRoot, plan, plan.cells[1]!));
    const first = plan.cells[0]!;
    await assertCampaignV2MayStart(f.repositoryRoot, plan, first);
    await runPlaySeries({ ...campaignV2ExecutionOptions(f.repositoryRoot, plan, first), seedBundle: bundle });
    await assert.rejects(publishCampaignsV2(f.repositoryRoot, [plan.campaign_id]), /ENOENT/);
    assert.deepEqual(await readdir(path.join(f.repositoryRoot, "results", "lite")), ["index.json"]);
    await assertCampaignV2MayStart(f.repositoryRoot, plan, plan.cells[1]!);
    await runPlaySeries({ ...campaignV2ExecutionOptions(f.repositoryRoot, plan, plan.cells[1]!), seedBundle: bundle });
    assert.equal((await publishCampaignsV2(f.repositoryRoot, [plan.campaign_id])).length, 2);
    assert.deepEqual(await checkSuitePublishedResults(f.repositoryRoot), { results: 2, campaigns: 1 });
    const indexPath = path.join(f.repositoryRoot, "results", "lite", "index.json");
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    index.results.pop();
    await writeJson(indexPath, index);
    await assert.rejects(checkSuitePublishedResults(f.repositoryRoot), /partially published/);
  } finally { await rm(f.repositoryRoot, { recursive: true, force: true }); }
});

test("seed bundle generation is private, ordered and immutable rather than silently regenerated", async () => {
  const f = await fixture();
  try {
    const bundle = createPlaySeedBundle(f.release);
    assert.equal(bundle.tasks.length, 2);
    assert.ok(bundle.tasks.every((task) => new Set(task.seeds).size === 10));
    const file = path.join(f.repositoryRoot, "private-seeds.json");
    await writePrivatePlaySeedBundle(file, bundle);
    assert.deepEqual(await readPrivatePlaySeedBundle(file), bundle);
    await assert.rejects(writePrivatePlaySeedBundle(file, createPlaySeedBundle(f.release)), /EEXIST/);
    const commitment = createPlaySeedCommitment(bundle);
    assert.equal(JSON.stringify(commitment).includes('"seeds"'), false);
    assert.deepEqual(commitment.tasks.map((task) => task.task_id), bundle.tasks.map((task) => task.task_id));
  } finally { await rm(f.repositoryRoot, { recursive: true, force: true }); }
});
