import type {
  ArtifactRef,
  AnyPublicationManifest,
  AnyResultIndex,
  ReviewSummary,
  ScoreResult,
} from "@carrick/gamebench-core";

type RawResultEntry = AnyResultIndex["entries"][number];
type RawConfiguration = AnyPublicationManifest["configuration"];
type RawAgent = RawConfiguration["agent"];

export interface NormalizedCoverage {
  completed: number;
  required: number;
}

export interface NormalizedAggregateTask {
  task_id: string;
  track: "build" | "reproduce";
  submission_id?: string;
  development_count: number;
  evaluation_count: number;
  required_evaluation_count: number;
  mean: number;
  standard_deviation: number;
}

export interface NormalizedAggregate {
  schema_version: 1 | 2 | 3;
  primary_board: "core" | "build" | "reproduce";
  tasks: NormalizedAggregateTask[];
  coverage: {
    build: NormalizedCoverage;
    reproduce: NormalizedCoverage;
    core: NormalizedCoverage;
  };
  evaluation_coverage: {
    build: NormalizedCoverage;
    reproduce: NormalizedCoverage;
    core: NormalizedCoverage;
  };
  leaderboards: {
    build?: number;
    reproduce?: number;
    core?: number;
  };
}

export interface NormalizedEvaluation {
  run_id: string;
  submission_id: string;
  input_fingerprint: string;
  task_id: string;
  task_version: string;
  task_hash: string;
  seed: number;
  included: boolean;
  network_policy: "none" | "full" | "model-api-only";
  exit_reason: "completed" | "timeout" | "agent-error" | "evaluation-error";
  development_exit_reason:
    | "completed"
    | "timeout"
    | "agent-error"
    | "preparation-error";
  score?: ScoreResult;
  wall_time_ms?: number;
  usage?: {
    input_tokens?: number | undefined;
    cached_input_tokens?: number | undefined;
    output_tokens?: number | undefined;
    cost_usd?: number | undefined;
    source: "provider" | "harness" | "estimated" | "not-reported";
  };
  artifacts: ArtifactRef[];
  development_artifacts: ArtifactRef[];
  evaluation_artifacts: ArtifactRef[];
  verification?: {
    status: "operator-reproduced";
    evaluator_image_digest: string;
    network_attestation:
      | "not-required"
      | "operator-attested-model-api-only"
      | "unverified";
  };
  agent_invocation_index: number;
  legacy_attempt?: number;
}

export interface NormalizedSubmission {
  submission_id: string;
  task_id: string;
  task_version: string;
  task_hash: string;
  included: boolean;
  agent_invocation_index: number;
  development_exit_reason:
    | "completed"
    | "timeout"
    | "agent-error"
    | "preparation-error";
  artifacts: ArtifactRef[];
  evaluations: NormalizedEvaluation[];
}

export interface NormalizedPublication {
  schema_version: 1 | 2;
  publication_id: string;
  created_at: string;
  tier: "experimental" | "official";
  board: "core" | "build" | "reproduce";
  series_id: string;
  benchmark: AnyPublicationManifest["benchmark"];
  configuration: RawConfiguration;
  aggregate: NormalizedAggregate;
  submissions: NormalizedSubmission[];
  runs: NormalizedEvaluation[];
  review_summaries: ReviewSummary[];
}

export interface NormalizedResultEntry {
  publication_id: string;
  created_at: string;
  tier: "experimental" | "official";
  board: "core" | "build" | "reproduce";
  status: "active" | "superseded" | "withdrawn";
  superseded_by?: string;
  benchmark_version: string;
  series_id: string;
  configuration_id: string;
  agent: RawAgent;
  aggregate: NormalizedAggregate;
}

function normalizeLeaderboards(leaderboards: {
  build?: number | undefined;
  reproduce?: number | undefined;
  core?: number | undefined;
}): NormalizedAggregate["leaderboards"] {
  return {
    ...(leaderboards.build === undefined ? {} : { build: leaderboards.build }),
    ...(leaderboards.reproduce === undefined
      ? {}
      : { reproduce: leaderboards.reproduce }),
    ...(leaderboards.core === undefined ? {} : { core: leaderboards.core }),
  };
}

function normalizeAggregate(
  aggregate: AnyPublicationManifest["aggregate"],
  board: "core" | "build" | "reproduce",
): NormalizedAggregate {
  if (aggregate.schema_version === 3) {
    return {
      schema_version: 3,
      primary_board: board === "core" ? "build" : board,
      tasks: aggregate.tasks.map((task) => ({
        task_id: task.task_id,
        track: task.track,
        submission_id: task.submission_id,
        development_count: 1,
        evaluation_count: task.evaluation_count,
        required_evaluation_count: task.required_evaluation_count,
        mean: task.mean,
        standard_deviation: task.standard_deviation,
      })),
      coverage: {
        ...aggregate.coverage,
        core: {
          completed:
            aggregate.coverage.build.completed +
            aggregate.coverage.reproduce.completed,
          required:
            aggregate.coverage.build.required +
            aggregate.coverage.reproduce.required,
        },
      },
      evaluation_coverage: {
        ...aggregate.evaluation_coverage,
        core: {
          completed:
            aggregate.evaluation_coverage.build.completed +
            aggregate.evaluation_coverage.reproduce.completed,
          required:
            aggregate.evaluation_coverage.build.required +
            aggregate.evaluation_coverage.reproduce.required,
        },
      },
      leaderboards: normalizeLeaderboards(aggregate.leaderboards),
    };
  }
  return {
    schema_version: aggregate.schema_version,
    primary_board: "core",
    tasks: aggregate.tasks.map((task) => ({
      task_id: task.task_id,
      track: task.track,
      development_count: task.attempts,
      evaluation_count: task.attempts,
      required_evaluation_count: task.attempts,
      mean: task.mean,
      standard_deviation: task.standard_deviation,
    })),
    coverage: aggregate.coverage,
    evaluation_coverage: aggregate.coverage,
    leaderboards: normalizeLeaderboards(aggregate.leaderboards),
  };
}

function mergeArtifacts(...groups: ArtifactRef[][]): ArtifactRef[] {
  const byIdentity = new Map<string, ArtifactRef>();
  for (const artifact of groups.flat()) {
    byIdentity.set(`${artifact.artifact_id}\0${artifact.role}\0${artifact.file_name}`, artifact);
  }
  return [...byIdentity.values()];
}

export function normalizePublication(
  publication: AnyPublicationManifest,
): NormalizedPublication {
  const board = publication.schema_version === 2 ? publication.board : "core";
  const aggregate = normalizeAggregate(publication.aggregate, board);
  if (publication.schema_version === 1) {
    const submissions = publication.runs.map((run) => {
      const submissionId = run.run_id;
      const evaluation: NormalizedEvaluation = {
        run_id: run.run_id,
        submission_id: submissionId,
        input_fingerprint: run.input_fingerprint,
        task_id: run.task_id,
        task_version: run.task_version,
        task_hash: run.task_hash,
        seed: run.seed,
        included: run.included,
        network_policy: run.network_policy,
        exit_reason: run.exit_reason,
        development_exit_reason:
          run.exit_reason === "evaluation-error" ? "completed" : run.exit_reason,
        ...(run.score ? { score: run.score } : {}),
        ...(run.wall_time_ms === undefined ? {} : { wall_time_ms: run.wall_time_ms }),
        ...(run.usage ? { usage: run.usage } : {}),
        artifacts: run.artifacts,
        development_artifacts: run.artifacts,
        evaluation_artifacts: run.artifacts,
        ...(run.verification ? { verification: run.verification } : {}),
        agent_invocation_index: run.attempt,
        legacy_attempt: run.attempt,
      };
      return {
        submission_id: submissionId,
        task_id: run.task_id,
        task_version: run.task_version,
        task_hash: run.task_hash,
        included: run.included,
        agent_invocation_index: run.attempt,
        development_exit_reason: evaluation.development_exit_reason,
        artifacts: run.artifacts,
        evaluations: [evaluation],
      } satisfies NormalizedSubmission;
    });
    return {
      ...publication,
      board,
      aggregate,
      submissions,
      runs: submissions.flatMap((submission) => submission.evaluations),
    };
  }

  const submissions = publication.submissions.map((submission) => {
    const evaluations = submission.evaluations.map((evaluation) => ({
      run_id: evaluation.run_id,
      submission_id: submission.submission_id,
      input_fingerprint: evaluation.input_fingerprint,
      task_id: submission.task_id,
      task_version: submission.task_version,
      task_hash: submission.task_hash,
      seed: evaluation.evaluation_seed,
      included: evaluation.included,
      network_policy: submission.network_policy,
      exit_reason: evaluation.exit_reason,
      development_exit_reason: submission.development_exit_reason,
      ...(evaluation.score ? { score: evaluation.score } : {}),
      ...(evaluation.wall_time_ms === undefined
        ? {}
        : { wall_time_ms: evaluation.wall_time_ms }),
      ...(submission.usage ? { usage: submission.usage } : {}),
      artifacts: mergeArtifacts(submission.artifacts, evaluation.artifacts),
      development_artifacts: submission.artifacts,
      evaluation_artifacts: evaluation.artifacts,
      ...(submission.verification ? { verification: submission.verification } : {}),
      agent_invocation_index: submission.agent_invocation_index,
    } satisfies NormalizedEvaluation));
    return {
      submission_id: submission.submission_id,
      task_id: submission.task_id,
      task_version: submission.task_version,
      task_hash: submission.task_hash,
      included: submission.included,
      agent_invocation_index: submission.agent_invocation_index,
      development_exit_reason: submission.development_exit_reason,
      artifacts: submission.artifacts,
      evaluations,
    } satisfies NormalizedSubmission;
  });
  return {
    ...publication,
    aggregate,
    submissions,
    runs: submissions.flatMap((submission) => submission.evaluations),
  };
}

export function normalizeResultEntry(
  entry: RawResultEntry,
  publication: NormalizedPublication,
): NormalizedResultEntry {
  return {
    publication_id: entry.publication_id,
    created_at: entry.created_at,
    tier: entry.tier,
    board: publication.board,
    status: entry.status,
    ...(entry.superseded_by ? { superseded_by: entry.superseded_by } : {}),
    benchmark_version: entry.benchmark_version,
    series_id: entry.series_id,
    configuration_id: entry.configuration_id,
    agent: entry.agent,
    aggregate: publication.aggregate,
  };
}
