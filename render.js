// Wordsweeper — Render & Interaction Layer
// Uses globals: WordweeperEngine (from game.js), WordweeperPuzzles (from puzzles.js)

const {
  GRID_SIZE,
  HIDDEN, REVEALED, FLAGGED,
  TYPE_EMPTY, TYPE_NUMBER, TYPE_LETTER, TYPE_BOMB,
  createGame, revealCell, flagCell, submitGuess,
} = WordweeperEngine;

let gameState   = null;
let showingInput = false;

// DOM refs — assigned in DOMContentLoaded
let gridEl, strikesEl, poolEl, guessEarlyBtn, wordInputArea,
    wordInput, submitGuessBtn, guessFeedback, overlay,
    overlayIcon, overlayTitle, overlayMsg, newGameBtn;

// ----------------------------------------------------------------
// Init
// ----------------------------------------------------------------

function init() {
  showingInput = false;

  // Reset word input area visibility
  wordInputArea.classList.add('is-hidden');
  guessEarlyBtn.classList.remove('is-hidden');
  guessFeedback.classList.add('is-hidden');
  guessFeedback.textContent = '';
  wordInput.value = '';
  wordInput.classList.remove('shake');

  // Get daily puzzle
  const { word, seed } = WordweeperPuzzles.getDailyPuzzle();
  gameState = createGame(word, seed);

  renderGrid();
  renderStrikes();
  renderPool();

  overlay.classList.add('is-hidden');
}

// ----------------------------------------------------------------
// Grid rendering
// ----------------------------------------------------------------

function renderGrid() {
  gridEl.innerHTML = '';

  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const cell = gameState.grid[r][c];
      const el = document.createElement('div');
      el.className = getCellClass(cell);
      el.innerHTML = getCellContent(cell);
      el.dataset.row = r;
      el.dataset.col = c;
      el.setAttribute('role', 'gridcell');
      gridEl.appendChild(el);
    }
  }
}

function getCellClass(cell) {
  const classes = ['cell', cell.visibility];
  if (cell.visibility === REVEALED) {
    classes.push(cell.type);
  }
  return classes.join(' ');
}

function getCellContent(cell) {
  if (cell.visibility === HIDDEN) {
    return '';
  }
  if (cell.visibility === FLAGGED) {
    return '🚩';
  }
  // Revealed states:
  switch (cell.type) {
    case TYPE_BOMB:
      return '💣';
    case TYPE_LETTER:
      return cell.letter;
    case TYPE_EMPTY:
      return '';
    case TYPE_NUMBER: {
      const hasBombs   = cell.bombCount > 0;
      const hasLetters = cell.letterCount > 0;
      if (!hasBombs && !hasLetters) return '';

      // Both: side-by-side inside a flex wrapper
      if (hasBombs && hasLetters) {
        return `<span class="counts"><span class="bc">${cell.bombCount}</span><span class="lc">${cell.letterCount}</span></span>`;
      }
      if (hasBombs) {
        return `<span class="bc">${cell.bombCount}</span>`;
      }
      // Only letters nearby
      return `<span class="lc">${cell.letterCount}</span>`;
    }
    default:
      return '';
  }
}

// ----------------------------------------------------------------
// Individual cell update (after reveal / flag)
// ----------------------------------------------------------------

function updateCellElement(r, c, animate = false, animDelay = 0) {
  const el = gridEl.querySelector(`[data-row="${r}"][data-col="${c}"]`);
  if (!el) return;

  const cell = gameState.grid[r][c];
  el.className = getCellClass(cell);
  el.innerHTML = getCellContent(cell);

  if (animate) {
    if (animDelay > 0) {
      el.style.animationDelay = `${animDelay}ms`;
    } else {
      el.style.animationDelay = '';
    }
    el.classList.add('just-revealed');
    el.addEventListener('animationend', () => {
      el.classList.remove('just-revealed');
      el.style.animationDelay = '';
    }, { once: true });
  }
}

// ----------------------------------------------------------------
// handleReveal — left click
// ----------------------------------------------------------------

function handleReveal(r, c) {
  if (!gameState) return;
  if (gameState.phase === 'won' || gameState.phase === 'lost') return;

  // Snapshot which cells are currently hidden
  const wasHidden = new Set();
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      if (gameState.grid[row][col].visibility === HIDDEN) {
        wasHidden.add(`${row},${col}`);
      }
    }
  }

  const result = revealCell(gameState, r, c);

  if (['already_revealed', 'flagged', 'game_over'].includes(result.event)) return;

  // Collect newly revealed cells and sort by Manhattan distance from click
  const newCells = [];
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      if (
        wasHidden.has(`${row},${col}`) &&
        gameState.grid[row][col].visibility !== HIDDEN
      ) {
        const dist = Math.abs(row - r) + Math.abs(col - c);
        newCells.push([row, col, dist]);
      }
    }
  }
  newCells.sort((a, b) => a[2] - b[2]);

  // Animate the cascade with a stagger, capping total to ~500ms
  const perCell = newCells.length > 1 ? Math.min(20, 400 / newCells.length) : 0;
  newCells.forEach(([row, col], i) => {
    setTimeout(() => updateCellElement(row, col, true, 0), i * perCell);
  });

  // Bomb shake animation on the clicked cell
  if (result.event === 'bomb') {
    const bombEl = gridEl.querySelector(`[data-row="${r}"][data-col="${c}"]`);
    if (bombEl) {
      // Delay the reveal update slightly so the shake plays on the bomb cell
      setTimeout(() => {
        updateCellElement(r, c, false);
        bombEl.classList.add('bomb-hit');
        bombEl.addEventListener('animationend', () => {
          bombEl.classList.remove('bomb-hit');
        }, { once: true });
      }, 0);
    }
  }

  renderStrikes();
  renderPool();

  const endDelay = newCells.length > 1
    ? Math.min(newCells.length * perCell + 200, 700)
    : 100;
  setTimeout(checkPhase, endDelay);
}

// ----------------------------------------------------------------
// handleFlag — right click
// ----------------------------------------------------------------

function handleFlag(r, c) {
  if (!gameState) return;
  if (gameState.phase === 'won' || gameState.phase === 'lost') return;
  flagCell(gameState, r, c);
  updateCellElement(r, c);
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
      dot.addEventListener('animationend', () => {
        dot.classList.remove('strike-pop');
      }, { once: true });
    }
  });
}

// ----------------------------------------------------------------
// Letter pool
// ----------------------------------------------------------------

function renderPool() {
  poolEl.innerHTML = '';

  // Show found letters
  for (const letter of gameState.letterPool) {
    const tile = document.createElement('span');
    tile.className = 'pool-tile found';
    tile.textContent = letter;
    poolEl.appendChild(tile);
  }

  // Show empty slots for remaining letters
  const remaining = gameState.targetWord.length - gameState.letterPool.length;
  for (let i = 0; i < remaining; i++) {
    const tile = document.createElement('span');
    tile.className = 'pool-tile empty';
    poolEl.appendChild(tile);
  }
}

// ----------------------------------------------------------------
// Phase transitions
// ----------------------------------------------------------------

function checkPhase() {
  if (gameState.phase === 'guessing' && !showingInput) {
    showWordInput();
  } else if (gameState.phase === 'won') {
    showOverlay('won');
  } else if (gameState.phase === 'lost') {
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
  if (guess.length < 3) return; // ignore empty / too short

  const result = submitGuess(gameState, guess);
  wordInput.value = '';

  if (result.event === 'won') {
    renderStrikes();
    setTimeout(() => showOverlay('won'), 300);
  } else if (result.event === 'wrong_guess') {
    renderStrikes();

    const guessesLeft = 3 - gameState.strikes;
    const plural = guessesLeft === 1 ? '' : 'es';
    guessFeedback.textContent = guessesLeft > 0
      ? `Not the word. ${guessesLeft} guess${plural} remaining.`
      : 'No guesses remaining.';
    guessFeedback.classList.remove('is-hidden');

    // Shake the input field
    wordInput.classList.remove('shake'); // reset in case still animating
    // Force reflow so the class re-triggers the animation
    void wordInput.offsetWidth;
    wordInput.classList.add('shake');
    wordInput.addEventListener('animationend', () => {
      wordInput.classList.remove('shake');
    }, { once: true });

    if (gameState.phase === 'lost') {
      // Reveal all cells then show overlay
      renderGrid();
      setTimeout(() => showOverlay('lost'), 600);
    }
  }
}

// ----------------------------------------------------------------
// Overlay
// ----------------------------------------------------------------

function showOverlay(type) {
  if (type === 'won') {
    overlayIcon.textContent  = '🎉';
    overlayTitle.textContent = 'You got it!';
    overlayMsg.textContent   = `The word was ${gameState.targetWord}.`;
  } else {
    overlayIcon.textContent  = '💥';
    overlayTitle.textContent = 'Game Over';
    overlayMsg.textContent   = `The word was ${gameState.targetWord}.`;
  }
  overlay.classList.remove('is-hidden');
}

// ----------------------------------------------------------------
// Event binding
// ----------------------------------------------------------------

function bindEvents() {
  // Left click → reveal
  gridEl.addEventListener('click', (e) => {
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

  // "Guess Early" button
  guessEarlyBtn.addEventListener('click', () => {
    showWordInput();
  });

  // Submit guess via button
  submitGuessBtn.addEventListener('click', handleSubmitGuess);

  // Submit guess via Enter key
  wordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSubmitGuess();
  });

  // "Play Again" button on overlay
  newGameBtn.addEventListener('click', () => {
    overlay.classList.add('is-hidden');
    init();
  });
}

// ----------------------------------------------------------------
// Bootstrap
// ----------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  gridEl         = document.getElementById('grid');
  strikesEl      = document.getElementById('strikes');
  poolEl         = document.getElementById('letter-pool');
  guessEarlyBtn  = document.getElementById('guess-early-btn');
  wordInputArea  = document.getElementById('word-input-area');
  wordInput      = document.getElementById('word-input');
  submitGuessBtn = document.getElementById('submit-guess-btn');
  guessFeedback  = document.getElementById('guess-feedback');
  overlay        = document.getElementById('overlay');
  overlayIcon    = document.getElementById('overlay-icon');
  overlayTitle   = document.getElementById('overlay-title');
  overlayMsg     = document.getElementById('overlay-message');
  newGameBtn     = document.getElementById('new-game-btn');

  bindEvents();
  init();
});
