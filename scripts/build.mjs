import * as esbuild from 'esbuild';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { buildOptions, GENERATED, ROOT, SITE } from './config.mjs';
import { syncStatic } from './static.mjs';

const version = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

// 只删除构建产物，源码（src/、public/、scripts/）不受影响
for (const name of GENERATED) {
  await rm(path.join(ROOT, name), { recursive: true, force: true });
}

await esbuild.build(buildOptions({ minify: true }));
await syncStatic({ version });

console.log(`\n构建完成 → ${SITE}（版本 ${version}）`);
console.log('根目录的 app.js / app.css / sw.js / manifest.webmanifest / icons / demo.stl 已更新。');
console.log('提交并推送后 GitHub Pages 会自动生效；本地预览用 `npm run preview`。');
