/**
 * i18n.js
 * Internationalization (i18n) module for Spotify Playlist Auto Sorter.
 * Supports English ('en') and Simplified Chinese ('zh').
 * Automatically detects browser language and allows manual toggle.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const exports = factory();
    root.SpotifySorterI18n = exports;
    root.t = exports.t;
    root.getLanguage = exports.getLanguage;
    root.setLanguage = exports.setLanguage;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'spotify_sorter_lang';

  const MESSAGES = {
    en: {
      appName: 'Spotify Playlist Auto Sorter',
      sortPlaylist: 'Sort Playlist',
      openSorterTooltip: 'Open Spotify Playlist Auto Sorter',
      langToggle: '中文',
      close: 'Close',
      cancel: 'Cancel',
      confirm: 'Confirm',
      save: 'Save',
      reset: 'Reset Defaults',
      apply: 'Apply Rules',

      // Notifications / Toasts
      notPlaylistWarning: 'Please open a Spotify playlist page with edit permissions first!',
      scanSuccess: 'Scan complete: loaded {count} tracks!',
      scanFailed: 'Failed to scan playlist tracks. Please check connection and try again.',
      copySuccess: 'Track list copied to clipboard! Paste into Spotify Desktop app.',
      copyFailed: 'Failed to copy to clipboard. Please copy manually.',
      rulesSaved: 'Sorting rules updated and applied!',
      undoSuccess: 'Restored previous state.',
      nothingToUndo: 'No previous operations to undo.',
      exportSuccess: 'Exported JSON successfully.',
      dedupApplied: 'Deduplication applied: removed {count} duplicate tracks.',

      // Loading Overlay
      loadingTitle: 'Scanning playlist tracks...',
      loadingProgress: 'Loading tracks: {loaded} / {total} ({percent}%)',
      loadingPleaseWait: 'Fetching tracks... Please wait.',
      fetchingMissing: 'Scanning remaining tracks ({count} missing)...',
      loadingDone: 'Done!',

      // Modal Header & Tabs
      playlistTitle: 'Playlist: {name} ({count} tracks)',
      tabGrouped: 'Grouped by Artist',
      tabFlat: 'Flat List',
      btnRules: 'Sort Rules',
      btnDedup: 'Deduplicate',
      btnCopy: 'Copy Tracks',
      btnCopied: 'Copied!',
      btnExportJson: 'Export JSON',
      btnRestoreOrder: 'Original Order',
      btnShowDiff: 'Toggle Diff',

      // Artist Dashboard / Filter
      searchArtistPlaceholder: 'Search artist name...',
      allArtists: 'All Artists',
      artistTrackCount: '{count} tracks ({pct}%)',
      filterActive: 'Filtering by: {artist}. Click to clear.',
      clearFilter: 'Clear Filter',

      // Track Item / List
      unknownArtist: 'Unknown Artist',
      unknownTrack: 'Unknown Track',
      album: 'Album',
      releaseDate: 'Released',
      duration: 'Duration',
      posDiffUp: 'Moved up {diff} positions',
      posDiffDown: 'Moved down {diff} positions',
      posUnchanged: 'Position unchanged',

      // Rules Drawer
      rulesDrawerTitle: '10 Professional Sorting Rules Configuration',
      rule1Title: 'Rule 1: Group by Artist',
      rule1Desc: 'Group all songs by the same artist together into continuous clusters.',
      rule2Title: 'Rule 2: Artist Order Mode',
      rule2OptCountDesc: 'Track count descending (Most songs first)',
      rule2OptAz: 'Alphabetical A-Z by artist name',
      rule3Title: 'Rule 3: Tie-Breaker for Equal Track Counts',
      rule3OptAz: 'Alphabetical A-Z by artist name',
      rule3OptDefault: 'Keep original playlist order',
      rule4Title: 'Rule 4: Single-Track Artists Strategy',
      rule4OptSink: 'Sink all single-song artists to the bottom',
      rule4OptNormal: 'Keep single-song artists in main ranking',
      rule5Title: 'Rule 5: Intra-Artist Track Order',
      rule5OptAz: 'Track title A-Z',
      rule5OptYearDesc: 'Release year (Newest to Oldest)',
      rule5OptYearAsc: 'Release year (Oldest to Newest)',
      rule5OptAlbum: 'Album name A-Z',
      rule5OptOriginal: 'Keep original order',
      rule6Title: 'Rule 6: Feat. & Collaboration Attribution',
      rule6OptFrequent: 'Attribute to the artist with the most songs in playlist',
      rule6OptFirst: 'Attribute strictly to the first main artist',
      rule7Title: 'Rule 7: Smart Duplicate Detection',
      rule7OptPrompt: 'Prompt on duplicates (Manual review)',
      rule7OptAuto: 'Auto remove duplicates (Keep first)',
      rule7OptKeep: 'Keep all duplicates',
      rule8Title: 'Rule 8: Ignore Special Characters & Brackets',
      rule8Desc: 'Ignore brackets, quotes, and punctuation during A-Z sorting (e.g. "(The)", "【...】").',
      rule9Title: 'Rule 9: Single-Track Artists Sunk Sorting',
      rule9OptArtistAz: 'Artist name A-Z',
      rule9OptTitleAz: 'Track title A-Z',
      rule10Title: 'Rule 10: Position Displacement Tracking',
      rule10Desc: 'Show index shifts (e.g. #15 -> #3, +12) comparing original and sorted positions.',

      // Deduplication Modal
      dedupTitle: 'Smart Duplicate Tracks Management',
      dedupSummary: 'Found {groups} duplicate groups ({count} tracks total)',
      dedupExact: 'Exact Match (Same title & artist)',
      dedupVersion: 'Version / Remix / Live Match',
      keepFirst: 'Keep First',
      keepAll: 'Keep All',
      removeSelected: 'Remove Selected',
      noDuplicates: 'No duplicate tracks detected! Your playlist is clean.',

      // Paste Guide Modal
      pasteModalTitle: 'Track List Copied to Clipboard!',
      pasteModalSubtitle: 'Follow these 3 easy steps to paste into Spotify Desktop App:',
      step1Title: '1. Create New Playlist',
      step1Desc: 'Open Spotify Desktop App, click "+" or "Create playlist" on the left sidebar.',
      step2Title: '2. Select Playlist Area',
      step2Desc: 'Click anywhere inside the new playlist\'s song list area to focus.',
      step3Title: '3. Paste Tracks',
      step3Desc: 'Press Ctrl + V (Windows) or Cmd + V (Mac) to paste all sorted tracks instantly!',
      tip0Track: '💡 Pro-Tip: If pasting into an empty playlist doesn\'t respond on certain client versions, simply add 1 random song into the new playlist first to initialize it, paste your sorted tracks, then delete the temporary song.',
      gotIt: 'Got it, Open Spotify Desktop App!'
    },

    zh: {
      appName: 'Spotify 歌单智能重排器',
      sortPlaylist: '排序歌单',
      openSorterTooltip: '打开 Spotify 歌单智能重排器',
      langToggle: 'EN',
      close: '关闭',
      cancel: '取消',
      confirm: '确认',
      save: '保存',
      reset: '恢复默认',
      apply: '保存并应用',

      // Notifications / Toasts
      notPlaylistWarning: '请先打开一个拥有编辑权限的 Spotify 歌单页面！',
      scanSuccess: '曲目读取成功，共获取 {count} 首曲目！',
      scanFailed: '读取歌单曲目失败，请检查网络后重试。',
      copySuccess: '曲目列表已成功复制到剪贴板！请前往桌面客户端粘贴。',
      copyFailed: '复制到剪贴板失败，请手动复制。',
      rulesSaved: '重排规则已更新并重新应用！',
      undoSuccess: '已撤销上一次操作。',
      nothingToUndo: '没有可撤销的历史记录。',
      exportSuccess: '导出 JSON 成功。',
      dedupApplied: '已应用去重：共移除 {count} 首重复曲目。',

      // Loading Overlay
      loadingTitle: '正在极速读取歌单全量曲目...',
      loadingProgress: '正在读取曲目: {loaded} / {total} 首 ({percent}%)',
      loadingPleaseWait: '正在读取曲目...请稍候',
      fetchingMissing: '正在补漏缺失曲目 ({count} 首未抓取)...',
      loadingDone: '完成！',

      // Modal Header & Tabs
      playlistTitle: '歌单: {name} ({count} 首)',
      tabGrouped: '歌手聚合视图',
      tabFlat: '平铺列表视图',
      btnRules: '规则配置',
      btnDedup: '智能去重',
      btnCopy: '一键复制曲目列表',
      btnCopied: '已复制!',
      btnExportJson: '导出 JSON',
      btnRestoreOrder: '原始顺序',
      btnShowDiff: '位移对比',

      // Artist Dashboard / Filter
      searchArtistPlaceholder: '搜索歌手名称...',
      allArtists: '全部歌手',
      artistTrackCount: '{count} 首曲目 ({pct}%)',
      filterActive: '正在筛选歌手: {artist}，点击清除筛选。',
      clearFilter: '清除筛选',

      // Track Item / List
      unknownArtist: '未知歌手',
      unknownTrack: '未知曲目',
      album: '专辑',
      releaseDate: '发行',
      duration: '时长',
      posDiffUp: '提前 {diff} 位',
      posDiffDown: '延后 {diff} 位',
      posUnchanged: '位置未变',

      // Rules Drawer
      rulesDrawerTitle: '10 大专业排序规则全自由配置',
      rule1Title: '规则 1: 同歌手全聚合',
      rule1Desc: '将歌单中同一位歌手的所有歌曲集中连续放置。',
      rule2Title: '规则 2: 聚合歌手排序依据',
      rule2OptCountDesc: '按歌曲数量降序（作品最多的歌手排最前）',
      rule2OptAz: '按歌手名首字母/拼音 A-Z',
      rule3Title: '规则 3: 相同歌曲数量排序依据',
      rule3OptAz: '按歌手名首字母/拼音 A-Z',
      rule3OptDefault: '保持歌单原始先后顺序',
      rule4Title: '规则 4: 单曲歌手置底策略',
      rule4OptSink: '仅有 1 首歌的冷门/单曲歌手统一置底',
      rule4OptNormal: '正常参与主排序（不置底）',
      rule5Title: '规则 5: 同歌手内部曲目排序',
      rule5OptAz: '按歌名拼音 / 英文 A-Z',
      rule5OptYearDesc: '按发行年份（由新到旧）',
      rule5OptYearAsc: '按发行年份（由旧到新）',
      rule5OptAlbum: '按所属专辑名 A-Z',
      rule5OptOriginal: '保持原始顺序',
      rule6Title: '规则 6: 合唱 / Feat. 歌曲归属',
      rule6OptFrequent: '归入当前歌单歌曲量最多的主导歌手',
      rule6OptFirst: '严格按第一主唱归属',
      rule7Title: '规则 7: 重复歌曲检测与去重',
      rule7OptPrompt: '检测到重复时弹窗提示并手动审核',
      rule7OptAuto: '自动去除重复曲目（保留首个版本）',
      rule7OptKeep: '保留所有重复曲目',
      rule8Title: '规则 8: 忽略标点符号与特殊字符',
      rule8Desc: '排序 A-Z 时自动忽略开头的括号、引号与标点符号（如 "(The)"、"【...】"）。',
      rule9Title: '规则 9: 单曲歌手置底排序',
      rule9OptArtistAz: '置底歌手姓名 A-Z',
      rule9OptTitleAz: '置底歌曲名称 A-Z',
      rule10Title: '规则 10: 曲目位移追踪与对比',
      rule10Desc: '在列表中显示原序号与排序后的位移变化对比（如 #15 -> #3，提前 12 位）。',

      // Deduplication Modal
      dedupTitle: '智能去重管理模块',
      dedupSummary: '共检测出 {groups} 组疑似重复曲目（涉及 {count} 首曲目）',
      dedupExact: '精准重复（同歌名且同歌手）',
      dedupVersion: '版本 / Live / Remix 重复',
      keepFirst: '保留首个',
      keepAll: '全部保留',
      removeSelected: '移除勾选曲目',
      noDuplicates: '未检测到任何重复曲目，歌单非常纯净！',

      // Paste Guide Modal
      pasteModalTitle: '曲目列表已成功复制！',
      pasteModalSubtitle: '只需 3 步，秒速贴回 Spotify 桌面客户端生成新歌单：',
      step1Title: '1. 在客户端新建歌单',
      step1Desc: '打开 Spotify 电脑桌面客户端，点击左侧边栏的「+」或「创建歌单」。',
      step2Title: '2. 鼠标点击歌单空白处',
      step2Desc: '鼠标在右侧新歌单的歌曲列表空白区域点击一下以聚焦激活。',
      step3Title: '3. 一键粘贴曲目',
      step3Desc: '直接按下 Ctrl + V（Windows）或 Cmd + V（Mac），所有排序好的曲目瞬间生成！',
      tip0Track: '💡 小窍门：部分客户端对完全空白的 0 首歌单可能不响应粘贴。只需先随便拖入/添加 1 首歌激活歌单，再按快捷键粘贴，之后把临时歌曲删掉即可！',
      gotIt: '我知道了，前往桌面客户端粘贴！'
    }
  };

  let currentLang = 'en';

  function detectLanguage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && (saved === 'en' || saved === 'zh')) {
        return saved;
      }
    } catch (e) {}

    if (typeof navigator !== 'undefined') {
      const navLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
      if (navLang.startsWith('zh')) {
        return 'zh';
      }
    }
    return 'en';
  }

  currentLang = detectLanguage();

  function getLanguage() {
    return currentLang;
  }

  function setLanguage(lang) {
    if (lang === 'zh' || lang === 'en') {
      currentLang = lang;
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch (e) {}
    }
    return currentLang;
  }

  function toggleLanguage() {
    return setLanguage(currentLang === 'zh' ? 'en' : 'zh');
  }

  function t(key, params) {
    const dict = MESSAGES[currentLang] || MESSAGES.en;
    let str = dict[key] || MESSAGES.en[key] || key;

    if (params && typeof params === 'object') {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }

    return str;
  }

  return {
    t,
    getLanguage,
    setLanguage,
    toggleLanguage,
    MESSAGES
  };
});
