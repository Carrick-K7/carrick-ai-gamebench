import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  findRepositoryRoot,
  loadTask,
} from "@carrick/gamebench-core";
import { prepareSubmissionWorkspace } from "../src/runner.js";

test("submission workspace includes the public state schema", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const task = await loadTask("build.2048.v1", repositoryRoot);
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "cagb-runner-"));
  const workspace = path.join(temporaryRoot, "workspace");
  try {
    const schemaPath = await prepareSubmissionWorkspace(
      repositoryRoot,
      task,
      workspace,
    );
    assert.equal(schemaPath, path.join(workspace, "state.schema.json"));
    assert.deepEqual(
      JSON.parse(await readFile(schemaPath, "utf8")),
      JSON.parse(
        await readFile(path.join(task.root, "state.schema.json"), "utf8"),
      ),
    );
    await assert.rejects(access(path.join(workspace, "node_modules")));
    await assert.rejects(access(path.join(workspace, "dist")));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
