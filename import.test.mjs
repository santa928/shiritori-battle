import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adaptRecord} from './import-jawiktionary.mjs';
import {evaluateSense} from './dictionary.mjs';
// Synthetic records exercise observed Wiktextract field shapes; no copied glosses.
const raw = extra => ({word:'てすと',lang_code:'ja',pos:'noun',pos_title:'名詞',senses:[{glosses:['検証専用の説明']}],...extra});
test('retains raw source and verb POS; non-Japanese records are skipped',()=>{
  const record=raw({pos:'verb'}); const result=adaptRecord(record,'snapshot',1);
  assert.deepEqual(result.raw,record); assert.equal(result.entry.senses[0].pos[0],'verb');
  assert.equal(evaluateSense(result.entry.senses[0]).eligible,false);
  assert.equal(adaptRecord(raw({lang_code:'en'}),'snapshot',2),null);
});
test('one bare transliteration indexes kanji word but on/kun character readings do not',()=>{
  const r=adaptRecord(raw({word:'検証',forms:[{form:'けんしょう',tags:['transliteration']},{form:'けん',tags:['transliteration','on']}]}),'snapshot',1);
  assert.deepEqual(r.entry.readings,['けんしょう']);
  const missing=adaptRecord(raw({word:'検',forms:[{form:'けん',tags:['transliteration','on']}]}),'snapshot',2);
  assert.equal(missing.entry,null); assert.equal(missing.reason,'unresolved-reading');
});
test('multiple readings are quarantined rather than incorrectly attaching senses',()=>{
  const r=adaptRecord(raw({word:'生',forms:[{form:'せい',tags:['transliteration']},{form:'なま',tags:['transliteration']}]}),'snapshot',1);
  assert.equal(r.entry,null); assert.equal(r.reason,'ambiguous-reading');
});
test('proper names, morphemes, aliases and abbreviations remain stored but not default eligible',()=>{
  for(const extra of [{pos:'name'},{pos_title:'造語成分'},{senses:[{glosses:['テスト'],form_of:[{word:'原形'}]}]},{tags:['abbreviation']}]) {
    const r=adaptRecord(raw(extra),'snapshot',1); assert.equal(evaluateSense(r.entry.senses[0]).eligible,false);
  }
});
test('global verb categories do not erase a noun sense; entry and sense labels are preserved',()=>{
  const r=adaptRecord(raw({categories:['日本語 名詞 サ変動詞'],senses:[{glosses:['検証'],tags:['archaic']}]}),'snapshot',1);
  assert.equal(evaluateSense(r.entry.senses[0]).eligible,true);
  assert.ok(r.entry.senses[0].labels.includes('archaic'));
});

test('explicit contradictory proper-name categories fail closed without broad etymology matching',()=>{
  const name=adaptRecord(raw({categories:['日本語 固有名詞']}),'snapshot',1);
  assert.equal(evaluateSense(name.entry.senses[0]).eligible,false);
  const derived=adaptRecord(raw({categories:['日本語_人名由来']}),'snapshot',2);
  assert.equal(evaluateSense(derived.entry.senses[0]).eligible,true);
  const nameSense=adaptRecord(raw({senses:[{glosses:['検証'],categories:['日本語_固有名詞']}]}),'snapshot',3);
  assert.equal(evaluateSense(nameSense.entry.senses[0]).eligible,false);
});

test('initialisms remain stored but excluded by provisional policy',()=>{
  const r=adaptRecord(raw({tags:['initialism']}),'snapshot',1);
  assert.equal(evaluateSense(r.entry.senses[0]).eligible,false);
});
