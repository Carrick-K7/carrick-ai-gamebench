import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  AnyPublicationManifestSchema,
  AnyReleaseLockSchema,
  LiteReleaseLockSchema,
  ReleaseLockV4Schema,
  PublicationManifestV1Schema,
  ResultIndexV1Schema,
  ResultIndexV2Schema,
  findRepositoryRoot,
  sha256Canonical,
  type JsonValue,
} from "../src/index.js";

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

test("historical release locks remain readable under their original versions", async () => {
  const root = await findRepositoryRoot();
  const releasesRoot = path.join(root, "benchmark", "releases");
  for (const file of (await readdir(releasesRoot)).filter((name) => name.endsWith(".json"))) {
    const input = await readJson(path.join(releasesRoot, file));
    const lite = LiteReleaseLockSchema.safeParse(input);
    if (lite.success) {
      assert.equal(`${lite.data.benchmark_version}.json`, file);
      continue;
    }
    const dual = ReleaseLockV4Schema.safeParse(input);
    if (dual.success) { assert.equal(`${dual.data.benchmark_version}.json`, file); continue; }
    const lock = AnyReleaseLockSchema.parse(input);
    assert.equal(`${lock.benchmark_version}.json`, file);
    if (lock.benchmark_version !== "0.5.0") {
      assert.ok(lock.schema_version === 1 || lock.schema_version === 2);
    }
  }
});

test("result index v2 upgrades five legacy entries and appends publication v2", async () => {
  const root = await findRepositoryRoot();
  const legacyInput = await readJson(path.join(root, "results", "index.json"));
  const legacy = ResultIndexV1Schema.parse(legacyInput);
  assert.equal(legacy.entries.length, 5);
  assert.equal(
    ResultIndexV1Schema.safeParse({
      ...legacy,
      entries: legacy.entries.map((entry) => ({
        ...entry,
        publication_schema_version: 1,
      })),
    }).success,
    false,
  );

  const first = legacy.entries[0];
  assert.ok(first);
  const aggregateV3 = {
    schema_version: 3 as const,
    primary_board: "build" as const,
    tasks: [{
      task_id: "build.sample.v1",
      track: "build" as const,
      submission_id: "01K00000000000000000000001",
      evaluation_count: 3,
      required_evaluation_count: 3,
      mean: 100,
      standard_deviation: 0,
    }],
    coverage: {
      build: { completed: 1, required: 1 },
      reproduce: { completed: 0, required: 0 },
    },
    evaluation_coverage: {
      build: { completed: 3, required: 3 },
      reproduce: { completed: 0, required: 0 },
    },
    leaderboards: { build: 100 },
  };
  const newEntry = {
    publication_schema_version: 2 as const,
    publication_id: `sha256:${"a".repeat(64)}`,
    created_at: "2026-08-01T00:00:00.000Z",
    tier: "official" as const,
    board: "build" as const,
    status: "active" as const,
    benchmark_version: "0.5.0",
    series_id: "01K00000000000000000000000",
    configuration_id: `sha256:${"b".repeat(64)}`,
    agent: first.agent,
    aggregate: aggregateV3,
  };
  const upgraded = {
    schema_version: 2 as const,
    generated_at: "2026-08-01T00:00:00.000Z",
    benchmark_versions: ["0.5.0", ...legacy.benchmark_versions],
    entries: [
      ...legacy.entries.map((entry) => ({
        publication_schema_version: 1 as const,
        ...entry,
      })),
      newEntry,
    ],
  };
  const parsed = ResultIndexV2Schema.parse(upgraded);
  assert.equal(parsed.entries.length, 6);
  assert.equal(
    parsed.entries.filter((entry) => entry.publication_schema_version === 1).length,
    5,
  );
  assert.equal(parsed.entries.at(-1)?.publication_schema_version, 2);
  assert.equal(
    ResultIndexV2Schema.safeParse({
      ...upgraded,
      entries: [{ ...newEntry, board: undefined }],
    }).success,
    false,
  );
  assert.equal(
    ResultIndexV2Schema.safeParse({
      ...upgraded,
      entries: [{ ...newEntry, board: "reproduce" }],
    }).success,
    false,
  );
  assert.equal(
    ResultIndexV2Schema.safeParse({
      ...upgraded,
      entries: [{ ...newEntry, publication_schema_version: 1 }],
    }).success,
    false,
  );
  assert.equal(
    ResultIndexV2Schema.safeParse({
      ...upgraded,
      entries: [{
        ...legacy.entries[0],
        publication_schema_version: 2,
      }],
    }).success,
    false,
  );
});

test("historical publication payloads keep their exact schema and identity", async () => {
  const root = await findRepositoryRoot();
  const publicationsRoot = path.join(root, "results", "publications");
  const files = (await readdir(publicationsRoot)).filter((name) => name.endsWith(".json"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const input = await readJson(path.join(publicationsRoot, file));
    const publication = PublicationManifestV1Schema.parse(input);
    assert.equal(AnyPublicationManifestSchema.parse(input).schema_version, 1);
    const { publication_id: claimed, ...payload } = publication;
    assert.equal(
      sha256Canonical(JSON.parse(JSON.stringify(payload)) as JsonValue),
      claimed,
    );
    assert.equal(
      PublicationManifestV1Schema.safeParse({
        ...publication,
        aggregate: {
          schema_version: 3,
          primary_board: "build",
          tasks: [],
          coverage: publication.aggregate.coverage,
          evaluation_coverage: publication.aggregate.coverage,
          leaderboards: {},
        },
      }).success,
      false,
    );
  }
});
