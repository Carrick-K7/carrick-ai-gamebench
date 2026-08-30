import assert from "node:assert/strict";
import test from "node:test";
import {
  CampaignPlanSchema,
  assertCampaignRelease,
  campaignCellExecutionSpec,
  campaignCellExecutionSpecHash,
  campaignPlanHash,
  hashCampaignCellExecution,
  hashCampaignPlan,
  type CampaignCell,
  type CampaignPlan,
} from "../src/index.js";

const hash = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;
const releaseHash = hash("a");
const adapterHash = hash("b");

const SERIES = [
  "00000000Z8N5XG3VMX30Y11GVF",
  "00000000ZJ8XN5ZPSQ4KM4SWSB",
  "00000000ZWQDAF95DV36TCPFYN",
  "0000000106Z17G6KHEYES4VCE5",
];

function cell(overrides: Partial<CampaignCell>): CampaignCell {
  return {
    cell_id: "placeholder",
    series_id: SERIES[0]!,
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

function validPlan(): CampaignPlan {
  const systems = [
    { id: "codex-gpt-5-6-sol", provider: "openai-codex", model: "gpt-5.6-sol" },
    { id: "codex-gpt-5-4-sol", provider: "openai-codex", model: "gpt-5.4-sol" },
    { id: "anthropic-claude-sonnet", provider: "anthropic", model: "claude-sonnet-4" },
    { id: "deepseek-qwen-max", provider: "deepseek", model: "qwen-max" },
  ];
  return {
    schema_version: 1,
    campaign_id: "pi-system-baseline-2026-08-30",
    benchmark_version: "0.6.0",
    release_hash: releaseHash,
    comparison: {
      unit: "system",
      primary_endpoint: "build.score",
      comparability: "within-release-only",
      vary: ["provider", "model"],
      order_policy: "preregistered",
    },
    cells: systems.map((system, index) =>
      cell({
        cell_id: system.id,
        series_id: SERIES[index]!,
        provider: system.provider,
        model: system.model,
      }),
    ),
  };
}

test("a valid four-cell system comparison plan is accepted", () => {
  const parsed = CampaignPlanSchema.safeParse(validPlan());
  assert.equal(parsed.success, true);
  const plan = parsed.data;
  assert.equal(plan.cells.length, 4);
  assert.equal(plan.comparison.vary.join(","), "provider,model");
  assert.equal(plan.comparison.primary_endpoint, "build.score");
  assert.equal(plan.comparison.unit, "system");
  // Documented isolation is fully disabled.
  assert.equal(
    plan.cells.every(
      (c) =>
        c.isolation.session === false &&
        c.isolation.context_files === false &&
        c.isolation.extensions === false &&
        c.isolation.skills === false,
    ),
    true,
  );
});

test("duplicate cell_id and duplicate series_id are rejected", () => {
  const duplicateCell = validPlan();
  duplicateCell.cells[1]!.cell_id = duplicateCell.cells[0]!.cell_id;
  assert.equal(CampaignPlanSchema.safeParse(duplicateCell).success, false);

  const duplicateSeries = validPlan();
  duplicateSeries.cells[1]!.series_id = duplicateSeries.cells[0]!.series_id;
  assert.equal(CampaignPlanSchema.safeParse(duplicateSeries).success, false);
});

test("escaping and non-portable adapter paths are rejected", () => {
  assert.equal(
    CampaignPlanSchema.safeParse({
      ...validPlan(),
      cells: [
        cell({ cell_id: "escape", adapter: { path: "../outside.sh", hash: adapterHash } }),
        ...validPlan().cells.slice(1),
      ],
    }).success,
    false,
  );
  assert.equal(
    CampaignPlanSchema.safeParse({
      ...validPlan(),
      cells: [
        cell({ cell_id: "escape", adapter: { path: "/absolute.sh", hash: adapterHash } }),
        ...validPlan().cells.slice(1),
      ],
    }).success,
    false,
  );
  assert.equal(
    CampaignPlanSchema.safeParse({
      ...validPlan(),
      cells: [
        cell({ cell_id: "escape", adapter: { path: "tools\\bad.sh", hash: adapterHash } }),
        ...validPlan().cells.slice(1),
      ],
    }).success,
    false,
  );
  assert.equal(
    CampaignPlanSchema.safeParse({
      ...validPlan(),
      cells: [
        cell({ cell_id: "escape", adapter: { path: "tools//agents.sh", hash: adapterHash } }),
        ...validPlan().cells.slice(1),
      ],
    }).success,
    false,
  );
});

test("a non-varied property that differs is an undeclared confound", () => {
  // vary = ["provider", "model"]; prompt_language differs => confound.
  const promptConfound = validPlan();
  promptConfound.cells[0]!.prompt_language = "zh";
  assert.equal(CampaignPlanSchema.safeParse(promptConfound).success, false);

  // vary = ["provider", "model"]; parameters differ => confound.
  const parameterConfound = validPlan();
  parameterConfound.cells[0]!.parameters = { thinking: "high" };
  assert.equal(CampaignPlanSchema.safeParse(parameterConfound).success, false);

  // vary = ["provider", "model"]; adapter differs => confound.
  const adapterConfound = validPlan();
  adapterConfound.cells[1]!.adapter = { path: "tools/agents/other.sh", hash: hash("c") };
  assert.equal(CampaignPlanSchema.safeParse(adapterConfound).success, false);
});

test("campaign plans reject enabled isolation and credential parameters", () => {
  const enabledIsolation = validPlan();
  const raw = JSON.parse(JSON.stringify(enabledIsolation)) as Record<string, unknown>;
  const cells = raw.cells as Array<Record<string, unknown>>;
  cells[0]!.isolation = {
    session: true,
    context_files: false,
    extensions: false,
    skills: false,
  };
  assert.equal(CampaignPlanSchema.safeParse(raw).success, false);

  const credential = validPlan();
  credential.cells[0]!.parameters = { thinking: "medium", api_key: "not-allowed" };
  assert.equal(CampaignPlanSchema.safeParse(credential).success, false);
});

test("a declared vary property that does not differ is rejected", () => {
  // vary = ["model"] while model is constant and every other property stays
  // equal: the only violation is that the declared variance is absent.
  const noVariance = validPlan();
  noVariance.comparison.vary = ["model"];
  noVariance.cells = noVariance.cells.map((c) => ({
    ...c,
    provider: "openai-codex",
    model: "gpt-5.6-sol",
  }));
  assert.equal(CampaignPlanSchema.safeParse(noVariance).success, false);

  // vary = ["provider", "model"] but provider is constant across cells.
  const missingProviderVariance = validPlan();
  missingProviderVariance.cells = missingProviderVariance.cells.map((c) => ({
    ...c,
    provider: "openai-codex",
  }));
  assert.equal(CampaignPlanSchema.safeParse(missingProviderVariance).success, false);
});

test("campaign plan hashes are canonical and stable", () => {
  const plan = validPlan();
  assert.equal(campaignPlanHash(plan), campaignPlanHash(plan));
  assert.match(campaignPlanHash(plan), /^sha256:[a-f0-9]{64}$/);
  // Runner-facing aliases resolve to the same canonical helpers.
  assert.equal(hashCampaignPlan(plan), campaignPlanHash(plan));
  assert.equal(
    hashCampaignCellExecution(plan.cells[0]!),
    campaignCellExecutionSpecHash(plan.cells[0]!),
  );

  // The hash is stable across parse + serialize round trips.
  const roundTripped = CampaignPlanSchema.parse(JSON.parse(JSON.stringify(plan)));
  assert.equal(campaignPlanHash(roundTripped), campaignPlanHash(plan));

  // Reordering parameter keys does not change the canonical hash.
  const reordered = validPlan();
  reordered.cells[0]!.parameters = { confidence: 0.5, thinking: "medium" };
  const base = validPlan();
  base.cells[0]!.parameters = { thinking: "medium", confidence: 0.5 };
  assert.equal(campaignPlanHash(reordered), campaignPlanHash(base));

  // A single differing cell changes the plan hash.
  const changed = validPlan();
  changed.cells[0]!.model = "gpt-5.6-mini";
  assert.notEqual(campaignPlanHash(changed), campaignPlanHash(plan));
});

test("a plan may not embed its own hash (no self-hash)", () => {
  const plan = validPlan();
  // The hash is derivable but must not be stored inside the plan.
  const selfHash = campaignPlanHash(plan);
  assert.equal(
    CampaignPlanSchema.safeParse({ ...plan, plan_hash: selfHash }).success,
    false,
  );
  // Conversely a cell-level self-hash is equally forbidden.
  assert.equal(
    CampaignPlanSchema.safeParse({
      ...plan,
      cells: [{ ...plan.cells[0]!, execution_hash: campaignPlanHash(plan) }, ...plan.cells.slice(1)],
    }).success,
    false,
  );
});

test("per-cell execution spec hashes are canonical and stable", () => {
  const plan = validPlan();
  const [first, second] = plan.cells;
  assert.ok(first && second);

  const spec = campaignCellExecutionSpec(first);
  assert.deepEqual(spec, {
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
  });

  const specHash = campaignCellExecutionSpecHash(first);
  assert.equal(specHash, campaignCellExecutionSpecHash(first));
  assert.match(specHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(campaignCellExecutionSpecHash(second), campaignCellExecutionSpecHash(second));

  // Series identity does not leak into the execution spec.
  const sameConfig = { ...first, series_id: SERIES[0]! };
  const otherSeries = { ...first, series_id: SERIES[3]! };
  assert.equal(
    campaignCellExecutionSpecHash(sameConfig),
    campaignCellExecutionSpecHash(otherSeries),
  );
});

test("a campaign must bind a single release", () => {
  const plan = validPlan();
  assert.doesNotThrow(() =>
    assertCampaignRelease(plan, {
      benchmark_version: "0.6.0",
      release_hash: releaseHash,
    }),
  );
  assert.throws(
    () =>
      assertCampaignRelease(plan, {
        benchmark_version: "0.5.0",
        release_hash: releaseHash,
      }),
    /benchmark version/,
  );
  assert.throws(
    () =>
      assertCampaignRelease(plan, {
        benchmark_version: "0.6.0",
        release_hash: hash("z"),
      }),
    /release hash/,
  );
});

test("omitted cell defaults materialize and keep hashing deterministic", () => {
  // Omit optional `parameters` and `isolation`; defaults must be applied so a
  // parsed plan hashes deterministically.
  const relaxed = CampaignPlanSchema.parse({
    ...validPlan(),
    cells: validPlan().cells.map(({ parameters, isolation, ...cellRest }) => cellRest),
  });
  assert.equal(relaxed.cells.every((c) => c.isolation.session === false), true);
  assert.equal(relaxed.cells.every((c) => Object.keys(c.parameters).length === 0), true);
  assert.equal(campaignPlanHash(relaxed), campaignPlanHash(relaxed));
});
