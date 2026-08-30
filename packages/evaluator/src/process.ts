import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

export interface CommandResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
}

export interface CommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdoutPath: string;
  stderrPath: string;
  timeoutMs?: number;
  append?: boolean;
}

const EVALUATOR_ENVIRONMENT_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SHELL",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "CI",
  "TERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "PNPM_HOME",
  "COREPACK_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "PLAYWRIGHT_BROWSERS_PATH",
] as const;

export function evaluatorEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of EVALUATOR_ENVIRONMENT_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function processTreeExists(pid: number | undefined): boolean {
  if (!pid || process.platform === "win32") {
    return false;
  }
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessTreeExit(
  pid: number | undefined,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (processTreeExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function signalProcessTree(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
): void {
  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else if (child.pid) {
      process.kill(-child.pid, signal);
    }
  } catch {
    // The process group has already exited.
  }
}

export async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions,
): Promise<CommandResult> {
  await Promise.all([
    mkdir(path.dirname(options.stdoutPath), { recursive: true }),
    mkdir(path.dirname(options.stderrPath), { recursive: true }),
  ]);
  const stdout = createWriteStream(options.stdoutPath, {
    flags: options.append ? "a" : "w",
  });
  const stderr = createWriteStream(options.stderrPath, {
    flags: options.append ? "a" : "w",
  });
  const started = Date.now();

  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);

    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const terminateTree = (): void => {
      signalProcessTree(child, "SIGTERM");
      killTimer ??= setTimeout(() => signalProcessTree(child, "SIGKILL"), 5_000);
      killTimer.unref();
    };
    const timer = options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          terminateTree();
        }, options.timeoutMs);

    timer?.unref();
    child.once("error", reject);
    child.once("exit", () => {
      // A shell may exit while detached descendants remain alive. Always close
      // the process group before the immutable submission snapshot is sealed.
      terminateTree();
    });
    child.once("close", async (code, signal) => {
      if (timer) {
        clearTimeout(timer);
      }
      terminateTree();
      await waitForProcessTreeExit(child.pid);
      if (processTreeExists(child.pid)) {
        signalProcessTree(child, "SIGKILL");
        await waitForProcessTreeExit(child.pid, 1_000);
      }
      if (killTimer) {
        clearTimeout(killTimer);
      }
      stdout.end();
      stderr.end();
      resolve({
        exitCode: code ?? 1,
        signal,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
  });
}

export function commandExists(command: string): boolean {
  return spawnSync(command, ["--version"], {
    stdio: "ignore",
  }).status === 0;
}

export async function findAvailablePort(
  host = "127.0.0.1",
): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error(`Could not allocate a TCP port on ${host}`));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(address.port);
        }
      });
    });
  });
}

export async function waitForUrl(
  url: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not started";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not become ready at ${url}: ${lastError}`);
}
