import * as esbuild from 'esbuild';
import { watch } from 'node:fs';
import path from 'node:path';
import { buildOptions, DIST, ROOT } from './config.mjs';
import { syncStatic } from './static.mjs';

const PORT = Number(process.env.PORT || 5173);

await syncStatic({ version: 'dev' });

const context = await esbuild.context(buildOptions({ minify: false, dev: true }));
await context.watch();

let timer = null;
const scheduleSync = () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    syncStatic({ version: 'dev' }).catch((error) => console.error('[static]', error));
  }, 150);
};

watch(path.join(ROOT, 'index.html'), scheduleSync);
watch(path.join(ROOT, 'public'), { recursive: true }, scheduleSync);

const served = await context.serve({ servedir: DIST, port: PORT, host: '0.0.0.0' });
const hosts = served.hosts && served.hosts.length ? served.hosts : ['localhost'];

console.log(`\n开发服务器已启动： http://localhost:${served.port}`);
console.log('局域网地址（开发模式不注册 Service Worker）：');
for (const host of hosts) console.log(`  http://${host}:${served.port}`);
console.log('');
