import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSearchController, safeSourceUrl, reasonText } from './app.mjs';
test('IME submit is ignored; valid submit updates state', async () => {
  let calls = 0;
  const states = [];
  const c = createSearchController(
    {
      search: async (input) => {
        calls++;
        return { reading: input, status: 'eligible', candidates: [], review: [] };
      },
    },
    (s) => states.push(s),
  );
  await c.submit('かな', { isComposing: true });
  assert.equal(calls, 0);
  await c.submit('かな');
  assert.equal(calls, 1);
  assert.equal(states.at(-1).result.reading, 'かな');
  assert.equal(states.at(-1).phase, 'result');
});
test('stale responses and destroyed controller cannot update state', async () => {
  const resolves = [];
  const states = [];
  const c = createSearchController(
    {
      search: (input) => new Promise((resolve) => resolves.push(() => resolve({ reading: input }))),
    },
    (s) => states.push(s),
  );
  const old = c.submit('ふるい');
  const current = c.submit('あたらしい');
  resolves[1]();
  await current;
  resolves[0]();
  await old;
  assert.equal(states.at(-1).result.reading, 'あたらしい');
  const pending = c.submit('さいご');
  c.destroy();
  const length = states.length;
  resolves[2]();
  await pending;
  assert.equal(states.length, length);
});
test('error is distinct and retry succeeds', async () => {
  let attempt = 0;
  let state;
  const c = createSearchController(
    {
      search: async () => {
        if (!attempt++) throw Error('offline');
        return { status: 'unconfirmed' };
      },
    },
    (s) => (state = s),
  );
  await c.submit('かな');
  assert.equal(state.phase, 'error');
  await c.submit('かな');
  assert.equal(state.result.status, 'unconfirmed');
});
test('only web source links and safe reason copy are accepted', () => {
  assert.equal(safeSourceUrl('javascript:alert(1)'), null);
  assert.equal(safeSourceUrl('data:text/html,hi'), null);
  assert.equal(
    safeSourceUrl('https://ja.wiktionary.org/wiki/蛙'),
    'https://ja.wiktionary.org/wiki/%E8%9B%99',
  );
  assert.equal(reasonText('unknown'), '要確認');
  assert.match(reasonText('part-of-speech'), /品詞/);
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
  const oldDocument = globalThis.document,
    oldFetch = globalThis.fetch;
  let urls = [];
  try {
    globalThis.document = document;
    globalThis.fetch = async (url) => {
      urls.push(url);
      return new Response('', { status: 404 });
    };
    await import('./app.mjs?bootstrap-retry-test');
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
    globalThis.document = oldDocument;
    globalThis.fetch = oldFetch;
  }
});
