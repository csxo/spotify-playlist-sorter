/**
 * comparator.js
 * Pinyin and Locale-aware String Comparator for Chinese & Latin characters.
 */

// Pinyin initial consonant boundary reference points in CLDR / zh-Hans-CN
const PINYIN_BOUNDARIES = [
  { letter: 'A', sample: '啊' },
  { letter: 'B', sample: '芭' },
  { letter: 'C', sample: '擦' },
  { letter: 'D', sample: '搭' },
  { letter: 'E', sample: '蛾' },
  { letter: 'F', sample: '发' },
  { letter: 'G', sample: '噶' },
  { letter: 'H', sample: '哈' },
  { letter: 'J', sample: '击' },
  { letter: 'K', sample: '喀' },
  { letter: 'L', sample: '垃' },
  { letter: 'M', sample: '妈' },
  { letter: 'N', sample: '拿' },
  { letter: 'O', sample: '哦' },
  { letter: 'P', sample: '啪' },
  { letter: 'Q', sample: '期' },
  { letter: 'R', sample: '然' },
  { letter: 'S', sample: '撒' },
  { letter: 'T', sample: '塌' },
  { letter: 'W', sample: '挖' },
  { letter: 'X', sample: '昔' },
  { letter: 'Y', sample: '压' },
  { letter: 'Z', sample: '匝' }
];

const zhCollator = new Intl.Collator('zh-Hans-CN', {
  sensitivity: 'base',
  numeric: true
});

/**
 * Determine the primary sort bucket/initial letter for a string (A-Z, 0-9, or symbol).
 * Maps Chinese characters to their Pinyin initial letter (A-Z).
 */
function getSortKeyInitial(str) {
  if (!str) return '#';
  const trimmed = str.trim();
  if (!trimmed) return '#';

  const firstChar = trimmed[0];

  // Latin letter
  if (/[a-zA-Z]/.test(firstChar)) {
    return firstChar.toUpperCase();
  }

  // Digit
  if (/[0-9]/.test(firstChar)) {
    return '0-9';
  }

  // Chinese character range
  if (/[\u4e00-\u9fa5]/.test(firstChar)) {
    for (let i = PINYIN_BOUNDARIES.length - 1; i >= 0; i--) {
      if (zhCollator.compare(firstChar, PINYIN_BOUNDARIES[i].sample) >= 0) {
        return PINYIN_BOUNDARIES[i].letter;
      }
    }
    return 'A';
  }

  return '#';
}

/**
 * Universal comparator:
 * 1. Groups Latin A-Z and Chinese characters starting with the same Pinyin letter together!
 * 2. Uses zh-Hans-CN collator for precise pinyin collation of Chinese text.
 * 3. Handles numbers, symbols, case insensitivity.
 */
function compareStrings(a, b) {
  const strA = (a || '').trim();
  const strB = (b || '').trim();

  if (strA === strB) return 0;
  if (!strA) return 1;
  if (!strB) return -1;

  const initA = getSortKeyInitial(strA);
  const initB = getSortKeyInitial(strB);

  // If different initial categories (e.g. 'A' vs 'B')
  if (initA !== initB) {
    // Numbers first, then Letters A-Z, then symbols '#'
    const rank = (init) => {
      if (init === '0-9') return 0;
      if (init >= 'A' && init <= 'Z') return 1;
      return 2;
    };
    const rankA = rank(initA);
    const rankB = rank(initB);
    if (rankA !== rankB) return rankA - rankB;

    if (initA >= 'A' && initA <= 'Z' && initB >= 'A' && initB <= 'Z') {
      return initA.localeCompare(initB);
    }
  }

  // Same initial letter or category: compare using zh-Hans-CN collator
  const cmp = zhCollator.compare(strA, strB);
  if (cmp !== 0) return cmp;

  return strA.localeCompare(strB);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    compareStrings,
    getSortKeyInitial,
    zhCollator
  };
}
