// Optional integration assertions for the pinned corpus; no copied definitions.
// Usage: node verify-corpus.mjs /path/to/build-output
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDictionary, evaluateSense } from './dictionary.mjs';

const output = process.argv[2];
if (!output) throw new Error('Usage: node verify-corpus.mjs BUILD_OUTPUT_DIR');
const source = JSON.parse(await readFile(new URL('./source.json', import.meta.url), 'utf8'));
const data = JSON.parse(await readFile(join(output, 'dictionary.json'), 'utf8'));
assert.equal(data.sources[0].sha256, source.sha256, 'requires pinned source snapshot');
const db = createDictionary(data);
function check(line, reading, expected) {
  const candidates = db
    .lookup(reading)
    .candidates.filter((c) => c.entryId === `${source.id}:${line}`);
  assert.deepEqual(
    candidates.map((c) => c.eligible),
    expected,
    `line ${line}: ${reading}`,
  );
  assert.ok(
    candidates.every(
      (c) => c.source.sha256 === source.sha256 && c.definitions.every((d) => d.language === 'ja'),
    ),
  );
}
check(402337, 'こうら', [true, true, true]);
check(402337, 'コウラ', [true, true, true]);
check(207997, 'ごま', [true, true, false]);
check(200572, 'こんにゃく', [true, true]);
check(170595, 'こんぶ', [true]);
check(56714, 'みかん', [true]);
check(167722, 'ぎょうざ', [true]);
check(107843, 'まんじゅう', [true, true]);
check(18947, 'おうむ', [true, false]);
check(61010, 'きっぷ', [true, true, true]);
check(74163, 'ちゃわん', [true, true]);
check(179810, 'ほうちょう', [true, true, true, true, true]);
assert.ok(
  !db.lookup('まんじゅう').candidates.some((c) => c.entryId === `${source.id}:107844`),
  'separate mantou reference must not inherit Japanese confection reading',
);
check(40423, 'きゃく', [true, true, true, true]);
check(225, 'て', [true, true, true, true]);
check(698, 'つくえ', [true]);
check(343229, 'おおさか', [false, true, false]);
check(597483, 'ひえいざん', [true, false]);
check(609917, 'ないるがわ', [true]);
check(580618, 'たんがにーか', [true, true]);
check(570531, 'だーうぃん', [false, true]);
check(668570, 'なかの', [true, false, false, false]);
check(612683, 'みしま', [false]);
check(53979, 'ゆうき', [false]);
check(147559, 'さとう', [false]);
check(449201, 'ももたろう', [false]);
check(575620, 'しんでれら', [false]);
// Its separate ordinary metaphorical noun sense is still allowed.
check(575621, 'しんでれら', [true]);
check(16108, 'たべる', [false, false, false]);
check(6725, 'たかい', Array(12).fill(false));
check(13973, 'ふじさん', [true, false]);
check(13975, 'びわこ', [true]);
check(163, 'にほん', [true, true, true, true]);
check(163, 'にっぽん', [true, true, true, true, false]);
check(509, 'とうきょう', [true, true, true, false]);
check(509, 'とうけい', [true, true, true]);
check(509, 'とんきん', [true, true]);
assert.ok(
  !db.lookup('にっぽん').candidates.some((c) => c.entryId === `${source.id}:162`),
  'country reading must not bleed into mathematical noun',
);
assert.deepEqual(
  data.entries
    .find((e) => e.sourceLine === 509)
    .senses.filter((s) => s.readings?.length === 0)
    .map((s) => s.id),
  ['5', '9', '12'],
);
for (const reading of ['かく', 'まろうど'])
  assert.ok(
    !db.lookup(reading).candidates.some((c) => c.entryId === `${source.id}:40423`),
    'do not assign unused character readings to 客',
  );
check(7025, 'てんこう', [true, false, false]);
check(136724, 'ふつほう', [false]);
check(282852, 'もんぶ', [false]);
check(647952, 'ぶつみょう', [true, false, true]);
check(651830, 'きゅうし', [true, false]);
check(150986, 'うすぐも', [true, false]);
check(650904, 'げんぽ', [false]);
const supplement = JSON.parse(
  await readFile(new URL('./supplement.json', import.meta.url), 'utf8'),
);
assert.deepEqual(
  JSON.parse(await readFile(join(output, 'supplement.json'), 'utf8')),
  supplement,
  'requires reviewed supplement version',
);
for (const patch of supplement.records)
  for (const scope of patch.senses) {
    const sense = data.entries
      .find((e) => e.sourceLine === patch.line)
      ?.senses.find((s) => s.id === scope.id);
    assert.ok(sense, `supplement target ${patch.line}:${scope.id}`);
    if (scope.excludeLabels) {
      assert.ok(scope.excludeLabels.every((label) => sense.labels.includes(label)));
      assert.equal(evaluateSense(sense).eligible, false);
    }
  }
console.log(
  'Pinned corpus: original records, all reviewed supplements, scoped readings, unresolved senses, and unused character readings verified.',
);

// Real dictionary and real game/controller: a valid bridge into voiced ご.
const { createGame } = await import('./web/battle-rules.mjs');
const { createBattleController } = await import('./web/battle-controller.mjs');
for (const mode of ['individual', 'shared']) {
  let state;
  const controller = createBattleController({
    game: createGame({ mode, start: 'り' }),
    now: () => 0,
    onState: (s) => {
      state = s;
    },
    client: {
      search: async (reading) => ({
        ...db.lookup(reading),
        reading,
        version: 'pinned-corpus',
        sources: data.sources,
      }),
    },
  });
  controller.ready();
  controller.edit('りんご');
  await controller.submit();
  assert.equal(state.game.phase, 'success');
  controller.next();
  controller.ready();
  controller.edit('ごま');
  await controller.submit();
  assert.equal(state.game.phase, 'success', `ごま must be accepted in ${mode} battle`);
  assert.equal(state.game.start, 'ま');
  assert.deepEqual(state.game.history.at(-1).consumed, ['ま']);
  assert.deepEqual(
    state.game.history
      .at(-1)
      .candidates.filter((c) => c.entryId === `${source.id}:207997`)
      .map((c) => c.eligible),
    [true, true, false],
  );
  controller.destroy();
}
console.log('Real corpus battle: りんご → ごま succeeds in individual and shared modes.');

// Source-backed missing reading: all three original 甲羅 senses stay separate.
for (const mode of ['individual', 'shared']) {
  let state;
  const controller = createBattleController({
    game: createGame({ mode, start: 'こ' }),
    now: () => 0,
    onState: (s) => {
      state = s;
    },
    client: {
      search: async (reading) => ({
        ...db.lookup(reading),
        reading,
        version: 'pinned-corpus',
        sources: data.sources,
      }),
    },
  });
  controller.ready();
  controller.edit('こうら');
  await controller.submit();
  assert.equal(state.game.phase, 'success', `こうら must be accepted in ${mode} battle`);
  assert.equal(state.game.start, 'ら');
  assert.deepEqual(state.game.history.at(-1).consumed, ['う', 'ら']);
  assert.deepEqual(
    state.game.history
      .at(-1)
      .candidates.filter((c) => c.entryId === `${source.id}:402337`)
      .map((c) => c.eligible),
    [true, true, true],
  );
  controller.destroy();
}
console.log('Real corpus battle: こうら succeeds and consumes only う・ら in both modes.');

// Trailing long marks connect to the preceding kana, using actual dictionary eligibility.
for (const mode of ['individual', 'shared'])
  for (const [reading, next, consumed] of [
    ['こーひー', 'ひ', ['ひ']],
    ['たくしー', 'し', ['く', 'し']],
  ]) {
    let state;
    const controller = createBattleController({
      game: createGame({ mode, start: reading[0] }),
      now: () => 0,
      onState: (s) => {
        state = s;
      },
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
    assert.equal(state.game.phase, 'success', `${reading} must be accepted in ${mode} battle`);
    assert.equal(state.game.start, next);
    assert.deepEqual(state.game.history.at(-1).consumed, consumed);
    controller.next();
    assert.equal(state.draft, next);
    controller.destroy();
  }
console.log('Real corpus battle: コーヒー → ひ and タクシー → し succeed in both modes.');

// 複数読みを共通名詞見出しに持つ語。語義対応を一次記事で確認したものだけ回復。
check(591846, 'そしな', [true, true]);
check(591846, 'そひん', [true, true]);
check(5967, 'しちがつ', [true]);
check(5967, 'なながつ', [true]);
check(5977, 'くがつ', [true]);
check(5977, 'くげつ', [true]);
check(55586, 'がんぐ', [true]);
check(55586, 'おもちゃ', [true]);
check(61626, 'ふうふ', [true]);
check(61626, 'おっとめ', [true]);
check(61626, 'みょうと', [true]);
check(135785, 'はくはつ', [true, true]);
check(135785, 'しらが', [true, true]);
check(363593, 'あっこう', [true, true]);
check(363593, 'わるぐち', [true, true]);
