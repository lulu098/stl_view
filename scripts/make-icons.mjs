// 生成 PWA 图标（纯 Node，无第三方依赖）：深色圆角底 + 等轴测立方体
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

/* ---------------- PNG 编码 ---------------- */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- 极简光栅器 ---------------- */
function createSurface(size) {
  return { size, data: new Float32Array(size * size * 4) };
}

function blendPixel(surface, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= surface.size || y >= surface.size || a <= 0) return;
  const i = (y * surface.size + x) * 4;
  const data = surface.data;
  const dstA = data[i + 3];
  const outA = a + dstA * (1 - a);
  if (outA <= 0) return;
  data[i] = (r * a + data[i] * dstA * (1 - a)) / outA;
  data[i + 1] = (g * a + data[i + 1] * dstA * (1 - a)) / outA;
  data[i + 2] = (b * a + data[i + 2] * dstA * (1 - a)) / outA;
  data[i + 3] = outA;
}

const mix = (a, b, t) => a + (b - a) * t;

function fillPolygon(surface, points, colorFn) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(surface.size - 1, Math.ceil(maxY));

  for (let y = yStart; y <= yEnd; y += 1) {
    const scanY = y + 0.5;
    const crossings = [];
    for (let i = 0; i < points.length; i += 1) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if ((scanY >= y1 && scanY < y2) || (scanY >= y2 && scanY < y1)) {
        crossings.push(x1 + ((scanY - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil(crossings[k] - 0.5));
      const to = Math.min(surface.size - 1, Math.floor(crossings[k + 1] - 0.5));
      for (let x = from; x <= to; x += 1) {
        const [r, g, b, a] = colorFn(x + 0.5, scanY);
        blendPixel(surface, x, y, r, g, b, a);
      }
    }
  }
}

function fillRoundedRect(surface, x0, y0, x1, y1, radius, colorFn) {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(surface.size, Math.ceil(y1)); y += 1) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(surface.size, Math.ceil(x1)); x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const dx = Math.max(x0 + radius - px, 0, px - (x1 - radius));
      const dy = Math.max(y0 + radius - py, 0, py - (y1 - radius));
      if (dx * dx + dy * dy > radius * radius) continue;
      const [r, g, b, a] = colorFn(px, py);
      blendPixel(surface, x, y, r, g, b, a);
    }
  }
}

function downsample(surface, factor) {
  const size = surface.size / factor;
  const out = Buffer.alloc(size * size * 4);
  const src = surface.data;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let alphaSum = 0;
      for (let sy = 0; sy < factor; sy += 1) {
        for (let sx = 0; sx < factor; sx += 1) {
          const i = ((y * factor + sy) * surface.size + (x * factor + sx)) * 4;
          const a = src[i + 3];
          r += src[i] * a;
          g += src[i + 1] * a;
          b += src[i + 2] * a;
          alphaSum += a;
        }
      }
      const count = factor * factor;
      const o = (y * size + x) * 4;
      if (alphaSum > 0) {
        out[o] = Math.round((r / alphaSum) * 255);
        out[o + 1] = Math.round((g / alphaSum) * 255);
        out[o + 2] = Math.round((b / alphaSum) * 255);
      }
      out[o + 3] = Math.round((alphaSum / count) * 255);
    }
  }
  return { size, data: out };
}

/* ---------------- 图标绘制 ---------------- */
const hex = (value) => [
  parseInt(value.slice(1, 3), 16) / 255,
  parseInt(value.slice(3, 5), 16) / 255,
  parseInt(value.slice(5, 7), 16) / 255,
];

const CUBE_FACES = [
  // [四个顶点, 起始色, 结束色]
  { points: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]], from: '#a5e6ff', to: '#38bdf8' },
  { points: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], from: '#3b9fd6', to: '#1d6fa5' },
  { points: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], from: '#25678f', to: '#123b57' },
];

function drawIcon(size, { maskable = false } = {}) {
  const scale = 4;
  const surface = createSurface(size * scale);
  const S = surface.size;

  const bgTop = hex('#182a3c');
  const bgBottom = hex('#070b11');
  if (maskable) {
    fillRoundedRect(surface, 0, 0, S, S, 0, (x, y) => {
      const t = (x / S) * 0.35 + (y / S) * 0.65;
      return [mix(bgTop[0], bgBottom[0], t), mix(bgTop[1], bgBottom[1], t), mix(bgTop[2], bgBottom[2], t), 1];
    });
  } else {
    const radius = S * 0.235;
    fillRoundedRect(surface, 0, 0, S, S, radius, (x, y) => {
      const t = (x / S) * 0.35 + (y / S) * 0.65;
      return [mix(bgTop[0], bgBottom[0], t), mix(bgTop[1], bgBottom[1], t), mix(bgTop[2], bgBottom[2], t), 1];
    });
  }

  // 等轴测投影
  const cos30 = Math.cos(Math.PI / 6);
  const sin30 = Math.sin(Math.PI / 6);
  const project = ([x, y, z]) => [(x - z) * cos30, (x + z) * sin30 - y];

  const projected = CUBE_FACES.flatMap((face) => face.points.map(project));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of projected) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  const fillRatio = maskable ? 0.5 : 0.66;
  const target = S * fillRatio;
  const factor = target / Math.max(maxX - minX, maxY - minY);
  const offsetX = S / 2 - ((minX + maxX) / 2) * factor;
  const offsetY = S / 2 - ((minY + maxY) / 2) * factor;
  const toScreen = (point) => {
    const [px, py] = project(point);
    return [px * factor + offsetX, py * factor + offsetY];
  };

  for (const face of CUBE_FACES) {
    const points = face.points.map(toScreen);
    const faceMinY = Math.min(...points.map((p) => p[1]));
    const faceMaxY = Math.max(...points.map((p) => p[1]));
    const from = hex(face.from);
    const to = hex(face.to);
    fillPolygon(surface, points, (_x, y) => {
      const t = (y - faceMinY) / Math.max(faceMaxY - faceMinY, 1);
      return [mix(from[0], to[0], t), mix(from[1], to[1], t), mix(from[2], to[2], t), 1];
    });
  }

  // 亮色描边
  const edges = [
    [[0, 1, 0], [1, 1, 0]],
    [[1, 1, 0], [1, 1, 1]],
    [[1, 1, 1], [0, 1, 1]],
    [[0, 1, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 0]],
    [[1, 1, 0], [1, 0, 0]],
    [[1, 1, 1], [1, 0, 1]],
    [[0, 1, 1], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 1]],
    [[1, 0, 1], [1, 0, 0]],
  ];
  const lineWidth = S * 0.013;
  const strokeColor = [0.86, 0.95, 1, 0.9];
  for (const [a, b] of edges) {
    const [x1, y1] = toScreen(a);
    const [x2, y2] = toScreen(b);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy) || 1;
    const nx = (-dy / length) * (lineWidth / 2);
    const ny = (dx / length) * (lineWidth / 2);
    fillPolygon(
      surface,
      [
        [x1 + nx, y1 + ny],
        [x2 + nx, y2 + ny],
        [x2 - nx, y2 - ny],
        [x1 - nx, y1 - ny],
      ],
      () => strokeColor,
    );
  }

  const final = downsample(surface, scale);
  return encodePng(final.size, final.size, final.data);
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect width="24" height="24" rx="5.5" fill="#0b1017"/>
  <path d="M12 6.8 16.5 9.4 12 12 7.5 9.4z" fill="#7dd3fc"/>
  <path d="M16.5 9.4v5.2L12 17.2v-5.2z" fill="#1d6fa5"/>
  <path d="M7.5 9.4v5.2l4.5 2.6v-5.2z" fill="#2f89c0"/>
  <path d="M12 6.8 16.5 9.4 12 12 7.5 9.4zM16.5 9.4v5.2L12 17.2 7.5 14.6V9.4" fill="none" stroke="#dff1ff" stroke-opacity=".85" stroke-width=".7" stroke-linejoin="round"/>
</svg>
`;

mkdirSync(OUT_DIR, { recursive: true });

const outputs = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],
];

for (const [name, size, options] of outputs) {
  writeFileSync(path.join(OUT_DIR, name), drawIcon(size, options));
  console.log(`生成 ${name} (${size}×${size})`);
}

writeFileSync(path.join(OUT_DIR, 'favicon.svg'), FAVICON_SVG.trim() + '\n');
console.log('生成 favicon.svg');
