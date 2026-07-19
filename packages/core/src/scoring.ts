import type {
  AggregateResult,
  AggregateTaskResult,
  JsonValue,
  ScoreResult,
  TaskManifest,
  TestOutcome,
  Track,
} from "./schema.js";

export interface TaskAttempt {
  task: TaskManifest;
  score: ScoreResult;
}

export function scoreResultIdentity(score: ScoreResult): JsonValue {
  return {
    schema_version: score.schema_version,
    task_id: score.task_id,
    task_hash: score.task_hash,
    earned: score.earned,
    available: score.available,
    percent: score.percent,
    hard_gate_failed: score.hard_gate_failed,
    categories: score.categories,
    tests: score.tests.map((test) => ({
      id: test.id,
      category: test.category,
      points: test.points,
      passed: test.passed,
    })),
  };
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function scoreTask(
  task: TaskManifest,
  taskHash: string,
  outcomes: TestOutcome[],
): ScoreResult {
  const outcomeById = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
  const hardGateFailed = task.tests
    .filter((test) => test.category === "build")
    .some((test) => outcomeById.get(test.id)?.passed !== true);
  const categories: ScoreResult["categories"] = {};
  const tests: ScoreResult["tests"] = task.tests.map((definition) => {
    const outcome = outcomeById.get(definition.id);
    const category = categories[definition.category] ?? {
      earned: 0,
      available: 0,
    };
    category.available += definition.points;
    if (outcome?.passed && !hardGateFailed) {
      category.earned += definition.points;
    }
    categories[definition.category] = category;

    return {
      id: definition.id,
      category: definition.category,
      points: definition.points,
      passed: Boolean(outcome?.passed) && !hardGateFailed,
      duration_ms: outcome?.duration_ms ?? 0,
      ...(outcome?.message ? { message: outcome.message } : {}),
      artifacts: outcome?.artifacts ?? [],
    };
  });

  const available = task.tests.reduce((sum, test) => sum + test.points, 0);
  const earned = hardGateFailed
    ? 0
    : tests.reduce((sum, test) => sum + (test.passed ? test.points : 0), 0);

  return {
    schema_version: 1,
    task_id: task.id,
    task_hash: taskHash,
    earned: round(earned),
    available: round(available),
    percent: round((earned / available) * 100),
    hard_gate_failed: hardGateFailed,
    categories,
    tests,
  };
}

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const average = mean(values);
  return Math.sqrt(
    mean(values.map((value) => (value - average) ** 2)),
  );
}

export function aggregateAttempts(
  attempts: TaskAttempt[],
  expectedTasks: TaskManifest[],
): AggregateResult {
  const grouped = new Map<string, TaskAttempt[]>();
  for (const attempt of attempts) {
    const current = grouped.get(attempt.task.id) ?? [];
    current.push(attempt);
    grouped.set(attempt.task.id, current);
  }

  const tasks: AggregateTaskResult[] = [...grouped.values()]
    .map((group) => {
      const values = group.map((attempt) => attempt.score.percent);
      const first = group[0];
      if (!first) {
        throw new Error("Unexpected empty aggregate group");
      }
      return {
        task_id: first.task.id,
        track: first.task.track,
        attempts: values.length,
        mean: round(mean(values)),
        standard_deviation: round(standardDeviation(values)),
      };
    })
    .sort((left, right) => left.task_id.localeCompare(right.task_id));

  const trackMean = (track: Track): number | undefined => {
    const values = tasks
      .filter((task) => task.track === track)
      .map((task) => task.mean);
    return values.length > 0 ? round(mean(values)) : undefined;
  };

  const expectedBuildIds = new Set(
    expectedTasks
      .filter((task) => task.track === "build")
      .map((task) => task.id),
  );
  const expectedReproduceIds = new Set(
    expectedTasks
      .filter((task) => task.track === "reproduce")
      .map((task) => task.id),
  );
  const completedTaskIds = new Set(tasks.map((task) => task.task_id));
  const completedBuild = [...expectedBuildIds].filter((id) =>
    completedTaskIds.has(id),
  ).length;
  const completedReproduce = [...expectedReproduceIds].filter((id) =>
    completedTaskIds.has(id),
  ).length;
  const completedCore = completedBuild + completedReproduce;
  const requiredCore = expectedBuildIds.size + expectedReproduceIds.size;

  const build =
    expectedBuildIds.size > 0 && completedBuild === expectedBuildIds.size
      ? trackMean("build")
      : undefined;
  const reproduce =
    expectedReproduceIds.size > 0 &&
    completedReproduce === expectedReproduceIds.size
      ? trackMean("reproduce")
      : undefined;
  const coreValues = tasks
    .filter((task) => task.track === "build" || task.track === "reproduce")
    .map((task) => task.mean);

  return {
    schema_version: 1,
    tasks,
    coverage: {
      build: { completed: completedBuild, required: expectedBuildIds.size },
      reproduce: {
        completed: completedReproduce,
        required: expectedReproduceIds.size,
      },
      core: { completed: completedCore, required: requiredCore },
    },
    leaderboards: {
      ...(build === undefined ? {} : { build }),
      ...(reproduce === undefined ? {} : { reproduce }),
      ...(requiredCore === 0 || completedCore !== requiredCore
        ? {}
        : { core: round(mean(coreValues)) }),
    },
  };
}
