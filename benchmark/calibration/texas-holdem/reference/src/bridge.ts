export type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

export interface CarrickGameBenchBridge {
  version: "1";
  ready: Promise<void>;
  reset(input: { seed: number; scenario?: string }): Promise<void>;
  act(input: { type: string; payload?: JsonValue }): Promise<void>;
  advance(ms: number): Promise<void>;
  snapshot(): Promise<{
    status: "menu" | "running" | "won" | "lost";
    tick: number;
    score: number;
    seed: number;
    state: { [key: string]: JsonValue };
    events: Array<{ seq: number; type: string }>;
  }>;
}

declare global {
  interface Window { __CARRICK_GAMEBENCH__: CarrickGameBenchBridge; }
}
