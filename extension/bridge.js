(function() {
  'use strict';

  function broadcastToken(token) {
    if (!token || typeof token !== 'string' || token.length < 25) return;
    try {
      window.postMessage({
        type: 'SPOTIFY_SORTER_INTERCEPTED_TOKEN',
        token: token.trim()
      }, '*');
      sessionStorage.setItem('spotify_sorter_access_token', token.trim());
    } catch (e) {}
  }

  function checkBearer(header) {
    if (!header || typeof header !== 'string') return;
    const match = header.match(/^Bearer\s+([a-zA-Z0-9_\-\.]+)/i);
    if (match) {
      broadcastToken(match[1]);
    }
  }

  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    let resp;
    try {
      resp = await origFetch.apply(this, args);
    } catch (err) {
      return origFetch.apply(this, args);
    }

    try {
      const [resource, config] = args;
      const url = typeof resource === 'string' ? resource : (resource?.url || '');

      // 1. Capture Authorization header
      let auth = null;
      if (config && config.headers) {
        if (config.headers instanceof Headers) {
          auth = config.headers.get('Authorization') || config.headers.get('authorization');
        } else if (typeof config.headers === 'object') {
          auth = config.headers['Authorization'] || config.headers['authorization'];
        }
      } else if (resource && typeof resource === 'object' && resource.headers) {
        if (resource.headers instanceof Headers) {
          auth = resource.headers.get('Authorization') || resource.headers.get('authorization');
        } else if (typeof resource.headers === 'object') {
          auth = resource.headers['Authorization'] || resource.headers['authorization'];
        }
      }
      checkBearer(auth);

      // 2. Intercept internal Spotify playlist GraphQL query responses
      if (url.includes('pathfinder/v1/query') || url.includes('fetchPlaylist') || url.includes('fetchPlaylistContents')) {
        const clone = resp.clone();
        clone.json().then(data => {
          const playlistV2 = data?.data?.playlistV2;
          if (playlistV2 && playlistV2.content && Array.isArray(playlistV2.content.items)) {
            window.postMessage({
              type: 'SPOTIFY_SORTER_INTERCEPTED_PLAYLIST',
              playlistName: playlistV2.name,
              totalCount: playlistV2.content.totalCount,
              items: playlistV2.content.items
            }, '*');
          }
        }).catch(() => {});
      }
    } catch (e) {}

    return resp;
  };

  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
    try {
      if (header && header.toLowerCase() === 'authorization' && value) {
        checkBearer(value);
      }
    } catch (e) {}
    return origSetHeader.apply(this, arguments);
  };

  try {
    if (window.Spicetify?.Platform?.Session?.accessToken) {
      broadcastToken(window.Spicetify.Platform.Session.accessToken);
    }
  } catch (e) {}

  // 1. Immediately discover token in sessionStorage
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      const val = sessionStorage.getItem(k);
      if (val && typeof val === 'string') {
        const match = val.match(/BQ[A-Za-z0-9_-]{40,}/);
        if (match) broadcastToken(match[0]);
      }
    }
  } catch (e) {}

  // 2. Proactively fetch session token from Spotify Web Player endpoint
  try {
    fetch('/get_access_token?reason=transport&productType=web_player', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data && data.accessToken) {
          broadcastToken(data.accessToken);
        }
      })
      .catch(() => {});
  } catch (e) {}

  console.log('[SpotifySorter] Bridge injected into MAIN world.');
})();
