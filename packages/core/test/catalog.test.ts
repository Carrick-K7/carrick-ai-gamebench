import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  LITE_EVALUATION_SEED,
  compareSemanticVersions,
  createLiteReleaseLock,
  findRepositoryRoot,
  listRetiredTasks,
  listTasks,
  resolveReleasedTasks,
} from "../src/index.js";

test("semantic releases sort by precedence rather than filename", () => {
  const versions = ["0.9.0", "0.10.0", "1.0.0-rc.2", "1.0.0", "1.0.0-rc.10"];
  assert.deepEqual(
    versions.sort(compareSemanticVersions),
    ["0.9.0", "0.10.0", "1.0.0-rc.2", "1.0.0-rc.10", "1.0.0"],
  );
});

test("the active v0.6 catalog contains four complementary Build tasks", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const tasks = await listTasks(repositoryRoot);
  assert.deepEqual(
    tasks.map((task) => task.manifest.id),
    [
      "build.2048.v2",
      "build.minesweeper.v2",
      "build.parking-2d.v2",
      "build.texas-holdem.v1",
    ],
  );
  assert.equal(tasks.every((task) => task.manifest.track === "build"), true);
});

test("every active task exposes and verifies the canonical run seed", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const tasks = await listTasks(repositoryRoot);

  for (const task of tasks) {
    const runSeedCase = task.suite.cases.find((testCase) => testCase.id === "run-seed");
    assert.equal(runSeedCase?.kind, "browser", `${task.manifest.id} needs run-seed`);
    if (!runSeedCase || runSeedCase.kind !== "browser") {
      continue;
    }
    assert.equal(
      runSeedCase.steps.some(
        (step) =>
          step.op === "expect" &&
          step.path === "seed" &&
          step.equals_run_seed === true,
      ),
      true,
    );
    assert.equal(
      runSeedCase.steps.some((step) => step.op === "reset" && step.seed === undefined),
      true,
    );
    const stateSchema = JSON.parse(
      await readFile(path.join(task.root, task.manifest.bridge.state_schema), "utf8"),
    ) as { required?: string[]; properties?: Record<string, { type?: string }> };
    assert.equal(stateSchema.required?.includes("seed"), true);
    assert.equal(stateSchema.properties?.seed?.type, "integer");
  }
});

test("Texas Hold'em covers non-reopening, odd pots, and an ordinary seeded hand", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const poker = (await listTasks(repositoryRoot)).find(
    (task) => task.manifest.id === "build.texas-holdem.v1",
  );
  assert.ok(poker);
  const shortAllIn = poker.suite.cases.find((testCase) => testCase.id === "short-allin");
  const split = poker.suite.cases.find((testCase) => testCase.id === "split-conservation");
  const runSeed = poker.suite.cases.find((testCase) => testCase.id === "run-seed");
  assert.equal(shortAllIn?.kind, "browser");
  assert.equal(split?.kind, "browser");
  assert.equal(runSeed?.kind, "browser");
  if (shortAllIn?.kind === "browser") {
    assert.equal(
      shortAllIn.steps.some(
        (step) => step.op === "expect" && step.path === "state.legal.canAllIn" && step.equals === false,
      ),
      true,
    );
    assert.equal(
      shortAllIn.steps.some(
        (step) => step.op === "expect" && step.path === "state.phase" && step.equals === "complete",
      ),
      true,
    );
  }
  if (split?.kind === "browser") {
    assert.equal(
      split.steps.some(
        (step) =>
          step.op === "expect" &&
          step.path === "state.showdown.payouts.0" &&
          JSON.stringify(step.equals) === JSON.stringify({ seat: 1, amount: 2, potIndex: 0 }),
      ),
      true,
    );
  }
  if (runSeed?.kind === "browser") {
    assert.equal(
      runSeed.steps.some(
        (step) => step.op === "expect" && step.path === "state.scenario" && step.equals === "default",
      ),
      true,
    );
    assert.equal(
      runSeed.steps.some(
        (step) => step.op === "expect" && step.path === "state.deckRemaining" && step.equals === 40,
      ),
      true,
    );
  }
});

test("the v0.6 release freezes exactly four task hashes and one seed", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const lock = createLiteReleaseLock("0.6.0", await listTasks(repositoryRoot));
  assert.equal(lock.tasks.length, 4);
  assert.equal(new Set(lock.tasks.map((task) => task.hash)).size, 4);
  assert.equal(lock.evaluation_seed, LITE_EVALUATION_SEED);
  assert.equal(lock.agent_invocations_per_task, 1);
  assert.equal(lock.scoring.primary_board, "build");
});

test("retired releases still resolve their exact task sources", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const retired = await listRetiredTasks(repositoryRoot);
  assert.equal(retired.length, 21);
  assert.equal(retired.some((task) => task.manifest.id === "reproduce.radius-raid.v2"), true);

  for (const version of [
    "0.1.0",
    "0.1.1",
    "0.1.2",
    "0.2.0",
    "0.3.0",
    "0.4.0",
    "0.5.0",
  ]) {
    const release = JSON.parse(
      await readFile(
        path.join(repositoryRoot, "benchmark", "releases", `${version}.json`),
        "utf8",
      ),
    ) as {
      tasks: Array<{
        id: string;
        version: string;
        track: "build" | "reproduce";
        hash: string;
      }>;
    };
    const resolved = await resolveReleasedTasks(release, repositoryRoot);
    assert.equal(
      resolved.every((task) => task.source?.hash === task.hash),
      true,
      `release ${version} must retain every task source`,
    );
  }
});
