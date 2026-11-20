// 生成一个示例模型 public/demo.stl（二进制 STL，圆环）
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'demo.stl');

const MAJOR = 30;
const MINOR = 11;
const SEG_U = 96;
const SEG_V = 48;

const point = (u, v) => {
  const cu = Math.cos(u);
  const su = Math.sin(u);
  const cv = Math.cos(v);
  const sv = Math.sin(v);
  return [(MAJOR + MINOR * cv) * cu, MINOR * sv, (MAJOR + MINOR * cv) * su];
};

const triangles = [];
const pushTri = (a, b, c) => {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  triangles.push({ normal: [nx / len, ny / len, nz / len], a, b, c });
};

for (let i = 0; i < SEG_U; i += 1) {
  const u0 = (i / SEG_U) * Math.PI * 2;
  const u1 = ((i + 1) / SEG_U) * Math.PI * 2;
  for (let j = 0; j < SEG_V; j += 1) {
    const v0 = (j / SEG_V) * Math.PI * 2;
    const v1 = ((j + 1) / SEG_V) * Math.PI * 2;
    const p00 = point(u0, v0);
    const p10 = point(u1, v0);
    const p11 = point(u1, v1);
    const p01 = point(u0, v1);
    pushTri(p00, p10, p11);
    pushTri(p00, p11, p01);
  }
}

const buffer = Buffer.alloc(84 + triangles.length * 50);
buffer.write('STL 查看器示例模型（圆环 R30 r11）', 0, 'utf8');
buffer.writeUInt32LE(triangles.length, 80);

let offset = 84;
for (const { normal, a, b, c } of triangles) {
  for (const value of [...normal, ...a, ...b, ...c]) {
    buffer.writeFloatLE(value, offset);
    offset += 4;
  }
  offset += 2;
}

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, buffer);
console.log(`生成 public/demo.stl：${triangles.length} 个三角面，${(buffer.length / 1024).toFixed(0)} KB`);
