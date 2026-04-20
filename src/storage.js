// Wordsweeper — localStorage persistence

const STATS_KEY = 'ws_stats';
const saveKey   = (day) => `ws_save_${day}`;

const DEFAULT_STATS = {
  played: 0,
  won: 0,
  currentStreak: 0,
  maxStreak: 0,
  lastPlayedDay: -1,
  lastWonDay: -1,
};

export function getStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    return raw ? { ...DEFAULT_STATS, ...JSON.parse(raw) } : { ...DEFAULT_STATS };
  } catch {
    return { ...DEFAULT_STATS };
  }
}

export function saveStats(stats) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch {}
}

/** Returns the saved game state for dayIndex, or null if none. */
export function getDaySave(dayIndex) {
  try {
    const raw = localStorage.getItem(saveKey(dayIndex));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Persist the current game state for dayIndex.
 * Saves only non-hidden cell visibility (everything else is deterministic from seed).
 */
export function saveDayState(dayIndex, state) {
  try {
    const cells = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const v = state.grid[r][c].visibility;
        if (v !== 'hidden') cells.push({ r, c, v });
      }
    }
    const save = {
      dayIndex,
      phase:        state.phase,
      strikes:      state.strikes,
      letterPool:   [...state.letterPool],
      revealedCount:state.revealedCount,
      cells,
    };
    localStorage.setItem(saveKey(dayIndex), JSON.stringify(save));
    // Prune saves older than 7 days
    for (let d = dayIndex - 7; d >= Math.max(0, dayIndex - 14); d--) {
      localStorage.removeItem(saveKey(d));
    }
  } catch {}
}

/**
 * Record a completed game and update streaks.
 * Safe to call multiple times for the same day — de-duplicates by dayIndex.
 * Returns the updated stats object.
 */
export function recordGameEnd(dayIndex, won) {
  const stats = getStats();

  // Already recorded this day — nothing to do
  if (stats.lastPlayedDay === dayIndex) return stats;

  stats.played += 1;

  if (won) {
    stats.won += 1;
    // Streak continues if we won yesterday, otherwise reset
    stats.currentStreak = (stats.lastWonDay === dayIndex - 1)
      ? stats.currentStreak + 1
      : 1;
    stats.maxStreak  = Math.max(stats.maxStreak, stats.currentStreak);
    stats.lastWonDay = dayIndex;
  } else {
    stats.currentStreak = 0;
  }

  stats.lastPlayedDay = dayIndex;
  saveStats(stats);
  return stats;
}
