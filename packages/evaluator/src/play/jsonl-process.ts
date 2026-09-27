import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";

export class JsonlProcessError extends Error {
  constructor(readonly kind: "process" | "protocol" | "timeout" | "aborted", message: string) {
    super(message);
    this.name = "JsonlProcessError";
  }
}

export interface JsonlProcessOptions {
  cwd: string;
  stderrPath: string;
  env?: NodeJS.ProcessEnv;
  maxLineBytes?: number;
}

/** A trusted external adapter transport, not a model-exposed shell tool. */
export class JsonlProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly stderr;
  private readonly exit: Promise<void>;
  private readonly decoder = new StringDecoder("utf8");
  private buffer = "";
  private readonly queue: unknown[] = [];
  private pending: { resolve: (message: unknown) => void; reject: (error: Error) => void } | undefined;
  private failure: Error | undefined;
  private ended = false;
  private readonly limit: number;

  constructor(command: string, options: JsonlProcessOptions) {
    this.limit = options.maxLineBytes ?? 8 * 1024 * 1024;
    this.stderr = createWriteStream(options.stderrPath, { flags: "wx", mode: 0o600 });
    this.child = spawn("bash", ["-c", command], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    this.stderr.on("error", () => this.fail(new JsonlProcessError("process", "could not write private adapter stderr")));
    this.child.on("error", () => this.fail(new JsonlProcessError("process", "could not start player adapter")));
    this.child.stdin.on("error", () => this.fail(new JsonlProcessError("process", "player adapter input closed")));
    this.child.stderr.pipe(this.stderr, { end: false });
    this.child.stdout.on("data", (chunk: Buffer) => this.consume(this.decoder.write(chunk)));
    this.exit = new Promise((resolve) => this.child.once("close", (code) => {
      this.ended = true;
      this.consume(this.decoder.end());
      if (this.buffer.length) this.fail(new JsonlProcessError("protocol", "player adapter ended with an unterminated JSONL record"));
      this.fail(new JsonlProcessError("process", `player adapter exited (${code ?? "signal"})`));
      this.stderr.end();
      resolve();
    }));
  }

  private consume(text: string): void {
    if (this.failure) return;
    this.buffer += text;
    for (;;) {
      const boundary = this.buffer.indexOf("\n");
      if (boundary < 0) break;
      const line = this.buffer.slice(0, boundary).replace(/\r$/, "");
      this.buffer = this.buffer.slice(boundary + 1);
      if (!line || Buffer.byteLength(line, "utf8") > this.limit) {
        this.fail(new JsonlProcessError("protocol", "invalid player adapter JSONL record size"));
        return;
      }
      let message: unknown;
      try { message = JSON.parse(line) as unknown; }
      catch {
        this.fail(new JsonlProcessError("protocol", "player adapter returned malformed JSONL"));
        return;
      }
      if (this.pending) {
        const waiting = this.pending;
        this.pending = undefined;
        waiting.resolve(message);
      } else {
        this.queue.push(message);
        if (this.queue.length > 32) {
          this.fail(new JsonlProcessError("protocol", "player adapter exceeded the message queue limit"));
          return;
        }
      }
    }
    if (Buffer.byteLength(this.buffer, "utf8") > this.limit) {
      this.fail(new JsonlProcessError("protocol", "player adapter exceeded the JSONL line limit"));
    }
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.pending?.reject(this.failure);
    this.pending = undefined;
  }

  async send(message: unknown, timeoutMs = 5_000): Promise<void> {
    if (this.failure) throw this.failure;
    if (this.ended) throw new JsonlProcessError("process", "player adapter is closed");
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line, "utf8") > this.limit) throw new JsonlProcessError("protocol", "outgoing player packet exceeds limit");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new JsonlProcessError("process", "player adapter stopped accepting input");
        this.fail(error);
        reject(error);
      }, Math.max(1, timeoutMs));
      this.child.stdin.write(line, (error) => {
        clearTimeout(timer);
        if (error) reject(new JsonlProcessError("process", "could not send player packet"));
        else resolve();
      });
    });
  }

  async read(timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    if (this.failure instanceof JsonlProcessError && this.failure.kind === "protocol") throw this.failure;
    if (this.queue.length) return this.queue.shift();
    if (this.failure) throw this.failure;
    if (this.pending) throw new JsonlProcessError("protocol", "concurrent player reads are not allowed");
    if (signal?.aborted) throw new JsonlProcessError("aborted", "player request aborted");
    return new Promise((resolve, reject) => {
      const finish = (error?: Error, message?: unknown): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (this.pending === pending) this.pending = undefined;
        if (error) reject(error);
        else resolve(message);
      };
      const onAbort = (): void => finish(new JsonlProcessError("aborted", "player request aborted"));
      const timer = setTimeout(() => finish(new JsonlProcessError("timeout", "player response deadline exceeded")), Math.max(0, timeoutMs));
      const pending = {
        resolve: (message: unknown): void => finish(undefined, message),
        reject: (error: Error): void => finish(error),
      };
      this.pending = pending;
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private signal(name: NodeJS.Signals): void {
    try {
      if (this.child.pid && process.platform !== "win32") process.kill(-this.child.pid, name);
      else this.child.kill(name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }

  async close(): Promise<void> {
    if (!this.ended) {
      this.signal("SIGTERM");
      const timer = setTimeout(() => this.signal("SIGKILL"), 1_000);
      timer.unref();
      await this.exit;
      clearTimeout(timer);
    }
    await finished(this.stderr);
  }
}
