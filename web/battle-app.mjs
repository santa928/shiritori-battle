import {KANA,KANA_ROWS,TURN_SECONDS,baseKana,createGame} from './battle-rules.mjs';
import {createBattleController} from './battle-controller.mjs';
import {createDictionaryClient} from './dictionary-client.mjs';

export function summarizeCandidates(candidates=[],reading){
 const words=new Map();
 for(const c of candidates.filter(c=>c.eligible)){
  const matchReading=reading??c.readings?.[0];
  const spelling=c.spellings?.find(x=>x!==matchReading)??c.spellings?.[0]??'ことば';
  if(!words.has(spelling))words.set(spelling,{spelling,aliases:[],definitions:[],sources:[]});
  const word=words.get(spelling);
  for(const alias of c.spellings??[])if(alias!==spelling&&!word.aliases.includes(alias))word.aliases.push(alias);
  for(const d of c.definitions??[])if(d.language==='ja'&&!word.definitions.includes(d.text))word.definitions.push(d.text);
  if(c.sourceUrl&&!word.sources.includes(c.sourceUrl))word.sources.push(c.sourceUrl);
 }
 const all=[...words.values()];return {preview:all.slice(0,2),remaining:Math.max(0,all.length-2),all};
}
export function transformLastKana(reading,kind){
 if(reading.length<2)return reading;
 const last=reading.at(-1);let next=last;
 if(kind==='small'){
  const large='あいうえおつやゆよわかけ',small='ぁぃぅぇぉっゃゅょゎゕゖ';
  if(large.includes(last))next=small[large.indexOf(last)];else if(small.includes(last))next=large[small.indexOf(last)];
 }else{
  const plain=baseKana(last),mark=kind==='semi'?'\u309a':'\u3099';
  const allowed=kind==='semi'?'はひふへほ':'かきくけこさしすせそたちつてとはひふへほう';
  if(allowed.includes(plain)){const composed=(plain+mark).normalize('NFC');next=last===composed?plain:composed;}
 }
 return reading.slice(0,-1)+next;
}
const messages={
 'duplicate-kana':'同じ文字は1回だけ。入力を直してください。','used-kana':'その文字はもう使っています。','used-reading':'その読みは、この勝負ですでに出ています。',
 'too-short':'2文字以上のことばにしてください。','wrong-start':'最初の文字は変えられません。','invalid-reading':'使えるかなで、64文字以内で入力してください。','invalid-ending':'最後の音を確認してください。',
 ineligible:'この読みは対象外です。別のことばをどうぞ。',pending:'辞書で確認中の読みです。別のことばをどうぞ。',unconfirmed:'辞書に見つかりません。文字を直して、もう一度。','network-error':'辞書を読み込めませんでした。残り時間は止めています。'
};
const terminalCopy={'timeout':'時間切れ','resigned':'降参','n-ending':'「ん」で終わりました'};
export function mountBattleApp(root,{client,now=()=>performance.now(),random=Math.random,autoTick=true,onMatchState=()=>{}}){
 const doc=root.ownerDocument;let controller=null,state=null,lastKey='',opponentOpen=false,resignOpen=false,interval=null,settings={mode:'individual',seconds:30};
 const el=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const button=(text,action,cls='')=>{const n=el('button',text,cls);n.type='button';n.dataset.action=action;return n;};
 function heading(text,small){const box=el('div',undefined,'battle-heading');if(small)box.append(el('p',small,'eyebrow'));box.append(el('h1',text));return box;}
 function showSetup(){
  controller?.destroy();controller=null;state=null;lastKey='';root.className='battle-root';root.replaceChildren();onMatchState(false);
  root.append(heading('ことばで、勝負しよう。','ふたりで遊ぶ、しりとりバトル'));
  const tiles=el('div',undefined,'setup-tiles');for(const c of ['し','り','と','り'])tiles.append(el('span',c));root.append(tiles);
  root.append(el('p','ひとつのスマホを交互に。\n使える文字を残しながら、つなげよう。','battle-lead'));
  const form=el('div',undefined,'battle-settings');
  const modeLabel=el('label','文字の持ち方');const modes=el('div',undefined,'setting-options');
  for(const [value,name,sub] of [['individual','ひとりずつ','それぞれの文字で勝負'],['shared','ふたりで共有','同じ文字を使って勝負']]){
   const b=button('',`mode-${value}`,'setting-option'+(settings.mode===value?' selected':''));b.setAttribute('aria-pressed',String(settings.mode===value));b.append(el('strong',name),el('span',sub));modes.append(b);
  }
  form.append(modeLabel,modes);const timeLabel=el('label','1手の制限時間');timeLabel.htmlFor='turn-seconds';const select=el('select');select.id='turn-seconds';select.name='seconds';
  for(const [i,seconds] of TURN_SECONDS.entries()){const option=el('option',['30秒','1分','2分','3分'][i]);option.value=String(seconds);if(seconds===settings.seconds)option.setAttribute('selected','');select.append(option);}
  select.addEventListener('change',()=>{settings.seconds=Number(select.value);});form.append(timeLabel,select);root.append(form,button('ふたりで対戦する','start','battle-primary'));
  const rules=el('details',undefined,'battle-rules-help');rules.append(el('summary','あそび方・文字のルール'));
  for(const s of ['先頭の1文字は無料。2文字目から、同じ文字は1回だけ。','「もも」はOK。「たまたま」は「ま」が2回なので使えません。','が・ぱ・ゃ・っは、か・は・や・つの文字を使います。「ー」は無料。','同じ読みはもう使えません。辞書にある一般名詞・地名でつなぎます。','1文字だけの語は使えません。「ん」で終わる・時間切れ・降参で負け。','画面の文字を押して入力。相手の残り文字も確認できます。'])rules.append(el('p',s));
  root.append(rules);
 }
 function updateClock(){
  const timer=root.querySelector('[data-timer]');if(timer&&state){const seconds=Math.ceil(state.remainingMs/1000);timer.textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');timer.classList.toggle('urgent',seconds<=10&&state.game.phase==='typing');}
  const fill=root.querySelector('[data-clock-fill]');if(fill&&state)fill.style.width=100*state.remainingMs/(state.game.seconds*1000)+'%';
 }
 function receive(next){
  state=next;const key=JSON.stringify([next.game.phase,next.game.turn,next.draft,next.feedback,next.game.history.length,resignOpen]);
  if(key!==lastKey){
   const oldBoard=root.querySelector('.battle-board'),oldDraft=root.querySelector('[data-draft]');
   const boardTop=oldBoard?.scrollTop??0,draftLeft=oldDraft?.scrollLeft??0;
   const focused=doc.activeElement,hadFocus=focused&&root.contains(focused);
   const action=hadFocus?focused.dataset?.action:null,kana=hadFocus?focused.dataset?.kana:null;
   lastKey=key;render();
   if(hadFocus){
    let target=kana?root.querySelector(`[data-kana="${kana}"]`):action?root.querySelector(`[data-action="${action}"]`):null;
    if(target?.disabled&&kana){const keys=[...root.querySelectorAll('.battle-board button')],at=keys.findIndex(k=>k.dataset.kana===kana);target=[...keys.slice(at+1),...keys.slice(0,at)].find(k=>!k.disabled);}
    if(!target||target.disabled)target=root.querySelector('.battle-primary:not([disabled]), .battle-utils button:not([disabled])');
    target?.focus({preventScroll:true});
   }
   const board=root.querySelector('.battle-board'),draftNode=root.querySelector('[data-draft]');
   if(board)board.scrollTop=boardTop;
   if(draftNode){const end=draftNode.scrollWidth-draftNode.clientWidth;draftNode.scrollLeft=Number.isFinite(end)?Math.max(0,end):draftLeft;}
  }updateClock();
 }
 function start(){
  const starts=KANA.filter(c=>!['ん','を','ぢ','づ'].includes(c));const choose=n=>Math.min(n-1,Math.max(0,Math.floor(random()*n)));
  opponentOpen=false;resignOpen=false;onMatchState(true);controller=createBattleController({game:createGame({...settings,firstPlayer:0,start:starts[choose(starts.length)]}),client,now,onState:receive});
 }
 function wordsBlock(words,animated=false){
  const list=el('div',undefined,'battle-words'+(animated?' celebrate':''));
  words.forEach((word,i)=>{const row=el('article');row.style.animationDelay=i*120+'ms';row.append(el('h3',word.spelling));for(const text of word.definitions)row.append(el('p',text));
   if(!animated&&word.aliases?.length)row.append(el('p','別表記：'+word.aliases.join('・'),'battle-hint'));
   if(!animated)for(const source of word.sources){try{const url=new URL(source);if(!['https:','http:'].includes(url.protocol))continue;const a=el('a','出典：ウィクショナリー ↗');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';row.append(a);}catch{}}
   list.append(row);});return list;
 }
 function render(){
  const g=state.game;root.replaceChildren();root.className='battle-root battle-'+g.phase;
  if(g.phase==='ready'){
   root.append(heading(`プレイヤー${g.turn+1}に渡してね`,g.history.length?'次の番です':'プレイヤー1が先攻です'));
   root.append(el('p','次はこの文字から','battle-lead'),el('div',g.start,'starting-kana'),el('p',`${g.seconds}秒 · ${g.mode==='shared'?'ふたりで共有':'文字はひとりずつ'}`,'battle-lead'),button('準備OK、はじめる','ready','battle-primary'));
   root.append(el('p','押すとタイマーが動きます','battle-hint'));return;
  }
  if(g.phase==='success'){
   const move=g.history.at(-1),summary=summarizeCandidates(move.candidates,move.reading);
   root.append(heading('つながった！',`プレイヤー${g.turn+1} · ${g.history.length}手目`));
   const reading=el('div',move.reading,'success-reading');root.append(reading,wordsBlock(summary.preview.map(w=>({...w,definitions:w.definitions.slice(0,1)})),true));
   if(summary.remaining)root.append(el('p',`他${summary.remaining}件 · 全部の意味は勝負のあとで`,'battle-hint'));
   root.append(el('p',`使った文字：${move.consumed.join('・')||'なし'}`,'battle-hint'),button(`プレイヤー${2-g.turn}へ渡す`,'next','battle-primary'));return;
  }
  if(g.phase==='finished'){
   onMatchState(false);root.append(heading(`プレイヤー${g.winner+1}の勝ち！`,terminalCopy[g.reason]));root.append(el('p',`${g.history.filter(x=>x.outcome==='accepted').length}語、つながりました`,'battle-lead'),button('もう一度あそぶ','setup','battle-primary'));
   const history=el('section',undefined,'battle-history');history.append(el('h2','この勝負のことば'));
   if(!g.history.length)history.append(el('p','まだことばは出ていません。次の勝負でつなげよう。'));
   g.history.forEach((move,i)=>{const details=el('details');const sum=el('summary',`${i+1}. ${move.reading}　プレイヤー${move.player+1}${move.outcome==='n-ending'?' · んで終了':''}`);details.append(sum,wordsBlock(summarizeCandidates(move.candidates,move.reading).all),el('p',`辞書版：${move.version}`,'battle-hint'));history.append(details);});
   root.append(history,el('p','語義：ウィクショナリー日本語版 / Kaikki・Wiktextract。CC BY-SA 4.0。各語の出典は一覧を開くと確認できます。','battle-hint'));return;
  }
  const play=el('div',undefined,'battle-play');
  const top=el('div',undefined,'battle-turn');top.append(el('strong',`プレイヤー${g.turn+1}の番`));const timer=el('span','','battle-timer');timer.dataset.timer='';timer.setAttribute('aria-label','残り時間');top.append(timer);play.append(top);
  const bar=el('div',undefined,'battle-clock');const fill=el('div');fill.dataset.clockFill='';bar.append(fill);play.append(bar);
  const opponent=el('details',undefined,'opponent-pool');opponent.dataset.opponent='';opponent.open=opponentOpen;
  opponent.append(el('summary',g.mode==='shared'?'共通の残り文字を見る':'相手の残り文字を見る'));
  const other=el('div',undefined,'opponent-letters');for(const c of KANA){const present=g.pools[1-g.turn].includes(c);const tile=el('span',c,present?'':'spent');tile.setAttribute('aria-label',c+(present?' 使用可':' 使用済み'));other.append(tile);}opponent.append(other,el('p','見ている間も時間は進みます','battle-hint'));
  opponent.addEventListener('toggle',()=>{opponentOpen=opponent.open;});play.append(opponent);
  play.append(el('p',`${g.mode==='shared'?'共通の文字':'使える文字・ひとりずつ'}　|　同じ文字は1回`,'board-label'));
  const board=el('div',undefined,'battle-board');board.setAttribute('aria-label','かな入力盤');
  for(const row of KANA_ROWS)for(const c of row){
   if(c===' '){const blank=el('span',undefined,'kana-blank');blank.setAttribute('aria-hidden','true');board.append(blank);continue;}
   const pending=state.consumed.includes(c),spent=!g.pools[g.turn].includes(c);const b=button(c,'kana','battle-kana'+(pending?' pending':'')+(spent?' spent':''));b.dataset.kana=c;b.disabled=pending||spent||g.phase!=='typing';b.setAttribute('aria-label',c+(pending?' 入力中':spent?' 使用済み':' 入力'));if(pending||spent)b.append(el('small',pending?'✓':'／'));board.append(b);
  }
  play.append(board);
  const entry=el('div',undefined,'battle-entry');const status=el('p',messages[state.feedback]??(g.phase==='checking'?'辞書で確認中… 時間は止めています':`次は「${g.start}」から`),'battle-feedback');status.setAttribute('role','status');entry.append(status);
  const line=el('div',undefined,'draft-line');const draft=el('div',undefined,'battle-draft');draft.dataset.draft='';draft.setAttribute('aria-label','入力中のことば：'+state.draft);
  [...state.draft].forEach((c,i)=>{const tile=el('span',c,i?'draft-tile':'draft-tile first');if(i===0)tile.setAttribute('aria-label',c+' 先頭は消費なし');draft.append(tile);});line.append(draft);const del=button('⌫','delete','battle-delete');del.setAttribute('aria-label','1文字消す');del.disabled=state.draft.length<=1||g.phase!=='typing';line.append(del);entry.append(line,el('p','先頭の1文字は消費なし','first-free'));
  const utils=el('div',undefined,'battle-utils');for(const [text,action] of [['゛','voice'],['゜','semi'],['小文字','small'],['ー','long']]){const b=button(text,action);b.disabled=g.phase!=='typing'||(action!=='long'&&state.draft.length<=1);utils.append(b);}entry.append(utils);
  const confirm=button(g.phase==='checking'?'辞書で確認中…':g.phase==='error'?'辞書をもう一度読み込む':'これで決定',g.phase==='error'?'retry':'submit','battle-primary');confirm.disabled=g.phase==='checking'||(g.phase==='typing'&&state.draft.length<2);entry.append(confirm);
  const resign=button('降参する','resign','battle-text-button');entry.append(resign);
  if(resignOpen){const confirmation=el('div',undefined,'resign-confirm');confirmation.append(el('p','この勝負を降参しますか？'),button('降参して終わる','confirm-resign'),button('続ける','cancel-resign'));entry.append(confirmation);}
  play.append(entry);root.append(play);updateClock();
 }
 function act(e){const b=e.target.closest('button[data-action]');if(!b||!root.contains(b)||b.disabled)return;const action=b.dataset.action;
  if(action.startsWith('mode-')){settings.mode=action.slice(5);showSetup();return;}
  if(action==='start'){start();return;}if(action==='setup'){showSetup();return;}if(!controller)return;
  if(action==='ready')controller.ready();else if(action==='next')controller.next();else if(action==='submit')controller.submit();else if(action==='retry')controller.retry();
  else if(action==='resign'){resignOpen=true;lastKey='';receive(state);}else if(action==='cancel-resign'){resignOpen=false;lastKey='';receive(state);}else if(action==='confirm-resign'){resignOpen=false;controller.resign();}
  else if(action==='kana')controller.edit(state.draft+b.dataset.kana);else if(action==='delete')controller.edit(state.draft.slice(0,-1));else if(action==='long')controller.edit(state.draft+'ー');else if(['voice','semi','small'].includes(action))controller.edit(transformLastKana(state.draft,action));
 }
 root.addEventListener('click',act);showSetup();if(autoTick)interval=setInterval(()=>controller?.tick(),100);
 return {tick(){controller?.tick();},destroy(){controller?.destroy();if(interval!==null)clearInterval(interval);root.removeEventListener('click',act);}};
}
if(typeof document!=='undefined'){
 const root=document.querySelector('[data-battle-app]');if(root){
  const dictionary=document.querySelector('[data-dictionary-app]');const battleTab=document.querySelector('[data-mode=battle]');const dictTab=document.querySelector('[data-mode=dictionary]');let locked=false;
  const show=mode=>{if(mode==='dictionary'&&locked)return;root.hidden=mode!=='battle';dictionary.hidden=mode!=='dictionary';for(const tab of [battleTab,dictTab]){const active=tab.dataset.mode===mode;tab.classList.toggle('mode-active',active);tab.setAttribute('aria-pressed',String(active));}document.body.classList.toggle('is-battle',mode==='battle');};
  battleTab.addEventListener('click',()=>show('battle'));dictTab.addEventListener('click',()=>show('dictionary'));
  mountBattleApp(root,{client:createDictionaryClient({manifestUrl:new URL(root.dataset.manifest,document.baseURI).href}),onMatchState:active=>{locked=active;document.body.classList.toggle('match-active',active);dictTab.disabled=active;dictTab.title=active?'対戦が終わると辞書を開けます':'';}});show('battle');
 }
}
