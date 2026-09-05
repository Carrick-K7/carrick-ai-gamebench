import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  findRepositoryRoot,
  loadTask,
} from "../packages/core/dist/index.js";
import { sealSubmissionWorkspace } from "../packages/evaluator/dist/archive.js";
import { evaluateSubmissionArchive } from "../packages/evaluator/dist/evaluate.js";

// This calibration seals a real source tree into the canonical frozen archive
// and evaluates it through the ordinary browser runner. It proves two things:
//
//   1. Positive control: the Texas Hold'em reference implementation is joint-
//      satisfiable (100/100) AND reproducible across repeated canonical runs.
//   2. Negative control: a small set of targeted, real source-code mutants each
//      fails its own atomic case while leaving the build hard gate open. This
//      guards against a case that can never fail (an assertion that cannot be
//      broken by a realistic implementation bug) and against false positives
//      where a "failure" is really just a compile error.
//
// Mutants are produced by copying the reference into a temporary directory and
// applying a single, source-level text patch. The original reference files are
// never modified. Each mutant must (a) compile (build gate passes) and (b) flip
// the targeted case from pass to fail.

const SEED = 104729;

/** One mutant => one anchored source edit in `file`, expected to flip `target`. */
const MUTANTS = [
  {
    label: "short all-in incorrectly reopens raising",
    target: "short-allin",
    file: "src/main.ts",
    // `playerAction` all-in branch: an all-in smaller than the minimum raise
    // increment must NOT reopen betting for a player who already acted. Forcing
    // the reopen guard to always run makes a short all-in reopen the raise.
    find: "if(increment>=this.state.minRaiseIncrement){",
    replace: "if(increment>=0){",
  },
  {
    label: "odd split-pot chip is dropped (conservation broken)",
    target: "split-conservation",
    file: "src/main.ts",
    // `resolveShowdown` payout loop: the odd chip (pot % winners) is awarded to
    // the clockwise-first winner. Dropping it loses a chip from the payouts.
    find: "const amount=base+(i<odd?1:0);",
    replace: "const amount=base;",
  },
  {
    label: "A2345 wheel straight is not recognized",
    target: "hand-ranking",
    file: "src/main.ts",
    // `evaluateFive`: appending rank 1 to the unique ranks is what lets the
    // five-high wheel be seen as a consecutive run. Removing it mis-ranks the
    // wheel sample as high-card.
    find: "if(unique.includes(14)) unique.push(1);",
    replace: "if(unique.includes(14)) { }",
  },
  {
    label: "native check button no longer dispatches",
    target: "pointer-input",
    file: "src/main.ts",
    // `render` control wiring: the Check button click listener is registered by
    // iterating over the action kinds. Dropping "check" leaves the button with
    // no handler, so a real pointer click reaches no reducer.
    find: 'for(const kind of ["fold","check","call","all-in"] as const)',
    replace: 'for(const kind of ["fold","call","all-in"] as const)',
  },
];

/**
 * Build the frozen source archive for `workspace` and evaluate it once through
 * the canonical browser runner. Returns the evaluator result.
 */
async function evaluateSource(workspace, runDir) {
  const archivePath = path.join(runDir, "source.tar.zst");
  const sealed = await sealSubmissionWorkspace(
    workspace,
    archivePath,
    path.join(runDir, "archive.log"),
  );
  const result = await evaluateSubmissionArchive(task, {
    archivePath,
    sourceSnapshotHash: sealed.sourceSnapshotHash,
    evaluationDir: runDir,
    seed: SEED,
  });
  return { ...result, sourceHash: sealed.sourceSnapshotHash };
}

/** Ordered test vector, ignoring non-deterministic timing and artifact paths. */
function passedVector(result) {
  return result.outcomes.map((outcome) => `${outcome.id}:${outcome.passed}`).join(",");
}

/**
 * The set of atomic cases that the reference passes but `result` fails. This is
 * the "mutation delta": the cases whose assertion actually fired on this bug.
 */
function regressedCases(result, reference) {
  const referenceBy = new Map(reference.outcomes.map((outcome) => [outcome.id, outcome.passed]));
  return result.outcomes
    .filter((outcome) => referenceBy.get(outcome.id) === true && outcome.passed === false)
    .map((outcome) => outcome.id)
    .sort();
}

function targetTest(result, id) {
  return result.score.tests.find((test) => test.id === id);
}

/** A mutant is valid only if the build hard gate is open and the target flipped. */
function buildGateOpen(result) {
  const build = targetTest(result, "build");
  return result.score.hard_gate_failed === false && build?.passed === true;
}

/** Copy the reference into `runDir/workspace` and apply the source mutation. */
async function buildMutant(reference, mutant, runDir) {
  const workspace = path.join(runDir, "workspace");
  await cp(reference, workspace, {
    recursive: true,
    // Match the archive's top-level exclusions instead of copying local caches.
    filter: (entry) => ![".git", "node_modules", "dist"].includes(
      path.relative(reference, entry).split(path.sep)[0],
    ),
  });
  const file = path.join(workspace, mutant.file);
  const source = await readFile(file, "utf8");
  const anchor = source.indexOf(mutant.find);
  if (anchor === -1 || source.indexOf(mutant.find, anchor + 1) !== -1) {
    throw new Error(
      `mutation anchor for "${mutant.label}" must appear exactly once in ${mutant.file}`,
    );
  }
  await writeFile(file, source.replace(mutant.find, mutant.replace));
  return workspace;
}

const repositoryRoot = await findRepositoryRoot();
const task = await loadTask("build.texas-holdem.v1", repositoryRoot);
const reference = path.join(
  repositoryRoot,
  "benchmark",
  "calibration",
  "texas-holdem",
  "reference",
);
const temporary = await mkdtemp(path.join(os.tmpdir(), "cagb-poker-calibration-"));

try {
  // ---- 1. Reference: positive control + reproducibility (two canonical runs).
  const first = await evaluateSource(reference, path.join(temporary, "ref-run-1"));
  const referenceFailures = first.outcomes.filter((outcome) => !outcome.passed);
  if (first.score.percent !== 100 || referenceFailures.length > 0) {
    throw new Error(
      `Texas Hold'em reference no longer reaches 100/100 (${first.score.percent}); ` +
        referenceFailures.map((outcome) => `${outcome.id}: ${outcome.message ?? "failed"}`).join("; "),
    );
  }
  const second = await evaluateSource(reference, path.join(temporary, "ref-run-2"));
  if (
    second.sourceHash !== first.sourceHash ||
    passedVector(second) !== passedVector(first) ||
    second.score.percent !== first.score.percent
  ) {
    throw new Error(
      "Texas Hold'em reference source hash or test vector changed between canonical runs: " +
        passedVector(second),
    );
  }
  console.log(
    `PASS  Texas Hold'em reference: 100/100 (${task.hash}); same source hash and test vector across two canonical runs`,
  );

  // ---- 2. Mutants: each must compile and fail its targeted case.
  let failures = 0;
  for (const mutant of MUTANTS) {
    const runDir = path.join(temporary, `mutant-${mutant.target}`);
    const workspace = await buildMutant(reference, mutant, runDir);
    const result = await evaluateSource(workspace, runDir);
    const target = targetTest(result, mutant.target);
    const gateOpen = buildGateOpen(result);
    const regressed = regressedCases(result, first);

    const valid = gateOpen && target?.passed === false && regressed.includes(mutant.target);
    if (!valid) {
      failures += 1;
      console.error(
        `FAIL  ${mutant.label}\n` +
          `        target=${mutant.target} passed=${target?.passed} gateOpen=${gateOpen} regressed=${regressed.join(",") || "none"}`,
      );
      continue;
    }
    const extra = regressed.filter((id) => id !== mutant.target);
    console.log(
      `PASS  ${mutant.label}\n` +
        `        build gate open; ${mutant.target} failed as expected` +
        (extra.length > 0 ? `; also regressed: ${extra.join(", ")}` : ""),
    );
  }

  if (failures > 0) {
    throw new Error(`Texas Hold'em mutation calibration failed for ${failures} mutant(s)`);
  }
  console.log(`PASS  Texas Hold'em mutation calibration: ${MUTANTS.length} mutants verified`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
