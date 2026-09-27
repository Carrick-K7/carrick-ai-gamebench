import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findRepositoryRoot } from "@carrick/gamebench-core";
import { suiteBench, trySuiteCommand } from "../src/suite-cli.js";
import { readPrivatePlaySeedBundle } from "../src/play/seeds.js";
import { assertSecretFreeSuiteConfiguration } from "../src/suite-configuration.js";

const repository = findRepositoryRoot();

test("suite CLI rejects configuration and budget overrides before invoking an adapter", async () => {
  const root = await repository;
  await assert.rejects(suiteBench(root, ["--suite", "play", "--agent-command", "must-not-run"]), /Official bench/);
  await assert.rejects(suiteBench(root, ["--local", "--suite", "both", "--agent-command", "must-not-run"]), /build or play/);
  await assert.rejects(suiteBench(root, ["--local", "--suite", "play", "--agent-command", "must-not-run", "--slot-seconds", "5"]), /Unknown option/);
  await assert.rejects(suiteBench(root, ["--local", "--suite", "play", "--agent-command", "must-not-run", "--model-params", '{"nested":{"api_key":"private-value"}}']), /credential fields/);
  await assert.rejects(suiteBench(root, ["--campaign", "missing", "--cell", "first", "--model", "override"]), /configuration overrides/);
  await assert.rejects(trySuiteCommand(root, "publish", ["--run", "missing", "--engine-only"]), /browser replay/);
});

test("seed CLI emits only a commitment and creates a private non-overwritable external file", async () => {
  const root = await repository;
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cagb-seeds-cli-"));
  const output = path.join(temporary, "seeds.json");
  try {
    await trySuiteCommand(root, "play", ["seeds", "--output", output]);
    const bundle = await readPrivatePlaySeedBundle(output);
    assert.equal(bundle.tasks.length, 2);
    assert.ok(bundle.tasks.every((task) => task.seeds.length === 10));
    const before = await readFile(output, "utf8");
    await assert.rejects(trySuiteCommand(root, "play", ["seeds", "--output", output]), /EEXIST/);
    assert.equal(await readFile(output, "utf8"), before);
    await assert.rejects(trySuiteCommand(root, "play", ["seeds", "--output", path.join(root, "private-seeds.json")]), /outside the repository/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("credential guard rejects nested keys without mistaking token accounting for authentication", () => {
  for (const data of [{ api_key: "opaque" }, { nested: [{ authorization: "opaque" }] }, { access_token: "opaque" }]) assert.throws(() => assertSecretFreeSuiteConfiguration(data), /credential/);
  assert.doesNotThrow(() => assertSecretFreeSuiteConfiguration({ input_tokens: 1, output_tokens: 2, thinking: "off" }));
});
