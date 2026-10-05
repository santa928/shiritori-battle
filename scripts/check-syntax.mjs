import { spawnSync } from 'node:child_process';
import { sourceFiles } from './source-files.mjs';

// 配置を変えても構文検査から漏らさない。生成物と依存は対象外。
for (const path of await sourceFiles()) {
  const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
