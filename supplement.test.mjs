import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { adaptRecord } from './import-jawiktionary.mjs';
import { evaluateSense } from './dictionary.mjs';
const raw = {
  word: '試験山',
  lang_code: 'ja',
  pos: 'name',
  senses: [{ glosses: ['テスト専用の山の説明'] }, { glosses: ['テスト専用の別の説明'] }],
};
const patch = {
  word: '試験山',
  pos: 'name',
  rawSha256: createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
  evidence: {
    url: 'https://ja.wiktionary.org/wiki/試験山',
    accessedAt: '2026-10-05',
    license: 'CC-BY-SA-4.0',
    section: '日本語 固有名詞',
    note: 'テスト専用の出典根拠',
  },
  senses: [
    { id: '1', readings: ['しけんざん'], place: true },
    { id: '2', readings: ['しけんざん'] },
  ],
};
test('reviewed supplement maps only anchored senses, retains raw and never licenses unrelated sense', () => {
  const r = adaptRecord(raw, 'fixture', 1, patch);
  assert.ok(r.entry);
  assert.deepEqual(r.raw, raw);
  assert.deepEqual(
    r.entry.senses.map((s) => evaluateSense(s).eligible),
    [true, false],
  );
  assert.equal(r.entry.senses[0].readingEvidence.method, 'reviewed-supplement');
  assert.equal(r.entry.senses[0].classificationEvidence[0].sourceUrl, patch.evidence.url);
});
test('supplements fail closed on source drift, duplicate/out-of-range scopes, invalid readings or provenance', () => {
  for (const broken of [
    { ...patch, word: '他' },
    { ...patch, rawSha256: '0'.repeat(64) },
    { ...patch, senses: [{ id: '3', readings: ['あ'] }] },
    { ...patch, senses: [patch.senses[0], patch.senses[0]] },
    { ...patch, senses: [{ id: '1', readings: ['漢字'] }] },
    { ...patch, evidence: {} },
    { ...patch, pos: 'noun' },
  ])
    assert.throws(() => adaptRecord(raw, 'fixture', 1, broken), /supplement/);
});
test('numeric sense IDs and supplements for structurally invalid raw fail closed', () => {
  assert.throws(
    () =>
      adaptRecord(raw, 'fixture', 1, {
        ...patch,
        senses: [{ id: 1, readings: ['しけんざん'], place: true }],
      }),
    /supplement/,
  );
  assert.throws(
    () => adaptRecord({ lang_code: 'ja', word: '試験山' }, 'fixture', 1, patch),
    /supplement/,
  );
});
test('reviewed exclusions are additive and narrow, with eligible siblings preserved', () => {
  const r = adaptRecord(raw, 'fixture', 1, {
    ...patch,
    senses: [{ ...patch.senses[0], excludeLabels: ['classification-conflict'] }, patch.senses[1]],
  });
  assert.equal(evaluateSense(r.entry.senses[0]).eligible, false);
  assert.ok(r.entry.senses[0].labels.includes('classification-conflict'));
  assert.throws(
    () =>
      adaptRecord(raw, 'fixture', 1, { ...patch, senses: [{ id: '1', excludeLabels: ['place'] }] }),
    /supplement/,
  );
});
test('supplementing one sense preserves untouched sibling reading provenance', () => {
  const kana = {
    word: 'あ',
    lang_code: 'ja',
    pos: 'noun',
    senses: [{ glosses: ['テスト一'] }, { glosses: ['テスト二'] }],
  };
  const p = {
    ...patch,
    word: 'あ',
    pos: 'noun',
    rawSha256: createHash('sha256').update(JSON.stringify(kana)).digest('hex'),
    senses: [{ id: '1', readings: ['い'] }],
  };
  const r = adaptRecord(kana, 'fixture', 1, p);
  assert.equal(r.entry.senses[1].readingEvidence.method, 'kana-headword');
});
