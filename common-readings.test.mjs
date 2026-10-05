// Source-pinned metadata regression; full definitions are verified by verify-corpus.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const supplement = JSON.parse(
  await readFile(new URL('./supplement.json', import.meta.url), 'utf8'),
);
const cases = [
  ['甲羅', 402337, 'こうら', 3, []],
  ['胡麻', 207997, 'ごま', 3, [3]],
  ['蒟蒻', 200572, 'こんにゃく', 2, []],
  ['昆布', 170595, 'こんぶ', 1, []],
  ['蜜柑', 56714, 'みかん', 1, []],
  ['餃子', 167722, 'ぎょうざ', 1, []],
  ['饅頭', 107843, 'まんじゅう', 2, []],
  ['鸚鵡', 18947, 'おうむ', 2, [2]],
  ['切符', 61010, 'きっぷ', 3, []],
  ['茶碗', 74163, 'ちゃわん', 2, []],
  ['包丁', 179810, 'ほうちょう', 5, []],
];
for (const [word, line, reading, count, excluded] of cases)
  test(`reviewed common reading: ${word} keeps source scope and exclusions`, () => {
    const p = supplement.records.find((p) => p.line === line);
    assert.ok(p, `missing supplement for ${word}`);
    assert.equal(p.word, word);
    assert.equal(p.pos, 'noun');
    assert.match(p.rawSha256, /^[a-f0-9]{64}$/);
    assert.ok(p.evidence.url.startsWith('https://ja.wiktionary.org/'));
    assert.equal(p.evidence.license, 'CC-BY-SA-4.0');
    assert.deepEqual(
      p.senses.map((s) => s.id),
      Array.from({ length: count }, (_, i) => String(i + 1)),
    );
    for (const s of p.senses) {
      assert.deepEqual(s.readings, [reading]);
      assert.deepEqual(
        s.excludeLabels ?? [],
        excluded.includes(Number(s.id)) ? ['abbreviation'] : [],
      );
      assert.equal(s.place, undefined);
    }
  });
test('Japanese confection reading does not leak into separate mantou reference record', () => {
  const other = supplement.records.find((p) => p.line === 107844);
  assert.ok(!other?.senses.some((s) => s.readings?.includes('まんじゅう')));
});
