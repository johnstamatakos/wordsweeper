// ============================================================
// Wordsweeper — Game Engine
// ============================================================

// --- Constants ---

const MAX_STRIKES = 3;

const NORMAL_GRID_SIZE = 8;
const HARD_GRID_SIZE   = 10;
const NORMAL_BOMBS     = 7;
const HARD_BOMBS       = 15;
const HARD_DECOYS      = 3;

// Cell visibility states
const HIDDEN   = 'hidden';
const REVEALED = 'revealed';
const FLAGGED  = 'flagged';

// Cell content types
const TYPE_EMPTY  = 'empty';
const TYPE_NUMBER = 'number';
const TYPE_LETTER = 'letter';
const TYPE_BOMB   = 'bomb';

// --- Utility ---

/** Returns all valid [r, c] neighbors of a cell */
function neighbors(r, c, gridSize) {
  const result = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < gridSize && nc >= 0 && nc < gridSize)
        result.push([nr, nc]);
    }
  }
  return result;
}

/** Seeded pseudo-random number generator (mulberry32) */
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle using provided rng */
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Check whether two cells are adjacent (within 1 step in any direction) */
function isAdjacent(r1, c1, r2, c2) {
  return Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1;
}

// --- Puzzle Generation ---

/** Place `count` letters such that no two are adjacent to each other */
function placeLetters(allPositions, rng, count) {
  const positions = shuffle(allPositions, rng);
  const chosen = [];
  for (const [r, c] of positions) {
    const tooClose = chosen.some(([pr, pc]) => isAdjacent(r, c, pr, pc));
    if (!tooClose) {
      chosen.push([r, c]);
      if (chosen.length === count) return chosen;
    }
  }
  return null;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function generateGrid(word, rng, gridSize, bombCount, decoyCount) {
  const allPositions = [];
  for (let r = 0; r < gridSize; r++)
    for (let c = 0; c < gridSize; c++)
      allPositions.push([r, c]);

  // Place all letters (word + decoys) non-adjacent to each other
  const totalLetters = word.length + decoyCount;
  const allLetterPositions = placeLetters(allPositions, rng, totalLetters);
  if (!allLetterPositions) return null;

  const wordPositions  = allLetterPositions.slice(0, word.length);
  const decoyPositions = allLetterPositions.slice(word.length);

  const letterSet  = new Set(allLetterPositions.map(([r, c]) => `${r},${c}`));
  const remaining  = allPositions.filter(([r, c]) => !letterSet.has(`${r},${c}`));
  const bombPositions = shuffle(remaining, rng).slice(0, bombCount);

  const cells = Array.from({ length: gridSize }, () =>
    Array.from({ length: gridSize }, () => ({
      type: TYPE_EMPTY,
      letter: null,
      letterCount: 0,
      bombCount: 0,
      visibility: HIDDEN,
      isDecoy: false,
      selected: false,
    }))
  );

  // Place real word letters
  for (let i = 0; i < word.length; i++) {
    const [r, c] = wordPositions[i];
    cells[r][c].type   = TYPE_LETTER;
    cells[r][c].letter = word[i];
  }

  // Place decoy letters (random from alphabet, any letter including word letters)
  for (const [r, c] of decoyPositions) {
    cells[r][c].type    = TYPE_LETTER;
    cells[r][c].letter  = ALPHABET[Math.floor(rng() * 26)];
    cells[r][c].isDecoy = true;
  }

  // Place bombs
  for (const [r, c] of bombPositions) {
    cells[r][c].type = TYPE_BOMB;
  }

  // Calculate number cells — blue counts only real word letters, not decoys
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (cells[r][c].type === TYPE_BOMB || cells[r][c].type === TYPE_LETTER) continue;
      let bombs = 0, letters = 0;
      for (const [nr, nc] of neighbors(r, c, gridSize)) {
        if (cells[nr][nc].type === TYPE_BOMB) bombs++;
        if (cells[nr][nc].type === TYPE_LETTER && !cells[nr][nc].isDecoy) letters++;
      }
      cells[r][c].bombCount   = bombs;
      cells[r][c].letterCount = letters;
      cells[r][c].type        = (bombs === 0 && letters === 0) ? TYPE_EMPTY : TYPE_NUMBER;
    }
  }

  return { cells, wordPositions, bombPositions, decoyPositions };
}

function validatePuzzle(cells, gridSize) {
  for (let r = 0; r < gridSize; r++)
    for (let c = 0; c < gridSize; c++)
      if (cells[r][c].type === TYPE_EMPTY) return true;
  return false;
}

// --- Game State ---

function createGame(word, seed, hardMode = false) {
  word = word.toUpperCase();
  const gridSize   = hardMode ? HARD_GRID_SIZE : NORMAL_GRID_SIZE;
  const bombCount  = hardMode ? HARD_BOMBS     : NORMAL_BOMBS;
  const decoyCount = hardMode ? HARD_DECOYS    : 0;
  const rng = makeRng(seed);

  let result = null;
  for (let attempt = 0; attempt < 50; attempt++) {
    result = generateGrid(word, rng, gridSize, bombCount, decoyCount);
    if (result && validatePuzzle(result.cells, gridSize)) break;
    result = null;
  }

  if (!result) throw new Error('Failed to generate a valid puzzle after 50 attempts');

  return {
    grid: result.cells,
    targetWord: word,
    revealedCount: 0,
    strikes: 0,
    letterPool: [],
    phase: 'playing',
    wordPositions:  result.wordPositions,
    bombPositions:  result.bombPositions,
    decoyPositions: result.decoyPositions,
    seed,
    gridSize,
    hardMode,
  };
}

// --- Actions ---

function cascadeReveal(state, r, c) {
  const cell = state.grid[r][c];
  if (cell.visibility !== HIDDEN) return;

  cell.visibility = REVEALED;
  state.revealedCount++;

  // Easy mode only: auto-add real word letters to pool
  if (!state.hardMode && cell.type === TYPE_LETTER && !cell.isDecoy) {
    if (!state.letterPool.includes(cell.letter)) {
      state.letterPool.push(cell.letter);
    }
  }

  if (cell.type === TYPE_EMPTY) {
    for (const [nr, nc] of neighbors(r, c, state.gridSize)) {
      cascadeReveal(state, nr, nc);
    }
  }
}

function revealCell(state, r, c) {
  if (state.phase === 'won' || state.phase === 'lost') return { event: 'game_over' };

  const cell = state.grid[r][c];
  if (cell.visibility === REVEALED) return { event: 'already_revealed' };
  if (cell.visibility === FLAGGED)  return { event: 'flagged' };

  if (cell.type === TYPE_BOMB) {
    cell.visibility = REVEALED;
    state.strikes++;
    if (state.strikes >= MAX_STRIKES) {
      state.phase = 'lost';
      revealAll(state);
    }
    return { event: 'bomb', strikes: state.strikes };
  }

  cascadeReveal(state, r, c);
  checkWinCondition(state);

  return {
    event: cell.type === TYPE_EMPTY ? 'cascade' : cell.type,
    cell,
  };
}

/**
 * Hard mode only: toggle a revealed letter cell's selection into/out of the pool.
 * No-ops in easy mode.
 */
function toggleLetterSelection(state, r, c) {
  if (!state.hardMode) return { event: 'noop' };

  const cell = state.grid[r][c];
  if (cell.type !== TYPE_LETTER || cell.visibility !== REVEALED) return { event: 'noop' };

  cell.selected = !cell.selected;

  // Rebuild pool from all selected cells in grid order
  state.letterPool = [];
  for (let row = 0; row < state.gridSize; row++) {
    for (let col = 0; col < state.gridSize; col++) {
      const c2 = state.grid[row][col];
      if (c2.type === TYPE_LETTER && c2.visibility === REVEALED && c2.selected) {
        state.letterPool.push(c2.letter);
      }
    }
  }

  return { event: 'letter_toggled', selected: cell.selected };
}

function flagCell(state, r, c) {
  if (state.phase === 'won' || state.phase === 'lost') return { event: 'game_over' };
  const cell = state.grid[r][c];
  if (cell.visibility === REVEALED) return { event: 'already_revealed' };
  cell.visibility = cell.visibility === FLAGGED ? HIDDEN : FLAGGED;
  return { event: 'flagged', state: cell.visibility };
}

function submitGuess(state, guess) {
  if (state.phase === 'won' || state.phase === 'lost') return { event: 'game_over' };
  guess = guess.toUpperCase().trim();
  if (guess === state.targetWord) {
    state.phase = 'won';
    return { event: 'won', guess };
  }
  state.strikes++;
  if (state.strikes >= MAX_STRIKES) {
    state.phase = 'lost';
    revealAll(state);
  }
  return { event: 'wrong_guess', guess, strikes: state.strikes };
}

function checkWinCondition(state) {
  if (state.phase !== 'playing') return;
  // Easy mode only: auto-transition when all word letters collected
  if (!state.hardMode && state.letterPool.length === state.targetWord.length) {
    state.phase = 'guessing';
  }
}

function revealAll(state) {
  for (let r = 0; r < state.gridSize; r++)
    for (let c = 0; c < state.gridSize; c++)
      state.grid[r][c].visibility = REVEALED;
}

// --- Exports ---

export {
  MAX_STRIKES,
  NORMAL_GRID_SIZE, HARD_GRID_SIZE,
  HIDDEN, REVEALED, FLAGGED,
  TYPE_EMPTY, TYPE_NUMBER, TYPE_LETTER, TYPE_BOMB,
  createGame, revealCell, flagCell, submitGuess, revealAll,
  toggleLetterSelection, neighbors,
};
