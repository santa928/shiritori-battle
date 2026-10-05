import {normalizeReading} from './dictionary.mjs';

// Fallback only when every sense explicitly names the same reading and a source
// transliteration corroborates it. Never assign all character on/kun readings.
function corroboratedSenseReading(raw) {
  if (!raw.senses.length) return null;
  const readings = raw.senses.map(sense => {
    const gloss = sense.glosses?.[0];
    const match = typeof gloss === 'string' && gloss.match(/^(?:（([^）]+)）|\(([^)]+)\))\s*(\S.*)$/u);
    return match ? normalizeReading(match[1] ?? match[2]) : null;
  });
  if (readings.some(reading => !reading || reading !== readings[0])) return null;
  // Child glosses can inherit the parent's text; never override a narrower
  // explicit reading that disagrees with the inherited prefix.
  for (const sense of raw.senses) for (const gloss of (sense.glosses ?? []).slice(1)) {
    const match = typeof gloss === 'string' && gloss.match(/^(?:（([^）]+)）|\(([^)]+)\))/u);
    const reading = match ? normalizeReading(match[1] ?? match[2]) : null;
    if (reading && reading !== readings[0]) return null;
  }
  return (raw.forms ?? []).some(form => form.tags?.includes('transliteration') &&
    normalizeReading(form.form) === readings[0]) ? readings[0] : null;
}

// Exact semantic labels only: topic, etymology and examples are not name evidence.
const placeCategories = new Set([
  '日本語 地名', '日本語 都市名', '日本語 首都名', '日本語 国名',
  '日本語 アジアの国名', '日本語 アフガニスタンの都市名', '日本語 日本の都市',
  '日本語 河川名', '河川名', '日本語 山名', '日本語 山岳名',
  '日本語 湖名', '日本語 湖',
  '日本語 アフリカの国名', '日本語 アメリカの国名', '日本語 オセアニアの国名',
  '日本語 ヨーロッパの国名', '日本語 中米の国名', '日本語 北米の国名', '日本語 南米の国名',
  '日本語 海洋名', '日本語 日本の川', '日本語 島', '日本語 半島',
  '日本語 都道府県', '日本語 旧国名', '日本語 アメリカ合衆国の州',
  '都道府県', '政令指定都市', '都道府県庁所在地', 'ブラジルの州',
]);
const personCategories = new Set([
  '日本語 人名', '日本語 姓', '日本語 日本語人名', '日本語 日本語男性名',
  '日本語 日本語女性名', '日本語 男性名', '日本語 女性名',
  '日本語 人名 英語音', '日本語 人物', '日本語 日本の歴史上の人物', '日本語 歴史上の人物',
]);
const fictionalCategories = new Set(['日本語 架空の人物', '日本語 キャラクター名']);
function classify(raw, sense) {
  const evidence = [];
  for (const [scope, object] of [['entry',raw], ['sense',sense]]) {
    // Category names can denote topics (e.g. 職業姓), not named entities.
    for (const value of raw.pos === 'name' ? (object.categories ?? []) : []) {
      const category = value.replaceAll('_',' ');
      const label = placeCategories.has(category) ? 'place' :
        personCategories.has(category) ? 'person' :
        fictionalCategories.has(category) ? 'fictional-character' : null;
      if (label === 'place' && scope === 'entry' && raw.senses.length > 1) continue;
      if (label) evidence.push({label,scope,field:'categories',value});
    }
    for (const value of object.tags ?? []) {
      if (value === 'place' && scope === 'entry' && raw.senses.length > 1) continue;
      if (['place','fictional-character','surname','given-name'].includes(value))
        evidence.push({label:['surname','given-name'].includes(value) ? 'person' : value,scope,field:'tags',value});
    }
  }
  if (raw.pos_title === '人名') evidence.push({label:'person',scope:'entry',field:'pos_title',value:raw.pos_title});
  return evidence;
}

/** Conservative adapter for Japanese-edition Wiktextract raw records.
 * Every Japanese record is retained verbatim in raw, even if not indexable.
 * A line-based ID is stable only inside the pinned source snapshot.
 */
export function adaptRecord(raw, sourceId, lineNumber) {
  if (raw.lang_code !== 'ja') return null;
  const result = {raw, sourceId, lineNumber, entry:null};
  if (typeof raw.word !== 'string' || !Array.isArray(raw.senses)) return {...result,reason:'invalid-record'};
  const kanaWord = normalizeReading(raw.word);
  let readings = kanaWord ? [kanaWord] : [...new Set((raw.forms ?? [])
    .filter(form => form.tags?.length === 1 && form.tags[0] === 'transliteration')
    .map(form => normalizeReading(form.form)).filter(Boolean))];
  let readingEvidence = {method:kanaWord ? 'kana-headword' : 'bare-transliteration'};
  if (!readings.length) {
    const recovered = corroboratedSenseReading(raw);
    if (recovered) { readings = [recovered]; readingEvidence = {method:'sense-prefix-and-form'}; }
  }
  if (!readings.length) return {...result,reason:'unresolved-reading'};
  if (readings.length > 1) return {...result,reason:'ambiguous-reading'};
  const pos = raw.pos === 'name' ? 'proper-noun' : (raw.pos || 'unknown');
  const commonLabels = [...(raw.tags ?? [])];
  if (raw.pos === 'name') commonLabels.push('proper-name');
  if (raw.pos_title === '造語成分' || commonLabels.includes('morpheme')) commonLabels.push('bound-form');
  const senses = raw.senses.map((sense, i) => {
    const labels = [...commonLabels, ...(sense.tags ?? [])];
    const classificationEvidence = classify(raw,sense);
    labels.push(...classificationEvidence.map(evidence => evidence.label));
    // Preserve inherited tags but do not mistake entry-wide geography for a
    // classification of each unrelated meaning (e.g. country vs organization).
    if (raw.tags?.includes('place') && raw.senses.length > 1 &&
        !classificationEvidence.some(evidence => evidence.label === 'place')) labels.push('classification-conflict');
    const categories = [...(raw.categories ?? []), ...(sense.categories ?? [])];
    if (raw.pos !== 'name' && categories.some(category => /^日本語[ _]固有名詞$/u.test(category))) labels.push('classification-conflict');
    // Cross-reference text is not treated as a resolved lexical meaning.
    if (sense.form_of?.length || sense.alt_of?.length) labels.push('unresolved-reference');
    if (labels.includes('form-of')) labels.push('inflected-form');
    return {
      id:String(i + 1), pos:[pos], labels:[...new Set(labels)], classificationEvidence,
      definitions:(sense.glosses ?? []).filter(text => typeof text === 'string' && text.trim())
        .map(text => ({language:'ja',text})),
    };
  });
  const spellings = [...new Set([raw.word, ...(raw.forms ?? [])
    .filter(form => form.tags?.includes('kanji')).map(form => form.form)
    .filter(form => typeof form === 'string' && form.trim())])];
  return {...result, entry:{
    id:`${sourceId}:${lineNumber}`, sourceId, sourceUrl:`https://ja.wiktionary.org/wiki/${encodeURIComponent(raw.word)}`,
    spellings, readings, readingEvidence, senses, sourceLine:lineNumber,
  }};
}
