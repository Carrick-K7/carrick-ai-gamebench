import type { JsonValue } from "@carrick/gamebench-core";

/** Private runner/engine IPC. None of this protocol is sent to a player. */
export type EngineCommand =
  | { type: "move"; direction: "up" | "down" | "left" | "right" }
  | { type: "reveal" | "flag"; row: number; col: number };

export interface EngineOutcome {
  terminal: boolean;
  won: boolean;
  score: number;
  max_tile?: number;
  effective_moves?: number;
  revealed_safe?: number;
  safe_cells?: number;
}

export interface EngineView {
  public_state: JsonValue;
  snapshot: JsonValue;
  outcome: EngineOutcome;
}

export interface ReferenceGame {
  dispatch(command: EngineCommand): unknown;
  publicState(): JsonValue;
  snapshot(): JsonValue;
  outcome(): EngineOutcome;
}

export type EngineRequest =
  | { id: number; type: "init"; engine_path: string; seed: number }
  | { id: number; type: "observe" }
  | { id: number; type: "dispatch"; command: EngineCommand };

export type EngineResponse =
  | { id: number; ok: true; view: EngineView }
  | { id: number; ok: false; message: string };

export function parseEngineCommand(input: unknown, game: "2048" | "minesweeper"): EngineCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("engine command must be an object");
  }
  const command = input as Record<string, unknown>;
  if (game === "2048" && command.type === "move") {
    if (
      Object.keys(command).sort().join(",") === "direction,type" &&
      ["up", "down", "left", "right"].includes(String(command.direction))
    ) {
      return { type: "move", direction: command.direction as "up" | "down" | "left" | "right" };
    }
  }
  if (game === "minesweeper" && (command.type === "reveal" || command.type === "flag")) {
    if (
      Object.keys(command).sort().join(",") === "col,row,type" &&
      Number.isInteger(command.row) && Number.isInteger(command.col) &&
      (command.row as number) >= 0 && (command.row as number) < 10 &&
      (command.col as number) >= 0 && (command.col as number) < 10
    ) {
      return { type: command.type, row: command.row as number, col: command.col as number };
    }
  }
  throw new Error("unsupported engine command");
}
