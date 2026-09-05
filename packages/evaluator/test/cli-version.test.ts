import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LITE_BENCHMARK_VERSION } from "@carrick/gamebench-core";

for (const flag of ["--version", "-V"]) {
  test(`CLI ${flag} reports the release without requiring a repository cwd`, () => {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("../src/cli.js", import.meta.url)), flag,
    ], { cwd: os.tmpdir(), encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), LITE_BENCHMARK_VERSION);
  });
}
