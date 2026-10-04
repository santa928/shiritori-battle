import {createReadStream} from 'node:fs';
import {mkdir,open,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {adaptRecord} from './import-jawiktionary.mjs';
import {createDictionary,evaluateSense} from './dictionary.mjs';

/** Offline build. No network requests; reject a changed download before any output. */
export async function buildDictionary(input, output, source) {
  createDictionary({schemaVersion:1,sources:[source],entries:[]});
  const hash=createHash('sha256');
  for await (const chunk of createReadStream(input)) hash.update(chunk);
  if(hash.digest('hex')!==source.sha256) throw new Error('source checksum mismatch');
  await mkdir(output); // Refuse to overwrite existing builds.
  let archive;
  try {
    archive=await open(join(output,'archive.jsonl'),'wx');
    const stream=createReadStream(input);
    const decoded=input.endsWith('.gz') ? stream.pipe(createGunzip()) : stream;
    const lines=createInterface({input:decoded,crlfDelay:Infinity});
    const entries=[];
    const report={sourceId:source.id,lines:0,japaneseRecords:0,indexedEntries:0,quarantinedRecords:0,eligibleSenses:0,quarantineReasons:{}};
    for await (const line of lines) {
      report.lines++;
      if(!line.trim()) continue;
      const result=adaptRecord(JSON.parse(line),source.id,report.lines);
      if(!result) continue;
      report.japaneseRecords++;
      await archive.write(JSON.stringify(result)+'\n');
      if(result.entry) {
        entries.push(result.entry);
        report.eligibleSenses+=result.entry.senses.filter(s=>evaluateSense(s).eligible).length;
      } else {
        report.quarantinedRecords++;
        report.quarantineReasons[result.reason]=(report.quarantineReasons[result.reason]??0)+1;
      }
    }
    report.indexedEntries=entries.length;
    const dataset={schemaVersion:1,sources:[source],entries};
    createDictionary(dataset); // Fail on structural defects before publishing build artifacts.
    await writeFile(join(output,'dictionary.json'),JSON.stringify(dataset)+'\n');
    await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
    await writeFile(join(output,'source.json'),JSON.stringify(source,null,2)+'\n');
    await writeFile(join(output,'ATTRIBUTION.txt'),[
      'Dictionary text: Japanese Wiktionary contributors, via Kaikki.org/Wiktextract.',
      'Each entry sourceUrl links its contributor/history attribution source.',
      `Source snapshot: ${source.version}; archive checksum: ${source.sha256}`,
      `License: ${source.license}; https://creativecommons.org/licenses/by-sa/4.0/`,
      'Changes: Japanese-language filtering, reading normalization, field mapping, candidate labels.',
      'Exact page revision IDs are unavailable in this extraction. Source links show current pages.',
      'Retain source attribution and applicable notices; redistributed adapted text must meet ShareAlike.',
      'Additional source notices/quotations/media require review before redistributing or displaying them.',
      'This build is an unreviewed research dictionary, not a production-valid word list.',
    ].join('\n')+'\n');
    return report;
  } catch(error) {
    await archive?.close(); archive=null;
    await rm(output,{recursive:true,force:true});
    throw error;
  } finally { await archive?.close(); }
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [input,output,manifest]=process.argv.slice(2);
  if(!input||!output||!manifest) {
    console.error('Usage: node build.mjs RAW.jsonl[.gz] NEW_OUTPUT_DIR SOURCE.json'); process.exitCode=1;
  } else {
    try { console.log(JSON.stringify(await buildDictionary(input,output,JSON.parse(await readFile(manifest,'utf8'))),null,2)); }
    catch(error) { console.error(error.message);process.exitCode=1; }
  }
}
