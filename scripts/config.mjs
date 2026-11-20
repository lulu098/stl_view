import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIST = path.join(ROOT, 'dist');

/** @returns {import('esbuild').BuildOptions} */
export function buildOptions({ minify = true, dev = false } = {}) {
  return {
    entryPoints: [path.join(ROOT, 'src', 'main.js')],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    outdir: DIST,
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
