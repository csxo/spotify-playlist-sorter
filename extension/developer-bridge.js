/**
 * developer-bridge.js
 * Injected into developer.spotify.com to automatically capture
 * official Spotify Web API tokens generated via the Spotify Developer Console / documentation.
 */
(function() {
  'use strict';

  let hasCaptured = false;

  function extractToken(str) {
    if (!str || typeof str !== 'string') return null;
    
    // Check for Bearer token match
    const bearerMatch = str.match(/Bearer\s+([a-zA-Z0-9_\-\.]{40,})/i);
    if (bearerMatch) {
      const t = bearerMatch[1].trim();
      if (!t.startsWith('BQD')) return t;
    }

    // Check for BQA / BQC direct tokens
    const bqMatch = str.match(/(BQ[a-zA-Z0-9_\-\.]{50,})/);
    if (bqMatch) {
      const t = bqMatch[1].trim();
      if (!t.startsWith('BQD')) return t;
    }

    const clean = str.trim().replace(/^Bearer\s+/i, '');
    if ((clean.startsWith('BQA') || clean.startsWith('BQC') || (clean.startsWith('BQ') && !clean.startsWith('BQD'))) && clean.length > 40) {
      return clean;
    }

    return null;
  }

  function notifyExtension(token) {
    if (hasCaptured || !token) return;
    hasCaptured = true;

    try {
      chrome.runtime.sendMessage({
        type: 'SPOTIFY_SORTER_SAVE_TOKEN',
        token: token.trim(),
        source: 'developer_spotify_com'
      }, (res) => {
        showFloatingNotice('🎉 Spotify 歌单重排器：已自动捕获官方 Token！返回歌单页面即可直接重排。');
      });
    } catch (e) {
      console.warn('[SpotifySorter] Failed to message background from developer page:', e);
    }
  }

  function showFloatingNotice(text) {
    const existing = document.getElementById('sp-sorter-dev-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'sp-sorter-dev-banner';
    banner.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #1db954;
      color: #000000;
      padding: 14px 20px;
      border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      font-weight: 700;
      box-shadow: 0 8px 30px rgba(0,0,0,0.5);
      z-index: 999999;
      display: flex;
      align-items: center;
      gap: 12px;
    `;
    banner.innerHTML = `
      <span>${text}</span>
      <button style="background:none; border:none; color:#000; font-size:18px; cursor:pointer; font-weight:bold;">&times;</button>
    `;
    banner.querySelector('button').onclick = () => banner.remove();
    document.body.appendChild(banner);

    setTimeout(() => {
      if (banner.parentNode) banner.remove();
    }, 10000);
  }

  // 1. Scan storage
  function scanStorage() {
    try {
      for (const storage of [sessionStorage, localStorage]) {
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          const v = storage.getItem(k);
          if (typeof v === 'string') {
            const token = extractToken(v);
            if (token) {
              notifyExtension(token);
              return;
            }
          }
        }
      }
    } catch (e) {}
  }

  // 2. Scan DOM elements (inputs, code blocks, pre, request sample)
  function scanDOM() {
    try {
      const elements = document.querySelectorAll('input, textarea, code, pre, span, p');
      for (const el of elements) {
        const val = el.value || el.innerText || '';
        const token = extractToken(val);
        if (token) {
          notifyExtension(token);
          return;
        }
      }
    } catch (e) {}
  }

  // 3. Listen to Copy event
  document.addEventListener('copy', () => {
    setTimeout(async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          const text = await navigator.clipboard.readText();
          const token = extractToken(text);
          if (token) {
            notifyExtension(token);
          }
        }
      } catch (e) {}
    }, 100);
  });

  // 4. Listen to Try it button click
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (target && (target.innerText === 'Try it' || target.classList?.contains('try-it'))) {
      setTimeout(() => {
        scanStorage();
        scanDOM();
      }, 500);
      setTimeout(() => {
        scanStorage();
        scanDOM();
      }, 1500);
    }
  });

  // Run periodic scans
  scanStorage();
  scanDOM();
  const timer = setInterval(() => {
    if (hasCaptured) {
      clearInterval(timer);
      return;
    }
    scanStorage();
    scanDOM();
  }, 1000);

  setTimeout(() => clearInterval(timer), 120000);

  console.log('[SpotifySorter] Developer bridge initialized on developer.spotify.com');
})();
