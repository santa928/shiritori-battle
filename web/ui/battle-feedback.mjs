/**
 * DOMだけを更新し、残り時間の計算はコントローラーに委ねる。
 * @param {HTMLElement} root 時計と進捗バーを含む画面。
 * @param {object|null} state 残り時間・gameのスナップショット。
 * @returns {void}
 */
export function updateClock(root, state) {
  const timer = root.querySelector('[data-timer]');
  if (timer && state) {
    const seconds = Math.ceil(state.remainingMs / 1000);
    timer.textContent =
      String(Math.floor(seconds / 60)).padStart(2, '0') +
      ':' +
      String(seconds % 60).padStart(2, '0');
    timer.classList.toggle('urgent', seconds <= 10 && state.game.phase === 'typing');
    timer.classList.toggle(
      'critical',
      seconds <= 5 && seconds > 0 && state.game.phase === 'typing',
    );
  }
  const fill = root.querySelector('[data-clock-fill]');
  if (fill && state)
    fill.style.width = (100 * state.remainingMs) / (state.game.seconds * 1000) + '%';
}

/**
 * 再描画で失う操作位置を保存し、次に使えるキーへフォーカスを戻す関数を返す。
 * @param {HTMLElement} root 再描画前の盤面。
 * @returns {function(): void} 再描画直後に呼ぶ復元関数。盤面のスクロールを保ち、下書きは末尾へ送る。
 */
export function preserveInteraction(root) {
  const doc = root.ownerDocument;
  const oldBoard = root.querySelector('.battle-board'),
    oldDraft = root.querySelector('[data-draft]');
  const boardTop = oldBoard?.scrollTop ?? 0,
    draftLeft = oldDraft?.scrollLeft ?? 0;
  const focused = doc.activeElement,
    hadFocus = focused && root.contains(focused);
  const action = hadFocus ? focused.dataset?.action : null,
    kana = hadFocus ? focused.dataset?.kana : null;
  return () => {
    if (hadFocus) {
      let target = kana
        ? root.querySelector(`[data-kana="${kana}"]`)
        : action
          ? root.querySelector(`[data-action="${action}"]`)
          : null;
      if (target?.disabled && kana) {
        const keys = [...root.querySelectorAll('.battle-board button')],
          at = keys.findIndex((k) => k.dataset.kana === kana);
        target = [...keys.slice(at + 1), ...keys.slice(0, at)].find((k) => !k.disabled);
      }
      if (!target || target.disabled)
        target = root.querySelector(
          '.battle-primary:not([disabled]), .battle-utils button:not([disabled])',
        );
      target?.focus({ preventScroll: true });
    }
    const board = root.querySelector('.battle-board'),
      draftNode = root.querySelector('[data-draft]');
    if (board) board.scrollTop = boardTop;
    if (draftNode) {
      const end = draftNode.scrollWidth - draftNode.clientWidth;
      draftNode.scrollLeft = Number.isFinite(end) ? Math.max(0, end) : draftLeft;
    }
  };
}

/**
 * 装飾用コピーを飛ばす。入力・時刻・通信は待たせず、動きを減らす設定を尊重する。
 * @param {HTMLElement} root 装飾コピーの追加先。
 * @param {DOMRect|null} inputOrigin 押したキーの位置。
 * @param {HTMLElement|null} target 入力後の末尾タイル。
 * @returns {void} 演出終了・キャンセルでコピーを除去する。再描画・destroyでも除去する。
 */
export function animateInput(root, inputOrigin, target) {
  const doc = root.ownerDocument;
  if (
    !inputOrigin ||
    !target?.getBoundingClientRect ||
    doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
    return;
  const end = target.getBoundingClientRect(),
    from = inputOrigin;
  if (!end.width || !from.width) return;
  const ghost = doc.createElement('span');
  ghost.textContent = target.textContent;
  ghost.className = 'kana-flight';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.left = from.left + 'px';
  ghost.style.top = from.top + 'px';
  ghost.style.width = from.width + 'px';
  ghost.style.height = from.height + 'px';
  ghost.style.setProperty('--fly-x', end.left + end.width / 2 - from.left - from.width / 2 + 'px');
  ghost.style.setProperty('--fly-y', end.top + end.height / 2 - from.top - from.height / 2 + 'px');
  const remove = () => ghost.remove();
  ghost.addEventListener('animationend', remove, { once: true });
  ghost.addEventListener('animationcancel', remove, { once: true });
  root.append(ghost);
}
