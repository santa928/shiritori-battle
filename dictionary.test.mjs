import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReading, createDictionary, evaluateSense } from './dictionary.mjs';

// Invented structural fixtures: not a dictionary corpus or sourced definitions.
const source = {id:'fixture', version:'1', url:'https://example.invalid/fixture', license:'TEST-ONLY', sha256:'a'.repeat(64)};
const sense = (id, pos=['noun'], extra={}) => ({id, pos, definitions:[{language:'ja', text:'テスト専用の語義'}], labels:[], ...extra});
const entry = (id, reading, senses=[sense('s1')], extra={}) => ({id, spellings:[id], readings:[reading], senses, sourceId:'fixture', sourceUrl:'https://example.invalid/fixture#'+id, ...extra});
const dictionary = entries => createDictionary({schemaVersion:1, sources:[source], entries});

test('reading normalization changes width/script but preserves small kana, voicing and long vowel', () => {
  assert.equal(normalizeReading(' ｶﾞｯｺｰ '),'がっこー');
  assert.equal(normalizeReading('ハ\u3099ナ'),'ばな');
  assert.equal(normalizeReading('きゃく'),'きゃく');
  for (const value of ['漢字','abc','１２','か な','か・な','ー','\u3099','']) assert.equal(normalizeReading(value),null);
});

test('lookup resolves reading, exposes every homophone and does not mutate input', () => {
  const data=[entry('橋','はし'),entry('箸','ハシ'),entry('走る','はしる',[sense('verb',['verb'])])];
  const before=JSON.stringify(data);
  const db=dictionary(data);
  assert.deepEqual(db.lookup('ﾊｼ').candidates.map(x=>x.entryId),['橋','箸']);
  assert.equal(db.lookup('はしる').candidates[0].reasons.includes('part-of-speech'),true);
  assert.equal(JSON.stringify(data),before);
  assert.equal(db.lookup('ないご').status,'not-found');
  assert.equal(db.lookup('橋').status,'invalid-reading');
});

test('eligibility is sense-level: noun homograph remains eligible with separate verb sense', () => {
  const result=dictionary([entry('混合','てすと',[sense('noun'),sense('verb',['verb'])])]).lookup('てすと');
  assert.deepEqual(result.candidates.map(x=>x.eligible),[true,false]);
  assert.equal(result.status,'candidates');
  assert.equal(result.candidates[0].definitions[0].language,'ja');
  assert.equal(result.candidates[0].source.id,'fixture');
});

test('conservative policy rejects proper names, unknown POS, inflections and unavailable Japanese definition', () => {
  assert.deepEqual(evaluateSense(sense('person',['proper-noun'],{labels:['person']})).reasons,['part-of-speech','excluded-label']);
  assert.equal(evaluateSense(sense('unknown',['unknown'])).eligible,false);
  assert.equal(evaluateSense(sense('form',['noun'],{labels:['inflected-form']})).eligible,false);
  assert.equal(evaluateSense(sense('eng',['noun'],{definitions:[{language:'en',text:'test'}]})).eligible,false);
  assert.equal(evaluateSense(sense('mixed',['noun','verb'])).eligible,false);
  assert.equal(evaluateSense(sense('verb',['verb']),{allowedPos:['verb']}).eligible,true);
});

test('missing or malformed metadata fails closed instead of manufacturing meaning or provenance', () => {
  assert.throws(()=>dictionary([entry('bad','かな',[],{sourceId:'missing'})]),/source/);
  assert.throws(()=>dictionary([entry('bad','漢字')]),/reading/);
  assert.throws(()=>dictionary([entry('same','かな'),entry('same','かに')]),/duplicate/);
  assert.throws(()=>dictionary([entry('bad','かな',[sense('same'),sense('same')])]),/duplicate/);
  assert.throws(()=>createDictionary({schemaVersion:1,sources:[{...source,license:''}],entries:[]}),/license/);
});

test('returned objects and caller changes cannot alter the indexed dictionary', () => {
  const data=[entry('a','かな')]; const db=dictionary(data);
  data[0].senses[0].definitions[0].text='modified';
  const result=db.lookup('かな'); result.candidates[0].definitions[0].text='changed';
  assert.equal(db.lookup('かな').candidates[0].definitions[0].text,'テスト専用の語義');
});

test('compatibility unit glyphs cannot be submitted as kana readings', () => {
  for(const glyph of ['㍑','㌔','㌀','㌢']) assert.equal(normalizeReading(glyph),null);
});
