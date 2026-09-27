# 2048

You are playing a 4x4 2048 board and you control it with the arrow keys.

## Rules

- The board is a 4x4 grid. Two tiles are present at the start.
- A move slides every tile as far as it can go in one direction (Up / Down /
  Left / Right) until a tile or the edge stops it.
- When two tiles with the same number collide, they merge into one tile of
  twice the value. A tile can merge at most once per move.
- Merging adds the value of the merged tile to your score. The score is the
  sum of every merged tile value across the whole game.
- After any move that actually changes the board, exactly one new tile appears
  in a random empty cell: a 2 (90% of the time) or a 4 (10% of the time).
- A move that does not change the board does nothing and does not add a tile.

## Goal and end state

- Maximize your native merge score within 200 decisions. This is a limited-move
  scoring task, not a test of reaching the 2048 tile.
- The game ends when you cannot make any move that changes the board (the
  board is full and no two equal tiles are adjacent). The score you earned is
  your result.
- You have a limited number of decisions. Every decision consumes one of them,
  whether or not the move changes the board.
- Only one move may be made per decision. There is no undo and no restart.
- Each response has a 60-second deadline. Invalid responses consume a decision;
  three consecutive invalid responses stop the episode. Budget, timeout or
  invalid-response termination retains the merge score already earned.

## Controls

- ArrowUp moves all tiles up.
- ArrowDown moves all tiles down.
- ArrowLeft moves all tiles left.
- ArrowRight moves all tiles right.

Only the current screenshot, these rules, your remaining decision budget, your
last actions, and your own brief memo are visible to you. Decide the next arrow
key from the board you see in the screenshot.
