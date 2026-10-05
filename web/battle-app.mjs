import { KANA, createGame } from './battle-rules.mjs?v=20261006-maintainability1';
import { createBattleController } from './battle-controller.mjs?v=20261006-maintainability1';
import { createBattleView } from './ui/battle-view.mjs?v=20261006-maintainability1';
import {
  animateInput,
  preserveInteraction,
  updateClock,
} from './ui/battle-feedback.mjs?v=20261006-maintainability1';
import { transformLastKana } from './input/transform-kana.mjs?v=20261006-maintainability1';
export { transformLastKana };
export { summarizeCandidates } from './ui/candidate-summary.mjs?v=20261006-maintainability1';

/**
 * 対戦UIのイベントと表示更新を制御する。判定・残り時間はcontroller、描画はviewに委ねる。
 * @param {HTMLElement} root 対戦画面の描画先。
 * @param {object} options client・単調増加のnow・random・autoTick・onMatchState。
 * @returns {{tick: function(): void, destroy: function(): void}} tickは表示を更新し、destroyは通信結果の通知とタイマー・イベントを停止する。
 */
export function mountBattleApp(
  root,
  {
    client,
    now = () => performance.now(),
    random = Math.random,
    autoTick = true,
    onMatchState = () => {},
  },
) {
  let controller = null,
    state = null,
    lastKey = '',
    opponentOpen = false,
    resignOpen = false,
    interval = null,
    settings = { mode: 'individual', seconds: 30 },
    inputOrigin = null;
  const view = createBattleView(root);
  function showSetup() {
    controller?.destroy();
    controller = null;
    state = null;
    lastKey = '';
    root.className = 'battle-root';
    delete root.dataset.player;
    inputOrigin = null;
    root.replaceChildren();
    onMatchState(false);
    view.renderSetup(settings, (seconds) => {
      settings.seconds = seconds;
    });
  }
  function receive(next) {
    const previous = state;
    state = next;
    const entered =
      previous?.game.phase === 'typing' &&
      next.game.phase === 'typing' &&
      next.draft.length > previous.draft.length &&
      next.draft.startsWith(previous.draft);
    const key = JSON.stringify([
      next.game.phase,
      next.game.turn,
      next.draft,
      next.feedback,
      next.game.history.length,
      resignOpen,
    ]);
    if (key !== lastKey) {
      const restoreInteraction = preserveInteraction(root);
      lastKey = key;
      view.render(state, {
        opponentOpen,
        resignOpen,
        onOpponentOpen: (open) => {
          opponentOpen = open;
        },
        onMatchState,
      });
      restoreInteraction();
      if (entered) {
        const tile = root.querySelector('.draft-tile:last-child');
        tile?.classList.add('entering');
        animateInput(root, inputOrigin, tile);
      }
    }
    inputOrigin = null;
    updateClock(root, state);
  }
  function start() {
    const starts = KANA.filter((c) => !['ん', 'を', 'ぢ', 'づ'].includes(c));
    const choose = (n) => Math.min(n - 1, Math.max(0, Math.floor(random() * n)));
    opponentOpen = false;
    resignOpen = false;
    onMatchState(true);
    controller = createBattleController({
      game: createGame({ ...settings, firstPlayer: 0, start: starts[choose(starts.length)] }),
      client,
      now,
      onState: receive,
    });
  }
  function act(e) {
    const b = e.target.closest('button[data-action]');
    if (!b || !root.contains(b) || b.disabled) return;
    const action = b.dataset.action;
    if (action.startsWith('mode-')) {
      settings.mode = action.slice(5);
      showSetup();
      return;
    }
    if (action === 'start') {
      start();
      return;
    }
    if (action === 'setup') {
      showSetup();
      return;
    }
    if (!controller) return;
    if (action === 'ready') controller.ready();
    else if (action === 'next') controller.next();
    else if (action === 'submit') controller.submit();
    else if (action === 'retry') controller.retry();
    else if (action === 'cancel-check') controller.cancelCheck();
    else if (action === 'resign') {
      resignOpen = true;
      lastKey = '';
      receive(state);
    } else if (action === 'cancel-resign') {
      resignOpen = false;
      lastKey = '';
      receive(state);
    } else if (action === 'confirm-resign') {
      resignOpen = false;
      controller.resign();
    } else if (action === 'kana') {
      inputOrigin = b.getBoundingClientRect?.() ?? null;
      controller.edit(state.draft + b.dataset.kana);
      inputOrigin = null;
    } else if (action === 'delete') controller.edit(state.draft.slice(0, -1));
    else if (action === 'long') controller.edit(state.draft + 'ー');
    else if (['voice', 'semi', 'small'].includes(action))
      controller.edit(transformLastKana(state.draft, action));
  }
  root.addEventListener('click', act);
  showSetup();
  if (autoTick) interval = setInterval(() => controller?.tick(), 100);
  return {
    tick() {
      controller?.tick();
    },
    destroy() {
      inputOrigin = null;
      root.querySelectorAll('.kana-flight,.battle-confetti').forEach((n) => n.remove());
      controller?.destroy();
      if (interval !== null) clearInterval(interval);
      root.removeEventListener('click', act);
    },
  };
}
