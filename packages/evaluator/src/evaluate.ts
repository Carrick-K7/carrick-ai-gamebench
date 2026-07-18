import { spawn, type ChildProcess } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import {
  scoreTask,
  type BrowserStep,
  type JsonValue,
  type LoadedTask,
  type ScoreResult,
  type TestCase,
  type TestOutcome,
} from "@carrick/gamebench-core";
import { runCommand, waitForUrl } from "./process.js";

export interface EvaluationOptions {
  submissionDir: string;
  runDir: string;
  seed: number;
  install?: boolean;
}

export interface EvaluationResult {
  outcomes: TestOutcome[];
  score: ScoreResult;
}

interface CaseResult {
  passed: boolean;
  duration_ms: number;
  message?: string;
  artifacts: string[];
}

function getPath(value: unknown, dottedPath: string): unknown {
  return dottedPath.split(".").reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      return current[Number(segment)];
    }
    if (typeof current === "object") {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, value);
}

function jsonEqual(left: unknown, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertExpectation(actual: unknown, step: Extract<BrowserStep, { op: "expect" }>): void {
  const checks = [
    step.equals !== undefined,
    step.one_of !== undefined,
    step.greater_than !== undefined,
    step.less_than !== undefined,
    step.approximately !== undefined,
  ].filter(Boolean).length;
  if (checks !== 1) {
    throw new Error(`expect step for ${step.path} must declare exactly one comparison`);
  }
  if (step.equals !== undefined && !jsonEqual(actual, step.equals)) {
    throw new Error(
      `${step.path}: expected ${JSON.stringify(step.equals)}, received ${JSON.stringify(actual)}`,
    );
  }
  if (
    step.one_of !== undefined &&
    !step.one_of.some((candidate) => jsonEqual(actual, candidate))
  ) {
    throw new Error(
      `${step.path}: expected one of ${JSON.stringify(step.one_of)}, received ${JSON.stringify(actual)}`,
    );
  }
  if (
    step.greater_than !== undefined &&
    (typeof actual !== "number" || actual <= step.greater_than)
  ) {
    throw new Error(`${step.path}: expected > ${step.greater_than}, received ${String(actual)}`);
  }
  if (
    step.less_than !== undefined &&
    (typeof actual !== "number" || actual >= step.less_than)
  ) {
    throw new Error(`${step.path}: expected < ${step.less_than}, received ${String(actual)}`);
  }
  if (step.approximately !== undefined) {
    if (
      typeof actual !== "number" ||
      Math.abs(actual - step.approximately.value) > step.approximately.tolerance
    ) {
      throw new Error(
        `${step.path}: expected ${step.approximately.value} ± ${step.approximately.tolerance}, received ${String(actual)}`,
      );
    }
  }
}

async function bridgeSnapshot(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const bridge = (
      window as typeof window & {
        __CARRICK_GAMEBENCH__?: {
          snapshot(): Promise<unknown>;
        };
      }
    ).__CARRICK_GAMEBENCH__;
    if (!bridge) {
      throw new Error("window.__CARRICK_GAMEBENCH__ is missing");
    }
    return bridge.snapshot();
  });
}

function assertValidSnapshot(
  snapshot: unknown,
  validateSnapshot: ValidateFunction,
): void {
  if (!validateSnapshot(snapshot)) {
    const details = (validateSnapshot.errors ?? [])
      .map((error) => `${error.instancePath || "<root>"} ${error.message ?? "is invalid"}`)
      .join("; ");
    throw new Error(`bridge snapshot does not match state.schema.json: ${details}`);
  }
}

async function preflightBridge(
  browser: Browser,
  task: LoadedTask,
  validateSnapshot: ValidateFunction,
): Promise<void> {
  const context = await browser.newContext({
    viewport: {
      width: task.manifest.runtime.viewport[0],
      height: task.manifest.runtime.viewport[1],
    },
    deviceScaleFactor: task.manifest.runtime.device_scale_factor,
  });
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${task.manifest.runtime.port}`, {
      waitUntil: "networkidle",
    });
    await page.waitForFunction(
      () => Boolean((window as typeof window & {
        __CARRICK_GAMEBENCH__?: unknown;
      }).__CARRICK_GAMEBENCH__),
      undefined,
      { timeout: 10_000 },
    );
    await page.evaluate(async () => {
      const bridge = (window as typeof window & {
        __CARRICK_GAMEBENCH__: {
          version: string;
          ready: Promise<void>;
        };
      }).__CARRICK_GAMEBENCH__;
      if (bridge.version !== "1") {
        throw new Error(`unsupported bridge version: ${bridge.version}`);
      }
      await bridge.ready;
    });
    assertValidSnapshot(await bridgeSnapshot(page), validateSnapshot);
  } finally {
    await context.close();
  }
}

async function compareScreenshot(
  actualPath: string,
  expectedPath: string,
  diffPath: string,
  maxDiffPixels = 100,
  threshold = 0.2,
): Promise<void> {
  const [actualBuffer, expectedBuffer] = await Promise.all([
    readFile(actualPath),
    readFile(expectedPath),
  ]);
  const actual = PNG.sync.read(actualBuffer);
  const expected = PNG.sync.read(expectedBuffer);
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `screenshot size differs: expected ${expected.width}x${expected.height}, received ${actual.width}x${actual.height}`,
    );
  }
  const diff = new PNG({ width: actual.width, height: actual.height });
  const changed = pixelmatch(
    actual.data,
    expected.data,
    diff.data,
    actual.width,
    actual.height,
    { threshold },
  );
  if (changed > maxDiffPixels) {
    await writeFile(diffPath, PNG.sync.write(diff));
    throw new Error(`screenshot differs by ${changed} pixels; maximum is ${maxDiffPixels}`);
  }
}

async function executeBrowserCase(
  browser: Browser,
  task: LoadedTask,
  testCase: Extract<TestCase, { kind: "browser" }>,
  options: EvaluationOptions,
  validateSnapshot: ValidateFunction,
): Promise<CaseResult> {
  const started = Date.now();
  const artifactsDir = path.join(options.runDir, "playwright", testCase.id);
  await mkdir(artifactsDir, { recursive: true });
  const context = await browser.newContext({
    viewport: {
      width: task.manifest.runtime.viewport[0],
      height: task.manifest.runtime.viewport[1],
    },
    deviceScaleFactor: 1,
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const artifacts: string[] = [];
  try {
    await page.goto(`http://127.0.0.1:${task.manifest.runtime.port}`, {
      waitUntil: "networkidle",
    });
    await page.waitForFunction(
      () =>
        Boolean(
          (
            window as typeof window & {
              __CARRICK_GAMEBENCH__?: { ready?: Promise<void> };
            }
          ).__CARRICK_GAMEBENCH__,
        ),
      undefined,
      { timeout: 10_000 },
    );
    await page.evaluate(async () => {
      const bridge = (
        window as typeof window & {
          __CARRICK_GAMEBENCH__: { ready: Promise<void> };
        }
      ).__CARRICK_GAMEBENCH__;
      await bridge.ready;
    });

    for (const step of testCase.steps) {
      if (step.op === "reset") {
        await page.evaluate(
          async ({ seed, scenario }) => {
            const bridge = (
              window as typeof window & {
                __CARRICK_GAMEBENCH__: {
                  reset(input: { seed: number; scenario?: string }): Promise<void>;
                };
              }
            ).__CARRICK_GAMEBENCH__;
            await bridge.reset({
              seed,
              ...(scenario ? { scenario } : {}),
            });
          },
          {
            seed: step.seed ?? options.seed,
            ...(step.scenario ? { scenario: step.scenario } : {}),
          },
        );
      } else if (step.op === "act") {
        const actionInput: { action: string; payload?: unknown } = {
          action: step.action,
          ...(step.payload === undefined ? {} : { payload: step.payload }),
        };
        await page.evaluate(
          async ({ action, payload }: { action: string; payload?: unknown }) => {
            const bridge = (
              window as typeof window & {
                __CARRICK_GAMEBENCH__: {
                  act(input: { type: string; payload?: unknown }): Promise<void>;
                };
              }
            ).__CARRICK_GAMEBENCH__;
            await bridge.act({
              type: action,
              ...(payload === undefined ? {} : { payload }),
            });
          },
          actionInput,
        );
      } else if (step.op === "advance") {
        await page.evaluate(async (ms) => {
          const bridge = (
            window as typeof window & {
              __CARRICK_GAMEBENCH__: { advance(ms: number): Promise<void> };
            }
          ).__CARRICK_GAMEBENCH__;
          await bridge.advance(ms);
        }, step.ms);
      } else if (step.op === "key") {
        await page.keyboard.press(step.key);
      } else if (step.op === "click") {
        if (step.selector) {
          await page.locator(step.selector).click({ button: step.button });
        } else if (step.x !== undefined && step.y !== undefined) {
          await page.mouse.click(step.x, step.y, { button: step.button });
        } else {
          throw new Error("click requires selector or x/y coordinates");
        }
      } else if (step.op === "expect") {
        const snapshot = await bridgeSnapshot(page);
        assertValidSnapshot(snapshot, validateSnapshot);
        assertExpectation(getPath(snapshot, step.path), step);
      } else if (step.op === "screenshot") {
        const actualPath = path.join(artifactsDir, step.name);
        const expectedPath = path.join(task.root, "references", step.name);
        const diffPath = path.join(
          artifactsDir,
          step.name.replace(/\.png$/, ".diff.png"),
        );
        await access(expectedPath);
        if (step.selector) {
          await page.locator(step.selector).screenshot({
            path: actualPath,
            animations: "disabled",
          });
        } else {
          await page.screenshot({
            path: actualPath,
            animations: "disabled",
          });
        }
        artifacts.push(path.relative(options.runDir, actualPath));
        await compareScreenshot(
          actualPath,
          expectedPath,
          diffPath,
          step.max_diff_pixels,
          step.threshold,
        );
      }
    }

    await context.tracing.stop();
    await context.close();
    return {
      passed: true,
      duration_ms: Date.now() - started,
      artifacts,
    };
  } catch (error) {
    const screenshotPath = path.join(artifactsDir, "failure.png");
    const tracePath = path.join(artifactsDir, "trace.zip");
    try {
      await page.screenshot({ path: screenshotPath });
      artifacts.push(path.relative(options.runDir, screenshotPath));
    } catch {
      // Navigation or browser startup may have failed before a page existed.
    }
    try {
      await context.tracing.stop({ path: tracePath });
      artifacts.push(path.relative(options.runDir, tracePath));
    } catch {
      // Preserve the original test failure.
    }
    await context.close();
    const message = error instanceof Error ? error.message : String(error);
    return {
      passed: false,
      duration_ms: Date.now() - started,
      message:
        consoleErrors.length > 0
          ? `${message}; browser errors: ${consoleErrors.join(" | ")}`
          : message,
      artifacts,
    };
  }
}

function stopServer(server: ChildProcess | undefined): void {
  if (!server?.pid) {
    return;
  }
  try {
    if (process.platform === "win32") {
      server.kill("SIGTERM");
    } else {
      process.kill(-server.pid, "SIGTERM");
    }
  } catch {
    // The server has already exited.
  }
}

export async function evaluateSubmission(
  task: LoadedTask,
  options: EvaluationOptions,
): Promise<EvaluationResult> {
  await mkdir(options.runDir, { recursive: true });
  const buildLog = path.join(options.runDir, "build.log");
  const buildErrorLog = path.join(options.runDir, "build.stderr.log");
  let buildPassed = true;
  let buildMessage: string | undefined;
  const stateSchema = JSON.parse(
    await readFile(path.join(task.root, task.manifest.bridge.state_schema), "utf8"),
  ) as object;
  const validateSnapshot = new Ajv2020({
    allErrors: true,
    strict: true,
  }).compile(stateSchema);

  if (options.install !== false) {
    const install = await runCommand(
      "pnpm",
      ["install", "--frozen-lockfile", "--offline"],
      {
        cwd: options.submissionDir,
        stdoutPath: buildLog,
        stderrPath: buildErrorLog,
        timeoutMs: 120_000,
      },
    );
    if (install.exitCode !== 0) {
      buildPassed = false;
      buildMessage = `dependency installation failed with exit ${install.exitCode}`;
    }
  }

  if (buildPassed) {
    const build = await runCommand("pnpm", ["build"], {
      cwd: options.submissionDir,
      stdoutPath: buildLog,
      stderrPath: buildErrorLog,
      timeoutMs: 120_000,
      append: true,
    });
    if (build.exitCode !== 0) {
      buildPassed = false;
      buildMessage = `build failed with exit ${build.exitCode}`;
    }
  }

  let server: ChildProcess | undefined;
  if (buildPassed) {
    const stdout = path.join(options.runDir, "server.log");
    const stderr = path.join(options.runDir, "server.stderr.log");
    const stdoutHandle = await import("node:fs").then(({ createWriteStream }) =>
      createWriteStream(stdout, { flags: "w" }),
    );
    const stderrHandle = await import("node:fs").then(({ createWriteStream }) =>
      createWriteStream(stderr, { flags: "w" }),
    );
    server = spawn(
      "pnpm",
      [
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        String(task.manifest.runtime.port),
      ],
      {
        cwd: options.submissionDir,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server.stdout?.pipe(stdoutHandle);
    server.stderr?.pipe(stderrHandle);
    try {
      await waitForUrl(
        `http://127.0.0.1:${task.manifest.runtime.port}`,
        30_000,
      );
    } catch (error) {
      buildPassed = false;
      buildMessage = error instanceof Error ? error.message : String(error);
      stopServer(server);
      server = undefined;
    }
  }

  let browser: Browser | undefined;
  try {
    if (buildPassed) {
      browser = await chromium.launch({ headless: true });
      try {
        await preflightBridge(browser, task, validateSnapshot);
      } catch (error) {
        buildPassed = false;
        buildMessage =
          error instanceof Error ? error.message : String(error);
      }
    }

    const caseResults = new Map<string, CaseResult>();
    for (const testCase of task.suite.cases) {
      if (testCase.kind === "build") {
        caseResults.set(testCase.id, {
          passed: buildPassed,
          duration_ms: 0,
          ...(buildMessage ? { message: buildMessage } : {}),
          artifacts: ["build.log", "build.stderr.log"],
        });
      }
    }

    if (buildPassed && browser) {
      for (const testCase of task.suite.cases) {
        if (testCase.kind === "browser") {
          caseResults.set(
            testCase.id,
            await executeBrowserCase(
              browser,
              task,
              testCase,
              options,
              validateSnapshot,
            ),
          );
        }
      }
    } else {
      for (const testCase of task.suite.cases) {
        if (testCase.kind !== "build") {
          caseResults.set(testCase.id, {
            passed: false,
            duration_ms: 0,
            message: "not run because the build gate failed",
            artifacts: [],
          });
        }
      }
    }

    const outcomes: TestOutcome[] = task.manifest.tests.map((test) => {
      const result = caseResults.get(test.case);
      return {
        id: test.id,
        passed: result?.passed ?? false,
        duration_ms: result?.duration_ms ?? 0,
        ...(result?.message ? { message: result.message } : {}),
        artifacts: result?.artifacts ?? [],
      };
    });

    return {
      outcomes,
      score: scoreTask(task.manifest, task.hash, outcomes),
    };
  } finally {
    await browser?.close();
    stopServer(server);
    await rm(path.join(options.submissionDir, ".cagb-evaluator"), {
      recursive: true,
      force: true,
    });
    await rm(path.join(options.submissionDir, "node_modules"), {
      recursive: true,
      force: true,
    });
  }
}
