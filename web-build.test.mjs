import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWeb } from './build-web.mjs';
import { createStaticHandler } from './serve-web.mjs';
import { dataset, entry } from './web-fixtures.mjs';
test('build copies only public assets, relative paths and shards, refuses overwrite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'web-build-'));
  try {
    const input = join(dir, 'in');
    await mkdir(input);
    await writeFile(join(input, 'dictionary.json'), JSON.stringify(dataset([entry('かな')])));
    await writeFile(join(input, 'archive.jsonl'), '');
    await writeFile(join(input, 'secret.txt'), 'not public');
    const out = join(dir, 'out');
    const { version } = await buildWeb(input, out);
    const html = await readFile(join(out, 'index.html'), 'utf8');
    assert.match(html, /\.\/web\/bootstrap.mjs/);
    assert.ok(html.includes('./data/' + version + '/manifest.json'));
    assert.ok(!html.includes('__MANIFEST_URL__'));
    assert.deepEqual((await readdir(out)).sort(), [
      '.nojekyll',
      'ATTRIBUTION.txt',
      'build-info.json',
      'data',
      'dictionary.mjs',
      'index.html',
      'reading-bucket.mjs',
      'web',
    ]);
    assert.deepEqual((await readdir(join(out, 'web'))).sort(), [
      'app.mjs',
      'battle-app.mjs',
      'battle-controller.mjs',
      'battle-rules.mjs',
      'bootstrap.mjs',
      'candidate-groups.mjs',
      'dictionary-client.mjs',
      'input',
      'meaning-equivalences.mjs',
      'search-controller.mjs',
      'styles.css',
      'ui',
    ]);
    assert.deepEqual((await readdir(join(out, 'web/input'))).sort(), ['transform-kana.mjs']);
    assert.deepEqual((await readdir(join(out, 'web/ui'))).sort(), [
      'battle-feedback.mjs',
      'battle-view.mjs',
      'candidate-summary.mjs',
    ]);
    await assert.rejects(buildWeb(input, out), /exist/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('static handler serves output only and blocks traversal, symlink and malformed paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'web-serve-'));
  try {
    const out = join(dir, 'out');
    await mkdir(out);
    await writeFile(join(out, 'index.html'), 'safe');
    await writeFile(join(dir, 'secret.txt'), 'secret');
    await symlink(join(dir, 'secret.txt'), join(out, 'leak.txt'));
    const handler = await createStaticHandler(out);
    async function request(url, method = 'GET') {
      let status, body;
      await handler(
        { url, method },
        {
          writeHead(s) {
            status = s;
          },
          end(b) {
            body = b?.toString();
          },
        },
      );
      return { status, body };
    }
    assert.deepEqual(await request('/'), { status: 200, body: 'safe' });
    for (const p of ['/..%2fsecret.txt', '/leak.txt', '/%zz'])
      assert.notEqual((await request(p)).status, 200);
    assert.equal((await request('/missing')).status, 404);
    assert.equal((await request('/', 'POST')).status, 405);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('packaging rejects stale copied source and unexpected raw archive', async () => {
  const { spawnSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'web-package-'));
  try {
    const input = join(dir, 'in');
    await mkdir(input);
    await writeFile(join(input, 'dictionary.json'), JSON.stringify(dataset([entry('かな')])));
    await writeFile(join(input, 'archive.jsonl'), '');
    const out = join(dir, 'out');
    await buildWeb(input, out);
    const app = join(out, 'web/app.mjs');
    const original = await readFile(app);
    await writeFile(app, 'stale source');
    let run = spawnSync(
      'python3',
      ['package-site.py', out, join(input, 'dictionary.json'), join(dir, 'release')],
      { encoding: 'utf8' },
    );
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /source|stale/);
    await writeFile(app, original);
    await writeFile(join(out, 'archive.jsonl'), 'raw');
    run = spawnSync(
      'python3',
      ['package-site.py', out, join(input, 'dictionary.json'), join(dir, 'release')],
      { encoding: 'utf8' },
    );
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /unexpected|allowlist/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reuse published dictionary preserves every byte and rejects tampered shard', async () => {
  const { rebuildWebFromPublished } = await import('./build-web.mjs');
  assert.equal(typeof rebuildWebFromPublished, 'function');
  const { spawnSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'web-reuse-'));
  try {
    const input = join(dir, 'in');
    await mkdir(input);
    await writeFile(join(input, 'dictionary.json'), JSON.stringify(dataset([entry('かな')])));
    await writeFile(join(input, 'archive.jsonl'), '');
    const base = join(dir, 'base');
    const { version } = await buildWeb(input, base);
    const release = join(dir, 'release');
    const packed = spawnSync(
      'python3',
      ['package-site.py', base, join(input, 'dictionary.json'), release],
      { encoding: 'utf8' },
    );
    assert.equal(packed.status, 0, packed.stderr);
    const manifest = JSON.parse(await readFile(join(release, 'site-manifest.json'), 'utf8'));
    const out = join(dir, 'rebuilt');
    await rebuildWebFromPublished({ siteDir: base, releaseManifest: manifest, outputDir: out });
    assert.deepEqual(
      await readFile(join(out, 'data', version, '00.json')),
      await readFile(join(base, 'data', version, '00.json')),
    );
    assert.equal(
      JSON.parse(await readFile(join(out, 'build-info.json'), 'utf8')).dictionarySha256,
      manifest.dictionarySha256,
    );
    assert.ok((await readdir(join(out, 'web'))).includes('battle-app.mjs'));
    await writeFile(join(base, 'data', version, '00.json'), 'tampered');
    await assert.rejects(
      rebuildWebFromPublished({
        siteDir: base,
        releaseManifest: manifest,
        outputDir: join(dir, 'bad'),
      }),
      /mismatch/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('new battle page versions stylesheet URL to avoid prior dictionary CSS cache', async () => {
  const html = await readFile(new URL('./web/index.html', import.meta.url), 'utf8');
  assert.match(html, /href="\.\/web\/styles\.css\?v=[a-zA-Z0-9-]+"/);
});
test('page bootstrap and changed runtime imports bypass cached modules', async () => {
  const token = '20261006-maintainability1';
  const cacheVersion = '20261007-gojuon1';
  const read = (file) => readFile(new URL('./web/' + file, import.meta.url), 'utf8');
  const html = await read('index.html');
  assert.ok(html.includes(`src="./web/bootstrap.mjs?v=${cacheVersion}"`));
  assert.ok(html.includes(`href="./web/styles.css?v=20261009-report1"`));
  const bootstrap = await read('bootstrap.mjs');
  for (const file of ['app.mjs', 'dictionary-client.mjs'])
    assert.ok(bootstrap.includes(`'./${file}?v=${token}'`));
  assert.ok(bootstrap.includes(`'./battle-app.mjs?v=${cacheVersion}'`));
  assert.ok((await read('app.mjs')).includes(`'./candidate-groups.mjs?v=${token}'`));
  assert.ok((await read('app.mjs')).includes(`'./search-controller.mjs?v=${token}'`));
  assert.ok(
    (await read('ui/candidate-summary.mjs')).includes(`'../candidate-groups.mjs?v=${token}'`),
  );
  assert.ok(
    (await read('candidate-groups.mjs')).includes(
      "'./meaning-equivalences.mjs?v=20261005-meaning3'",
    ),
  );
});

test('battle runtime keeps versioned rule and extracted view dependencies', async () => {
  const token = '20261006-maintainability1';
  const read = (file) => readFile(new URL('./web/' + file, import.meta.url), 'utf8');
  const battle = await read('battle-app.mjs');
  for (const file of [
    'battle-controller.mjs',
    'battle-rules.mjs',
    'ui/battle-feedback.mjs',
    'input/transform-kana.mjs',
  ])
    assert.ok(battle.includes(`'./${file}?v=${token}'`));
  assert.ok(battle.includes("'./ui/battle-view.mjs?v=20261007-gojuon1'"));
  assert.ok((await read('battle-controller.mjs')).includes(`'./battle-rules.mjs?v=${token}'`));
  for (const file of ['ui/battle-view.mjs', 'input/transform-kana.mjs'])
    assert.ok((await read(file)).includes(`'../battle-rules.mjs?v=${token}'`));
});
