import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, SITE } from './config.mjs';

/**
 * 把 public/ 下的静态资源同步到发布目录（仓库根目录），
 * 并把 Service Worker 里的 __BUILD_VERSION__ 替换成实际版本号。
 */
export async function syncStatic({ version = 'dev' } = {}) {
  await mkdir(SITE, { recursive: true });
  await cp(path.join(ROOT, 'public'), SITE, { recursive: true });

  const swPath = path.join(SITE, 'sw.js');
  const sw = await readFile(swPath, 'utf8');
  await writeFile(swPath, sw.replaceAll('__BUILD_VERSION__', version));
}
