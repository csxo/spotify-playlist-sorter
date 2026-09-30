/**
 * sorter.js
 * Core Spotify Playlist sorting & deduplication engine adhering strictly to all 10 rules.
 */

const { compareStrings } = (typeof module !== 'undefined' && module.exports)
  ? require('./comparator')
  : (window.SpotifyPlaylistSorterCompartor || {});

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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sortPlaylistItems,
    standardizePlaylistItem,
    findDuplicateTracks
  };
}
