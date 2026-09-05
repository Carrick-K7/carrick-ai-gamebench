import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { findRepositoryRoot } from "../src/index.js";

type Workflow = {
  permissions: { contents: string; [key: string]: string };
  jobs: Record<string, { steps: Array<{ run?: string; uses?: string }> }>;
};

async function workflow(name: string): Promise<Workflow> {
  const root = await findRepositoryRoot();
  return parse(await readFile(path.join(root, ".github/workflows", name), "utf8")) as Workflow;
}

test("every full-check workflow installs its pinned Chromium before calibration", async () => {
  for (const name of ["ci.yml", "benchmark-release.yml", "publish-results.yml"]) {
    const definition = await workflow(name);
    let fullChecks = 0;
    for (const job of Object.values(definition.jobs)) {
      const checkIndex = job.steps.findIndex((step) => step.run?.trim() === "pnpm check");
      if (checkIndex < 0) continue;
      fullChecks += 1;
      const browserIndex = job.steps.findIndex((step) =>
        step.run === "pnpm --filter @carrick/gamebench exec playwright install --with-deps chromium"
      );
      assert.ok(browserIndex >= 0 && browserIndex < checkIndex, name);
    }
    assert.ok(fullChecks > 0, name);
  }
});

test("the static-site workflow uploads a build without a production deployment", async () => {
  const definition = await workflow("site-build.yml");
  assert.deepEqual(definition.permissions, { contents: "read" });
  const steps = Object.values(definition.jobs).flatMap((job) => job.steps);
  assert.ok(steps.some((step) => step.uses === "actions/upload-artifact@v6"));
  const configuration = JSON.stringify(definition);
  assert.doesNotMatch(configuration, /DEPLOY_SSH_KEY|DEPLOY_HOST|deploy \$REVISION|gamebench-production/);
  for (const step of steps) {
    assert.doesNotMatch(step.run ?? "", /(?:^|\n)\s*(?:ssh|scp|rsync)\s/);
  }
});

test("release retries compare immutable evidence instead of overwriting assets", async () => {
  const definition = await workflow("benchmark-release.yml");
  const commands = Object.values(definition.jobs).flatMap((job) => job.steps)
    .map((step) => step.run ?? "").join("\n");
  assert.doesNotMatch(commands, /--clobber/);
  assert.match(commands, /gh release download/);
  assert.match(commands, /cmp "\$artifact"/);
  assert.match(commands, /sha256sum .*release-summary\.md > SHA256SUMS/);
});
