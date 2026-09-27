import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readFlatSeriesResult, sha256Canonical } from "@carrick/gamebench-core";
import { resultData } from "../src/lib/data.ts";

const repository = new URL("../../../", import.meta.url);
const json = async (relative) => JSON.parse(await readFile(new URL(relative, repository), "utf8"));

test("lightweight display provenance preserves frozen identities and task scores", async () => {
  const previousRoot = process.env.GAMEBENCH_RESULTS_ROOT;
  delete process.env.GAMEBENCH_RESULTS_ROOT;
  try {
    const index = await json("results/lite/index.json");
    const { records } = await resultData();
    for (const item of index.results) {
      const result = readFlatSeriesResult(await json(item.path));
      if (result.schema_version === 3 && result.suite === "play") continue;
      const record = records.find(({ entry }) =>
        entry.series_id === result.series_id && entry.benchmark_version === result.benchmark_version
      );
      assert.ok(record, item.series_id);
      assert.equal(record.entry.publication_id, sha256Canonical(result));
      assert.deepEqual(record.result, result);
      assert.ok(!("publication" in record));
      assert.ok(!("aggregate" in record.entry));
      assert.equal(record.entry.configuration_id, sha256Canonical(result.configuration));
      assert.deepEqual(record.entry.campaign, result.campaign
        ? { id: result.campaign.id, cell_id: result.campaign.cell_id }
        : undefined);
      assert.deepEqual(record.result.tasks.map((task) => ({
        task_id: task.task_id,
        score: task.evaluation.score?.percent,
        hard_gate_failed: task.evaluation.score?.hard_gate_failed,
      })), result.tasks.map((task) => ({
        task_id: task.task_id,
        score: task.evaluation.score?.percent,
        hard_gate_failed: task.evaluation.score?.hard_gate_failed,
      })));
    }
  } finally {
    if (previousRoot === undefined) delete process.env.GAMEBENCH_RESULTS_ROOT;
    else process.env.GAMEBENCH_RESULTS_ROOT = previousRoot;
  }
});
