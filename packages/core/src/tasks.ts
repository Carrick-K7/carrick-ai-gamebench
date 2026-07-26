import { createHash } from "node:crypto";
import {
  access,
  readFile,
  readdir,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse as parseYaml } from "yaml";
import {
  formatZodIssues,
  TaskManifestSchema,
  TestSuiteSchema,
  ThirdPartyManifestSchema,
  type TaskManifest,
  type TestSuite,
} from "./schema.js";

export interface LoadedTask {
  root: string;
  manifestPath: string;
  manifest: TaskManifest;
  suite: TestSuite;
  hash: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  task?: LoadedTask;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walkForTaskManifests(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return walkForTaskManifests(absolute);
      }
      return entry.isFile() && entry.name === "task.yml" ? [absolute] : [];
    }),
  );
  return paths.flat().sort();
}

async function listTaskFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        return listTaskFiles(root, absolute);
      }
      return entry.isFile() ? [path.relative(root, absolute)] : [];
    }),
  );
  return nested.flat().sort();
}

export async function findRepositoryRoot(start = process.cwd()): Promise<string> {
  let current = path.resolve(start);
  for (;;) {
    const marker = path.join(current, "benchmark", "tasks");
    if (await exists(marker)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(
        `Could not locate benchmark/tasks while walking up from ${start}`,
      );
    }
    current = parent;
  }
}

async function hashFiles(root: string, relativePaths: string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const relative of [...new Set(relativePaths)].sort()) {
    const normalized = relative.split(path.sep).join("/");
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) {
      throw new Error(`Task file escapes its root: ${relative}`);
    }
    const fileStat = await stat(absolute);
    if (!fileStat.isFile()) {
      throw new Error(`Task input is not a file: ${relative}`);
    }
    hash.update(normalized);
    hash.update("\0");
    hash.update(await readFile(absolute));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export async function validateTaskManifest(
  manifestPath: string,
): Promise<ValidationResult> {
  const root = path.dirname(manifestPath);
  const errors: string[] = [];
  let raw: unknown;

  try {
    raw = parseYaml(await readFile(manifestPath, "utf8"));
  } catch (error) {
    return {
      valid: false,
      errors: [
        `Cannot parse ${manifestPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  const parsed = TaskManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return { valid: false, errors: formatZodIssues(parsed.error) };
  }

  const manifest = parsed.data;
  if (!manifest.id.startsWith(`${manifest.track}.`)) {
    errors.push(`id ${manifest.id} does not match track ${manifest.track}`);
  }
  if (manifest.track === "reproduce" && !manifest.reference) {
    errors.push("reproduce tasks require reference metadata");
  }
  if (manifest.track !== "reproduce" && manifest.reference) {
    errors.push("reference metadata is only valid for reproduce tasks");
  }
  const idMajor = Number(manifest.id.match(/\.v(\d+)$/)?.[1]);
  const versionMajor = Number(manifest.version.split(".")[0]);
  if (idMajor !== versionMajor) {
    errors.push(
      `task ID major v${idMajor} does not match manifest version ${manifest.version}`,
    );
  }
  const idSuffix = `.v${idMajor}`;
  const gameSlug = manifest.id.slice(
    `${manifest.track}.`.length,
    -idSuffix.length,
  );
  if (path.basename(root) !== `v${idMajor}`) {
    errors.push(`task directory must end in v${idMajor}`);
  }
  if (path.basename(path.dirname(root)) !== gameSlug) {
    errors.push(`task parent directory must match game slug ${gameSlug}`);
  }
  if (path.basename(path.dirname(path.dirname(root))) !== manifest.track) {
    errors.push(`task track directory must be ${manifest.track}`);
  }

  const pointTotal = manifest.tests.reduce((sum, test) => sum + test.points, 0);
  if (Math.abs(pointTotal - 100) > 0.0001) {
    errors.push(`test points must total 100; received ${pointTotal}`);
  }
  const buildTests = manifest.tests.filter((test) => test.category === "build");
  if (buildTests.length !== 1 || buildTests[0]?.points !== 5) {
    errors.push("each task requires exactly one 5-point build hard gate");
  }
  if (manifest.budget_seconds !== 3600) {
    errors.push("tasks must use a 3600-second agent budget");
  }
  if (
    manifest.runtime.viewport[0] !== 1280 ||
    manifest.runtime.viewport[1] !== 720
  ) {
    errors.push("tasks must use the 1280×720 official viewport");
  }
  if (
    manifest.track === "reproduce" &&
    manifest.network_policy !== "model-api-only"
  ) {
    errors.push("reproduce tasks must use model-api-only network policy");
  }
  if (
    manifest.track !== "reproduce" &&
    manifest.network_policy !== "full"
  ) {
    errors.push("build tasks must use full network policy");
  }

  const categoryPoints = new Map<string, number>();
  for (const test of manifest.tests) {
    categoryPoints.set(
      test.category,
      (categoryPoints.get(test.category) ?? 0) + test.points,
    );
  }
  const expectedCategoryPoints =
    manifest.track === "build"
      ? { build: 5, mechanics: 60, state: 20, input: 10, stability: 5 }
      : { build: 5, mechanics: 45, feel: 20, visual: 20, stability: 10 };
  for (const [category, expected] of Object.entries(expectedCategoryPoints)) {
    if ((categoryPoints.get(category) ?? 0) !== expected) {
      errors.push(
        `${manifest.track} task requires ${expected} ${category} points`,
      );
    }
  }
  const unexpectedCategories = [...categoryPoints].filter(
    ([category]) => !(category in expectedCategoryPoints),
  );
  if (unexpectedCategories.length > 0) {
    errors.push(
      `unexpected score categories: ${unexpectedCategories
        .map(([category]) => category)
        .join(", ")}`,
    );
  }

  const ids = new Set<string>();
  for (const test of manifest.tests) {
    if (ids.has(test.id)) {
      errors.push(`duplicate test id: ${test.id}`);
    }
    ids.add(test.id);
  }

  const requiredFiles = [
    manifest.prompt.en,
    manifest.prompt.zh,
    manifest.test_suite,
    manifest.bridge.state_schema,
  ];
  if (manifest.reference) {
    requiredFiles.push(manifest.reference.capture_pack, "THIRD_PARTY.yml");
  }

  for (const relative of requiredFiles) {
    if (!(await exists(path.resolve(root, relative)))) {
      errors.push(`missing task file: ${relative}`);
    }
  }

  if (manifest.reference) {
    const thirdPartyPath = path.join(root, "THIRD_PARTY.yml");
    if (await exists(thirdPartyPath)) {
      try {
        const thirdPartyResult = ThirdPartyManifestSchema.safeParse(
          parseYaml(await readFile(thirdPartyPath, "utf8")),
        );
        if (!thirdPartyResult.success) {
          errors.push(
            ...formatZodIssues(thirdPartyResult.error).map(
              (issue) => `THIRD_PARTY.yml ${issue}`,
            ),
          );
        } else {
          const thirdParty = thirdPartyResult.data;
          if (thirdParty.project !== manifest.reference.project) {
            errors.push("THIRD_PARTY.yml project does not match reference.project");
          }
          if (thirdParty.upstream !== manifest.reference.repository) {
            errors.push(
              "THIRD_PARTY.yml upstream does not match reference.repository",
            );
          }
          if (thirdParty.commit !== manifest.reference.commit) {
            errors.push("THIRD_PARTY.yml commit does not match reference.commit");
          }
          if (thirdParty.license !== manifest.reference.license) {
            errors.push("THIRD_PARTY.yml license does not match reference.license");
          }
          for (const material of thirdParty.distributed_material) {
            const materialPath = path.resolve(root, material.path);
            if (!materialPath.startsWith(`${path.resolve(root)}${path.sep}`)) {
              errors.push(
                `THIRD_PARTY.yml material escapes task root: ${material.path}`,
              );
              continue;
            }
            if (!(await exists(materialPath))) {
              errors.push(
                `THIRD_PARTY.yml material is missing: ${material.path}`,
              );
              continue;
            }
            const digest = createHash("sha256")
              .update(await readFile(materialPath))
              .digest("hex");
            if (digest !== material.sha256) {
              errors.push(
                `THIRD_PARTY.yml digest mismatch for ${material.path}`,
              );
            }
          }
        }
      } catch (error) {
        errors.push(
          `cannot validate THIRD_PARTY.yml: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  const stateSchemaPath = path.resolve(root, manifest.bridge.state_schema);
  if (await exists(stateSchemaPath)) {
    try {
      const stateSchema = JSON.parse(
        await readFile(stateSchemaPath, "utf8"),
      ) as object;
      new Ajv2020({ allErrors: true, strict: true }).compile(stateSchema);
    } catch (error) {
      errors.push(
        `invalid state schema: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  let suite: TestSuite | undefined;
  const suitePath = path.resolve(root, manifest.test_suite);
  if (await exists(suitePath)) {
    try {
      const suiteResult = TestSuiteSchema.safeParse(
        JSON.parse(await readFile(suitePath, "utf8")),
      );
      if (!suiteResult.success) {
        errors.push(...formatZodIssues(suiteResult.error));
      } else {
        suite = suiteResult.data;
        const caseIds = new Set(suite.cases.map((testCase) => testCase.id));
        for (const test of manifest.tests) {
          if (!caseIds.has(test.case)) {
            errors.push(`test ${test.id} references missing case ${test.case}`);
          }
        }
        for (const testCase of suite.cases) {
          if (testCase.kind !== "browser") {
            continue;
          }
          for (const step of testCase.steps) {
            if (
              step.op === "screenshot" &&
              !(await exists(path.join(root, "references", step.name)))
            ) {
              errors.push(
                `case ${testCase.id} references missing screenshot ${step.name}`,
              );
            }
          }
        }
      }
    } catch (error) {
      errors.push(
        `cannot parse test suite: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (errors.length > 0 || !suite) {
    return { valid: false, errors };
  }

  try {
    const hash = await hashFiles(root, await listTaskFiles(root));
    return {
      valid: true,
      errors: [],
      task: { root, manifestPath, manifest, suite, hash },
    };
  } catch (error) {
    return {
      valid: false,
      errors: [
        error instanceof Error ? error.message : String(error),
      ],
    };
  }
}

export async function listTasks(repositoryRoot?: string): Promise<LoadedTask[]> {
  const root = repositoryRoot ?? (await findRepositoryRoot());
  const manifests = await walkForTaskManifests(
    path.join(root, "benchmark", "tasks"),
  );
  const tasks: LoadedTask[] = [];
  const failures: string[] = [];

  for (const manifestPath of manifests) {
    const result = await validateTaskManifest(manifestPath);
    if (!result.valid || !result.task) {
      failures.push(
        `${path.relative(root, manifestPath)}:\n  ${result.errors.join("\n  ")}`,
      );
    } else {
      tasks.push(result.task);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Invalid benchmark tasks:\n${failures.join("\n")}`);
  }
  return tasks.sort((left, right) =>
    left.manifest.id.localeCompare(right.manifest.id),
  );
}

export async function loadTask(
  id: string,
  repositoryRoot?: string,
): Promise<LoadedTask> {
  const tasks = await listTasks(repositoryRoot);
  const task = tasks.find((candidate) => candidate.manifest.id === id);
  if (!task) {
    throw new Error(`Unknown task: ${id}`);
  }
  return task;
}
