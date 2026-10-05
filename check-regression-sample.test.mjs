// Synthetic fixtures only. These short definitions are test data, never corpus evidence.
// Mutations caught: omit source pin; count any homophone; ignore sense identity;
// ignore forbidden candidates; label missing controls as passed; omit normalization.
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSample } from './check-regression-sample.mjs';
const api = await import(process.env.SHIRITORI_DICTIONARY_MODULE || './dictionary.mjs');
const source = {
  id: 'synthetic-source',
  version: 'synthetic-v1',
  url: 'https://example.test/source',
  license: 'CC0',
  sha256: 'a'.repeat(64),
};
const reference = (id, senseId = '1') => ({
  entryId: id,
  senseId,
  sourceUrl: 'https://example.test/word',
});
function entry(id, spelling, reading, pos = 'noun', labels = []) {
  return {
    id,
    sourceId: source.id,
    sourceUrl: 'https://example.test/word',
    spellings: [spelling],
    readings: [reading],
    senses: [
      {
        id: '1',
        pos: [pos],
        labels,
        definitions: [{ language: 'ja', text: '合成テスト用の語義。' }],
      },
    ],
  };
}
function fixtures() {
  return {
    data: { schemaVersion: 1, sources: [structuredClone(source)], entries: [] },
    sample: {
      schemaVersion: 1,
      source: structuredClone(source),
      positiveSamples: Array.from({ length: 300 }, (_, i) => ({
        id: `p-${i}`,
        category: 'everyday',
        spelling: '未解決の試験入力',
        expectedReading: 'ぬぷぺぽ',
        expectedAcceptance: 'missing-source',
        acceptedSenseEvidence: [],
      })),
      controls: Array.from({ length: 20 }, (_, i) => ({
        id: `c-${i}`,
        spelling: '不在入力',
        input: 'ぬぷぺぽ',
        kind: 'absent-input',
        forbiddenEligibleSenses: [],
        requiredEligibleSenses: [],
        requiredLookupStatus: 'not-found',
      })),
    },
  };
}
function positive(f, spelling, reading, ref) {
  f.sample.positiveSamples[0] = {
    id: 'target',
    category: 'everyday',
    spelling,
    expectedReading: reading,
    expectedAcceptance: 'accept-source-backed',
    acceptedSenseEvidence: [ref],
  };
}
function control(f, patch) {
  f.sample.controls[0] = {
    id: 'target-control',
    spelling: '対象',
    input: 'ねこ',
    kind: 'person',
    forbiddenEligibleSenses: [],
    requiredEligibleSenses: [],
    ...patch,
  };
}

test('rejects a changed source hash before trusting source-line IDs', () => {
  const f = fixtures();
  f.data.sources[0].sha256 = 'b'.repeat(64);
  assert.throws(() => auditSample(f.data, f.sample, api), /Source snapshot mismatch/);
});
test('rejects a changed source ID even when the hash is unchanged', () => {
  const f = fixtures();
  f.data.sources[0].id = 'different-source';
  assert.throws(() => auditSample(f.data, f.sample, api), /Source snapshot mismatch/);
});
test('an eligible homophone cannot satisfy the intended source sense', () => {
  const f = fixtures();
  f.data.entries = [entry('rain', '雨', 'あめ')];
  positive(f, '飴', 'あめ', reference('candy'));
  const r = auditSample(f.data, f.sample, api).positives[0];
  assert.equal(r.anyEligibleReading, true);
  assert.equal(r.sourceBackedIntendedMeaning, false);
  assert.equal(r.strictSpellingEligibleMeaning, false);
  assert.equal(r.regression, true);
});
test('same spelling and entry do not substitute another sense for the expected sense', () => {
  const f = fixtures();
  const e = entry('same', '試験', 'しけん');
  f.data.entries = [e];
  positive(f, '試験', 'しけん', reference('same', '2'));
  const r = auditSample(f.data, f.sample, api).positives[0];
  assert.equal(r.strictSpellingEligibleMeaning, true);
  assert.equal(r.sourceBackedIntendedMeaning, false);
  assert.equal(r.regression, true);
});
test('a reviewed kana headword satisfies the intended meaning without an exact spelling link', () => {
  const f = fixtures();
  f.data.entries = [entry('cat', 'ねこ', 'ねこ')];
  positive(f, '猫', 'ねこ', reference('cat'));
  const r = auditSample(f.data, f.sample, api).positives[0];
  assert.equal(r.sourceBackedIntendedMeaning, true);
  assert.equal(r.strictSpellingEligibleMeaning, false);
  assert.equal(r.regression, false);
});
test('forbidden eligible sense leakage fails the control', () => {
  const f = fixtures();
  f.data.entries = [entry('leak', 'ねこ', 'ねこ')];
  control(f, { forbiddenEligibleSenses: [reference('leak')] });
  const r = auditSample(f.data, f.sample, api).controls[0];
  assert.equal(r.verdict, 'fail');
  assert.deepEqual(r.leakedEligibleSenses, [{ entryId: 'leak', senseId: '1' }]);
});
test('a present rejected person sense passes its rejection control', () => {
  const f = fixtures();
  f.data.entries = [entry('person', 'ねこ', 'ねこ', 'proper-noun', ['person', 'proper-name'])];
  control(f, { forbiddenEligibleSenses: [reference('person')] });
  assert.equal(auditSample(f.data, f.sample, api).controls[0].verdict, 'pass');
});
test('a missing target person sense is unexercised rather than falsely passed', () => {
  const f = fixtures();
  control(f, { forbiddenEligibleSenses: [reference('missing-person')] });
  assert.equal(
    auditSample(f.data, f.sample, api).controls[0].verdict,
    'unexercised-missing-or-ambiguous',
  );
});
test('a missing required allowed sense fails rather than becoming unexercised', () => {
  const f = fixtures();
  control(f, { requiredEligibleSenses: [reference('missing-place')] });
  const r = auditSample(f.data, f.sample, api).controls[0];
  assert.equal(r.verdict, 'fail');
  assert.equal(r.absentRequired.length, 1);
});
test('fullwidth and halfwidth kana normalize before filtering dictionary entries', () => {
  const f = fixtures();
  f.data.entries = [entry('cat', '猫', 'ネコ')];
  positive(f, '猫', 'ﾈｺ', reference('cat'));
  const r = auditSample(f.data, f.sample, api).positives[0];
  assert.equal(r.sourceBackedIntendedMeaning, true);
  assert.equal(r.lookupStatus, 'candidates');
});
test('input-validation controls check exact status, not just absent candidates', () => {
  const f = fixtures();
  control(f, { input: '東京', kind: 'invalid-input', requiredLookupStatus: 'invalid-reading' });
  assert.equal(auditSample(f.data, f.sample, api).controls[0].verdict, 'pass');
  f.sample.controls[0].requiredLookupStatus = 'not-found';
  assert.equal(auditSample(f.data, f.sample, api).controls[0].verdict, 'fail');
});
test('wildcard rejection controls detect any eligible sense on the specified source record', () => {
  const f = fixtures();
  const e = entry('unsafe', '猫', 'ねこ');
  e.senses[0].id = '7';
  f.data.entries = [e];
  control(f, { forbiddenEligibleSenses: [reference('unsafe', '*')] });
  assert.equal(auditSample(f.data, f.sample, api).controls[0].verdict, 'fail');
});
test('rejects undersized fixtures instead of presenting them as the required audit', () => {
  const f = fixtures();
  f.sample.positiveSamples.pop();
  assert.throws(() => auditSample(f.data, f.sample, api), /300 positive/);
  const g = fixtures();
  g.sample.controls.pop();
  assert.throws(() => auditSample(g.data, g.sample, api), /20 controls/);
});
