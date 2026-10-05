import { groupCandidates } from '../candidate-groups.mjs?v=20261006-maintainability1';

/**
 * 採用可能な表示カードをまとめ、成功演出用の最大2件と履歴用の全件を返す。
 * @param {object[]} [candidates] 辞書の語義候補。
 * @param {string} [reading] 対象の読み。
 * @returns {{preview: object[], remaining: number, all: object[]}} remainingはカード数であり語義数や得点ではない。
 */
export function summarizeCandidates(candidates = [], reading) {
  const all = groupCandidates(
    candidates.filter((c) => c.eligible),
    reading,
  );
  return { preview: all.slice(0, 2), remaining: Math.max(0, all.length - 2), all };
}
