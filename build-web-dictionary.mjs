import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';import {createInterface} from 'node:readline';import {createHash} from 'node:crypto';import {join} from 'node:path';
import {createDictionary,normalizeReading} from './dictionary.mjs';import {bucketForReading} from './reading-bucket.mjs';
/** Only explicit potential readings, never a claim that a sense has that reading. */
export function extractReview(record){
  const partial=record.entry?.senses?.some(s=>s.readings?.length===0);
  if(!partial&&!['ambiguous-reading','unresolved-reading'].includes(record.reason))return [];
  const raw=record.raw;if(typeof raw?.word!=='string')return [];
  const kana=normalizeReading(raw.word);
  const readings=kana?[kana]:(raw.forms??[]).filter(f=>f.tags?.length===1&&f.tags[0]==='transliteration').map(f=>normalizeReading(f.form)).filter(Boolean);
  return [...new Set(readings)].map(reading=>({reading,spelling:raw.word,sourceUrl:record.entry?.sourceUrl??'https://ja.wiktionary.org/wiki/'+encodeURIComponent(raw.word),reason:'ambiguous-reading'}));
}
export async function buildWebDictionary({dataset,archivePath,outputDir,version}){
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(version??''))throw new Error('invalid version');
  createDictionary(dataset);
  const buckets=Array.from({length:256},()=>({entries:new Map(),review:new Map()}));
  const at=async r=>buckets[parseInt(await bucketForReading(r),16)];
  for(const entry of dataset.entries)for(const reading of new Set(entry.readings.map(normalizeReading)))(await at(reading)).entries.set(entry.id,entry);
  if(archivePath){const lines=createInterface({input:createReadStream(archivePath),crlfDelay:Infinity});for await(const line of lines){if(!line.trim())continue;for(const item of extractReview(JSON.parse(line)))(await at(item.reading)).review.set(JSON.stringify(item),item);}}
  await mkdir(outputDir); // Reject existing output without deleting it.
  const manifest={schemaVersion:1,version,sources:dataset.sources,shards:{}};
  try{for(let i=0;i<256;i++){
    const key=i.toString(16).padStart(2,'0');const bucket=buckets[i];
    const text=JSON.stringify({schemaVersion:1,version,dataset:{schemaVersion:1,sources:dataset.sources,entries:[...bucket.entries.values()]},review:[...bucket.review.values()]});
    const bytes=Buffer.byteLength(text);const sha256=createHash('sha256').update(text).digest('hex');
    await writeFile(join(outputDir,key+'.json'),text);manifest.shards[key]={url:key+'.json',sha256,bytes};
  }await writeFile(join(outputDir,'manifest.json'),JSON.stringify(manifest));return manifest;
  }catch(error){await rm(outputDir,{recursive:true,force:true});throw error;}
}
