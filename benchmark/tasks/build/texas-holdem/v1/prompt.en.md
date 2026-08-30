# Build a six-player no-limit Texas Hold'em cash table

Create a polished, playable browser game for one human at seat 0 and five deterministic computer opponents at seats 1–5. Use the supplied Vite + TypeScript starter and keep the project self-contained.

## Table rules

- Six fixed seats, blinds 1/2, no ante, and 200 chips per seat on a normal reset.
- Implement the dealer button, small blind, big blind, and clockwise button rotation after each hand.
- Preflop action starts left of the big blind. Flop, turn, and river action starts at the first active seat left of the button.
- Implement fold, check, call, bet/raise-to, and all-in.
- Enforce legal checks/calls and no-limit minimum full raises. A short all-in may increase the call amount without reopening raising for a player who already acted.
- Run preflop, flop, turn, river, and showdown. Skip folded, all-in, and out seats when choosing the next actor.
- Evaluate the best five cards from seven with standard categories and kickers, including the ace-low wheel straight.
- Build main and side pots from contribution levels. Folded players fund pots but cannot win them. Refund uncalled excess. Split tied pots, assigning an odd chip clockwise from the button's left.
- Preserve total chips through every action and payout.
- Five bots must be deterministic: the same seed and action history must produce the same deck and decisions. One bot decision is processed for every 250 ms passed to `advance`.

This benchmark does not require accounts, networking, matchmaking, chat, rake, purchases, tournaments, or a rebuy system.

## Required interface

Provide a clear 1280×720 table view showing six seats, stacks, board cards, pot, dealer/blind markers, current actor, legal actions, and the human hole cards. Controls must include stable selectors:

- `[data-action="fold"]`
- `[data-action="check"]`
- `[data-action="call"]`
- `[data-action="all-in"]`
- `[data-action="raise"]`
- `[data-testid="raise-to"]`

Real controls and bridge actions must use the same game reducer.

## Bridge contract

Keep `window.__CARRICK_GAMEBENCH__` bridge version `1`. Implement:

- `reset({ seed, scenario? })`
- `act({ type: "start-hand" })`
- `act({ type: "player-action", payload: { kind: "fold" | "check" | "call" | "all-in" } })`
- `act({ type: "player-action", payload: { kind: "raise", to: integer } })`, where `to` is the human's total contribution on the current street
- `act({ type: "new-hand" })`
- `act({ type: "restart-table" })`
- `advance(ms)`
- `snapshot()` exactly matching `state.schema.json`

The public cases use named deterministic scenarios. Implement those scenarios as documented by their expected snapshots while keeping the same production reducer and poker rules. Do not inspect test files at runtime or special-case the evaluator itself.

An illegal bridge action should reject rather than silently corrupt state. Every reset must report the supplied integer at top-level `seed`.

## Delivery

The project must install with the frozen lockfile, build with `pnpm build`, serve with `pnpm preview`, and work without runtime network access.
