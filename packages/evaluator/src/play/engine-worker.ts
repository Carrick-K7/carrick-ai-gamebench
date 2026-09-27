import { pathToFileURL } from "node:url";
import type { EngineRequest, EngineResponse, EngineView, ReferenceGame } from "./engine-protocol.js";

let game: ReferenceGame | undefined;
let initializing = false;

function observe(): EngineView {
  if (!game) throw new Error("engine is not initialized");
  const outcome = game.outcome();
  if (
    typeof outcome.terminal !== "boolean" || typeof outcome.won !== "boolean" ||
    !Number.isFinite(outcome.score) || outcome.score < 0
  ) throw new Error("reference engine returned an invalid outcome");
  return JSON.parse(JSON.stringify({
    public_state: game.publicState(), snapshot: game.snapshot(), outcome,
  })) as EngineView;
}

async function handle(request: EngineRequest): Promise<EngineResponse> {
  try {
    if (request.type === "init") {
      if (game || initializing) throw new Error("engine cannot be reset");
      initializing = true;
      if (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 0xffff_ffff) {
        throw new Error("engine seed must be uint32");
      }
      const module = await import(pathToFileURL(request.engine_path).href) as {
        createGame?: (seed: number) => ReferenceGame;
      };
      if (typeof module.createGame !== "function") throw new Error("missing createGame export");
      game = module.createGame(request.seed);
      if (![game.dispatch, game.publicState, game.snapshot, game.outcome].every((value) => typeof value === "function")) {
        throw new Error("reference engine does not implement the Play contract");
      }
    } else if (request.type === "dispatch") {
      if (!game) throw new Error("engine is not initialized");
      game.dispatch(request.command);
    } else if (request.type !== "observe") {
      throw new Error("unsupported engine request");
    }
    return { id: request.id, ok: true, view: observe() };
  } catch (error) {
    return { id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

process.on("message", (message: EngineRequest) => {
  void handle(message).then((response) => {
    if (process.connected) process.send?.(response);
  });
});
process.on("disconnect", () => process.exit(0));
