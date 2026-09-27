import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  ReleaseLockV4Schema,
  createLiteReleaseLock,
  createReleaseLockV4,
  readReleaseLock,
  type ReleaseLockV4,
} from "../src/index.js";
import { findRepositoryRoot } from "../src/tasks.js";
import type { LoadedPlayTask } from "../src/play-tasks.js";
import type { LoadedTask } from "../src/tasks.js";

const hash = (input: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(input).digest("hex")}`;

const BUILD_IDS = [
  "build.2048.v2",
  "build.minesweeper.v2",
  "build.parking-2d.v2",
  "build.texas-holdem.v1",
];

function buildManifest(id = "build.2048.v2", track = "build") {
  return {
    schema_version: 1,
    id,
    version: "2.0.0",
    title: { en: "2048", zh: "2048" },
    track,
    level: 1,
    prompt: { en: "prompt.en.md", zh: "prompt.zh.md" },
    starter: "vite-ts",
    budget_seconds: 3600,
    network_policy: "full",
    runtime: {
      node: "22",
      package_manager: "pnpm",
      port: 4173,
      viewport: [1280, 720],
      device_scale_factor: 1,
    },
    test_suite: "tests/cases.json",
    bridge: { version: "1", state_schema: "state.schema.json" },
    tests: [
      { id: "build", category: "build", points: 5, case: "build" },
      { id: "mechanics", category: "mechanics", points: 95, case: "mechanics" },
    ],
  };
}

function loadedBuild(id: string): LoadedTask {
  return {
    root: "/tmp",
    manifestPath: "/tmp/task.yml",
    manifest: buildManifest(id) as never,
    suite: null as never,
    hash: hash(id),
  };
}

function loadedPlay(id: string, game: "2048" | "minesweeper"): LoadedPlayTask {
  const manifest = {
    schema_version: 1,
    id,
    version: "1.0.0",
    title: { en: game, zh: game },
    suite: "play",
    game,
    engine: "engine.mjs",
    renderer: "renderer.mjs",
    prompt: { en: "prompt.en.md", zh: "prompt.zh.md" },
    episodes: 10,
    max_decisions: game === "2048" ? 200 : 128,
    viewport: [1280, 720],
    device_scale_factor: 1,
    primary_metric: game === "2048" ? "mean_score" : "win_rate",
    license: "Apache-2.0",
  };
  return {
    root: "/tmp",
    manifestPath: "/tmp/task.yml",
    manifest: manifest as never,
    hash: hash(id),
    files: ["task.yml", "engine.mjs", "renderer.mjs"],
  };
}

function buildTasks(): { id: string; version: string; hash: string }[] {
  return BUILD_IDS.map((id) => ({ id, version: "2.0.0", hash: hash(id) }));
}

function validLock(): ReleaseLockV4 {
  return ReleaseLockV4Schema.parse({
    schema_version: 4,
    benchmark: "carrick-ai-gamebench",
    benchmark_version: "0.7.0",
    protocols: {
      task_manifest: 1,
      play_task_manifest: 1,
      bridge: 1,
      runner_protocol: 4,
    },
    suites: {
      build: {
        evaluation_seed: 104729,
        agent_invocations_per_task: 1,
        scoring: { primary_board: "build", task_weighting: "equal" },
        tasks: buildTasks(),
      },
      play: {
        config: {
          protocol: "play-visual-v1", observation: "screenshot-png", action_space: "native-keyboard-mouse",
          viewport: [1280, 720], device_scale_factor: 1, history_length: 8,
          transport_retries: 1, seed_policy: "committed-distinct-uint32-per-game",
          episodes: 10,
          slot_seconds: 60,
          memo_max_bytes: 1024,
          invalid_response_stop: 3,
        },
        task_count: 2,
        tasks: [
          {
            id: "play.2048.v1",
            version: "1.0.0",
            game: "2048",
            hash: hash("b"),
            episodes: 10,
            max_decisions: 200,
            primary_metric: "mean_score",
          },
          { id: "play.minesweeper.v1", version: "1.0.0", game: "minesweeper", hash: hash("m"), episodes: 10, max_decisions: 128, primary_metric: "win_rate" },
        ],
      },
    },
  });
}

test("release v4 build suite is an exact v0.6 Lite instrument (4 build, seed 104729)", () => {
  const lock = validLock();
  assert.equal(lock.schema_version, 4);
  assert.equal(lock.suites.build.evaluation_seed, 104729);
  assert.equal(lock.suites.build.agent_invocations_per_task, 1);
  assert.deepEqual(lock.suites.build.scoring, {
    primary_board: "build",
    task_weighting: "equal",
  });
  assert.equal(lock.suites.build.tasks.length, 4);
  assert.ok(lock.suites.build.tasks.every((task) => task.id.startsWith("build.")));
  // No Reproduce track, no v0.5 three-seed set, no per-task track field.
  assert.ok(!("track" in lock.suites.build.tasks[0]!));
  assert.ok(!("official" in lock.suites.build));
  assert.ok(!("config" in lock.suites.build));
});

test("release v4 build suite rejects reproduce ids and non-four task sets", () => {
  const reproduce = validLock();
  reproduce.suites.build.tasks[0] = {
    ...reproduce.suites.build.tasks[0]!,
    id: "reproduce.2048.v2",
  };
  assert.equal(ReleaseLockV4Schema.safeParse(reproduce).success, false);

  const three = validLock();
  three.suites.build.tasks = three.suites.build.tasks.slice(0, 3);
  assert.equal(ReleaseLockV4Schema.safeParse(three).success, false);
});

test("release v4 rejects cross-suite and per-game inconsistencies", () => {
  assert.equal(
    ReleaseLockV4Schema.safeParse({
      ...validLock(),
      suites: {
        ...validLock().suites,
        play: {
          ...validLock().suites.play,
          tasks: [
            {
              ...validLock().suites.play.tasks[0],
              id: "play.minesweeper.v1",
              game: "minesweeper",
            },
          ],
        },
      },
    }).success,
    false,
  );
  assert.equal(
    ReleaseLockV4Schema.safeParse({
      ...validLock(),
      suites: {
        ...validLock().suites,
        play: {
          ...validLock().suites.play,
          tasks: [{ ...validLock().suites.play.tasks[0], max_decisions: 128 }],
        },
      },
    }).success,
    false,
  );
  // A task id may not appear in both suites.
  assert.equal(
    ReleaseLockV4Schema.safeParse({
      ...validLock(),
      suites: {
        ...validLock().suites,
        play: {
          ...validLock().suites.play,
          tasks: [
            { ...validLock().suites.play.tasks[0], id: "build.2048.v2" },
          ],
        },
      },
    }).success,
    false,
  );
});

test("createReleaseLockV4 projects the Build suite exactly from the Lite instrument", () => {
  const loaded = BUILD_IDS.map((id) => loadedBuild(id));
  const lock = createReleaseLockV4(
    "0.7.0",
    loaded,
    [loadedPlay("play.2048.v1", "2048"), loadedPlay("play.minesweeper.v1", "minesweeper")],
  );
  const lite = createLiteReleaseLock("0.7.0", loaded);
  assert.equal(lock.suites.build.evaluation_seed, lite.evaluation_seed);
  assert.equal(lock.suites.build.agent_invocations_per_task, lite.agent_invocations_per_task);
  assert.deepEqual(lock.suites.build.scoring, lite.scoring);
  assert.deepEqual(
    lock.suites.build.tasks,
    lite.tasks.map((task) => ({ id: task.id, version: task.version, hash: task.hash })),
  );
  assert.equal(lock.suites.build.tasks[0]!.id, "build.2048.v2");
  assert.equal(lock.suites.play.tasks[0]!.id, "play.2048.v1");
  assert.equal(lock.suites.play.tasks[1]!.id, "play.minesweeper.v1");
});

test("readReleaseLock dispatches by exact schema_version and shape", () => {
  const lock = validLock();
  assert.equal(readReleaseLock(lock).schema_version, 4);
  assert.throws(() => readReleaseLock({ schema_version: 99 }), /Unrecognized release lock/);
});

test("readReleaseLock parses every historical benchmark release file", async () => {
  const root = await findRepositoryRoot();
  const releasesDir = path.join(root, "benchmark", "releases");
  const files = (await readdir(releasesDir)).filter((name) => name.endsWith(".json"));
  assert.ok(files.length > 0, "found release lock files");
  for (const name of files) {
    const raw = await readFile(path.join(releasesDir, name), "utf8");
    assert.doesNotThrow(
      () => readReleaseLock(JSON.parse(raw)),
      `could not parse release ${name}`,
    );
  }
});
