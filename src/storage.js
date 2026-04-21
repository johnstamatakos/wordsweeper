// Wordsweeper — localStorage persistence

const STATS_KEY      = 'ws_stats';
const HARD_STATS_KEY = 'ws_stats_hard';
const HARD_MODE_KEY  = 'ws_hard_mode';

const saveKey = (day, hard) => hard ? `ws_save_hard_${day}` : `ws_save_${day}`;

const DEFAULT_STATS = {
  played: 0,
  won: 0,
  currentStreak: 0,
  maxStreak: 0,
  lastPlayedDay: -1,
  lastWonDay: -1,
};

export function getHardMode() {
  try { return localStorage.getItem(HARD_MODE_KEY) === 'true'; } catch { return false; }
}

export function setHardMode(val) {
  try { localStorage.setItem(HARD_MODE_KEY, String(val)); } catch {}
}

export function getStats(hardMode = false) {
  const key = hardMode ? HARD_STATS_KEY : STATS_KEY;
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...DEFAULT_STATS, ...JSON.parse(raw) } : { ...DEFAULT_STATS };
  } catch {
    return { ...DEFAULT_STATS };
  }
}

function saveStats(stats, hardMode = false) {
  const key = hardMode ? HARD_STATS_KEY : STATS_KEY;
  try { localStorage.setItem(key, JSON.stringify(stats)); } catch {}
}

/** Returns the saved game state for dayIndex, or null if none. */
export function getDaySave(dayIndex, hardMode = false) {
  try {
    const raw = localStorage.getItem(saveKey(dayIndex, hardMode));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Persist the current game state for dayIndex.
 * Saves cell.selected for hard mode letter selection.
 */
export function saveDayState(dayIndex, state) {
  try {
    const cells = [];
    for (let r = 0; r < state.gridSize; r++) {
      for (let c = 0; c < state.gridSize; c++) {
        const cell = state.grid[r][c];
        if (cell.visibility !== 'hidden') {
          const entry = { r, c, v: cell.visibility };
          if (state.hardMode && cell.selected) entry.sel = true;
          cells.push(entry);
        }
      }
    }
    const save = {
      dayIndex,
      phase:         state.phase,
      strikes:       state.strikes,
      letterPool:    [...state.letterPool],
      revealedCount: state.revealedCount,
      cells,
    };
    localStorage.setItem(saveKey(dayIndex, state.hardMode), JSON.stringify(save));
    // Prune saves older than 7 days (both modes)
    for (let d = dayIndex - 7; d >= Math.max(0, dayIndex - 14); d--) {
      localStorage.removeItem(saveKey(d, false));
      localStorage.removeItem(saveKey(d, true));
    }
  } catch {}
}

/**
 * Record a completed game and update streaks.
 * Stats are tracked separately for normal and hard mode.
 */
export function recordGameEnd(dayIndex, won, hardMode = false) {
  const stats = getStats(hardMode);

  // Already recorded this day — nothing to do
  if (stats.lastPlayedDay === dayIndex) return stats;

  stats.played += 1;

  if (won) {
    stats.won += 1;
    stats.currentStreak = (stats.lastWonDay === dayIndex - 1)
      ? stats.currentStreak + 1
      : 1;
    stats.maxStreak  = Math.max(stats.maxStreak, stats.currentStreak);
    stats.lastWonDay = dayIndex;
  } else {
    stats.currentStreak = 0;
  }

  stats.lastPlayedDay = dayIndex;
  saveStats(stats, hardMode);
  return stats;
}
