import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  CampaignPlanSchema,
  CAMPAIGN_SUITE_ENDPOINTS,
  CampaignPlanV2Schema,
  assertCampaignCommitConsistency,
  assertCampaignV2Release,
  campaignCellExecutionSpecV2,
  campaignCellExecutionSpecV2Hash,
  campaignPlanHash,
  campaignPlanV2Hash,
  campaignPlaySeedCommitment,
  type CampaignCell,
  type CampaignPlanV2,
} from "../src/index.js";

const hash = (input: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(input).digest("hex")}`;
const adapterHash = hash("ad");
const seriesA = "00000000Z8N5XG3VMX30Y11GVF";
const seriesB = "00000000Z8N5XG3VMX31Y11GVF";

function cell(overrides: Partial<CampaignCell> = {}): CampaignCell {
  return {
    cell_id: "placeholder",
    series_id: seriesA,
    agent: { id: "pi", version: "0.84.3" },
    adapter: { path: "tools/agents/pi-gamebench.sh", hash: adapterHash },
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    parameters: { thinking: "medium" },
    prompt_language: "en",
    isolation: {
      session: false,
      context_files: false,
      extensions: false,
      skills: false,
    },
    ...overrides,
  };
}

function buildPlan(): CampaignPlanV2 {
  return {
    schema_version: 2,
    campaign_id: "build-suite-2026-09-06",
    benchmark_version: "0.7.0",
    release_hash: hash("r"),
    suite: "build",
    protocol: "build-campaign-v1",
    comparison: {
      unit: "system",
      primary_endpoints: ["build.score"],
      comparability: "within-release-only",
      vary: ["provider", "model"],
      order_policy: "preregistered",
    },
    cells: [
      cell({ cell_id: "codex-sol", provider: "openai-codex", model: "gpt-5.6-sol" }),
      cell({ cell_id: "anthropic-sonnet", provider: "anthropic", model: "claude-sonnet-4", series_id: seriesB }),
    ],
  };
}

function playPlan(): CampaignPlanV2 {
  return {
    schema_version: 2,
    campaign_id: "play-suite-2026-09-06",
    benchmark_version: "0.7.0",
    release_hash: hash("r"),
    suite: "play",
    protocol: "play-visual-v1",
    comparison: {
      unit: "system",
      primary_endpoints: ["play.2048.mean_score", "play.minesweeper.win_rate"],
      comparability: "within-release-only",
      vary: ["provider", "model"],
      order_policy: "preregistered",
    },
    cells: [
      cell({ cell_id: "codex-sol", provider: "openai-codex", model: "gpt-5.6-sol" }),
      cell({ cell_id: "anthropic-sonnet", provider: "anthropic", model: "claude-sonnet-4", series_id: seriesB }),
    ],
    seed_commitment: {
      schema_version: 1,
      benchmark_version: "0.7.0",
      seed_bundle_hash: hash("seed"),
      tasks: [
        { task_id: "play.2048.v1", episodes: 10 },
        { task_id: "play.minesweeper.v1", episodes: 10 },
      ],
    },
  };
}

test("campaign v2 accepts a single-suite build comparison", () => {
  const parsed = CampaignPlanV2Schema.safeParse(buildPlan());
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.comparison.primary_endpoints.join(","), "build.score");
});

test("campaign v2 accepts a single-suite play comparison with a seed commitment", () => {
  const parsed = CampaignPlanV2Schema.safeParse(playPlan());
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.protocol, "play-visual-v1");
  assert.ok(campaignPlaySeedCommitment(parsed.data));
});

test("campaign v2 enforces suite-endpoint and suite-protocol consistency", () => {
  const wrongEndpoint = buildPlan();
  wrongEndpoint.comparison.primary_endpoints = ["play.2048.mean_score", "play.minesweeper.win_rate"];
  assert.equal(CampaignPlanV2Schema.safeParse(wrongEndpoint).success, false);

  const wrongProtocol = buildPlan();
  wrongProtocol.protocol = "play-visual-v1";
  assert.equal(CampaignPlanV2Schema.safeParse(wrongProtocol).success, false);

  const wrongPlayEndpoint = playPlan();
  wrongPlayEndpoint.comparison.primary_endpoints = ["build.score"];
  assert.equal(CampaignPlanV2Schema.safeParse(wrongPlayEndpoint).success, false);
});

test("campaign v2 requires a seed commitment for play and forbids it for build", () => {
  const missingSeed = playPlan();
  delete missingSeed.seed_commitment;
  assert.equal(CampaignPlanV2Schema.safeParse(missingSeed).success, false);

  const forbiddenSeed = buildPlan();
  forbiddenSeed.seed_commitment = playPlan().seed_commitment!;
  assert.equal(CampaignPlanV2Schema.safeParse(forbiddenSeed).success, false);
});

test("campaign v2 rejects duplicate cells and undeclared confounds", () => {
  const duplicateCell = buildPlan();
  duplicateCell.cells[1] = { ...duplicateCell.cells[1]!, cell_id: duplicateCell.cells[0]!.cell_id };
  assert.equal(CampaignPlanV2Schema.safeParse(duplicateCell).success, false);

  const promptConfound = buildPlan();
  promptConfound.cells[0]!.prompt_language = "zh";
  assert.equal(CampaignPlanV2Schema.safeParse(promptConfound).success, false);
});

test("campaign v2 hashes are canonical, stable and distinct from v1", () => {
  const plan = buildPlan();
  assert.match(campaignPlanV2Hash(plan), /^sha256:[a-f0-9]{64}$/);
  assert.equal(campaignPlanV2Hash(plan), campaignPlanV2Hash(plan));
  const roundTripped = CampaignPlanV2Schema.parse(JSON.parse(JSON.stringify(plan)));
  assert.equal(campaignPlanV2Hash(roundTripped), campaignPlanV2Hash(plan));

  const changed = buildPlan();
  changed.cells[0]!.model = "gpt-5.6-mini";
  assert.notEqual(campaignPlanV2Hash(changed), campaignPlanV2Hash(plan));

  // The v2 hash must not equal the v1 hash for the equivalent concept.
  const v1 = CampaignPlanSchema.parse({
    schema_version: 1,
    campaign_id: plan.campaign_id,
    benchmark_version: plan.benchmark_version,
    release_hash: plan.release_hash,
    comparison: {
      unit: "system",
      primary_endpoint: "build.score",
      comparability: "within-release-only",
      vary: plan.comparison.vary,
      order_policy: "preregistered",
    },
    cells: plan.cells.map(({ cell_id, series_id, agent, adapter, provider, model, parameters, prompt_language, isolation }) => ({
      cell_id,
      series_id,
      agent,
      adapter,
      provider,
      model,
      parameters,
      prompt_language,
      isolation,
    })),
  });
  assert.notEqual(campaignPlanV2Hash(plan), campaignPlanHash(v1));
});

test("v2 execution specs bind suite and protocol without rewriting v1 hashes", () => {
  const plan = buildPlan();
  const firstCell = plan.cells[0]!;
  const spec = campaignCellExecutionSpecV2(firstCell, plan.suite, plan.protocol);
  assert.equal(spec.suite, "build");
  assert.equal(spec.protocol, "build-campaign-v1");
  assert.equal(
    campaignCellExecutionSpecV2Hash(firstCell, plan.suite, plan.protocol),
    campaignCellExecutionSpecV2Hash(firstCell, plan.suite, plan.protocol),
  );
  // A different suite/protocol changes the cell execution hash.
  assert.notEqual(
    campaignCellExecutionSpecV2Hash(firstCell, "play", "play-visual-v1"),
    campaignCellExecutionSpecV2Hash(firstCell, plan.suite, plan.protocol),
  );
});

test("campaign v2 binds exactly one release and suite", () => {
  const plan = buildPlan();
  assert.doesNotThrow(() =>
    assertCampaignV2Release(plan, {
      benchmark_version: "0.7.0",
      release_hash: hash("r"),
      suite: "build",
    }),
  );
  assert.throws(
    () =>
      assertCampaignV2Release(plan, {
        benchmark_version: "0.6.0",
        release_hash: hash("r"),
        suite: "build",
      }),
    /benchmark version/,
  );
  assert.throws(
    () =>
      assertCampaignV2Release(plan, {
        benchmark_version: "0.7.0",
        release_hash: hash("r"),
        suite: "play",
      }),
    /suite/,
  );
});

test("campaign membership requires one concrete commit, optionally the current execution commit", () => {
  const first = { git_commit: "a".repeat(40) };
  const second = { git_commit: "b".repeat(40) };
  assert.doesNotThrow(() => assertCampaignCommitConsistency([]));
  assert.doesNotThrow(() => assertCampaignCommitConsistency([first, { ...first }]));
  assert.doesNotThrow(() => assertCampaignCommitConsistency([first], first.git_commit));
  assert.throws(() => assertCampaignCommitConsistency([first, second]), /same recorded Git commit/);
  assert.throws(() => assertCampaignCommitConsistency([first], second.git_commit), /same recorded Git commit/);
  assert.throws(() => assertCampaignCommitConsistency([{ git_commit: "unknown" }]), /same recorded Git commit/);
});

test("campaign suite endpoints are the frozen preregistered sets", () => {
  assert.deepEqual([...CAMPAIGN_SUITE_ENDPOINTS.build], ["build.score"]);
  assert.deepEqual(
    [...CAMPAIGN_SUITE_ENDPOINTS.play],
    ["play.2048.mean_score", "play.minesweeper.win_rate"],
  );
});
