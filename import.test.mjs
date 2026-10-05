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

test('sense-leading reading corroborated by source forms recovers a lexical reading only',()=>{
  const record=raw({word:'客',forms:[{form:'キャク',tags:['transliteration','go-on','joyo']},{form:'カク',tags:['transliteration','kan-on']},{form:'まろうど',tags:['transliteration','kun']}],senses:[{glosses:['（キャク）検証用の名詞の説明。']},{glosses:['(きゃく) 別の検証用の説明。']}]});
  const r=adaptRecord(record,'snapshot',1);
  assert.deepEqual(r.entry?.readings,['きゃく']);
  assert.deepEqual(r.raw,record);
  assert.equal(r.entry.readingEvidence.method,'sense-prefix-and-form');
  assert.ok(r.entry.senses.every(s=>evaluateSense(s).eligible));
});
test('reading fallback rejects unmatched, missing, mixed, or non-reading parentheticals',()=>{
  const forms=[{form:'きゃく',tags:['transliteration','on']}];
  for(const glosses of [['（きゃく）説明','別の説明'],['（きゃく）説明','（かく）説明'],['（俗語）説明'],['（きゃく、かく）説明'],['（きゃく）']]) {
    const r=adaptRecord(raw({word:'客',forms,senses:glosses.map(g=>({glosses:[g]}))}),'snapshot',1);
    assert.equal(r.entry,null);
  }
  assert.equal(adaptRecord(raw({word:'客',forms:[],senses:[{glosses:['（きゃく）説明']}]}),'snapshot',1).entry,null);
});
test('recovered verb and adjective readings preserve POS and remain ineligible',()=>{
  for(const pos of ['verb','adj']) {
    const r=adaptRecord(raw({word:'試',pos,forms:[{form:'ためし',tags:['transliteration','kun']}],senses:[{glosses:['（ためし）検証専用の説明。']}]}),'snapshot',1);
    assert.deepEqual(r.entry?.senses[0].pos,[pos]);
    assert.equal(evaluateSense(r.entry.senses[0]).eligible,false);
  }
});

test('explicit geographic proper nouns retain name POS but are eligible',()=>{
  for(const category of ['日本語 地名','日本語_都市名','日本語 河川名','河川名','日本語 山名','日本語 湖']) {
    const r=adaptRecord(raw({pos:'name',categories:['日本語 固有名詞',category]}),'snapshot',1);
    assert.deepEqual(r.entry.senses[0].pos,['proper-noun']);
    assert.ok(r.entry.senses[0].labels.includes('place'));
    assert.equal(evaluateSense(r.entry.senses[0]).eligible,true,category);
    assert.ok(r.entry.senses[0].classificationEvidence.some(e=>e.value===category));
  }
});
test('person and fictional character evidence wins over place without affecting sibling senses',()=>{
  const r=adaptRecord(raw({pos:'name',senses:[
    {glosses:['検証場所'],categories:['日本語_都市名']},
    {glosses:['検証の姓'],categories:['日本語 姓']},
    {glosses:['検証の架空名'],tags:['place','fictional-character']},
    {glosses:['未分類の固有名詞']},
  ]}),'snapshot',1);
  assert.deepEqual(r.entry.senses.map(s=>evaluateSense(s).eligible),[true,false,false,false]);
  assert.ok(r.entry.senses[1].labels.includes('person'));
  assert.ok(r.entry.senses[2].labels.includes('fictional-character'));
});
test('geographic topic/etymology is not a proper-name exception; unknown POS fails closed',()=>{
  for(const extra of [
    {pos:'noun',categories:['日本語 固有名詞','日本語_地名']},
    {pos:'verb',tags:['place']},{pos:'adj',tags:['place']},{pos:'unknown',tags:['place']},
    {pos:'name',categories:['日本語_地名由来']},{pos:'name',categories:['日本語 火山学']},
    {pos:'name',pos_title:'人名',tags:['place']},
    {pos:'name',tags:['place','organization']},
  ]) assert.equal(evaluateSense(adaptRecord(raw(extra),'snapshot',1).entry.senses[0]).eligible,false,JSON.stringify(extra));
});

test('noun topic categories do not turn name-related vocabulary into a named person or place',()=>{
  for(const category of ['日本語 姓','日本語 人名','日本語 湖','日本語 地名','日本語 人名由来']) {
    const s=adaptRecord(raw({categories:[category]}),'snapshot',1).entry.senses[0];
    assert.deepEqual(s.labels,[],category);
    assert.equal(evaluateSense(s).eligible,true,category);
  }
});

test('entry geography cannot license unrelated meanings in a multisense name',()=>{
  for(const extra of [{categories:['日本語_ヨーロッパの国名']},{tags:['place']}]) {
    const r=adaptRecord(raw({pos:'name',...extra,senses:[{glosses:['検証場所'],tags:['place']},{glosses:['同名の組織を表す検証語義']}]}),'snapshot',1);
    assert.deepEqual(r.entry.senses.map(s=>evaluateSense(s).eligible),[true,false]);
  }
});

test('a conflicting child gloss reading cannot inherit the parent reading',()=>{
  const r=adaptRecord(raw({word:'客',forms:[{form:'きゃく',tags:['transliteration','go-on']},{form:'かく',tags:['transliteration','kan-on']}],senses:[{glosses:['（きゃく）上位の検証義']},{glosses:['（きゃく）上位の検証義','（かく）下位の検証義']}]}),'snapshot',1);
  assert.equal(r.entry,null);
});
