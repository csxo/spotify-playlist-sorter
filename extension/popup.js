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
      statusBox.innerHTML = '<span style="color: #1db954; font-weight:700;">● 已连接到 Spotify 歌单页面</span><br><span style="color:#aaa;">点击下方按钮直接开始排序。</span>';
      actionBtn.style.display = 'flex';
      actionBtn.innerText = '🚀 打开智能重排器';
    } else {
      statusBox.innerHTML = '<span style="color: #f59e0b; font-weight:700;">● 已打开 Spotify，但未进入歌单</span><br><span style="color:#aaa;">请在网页中点进您要排序的歌单页面。</span>';
      actionBtn.innerText = '前往歌单页面后即可排序';
      actionBtn.disabled = true;
      actionBtn.style.opacity = '0.6';
    }
  } else {
    statusBox.innerHTML = '<span style="color: #888888; font-weight:700;">● 未在 Spotify 页面</span><br><span style="color:#aaa;">请先点击下方按钮打开 Spotify 网页版。</span>';
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
              const btn = document.getElementById('sp-sorter-trigger-btn');
              if (btn) btn.click();
            }
          });
          window.close();
        } catch (err) {
          alert('未能连接到页面脚本，请刷新当前网页后再试！');
        }
      }
    }
  };

  openBtn.onclick = () => {
    chrome.tabs.create({ url: 'https://open.spotify.com' });
    window.close();
  };
});
