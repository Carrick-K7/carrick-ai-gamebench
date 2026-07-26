import { z } from "zod";
import { HashRefSchema, SemverSchema, TrackSchema } from "./schema.js";
import type { LoadedTask } from "./tasks.js";

export const ReleaseLockV1Schema = z.strictObject({
  schema_version: z.literal(1),
  benchmark: z.literal("carrick-ai-gamebench"),
  benchmark_version: SemverSchema,
  protocols: z.strictObject({
    task_manifest: z.literal(1),
    bridge: z.literal(1),
  }),
  tracks: z.tuple([z.literal("build"), z.literal("reproduce")]),
  task_count: z.number().int().nonnegative(),
  tasks: z.array(
    z.strictObject({
      id: z.string().min(1),
      version: z.string().regex(/^\d+\.\d+\.\d+$/),
      track: TrackSchema,
      hash: HashRefSchema,
    }),
  ),
});

export const ReleaseLockV2Schema = z.strictObject({
  schema_version: z.literal(2),
  benchmark: z.literal("carrick-ai-gamebench"),
  benchmark_version: SemverSchema,
  protocols: z.strictObject({
    task_manifest: z.literal(1),
    bridge: z.literal(1),
    run_manifest: z.literal(2),
    publication_manifest: z.literal(1),
  }),
  scoring: z.strictObject({
    score_result: z.literal(1),
    aggregate: z.union([z.literal(1), z.literal(2)]),
  }),
  official: z.strictObject({
    attempts_per_task: z.literal(3),
    seeds: z.tuple([z.literal(104729), z.literal(130363), z.literal(155921)]),
  }),
  tracks: z.tuple([z.literal("build"), z.literal("reproduce")]),
  task_count: z.number().int().nonnegative(),
  tasks: z.array(
    z.strictObject({
      id: z.string().min(1),
      version: z.string().regex(/^\d+\.\d+\.\d+$/),
      track: TrackSchema,
      hash: HashRefSchema,
    }),
  ),
});

export const ReleaseLockSchema = z.discriminatedUnion("schema_version", [
  ReleaseLockV1Schema,
  ReleaseLockV2Schema,
]);

export type ReleaseLock = z.infer<typeof ReleaseLockSchema>;
export type ReleaseLockV2 = z.infer<typeof ReleaseLockV2Schema>;

function semverParts(version: string): {
  core: [number, number, number];
  prerelease: string[];
} {
  const [coreValue, prereleaseValue] = version.split("-", 2);
  const core = (coreValue ?? "").split(".").map(Number);
  if (
    core.length !== 3 ||
    core.some((part) => !Number.isInteger(part) || part < 0)
  ) {
    throw new Error(`invalid semantic version: ${version}`);
  }
  return {
    core: [core[0] ?? 0, core[1] ?? 0, core[2] ?? 0],
    prerelease: prereleaseValue?.split(".") ?? [],
  };
}

/**
 * Compare two validated semantic versions in ascending precedence order.
 */
export function compareSemanticVersions(left: string, right: string): number {
  const a = semverParts(left);
  const b = semverParts(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length
      ? 0
      : a.prerelease.length === 0
        ? 1
        : -1;
  }
  const maximum = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < maximum; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) {
      continue;
    }
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      return Number(leftPart) - Number(rightPart);
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

export function createReleaseLock(
  benchmarkVersion: string,
  loadedTasks: LoadedTask[],
): ReleaseLockV2 {
  const tasks = loadedTasks
    .map((task) => ({
      id: task.manifest.id,
      version: task.manifest.version,
      track: task.manifest.track,
      hash: task.hash,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return ReleaseLockV2Schema.parse({
    schema_version: 2,
    benchmark: "carrick-ai-gamebench",
    benchmark_version: benchmarkVersion,
    protocols: {
      task_manifest: 1,
      bridge: 1,
      run_manifest: 2,
      publication_manifest: 1,
    },
    scoring: {
      score_result: 1,
      aggregate: 2,
    },
    official: {
      attempts_per_task: 3,
      seeds: [104729, 130363, 155921],
    },
    tracks: ["build", "reproduce"],
    task_count: tasks.length,
    tasks,
  });
}
