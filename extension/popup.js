/**
 * popup.js
 * Controls extension popup state and modal launch.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const statusBox = document.getElementById('status-box');
  const actionBtn = document.getElementById('action-btn');
  const openBtn = document.getElementById('open-spotify-btn');

  // Query Tab State
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let isSpotifyPlaylist = false;

  if (tab && tab.url && tab.url.includes('open.spotify.com')) {
    isSpotifyPlaylist = /open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/.test(tab.url);
    if (isSpotifyPlaylist) {
      statusBox.innerHTML = '<span style="color: #1db954; font-weight:700;">● Connected to Spotify Playlist</span><br><span style="color:#aaa;">Click button below to start sorting. / 点击下方按钮开始排序。</span>';
      actionBtn.style.display = 'flex';
      actionBtn.innerText = '🚀 Open Playlist Sorter';
    } else {
      statusBox.innerHTML = '<span style="color: #f59e0b; font-weight:700;">● On Spotify, but not in a playlist</span><br><span style="color:#aaa;">Please open a playlist page. / 请在网页中进入歌单。</span>';
      actionBtn.innerText = 'Open a playlist page to sort';
      actionBtn.disabled = true;
      actionBtn.style.opacity = '0.6';
    }
  } else {
    statusBox.innerHTML = '<span style="color: #888888; font-weight:700;">● Not on Spotify</span><br><span style="color:#aaa;">Click button below to open Spotify Web Player.</span>';
    actionBtn.style.display = 'none';
  }

  // Open Modal Action Button
  actionBtn.onclick = async () => {
    if (!tab || !tab.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_SORTER_MODAL' });
      window.close();
    } catch (e) {
      // Fallback via scripting
      if (chrome.scripting && chrome.scripting.executeScript) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const btn = document.getElementById('sp-action-bar-sorter-btn') || document.getElementById('sp-sorter-trigger-btn');
              if (btn) btn.click();
            }
          });
          window.close();
        } catch (err) {
          alert('Unable to connect to page script. Please refresh the page and try again! / 未能连接到页面脚本，请刷新重试！');
        }
      }
    }
  };

  openBtn.onclick = () => {
    chrome.tabs.create({ url: 'https://open.spotify.com' });
    window.close();
  };
});
