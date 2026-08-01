import assert from "node:assert/strict";
import test from "node:test";

import {
  sampleIndexForRun,
  sampleLetter,
  sortRunsForPresentation,
} from "../src/lib/presentation.ts";

const runs = [
  { run_id: "run-c", seed: 155921 },
  { run_id: "run-a", seed: 104729 },
  { run_id: "run-b", seed: 130363 },
];

test("sample labels keep the default showcase first without exposing seed values", () => {
  const ordered = sortRunsForPresentation(runs);
  assert.deepEqual(ordered.map(({ run_id }) => run_id), ["run-a", "run-b", "run-c"]);
  assert.equal(sampleLetter(sampleIndexForRun(runs, "run-a")), "A");
  assert.equal(sampleLetter(sampleIndexForRun(runs, "run-b")), "B");
  assert.equal(sampleLetter(sampleIndexForRun(runs, "run-c")), "C");
});

test("sample labels stay stable beyond the public three-sample matrix", () => {
  assert.equal(sampleLetter(25), "Z");
  assert.equal(sampleLetter(26), "27");
});
