import {mkdir,readFile,writeFile,copyFile,rm,lstat} from 'node:fs/promises';import {createReadStream} from 'node:fs';import {createHash} from 'node:crypto';import {join,dirname} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {buildWebDictionary} from './build-web-dictionary.mjs';
const project=dirname(fileURLToPath(import.meta.url));
export const releaseSources=['dictionary.mjs','reading-bucket.mjs','build-web-dictionary.mjs','build-web.mjs','import-jawiktionary.mjs','build.mjs','source.json','supplement.json','web/app.mjs','web/battle-rules.mjs','web/battle-controller.mjs','web/battle-app.mjs','web/dictionary-client.mjs','web/index.html','web/styles.css'];
async function hashFile(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
export async function buildWeb(inputDir,outputDir){
 const dataPath=join(inputDir,'dictionary.json'),archivePath=join(inputDir,'archive.jsonl');const data=JSON.parse(await readFile(dataPath,'utf8'));
 const version='v1-'+createHash('sha256').update(await hashFile(dataPath)).update(await hashFile(archivePath)).update(await hashFile(join(project,'build-web-dictionary.mjs'))).digest('hex').slice(0,16);
 await mkdir(outputDir);
 try{await mkdir(join(outputDir,'web'));await mkdir(join(outputDir,'data'));const manifest=await buildWebDictionary({dataset:data,archivePath,outputDir:join(outputDir,'data',version),version});
 for(const name of ['dictionary.mjs','reading-bucket.mjs'])await copyFile(join(project,name),join(outputDir,name));
 for(const name of ['app.mjs','battle-rules.mjs','battle-controller.mjs','battle-app.mjs','dictionary-client.mjs','styles.css'])await copyFile(join(project,'web',name),join(outputDir,'web',name));
 const buildInfo={schemaVersion:1,version,dictionarySha256:await hashFile(dataPath),sources:{}};for(const file of releaseSources)buildInfo.sources[file]=await hashFile(join(project,file));await writeFile(join(outputDir,'build-info.json'),JSON.stringify(buildInfo));
 const html=(await readFile(join(project,'web/index.html'),'utf8')).replaceAll('__MANIFEST_URL__','./data/'+version+'/manifest.json');await writeFile(join(outputDir,'index.html'),html);await writeFile(join(outputDir,'.nojekyll'),'');
 await writeFile(join(outputDir,'ATTRIBUTION.txt'),['Dictionary definitions: Japanese Wiktionary contributors, via Kaikki.org/Wiktextract.','Source page links and attribution are retained in every candidate.','CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/','Changes: Japanese-language filtering, reading normalization, labels, sense mapping and static sharding.','Current article links are not exact historical revision links.','Adapted dictionary data retains CC BY-SA 4.0; application code is separate.',...data.sources.map(s=>s.id+' | '+s.version+' | '+s.url+' | '+s.license)].join('\n')+'\n');return {version,manifest};
 }catch(error){await rm(outputDir,{recursive:true,force:true});throw error;}
}
export async function rebuildWebFromPublished({siteDir,releaseManifest:m,outputDir}){
 if(!/^v1-[a-f0-9]{16}$/.test(m.version)||!/^([a-f0-9]{64})$/.test(m.dictionarySha256))throw Error('invalid base manifest');
 const version=m.version;
 const retained=['ATTRIBUTION.txt',`data/${version}/manifest.json`,...Array.from({length:256},(_,i)=>`data/${version}/${i.toString(16).padStart(2,'0')}.json`)];
 for(const name of [...retained,'build-info.json','dictionary.mjs','reading-bucket.mjs']){
  const path=join(siteDir,name),stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||await hashFile(path)!==m.artifacts[name])throw Error('base artifact mismatch: '+name);
 }
 const oldInfo=JSON.parse(await readFile(join(siteDir,'build-info.json'),'utf8'));
 if(oldInfo.version!==version||oldInfo.dictionarySha256!==m.dictionarySha256)throw Error('base dictionary mismatch');
 for(const name of ['dictionary.mjs','reading-bucket.mjs'])if(await hashFile(join(project,name))!==m.artifacts[name])throw Error('dictionary runtime mismatch: '+name);
 await mkdir(outputDir);
 try{
  await mkdir(join(outputDir,'web'));await mkdir(join(outputDir,'data',version),{recursive:true});
  for(const name of retained)await copyFile(join(siteDir,name),join(outputDir,name));
  for(const name of ['dictionary.mjs','reading-bucket.mjs'])await copyFile(join(project,name),join(outputDir,name));
  for(const name of ['app.mjs','battle-rules.mjs','battle-controller.mjs','battle-app.mjs','dictionary-client.mjs','styles.css'])await copyFile(join(project,'web',name),join(outputDir,'web',name));
  const info={schemaVersion:1,version,dictionarySha256:m.dictionarySha256,sources:{}};
  for(const file of releaseSources)info.sources[file]=await hashFile(join(project,file));
  await writeFile(join(outputDir,'build-info.json'),JSON.stringify(info));
  await writeFile(join(outputDir,'index.html'),(await readFile(join(project,'web/index.html'),'utf8')).replaceAll('__MANIFEST_URL__','./data/'+version+'/manifest.json'));
  await writeFile(join(outputDir,'.nojekyll'),'');return {version};
 }catch(error){await rm(outputDir,{recursive:true,force:true});throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const args=process.argv.slice(2);let result,out;
  if(args[0]==='--reuse-published'){
   const [,siteDir,manifestPath,outputDir]=args;if(!siteDir||!manifestPath||!outputDir)throw Error('Usage: node build-web.mjs --reuse-published BASE_SITE BASE_MANIFEST NEW_OUTPUT');
   out=outputDir;result=await rebuildWebFromPublished({siteDir,releaseManifest:JSON.parse(await readFile(manifestPath,'utf8')),outputDir});
  }else{const [input,outputDir]=args;if(!input||!outputDir)throw Error('Usage: node build-web.mjs DICTIONARY_BUILD_DIR NEW_OUTPUT');out=outputDir;result=await buildWeb(input,out);}
  console.log(JSON.stringify({version:result.version,output:out}));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
