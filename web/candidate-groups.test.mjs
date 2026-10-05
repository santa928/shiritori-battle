import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCandidates} from './battle-app.mjs';
import {wani} from './meaning-fixtures.mjs';
const summarize=cs=>summarizeCandidates(cs,'わに').all;
test('reviewed equivalent senses become one card retaining definitions, aliases and sources',()=>{
 const groups=summarize(wani);assert.equal(groups.length,1);assert.equal(groups[0].spelling,'鰐');
 assert.deepEqual(new Set(groups[0].definitions),new Set(wani.flatMap(c=>c.definitions.map(d=>d.text))));
 assert.deepEqual(new Set(groups[0].sources),new Set(wani.map(c=>c.sourceUrl)));
 assert.ok(groups[0].aliases.includes('ワニ'));assert.ok(groups[0].aliases.includes('わに'));
});
test('same spelling distinct senses never collapse',()=>{
 const animal={...wani[0],entryId:'dog',spellings:['犬'],definitions:[{language:'ja',text:'動物'}]};
 const spy={...animal,senseId:'2',definitions:[{language:'ja',text:'スパイ'}]};
 assert.equal(summarize([animal,spy]).length,2);
});
for(const field of ['entryId','senseId','source','definitions','spellings','sourceUrl'])test(`mapping fails closed when ${field} drifts`,()=>{
 const cs=structuredClone(wani);cs[0][field]=field==='source'?{id:'new'}:field==='definitions'?[{language:'ja',text:'changed'}]:field==='spellings'?['changed']:'changed';assert.equal(summarize(cs).length,2);
});
test('one reviewed sense does not absorb another sense or excluded meaning',()=>{
 const other={...wani[0],senseId:'2',definitions:[{language:'ja',text:'別の意味'}]};
 assert.equal(summarize([...wani,other]).length,2);
 const excluded={...wani[0],eligible:false};const result=summarize([excluded,wani[1]]);assert.equal(result.length,1);assert.deepEqual(result[0].sources,[wani[1].sourceUrl]);
});
test('grouping is immutable and deterministic across input ordering',()=>{
 const before=JSON.stringify(wani);assert.deepEqual(summarize(wani),summarize([...wani].reverse()));assert.equal(JSON.stringify(wani),before);
});
test('preview caps two cards and remaining counts grouped cards',()=>{
 const extras=[1,2].map(i=>({...wani[0],entryId:'other'+i,spellings:['別'+i]}));const r=summarizeCandidates([...wani,...extras],'わに');assert.equal(r.preview.length,2);assert.equal(r.remaining,1);assert.equal(r.all.length,3);
});
test('dictionary and battle history group consistently and retain excluded cards',async()=>{
 const {parseHTML}=await import('linkedom');const {mountDictionaryApp}=await import('./app.mjs');const {mountBattleApp}=await import('./battle-app.mjs');
 const {document}=parseHTML('<html><body><div id="dict"><form><input><button type="submit"></button></form><div id="feedback"></div><div id="results"></div></div><div id="battle"></div></body></html>');
 const excluded={...wani[0],senseId:'99',eligible:false,reasons:['excluded-label'],definitions:[{language:'ja',text:'対象外の別義'}]};
 const candidates=[...wani,excluded];const client={search:async reading=>({reading,status:'eligible',candidates,review:[],sources:[],version:'test'})};
 const dict=document.querySelector('#dict');const app=mountDictionaryApp(dict,{client});dict.querySelector('input').value='わに';dict.querySelector('form').dispatchEvent(new document.defaultView.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,0));
 assert.equal(dict.querySelectorAll('.candidate').length,2);assert.equal(dict.querySelector('.count').textContent,'2件');
 for(const c of wani){assert.ok(dict.textContent.includes(c.definitions[0].text));assert.ok([...dict.querySelectorAll('a')].some(a=>a.href===c.sourceUrl));}
 assert.ok(dict.textContent.includes('対象外の別義'));
 const root=document.querySelector('#battle');const battle=mountBattleApp(root,{client,random:()=>0.999,autoTick:false});const click=a=>root.querySelector(`[data-action=${a}]`).click();click('start');click('ready');root.querySelector('[data-kana=に]').click();click('submit');await new Promise(r=>setTimeout(r,0));assert.equal(root.querySelectorAll('.battle-words article').length,1);
 click('next');click('ready');click('resign');click('confirm-resign');assert.equal(root.querySelectorAll('.battle-words article').length,1);
 for(const c of wani){assert.ok(root.textContent.includes(c.definitions[0].text));assert.ok([...root.querySelectorAll('a')].some(a=>a.href===c.sourceUrl));}assert.ok(!root.textContent.includes('対象外の別義'));battle.destroy();app.destroy();
});
test('all reviewed mappings match their pinned evidence and preserve original identities',async()=>{
 const {meaningEquivalences}=await import('./meaning-equivalences.mjs');const {groupCandidates}=await import('./candidate-groups.mjs');
 assert.ok(meaningEquivalences.length>=20);
 for(const rule of meaningEquivalences){const cs=rule.members.map(m=>({...m,eligible:true,source:{id:rule.sourceId},readings:[rule.reading],definitions:m.definitions.map(text=>({language:'ja',text})),labels:[],reasons:[]}));const grouped=groupCandidates(cs,rule.reading);assert.equal(grouped.length,1,rule.id);assert.deepEqual(new Set(grouped[0].candidates.map(c=>`${c.entryId}/${c.senseId}`)),new Set(cs.map(c=>`${c.entryId}/${c.senseId}`)));assert.deepEqual(groupCandidates([...cs].reverse(),rule.reading),grouped);grouped[0].candidates[0].spellings.push('mutation');assert.ok(cs.every(c=>!c.spellings.includes('mutation')));}
});
test('duplicated or extra definition text is source drift, not matching evidence',()=>{
 const cs=structuredClone(wani);cs[0].definitions.push({...cs[0].definitions[0]});assert.equal(summarize(cs).length,2);
});
test('merged main explanation is substantive, with complete source explanations in details',async()=>{
 const result=summarizeCandidates(wani,'わに');assert.equal(result.preview[0].definitions[0],'爬虫類、ワニ目の動物の総称。');
 const {parseHTML}=await import('linkedom');const {mountDictionaryApp}=await import('./app.mjs');const {document}=parseHTML('<div id="d"><form><input><button type="submit"></button></form><div id="feedback"></div><div id="results"></div></div>');const root=document.querySelector('#d');const ui=mountDictionaryApp(root,{client:{search:async()=>({reading:'わに',status:'eligible',candidates:wani,review:[],version:'test'})}});root.querySelector('form').dispatchEvent(new document.defaultView.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,0));
 const card=root.querySelector('.candidate');assert.equal(card.querySelectorAll(':scope > .definition').length,1);assert.equal(card.querySelector(':scope > .definition').textContent,'爬虫類、ワニ目の動物の総称。');assert.equal(card.querySelector('details summary').textContent,'出典ごとの説明');assert.ok(card.querySelector('details').textContent.includes(wani[0].definitions[0].text));assert.equal(card.querySelectorAll('details a').length,2);ui.destroy();
});
test('source-pinned 箸 reading-prefix duplicate merges without swallowing glassworking sense',async()=>{
 const {hashi}=await import('./meaning-fixtures.mjs');const {groupCandidates}=await import('./candidate-groups.mjs');const before=structuredClone(hashi);const groups=groupCandidates(hashi,'はし');
 assert.equal(groups.length,8);const food=groups.find(g=>g.candidates.some(c=>c.entryId.endsWith(':48630')));assert.equal(food.candidates.length,2);assert.equal(food.spelling,'箸');assert.ok(!food.definitions[0].startsWith('（はし）'));assert.equal(food.definitions.length,2);assert.equal(food.sources.length,2);
 const glass=groups.find(g=>g.definitions.some(d=>d.includes('吹きガラス')));assert.equal(glass.candidates.length,1);assert.notEqual(food,glass);assert.ok(groups.some(g=>g.spelling==='橋'));assert.ok(groups.some(g=>g.spelling==='端'));assert.deepEqual(hashi,before);
 const stale=structuredClone(hashi);stale.find(c=>c.entryId.endsWith(':48630')).definitions[0].text+='変更';assert.equal(groupCandidates(stale,'はし').length,9);
});
test('reviewed four-member prefix component consolidates with complete source evidence',async()=>{
 const {nagisa}=await import('./meaning-fixtures.mjs');const {groupCandidates}=await import('./candidate-groups.mjs');assert.equal(nagisa.length,4);const groups=groupCandidates(nagisa,'なぎさ');assert.equal(groups.length,1);assert.equal(groups[0].candidates.length,4);assert.ok(!groups[0].definitions[0].startsWith('（なぎさ）'));assert.deepEqual(new Set(groups[0].sources),new Set(nagisa.map(c=>c.sourceUrl)));assert.deepEqual(groupCandidates([...nagisa].reverse(),'なぎさ'),groups);assert.equal(groupCandidates(nagisa.slice(1),'なぎさ').length,3);
});
