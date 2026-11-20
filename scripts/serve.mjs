// 预览 dist/：本机 http + 局域网 https（自签名证书，用于在手机上安装 PWA）
import http from 'node:http';
import https from 'node:https';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { DIST, ROOT } from './config.mjs';

const HTTP_PORT = Number(process.env.PORT || 8080);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);
const CERT_DIR = path.join(ROOT, '.certs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.stl': 'model/stl',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

// 虚拟网卡（VirtualBox / VMware / Hyper-V / 蓝牙 / WSL 等）手机一般是连不上的
const VIRTUAL_ADAPTER = /virtualbox|vmware|hyper-?v|vethernet|default switch|loopback|bluetooth|bluetooth|wsl|docker|tap|tun\d|tailscale|zerotier|hamachi|npcap|本地连接\s*\*/i;

/** 默认路由所在网卡名，用于挑出「真正上网的那块网卡」 */
function defaultRouteInterface() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '(Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).InterfaceAlias',
        ],
        { encoding: 'utf8', timeout: 8000 },
      );
      return out.trim();
    }
    if (process.platform === 'linux') {
      const out = execFileSync('ip', ['route', 'show', 'default'], { encoding: 'utf8', timeout: 5000 });
      return out.match(/dev\s+(\S+)/)?.[1] || '';
    }
    const out = execFileSync('route', ['-n', 'get', 'default'], { encoding: 'utf8', timeout: 5000 });
    return out.match(/interface:\s+(\S+)/)?.[1] || '';
  } catch {
    return '';
  }
}

function lanAddresses() {
  const preferred = defaultRouteInterface();
  const list = [];

  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      const family = entry.family;
      if (family !== 'IPv4' && family !== 4) continue;
      if (entry.internal) continue;
      if (entry.address.startsWith('169.254.')) continue;
      list.push({
        name,
        address: entry.address,
        isVirtual: VIRTUAL_ADAPTER.test(name),
        isDefault: Boolean(preferred) && name === preferred,
      });
    }
  }

  const score = (item) => (item.isDefault ? 100 : 0) + (item.isVirtual ? -50 : 10);
  return list.sort((a, b) => score(b) - score(a));
}

function describe(item) {
  const tags = [];
  if (item.isDefault) tags.push('默认上网网卡');
  if (item.isVirtual) tags.push('虚拟网卡，手机通常连不上');
  return tags.length ? `  [${item.name}｜${tags.join('，')}]` : `  [${item.name}]`;
}

function handleRequest(request, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end('Bad Request');
    return;
  }

  // 手机下载本地 CA 证书（安装后浏览器才会信任 https 站点）
  if (pathname === '/ca.crt' || pathname === '/ca.pem') {
    const caPath = path.join(CERT_DIR, 'ca.pem');
    if (!existsSync(caPath)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('尚未生成本地 CA（需要 openssl）');
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'application/x-x509-ca-cert',
      'Content-Disposition': 'attachment; filename="stl-viewer-ca.crt"',
      'Cache-Control': 'no-store',
    });
    createReadStream(caPath).pipe(response);
    return;
  }

  let filePath = path.join(DIST, pathname);
  if (!filePath.startsWith(DIST)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!existsSync(filePath)) {
    filePath = path.join(DIST, 'index.html');
  }

  const extension = path.extname(filePath).toLowerCase();
  const noCache = ['.html', '.webmanifest', '.js'].includes(extension);
  response.writeHead(200, {
    'Content-Type': MIME[extension] || 'application/octet-stream',
    'Cache-Control': noCache ? 'no-cache' : 'public, max-age=300',
    'Service-Worker-Allowed': '/',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

function findOpenSSL() {
  const candidates = [
    process.env.OPENSSL,
    'openssl',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe',
    '/usr/bin/openssl',
    '/usr/local/bin/openssl',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.includes('\\') || candidate.includes('/')) {
      if (!existsSync(candidate)) continue;
    }
    try {
      execFileSync(candidate, ['version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // 继续尝试下一个候选
    }
  }
  return null;
}

/** 本地 CA + 服务端证书：手机安装一次 CA 后，Chrome 才会信任该站点并允许注册 Service Worker / 安装 PWA */
function ensureCertificate(ips, openssl) {
  mkdirSync(CERT_DIR, { recursive: true });
  const caKeyPath = path.join(CERT_DIR, 'ca-key.pem');
  const caPath = path.join(CERT_DIR, 'ca.pem');
  const keyPath = path.join(CERT_DIR, 'key.pem');
  const certPath = path.join(CERT_DIR, 'cert.pem');
  const csrPath = path.join(CERT_DIR, 'server.csr');
  const extPath = path.join(CERT_DIR, 'server.ext');
  const sanPath = path.join(CERT_DIR, 'san.txt');

  const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)].join(',');

  // 证书与当前 IP 一致就直接复用（CA 保持不变，手机上不用重装）
  if (existsSync(keyPath) && existsSync(certPath) && existsSync(caPath) && existsSync(sanPath)) {
    if (readFileSync(sanPath, 'utf8').trim() === san) return { keyPath, certPath, caPath };
  }

  const run = (args, label) => {
    try {
      execFileSync(openssl, args, { stdio: 'ignore' });
    } catch (error) {
      throw new Error(`${label} 失败：${error.message}`);
    }
  };

  try {
    if (!existsSync(caKeyPath) || !existsSync(caPath)) {
      run(
        [
          'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650',
          '-keyout', caKeyPath,
          '-out', caPath,
          '-subj', '/CN=STL Viewer Local CA/O=STL Viewer',
          '-addext', 'basicConstraints=critical,CA:TRUE',
          '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
        ],
        '生成本地 CA',
      );
    }

    writeFileSync(
      extPath,
      [
        'basicConstraints=CA:FALSE',
        'keyUsage=critical,digitalSignature,keyEncipherment',
        'extendedKeyUsage=serverAuth',
        `subjectAltName=${san}`,
        '',
      ].join('\n'),
    );

    run(
      ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', csrPath, '-subj', '/CN=stl-viewer'],
      '生成服务端私钥',
    );
    run(
      [
        'x509', '-req', '-in', csrPath,
        '-CA', caPath, '-CAkey', caKeyPath, '-CAcreateserial',
        '-out', certPath, '-days', '825', '-sha256', '-extfile', extPath,
      ],
      '签发服务端证书',
    );

    writeFileSync(sanPath, san);
    return { keyPath, certPath, caPath };
  } catch (error) {
    console.warn(`未能生成本地证书（${error.message}），跳过 HTTPS。`);
    return null;
  }
}

if (!existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/ 不存在，请先运行 `npm run build`。');
  process.exit(1);
}

const interfaces = lanAddresses();
const recommended = interfaces[0] || null;

http
  .createServer(handleRequest)
  .listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`\n本机预览： http://localhost:${HTTP_PORT}`);
    if (!interfaces.length) console.log('  未检测到可用的局域网网卡。');
    for (const item of interfaces) {
      console.log(`  http://${item.address}:${HTTP_PORT}${describe(item)}`);
    }
    console.log('  （HTTP 只能浏览，不能“安装为应用”）');
  })
  .on('error', (error) => console.error(`HTTP ${HTTP_PORT} 启动失败：`, error.message));

const openssl = findOpenSSL();
if (!openssl) console.warn('\n未找到 openssl（Git for Windows 自带），将无法启用 HTTPS。');

const certificate = openssl ? ensureCertificate(interfaces.map((item) => item.address), openssl) : null;
if (certificate) {
  https
    .createServer(
      {
        key: readFileSync(certificate.keyPath),
        cert: readFileSync(certificate.certPath),
      },
      handleRequest,
    )
    .listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log('\n手机安装用（手机连同一个 Wi-Fi）：');
      if (recommended) {
        console.log(`  >>> 手机请用这个： https://${recommended.address}:${HTTPS_PORT}${describe(recommended)}`);
        for (const item of interfaces.slice(1)) {
          console.log(`      https://${item.address}:${HTTPS_PORT}${describe(item)}`);
        }
      } else {
        console.log('  未检测到局域网 IP。');
      }
      console.log('\n注意：本地证书默认不被信任，直接用手机打开会提示“连接不安全”。');
      console.log('要让浏览器信任（Chrome 只有信任证书时才允许安装 PWA / 注册 Service Worker）：');
      console.log('  1) 手机浏览器先访问下面这个地址下载本地 CA：');
      if (recommended) console.log(`     http://${recommended.address}:${HTTP_PORT}/ca.crt`);
      console.log('  2) Android：设置 → 安全（或“加密与凭据”）→ 安装证书 → CA 证书 → 选择刚下载的文件');
      console.log('     iPhone：设置 → 已下载描述文件 → 安装 → 通用 → 关于本机 → 证书信任设置 → 开启完全信任');
      console.log('  3) 再用上面的 https 地址打开，安装提示就会正常出现');
      console.log('  Android Chrome：右上角菜单 → “安装应用”；iPhone Safari：分享 → “添加到主屏幕”');
      console.log('\n如果嫌麻烦，最省事的是把 dist/ 部署到任意静态托管（GitHub Pages / Cloudflare Pages / Netlify），');
      console.log('那里有受信任的 HTTPS，直接就能安装。');
      console.log(`\n若手机完全打不开，说明 Windows 防火墙拦了 node（端口 ${HTTP_PORT}/${HTTPS_PORT}），`);
      console.log('用管理员 PowerShell 执行：');
      console.log(
        `  New-NetFirewallRule -DisplayName "STL Viewer" -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${HTTP_PORT},${HTTPS_PORT}`,
      );
      console.log('');
    })
    .on('error', (error) => console.error(`HTTPS ${HTTPS_PORT} 启动失败：`, error.message));
} else {
  console.log('\n未启用 HTTPS：安装为应用需要 HTTPS（或部署到 GitHub Pages 等静态托管）。\n');
}
