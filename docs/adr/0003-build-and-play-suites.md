# ADR 0003: Independent Build and Play suites

- Status: Accepted and implemented in 0.7.0; no measured model results accompany the release
- Decision owners: GameBench maintainers
- Scope: the new 0.7 protocol generation; no reinterpretation of older releases

## Context

Game delivery and game playing answer different questions. A correct game implementation does not prove that its author is a capable player; a successful player does not prove that an arbitrary generated game is correct or enjoyable. GameBench should support both measurements without hiding their differences inside one score or creating a second operational platform.

The maintainer chose screenshot/native-input Play, initially 2048 and Minesweeper. The first Play endpoints are bounded 2048 native score and Minesweeper win rate, not a cross-game total. AI playtesting generated Build deliveries remains a separate potential QA experiment.

## Decision

1. **One brand and monorepo, two explicit suites.** Build keeps the current four public development contracts unchanged. Play uses maintainer-owned deterministic game engines, fixed renderers and an interactive visual player protocol.
2. **Separate measured objects and scores.** Build is one frozen Agent delivery; Play is a complete preregistered set of fresh player episodes. No Build/Play composite, no `play.score`, no historical Core/Reproduce revival, and no subjective fun/aesthetic score.
3. **Share low-level infrastructure, not false data models.** Core owns strict contracts, hashes and pure reducers. Evaluator owns process/browser lifecycle, evidence checks and publication. Play's live model calls occur only in a trusted external player adapter. Its `game_hash` and `trajectory_hash` must not masquerade as a Build submission's `source_hash`.
4. **Add schema generations.** ReleaseLock v4 contains `suites.build` and `suites.play`; flat result v3 and Campaign v2 each select exactly one suite. Legacy readers and identity/hash functions keep their old meaning. In particular, historical `TrackSchema(build|reproduce)` is not silently widened.
5. **Keep canonical namespaces.** The release, Campaign, series and flat publication paths in ADR 0002 remain unchanged. Per-episode evidence is a version-specific substructure below an existing task directory. One release can contain both instruments; unique series identities prevent collisions without suite directory levels.
6. **Authoritative engine, bounded player channel.** Only screenshot/rules/bounded action memory reach the player. Hidden state, seeds, resets and source inspection are not player tools. The engine owns transitions, scoring and termination. The browser receives a positively constructed visible projection, not a full-state object with a blacklist.
7. **Deterministic evidence verification, not deterministic models.** Replay reexecutes recorded actions against the frozen engine and can reissue native inputs in a fresh browser. It neither calls the model again nor accepts an injected recorded final state as proof. Official remains maintainer-operated and auditable, not trustless.
8. **Predeclare randomness and failures.** Play Campaigns commit the seed-bundle hash before execution and disclose seeds only after every planned cell finishes. Partial/infrastructure-failed measurements are not silently averaged or ranked. Player/system budget outcomes are distinct from maintainer engine, browser, adapter and provider service defects.

## Relationship to prior ADRs

ADR 0001's separate boundary for subjective Creative evaluation remains in force. Machine-scored playing on fixed games is not Creative, Reproduce, or human QA annotation. This ADR explicitly authorizes the new Play suite only through new contracts and independent endpoints; it does not change any previous board.

ADR 0002's layout does not need a migration:

1. The missing first-principles capability is measurement of a visual player's decisions, rather than generated-code correctness.
2. It is expressible as `suite` plus new release/result/Campaign schemas; therefore no outer path change is justified.
3. Existing releases and observations remain at the same paths and retain their exact hashes and URLs.
4. Regression checks enforce single-suite Campaigns/results, correct release selection, immutable old records, independent metrics and no cross-suite aggregate.

## Consequences

The interactive Play runner and typed failure/transport policy are genuinely new protocol work; this is not a 0.6.1 wording patch. No package split, provider SDK in Core/Evaluator, database, scheduler, verifier service, Docker requirement or production deployment is introduced.

Ten Play episodes per game produce small-sample descriptive statistics for the configured system. Different games, budgets, observation modes, releases or Campaign seed bundles are not silently combined. The site may offer human practice on the same fixed resources, but practice is unranked and never creates an Official result.

The complete approved implementation and acceptance brief is [build-play-implementation.md](../build-play-implementation.md). The maintainer authorized the 0.7.0 software release after architecture review. Paid model Campaigns and production deployment still require separate authorization.
