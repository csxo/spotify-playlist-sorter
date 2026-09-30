/**
 * history-manager.js
 * Manages sort history, snapshots, and Undo stack.
 */

const STORAGE_KEY = 'spotify_playlist_sorter_history_v1';

class HistoryManager {
  constructor() {
    this.maxEntries = 20;
  }

  getAllHistory() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return [];
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('[HistoryManager] Failed to read history from localStorage:', e);
      return [];
    }
  }

  saveAllHistory(historyList) {
    try {
      const trimmed = historyList.slice(0, this.maxEntries);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
      console.warn('[HistoryManager] Failed to write history to localStorage:', e);
    }
  }

  /**
   * Save a snapshot state before modifying a playlist.
   *
   * @param {Object} entry
   * @param {string} entry.playlistId
   * @param {string} entry.playlistName
   * @param {string} entry.snapshotIdBefore
   * @param {string} [entry.snapshotIdAfter]
   * @param {Array<string>} entry.originalUris
   * @param {Array<Object>} entry.originalItems
   * @param {Object} entry.optionsUsed
   */
  pushHistory(entry) {
    if (!entry || !entry.playlistId || !entry.originalUris) return;

    const record = {
      id: `${entry.playlistId}_${Date.now()}`,
      playlistId: entry.playlistId,
      playlistName: entry.playlistName || 'Playlist',
      snapshotIdBefore: entry.snapshotIdBefore || '',
      snapshotIdAfter: entry.snapshotIdAfter || '',
      originalUris: entry.originalUris,
      originalItems: (entry.originalItems || []).map(i => ({
        trackName: i.trackName || i.name,
        artistName: i.artists?.[0]?.name || i.assignedArtistName || 'Unknown',
        uri: i.trackUri || i.uri
      })),
      timestamp: Date.now(),
      optionsUsed: entry.optionsUsed || {}
    };

    const all = this.getAllHistory();
    all.unshift(record);
    this.saveAllHistory(all);
    return record;
  }

  /**
   * Get the most recent history record for a specific playlist.
   * @param {string} playlistId
   * @returns {Object|null}
   */
  getLatestHistory(playlistId) {
    if (!playlistId) return null;
    const all = this.getAllHistory();
    return all.find(r => r.playlistId === playlistId) || null;
  }

  /**
   * Pop / remove the latest history record for a specific playlist.
   * @param {string} playlistId
   */
  popHistory(playlistId) {
    if (!playlistId) return null;
    const all = this.getAllHistory();
    const index = all.findIndex(r => r.playlistId === playlistId);
    if (index !== -1) {
      const removed = all.splice(index, 1)[0];
      this.saveAllHistory(all);
      return removed;
    }
    return null;
  }

  /**
   * Check if undo is available for a playlist.
   * @param {string} playlistId
   * @returns {boolean}
   */
  hasUndo(playlistId) {
    return !!this.getLatestHistory(playlistId);
  }
}

const historyManagerInstance = new HistoryManager();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    HistoryManager,
    historyManager: historyManagerInstance
  };
} else if (typeof window !== 'undefined') {
  window.SpotifyPlaylistSorterHistoryManager = historyManagerInstance;
}
