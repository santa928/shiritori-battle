import { mountDictionaryApp } from './app.mjs?v=20261006-maintainability1';
import { mountBattleApp } from './battle-app.mjs?v=20261007-gojuon1';
import { createDictionaryClient } from './dictionary-client.mjs?v=20261006-maintainability1';

/**
 * ページの起動・モード切替を担当する。両画面は独立した辞書クライアントを使う。
 * @param {Document} document 公開HTMLのdocument。
 * @param {object} [options] 対戦の時計などを検証時に注入する設定。
 * @returns {{destroy: function(): void}} 両画面のイベントと対戦タイマーを停止する。
 */
export function mountPage(document, { battleOptions = {} } = {}) {
  const root = document.querySelector('[data-battle-app]');
  const dictionary = document.querySelector('[data-dictionary-app]');
  const battleTab = document.querySelector('[data-mode=battle]');
  const dictTab = document.querySelector('[data-mode=dictionary]');
  const clientFor = (element) =>
    createDictionaryClient({
      manifestUrl: new URL(element.dataset.manifest, document.baseURI).href,
      releaseInfoUrl: new URL('./build-info.json', document.baseURI).href,
    });
  const dictionaryApp = mountDictionaryApp(dictionary, { client: clientFor(dictionary) });
  let locked = false;
  const show = (mode) => {
    if (mode === 'dictionary' && locked) return;
    root.hidden = mode !== 'battle';
    dictionary.hidden = mode !== 'dictionary';
    for (const tab of [battleTab, dictTab]) {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle('mode-active', active);
      tab.setAttribute('aria-pressed', String(active));
    }
    document.body.classList.toggle('is-battle', mode === 'battle');
  };
  const showBattle = () => show('battle');
  const showDictionary = () => show('dictionary');
  battleTab.addEventListener('click', showBattle);
  dictTab.addEventListener('click', showDictionary);
  const battleApp = mountBattleApp(root, {
    ...battleOptions,
    client: clientFor(root),
    onMatchState: (active) => {
      locked = active;
      document.body.classList.toggle('match-active', active);
      dictTab.disabled = active;
      dictTab.title = active ? '対戦が終わると辞書を開けます' : '';
    },
  });
  show('battle');
  return {
    destroy() {
      dictionaryApp.destroy();
      battleApp.destroy();
      battleTab.removeEventListener('click', showBattle);
      dictTab.removeEventListener('click', showDictionary);
    },
  };
}

if (typeof document !== 'undefined') mountPage(document);
