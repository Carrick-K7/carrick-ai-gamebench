import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCommand } from "../src/process.js";

test("runCommand captures stdout and stderr separately", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cagb-process-"));
  const stdout = path.join(root, "stdout.log");
  const stderr = path.join(root, "stderr.log");
  const result = await runCommand(
    "node",
    ["-e", "console.log('out'); console.error('err')"],
    {
      cwd: root,
      stdoutPath: stdout,
      stderrPath: stderr,
      timeoutMs: 5_000,
    },
  );
  assert.equal(result.exitCode, 0);
  assert.match(await readFile(stdout, "utf8"), /out/);
  assert.match(await readFile(stderr, "utf8"), /err/);
});
