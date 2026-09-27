import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadPlayTasks,
  validatePlayTask,
} from "../src/index.js";

const TASK_YAML = `schema_version: 1
id: play.2048.v1
version: 1.0.0
title:
  en: "2048"
  zh: "2048"
suite: play
game: "2048"
engine: engine.mjs
renderer: renderer.mjs
prompt:
  en: prompt.en.md
  zh: prompt.zh.md
episodes: 10
max_decisions: 200
viewport: [1280, 720]
device_scale_factor: 1
primary_metric: mean_score
license: Apache-2.0
`;

async function writePlayTask(root: string, manifestYaml = TASK_YAML) {
  const rootDir = path.join(root, "benchmark", "play", "2048", "v1");
  await mkdir(rootDir, { recursive: true });
  await writeFile(path.join(rootDir, "task.yml"), manifestYaml, "utf8");
  await writeFile(path.join(rootDir, "engine.mjs"), "export {}", "utf8");
  await writeFile(path.join(rootDir, "renderer.mjs"), "export {}", "utf8");
  await writeFile(path.join(rootDir, "prompt.en.md"), "# prompt", "utf8");
  await writeFile(path.join(rootDir, "prompt.zh.md"), "# 说明", "utf8");
  await writeFile(path.join(rootDir, "LICENSE"), "Apache-2.0\n", "utf8");
  return rootDir;
}

test("validatePlayTask accepts a canonical 2048 package and hashes all files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cagb-play-"));
  try {
    const rootDir = await writePlayTask(root);
    const result = await validatePlayTask(path.join(rootDir, "task.yml"));
    assert.equal(result.valid, true);
    assert.ok(result.task);
    assert.match(result.task!.hash, /^sha256:[a-f0-9]{64}$/);
    assert.ok(result.task!.files.includes("engine.mjs"));
    assert.ok(result.task!.files.includes("task.yml"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validatePlayTask rejects wrong directory layout and missing files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cagb-play-"));
  try {
    const rootDir = await writePlayTask(root);
    // Missing required engine file.
    await rm(path.join(rootDir, "engine.mjs"));
    const missing = await validatePlayTask(path.join(rootDir, "task.yml"));
    assert.equal(missing.valid, false);
    assert.ok(missing.errors.some((error) => error.includes("missing play task file")));

    // Wrong parent directory layout (not under play/<game>/v1).
    const wrongLayout = path.join(root, "benchmark", "play", "2048", "v2");
    await mkdir(wrongLayout, { recursive: true });
    await writeFile(path.join(wrongLayout, "task.yml"), TASK_YAML, "utf8");
    const invalidLayout = await validatePlayTask(path.join(wrongLayout, "task.yml"));
    assert.equal(invalidLayout.valid, false);
    assert.ok(
      invalidLayout.errors.some((error) =>
        error.includes("directory must end in v1"),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validatePlayTask rejects a missing LICENSE file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cagb-play-"));
  try {
    const rootDir = await writePlayTask(root);
    await rm(path.join(rootDir, "LICENSE"));
    const result = await validatePlayTask(path.join(rootDir, "task.yml"));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("missing play task file: LICENSE")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validatePlayTask rejects a symlinked engine even though the path exists", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cagb-play-"));
  try {
    const rootDir = await writePlayTask(root);
    await rm(path.join(rootDir, "engine.mjs"));
    await symlink("prompt.en.md", path.join(rootDir, "engine.mjs"));
    const result = await validatePlayTask(path.join(rootDir, "task.yml"));
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((error) => error.includes("symlink is not allowed")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadPlayTasks loads and sorts every canonical play package", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cagb-play-"));
  try {
    await writePlayTask(root);
    const rootDir = path.join(root, "benchmark", "play", "2048", "v1");
    await writeFile(path.join(rootDir, "task.yml"), TASK_YAML, "utf8");
    const tasks = await loadPlayTasks(root);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]!.manifest.id, "play.2048.v1");
    assert.equal(tasks[0]!.manifest.primary_metric, "mean_score");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
