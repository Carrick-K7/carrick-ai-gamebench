# Riverstone Hold'em reference

Deterministic, dependency-free TypeScript implementation for `build.texas-holdem.v1`.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm preview --port 4173
```

The browser UI and Bridge v1 both dispatch through the same `PokerGame` reducer. Named public calibration scenarios are deterministic table fixtures; normal resets use a seeded shuffled deck and the complete betting/showdown engine.
