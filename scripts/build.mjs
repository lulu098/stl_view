import * as esbuild from 'esbuild';
import { rm } from 'node:fs/promises';
import { buildOptions, DIST } from './config.mjs';
import { syncStatic } from './static.mjs';

const version = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

await rm(DIST, { recursive: true, force: true });
await esbuild.build(buildOptions({ minify: true }));
await syncStatic({ version });

console.log(`\n构建完成 → ${DIST}（版本 ${version}）`);
console.log('运行 `npm run preview` 预览构建产物。');
