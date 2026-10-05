import {test} from 'node:test';import assert from 'node:assert/strict';
import {createGame} from './battle-rules.mjs';import {createBattleController} from './battle-controller.mjs';
const good=reading=>({reading,status:'eligible',candidates:[{eligible:true,spellings:['蛙'],definitions:[]}],version:'v1',sources:[]});
function fixture(search=async r=>good(r),settings={}){let time=0,state;const c=createBattleController({game:createGame({start:'か',firstPlayer:0,...settings}),client:{search},now:()=>time,onState:s=>state=s});return {c,get state(){return state;},advance:ms=>{time+=ms;c.tick();}};}
test('ready starts full time, pending pauses and wrong answer resumes same remaining',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>resolve=r));f.advance(5000);assert.equal(f.state.remainingMs,30000);
 f.c.ready();f.advance(1000);assert.equal(f.state.remainingMs,29000);f.c.edit('かえる');const pending=f.c.submit();f.advance(9000);assert.equal(f.state.remainingMs,29000);
 resolve({reading:'かえる',status:'unconfirmed',candidates:[]});await pending;assert.equal(f.state.game.phase,'typing');assert.equal(f.state.remainingMs,29000);assert.equal(f.state.game.history.length,0);
 f.advance(1000);assert.equal(f.state.remainingMs,28000);
});
test('each configured time starts correctly and handover waits for ready',async()=>{
 for(const seconds of [30,60,120,180]){const f=fixture(undefined,{seconds});f.c.ready();assert.equal(f.state.remainingMs,seconds*1000);f.c.edit('かえる');await f.c.submit();assert.equal(f.state.game.phase,'success');f.advance(100000);assert.equal(f.state.game.phase,'success');f.c.next();assert.equal(f.state.game.turn,1);assert.equal(f.state.draft,'る');f.advance(100000);assert.equal(f.state.game.phase,'ready');f.c.ready();assert.equal(f.state.remainingMs,seconds*1000);}
});
test('repeated submit commits once and late response cannot revive a resigned game',async()=>{
 let calls=0,resolve;const f=fixture(()=>{calls++;return new Promise(r=>resolve=r);});f.c.ready();f.c.edit('かえる');const p=f.c.submit();await f.c.submit();assert.equal(calls,1);resolve(good('かえる'));await p;assert.equal(f.state.game.history.length,1);
 let resolve2;const g=fixture(()=>new Promise(r=>resolve2=r));g.c.ready();g.c.edit('かえる');const q=g.c.submit();g.c.resign();resolve2(good('かえる'));await q;assert.equal(g.state.game.reason,'resigned');assert.equal(g.state.game.history.length,0);
});
test('errors freeze timer, retry keeps remaining; destroy ignores pending response',async()=>{
 let calls=0;const f=fixture(async r=>{if(!calls++)throw Error('offline');return good(r);});f.c.ready();f.advance(2000);f.c.edit('かえる');await f.c.submit();assert.equal(f.state.game.phase,'error');f.advance(10000);assert.equal(f.state.remainingMs,28000);await f.c.retry();assert.equal(f.state.game.phase,'success');
 let resolve;const g=fixture(()=>new Promise(r=>resolve=r));g.c.ready();g.c.edit('かえる');const p=g.c.submit();const state=g.state;g.c.destroy();resolve(good('かえる'));await p;assert.deepEqual(g.state,state);
});
test('zero deadline fails before sending; just-before-zero accepted request gets fair pause',async()=>{
 let calls=0;const f=fixture(async r=>{calls++;return good(r);});f.c.ready();f.c.edit('かえる');f.advance(30000);await f.c.submit();assert.equal(calls,0);assert.equal(f.state.game.winner,1);assert.equal(f.state.game.reason,'timeout');
 const g=fixture();g.c.ready();g.c.edit('かえる');g.advance(29999);await g.c.submit();assert.equal(g.state.game.phase,'success');
});
test('editing is provisional, rejects duplicate resource, supports delete and variant recompute',()=>{
 const f=fixture();f.c.ready();f.c.edit('かは');assert.equal(f.state.draft,'かは');f.c.edit('かぱ');assert.equal(f.state.draft,'かぱ');assert.deepEqual(f.state.consumed,['は']);
 f.c.edit('かぱは');assert.equal(f.state.draft,'かぱ');f.c.edit('か');assert.deepEqual(f.state.consumed,[]);f.c.edit('かは');assert.equal(f.state.draft,'かは');assert.equal(f.state.game.pools[0].length,46);
});
test('used reading may be an intermediate draft prefix but cannot be submitted again',async()=>{
 let state;const c=createBattleController({game:{...createGame({start:'か'}),usedReadings:['かえ']},client:{search:async r=>good(r)},now:()=>0,onState:s=>state=s});c.ready();c.edit('かえ');assert.equal(state.draft,'かえ');await c.submit();assert.equal(state.feedback,'used-reading');c.edit('かえる');await c.submit();assert.equal(state.game.phase,'success');
});
test('editing after an error restores input with the same time and no resource consumption',async()=>{
 const f=fixture(async()=>{throw Error('offline')});f.c.ready();f.advance(2000);f.c.edit('かえる');await f.c.submit();f.advance(9000);f.c.edit('かえ');assert.equal(f.state.game.phase,'typing');assert.equal(f.state.draft,'かえ');assert.equal(f.state.remainingMs,28000);assert.equal(f.state.game.history.length,0);assert.equal(f.state.game.pools[0].length,46);f.advance(1000);assert.equal(f.state.remainingMs,27000);
});
test('cancel pending retry resumes preserved time and ignores a late acceptance',async()=>{
 let resolve,calls=0;const f=fixture(()=>{if(!calls++)throw Error('offline');return new Promise(r=>resolve=r);});f.c.ready();f.advance(3000);f.c.edit('かえる');await f.c.submit();const p=f.c.retry();f.advance(8000);f.c.cancelCheck();assert.equal(f.state.game.phase,'typing');assert.equal(f.state.remainingMs,27000);f.c.edit('かえ');resolve(good('かえる'));await p;assert.equal(f.state.draft,'かえ');assert.equal(f.state.game.history.length,0);f.advance(1000);assert.equal(f.state.remainingMs,26000);
});

test('long-mark words hand over the preceding kana in both modes without changing consumption',async()=>{
 for(const mode of ['individual','shared'])for(const [reading,start,next,consumed] of [
  ['こーひー','こ','ひ',['ひ']],['たくしー','た','し',['く','し']],
  ['きゃー','き','や',['や']],['やぎーー','や','ぎ',['き']]
 ]){
  const f=fixture(undefined,{mode,start});
  f.c.ready();f.c.edit(reading);await f.c.submit();
  assert.equal(f.state.game.phase,'success');assert.equal(f.state.game.start,next);
  assert.deepEqual(f.state.game.history[0].consumed,consumed);
  for(const kana of consumed){assert.equal(f.state.game.pools[0].includes(kana),false);assert.equal(f.state.game.pools[1].includes(kana),mode==='individual');}
  f.c.next();assert.equal(f.state.draft,next);assert.equal(f.state.game.turn,1);
 }
});
