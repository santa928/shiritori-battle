import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { readFile } from 'node:fs/promises';
import { mountPage } from './bootstrap.mjs';

test('page mode controls lock during a match and stop responding after destroy', async () => {
  const { document } = parseHTML(await readFile(new URL('./index.html', import.meta.url), 'utf8'));
  Object.defineProperty(document, 'baseURI', { value: 'https://example.invalid/base/' });
  const app = mountPage(document, { battleOptions: { autoTick: false, random: () => 0 } });
  const battle = document.querySelector('[data-battle-app]');
  const dictionary = document.querySelector('[data-dictionary-app]');
  const dictionaryTab = document.querySelector('[data-mode=dictionary]');
  const battleTab = document.querySelector('[data-mode=battle]');
  const click = (action) => battle.querySelector(`[data-action=${action}]`).click();
  dictionaryTab.click();
  assert.equal(dictionary.hidden, false);
  assert.equal(dictionaryTab.getAttribute('aria-pressed'), 'true');
  battleTab.click();
  click('start');
  assert.equal(dictionaryTab.disabled, true);
  dictionaryTab.click();
  assert.equal(dictionary.hidden, true);
  click('ready');
  click('resign');
  click('confirm-resign');
  assert.equal(dictionaryTab.disabled, false);
  dictionaryTab.click();
  assert.equal(dictionary.hidden, false);
  assert.equal(document.body.classList.contains('match-active'), false);
  app.destroy();
  battleTab.click();
  assert.equal(dictionary.hidden, false);
});

test('public dictionary bootstrap discovers the current release on retry', async () => {
  const { parseHTML } = await import('linkedom');
  const { readFile } = await import('node:fs/promises');
  const { document } = parseHTML(
    (await readFile(new URL('./index.html', import.meta.url), 'utf8')).replaceAll(
      '__MANIFEST_URL__',
      './data/old/manifest.json',
    ),
  );
  Object.defineProperty(document, 'baseURI', { value: 'https://example.invalid/base/' });
  const oldFetch = globalThis.fetch;
  const { mountPage } = await import('./bootstrap.mjs');
  let app;
  let urls = [];
  try {
    globalThis.fetch = async (url) => {
      urls.push(url);
      return new Response('', { status: 404 });
    };
    app = mountPage(document, { battleOptions: { autoTick: false } });
    const root = document.querySelector('[data-dictionary-app]');
    root.querySelector('input').value = 'かな';
    root
      .querySelector('form')
      .dispatchEvent(new document.defaultView.Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    root.querySelector('.retry').click();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(urls[1], 'https://example.invalid/base/build-info.json');
  } finally {
    app?.destroy();
    globalThis.fetch = oldFetch;
  }
});

test('problem report opens the fixed public form without game data', async () => {
  const { document } = parseHTML(await readFile(new URL('./index.html', import.meta.url), 'utf8'));
  const link = document.querySelector('footer .problem-report');
  const url = new URL(link.getAttribute('href'));
  assert.equal(url.origin, 'https://github.com');
  assert.equal(url.pathname, '/santa928/shiritori-battle/issues/new');
  assert.deepEqual([...url.searchParams], [['template', 'problem-report.yml']]);
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  const notice = document.getElementById(link.getAttribute('aria-describedby')).textContent;
  for (const text of ['ログインが必要', '公開されます', '個人情報', '自動送信しません'])
    assert.ok(notice.includes(text));
});
