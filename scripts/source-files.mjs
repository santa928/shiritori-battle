import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** 手書きmoduleの配置だけを探索し、distの退避ソースや依存を検証対象に混ぜない。 */
export async function sourceFiles() {
  const files = [];
  async function collect(directory, recursive) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (recursive && entry.isDirectory()) await collect(path, true);
      else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(path);
    }
  }
  await collect('.', false);
  await collect('web', true);
  await collect('scripts', true);
  return files.sort();
}
