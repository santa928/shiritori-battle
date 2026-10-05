// Full-corpus integration: node verify-similar-readings.mjs NEW_BUILD PRIOR_BUILD
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { groupCandidates } from './web/candidate-groups.mjs';
import { meaningEquivalences } from './web/meaning-equivalences.mjs';
import { createDictionary, evaluateSense } from './dictionary.mjs';
import { createGame, inspectDraft, KANA, nextStart } from './web/battle-rules.mjs';
import { createBattleController } from './web/battle-controller.mjs';
const [out, prior, site] = process.argv.slice(2);
if (!out || !prior) throw Error('NEW_BUILD PRIOR_BUILD required');
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const batch = await read(new URL('./docs/similar-reading-batch.json', import.meta.url));
const equivalences = await read(
  new URL('./docs/similar-reading-equivalences.json', import.meta.url),
);
const pins = new Map(equivalences.rawRecordPins.map((p) => [p.line, p]));
const data = await read(join(out, 'dictionary.json')),
  old = await read(join(prior, 'dictionary.json'));
const db = createDictionary(data),
  entries = new Map(data.entries.map((e) => [e.sourceLine, e]));
const supplement = await read(join(out, 'supplement.json')),
  oldSupplement = await read(join(prior, 'supplement.json'));
assert.deepEqual(supplement.records.slice(0, 33), oldSupplement.records);
for (const entry of old.entries)
  assert.deepEqual(entries.get(entry.sourceLine), entry, `prior index ${entry.sourceLine}`);
assert.equal(data.entries.length - old.entries.length, 23);
const raw = async function* (p) {
  for await (const line of createInterface({ input: createReadStream(p), crlfDelay: Infinity }))
    yield JSON.parse(line);
};
const a = raw(join(out, 'archive.jsonl')),
  b = raw(join(prior, 'archive.jsonl'));
let rawCount = 0;
while (true) {
  const [n, p] = await Promise.all([a.next(), b.next()]);
  assert.equal(n.done, p.done);
  if (n.done) break;
  assert.deepEqual(n.value.raw, p.value.raw);
  const pin = pins.get(n.value.lineNumber);
  if (pin) {
    assert.equal(
      createHash('sha256').update(JSON.stringify(n.value.raw)).digest('hex'),
      pin.rawSha256,
    );
    pins.delete(n.value.lineNumber);
  }
  rawCount++;
}
assert.equal(rawCount, 150505);
assert.equal(pins.size, 0, 'all equivalence raw pins exercised');
const outcomes = [];
let accepted = 0,
  nEnding = 0,
  ruleBlocked = 0;
for (const expected of batch.validation) {
  const entry = entries.get(expected.line);
  assert.ok(entry);
  assert.deepEqual(
    entry.senses.map((s) => ({
      id: s.id,
      readings: s.readings,
      labels: s.labels,
      eligible: evaluateSense(s).eligible,
      reasons: evaluateSense(s).reasons,
    })),
    expected.afterSenses,
  );
  for (const reading of new Set(expected.afterSenses.flatMap((s) => s.readings))) {
    const wanted = expected.afterSenses.filter((s) => s.readings.includes(reading));
    for (const input of [
      reading,
      reading.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)),
    ]) {
      const found = db.lookup(input).candidates.filter((c) => c.entryId === entry.id);
      assert.deepEqual(
        found.map((c) => c.senseId),
        wanted.map((s) => s.id),
      );
      assert.ok(found.every((c) => c.eligible));
    }
    const check = inspectDraft(reading, { start: reading[0], pool: KANA });
    if (!check.ok) {
      ruleBlocked++;
      outcomes.push({ word: expected.word, reading, battle: 'rule-blocked', reason: check.reason });
      continue;
    }
    for (const mode of ['individual', 'shared']) {
      let state;
      const game = { ...createGame({ mode }), start: reading[0] };
      const controller = createBattleController({
        game,
        now: () => 0,
        onState: (s) => (state = s),
        client: {
          search: async (r) => ({
            ...db.lookup(r),
            reading: r,
            version: 'pinned-corpus',
            sources: data.sources,
          }),
        },
      });
      controller.ready();
      controller.edit(reading);
      await controller.submit();
      assert.equal(state.game.phase, reading.endsWith('ん') ? 'finished' : 'success', reading);
      assert.equal(state.game.history.length, 1);
      assert.ok(state.game.history[0].candidates.some((c) => c.entryId === entry.id && c.eligible));
      if (reading.endsWith('ん')) {
        assert.equal(state.game.reason, 'n-ending');
        assert.deepEqual(state.game.history[0].consumed, []);
      } else {
        assert.equal(state.game.start, nextStart(reading));
        assert.deepEqual(state.game.history[0].consumed, check.consumed);
      }
      controller.destroy();
    }
    reading.endsWith('ん') ? nEnding++ : accepted++;
    outcomes.push({
      word: expected.word,
      reading,
      battle: reading.endsWith('ん') ? 'n-ending' : 'accepted',
    });
  }
}
for (const [line, reading] of [
  [48066, 'けん'],
  [48213, 'みずち'],
  [55664, 'さんま'],
  [369, 'しゃん'],
  [56682, 'おたねにんじん'],
])
  assert.ok(!db.lookup(reading).candidates.some((c) => c.entryId === `${batch.sourceId}:${line}`));
for (const held of batch.held) assert.equal(entries.has(held.line), false, held.word);
for (const { group: rule } of equivalences.groups) {
  assert.deepEqual(
    meaningEquivalences.find((g) => g.id === rule.id),
    rule,
  );
  const found = db.lookup(rule.reading).candidates;
  const members = rule.members.map((m) => {
    const c = found.find((c) => c.entryId === m.entryId && c.senseId === m.senseId);
    assert.ok(c?.eligible);
    assert.deepEqual(
      {
        entryId: c.entryId,
        senseId: c.senseId,
        spellings: c.spellings,
        definitions: c.definitions.map((d) => d.text),
        sourceUrl: c.sourceUrl,
        pos: c.pos,
      },
      m,
    );
    return c;
  });
  const grouped = groupCandidates(found, rule.reading);
  const merged = grouped.find((g) =>
    g.candidates.some(
      (c) => c.entryId === rule.primaryMember.entryId && c.senseId === rule.primaryMember.senseId,
    ),
  );
  assert.deepEqual(
    new Set(merged.candidates.map((c) => c.entryId + ':' + c.senseId)),
    new Set(members.map((c) => c.entryId + ':' + c.senseId)),
  );
}
for (const [reading, line, sense] of [
  ['くじら', 44111, '1'],
  ['きゅうり', 61602, '2'],
  ['きゅうり', 241124, '1'],
  ['すね', 11744, '2'],
  ['かぎ', 62880, '3'],
  ['ちょうちん', 383166, '1'],
  ['びん', 45191, '1'],
  ['びん', 45191, '2'],
  ['びん', 45191, '3'],
]) {
  const found = db.lookup(reading).candidates;
  const target = found.find(
    (c) => c.entryId === `${batch.sourceId}:${line}` && c.senseId === sense,
  );
  assert.ok(target);
  const group = groupCandidates(found, reading).find((g) =>
    g.candidates.some((c) => c.entryId === target.entryId && c.senseId === sense),
  );
  assert.equal(group.candidates.length, 1, `negative equivalence ${line}:${sense}`);
}
const report = await read(join(out, 'report.json')),
  priorReport = await read(join(prior, 'report.json'));
assert.equal(report.eligibleSenses - priorReport.eligibleSenses, 30);
assert.equal(report.quarantinedRecords - priorReport.quarantinedRecords, -23);
const result = {
  rawPreserved: rawCount,
  priorIndexPreserved: old.entries.length,
  addedEntries: 23,
  addedEligibleSenses: 30,
  coverage: batch.coverage,
  report,
  readingOutcomes: outcomes,
  battleSummary: { accepted, nEnding, ruleBlocked },
  senseOutcomes: batch.validation,
  held: batch.held,
};
if (site) {
  const { createDictionaryClient } = await import('./web/dictionary-client.mjs');
  const info = await read(join(site, 'build-info.json'));
  assert.deepEqual(info.retainedVersions, ['v1-74cbc1f057467d8b', 'v1-f667664edefe998d']);
  const client = createDictionaryClient({
    manifestUrl: `https://verification.invalid/data/${info.version}/manifest.json`,
    fetchImpl: async (url) => new Response(await readFile(join(site, new URL(url).pathname))),
  });
  let lookups = 0;
  for (const record of batch.records)
    for (const scope of record.senses)
      for (const reading of scope.readings ?? [])
        for (const input of [
          reading,
          reading.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)),
        ]) {
          const response = await client.search(input);
          assert.ok(
            response.candidates.some(
              (c) =>
                c.entryId === `${batch.sourceId}:${record.line}` &&
                c.senseId === scope.id &&
                c.eligible,
            ),
          );
          lookups++;
        }
  result.web = {
    version: info.version,
    retainedVersions: info.retainedVersions,
    verifiedSenseLookups: lookups,
  };
}
await writeFile(
  join(out, 'similar-reading-verification.json'),
  JSON.stringify(result, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      rawPreserved: rawCount,
      priorIndexPreserved: old.entries.length,
      report,
      battleSummary: result.battleSummary,
    },
    null,
    2,
  ),
);
