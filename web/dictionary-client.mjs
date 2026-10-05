import { normalizeReading, createDictionary } from '../dictionary.mjs';
import { bucketForReading } from '../reading-bucket.mjs';
const pendingLabels = new Set(['classification-conflict']);
/**
 * manifestと必要な区画を遅延取得し、SHA-256・サイズ・版・同一originの参照先を検証する。
 * @param {object} options manifestUrl、任意のreleaseInfoUrl/fetchImpl/timeoutMs（本文取得を含む）。
 * @returns {{search: function(string): Promise<object>}} 読み・採否・候補・保留・出典・版を返す。取得/検証失敗はrejectする。
 * 失敗したPromiseは破棄する。再試行時だけ公開版を再照会し、古い失敗で新しい要求を無効にしない。
 */
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
  // 本文転送も期限に含め、通信失敗で手番が停止し続けないようにする。
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
        // 公開更新後も残るmanifestを再試行時に再検証する。
        // 遅れた失敗で、新しい同時要求のmanifestを無効にしない。
        if (manifestPromise === current) {
          manifestPromise = null;
          reload = true;
        }
        throw error;
      }
    },
  });
}
