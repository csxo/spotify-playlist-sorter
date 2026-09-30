// ==UserScript==
// @name         Spotify 歌单智能重排器 (Spotify Playlist Auto Sorter)
// @namespace    https://github.com/csxo/spotify-playlist-sorter
// @version      1.0.0
// @description  自动将 Spotify 歌单按歌手聚合、歌曲数量降序、A-Z/年份排序、单曲歌手置底、feat智能归属与重复歌曲清理，支持歌手可视化看板与一键复制生成新歌单。
// @author       csxo (https://github.com/csxo/spotify-playlist-sorter)
// @homepageURL  https://github.com/csxo/spotify-playlist-sorter
// @supportURL   https://github.com/csxo/spotify-playlist-sorter/issues
// @match        https://open.spotify.com/*
// @icon         https://open.spotifycdn.com/cdn/images/favicon32.b64ecc03.png
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        unsafeWindow
// @connect      api.spotify.com
// @connect      accounts.spotify.com
// @connect      developer.spotify.com
// @connect      open.spotify.com
// @run-at       document-start
// ==/UserScript==


(function() {
  'use strict';

  // Prevent multiple injections
  if (window.__SpotifyPlaylistSorterLoaded) return;
  window.__SpotifyPlaylistSorterLoaded = true;

  console.log('[SpotifySorter] Initializing Spotify Playlist Auto Sorter...');

  // --- 1. Comparator Module ---
  /**
 * comparator.js
 * Pinyin and Locale-aware String Comparator for Chinese & Latin characters.
 */

// Pinyin initial consonant boundary reference points in CLDR / zh-Hans-CN
const PINYIN_BOUNDARIES = [
  { letter: 'A', sample: '啊' },
  { letter: 'B', sample: '芭' },
  { letter: 'C', sample: '擦' },
  { letter: 'D', sample: '搭' },
  { letter: 'E', sample: '蛾' },
  { letter: 'F', sample: '发' },
  { letter: 'G', sample: '噶' },
  { letter: 'H', sample: '哈' },
  { letter: 'J', sample: '击' },
  { letter: 'K', sample: '喀' },
  { letter: 'L', sample: '垃' },
  { letter: 'M', sample: '妈' },
  { letter: 'N', sample: '拿' },
  { letter: 'O', sample: '哦' },
  { letter: 'P', sample: '啪' },
  { letter: 'Q', sample: '期' },
  { letter: 'R', sample: '然' },
  { letter: 'S', sample: '撒' },
  { letter: 'T', sample: '塌' },
  { letter: 'W', sample: '挖' },
  { letter: 'X', sample: '昔' },
  { letter: 'Y', sample: '压' },
  { letter: 'Z', sample: '匝' }
];

const zhCollator = new Intl.Collator('zh-Hans-CN', {
  sensitivity: 'base',
  numeric: true
});

/**
 * Determine the primary sort bucket/initial letter for a string (A-Z, 0-9, or symbol).
 * Maps Chinese characters to their Pinyin initial letter (A-Z).
 */
function getSortKeyInitial(str) {
  if (!str) return '#';
  const trimmed = str.trim();
  if (!trimmed) return '#';

  const firstChar = trimmed[0];

  // Latin letter
  if (/[a-zA-Z]/.test(firstChar)) {
    return firstChar.toUpperCase();
  }

  // Digit
  if (/[0-9]/.test(firstChar)) {
    return '0-9';
  }

  // Chinese character range
  if (/[\u4e00-\u9fa5]/.test(firstChar)) {
    for (let i = PINYIN_BOUNDARIES.length - 1; i >= 0; i--) {
      if (zhCollator.compare(firstChar, PINYIN_BOUNDARIES[i].sample) >= 0) {
        return PINYIN_BOUNDARIES[i].letter;
      }
    }
    return 'A';
  }

  return '#';
}

/**
 * Universal comparator:
 * 1. Groups Latin A-Z and Chinese characters starting with the same Pinyin letter together!
 * 2. Uses zh-Hans-CN collator for precise pinyin collation of Chinese text.
 * 3. Handles numbers, symbols, case insensitivity.
 */
function compareStrings(a, b) {
  const strA = (a || '').trim();
  const strB = (b || '').trim();

  if (strA === strB) return 0;
  if (!strA) return 1;
  if (!strB) return -1;

  const initA = getSortKeyInitial(strA);
  const initB = getSortKeyInitial(strB);

  // If different initial categories (e.g. 'A' vs 'B')
  if (initA !== initB) {
    // Numbers first, then Letters A-Z, then symbols '#'
    const rank = (init) => {
      if (init === '0-9') return 0;
      if (init >= 'A' && init <= 'Z') return 1;
      return 2;
    };
    const rankA = rank(initA);
    const rankB = rank(initB);
    if (rankA !== rankB) return rankA - rankB;

    if (initA >= 'A' && initA <= 'Z' && initB >= 'A' && initB <= 'Z') {
      return initA.localeCompare(initB);
    }
  }

  // Same initial letter or category: compare using zh-Hans-CN collator
  const cmp = zhCollator.compare(strA, strB);
  if (cmp !== 0) return cmp;

  return strA.localeCompare(strB);
}

  // --- 2. Sorter Module ---
  /**
 * sorter.js
 * Core Spotify Playlist sorting & deduplication engine adhering strictly to all 10 rules.
 */


/**
 * Standardizes a track item from Spotify Web API or raw object.
 * Guarantees duplicate tracks are preserved as separate unique items.
 *
 * @param {Object} rawItem - Item from Spotify API (playlist item or track)
 * @param {number} originalIndex - Original position index in the playlist
 * @returns {Object} Standardized PlaylistItem
 */
function standardizePlaylistItem(rawItem, originalIndex) {
  const track = rawItem.track || rawItem;
  const isLocal = !!(rawItem.is_local || track.is_local || (track.uri && track.uri.startsWith('spotify:local:')));

  const artists = (track.artists || []).map(a => ({
    id: a.id || a.uri || a.name || 'unknown_artist',
    name: (a.name || 'Unknown Artist').trim()
  }));

  if (artists.length === 0) {
    artists.push({ id: 'unknown_artist', name: 'Unknown Artist' });
  }

  const album = {
    id: track.album?.id || '',
    name: (track.album?.name || 'Unknown Album').trim(),
    releaseDate: track.album?.release_date || track.album?.releaseDate || ''
  };

  return {
    originalIndex,
    uniqueItemId: `${track.id || track.uri}_${originalIndex}`,
    trackId: track.id || '',
    trackUri: track.uri || (track.id ? `spotify:track:${track.id}` : ''),
    trackName: (track.name || 'Unknown Title').trim(),
    artists,
    album,
    durationMs: track.duration_ms || 0,
    isLocal,
    addedAt: rawItem.added_at || ''
  };
}

/**
 * Detects duplicate tracks in a playlist.
 * Tracks are considered duplicates if:
 * 1. They have identical Spotify Track IDs or URIs (when not generic dom_ placeholder), OR
 * 2. They have identical normalized track name and primary artist name.
 *
 * @param {Array<Object>} rawTracks
 * @returns {Array<Object>} Array of duplicate groups:
 *   [{ key, trackName, artistName, occurrences: [{ item, originalIndex, albumName, uri }] }]
 */
function findDuplicateTracks(rawTracks) {
  if (!rawTracks || rawTracks.length === 0) return [];

  const groupsByKey = new Map();

  rawTracks.forEach((t, fallbackIdx) => {
    const track = t.track || t;
    const trackName = (track.name || t.trackName || '').trim();
    const artistName = (track.artists?.[0]?.name || t.artists?.[0]?.name || t.assignedArtist?.name || '').trim();
    const uri = (track.uri || t.trackUri || '').trim();
    const albumName = (track.album?.name || t.album?.name || '').trim();
    const origIndex = t.index !== undefined ? t.index : (t.originalIndex !== undefined ? t.originalIndex : fallbackIdx);

    // Normalization: lowercase, strip non-alphanumeric/non-cjk, remove common suffixes
    const cleanTitle = trackName
      .toLowerCase()
      .replace(/\s*[\(\[].*?(live|remaster|version|edition|deluxe|bonus|edit|mix).*?[\)\]]/gi, '')
      .replace(/[^\w\u4e00-\u9fa5]/g, '');

    const cleanArtist = artistName
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]/g, '');

    let matchKey;
    if (uri && uri.startsWith('spotify:track:') && !uri.includes('dom_') && !uri.includes('graphql_')) {
      matchKey = `uri_${uri}`;
    } else {
      matchKey = `meta_${cleanTitle}__${cleanArtist}`;
    }

    if (!groupsByKey.has(matchKey)) {
      groupsByKey.set(matchKey, {
        key: matchKey,
        trackName,
        artistName,
        occurrences: []
      });
    }

    groupsByKey.get(matchKey).occurrences.push({
      item: t,
      originalIndex: origIndex,
      albumName,
      uri
    });
  });

  return Array.from(groupsByKey.values()).filter(g => g.occurrences.length > 1);
}

/**
 * Main Sorting Function implementing all 10 rules.
 *
 * @param {Array<Object>} rawItems - List of items from Spotify Playlist API or DOM scanner
 * @param {Object} [options={}] - 10 customizable rules options
 * @returns {Object} Sorting result containing sortedItems, artistGroups, stats, and diff
 */
function sortPlaylistItems(rawItems, options = {}) {
  const enableArtistAggregation = options.enableArtistAggregation !== false; // Rule 1
  const artistOrderMode = options.artistOrderMode || 'count_desc'; // Rule 2 ('count_desc' | 'pinyin_az' | 'original_order')
  const artistTieBreaker = options.artistTieBreaker || 'pinyin_az'; // Rule 3 ('pinyin_az' | 'original_appearance')
  const singleTrackStrategy = options.singleTrackStrategy || 'at_the_end_az'; // Rule 4 ('at_the_end_az' | 'mix_with_multi' | 'at_the_top_az')
  const intraArtistSort = options.intraArtistSort || 'track_name_az'; // Rule 5
  const featAttribution = options.featAttribution || 'most_frequent_in_playlist'; // Rule 6
  const duplicateStrategy = options.duplicateStrategy || 'prompt'; // Rule 7 ('prompt' | 'auto_remove' | 'keep_all')
  const singleTrackSortBy = options.singleTrackSortBy || 'artist_az'; // Rule 9 ('artist_az' | 'track_az')
  const enableDiffTracking = options.enableDiffTracking !== false; // Rule 10

  // 1. Filter out duplicate tracks if auto_remove strategy is chosen (Rule 7)
  let workingItems = rawItems || [];
  if (duplicateStrategy === 'auto_remove' && workingItems.length > 0) {
    const seenUris = new Set();
    const seenTitles = new Set();
    workingItems = workingItems.filter((it, idx) => {
      const track = it.track || it;
      const uri = track.uri || it.trackUri;
      if (uri && uri.startsWith('spotify:track:') && !uri.includes('dom_')) {
        if (seenUris.has(uri)) return false;
        seenUris.add(uri);
        return true;
      }
      const titleKey = `${(track.name || it.trackName || '').trim().toLowerCase()}__${(track.artists?.[0]?.name || '').trim().toLowerCase()}`;
      if (seenTitles.has(titleKey)) return false;
      seenTitles.add(titleKey);
      return true;
    });
  }

  // 2. Standardize items
  const items = workingItems.map((item, idx) => standardizePlaylistItem(item, idx));
  const totalCount = items.length;

  if (totalCount === 0) {
    return {
      sortedItems: [],
      multiTrackGroups: [],
      singleTrackGroups: [],
      stats: { total: 0, changedCount: 0, multiArtistCount: 0, singleArtistCount: 0 },
      diff: []
    };
  }

  // 3. Compute artist global counts & first appearances (Rule 6: feat attribution & Rule 3: tiebreaker)
  const artistGlobalCount = new Map();
  const artistNameMap = new Map();
  const artistFirstAppearance = new Map();

  items.forEach((item, idx) => {
    for (const artist of item.artists) {
      const prev = artistGlobalCount.get(artist.id) || 0;
      artistGlobalCount.set(artist.id, prev + 1);
      if (!artistNameMap.has(artist.id)) {
        artistNameMap.set(artist.id, artist.name);
      }
      if (!artistFirstAppearance.has(artist.id)) {
        artistFirstAppearance.set(artist.id, idx);
      }
    }
  });

  // 4. Assign primary artist for each item (Rule 6: feat. collaboration attribution)
  const itemsWithAssignedArtist = items.map(item => {
    let chosenArtist = item.artists[0];

    if (featAttribution === 'most_frequent_in_playlist' && item.artists.length > 1) {
      let maxScore = -1;
      let selected = chosenArtist;

      for (let i = 0; i < item.artists.length; i++) {
        const a = item.artists[i];
        const score = artistGlobalCount.get(a.id) || 0;

        if (score > maxScore) {
          maxScore = score;
          selected = a;
        } else if (score === maxScore) {
          const cmp = compareStrings(selected.name, a.name);
          if (cmp > 0 && i === 0) {
            selected = a;
          }
        }
      }
      chosenArtist = selected;
    }

    return {
      ...item,
      assignedArtist: {
        id: chosenArtist.id,
        name: chosenArtist.name
      }
    };
  });

  // Rule 1: If artist aggregation is disabled, sort flat directly or keep original
  if (!enableArtistAggregation) {
    const sorted = [...itemsWithAssignedArtist];
    if (intraArtistSort === 'track_name_az') {
      sorted.sort((a, b) => compareStrings(a.trackName, b.trackName));
    }
    let changedCount = 0;
    const diff = sorted.map((item, newIndex) => {
      const isMoved = item.originalIndex !== newIndex;
      if (isMoved) changedCount++;
      return {
        newIndex,
        originalIndex: item.originalIndex,
        isMoved,
        delta: newIndex - item.originalIndex,
        trackId: item.trackId,
        trackUri: item.trackUri,
        trackName: item.trackName,
        artistsText: item.artists.map(a => a.name).join(', '),
        assignedArtistName: item.assignedArtist.name,
        albumName: item.album.name,
        item
      };
    });
    return {
      sortedItems: sorted,
      multiTrackGroups: [{ artistId: 'all', artistName: '全部歌手', items: sorted }],
      singleTrackGroups: [],
      stats: { total: totalCount, changedCount, unchangedCount: totalCount - changedCount, multiArtistCount: 1, singleArtistCount: 0 },
      diff
    };
  }

  // 5. Group items by assigned artist (Rule 1: 同一个歌手的歌曲严格聚合到一起)
  const artistGroupsMap = new Map();
  for (const item of itemsWithAssignedArtist) {
    const aid = item.assignedArtist.id;
    if (!artistGroupsMap.has(aid)) {
      artistGroupsMap.set(aid, {
        artistId: aid,
        artistName: item.assignedArtist.name,
        items: []
      });
    }
    artistGroupsMap.get(aid).items.push(item);
  }

  // 6. Separate multi-track artists vs single-track artists (Rule 4)
  const multiTrackGroups = [];
  const singleTrackGroups = [];

  for (const group of artistGroupsMap.values()) {
    if (singleTrackStrategy === 'mix_with_multi') {
      multiTrackGroups.push(group);
    } else {
      if (group.items.length > 1) {
        multiTrackGroups.push(group);
      } else {
        singleTrackGroups.push(group);
      }
    }
  }

  // Helper for tie-breaking between artists (Rule 3)
  const compareArtistTie = (a, b) => {
    if (artistTieBreaker === 'original_appearance') {
      const idxA = artistFirstAppearance.get(a.artistId) ?? 999999;
      const idxB = artistFirstAppearance.get(b.artistId) ?? 999999;
      if (idxA !== idxB) return idxA - idxB;
    }
    return compareStrings(a.artistName, b.artistName);
  };

  // 7. Sort multiTrackGroups (Rule 2)
  multiTrackGroups.sort((a, b) => {
    if (artistOrderMode === 'count_desc') {
      const diff = b.items.length - a.items.length;
      if (diff !== 0) return diff;
      return compareArtistTie(a, b);
    } else if (artistOrderMode === 'pinyin_az') {
      return compareStrings(a.artistName, b.artistName);
    } else if (artistOrderMode === 'original_order') {
      const idxA = artistFirstAppearance.get(a.artistId) ?? 999999;
      const idxB = artistFirstAppearance.get(b.artistId) ?? 999999;
      return idxA - idxB;
    }
    return compareArtistTie(a, b);
  });

  // 8. Sort items within each group (Rule 5: 同歌手内部细分排序)
  const sortGroupItems = (group) => {
    group.items.sort((itemA, itemB) => {
      if (intraArtistSort === 'original_order') {
        return itemA.originalIndex - itemB.originalIndex;
      }

      if (intraArtistSort === 'album_name_then_track_az') {
        const albumCmp = compareStrings(itemA.album.name, itemB.album.name);
        if (albumCmp !== 0) return albumCmp;
        const trackCmp = compareStrings(itemA.trackName, itemB.trackName);
        if (trackCmp !== 0) return trackCmp;
        return itemA.originalIndex - itemB.originalIndex;
      }

      if (intraArtistSort === 'album_date_desc' || intraArtistSort === 'album_date_then_track_az') {
        const dateA = itemA.album.releaseDate || '';
        const dateB = itemB.album.releaseDate || '';
        if (dateA !== dateB) return dateB.localeCompare(dateA); // Newest first
        const trackCmp = compareStrings(itemA.trackName, itemB.trackName);
        if (trackCmp !== 0) return trackCmp;
        return itemA.originalIndex - itemB.originalIndex;
      }

      if (intraArtistSort === 'album_date_asc') {
        const dateA = itemA.album.releaseDate || '';
        const dateB = itemB.album.releaseDate || '';
        if (dateA !== dateB) return dateA.localeCompare(dateB); // Oldest first
        const trackCmp = compareStrings(itemA.trackName, itemB.trackName);
        if (trackCmp !== 0) return trackCmp;
        return itemA.originalIndex - itemB.originalIndex;
      }

      // Default: 'track_name_az' (Rule 5: 歌曲名称 A-Z 拼音)
      const trackCmp = compareStrings(itemA.trackName, itemB.trackName);
      if (trackCmp !== 0) return trackCmp;
      const albumCmp = compareStrings(itemA.album.name, itemB.album.name);
      if (albumCmp !== 0) return albumCmp;
      return itemA.originalIndex - itemB.originalIndex;
    });
  };

  multiTrackGroups.forEach(sortGroupItems);

  // 9. Sort singleTrackGroups (Rule 4 & Rule 9)
  singleTrackGroups.sort((a, b) => {
    if (singleTrackSortBy === 'track_az') {
      const trackCmp = compareStrings(a.items[0].trackName, b.items[0].trackName);
      if (trackCmp !== 0) return trackCmp;
      return compareArtistTie(a, b);
    }
    // Default: artist_az
    const artistCmp = compareArtistTie(a, b);
    if (artistCmp !== 0) return artistCmp;
    return compareStrings(a.items[0].trackName, b.items[0].trackName);
  });

  // 10. Assemble final sorted list (Rule 4: strategy top vs end)
  const sortedItems = [];
  if (singleTrackStrategy === 'at_the_top_az') {
    for (const group of singleTrackGroups) {
      sortedItems.push(...group.items);
    }
    for (const group of multiTrackGroups) {
      sortedItems.push(...group.items);
    }
  } else {
    for (const group of multiTrackGroups) {
      sortedItems.push(...group.items);
    }
    for (const group of singleTrackGroups) {
      sortedItems.push(...group.items);
    }
  }

  // Safety Assertion
  if (sortedItems.length !== totalCount) {
    throw new Error(`Integrity check failed: sorted items count (${sortedItems.length}) !== original items count (${totalCount})`);
  }

  // 11. Generate diff & analytics for user preview modal (Rule 10)
  let changedCount = 0;
  const diff = sortedItems.map((item, newIndex) => {
    const isMoved = item.originalIndex !== newIndex;
    if (isMoved) changedCount++;
    return {
      newIndex,
      originalIndex: item.originalIndex,
      isMoved,
      delta: newIndex - item.originalIndex,
      trackId: item.trackId,
      trackUri: item.trackUri,
      trackName: item.trackName,
      artistsText: item.artists.map(a => a.name).join(', '),
      assignedArtistName: item.assignedArtist.name,
      albumName: item.album.name,
      isLocal: item.isLocal,
      item
    };
  });

  return {
    sortedItems,
    multiTrackGroups,
    singleTrackGroups,
    stats: {
      total: totalCount,
      changedCount,
      unchangedCount: totalCount - changedCount,
      multiArtistCount: multiTrackGroups.length,
      singleArtistCount: singleTrackGroups.length
    },
    diff: enableDiffTracking ? diff : []
  };
}

  // --- 3. Token Manager Module ---
  /**
 * token-manager.js
 * Automatically manages Spotify Web API access tokens across
 * extension storage, window bridges, and manual input.
 */

class TokenManager {
  constructor() {
    this.token = null;
    this.source = 'none'; // 'chrome_storage' | 'manual' | 'developer_bridge' | 'cache'
    this.listeners = new Set();
    this.storageKey = 'spotify_sorter_access_token';
    this.init();
  }

  init() {
    // 1. Check Chrome Extension storage (highest priority)
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['spotify_access_token'], (res) => {
        if (res && res.spotify_access_token && this.isValidFormat(res.spotify_access_token)) {
          this.setToken(res.spotify_access_token, 'chrome_storage');
        }
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.spotify_access_token && changes.spotify_access_token.newValue) {
          this.setToken(changes.spotify_access_token.newValue, 'chrome_storage_sync');
        }
      });
    }

    // 2. Check cached token in sessionStorage & localStorage
    try {
      const cached = localStorage.getItem(this.storageKey) || sessionStorage.getItem(this.storageKey);
      if (cached && this.isValidFormat(cached)) {
        this.setToken(cached, 'cache');
      }
    } catch (e) {}

    // 3. Listen for postMessage from bridge.js or developer bridge
    if (typeof window !== 'undefined') {
      window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'SPOTIFY_SORTER_INTERCEPTED_TOKEN' && event.data.token) {
          const t = event.data.token.trim();
          if (this.isValidFormat(t)) {
            this.setToken(t, 'auto_session');
          }
        }
      });
    }

    // 4. Listen for runtime messages from background (e.g. from developer-bridge tab)
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === 'SPOTIFY_SORTER_TOKEN_SYNC' && msg.token) {
          this.setToken(msg.token, 'sync_broadcast');
        }
      });
    }

    // 5. Detect OAuth PKCE redirect in URL query (?code=... or ?error=...)
    if (typeof window !== 'undefined' && window.location && window.location.search) {
      const searchParams = new URLSearchParams(window.location.search);
      const code = searchParams.get('code');
      const error = searchParams.get('error');
      if (code) {
        console.log('[SpotifySorter] Detected OAuth authorization code in URL, exchanging for token via PKCE...');
        this.handlePkceCallback(code);
      } else if (error) {
        console.warn('[SpotifySorter] Spotify OAuth returned error:', error);
        try {
          const cleanUrl = window.location.pathname;
          window.history.replaceState(null, null, cleanUrl);
        } catch (e) {}
      }
    }

    // 6. Detect OAuth Implicit Grant redirect in URL hash (#access_token=...)
    if (typeof window !== 'undefined' && window.location && window.location.hash) {
      if (window.location.hash.includes('access_token=')) {
        const match = window.location.hash.match(/access_token=([^&]+)/);
        if (match) {
          const oauthToken = decodeURIComponent(match[1]);
          console.log('[SpotifySorter] Detected OAuth access_token from Spotify redirect!');
          this.setToken(oauthToken, 'oauth_login');
          try {
            // Restore URL cleanly
            const cleanUrl = window.location.pathname + window.location.search;
            window.history.replaceState(null, null, cleanUrl);
          } catch (e) {}
        }
      }
    }
  }

  isOfficialToken(token) {
    if (!token || typeof token !== 'string') return false;
    const clean = token.trim();
    if (clean.startsWith('BQD')) return false;
    return clean.length > 30 && (clean.startsWith('BQ') || clean.startsWith('AQ') || clean.length > 50);
  }

  async autoDiscoverSessionToken() {
    if (this.token && this.isValidFormat(this.token)) {
      return this.token;
    }

    // 1. Direct fetch from Spotify Web Player native endpoint
    if (typeof window !== 'undefined' && typeof fetch !== 'undefined') {
      try {
        const resp = await fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
          credentials: 'include'
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.accessToken && this.isValidFormat(data.accessToken)) {
            console.log('[SpotifySorter] Auto-discovered native Spotify Web Player token!');
            this.setToken(data.accessToken, 'web_player_endpoint');
            return data.accessToken;
          }
        }
      } catch (e) {}
    }

    // 2. Discover from sessionStorage
    try {
      if (typeof sessionStorage !== 'undefined') {
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          const val = sessionStorage.getItem(k);
          if (val && typeof val === 'string') {
            const match = val.match(/BQ[A-Za-z0-9_-]{40,}/);
            if (match && this.isValidFormat(match[0])) {
              this.setToken(match[0], 'session_storage');
              return match[0];
            }
          }
        }
      }
    } catch (e) {}

    // 3. Discover from localStorage
    try {
      if (typeof localStorage !== 'undefined') {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          const val = localStorage.getItem(k);
          if (val && typeof val === 'string') {
            const match = val.match(/BQ[A-Za-z0-9_-]{40,}/);
            if (match && this.isValidFormat(match[0])) {
              this.setToken(match[0], 'local_storage');
              return match[0];
            }
          }
        }
      }
    } catch (e) {}

    return this.token;
  }

  isValidFormat(token) {
    return typeof token === 'string' && token.length > 30 && !token.includes(' ') && !token.includes('\n');
  }

  setToken(token, source = 'manual') {
    if (!token) return;
    const clean = token.trim().replace(/^Bearer\s+/i, '');
    if (!this.isValidFormat(clean) || (clean === this.token && this.source === source)) return;

    this.token = clean;
    this.source = source;

    try {
      localStorage.setItem(this.storageKey, clean);
      sessionStorage.setItem(this.storageKey, clean);
    } catch (e) {}

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ spotify_access_token: clean });
    }

    this.notifyListeners();
  }

  setManualToken(token) {
    const clean = (token || '').trim().replace(/^Bearer\s+/i, '');
    if (!this.isValidFormat(clean)) {
      throw new Error('Token 格式无效，长度需超过 30 位且不含空格');
    }
    this.setToken(clean, 'manual');
  }

  clearToken() {
    this.token = null;
    this.source = 'none';
    try {
      localStorage.removeItem(this.storageKey);
      sessionStorage.removeItem(this.storageKey);
      localStorage.removeItem('spotify_sorter_refresh_token');
      localStorage.removeItem('spotify_sorter_token_expiry');
    } catch (e) {}
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove(['spotify_access_token', 'spotify_refresh_token', 'spotify_user_name', 'spotify_user_id']);
    }
    this.notifyListeners();
  }

  getToken() {
    return this.token;
  }

  getSource() {
    return this.source;
  }

  hasToken() {
    return !!this.token;
  }

  hasOfficialToken() {
    return this.isOfficialToken(this.token);
  }

  addListener(fn) {
    this.listeners.add(fn);
    if (this.token) {
      try { fn(this.token, this.source); } catch (e) { console.error(e); }
    }
    return () => this.listeners.delete(fn);
  }

  getClientId() {
    try {
      return localStorage.getItem('spotify_sorter_client_id') || '';
    } catch (e) {
      return '';
    }
  }

  setClientId(clientId) {
    if (!clientId) return;
    const clean = clientId.trim();
    try {
      localStorage.setItem('spotify_sorter_client_id', clean);
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ spotify_client_id: clean });
      }
    } catch (e) {}
  }

  generateCodeVerifier(length = 64) {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const randomValues = new Uint8Array(length);
    const cryptoObj = (typeof window !== 'undefined' && (window.crypto || window.msCrypto))
      ? (window.crypto || window.msCrypto)
      : null;

    if (cryptoObj && cryptoObj.getRandomValues) {
      cryptoObj.getRandomValues(randomValues);
    } else {
      for (let i = 0; i < length; i++) {
        randomValues[i] = Math.floor(Math.random() * 256);
      }
    }

    return Array.from(randomValues)
      .map((x) => possible[x % possible.length])
      .join('');
  }

  async generateCodeChallenge(codeVerifier) {
    const cryptoObj = (typeof window !== 'undefined' && window.crypto)
      ? window.crypto
      : (typeof globalThis !== 'undefined' ? globalThis.crypto : null);

    if (cryptoObj && cryptoObj.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(codeVerifier);
      const digest = await cryptoObj.subtle.digest('SHA-256', data);
      const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
      return base64
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    }

    try {
      const getCrypto = new Function('return require("crypto")');
      const nodeCrypto = getCrypto();
      return nodeCrypto.createHash('sha256').update(codeVerifier).digest('base64url');
    } catch (e) {
      throw new Error('当前环境缺少 Web Crypto 支持');
    }
  }

  async startOAuthLogin(clientId) {
    const id = (clientId || this.getClientId() || '').trim();
    if (!id) {
      throw new Error('请先提供 Spotify Client ID！');
    }
    this.setClientId(id);

    // Save return playlist URL so we redirect right back
    try {
      sessionStorage.setItem('spotify_oauth_return_url', window.location.href);
      localStorage.setItem('spotify_oauth_return_url', window.location.href);
    } catch (e) {}

    // Generate PKCE Verifier & Challenge
    const codeVerifier = this.generateCodeVerifier(64);
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    const state = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);

    try {
      sessionStorage.setItem('spotify_pkce_code_verifier', codeVerifier);
      localStorage.setItem('spotify_pkce_code_verifier', codeVerifier);
      sessionStorage.setItem('spotify_oauth_state', state);
      localStorage.setItem('spotify_oauth_state', state);
    } catch (e) {}

    // Use open.spotify.com/ as redirect_uri
    const redirectUri = window.location.origin + '/';
    const scopes = [
      'playlist-read-private',
      'playlist-read-collaborative',
      'playlist-modify-public',
      'playlist-modify-private'
    ].join(' ');

    const params = new URLSearchParams({
      client_id: id,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: scopes,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
      state: state,
      show_dialog: 'true'
    });

    const authUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;
    console.log('[SpotifySorter] Initiating PKCE OAuth login, redirecting to Spotify accounts...');
    window.location.href = authUrl;
  }

  async handlePkceCallback(code) {
    try {
      const codeVerifier = sessionStorage.getItem('spotify_pkce_code_verifier') || localStorage.getItem('spotify_pkce_code_verifier');
      const clientId = this.getClientId();
      const returnUrl = sessionStorage.getItem('spotify_oauth_return_url') || localStorage.getItem('spotify_oauth_return_url');

      // Clean the URL immediately to avoid re-triggering and keep address bar clean
      try {
        const cleanUrl = window.location.pathname;
        window.history.replaceState(null, null, cleanUrl);
      } catch (e) {}

      if (!codeVerifier) {
        console.error('[SpotifySorter] Missing PKCE code_verifier in storage. Authentication cannot proceed.');
        if (typeof window !== 'undefined' && window.__spotifySorterApp) {
          window.__spotifySorterApp.showToast('授权校验失败：缺少 code_verifier，请重新点击一键授权', 'error');
        }
        return;
      }
      if (!clientId) {
        console.error('[SpotifySorter] Missing Client ID. Authentication cannot proceed.');
        if (typeof window !== 'undefined' && window.__spotifySorterApp) {
          window.__spotifySorterApp.showToast('授权失败：未找到 Client ID，请重新输入并授权', 'error');
        }
        return;
      }

      console.log('[SpotifySorter] Exchanging PKCE code for access token...');
      const tokenData = await this.exchangeCodeForToken(code, codeVerifier, clientId);

      if (tokenData && tokenData.access_token) {
        console.log('[SpotifySorter] PKCE exchange successful! Token acquired.');
        this.setToken(tokenData.access_token, 'oauth_pkce');

        if (tokenData.refresh_token) {
          try {
            localStorage.setItem('spotify_sorter_refresh_token', tokenData.refresh_token);
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
              chrome.storage.local.set({ spotify_refresh_token: tokenData.refresh_token });
            }
          } catch (e) {}
        }

        if (tokenData.expires_in) {
          const expiry = Date.now() + (Number(tokenData.expires_in) - 60) * 1000;
          try {
            localStorage.setItem('spotify_sorter_token_expiry', String(expiry));
          } catch (e) {}
        }

        // Clean up verifier & state
        try {
          sessionStorage.removeItem('spotify_pkce_code_verifier');
          localStorage.removeItem('spotify_pkce_code_verifier');
          sessionStorage.removeItem('spotify_oauth_state');
          localStorage.removeItem('spotify_oauth_state');
          sessionStorage.removeItem('spotify_oauth_return_url');
          localStorage.removeItem('spotify_oauth_return_url');
        } catch (e) {}

        // Set auto-open flag so sorter modal pops up
        try {
          sessionStorage.setItem('spotify_sorter_auto_open', '1');
        } catch (e) {}

        // If returnUrl was different and points to a playlist, redirect there
        if (returnUrl && returnUrl !== window.location.href && returnUrl.includes('/playlist/')) {
          console.log('[SpotifySorter] Returning to playlist:', returnUrl);
          window.location.href = returnUrl;
        } else {
          // If already on the page or root, notify user
          if (typeof window !== 'undefined' && window.__spotifySorterApp) {
            try {
              window.__spotifySorterApp.showToast('✅ Spotify 授权成功！凭据已就绪', 'success');
              if (window.__spotifySorterApp.extractPlaylistId()) {
                window.__spotifySorterApp.handleOpenModal();
              }
            } catch (e) {}
          }
        }
      }
    } catch (err) {
      console.error('[SpotifySorter] PKCE exchange error:', err);
      if (typeof window !== 'undefined' && window.__spotifySorterApp) {
        window.__spotifySorterApp.showToast(`授权失败: ${err.message}`, 'error');
      }
    }
  }

  async exchangeCodeForToken(code, codeVerifier, clientId) {
    const redirectUri = window.location.origin + '/';
    const params = new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    });

    const bodyStr = params.toString();
    const tokenUrl = 'https://accounts.spotify.com/api/token';

    let reqFn = typeof sendUniversalRequest === 'function' ? sendUniversalRequest : null;
    if (!reqFn && typeof window !== 'undefined' && window.__sendUniversalRequest) {
      reqFn = window.__sendUniversalRequest;
    }

    if (reqFn) {
      const res = await reqFn(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: bodyStr
      }, 15000);

      const data = await res.json();
      if (!res.ok) {
        const desc = data?.error_description || data?.error || `HTTP ${res.status}`;
        throw new Error(desc);
      }
      return data;
    }

    // Direct fetch fallback
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: bodyStr
    });

    const text = await resp.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = { raw: text };
    }

    if (!resp.ok) {
      const desc = data.error_description || data.error || `HTTP ${resp.status}`;
      throw new Error(desc);
    }

    return data;
  }

  async refreshAccessToken() {
    let refreshToken = null;
    try {
      refreshToken = localStorage.getItem('spotify_sorter_refresh_token');
    } catch (e) {}

    const clientId = this.getClientId();
    if (!refreshToken || !clientId) return false;

    try {
      const params = new URLSearchParams({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      });

      const bodyStr = params.toString();
      const tokenUrl = 'https://accounts.spotify.com/api/token';

      let reqFn = typeof sendUniversalRequest === 'function' ? sendUniversalRequest : null;
      if (!reqFn && typeof window !== 'undefined' && window.__sendUniversalRequest) {
        reqFn = window.__sendUniversalRequest;
      }

      let data;
      if (reqFn) {
        const res = await reqFn(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: bodyStr
        }, 12000);
        if (res.ok) data = await res.json();
      } else {
        const resp = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: bodyStr
        });
        if (resp.ok) data = await resp.json();
      }

      if (data && data.access_token) {
        this.setToken(data.access_token, 'pkce_refresh');
        if (data.refresh_token) {
          try {
            localStorage.setItem('spotify_sorter_refresh_token', data.refresh_token);
          } catch (e) {}
        }
        if (data.expires_in) {
          const expiry = Date.now() + (Number(data.expires_in) - 60) * 1000;
          try {
            localStorage.setItem('spotify_sorter_token_expiry', String(expiry));
          } catch (e) {}
        }
        return true;
      }
    } catch (e) {
      console.warn('[SpotifySorter] Failed to refresh token:', e);
    }
    return false;
  }
}

const tokenManagerInstance = new TokenManager();

  // --- 4. History Manager Module ---
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

  // --- 5. Spotify API Module ---
  /**
 * spotify-api.js
 * Comprehensive Spotify Web API client with multi-tier CORS bypass
 * (GM_xmlhttpRequest -> Chrome background worker -> fetch with timeout),
 * Snapshot ID concurrency protection, paginated track retrieval, and batch updates.
 */

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

/**
 * Universal HTTP request dispatcher.
 * Automatically chooses the best transport to guarantee zero CORS issues and strict timeout.
 */
function sendUniversalRequest(url, options = {}, timeoutMs = 10000) {
  // 1. Violentmonkey / Tampermonkey GM_xmlhttpRequest (Highest priority: 100% bypasses browser CORS)
  const gmRequest = typeof GM_xmlhttpRequest !== 'undefined'
    ? GM_xmlhttpRequest
    : (typeof GM !== 'undefined' && GM.xmlHttpRequest ? GM.xmlHttpRequest : null);

  if (gmRequest) {
    return new Promise((resolve, reject) => {
      let isCompleted = false;
      const timer = setTimeout(() => {
        if (!isCompleted) {
          isCompleted = true;
          reject(new Error(`网络请求超时 (${Math.round(timeoutMs / 1000)}s)，请检查网络连接或代理状态！`));
        }
      }, timeoutMs);

      try {
        gmRequest({
          method: options.method || 'GET',
          url: url,
          headers: options.headers || {},
          data: options.body,
          timeout: timeoutMs,
          onload: function(res) {
            if (isCompleted) return;
            isCompleted = true;
            clearTimeout(timer);

            let jsonParsed = null;
            resolve({
              status: res.status,
              statusText: res.statusText,
              ok: res.status >= 200 && res.status < 300,
              headers: {
                get: (h) => {
                  if (!res.responseHeaders) return null;
                  const match = res.responseHeaders.match(new RegExp(`^${h}:\\s*(.+)$`, 'im'));
                  return match ? match[1].trim() : null;
                }
              },
              json: async () => {
                if (jsonParsed) return jsonParsed;
                jsonParsed = JSON.parse(res.responseText || '{}');
                return jsonParsed;
              },
              text: async () => res.responseText
            });
          },
          onerror: function(err) {
            if (isCompleted) return;
            isCompleted = true;
            clearTimeout(timer);
            reject(new Error(err.error || err.statusText || 'GM_xmlhttpRequest 请求失败，请检查脚本权限或代理'));
          },
          ontimeout: function() {
            if (isCompleted) return;
            isCompleted = true;
            clearTimeout(timer);
            reject(new Error(`请求超时 (${Math.round(timeoutMs / 1000)}s)`));
          }
        });
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  // 2. Chrome Extension background worker messaging (Bypasses CORS via host_permissions)
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage && !window.__isExtensionBackground) {
    return new Promise((resolve, reject) => {
      let isCompleted = false;
      const timer = setTimeout(() => {
        if (!isCompleted) {
          isCompleted = true;
          reject(new Error(`扩展后台请求超时 (${Math.round(timeoutMs / 1000)}s)，请检查网络连接或代理！`));
        }
      }, timeoutMs + 1000);

      try {
        chrome.runtime.sendMessage({
          type: 'SPOTIFY_API_REQUEST',
          url,
          options,
          timeoutMs
        }, (response) => {
          if (isCompleted) return;
          isCompleted = true;
          clearTimeout(timer);

          if (chrome.runtime.lastError) {
            return reject(new Error(`扩展通信异常: ${chrome.runtime.lastError.message}`));
          }
          if (!response) {
            return reject(new Error('扩展后台无响应，请在 chrome://extensions 页面刷新扩展后再试。'));
          }

          if (response.error) {
            return reject(new Error(response.error));
          }

          resolve({
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
            headers: {
              get: (h) => (response.headers && response.headers[h.toLowerCase()]) || null
            },
            json: async () => response.data,
            text: async () => (typeof response.data === 'string' ? response.data : JSON.stringify(response.data))
          });
        });
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  // 3. Fallback: native browser fetch with strict timeout
  return sendNativeFetch(url, options, timeoutMs);
}

async function sendNativeFetch(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timer);
    return resp;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`网络连接超时 (${Math.round(timeoutMs / 1000)}s)：浏览器端连接 api.spotify.com 超时，可能是 CORS 拦截或代理规则未命中。`);
    }
    throw err;
  }
}

class SpotifyApiClient {
  async fetchWithAuth(endpoint, options = {}, token) {
    if (!token) {
      throw new Error('未检测到有效的 Spotify 访问凭证，请刷新页面重试。');
    }

    const cleanToken = token.trim();
    const url = endpoint.startsWith('http') ? endpoint : `${SPOTIFY_API_BASE}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${cleanToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    let retries = 1; // max 1 retry for transient glitches
    while (retries >= 0) {
      let resp;
      try {
        resp = await sendUniversalRequest(url, { ...options, headers }, 10000);
      } catch (netErr) {
        if (retries > 0) {
          retries--;
          await new Promise(r => setTimeout(r, 600));
          continue;
        }
        throw netErr;
      }

      // Handle Spotify 429 Rate Limiting
      if (resp.status === 429) {
        const retryAfterSec = parseInt(resp.headers.get('Retry-After') || '2', 10);
        console.warn(`[SpotifyAPI] Rate limited (429). Retrying after ${retryAfterSec}s...`);
        await new Promise(r => setTimeout(r, (retryAfterSec + 0.5) * 1000));
        retries--;
        continue;
      }

      // Handle 401 Unauthorized
      if (resp.status === 401) {
        // Try refreshing token once if we have PKCE refresh capability
        if (typeof window !== 'undefined' && window.SpotifyPlaylistSorterTokenManager && typeof window.SpotifyPlaylistSorterTokenManager.refreshAccessToken === 'function') {
          console.log('[SpotifyAPI] Token expired (401), attempting PKCE silent refresh...');
          const refreshed = await window.SpotifyPlaylistSorterTokenManager.refreshAccessToken();
          if (refreshed) {
            cleanToken = window.SpotifyPlaylistSorterTokenManager.getToken();
            retries++;
            continue;
          }
        }
        throw new Error('401 凭证已过期或无效，请刷新页面重新获取。');
      }

      // Handle 403 Forbidden: Do NOT retry
      if (resp.status === 403) {
        throw new Error('403 权限不足：您可能不是该歌单的创建者，或者该 Token 在申请时未勾选 playlist-modify-public / playlist-modify-private 权限。');
      }

      if (resp.status === 404) {
        throw new Error('404 未找到：未找到该歌单或曲目。请确认当前网页是否为公开或属于您的自建歌单！');
      }

      if (!resp.ok) {
        let errMessage = `HTTP ${resp.status} ${resp.statusText}`;
        try {
          const errJson = await resp.json();
          if (errJson.error?.message) {
            errMessage = errJson.error.message;
          }
        } catch (e) {}
        throw new Error(`Spotify API 请求失败: ${errMessage}`);
      }

      // 204 No Content
      if (resp.status === 204) {
        return null;
      }

      return await resp.json();
    }

    throw new Error('Spotify API 请求重试失败，请检查网络连接或稍后重试。');
  }

  /**
   * Fast verification of token validity (timeout: 5000ms).
   * @param {string} token
   * @returns {Promise<{ valid: boolean, user?: Object, error?: string }>}
   */
  async validateToken(token) {
    if (!token) return { valid: false, error: '未提供凭证' };
    const clean = token.trim();

    try {
      const user = await this.getCurrentUser(clean);
      return { valid: true, user };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  /**
   * Get current logged-in user profile.
   */
  async getCurrentUser(token) {
    return await this.fetchWithAuth('/me', {}, token);
  }

  /**
   * Get basic playlist metadata (name, snapshot_id, owner, track count).
   */
  async getPlaylist(playlistId, token) {
    const fields = 'id,name,snapshot_id,owner(id,display_name),collaborative,public,tracks(total),images';
    return await this.fetchWithAuth(`/playlists/${playlistId}?fields=${fields}`, {}, token);
  }

  /**
   * Fetch all tracks in a playlist with pagination.
   */
  async getAllPlaylistTracks(playlistId, token, onProgress) {
    const limit = 100;
    let offset = 0;
    let allItems = [];
    let total = 0;

    while (true) {
      const url = `/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}&additional_types=track`;
      const data = await this.fetchWithAuth(url, {}, token);

      total = data.total || 0;
      const items = data.items || [];
      allItems.push(...items);

      if (onProgress) {
        const percent = total > 0 ? Math.min(100, Math.round((allItems.length / total) * 100)) : 100;
        onProgress({ loaded: allItems.length, total, percent });
      }

      if (!data.next || allItems.length >= total || items.length === 0) {
        break;
      }

      offset += limit;
      await new Promise(r => setTimeout(r, 60));
    }

    return allItems.filter(item => item && (item.track || item.uri));
  }

  /**
   * Check if current remote snapshot_id matches expected snapshot_id.
   */
  async verifySnapshotId(playlistId, expectedSnapshotId, token) {
    const data = await this.fetchWithAuth(`/playlists/${playlistId}?fields=snapshot_id`, {}, token);
    const remoteSnapshotId = data.snapshot_id;
    if (expectedSnapshotId && remoteSnapshotId !== expectedSnapshotId) {
      throw new Error(`歌单版本冲突 (Snapshot Mismatch): 歌单已被修改或在其他设备更新。\n` +
        `预期版本: ${expectedSnapshotId.substring(0, 10)}...\n` +
        `远程版本: ${remoteSnapshotId.substring(0, 10)}...\n` +
        `为防止覆盖冲突，操作已自动取消。请刷新后重新分析歌单！`);
    }
    return remoteSnapshotId;
  }

  /**
   * Safely updates playlist tracks order with Snapshot ID guard and batching.
   */
  async updatePlaylistTracks(playlistId, expectedSnapshotId, sortedTrackUris, token, onProgress) {
    if (!sortedTrackUris || sortedTrackUris.length === 0) {
      throw new Error('曲目列表为空，无法执行更新！');
    }

    // 1. Verify snapshot_id safety check (Rule 9)
    await this.verifySnapshotId(playlistId, expectedSnapshotId, token);

    const total = sortedTrackUris.length;
    let currentSnapshotId = expectedSnapshotId;

    if (onProgress) {
      onProgress({ step: 'writing', written: 0, total, percent: 5, message: '正在初始化写入...' });
    }

    // 2. Batch 1: Replace first 100 items using PUT
    const firstChunk = sortedTrackUris.slice(0, 100);
    const putPayload = { uris: firstChunk };
    if (expectedSnapshotId) {
      putPayload.snapshot_id = expectedSnapshotId;
    }

    const putRes = await this.fetchWithAuth(`/playlists/${playlistId}/tracks`, {
      method: 'PUT',
      body: JSON.stringify(putPayload)
    }, token);

    if (putRes && putRes.snapshot_id) {
      currentSnapshotId = putRes.snapshot_id;
    }

    let written = firstChunk.length;
    if (onProgress) {
      const pct = Math.round((written / total) * 100);
      onProgress({ step: 'writing', written, total, percent: pct, message: `已写入 ${written}/${total} 首...` });
    }

    // 3. Batch 2+: If playlist has > 100 items, append remaining chunks in order using POST
    if (total > 100) {
      for (let i = 100; i < total; i += 100) {
        const chunk = sortedTrackUris.slice(i, i + 100);
        const postRes = await this.fetchWithAuth(`/playlists/${playlistId}/tracks`, {
          method: 'POST',
          body: JSON.stringify({ uris: chunk })
        }, token);

        if (postRes && postRes.snapshot_id) {
          currentSnapshotId = postRes.snapshot_id;
        }

        written += chunk.length;
        if (onProgress) {
          const pct = Math.round((written / total) * 100);
          onProgress({ step: 'writing', written, total, percent: pct, message: `已写入 ${written}/${total} 首...` });
        }

        await new Promise(r => setTimeout(r, 100));
      }
    }

    // 4. Fetch final playlist snapshot_id
    const finalInfo = await this.fetchWithAuth(`/playlists/${playlistId}?fields=snapshot_id`, {}, token);
    const finalSnapshotId = finalInfo.snapshot_id || currentSnapshotId;

    if (onProgress) {
      onProgress({ step: 'complete', written: total, total, percent: 100, message: '排序已成功写回歌单！' });
    }

    return {
      success: true,
      snapshotId: finalSnapshotId,
      totalUpdated: total
    };
  }
}

const spotifyApiClientInstance = new SpotifyApiClient();

  // --- 6. UI Module ---
  /**
 * ui.js
 * Injected Spotify UI: Floating trigger button, Analysis/Preview modal,
 * Diff viewer, Grouped/Flat views, Undo control, and Diagnostics/Token manager.
 */

class SpotifySorterUI {
  constructor(deps) {
    this.tokenManager = deps.tokenManager;
    this.api = deps.api;
    this.sorter = deps.sorter;
    this.history = deps.history;

    this.currentPlaylistId = null;
    this.currentPlaylistData = null;
    this.rawTracks = [];
    this.sortResult = null;
    this.activeTab = 'grouped'; // 'grouped' | 'flat'
    this.options = {
      enableArtistAggregation: true,       // 规则 1: 同歌手全聚合
      artistOrderMode: 'count_desc',       // 规则 2: 聚合歌手按歌曲数降序
      artistTieBreaker: 'pinyin_az',       // 规则 3: 同量级拼音 A-Z
      singleTrackStrategy: 'at_the_end_az', // 规则 4: 单曲歌手置底
      intraArtistSort: 'track_name_az',    // 规则 5: 同歌手内按歌名 A-Z 拼音
      featAttribution: 'most_frequent_in_playlist', // 规则 6: feat 归属最多歌曲歌手
      duplicateStrategy: 'prompt',         // 规则 7: 重复歌曲检测与去重
      ignoreSpecialPrefix: true,           // 规则 8: 忽略标点符号 A-Z 排序
      singleTrackSortBy: 'artist_az',      // 规则 9: 单曲歌手按姓名 A-Z
      enableDiffTracking: true             // 规则 10: 位移追踪分析
    };

    this.selectedArtistFilter = null;
    this.artistSearchQuery = '';
    this.showRulesDrawer = false;
    this.duplicateGroups = [];
    this.removedTrackKeys = new Set();
    this.showDuplicateList = false;

    this.isOpen = false;
    this.abortController = null;
    this.interceptedPlaylistData = null;
    this.init();
  }

  init() {
    if (typeof window !== 'undefined') {
      window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'SPOTIFY_SORTER_INTERCEPTED_PLAYLIST') {
          this.interceptedPlaylistData = event.data;
        }
      });
    }

    const setupUI = () => {
      this.injectStyles();
      this.mountActionBarButton();
      this.startLocationWatcher();

      // Check auto-open flag from OAuth PKCE login redirect
      try {
        if (sessionStorage.getItem('spotify_sorter_auto_open') === '1') {
          sessionStorage.removeItem('spotify_sorter_auto_open');
          setTimeout(() => {
            if (this.extractPlaylistId()) {
              this.handleOpenModal();
            }
          }, 600);
        }
      } catch (e) {}
    };

    if (document.readyState === 'interactive' || document.readyState === 'complete' || document.body) {
      setupUI();
    } else {
      document.addEventListener('DOMContentLoaded', setupUI, { once: true });
      window.addEventListener('load', setupUI, { once: true });
    }

    // Observe DOM mutations to mount button dynamically on SPA route changes
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined' && document.body) {
      const observer = new MutationObserver(() => {
        if (this.extractPlaylistId() && !document.getElementById('sp-action-bar-sorter-btn')) {
          this.mountActionBarButton();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    // Periodic check to ensure button is mounted when navigating into playlists
    setInterval(() => {
      if (this.extractPlaylistId() && !document.getElementById('sp-action-bar-sorter-btn')) {
        this.mountActionBarButton();
      }
    }, 600);

    // Listen to Chrome extension popup messages
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message) => {
        if (message && message.type === 'OPEN_SORTER_MODAL') {
          this.handleOpenModal();
        }
      });
    }
  }

  // Monitor SPA route changes on open.spotify.com
  startLocationWatcher() {
    let lastUrl = location.href;
    const checkUrl = () => {
      const currentUrl = location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        this.onRouteChanged();
      }
    };

    setInterval(checkUrl, 500);
    window.addEventListener('popstate', checkUrl);
  }

  extractPlaylistId() {
    const match = location.pathname.match(/\/playlist\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  onRouteChanged() {
    const playlistId = this.extractPlaylistId();
    if (playlistId) {
      this.currentPlaylistId = playlistId;
      this.mountActionBarButton();
    } else {
      this.currentPlaylistId = null;
      const btn = document.getElementById('sp-action-bar-sorter-btn');
      if (btn) btn.remove();
      if (this.isOpen) {
        this.closeModal();
      }
    }
  }

  /**
   * Mounts the trigger button directly in the playlist action bar row
   * (right next to the more options '...' button in the action bar, as requested)
   */
  mountActionBarButton() {
    if (typeof window === 'undefined' || !document.body) return;
    const playlistId = this.extractPlaylistId();
    if (!playlistId) return;

    const existing = document.getElementById('sp-action-bar-sorter-btn');
    if (existing && existing.isConnected) return;

    // Remove legacy floating button if any
    const oldFab = document.getElementById('sp-sorter-trigger-btn');
    if (oldFab) oldFab.remove();

    // Locate Spotify playlist action bar
    const actionBar = document.querySelector('[data-testid="action-bar-row"]')
      || document.querySelector('div[data-testid="action-bar-row"]')
      || document.querySelector('[data-testid="play-button"]')?.closest('div')
      || document.querySelector('.action-bar-row');

    if (actionBar) {
      const btn = document.createElement('button');
      btn.id = 'sp-action-bar-sorter-btn';
      btn.className = 'sp-action-bar-sorter-btn';
      btn.setAttribute('type', 'button');
      btn.setAttribute('title', '点击打开 Spotify 歌单智能重排器');
      btn.innerHTML = `
        <span style="font-size:16px; line-height:1; display:flex; align-items:center;">🎵</span>
        <span>智能排序歌单</span>
      `;

      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleOpenModal();
      };

      actionBar.appendChild(btn);
    }
  }

  showTriggerButton() {
    this.mountActionBarButton();
  }

  updateTriggerButtonStatus() {}
  createTriggerButton() {
    this.mountActionBarButton();
  }

  async handleOpenModal() {
    const playlistId = this.extractPlaylistId();
    if (!playlistId) {
      this.showToast('请先打开任意一个您拥有编辑权限的 Spotify 歌单页面！', 'warning');
      return;
    }

    this.currentPlaylistId = playlistId;
    this.renderModalBase();
    this.showModal(true);

    // Directly load playlist data using API or DOM fallback
    await this.loadPlaylistData();
  }

  getExpectedPlaylistTotal() {
    const textNodes = document.querySelectorAll('span, p, div');
    for (const el of textNodes) {
      if (el.children.length === 0) {
        const text = el.textContent.trim();
        const match = text.match(/([\d,]+)\s*(?:首歌曲|首单曲|首歌|songs|tracks)/i);
        if (match) {
          const num = parseInt(match[1].replace(/,/g, ''), 10);
          if (num > 0 && num < 100000) return num;
        }
      }
    }
    return 0;
  }

  findSpotifyScroller() {
    // 1. Walk up from tracklist row or tracklist container
    const anchor = document.querySelector('[data-testid="tracklist-row"]')
      || document.querySelector('[data-testid="playlist-tracklist"]')
      || document.querySelector('[data-testid="track-list"]')
      || document.querySelector('main');

    if (anchor) {
      let curr = anchor.parentElement;
      while (curr && curr !== document.body && curr !== document.documentElement) {
        const style = window.getComputedStyle(curr);
        const overflowY = style.overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && curr.scrollHeight > curr.clientHeight) {
          return curr;
        }
        curr = curr.parentElement;
      }
    }

    // 2. Specific Spotify main view containers
    const candidates = [
      document.querySelector('.main-view-container__scroll-node [tabindex="-1"]'),
      document.querySelector('.main-view-container__scroll-node'),
      document.querySelector('[data-overlayscrollbars-viewport]'),
      document.querySelector('.os-viewport'),
      document.querySelector('main')?.parentElement,
      document.querySelector('[role="main"]')?.parentElement
    ];
    for (const el of candidates) {
      if (el && el.scrollHeight > el.clientHeight + 50) {
        const style = window.getComputedStyle(el);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') return el;
      }
    }

    // 3. Fallback to scrollable inside main
    const mainArea = document.querySelector('main') || document.querySelector('.main-view-container');
    if (mainArea) {
      const scrollables = mainArea.querySelectorAll('*');
      for (const el of scrollables) {
        if (el.scrollHeight > el.clientHeight + 100) {
          const style = window.getComputedStyle(el);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll') return el;
        }
      }
    }

    return window;
  }

  parseTrackRow(row, tracklistContainer, expectedTotal) {
    const col2 = row.querySelector('[aria-colindex="2"]') || (row.children.length > 1 ? row.children[1] : null);
    if (!col2) return null;

    // 1. Determine EXACT 0-based Row Index
    let rowIndex = -1;
    const col1 = row.querySelector('[aria-colindex="1"]') || (row.children.length > 0 ? row.children[0] : null);

    // Method A: Check Column 1 for track number text
    if (col1) {
      const spans = col1.querySelectorAll('span, div');
      for (const s of spans) {
        const t = s.textContent.trim();
        if (/^\d+$/.test(t)) {
          const n = parseInt(t, 10);
          if (n >= 1 && (expectedTotal === 0 || n <= expectedTotal)) {
            rowIndex = n - 1;
            break;
          }
        }
      }
      if (rowIndex === -1) {
        const m = col1.textContent.trim().match(/^(\d+)$/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n >= 1 && (expectedTotal === 0 || n <= expectedTotal)) {
            rowIndex = n - 1;
          }
        }
      }
    }

    // Method B: Check aria-rowindex
    if (rowIndex === -1) {
      const aria = row.getAttribute('aria-rowindex') || row.querySelector('[aria-rowindex]')?.getAttribute('aria-rowindex');
      if (aria) {
        const n = parseInt(aria, 10);
        const candidate = n >= 2 ? n - 2 : n - 1;
        if (candidate >= 0 && (expectedTotal === 0 || candidate < expectedTotal)) {
          rowIndex = candidate;
        }
      }
    }

    // Method C: Virtual list transform / offsetTop coordinates (Guarantees unique slot calculation)
    if (rowIndex === -1) {
      const transform = row.style.transform || '';
      const transMatch = transform.match(/translateY\((\d+(?:\.\d+)?)px\)/);
      if (transMatch) {
        const y = parseFloat(transMatch[1]);
        rowIndex = Math.round(y / 56);
      } else if (tracklistContainer && tracklistContainer.scrollTop !== undefined) {
        const rowRect = row.getBoundingClientRect();
        const contRect = tracklistContainer.getBoundingClientRect();
        const relTop = rowRect.top - contRect.top + tracklistContainer.scrollTop;
        if (relTop >= 0) {
          rowIndex = Math.round(relTop / 56);
        }
      }
    }

    // Strict boundary checks
    if (rowIndex < 0) return null;
    if (expectedTotal > 0 && rowIndex >= expectedTotal) return null; // Exclude recommended songs below playlist

    let title = '';
    let trackId = null;
    let trackUri = null;
    let artists = [];

    // Check button/row aria-labels (often contains clean "Title by Artist")
    const moreBtn = row.querySelector('button[aria-label*="More options for"], button[aria-label*="更多选项"], button[aria-label*="Play "], button[aria-label*="播放 "]');
    if (moreBtn) {
      const label = moreBtn.getAttribute('aria-label') || '';
      const m1 = label.match(/More options for (.+?) by (.+)/i);
      const m2 = label.match(/(.+?) 的更多选项/);
      const m3 = label.match(/播放 (.+?) 的 (.+)/);
      const m4 = label.match(/Play (.+?) by (.+)/i);
      if (m1) {
        title = m1[1].trim();
        artists = m1[2].split(/,\s*/).map(n => ({ name: n.trim() })).filter(n => n.name);
      } else if (m2) {
        title = m2[1].trim();
      } else if (m3) {
        artists = [{ name: m3[1].trim() }];
        title = m3[2].trim();
      } else if (m4) {
        title = m4[1].trim();
        artists = m4[2].split(/,\s*/).map(n => ({ name: n.trim() })).filter(n => n.name);
      }
    }

    // Playable track link: <a href="/track/...">
    const trackLink = col2.querySelector('a[href*="/track/"]') || row.querySelector('a[href*="/track/"]');
    if (trackLink && trackLink.textContent.trim()) {
      title = trackLink.textContent.trim();
      const idMatch = trackLink.href.match(/track\/([a-zA-Z0-9]+)/);
      if (idMatch) {
        trackId = idMatch[1];
        trackUri = `spotify:track:${trackId}`;
      }
    }

    // Artists from <a> links
    const artistLinks = col2.querySelectorAll('a[href*="/artist/"]');
    if (artistLinks && artistLinks.length > 0) {
      artists = Array.from(artistLinks).map(a => ({ name: a.textContent.trim() })).filter(a => a.name);
    }

    // If title or artists are missing (e.g. region-restricted or unplayable track):
    if (!title || artists.length === 0) {
      const textNodes = [];
      const walker = document.createTreeWalker(col2, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent.trim();
        if (text && !textNodes.includes(text)) {
          textNodes.push(text);
        }
      }

      if (textNodes.length > 0) {
        if (!title) {
          title = textNodes[0];
        }
        if (artists.length === 0 && textNodes.length > 1) {
          const artistText = textNodes[1];
          artists = artistText.split(/,\s*/).map(n => ({ name: n.trim() })).filter(n => n.name);
        }
      }
    }

    // If row is a skeleton or empty loading placeholder, do not record
    if (!title || title === '未知曲目' || title.length === 0) {
      return null;
    }

    if (artists.length === 0) artists = [{ name: '未知歌手' }];

    // Column 3: Album
    let albumName = '';
    const col3 = row.querySelector('[aria-colindex="3"]') || (row.children.length > 2 ? row.children[2] : null);
    if (col3) {
      const albumLink = col3.querySelector('a[href*="/album/"]');
      albumName = albumLink ? albumLink.textContent.trim() : col3.textContent.trim();
    }

    // Track URI fallback
    if (!trackUri) {
      const contextUri = row.getAttribute('data-context-item-uri')
        || row.getAttribute('data-uri')
        || row.querySelector('[data-context-item-uri]')?.getAttribute('data-context-item-uri')
        || row.querySelector('[data-uri]')?.getAttribute('data-uri');
      if (contextUri) {
        trackUri = contextUri;
        trackId = contextUri.replace('spotify:track:', '');
      } else {
        trackId = `dom_${rowIndex}`;
        trackUri = `spotify:track:${trackId}`;
      }
    }

    return {
      index: rowIndex,
      track: {
        id: trackId,
        name: title,
        artists,
        album: { name: albumName || '' },
        uri: trackUri
      }
    };
  }

  async scanAllTracksWithAutoScroll(progressCb) {
    const scroller = this.findSpotifyScroller();
    const expectedTotal = this.getExpectedPlaylistTotal() || 539;
    const tracksMap = new Map();

    const tracklistContainer = document.querySelector('[data-testid="playlist-tracklist"]')
      || document.querySelector('[role="grid"]')
      || document.querySelector('[data-testid="track-list"]')
      || scroller;

    const scanCurrent = () => {
      // ONLY select rows within the playlist tracklist, strictly avoiding recommended songs
      const rows = tracklistContainer.querySelectorAll('[data-testid="tracklist-row"]');
      rows.forEach((row) => {
        const parsed = this.parseTrackRow(row, tracklistContainer, expectedTotal);
        if (parsed && parsed.index >= 0 && (!expectedTotal || parsed.index < expectedTotal)) {
          const existing = tracksMap.get(parsed.index);
          // Prefer entries with real Spotify URIs
          if (!existing || (!parsed.track.uri.startsWith('spotify:track:dom_') && existing.track.uri.startsWith('spotify:track:dom_'))) {
            tracksMap.set(parsed.index, parsed);
          }
        }
      });
    };

    // Phase 1: Smooth sweep from top to bottom
    const initialScrollTop = scroller.scrollTop || 0;
    const viewportHeight = scroller.clientHeight || window.innerHeight || 800;
    const scrollStep = Math.max(300, Math.floor(viewportHeight * 0.65)); // ~450px step ensures overlap
    let currentScroll = 0;

    // Reset to top
    if (scroller.scrollTo) {
      scroller.scrollTo({ top: 0, behavior: 'instant' });
    } else {
      scroller.scrollTop = 0;
    }
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    await new Promise(r => setTimeout(r, 70));
    scanCurrent();

    const maxScroll = Math.max(scroller.scrollHeight || (expectedTotal * 56), 25000);
    let stagnantCount = 0;
    let lastCount = tracksMap.size;
    const maxIterations = 260;
    let iteration = 0;

    while (iteration < maxIterations && (expectedTotal === 0 || tracksMap.size < expectedTotal)) {
      iteration++;
      currentScroll += scrollStep;

      if (scroller.scrollTo) {
        scroller.scrollTo({ top: currentScroll, behavior: 'instant' });
      } else {
        scroller.scrollTop = currentScroll;
      }
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));

      // Wait 95ms for React virtualizer and network chunks to mount
      await new Promise(r => setTimeout(r, 95));

      scanCurrent();

      const count = tracksMap.size;
      const target = expectedTotal || Math.max(count, 539);
      const percent = Math.min(95, Math.round((count / target) * 100));

      if (progressCb) {
        progressCb({ loaded: count, total: target, percent });
      }

      if (count === lastCount) {
        stagnantCount++;
        if (scroller.scrollHeight && (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 60)) {
          await new Promise(r => setTimeout(r, 160));
          scanCurrent();
          break;
        }
        if (stagnantCount >= 20) {
          break;
        }
      } else {
        stagnantCount = 0;
        lastCount = count;
      }
    }

    // Phase 2: Automatic Self-Healing (Targeted backfill for ALL skipped rows)
    if (expectedTotal > 0 && tracksMap.size < expectedTotal) {
      const missingIndices = [];
      for (let i = 0; i < expectedTotal; i++) {
        if (!tracksMap.has(i)) missingIndices.push(i);
      }

      if (missingIndices.length > 0) {
        if (progressCb) {
          progressCb({
            loaded: tracksMap.size,
            total: expectedTotal,
            percent: Math.min(99, Math.round((tracksMap.size / expectedTotal) * 100)),
            status: `正在智能查漏补缺 (${missingIndices.length} 首未读曲目)...`
          });
        }

        // Jump directly to chunks of missing rows
        for (let i = 0; i < missingIndices.length; i += 5) {
          const targetIndex = missingIndices[i];
          const targetScrollY = Math.max(0, targetIndex * 56 - 120);
          if (scroller.scrollTo) {
            scroller.scrollTo({ top: targetScrollY, behavior: 'instant' });
          } else {
            scroller.scrollTop = targetScrollY;
          }
          scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
          await new Promise(r => setTimeout(r, 180));
          scanCurrent();
          if (tracksMap.size >= expectedTotal) break;
        }
      }
    }

    // Reset back to top
    if (scroller.scrollTo) {
      scroller.scrollTo({ top: initialScrollTop, behavior: 'instant' });
    } else {
      scroller.scrollTop = initialScrollTop;
    }
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));

    // Assemble final tracks strictly in 0-based index order
    const finalTracks = [];
    if (expectedTotal > 0) {
      for (let i = 0; i < expectedTotal; i++) {
        if (tracksMap.has(i)) {
          finalTracks.push(tracksMap.get(i));
        }
      }
    }

    // Fallback if expectedTotal was 0
    if (finalTracks.length === 0) {
      return Array.from(tracksMap.values()).sort((a, b) => a.index - b.index);
    }

    // Record scan integrity diagnostics
    this.scanIntegrity = {
      loaded: finalTracks.length,
      expected: expectedTotal,
      missingCount: Math.max(0, expectedTotal - finalTracks.length)
    };

    return finalTracks;
  }

  convertGraphQLItems(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item, idx) => {
      const data = item.itemV2?.data || item.track || {};
      const id = data.id || (data.uri ? data.uri.replace('spotify:track:', '') : `graphql_${idx}`);
      const uri = data.uri || `spotify:track:${id}`;
      const name = data.name || '未知曲目';
      let artists = [];
      if (data.artists?.items && Array.isArray(data.artists.items)) {
        artists = data.artists.items.map(a => ({ name: a.profile?.name || a.name || '' })).filter(a => a.name);
      } else if (data.artists && Array.isArray(data.artists)) {
        artists = data.artists.map(a => ({ name: a.name || '' })).filter(a => a.name);
      }
      if (artists.length === 0) artists = [{ name: '未知歌手' }];
      const albumName = data.albumOfTrack?.name || data.album?.name || '';

      return {
        track: {
          id,
          name,
          artists,
          album: { name: albumName },
          uri
        }
      };
    });
  }

  async loadPlaylistData() {
    this.showLoadingOverlay(true, '正在高速读取歌单全部歌曲...');

    let loadedTracks = null;
    let playlistName = this.currentPlaylistId;

    // Tier 1: Proactively auto-discover native session token from Spotify Web Player
    let token = this.tokenManager.getToken();
    if (!token && typeof this.tokenManager.autoDiscoverSessionToken === 'function') {
      try {
        token = await this.tokenManager.autoDiscoverSessionToken();
      } catch (e) {}
    }

    if (token) {
      try {
        this.updateLoadingProgress('正在读取曲目...请稍候', 15);

        // Fetch playlist metadata
        try {
          const playlist = await this.api.getPlaylist(this.currentPlaylistId, token);
          if (playlist) {
            this.currentPlaylistData = playlist;
            playlistName = playlist.name || playlistName;
          }
        } catch (e) {}

        // Fetch all tracks with 100/page API pagination (instantaneous in memory)
        const tracks = await this.api.getAllPlaylistTracks(
          this.currentPlaylistId,
          token,
          ({ loaded, total, percent }) => {
            this.updateLoadingProgress(`正在读取曲目: ${loaded} / ${total} 首 (${percent}%)`, percent);
          }
        );

        if (tracks && tracks.length > 0) {
          console.log(`[SpotifySorter] 曲目读取成功！共获取 ${tracks.length} 首完整曲目！`);
          loadedTracks = tracks;
        }
      } catch (apiErr) {
        console.warn('[SpotifySorter] 官方直读通道暂不可用，无缝切入智能自愈 DOM 扫描器:', apiErr);
      }
    }

    // Tier 2: Check if bridge intercepted GraphQL items
    if ((!loadedTracks || loadedTracks.length === 0) && this.interceptedPlaylistData) {
      const items = this.interceptedPlaylistData.items;
      const expected = this.getExpectedPlaylistTotal();
      if (items && (items.length >= expected || items.length > 100)) {
        console.log('[SpotifySorter] Using intercepted GraphQL playlist items...');
        loadedTracks = this.convertGraphQLItems(items);
        if (this.interceptedPlaylistData.playlistName) {
          playlistName = this.interceptedPlaylistData.playlistName;
        }
      }
    }

    // Tier 3: Enhanced Smart Virtual DOM Scanner (Self-healing & network-adaptive fallback)
    if (!loadedTracks || loadedTracks.length < (this.getExpectedPlaylistTotal() || 100)) {
      console.log('[SpotifySorter] Running enhanced smart Virtual DOM scanner...');
      const domTracks = await this.scanAllTracksWithAutoScroll(({ loaded, total, percent, status }) => {
        this.updateLoadingProgress(status || `正在读取歌曲: ${loaded} / ${total} 首 (${percent}%)`, percent);
      });

      if (domTracks && domTracks.length > 0) {
        loadedTracks = domTracks;
        const pageTitle = document.title.replace(' | Spotify', '').replace(' - playlist by.*', '').trim() || '我的歌单';
        this.currentPlaylistData = {
          id: this.currentPlaylistId,
          name: pageTitle,
          snapshot_id: 'dom_snapshot'
        };
        playlistName = pageTitle;
      }
    }

    if (loadedTracks && loadedTracks.length > 0) {
      this.rawTracks = loadedTracks;
      const sub = document.getElementById('sp-sorter-subtitle');
      if (sub) {
        sub.innerText = `歌单: ${playlistName} (${loadedTracks.length} 首)`;
      }
      this.recalculateAndRender();
      this.showLoadingOverlay(false);
    } else {
      this.showLoadingOverlay(false);
      this.renderEmptyOrRetryState('未能读取到歌单歌曲。请确认已打开歌单页面，然后点击重试：');
    }
  }

  renderDeduplicationUI() {
    const container = document.getElementById('sp-dup-container');
    if (!container) return;

    const dupGroups = this.duplicateGroups || [];
    const totalDups = dupGroups.reduce((acc, g) => acc + (g.occurrences.length - 1), 0);
    const removedCount = this.removedTrackKeys.size;

    if (totalDups === 0 && removedCount === 0) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    container.style.display = 'block';

    let html = `
      <div class="sp-dup-banner">
        <div class="sp-dup-banner-left">
          <span class="sp-dup-badge">⚠️ 重复歌曲检测</span>
          <span class="sp-dup-info">
            ${totalDups > 0
              ? `检测到歌单中存在 <strong>${totalDups}</strong> 首重复歌曲（共 <strong>${dupGroups.length}</strong> 组）。去重后歌单更清爽！`
              : `✅ 重复歌曲已全部清理完成！当前歌单已无重复曲目。`
            }
            ${removedCount > 0 ? `<span style="color:#1ed760; margin-left:6px; font-weight:600;">(已移除 ${removedCount} 首重复)</span>` : ''}
          </span>
        </div>
        <div class="sp-dup-banner-right">
          ${totalDups > 0 ? `
            <button id="sp-dup-batch-btn" class="sp-dup-btn sp-dup-btn-clean" title="每组仅保留第一首，批量删除其他重复项">
              ⚡ 一键去重 (保留首首)
            </button>
            <button id="sp-dup-toggle-btn" class="sp-dup-btn sp-dup-btn-view">
              ${this.showDuplicateList ? '▲ 收起重复明细' : '▼ 查看/管理重复明细'}
            </button>
          ` : ''}
          ${removedCount > 0 ? `
            <button id="sp-dup-restore-btn" class="sp-dup-btn sp-dup-btn-restore" title="恢复所有被删除的重复歌曲">
              ↺ 撤销去重并恢复 (${removedCount} 首)
            </button>
          ` : ''}
        </div>
      </div>
    `;

    if (this.showDuplicateList && totalDups > 0) {
      html += `
        <div class="sp-dup-list-card">
          <div style="font-size:12px; color:#aaa; margin-bottom:10px;">
            请核对以下重复歌曲，支持针对单首歌曲单独删除或针对整组一键去重：
          </div>
          <div class="sp-dup-groups-grid">
            ${dupGroups.map(g => `
              <div class="sp-dup-group-item">
                <div class="sp-dup-group-header">
                  <div>
                    <strong style="color:#fff; font-size:13px;">🎵 ${this.escapeHtml(g.trackName)}</strong>
                    <span style="color:#aaa; font-size:12px; margin-left:6px;">- ${this.escapeHtml(g.artistName)}</span>
                    <span style="color:#f59e0b; font-size:11px; margin-left:8px; background:rgba(245,158,11,0.15); padding:2px 6px; border-radius:4px;">出现 ${g.occurrences.length} 次</span>
                  </div>
                  <button class="sp-dup-keep-first-btn" data-key="${this.escapeHtml(g.key)}">
                    仅保留首首
                  </button>
                </div>
                <div class="sp-dup-instances">
                  ${g.occurrences.map((occ, oIdx) => {
                    const occUri = occ.uri && !occ.uri.includes('dom_') ? occ.uri : `idx_${occ.originalIndex}`;
                    const isFirst = oIdx === 0;
                    return `
                      <div class="sp-dup-instance-row">
                        <span style="color:#888; width:50px;">#${occ.originalIndex + 1}</span>
                        <span style="flex:1; color:#bbb;">专辑: ${this.escapeHtml(occ.albumName || '单曲/未知')}</span>
                        ${isFirst ? `
                          <span style="color:#1ed760; font-size:11px; font-weight:700; background:rgba(30,215,96,0.15); padding:2px 8px; border-radius:4px;">
                            ✓ 第一首 (默认保留)
                          </span>
                        ` : `
                          <button class="sp-dup-del-single-btn" data-track-key="${this.escapeHtml(occUri)}">
                            🗑️ 删除此首
                          </button>
                        `}
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    container.innerHTML = html;

    // Bind deduplication events
    const batchBtn = document.getElementById('sp-dup-batch-btn');
    if (batchBtn) {
      batchBtn.onclick = () => {
        dupGroups.forEach(g => {
          g.occurrences.slice(1).forEach(occ => {
            const occUri = occ.uri && !occ.uri.includes('dom_') ? occ.uri : `idx_${occ.originalIndex}`;
            this.removedTrackKeys.add(occUri);
          });
        });
        this.showToast(`✅ 已批量清理 ${totalDups} 首重复歌曲！`, 'success');
        this.recalculateAndRender();
      };
    }

    const toggleBtn = document.getElementById('sp-dup-toggle-btn');
    if (toggleBtn) {
      toggleBtn.onclick = () => {
        this.showDuplicateList = !this.showDuplicateList;
        this.renderDeduplicationUI();
      };
    }

    const restoreBtn = document.getElementById('sp-dup-restore-btn');
    if (restoreBtn) {
      restoreBtn.onclick = () => {
        const count = this.removedTrackKeys.size;
        this.removedTrackKeys.clear();
        this.showToast(`↺ 已恢复全部 ${count} 首歌曲！`, 'info');
        this.recalculateAndRender();
      };
    }

    container.querySelectorAll('.sp-dup-del-single-btn').forEach(btn => {
      btn.onclick = () => {
        const k = btn.getAttribute('data-track-key');
        if (k) {
          this.removedTrackKeys.add(k);
          this.showToast('🗑️ 已删除该重复曲目！', 'info');
          this.recalculateAndRender();
        }
      };
    });

    container.querySelectorAll('.sp-dup-keep-first-btn').forEach(btn => {
      btn.onclick = () => {
        const k = btn.getAttribute('data-key');
        const grp = dupGroups.find(g => g.key === k);
        if (grp) {
          grp.occurrences.slice(1).forEach(occ => {
            const occUri = occ.uri && !occ.uri.includes('dom_') ? occ.uri : `idx_${occ.originalIndex}`;
            this.removedTrackKeys.add(occUri);
          });
          this.showToast(`✅ 已去重《${grp.trackName}》！`, 'success');
          this.recalculateAndRender();
        }
      };
    });
  }

  handleExportConfig() {
    const cfg = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      options: { ...this.options }
    };
    const jsonStr = JSON.stringify(cfg, null, 2);

    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spotify-sorter-config-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(jsonStr).catch(() => {});
    }

    this.showToast('✅ 筛选配置已导出为 JSON 文件并已复制到剪贴板！', 'success');
  }

  handleImportConfig() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const parsed = JSON.parse(evt.target.result);
          const opts = parsed.options || parsed;
          if (opts.enableArtistAggregation !== undefined) this.options.enableArtistAggregation = opts.enableArtistAggregation;
          if (opts.artistOrderMode) this.options.artistOrderMode = opts.artistOrderMode;
          if (opts.artistTieBreaker) this.options.artistTieBreaker = opts.artistTieBreaker;
          if (opts.singleTrackStrategy) this.options.singleTrackStrategy = opts.singleTrackStrategy;
          if (opts.intraArtistSort) this.options.intraArtistSort = opts.intraArtistSort;
          if (opts.featAttribution) this.options.featAttribution = opts.featAttribution;
          if (opts.duplicateStrategy) this.options.duplicateStrategy = opts.duplicateStrategy;
          if (opts.ignoreSpecialPrefix !== undefined) this.options.ignoreSpecialPrefix = opts.ignoreSpecialPrefix;
          if (opts.singleTrackSortBy) this.options.singleTrackSortBy = opts.singleTrackSortBy;
          if (opts.enableDiffTracking !== undefined) this.options.enableDiffTracking = opts.enableDiffTracking;

          this.syncFormControlsWithOptions();
          this.recalculateAndRender();
          this.showToast('✅ 排序配置导入成功，已按新规则重新计算！', 'success');
        } catch (err) {
          this.showToast('❌ 配置文件格式无效，请选择正确的 JSON 配置文件！', 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  syncFormControlsWithOptions() {
    const intra = document.getElementById('sp-opt-intra');
    if (intra) intra.value = this.options.intraArtistSort;
    const feat = document.getElementById('sp-opt-feat');
    if (feat) feat.value = this.options.featAttribution;

    // Sync all 10 rule selectors
    const map = {
      'sp-rule-1': String(this.options.enableArtistAggregation !== false),
      'sp-rule-2': this.options.artistOrderMode || 'count_desc',
      'sp-rule-3': this.options.artistTieBreaker || 'pinyin_az',
      'sp-rule-4': this.options.singleTrackStrategy || 'at_the_end_az',
      'sp-rule-5': this.options.intraArtistSort || 'track_name_az',
      'sp-rule-6': this.options.featAttribution || 'most_frequent_in_playlist',
      'sp-rule-7': this.options.duplicateStrategy || 'prompt',
      'sp-rule-8': String(this.options.ignoreSpecialPrefix !== false),
      'sp-rule-9': this.options.singleTrackSortBy || 'artist_az',
      'sp-rule-10': String(this.options.enableDiffTracking !== false)
    };

    for (const [id, val] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (el) el.value = val;
    }
  }

  recalculateAndRender() {
    if (!this.rawTracks || this.rawTracks.length === 0) {
      this.renderEmptyState('歌单内暂无可排序的歌曲');
      return;
    }

    // Filter out user-removed duplicate tracks
    const activeTracks = this.rawTracks.filter((t, idx) => {
      const origIdx = t.index !== undefined ? t.index : idx;
      const uri = (t.track?.uri || t.uri || '').trim();
      const key = uri && !uri.includes('dom_') ? uri : `idx_${origIdx}`;
      return !this.removedTrackKeys.has(key);
    });

    // Detect duplicates in active tracks
    const findDups = this.sorter.findDuplicateTracks || (typeof findDuplicateTracks !== 'undefined' ? findDuplicateTracks : null);
    if (findDups) {
      this.duplicateGroups = findDups(activeTracks);
    } else {
      this.duplicateGroups = [];
    }

    // Run sort algorithm with current options
    this.sortResult = this.sorter.sortPlaylistItems(activeTracks, this.options);

    // Update copy button count
    const copyCountEl = document.getElementById('sp-copy-count');
    if (copyCountEl) {
      copyCountEl.innerText = this.sortResult.sortedItems.length;
    }

    this.renderDeduplicationUI();
    this.renderModalContent();
  }

  renderModalBase() {
    let modal = document.getElementById('sp-sorter-modal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'sp-sorter-modal';
    modal.className = 'sp-sorter-modal-overlay';
    modal.innerHTML = `
      <div class="sp-sorter-modal-container">
        <!-- Header -->
        <div class="sp-sorter-header">
          <div class="sp-sorter-title-area">
            <h2 class="sp-sorter-title">🎵 Spotify 歌单智能重排器</h2>
            <div id="sp-sorter-subtitle" class="sp-sorter-subtitle">正在连接歌单...</div>
          </div>

          <!-- Feature Description Slogan Box (Requirement 1) -->
          <div class="sp-feature-slogan-box">
            <span class="sp-slogan-icon">✨</span>
            <div class="sp-slogan-text">
              <strong>Spotify 歌单整理神器：</strong>全自动同歌手全聚合 · 歌曲数量降序 · A-Z/年份精细重排 · 智能去重 · 一键复制生成新歌单
            </div>
          </div>

          <div class="sp-sorter-header-right">
            <a href="https://github.com/csxo/spotify-playlist-sorter" target="_blank" rel="noopener noreferrer" class="sp-sorter-github-link" title="GitHub 开源主页 (csxo/spotify-playlist-sorter)">
              <svg height="22" width="22" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
              </svg>
            </a>
            <button id="sp-sorter-close-btn" class="sp-sorter-close-btn" title="关闭">&times;</button>
          </div>
        </div>

        <!-- Scan Incomplete Warning Banner (Requirement 1) -->
        <div id="sp-scan-warning-banner" class="sp-scan-warning-banner" style="display: none;"></div>

        <!-- Deduplication Management Panel (Requirement 5) -->
        <div id="sp-dup-container" class="sp-dup-container" style="display: none;"></div>

        <!-- Controls Toolbar -->
        <div class="sp-sorter-toolbar">
          <div class="sp-toolbar-left">
            <div class="sp-sorter-tool-group">
              <label class="sp-sorter-label" for="sp-opt-intra">同一歌手内部：</label>
              <select id="sp-opt-intra" class="sp-sorter-select">
                <option value="track_name_az">🔤 歌曲名 A-Z (中文拼音)</option>
                <option value="album_name_then_track_az">💿 专辑名称 → 歌曲名 A-Z</option>
                <option value="album_date_desc">📅 发行年份由新到旧 (最新优先)</option>
                <option value="album_date_asc">⏳ 发行年份由旧到新 (经典优先)</option>
                <option value="original_order">⏸️ 保持歌单原添加顺序</option>
              </select>
            </div>

            <div class="sp-sorter-tool-group">
              <label class="sp-sorter-label" for="sp-opt-feat">feat. 合作归属：</label>
              <select id="sp-opt-feat" class="sp-sorter-select">
                <option value="most_frequent_in_playlist">🌟 歌单歌曲最多的歌手 (推荐)</option>
                <option value="primary_artist_only">👤 仅按第一主唱歌手</option>
              </select>
            </div>

            <button id="sp-toggle-rules-btn" class="sp-sorter-btn sp-btn-drawer">
              ⚙️ 规则说明与高级筛选
            </button>
          </div>

          <div class="sp-toolbar-right">
            <button id="sp-export-cfg-btn" class="sp-sorter-btn sp-btn-cfg" title="将当前筛选条件导出为 JSON 文件并复制到剪贴板">
              📥 导出配置
            </button>
            <button id="sp-import-cfg-btn" class="sp-sorter-btn sp-btn-cfg" title="导入已有的 JSON 筛选配置文件">
              📤 导入配置
            </button>

            <div class="sp-sorter-tabs">
              <button id="sp-tab-grouped" class="sp-sorter-tab-btn active">歌手分组视图</button>
              <button id="sp-tab-flat" class="sp-sorter-tab-btn">完整重排清单</button>
            </div>
          </div>
        </div>

        <!-- Collapsible Rules & Advanced Filter Drawer (Requirement 4: 10 Rules Selectable/Configurable) -->
        <div id="sp-rules-drawer" class="sp-rules-drawer" style="display: none;">
          <div class="sp-drawer-header">
            <div style="font-weight:700; color:#1ed760; font-size:14px; display:flex; align-items:center; gap:6px;">
              ⚙️ 10 大专业排序规则详解与自由配置面板
            </div>
            <div style="font-size:12px; color:#888;">每个规则均支持自由点选与调整，即选即生效</div>
          </div>

          <div class="sp-rules-grid">
            <!-- 规则 1 -->
            <div class="sp-rule-card">
              <div class="sp-rule-header-row">
                <span class="sp-rule-num">规则 1</span>
                <span class="sp-rule-title">同歌手全聚合</span>
              </div>
              <div class="sp-rule-desc">相同歌手的所有歌曲紧密聚合，告别零散分布。</div>
              <div class="sp-rule-control">
                <select id="sp-rule-1" class="sp-rule-select">
                  <option value="true">✅ 严格歌手聚合 (推荐)</option>
                  <option value="false">❌ 不聚合 (仅单曲全局平铺)</option>
                </select>
              </div>
            </div>

            <!-- 规则 2 -->
            <div class="sp-rule-card">
              <div class="sp-rule-header-row">
                <span class="sp-rule-num">规则 2</span>
                <span class="sp-rule-title">聚合歌手主排序</span>
              </div>
              <div class="sp-rule-desc">歌单中歌手组的排位依据。</div>
              <div class="sp-rule-control">
                <select id="sp-rule-2" class="sp-rule-select">
                  <option value="count_desc">📊 按收录歌曲量由多到少降序 (推荐)</option>
                  <option value="pinyin_az">🔤 按歌手姓名 A-Z (拼音首字母)</option>
                  <option value="original_order">⏱️ 按原歌单中首次出现先后顺序</option>
                </select>
              </div>
            </div>

            <!-- 规则 3 -->
            <div class="sp-rule-card">
              <div class="sp-rule-header-row">
                <span class="sp-rule-num">规则 3</span>
                <span class="sp-rule-title">同量级歌手并列决胜</span>
              </div>
              <div class="sp-rule-desc">多位歌手歌曲数量相同时的次级决胜策略。</div>
              <div class="sp-rule-control">
                <select id="sp-rule-3" class="sp-rule-select">
                  <option value="pinyin_az">🔤 按姓名 A-Z (中文拼音首字母，推荐)</option>
                  <option value="original_appearance">⏱️ 按原歌单首次出场顺序</option>
                </select>
              </div>
            </div>

            <!-- 规则 4 -->
            <div class="sp-rule-card">
              <div class="sp-rule-header-row">
                <span class="sp-rule-num">规则 4</span>
                <span class="sp-rule-title">单曲歌手放置策略</span>
              </div>
              <div class="sp-rule-desc">歌单中仅收录 1 首歌的散客歌手位置。</div>
              <div class="sp-rule-control">
                <select id="sp-rule-4" class="sp-rule-select">
                  <option value="at_the_end_az">📌 统一置底按 A-Z 拼音排序 (推荐)</option>
                  <option value="mix_with_multi">🔀 与多曲歌手混合参与全局降序</option>
                  <option value="at_the_top_az">🔝 统一置顶 (单曲歌手放最前)</option>
                </select>
              </div>
            </div>

            <!-- 规则 5 -->
            <div class="sp-rule-card">
              <div class="sp-rule-header-row">
                <span class="sp-rule-num">规则 5</span>
                <span class="sp-rule-title">同一歌手内细分排序</span>
              </div>
              <div class="sp-rule-desc">同一歌手组内部多首歌曲的排序维度。</div>
              <div class="sp-rule-control">
                <select id="sp-rule-5" class="sp-rule-select">
                  <option value="track_name_az">🔤 歌曲名 A-Z (中文拼音)</option>
                  <option value="album_name_then_track_az">💿 专辑名称 A-Z → 歌曲名 A-Z</option>
                  <option value="album_date_desc">📅 发行年份由新到旧 (最新优先)</option>
                  <option value="album_date_asc">⏳ 发行年份由旧到新 (经典优先)</option>
                  <option value="original_order">⏸️ 保持歌单原添加顺序</option>
                </select>
              </div>
            </div>

            <!-- 规则 6 -->
            <div class="sp-rule-card">
              <div class="sp-rule-header-row">
                <span class="sp-rule-num">规则 6</span>
                <span class="sp-rule-title">feat. 合作曲目归属</span>
              </div>
              <div class="sp-rule-desc">多艺人合唱/合作曲目归属哪位歌手名下。</div>
              <div class="sp-rule-control">
                <select id="sp-rule-6" class="sp-rule-select">
                  <option value="most_frequent_in_playlist">🌟 归属歌单歌曲最多的歌手 (推荐)</option>
                  <option value="primary_artist_only">👤 严格按第一主唱歌手归属</option>
                </select>
              </div>
            </div>

            <!-- 规则 7 -->
            <div class="sp-rule-card">
              <div class="sp-rule-header-row">
                <span class="sp-rule-num">规则 7</span>
                <span class="sp-rule-title">重复歌曲处理策略</span>
              </div>
              <div class="sp-rule-desc">原歌单中存在相同歌曲时的处理方式。</div>
              <div class="sp-rule-control">
                <select id="sp-rule-7" class="sp-rule-select">
                  <option value="prompt">⚠️ 智能提示并支持手动/一键去重 (推荐)</option>
                  <option value="auto_remove">⚡ 自动移除所有重复歌曲 (仅留首份)</option>
                  <option value="keep_all">📦 保留所有重复曲目 (分配独立槽位)</option>
                </select>
              </div>
            </div>

            <!-- 规则 8 -->
            <div class="sp-rule-card">
              <div class="sp-rule-header-row">
                <span class="sp-rule-num">规则 8</span>
                <span class="sp-rule-title">特殊符号与标点处理</span>
              </div>
              <div class="sp-rule-desc">歌名/歌手名前缀特殊标点符号的处理。</div>
              <div class="sp-rule-control">
                <select id="sp-rule-8" class="sp-rule-select">
                  <option value="true">🔤 忽略特殊前导符号参与拼音 A-Z 比较 (推荐)</option>
                  <option value="false">🔡 严格按 ASCII 字符原始顺序排序</option>
                </select>
              </div>
            </div>

            <!-- 规则 9 -->
            <div class="sp-rule-card">
              <div class="sp-rule-header-row">
                <span class="sp-rule-num">规则 9</span>
                <span class="sp-rule-title">单曲歌手内部排序依据</span>
              </div>
              <div class="sp-rule-desc">末尾单曲歌手集合内部以什么为主键排序。</div>
              <div class="sp-rule-control">
                <select id="sp-rule-9" class="sp-rule-select">
                  <option value="artist_az">👤 按歌手姓名 A-Z 拼音排序 (推荐)</option>
                  <option value="track_az">🎵 按歌曲名称 A-Z 拼音排序</option>
                </select>
              </div>
            </div>

            <!-- 规则 10 -->
            <div class="sp-rule-card">
              <div class="sp-rule-header-row">
                <span class="sp-rule-num">规则 10</span>
                <span class="sp-rule-title">位移追踪与分析模式</span>
              </div>
              <div class="sp-rule-desc">是否计算每首歌曲从原位置到新位置的位移。</div>
              <div class="sp-rule-control">
                <select id="sp-rule-10" class="sp-rule-select">
                  <option value="true">📈 启用位移追踪分析与变动统计 (推荐)</option>
                  <option value="false">⚡ 极速模式 (不追踪位移)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <!-- Analytics Summary -->
        <div id="sp-sorter-summary-bar" class="sp-sorter-summary-bar"></div>

        <!-- Main Content Area -->
        <div id="sp-sorter-content-area" class="sp-sorter-content-area">
          <div class="sp-sorter-empty">正在加载...</div>
        </div>

        <!-- Footer Actions (Requirement 3: Clean footer with single copy button) -->
        <div class="sp-sorter-footer">
          <div class="sp-sorter-footer-left">
            <span class="sp-sorter-guard-tip">
              🛡️ 零凭证 · 纯本地智能重排 · 完美保护原歌单安全可靠
            </span>
          </div>

          <div class="sp-sorter-footer-right">
            <button id="sp-cancel-btn" class="sp-sorter-btn sp-sorter-btn-cancel">关闭</button>
            <button id="sp-copy-clipboard-btn" class="sp-sorter-btn sp-sorter-btn-primary" style="background:#1ed760; color:#000; font-weight:700; padding:10px 24px; border-radius:500px; display:inline-flex; align-items:center; gap:8px; cursor:pointer; font-size:14px;" title="一键复制排好序的全部歌曲链接，到 Spotify 桌面端直接 Ctrl+V 粘贴为新歌单">
              📋 复制排序结果 (<span id="sp-copy-count">0</span> 首)
            </button>
          </div>
        </div>

        <!-- Loading / Progress Overlay with Cancel Button -->
        <div id="sp-sorter-loading-overlay" class="sp-sorter-loading-overlay" style="display: none;">
          <div class="sp-sorter-spinner"></div>
          <div id="sp-sorter-loading-text" class="sp-sorter-loading-text">正在处理...</div>
          <div class="sp-sorter-progress-bar-container">
            <div id="sp-sorter-progress-bar" class="sp-sorter-progress-bar"></div>
          </div>
          <button id="sp-cancel-loading-btn" class="sp-sorter-cancel-loading-btn">取消并返回</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Bind events
    document.getElementById('sp-sorter-close-btn').onclick = () => this.closeModal();
    document.getElementById('sp-cancel-btn').onclick = () => this.closeModal();
    document.getElementById('sp-copy-clipboard-btn').onclick = () => this.handleCopyClipboardFlow();
    document.getElementById('sp-cancel-loading-btn').onclick = () => {
      this.showLoadingOverlay(false);
      this.renderLoadError(new Error('用户主动取消了加载请求。'));
    };

    // Quick toolbar options
    document.getElementById('sp-opt-intra').onchange = (e) => {
      this.options.intraArtistSort = e.target.value;
      const r5 = document.getElementById('sp-rule-5');
      if (r5) r5.value = e.target.value;
      this.recalculateAndRender();
    };

    document.getElementById('sp-opt-feat').onchange = (e) => {
      this.options.featAttribution = e.target.value;
      const r6 = document.getElementById('sp-rule-6');
      if (r6) r6.value = e.target.value;
      this.recalculateAndRender();
    };

    // 10 Interactive rule drawer selects
    for (let r = 1; r <= 10; r++) {
      const el = document.getElementById(`sp-rule-${r}`);
      if (el) {
        el.onchange = (e) => {
          const val = e.target.value;
          if (r === 1) this.options.enableArtistAggregation = val === 'true';
          if (r === 2) this.options.artistOrderMode = val;
          if (r === 3) this.options.artistTieBreaker = val;
          if (r === 4) this.options.singleTrackStrategy = val;
          if (r === 5) {
            this.options.intraArtistSort = val;
            const q = document.getElementById('sp-opt-intra');
            if (q) q.value = val;
          }
          if (r === 6) {
            this.options.featAttribution = val;
            const q = document.getElementById('sp-opt-feat');
            if (q) q.value = val;
          }
          if (r === 7) this.options.duplicateStrategy = val;
          if (r === 8) this.options.ignoreSpecialPrefix = val === 'true';
          if (r === 9) this.options.singleTrackSortBy = val;
          if (r === 10) this.options.enableDiffTracking = val === 'true';

          this.recalculateAndRender();
        };
      }
    }

    document.getElementById('sp-toggle-rules-btn').onclick = () => {
      this.showRulesDrawer = !this.showRulesDrawer;
      const drawer = document.getElementById('sp-rules-drawer');
      const btn = document.getElementById('sp-toggle-rules-btn');
      if (drawer) drawer.style.display = this.showRulesDrawer ? 'block' : 'none';
      if (btn) btn.classList.toggle('active', this.showRulesDrawer);
    };

    document.getElementById('sp-export-cfg-btn').onclick = () => this.handleExportConfig();
    document.getElementById('sp-import-cfg-btn').onclick = () => this.handleImportConfig();

    document.getElementById('sp-tab-grouped').onclick = () => {
      this.activeTab = 'grouped';
      this.updateTabStyles();
      this.renderTabBody();
    };

    document.getElementById('sp-tab-flat').onclick = () => {
      this.activeTab = 'flat';
      this.updateTabStyles();
      this.renderTabBody();
    };
  }



  renderLoadError(err) {
    const container = document.getElementById('sp-sorter-content-area');
    if (!container) return;

    const errMsg = err.message || String(err);

    container.innerHTML = `
      <div class="sp-error-card">
        <div class="sp-error-icon">⚠️</div>
        <h3 class="sp-error-title">无法读取歌单曲目</h3>
        <p class="sp-error-desc">${this.escapeHtml(errMsg)}</p>

        <div class="sp-diag-box">
          <div class="sp-diag-item"><strong>目标歌单 ID：</strong><code>${this.currentPlaylistId}</code></div>
          <div class="sp-diag-item"><strong>运行环境：</strong>${typeof GM_xmlhttpRequest !== 'undefined' ? '脚本模式 (Violentmonkey/Tampermonkey)' : 'Chrome 扩展模式'}</div>
        </div>

        <div class="sp-error-actions">
          <button id="sp-err-retry-btn" class="sp-sorter-btn sp-sorter-btn-primary" style="background:#1db954; color:#000; font-weight:700; padding:10px 24px; border-radius:500px;">🔄 重新读取歌曲</button>
        </div>

        <div class="sp-error-tips" style="margin-top:20px; text-align:left;">
          <h4>💡 排查与解决指引：</h4>
          <ol style="margin:8px 0 0 0; padding-left:18px; line-height:1.8; color:#bbb; font-size:13px;">
            <li><strong>刷新重试</strong>：按键盘 <code>F5</code> 刷新整个网页后，再次点击「🎵 智能排序歌单」；</li>
            <li><strong>网络代理设置</strong>：若您在国内使用代理，请确认您的代理规则覆盖了 <code>api.spotify.com</code>。</li>
          </ol>
        </div>
      </div>
    `;

    document.getElementById('sp-err-retry-btn').onclick = () => this.loadPlaylistData();
  }

  renderEmptyOrRetryState(tipMessage) {
    const container = document.getElementById('sp-sorter-content-area');
    if (!container) return;

    container.innerHTML = `
      <div class="sp-error-card">
        <div class="sp-error-icon">🎵</div>
        <h3 class="sp-error-title">未能读取到歌单歌曲</h3>
        <p class="sp-error-desc">${this.escapeHtml(tipMessage)}</p>

        <div class="sp-error-actions">
          <button id="sp-empty-retry-btn" class="sp-sorter-btn sp-sorter-btn-primary" style="background:#1db954; color:#000; font-weight:700; padding:10px 24px; border-radius:500px;">🔄 重新尝试读取</button>
        </div>

        <div class="sp-error-tips" style="margin-top:20px; text-align:left;">
          <h4>💡 快速提示：</h4>
          <ol style="margin:8px 0 0 0; padding-left:18px; line-height:1.8; color:#bbb; font-size:13px;">
            <li>请确认当前打开的是您的歌单详情页面；</li>
            <li>请在 Spotify 网页列表中上下滚动一下，让歌曲列表渲染出来，然后点击上方的「重新尝试读取」；</li>
            <li>按 <code>F5</code> 刷新整个网页也是一个快速生效的解决方法。</li>
          </ol>
        </div>
      </div>
    `;

    document.getElementById('sp-empty-retry-btn').onclick = () => this.loadPlaylistData();
  }

  updateTabStyles() {
    const tabGrouped = document.getElementById('sp-tab-grouped');
    const tabFlat = document.getElementById('sp-tab-flat');
    if (tabGrouped && tabFlat) {
      tabGrouped.className = `sp-sorter-tab-btn ${this.activeTab === 'grouped' ? 'active' : ''}`;
      tabFlat.className = `sp-sorter-tab-btn ${this.activeTab === 'flat' ? 'active' : ''}`;
    }
  }

  updateUndoButtonState() {
    const undoBtn = document.getElementById('sp-undo-btn');
    if (!undoBtn) return;

    const hasUndo = this.history.hasUndo(this.currentPlaylistId);
    undoBtn.disabled = !hasUndo;
    if (hasUndo) {
      const latest = this.history.getLatestHistory(this.currentPlaylistId);
      const timeStr = new Date(latest.timestamp).toLocaleTimeString();
      undoBtn.innerHTML = `↩️ 撤销排序 (恢复 ${timeStr} 快照)`;
      undoBtn.classList.remove('disabled');
    } else {
      undoBtn.innerHTML = `↩️ 撤销上次排序 (暂无快照)`;
      undoBtn.classList.add('disabled');
    }
  }

  handleCopyClipboardFlow() {
    if (!this.sortResult || !this.sortResult.sortedItems || this.sortResult.sortedItems.length === 0) {
      this.showToast('歌单尚未加载或暂无可排序歌曲', 'warning');
      return;
    }

    const items = this.sortResult.sortedItems;
    const urls = items.map(item => {
      // 1. If valid Spotify URI exists
      const uri = item.trackUri || (item.track && item.track.uri);
      if (uri && uri.startsWith('spotify:track:') && !uri.includes('dom_')) {
        return uri;
      }
      // 2. If valid Spotify Track ID exists
      const id = item.trackId || (item.track && item.track.id);
      if (id && !id.startsWith('dom_')) {
        return `spotify:track:${id}`;
      }
      // 3. Fallback to https track link if possible
      if (id && !id.startsWith('dom_')) {
        return `https://open.spotify.com/track/${id}`;
      }
      // 4. Plain text title - artist
      const title = item.trackName || (item.track && item.track.name) || '未知曲目';
      const artist = item.assignedArtist?.name || (item.artists && item.artists[0]?.name) || '';
      return `${title} - ${artist}`;
    }).filter(Boolean).join('\n');

    const copySuccess = () => {
      this.showToast(`✅ 已复制全部 ${items.length} 首歌曲！去 Spotify 粘贴即可`, 'success');
      this.showClipboardSuccessModal(items.length);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(urls).then(copySuccess).catch(() => {
        this.fallbackCopy(urls);
        copySuccess();
      });
    } else {
      this.fallbackCopy(urls);
      copySuccess();
    }
  }

  fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }

  showClipboardSuccessModal(count) {
    let overlay = document.getElementById('sp-clipboard-modal');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'sp-clipboard-modal';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:9999999; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(6px); font-family:system-ui,sans-serif;';
    overlay.innerHTML = `
      <div style="background:#181818; border:1px solid #333; border-radius:12px; padding:28px; width:480px; max-width:90%; color:#fff; text-align:center; box-shadow:0 12px 36px rgba(0,0,0,0.7);">
        <div style="font-size:40px; margin-bottom:12px;">🎉</div>
        <h3 style="margin:0 0 10px 0; color:#1ed760; font-size:20px; font-weight:700;">已成功复制全部 ${count} 首排好序的歌曲！</h3>
        <p style="color:#aaa; font-size:13px; margin:0 0 16px 0;">全自动 · 零配置 · 完美应用 10 大重排规则</p>
        
        <div style="background:#222; border-radius:8px; padding:16px; text-align:left; font-size:13px; line-height:1.9; color:#eee; border:1px solid #2a2a2a; margin-bottom:20px;">
          <div style="font-weight:700; color:#1ed760; margin-bottom:6px;">📋 仅需最后 2 步，粘贴回 Spotify 客户端：</div>
          <div>1. 打开 <strong>Spotify 桌面客户端</strong>，点击左侧边栏的 <strong>「＋ 新建歌单」</strong>（例如命名为 <code>智能排序歌单</code>）；</div>
          <div>2. 点进新建的歌单页面，直接按键盘快捷键 <strong>Ctrl + V</strong> 粘贴！</div>
          <div style="color:#888; font-size:12px; margin-top:6px;">💡 技巧：也可以直接在已有歌单按 <strong>Ctrl+A</strong> 全选、按 <strong>Delete</strong> 清空后按 <strong>Ctrl+V</strong> 粘贴覆盖！</div>
        </div>

        <button id="sp-close-clip-modal-btn" style="background:#1ed760; color:#000; font-weight:700; border:none; border-radius:500px; padding:10px 32px; font-size:14px; cursor:pointer;">
          我知道了，去 Spotify 粘贴！
        </button>
      </div>
    `;

    document.body.appendChild(overlay);
    document.getElementById('sp-close-clip-modal-btn').onclick = () => overlay.remove();
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };
  }

  renderModalContent() {
    if (!this.sortResult || !this.currentPlaylistData) return;

    // Update subtitle
    const sub = document.getElementById('sp-sorter-subtitle');
    if (sub) {
      const snap = (this.currentPlaylistData.snapshot_id || '').substring(0, 10);
      sub.innerHTML = `歌单：<strong>${this.escapeHtml(this.currentPlaylistData.name)}</strong> · Snapshot: <code>${snap}...</code>`;
    }

    // Update Summary Bar
    const summaryBar = document.getElementById('sp-sorter-summary-bar');
    const { stats } = this.sortResult;
    const moveRate = stats.total > 0 ? Math.round((stats.changedCount / stats.total) * 100) : 0;

    summaryBar.innerHTML = `
      <div class="sp-stat-card">
        <div class="sp-stat-value">${stats.total}</div>
        <div class="sp-stat-label">总曲目数</div>
      </div>
      <div class="sp-stat-card">
        <div class="sp-stat-value">${stats.multiArtistCount} 位</div>
        <div class="sp-stat-label">多曲聚合歌手</div>
      </div>
      <div class="sp-stat-card">
        <div class="sp-stat-value">${stats.singleArtistCount} 位</div>
        <div class="sp-stat-label">单曲歌手 (末尾 A-Z)</div>
      </div>
      <div class="sp-stat-card">
        <div class="sp-stat-value" style="color: ${stats.changedCount > 0 ? '#1db954' : '#fff'};">
          ${stats.changedCount} <span style="font-size:12px; font-weight:normal;">(${moveRate}%)</span>
        </div>
        <div class="sp-stat-label">位置将调整</div>
      </div>
    `;

    // Update apply count
    const applyCount = document.getElementById('sp-apply-count');
    if (applyCount) applyCount.innerText = stats.total;

    this.renderTabBody();
    this.updateUndoButtonState();
  }

  renderTabBody() {
    const container = document.getElementById('sp-sorter-content-area');
    if (!container || !this.sortResult) return;

    if (this.activeTab === 'grouped') {
      this.renderGroupedView(container);
    } else {
      this.renderFlatView(container);
    }
  }

  renderGroupedView(container) {
    const { multiTrackGroups, singleTrackGroups } = this.sortResult;
    const totalTracks = this.sortResult.stats.total;

    // 1. Visual Distribution Bar (Top Artists)
    const topArtists = multiTrackGroups.slice(0, 12);
    const maxTrackCount = topArtists[0]?.items?.length || 1;

    let vizCards = topArtists.map((g, idx) => {
      const rank = idx + 1;
      const rankBadge = rank === 1 ? '🥇' : (rank === 2 ? '🥈' : (rank === 3 ? '🥉' : `#${rank}`));
      const pct = totalTracks > 0 ? ((g.items.length / totalTracks) * 100).toFixed(1) : 0;
      const barWidth = Math.max(15, Math.round((g.items.length / maxTrackCount) * 100));
      const isActive = this.selectedArtistFilter === g.artistName;

      return `
        <div class="sp-viz-pill ${isActive ? 'active' : ''}" data-artist="${this.escapeHtml(g.artistName)}" title="点击仅查看 ${this.escapeHtml(g.artistName)} 的所有歌曲 (${g.items.length} 首)">
          <div class="sp-viz-fill" style="width: ${barWidth}%;"></div>
          <div class="sp-viz-content">
            <span class="sp-viz-rank">${rankBadge}</span>
            <span class="sp-viz-name">${this.escapeHtml(g.artistName)}</span>
            <span class="sp-viz-count">${g.items.length}首 <small>(${pct}%)</small></span>
          </div>
        </div>
      `;
    }).join('');

    // 2. Filter & Search Controls
    const isFiltered = !!this.selectedArtistFilter || !!this.artistSearchQuery;
    let filterLabel = '';
    if (this.selectedArtistFilter) {
      if (this.selectedArtistFilter === '__top10') filterLabel = 'Top 10 歌手';
      else if (this.selectedArtistFilter === '__gte5') filterLabel = '5首及以上歌手';
      else if (this.selectedArtistFilter === '__2to4') filterLabel = '2-4首歌手';
      else if (this.selectedArtistFilter === '__single') filterLabel = '单曲歌手';
      else filterLabel = this.selectedArtistFilter;
    } else if (this.artistSearchQuery) {
      filterLabel = `"${this.artistSearchQuery}"`;
    }

    // Filter groups based on search / selected artist
    let displayMulti = multiTrackGroups;
    let displaySingle = singleTrackGroups;

    if (this.selectedArtistFilter) {
      if (this.selectedArtistFilter === '__top10') {
        displayMulti = multiTrackGroups.slice(0, 10);
        displaySingle = [];
      } else if (this.selectedArtistFilter === '__gte5') {
        displayMulti = multiTrackGroups.filter(g => g.items.length >= 5);
        displaySingle = [];
      } else if (this.selectedArtistFilter === '__2to4') {
        displayMulti = multiTrackGroups.filter(g => g.items.length >= 2 && g.items.length <= 4);
        displaySingle = [];
      } else if (this.selectedArtistFilter === '__single') {
        displayMulti = [];
        displaySingle = singleTrackGroups;
      } else {
        const filterName = this.selectedArtistFilter.toLowerCase();
        displayMulti = multiTrackGroups.filter(g => g.artistName.toLowerCase() === filterName);
        displaySingle = singleTrackGroups.filter(g => g.artistName.toLowerCase() === filterName);
      }
    } else if (this.artistSearchQuery) {
      const q = this.artistSearchQuery.toLowerCase();
      displayMulti = multiTrackGroups.filter(g => g.artistName.toLowerCase().includes(q) || g.items.some(it => it.trackName.toLowerCase().includes(q)));
      displaySingle = singleTrackGroups.filter(g => g.artistName.toLowerCase().includes(q) || g.items.some(it => it.trackName.toLowerCase().includes(q)));
    }

    let groupsHtml = '';
    if (displayMulti.length > 0) {
      groupsHtml += `<div class="sp-section-heading">🔥 聚合歌手组 (${displayMulti.length} 位 · 歌曲数降序排列)</div>`;
      for (const group of displayMulti) {
        groupsHtml += this.renderGroupCard(group, false);
      }
    }

    if (displaySingle.length > 0) {
      groupsHtml += `<div class="sp-section-heading" style="margin-top: 20px;">🎵 单曲歌手组 (${displaySingle.length} 位 · 统一汇总于歌单末尾，按歌手 A-Z 拼音排序)</div>`;
      for (const group of displaySingle) {
        groupsHtml += this.renderGroupCard(group, true);
      }
    }

    if (displayMulti.length === 0 && displaySingle.length === 0) {
      groupsHtml = `<div class="sp-sorter-empty" style="padding:40px 20px;">未找到匹配的歌手或歌曲。<br><button id="sp-clear-filter-empty-btn" class="sp-sorter-btn sp-sorter-btn-secondary" style="margin-top:14px;">✖️ 显示全部歌手</button></div>`;
    }

    container.innerHTML = `
      <div class="sp-viz-container">
        <div class="sp-viz-header">
          <div class="sp-viz-title">📊 歌手歌曲数量分布与占比可视化 (共 ${multiTrackGroups.length} 位聚合歌手)</div>
          ${isFiltered ? `<button id="sp-clear-filter-btn" class="sp-filter-clear-btn">✖️ 清除筛选 (显示全部)</button>` : ''}
        </div>
        <div class="sp-viz-grid">
          ${vizCards}
        </div>

        <div class="sp-filter-toolbar">
          <div class="sp-search-box">
            <span class="sp-search-icon">🔍</span>
            <input id="sp-artist-search-input" type="text" placeholder="输入歌手姓名或歌名快速筛选..." value="${this.escapeHtml(this.artistSearchQuery)}" />
            ${this.artistSearchQuery ? `<button id="sp-search-clear-btn" class="sp-search-clear">&times;</button>` : ''}
          </div>
          <div class="sp-filter-tags">
            <button class="sp-tag-btn ${!this.selectedArtistFilter && !this.artistSearchQuery ? 'active' : ''}" data-tag="all">全部 (${multiTrackGroups.length + singleTrackGroups.length}位)</button>
            <button class="sp-tag-btn ${this.selectedArtistFilter === '__top10' ? 'active' : ''}" data-tag="top10">🔥 Top 10 巨头</button>
            <button class="sp-tag-btn ${this.selectedArtistFilter === '__gte5' ? 'active' : ''}" data-tag="gte5">✨ 5首及以上</button>
            <button class="sp-tag-btn ${this.selectedArtistFilter === '__2to4' ? 'active' : ''}" data-tag="2to4">🎵 2-4首</button>
            <button class="sp-tag-btn ${this.selectedArtistFilter === '__single' ? 'active' : ''}" data-tag="single">👤 单曲歌手 (${singleTrackGroups.length}位)</button>
          </div>
        </div>

        ${isFiltered ? `<div class="sp-active-filter-bar">📌 当前筛选：<strong>${this.escapeHtml(filterLabel)}</strong> (共展示 ${displayMulti.length + displaySingle.length} 位歌手)</div>` : ''}
      </div>

      <div class="sp-grouped-list">
        ${groupsHtml}
      </div>
    `;

    // Bind Visualizer and Filter Events
    container.querySelectorAll('.sp-viz-pill').forEach(pill => {
      pill.onclick = () => {
        const art = pill.getAttribute('data-artist');
        if (this.selectedArtistFilter === art) {
          this.selectedArtistFilter = null;
        } else {
          this.selectedArtistFilter = art;
          this.artistSearchQuery = '';
        }
        this.renderGroupedView(container);
      };
    });

    const clearBtn = container.querySelector('#sp-clear-filter-btn');
    if (clearBtn) {
      clearBtn.onclick = () => {
        this.selectedArtistFilter = null;
        this.artistSearchQuery = '';
        this.renderGroupedView(container);
      };
    }

    const clearEmptyBtn = container.querySelector('#sp-clear-filter-empty-btn');
    if (clearEmptyBtn) {
      clearEmptyBtn.onclick = () => {
        this.selectedArtistFilter = null;
        this.artistSearchQuery = '';
        this.renderGroupedView(container);
      };
    }

    const searchInput = container.querySelector('#sp-artist-search-input');
    if (searchInput) {
      searchInput.oninput = (e) => {
        this.artistSearchQuery = e.target.value.trim();
        this.selectedArtistFilter = null;
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => this.renderGroupedView(container), 200);
      };
    }

    const searchClear = container.querySelector('#sp-search-clear-btn');
    if (searchClear) {
      searchClear.onclick = () => {
        this.artistSearchQuery = '';
        this.renderGroupedView(container);
      };
    }

    container.querySelectorAll('.sp-tag-btn').forEach(btn => {
      btn.onclick = () => {
        const tag = btn.getAttribute('data-tag');
        this.artistSearchQuery = '';
        if (tag === 'all') this.selectedArtistFilter = null;
        else if (tag === 'top10') this.selectedArtistFilter = '__top10';
        else if (tag === 'gte5') this.selectedArtistFilter = '__gte5';
        else if (tag === '2to4') this.selectedArtistFilter = '__2to4';
        else if (tag === 'single') this.selectedArtistFilter = '__single';
        this.renderGroupedView(container);
      };
    });
  }

  renderGroupCard(group, isSingle) {
    const count = group.items.length;
    const badge = isSingle
      ? `<span class="sp-badge sp-badge-single">单曲歌手</span>`
      : `<span class="sp-badge sp-badge-multi">${count} 首歌曲</span>`;

    const rows = group.items.map((item, idx) => {
      const diffItem = this.sortResult.diff.find(d => d.item === item);
      const newIdx = diffItem ? diffItem.newIndex + 1 : idx + 1;
      const oldIdx = item.originalIndex + 1;

      let shiftBadge = '';
      if (newIdx === oldIdx) {
        shiftBadge = `<span class="sp-shift sp-shift-same">= 保持</span>`;
      } else if (newIdx < oldIdx) {
        shiftBadge = `<span class="sp-shift sp-shift-up">↑ 前移 ${oldIdx - newIdx}</span>`;
      } else {
        shiftBadge = `<span class="sp-shift sp-shift-down">↓ 后移 ${newIdx - oldIdx}</span>`;
      }

      const allArtists = item.artists.map(a => a.name).join(', ');
      const featTag = item.artists.length > 1
        ? `<span class="sp-feat-tag" title="合作/feat. 歌曲：${allArtists}">feat.</span>`
        : '';

      return `
        <div class="sp-track-row">
          <div class="sp-col-pos">#${newIdx} <span class="sp-old-pos">(原 #${oldIdx})</span></div>
          <div class="sp-col-shift">${shiftBadge}</div>
          <div class="sp-col-name">
            <span class="sp-track-title">${this.escapeHtml(item.trackName)}</span>
            ${featTag}
          </div>
          <div class="sp-col-artist" title="${this.escapeHtml(allArtists)}">${this.escapeHtml(allArtists)}</div>
          <div class="sp-col-album">${this.escapeHtml(item.album.name || '-')}</div>
        </div>
      `;
    }).join('');

    return `
      <details class="sp-group-card" open>
        <summary class="sp-group-summary">
          <span class="sp-group-name">🎤 ${this.escapeHtml(group.artistName)}</span>
          ${badge}
        </summary>
        <div class="sp-group-body">
          ${rows}
        </div>
      </details>
    `;
  }

  renderFlatView(container) {
    const { diff } = this.sortResult;

    const rows = diff.map(d => {
      const newIdx = d.newIndex + 1;
      const oldIdx = d.originalIndex + 1;

      let shiftBadge = '';
      if (newIdx === oldIdx) {
        shiftBadge = `<span class="sp-shift sp-shift-same">= 保持</span>`;
      } else if (newIdx < oldIdx) {
        shiftBadge = `<span class="sp-shift sp-shift-up">↑ 前移 ${oldIdx - newIdx}</span>`;
      } else {
        shiftBadge = `<span class="sp-shift sp-shift-down">↓ 后移 ${newIdx - oldIdx}</span>`;
      }

      return `
        <tr class="sp-table-row ${d.isMoved ? 'row-moved' : ''}">
          <td class="sp-td-num">#${newIdx}</td>
          <td>${shiftBadge}</td>
          <td class="sp-td-orig">#${oldIdx}</td>
          <td class="sp-td-title"><strong>${this.escapeHtml(d.trackName)}</strong></td>
          <td>${this.escapeHtml(d.assignedArtistName)}</td>
          <td class="sp-td-artists">${this.escapeHtml(d.artistsText)}</td>
          <td>${this.escapeHtml(d.albumName)}</td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <table class="sp-flat-table">
        <thead>
          <tr>
            <th style="width: 60px;">新位置</th>
            <th style="width: 100px;">位移变动</th>
            <th style="width: 60px;">原位置</th>
            <th>歌曲名称</th>
            <th>归属歌手</th>
            <th>参与艺人</th>
            <th>专辑</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  }

  renderEmptyState(msg) {
    const container = document.getElementById('sp-sorter-content-area');
    if (container) {
      container.innerHTML = `<div class="sp-sorter-empty">${this.escapeHtml(msg)}</div>`;
    }
  }

  showModal(show) {
    this.isOpen = show;
    const modal = document.getElementById('sp-sorter-modal');
    if (modal) {
      modal.style.display = show ? 'flex' : 'none';
    }
  }

  closeModal() {
    this.showModal(false);
  }

  showLoadingOverlay(show, text = '正在处理...') {
    const overlay = document.getElementById('sp-sorter-loading-overlay');
    const label = document.getElementById('sp-sorter-loading-text');
    const bar = document.getElementById('sp-sorter-progress-bar');
    if (overlay) {
      overlay.style.display = show ? 'flex' : 'none';
      if (label) label.innerText = text;
      if (bar) bar.style.width = '0%';
    }
  }

  updateLoadingProgress(text, percent) {
    const label = document.getElementById('sp-sorter-loading-text');
    const bar = document.getElementById('sp-sorter-progress-bar');
    if (label) label.innerText = text;
    if (bar) bar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `sp-sorter-toast sp-toast-${type}`;
    toast.innerText = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 400);
    }, 4000);
  }

  async handleConfirmSort() {
    if (!this.sortResult || !this.currentPlaylistId) return;

    const token = this.tokenManager.getToken();
    const isOfficial = this.tokenManager.isOfficialToken(token);

    if (!isOfficial) {
      this.handleCopyClipboardFlow();
      return;
    }

    const { sortedItems, stats } = this.sortResult;
    const sortedUris = sortedItems.map(i => i.trackUri).filter(Boolean);

    if (sortedUris.length !== sortedItems.length) {
      this.showToast('检测到部分曲目 URI 异常，操作已终止。', 'error');
      return;
    }

    const confirmMsg = `确认将当前歌单内 ${stats.total} 首歌曲按照选定规则重新排序？\n\n` +
      `• 变动歌曲：${stats.changedCount} 首\n` +
      `• 排序前原顺序将自动备份，支持一键 Undo 撤销。`;

    if (!window.confirm(confirmMsg)) {
      return;
    }

    const expectedSnapshotId = this.currentPlaylistData.snapshot_id;

    // 1. Save Undo Snapshot (Rule 10)
    const originalUris = this.rawTracks.map(item => item.track?.uri || item.uri).filter(Boolean);
    this.history.pushHistory({
      playlistId: this.currentPlaylistId,
      playlistName: this.currentPlaylistData.name,
      snapshotIdBefore: expectedSnapshotId,
      originalUris,
      originalItems: sortedItems,
      optionsUsed: { ...this.options }
    });

    this.showLoadingOverlay(true, '正在安全写入 Spotify 歌单 (快照校验中)...');

    try {
      // 2. Perform safe writeback with snapshot_id guard (Rule 9)
      const res = await this.api.updatePlaylistTracks(
        this.currentPlaylistId,
        expectedSnapshotId,
        sortedUris,
        token,
        ({ message, percent }) => {
          this.updateLoadingProgress(message, percent);
        }
      );

      this.showLoadingOverlay(false);
      this.showToast(`🎉 歌单重排成功！已成功写回 ${res.totalUpdated} 首歌曲。`, 'success');

      this.currentPlaylistData.snapshot_id = res.snapshotId;
      this.updateUndoButtonState();

      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('spotify-sorter-updated', { detail: { playlistId: this.currentPlaylistId } }));
      }, 500);

    } catch (err) {
      this.showLoadingOverlay(false);
      this.showToast(`写回失败: ${err.message}`, 'error');
      console.error('[SpotifySorter]', err);
    }
  }

  async handleUndo() {
    const record = this.history.getLatestHistory(this.currentPlaylistId);
    if (!record) {
      this.showToast('未找到该歌单的历史备份快照。', 'warning');
      return;
    }

    const dateStr = new Date(record.timestamp).toLocaleString();
    const confirmMsg = `是否确认将歌单恢复至 [${dateStr}] 排序前的原状态？\n\n共 ${record.originalUris.length} 首歌曲将被恢复至原顺序。`;

    if (!window.confirm(confirmMsg)) {
      return;
    }

    const token = this.tokenManager.getToken();
    this.showLoadingOverlay(true, '正在恢复排序前状态...');

    try {
      const currentInfo = await this.api.getPlaylist(this.currentPlaylistId, token);

      await this.api.updatePlaylistTracks(
        this.currentPlaylistId,
        currentInfo.snapshot_id,
        record.originalUris,
        token,
        ({ message, percent }) => {
          this.updateLoadingProgress(`正在恢复原顺序: ${message}`, percent);
        }
      );

      this.history.popHistory(this.currentPlaylistId);
      this.showLoadingOverlay(false);
      this.showToast('✅ 撤销成功！歌单已完整恢复至排序前状态。', 'success');

      await this.loadPlaylistData();
    } catch (err) {
      this.showLoadingOverlay(false);
      this.showToast(`撤销失败: ${err.message}`, 'error');
      console.error('[SpotifySorter]', err);
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  injectStyles() {
    if (document.getElementById('sp-sorter-styles')) return;

    const style = document.createElement('style');
    style.id = 'sp-sorter-styles';
    style.textContent = `
      /* Floating Action Button */
      .sp-sorter-fab {
        position: fixed;
        bottom: 30px;
        right: 32px;
        z-index: 999999;
        display: none;
        align-items: center;
        gap: 8px;
        background: #121212;
        color: #ffffff;
        border: 1.5px solid #1db954;
        border-radius: 9999px;
        padding: 10px 18px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6), 0 0 12px rgba(29, 185, 84, 0.4);
        transition: all 0.25s cubic-bezier(0.3, 0, 0, 1);
        user-select: none;
      }
      .sp-sorter-fab:hover {
        transform: translateY(-2px) scale(1.03);
        background: #1db954;
        color: #000000;
        box-shadow: 0 12px 28px rgba(29, 185, 84, 0.6);
      }
      .sp-sorter-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background-color: #e2b340;
        box-shadow: 0 0 6px currentColor;
      }

      /* Modal Overlay */
      .sp-sorter-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        z-index: 1000000;
        background: rgba(0, 0, 0, 0.78);
        backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
        color: #ffffff;
      }
      .sp-sorter-modal-container {
        position: relative;
        width: 92vw;
        max-width: 1100px;
        height: 88vh;
        max-height: 850px;
        background: #181818;
        border: 1px solid #282828;
        border-radius: 14px;
        display: flex;
        flex-direction: column;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.85);
        overflow: hidden;
      }

      /* Header */
      .sp-sorter-header {
        position: relative;
        z-index: 30;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 18px 24px;
        background: #202020;
        border-bottom: 1px solid #2e2e2e;
      }
      .sp-sorter-title {
        margin: 0;
        font-size: 20px;
        font-weight: 700;
        color: #1db954;
      }
      .sp-sorter-subtitle {
        margin-top: 4px;
        font-size: 13px;
        color: #b3b3b3;
      }
      .sp-sorter-subtitle code {
        background: #2a2a2a;
        padding: 2px 6px;
        border-radius: 4px;
        color: #1db954;
      }
      .sp-sorter-header-right {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .sp-sorter-github-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #b3b3b3;
        transition: color 0.2s, transform 0.2s;
        text-decoration: none;
      }
      .sp-sorter-github-link:hover {
        color: #ffffff;
        transform: scale(1.1);
      }
      .sp-sorter-close-btn {
        background: none;
        border: none;
        color: #b3b3b3;
        font-size: 28px;
        cursor: pointer;
        line-height: 1;
        transition: color 0.2s;
      }
      .sp-sorter-close-btn:hover {
        color: #ffffff;
      }

      /* Toolbar */
      .sp-sorter-toolbar {
        display: flex;
        align-items: center;
        gap: 20px;
        padding: 14px 24px;
        background: #141414;
        border-bottom: 1px solid #262626;
        flex-wrap: wrap;
      }
      .sp-sorter-tool-group {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .sp-sorter-label {
        font-size: 13px;
        color: #a7a7a7;
        font-weight: 500;
      }
      .sp-sorter-select {
        background: #2a2a2a;
        color: #ffffff;
        border: 1px solid #404040;
        border-radius: 6px;
        padding: 6px 12px;
        font-size: 13px;
        outline: none;
        cursor: pointer;
        transition: border-color 0.2s;
      }
      .sp-sorter-select:hover, .sp-sorter-select:focus {
        border-color: #1db954;
      }
      .sp-sorter-tabs {
        margin-left: auto;
        display: flex;
        background: #222222;
        border-radius: 8px;
        padding: 3px;
      }
      .sp-sorter-tab-btn {
        background: transparent;
        border: none;
        color: #b3b3b3;
        padding: 6px 16px;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }
      .sp-sorter-tab-btn.active {
        background: #333333;
        color: #1db954;
      }

      /* Summary Bar */
      .sp-sorter-summary-bar {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        padding: 12px 24px;
        background: #1c1c1c;
        border-bottom: 1px solid #282828;
      }
      .sp-stat-card {
        background: #242424;
        padding: 10px 14px;
        border-radius: 8px;
        text-align: center;
        border: 1px solid #303030;
      }
      .sp-stat-value {
        font-size: 18px;
        font-weight: 700;
        color: #ffffff;
      }
      .sp-stat-label {
        font-size: 12px;
        color: #a7a7a7;
        margin-top: 2px;
      }

      /* Content Area */
      .sp-sorter-content-area {
        flex: 1;
        overflow-y: auto;
        padding: 20px 24px;
        background: #121212;
      }
      .sp-sorter-empty {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 200px;
        color: #777777;
        font-size: 15px;
      }

      /* Error Card */
      .sp-error-card {
        max-width: 650px;
        margin: 30px auto;
        background: #1e1e1e;
        border: 1.5px solid #e91429;
        border-radius: 12px;
        padding: 28px;
        text-align: center;
        box-shadow: 0 12px 32px rgba(233, 20, 41, 0.15);
      }
      .sp-error-icon {
        font-size: 40px;
        margin-bottom: 12px;
      }
      .sp-error-title {
        font-size: 18px;
        color: #ff5566;
        margin: 0 0 10px 0;
      }
      .sp-error-desc {
        color: #e0e0e0;
        font-size: 14px;
        line-height: 1.6;
        margin-bottom: 18px;
        white-space: pre-wrap;
      }
      .sp-diag-box {
        background: #141414;
        border: 1px solid #333333;
        border-radius: 8px;
        padding: 12px 16px;
        text-align: left;
        font-size: 12px;
        margin-bottom: 20px;
      }
      .sp-diag-item {
        margin-bottom: 6px;
        color: #b3b3b3;
      }
      .sp-diag-item:last-child {
        margin-bottom: 0;
      }
      .sp-diag-item code {
        background: #252525;
        padding: 2px 6px;
        border-radius: 4px;
        color: #1db954;
      }
      .sp-error-actions {
        display: flex;
        justify-content: center;
        gap: 14px;
        margin-bottom: 20px;
      }
      .sp-error-tips {
        border-top: 1px solid #2a2a2a;
        padding-top: 16px;
        text-align: left;
        font-size: 13px;
        color: #999999;
      }
      .sp-error-tips h4 {
        margin: 0 0 8px 0;
        color: #ffffff;
      }
      .sp-error-tips ol {
        margin: 0;
        padding-left: 20px;
        line-height: 1.6;
      }

      /* Section Heading */
      .sp-section-heading {
        font-size: 13px;
        font-weight: 700;
        color: #1db954;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 10px;
      }

      /* Group Card */
      .sp-group-card {
        background: #1e1e1e;
        border: 1px solid #2c2c2c;
        border-radius: 8px;
        margin-bottom: 10px;
        overflow: hidden;
      }
      .sp-group-summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 18px;
        cursor: pointer;
        background: #222222;
        font-size: 14px;
        font-weight: 600;
        user-select: none;
        transition: background 0.15s;
      }
      .sp-group-summary:hover {
        background: #292929;
      }
      .sp-group-name {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #ffffff;
      }
      .sp-badge {
        font-size: 11px;
        padding: 3px 8px;
        border-radius: 12px;
        font-weight: 700;
      }
      .sp-badge-multi {
        background: rgba(29, 185, 84, 0.18);
        color: #1db954;
        border: 1px solid rgba(29, 185, 84, 0.35);
      }
      .sp-badge-single {
        background: #333333;
        color: #a7a7a7;
      }
      .sp-group-body {
        padding: 4px 0;
      }

      /* Track Row */
      .sp-track-row {
        display: flex;
        align-items: center;
        padding: 8px 18px;
        border-bottom: 1px solid #252525;
        font-size: 13px;
        gap: 14px;
        transition: background 0.15s;
      }
      .sp-track-row:last-child {
        border-bottom: none;
      }
      .sp-track-row:hover {
        background: #252525;
      }
      .sp-col-pos {
        width: 105px;
        font-weight: 700;
        color: #ffffff;
      }
      .sp-old-pos {
        font-size: 11px;
        font-weight: normal;
        color: #777777;
      }
      .sp-col-shift {
        width: 95px;
      }
      .sp-shift {
        font-size: 11px;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 4px;
        display: inline-block;
      }
      .sp-shift-up {
        background: rgba(29, 185, 84, 0.18);
        color: #1db954;
      }
      .sp-shift-down {
        background: rgba(245, 158, 11, 0.18);
        color: #f59e0b;
      }
      .sp-shift-same {
        background: #2e2e2e;
        color: #777777;
      }
      .sp-col-name {
        flex: 2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .sp-track-title {
        color: #ffffff;
        font-weight: 500;
      }
      .sp-feat-tag {
        font-size: 10px;
        background: #333333;
        color: #1db954;
        padding: 1px 4px;
        border-radius: 3px;
      }
      .sp-col-artist {
        flex: 1.5;
        color: #a7a7a7;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sp-col-album {
        flex: 1.5;
        color: #777777;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Flat Table */
      .sp-flat-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      .sp-flat-table th {
        text-align: left;
        padding: 10px 12px;
        background: #1c1c1c;
        color: #a7a7a7;
        font-weight: 600;
        border-bottom: 1px solid #333333;
        position: sticky;
        top: 0;
        z-index: 10;
      }
      .sp-flat-table td {
        padding: 9px 12px;
        border-bottom: 1px solid #222222;
        color: #dddddd;
      }
      .sp-table-row:hover td {
        background: #222222;
      }
      .sp-td-num {
        font-weight: 700;
        color: #1db954;
      }
      .sp-td-orig {
        color: #777777;
      }

      /* Footer */
      .sp-sorter-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 24px;
        background: #1c1c1c;
        border-top: 1px solid #2a2a2a;
      }
      .sp-sorter-footer-left {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .sp-sorter-guard-tip {
        font-size: 12px;
        color: #888888;
      }
      .sp-sorter-footer-right {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .sp-sorter-btn {
        padding: 10px 20px;
        border-radius: 9999px;
        font-size: 14px;
        font-weight: 700;
        border: none;
        cursor: pointer;
        transition: all 0.2s;
      }
      .sp-sorter-btn-primary {
        background: #1db954;
        color: #000000;
      }
      .sp-sorter-btn-primary:hover {
        background: #1ed760;
        transform: scale(1.02);
      }
      .sp-sorter-btn-secondary {
        background: #2a2a2a;
        color: #ffffff;
        border: 1px solid #3e3e3e;
      }
      .sp-sorter-btn-secondary:hover:not(:disabled) {
        background: #383838;
      }
      .sp-sorter-btn-secondary.disabled, .sp-sorter-btn-secondary:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .sp-sorter-btn-cancel {
        background: transparent;
        color: #b3b3b3;
      }
      .sp-sorter-btn-cancel:hover {
        color: #ffffff;
      }

      /* Loading Overlay */
      .sp-sorter-loading-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(18, 18, 18, 0.92);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 25;
      }
      .sp-sorter-spinner {
        width: 44px;
        height: 44px;
        border: 4px solid #2e2e2e;
        border-top-color: #1db954;
        border-radius: 50%;
        animation: sp-spin 0.8s linear infinite;
      }
      @keyframes sp-spin {
        to { transform: rotate(360deg); }
      }
      .sp-sorter-loading-text {
        margin-top: 18px;
        font-size: 15px;
        font-weight: 600;
        color: #ffffff;
      }
      .sp-sorter-progress-bar-container {
        width: 320px;
        height: 6px;
        background: #2c2c2c;
        border-radius: 3px;
        margin-top: 14px;
        overflow: hidden;
      }
      .sp-sorter-progress-bar {
        width: 0%;
        height: 100%;
        background: #1db954;
        transition: width 0.25s ease-out;
      }
      .sp-sorter-cancel-loading-btn {
        margin-top: 20px;
        background: #2a2a2a;
        color: #b3b3b3;
        border: 1px solid #444;
        border-radius: 20px;
        padding: 6px 16px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .sp-sorter-cancel-loading-btn:hover {
        background: #383838;
        color: #ffffff;
      }

      /* Toast Notification */
      .sp-sorter-toast {
        position: fixed;
        top: 24px;
        right: 24px;
        z-index: 1000001;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        color: #ffffff;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        animation: sp-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .sp-sorter-toast.sp-toast-success {
        background: #1db954;
        color: #000000;
      }
      .sp-sorter-toast.sp-toast-error {
        background: #e91429;
      }
      .sp-sorter-toast.sp-toast-warning {
        background: #f59e0b;
        color: #000000;
      }
      .sp-sorter-toast.sp-toast-info {
        background: #2e77d0;
      }
      .sp-sorter-toast.fade-out {
        opacity: 0;
        transform: translateY(-10px);
        transition: all 0.3s;
      }
      /* AI Taste Roast Card (Requirement 5) */
      .sp-taste-box {
        flex: 1;
        max-width: 580px;
        margin: 0 16px;
        background: #181818;
        border: 1px solid #333333;
        border-radius: 8px;
        padding: 8px 14px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      }
      .sp-taste-badge-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 4px;
      }
      .sp-taste-badge {
        font-size: 11px;
        font-weight: 700;
        color: #ff5252;
        background: rgba(255, 82, 82, 0.15);
        padding: 2px 8px;
        border-radius: 4px;
        letter-spacing: 0.5px;
      }
      .sp-taste-reroll-btn {
        background: #2a2a2a;
        color: #1ed760;
        border: 1px solid #383838;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 600;
        padding: 2px 10px;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .sp-taste-reroll-btn:hover {
        background: #333333;
        color: #ffffff;
        transform: scale(1.03);
      }
      .sp-taste-text {
        font-size: 12px;
        color: #dddddd;
        line-height: 1.5;
        font-style: italic;
        display: block;
      }

      /* Toolbar layout & Buttons */
      .sp-toolbar-left {
        display: flex;
        align-items: center;
        gap: 14px;
        flex-wrap: wrap;
      }
      .sp-toolbar-right {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .sp-btn-drawer {
        background: #2a2a2a;
        color: #1ed760;
        border: 1px solid #383838;
        border-radius: 6px;
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }
      .sp-btn-drawer:hover, .sp-btn-drawer.active {
        background: #333333;
        border-color: #1ed760;
      }
      .sp-btn-cfg {
        background: #222222;
        color: #cccccc;
        border: 1px solid #333333;
        border-radius: 6px;
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
      }
      .sp-btn-cfg:hover {
        background: #2e2e2e;
        color: #ffffff;
      }

      /* Spotify Action Bar Injected Button (Requirement 2) */
      .sp-action-bar-sorter-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
        border: 1px solid rgba(255, 255, 255, 0.2);
        padding: 8px 18px;
        border-radius: 500px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        margin-left: 16px;
        height: 38px;
        box-sizing: border-box;
        font-family: inherit;
        white-space: nowrap;
        user-select: none;
      }
      .sp-action-bar-sorter-btn:hover {
        background: #1ed760;
        color: #000000;
        border-color: #1ed760;
        transform: scale(1.04);
        box-shadow: 0 4px 16px rgba(30, 215, 96, 0.4);
      }
      .sp-action-bar-sorter-btn:active {
        transform: scale(0.98);
      }

      /* Feature Description Slogan Box (Requirement 1) */
      .sp-feature-slogan-box {
        display: flex;
        align-items: center;
        gap: 10px;
        background: rgba(30, 215, 96, 0.08);
        border: 1px solid rgba(30, 215, 96, 0.25);
        border-radius: 8px;
        padding: 8px 16px;
        max-width: 580px;
      }
      .sp-slogan-icon {
        font-size: 18px;
        flex-shrink: 0;
      }
      .sp-slogan-text {
        font-size: 12px;
        color: #d1d5db;
        line-height: 1.4;
      }
      .sp-slogan-text strong {
        color: #1ed760;
      }

      /* Deduplication Manager (Requirement 5) */
      .sp-dup-container {
        border-bottom: 1px solid #282828;
      }
      .sp-dup-banner {
        background: #231908;
        border-bottom: 1px solid #543a0e;
        color: #f59e0b;
        padding: 10px 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 13px;
        gap: 12px;
        flex-wrap: wrap;
      }
      .sp-dup-banner-left {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .sp-dup-badge {
        font-size: 11px;
        font-weight: 700;
        background: rgba(245, 158, 11, 0.2);
        border: 1px solid rgba(245, 158, 11, 0.4);
        padding: 2px 8px;
        border-radius: 4px;
      }
      .sp-dup-banner-right {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .sp-dup-btn {
        padding: 5px 14px;
        border-radius: 500px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s;
        border: none;
      }
      .sp-dup-btn-clean {
        background: #f59e0b;
        color: #000000;
      }
      .sp-dup-btn-clean:hover {
        background: #fbbf24;
      }
      .sp-dup-btn-view {
        background: #33230a;
        color: #f59e0b;
        border: 1px solid #78480e;
      }
      .sp-dup-btn-view:hover {
        background: #452f0e;
      }
      .sp-dup-btn-restore {
        background: #2a2a2a;
        color: #1ed760;
        border: 1px solid #3e3e3e;
      }
      .sp-dup-btn-restore:hover {
        background: #333333;
      }
      .sp-dup-list-card {
        background: #18140c;
        padding: 14px 24px;
        max-height: 280px;
        overflow-y: auto;
      }
      .sp-dup-groups-grid {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .sp-dup-group-item {
        background: #201a11;
        border: 1px solid #382c16;
        border-radius: 8px;
        padding: 10px 14px;
      }
      .sp-dup-group-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .sp-dup-keep-first-btn {
        background: #2d2414;
        color: #f59e0b;
        border: 1px solid #543a0e;
        border-radius: 4px;
        padding: 3px 8px;
        font-size: 11px;
        cursor: pointer;
      }
      .sp-dup-keep-first-btn:hover {
        background: #f59e0b;
        color: #000000;
      }
      .sp-dup-instances {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .sp-dup-instance-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 4px 8px;
        background: #19140d;
        border-radius: 4px;
        font-size: 12px;
      }
      .sp-dup-del-single-btn {
        background: #3a1c1c;
        color: #f87171;
        border: 1px solid #5c2828;
        border-radius: 4px;
        padding: 2px 8px;
        font-size: 11px;
        cursor: pointer;
      }
      .sp-dup-del-single-btn:hover {
        background: #dc2626;
        color: #ffffff;
      }

      /* Collapsible Rules & Config Drawer (Requirement 4) */
      .sp-rules-drawer {
        background: #141414;
        border-bottom: 1px solid #282828;
        padding: 16px 24px;
        max-height: 420px;
        overflow-y: auto;
      }
      .sp-drawer-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 14px;
        padding-bottom: 8px;
        border-bottom: 1px solid #242424;
      }
      .sp-rules-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 12px;
      }
      .sp-rule-card {
        background: #1c1c1c;
        border: 1px solid #2d2d2d;
        border-radius: 8px;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 8px;
      }
      .sp-rule-header-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .sp-rule-num {
        font-size: 11px;
        font-weight: 700;
        color: #1ed760;
        background: rgba(30, 215, 96, 0.12);
        padding: 2px 6px;
        border-radius: 4px;
        text-transform: uppercase;
      }
      .sp-rule-title {
        font-size: 13px;
        font-weight: 700;
        color: #ffffff;
      }
      .sp-rule-desc {
        font-size: 11px;
        color: #888888;
        line-height: 1.4;
      }
      .sp-rule-control {
        margin-top: 4px;
      }
      .sp-rule-select {
        width: 100%;
        background: #111111;
        color: #ffffff;
        border: 1px solid #3d3d3d;
        border-radius: 6px;
        padding: 6px 8px;
        font-size: 12px;
        outline: none;
        cursor: pointer;
        transition: border-color 0.2s;
      }
      .sp-rule-select:hover, .sp-rule-select:focus {
        border-color: #1ed760;
      }

      /* Visualizer Section (Requirement 4) */
      .sp-viz-container {
        padding: 14px 20px;
        background: #161616;
        border-bottom: 1px solid #242424;
      }
      .sp-viz-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      .sp-viz-title {
        font-size: 13px;
        font-weight: 700;
        color: #1ed760;
      }
      .sp-filter-clear-btn {
        background: #2a2a2a;
        color: #ff5252;
        border: 1px solid #444;
        border-radius: 4px;
        padding: 3px 10px;
        font-size: 11px;
        cursor: pointer;
      }
      .sp-filter-clear-btn:hover {
        background: #333;
      }
      .sp-viz-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 12px;
      }
      .sp-viz-pill {
        position: relative;
        background: #222222;
        border: 1px solid #333333;
        border-radius: 6px;
        overflow: hidden;
        cursor: pointer;
        user-select: none;
        transition: transform 0.15s, border-color 0.15s;
        flex: 1 1 calc(20% - 8px);
        min-width: 140px;
        max-width: 220px;
      }
      .sp-viz-pill:hover {
        transform: translateY(-1px);
        border-color: #1ed760;
      }
      .sp-viz-pill.active {
        border-color: #1ed760;
        box-shadow: 0 0 8px rgba(30, 215, 96, 0.4);
      }
      .sp-viz-fill {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        background: rgba(30, 215, 96, 0.18);
        pointer-events: none;
      }
      .sp-viz-content {
        position: relative;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 10px;
        font-size: 12px;
      }
      .sp-viz-rank {
        font-size: 12px;
        margin-right: 4px;
      }
      .sp-viz-name {
        font-weight: 600;
        color: #ffffff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 80px;
      }
      .sp-viz-count {
        color: #1ed760;
        font-weight: 700;
        font-size: 11px;
      }
      .sp-viz-count small {
        color: #888888;
        font-weight: normal;
      }

      /* Filter Toolbar */
      .sp-filter-toolbar {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }
      .sp-search-box {
        position: relative;
        display: flex;
        align-items: center;
        background: #121212;
        border: 1px solid #333333;
        border-radius: 6px;
        padding: 4px 8px;
        min-width: 220px;
      }
      .sp-search-icon {
        font-size: 12px;
        color: #777;
        margin-right: 6px;
      }
      .sp-search-box input {
        background: transparent;
        border: none;
        outline: none;
        color: #ffffff;
        font-size: 12px;
        width: 100%;
      }
      .sp-search-clear {
        background: none;
        border: none;
        color: #888;
        font-size: 14px;
        cursor: pointer;
        padding: 0 4px;
      }
      .sp-filter-tags {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .sp-tag-btn {
        background: #202020;
        border: 1px solid #333333;
        color: #aaaaaa;
        border-radius: 20px;
        padding: 4px 12px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.15s;
      }
      .sp-tag-btn:hover {
        background: #2c2c2c;
        color: #ffffff;
      }
      .sp-tag-btn.active {
        background: #1ed760;
        color: #000000;
        border-color: #1ed760;
        font-weight: 700;
      }
      .sp-active-filter-bar {
        margin-top: 8px;
        font-size: 12px;
        color: #1ed760;
        background: rgba(30, 215, 96, 0.08);
        padding: 6px 12px;
        border-radius: 4px;
        border: 1px solid rgba(30, 215, 96, 0.2);
      }
      .sp-scan-warning-banner {
        background: #2b1d07;
        border-bottom: 1px solid #78480e;
        color: #f59e0b;
        padding: 10px 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 13px;
        gap: 12px;
      }
      .sp-btn-warning {
        background: #f59e0b;
        color: #000000;
        border: none;
        border-radius: 4px;
        padding: 5px 12px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }

      @keyframes sp-slide-in {
        from { transform: translateY(-20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;

    const target = document.head || document.documentElement || document.body;
    if (target) {
      target.appendChild(style);
    } else {
      setTimeout(() => this.injectStyles(), 100);
    }
  }
}

  // --- 7. Application Initialization ---
  try {
    const app = new SpotifySorterUI({
      tokenManager: tokenManagerInstance,
      api: spotifyApiClientInstance,
      sorter: { sortPlaylistItems, standardizePlaylistItem },
      history: historyManagerInstance
    });
    window.__spotifySorterApp = app;
    console.log('[SpotifySorter] Ready!');
  } catch (err) {
    console.error('[SpotifySorter] Initialization error:', err);
  }
})();
