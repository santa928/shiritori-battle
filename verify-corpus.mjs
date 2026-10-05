// Optional integration assertions for the pinned corpus; no copied definitions.
// Usage: node verify-corpus.mjs /path/to/build-output
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createDictionary} from './dictionary.mjs';

const output=process.argv[2];
if(!output) throw new Error('Usage: node verify-corpus.mjs BUILD_OUTPUT_DIR');
const source=JSON.parse(await readFile(new URL('./source.json',import.meta.url),'utf8'));
const data=JSON.parse(await readFile(join(output,'dictionary.json'),'utf8'));
assert.equal(data.sources[0].sha256,source.sha256,'requires pinned source snapshot');
const db=createDictionary(data);
function check(line,reading,expected) {
  const candidates=db.lookup(reading).candidates.filter(c=>c.entryId===`${source.id}:${line}`);
  assert.deepEqual(candidates.map(c=>c.eligible),expected,`line ${line}: ${reading}`);
  assert.ok(candidates.every(c=>c.source.sha256===source.sha256 && c.definitions.every(d=>d.language==='ja')));
}
check(40423,'きゃく',[true,true,true,true]);
check(225,'て',[true,true,true,true]);
check(698,'つくえ',[true]);
check(343229,'おおさか',[false,true,false]);
check(597483,'ひえいざん',[true,false]);
check(609917,'ないるがわ',[true]);
check(580618,'たんがにーか',[true,true]);
check(570531,'だーうぃん',[false,true]);
check(668570,'なかの',[true,false,false,false]);
check(612683,'みしま',[false]);
check(53979,'ゆうき',[false]);
check(147559,'さとう',[false]);
check(449201,'ももたろう',[false]);
check(575620,'しんでれら',[false]);
// Its separate ordinary metaphorical noun sense is still allowed.
check(575621,'しんでれら',[true]);
check(16108,'たべる',[false,false,false]);
check(6725,'たかい',Array(12).fill(false));
for(const line of [13973,13975,509,163])
  assert.ok(!data.entries.some(e=>e.sourceLine===line),'missing/ambiguous readings must remain quarantined');
for(const reading of ['かく','まろうど'])
  assert.ok(!db.lookup(reading).candidates.some(c=>c.entryId===`${source.id}:40423`),'do not assign unused character readings to 客');
console.log('Pinned corpus: 17 representative records, 4 quarantine cases, and unused character readings verified.');
