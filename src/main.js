// Wordsweeper — Render & Interaction Layer

import {
  GRID_SIZE, MAX_STRIKES,
  HIDDEN, REVEALED, FLAGGED,
  TYPE_EMPTY, TYPE_NUMBER, TYPE_LETTER, TYPE_BOMB,
  createGame, revealCell, flagCell, submitGuess, revealAll,
} from './game.js';
import { getDailyPuzzle } from './puzzles.js';
import { getDaySave, saveDayState, recordGameEnd, getStats } from './storage.js';

let gameState       = null;
let showingInput    = false;
let currentDayIndex = 0;

// Long-press state for touch flagging
let touchTimer     = null;
let touchCellEl    = null;
let longPressFired = false;

// DOM refs — assigned in DOMContentLoaded
let gridEl, strikesEl, poolEl, guessEarlyBtn, wordInputArea,
    wordInput, submitGuessBtn, guessFeedback, overlay,
    overlayIcon, overlayTitle, overlayMsg,
    overlayResult, statsHeading, overlayActions,
    shareBtn, shareFeedback,
    statPlayed, statWinPct, statStreak, statBest,
    statsBtn, overlayCloseBtn;

// ----------------------------------------------------------------
// Init
// ----------------------------------------------------------------

function init() {
  showingInput = false;

  wordInputArea.classList.add('is-hidden');
  guessEarlyBtn.classList.remove('is-hidden');
  guessFeedback.classList.add('is-hidden');
  guessFeedback.textContent = '';
  wordInput.value = '';
  wordInput.classList.remove('shake');

  const puzzle    = getDailyPuzzle();
  currentDayIndex = puzzle.dayIndex;
  gameState       = createGame(puzzle.word, puzzle.seed);

  // Puzzle number + date header
  const now  = new Date();
  const date = now.toLocaleDateString('en-US', {
    timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric',
  });
  document.getElementById('puzzle-meta').textContent =
    `Puzzle #${currentDayIndex + 1} · ${date}`;

  // Restore saved progress for today if it exists
  const save = getDaySave(currentDayIndex);
  if (save) restoreGameState(save);

  renderGrid();
  renderStrikes();
  renderPool();

  overlay.classList.add('is-hidden');

  // Resume to correct UI state
  if (gameState.phase === 'won') {
    setTimeout(() => showOverlay('won'), 400);
  } else if (gameState.phase === 'lost') {
    setTimeout(() => showOverlay('lost'), 400);
  } else if (gameState.phase === 'guessing') {
    showWordInput();
  }
}

// ----------------------------------------------------------------
// Restore saved game state
// ----------------------------------------------------------------

function restoreGameState(save) {
  gameState.strikes      = save.strikes;
  gameState.phase        = save.phase;
  gameState.letterPool   = [...save.letterPool];
  gameState.revealedCount = save.revealedCount;
  for (const { r, c, v } of save.cells) {
    gameState.grid[r][c].visibility = v;
  }
}

// ----------------------------------------------------------------
// Persist current state
// ----------------------------------------------------------------

function saveProgress() {
  saveDayState(currentDayIndex, gameState);
}

// ----------------------------------------------------------------
// Grid rendering
// ----------------------------------------------------------------

function renderGrid() {
  gridEl.innerHTML = '';

  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const cell = gameState.grid[r][c];
      const el   = document.createElement('div');
      el.className         = getCellClass(cell);
      el.innerHTML         = getCellContent(cell);
      el.dataset.row       = r;
      el.dataset.col       = c;
      el.setAttribute('role', 'gridcell');
      gridEl.appendChild(el);
    }
  }
}

function getCellClass(cell) {
  const classes = ['cell', cell.visibility];
  if (cell.visibility === REVEALED) classes.push(cell.type);
  return classes.join(' ');
}

function getCellContent(cell) {
  if (cell.visibility === HIDDEN)  return '';
  if (cell.visibility === FLAGGED) return '🚩';

  switch (cell.type) {
    case TYPE_BOMB:   return '💣';
    case TYPE_LETTER: return cell.letter;
    case TYPE_EMPTY:  return '';
    case TYPE_NUMBER: {
      const hasBombs   = cell.bombCount > 0;
      const hasLetters = cell.letterCount > 0;
      if (!hasBombs && !hasLetters) return '';
      if (hasBombs && hasLetters) {
        return `<span class="counts"><span class="bc">${cell.bombCount}</span><span class="lc">${cell.letterCount}</span></span>`;
      }
      if (hasBombs)   return `<span class="bc">${cell.bombCount}</span>`;
      return `<span class="lc">${cell.letterCount}</span>`;
    }
    default: return '';
  }
}

// ----------------------------------------------------------------
// Individual cell update (after reveal / flag)
// ----------------------------------------------------------------

function updateCellElement(r, c, animate = false, animDelay = 0) {
  const el = gridEl.querySelector(`[data-row="${r}"][data-col="${c}"]`);
  if (!el) return;

  const cell    = gameState.grid[r][c];
  el.className  = getCellClass(cell);
  el.innerHTML  = getCellContent(cell);

  if (animate) {
    el.style.animationDelay = animDelay > 0 ? `${animDelay}ms` : '';
    el.classList.add('just-revealed');
    el.addEventListener('animationend', () => {
      el.classList.remove('just-revealed');
      el.style.animationDelay = '';
    }, { once: true });
  }
}

// ----------------------------------------------------------------
// handleReveal — left click / tap
// ----------------------------------------------------------------

function handleReveal(r, c) {
  if (!gameState) return;
  if (gameState.phase === 'won' || gameState.phase === 'lost') return;

  const wasHidden = new Set();
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      if (gameState.grid[row][col].visibility === HIDDEN) wasHidden.add(`${row},${col}`);
    }
  }

  const result = revealCell(gameState, r, c);
  if (result.event === 'already_revealed' || result.event === 'flagged' || result.event === 'game_over') return;

  // Collect newly revealed cells sorted by Manhattan distance
  const newCells = [];
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      if (wasHidden.has(`${row},${col}`) && gameState.grid[row][col].visibility === REVEALED) {
        newCells.push([row, col, Math.abs(row - r) + Math.abs(col - c)]);
      }
    }
  }
  newCells.sort((a, b) => a[2] - b[2]);

  const perCell = newCells.length > 1 ? Math.min(20, 400 / newCells.length) : 0;
  newCells.forEach(([row, col], i) => {
    setTimeout(() => updateCellElement(row, col, true, 0), i * perCell);
  });

  if (result.event === 'bomb') {
    const bombEl = gridEl.querySelector(`[data-row="${r}"][data-col="${c}"]`);
    if (bombEl) {
      setTimeout(() => {
        updateCellElement(r, c, false);
        bombEl.classList.add('bomb-hit');
        bombEl.addEventListener('animationend', () => bombEl.classList.remove('bomb-hit'), { once: true });
      }, 0);
    }
  }

  renderStrikes();
  renderPool();
  saveProgress();

  const endDelay = newCells.length > 1 ? Math.min(newCells.length * perCell + 200, 700) : 100;
  setTimeout(checkPhase, endDelay);
}

// ----------------------------------------------------------------
// handleFlag — right click / long press
// ----------------------------------------------------------------

function handleFlag(r, c) {
  if (!gameState) return;
  if (gameState.phase === 'won' || gameState.phase === 'lost') return;
  flagCell(gameState, r, c);
  updateCellElement(r, c);
  saveProgress();
}

// ----------------------------------------------------------------
// Strikes
// ----------------------------------------------------------------

function renderStrikes() {
  const dots = strikesEl.querySelectorAll('.strike-dot');
  dots.forEach((dot, i) => {
    const wasActive = dot.classList.contains('active');
    const isActive  = i < gameState.strikes;
    dot.classList.toggle('active', isActive);
    if (isActive && !wasActive) {
      dot.classList.add('strike-pop');
      dot.addEventListener('animationend', () => dot.classList.remove('strike-pop'), { once: true });
    }
  });
}

// ----------------------------------------------------------------
// Letter pool
// ----------------------------------------------------------------

function renderPool() {
  poolEl.innerHTML = '';

  for (const letter of gameState.letterPool) {
    const tile       = document.createElement('span');
    tile.className   = 'pool-tile found';
    tile.textContent = letter;
    poolEl.appendChild(tile);
  }

  const remaining = gameState.targetWord.length - gameState.letterPool.length;
  for (let i = 0; i < remaining; i++) {
    const tile     = document.createElement('span');
    tile.className = 'pool-tile empty';
    poolEl.appendChild(tile);
  }
}

// ----------------------------------------------------------------
// Win celebration
// ----------------------------------------------------------------

function celebrateWin() {
  const tiles = poolEl.querySelectorAll('.pool-tile.found');
  tiles.forEach((tile, i) => {
    setTimeout(() => {
      tile.classList.remove('bounce', 'glow');
      void tile.offsetWidth; // reflow to restart animation
      tile.classList.add('bounce', 'glow');
      tile.addEventListener('animationend', () => {
        tile.classList.remove('bounce', 'glow');
      }, { once: true });
    }, i * 90);
  });
}

// ----------------------------------------------------------------
// Phase transitions
// ----------------------------------------------------------------

function checkPhase() {
  if (gameState.phase === 'guessing' && !showingInput) {
    showWordInput();
  } else if (gameState.phase === 'won') {
    recordGameEnd(currentDayIndex, true);
    saveProgress();
    celebrateWin();
    setTimeout(() => showOverlay('won'), 550);
  } else if (gameState.phase === 'lost') {
    recordGameEnd(currentDayIndex, false);
    saveProgress();
    showOverlay('lost');
  }
}

function showWordInput() {
  showingInput = true;
  wordInputArea.classList.remove('is-hidden');
  guessEarlyBtn.classList.add('is-hidden');
  wordInput.focus();
}

// ----------------------------------------------------------------
// Guess handling
// ----------------------------------------------------------------

function handleSubmitGuess() {
  const guess = wordInput.value.trim().toUpperCase();
  if (guess.length < 3) return;

  const result = submitGuess(gameState, guess);
  wordInput.value = '';

  if (result.event === 'won') {
    renderStrikes();
    recordGameEnd(currentDayIndex, true);
    saveProgress();
    celebrateWin();
    setTimeout(() => showOverlay('won'), 550);
  } else if (result.event === 'wrong_guess') {
    renderStrikes();

    const guessesLeft = MAX_STRIKES - gameState.strikes;
    const plural      = guessesLeft === 1 ? '' : 'es';
    guessFeedback.textContent = guessesLeft > 0
      ? `Not the word. ${guessesLeft} guess${plural} remaining.`
      : 'No guesses remaining.';
    guessFeedback.classList.remove('is-hidden');

    wordInput.classList.remove('shake');
    void wordInput.offsetWidth;
    wordInput.classList.add('shake');
    wordInput.addEventListener('animationend', () => wordInput.classList.remove('shake'), { once: true });

    if (gameState.phase === 'lost') {
      recordGameEnd(currentDayIndex, false);
      saveProgress();
      renderGrid();
      setTimeout(() => showOverlay('lost'), 600);
    }
  }
}

// ----------------------------------------------------------------
// Share result
// ----------------------------------------------------------------

function buildShareText() {
  const result = gameState.phase === 'won' ? '✅' : '❌';
  const strikes = '💣'.repeat(gameState.strikes) + '⬜'.repeat(MAX_STRIKES - gameState.strikes);
  return `Wordsweeper #${currentDayIndex + 1} ${result}\n${strikes}`;
}

// ----------------------------------------------------------------
// Stats helpers
// ----------------------------------------------------------------

function updateStatsDisplay() {
  const stats          = getStats();
  statPlayed.textContent  = stats.played;
  statWinPct.textContent  = stats.played > 0
    ? Math.round((stats.won / stats.played) * 100)
    : 0;
  statStreak.textContent  = stats.currentStreak;
  statBest.textContent    = stats.maxStreak;
}

// ----------------------------------------------------------------
// Overlay — game result mode
// ----------------------------------------------------------------

function showOverlay(type) {
  // Reveal full board on game end
  revealAll(gameState);
  renderGrid();

  overlayResult.classList.remove('is-hidden');
  statsHeading.classList.add('is-hidden');
  overlayActions.classList.remove('is-hidden');
  shareBtn.classList.remove('is-hidden');
  shareFeedback.classList.add('is-hidden');

  if (type === 'won') {
    overlayIcon.textContent  = '🎉';
    overlayTitle.textContent = 'You got it!';
    overlayMsg.textContent   = `The word was ${gameState.targetWord}.`;
  } else {
    overlayIcon.textContent  = '💥';
    overlayTitle.textContent = 'Game Over';
    overlayMsg.textContent   = `The word was ${gameState.targetWord}.`;
  }

  updateStatsDisplay();
  overlay.classList.remove('is-hidden');
}

// ----------------------------------------------------------------
// Overlay — stats-only mode (header button)
// ----------------------------------------------------------------

function showStatsOverlay() {
  overlayResult.classList.add('is-hidden');
  statsHeading.classList.remove('is-hidden');
  overlayActions.classList.add('is-hidden');
  shareFeedback.classList.add('is-hidden');

  updateStatsDisplay();
  overlay.classList.remove('is-hidden');
}

// ----------------------------------------------------------------
// Event binding
// ----------------------------------------------------------------

function bindEvents() {
  // Click → reveal (desktop + mobile tap)
  gridEl.addEventListener('click', (e) => {
    if (longPressFired) { longPressFired = false; return; }
    const cell = e.target.closest('.cell');
    if (!cell) return;
    handleReveal(+cell.dataset.row, +cell.dataset.col);
  });

  // Right click → flag
  gridEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const cell = e.target.closest('.cell');
    if (!cell) return;
    handleFlag(+cell.dataset.row, +cell.dataset.col);
  });

  // Touch: long-press → flag (tap falls through to click event)
  gridEl.addEventListener('touchstart', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    touchCellEl    = cell;
    longPressFired = false;
    touchTimer = setTimeout(() => {
      longPressFired = true;
      handleFlag(+touchCellEl.dataset.row, +touchCellEl.dataset.col);
      touchTimer   = null;
      touchCellEl  = null;
    }, 500);
  }, { passive: true });

  gridEl.addEventListener('touchend', () => {
    if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
  });

  gridEl.addEventListener('touchmove', () => {
    if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
  });

  // "Guess Early" button
  guessEarlyBtn.addEventListener('click', showWordInput);

  // Submit guess via button
  submitGuessBtn.addEventListener('click', handleSubmitGuess);

  // Submit guess via Enter key
  wordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSubmitGuess();
  });

  // Header stats button
  statsBtn.addEventListener('click', showStatsOverlay);

  // Overlay close button
  overlayCloseBtn.addEventListener('click', () => overlay.classList.add('is-hidden'));

  // Backdrop click closes overlay
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.add('is-hidden');
  });

  // Share result button
  shareBtn.addEventListener('click', () => {
    const text = buildShareText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        shareFeedback.textContent = 'Copied to clipboard!';
        shareFeedback.classList.remove('is-hidden');
      }).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  });

}

function fallbackCopy(text) {
  const ta      = document.createElement('textarea');
  ta.value      = text;
  ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    shareFeedback.textContent = 'Copied to clipboard!';
    shareFeedback.classList.remove('is-hidden');
  } catch {
    shareFeedback.textContent = 'Copy failed — share manually.';
    shareFeedback.classList.remove('is-hidden');
  }
  document.body.removeChild(ta);
}

// ----------------------------------------------------------------
// Bootstrap
// ----------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  gridEl          = document.getElementById('grid');
  strikesEl       = document.getElementById('strikes');
  poolEl          = document.getElementById('letter-pool');
  guessEarlyBtn   = document.getElementById('guess-early-btn');
  wordInputArea   = document.getElementById('word-input-area');
  wordInput       = document.getElementById('word-input');
  submitGuessBtn  = document.getElementById('submit-guess-btn');
  guessFeedback   = document.getElementById('guess-feedback');
  overlay         = document.getElementById('overlay');
  overlayIcon     = document.getElementById('overlay-icon');
  overlayTitle    = document.getElementById('overlay-title');
  overlayMsg      = document.getElementById('overlay-message');
  overlayResult   = document.getElementById('overlay-result');
  statsHeading    = document.getElementById('stats-heading');
  overlayActions  = document.getElementById('overlay-actions');
  shareBtn        = document.getElementById('share-btn');
  shareFeedback   = document.getElementById('share-feedback');
  statPlayed      = document.getElementById('stat-played');
  statWinPct      = document.getElementById('stat-win-pct');
  statStreak      = document.getElementById('stat-streak');
  statBest        = document.getElementById('stat-best');
  statsBtn        = document.getElementById('stats-btn');
  overlayCloseBtn = document.getElementById('overlay-close-btn');

  bindEvents();
  init();
});
