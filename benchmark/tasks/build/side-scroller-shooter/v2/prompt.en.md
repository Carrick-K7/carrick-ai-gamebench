# Build task: Side-scroller Shooter

Create a polished horizontal aircraft shooter.

## Required game

- The player moves with WASD/arrows and fires toward the right with Space or
  pointer input.
- Projectiles move, damage once, and are removed on impact or off-screen.
- Implement normal, fast, and tank enemies with materially different speed/HP.
- Enemies damage the player; give visible hit feedback and a short invulnerability
  interval. Show health, score, and wave.
- Difficulty increases through waves. Include a distinct boss/elite encounter
  and a clear win or loss.
- Pause freezes movement, projectiles, and spawning. Restart clears all objects.
- Remove dead and off-screen objects so a 60-second simulation remains bounded.

## Public automation contract

Bridge actions: `move-up`, `move-down`, `move-left`, `move-right`, `stop`,
`fire`, `pause`, `resume`, and `restart`. Snapshot follows `state.schema.json`.

Fixtures: `projectile-hit` places a 1 HP normal enemy in the firing line;
`enemy-types` exposes all three enemy types; `player-hit` starts an enemy at
contact; `wave` starts one tick before wave 2; `boss` starts a 1 HP boss in the
firing line; `cleanup` starts 100 objects just beyond their removal boundary.
Space must share the same fire cooldown path as the bridge.

No runtime network requests or evaluator-specific branches.

## Evaluation contract

The complete public fixture contract is available at `$CAGB_PUBLIC_TESTS_PATH`,
and the scored task manifest is at `$CAGB_TASK_MANIFEST_PATH`. Read both before
implementing. Every bridge reset must apply its input seed, and every snapshot
must report that integer as the top-level `seed` field. The official run seed is
also available as `$CAGB_SEED`.
