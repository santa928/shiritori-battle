import {normalizeReading} from '../dictionary.mjs';

export const KANA_ROWS = Object.freeze(['あいうえお','かきくけこ','さしすせそ','たちつてと','なにぬねの','はひふへほ','まみむめも','や ゆ よ','らりるれろ','わ を ん']);
export const KANA = Object.freeze([...KANA_ROWS.join('').replaceAll(' ','')]);
export const TURN_SECONDS = Object.freeze([30,60,120,180]);
const small = Object.fromEntries([...'ぁぃぅぇぉっゃゅょゎゕゖ'].map((c,i)=>[c,[...'あいうえおつやゆよわかけ'][i]]));
export function baseKana(char){
 const plain=char?.normalize('NFD').replace(/[\u3099\u309a]/gu,'');
 return small[plain]??plain;
}
export function nextStart(reading){
 const chars=[...reading];let last=chars.at(-1);
 if(last==='ー'){
  last=chars.findLast(c=>c!=='ー');
  // Keep the existing rejection of an n-ending hidden by long marks.
  if(last==='ん')return null;
 }
 return small[last]??last??null;
}
export function inspectDraft(input,{start,pool,usedReadings=[],incomplete=false}){
 const reading=normalizeReading(input);const consumed=[];
 const fail=reason=>({ok:false,reason,reading,consumed});
 if(!reading||reading!==input||reading.length>64)return fail('invalid-reading');
 if(reading[0]!==start)return fail('wrong-start');
 if(!incomplete&&reading.length<2)return fail('too-short');
 if(usedReadings.includes(reading))return fail('used-reading');
 for(const char of [...reading].slice(1)){
  if(char==='ー')continue;
  const key=baseKana(char);
  if(!KANA.includes(key))return fail('invalid-reading');
  if(consumed.includes(key))return fail('duplicate-kana');
  if(!pool.includes(key))return fail('used-kana');
  consumed.push(key);
 }
 if(!nextStart(reading))return fail('invalid-ending');
 return {ok:true,reason:null,reading,consumed};
}
export function createGame({mode='individual',seconds=30,firstPlayer=0,start='か'}={}){
 if(!['individual','shared'].includes(mode)||!TURN_SECONDS.includes(seconds)||![0,1].includes(firstPlayer)||!KANA.includes(start)||['ん','を'].includes(start))throw new TypeError('invalid game settings');
 return {phase:'ready',turn:firstPlayer,start,pools:[[...KANA],[...KANA]],usedReadings:[],history:[],winner:null,reason:null,mode,seconds};
}
export function applyAccepted(game,{reading,candidates,version,sources}){
 if(game.phase!=='checking'||!candidates.some(c=>c.eligible))throw new Error('move cannot be committed');
 const check=inspectDraft(reading,{start:game.start,pool:game.pools[game.turn],usedReadings:game.usedReadings});
 if(!check.ok)throw new Error(check.reason);
 const n=structuredClone(game);const loses=reading.endsWith('ん');
 n.history.push({player:game.turn,reading,candidates:structuredClone(candidates),version,sources:structuredClone(sources??[]),consumed:loses?[]:check.consumed,outcome:loses?'n-ending':'accepted'});
 if(loses){n.phase='finished';n.reason='n-ending';n.winner=1-game.turn;return n;}
 n.pools[n.turn]=n.pools[n.turn].filter(c=>!check.consumed.includes(c));
 if(n.mode==='shared')n.pools[1-n.turn]=[...n.pools[n.turn]];
 n.usedReadings.push(reading);n.start=nextStart(reading);n.phase='success';return n;
}
