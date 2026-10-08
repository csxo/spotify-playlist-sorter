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

  isZh() {
    if (typeof SpotifySorterI18n !== 'undefined') {
      return SpotifySorterI18n.getLanguage() === 'zh';
    }
    return false;
  }

  t(key, params) {
    if (typeof SpotifySorterI18n !== 'undefined') {
      return SpotifySorterI18n.t(key, params);
    }
    return key;
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
    if (existing && existing.isConnected) {
      existing.setAttribute('title', this.isZh() ? '点击打开 Spotify 歌单智能重排器' : 'Open Spotify Playlist Auto Sorter');
      existing.innerHTML = `
        <span style="font-size:16px; line-height:1; display:flex; align-items:center;">🎵</span>
        <span>${this.isZh() ? '智能排序歌单' : 'Sort Playlist'}</span>
      `;
      return;
    }

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
      btn.setAttribute('title', this.isZh() ? '点击打开 Spotify 歌单智能重排器' : 'Open Spotify Playlist Auto Sorter');
      btn.innerHTML = `
        <span style="font-size:16px; line-height:1; display:flex; align-items:center;">🎵</span>
        <span>${this.isZh() ? '智能排序歌单' : 'Sort Playlist'}</span>
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
      this.showToast(this.isZh() ? '请先打开任意一个您拥有编辑权限的 Spotify 歌单页面！' : 'Please open a Spotify playlist page with edit permissions first!', 'warning');
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
            status: this.isZh() ? `正在智能查漏补缺 (${missingIndices.length} 首未读曲目)...` : `Scanning missing tracks (${missingIndices.length} remaining)...`
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
    this.showLoadingOverlay(true, this.isZh() ? '正在高速读取歌单全部歌曲...' : 'Scanning playlist tracks...');

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
        this.updateLoadingProgress(this.isZh() ? '正在读取曲目...请稍候' : 'Fetching tracks... Please wait', 15);

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
            this.updateLoadingProgress(this.isZh() ? `正在读取曲目: ${loaded} / ${total} 首 (${percent}%)` : `Loading tracks: ${loaded} / ${total} (${percent}%)`, percent);
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
        this.updateLoadingProgress(status || (this.isZh() ? `正在读取歌曲: ${loaded} / ${total} 首 (${percent}%)` : `Loading tracks: ${loaded} / ${total} (${percent}%)`), percent);
      });

      if (domTracks && domTracks.length > 0) {
        loadedTracks = domTracks;
        const pageTitle = document.title.replace(' | Spotify', '').replace(' - playlist by.*', '').trim() || (this.isZh() ? '我的歌单' : 'My Playlist');
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
        sub.innerText = this.isZh() ? `歌单: ${playlistName} (${loadedTracks.length} 首)` : `Playlist: ${playlistName} (${loadedTracks.length} tracks)`;
      }
      this.recalculateAndRender();
      this.showLoadingOverlay(false);
    } else {
      this.showLoadingOverlay(false);
      this.renderEmptyOrRetryState(this.isZh() ? '未能读取到歌单歌曲。请确认已打开歌单页面，然后点击重试：' : 'Unable to read playlist tracks. Please ensure you are on a playlist page and retry:');
    }
  }

  renderDeduplicationUI() {
    const container = document.getElementById('sp-dup-container');
    if (!container) return;

    const dupGroups = this.duplicateGroups || [];
    const totalDups = dupGroups.reduce((acc, g) => acc + (g.occurrences.length - 1), 0);
    const removedCount = this.removedTrackKeys.size;
    const isZh = this.isZh();

    if (totalDups === 0 && removedCount === 0) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    container.style.display = 'block';

    let html = `
      <div class="sp-dup-banner">
        <div class="sp-dup-banner-left">
          <span class="sp-dup-badge">${isZh ? '⚠️ 重复歌曲检测' : '⚠️ Duplicate Detection'}</span>
          <span class="sp-dup-info">
            ${totalDups > 0
              ? (isZh
                ? `检测到歌单中存在 <strong>${totalDups}</strong> 首重复歌曲（共 <strong>${dupGroups.length}</strong> 组）。去重后歌单更清爽！`
                : `Detected <strong>${totalDups}</strong> duplicate tracks across <strong>${dupGroups.length}</strong> groups.`)
              : (isZh
                ? `✅ 重复歌曲已全部清理完成！当前歌单已无重复曲目。`
                : `✅ All duplicate tracks cleaned! No duplicates remain.`)
            }
            ${removedCount > 0 ? `<span style="color:#1ed760; margin-left:6px; font-weight:600;">(${isZh ? `已移除 ${removedCount} 首重复` : `${removedCount} duplicates removed`})</span>` : ''}
          </span>
        </div>
        <div class="sp-dup-banner-right">
          ${totalDups > 0 ? `
            <button id="sp-dup-batch-btn" class="sp-dup-btn sp-dup-btn-clean" title="${isZh ? '每组仅保留第一首，批量删除其他重复项' : 'Keep first occurrence of each group, remove other duplicates'}">
              ⚡ ${isZh ? '一键去重 (保留首首)' : 'Clean All Duplicates'}
            </button>
            <button id="sp-dup-toggle-btn" class="sp-dup-btn sp-dup-btn-view">
              ${this.showDuplicateList ? (isZh ? '▲ 收起重复明细' : '▲ Hide Duplicates') : (isZh ? '▼ 查看/管理重复明细' : '▼ View Duplicates')}
            </button>
          ` : ''}
          ${removedCount > 0 ? `
            <button id="sp-dup-restore-btn" class="sp-dup-btn sp-dup-btn-restore" title="${isZh ? '恢复所有被删除的重复歌曲' : 'Restore all removed duplicate tracks'}">
              ↺ ${isZh ? `撤销去重并恢复 (${removedCount} 首)` : `Restore Duplicates (${removedCount})`}
            </button>
          ` : ''}
        </div>
      </div>
    `;

    if (this.showDuplicateList && totalDups > 0) {
      html += `
        <div class="sp-dup-list-card">
          <div style="font-size:12px; color:#aaa; margin-bottom:10px;">
            ${isZh ? '请核对以下重复歌曲，支持针对单首歌曲单独删除或针对整组一键去重：' : 'Review duplicate tracks below. Remove single tracks or keep the first occurrence of each group:'}
          </div>
          <div class="sp-dup-groups-grid">
            ${dupGroups.map(g => `
              <div class="sp-dup-group-item">
                <div class="sp-dup-group-header">
                  <div>
                    <strong style="color:#fff; font-size:13px;">🎵 ${this.escapeHtml(g.trackName)}</strong>
                    <span style="color:#aaa; font-size:12px; margin-left:6px;">- ${this.escapeHtml(g.artistName)}</span>
                    <span style="color:#f59e0b; font-size:11px; margin-left:8px; background:rgba(245,158,11,0.15); padding:2px 6px; border-radius:4px;">${isZh ? `出现 ${g.occurrences.length} 次` : `${g.occurrences.length} copies`}</span>
                  </div>
                  <button class="sp-dup-keep-first-btn" data-key="${this.escapeHtml(g.key)}">
                    ${isZh ? '仅保留首首' : 'Keep First Only'}
                  </button>
                </div>
                <div class="sp-dup-instances">
                  ${g.occurrences.map((occ, oIdx) => {
                    const occUri = occ.uri && !occ.uri.includes('dom_') ? occ.uri : `idx_${occ.originalIndex}`;
                    const isFirst = oIdx === 0;
                    return `
                      <div class="sp-dup-instance-row">
                        <span style="color:#888; width:50px;">#${occ.originalIndex + 1}</span>
                        <span style="flex:1; color:#bbb;">${isZh ? '专辑: ' : 'Album: '}${this.escapeHtml(occ.albumName || (isZh ? '单曲/未知' : 'Single / Unknown'))}</span>
                        ${isFirst ? `
                          <span style="color:#1ed760; font-size:11px; font-weight:700; background:rgba(30,215,96,0.15); padding:2px 8px; border-radius:4px;">
                            ${isZh ? '✓ 第一首 (默认保留)' : '✓ First (Kept)'}
                          </span>
                        ` : `
                          <button class="sp-dup-del-single-btn" data-track-key="${this.escapeHtml(occUri)}">
                            🗑️ ${isZh ? '删除此首' : 'Delete'}
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
        this.showToast(this.isZh() ? `✅ 已批量清理 ${totalDups} 首重复歌曲！` : `✅ Cleaned ${totalDups} duplicate tracks!`, 'success');
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
        this.showToast(this.isZh() ? `↺ 已恢复全部 ${count} 首歌曲！` : `↺ Restored all ${count} tracks!`, 'info');
        this.recalculateAndRender();
      };
    }

    container.querySelectorAll('.sp-dup-del-single-btn').forEach(btn => {
      btn.onclick = () => {
        const k = btn.getAttribute('data-track-key');
        if (k) {
          this.removedTrackKeys.add(k);
          this.showToast(this.isZh() ? '🗑️ 已删除该重复曲目！' : '🗑️ Removed duplicate track!', 'info');
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
          this.showToast(this.isZh() ? `✅ 已去重《${grp.trackName}》！` : `✅ Deduplicated "${grp.trackName}"!`, 'success');
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

    this.showToast(this.isZh() ? '✅ 筛选配置已导出为 JSON 文件并已复制到剪贴板！' : '✅ Configuration exported to JSON and copied to clipboard!', 'success');
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
          this.showToast(this.isZh() ? '✅ 排序配置导入成功，已按新规则重新计算！' : '✅ Configuration imported successfully, rules applied!', 'success');
        } catch (err) {
          this.showToast(this.isZh() ? '❌ 配置文件格式无效，请选择正确的 JSON 配置文件！' : '❌ Invalid configuration file format!', 'error');
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
      this.renderEmptyState(this.isZh() ? '歌单内暂无可排序的歌曲' : 'No tracks available to sort in this playlist');
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
            <h2 class="sp-sorter-title">🎵 ${this.isZh() ? 'Spotify 歌单智能重排器' : 'Spotify Playlist Auto Sorter'}</h2>
            <div id="sp-sorter-subtitle" class="sp-sorter-subtitle">${this.isZh() ? '正在连接歌单...' : 'Connecting to playlist...'}</div>
          </div>

          <!-- Feature Description Slogan Box -->
          <div class="sp-feature-slogan-box">
            <span class="sp-slogan-icon">✨</span>
            <div class="sp-slogan-text">
              <strong>${this.isZh() ? 'Spotify 歌单整理神器：' : 'Spotify Playlist Auto Sorter: '}</strong>${this.isZh() ? '全自动同歌手全聚合 · 歌曲数量降序 · A-Z/年份精细重排 · 智能去重 · 一键复制生成新歌单' : 'Auto artist grouping · Track count descending · A-Z / year sorting · Smart deduplication · 1-click copy to new playlist'}
            </div>
          </div>

          <div class="sp-sorter-header-right">
            <button id="sp-sorter-lang-btn" class="sp-sorter-lang-btn" title="${this.isZh() ? 'Switch to English' : '切换到简体中文'}" style="background:#282828; color:#1ed760; border:1px solid #444; border-radius:14px; padding:3px 10px; font-size:12px; font-weight:700; cursor:pointer; margin-right:8px; display:inline-flex; align-items:center; gap:4px;">
              🌐 ${this.isZh() ? 'EN' : '中文'}
            </button>
            <a href="https://github.com/csxo/spotify-playlist-sorter" target="_blank" rel="noopener noreferrer" class="sp-sorter-github-link" title="GitHub (csxo/spotify-playlist-sorter)">
              <svg height="22" width="22" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
              </svg>
            </a>
            <button id="sp-sorter-close-btn" class="sp-sorter-close-btn" title="${this.t('close')}">&times;</button>
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
              <label class="sp-sorter-label" for="sp-opt-intra">${this.isZh() ? '同一歌手内部：' : 'Intra-Artist Sort:'}</label>
              <select id="sp-opt-intra" class="sp-sorter-select">
                <option value="track_name_az">🔤 ${this.isZh() ? '歌曲名 A-Z (中文拼音)' : 'Track Title A-Z'}</option>
                <option value="album_name_then_track_az">💿 ${this.isZh() ? '专辑名称 → 歌曲名 A-Z' : 'Album Name → Title A-Z'}</option>
                <option value="album_date_desc">📅 ${this.isZh() ? '发行年份由新到旧 (最新优先)' : 'Release Year (Newest First)'}</option>
                <option value="album_date_asc">⏳ ${this.isZh() ? '发行年份由旧到新 (经典优先)' : 'Release Year (Oldest First)'}</option>
                <option value="original_order">⏸️ ${this.isZh() ? '保持歌单原添加顺序' : 'Original Playlist Order'}</option>
              </select>
            </div>

            <div class="sp-sorter-tool-group">
              <label class="sp-sorter-label" for="sp-opt-feat">${this.isZh() ? 'feat. 合作归属：' : 'Feat. Attribution:'}</label>
              <select id="sp-opt-feat" class="sp-sorter-select">
                <option value="most_frequent_in_playlist">🌟 ${this.isZh() ? '歌单歌曲最多的歌手 (推荐)' : 'Most Frequent Artist (Recommended)'}</option>
                <option value="primary_artist_only">👤 ${this.isZh() ? '仅按第一主唱歌手' : 'First Main Artist Only'}</option>
              </select>
            </div>

            <button id="sp-toggle-rules-btn" class="sp-sorter-btn sp-btn-drawer">
              ⚙️ ${this.isZh() ? '规则说明与高级筛选' : 'Sort Rules & Filters'}
            </button>
          </div>

          <div class="sp-toolbar-right">
            <button id="sp-export-cfg-btn" class="sp-sorter-btn sp-btn-cfg" title="${this.isZh() ? '将当前筛选条件导出为 JSON 文件并复制到剪贴板' : 'Export current sorting options to JSON'}">
              📥 ${this.isZh() ? '导出配置' : 'Export Config'}
            </button>
            <button id="sp-import-cfg-btn" class="sp-sorter-btn sp-btn-cfg" title="${this.isZh() ? '导入已有的 JSON 筛选配置文件' : 'Import JSON sorting options'}">
              📤 ${this.isZh() ? '导入配置' : 'Import Config'}
            </button>

            <div class="sp-sorter-tabs">
              <button id="sp-tab-grouped" class="sp-sorter-tab-btn active">${this.isZh() ? '歌手分组视图' : 'Grouped by Artist'}</button>
              <button id="sp-tab-flat" class="sp-sorter-tab-btn">${this.isZh() ? '完整重排清单' : 'Flat List'}</button>
            </div>
          </div>
        </div>

        <!-- Collapsible Rules & Advanced Filter Drawer -->
        <div id="sp-rules-drawer" class="sp-rules-drawer" style="display: none;">
          <div class="sp-drawer-header">
            <div style="font-weight:700; color:#1ed760; font-size:14px; display:flex; align-items:center; gap:6px;">
              ⚙️ ${this.isZh() ? '10 大专业排序规则详解与自由配置面板' : '10 Professional Sorting Rules Configuration'}
            </div>
            <div style="font-size:12px; color:#888;">${this.isZh() ? '每个规则均支持自由点选与调整，即选即生效' : 'Every rule can be adjusted freely with real-time preview'}</div>
          </div>

          <div class="sp-rules-grid">
            <!-- 规则 1 -->
            <div class="sp-rule-card">
              <div class="sp-rule-header-row">
                <span class="sp-rule-num">${this.isZh() ? '规则 1' : 'Rule 1'}</span>
                <span class="sp-rule-title">${this.isZh() ? '同歌手全聚合' : 'Artist Aggregation'}</span>
              </div>
              <div class="sp-rule-desc">${this.isZh() ? '相同歌手的所有歌曲紧密聚合，告别零散分布。' : 'Group all tracks by the same artist into contiguous clusters.'}</div>
              <div class="sp-rule-control">
                <select id="sp-rule-1" class="sp-rule-select">
                  <option value="true">✅ ${this.isZh() ? '严格歌手聚合 (推荐)' : 'Strict Grouping (Recommended)'}</option>
                  <option value="false">❌ ${this.isZh() ? '不聚合 (仅单曲全局平铺)' : 'No Grouping (Flat list only)'}</option>
                </select>
              </div>
            </div>

            <!-- 规则 2 -->
            <div class="sp-rule-card">
              <div class="sp-rule-header-row">
                <span class="sp-rule-num">${this.isZh() ? '规则 2' : 'Rule 2'}</span>
                <span class="sp-rule-title">${this.isZh() ? '聚合歌手主排序' : 'Artist Order Mode'}</span>
              </div>
              <div class="sp-rule-desc">${this.isZh() ? '歌单中歌手组的排位依据。' : 'Ranking logic for artist groups.'}</div>
              <div class="sp-rule-control">
                <select id="sp-rule-2" class="sp-rule-select">
                  <option value="count_desc">📊 ${this.isZh() ? '按收录歌曲量由多到少降序 (推荐)' : 'Track Count Descending (Recommended)'}</option>
                  <option value="pinyin_az">🔤 ${this.isZh() ? '按歌手姓名 A-Z (拼音首字母)' : 'Artist Name A-Z'}</option>
                  <option value="original_order">⏱️ ${this.isZh() ? '按原歌单中首次出现先后顺序' : 'Original First Appearance'}</option>
                </select>
              </div>
            </div>

            <!-- 规则 3 -->
            <div class="sp-rule-card">
              <div class="sp-rule-header-row">
                <span class="sp-rule-num">${this.isZh() ? '规则 3' : 'Rule 3'}</span>
                <span class="sp-rule-title">${this.isZh() ? '同量级歌手并列决胜' : 'Tie-Breaker Strategy'}</span>
              </div>
              <div class="sp-rule-desc">${this.isZh() ? '多位歌手歌曲数量相同时的次级决胜策略。' : 'Secondary sorting when artists have equal song counts.'}</div>
              <div class="sp-rule-control">
                <select id="sp-rule-3" class="sp-rule-select">
                  <option value="pinyin_az">🔤 ${this.isZh() ? '按姓名 A-Z (拼音/首字母，推荐)' : 'Artist Name A-Z (Recommended)'}</option>
                  <option value="original_appearance">⏱️ ${this.isZh() ? '按原歌单首次出场顺序' : 'Original Appearance Order'}</option>
                </select>
              </div>
            </div>

            <!-- 规则 4 -->
            <div class="sp-rule-card">
              <div class="sp-rule-header-row">
                <span class="sp-rule-num">${this.isZh() ? '规则 4' : 'Rule 4'}</span>
                <span class="sp-rule-title">${this.isZh() ? '单曲歌手放置策略' : 'Single-Track Strategy'}</span>
              </div>
              <div class="sp-rule-desc">${this.isZh() ? '歌单中仅收录 1 首歌的散客歌手位置。' : 'Placement for artists with only 1 song in playlist.'}</div>
              <div class="sp-rule-control">
                <select id="sp-rule-4" class="sp-rule-select">
                  <option value="at_the_end_az">📌 ${this.isZh() ? '统一置底按 A-Z 排序 (推荐)' : 'Sink to Bottom A-Z (Recommended)'}</option>
                  <option value="mix_with_multi">🔀 ${this.isZh() ? '与多曲歌手混合参与全局降序' : 'Mix with Multi-track Artists'}</option>
                  <option value="at_the_top_az">🔝 ${this.isZh() ? '统一置顶 (单曲歌手放最前)' : 'Pin to Top'}</option>
                </select>
              </div>
            </div>

            <!-- 规则 5 -->
            <div class="sp-rule-card">
              <div class="sp-rule-header-row">
                <span class="sp-rule-num">${this.isZh() ? '规则 5' : 'Rule 5'}</span>
                <span class="sp-rule-title">${this.isZh() ? '同一歌手内细分排序' : 'Intra-Artist Track Order'}</span>
              </div>
              <div class="sp-rule-desc">${this.isZh() ? '同一歌手组内部多首歌曲的排序维度。' : 'Sorting dimensions within each artist cluster.'}</div>
              <div class="sp-rule-control">
                <select id="sp-rule-5" class="sp-rule-select">
                  <option value="track_name_az">🔤 ${this.isZh() ? '歌曲名 A-Z (拼音)' : 'Track Title A-Z'}</option>
                  <option value="album_name_then_track_az">💿 ${this.isZh() ? '专辑名称 A-Z → 歌曲名 A-Z' : 'Album Name A-Z → Title A-Z'}</option>
                  <option value="album_date_desc">📅 ${this.isZh() ? '发行年份由新到旧 (最新优先)' : 'Release Year (Newest First)'}</option>
                  <option value="album_date_asc">⏳ ${this.isZh() ? '发行年份由旧到新 (经典优先)' : 'Release Year (Oldest First)'}</option>
                  <option value="original_order">⏸️ ${this.isZh() ? '保持歌单原添加顺序' : 'Original Playlist Order'}</option>
                </select>
              </div>
            </div>

            <!-- 规则 6 -->
            <div class="sp-rule-card">
              <div class="sp-rule-header-row">
                <span class="sp-rule-num">${this.isZh() ? '规则 6' : 'Rule 6'}</span>
                <span class="sp-rule-title">${this.isZh() ? 'feat. 合作曲目归属' : 'Feat. & Collab Attribution'}</span>
              </div>
              <div class="sp-rule-desc">${this.isZh() ? '多艺人合唱/合作曲目归属哪位歌手名下。' : 'Attribution of collaborative / duet tracks.'}</div>
              <div class="sp-rule-control">
                <select id="sp-rule-6" class="sp-rule-select">
                  <option value="most_frequent_in_playlist">🌟 ${this.isZh() ? '归属歌单歌曲最多的歌手 (推荐)' : 'Most Frequent Artist in Playlist (Recommended)'}</option>
                  <option value="primary_artist_only">👤 ${this.isZh() ? '严格按第一主唱歌手归属' : 'First Main Artist Only'}</option>
                </select>
              </div>
            </div>

            <!-- 规则 7 -->
            <div class="sp-rule-card">
              <div class="sp-rule-header-row">
                <span class="sp-rule-num">${this.isZh() ? '规则 7' : 'Rule 7'}</span>
                <span class="sp-rule-title">${this.isZh() ? '重复歌曲处理策略' : 'Smart Deduplication'}</span>
              </div>
              <div class="sp-rule-desc">${this.isZh() ? '原歌单中存在相同歌曲时的处理方式。' : 'Handling duplicates in playlist.'}</div>
              <div class="sp-rule-control">
                <select id="sp-rule-7" class="sp-rule-select">
                  <option value="prompt">⚠️ ${this.isZh() ? '智能提示并支持手动/一键去重 (推荐)' : 'Prompt & Review (Recommended)'}</option>
                  <option value="auto_remove">⚡ ${this.isZh() ? '自动移除所有重复歌曲 (仅留首份)' : 'Auto Remove Duplicates (Keep first)'}</option>
                  <option value="keep_all">📦 ${this.isZh() ? '保留所有重复曲目 (分配独立槽位)' : 'Keep All Duplicates'}</option>
                </select>
              </div>
            </div>

            <!-- 规则 8 -->
            <div class="sp-rule-card">
              <div class="sp-rule-header-row">
                <span class="sp-rule-num">${this.isZh() ? '规则 8' : 'Rule 8'}</span>
                <span class="sp-rule-title">${this.isZh() ? '特殊符号与标点处理' : 'Punctuation & Prefix'}</span>
              </div>
              <div class="sp-rule-desc">${this.isZh() ? '歌名/歌手名前缀特殊标点符号的处理。' : 'Handling brackets & quotes during A-Z sort.'}</div>
              <div class="sp-rule-control">
                <select id="sp-rule-8" class="sp-rule-select">
                  <option value="true">🔤 ${this.isZh() ? '忽略特殊前导符号参与 A-Z 比较 (推荐)' : 'Ignore Special Leading Symbols (Recommended)'}</option>
                  <option value="false">🔡 ${this.isZh() ? '严格按 ASCII 字符原始顺序排序' : 'Strict ASCII Character Order'}</option>
                </select>
              </div>
            </div>

            <!-- 规则 9 -->
            <div class="sp-rule-card">
              <div class="sp-rule-header-row">
                <span class="sp-rule-num">${this.isZh() ? '规则 9' : 'Rule 9'}</span>
                <span class="sp-rule-title">${this.isZh() ? '单曲歌手内部排序依据' : 'Sunk Single-Track Order'}</span>
              </div>
              <div class="sp-rule-desc">${this.isZh() ? '末尾单曲歌手集合内部以什么为主键排序。' : 'Sorting key for the sunk single-track section.'}</div>
              <div class="sp-rule-control">
                <select id="sp-rule-9" class="sp-rule-select">
                  <option value="artist_az">👤 ${this.isZh() ? '按歌手姓名 A-Z 排序 (推荐)' : 'Artist Name A-Z (Recommended)'}</option>
                  <option value="track_az">🎵 ${this.isZh() ? '按歌曲名称 A-Z 排序' : 'Track Title A-Z'}</option>
                </select>
              </div>
            </div>

            <!-- 规则 10 -->
            <div class="sp-rule-card">
              <div class="sp-rule-header-row">
                <span class="sp-rule-num">${this.isZh() ? '规则 10' : 'Rule 10'}</span>
                <span class="sp-rule-title">${this.isZh() ? '位移追踪与分析模式' : 'Position Diff Tracking'}</span>
              </div>
              <div class="sp-rule-desc">${this.isZh() ? '是否计算每首歌曲从原位置到新位置的位移。' : 'Calculate index shifts comparing original and sorted order.'}</div>
              <div class="sp-rule-control">
                <select id="sp-rule-10" class="sp-rule-select">
                  <option value="true">📈 ${this.isZh() ? '启用位移追踪分析与变动统计 (推荐)' : 'Enable Shift Tracking (Recommended)'}</option>
                  <option value="false">⚡ ${this.isZh() ? '极速模式 (不追踪位移)' : 'Fast Mode (No tracking)'}</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <!-- Analytics Summary -->
        <div id="sp-sorter-summary-bar" class="sp-sorter-summary-bar"></div>

        <!-- Main Content Area -->
        <div id="sp-sorter-content-area" class="sp-sorter-content-area">
          <div class="sp-sorter-empty">${this.isZh() ? '正在加载...' : 'Loading...'}</div>
        </div>

        <!-- Footer Actions -->
        <div class="sp-sorter-footer">
          <div class="sp-sorter-footer-left">
            <span class="sp-sorter-guard-tip">
              🛡️ ${this.isZh() ? '零凭证 · 纯本地智能重排 · 完美保护原歌单安全可靠' : 'Zero Token · 100% Local Execution · Original Playlist Safe'}
            </span>
          </div>

          <div class="sp-sorter-footer-right">
            <button id="sp-cancel-btn" class="sp-sorter-btn sp-sorter-btn-cancel">${this.t('close')}</button>
            <button id="sp-copy-clipboard-btn" class="sp-sorter-btn sp-sorter-btn-primary" style="background:#1ed760; color:#000; font-weight:700; padding:10px 24px; border-radius:500px; display:inline-flex; align-items:center; gap:8px; cursor:pointer; font-size:14px;" title="${this.isZh() ? '一键复制排好序的全部歌曲链接，到 Spotify 桌面端直接 Ctrl+V 粘贴为新歌单' : 'Copy all sorted track URIs, open Spotify Desktop and press Ctrl+V / Cmd+V'}">
              📋 ${this.isZh() ? '复制排序结果' : 'Copy Tracks'} (<span id="sp-copy-count">0</span> ${this.isZh() ? '首' : 'tracks'})
            </button>
          </div>
        </div>

        <!-- Loading / Progress Overlay with Cancel Button -->
        <div id="sp-sorter-loading-overlay" class="sp-sorter-loading-overlay" style="display: none;">
          <div class="sp-sorter-spinner"></div>
          <div id="sp-sorter-loading-text" class="sp-sorter-loading-text">${this.isZh() ? '正在处理...' : 'Processing...'}</div>
          <div class="sp-sorter-progress-bar-container">
            <div id="sp-sorter-progress-bar" class="sp-sorter-progress-bar"></div>
          </div>
          <button id="sp-cancel-loading-btn" class="sp-sorter-cancel-loading-btn">${this.isZh() ? '取消并返回' : 'Cancel'}</button>
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
      this.renderLoadError(new Error(this.isZh() ? '用户主动取消了加载请求。' : 'Loading canceled by user.'));
    };

    const langBtn = document.getElementById('sp-sorter-lang-btn');
    if (langBtn) {
      langBtn.onclick = () => {
        if (typeof SpotifySorterI18n !== 'undefined' && SpotifySorterI18n.toggleLanguage) {
          SpotifySorterI18n.toggleLanguage();
        }
        this.renderModalBase();
        this.syncFormControlsWithOptions();
        this.recalculateAndRender();
        this.mountActionBarButton();
      };
    }

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
        <h3 class="sp-error-title">${this.isZh() ? '无法读取歌单曲目' : 'Failed to Load Playlist Tracks'}</h3>
        <p class="sp-error-desc">${this.escapeHtml(errMsg)}</p>

        <div class="sp-diag-box">
          <div class="sp-diag-item"><strong>${this.isZh() ? '目标歌单 ID：' : 'Playlist ID: '}</strong><code>${this.currentPlaylistId}</code></div>
          <div class="sp-diag-item"><strong>${this.isZh() ? '运行环境：' : 'Environment: '}</strong>${typeof GM_xmlhttpRequest !== 'undefined' ? (this.isZh() ? '脚本模式 (Violentmonkey/Tampermonkey)' : 'Userscript Mode') : (this.isZh() ? 'Chrome 扩展模式' : 'Chrome Extension Mode')}</div>
        </div>

        <div class="sp-error-actions">
          <button id="sp-err-retry-btn" class="sp-sorter-btn sp-sorter-btn-primary" style="background:#1db954; color:#000; font-weight:700; padding:10px 24px; border-radius:500px;">🔄 ${this.isZh() ? '重新读取歌曲' : 'Retry Scanning Tracks'}</button>
        </div>

        <div class="sp-error-tips" style="margin-top:20px; text-align:left;">
          <h4>💡 ${this.isZh() ? '排查与解决指引：' : 'Troubleshooting Tips:'}</h4>
          <ol style="margin:8px 0 0 0; padding-left:18px; line-height:1.8; color:#bbb; font-size:13px;">
            <li><strong>${this.isZh() ? '刷新重试' : 'Refresh & Retry'}</strong>: ${this.isZh() ? '按键盘 F5 刷新整个网页后，再次点击「🎵 智能排序歌单」；' : 'Press F5 to refresh page, then click "Sort Playlist" again;'}</li>
            <li><strong>${this.isZh() ? '网络与代理' : 'Network & Proxy'}</strong>: ${this.isZh() ? '请确认网络连接正常，若使用代理请确保放行 api.spotify.com。' : 'Ensure api.spotify.com is accessible on your network or proxy.'}</li>
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
        <h3 class="sp-error-title">${this.isZh() ? '未能读取到歌单歌曲' : 'No Tracks Found'}</h3>
        <p class="sp-error-desc">${this.escapeHtml(tipMessage)}</p>

        <div class="sp-error-actions">
          <button id="sp-empty-retry-btn" class="sp-sorter-btn sp-sorter-btn-primary" style="background:#1db954; color:#000; font-weight:700; padding:10px 24px; border-radius:500px;">🔄 ${this.isZh() ? '重新尝试读取' : 'Retry Loading Tracks'}</button>
        </div>

        <div class="sp-error-tips" style="margin-top:20px; text-align:left;">
          <h4>💡 ${this.isZh() ? '快速提示：' : 'Quick Tips:'}</h4>
          <ol style="margin:8px 0 0 0; padding-left:18px; line-height:1.8; color:#bbb; font-size:13px;">
            <li>${this.isZh() ? '请确认当前打开的是您的歌单详情页面；' : 'Ensure you are currently on a Spotify playlist page;'}</li>
            <li>${this.isZh() ? '在页面中上下滚动一下，让歌曲列表渲染出来，然后点击「重新尝试读取」；' : 'Scroll up and down on the page to let track rows render, then click Retry;'}</li>
            <li>${this.isZh() ? '按 F5 刷新整个网页也是一个快速生效的解决方法。' : 'Pressing F5 to refresh the browser is also an effective quick fix.'}</li>
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
      undoBtn.innerHTML = this.isZh() ? `↩️ 撤销排序 (恢复 ${timeStr} 快照)` : `↩️ Undo Sort (Restore ${timeStr})`;
      undoBtn.classList.remove('disabled');
    } else {
      undoBtn.innerHTML = this.isZh() ? `↩️ 撤销上次排序 (暂无快照)` : `↩️ Undo Sort (No Snapshot)`;
      undoBtn.classList.add('disabled');
    }
  }

  handleCopyClipboardFlow() {
    if (!this.sortResult || !this.sortResult.sortedItems || this.sortResult.sortedItems.length === 0) {
      this.showToast(this.isZh() ? '歌单尚未加载或暂无可排序歌曲' : 'Playlist not loaded or no tracks available', 'warning');
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
      const title = item.trackName || (item.track && item.track.name) || (this.isZh() ? '未知曲目' : 'Unknown Track');
      const artist = item.assignedArtist?.name || (item.artists && item.artists[0]?.name) || '';
      return `${title} - ${artist}`;
    }).filter(Boolean).join('\n');

    const copySuccess = () => {
      this.showToast(this.isZh() ? `✅ 已复制全部 ${items.length} 首歌曲！去 Spotify 粘贴即可` : `✅ Copied all ${items.length} tracks! Ready to paste into Spotify`, 'success');
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

    const isZh = this.isZh();

    overlay = document.createElement('div');
    overlay.id = 'sp-clipboard-modal';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:9999999; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(6px); font-family:system-ui,sans-serif;';
    overlay.innerHTML = `
      <div style="background:#181818; border:1px solid #333; border-radius:12px; padding:28px; width:520px; max-width:90%; color:#fff; text-align:center; box-shadow:0 12px 36px rgba(0,0,0,0.7);">
        <div style="font-size:40px; margin-bottom:12px;">🎉</div>
        <h3 style="margin:0 0 10px 0; color:#1ed760; font-size:20px; font-weight:700;">
          ${isZh ? `已成功复制全部 ${count} 首排好序的歌曲！` : `Successfully copied all ${count} sorted tracks!`}
        </h3>
        <p style="color:#aaa; font-size:13px; margin:0 0 16px 0;">
          ${isZh ? '全自动 · 零配置 · 完美应用 10 大重排规则' : 'Zero Token · 100% Local · All 10 Rules Applied Perfectly'}
        </p>
        
        <div style="background:#222; border-radius:8px; padding:16px; text-align:left; font-size:13px; line-height:1.9; color:#eee; border:1px solid #2a2a2a; margin-bottom:20px;">
          <div style="font-weight:700; color:#1ed760; margin-bottom:6px;">
            ${isZh ? '📋 仅需最后 2 步，粘贴回 Spotify 客户端：' : '📋 Final 2 Steps: Paste directly into Spotify App:'}
          </div>
          <div>
            ${isZh ? '1. 打开 <strong>Spotify 桌面客户端</strong>，点击左侧边栏的 <strong>「＋ 新建歌单」</strong>；' : '1. Open <strong>Spotify Desktop App</strong>, click <strong>"＋ New Playlist"</strong> on the left sidebar;'}
          </div>
          <div>
            ${isZh ? '2. 点进新建的歌单页面，按键盘快捷键 <strong>Ctrl + V</strong>（Mac 上为 <strong>Cmd + V</strong>）粘贴！' : '2. Open the new playlist, press <strong>Ctrl + V</strong> (or <strong>Cmd + V</strong> on Mac) to paste!'}
          </div>
          <div style="color:#f59e0b; font-size:12px; margin-top:8px; line-height:1.6; background:#292212; padding:8px 10px; border-radius:6px; border:1px solid #4a3818;">
            ⚠️ <strong>${isZh ? '关键提示' : 'Pro-Tip'}</strong>: ${isZh ? '部分 Spotify 客户端版本要求歌单中<strong>至少先存在 1 首歌曲</strong>（歌曲列表激活后）才能响应快捷键粘贴。若空白歌单按 Ctrl+V 无反应，只需<strong>先随便添加 1 首歌曲</strong>再按 Ctrl+V 粘贴即可（或者直接在已有歌单按 Ctrl+A 全选 Delete 清空后粘贴覆盖）！' : 'Some Spotify desktop versions require at least <strong>1 existing track</strong> before the song list accepts keyboard paste. If pressing Ctrl+V does nothing, simply <strong>add 1 random song first</strong>, press Ctrl+V, then delete the temporary song!'}
          </div>
        </div>

        <button id="sp-close-clip-modal-btn" style="background:#1ed760; color:#000; font-weight:700; border:none; border-radius:500px; padding:10px 32px; font-size:14px; cursor:pointer;">
          ${isZh ? '我知道了，去 Spotify 粘贴！' : 'Got it, Open Spotify & Paste!'}
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
      sub.innerHTML = `${this.isZh() ? '歌单：' : 'Playlist: '}<strong>${this.escapeHtml(this.currentPlaylistData.name)}</strong> · Snapshot: <code>${snap}...</code>`;
    }

    // Update Summary Bar
    const summaryBar = document.getElementById('sp-sorter-summary-bar');
    const { stats } = this.sortResult;
    const moveRate = stats.total > 0 ? Math.round((stats.changedCount / stats.total) * 100) : 0;

    summaryBar.innerHTML = `
      <div class="sp-stat-card">
        <div class="sp-stat-value">${stats.total}</div>
        <div class="sp-stat-label">${this.isZh() ? '总曲目数' : 'Total Tracks'}</div>
      </div>
      <div class="sp-stat-card">
        <div class="sp-stat-value">${stats.multiArtistCount} ${this.isZh() ? '位' : ''}</div>
        <div class="sp-stat-label">${this.isZh() ? '多曲聚合歌手' : 'Multi-Track Artists'}</div>
      </div>
      <div class="sp-stat-card">
        <div class="sp-stat-value">${stats.singleArtistCount} ${this.isZh() ? '位' : ''}</div>
        <div class="sp-stat-label">${this.isZh() ? '单曲歌手 (末尾 A-Z)' : 'Single Artists (Sunk A-Z)'}</div>
      </div>
      <div class="sp-stat-card">
        <div class="sp-stat-value" style="color: ${stats.changedCount > 0 ? '#1db954' : '#fff'};">
          ${stats.changedCount} <span style="font-size:12px; font-weight:normal;">(${moveRate}%)</span>
        </div>
        <div class="sp-stat-label">${this.isZh() ? '位置将调整' : 'Tracks Moved'}</div>
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
    const isZh = this.isZh();

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
        <div class="sp-viz-pill ${isActive ? 'active' : ''}" data-artist="${this.escapeHtml(g.artistName)}" title="${isZh ? `点击仅查看 ${this.escapeHtml(g.artistName)} 的所有歌曲 (${g.items.length} 首)` : `Click to filter by ${this.escapeHtml(g.artistName)} (${g.items.length} tracks)`}">
          <div class="sp-viz-fill" style="width: ${barWidth}%;"></div>
          <div class="sp-viz-content">
            <span class="sp-viz-rank">${rankBadge}</span>
            <span class="sp-viz-name">${this.escapeHtml(g.artistName)}</span>
            <span class="sp-viz-count">${g.items.length}${isZh ? '首' : ''} <small>(${pct}%)</small></span>
          </div>
        </div>
      `;
    }).join('');

    // 2. Filter & Search Controls
    const isFiltered = !!this.selectedArtistFilter || !!this.artistSearchQuery;
    let filterLabel = '';
    if (this.selectedArtistFilter) {
      if (this.selectedArtistFilter === '__top10') filterLabel = isZh ? 'Top 10 歌手' : 'Top 10 Artists';
      else if (this.selectedArtistFilter === '__gte5') filterLabel = isZh ? '5首及以上歌手' : '5+ Tracks Artists';
      else if (this.selectedArtistFilter === '__2to4') filterLabel = isZh ? '2-4首歌手' : '2-4 Tracks Artists';
      else if (this.selectedArtistFilter === '__single') filterLabel = isZh ? '单曲歌手' : 'Single-Track Artists';
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
      groupsHtml += `<div class="sp-section-heading">🔥 ${isZh ? `聚合歌手组 (${displayMulti.length} 位 · 歌曲数降序排列)` : `Grouped Artists (${displayMulti.length} · Track Count Descending)`}</div>`;
      for (const group of displayMulti) {
        groupsHtml += this.renderGroupCard(group, false);
      }
    }

    if (displaySingle.length > 0) {
      groupsHtml += `<div class="sp-section-heading" style="margin-top: 20px;">🎵 ${isZh ? `单曲歌手组 (${displaySingle.length} 位 · 统一汇总于歌单末尾，按歌手 A-Z 排序)` : `Single-Track Artists (${displaySingle.length} · Grouped at end, sorted A-Z)`}</div>`;
      for (const group of displaySingle) {
        groupsHtml += this.renderGroupCard(group, true);
      }
    }

    if (displayMulti.length === 0 && displaySingle.length === 0) {
      groupsHtml = `<div class="sp-sorter-empty" style="padding:40px 20px;">${isZh ? '未找到匹配的歌手或歌曲。' : 'No matching artists or tracks found.'}<br><button id="sp-clear-filter-empty-btn" class="sp-sorter-btn sp-sorter-btn-secondary" style="margin-top:14px;">✖️ ${isZh ? '显示全部歌手' : 'Show All Artists'}</button></div>`;
    }

    container.innerHTML = `
      <div class="sp-viz-container">
        <div class="sp-viz-header">
          <div class="sp-viz-title">📊 ${isZh ? `歌手歌曲数量分布与占比可视化 (共 ${multiTrackGroups.length} 位聚合歌手)` : `Artist Distribution & Share (${multiTrackGroups.length} grouped artists)`}</div>
          ${isFiltered ? `<button id="sp-clear-filter-btn" class="sp-filter-clear-btn">✖️ ${isZh ? '清除筛选 (显示全部)' : 'Clear Filter'}</button>` : ''}
        </div>
        <div class="sp-viz-grid">
          ${vizCards}
        </div>

        <div class="sp-filter-toolbar">
          <div class="sp-search-box">
            <span class="sp-search-icon">🔍</span>
            <input id="sp-artist-search-input" type="text" placeholder="${isZh ? '输入歌手姓名或歌名快速筛选...' : 'Search by artist or track title...'}" value="${this.escapeHtml(this.artistSearchQuery)}" />
            ${this.artistSearchQuery ? `<button id="sp-search-clear-btn" class="sp-search-clear">&times;</button>` : ''}
          </div>
          <div class="sp-filter-tags">
            <button class="sp-tag-btn ${!this.selectedArtistFilter && !this.artistSearchQuery ? 'active' : ''}" data-tag="all">${isZh ? `全部 (${multiTrackGroups.length + singleTrackGroups.length}位)` : `All (${multiTrackGroups.length + singleTrackGroups.length})`}</button>
            <button class="sp-tag-btn ${this.selectedArtistFilter === '__top10' ? 'active' : ''}" data-tag="top10">${isZh ? '🔥 Top 10 巨头' : '🔥 Top 10'}</button>
            <button class="sp-tag-btn ${this.selectedArtistFilter === '__gte5' ? 'active' : ''}" data-tag="gte5">${isZh ? '✨ 5首及以上' : '✨ 5+ Tracks'}</button>
            <button class="sp-tag-btn ${this.selectedArtistFilter === '__2to4' ? 'active' : ''}" data-tag="2to4">${isZh ? '🎵 2-4首' : '🎵 2-4 Tracks'}</button>
            <button class="sp-tag-btn ${this.selectedArtistFilter === '__single' ? 'active' : ''}" data-tag="single">${isZh ? `👤 单曲歌手 (${singleTrackGroups.length}位)` : `👤 Single-Track (${singleTrackGroups.length})`}</button>
          </div>
        </div>

        ${isFiltered ? `<div class="sp-active-filter-bar">📌 ${isZh ? `当前筛选：<strong>${this.escapeHtml(filterLabel)}</strong> (共展示 ${displayMulti.length + displaySingle.length} 位歌手)` : `Current Filter: <strong>${this.escapeHtml(filterLabel)}</strong> (${displayMulti.length + displaySingle.length} artists)`}</div>` : ''}
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
    const isZh = this.isZh();
    const count = group.items.length;
    const badge = isSingle
      ? `<span class="sp-badge sp-badge-single">${isZh ? '单曲歌手' : 'Single Track'}</span>`
      : `<span class="sp-badge sp-badge-multi">${count} ${isZh ? '首歌曲' : 'Tracks'}</span>`;

    const rows = group.items.map((item, idx) => {
      const diffItem = this.sortResult.diff.find(d => d.item === item);
      const newIdx = diffItem ? diffItem.newIndex + 1 : idx + 1;
      const oldIdx = item.originalIndex + 1;

      let shiftBadge = '';
      if (newIdx === oldIdx) {
        shiftBadge = `<span class="sp-shift sp-shift-same">= ${isZh ? '保持' : 'Kept'}</span>`;
      } else if (newIdx < oldIdx) {
        shiftBadge = `<span class="sp-shift sp-shift-up">↑ ${isZh ? '前移' : 'Up'} ${oldIdx - newIdx}</span>`;
      } else {
        shiftBadge = `<span class="sp-shift sp-shift-down">↓ ${isZh ? '后移' : 'Down'} ${newIdx - oldIdx}</span>`;
      }

      const allArtists = item.artists.map(a => a.name).join(', ');
      const featTag = item.artists.length > 1
        ? `<span class="sp-feat-tag" title="${isZh ? `合作/feat. 歌曲：${allArtists}` : `Collaboration / Feat: ${allArtists}`}">${isZh ? 'feat.' : 'feat.'}</span>`
        : '';

      return `
        <div class="sp-track-row">
          <div class="sp-col-pos">#${newIdx} <span class="sp-old-pos">(${isZh ? '原' : 'was'} #${oldIdx})</span></div>
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
    const isZh = this.isZh();
    const { diff } = this.sortResult;

    const rows = diff.map(d => {
      const newIdx = d.newIndex + 1;
      const oldIdx = d.originalIndex + 1;

      let shiftBadge = '';
      if (newIdx === oldIdx) {
        shiftBadge = `<span class="sp-shift sp-shift-same">= ${isZh ? '保持' : 'Kept'}</span>`;
      } else if (newIdx < oldIdx) {
        shiftBadge = `<span class="sp-shift sp-shift-up">↑ ${isZh ? '前移' : 'Up'} ${oldIdx - newIdx}</span>`;
      } else {
        shiftBadge = `<span class="sp-shift sp-shift-down">↓ ${isZh ? '后移' : 'Down'} ${newIdx - oldIdx}</span>`;
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
            <th style="width: 60px;">${isZh ? '新位置' : 'New #'}</th>
            <th style="width: 100px;">${isZh ? '位移变动' : 'Shift'}</th>
            <th style="width: 60px;">${isZh ? '原位置' : 'Orig #'}</th>
            <th>${isZh ? '歌曲名称' : 'Track Title'}</th>
            <th>${isZh ? '归属歌手' : 'Assigned Artist'}</th>
            <th>${isZh ? '参与艺人' : 'All Artists'}</th>
            <th>${isZh ? '专辑' : 'Album'}</th>
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

  showLoadingOverlay(show, text = null) {
    const overlay = document.getElementById('sp-sorter-loading-overlay');
    const label = document.getElementById('sp-sorter-loading-text');
    const bar = document.getElementById('sp-sorter-progress-bar');
    if (overlay) {
      overlay.style.display = show ? 'flex' : 'none';
      const defaultText = this.isZh() ? '正在处理...' : 'Processing...';
      if (label) label.innerText = text || defaultText;
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
    const isZh = this.isZh();

    if (!isOfficial) {
      this.handleCopyClipboardFlow();
      return;
    }

    const { sortedItems, stats } = this.sortResult;
    const sortedUris = sortedItems.map(i => i.trackUri).filter(Boolean);

    if (sortedUris.length !== sortedItems.length) {
      this.showToast(isZh ? '检测到部分曲目 URI 异常，操作已终止。' : 'Detected invalid track URIs, operation aborted.', 'error');
      return;
    }

    const confirmMsg = isZh
      ? `确认将当前歌单内 ${stats.total} 首歌曲按照选定规则重新排序？\n\n` +
        `• 变动歌曲：${stats.changedCount} 首\n` +
        `• 排序前原顺序将自动备份，支持一键 Undo 撤销。`
      : `Are you sure you want to sort all ${stats.total} tracks in this playlist?\n\n` +
        `• Tracks moved: ${stats.changedCount}\n` +
        `• Original order will be backed up for 1-click Undo.`;

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

    this.showLoadingOverlay(true, isZh ? '正在安全写入 Spotify 歌单 (快照校验中)...' : 'Writing sorted tracks to Spotify (verifying snapshot)...');

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
      this.showToast(isZh ? `🎉 歌单重排成功！已成功写回 ${res.totalUpdated} 首歌曲。` : `🎉 Playlist sorted! Successfully updated ${res.totalUpdated} tracks.`, 'success');

      this.currentPlaylistData.snapshot_id = res.snapshotId;
      this.updateUndoButtonState();

      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('spotify-sorter-updated', { detail: { playlistId: this.currentPlaylistId } }));
      }, 500);

    } catch (err) {
      this.showLoadingOverlay(false);
      this.showToast(isZh ? `写回失败: ${err.message}` : `Update failed: ${err.message}`, 'error');
      console.error('[SpotifySorter]', err);
    }
  }

  async handleUndo() {
    const isZh = this.isZh();
    const record = this.history.getLatestHistory(this.currentPlaylistId);
    if (!record) {
      this.showToast(isZh ? '未找到该歌单的历史备份快照。' : 'No snapshot found for this playlist.', 'warning');
      return;
    }

    const dateStr = new Date(record.timestamp).toLocaleString();
    const confirmMsg = isZh
      ? `是否确认将歌单恢复至 [${dateStr}] 排序前的原状态？\n\n共 ${record.originalUris.length} 首歌曲将被恢复至原顺序。`
      : `Restore playlist to snapshot from [${dateStr}]?\n\nAll ${record.originalUris.length} tracks will be restored to their original positions.`;

    if (!window.confirm(confirmMsg)) {
      return;
    }

    const token = this.tokenManager.getToken();
    this.showLoadingOverlay(true, isZh ? '正在恢复排序前状态...' : 'Restoring original playlist order...');

    try {
      const currentInfo = await this.api.getPlaylist(this.currentPlaylistId, token);

      await this.api.updatePlaylistTracks(
        this.currentPlaylistId,
        currentInfo.snapshot_id,
        record.originalUris,
        token,
        ({ message, percent }) => {
          this.updateLoadingProgress(isZh ? `正在恢复原顺序: ${message}` : `Restoring tracks: ${message}`, percent);
        }
      );

      this.history.popHistory(this.currentPlaylistId);
      this.showLoadingOverlay(false);
      this.showToast(isZh ? '✅ 撤销成功！歌单已完整恢复至排序前状态。' : '✅ Restored! Playlist order recovered to previous snapshot.', 'success');

      await this.loadPlaylistData();
    } catch (err) {
      this.showLoadingOverlay(false);
      this.showToast(isZh ? `撤销失败: ${err.message}` : `Restore failed: ${err.message}`, 'error');
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SpotifySorterUI
  };
} else if (typeof window !== 'undefined') {
  window.SpotifySorterUI = SpotifySorterUI;
}
