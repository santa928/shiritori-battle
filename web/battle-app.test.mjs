import {test} from 'node:test';import assert from 'node:assert/strict';

import {summarizeCandidates,transformLastKana,mountBattleApp} from './battle-app.mjs';
const candidate=(spelling,meaning,eligible=true)=>({eligible,spellings:[spelling],definitions:[{language:'ja',text:meaning}],sourceUrl:'https://ja.wiktionary.org/wiki/'+spelling});
test('preview counts unique eligible words and preserves all senses',()=>{
 const r=summarizeCandidates([candidate('橋','川を渡るもの'),candidate('橋','別の語義'),candidate('箸','食器'),candidate('端','はし'),candidate('走る','動詞',false)]);
 assert.equal(r.preview.length,2);assert.equal(r.remaining,1);assert.equal(r.all.length,3);assert.equal(r.all[0].definitions.length,2);
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
 assert.deepEqual(r.all.map(w=>w.spelling),['橋','箸','端','梯']);assert.equal(r.remaining,2);assert.equal(r.all[1].definitions.length,2);assert.ok(r.all[0].aliases.includes('はし'));
});
test('editing restores board scroll, draft scroll and keyboard focus without resetting the clock',async()=>{
 const {parseHTML}=await import('linkedom');const {document}=parseHTML('<html><body><div id="r"></div></body></html>');let focused;
 Object.defineProperty(document,'activeElement',{get:()=>focused});document.defaultView.HTMLElement.prototype.focus=function(){focused=this;};
 const root=document.querySelector('#r');const app=mountBattleApp(root,{client:{search:async()=>({})},random:()=>0,autoTick:false});root.querySelector('[data-action=start]').click();root.querySelector('[data-action=ready]').click();
 root.querySelector('.battle-board').scrollTop=210;root.querySelector('[data-draft]').scrollLeft=90;const key=root.querySelector('[data-kana=る]');key.focus();key.click();
 assert.equal(root.querySelector('.battle-board').scrollTop,210);assert.equal(root.querySelector('[data-draft]').scrollLeft,90);assert.ok(focused.isConnected);assert.equal(focused.dataset.kana,'れ');
 const del=root.querySelector('[data-action=delete]');del.focus();del.click();assert.equal(root.querySelector('.battle-board').scrollTop,210);assert.ok(focused.isConnected);app.destroy();
});
