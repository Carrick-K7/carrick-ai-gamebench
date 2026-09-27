# GameBench Play: visual player protocol

Instrument: GameBench 0.7.0. Reference calibration and model-free runtime tests are included; no measured model results accompany this release. See [operations](play-operations.md) before any paid execution.

## What is measured

Play measures a configured visual player system's decisions and native interaction with fixed maintainer-owned games. It measures perception, operation and bounded game strategy together, not code generation, pure structured-state reasoning, creativity or fun.

Build remains independent. A model need not complete Build to enter Play, and Play performance never changes a Build score. Generated Build games are not the Play test environments.

## First instrument

Two game-specific endpoints are preregistered; there is no Play total.

- **2048 at 200 decisions:** arithmetic mean of ten native game scores. Standard 4x4 merging, two initial tiles and 9:1 2/4 spawns after effective moves. A locked board ends normally. This is a limited-opening test, not a 2048-completion test.
- **Minesweeper:** percentage of ten episodes in which every safe cell is revealed. Board 10x10 with ten mines; the first effective reveal and its valid neighbors are protected during deterministic placement. Right-click flags, eight-neighbor numbers and flood expansion are part of the frozen engine. Limit 128 decisions. Boards are not guaranteed guess-free; hitting a mine is an ordinary scored loss.

Every episode uses a distinct preregistered seed and fresh player context. Record every episode, including failures, rather than selecting a best attempt. An ineffective action still consumes a decision. No undo, reset or save/load exists in the scored player interface.

## Observation and action

The player receives a 1280x720 DPR1 PNG, fixed game instructions, remaining budget, the last eight action records and its own previous memo (at most 1,024 UTF-8 bytes). Only the current frame is supplied; context does not grow through unlimited frame history or hidden automatic summarization.

No structured board, DOM, source, seed, private engine state or legal-action advice is supplied. The player cannot execute a solver or invoke browser JavaScript. Actions are one arrow key or one left/right click at integer viewport coordinates. The runner dispatches native input; it does not translate a model's strategic instruction into a privileged game-state mutation.

The engine is authoritative for score and termination. Its private state is separate from the visible projection; concealed Minesweeper cells have no mine/count metadata in the projection. Legitimate post-loss disclosure occurs only after play has ended.

## Opportunity and cost

A decision slot lasts at most 60 seconds, including any permitted transport retry. There is no shorter episode clock that silently reduces the fixed action opportunity. An entire two-game series has at most 3,280 ordinary decision requests, before separately recorded infrastructure retries.

Malformed/refused responses consume a slot without game advancement; three consecutive invalid responses stop the episode. Decision timeout and step exhaustion end the episode with achieved 2048 score or a Minesweeper loss unless already won. These are outcomes of the budgeted configured system, not causal claims about which provider component was slow.

Only explicit transport failure before any model content permits one identical-request retry within the original slot deadline. Content already received cannot be discarded to sample a better action. Underlying adapter auto-retry/auto-compaction is disabled; no whole-game restart is hidden inside recovery.

Report observed tokens, request counts, latency and cost when available. Unknown usage remains unknown. Equal action budgets are not equal tokens, compute or money. None is a rank tie-breaker.

## Randomness and Campaigns

The release freezes the sampling protocol and counts. Each Play Campaign commits the canonical hash of its private seed bundle before execution. Every planned cell must use that same bundle/order; the runner checks the input commitment before measured work. Seed selection must not use any measured model's results.

Seeds remain outside all player-visible channels and are disclosed with reviewed results only after all Campaign cells finish. New experiments get new Campaign and series identities. Results identify game, task, protocol, renderer/resources, model/provider/harness parameters and source commit rather than asserting that a provider alias names immutable weights.

## Failure ownership and completeness

Reference engine defects, browser failure, trusted adapter bugs and unrecovered provider service errors are infrastructure errors. They produce no episode score and do not become model zeroes. A series with missing/unscored episodes cannot be ranked by averaging just its successful episodes. An incomplete Campaign cannot be published as a complete planned experiment.

Normal game losses, bounded invalid-response stops and budget exhaustion are scored outcomes. A terminated series is not silently restarted or reused. Failure evidence is retained so absence of a score is distinguishable from a low score.

## Evidence and replay

A sealed episode binds the game/protocol hashes, private seed, native actions, resulting engine commands, deterministic state hashes, original PNG hashes, usage and termination. The scorer recomputes state and score from the initial seed plus recorded commands. A browser replay reissues the recorded native actions and compares the resulting command stream and state.

Replay does not call the model or load a recorded terminal snapshot to pretend the score was independently calculated. Original PNG files are checked by hash. The current browser checker additionally requires the re-rendered PNGs to match, so run it in the same pinned Chromium/font environment as capture. Engine-only replay remains a cross-host state/score diagnostic, not visual verification; a raster mismatch must not be converted into a model zero.

Official remains a maintainer-operated, Git-reviewed experiment. Hashes and reproducible transcripts support auditing; they do not prove the provenance of proprietary model weights or make a malicious operator unable to fabricate observations.

## Interpretation and public display

Display the entire episode vector, sample count, 2048 sample standard deviation/max tiles and Minesweeper win/loss/coverage. Sort on the exact unrounded primary metric with competition ties. Missing/non-finite results are not ranked.

Ten episodes are a small sample. Do not interpret small gaps as statistically significant or mix between-game spread into a confidence interval. Cross-Campaign comparisons may differ in seed bundle, execution time, provider and host and must be labeled descriptive rather than paired.

Human practice may reuse the exact fixed game logic and rendering resources with fresh practice seeds. It is explicitly unranked, has no model calls, and cannot produce an Official result. Public replay/source/playable links are conditional on actually published artifacts; a hash alone is not a download or a playable output.

See [ADR 0003](adr/0003-build-and-play-suites.md) for boundaries and [the implementation brief](build-play-implementation.md) for schema, CLI and acceptance details.
