import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const batch = JSON.parse(
  await readFile(new URL('./docs/similar-reading-batch.json', import.meta.url)),
);
const supplement = JSON.parse(await readFile(new URL('./supplement.json', import.meta.url)));
for (const expected of batch.records)
  test(`reviewed analogous missing reading: ${expected.word}`, () => {
    assert.deepEqual(
      supplement.records.find((p) => p.line === expected.line),
      expected,
    );
  });
test('bounded review count and held records remain separate', () => {
  assert.equal(batch.coverage.focusedCandidateRecordsExamined, 53);
  assert.equal(batch.records.length, 23);
  assert.equal(batch.held.length, 30);
  assert.equal(batch.validation.flatMap((x) => x.afterSenses).filter((s) => s.eligible).length, 30);
  for (const held of batch.held)
    assert.equal(
      supplement.records.some((p) => p.line === held.line),
      false,
      held.word,
    );
  assert.equal(supplement.records.length, 56);
});
