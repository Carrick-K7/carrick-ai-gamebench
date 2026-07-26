# Reproduction task: Radius Raid

Reproduce the scoped mechanics, feel, and neon visual identity shown in the
Radius Raid reference pack. The source project is MIT licensed and frozen in
`THIRD_PARTY.yml`; do not search for or copy its source during this run.

## Required slice

- An 800×600 Canvas game with the reference title/start view.
- Move with WASD/arrows, aim and fire with the mouse, and pause with P/Escape.
- Inertial movement stays bounded; continuous fire has a 100 ms cooldown.
- Implement three enemy behaviors: straight, diagonal, and direct pursuit.
- Implement one shield powerup, projectile/enemy/player collisions, three life
  points, score, hit feedback, particles, game over, restart, and pause.
- Reproduce the black space field, cyan/magenta/green glow, geometric entities,
  thin typography, score/life HUD, and dense but readable particle feedback.
- Scope intentionally excludes the other ten enemies, four powerups, audio, and
  locally stored statistics from the full upstream game.

Reference material is at `$CAGB_REFERENCE_DIR/reference/index.html`. The active
canvas must be `canvas[data-game-canvas]`, exactly 800×600.

Bridge actions: `start`, `move` with `{up,down,left,right}`, `aim` with `{x,y}`,
`fire`, `hold-fire`, `release-fire`, `pause`, `resume`, and `restart`.
Snapshot follows `state.schema.json`. No runtime network requests are allowed.
