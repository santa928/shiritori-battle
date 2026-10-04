import {normalizeReading} from './dictionary.mjs';

/** Conservative adapter for Japanese-edition Wiktextract raw records.
 * Every Japanese record is retained verbatim in raw, even if not indexable.
 * A line-based ID is stable only inside the pinned source snapshot.
 */
export function adaptRecord(raw, sourceId, lineNumber) {
  if (raw.lang_code !== 'ja') return null;
  const result = {raw, sourceId, lineNumber, entry:null};
  if (typeof raw.word !== 'string' || !Array.isArray(raw.senses)) return {...result,reason:'invalid-record'};
  const kanaWord = normalizeReading(raw.word);
  const readings = kanaWord ? [kanaWord] : [...new Set((raw.forms ?? [])
    .filter(form => form.tags?.length === 1 && form.tags[0] === 'transliteration')
    .map(form => normalizeReading(form.form)).filter(Boolean))];
  if (!readings.length) return {...result,reason:'unresolved-reading'};
  if (readings.length > 1) return {...result,reason:'ambiguous-reading'};
  const pos = raw.pos === 'name' ? 'proper-noun' : (raw.pos || 'unknown');
  const commonLabels = [...(raw.tags ?? [])];
  if (raw.pos === 'name') commonLabels.push('proper-name');
  if (raw.pos_title === '造語成分' || commonLabels.includes('morpheme')) commonLabels.push('bound-form');
  const senses = raw.senses.map((sense, i) => {
    const labels = [...commonLabels, ...(sense.tags ?? [])];
    const categories = [...(raw.categories ?? []), ...(sense.categories ?? [])];
    if (categories.some(category => /^日本語[ _]固有名詞$/u.test(category))) labels.push('classification-conflict');
    // Cross-reference text is not treated as a resolved lexical meaning.
    if (sense.form_of?.length || sense.alt_of?.length) labels.push('unresolved-reference');
    if (labels.includes('form-of')) labels.push('inflected-form');
    return {
      id:String(i + 1), pos:[pos], labels:[...new Set(labels)],
      definitions:(sense.glosses ?? []).filter(text => typeof text === 'string' && text.trim())
        .map(text => ({language:'ja',text})),
    };
  });
  const spellings = [...new Set([raw.word, ...(raw.forms ?? [])
    .filter(form => form.tags?.includes('kanji')).map(form => form.form)
    .filter(form => typeof form === 'string' && form.trim())])];
  return {...result, entry:{
    id:`${sourceId}:${lineNumber}`, sourceId, sourceUrl:`https://ja.wiktionary.org/wiki/${encodeURIComponent(raw.word)}`,
    spellings, readings, senses, sourceLine:lineNumber,
  }};
}
