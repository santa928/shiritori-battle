import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  rm,
  copyFile,
  readdir,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildWeb, rebuildWebFromPublished, releaseSources } from './build-web.mjs';
import { verifyRelease } from './verify-site.mjs';
import { dataset, entry } from './web-fixtures.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'retain-dictionary-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  async function release(name, reading) {
    const input = join(dir, name + '-input'),
      siteDir = join(dir, name + '-site'),
      published = join(dir, name + '-publish');
    await mkdir(input);
    await writeFile(join(input, 'dictionary.json'), JSON.stringify(dataset([entry(reading)])));
    await writeFile(join(input, 'archive.jsonl'), '');
    const { version } = await buildWeb(input, siteDir);
    const result = spawnSync(
      'python3',
      ['package-site.py', siteDir, join(input, 'dictionary.json'), published],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    return {
      input,
      siteDir,
      published,
      version,
      releaseManifest: JSON.parse(await readFile(join(published, 'site-manifest.json'), 'utf8')),
      archivePath: join(published, 'site.zip'),
    };
  }
  const old = await release('old', 'かな'),
    current = await release('current', 'かめ');
  return { dir, old, current, release };
}

test('reuse retains an explicitly verified prior dictionary and packages only its public files', async (t) => {
  const { dir, old, current } = await fixture(t),
    out = join(dir, 'out');
  await writeFile(join(old.siteDir, 'private.txt'), 'must never publish');
  await rebuildWebFromPublished({ ...current, outputDir: out, retainedReleases: [old] });
  assert.deepEqual(
    (await readdir(join(out, 'data'))).sort(),
    [old.version, current.version].sort(),
  );
  assert.deepEqual(
    await readFile(join(out, 'data', old.version, 'manifest.json')),
    await readFile(join(old.siteDir, 'data', old.version, 'manifest.json')),
  );
  assert.ok(
    (await readFile(join(out, 'index.html'), 'utf8')).includes(
      `./data/${current.version}/manifest.json`,
    ),
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(out, 'build-info.json'), 'utf8')).retainedVersions,
    [old.version],
  );
  const root = join(dir, 'root');
  await mkdir(join(root, 'web'), { recursive: true });
  for (const file of [...releaseSources, 'package-site.py']) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await copyFile(file, join(root, file));
  }
  const packed = spawnSync(
    'python3',
    [join(root, 'package-site.py'), out, join(current.input, 'dictionary.json')],
    { encoding: 'utf8' },
  );
  assert.equal(packed.status, 0, packed.stderr);
  assert.equal(await verifyRelease(root, out), current.version);
  const manifest = JSON.parse(await readFile(join(root, 'publish/site-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.retainedVersions, [old.version]);
  const again = join(dir, 'again');
  await rebuildWebFromPublished({ siteDir: out, releaseManifest: manifest, outputDir: again });
  assert.deepEqual(
    await readdir(join(again, 'data')),
    [current.version],
    'retention must be explicitly renewed on each build',
  );
  await writeFile(join(out, 'data', old.version, 'private.txt'), 'not allowed');
  const bad = spawnSync(
    'python3',
    [join(root, 'package-site.py'), out, join(current.input, 'dictionary.json')],
    { encoding: 'utf8' },
  );
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /allowlist/);
  await assert.rejects(verifyRelease(root, out), /unexpected/);
});

test('fresh build and CLI can opt into retaining a verified previous release', async (t) => {
  const { dir, old, current } = await fixture(t),
    out = join(dir, 'out');
  await buildWeb(current.input, out, { retainedReleases: [old] });
  assert.deepEqual(
    (await readdir(join(out, 'data'))).sort(),
    [old.version, current.version].sort(),
  );
  const cli = join(dir, 'cli');
  const run = spawnSync(
    'node',
    [
      'build-web.mjs',
      '--reuse-published',
      current.siteDir,
      join(current.published, 'site-manifest.json'),
      cli,
      '--retain-published',
      old.siteDir,
      join(old.published, 'site-manifest.json'),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(
    (await readdir(join(cli, 'data'))).sort(),
    [old.version, current.version].sort(),
  );
});

test('retention rejects a corrupt release archive before creating output', async (t) => {
  const { dir, old, current } = await fixture(t);
  await writeFile(join(old.published, old.releaseManifest.zipParts[0].path), 'corrupt archive');
  await assert.rejects(
    rebuildWebFromPublished({ ...current, outputDir: join(dir, 'out'), retainedReleases: [old] }),
    /archive part size mismatch|archive checksum mismatch/,
  );
});

test('retention rejects a shard tampered after the release was verified', async (t) => {
  const { dir, old, current } = await fixture(t);
  await writeFile(join(old.siteDir, 'data', old.version, '00.json'), 'tampered');
  await assert.rejects(
    rebuildWebFromPublished({ ...current, outputDir: join(dir, 'out'), retainedReleases: [old] }),
    /artifact mismatch/,
  );
});

test('retention validates shard descriptors and schema even when artifact hashes agree', async (t) => {
  const { dir, old, current } = await fixture(t);
  delete old.archivePath;
  const path = join(old.siteDir, 'data', old.version, 'manifest.json'),
    manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.shards['00'].url = '../private.json';
  const bytes = JSON.stringify(manifest);
  await writeFile(path, bytes);
  old.releaseManifest.artifacts[`data/${old.version}/manifest.json`] = hash(bytes);
  await assert.rejects(
    rebuildWebFromPublished({ ...current, outputDir: join(dir, 'out'), retainedReleases: [old] }),
    /shard descriptor/,
  );
});

test('retention rejects symlinked dictionary directories', async (t) => {
  const { dir, old, current } = await fixture(t),
    alias = join(dir, 'alias');
  await mkdir(alias);
  await symlink(join(old.siteDir, 'data'), join(alias, 'data'));
  old.siteDir = alias;
  await assert.rejects(
    rebuildWebFromPublished({ ...current, outputDir: join(dir, 'out'), retainedReleases: [old] }),
    /symlink|directory/,
  );
});

test('package and verifier reject invalid retained dictionary metadata', async (t) => {
  const { dir, current } = await fixture(t);
  const infoPath = join(current.siteDir, 'build-info.json'),
    info = JSON.parse(await readFile(infoPath, 'utf8'));
  info.retainedVersions = ['../private'];
  await writeFile(infoPath, JSON.stringify(info));
  const run = spawnSync(
    'python3',
    ['package-site.py', current.siteDir, join(current.input, 'dictionary.json'), join(dir, 'bad')],
    { encoding: 'utf8' },
  );
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /retained|version/);
  const root = join(dir, 'root');
  await mkdir(join(root, 'web'), { recursive: true });
  await mkdir(join(root, 'publish'));
  for (const file of [...releaseSources, 'package-site.py']) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await copyFile(file, join(root, file));
  }
  for (const part of current.releaseManifest.zipParts)
    await copyFile(join(current.published, part.path), join(root, 'publish', part.path));
  current.releaseManifest.retainedVersions = ['../private'];
  await writeFile(
    join(root, 'publish/site-manifest.json'),
    JSON.stringify(current.releaseManifest),
  );
  await assert.rejects(verifyRelease(root), /retained|version/);
});

test('retention is bounded to at most two explicitly selected older versions', async (t) => {
  const { dir, old, current, release } = await fixture(t),
    second = await release('second', 'かさ'),
    third = await release('third', 'かき');
  const out = join(dir, 'two-old');
  await rebuildWebFromPublished({ ...current, outputDir: out, retainedReleases: [old, second] });
  assert.deepEqual(
    (await readdir(join(out, 'data'))).sort(),
    [current.version, old.version, second.version].sort(),
  );
  await assert.rejects(
    rebuildWebFromPublished({
      ...current,
      outputDir: join(dir, 'three-old'),
      retainedReleases: [old, second, third],
    }),
    /at most two|retention limit/,
  );
});
