import { z } from "zod";
import { TrackSchema } from "./schema.js";
import type { LoadedTask } from "./tasks.js";

const BenchmarkVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

export const ReleaseLockSchema = z.strictObject({
  schema_version: z.literal(1),
  benchmark: z.literal("carrick-ai-gamebench"),
  benchmark_version: BenchmarkVersionSchema,
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
      hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    }),
  ),
});

export type ReleaseLock = z.infer<typeof ReleaseLockSchema>;

export function createReleaseLock(
  benchmarkVersion: string,
  loadedTasks: LoadedTask[],
): ReleaseLock {
  const tasks = loadedTasks
    .map((task) => ({
      id: task.manifest.id,
      version: task.manifest.version,
      track: task.manifest.track,
      hash: task.hash,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return ReleaseLockSchema.parse({
    schema_version: 1,
    benchmark: "carrick-ai-gamebench",
    benchmark_version: benchmarkVersion,
    protocols: {
      task_manifest: 1,
      bridge: 1,
    },
    tracks: ["build", "reproduce"],
    task_count: tasks.length,
    tasks,
  });
}
