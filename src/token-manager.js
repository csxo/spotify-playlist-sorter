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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TokenManager,
    tokenManager: tokenManagerInstance
  };
} else if (typeof window !== 'undefined') {
  window.SpotifyPlaylistSorterTokenManager = tokenManagerInstance;
}
