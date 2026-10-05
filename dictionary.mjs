/** Dictionary evidence and candidate eligibility, deliberately not game state. */
export function normalizeReading(value) {
  if (typeof value !== 'string') return null;
  // NFKC also expands unit symbols (e.g. ㍑); these are not typed kana.
  if (!/^[ぁ-ゖ゙゚ァ-ヺーｦ-ﾟ]+$/u.test(value.trim())) return null;
  const reading = value.normalize('NFKC').trim().replace(/[ァ-ヶ]/gu,
    char => String.fromCodePoint(char.codePointAt(0) - 0x60));
  // Preserve phonetic distinctions. Do not guess kanji readings or expand ー.
  return /^[ぁ-ゖ][ぁ-ゖー]*$/u.test(reading) ? reading : null;
}

export const DEFAULT_POLICY = Object.freeze({
  allowedPos: Object.freeze(['noun']),
  allowPlaces: true,
  excludedLabels: Object.freeze(['person', 'fictional-character', 'organization', 'brand', 'proper-name', 'inflected-form', 'abbreviation', 'initialism', 'acronym', 'classification-conflict', 'number', 'bound-form', 'unresolved-reference', 'unresolved-reading']),
  definitionLanguage: 'ja',
});

export function evaluateSense(sense, options = {}) {
  const policy = {...DEFAULT_POLICY, ...options};
  const reasons = [];
  const geographicName = policy.allowPlaces && sense.pos?.length === 1 &&
    sense.pos[0] === 'proper-noun' && sense.labels?.includes('place');
  // All tags must be allowed: a mixed/unresolved noun+verb record needs review.
  if (!geographicName && (!sense.pos?.length || !sense.pos.every(pos => policy.allowedPos.includes(pos)))) reasons.push('part-of-speech');
  if (sense.labels?.some(label => policy.excludedLabels.includes(label) && !(geographicName && label === 'proper-name'))) reasons.push('excluded-label');
  if (!sense.definitions?.some(def => def.language === policy.definitionLanguage && def.text?.trim())) reasons.push('missing-definition');
  return {eligible: reasons.length === 0, reasons};
}

function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`invalid ${name}`);
}
function textList(value, name, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && !value.length)) throw new TypeError(`invalid ${name}`);
  value.forEach(item => requiredText(item, name));
}
function unique(id, seen, name) {
  requiredText(id, name);
  if (seen.has(id)) throw new TypeError(`duplicate ${name}: ${id}`);
  seen.add(id);
}

/** Snapshot an explicitly normalized dataset. Source-specific extraction belongs in adapters. */
export function createDictionary(dataset) {
  if (dataset?.schemaVersion !== 1 || !Array.isArray(dataset.sources) || !Array.isArray(dataset.entries)) throw new TypeError('invalid dataset');
  const {sources, entries} = structuredClone(dataset);
  const sourceMap = new Map();
  const sourceIds = new Set();
  for (const source of sources) {
    unique(source.id, sourceIds, 'source id');
    for (const field of ['version', 'url', 'license']) requiredText(source[field], `source ${field}`);
    if (!/^[a-f0-9]{64}$/u.test(source.sha256)) throw new TypeError('invalid source sha256');
    sourceMap.set(source.id, source);
  }
  const index = new Map();
  const entryIds = new Set();
  for (const entry of entries) {
    unique(entry.id, entryIds, 'entry id');
    if (!sourceMap.has(entry.sourceId)) throw new TypeError('unknown source id');
    requiredText(entry.sourceUrl, 'source URL');
    textList(entry.spellings, 'spellings');
    textList(entry.readings, 'readings');
    if (!Array.isArray(entry.senses)) throw new TypeError('invalid senses');
    const senseIds = new Set();
    for (const sense of entry.senses) {
      unique(sense.id, senseIds, 'sense id');
      if (sense.readings !== undefined) {
        textList(sense.readings, 'sense readings', true);
        if (sense.readings.some(r => !normalizeReading(r) || !entry.readings.map(normalizeReading).includes(normalizeReading(r)))) throw new TypeError('invalid sense reading');
      }
      textList(sense.pos, 'POS');
      textList(sense.labels, 'labels', true);
      if (!Array.isArray(sense.definitions)) throw new TypeError('invalid definitions');
      for (const definition of sense.definitions) {
        requiredText(definition.language, 'definition language');
        requiredText(definition.text, 'definition text');
      }
    }
    const keys = entry.readings.map(normalizeReading);
    if (keys.some(key => key === null)) throw new TypeError('invalid reading');
    for (const key of new Set(keys)) {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(entry);
    }
  }
  return Object.freeze({
    lookup(input, policy = {}) {
      const reading = normalizeReading(input);
      if (reading === null) return {status:'invalid-reading', reading:null, candidates:[]};
      const matches = index.get(reading) ?? [];
      const candidates = matches.flatMap(entry => entry.senses.filter(sense => !sense.readings || sense.readings.map(normalizeReading).includes(reading)).map(sense => ({
        entryId:entry.id, senseId:sense.id, spellings:entry.spellings, readings:sense.readings ?? entry.readings,
        definitions:sense.definitions, pos:sense.pos, labels:sense.labels,
        readingEvidence:sense.readingEvidence ?? entry.readingEvidence, classificationEvidence:sense.classificationEvidence,
        source:sourceMap.get(entry.sourceId), sourceUrl:entry.sourceUrl,
        ...evaluateSense(sense, policy),
      })));
      // Candidates are evidence, never a final "valid move" verdict.
      return structuredClone({status: candidates.length ? 'candidates' : 'not-found', reading, candidates});
    },
  });
}
