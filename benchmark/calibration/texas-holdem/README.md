# Texas Hold'em calibration

`reference/` is a deterministic implementation of `build.texas-holdem.v1`. It is outside the active task package and therefore does not contribute to the task hash or Agent workspace.

The reference exists to prove that every public case is jointly satisfiable. At task hash `sha256:ff962bae33b5435d3f935467654d2e1996c47558ca36b8e859808c395c4b1072` and seed `104729`, the canonical evaluator reports 100/100:

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

The scenarios are directed contract fixtures, while an ordinary reset uses the seeded full deck, shared reducer, complete betting flow, showdown ranking, and pot engine. UI and Bridge actions dispatch through the same reducer.

To rebuild the fixture:

```bash
cd benchmark/calibration/texas-holdem/reference
pnpm install --frozen-lockfile
pnpm build
```
