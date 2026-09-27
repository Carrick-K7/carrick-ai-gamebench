# Approved Build / Play implementation plan

Status: approved by the maintainer through plan review; implemented in 0.7.0. The maintainer subsequently authorized architecture simplification and version publication. Operational commands and verification boundaries are documented in [play-operations.md](play-operations.md).

This is the durable implementation brief for the dual-suite design. Publishing the software does not claim measured Play results or authorize paid model runs or production deployment. See [0.7.0 release notes](releases/0.7.0.md) for the final scope.

## Product boundary

- **Build** measures one Coding Agent's frozen game delivery against the existing four public contracts. Preserve all 0.6 scoring, prompts, task hashes, seeds, budgets, results and Campaigns.
- **Play** measures a visual player system (model + player harness + configuration) interacting with immutable maintainer-owned games. It is a live decision loop, not an Agent writing a solver/bot for later execution.
- No Build + Play aggregate. The first Play release also has **no cross-game Play score**: two native game metrics, two rankings.
- Playing generated Build artifacts is a future auxiliary QA experiment. It must neither become the Play dataset nor repair a frozen Build delivery.
- One repository, existing Core/Evaluator packages and static site. No new platform, database, queue, provider SDK in Core/Evaluator, production server or deployment target.

## Approved Play instrument

| Item | 2048 | Minesweeper |
| --- | --- | --- |
| Task id | `play.2048.v1` | `play.minesweeper.v1` |
| Rules | 4x4, two initial tiles, one 2/4 after effective moves with 9:1 probability, native merge score | 10x10, 10 mines, first effective reveal and its valid eight neighbors safe, eight-neighbor numbers/flood, right-click flags |
| Decisions per episode | 200 | 128 |
| Episodes per complete series | 10 distinct seeds | 10 distinct seeds |
| Primary endpoint | `play.2048.mean_score` | `play.minesweeper.win_rate` |
| Secondary | every raw score, sample SD, max tile, effective moves | every win/loss, safe-cell coverage, action count |
| Normal end | no legal move or decision limit | all safe cells revealed, mine, or decision limit |

2048 is an opening/limited-move evaluation, not a 2048 completion test. Minesweeper does not guarantee guess-free boards. Native losing outcomes remain scored.

A decision slot has a 60-second deadline including any allowed transport retry. No shorter episode deadline silently reduces the action budget. No undo/restart/load. Invalid JSON, unsupported actions, off-board clicks and ineffective moves consume slots. Three consecutive invalid model responses stop the episode. A timeout, invalid-response stop, or budget stop keeps earned 2048 score and counts as a Minesweeper loss unless already won.

The maximum is 3,280 ordinary decision requests per complete system measurement, plus at most one recorded transport retry per slot. Do not claim equal token/compute expenditure or invent prices; record provider usage, latency and cost when available, otherwise unknown. These are not rank tie-breakers.

## Observation and decision protocol

- Viewport 1280x720, DPR 1, PNG; pinned resources and no game-affecting wall clock or animations.
- Only the current screenshot, game rules, remaining budget, last eight action records, and a self-authored memo of at most 1,024 UTF-8 bytes are model-visible. No accumulated screenshot history, structured board, DOM, source, engine state, legal-move advice, seed, or hidden minefield.
- Every episode starts with empty memory. Every decision reconstructs this bounded context.
- Versioned JSONL envelope: `init`, `observe`, `action`, `finish`, with request/response correlation by `turn_id`. Never accept duplicate or stale actions.
- Native action payloads:
  - `{ "type": "key", "key": "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" }`
  - `{ "type": "click", "button": "left" | "right", "x": integer, "y": integer }` within the viewport.
- One native action per decision. No JS, code execution, arbitrary keys/chords, action batches or navigation.
- Action reply carries the action and optional bounded `memo`. No internal chain-of-thought is requested or published.
- The first real adapter is an external trusted Pi no-tools RPC wrapper. The installed 0.84.3 supports image prompts, `--no-tools`, `--no-session`, `--no-context-files`, `--no-extensions`, `--no-skills`, `set_auto_compaction(false)` and `set_auto_retry(false)`. Reconstruct bounded requests using fresh sessions rather than hidden compaction.
- Only the adapter accesses provider credentials. The engine/browser receive an allowlisted credential-free environment. This remains maintainer-operated, not host-level attestation.
- Inspection of Pi 0.84.3 found that RPC `set_auto_compaction` / `set_auto_retry` call `SettingsManager.save()` and would modify the real global settings. The adapter must therefore use a private 0700 temporary `PI_CODING_AGENT_DIR` outside raw evidence, with 0600 runtime-only auth/model metadata copies if needed and explicit settings disabling compaction, agent retry, provider retry (`retry.provider.maxRetries:0`), image resizing, telemetry and startup networking (`--offline`). Never operate these RPC setters on the user's actual agent directory. Delete the temporary directory on every exit; never log/copy credentials into `runs` or public artifacts. Tests use fake credential fixtures and fake Pi, not real auth/model calls.

## Fixed engine contract (implementation integration boundary)

Reference tasks live under `benchmark/play/<game>/v1/`, outside the legacy recursive Build task loader. Each task is a dependency-free, versioned ESM package whose game logic, renderer, resources, prompt, manifest and license are hashed together.

A reference `engine.mjs` exports `createGame(seed)` where seed is an unsigned 32-bit integer. The returned object exposes:

- `dispatch(command)` for **engine** commands (not a model/player interface): 2048 `{type:'move',direction:'up'|'down'|'left'|'right'}`; Minesweeper `{type:'reveal'|'flag',row,col}`.
- `publicState()` returns a deep-copy JSON-safe, positively constructed visible projection. Unrevealed cells must not contain mines or adjacent counts. Legitimate post-loss revealed mines are allowed only after termination.
- `snapshot()` returns a deep-copy JSON-safe private deterministic state, including RNG state as necessary. It is for runner evidence/replay only.
- `outcome()` returns `{terminal:boolean,won:boolean,score:number,max_tile?:number,effective_moves?:number,revealed_safe?:number,safe_cells?:number}`. No getters depend on wall time or mutate the engine.

The renderer maps **real** keyboard/pointer events to those engine commands. The official engine is owned by the runner, not browser global state. Browser-side commands cannot reset or peek. The same pure engine/renderer resources support explicitly unranked static human practice with fresh practice seeds.

Canonical scoring uses the private engine outcome, not model claims, OCR or browser UI text. Model-free engine replay recomputes every state transition from the seed and actual commands. Native browser replay reissues the recorded keyboard/pointer inputs and must yield the same command stream and state/score. It must never validate by merely loading a recorded final snapshot.

## Seeds and failure ownership

- Release locks freeze the sampling procedure and episode counts. Before any measured call, a Campaign commits the canonical SHA-256 hash of a private seed bundle containing the ten distinct seeds for each task.
- All cells of that Campaign use the same bundle and order. No selection based on model results. The private input file must match the commitment before run allocation/paid work, and is sealed inside each canonical raw series.
- Seeds must not reach player prompts, screenshots, HTML hidden data, ordinary game APIs or the model-visible action history. Reveal only after all Campaign cells finish, in reviewed public data.
- Distinct seeds and fresh episode contexts support descriptive within-game statistics. Ten episodes are a small sample, not evidence of broad game-playing superiority. Cross-Campaign comparisons are explicitly descriptive, not paired.
- Invalid/refused model responses are budgeted player-system behavior, with the three-consecutive-invalid stop. Decision deadline exhaustion is a bounded-system outcome, not a claim that the underlying model caused a network delay.
- Only an explicit transport failure **before any model content** can retry the identical pending request once, within its original deadline. No resampling after model content/action, no silent episode or series restart.
- Maintainer game defects, browser failure, trusted adapter failure and unrecovered provider service errors are infrastructure failures: no episode score, no complete-series rank. Never average only the surviving episodes.
- Terminated series identities are never reused. Incomplete Campaigns must not be presented as complete publications.

## Identity and compatibility

New generation (target 0.7):

- **ReleaseLock v4** declares both `suites.build` and `suites.play` under one `benchmark_version`. Build's instrument remains the current four-task v0.6 contract. One version therefore has no suite collision.
- **Flat Result v3** is a discriminated `suite: build | play` union; each series belongs to exactly one suite. Play includes episode vectors/coverage/per-game metrics, **not `play.score`**. Its `game_hash` and `trajectory_hash` are not fake Build `source_hash` values.
- **Campaign v2** is single-suite. Build's endpoint remains `build.score`; Play preregisters both native endpoints above. Execution bindings include suite/protocol as appropriate; v1 plan hashes are unchanged.
- Preserve old release/result/Campaign validators, legacy `TrackSchema(build|reproduce)` and historical views. Treat 0.6 result v2 as Build only in memory, without rewriting it.
- Existing raw/public namespaces and flat index stay unchanged:

```text
benchmark/releases/<version>.json
benchmark/campaigns/<version>/<campaign-id>.json
runs/<version>/<series-id>/
results/lite/<version>/<series-id>.json
```

Play episodes belong below `tasks/<task-id>/episodes/` within a series. Do not create a second result ledger or move old records. New readers dispatch by exact record version/schema, never the currently installed lock.

## CLI and site

- `cagb bench --suite build|play`; old local invocation defaults to Build. Campaign derives suite from its plan, and any explicit suite must match.
- `--benchmark-version` selects an instrument, not a score override. The Play seed input must match the plan commitment.
- `cagb doctor --suite build|play`; no suite checks both active suites. Preflight and default tests do not call paid models.
- `check/publish/campaign check/campaign publish` validate both schema generations by the actual record version. Complete coverage is mandatory.
- `cagb replay --run ... --task ... --episode ...` performs Play replay without model calls.
- Site: clear Build and Play entry points, separate versioned per-game Play rankings, preserved historical URLs and existing `/leaderboard` Build compatibility.
- Human practice reuses frozen reference resources, is unranked, has no model calls or online submissions. Generated Build artifacts retain untrusted-origin/sandbox rules.
- Fix the homepage's Experimental-only public count (currently omitting seven Official results); choose result-bearing versions independently per suite; no fake zero for absent results.
- Playable/source/replay/evidence availability is conditional on actual published artifacts. Do not auto-commit raw frames/traces or promise hosting not selected by the maintainer.
- Link to LLM Showcase and explain the boundary; do not modify that project.

## Implementation phases and acceptance

1. ADR/docs, additive core schemas and routing, historical compatibility tests.
2. 2048 engine + native browser + scripted player + sealed trajectory + two replay paths. Single-game development is not a qualified Play series.
3. Minesweeper hidden-state boundary and two-game reference calibration.
4. No-tools Pi adapter, deadlines/retries, seed commitments, Campaign/CLI/publication integration. Use fake models/RPC streams for tests.
5. Dual-suite site, unranked practice, accurate counts/attachments, full verification. Freeze the new release lock only after calibration; publishing the release is separate authorization.

Required checks:

- Existing tests pass and old hashes/results/ranks remain unchanged.
- Engine rule/property tests; correct renderer/input mapping; hidden state absent from all model channels.
- Reference policies using visible information outperform random policies on a separate fixed calibration set; input/scoring/projection/secret-leak mutants are detected before paid ranking.
- Fresh-process replay equals original state and score; seed/action/frame/termination/aggregate tampering is rejected.
- Invalid/duplicate/timeout/transport/browser/adapter/partial-result/commitment mismatch injection tests.
- No mixed-suite or mixed-version aggregate; exact recomputable per-game metrics, competition ties, complete publication coverage, honest empty states.
- Pinned Node 22.22.0 / pnpm 10.33.0, full `pnpm check`, Build and Play doctors; exact-commit CI if separately asked to push.

Deferred: changes to Build scoring, historical regrading, parking realtime control, poker opponents, solver/code tools, subjective fun scores, Build-feedback repair loop, paid campaigns, version publication and deployment.
