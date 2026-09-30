/**
 * background.js - Service Worker for Spotify Playlist Sorter MV3
 * Handles CORS-free API dispatch, token synchronization across tabs, and verification.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 1. Universal Spotify API Request Relay (Bypasses CORS restrictions)
  if (message.type === 'SPOTIFY_API_REQUEST') {
    const { url, options = {}, timeoutMs = 12000 } = message;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    fetch(url, {
      ...options,
      signal: controller.signal
    })
      .then(async (resp) => {
        clearTimeout(timer);
        let data = null;
        const text = await resp.text();
        try {
          data = JSON.parse(text);
        } catch (e) {
          data = text;
        }

        const headers = {};
        resp.headers.forEach((v, k) => {
          headers[k.toLowerCase()] = v;
        });

        sendResponse({
          ok: resp.ok,
          status: resp.status,
          statusText: resp.statusText,
          headers,
          data
        });
      })
      .catch((err) => {
        clearTimeout(timer);
        const errMsg = err.name === 'AbortError'
          ? `请求超时 (${Math.round(timeoutMs / 1000)}s)，请检查网络代理`
          : (err.message || '网络连接失败');
        sendResponse({
          error: errMsg
        });
      });

    return true; // Keep message channel open for async response
  }

  // 2. Validate Token via /v1/me
  if (message.type === 'VALIDATE_TOKEN') {
    const { token } = message;
    if (!token) {
      sendResponse({ valid: false, error: '未提供凭据' });
      return false;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    fetch('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${token.trim()}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    })
      .then(async (resp) => {
        clearTimeout(timer);
        if (resp.ok) {
          const user = await resp.json();
          // Save valid token to storage
          chrome.storage.local.set({
            spotify_access_token: token.trim(),
            spotify_user_name: user.display_name || user.id,
            spotify_user_id: user.id
          });
          sendResponse({ valid: true, user });
        } else {
          let errText = `HTTP ${resp.status}`;
          try {
            const errObj = await resp.json();
            errText = errObj.error?.message || errText;
          } catch (e) {}
          sendResponse({ valid: false, status: resp.status, error: errText });
        }
      })
      .catch((err) => {
        clearTimeout(timer);
        sendResponse({ valid: false, error: err.message || '网络超时' });
      });

    return true;
  }

  // 3. Save Token and Broadcast to Active Spotify Tabs
  if (message.type === 'SPOTIFY_SORTER_SAVE_TOKEN') {
    const { token } = message;
    if (token) {
      chrome.storage.local.set({ spotify_access_token: token.trim() }, () => {
        // Broadcast to all open.spotify.com tabs
        chrome.tabs.query({ url: '*://open.spotify.com/*' }, (tabs) => {
          for (const tab of tabs) {
            try {
              chrome.tabs.sendMessage(tab.id, {
                type: 'SPOTIFY_SORTER_TOKEN_SYNC',
                token: token.trim()
              });
            } catch (e) {}
          }
        });
      });
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false });
    }
    return false;
  }
});
