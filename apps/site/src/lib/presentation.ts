import { defaultOfficialSeed } from "./data.ts";

export interface SeededRun {
  run_id: string;
  seed: number;
}

export function sortRunsForPresentation<T extends SeededRun>(runs: T[]): T[] {
  return [...runs].sort(
    (left, right) =>
      Number(left.seed !== defaultOfficialSeed) -
        Number(right.seed !== defaultOfficialSeed) ||
      left.seed - right.seed ||
      left.run_id.localeCompare(right.run_id),
  );
}

export function sampleLetter(index: number): string {
  return index >= 0 && index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

export function sampleIndexForRun<T extends SeededRun>(runs: T[], runId: string): number {
  return sortRunsForPresentation(runs).findIndex((run) => run.run_id === runId);
}
