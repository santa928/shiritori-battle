import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildWeb} from './build-web.mjs';
import {dataset} from './web-fixtures.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('split release is bounded, verified, reproducible and Python CI extraction preserves all artifacts',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'package-parts-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const input=join(dir,'input'),site=join(dir,'site'),release=join(dir,'release'),extracted=join(dir,'extracted');await mkdir(input);
 await writeFile(join(input,'dictionary.json'),JSON.stringify(dataset()));await writeFile(join(input,'archive.jsonl'),'');await buildWeb(input,site);
 let run=spawnSync('python3',['package-site.py',site,join(input,'dictionary.json'),release],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
 const manifest=JSON.parse(await readFile(join(release,'site-manifest.json'),'utf8'));
 assert.ok(Array.isArray(manifest.zipParts),'release must declare split archive parts');assert.ok(manifest.zipParts.length>0);
 await assert.rejects(access(join(release,'site.zip')));
 const {readPublishedArchive}=await import('./build-web.mjs');assert.equal(typeof readPublishedArchive,'function');
 const whole=await readPublishedArchive(release,manifest);assert.equal(whole.length,manifest.zipBytes);assert.equal(hash(whole),manifest.zipSha256);
 for(const [i,part] of manifest.zipParts.entries()){assert.equal(part.path,`site.zip.part${String(i+1).padStart(3,'0')}`);assert.ok(part.bytes>0&&part.bytes<=8*1024*1024);const bytes=await readFile(join(release,part.path));assert.equal(bytes.length,part.bytes);assert.equal(hash(bytes),part.sha256);}
 const archive=join(dir,'assembled.zip');await writeFile(archive,whole);
 run=spawnSync('python3',['-m','zipfile','-e',archive,extracted],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
 for(const [name,sha] of Object.entries(manifest.artifacts)){const bytes=await readFile(join(extracted,name));assert.equal(hash(bytes),sha,name);assert.deepEqual(bytes,await readFile(join(site,name)),name);}
 run=spawnSync('python3',['package-site.py',site,join(input,'dictionary.json'),release],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.deepEqual(await readPublishedArchive(release,manifest),whole);
 await writeFile(join(release,'site.zip.part999'),'unexpected');await assert.rejects(readPublishedArchive(release,manifest),/part file list/);await rm(join(release,'site.zip.part999'));
 const invalid=structuredClone(manifest);invalid.zipParts[0].path='../outside';await assert.rejects(readPublishedArchive(release,invalid),/archive part/);
 const tooBig=structuredClone(manifest);tooBig.zipParts[0].bytes=8*1024*1024+1;await assert.rejects(readPublishedArchive(release,tooBig),/archive part/);
 const reordered=structuredClone(manifest);reordered.zipParts[0].path='site.zip.part002';await assert.rejects(readPublishedArchive(release,reordered),/archive part/);
 const badTotal=structuredClone(manifest);badTotal.zipBytes++;await assert.rejects(readPublishedArchive(release,badTotal),/archive size/);
 const path=join(release,manifest.zipParts[0].path),part=await readFile(path);await writeFile(path,Buffer.alloc(part.length));await assert.rejects(readPublishedArchive(release,manifest),/part checksum/);await writeFile(path,part);
 const legacy=join(dir,'legacy');await mkdir(legacy);await writeFile(join(legacy,'site.zip'),whole);const legacyManifest={...manifest};delete legacyManifest.zipParts;delete legacyManifest.zipBytes;assert.deepEqual(await readPublishedArchive(legacy,legacyManifest),whole);
});
