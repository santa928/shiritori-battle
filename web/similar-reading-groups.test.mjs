import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {meaningEquivalences} from './meaning-equivalences.mjs';import {groupCandidates} from './candidate-groups.mjs';
const evidence=JSON.parse(await readFile(new URL('../docs/similar-reading-equivalences.json',import.meta.url)));
for(const {group:expected} of evidence.groups)test(`reviewed batch equivalence: ${expected.id}`,()=>{
 const rule=meaningEquivalences.find(g=>g.id===expected.id);assert.deepEqual(rule,expected);
 const cs=rule.members.map(m=>({...m,eligible:true,source:{id:rule.sourceId},readings:[rule.reading],definitions:m.definitions.map(text=>({language:'ja',text}))}));
 assert.equal(groupCandidates(cs,rule.reading).length,1);assert.equal(groupCandidates(cs.slice(1),rule.reading).length,cs.length-1);
 const changed=structuredClone(cs);changed[0].definitions[0].text+='変更';assert.equal(groupCandidates(changed,rule.reading).length,cs.length);
 const other={...cs[0],senseId:'unreviewed'};assert.equal(groupCandidates([...cs,other],rule.reading).length,2);
});
test('broad whale and ambiguous cucumber references stay outside added groups',()=>{
 assert.equal(meaningEquivalences.length,380);
 assert.ok(!meaningEquivalences.some(g=>g.members.some(m=>m.entryId.endsWith(':44111'))));
 assert.ok(!evidence.groups.some(({group:g})=>g.members.some(m=>m.entryId.endsWith(':241124')||m.entryId.endsWith(':28409')||m.entryId.endsWith(':55664'))));
});
test('all prior groups except approved shark extension and all prior primaries remain unchanged',async()=>{
 const {createHash}=await import('node:crypto');const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
 const prior=meaningEquivalences.slice(0,365);
 assert.equal(sha(prior.filter(g=>g.id!=='equivalent-93e1cc8b60ec8299')),'bf1fbf4bae6c5e148283d72ddd78f5de9ca598195ad51a8c19fd9c7a23fcbe8d');
 assert.equal(sha(prior.map(g=>({id:g.id,primaryMember:g.primaryMember}))),'2ca09a9d133bc09cde07a313b89fca8d04980a8058bd82ccfb8c465860510a5e');
});
