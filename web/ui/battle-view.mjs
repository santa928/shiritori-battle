import { KANA_ROWS, TURN_SECONDS } from '../battle-rules.mjs?v=20261006-maintainability1';
import { summarizeCandidates } from './candidate-summary.mjs?v=20261006-maintainability1';
import { updateClock } from './battle-feedback.mjs?v=20261006-maintainability1';

const messages = {
  'duplicate-kana': '同じ文字は1回だけ。入力を直してください。',
  'used-kana': 'その文字はもう使っています。',
  'used-reading': 'その読みは、この勝負ですでに出ています。',
  'too-short': '2文字以上のことばにしてください。',
  'wrong-start': '最初の文字は変えられません。',
  'invalid-reading': '使えるかなで、64文字以内で入力してください。',
  'invalid-ending': '最後の音を確認してください。',
  ineligible: 'この読みは対象外です。別のことばをどうぞ。',
  pending: '辞書で確認中の読みです。別のことばをどうぞ。',
  unconfirmed: '辞書に見つかりません。文字を直して、もう一度。',
  'network-error':
    '辞書を読み込めませんでした。残り時間は止めています。再読み込みか、文字を直して続けられます。編集すると時間が再開します。',
};
const terminalCopy = { timeout: '時間切れ', resigned: '降参', 'n-ending': '「ん」で終わりました' };
/**
 * 対戦のDOMを描画する。ゲーム状態・通信・タイマーは所有しない。
 * @param {HTMLElement} root 設定と対戦画面の描画先。
 * @returns {{renderSetup: function(object, function): void, render: function(object, object): void}} 設定値またはスナップショットとUI通知先を受け取る描画関数。
 */
export function createBattleView(root) {
  const doc = root.ownerDocument;
  const el = (tag, text, cls) => {
    const n = doc.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const button = (text, action, cls = '') => {
    const n = el('button', text, cls);
    n.type = 'button';
    n.dataset.action = action;
    return n;
  };
  function heading(text, small) {
    const box = el('div', undefined, 'battle-heading');
    if (small) box.append(el('p', small, 'eyebrow'));
    box.append(el('h1', text));
    return box;
  }
  function renderSetup(settings, onSecondsChange) {
    root.append(heading('ことばで、勝負しよう。', 'ふたりで遊ぶ、しりとりバトル'));
    const tiles = el('div', undefined, 'setup-tiles');
    for (const c of ['し', 'り', 'と', 'り']) tiles.append(el('span', c));
    root.append(tiles);
    root.append(
      el('p', 'ひとつのスマホを交互に。\n使える文字を残しながら、つなげよう。', 'battle-lead'),
    );
    const form = el('div', undefined, 'battle-settings');
    const modeLabel = el('label', '文字の持ち方');
    const modes = el('div', undefined, 'setting-options');
    for (const [value, name, sub] of [
      ['individual', 'ひとりずつ', 'それぞれの文字で勝負'],
      ['shared', 'ふたりで共有', '同じ文字を使って勝負'],
    ]) {
      const b = button(
        '',
        `mode-${value}`,
        'setting-option' + (settings.mode === value ? ' selected' : ''),
      );
      b.setAttribute('aria-pressed', String(settings.mode === value));
      b.append(el('strong', name), el('span', sub));
      modes.append(b);
    }
    form.append(modeLabel, modes);
    const timeLabel = el('label', '1手の制限時間');
    timeLabel.htmlFor = 'turn-seconds';
    const select = el('select');
    select.id = 'turn-seconds';
    select.name = 'seconds';
    for (const [i, seconds] of TURN_SECONDS.entries()) {
      const option = el('option', ['30秒', '1分', '2分', '3分'][i]);
      option.value = String(seconds);
      if (seconds === settings.seconds) option.setAttribute('selected', '');
      select.append(option);
    }
    select.addEventListener('change', () => {
      onSecondsChange(Number(select.value));
    });
    form.append(timeLabel, select);
    root.append(form, button('ふたりで対戦する', 'start', 'battle-primary'));
    const rules = el('details', undefined, 'battle-rules-help');
    rules.append(el('summary', 'あそび方・文字のルール'));
    for (const s of [
      '先頭の1文字は無料。2文字目から、同じ文字は1回だけ。',
      '「もも」はOK。「たまたま」は「ま」が2回なので使えません。',
      'が・ぱ・ゃ・っは、か・は・や・つの文字を使います。「ー」は無料。',
      '末尾の「ー」は飛ばして、その前の文字でつなぎます。コーヒー→ひ、タクシー→し。',
      '同じ読みはもう使えません。辞書にある一般名詞・地名でつなぎます。',
      '1文字だけの語は使えません。「ん」で終わる・時間切れ・降参で負け。',
      '画面の文字を押して入力。相手の残り文字も確認できます。',
    ])
      rules.append(el('p', s));
    root.append(rules);
  }
  function wordsBlock(words, animated = false) {
    const list = el('div', undefined, 'battle-words' + (animated ? ' celebrate' : ''));
    words.forEach((word, i) => {
      const row = el('article');
      row.style.animationDelay = animated ? 260 + i * 180 + 'ms' : '0ms';
      row.append(el('h3', word.spelling));
      for (const text of !animated && word.candidates?.length > 1
        ? word.definitions.slice(0, 1)
        : word.definitions)
        row.append(el('p', text));
      if (!animated && word.aliases?.length)
        row.append(el('p', '別表記：' + word.aliases.join('・'), 'battle-hint'));
      if (!animated && word.candidates?.length > 1) {
        const details = el('details');
        details.append(el('summary', '出典ごとの説明'));
        for (const original of word.candidates) {
          const section = el('section');
          section.append(el('p', original.spellings.join('・'), 'battle-hint'));
          for (const definition of original.definitions.filter((d) => d.language === 'ja'))
            section.append(el('p', definition.text));
          if (original.labels?.length)
            section.append(el('p', '分類：' + original.labels.join('・'), 'battle-hint'));
          try {
            const url = new URL(original.sourceUrl);
            if (['https:', 'http:'].includes(url.protocol)) {
              const a = el('a', '出典：ウィクショナリー ↗');
              a.href = url.href;
              a.target = '_blank';
              a.rel = 'noopener noreferrer';
              section.append(a);
            }
          } catch {}
          details.append(section);
        }
        row.append(details);
      }
      if (!animated && word.candidates?.length <= 1)
        for (const source of word.sources) {
          try {
            const url = new URL(source);
            if (!['https:', 'http:'].includes(url.protocol)) continue;
            const a = el('a', '出典：ウィクショナリー ↗');
            a.href = url.href;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            row.append(a);
          } catch {}
        }
      list.append(row);
    });
    return list;
  }
  function render(state, { opponentOpen, resignOpen, onOpponentOpen, onMatchState }) {
    const g = state.game;
    root.replaceChildren();
    root.className = 'battle-root battle-' + g.phase;
    root.dataset.player = String((g.phase === 'finished' ? g.winner : g.turn) + 1);
    if (g.phase === 'ready') {
      root.append(
        heading(
          `プレイヤー${g.turn + 1}に渡してね`,
          g.history.length ? '次の番です' : 'プレイヤー1が先攻です',
        ),
      );
      root.append(
        el('p', '次はこの文字から', 'battle-lead'),
        el('div', g.start, 'starting-kana'),
        el(
          'p',
          `${g.seconds}秒 · ${g.mode === 'shared' ? 'ふたりで共有' : '文字はひとりずつ'}`,
          'battle-lead',
        ),
        button('準備OK、はじめる', 'ready', 'battle-primary'),
      );
      root.append(el('p', '押すとタイマーが動きます', 'battle-hint'));
      return;
    }
    if (g.phase === 'success') {
      const move = g.history.at(-1),
        summary = summarizeCandidates(move.candidates, move.reading);
      root.append(heading('つながった！', `プレイヤー${g.turn + 1} · ${g.history.length}手目`));
      const reading = el('div', undefined, 'success-reading');
      reading.append(el('span', move.reading, 'reading-accessible'));
      for (const [i, c] of [...move.reading].entries()) {
        const letter = el('span', c, 'success-letter');
        letter.setAttribute('aria-hidden', 'true');
        letter.style.animationDelay = Math.min(i, 12) * 45 + 'ms';
        reading.append(letter);
      }
      root.append(
        reading,
        wordsBlock(
          summary.preview.map((w) => ({ ...w, definitions: w.definitions.slice(0, 1) })),
          true,
        ),
      );
      if (summary.remaining)
        root.append(el('p', `他${summary.remaining}件 · 全部の意味は勝負のあとで`, 'battle-hint'));
      const consumed = el('div', undefined, 'consumed-tiles');
      consumed.setAttribute('aria-label', `使った文字：${move.consumed.join('・') || 'なし'}`);
      consumed.append(el('span', '使った文字', 'consumed-label'));
      for (const [i, c] of move.consumed.entries()) {
        const tile = el('span', c, 'consumed-tile');
        tile.style.animationDelay = 180 + Math.min(i, 12) * 45 + 'ms';
        consumed.append(tile);
      }
      if (!move.consumed.length) consumed.append(el('span', 'なし'));
      root.append(consumed, button(`プレイヤー${2 - g.turn}へ渡す`, 'next', 'battle-primary'));
      return;
    }
    if (g.phase === 'finished') {
      onMatchState(false);
      const confetti = el('div', undefined, 'battle-confetti');
      confetti.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 24; i++) {
        const piece = el('i');
        piece.style.setProperty('--x', ((i * 37) % 100) + '%');
        piece.style.setProperty('--drift', ((i % 5) - 2) * 28 + 'px');
        piece.style.setProperty('--spin', (i % 2 ? 1 : -1) * 420 + 'deg');
        piece.style.animationDelay = (i % 6) * 65 + 'ms';
        confetti.append(piece);
      }
      root.append(confetti);
      root.append(heading(`プレイヤー${g.winner + 1}の勝ち！`, terminalCopy[g.reason]));
      root.append(
        el(
          'p',
          `${g.history.filter((x) => x.outcome === 'accepted').length}語、つながりました`,
          'battle-lead',
        ),
        button('もう一度あそぶ', 'setup', 'battle-primary'),
      );
      const history = el('section', undefined, 'battle-history');
      history.append(el('h2', 'この勝負のことば'));
      if (!g.history.length)
        history.append(el('p', 'まだことばは出ていません。次の勝負でつなげよう。'));
      g.history.forEach((move, i) => {
        const details = el('details');
        const sum = el(
          'summary',
          `${i + 1}. ${move.reading}　プレイヤー${move.player + 1}${move.outcome === 'n-ending' ? ' · んで終了' : ''}`,
        );
        details.append(
          sum,
          wordsBlock(summarizeCandidates(move.candidates, move.reading).all),
          el('p', `辞書版：${move.version}`, 'battle-hint'),
        );
        history.append(details);
      });
      root.append(
        history,
        el(
          'p',
          '語義：ウィクショナリー日本語版 / Kaikki・Wiktextract。CC BY-SA 4.0。各語の出典は一覧を開くと確認できます。',
          'battle-hint',
        ),
      );
      return;
    }
    const play = el('div', undefined, 'battle-play');
    const top = el('div', undefined, 'battle-turn');
    top.append(el('strong', `プレイヤー${g.turn + 1}の番`));
    const timer = el('span', '', 'battle-timer');
    timer.dataset.timer = '';
    timer.setAttribute('aria-label', '残り時間');
    top.append(timer);
    play.append(top);
    const bar = el('div', undefined, 'battle-clock');
    const fill = el('div');
    fill.dataset.clockFill = '';
    bar.append(fill);
    play.append(bar);
    const opponent = el('details', undefined, 'opponent-pool');
    opponent.dataset.opponent = '';
    opponent.open = opponentOpen;
    opponent.append(
      el('summary', g.mode === 'shared' ? '共通の残り文字を見る' : '相手の残り文字を見る'),
    );
    const other = el('div', undefined, 'opponent-letters');
    other.setAttribute('aria-label', '残り文字の五十音表。右からあ行、か行。');
    // 各行を縦に読み、右からあ行・か行と並べる。や行・わ行の空マスも保つ。
    for (let vowel = 0; vowel < 5; vowel++)
      for (const row of [...KANA_ROWS].reverse()) {
        const c = row[vowel];
        if (c === ' ') {
          const blank = el('span', undefined, 'opponent-blank');
          blank.setAttribute('aria-hidden', 'true');
          other.append(blank);
          continue;
        }
        const present = g.pools[1 - g.turn].includes(c);
        const tile = el('span', c, present ? '' : 'spent');
        tile.setAttribute('aria-label', c + (present ? ' 使用可' : ' 使用済み'));
        other.append(tile);
      }
    opponent.append(other, el('p', '見ている間も時間は進みます', 'battle-hint'));
    opponent.addEventListener('toggle', () => {
      onOpponentOpen(opponent.open);
    });
    play.append(opponent);
    play.append(
      el(
        'p',
        `${g.mode === 'shared' ? '共通の文字' : '使える文字・ひとりずつ'}　|　同じ文字は1回`,
        'board-label',
      ),
    );
    const board = el('div', undefined, 'battle-board');
    board.setAttribute('aria-label', 'かな入力盤');
    for (const row of KANA_ROWS)
      for (const c of row) {
        if (c === ' ') {
          const blank = el('span', undefined, 'kana-blank');
          blank.setAttribute('aria-hidden', 'true');
          board.append(blank);
          continue;
        }
        const pending = state.consumed.includes(c),
          spent = !g.pools[g.turn].includes(c);
        const b = button(
          c,
          'kana',
          'battle-kana' + (pending ? ' pending' : '') + (spent ? ' spent' : ''),
        );
        b.dataset.kana = c;
        b.disabled = pending || spent || !['typing', 'error'].includes(g.phase);
        b.setAttribute('aria-label', c + (pending ? ' 入力中' : spent ? ' 使用済み' : ' 入力'));
        if (pending || spent) b.append(el('small', pending ? '✓' : '／'));
        board.append(b);
      }
    play.append(board);
    const entry = el('div', undefined, 'battle-entry');
    const status = el(
      'p',
      messages[state.feedback] ??
        (g.phase === 'checking' ? '辞書で確認中… 時間は止めています' : `次は「${g.start}」から`),
      'battle-feedback',
    );
    status.setAttribute('role', 'status');
    entry.append(status);
    const line = el('div', undefined, 'draft-line');
    const draft = el('div', undefined, 'battle-draft');
    draft.dataset.draft = '';
    draft.setAttribute('aria-label', '入力中のことば：' + state.draft);
    [...state.draft].forEach((c, i) => {
      const tile = el('span', c, i ? 'draft-tile' : 'draft-tile first');
      if (i === 0) tile.setAttribute('aria-label', c + ' 先頭は消費なし');
      draft.append(tile);
    });
    line.append(draft);
    const del = button('⌫', 'delete', 'battle-delete');
    del.setAttribute('aria-label', '1文字消す');
    del.disabled = state.draft.length <= 1 || !['typing', 'error'].includes(g.phase);
    line.append(del);
    entry.append(line, el('p', '先頭の1文字は消費なし', 'first-free'));
    const utils = el('div', undefined, 'battle-utils');
    for (const [text, action] of [
      ['゛', 'voice'],
      ['゜', 'semi'],
      ['小文字', 'small'],
      ['ー', 'long'],
    ]) {
      const b = button(text, action);
      b.disabled =
        !['typing', 'error'].includes(g.phase) || (action !== 'long' && state.draft.length <= 1);
      utils.append(b);
    }
    entry.append(utils);
    const confirm = button(
      g.phase === 'checking'
        ? '辞書で確認中…'
        : g.phase === 'error'
          ? '辞書をもう一度読み込む'
          : 'これで決定',
      g.phase === 'error' ? 'retry' : 'submit',
      'battle-primary',
    );
    confirm.disabled = g.phase === 'checking' || (g.phase === 'typing' && state.draft.length < 2);
    entry.append(confirm);
    if (['checking', 'error'].includes(g.phase))
      entry.append(button('入力に戻る（残り時間を再開）', 'cancel-check', 'battle-text-button'));
    const resign = button('降参する', 'resign', 'battle-text-button');
    entry.append(resign);
    if (resignOpen) {
      const confirmation = el('div', undefined, 'resign-confirm');
      confirmation.append(
        el('p', 'この勝負を降参しますか？'),
        button('降参して終わる', 'confirm-resign'),
        button('続ける', 'cancel-resign'),
      );
      entry.append(confirmation);
    }
    play.append(entry);
    root.append(play);
    updateClock(root, state);
  }
  return { renderSetup, render };
}
