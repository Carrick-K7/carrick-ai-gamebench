import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadTask,
  validateTaskManifest,
  type TaskManifest,
  type TestSuite,
} from "../src/index.js";

async function validateMutation(
  mutate: (manifest: TaskManifest, suite: TestSuite) => void,
) {
  const source = await loadTask("build.2048.v2");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cagb-task-validation-"));
  const root = path.join(temporary, "build", "2048", "v2");
  try {
    await cp(source.root, root, { recursive: true });
    const manifest = structuredClone(source.manifest);
    const suite = structuredClone(source.suite);
    mutate(manifest, suite);
    // JSON is also valid YAML; no frozen repository contract is modified.
    await writeFile(path.join(root, "task.yml"), JSON.stringify(manifest));
    await writeFile(path.join(root, manifest.test_suite), JSON.stringify(suite));
    return await validateTaskManifest(path.join(root, "task.yml"));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

test("task validation accepts an unchanged scoring-to-case mapping", async () => {
  const result = await validateMutation(() => {});
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("task validation rejects duplicated and orphaned scoring coverage", async () => {
  const result = await validateMutation((manifest) => {
    manifest.tests.find((entry) => entry.id === "valid-spawn")!.case = "merge-once";
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("case merge-once is scored more than once"));
  assert.ok(result.errors.includes("case valid-spawn has no scored test"));
});

test("task validation rejects browser/build gate swaps even with valid totals", async () => {
  const result = await validateMutation((manifest) => {
    manifest.tests.find((entry) => entry.id === "build")!.case = "merge-once";
    manifest.tests.find((entry) => entry.id === "merge-once")!.case = "build";
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.filter((error) => error.includes("build category")).length, 2);
});

test("task validation rejects unscored cases that the evaluator would execute", async () => {
  const result = await validateMutation((_manifest, suite) => {
    suite.cases.push({
      id: "unscored", kind: "browser", description: "Invisible failure",
      steps: [{ op: "expect", path: "score", equals: 0 }],
    });
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("case unscored has no scored test"));
});

test("task validation rejects duplicate cases before a result Map can overwrite them", async () => {
  const result = await validateMutation((_manifest, suite) => {
    suite.cases.push(structuredClone(suite.cases[0]!));
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("duplicate case id: build")));
});

test("task validation still rejects references to missing cases", async () => {
  const result = await validateMutation((manifest) => {
    manifest.tests[0]!.case = "missing";
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("test build references missing case missing"));
});
