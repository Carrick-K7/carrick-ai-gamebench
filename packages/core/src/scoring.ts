import type {
  AggregateResultV2,
  AggregateResultV3,
  AggregateTaskResult,
  AggregateTaskResultV3,
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

function assertNumberEqual(actual: number, expected: number, label: string): void {
  const canonical = round(expected);
  if (actual !== canonical) {
    throw new Error(`${label} mismatch: expected ${canonical}, received ${actual}`);
  }
}

/** Assert that a score is the exact arithmetic projection of its frozen task. */
export function assertScoreResult(
  task: TaskManifest,
  taskHash: string,
  score: ScoreResult,
): void {
  if (score.task_id !== task.id || score.task_hash !== taskHash) {
    throw new Error("score task identity does not match the expected task");
  }
  if (score.tests.length !== task.tests.length) {
    throw new Error(
      `score test count mismatch: expected ${task.tests.length}, received ${score.tests.length}`,
    );
  }

  const seen = new Set<string>();
  for (const [index, definition] of task.tests.entries()) {
    const scored = score.tests[index];
    if (!scored) {
      throw new Error(`score is missing test ${definition.id}`);
    }
    if (seen.has(scored.id)) {
      throw new Error(`score contains duplicate test ${scored.id}`);
    }
    seen.add(scored.id);
    if (
      scored.id !== definition.id ||
      scored.category !== definition.category ||
      scored.points !== definition.points
    ) {
      throw new Error(`score test ${index} does not match task definition ${definition.id}`);
    }
  }

  const hardGateFailed = task.tests
    .filter((test) => test.category === "build")
    .some((definition) => {
      const scored = score.tests.find((test) => test.id === definition.id);
      return scored?.passed !== true;
    });
  if (score.hard_gate_failed !== hardGateFailed) {
    throw new Error("score hard_gate_failed is inconsistent with build tests");
  }
  if (hardGateFailed && score.tests.some((test) => test.passed)) {
    throw new Error("hard-gated scores may not contain passed tests");
  }

  const expectedCategories: ScoreResult["categories"] = {};
  for (const test of score.tests) {
    const category = expectedCategories[test.category] ?? {
      earned: 0,
      available: 0,
    };
    category.available += test.points;
    if (test.passed && !hardGateFailed) {
      category.earned += test.points;
    }
    expectedCategories[test.category] = category;
  }
  const actualCategoryNames = Object.keys(score.categories).sort();
  const expectedCategoryNames = Object.keys(expectedCategories).sort();
  if (JSON.stringify(actualCategoryNames) !== JSON.stringify(expectedCategoryNames)) {
    throw new Error("score category set does not match task tests");
  }
  for (const categoryName of expectedCategoryNames) {
    const actual = score.categories[categoryName];
    const expected = expectedCategories[categoryName];
    if (!actual || !expected) {
      throw new Error(`score category ${categoryName} is missing`);
    }
    assertNumberEqual(actual.earned, expected.earned, `${categoryName} earned`);
    assertNumberEqual(
      actual.available,
      expected.available,
      `${categoryName} available`,
    );
  }

  const available = task.tests.reduce((sum, test) => sum + test.points, 0);
  const earned = hardGateFailed
    ? 0
    : score.tests.reduce(
        (sum, test) => sum + (test.passed ? test.points : 0),
        0,
      );
  assertNumberEqual(score.available, available, "score available");
  assertNumberEqual(score.earned, earned, "score earned");
  assertNumberEqual(score.percent, (earned / available) * 100, "score percent");
}

export function aggregateAttempts(
  attempts: TaskAttempt[],
  expectedTasks: TaskManifest[],
): AggregateResultV2 {
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
  const expectedTrackMeans = [
    ...(expectedBuildIds.size > 0 ? [build] : []),
    ...(expectedReproduceIds.size > 0 ? [reproduce] : []),
  ];
  const core = expectedTrackMeans.every(
    (value): value is number => value !== undefined,
  )
    ? round(mean(expectedTrackMeans))
    : undefined;

  return {
    schema_version: 2,
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
      ...(requiredCore === 0 || completedCore !== requiredCore || core === undefined
        ? {}
        : { core }),
    },
  };
}

export interface TaskEvaluation {
  task: TaskManifest;
  task_hash: string;
  submission_id: string;
  evaluation_seed: number;
  score: ScoreResult;
}

export interface ExpectedTaskEvaluation {
  task: TaskManifest;
  task_hash: string;
}

/** Aggregate seed evaluations while enforcing one frozen task and submission. */
export function aggregateEvaluationsV3(
  evaluations: TaskEvaluation[],
  expectedTasks: ExpectedTaskEvaluation[],
  expectedSeeds: readonly number[],
): AggregateResultV3 {
  if (expectedSeeds.length === 0) {
    throw new Error("aggregate v3 requires at least one evaluation seed");
  }
  const seedSet = new Set(expectedSeeds);
  if (seedSet.size !== expectedSeeds.length) {
    throw new Error("aggregate v3 expected seeds must be unique");
  }
  const expectedById = new Map<string, ExpectedTaskEvaluation>();
  for (const expected of expectedTasks) {
    if (expectedById.has(expected.task.id)) {
      throw new Error(`duplicate expected task: ${expected.task.id}`);
    }
    expectedById.set(expected.task.id, expected);
  }

  const grouped = new Map<string, TaskEvaluation[]>();
  const cells = new Set<string>();
  for (const evaluation of evaluations) {
    const expected = expectedById.get(evaluation.task.id);
    if (!expected) {
      throw new Error(`evaluation references unexpected task: ${evaluation.task.id}`);
    }
    if (
      evaluation.task.version !== expected.task.version ||
      evaluation.task.track !== expected.task.track ||
      evaluation.task_hash !== expected.task_hash
    ) {
      throw new Error(`evaluation task contract mismatch: ${evaluation.task.id}`);
    }
    if (!seedSet.has(evaluation.evaluation_seed)) {
      throw new Error(
        `evaluation uses unexpected seed ${evaluation.evaluation_seed} for ${evaluation.task.id}`,
      );
    }
    const cell = `${evaluation.task.id}\0${evaluation.evaluation_seed}`;
    if (cells.has(cell)) {
      throw new Error(
        `duplicate evaluation cell for ${evaluation.task.id} seed ${evaluation.evaluation_seed}`,
      );
    }
    cells.add(cell);
    assertScoreResult(expected.task, expected.task_hash, evaluation.score);
    const group = grouped.get(evaluation.task.id) ?? [];
    if (
      group.length > 0 &&
      group[0]?.submission_id !== evaluation.submission_id
    ) {
      throw new Error(
        `evaluations for ${evaluation.task.id} come from multiple submissions`,
      );
    }
    group.push(evaluation);
    grouped.set(evaluation.task.id, group);
  }

  const tasks: AggregateTaskResultV3[] = [...grouped.entries()]
    .map(([taskId, group]) => {
      const expected = expectedById.get(taskId);
      const first = group[0];
      if (!expected || !first) {
        throw new Error("unexpected empty aggregate v3 group");
      }
      const values = group.map((evaluation) => evaluation.score.percent);
      return {
        task_id: taskId,
        track: expected.task.track,
        submission_id: first.submission_id,
        evaluation_count: values.length,
        required_evaluation_count: expectedSeeds.length,
        mean: round(mean(values)),
        standard_deviation: round(standardDeviation(values)),
      };
    })
    .sort((left, right) => left.task_id.localeCompare(right.task_id));

  const expectedIds = (track: Track): Set<string> =>
    new Set(
      expectedTasks
        .filter((expected) => expected.task.track === track)
        .map((expected) => expected.task.id),
    );
  const buildIds = expectedIds("build");
  const reproduceIds = expectedIds("reproduce");
  const completeIds = new Set(
    tasks
      .filter((task) => task.evaluation_count === expectedSeeds.length)
      .map((task) => task.task_id),
  );
  const completeCount = (ids: Set<string>): number =>
    [...ids].filter((id) => completeIds.has(id)).length;
  const completedBuild = completeCount(buildIds);
  const completedReproduce = completeCount(reproduceIds);

  const evaluationCount = (ids: Set<string>): number =>
    tasks
      .filter((task) => ids.has(task.task_id))
      .reduce((sum, task) => sum + task.evaluation_count, 0);
  const buildEvaluationCount = evaluationCount(buildIds);
  const reproduceEvaluationCount = evaluationCount(reproduceIds);
  const requiredBuildEvaluations = buildIds.size * expectedSeeds.length;
  const requiredReproduceEvaluations = reproduceIds.size * expectedSeeds.length;

  const completeTrackMean = (track: Track, ids: Set<string>): number | undefined => {
    if (ids.size === 0 || completeCount(ids) !== ids.size) {
      return undefined;
    }
    return round(mean(
      tasks
        .filter((task) => task.track === track && completeIds.has(task.task_id))
        .map((task) => task.mean),
    ));
  };
  const build = completeTrackMean("build", buildIds);
  const reproduce = completeTrackMean("reproduce", reproduceIds);

  return {
    schema_version: 3,
    primary_board: "build",
    tasks,
    coverage: {
      build: { completed: completedBuild, required: buildIds.size },
      reproduce: {
        completed: completedReproduce,
        required: reproduceIds.size,
      },
    },
    evaluation_coverage: {
      build: {
        completed: buildEvaluationCount,
        required: requiredBuildEvaluations,
      },
      reproduce: {
        completed: reproduceEvaluationCount,
        required: requiredReproduceEvaluations,
      },
    },
    leaderboards: {
      ...(build === undefined ? {} : { build }),
      ...(reproduce === undefined ? {} : { reproduce }),
    },
  };
}
