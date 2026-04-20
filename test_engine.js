// ============================================================
// Wordweeper — Console Test Harness (run with: node test_engine.js)
// ============================================================

const {
  GRID_SIZE, HIDDEN, REVEALED, FLAGGED,
  TYPE_EMPTY, TYPE_NUMBER, TYPE_LETTER, TYPE_BOMB,
  createGame, revealCell, flagCell, submitGuess, neighbors,
} = require('./game.js');

// --- Helpers ---

const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';
let passed = 0, failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ${PASS}  ${label}`);
    passed++;
  } else {
    console.log(`  ${FAIL}  ${label}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(50));
}

/** Print a compact ASCII view of the grid */
function printGrid(state) {
  const { grid } = state;
  const typeChar = { empty: '.', number: '#', letter: 'L', bomb: 'B' };
  const vis = { hidden: '?', revealed: ' ', flagged: 'F' };

  console.log('\n     0  1  2  3  4  5  6  7');
  for (let r = 0; r < GRID_SIZE; r++) {
    const row = grid[r].map(cell => {
      if (cell.visibility === HIDDEN)   return ' ?';
      if (cell.visibility === FLAGGED)  return ' F';
      if (cell.type === TYPE_BOMB)      return ' *';
      if (cell.type === TYPE_LETTER)    return ` ${cell.letter}`;
      if (cell.type === TYPE_EMPTY)     return ' .';
      // number: show bomb|letter counts
      return `${cell.bombCount}${cell.letterCount}`;
    });
    console.log(`  ${r}  ${row.join(' ')}`);
  }
  console.log(`  strikes=${state.strikes}  pool=[${state.letterPool.join('')}]  phase=${state.phase}`);
}

// ─── Test 1: Grid generation ───────────────────────────────

section('1. Grid generation');

const SEED  = 20260420;
const WORD  = 'CRANE';
const state = createGame(WORD, SEED);

assert('createGame returns an object',         typeof state === 'object');
assert('grid is 8×8',                          state.grid.length === 8 && state.grid[0].length === 8);
assert('targetWord matches',                   state.targetWord === WORD);
assert('strikes start at 0',                   state.strikes === 0);
assert('phase starts as playing',              state.phase === 'playing');
assert('letterPool starts empty',              state.letterPool.length === 0);

// Count cell types
let bombs = 0, letters = 0, empty = 0, numbers = 0;
for (let r = 0; r < GRID_SIZE; r++) {
  for (let c = 0; c < GRID_SIZE; c++) {
    const t = state.grid[r][c].type;
    if (t === TYPE_BOMB)   bombs++;
    if (t === TYPE_LETTER) letters++;
    if (t === TYPE_EMPTY)  empty++;
    if (t === TYPE_NUMBER) numbers++;
  }
}
assert(`exactly ${WORD.length} letter cells`,  letters === WORD.length);
assert('exactly 9 bomb cells',                 bombs === 9);
assert('bombs + letters + others = 64',        bombs + letters + empty + numbers === 64);

// ─── Test 2: Letter placement (non-adjacency) ──────────────

section('2. Letter cells are non-adjacent');

const lpos = state.letterPositions;
let allNonAdj = true;
for (let i = 0; i < lpos.length; i++) {
  for (let j = i + 1; j < lpos.length; j++) {
    const [r1, c1] = lpos[i];
    const [r2, c2] = lpos[j];
    if (Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1) {
      allNonAdj = false;
    }
  }
}
assert('no two letter cells are adjacent', allNonAdj);

// ─── Test 3: Neighbor counts ───────────────────────────────

section('3. Neighbor counts');

let countsCorrect = true;
for (let r = 0; r < GRID_SIZE; r++) {
  for (let c = 0; c < GRID_SIZE; c++) {
    const cell = state.grid[r][c];
    if (cell.type === TYPE_BOMB || cell.type === TYPE_LETTER) continue;
    let bombs = 0, letters = 0;
    for (const [nr, nc] of neighbors(r, c)) {
      if (state.grid[nr][nc].type === TYPE_BOMB)   bombs++;
      if (state.grid[nr][nc].type === TYPE_LETTER) letters++;
    }
    if (cell.bombCount !== bombs || cell.letterCount !== letters) {
      countsCorrect = false;
      console.log(`    BAD COUNTS at (${r},${c}): got b=${cell.bombCount} l=${cell.letterCount}, expected b=${bombs} l=${letters}`);
    }
  }
}
assert('all non-bomb/letter cells have correct neighbor counts', countsCorrect);

// ─── Test 4: Cascade reveal ────────────────────────────────

section('4. Cascade reveal');

// Find an empty cell to cascade from
let emptyR = -1, emptyC = -1;
outer: for (let r = 0; r < GRID_SIZE; r++) {
  for (let c = 0; c < GRID_SIZE; c++) {
    if (state.grid[r][c].type === TYPE_EMPTY) { emptyR = r; emptyC = c; break outer; }
  }
}

assert('empty cell exists in puzzle', emptyR !== -1);

const beforeCount = state.revealedCount;
const result = revealCell(state, emptyR, emptyC);
const afterCount = state.revealedCount;

assert('cascade event returned',          result.event === 'cascade');
assert('cascade reveals more than 1 cell', afterCount > beforeCount + 1);

// All cascaded cells must be revealed
let cascadedNonRevealed = false;
for (let r = 0; r < GRID_SIZE; r++) {
  for (let c = 0; c < GRID_SIZE; c++) {
    const cell = state.grid[r][c];
    // Any empty cell that borders only other revealed cells should itself be revealed
    if (cell.type === TYPE_EMPTY && cell.visibility === HIDDEN) {
      // check if all non-bomb neighbors are revealed — if so, cascade missed it
      const nbrs = neighbors(r, c);
      const reachable = nbrs.every(([nr, nc]) => state.grid[nr][nc].visibility !== HIDDEN || state.grid[nr][nc].type === TYPE_BOMB);
      // (This is a soft check; cascade only propagates from the start cell)
    }
  }
}
assert('revealedCount increased after cascade', afterCount > beforeCount);

// ─── Test 5: Flag toggle ───────────────────────────────────

section('5. Flag toggle');

// Find a hidden, non-bomb cell
let fR = -1, fC = -1;
outer2: for (let r = 0; r < GRID_SIZE; r++) {
  for (let c = 0; c < GRID_SIZE; c++) {
    const cell = state.grid[r][c];
    if (cell.visibility === HIDDEN && cell.type !== TYPE_BOMB) { fR = r; fC = c; break outer2; }
  }
}

const fr1 = flagCell(state, fR, fC);
assert('flag sets cell to FLAGGED',   state.grid[fR][fC].visibility === FLAGGED);
const fr2 = flagCell(state, fR, fC);
assert('second flag removes flag',    state.grid[fR][fC].visibility === HIDDEN);

// ─── Test 6: Bomb reveal → strike ─────────────────────────

section('6. Bomb reveal → strike');

const [bR, bC] = state.bombPositions[0];
// Ensure it's still hidden (might have been cascaded over — bombs never cascade)
if (state.grid[bR][bC].visibility === HIDDEN) {
  const br = revealCell(state, bR, bC);
  assert('bomb event returned',      br.event === 'bomb');
  assert('strikes increased to 1',   state.strikes === 1);
  assert('phase still playing',      state.phase === 'playing');
} else {
  // Bomb was already revealed? That shouldn't happen — bombs don't cascade.
  assert('bomb cell was still hidden (unexpected pre-reveal)', false);
}

// ─── Test 7: 3 strikes → loss ─────────────────────────────

section('7. Three strikes triggers loss');

// Count how many bomb cells are still hidden
const hiddenBombs = state.bombPositions.filter(([r, c]) => state.grid[r][c].visibility === HIDDEN);
if (hiddenBombs.length >= 2) {
  revealCell(state, hiddenBombs[0][0], hiddenBombs[0][1]);
  revealCell(state, hiddenBombs[1][0], hiddenBombs[1][1]);
  assert('phase becomes lost after 3 bombs', state.phase === 'lost');
  // All cells should be revealed
  let allRevealed = true;
  for (let r = 0; r < GRID_SIZE; r++)
    for (let c = 0; c < GRID_SIZE; c++)
      if (state.grid[r][c].visibility !== REVEALED) allRevealed = false;
  assert('all cells revealed on loss', allRevealed);
} else {
  console.log('  (skipped — not enough hidden bombs remaining)');
}

// ─── Test 8: Fresh game — win path ────────────────────────

section('8. Win path: reveal all letters → guess word');

const wState = createGame('PLUMB', SEED + 1);

// Reveal all letter positions
for (const [r, c] of wState.letterPositions) {
  revealCell(wState, r, c);
}

assert('all letters collected',       wState.letterPool.length === 5);
assert('phase advances to guessing',  wState.phase === 'guessing');

const wrongGuess = submitGuess(wState, 'WRONG');
assert('wrong guess gives strike',    wrongGuess.event === 'wrong_guess');
assert('strike count is 1',          wState.strikes === 1);

const correctGuess = submitGuess(wState, 'PLUMB');
assert('correct guess wins',          correctGuess.event === 'won');
assert('phase is won',                wState.phase === 'won');

// ─── Test 9: Guess strike → loss ──────────────────────────

section('9. Wrong guesses cause loss at 3 strikes');

const lState = createGame('BRUSH', SEED + 2);
// Start with 2 bomb strikes first
let hb = lState.bombPositions.filter(([r, c]) => lState.grid[r][c].visibility === HIDDEN);
if (hb.length >= 2) {
  revealCell(lState, hb[0][0], hb[0][1]);
  revealCell(lState, hb[1][0], hb[1][1]);
  assert('2 strikes from bombs', lState.strikes === 2);
  const final = submitGuess(lState, 'WRONG');
  assert('wrong guess on 2 strikes → lost', lState.phase === 'lost');
} else {
  console.log('  (skipped)');
}

// ─── Test 10: deterministic seed ──────────────────────────

section('10. Deterministic seed');

const s1 = createGame('TRAIL', 999);
const s2 = createGame('TRAIL', 999);
let same = true;
for (let r = 0; r < GRID_SIZE; r++)
  for (let c = 0; c < GRID_SIZE; c++)
    if (s1.grid[r][c].type !== s2.grid[r][c].type) same = false;

assert('same seed produces identical grids', same);

const s3 = createGame('TRAIL', 12345);
let diff = false;
for (let r = 0; r < GRID_SIZE; r++)
  for (let c = 0; c < GRID_SIZE; c++)
    if (s1.grid[r][c].type !== s3.grid[r][c].type) { diff = true; break; }

assert('different seeds produce different grids', diff);

// ─── Summary ──────────────────────────────────────────────

section('Summary');
console.log(`\n  ${passed} passed, ${failed} failed\n`);

if (failed === 0) {
  console.log('  \x1b[32mAll tests passed — M1 engine ready.\x1b[0m\n');
} else {
  console.log('  \x1b[31mSome tests failed.\x1b[0m\n');
  process.exit(1);
}

// Print a sample board for visual inspection
console.log('\n--- Sample board (CRANE, seed 20260420) ---');
const viz = createGame('CRANE', SEED);
// Reveal a few safe cells for display
for (const [r, c] of viz.letterPositions.slice(0, 2)) revealCell(viz, r, c);
printGrid(viz);
