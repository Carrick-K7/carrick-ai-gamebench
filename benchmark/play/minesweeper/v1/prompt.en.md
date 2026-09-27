# Minesweeper

You are playing a 10x10 Minesweeper board. You reveal cells with a left click
and mark suspected mines with a right click.

## Rules

- The board is a 10x10 grid. Exactly 10 cells contain a hidden mine.
- Each revealed cell shows how many mines are in its eight surrounding cells
  (0 is shown as an empty cell). Numbers never reveal mine locations directly.
- Your first successful reveal is always safe: the first cell you reveal and
  its eight neighbors never contain a mine, so the opening is guaranteed to
  start a safe flood.
- When you reveal a cell with no adjacent mines (0), it automatically reveals
  all neighbouring cells, and that expansion continues through the whole
  connected region of zero cells and the numbered border around it.
- Right-clicking an unrevealed cell toggles a flag (a marker for a suspected
  mine). A flagged cell cannot be revealed until you unflag it. Right-clicking
  a revealed cell does nothing.

## Goal and end state

- You win when every non-mine cell has been revealed.
- You lose if you reveal a cell that contains a mine. All mine locations are
  then revealed, but the loss is final.
- You have at most 128 decisions. Every operation consumes one of them,
  whether or not it reveals or changes anything.
- Each response has a 60-second deadline. Invalid responses consume a decision;
  three consecutive invalid responses stop the episode. Any budget, timeout or
  invalid-response stop without a win counts as a loss. Some boards require a guess.
- Only one operation may be made per decision. There is no undo and no
  restart.

## Controls

- Left click a cell to reveal it.
- Right click a cell to flag or unflag it.

Only the current screenshot, these rules, your remaining decision budget, your
last actions, and your own brief memo are visible to you. Hidden mine
locations and the adjacent mine counts of unrevealed cells are never shown, so
work from the numbers you can see and the flags you have placed.
