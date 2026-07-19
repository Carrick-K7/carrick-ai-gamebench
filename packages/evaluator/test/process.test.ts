import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  findAvailablePort,
  runCommand,
} from "../src/process.js";

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

test("findAvailablePort returns a bindable loopback port", async () => {
  const port = await findAvailablePort();
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});
