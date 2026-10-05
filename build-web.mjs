import { mkdir, readFile, writeFile, copyFile, rm, lstat, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildWebDictionary } from './build-web-dictionary.mjs';
const project = dirname(fileURLToPath(import.meta.url));
import { releaseSources, copiedSources } from './scripts/release-assets.mjs';
export { releaseSources };
async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
const versionPattern = /^v1-[a-f0-9]{16}$/;
const shaPattern = /^[a-f0-9]{64}$/;
export function dictionaryVersions(info) {
  if (!versionPattern.test(info.version)) throw Error('invalid release version');
  const retained = info.retainedVersions ?? [];
  if (
    !Array.isArray(retained) ||
    retained.length > 2 ||
    retained.some((v) => !versionPattern.test(v) || v === info.version) ||
    new Set(retained).size !== retained.length
  )
    throw Error('invalid retained dictionary versions');
  return [info.version, ...[...retained].sort()];
}
export function dictionaryArtifacts(version) {
  return [
    `data/${version}/manifest.json`,
    ...Array.from(
      { length: 256 },
      (_, i) => `data/${version}/${i.toString(16).padStart(2, '0')}.json`,
    ),
  ];
}
export async function verifyDictionaryArtifacts(siteDir, version, artifacts) {
  if (!versionPattern.test(version)) throw Error('invalid dictionary version');
  for (const path of [siteDir, join(siteDir, 'data'), join(siteDir, 'data', version)]) {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error('unexpected dictionary directory or symlink');
  }
  const expected = dictionaryArtifacts(version),
    prefix = `data/${version}/`;
  if (
    JSON.stringify(
      Object.keys(artifacts)
        .filter((p) => p.startsWith(prefix))
        .sort(),
    ) !== JSON.stringify([...expected].sort())
  )
    throw Error('unexpected dictionary artifact allowlist');
  const content = new Map();
  for (const name of expected) {
    const path = join(siteDir, name),
      stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw Error('unexpected dictionary artifact or symlink');
    const bytes = await readFile(path);
    if (
      !shaPattern.test(artifacts[name]) ||
      createHash('sha256').update(bytes).digest('hex') !== artifacts[name]
    )
      throw Error('base artifact mismatch: ' + name);
    content.set(name, bytes);
  }
  const manifest = JSON.parse(content.get(expected[0]));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.version !== version ||
    !Array.isArray(manifest.sources) ||
    !manifest.shards ||
    Object.keys(manifest.shards).sort().join(',') !==
      Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0')).join(',')
  )
    throw Error('invalid dictionary manifest');
  for (let i = 0; i < 256; i++) {
    const key = i.toString(16).padStart(2, '0'),
      descriptor = manifest.shards[key],
      bytes = content.get(prefix + key + '.json');
    if (
      !descriptor ||
      descriptor.url !== key + '.json' ||
      !shaPattern.test(descriptor.sha256) ||
      !Number.isSafeInteger(descriptor.bytes) ||
      descriptor.bytes !== bytes.length ||
      descriptor.sha256 !== artifacts[prefix + key + '.json']
    )
      throw Error('invalid shard descriptor: ' + key);
    const shard = JSON.parse(bytes);
    if (
      shard.schemaVersion !== 1 ||
      shard.version !== version ||
      !Array.isArray(shard.review) ||
      shard.dataset?.schemaVersion !== 1 ||
      !Array.isArray(shard.dataset.entries) ||
      JSON.stringify(shard.dataset.sources) !== JSON.stringify(manifest.sources)
    )
      throw Error('invalid dictionary shard: ' + key);
  }
}
export async function readPublishedArchive(directory, m) {
  const read = async (name) => {
    const path = join(directory, name),
      stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('invalid archive file: ' + name);
    return readFile(path);
  };
  let archive;
  if (m.zipParts === undefined) {
    archive = await read('site.zip');
  } else {
    const parts = m.zipParts,
      limit = 8 * 1024 * 1024;
    if (!Array.isArray(parts) || parts.length < 1 || parts.length > 999)
      throw Error('invalid archive parts');
    for (const [i, part] of parts.entries())
      if (
        !part ||
        part.path !== `site.zip.part${String(i + 1).padStart(3, '0')}` ||
        !Number.isSafeInteger(part.bytes) ||
        part.bytes < 1 ||
        part.bytes > limit ||
        (i < parts.length - 1 && part.bytes !== limit) ||
        !shaPattern.test(part.sha256)
      )
        throw Error('invalid archive part');
    const actual = (await readdir(directory))
      .filter((name) => name === 'site.zip' || name.startsWith('site.zip.part'))
      .sort();
    if (JSON.stringify(actual) !== JSON.stringify(parts.map((p) => p.path)))
      throw Error('unexpected archive part file list');
    if (
      !Number.isSafeInteger(m.zipBytes) ||
      m.zipBytes !== parts.reduce((total, p) => total + p.bytes, 0)
    )
      throw Error('archive size mismatch');
    const buffers = [];
    for (const part of parts) {
      const bytes = await read(part.path);
      if (bytes.length !== part.bytes) throw Error('archive part size mismatch: ' + part.path);
      if (createHash('sha256').update(bytes).digest('hex') !== part.sha256)
        throw Error('archive part checksum mismatch: ' + part.path);
      buffers.push(bytes);
    }
    archive = Buffer.concat(buffers);
  }
  if (
    !shaPattern.test(m.zipSha256) ||
    createHash('sha256').update(archive).digest('hex') !== m.zipSha256
  )
    throw Error('archive checksum mismatch');
  return archive;
}
async function publishedDictionaries({ siteDir, releaseManifest: m, archivePath }) {
  if (archivePath) await readPublishedArchive(dirname(archivePath), m);
  if (!shaPattern.test(m.dictionarySha256)) throw Error('invalid base manifest');
  const result = new Map();
  dictionaryVersions(m); // メタデータを検証する。旧版の旧版は再帰的に引き継がない。
  await verifyDictionaryArtifacts(siteDir, m.version, m.artifacts);
  result.set(m.version, { siteDir, artifacts: m.artifacts });
  return result;
}
async function retainedDictionaries(releases, base = new Map()) {
  for (const release of releases)
    for (const [version, source] of await publishedDictionaries(release)) {
      if (
        base.has(version) &&
        dictionaryArtifacts(version).some(
          (file) => base.get(version).artifacts[file] !== source.artifacts[file],
        )
      )
        throw Error('conflicting retained dictionary: ' + version);
      base.set(version, source);
    }
  return base;
}
async function copyRetained(outputDir, activeVersion, retained) {
  if ([...retained.keys()].filter((v) => v !== activeVersion).length > 2)
    throw Error('retention limit: at most two older dictionary versions');
  for (const [version, { siteDir, artifacts }] of retained) {
    if (version === activeVersion) {
      for (const file of dictionaryArtifacts(version))
        if ((await hashFile(join(outputDir, file))) !== artifacts[file])
          throw Error('conflicting active dictionary: ' + version);
      continue;
    }
    await mkdir(join(outputDir, 'data', version), { recursive: true });
    for (const file of dictionaryArtifacts(version))
      await copyFile(join(siteDir, file), join(outputDir, file));
  }
  return [...retained.keys()].filter((v) => v !== activeVersion).sort();
}
export async function buildWeb(inputDir, outputDir, { retainedReleases = [] } = {}) {
  const retained = await retainedDictionaries(retainedReleases);
  const dataPath = join(inputDir, 'dictionary.json'),
    archivePath = join(inputDir, 'archive.jsonl');
  const data = JSON.parse(await readFile(dataPath, 'utf8'));
  const version =
    'v1-' +
    createHash('sha256')
      .update(await hashFile(dataPath))
      .update(await hashFile(archivePath))
      .update(await hashFile(join(project, 'build-web-dictionary.mjs')))
      .digest('hex')
      .slice(0, 16);
  await mkdir(outputDir);
  try {
    await mkdir(join(outputDir, 'web'));
    await mkdir(join(outputDir, 'data'));
    const manifest = await buildWebDictionary({
      dataset: data,
      archivePath,
      outputDir: join(outputDir, 'data', version),
      version,
    });
    for (const name of copiedSources) {
      await mkdir(dirname(join(outputDir, name)), { recursive: true });
      await copyFile(join(project, name), join(outputDir, name));
    }
    const retainedVersions = await copyRetained(outputDir, version, retained);
    const buildInfo = {
      schemaVersion: 1,
      version,
      dictionarySha256: await hashFile(dataPath),
      sources: {},
      ...(retainedVersions.length ? { retainedVersions } : {}),
    };
    for (const file of releaseSources)
      buildInfo.sources[file] = await hashFile(join(project, file));
    await writeFile(join(outputDir, 'build-info.json'), JSON.stringify(buildInfo));
    const html = (await readFile(join(project, 'web/index.html'), 'utf8')).replaceAll(
      '__MANIFEST_URL__',
      './data/' + version + '/manifest.json',
    );
    await writeFile(join(outputDir, 'index.html'), html);
    await writeFile(join(outputDir, '.nojekyll'), '');
    await writeFile(
      join(outputDir, 'ATTRIBUTION.txt'),
      [
        'Dictionary definitions: Japanese Wiktionary contributors, via Kaikki.org/Wiktextract.',
        'Source page links and attribution are retained in every candidate.',
        'CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/',
        'Changes: Japanese-language filtering, reading normalization, labels, sense mapping and static sharding.',
        'Current article links are not exact historical revision links.',
        'Adapted dictionary data retains CC BY-SA 4.0; application code is separate.',
        ...data.sources.map((s) => s.id + ' | ' + s.version + ' | ' + s.url + ' | ' + s.license),
      ].join('\n') + '\n',
    );
    return { version, manifest };
  } catch (error) {
    await rm(outputDir, { recursive: true, force: true });
    throw error;
  }
}
export async function rebuildWebFromPublished({
  siteDir,
  releaseManifest: m,
  outputDir,
  archivePath,
  retainedReleases = [],
}) {
  if (!/^v1-[a-f0-9]{16}$/.test(m.version) || !/^([a-f0-9]{64})$/.test(m.dictionarySha256))
    throw Error('invalid base manifest');
  const dictionaries = await retainedDictionaries(
    retainedReleases,
    await publishedDictionaries({ siteDir, releaseManifest: m, archivePath }),
  );
  const version = m.version;
  const retained = [
    'ATTRIBUTION.txt',
    `data/${version}/manifest.json`,
    ...Array.from(
      { length: 256 },
      (_, i) => `data/${version}/${i.toString(16).padStart(2, '0')}.json`,
    ),
  ];
  for (const name of [...retained, 'build-info.json', 'dictionary.mjs', 'reading-bucket.mjs']) {
    const path = join(siteDir, name),
      stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || (await hashFile(path)) !== m.artifacts[name])
      throw Error('base artifact mismatch: ' + name);
  }
  const oldInfo = JSON.parse(await readFile(join(siteDir, 'build-info.json'), 'utf8'));
  if (oldInfo.version !== version || oldInfo.dictionarySha256 !== m.dictionarySha256)
    throw Error('base dictionary mismatch');
  for (const name of ['dictionary.mjs', 'reading-bucket.mjs'])
    if ((await hashFile(join(project, name))) !== m.artifacts[name])
      throw Error('dictionary runtime mismatch: ' + name);
  await mkdir(outputDir);
  try {
    await mkdir(join(outputDir, 'web'));
    await mkdir(join(outputDir, 'data', version), { recursive: true });
    for (const name of retained) await copyFile(join(siteDir, name), join(outputDir, name));
    for (const name of copiedSources) {
      await mkdir(dirname(join(outputDir, name)), { recursive: true });
      await copyFile(join(project, name), join(outputDir, name));
    }
    const retainedVersions = await copyRetained(outputDir, version, dictionaries);
    const info = {
      schemaVersion: 1,
      version,
      dictionarySha256: m.dictionarySha256,
      sources: {},
      ...(retainedVersions.length ? { retainedVersions } : {}),
    };
    for (const file of releaseSources) info.sources[file] = await hashFile(join(project, file));
    await writeFile(join(outputDir, 'build-info.json'), JSON.stringify(info));
    await writeFile(
      join(outputDir, 'index.html'),
      (await readFile(join(project, 'web/index.html'), 'utf8')).replaceAll(
        '__MANIFEST_URL__',
        './data/' + version + '/manifest.json',
      ),
    );
    await writeFile(join(outputDir, '.nojekyll'), '');
    return { version };
  } catch (error) {
    await rm(outputDir, { recursive: true, force: true });
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2),
      retainedReleases = [];
    let result, out;
    for (let i = 0; i < args.length;) {
      if (args[i] !== '--retain-published') {
        i++;
        continue;
      }
      const [, siteDir, manifestPath] = args.slice(i, i + 3);
      if (!siteDir || !manifestPath || siteDir.startsWith('--') || manifestPath.startsWith('--'))
        throw Error('Usage: --retain-published OLD_SITE OLD_MANIFEST');
      retainedReleases.push({
        siteDir,
        releaseManifest: JSON.parse(await readFile(manifestPath, 'utf8')),
        archivePath: join(dirname(manifestPath), 'site.zip'),
      });
      args.splice(i, 3);
    }
    if (args[0] === '--reuse-published') {
      const [, siteDir, manifestPath, outputDir] = args;
      if (args.length !== 4 || !siteDir || !manifestPath || !outputDir)
        throw Error(
          'Usage: node build-web.mjs --reuse-published BASE_SITE BASE_MANIFEST NEW_OUTPUT',
        );
      out = outputDir;
      result = await rebuildWebFromPublished({
        siteDir,
        releaseManifest: JSON.parse(await readFile(manifestPath, 'utf8')),
        outputDir,
        archivePath: join(dirname(manifestPath), 'site.zip'),
        retainedReleases,
      });
    } else {
      const [input, outputDir] = args;
      if (args.length !== 2 || !input || !outputDir)
        throw Error('Usage: node build-web.mjs DICTIONARY_BUILD_DIR NEW_OUTPUT');
      out = outputDir;
      result = await buildWeb(input, out, { retainedReleases });
    }
    console.log(JSON.stringify({ version: result.version, output: out }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
