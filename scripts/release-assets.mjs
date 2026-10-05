import { readFile } from 'node:fs/promises';

// NodeとPythonの生成・検証で同じallowlistを参照する。データ区画は版ごとに追加する。
const spec = JSON.parse(await readFile(new URL('./release-assets.json', import.meta.url), 'utf8'));
export const copiedSources = Object.freeze(spec.copiedSources);
export const staticArtifacts = Object.freeze(spec.staticArtifacts);
export const releaseSources = Object.freeze([...new Set([...spec.buildSources, ...copiedSources])]);
