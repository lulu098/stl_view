import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// GitHub Pages 发布的是 main 分支根目录，所以构建产物直接输出到仓库根目录。
// 根目录下的 app.js / app.css / sw.js / manifest.webmanifest / icons / demo.stl 都是构建生成的，不要手改。
export const SITE = ROOT;

/** 由构建生成、可以安全删除的文件/目录（都在仓库根目录） */
export const GENERATED = ['app.js', 'app.css', 'sw.js', 'manifest.webmanifest', 'demo.stl', 'icons', '.nojekyll'];

/** @returns {import('esbuild').BuildOptions} */
export function buildOptions({ minify = true, dev = false } = {}) {
  return {
    entryPoints: [path.join(ROOT, 'src', 'main.js')],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    outdir: SITE,
    entryNames: 'app',
    assetNames: 'assets/[name]-[hash]',
    loader: { '.png': 'file', '.jpg': 'file', '.svg': 'file', '.stl': 'file' },
    minify,
    sourcemap: dev ? 'inline' : false,
    legalComments: 'none',
    logLevel: 'info',
    define: { __DEV__: dev ? 'true' : 'false' },
  };
}
