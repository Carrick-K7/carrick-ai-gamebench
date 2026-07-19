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
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            if (process.platform === "win32") {
              child.kill("SIGTERM");
            } else if (child.pid) {
              process.kill(-child.pid, "SIGTERM");
              setTimeout(() => {
                if (child.pid) {
                  try {
                    process.kill(-child.pid, "SIGKILL");
                  } catch {
                    // The process group has already exited.
                  }
                }
              }, 5_000).unref();
            }
          }, options.timeoutMs);

    timer?.unref();
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (timer) {
        clearTimeout(timer);
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
