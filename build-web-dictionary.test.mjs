import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildWebDictionary, extractReview } from './build-web-dictionary.mjs';
import { bucketForReading } from './reading-bucket.mjs';
import { createDictionary } from './dictionary.mjs';
import { dataset, entry, sense } from './web-fixtures.mjs';
test('shards preserve lookup results, deduplicate and verify bytes and checksums', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shards-'));
  try {
    const data = dataset([
      entry('橋', ['はし']),
      entry('箸', ['はし']),
      entry(
        '複数',
        ['あお', 'せい'],
        [sense('1', { readings: ['あお'] }), sense('2', { readings: ['せい'] })],
      ),
    ]);
    const out = join(dir, 'out');
    const m = await buildWebDictionary({ dataset: data, outputDir: out, version: 'v1' });
    assert.equal(Object.keys(m.shards).length, 256);
    for (const r of ['はし', 'あお', 'せい']) {
      const key = await bucketForReading(r);
      const b = await readFile(join(out, key + '.json'));
      const shard = JSON.parse(b);
      assert.equal(m.shards[key].bytes, b.length);
      assert.equal(m.shards[key].sha256, createHash('sha256').update(b).digest('hex'));
      assert.deepEqual(createDictionary(shard.dataset).lookup(r), createDictionary(data).lookup(r));
      assert.equal(
        new Set(shard.dataset.entries.map((x) => x.id)).size,
        shard.dataset.entries.length,
      );
    }
    await assert.rejects(
      buildWebDictionary({ dataset: data, outputDir: out, version: 'v1' }),
      /exist/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('review only exposes explicit candidate readings, no raw definitions', () => {
  const record = {
    raw: {
      word: '架空語',
      forms: [
        { form: 'かな', tags: ['transliteration'] },
        { form: 'かに', tags: ['transliteration'] },
        { form: 'おん', tags: ['transliteration', 'kan-on'] },
      ],
      senses: [{ glosses: ['secret'] }],
      examples: ['secret'],
    },
    reason: 'ambiguous-reading',
    entry: null,
  };
  assert.deepEqual(
    extractReview(record).map((x) => x.reading),
    ['かな', 'かに'],
  );
  assert.equal(JSON.stringify(extractReview(record)).includes('secret'), false);
  assert.equal(
    extractReview({
      ...record,
      raw: { word: '漢字', forms: [{ form: 'かんじ', tags: ['transliteration', 'kan-on'] }] },
    }).length,
    0,
  );
  assert.equal(extractReview({ ...record, reason: 'invalid-record' }).length, 0);
});
test('archive-derived review is partitioned and version rejects paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'review-'));
  try {
    const archive = join(dir, 'archive.jsonl');
    await writeFile(
      archive,
      JSON.stringify({ raw: { word: 'かな' }, reason: 'ambiguous-reading', entry: null }) + '\n',
    );
    const out = join(dir, 'out');
    await buildWebDictionary({
      dataset: dataset(),
      archivePath: archive,
      outputDir: out,
      version: 'v1',
    });
    assert.equal(
      JSON.parse(await readFile(join(out, (await bucketForReading('かな')) + '.json'))).review[0]
        .reason,
      'ambiguous-reading',
    );
    await assert.rejects(
      buildWebDictionary({ dataset: dataset(), outputDir: join(dir, 'bad'), version: '../x' }),
      /version/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
