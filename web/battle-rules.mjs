import { normalizeReading } from '../dictionary.mjs';

export const KANA_ROWS = Object.freeze([
  'あいうえお',
  'かきくけこ',
  'さしすせそ',
  'たちつてと',
  'なにぬねの',
  'はひふへほ',
  'まみむめも',
  'や ゆ よ',
  'らりるれろ',
  'わ を ん',
]);
export const KANA = Object.freeze([...KANA_ROWS.join('').replaceAll(' ', '')]);
export const TURN_SECONDS = Object.freeze([30, 60, 120, 180]);
const small = Object.fromEntries(
  [...'ぁぃぅぇぉっゃゅょゎゕゖ'].map((c, i) => [c, [...'あいうえおつやゆよわかけ'][i]]),
);
/**
 * 文字消費用に濁点・半濁点と小書きを清音・大書きへまとめる。
 * @param {string} char 1文字のかな。
 * @returns {string|undefined} 消費する基底かな。長音の無料扱いはinspectDraftで行う。
 */
export function baseKana(char) {
  const plain = char?.normalize('NFD').replace(/[\u3099\u309a]/gu, '');
  return small[plain] ?? plain;
}
/**
 * 次の先頭かなを求める。末尾の連続長音を飛ばし、小書きだけを大書きにする。
 * @param {string} reading 入力規則を満たす読み。
 * @returns {string|null} 濁点を保った先頭かな。「んー」や長音だけならnull。
 */
export function nextStart(reading) {
  const chars = [...reading];
  let last = chars.at(-1);
  if (last === 'ー') {
    last = chars.findLast((c) => c !== 'ー');
    // 長音に隠れた「ん」末尾は従来どおり拒否する。
    if (last === 'ん') return null;
  }
  return small[last] ?? last ?? null;
}
/**
 * 辞書を参照せず、読み・先頭・既使用読みと2文字目以降の文字消費を検査する。
 * @param {string} input 正規化済みのひらがな（最大64文字）。
 * @param {object} context start/pool/usedReadings。incompleteなら編集中として1文字を許す。
 * @returns {{ok: boolean, reason: string|null, reading: string|null, consumed: string[]}} consumedは検査済みの文字。失敗時は消費確定に使わない。
 */
export function inspectDraft(input, { start, pool, usedReadings = [], incomplete = false }) {
  const reading = normalizeReading(input);
  const consumed = [];
  const fail = (reason) => ({ ok: false, reason, reading, consumed });
  if (!reading || reading !== input || reading.length > 64) return fail('invalid-reading');
  if (reading[0] !== start) return fail('wrong-start');
  if (!incomplete && reading.length < 2) return fail('too-short');
  if (usedReadings.includes(reading)) return fail('used-reading');
  for (const char of [...reading].slice(1)) {
    if (char === 'ー') continue;
    const key = baseKana(char);
    if (!KANA.includes(key)) return fail('invalid-reading');
    if (consumed.includes(key)) return fail('duplicate-kana');
    if (!pool.includes(key)) return fail('used-kana');
    consumed.push(key);
  }
  if (!nextStart(reading)) return fail('invalid-ending');
  return { ok: true, reason: null, reading, consumed };
}
/**
 * 独立した文字プールを持つready状態を作る。
 * @param {object} [settings] mode/seconds/firstPlayer/start。各値は既定の選択肢に限定する。
 * @returns {object} 初期ゲーム状態。
 * @throws {TypeError} 設定が不正な場合。
 */
export function createGame({
  mode = 'individual',
  seconds = 30,
  firstPlayer = 0,
  start = 'か',
} = {}) {
  if (
    !['individual', 'shared'].includes(mode) ||
    !TURN_SECONDS.includes(seconds) ||
    ![0, 1].includes(firstPlayer) ||
    !KANA.includes(start) ||
    ['ん', 'を'].includes(start)
  )
    throw new TypeError('invalid game settings');
  return {
    phase: 'ready',
    turn: firstPlayer,
    start,
    pools: [[...KANA], [...KANA]],
    usedReadings: [],
    history: [],
    winner: null,
    reason: null,
    mode,
    seconds,
  };
}
/**
 * 辞書で採用可能な手を複製した状態へ確定する。元のgame・候補を変更しない。
 * @param {object} game checking状態のゲーム。
 * @param {object} move reading/candidates/version/sources。語義と辞書版を履歴へ保存する。
 * @returns {object} successまたは「ん」負けのfinished状態。「ん」負けでは文字を消費しない。
 * @throws {Error} 状態・辞書採否・入力規則が確定条件を満たさない場合。
 */
export function applyAccepted(game, { reading, candidates, version, sources }) {
  if (game.phase !== 'checking' || !candidates.some((c) => c.eligible))
    throw new Error('move cannot be committed');
  const check = inspectDraft(reading, {
    start: game.start,
    pool: game.pools[game.turn],
    usedReadings: game.usedReadings,
  });
  if (!check.ok) throw new Error(check.reason);
  const n = structuredClone(game);
  const loses = reading.endsWith('ん');
  n.history.push({
    player: game.turn,
    reading,
    candidates: structuredClone(candidates),
    version,
    sources: structuredClone(sources ?? []),
    consumed: loses ? [] : check.consumed,
    outcome: loses ? 'n-ending' : 'accepted',
  });
  if (loses) {
    n.phase = 'finished';
    n.reason = 'n-ending';
    n.winner = 1 - game.turn;
    return n;
  }
  n.pools[n.turn] = n.pools[n.turn].filter((c) => !check.consumed.includes(c));
  if (n.mode === 'shared') n.pools[1 - n.turn] = [...n.pools[n.turn]];
  n.usedReadings.push(reading);
  n.start = nextStart(reading);
  n.phase = 'success';
  return n;
}
