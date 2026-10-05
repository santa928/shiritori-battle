import { normalizeReading, createDictionary } from '../dictionary.mjs';
import { bucketForReading } from '../reading-bucket.mjs';
const pendingLabels = new Set(['classification-conflict']);
export function createDictionaryClient({
  manifestUrl,
  releaseInfoUrl,
  fetchImpl = fetch,
  timeoutMs = 15000,
}) {
  const base = new URL(manifestUrl, globalThis.location?.href);
  const releaseBase = releaseInfoUrl ? new URL(releaseInfoUrl, base) : null;
  if (releaseBase && releaseBase.origin !== base.origin) throw new Error('辞書の参照先が不正です');
  let manifestPromise,
    reload = false;
  const cache = new Map();
  // Include body transfer in the deadline. A failed connection must not trap a turn.
  async function request(url, format, revalidate) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(url, {
            signal: controller.signal,
            cache: revalidate ? 'reload' : 'default',
          });
          if (!response.ok) throw new Error('辞書の取得に失敗しました (' + response.status + ')');
          return response[format]();
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('辞書の取得に時間がかかっています'));
            controller.abort();
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  function manifest() {
    if (!manifestPromise) {
      const revalidate = reload;
      const promise = (async () => {
        let manifestBase = base,
          expectedVersion;
        if (revalidate && releaseBase) {
          const info = await request(releaseBase.href, 'json', true);
          if (info.schemaVersion !== 1 || !/^v1-[a-f0-9]{16}$/.test(info.version))
            throw new Error('辞書の版が一致しません');
          expectedVersion = info.version;
          manifestBase = new URL('data/' + info.version + '/manifest.json', releaseBase);
        }
        const data = await request(manifestBase.href, 'json', revalidate);
        if (expectedVersion && data.version !== expectedVersion)
          throw new Error('辞書の版が一致しません');
        if (data.schemaVersion !== 1 || typeof data.version !== 'string' || !data.shards)
          throw new Error('辞書の形式が一致しません');
        return { data, revalidate, manifestBase };
      })();
      manifestPromise = promise;
      promise.catch(() => {
        if (manifestPromise === promise) {
          manifestPromise = null;
          reload = true;
        }
      });
    }
    return manifestPromise;
  }
  async function load(key, m, revalidate, manifestBase) {
    const cacheKey = manifestBase.href + ':' + m.version + ':' + key;
    if (!cache.has(cacheKey)) {
      const promise = (async () => {
        const descriptor = m.shards[key];
        if (
          !descriptor ||
          !/^([a-f0-9]{64})$/.test(descriptor.sha256) ||
          !Number.isSafeInteger(descriptor.bytes)
        )
          throw new Error('辞書の索引が不正です');
        const url = new URL(descriptor.url, manifestBase);
        if (
          url.origin !== base.origin ||
          !url.pathname.startsWith(new URL('.', manifestBase).pathname)
        )
          throw new Error('辞書の参照先が不正です');
        const bytes = await request(url.href, 'arrayBuffer', revalidate);
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map((x) => x.toString(16).padStart(2, '0'))
          .join('');
        if (hash !== descriptor.sha256 || bytes.byteLength !== descriptor.bytes)
          throw new Error('辞書データの検証に失敗しました');
        const shard = JSON.parse(new TextDecoder().decode(bytes));
        if (
          shard.schemaVersion !== 1 ||
          shard.version !== m.version ||
          !Array.isArray(shard.review)
        )
          throw new Error('辞書の版が一致しません');
        return { dictionary: createDictionary(shard.dataset), review: shard.review };
      })();
      cache.set(cacheKey, promise);
      promise.catch(() => {
        if (cache.get(cacheKey) === promise) cache.delete(cacheKey);
      });
    }
    return cache.get(cacheKey);
  }
  return Object.freeze({
    async search(input) {
      const reading = normalizeReading(input);
      if (reading === null)
        return { reading: null, status: 'invalid-reading', candidates: [], review: [] };
      const current = manifest();
      try {
        const { data: m, revalidate, manifestBase } = await current;
        const shard = await load(await bucketForReading(reading), m, revalidate, manifestBase);
        const result = shard.dictionary.lookup(reading),
          review = shard.review.filter((x) => x.reading === reading),
          candidates = result.candidates;
        const status = candidates.some((c) => c.eligible)
          ? 'eligible'
          : review.length ||
              candidates.some((c) => c.labels.some((label) => pendingLabels.has(label)))
            ? 'pending'
            : candidates.length
              ? 'ineligible'
              : 'unconfirmed';
        return {
          reading,
          status,
          candidates,
          review,
          sources: m.sources ?? [],
          version: m.version,
        };
      } catch (error) {
        // A cached manifest can outlive a release. Retry revalidates both resources.
        // Avoid a late failure invalidating a newer concurrent manifest request.
        if (manifestPromise === current) {
          manifestPromise = null;
          reload = true;
        }
        throw error;
      }
    },
  });
}
