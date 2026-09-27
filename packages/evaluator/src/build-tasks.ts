import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  summarizeLiteBuild, writeJson,
  type LiteTaskResult, type LoadedTask,
} from "@carrick/gamebench-core";

/** The unchanged Build batch policy: try each task once, retain all failures,
 * and never turn an incomplete/infrastructure-failed batch into a score.
 * Result envelopes and Campaign generations belong to the caller.
 */
export async function runBuildTaskBatch(
  tasks: LoadedTask[],
  runDir: string,
  runTask: (task: LoadedTask) => Promise<LiteTaskResult>,
) {
  const results: LiteTaskResult[] = [];
  const errors: Array<{ task_id: string; message: string }> = [];
  for (const task of tasks) {
    try {
      results.push(await runTask(task));
    } catch (error) {
      const failure = {
        task_id: task.manifest.id,
        message: error instanceof Error ? error.message : String(error),
      };
      errors.push(failure);
      const taskDir = path.join(runDir, "tasks", task.manifest.id.replaceAll("/", "-"));
      await mkdir(taskDir, { recursive: true });
      await writeJson(path.join(taskDir, "task-error.json"), failure);
    }
  }
  const build = summarizeLiteBuild(results);
  if (errors.length || build.score === undefined) {
    await writeJson(path.join(runDir, "benchmark-error.json"), {
      schema_version: 1,
      series_id: path.basename(runDir),
      completed_tasks: results,
      errors: errors.length ? errors : [{ message: "one or more evaluations exhausted infrastructure retries" }],
    });
    throw new Error(errors.length
      ? `benchmark could not produce a complete result: ${errors.map((error) => error.task_id).join(", ")}`
      : "benchmark could not produce a complete scored series");
  }
  return { tasks: results, build };
}
