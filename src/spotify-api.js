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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SpotifyApiClient,
    spotifyApi: spotifyApiClientInstance,
    sendUniversalRequest
  };
} else if (typeof window !== 'undefined') {
  window.SpotifyPlaylistSorterApi = spotifyApiClientInstance;
  window.__sendUniversalRequest = sendUniversalRequest;
}
