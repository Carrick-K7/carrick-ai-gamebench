# Build task: Tower Defense Mini

Create a complete, compact tower-defense game.

## Required game

- Enemies follow a waypoint path and reduce life when they reach the endpoint.
- The player spends gold at build slots. Insufficient funds never create a
  tower or make gold negative.
- Implement basic, rapid, and area-or-slow towers with real differences.
- Towers only target enemies in range and respect damage/fire-rate values.
- Implement normal, fast, and tank enemies, escalating waves, kill rewards,
  tower upgrades, pause/resume, restart, and clear win/loss states.
- Dead enemies are removed once, rewarded once, and can never leak life later.

## Public automation contract

Bridge actions: `build-tower` with `{slot,type}`, `upgrade-tower` with `{slot}`,
`start-wave`, `pause`, `resume`, and `restart`. Snapshot follows
`state.schema.json`. Render tower choices with `data-tower-type`, and build
slots with `data-build-slot`.

Fixtures: `path` starts one normal enemy at progress 0; `range` starts a basic
tower and an approaching enemy outside range; `economy` starts with 100 gold,
basic cost 50 and area cost 120; `wave` is one tick before wave 2; `upgrade`
starts a basic tower with damage 10 and 100 gold; `lifecycle` starts a 1 HP
enemy in range with 100 gold; `load` starts 100 path enemies.

No runtime network requests or evaluator-specific branches.

## Evaluation contract

The complete public fixture contract is available at `$CAGB_PUBLIC_TESTS_PATH`,
and the scored task manifest is at `$CAGB_TASK_MANIFEST_PATH`. Read both before
implementing. Every bridge reset must apply its input seed, and every snapshot
must report that integer as the top-level `seed` field. The official run seed is
also available as `$CAGB_SEED`.
