# Texas Hold'em calibration

`reference/` is a deterministic implementation of `build.texas-holdem.v1`. It is
outside the active task package and therefore does not contribute to the task
hash or Agent workspace.

The reference exists to prove that every public case is jointly satisfiable. At
task hash `sha256:ff962bae33b5435d3f935467654d2e1996c47558ca36b8e859808c395c4b1072`
and seed `104729`, the canonical evaluator reports 100/100:

| Case | Points |
| --- | ---: |
| build | 5 |
| blinds-order | 10 |
| betting-round | 10 |
| short-allin | 10 |
| side-pots | 15 |
| hand-ranking | 15 |
| split-conservation | 10 |
| new-hand | 5 |
| run-seed | 5 |
| pointer-input | 10 |
| deterministic-bots | 5 |

The scenarios are directed contract fixtures, while an ordinary reset uses the
seeded full deck, shared reducer, complete betting flow, showdown ranking, and
pot engine. UI and Bridge actions dispatch through the same reducer.

## Calibration harness

`tools/calibrate-poker.mjs` (run by `pnpm calibrate:poker`, part of `pnpm check`)
runs through the real archiving and browser evaluation path and guards three
properties:

1. **Positive control** — the reference reaches `100/100` at the frozen task
   hash and canonical seed.
2. **Repeatability smoke** — the reference is evaluated twice; its frozen source
   hash, per-case pass/fail vector, and score must agree. Both evaluations and
   the four mutant runs are always performed. Two matching vectors are a smoke
   check, not a statistical proof of repeatability or independent Agent samples.
3. **Negative control (mutations)** — a small set of real, source-level mutants
   of `reference/src/main.ts` is produced in a temporary copy (the original
   reference is never modified). Each mutant must
   * keep the build hard gate open (it compiles, so a failure is real, not a
     compile error) and
   * flip the targeted atomic case from pass to fail; additional failing cases
     are reported rather than silently ignored.

The mutations currently guard the cases that target the trickiest poker rules:

| Mutation | Anchored source edit in `reference/src/main.ts` | Case that must fail |
| --- | --- | --- |
| short all-in reopens raising | `if(increment>=this.state.minRaiseIncrement){` → `if(increment>=0){` | `short-allin` |
| odd split-pot chip dropped | `const amount=base+(i<odd?1:0);` → `const amount=base;` | `split-conservation` |
| A2345 wheel straight not recognized | `if(unique.includes(14)) unique.push(1);` → `if(unique.includes(14)) { }` | `hand-ranking` |
| native check button not wired | `for(const kind of ["fold","check","call","all-in"] as const)` → `for(const kind of ["fold","call","all-in"] as const)` | `pointer-input` |

Each mutation anchors on a string that must appear exactly once, so a stale or
duplicated source edit fails loudly instead of silently no-op'ing. The runner
also reports any additional case a mutation regresses, so a broad engine bug is
distinguishable from an isolated rule bug. This calibration proves that each of
these four targeted cases can fail on its corresponding bug; it does not prove
that every assertion can fail or that the reducer is correct for every path
(the directed fixtures inject some scenario-specific behavior). The other three
tasks do not yet have equivalent reference/mutation coverage.

## Rebuild the fixture

```bash
cd benchmark/calibration/texas-holdem/reference
pnpm install --frozen-lockfile
pnpm build
```

## Run the calibration

```bash
cd <repository-root>
node tools/calibrate-poker.mjs
```

The harness needs `pnpm` and a Playwright Chromium browser; it seals the reference
(or a mutant copy) into a frozen archive and evaluates it with the canonical
seed, so the `packages/*/dist` build must be current.
