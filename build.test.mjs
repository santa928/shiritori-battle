import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {buildDictionary} from './build.mjs';
import {createDictionary} from './dictionary.mjs';

test('build verifies bytes and preserves quarantined records; outputs are reusable',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'shiritori-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const records=[{word:'てすと',lang_code:'ja',pos:'noun',senses:[{glosses:['検証用の説明']}]},{word:'漢字',lang_code:'ja',pos:'verb',senses:[{glosses:['検証用']}]},{word:'test',lang_code:'en',pos:'noun',senses:[]}];
 const bytes=gzipSync(records.map(x=>JSON.stringify(x)).join('\n'));const input=join(dir,'raw.gz');await writeFile(input,bytes);
 const source={id:'fixture',version:'1',url:'https://example.invalid',license:'TEST-ONLY',sha256:createHash('sha256').update(bytes).digest('hex')};
 const out=join(dir,'out');const report=await buildDictionary(input,out,source);
 assert.equal(report.japaneseRecords,2);assert.equal(report.indexedEntries,1);assert.equal(report.quarantinedRecords,1);
 const dataset=JSON.parse(await readFile(join(out,'dictionary.json'),'utf8'));
 assert.equal(createDictionary(dataset).lookup('テスト').candidates[0].eligible,true);
 const archive=(await readFile(join(out,'archive.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(archive[1].raw.pos,'verb');assert.equal(archive[1].reason,'unresolved-reading');
 await assert.rejects(buildDictionary(input,out,source),/exist/i);
 const bad=join(dir,'bad');await assert.rejects(buildDictionary(input,bad,{...source,sha256:'0'.repeat(64)}),/checksum/);
 await assert.rejects(access(bad));
});

test('build pins, applies and archives supplements and rejects unused or foreign patches',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'shiritori-supp-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const raw={word:'試験山',lang_code:'ja',pos:'name',senses:[{glosses:['テスト用の山の説明']}]};
 const bytes=Buffer.from(JSON.stringify(raw)+'\n'), input=join(dir,'raw.jsonl');await writeFile(input,bytes);
 const source={id:'fixture',version:'1',url:'https://example.invalid',license:'TEST-ONLY',sha256:createHash('sha256').update(bytes).digest('hex')};
 const supplement={schemaVersion:1,sourceId:source.id,sourceSha256:source.sha256,records:[{line:1,word:raw.word,pos:raw.pos,rawSha256:createHash('sha256').update(JSON.stringify(raw)).digest('hex'),evidence:{url:'https://ja.wiktionary.org/wiki/試験山',accessedAt:'2026-10-05',license:'CC-BY-SA-4.0',section:'test',note:'test-only'},senses:[{id:'1',readings:['しけんざん'],place:true}]}]};
 const out=join(dir,'ok');const report=await buildDictionary(input,out,source,supplement);
 assert.equal(report.supplementedRecords,1);assert.equal(report.eligibleSenses,1);
 assert.deepEqual(JSON.parse(await readFile(join(out,'supplement.json'),'utf8')),supplement);
 for(const s of [{...supplement,sourceId:'wrong'},{...supplement,sourceSha256:'0'.repeat(64)},{...supplement,records:[{...supplement.records[0],line:2}]},{...supplement,records:[...supplement.records,...supplement.records]}])
 await assert.rejects(buildDictionary(input,join(dir,'bad'),source,s),/supplement/);
});
