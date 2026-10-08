/**
 * i18n.test.js
 * Unit tests for Internationalization (i18n) module.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const i18n = require('../src/i18n.js');

test('i18n: default language and dictionary', () => {
  const lang = i18n.getLanguage();
  assert.ok(lang === 'en' || lang === 'zh');
  assert.ok(typeof i18n.MESSAGES.en === 'object');
  assert.ok(typeof i18n.MESSAGES.zh === 'object');
});

test('i18n: setLanguage and getLanguage', () => {
  i18n.setLanguage('en');
  assert.equal(i18n.getLanguage(), 'en');
  assert.equal(i18n.t('appName'), 'Spotify Playlist Auto Sorter');
  assert.equal(i18n.t('sortPlaylist'), 'Sort Playlist');

  i18n.setLanguage('zh');
  assert.equal(i18n.getLanguage(), 'zh');
  assert.equal(i18n.t('appName'), 'Spotify 歌单智能重排器');
  assert.equal(i18n.t('sortPlaylist'), '排序歌单');
});

test('i18n: toggleLanguage', () => {
  i18n.setLanguage('en');
  i18n.toggleLanguage();
  assert.equal(i18n.getLanguage(), 'zh');
  i18n.toggleLanguage();
  assert.equal(i18n.getLanguage(), 'en');
});

test('i18n: parameter interpolation', () => {
  i18n.setLanguage('en');
  const enMsg = i18n.t('scanSuccess', { count: 42 });
  assert.equal(enMsg, 'Scan complete: loaded 42 tracks!');

  i18n.setLanguage('zh');
  const zhMsg = i18n.t('scanSuccess', { count: 42 });
  assert.equal(zhMsg, '曲目读取成功，共获取 42 首曲目！');
});

test('i18n: fallback to key on missing translation', () => {
  const missing = i18n.t('non_existent_key_123');
  assert.equal(missing, 'non_existent_key_123');
});
