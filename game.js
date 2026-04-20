// ============================================================
// Wordweeper — Game Engine (M1)
// ============================================================

const WordweeperEngine = (() => {

// --- Constants ---

const GRID_SIZE = 8;
const BOMB_COUNT = 9;
const MAX_STRIKES = 3;

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
function neighbors(r, c) {
  const result = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
        result.push([nr, nc]);
      }
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

function placeLetters(word, allPositions, rng) {
  const positions = shuffle(allPositions, rng);
  const chosen = [];

  for (const [r, c] of positions) {
    const tooClose = chosen.some(([pr, pc]) => isAdjacent(r, c, pr, pc));
    if (!tooClose) {
      chosen.push([r, c]);
      if (chosen.length === word.length) return chosen;
    }
  }
  return null;
}

function generateGrid(word, rng) {
  const allPositions = [];
  for (let r = 0; r < GRID_SIZE; r++)
    for (let c = 0; c < GRID_SIZE; c++)
      allPositions.push([r, c]);

  const letterPositions = placeLetters(word, allPositions, rng);
  if (!letterPositions) return null;

  const letterSet = new Set(letterPositions.map(([r, c]) => `${r},${c}`));

  const remaining = allPositions.filter(([r, c]) => !letterSet.has(`${r},${c}`));
  const shuffledRemaining = shuffle(remaining, rng);
  const bombPositions = shuffledRemaining.slice(0, BOMB_COUNT);

  const cells = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({
      type: TYPE_EMPTY,
      letter: null,
      letterCount: 0,
      bombCount: 0,
      visibility: HIDDEN,
    }))
  );

  for (let i = 0; i < word.length; i++) {
    const [r, c] = letterPositions[i];
    cells[r][c].type = TYPE_LETTER;
    cells[r][c].letter = word[i];
  }

  for (const [r, c] of bombPositions) {
    cells[r][c].type = TYPE_BOMB;
  }

  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (cells[r][c].type === TYPE_BOMB || cells[r][c].type === TYPE_LETTER) continue;
      let bombs = 0, letters = 0;
      for (const [nr, nc] of neighbors(r, c)) {
        if (cells[nr][nc].type === TYPE_BOMB)   bombs++;
        if (cells[nr][nc].type === TYPE_LETTER) letters++;
      }
      cells[r][c].bombCount   = bombs;
      cells[r][c].letterCount = letters;
      cells[r][c].type        = (bombs === 0 && letters === 0) ? TYPE_EMPTY : TYPE_NUMBER;
    }
  }

  return { cells, letterPositions, bombPositions };
}

function validatePuzzle(cells) {
  for (let r = 0; r < GRID_SIZE; r++)
    for (let c = 0; c < GRID_SIZE; c++)
      if (cells[r][c].type === TYPE_EMPTY) return true;
  return false;
}

// --- Game State ---

function createGame(word, seed) {
  word = word.toUpperCase();
  const rng = makeRng(seed);

  let result = null;
  for (let attempt = 0; attempt < 50; attempt++) {
    result = generateGrid(word, rng);
    if (result && validatePuzzle(result.cells)) break;
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
    letterPositions: result.letterPositions,
    bombPositions: result.bombPositions,
    seed,
  };
}

// --- Actions ---

function cascadeReveal(state, r, c, revealed = new Set()) {
  const key = `${r},${c}`;
  if (revealed.has(key)) return;
  const cell = state.grid[r][c];
  if (cell.visibility !== HIDDEN) return;

  revealed.add(key);
  cell.visibility = REVEALED;
  state.revealedCount++;

  if (cell.type === TYPE_LETTER && !state.letterPool.includes(cell.letter)) {
    state.letterPool.push(cell.letter);
  }

  if (cell.type === TYPE_EMPTY) {
    for (const [nr, nc] of neighbors(r, c)) {
      if (state.grid[nr][nc].visibility === HIDDEN) {
        cascadeReveal(state, nr, nc, revealed);
      }
    }
  }
}

function revealCell(state, r, c) {
  if (state.phase !== 'playing') return { event: 'game_over' };

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

function flagCell(state, r, c) {
  if (state.phase !== 'playing') return { event: 'game_over' };
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
  if (state.letterPool.length === state.targetWord.length) state.phase = 'guessing';
}

function revealAll(state) {
  for (let r = 0; r < GRID_SIZE; r++)
    for (let c = 0; c < GRID_SIZE; c++)
      state.grid[r][c].visibility = REVEALED;
}

// --- Public API ---

return {
  GRID_SIZE, BOMB_COUNT, MAX_STRIKES,
  HIDDEN, REVEALED, FLAGGED,
  TYPE_EMPTY, TYPE_NUMBER, TYPE_LETTER, TYPE_BOMB,
  createGame,
  revealCell,
  flagCell,
  submitGuess,
  neighbors,
};

})(); // end IIFE

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WordweeperEngine;
}
