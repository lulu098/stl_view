import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DIST, ROOT } from './config.mjs';

/**
 * 把 index.html 与 public/ 下的静态资源同步到 dist/，
 * 并把 Service Worker 里的 __BUILD_VERSION__ 替换成实际版本号。
 */
export async function syncStatic({ version = 'dev' } = {}) {
  await mkdir(DIST, { recursive: true });
  await cp(path.join(ROOT, 'index.html'), path.join(DIST, 'index.html'));
  await cp(path.join(ROOT, 'public'), DIST, { recursive: true });

  const swPath = path.join(DIST, 'sw.js');
  const sw = await readFile(swPath, 'utf8');
  await writeFile(swPath, sw.replaceAll('__BUILD_VERSION__', version));
}
