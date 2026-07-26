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
