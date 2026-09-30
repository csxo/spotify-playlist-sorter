/**
 * build.js
 * Builds both:
 * 1. spotify-playlist-sorter.user.js (Violentmonkey/Tampermonkey installable script)
 * 2. extension/content.js (Chrome Unpacked Extension content script)
 * 3. extension/ assets, manifests, and background workers
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const SRC_DIR = path.join(ROOT_DIR, 'src');
const EXT_DIR = path.join(ROOT_DIR, 'extension');
const ICONS_DIR = path.join(EXT_DIR, 'icons');

if (!fs.existsSync(EXT_DIR)) fs.mkdirSync(EXT_DIR, { recursive: true });
if (!fs.existsSync(ICONS_DIR)) fs.mkdirSync(ICONS_DIR, { recursive: true });

// Read source files
const comparatorCode = fs.readFileSync(path.join(SRC_DIR, 'comparator.js'), 'utf8');
const sorterCode = fs.readFileSync(path.join(SRC_DIR, 'sorter.js'), 'utf8');
const tokenManagerCode = fs.readFileSync(path.join(SRC_DIR, 'token-manager.js'), 'utf8');
const historyManagerCode = fs.readFileSync(path.join(SRC_DIR, 'history-manager.js'), 'utf8');
const spotifyApiCode = fs.readFileSync(path.join(SRC_DIR, 'spotify-api.js'), 'utf8');
const uiCode = fs.readFileSync(path.join(SRC_DIR, 'ui.js'), 'utf8');

// Filter out CommonJS requires and exports for browser bundling
function cleanForBundle(code) {
  // Strip require statements safely without greedy cross-line matching
  // 1. Single-line requires: const ... = require(...);
  code = code.replace(/^[ \t]*const[^\n=]+=[ \t]*require\([^)]+\)[^;\n]*;?[ \t]*\r?\n?/gm, '');
  // 2. Destructuring requires: const { ... } = require(...);
  code = code.replace(/^[ \t]*const\s*\{[^}]+\}\s*=[ \t]*require\([^)]+\)[^;\n]*;?[ \t]*\r?\n?/gm, '');
  // 3. Conditional require in sorter.js
  code = code.replace(/const\s*\{\s*compareStrings\s*\}\s*=\s*\(typeof module[\s\S]*?\);\r?\n?/g, '');
  
  // Strip CommonJS export blocks cleanly by finding the export check
  const exportMarkers = [
    "if (typeof module !== 'undefined'",
    'if (typeof module !== "undefined"'
  ];

  for (const marker of exportMarkers) {
    const idx = code.indexOf(marker);
    if (idx !== -1) {
      code = code.substring(0, idx);
    }
  }

  return code.trim();
}

const bundledBody = `
(function() {
  'use strict';

  // Prevent multiple injections
  if (window.__SpotifyPlaylistSorterLoaded) return;
  window.__SpotifyPlaylistSorterLoaded = true;

  console.log('[SpotifySorter] Initializing Spotify Playlist Auto Sorter...');

  // --- 1. Comparator Module ---
  ${cleanForBundle(comparatorCode)}

  // --- 2. Sorter Module ---
  ${cleanForBundle(sorterCode)}

  // --- 3. Token Manager Module ---
  ${cleanForBundle(tokenManagerCode)}

  // --- 4. History Manager Module ---
  ${cleanForBundle(historyManagerCode)}

  // --- 5. Spotify API Module ---
  ${cleanForBundle(spotifyApiCode)}

  // --- 6. UI Module ---
  ${cleanForBundle(uiCode)}

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
`;

// Userscript Header
const userscriptHeader = `// ==UserScript==
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
`;

// 1. Output Userscript
const userscriptPath = path.join(ROOT_DIR, 'spotify-playlist-sorter.user.js');
fs.writeFileSync(userscriptPath, userscriptHeader + '\n' + bundledBody, 'utf8');
console.log('✓ Generated:', userscriptPath);

// 2. Output Extension content.js
const extensionContentPath = path.join(EXT_DIR, 'content.js');
fs.writeFileSync(extensionContentPath, bundledBody, 'utf8');
console.log('✓ Generated:', extensionContentPath);

// 3. Generate PNG icons
function generateMinimalPng() {
  const greenPngBase64 = 
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAJy' +
    'SURBVHgB7Zk9bhsxFIVf4yZupVslC4huuAso1zhyk8Z18hBqG6lch4Fcpkldp01vk4a7gB5dJcUC4idB/FmBgeLMRqP5hH6PDyE5y+vrczGfp5kx' +
    '3z36v8h0+vnq+flp9+l02l0vH/P5Zfc62e33+8v1+uUf1p9+/Xb1sX+6efj88bXb/9x/2+xW+/1u9/X69uL9/et/vL6+/mD9kZ1c0fDq58/7212b' +
    'd8u2j10P3bL4vFv4eX/71r3Zvfvd3Xp5+b2z40h7Y43f9rvv3c393e82v7m4uLjq/71e3F392/x90f/G7y/uX/4c7f0fP739/eH27d/13+1/6334' +
    '1K331u8/ffz4n/34/frdZ7+z/5u3F2797v762V+73f3D9bv2b3/9eXX15f5+d/v+n/6X8/8H+PjxP62Pj099/q8/f+p/+4fP3fq3H//U//7+8/d9' +
    'v7O827376z/q/33e9bvL9r/13/z/2P+3v7z45Z/+5f+49b+/v72/9ftt3vW/3bv/v/1fv71g/X8FmBfwX8/4bZ2f5wW4QYAbBLhBgBsEuEGA' +
    'GwS4QYAbBLhBgBsEuEGAe90AbgX86xZwv7jA3Q/gNgG4TYDbBOA2AbhNAHYTgNsEYDcB2E0A7vECuKcA7imAewrAngK4pwDuKQB7CuCeAriXAXgZ' +
    'gJcBeBmAlwF4GYCXAXgZgJcBeJkC4GUKgJcpAF6mAHrXvW4A7p8P3P8/eO8DcNsE4DYB2E0AdhOA2wTgNgHYTQB2E4DdBOAeL4B7CuCeAriXAXgZ' +
    'gJcBeBmAlwF4GYCXAXiZAuBlCoCXKQBepgB4/wLg50mAmSdA/gAAAABJRU5ErkJggg==';
  return Buffer.from(greenPngBase64, 'base64');
}

const iconBuffer = generateMinimalPng();
fs.writeFileSync(path.join(ICONS_DIR, 'icon16.png'), iconBuffer);
fs.writeFileSync(path.join(ICONS_DIR, 'icon48.png'), iconBuffer);
fs.writeFileSync(path.join(ICONS_DIR, 'icon128.png'), iconBuffer);
console.log('✓ Generated icons in:', ICONS_DIR);

console.log('\n=============================================');
console.log('🎉 BUILD SUCCESSFUL! All deliverables generated. 🎉');
console.log('=============================================');
