import {test} from 'node:test';import assert from 'node:assert/strict';

import {summarizeCandidates,transformLastKana,mountBattleApp} from './battle-app.mjs';
const candidate=(spelling,meaning,eligible=true)=>({eligible,spellings:[spelling],definitions:[{language:'ja',text:meaning}],sourceUrl:'https://ja.wiktionary.org/wiki/'+spelling});
test('preview keeps distinct eligible senses separate even with the same spelling',()=>{
 const r=summarizeCandidates([candidate('橋','川を渡るもの'),candidate('橋','別の語義'),candidate('箸','食器'),candidate('端','はし'),candidate('走る','動詞',false)]);
 assert.equal(r.preview.length,2);assert.equal(r.remaining,2);assert.equal(r.all.length,4);assert.ok(r.all.every(w=>w.definitions.length===1));
});
test('kana modifiers affect only editable last char and preserve first',()=>{
 assert.equal(transformLastKana('か','voice'),'か');assert.equal(transformLastKana('かは','voice'),'かば');assert.equal(transformLastKana('かば','voice'),'かは');
 assert.equal(transformLastKana('かは','semi'),'かぱ');assert.equal(transformLastKana('きや','small'),'きゃ');assert.equal(transformLastKana('きゃ','small'),'きや');assert.equal(transformLastKana('かー','voice'),'かー');
});
test('DOM match flow uses tile keys, opponent disclosure preserves input, success and result work',async()=>{
 const {parseHTML}=await import('linkedom');
 const {document}=parseHTML('<html><body><div id="battle"></div></body></html>');const root=document.querySelector('#battle');let time=0;
 const app=mountBattleApp(root,{client:{search:async reading=>({reading,status:'eligible',candidates:[candidate('蛙','両生類')],version:'v1',sources:[]})},now:()=>time,random:()=>0,autoTick:false});
 assert.equal(root.querySelector('select[name=seconds]').value,'30');
 root.querySelector('[data-action=start]').click();assert.match(root.textContent,/準備OK/);root.querySelector('[data-action=ready]').click();
 const initial=root.querySelector('[data-draft]').textContent;root.querySelector('[data-kana=え]').click();root.querySelector('[data-kana=る]').click();assert.equal(root.querySelector('[data-kana=え]').disabled,true);
 const draft=root.querySelector('[data-draft]').textContent;const details=root.querySelector('[data-opponent]');details.open=true;details.dispatchEvent(new document.defaultView.Event('toggle'));time=1000;app.tick();
 assert.equal(root.querySelector('[data-draft]').textContent,draft);assert.equal(root.querySelector('[data-opponent]').open,true);assert.equal(root.querySelector('[data-timer]').textContent,'00:29');
 root.querySelector('[data-action=delete]').click();assert.equal(root.querySelector('[data-kana=る]').disabled,false);root.querySelector('[data-kana=る]').click();root.querySelector('[data-action=submit]').click();await new Promise(r=>setTimeout(r,0));
 assert.match(root.textContent,/蛙/);root.querySelector('[data-action=next]').click();root.querySelector('[data-action=ready]').click();assert.equal(root.querySelector('[data-draft]').textContent,'る');
 root.querySelector('[data-action=resign]').click();assert.ok(root.querySelector('[data-action=confirm-resign]'));root.querySelector('[data-action=confirm-resign]').click();assert.match(root.textContent,/プレイヤー1の勝ち/);assert.match(root.textContent,/両生類/);assert.notEqual(initial,'');app.destroy();
});
test('dictionary mounting still finds its own form beside battle area',async()=>{
 const {parseHTML}=await import('linkedom');const {readFile}=await import('node:fs/promises');const {mountDictionaryApp}=await import('./app.mjs');
 const {document}=parseHTML(await readFile(new URL('./index.html',import.meta.url),'utf8'));const dict=document.querySelector('[data-dictionary-app]');
 const ui=mountDictionaryApp(dict,{client:{search:async reading=>({reading,status:'eligible',candidates:[{...candidate('蛙','両生類'),readings:['かえる'],pos:['noun'],labels:[],reasons:[]}],review:[],version:'test',sources:[]})}});
 dict.querySelector('input').value='かえる';dict.querySelector('form').dispatchEvent(new document.defaultView.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,0));assert.match(dict.textContent,/辞書では採用可/);assert.match(dict.textContent,/両生類/);ui.destroy();
});
test('multi-spelling corpus-shaped candidates stay separate and retain aliases',()=>{
 const sense=(spellings,text)=>({...candidate(spellings[0],text),spellings,readings:['はし']});
 const r=summarizeCandidates([sense(['はし','橋'],'橋の意味'),sense(['はし','箸'],'箸の意味'),sense(['箸'],'箸の別語義'),sense(['はし','端'],'端の意味'),sense(['はし','梯'],'梯の意味')],'はし');
 assert.deepEqual(r.all.map(w=>w.spelling).sort(),['橋','箸','箸','端','梯'].sort());assert.equal(r.remaining,3);assert.ok(r.all.every(w=>w.definitions.length===1));assert.ok(r.all.find(w=>w.spelling==='橋').aliases.includes('はし'));
});
test('editing restores board scroll, draft scroll and keyboard focus without resetting the clock',async()=>{
 const {parseHTML}=await import('linkedom');const {document}=parseHTML('<html><body><div id="r"></div></body></html>');let focused;
 Object.defineProperty(document,'activeElement',{get:()=>focused});document.defaultView.HTMLElement.prototype.focus=function(){focused=this;};
 const root=document.querySelector('#r');const app=mountBattleApp(root,{client:{search:async()=>({})},random:()=>0,autoTick:false});root.querySelector('[data-action=start]').click();root.querySelector('[data-action=ready]').click();
 root.querySelector('.battle-board').scrollTop=210;root.querySelector('[data-draft]').scrollLeft=90;const key=root.querySelector('[data-kana=る]');key.focus();key.click();
 assert.equal(root.querySelector('.battle-board').scrollTop,210);assert.equal(root.querySelector('[data-draft]').scrollLeft,90);assert.ok(focused.isConnected);assert.equal(focused.dataset.kana,'れ');
 const del=root.querySelector('[data-action=delete]');del.focus();del.click();assert.equal(root.querySelector('.battle-board').scrollTop,210);assert.ok(focused.isConnected);app.destroy();
});
for(const mode of ['individual','shared'])test(`player 1 starts new and repeat ${mode} matches regardless of random starting kana`,async()=>{
 const {parseHTML}=await import('linkedom');
 const {document}=parseHTML('<html><body><div id="battle"></div></body></html>');const root=document.querySelector('#battle');
 const app=mountBattleApp(root,{client:{search:async reading=>({reading,status:'eligible',candidates:[candidate('テスト語','テスト用の語義')],version:'test',sources:[]})},random:()=>0.99,autoTick:false});
 const click=action=>root.querySelector(`[data-action=${action}]`).click();
 if(mode==='shared')click('mode-shared');
 for(let match=0;match<2;match++){
  click('start');assert.equal(root.querySelector('h1').textContent,'プレイヤー1に渡してね');
  assert.match(root.textContent,/プレイヤー1が先攻です/);
  assert.equal(root.querySelector('.starting-kana').textContent,'わ');
  click('ready');assert.equal(root.querySelector('.battle-turn strong').textContent,'プレイヤー1の番');
  root.querySelector('[data-kana=か]').click();click('submit');await new Promise(r=>setTimeout(r,0));
  assert.equal(root.querySelector('[data-action=next]').textContent,'プレイヤー2へ渡す');click('next');
  assert.equal(root.querySelector('h1').textContent,'プレイヤー2に渡してね');assert.match(root.textContent,/次の番です/);
  click('ready');assert.equal(root.querySelector('.battle-turn strong').textContent,'プレイヤー2の番');
  root.querySelector('[data-kana=き]').click();click('submit');await new Promise(r=>setTimeout(r,0));click('next');
  assert.equal(root.querySelector('h1').textContent,'プレイヤー1に渡してね');click('ready');
  click('resign');click('confirm-resign');assert.match(root.textContent,/プレイヤー2の勝ち/);click('setup');
 }
 app.destroy();
});
test('presentation celebrates letters and spent tiles without delaying next turn',async()=>{
 const {parseHTML}=await import('linkedom');const {document}=parseHTML('<html><body><div id="r"></div></body></html>');const root=document.querySelector('#r');
 const app=mountBattleApp(root,{client:{search:async reading=>({reading,status:'eligible',candidates:[candidate('愛','意味1'),candidate('藍','意味2'),candidate('相','意味3')],version:'test'})},random:()=>0,autoTick:false});
 const click=a=>root.querySelector(`[data-action=${a}]`).click();click('start');click('ready');root.querySelector('[data-kana=い]').click();
 assert.equal(root.querySelectorAll('.draft-tile.entering').length,1);assert.equal(root.querySelector('.draft-tile.entering').textContent,'い');
 click('submit');await new Promise(r=>setTimeout(r,0));
 assert.equal(root.querySelector('.success-reading .reading-accessible')?.textContent,'あい');assert.equal(root.querySelectorAll('.success-letter').length,2);assert.equal(root.querySelectorAll('.consumed-tile').length,1);assert.equal(root.querySelector('.consumed-tile').textContent,'い');assert.equal(root.querySelectorAll('.celebrate article').length,2);
 assert.equal(root.dataset.player,'1');assert.equal(root.querySelector('[data-action=next]').disabled,false);click('next');assert.equal(root.dataset.player,'2');assert.equal(root.querySelectorAll('.success-letter').length,0);click('ready');assert.equal(root.querySelector('[data-timer]').textContent,'00:30');app.destroy();
});
test('critical timer stops its pulse during dictionary checks and confetti clears on restart',async()=>{
 const {parseHTML}=await import('linkedom');const {document}=parseHTML('<html><body><div id="r"></div></body></html>');const root=document.querySelector('#r');let time=0,resolve;
 const app=mountBattleApp(root,{client:{search:()=>new Promise(r=>resolve=r)},now:()=>time,random:()=>0,autoTick:false});const click=a=>root.querySelector(`[data-action=${a}]`).click();click('start');click('ready');time=25000;app.tick();assert.ok(root.querySelector('[data-timer]').classList.contains('critical'));
 root.querySelector('[data-kana=い]').click();click('submit');assert.equal(root.querySelector('[data-timer]').classList.contains('critical'),false);time=45000;app.tick();assert.equal(root.querySelector('[data-timer]').textContent,'00:05');
 click('resign');click('confirm-resign');assert.equal(root.dataset.player,'2');assert.equal(root.querySelectorAll('.battle-confetti i').length,24);assert.equal(root.querySelector('.battle-confetti').getAttribute('aria-hidden'),'true');
 click('setup');assert.equal(root.querySelector('.battle-confetti'),null);resolve({reading:'あい',status:'eligible',candidates:[candidate('愛','意味')],version:'test'});await new Promise(r=>setTimeout(r,0));assert.ok(root.querySelector('[data-action=start]'));app.destroy();
});
test('flying input is decorative, bounded and removed on animation end, edit and destroy',async()=>{
 const {parseHTML}=await import('linkedom');const {document}=parseHTML('<html><body><div id="r"></div></body></html>');const root=document.querySelector('#r');
 document.defaultView.HTMLElement.prototype.getBoundingClientRect=function(){return {left:10,top:this.classList.contains('draft-tile')?200:20,width:40,height:40};};
 const app=mountBattleApp(root,{client:{search:async()=>({})},random:()=>0,autoTick:false});const click=a=>root.querySelector(`[data-action=${a}]`).click();click('start');click('ready');root.querySelector('[data-kana=い]').click();
 let flight=root.querySelector('.kana-flight');assert.ok(flight);assert.equal(flight.getAttribute('aria-hidden'),'true');assert.equal(flight.style.getPropertyValue('--fly-y'),'180px');flight.dispatchEvent(new document.defaultView.Event('animationend'));assert.equal(root.querySelector('.kana-flight'),null);
 root.querySelector('[data-kana=う]').click();root.querySelector('.kana-flight').dispatchEvent(new document.defaultView.Event('animationcancel'));assert.equal(root.querySelector('.kana-flight'),null);root.querySelector('[data-kana=え]').click();const previousFlight=root.querySelector('.kana-flight');root.querySelector('[data-kana=お]').click();assert.equal(previousFlight.isConnected,false);assert.equal(root.querySelectorAll('.kana-flight').length,1);click('delete');click('delete');assert.equal(root.querySelector('.kana-flight'),null);
 root.querySelector('[data-kana=え]').click();app.destroy();assert.equal(root.querySelector('.kana-flight'),null);
 delete document.defaultView.HTMLElement.prototype.getBoundingClientRect;
});
test('reduced-motion avoids creating a flying input copy',async()=>{
 const {parseHTML}=await import('linkedom');const {document}=parseHTML('<html><body><div id="r"></div></body></html>');const root=document.querySelector('#r');
 document.defaultView.matchMedia=()=>({matches:true});document.defaultView.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:40,height:40});
 const app=mountBattleApp(root,{client:{search:async()=>({})},random:()=>0,autoTick:false});root.querySelector('[data-action=start]').click();root.querySelector('[data-action=ready]').click();root.querySelector('[data-kana=い]').click();assert.equal(root.querySelector('.kana-flight'),null);assert.equal(root.querySelector('[data-draft]').textContent,'あい');app.destroy();delete document.defaultView.matchMedia;delete document.defaultView.HTMLElement.prototype.getBoundingClientRect;
});
