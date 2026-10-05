import { spawnSync } from 'node:child_process';
import { sourceFiles } from './source-files.mjs';

const tests = (await sourceFiles()).filter((path) => path.endsWith('.test.mjs'));
const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
