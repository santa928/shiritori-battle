import { inspectDraft, applyAccepted } from './battle-rules.mjs?v=20261005-longmark1';

export function createBattleController({
  game: initial,
  client,
  now = () => performance.now(),
  onState,
}) {
  let game = structuredClone(initial),
    draft = game.start,
    remainingMs = game.seconds * 1000,
    feedback = '',
    lastTime = null,
    active = true,
    sequence = 0;
  const context = (incomplete = false) => ({
    start: game.start,
    pool: game.pools[game.turn],
    usedReadings: incomplete ? [] : game.usedReadings,
    incomplete,
  });
  const snapshot = () => ({
    game: structuredClone(game),
    draft,
    remainingMs,
    feedback,
    consumed: inspectDraft(draft, context(true)).consumed,
  });
  const emit = () => {
    if (active) onState(snapshot());
  };
  function finish(reason) {
    sequence++;
    game = { ...game, phase: 'finished', winner: 1 - game.turn, reason };
    lastTime = null;
    feedback = '';
  }
  function sync() {
    if (!active || game.phase !== 'typing') return;
    const t = now();
    remainingMs = Math.max(0, remainingMs - Math.max(0, t - lastTime));
    lastTime = t;
    if (remainingMs === 0) finish('timeout');
  }
  function ready() {
    if (!active || game.phase !== 'ready') return;
    game.phase = 'typing';
    remainingMs = game.seconds * 1000;
    lastTime = now();
    feedback = '';
    emit();
  }
  function edit(reading) {
    if (!active) return;
    if (game.phase === 'error') cancelCheck();
    if (game.phase !== 'typing') return;
    sync();
    if (game.phase !== 'typing') {
      emit();
      return;
    }
    const check = inspectDraft(reading, context(true));
    if (check.ok) {
      draft = reading;
      feedback = '';
    } else feedback = check.reason;
    emit();
  }
  async function check() {
    const token = ++sequence,
      reading = draft;
    game.phase = 'checking';
    lastTime = null;
    feedback = '';
    emit();
    try {
      const result = await client.search(reading);
      if (!active || token !== sequence || game.phase !== 'checking') return;
      if (result.reading !== reading) throw new Error('dictionary reading mismatch');
      if (result.candidates?.some((c) => c.eligible)) {
        game = applyAccepted(game, {
          reading,
          candidates: result.candidates,
          version: result.version,
          sources: result.sources,
        });
      } else {
        game.phase = 'typing';
        lastTime = now();
        feedback = ['ineligible', 'pending', 'unconfirmed', 'invalid-reading'].includes(
          result.status,
        )
          ? result.status
          : 'unconfirmed';
      }
    } catch {
      if (!active || token !== sequence) return;
      game.phase = 'error';
      lastTime = null;
      feedback = 'network-error';
    }
    emit();
  }
  async function submit() {
    if (!active || game.phase !== 'typing') return;
    sync();
    if (game.phase !== 'typing') {
      emit();
      return;
    }
    const checkResult = inspectDraft(draft, context());
    if (!checkResult.ok) {
      feedback = checkResult.reason;
      emit();
      return;
    }
    return check();
  }
  function next() {
    if (!active || game.phase !== 'success') return;
    game = { ...game, phase: 'ready', turn: 1 - game.turn };
    draft = game.start;
    remainingMs = game.seconds * 1000;
    feedback = '';
    lastTime = null;
    emit();
  }
  function cancelCheck() {
    if (!active || !['checking', 'error'].includes(game.phase)) return;
    sequence++;
    game.phase = 'typing';
    lastTime = now();
    feedback = '';
    emit();
  }
  function retry() {
    if (!active || game.phase !== 'error') return;
    return check();
  }
  function resign() {
    if (!active || !['typing', 'checking', 'error'].includes(game.phase)) return;
    finish('resigned');
    emit();
  }
  function tick() {
    if (!active) return;
    sync();
    emit();
  }
  function destroy() {
    active = false;
    sequence++;
    lastTime = null;
  }
  emit();
  return { ready, edit, submit, next, retry, cancelCheck, resign, tick, destroy };
}
