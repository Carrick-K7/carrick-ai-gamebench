# Build task: 2D Parking

Create a top-down 2D driving game where the player parks a car in a marked bay.
This is not a sliding-block puzzle.

## Required game

- At least three genuinely different levels with boundaries, obstacles, parked
  cars, a start pose, and a target bay.
- W/ArrowUp accelerates, S/ArrowDown reverses, A/D or arrows steer, and Space
  brakes. Movement follows the car angle with acceleration, drag, and limits.
- Reversing changes the steering path naturally. The car must not rotate
  rapidly while stationary.
- Use an oriented vehicle footprint for collisions. A collision increments a
  counter, gives visible feedback, and prevents tunnelling.
- Win only when the complete vehicle is inside the bay, nearly aligned, and
  nearly stopped. Show time, collisions, result, restart, and level selection.

## Public automation contract

Bridge actions: `throttle`, `reverse`, `steer-left`, `steer-right`, `brake`,
`release-controls`, `pause`, `restart`, and `select-level` with `{level}`.
Snapshot follows `state.schema.json`.

Fixture poses are defined as follows: `motion` starts at `(400,400)`, angle 0;
`reverse-turn` starts at the same pose; `collision` faces a wall ten pixels
ahead; `parked` is centered and aligned in the target at speed 0; `level-2`
uses level signature `reverse-bay`. Real keyboard input must share the same
control state as bridge actions.

No runtime network requests or evaluator-specific branches.

## Evaluation contract

The complete public fixture contract is available at `$CAGB_PUBLIC_TESTS_PATH`,
and the scored task manifest is at `$CAGB_TASK_MANIFEST_PATH`. Read both before
implementing. Every bridge reset must apply its input seed, and every snapshot
must report that integer as the top-level `seed` field. The official run seed is
also available as `$CAGB_SEED`.
