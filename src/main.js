// Wordsweeper — Render & Interaction Layer

import {
  MAX_STRIKES,
  HARD_GRID_SIZE,
  HIDDEN, REVEALED, FLAGGED,
  TYPE_EMPTY, TYPE_NUMBER, TYPE_LETTER, TYPE_BOMB,
  createGame, revealCell, flagCell, submitGuess, revealAll,
  toggleLetterSelection,
} from './game.js';
import { getDailyPuzzle } from './puzzles.js';
import {
  getDaySave, saveDayState, recordGameEnd, getStats,
  getHardMode, setHardMode,
} from './storage.js';

let gameState       = null;
let currentDayIndex = 0;
let hardMode        = false;

// Long-press state for touch flagging
let touchTimer     = null;
let touchCellEl    = null;
let longPressFired = false;

// DOM refs — assigned in DOMContentLoaded
let gridEl, strikesEl, poolEl, poolLabel, wordInputArea,
    wordInput, submitGuessBtn, guessFeedback, overlay,
    overlayIcon, overlayTitle, overlayMsg,
    overlayResult, statsHeading, overlayActions,
    shareBtn, shareFeedback,
    statPlayed, statWinPct, statStreak, statBest,
    statsBtn, overlayCloseBtn,
    howToPlayBtn, instructionsOverlay, instructionsCloseBtn,
    settingsBtn, settingsOverlay, settingsCloseBtn, hardModeToggle,
    countdownEl;

// ----------------------------------------------------------------
// Init
// ----------------------------------------------------------------

function init() {
  guessFeedback.classList.add('is-hidden');
  guessFeedback.textContent = '';
  wordInput.value = '';
  wordInput.classList.remove('shake');

  const puzzle    = getDailyPuzzle();
  currentDayIndex = puzzle.dayIndex;
  gameState       = createGame(puzzle.word, puzzle.seed, hardMode);

  // Puzzle number + date header
  const now  = new Date();
  const date = now.toLocaleDateString('en-US', {
    timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric',
  });
  document.getElementById('puzzle-meta').textContent =
    `Puzzle #${currentDayIndex + 1} · ${date}`;

  // Restore saved progress for today if it exists
  const save = getDaySave(currentDayIndex, hardMode);
  if (save) restoreGameState(save);

  applyGridSizeStyles();
  renderGrid();
  renderStrikes();
  renderPool();
  updatePoolLabel();

  overlay.classList.add('is-hidden');

  // Resume to correct UI state
  if (gameState.phase === 'won') {
    setTimeout(() => showOverlay('won'), 400);
  } else if (gameState.phase === 'lost') {
    setTimeout(() => showOverlay('lost'), 400);
  }
}

// ----------------------------------------------------------------
// Grid CSS sizing
// ----------------------------------------------------------------

function getOptimalCellSize(gridSize) {
  const available = Math.min(window.innerWidth - 32, 488) - (gridSize - 1) * 3 - 6;
  const fromViewport = Math.floor(available / gridSize);
  const maxCs = gridSize >= HARD_GRID_SIZE ? 42 : 48;
  return Math.max(26, Math.min(maxCs, fromViewport));
}

function applyGridSizeStyles() {
  const cs = getOptimalCellSize(gameState.gridSize);
  gridEl.style.setProperty('--cs', `${cs}px`);
  gridEl.style.setProperty('--grid-cols', gameState.gridSize);
  gridEl.classList.toggle('hard-mode', hardMode);
}

// ----------------------------------------------------------------
// Restore saved game state
// ----------------------------------------------------------------

function restoreGameState(save) {
  gameState.strikes       = save.strikes;
  gameState.phase         = save.phase;
  gameState.letterPool    = [...save.letterPool];
  gameState.revealedCount = save.revealedCount;
  for (const { r, c, v, sel } of save.cells) {
    gameState.grid[r][c].visibility = v;
    if (sel) gameState.grid[r][c].selected = true;
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

  for (let r = 0; r < gameState.gridSize; r++) {
    for (let c = 0; c < gameState.gridSize; c++) {
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
  if (cell.visibility === REVEALED) {
    classes.push(cell.type);
    if (cell.type === TYPE_LETTER && cell.selected) classes.push('selected');
    // Show decoys with distinct color after game ends
    if (cell.type === TYPE_LETTER && cell.isDecoy &&
        (gameState.phase === 'won' || gameState.phase === 'lost')) {
      classes.push('decoy');
    }
  }
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
// Individual cell update (after reveal / flag / toggle)
// ----------------------------------------------------------------

function updateCellElement(r, c, animate = false) {
  const el = gridEl.querySelector(`[data-row="${r}"][data-col="${c}"]`);
  if (!el) return;

  const cell   = gameState.grid[r][c];
  el.className = getCellClass(cell);
  el.innerHTML = getCellContent(cell);

  if (animate) {
    el.classList.add('just-revealed');
    el.addEventListener('animationend', () => el.classList.remove('just-revealed'), { once: true });
  }
}

// ----------------------------------------------------------------
// handleReveal — left click / tap on hidden cell
// ----------------------------------------------------------------

function handleReveal(r, c) {
  if (!gameState) return;
  if (gameState.phase === 'won' || gameState.phase === 'lost') return;

  const wasHidden = new Set();
  for (let row = 0; row < gameState.gridSize; row++) {
    for (let col = 0; col < gameState.gridSize; col++) {
      if (gameState.grid[row][col].visibility === HIDDEN) wasHidden.add(`${row},${col}`);
    }
  }

  const result = revealCell(gameState, r, c);
  if (result.event === 'already_revealed' || result.event === 'flagged' || result.event === 'game_over') return;

  // Collect newly revealed cells sorted by Manhattan distance for cascade animation
  const newCells = [];
  for (let row = 0; row < gameState.gridSize; row++) {
    for (let col = 0; col < gameState.gridSize; col++) {
      if (wasHidden.has(`${row},${col}`) && gameState.grid[row][col].visibility === REVEALED) {
        newCells.push([row, col, Math.abs(row - r) + Math.abs(col - c)]);
      }
    }
  }
  newCells.sort((a, b) => a[2] - b[2]);

  const perCell = newCells.length > 1 ? Math.min(20, 400 / newCells.length) : 0;
  newCells.forEach(([row, col], i) => {
    setTimeout(() => updateCellElement(row, col, true), i * perCell);
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
// handleLetterToggle — hard mode only: click revealed letter to select/deselect
// ----------------------------------------------------------------

function handleLetterToggle(r, c) {
  if (!gameState || gameState.phase === 'won' || gameState.phase === 'lost') return;

  const result = toggleLetterSelection(gameState, r, c);
  if (result.event === 'noop') return;

  updateCellElement(r, c);
  renderPool();
  saveProgress();
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

  // Easy mode: show dashed placeholders for letters not yet found
  if (!hardMode) {
    const remaining = gameState.targetWord.length - gameState.letterPool.length;
    for (let i = 0; i < remaining; i++) {
      const tile     = document.createElement('span');
      tile.className = 'pool-tile empty';
      poolEl.appendChild(tile);
    }
  }
}

function updatePoolLabel() {
  if (poolLabel) poolLabel.textContent = hardMode ? 'Click to select letters' : 'Letters found';
}

// ----------------------------------------------------------------
// Win celebration
// ----------------------------------------------------------------

function celebrateWin() {
  const tiles = poolEl.querySelectorAll('.pool-tile.found');
  tiles.forEach((tile, i) => {
    setTimeout(() => {
      tile.classList.remove('bounce', 'glow');
      void tile.offsetWidth;
      tile.classList.add('bounce', 'glow');
      tile.addEventListener('animationend', () => {
        tile.classList.remove('bounce', 'glow');
      }, { once: true });
    }, i * 90);
  });
}

// ----------------------------------------------------------------
// Phase transitions (called after reveal animation)
// ----------------------------------------------------------------

function checkPhase() {
  // 'guessing' in easy mode: all letters found; input is already always visible
  if (gameState.phase === 'lost') {
    recordGameEnd(currentDayIndex, false, hardMode);
    saveProgress();
    showOverlay('lost');
  }
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
    recordGameEnd(currentDayIndex, true, hardMode);
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
      recordGameEnd(currentDayIndex, false, hardMode);
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
  const result  = gameState.phase === 'won' ? '✅' : '❌';
  const strikes = '💣'.repeat(gameState.strikes) + '⬜'.repeat(MAX_STRIKES - gameState.strikes);
  const modeTag = hardMode ? ' [Hard Mode]' : '';
  return `Wordsweeper #${currentDayIndex + 1}${modeTag} ${result}\n${strikes}`;
}

// ----------------------------------------------------------------
// Stats helpers
// ----------------------------------------------------------------

function updateStatsDisplay() {
  const stats         = getStats(hardMode);
  statPlayed.textContent = stats.played;
  statWinPct.textContent = stats.played > 0
    ? Math.round((stats.won / stats.played) * 100)
    : 0;
  statStreak.textContent = stats.currentStreak;
  statBest.textContent   = stats.maxStreak;
}

// ----------------------------------------------------------------
// Overlay — game result mode
// ----------------------------------------------------------------

function showOverlay(type) {
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
  statsHeading.textContent = hardMode ? 'Statistics · Hard Mode' : 'Statistics';
  overlayActions.classList.add('is-hidden');
  shareFeedback.classList.add('is-hidden');

  updateStatsDisplay();
  overlay.classList.remove('is-hidden');
}

// ----------------------------------------------------------------
// Countdown timer
// ----------------------------------------------------------------

function updateCountdown() {
  if (!countdownEl) return;
  const now      = new Date();
  const midnight = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1
  ));
  const diff = midnight - now;
  const h    = Math.floor(diff / 3600000);
  const m    = Math.floor((diff % 3600000) / 60000);
  const s    = Math.floor((diff % 60000) / 1000);
  const pad  = n => String(n).padStart(2, '0');
  countdownEl.textContent = `Next puzzle in ${pad(h)}:${pad(m)}:${pad(s)}`;
}

// ----------------------------------------------------------------
// Event binding
// ----------------------------------------------------------------

function bindEvents() {
  // Click → reveal hidden cell, OR toggle letter selection in hard mode
  gridEl.addEventListener('click', (e) => {
    if (longPressFired) { longPressFired = false; return; }
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const r = +cell.dataset.row, c = +cell.dataset.col;
    if (hardMode &&
        gameState.grid[r][c].visibility === REVEALED &&
        gameState.grid[r][c].type === TYPE_LETTER) {
      handleLetterToggle(r, c);
      return;
    }
    handleReveal(r, c);
  });

  // Right click → flag (capture: true so nothing can block it)
  gridEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cell = e.target.closest('.cell');
    if (!cell) return;
    handleFlag(+cell.dataset.row, +cell.dataset.col);
  }, { capture: true });

  // Touch: long-press → flag (tap falls through to click event)
  gridEl.addEventListener('touchstart', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    touchCellEl    = cell;
    longPressFired = false;
    touchTimer = setTimeout(() => {
      longPressFired = true;
      handleFlag(+touchCellEl.dataset.row, +touchCellEl.dataset.col);
      touchTimer  = null;
      touchCellEl = null;
    }, 500);
  }, { passive: true });

  gridEl.addEventListener('touchend', () => {
    if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
  });

  gridEl.addEventListener('touchmove', () => {
    if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
  });

  // Submit guess via button and Enter key
  submitGuessBtn.addEventListener('click', handleSubmitGuess);
  wordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSubmitGuess();
  });

  // Header stats button
  statsBtn.addEventListener('click', showStatsOverlay);

  // Overlay close + backdrop
  overlayCloseBtn.addEventListener('click', () => overlay.classList.add('is-hidden'));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.add('is-hidden');
  });

  // Share result
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

  // How to play
  howToPlayBtn.addEventListener('click', () => instructionsOverlay.classList.remove('is-hidden'));
  instructionsCloseBtn.addEventListener('click', () => instructionsOverlay.classList.add('is-hidden'));
  instructionsOverlay.addEventListener('click', (e) => {
    if (e.target === instructionsOverlay) instructionsOverlay.classList.add('is-hidden');
  });

  // Settings
  settingsBtn.addEventListener('click', () => {
    hardModeToggle.checked = hardMode;
    settingsOverlay.classList.remove('is-hidden');
  });
  settingsCloseBtn.addEventListener('click', () => settingsOverlay.classList.add('is-hidden'));
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) settingsOverlay.classList.add('is-hidden');
  });

  // Hard mode toggle — persists to next day, re-inits immediately
  hardModeToggle.addEventListener('change', () => {
    hardMode = hardModeToggle.checked;
    setHardMode(hardMode);
    settingsOverlay.classList.add('is-hidden');
    init();
  });
}

function fallbackCopy(text) {
  const ta         = document.createElement('textarea');
  ta.value         = text;
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
  gridEl               = document.getElementById('grid');
  strikesEl            = document.getElementById('strikes');
  poolEl               = document.getElementById('letter-pool');
  poolLabel            = document.getElementById('pool-label');
  wordInputArea        = document.getElementById('word-input-area');
  wordInput            = document.getElementById('word-input');
  submitGuessBtn       = document.getElementById('submit-guess-btn');
  guessFeedback        = document.getElementById('guess-feedback');
  overlay              = document.getElementById('overlay');
  overlayIcon          = document.getElementById('overlay-icon');
  overlayTitle         = document.getElementById('overlay-title');
  overlayMsg           = document.getElementById('overlay-message');
  overlayResult        = document.getElementById('overlay-result');
  statsHeading         = document.getElementById('stats-heading');
  overlayActions       = document.getElementById('overlay-actions');
  shareBtn             = document.getElementById('share-btn');
  shareFeedback        = document.getElementById('share-feedback');
  statPlayed           = document.getElementById('stat-played');
  statWinPct           = document.getElementById('stat-win-pct');
  statStreak           = document.getElementById('stat-streak');
  statBest             = document.getElementById('stat-best');
  statsBtn             = document.getElementById('stats-btn');
  overlayCloseBtn      = document.getElementById('overlay-close-btn');
  howToPlayBtn         = document.getElementById('how-to-play-btn');
  instructionsOverlay  = document.getElementById('instructions-overlay');
  instructionsCloseBtn = document.getElementById('instructions-close-btn');
  settingsBtn          = document.getElementById('settings-btn');
  settingsOverlay      = document.getElementById('settings-overlay');
  settingsCloseBtn     = document.getElementById('settings-close-btn');
  hardModeToggle       = document.getElementById('hard-mode-toggle');
  countdownEl          = document.getElementById('countdown');

  hardMode = getHardMode();

  bindEvents();
  init();

  updateCountdown();
  setInterval(updateCountdown, 1000);

  // Show instructions automatically for first-time visitors
  if (!localStorage.getItem('ws_visited')) {
    localStorage.setItem('ws_visited', '1');
    instructionsOverlay.classList.remove('is-hidden');
  }
});
