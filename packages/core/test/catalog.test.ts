import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  createReleaseLock,
  findRepositoryRoot,
  listTasks,
} from "../src/index.js";

test("the active v2 catalog contains the eight Build and Reproduce tasks", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const tasks = await listTasks(repositoryRoot);
  assert.equal(tasks.length, 8);
  assert.equal(
    tasks.filter((task) => task.manifest.track === "build").length,
    6,
  );
  assert.equal(
    tasks.filter((task) => task.manifest.track === "reproduce").length,
    2,
  );
  assert.deepEqual(
    [...new Set(tasks.map((task) => task.manifest.track))].sort(),
    ["build", "reproduce"],
  );
  assert.equal(
    tasks.every(
      (task) =>
        task.manifest.id.endsWith(".v2") &&
        task.manifest.version === "2.0.0",
    ),
    true,
  );
});

test("every active v2 task exposes and verifies the applied run seed", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const tasks = await listTasks(repositoryRoot);

  for (const task of tasks) {
    const runSeedCase = task.suite.cases.find(
      (testCase) => testCase.id === "run-seed",
    );
    assert.equal(
      runSeedCase?.kind,
      "browser",
      `${task.manifest.id} must define a browser run-seed case`,
    );
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
      `${task.manifest.id} must compare snapshot.seed with the run seed`,
    );
    assert.equal(
      task.suite.cases.some(
        (testCase) =>
          testCase.kind === "browser" &&
          testCase.steps.some(
            (step) => step.op === "reset" && step.seed === undefined,
          ),
      ),
      true,
      `${task.manifest.id} must contain a reset driven by the active run seed`,
    );

    const stateSchema = JSON.parse(
      await readFile(
        path.join(task.root, task.manifest.bridge.state_schema),
        "utf8",
      ),
    ) as {
      required?: string[];
      properties?: Record<string, { type?: string }>;
    };
    assert.equal(
      stateSchema.required?.includes("seed"),
      true,
      `${task.manifest.id} must require snapshot.seed`,
    );
    assert.equal(stateSchema.properties?.seed?.type, "integer");
  }
});

test("a release lock freezes every task hash", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const lock = createReleaseLock(
    "0.3.0",
    await listTasks(repositoryRoot),
  );
  assert.equal(lock.task_count, 8);
  assert.equal(new Set(lock.tasks.map((task) => task.hash)).size, 8);
  assert.deepEqual(lock.tracks, ["build", "reproduce"]);
  assert.equal(lock.scoring.aggregate, 2);
});
