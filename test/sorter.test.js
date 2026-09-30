/**
 * sorter.test.js
 * Comprehensive unit test suite verifying all 10 core requirements.
 */

const assert = require('assert');
const { sortPlaylistItems } = require('../src/sorter');
const { compareStrings, getSortKeyInitial } = require('../src/comparator');

console.log('--- Starting Sorter & Comparator Tests ---');

// Test 1: Pinyin & Comparator
console.log('Testing Test 1: Chinese Pinyin & Alphabetical comparator...');
assert.strictEqual(getSortKeyInitial('晴天'), 'Q');
assert.strictEqual(getSortKeyInitial('周杰伦'), 'Z');
assert.strictEqual(getSortKeyInitial('爱在西元前'), 'A');
assert.strictEqual(getSortKeyInitial('Apple'), 'A');
assert.strictEqual(getSortKeyInitial('Beat It'), 'B');
assert.strictEqual(getSortKeyInitial('123'), '0-9');

// Compare order
const sampleTitles = ['晴天', '爱在西元前', '东风破', '安静', '黑色幽默', '七里香'];
sampleTitles.sort(compareStrings);
// Expected: 爱在西元前 (A), 安静 (A), 东风破 (D), 黑色幽默 (H), 七里香 (Q), 晴天 (Q)
assert.deepStrictEqual(sampleTitles, ['爱在西元前', '安静', '东风破', '黑色幽默', '七里香', '晴天']);
console.log('✓ Test 1 Passed!');

// Test 2: Artist Aggregation & Track Count Descending (Rule 1 & Rule 2)
console.log('Testing Test 2: Artist aggregation & track count descending...');
const samplePlaylist = [
  { track: { id: 't1', name: 'Song 1', artists: [{ id: 'art_b', name: 'Artist B' }], album: { name: 'Alb B' } } },
  { track: { id: 't2', name: 'Song 2', artists: [{ id: 'art_a', name: 'Artist A' }], album: { name: 'Alb A' } } },
  { track: { id: 't3', name: 'Song 3', artists: [{ id: 'art_a', name: 'Artist A' }], album: { name: 'Alb A' } } },
  { track: { id: 't4', name: 'Song 4', artists: [{ id: 'art_a', name: 'Artist A' }], album: { name: 'Alb A' } } },
  { track: { id: 't5', name: 'Song 5', artists: [{ id: 'art_b', name: 'Artist B' }], album: { name: 'Alb B' } } }
];

const res2 = sortPlaylistItems(samplePlaylist);
assert.strictEqual(res2.sortedItems.length, 5);
// Artist A has 3 tracks, Artist B has 2 tracks -> Artist A comes before Artist B!
assert.strictEqual(res2.sortedItems[0].assignedArtist.name, 'Artist A');
assert.strictEqual(res2.sortedItems[1].assignedArtist.name, 'Artist A');
assert.strictEqual(res2.sortedItems[2].assignedArtist.name, 'Artist A');
assert.strictEqual(res2.sortedItems[3].assignedArtist.name, 'Artist B');
assert.strictEqual(res2.sortedItems[4].assignedArtist.name, 'Artist B');
console.log('✓ Test 2 Passed!');

// Test 3: Intra-artist sort options (Rule 3)
console.log('Testing Test 3: Intra-artist sorting (Track Name vs Album Name)...');
const artistSongs = [
  { track: { id: '1', name: 'Zeta', artists: [{ id: 'a', name: 'Artist' }], album: { name: 'Alpha Album' } } },
  { track: { id: '2', name: 'Alpha', artists: [{ id: 'a', name: 'Artist' }], album: { name: 'Beta Album' } } },
  { track: { id: '3', name: 'Beta', artists: [{ id: 'a', name: 'Artist' }], album: { name: 'Alpha Album' } } }
];

const resTrackNameAZ = sortPlaylistItems(artistSongs, { intraArtistSort: 'track_name_az' });
assert.deepStrictEqual(resTrackNameAZ.sortedItems.map(t => t.trackName), ['Alpha', 'Beta', 'Zeta']);

const resAlbumNameAZ = sortPlaylistItems(artistSongs, { intraArtistSort: 'album_name_then_track_az' });
// Alpha Album (Beta, Zeta), Beta Album (Alpha)
assert.deepStrictEqual(resAlbumNameAZ.sortedItems.map(t => t.trackName), ['Beta', 'Zeta', 'Alpha']);
console.log('✓ Test 3 Passed!');

// Test 4: Single-track Artists at the end sorted by Artist Name A-Z (Rule 4)
console.log('Testing Test 4: Single-track artists moved to the end and sorted A-Z...');
const mixPlaylist = [
  { track: { id: 'm1', name: 'Song M1', artists: [{ id: 'art_jay', name: '周杰伦' }], album: { name: 'Alb 1' } } },
  { track: { id: 'm2', name: 'Song M2', artists: [{ id: 'art_jay', name: '周杰伦' }], album: { name: 'Alb 1' } } },
  { track: { id: 's1', name: 'Song S1', artists: [{ id: 'art_z', name: 'Zoe' }], album: { name: 'Alb Z' } } },
  { track: { id: 's2', name: 'Song S2', artists: [{ id: 'art_a', name: 'Adele' }], album: { name: 'Alb A' } } },
  { track: { id: 's3', name: 'Song S3', artists: [{ id: 'art_c', name: '陈奕迅' }], album: { name: 'Alb C' } } }
];

const res4 = sortPlaylistItems(mixPlaylist);
// Jay Chou has 2 tracks -> Multi-track group first!
assert.strictEqual(res4.sortedItems[0].assignedArtist.name, '周杰伦');
assert.strictEqual(res4.sortedItems[1].assignedArtist.name, '周杰伦');
// Remaining single-track artists: Adele ('A'), 陈奕迅 ('C'), Zoe ('Z')
assert.strictEqual(res4.sortedItems[2].assignedArtist.name, 'Adele');
assert.strictEqual(res4.sortedItems[3].assignedArtist.name, '陈奕迅');
assert.strictEqual(res4.sortedItems[4].assignedArtist.name, 'Zoe');
console.log('✓ Test 4 Passed!');

// Test 5: Feat / Collaboration attribution (Rule 5)
console.log('Testing Test 5: Feat / collaboration attribution...');
const featPlaylist = [
  { track: { id: 'f1', name: 'Solo 1', artists: [{ id: 'art_jay', name: '周杰伦' }], album: { name: 'Alb' } } },
  { track: { id: 'f2', name: 'Solo 2', artists: [{ id: 'art_jay', name: '周杰伦' }], album: { name: 'Alb' } } },
  { track: { id: 'f3', name: 'Solo 3', artists: [{ id: 'art_jay', name: '周杰伦' }], album: { name: 'Alb' } } },
  { track: { id: 'f4', name: 'Collab Song', artists: [{ id: 'guest', name: 'Guest Singer' }, { id: 'art_jay', name: '周杰伦' }], album: { name: 'Alb' } } }
];

const res5 = sortPlaylistItems(featPlaylist, { featAttribution: 'most_frequent_in_playlist' });
// Because 周杰伦 has 4 appearances in the playlist and Guest Singer has 1,
// the Collab Song MUST be attributed to 周杰伦!
// Thus 周杰伦 has 4 tracks, and Guest Singer has 0 tracks!
assert.strictEqual(res5.sortedItems.length, 4);
for (const item of res5.sortedItems) {
  assert.strictEqual(item.assignedArtist.name, '周杰伦');
}
assert.strictEqual(res5.singleTrackGroups.length, 0);
console.log('✓ Test 5 Passed!');

// Test 6: Duplicate songs handled as distinct items (Rule 7)
console.log('Testing Test 6: Duplicate songs treated as distinct items...');
const dupPlaylist = [
  { track: { id: 'dup', name: '晴天', artists: [{ id: 'art_jay', name: '周杰伦' }], album: { name: '叶惠美' } } },
  { track: { id: 'other', name: '安静', artists: [{ id: 'art_jay', name: '周杰伦' }], album: { name: '范特西' } } },
  { track: { id: 'dup', name: '晴天', artists: [{ id: 'art_jay', name: '周杰伦' }], album: { name: '叶惠美' } } }
];

const res6 = sortPlaylistItems(dupPlaylist);
assert.strictEqual(res6.sortedItems.length, 3);
assert.strictEqual(res6.sortedItems[0].trackName, '安静');
assert.strictEqual(res6.sortedItems[1].trackName, '晴天');
assert.strictEqual(res6.sortedItems[2].trackName, '晴天');
// Both duplicate items exist and have distinct originalIndex!
assert.notStrictEqual(res6.sortedItems[1].originalIndex, res6.sortedItems[2].originalIndex);
// Test 7: Duplicate detection
console.log('Testing Test 7: findDuplicateTracks detection...');
const { findDuplicateTracks } = require('../src/sorter');
const dups = findDuplicateTracks(dupPlaylist);
assert.strictEqual(dups.length, 1);
assert.strictEqual(dups[0].trackName, '晴天');
assert.strictEqual(dups[0].occurrences.length, 2);
console.log('✓ Test 7 Passed!');

console.log('\n========================================');
console.log('🎉 ALL UNIT TESTS PASSED SUCCESSFULLY! 🎉');
console.log('========================================');
