import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "@playwright/test";
import { evaluatorEnvironment } from "../process.js";
import { installRuntimeNetworkGuard } from "../runtime-security.js";
import {
  parseEngineCommand,
  type EngineCommand, type EngineRequest, type EngineResponse, type EngineView,
} from "./engine-protocol.js";

export type NativePlayAction =
  | { type: "key"; key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" }
  | { type: "click"; button: "left" | "right"; x: number; y: number };

export function validateNativeAction(input: NativePlayAction): void {
  if (input.type === "key") {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(input.key)) {
      throw new Error("unsupported native key");
    }
  } else if (
    input.type !== "click" || !["left", "right"].includes(input.button) ||
    !Number.isInteger(input.x) || !Number.isInteger(input.y) ||
    input.x < 0 || input.x >= 1280 || input.y < 0 || input.y >= 720
  ) throw new Error("native click must be inside the 1280x720 viewport");
}

/** The worker receives no provider credentials and has no model-facing API. */
export class PlayEngineClient {
  private readonly child: ChildProcess;
  private readonly waiting = new Map<number, {
    resolve: (view: EngineView) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private nextId = 0;
  private stopped = false;
  private stderr = "";
  private readonly exited: Promise<void>;

  constructor(private readonly timeoutMs = 5_000) {
    this.child = fork(fileURLToPath(new URL("./engine-worker.js", import.meta.url)), [], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: evaluatorEnvironment(),
      execArgv: [],
      detached: process.platform !== "win32",
    });
    this.child.stderr?.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-4096);
    });
    this.child.on("message", (message: EngineResponse) => {
      const pending = this.waiting.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.waiting.delete(message.id);
      if (message.ok) pending.resolve(message.view);
      else pending.reject(new Error(`reference engine: ${message.message}`));
    });
    this.child.on("error", (error) => this.rejectAll(error));
    this.exited = new Promise((resolve) => this.child.once("close", () => {
      this.stopped = true;
      this.rejectAll(new Error(`reference engine stopped unexpectedly${this.stderr ? `: ${this.stderr}` : ""}`));
      resolve();
    }));
  }

  private rejectAll(error: Error): void {
    for (const pending of this.waiting.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.waiting.clear();
  }

  private request(input: Omit<Extract<EngineRequest, { type: "init" }>, "id"> |
    Omit<Extract<EngineRequest, { type: "dispatch" }>, "id"> | { type: "observe" }): Promise<EngineView> {
    if (this.stopped || !this.child.connected) return Promise.reject(new Error("reference engine is unavailable"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error("reference engine request timed out"));
      }, this.timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
      this.child.send({ ...input, id }, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.waiting.delete(id);
        reject(error);
      });
    });
  }

  init(enginePath: string, seed: number): Promise<EngineView> {
    return this.request({ type: "init", engine_path: path.resolve(enginePath), seed });
  }
  observe(): Promise<EngineView> { return this.request({ type: "observe" }); }
  dispatch(command: EngineCommand): Promise<EngineView> { return this.request({ type: "dispatch", command }); }

  async close(): Promise<void> {
    if (this.stopped) return;
    this.rejectAll(new Error("reference engine closed"));
    const signal = (name: NodeJS.Signals): void => {
      try {
        if (this.child.pid && process.platform !== "win32") process.kill(-this.child.pid, name);
        else this.child.kill(name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    };
    signal("SIGTERM");
    const kill = setTimeout(() => signal("SIGKILL"), 1_000);
    kill.unref();
    await this.exited;
    clearTimeout(kill);
  }
}

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function requestJson(request: IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of request) {
    text += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (Buffer.byteLength(text, "utf8") > 4096) throw new Error("input body exceeds limit");
  }
  return JSON.parse(text) as unknown;
}

function clientHtml(token: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GameBench Play</title><style>html,body{margin:0;padding:0;overflow:hidden;width:1280px;height:720px}</style></head><body><main id="game"></main><script type="module">
import { mountGame } from '/renderer.mjs';
const headers = { 'x-cagb-play-session': ${JSON.stringify(token)} };
window.__CAGB_PLAY_PENDING = 0;
window.__CAGB_PLAY_READY = false;
window.__CAGB_PLAY_ERROR = null;
const paint = async (state) => {
  view.render(state);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
};
const view = mountGame(document.getElementById('game'), { onCommand: async (command) => {
  window.__CAGB_PLAY_PENDING++;
  try {
    const result = await fetch('/input', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(command) });
    if (!result.ok) throw new Error('game input failed');
    await paint((await result.json()).state);
  } catch (error) { window.__CAGB_PLAY_ERROR = String(error); }
  finally { window.__CAGB_PLAY_PENDING--; }
}});
try {
  const response = await fetch('/state', { headers });
  if (!response.ok) throw new Error('game initialization failed');
  await paint((await response.json()).state);
  window.__CAGB_PLAY_READY = true;
} catch (error) { window.__CAGB_PLAY_ERROR = String(error); }
</script></body></html>`;
}

export interface PlayBrowserOptions {
  enginePath: string;
  rendererPath: string;
  game: "2048" | "minesweeper";
  seed: number;
}

/** A short-lived loopback host. Only the visible projection and renderer reach Chromium. */
export class PlayBrowser {
  readonly engine = new PlayEngineClient();
  private readonly server = createServer((request, response) => { void this.handle(request, response); });
  private readonly token = randomUUID();
  private browser: Browser | undefined;
  private page: Page | undefined;
  private view: EngineView | undefined;
  private renderer = "";
  private origin = "";
  private failure: Error | undefined;
  private activeCommands: EngineCommand[] | undefined;
  private receivedInputs = 0;

  private constructor(private readonly options: PlayBrowserOptions) {}

  static async start(options: PlayBrowserOptions): Promise<PlayBrowser> {
    const runtime = new PlayBrowser(options);
    try {
      runtime.renderer = await readFile(options.rendererPath, "utf8");
      runtime.view = await runtime.engine.init(options.enginePath, options.seed);
      await new Promise<void>((resolve, reject) => {
        runtime.server.once("error", reject);
        runtime.server.listen(0, "127.0.0.1", () => {
          runtime.server.off("error", reject);
          resolve();
        });
      });
      const address = runtime.server.address();
      if (!address || typeof address === "string") throw new Error("Play host has no loopback port");
      runtime.origin = `http://127.0.0.1:${address.port}`;
      runtime.browser = await chromium.launch({
        headless: true,
        env: Object.fromEntries(Object.entries(evaluatorEnvironment()).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        )),
      });
      const context = await runtime.browser.newContext({
        viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
        locale: "en-US", timezoneId: "UTC", serviceWorkers: "block",
        reducedMotion: "reduce", colorScheme: "dark",
      });
      await installRuntimeNetworkGuard(context, runtime.origin);
      runtime.page = await context.newPage();
      runtime.page.on("pageerror", (error) => { runtime.failure = error; });
      await runtime.page.goto(runtime.origin, { waitUntil: "load", timeout: 15_000 });
      await runtime.settle();
      return runtime;
    } catch (error) {
      await runtime.close();
      throw error;
    }
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", this.origin || "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        });
        response.end(clientHtml(this.token));
      } else if (request.method === "GET" && url.pathname === "/renderer.mjs") {
        response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
        response.end(this.renderer);
      } else if (request.headers["x-cagb-play-session"] !== this.token) {
        reply(response, 403, { error: "forbidden" });
      } else if (request.method === "GET" && url.pathname === "/state") {
        reply(response, 200, { state: this.view?.public_state });
      } else if (request.method === "POST" && url.pathname === "/input") {
        if (request.headers.origin !== this.origin || !this.activeCommands || ++this.receivedInputs > 1) {
          reply(response, 409, { error: "input is not armed" });
          return;
        }
        let command: EngineCommand;
        try { command = parseEngineCommand(await requestJson(request), this.options.game); }
        catch { reply(response, 400, { error: "invalid input" }); return; }
        this.view = await this.engine.dispatch(command);
        this.activeCommands.push(command);
        reply(response, 200, { state: this.view.public_state });
      } else reply(response, 404, { error: "not found" });
    } catch (error) {
      this.failure = error instanceof Error ? error : new Error(String(error));
      reply(response, 500, { error: "runtime failure" });
    }
  }

  private async settle(): Promise<void> {
    if (this.failure) throw this.failure;
    if (!this.page) throw new Error("Play browser is unavailable");
    await this.page.waitForFunction(() => {
      const state = globalThis as typeof globalThis & {
        __CAGB_PLAY_READY?: boolean; __CAGB_PLAY_PENDING?: number; __CAGB_PLAY_ERROR?: string;
      };
      return state.__CAGB_PLAY_ERROR || (state.__CAGB_PLAY_READY && state.__CAGB_PLAY_PENDING === 0);
    }, undefined, { timeout: 10_000 });
    const clientError = await this.page.evaluate(() => (globalThis as typeof globalThis & { __CAGB_PLAY_ERROR?: string }).__CAGB_PLAY_ERROR);
    if (this.failure) throw this.failure;
    if (clientError) throw new Error(`reference renderer: ${clientError}`);
  }

  async frame(): Promise<Buffer> {
    await this.settle();
    return this.page!.screenshot({ type: "png", animations: "disabled", timeout: 10_000 });
  }

  async snapshot(): Promise<EngineView> {
    await this.settle();
    return this.engine.observe();
  }

  async act(action: NativePlayAction): Promise<{ commands: EngineCommand[]; view: EngineView }> {
    validateNativeAction(action);
    if (this.activeCommands) throw new Error("a Play input is already in progress");
    await this.settle();
    this.activeCommands = [];
    this.receivedInputs = 0;
    try {
      if (action.type === "key") await this.page!.keyboard.press(action.key);
      else await this.page!.mouse.click(action.x, action.y, { button: action.button });
      await this.settle();
      const commands = this.activeCommands;
      return { commands, view: await this.engine.observe() };
    } finally { this.activeCommands = undefined; }
  }

  /** For security/preflight assertions only, never supplied to a model adapter. */
  get url(): string { return this.origin; }

  async close(): Promise<void> {
    try { await this.browser?.close(); }
    finally {
      try {
        if (this.server.listening) {
          this.server.closeAllConnections();
          await new Promise<void>((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
        }
      } finally { await this.engine.close(); }
    }
  }
}
