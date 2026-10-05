import { baseKana } from '../battle-rules.mjs?v=20261006-maintainability1';

/**
 * 先頭を固定したまま末尾のかなだけを濁音・半濁音・小書きと切り替える。
 * @param {string} reading 入力中の読み。
 * @param {'voice'|'semi'|'small'} kind 切替操作。
 * @returns {string} 切替後の読み。先頭だけ・変換対象外なら元の読み。
 */
export function transformLastKana(reading, kind) {
  if (reading.length < 2) return reading;
  const last = reading.at(-1);
  let next = last;
  if (kind === 'small') {
    const large = 'あいうえおつやゆよわかけ',
      small = 'ぁぃぅぇぉっゃゅょゎゕゖ';
    if (large.includes(last)) next = small[large.indexOf(last)];
    else if (small.includes(last)) next = large[small.indexOf(last)];
  } else {
    const plain = baseKana(last),
      mark = kind === 'semi' ? '\u309a' : '\u3099';
    const allowed = kind === 'semi' ? 'はひふへほ' : 'かきくけこさしすせそたちつてとはひふへほう';
    if (allowed.includes(plain)) {
      const composed = (plain + mark).normalize('NFC');
      next = last === composed ? plain : composed;
    }
  }
  return reading.slice(0, -1) + next;
}
