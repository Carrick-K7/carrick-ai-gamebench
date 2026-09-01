import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  findRepositoryRoot,
  hashCampaignCellExecution,
  hashCampaignPlan,
  type LiteSeriesResult,
} from "@carrick/gamebench-core";
import {
  assertCampaignCellMayStart,
  assertResultMatchesCampaignCell,
  campaignBenchOptions,
  checkCampaignPublications,
  findCampaignCell,
  listCampaignPlans,
  loadCampaignPlan,
} from "../src/campaign.js";
import { createSeriesRunDirectory } from "../src/lite-runner.js";

test("campaign plan derives one fixed Official Pi invocation", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const { plan, planHash } = await loadCampaignPlan(
    repositoryRoot,
    "pi-system-baseline-2026-08-30",
  );
  assert.equal(
    planHash,
    "sha256:c80bf2e436a260367ea44bddf4176ea65d49b7deaa818946fedcc4c5e24c664d",
  );
  const cell = findCampaignCell(plan, "gpt-5.6-sol");
  const options = campaignBenchOptions(repositoryRoot, plan, cell);
  assert.equal(options.seriesId, cell.series_id);
  assert.equal(options.agentId, "pi");
  assert.equal(options.agentVersion, "0.84.3");
  assert.equal(options.model, "gpt-5.6-sol");
  assert.equal(options.harness, "pi");
  assert.deepEqual(options.modelParameters, {
    thinking: "medium",
    provider: "openai-codex",
  });
  assert.equal(options.campaign?.plan_hash, planHash);
  assert.equal(options.campaign?.execution_hash, hashCampaignCellExecution(cell));
  assert.match(options.agentCommand, /tools\/agents\/pi-gamebench\.sh/);
  assert.match(options.agentCommand, /openai-codex/);
});

test("single-cell GLM measurement derives its frozen 302.AI invocation", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const { plan } = await loadCampaignPlan(
    repositoryRoot,
    "glm-5-3-flash-302-2026-08-31",
  );
  assert.equal(plan.cells.length, 1);
  assert.deepEqual(plan.comparison.vary, []);
  const cell = findCampaignCell(plan, "glm-5.3-flash-302");
  const options = campaignBenchOptions(repositoryRoot, plan, cell);
  assert.equal(options.seriesId, "01M1C3ECWM6VSC1ZBXQBW32PET");
  assert.equal(options.model, "glm-5.3-flash");
  assert.deepEqual(options.modelParameters, {
    thinking: "off",
    provider: "ai-302",
  });
  assert.match(options.agentCommand, /ai-302/);
});

test("campaign execution order is enforced before Agent invocation", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const { plan } = await loadCampaignPlan(
    repositoryRoot,
    "pi-system-baseline-2026-08-30",
  );
  const second = findCampaignCell(plan, "gpt-5.6-luna");
  await assert.rejects(
    assertCampaignCellMayStart(repositoryRoot, plan, second),
    /prior campaign cell is not complete/,
  );
});

test("campaign result binding rejects relabeling", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const { plan } = await loadCampaignPlan(
    repositoryRoot,
    "pi-system-baseline-2026-08-30",
  );
  const cell = findCampaignCell(plan, "gpt-5.6-terra");
  const result = {
    benchmark_version: plan.benchmark_version,
    release_hash: plan.release_hash,
    series_id: cell.series_id,
    profile: "official",
    source_tree_clean: true,
    git_commit: "a".repeat(40),
    build: { completed: 4, required: 4, score: 50 },

    campaign: {
      id: plan.campaign_id,
      cell_id: cell.cell_id,
      plan_hash: hashCampaignPlan(plan),
      execution_hash: hashCampaignCellExecution(cell),
    },
    configuration: {
      agent: {
        id: cell.agent.id,
        version: cell.agent.version,
        model: cell.model,
        harness: cell.agent.id,
        parameters: { ...cell.parameters, provider: cell.provider },
      },
      prompt_language: cell.prompt_language,
    },
  } as unknown as LiteSeriesResult;
  assert.doesNotThrow(() => assertResultMatchesCampaignCell(result, plan, cell));
  assert.throws(
    () =>
      assertResultMatchesCampaignCell(
        {
          ...result,
          configuration: {
            ...result.configuration,
            agent: { ...result.configuration.agent, model: "gpt-5.6-sol" },
          },
        },
        plan,
        cell,
      ),
    /configuration differs/,
  );
});

test("preallocated series directories are single-use", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cagb-series-once-"));
  try {
    const seriesId = "01M00000000000000000000000";
    await createSeriesRunDirectory(temporary, seriesId);
    await assert.rejects(
      createSeriesRunDirectory(temporary, seriesId),
      /may not be reused/,
    );
    await assert.rejects(
      createSeriesRunDirectory(temporary, "../escape"),
      /canonical ULID/,
    );
    const actual = path.join(temporary, "actual");
    const linked = path.join(temporary, "linked");
    await mkdir(actual);
    await symlink(actual, linked);
    await assert.rejects(
      createSeriesRunDirectory(path.join(linked, "0.6.0"), "01M00000000000000000000001"),
      /not a real directory/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("committed campaign plans may remain preregistered before publication", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const plans = await listCampaignPlans(repositoryRoot);
  assert.equal(await checkCampaignPublications(repositoryRoot), plans.length);
  assert.equal(plans.length, 4);
});
