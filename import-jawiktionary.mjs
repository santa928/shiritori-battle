import { createHash } from 'node:crypto';
import { normalizeReading } from './dictionary.mjs';

// Fallback only when every sense explicitly names the same reading and a source
// transliteration corroborates it. Never assign all character on/kun readings.
function corroboratedSenseReading(raw) {
  if (!raw.senses.length) return null;
  const readings = raw.senses.map((sense) => {
    const gloss = sense.glosses?.[0];
    const match =
      typeof gloss === 'string' && gloss.match(/^(?:（([^）]+)）|\(([^)]+)\))\s*(\S.*)$/u);
    return match ? normalizeReading(match[1] ?? match[2]) : null;
  });
  if (readings.some((reading) => !reading || reading !== readings[0])) return null;
  // Child glosses can inherit the parent's text; never override a narrower
  // explicit reading that disagrees with the inherited prefix.
  for (const sense of raw.senses)
    for (const gloss of (sense.glosses ?? []).slice(1)) {
      const match = typeof gloss === 'string' && gloss.match(/^(?:（([^）]+)）|\(([^)]+)\))/u);
      const reading = match ? normalizeReading(match[1] ?? match[2]) : null;
      if (reading && reading !== readings[0]) return null;
    }
  return (raw.forms ?? []).some(
    (form) => form.tags?.includes('transliteration') && normalizeReading(form.form) === readings[0],
  )
    ? readings[0]
    : null;
}

// Multiple bare lexical readings require explicit sense-level correspondence.
// Keep unmapped senses in the archive/entry with an empty scope, never guessed.
function scopedReadings(sense, forms) {
  const parse = (text) => {
    const m = typeof text === 'string' && text.match(/^(?:（([^）]+)）|\(([^)]+)\))(.*)$/u);
    if (!m) return null;
    const values = (m[1] ?? m[2]).split('、').map(normalizeReading);
    return values.every(Boolean) ? { values: [...new Set(values)], body: m[3].trim() } : null;
  };
  const first = parse(sense.glosses?.[0]);
  if (!first || first.values.some((r) => !forms.includes(r))) return [];
  if (
    !(sense.glosses ?? []).some((g) => {
      const p = parse(g);
      return p ? p.body : g?.trim();
    })
  )
    return [];
  let values = first.values;
  for (const gloss of (sense.glosses ?? []).slice(1)) {
    const child = parse(gloss);
    if (!child) {
      const prefix = typeof gloss === 'string' && gloss.match(/^(?:（([^）]+)）|\(([^)]+)\))/u);
      if (
        prefix &&
        /^[ぁ-ゖァ-ヺー、,，/／・\s]+$/u.test((prefix[1] ?? prefix[2]).normalize('NFKC'))
      )
        return [];
      continue;
    }
    if (child.values.some((r) => !values.includes(r))) return [];
    values = child.values;
  }
  return values;
}

// Exact semantic labels only: topic, etymology and examples are not name evidence.
const placeCategories = new Set([
  '日本語 地名',
  '日本語 都市名',
  '日本語 首都名',
  '日本語 国名',
  '日本語 アジアの国名',
  '日本語 アフガニスタンの都市名',
  '日本語 日本の都市',
  '日本語 河川名',
  '河川名',
  '日本語 山名',
  '日本語 山岳名',
  '日本語 湖名',
  '日本語 湖',
  '日本語 アフリカの国名',
  '日本語 アメリカの国名',
  '日本語 オセアニアの国名',
  '日本語 ヨーロッパの国名',
  '日本語 中米の国名',
  '日本語 北米の国名',
  '日本語 南米の国名',
  '日本語 海洋名',
  '日本語 日本の川',
  '日本語 島',
  '日本語 半島',
  '日本語 都道府県',
  '日本語 旧国名',
  '日本語 アメリカ合衆国の州',
  '都道府県',
  '政令指定都市',
  '都道府県庁所在地',
  'ブラジルの州',
]);
const personCategories = new Set([
  '日本語 人名',
  '日本語 姓',
  '日本語 日本語人名',
  '日本語 日本語男性名',
  '日本語 日本語女性名',
  '日本語 男性名',
  '日本語 女性名',
  '日本語 人名 英語音',
  '日本語 人物',
  '日本語 日本の歴史上の人物',
  '日本語 歴史上の人物',
]);
const fictionalCategories = new Set(['日本語 架空の人物', '日本語 キャラクター名']);
function classify(raw, sense) {
  const evidence = [];
  for (const [scope, object] of [
    ['entry', raw],
    ['sense', sense],
  ]) {
    // Category names can denote topics (e.g. 職業姓), not named entities.
    for (const value of raw.pos === 'name' ? (object.categories ?? []) : []) {
      const category = value.replaceAll('_', ' ');
      const label = placeCategories.has(category)
        ? 'place'
        : personCategories.has(category)
          ? 'person'
          : fictionalCategories.has(category)
            ? 'fictional-character'
            : null;
      if (label === 'place' && scope === 'entry' && raw.senses.length > 1) continue;
      if (label) evidence.push({ label, scope, field: 'categories', value });
    }
    for (const value of object.tags ?? []) {
      if (value === 'place' && scope === 'entry' && raw.senses.length > 1) continue;
      if (['place', 'fictional-character', 'surname', 'given-name'].includes(value))
        evidence.push({
          label: ['surname', 'given-name'].includes(value) ? 'person' : value,
          scope,
          field: 'tags',
          value,
        });
    }
  }
  if (raw.pos_title === '人名')
    evidence.push({ label: 'person', scope: 'entry', field: 'pos_title', value: raw.pos_title });
  return evidence;
}

function validateSupplement(raw, patch) {
  if (!patch) return;
  const fail = () => {
    throw new Error('invalid or stale supplement');
  };
  if (
    patch.word !== raw.word ||
    patch.pos !== raw.pos ||
    patch.rawSha256 !== createHash('sha256').update(JSON.stringify(raw)).digest('hex')
  )
    fail();
  const e = patch.evidence;
  if (
    !e ||
    !['url', 'accessedAt', 'license', 'section', 'note'].every(
      (k) => typeof e[k] === 'string' && e[k].trim(),
    ) ||
    !e.url.startsWith('https://ja.wiktionary.org/') ||
    e.license !== 'CC-BY-SA-4.0'
  )
    fail();
  if (!Array.isArray(patch.senses) || !patch.senses.length) fail();
  const seen = new Set();
  for (const scope of patch.senses) {
    if (
      typeof scope.id !== 'string' ||
      !/^[1-9][0-9]*$/u.test(scope.id) ||
      Number(scope.id) > raw.senses.length ||
      seen.has(scope.id)
    )
      fail();
    seen.add(scope.id);
    if (
      scope.readings !== undefined &&
      (!Array.isArray(scope.readings) ||
        !scope.readings.length ||
        scope.readings.some((r) => !normalizeReading(r)))
    )
      fail();
    if (
      scope.excludeLabels !== undefined &&
      (!Array.isArray(scope.excludeLabels) ||
        !scope.excludeLabels.length ||
        scope.excludeLabels.some(
          (label) =>
            !['abbreviation', 'classification-conflict', 'unresolved-reference'].includes(label),
        ))
    )
      fail();
    if (scope.place !== undefined && (scope.place !== true || raw.pos !== 'name')) fail();
  }
}

/** Conservative adapter for Japanese-edition Wiktextract raw records.
 * Every Japanese record is retained verbatim in raw, even if not indexable.
 * A line-based ID is stable only inside the pinned source snapshot.
 */
export function adaptRecord(raw, sourceId, lineNumber, supplement = null) {
  if (raw.lang_code !== 'ja') return null;
  const result = { raw, sourceId, lineNumber, entry: null };
  if (typeof raw.word !== 'string' || !Array.isArray(raw.senses)) {
    if (supplement) throw new Error('supplement requires a structurally valid record');
    return { ...result, reason: 'invalid-record' };
  }
  validateSupplement(raw, supplement);
  const kanaWord = normalizeReading(raw.word);
  let readings = kanaWord
    ? [kanaWord]
    : [
        ...new Set(
          (raw.forms ?? [])
            .filter((form) => form.tags?.length === 1 && form.tags[0] === 'transliteration')
            .map((form) => normalizeReading(form.form))
            .filter(Boolean),
        ),
      ];
  let readingEvidence = { method: kanaWord ? 'kana-headword' : 'bare-transliteration' };
  if (!readings.length) {
    const recovered = corroboratedSenseReading(raw);
    if (recovered) {
      readings = [recovered];
      readingEvidence = { method: 'sense-prefix-and-form' };
    }
  }
  const unscopedEvidence = readingEvidence;
  const multipleBareReadings = readings.length > 1;
  let scopes = readings.length > 1 ? raw.senses.map((s) => scopedReadings(s, readings)) : null;
  if (supplement?.senses.some((s) => s.readings)) {
    scopes ??= raw.senses.map(() => [...readings]);
    for (const scope of supplement.senses)
      if (scope.readings) scopes[Number(scope.id) - 1] = scope.readings.map(normalizeReading);
  }
  if (!readings.length && !scopes?.flat().length)
    return { ...result, reason: 'unresolved-reading' };
  if (scopes) {
    readings = [...new Set(scopes.flat())];
    if (!readings.length) return { ...result, reason: 'ambiguous-reading' };
    readingEvidence = { method: 'sense-scoped-readings' };
  }
  const pos = raw.pos === 'name' ? 'proper-noun' : raw.pos || 'unknown';
  const commonLabels = [...(raw.tags ?? [])];
  if (raw.pos === 'name') commonLabels.push('proper-name');
  if (raw.pos_title === '造語成分' || commonLabels.includes('morpheme'))
    commonLabels.push('bound-form');
  const senses = raw.senses.map((sense, i) => {
    const labels = [...commonLabels, ...(sense.tags ?? [])];
    const classificationEvidence = classify(raw, sense);
    const reviewed = supplement?.senses.find((s) => s.id === String(i + 1));
    for (const label of reviewed?.excludeLabels ?? [])
      classificationEvidence.push({
        label,
        scope: 'sense',
        field: 'reviewed-supplement',
        sourceUrl: supplement.evidence.url,
        evidence: supplement.evidence,
      });
    if (reviewed?.place)
      classificationEvidence.push({
        label: 'place',
        scope: 'sense',
        field: 'reviewed-supplement',
        sourceUrl: supplement.evidence.url,
        evidence: supplement.evidence,
      });
    if (scopes && !scopes[i].length) labels.push('unresolved-reading');
    labels.push(...classificationEvidence.map((evidence) => evidence.label));
    // Preserve inherited tags but do not mistake entry-wide geography for a
    // classification of each unrelated meaning (e.g. country vs organization).
    if (
      raw.tags?.includes('place') &&
      raw.senses.length > 1 &&
      !classificationEvidence.some((evidence) => evidence.label === 'place')
    )
      labels.push('classification-conflict');
    const categories = [...(raw.categories ?? []), ...(sense.categories ?? [])];
    if (raw.pos !== 'name' && categories.some((category) => /^日本語[ _]固有名詞$/u.test(category)))
      labels.push('classification-conflict');
    // Cross-reference text is not treated as a resolved lexical meaning.
    if (sense.form_of?.length || sense.alt_of?.length) labels.push('unresolved-reference');
    if (labels.includes('form-of')) labels.push('inflected-form');
    return {
      ...(scopes
        ? {
            readings: scopes[i],
            readingEvidence: {
              method: reviewed?.readings
                ? 'reviewed-supplement'
                : scopes[i].length
                  ? multipleBareReadings
                    ? 'sense-prefix-and-bare-forms'
                    : unscopedEvidence.method
                  : 'unresolved-sense-reading',
              ...(reviewed?.readings ? { evidence: supplement.evidence } : {}),
            },
          }
        : {}),
      id: String(i + 1),
      pos: [pos],
      labels: [...new Set(labels)],
      classificationEvidence,
      definitions: (sense.glosses ?? [])
        .filter((text) => typeof text === 'string' && text.trim())
        .map((text) => ({ language: 'ja', text })),
    };
  });
  const spellings = [
    ...new Set([
      raw.word,
      ...(raw.forms ?? [])
        .filter((form) => form.tags?.includes('kanji'))
        .map((form) => form.form)
        .filter((form) => typeof form === 'string' && form.trim()),
    ]),
  ];
  return {
    ...result,
    entry: {
      id: `${sourceId}:${lineNumber}`,
      sourceId,
      sourceUrl: `https://ja.wiktionary.org/wiki/${encodeURIComponent(raw.word)}`,
      spellings,
      readings,
      readingEvidence,
      senses,
      sourceLine: lineNumber,
    },
  };
}
