import assert from "node:assert/strict";
import test from "node:test";
import {
  createReleaseLock,
  findRepositoryRoot,
  listTasks,
} from "../src/index.js";

test("the v1 catalog contains the eight Build and Reproduce tasks", async () => {
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
});

test("a release lock freezes every task hash", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const lock = createReleaseLock(
    "1.0.0-alpha.1",
    await listTasks(repositoryRoot),
  );
  assert.equal(lock.task_count, 8);
  assert.equal(new Set(lock.tasks.map((task) => task.hash)).size, 8);
  assert.deepEqual(lock.tracks, ["build", "reproduce"]);
});
