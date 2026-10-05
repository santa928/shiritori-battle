import {test} from 'node:test';
import assert from 'node:assert/strict';
import {KANA,baseKana,nextStart,inspectDraft,createGame,applyAccepted} from './battle-rules.mjs';
const ctx=start=>({start,pool:[...KANA],usedReadings:[]});
test('first letter is free but consumed letters must be strictly unique',()=>{
 assert.deepEqual(inspectDraft('もも',ctx('も')).consumed,['も']);
 assert.equal(inspectDraft('たまたま',ctx('た')).reason,'duplicate-kana');
 assert.deepEqual(inspectDraft('かたかな',ctx('か')).consumed,['た','か','な']);
 assert.equal(inspectDraft('こころ',ctx('こ')).ok,true);
});
test('voiced and small kana share resource, long mark is free',()=>{
 assert.equal(baseKana('ぱ'),'は'); assert.equal(baseKana('っ'),'つ');
 assert.deepEqual(inspectDraft('がが',ctx('が')).consumed,['か']);
 assert.equal(inspectDraft('たはば',ctx('た')).reason,'duplicate-kana');
 assert.deepEqual(inspectDraft('きゃく',ctx('き')).consumed,['や','く']);
 assert.deepEqual(inspectDraft('こーひー',ctx('こ')).consumed,['ひ']);
 assert.equal(inspectDraft('こー',ctx('こ')).ok,true);
});
test('chain preserves voicing, expands small kana, resolves vowel including contracted sounds',()=>{
 for(const [r,c] of [['が','が'],['きゃ','や'],['こーひー','い'],['きゃー','あ'],['しゅー','う'],['ぴゅーー','う'],['んー',null]])assert.equal(nextStart(r),c);
});
test('exhausted first is allowed, later occurrence is not; reading remains distinct',()=>{
 const c={...ctx('も'),pool:KANA.filter(x=>x!=='も')};
 assert.equal(inspectDraft('もり',c).ok,true);assert.equal(inspectDraft('もも',c).reason,'used-kana');
 assert.equal(inspectDraft('かえる',{...ctx('か'),usedReadings:['かえる']}).reason,'used-reading');
 assert.equal(inspectDraft('がえる',{...ctx('が'),usedReadings:['かえる']}).ok,true);
 assert.equal(inspectDraft('か',ctx('か')).reason,'too-short');
 assert.equal(inspectDraft('かえ1',ctx('か')).reason,'invalid-reading');
 assert.equal(inspectDraft('ける',ctx('か')).reason,'wrong-start');
});
test('game validates settings and immutable commits update only correct pool',()=>{
 for(const seconds of [30,60,120,180])assert.equal(createGame({seconds,start:'か',firstPlayer:0}).seconds,seconds);
 for(const seconds of [0,360,NaN])assert.throws(()=>createGame({seconds,start:'か',firstPlayer:0}));
 const g=createGame({mode:'individual',seconds:30,start:'か',firstPlayer:0});
 const accepted={reading:'かえる',candidates:[{eligible:true}],version:'v1',sources:[]};
 const n=applyAccepted({...g,phase:'checking'},accepted);
 assert.equal(g.pools[0].includes('え'),true);assert.equal(n.pools[0].includes('え'),false);assert.equal(n.pools[1].includes('え'),true);
 assert.equal(n.history.length,1);assert.equal(n.start,'る');assert.equal(n.phase,'success');
 const shared=applyAccepted({...createGame({mode:'shared',seconds:30,start:'か',firstPlayer:0}),phase:'checking'},accepted);
 assert.deepEqual(shared.pools[0],shared.pools[1]);
});
test('dictionary-eligible n ending loses without consuming, ineligible move cannot commit',()=>{
 const g={...createGame({start:'か',firstPlayer:0}),phase:'checking'};
 const n=applyAccepted(g,{reading:'かん',candidates:[{eligible:true}],version:'v1',sources:[]});
 assert.equal(n.phase,'finished');assert.equal(n.winner,1);assert.deepEqual(n.pools,g.pools);assert.equal(n.usedReadings.length,0);assert.equal(n.history.at(-1).outcome,'n-ending');
 assert.throws(()=>applyAccepted(g,{reading:'かえる',candidates:[]}));
});
