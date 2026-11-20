# STL 查看器（可安装到手机的 PWA）

一个纯前端的 STL 模型查看器，构建产物是一组静态文件。用手机浏览器打开后「添加到主屏幕 / 安装应用」，就能像原生 App 一样全屏离线使用 —— 不需要应用商店、不需要签名、iPhone 和 Android 通用。

## 功能

- 打开 **二进制 / ASCII STL**，可一次打开多个模型（多文件自动分配颜色，可单独隐藏 / 删除 / 聚焦）
- 触摸手势：单指旋转、双指缩放与平移；桌面端鼠标拖拽 + 滚轮
- 双击（或点「视角」）一键适配视图，支持自动旋转、线框、地面网格
- 信息面板：三角面数、包围盒尺寸（mm）、体积（近似）、文件大小
- 一键截图保存 PNG
- 全屏模式、深色主题、刘海屏安全区适配
- Service Worker 预缓存：**安装后可完全离线使用**
- 支持在系统文件管理器里「用 STL 查看器打开」`.stl`（Android + 已安装的 PWA）

## 在手机上安装

PWA 的安装按钮要求页面运行在 **HTTPS**（或 `localhost`）下，所以手机安装必须走 HTTPS。

### 方式 A：局域网直连（最快，本地 CA + HTTPS）

```powershell
npm install
npm run build
npm run preview
```

终端会打印本机所有网卡地址，并标注推荐的那一个，例如：

```
  >>> 手机请用这个： https://192.168.1.120:8443  [WLAN｜默认上网网卡]
      https://192.168.56.1:8443  [VirtualBox Host-Only Network｜虚拟网卡，手机通常连不上]
```

**只挑标了「默认上网网卡」的那个 IP**（`192.168.56.x` 之类是 VirtualBox/VMware 虚拟网卡，手机根本不在那个网段）。

浏览器只有在证书被信任时才允许注册 Service Worker（否则装不成应用），所以先让手机信任本地 CA：

1. 手机连同一个 Wi-Fi，浏览器打开 `http://<你的IP>:8080/ca.crt` 下载证书
2. **Android**：设置 → 安全（或「加密与凭据」）→ 安装证书 → **CA 证书** → 选刚下载的文件
   **iPhone**：设置 → 已下载描述文件 → 安装，再进 设置 → 通用 → 关于本机 → 证书信任设置 → 开启完全信任
3. 再用 `https://<你的IP>:8443` 打开，地址栏显示正常小锁 / 无警告
4. **Android Chrome**：右上角菜单 → 「安装应用」；**iPhone Safari**：分享 → 「添加到主屏幕」

> HTTPS 依赖本机 `openssl`（Git for Windows 自带，脚本会自动查找）。找不到时只启动 8080 的 HTTP，可以浏览但无法安装。
> 证书有 SAN 白名单，换网络导致 IP 变化后脚本会自动按新 IP 重签服务端证书，CA 不用重装。

### 方式 B：部署到静态托管（最省事，推荐长期使用）

把 `dist/` 目录上传到任意静态托管（GitHub Pages、Cloudflare Pages、Vercel、Netlify、nginx…）即可，全部是静态文件、无后端依赖，且自带受信任的 HTTPS，手机直接就能安装。

> 托管在子路径（如 `https://user.github.io/stl-viewer/`）也没问题，所有资源都使用相对路径。

### 方式 C：真 APK

本项目是用 Capacitor / Cordova / Tauri 打包 APK 的理想素材（纯静态、无后端），需要本机安装 JDK 17 + Android SDK，本项目未包含这套工具链。

## 本地开发

```powershell
npm install
npm run dev      # http://localhost:5173 ，热重建，不注册 Service Worker
```

其它命令：

| 命令 | 作用 |
| --- | --- |
| `npm run build` | 打包到 `dist/`（esbuild + 版本号注入到 sw.js） |
| `npm run preview` | 用 Node 静态服务器预览 `dist/`，同时提供局域网 HTTP/HTTPS |
| `npm run icons` | 重新生成 PWA 图标（纯 Node 绘制，无第三方依赖） |
| `npm run demo` | 重新生成示例模型 `public/demo.stl` |

## 目录结构

```
index.html                 页面骨架 + 内联 SVG 图标
src/main.js                界面逻辑：文件打开/拖放、模型列表、工具栏、安装提示
src/viewer.js              three.js 场景：光照、相机适配、网格、截图、体积统计
src/pwa.js                 Service Worker 注册 + 安装引导（含 iOS 提示）
src/style.css              移动优先的深色主题样式
public/manifest.webmanifest  PWA 清单（standalone、图标、文件关联）
public/sw.js               离线缓存策略（预缓存 + 缓存优先 + 后台更新）
public/icons/              自动生成的图标
public/demo.stl            示例模型
scripts/                   构建、开发服务器、图标与示例模型生成脚本
```

## 实现说明

- **解析**：`STLLoader` 同时支持二进制与 ASCII；文件面法线全为 0 时会自动重算法线，材质使用 `DoubleSide` 以避免法线翻转的模型出现黑洞。
- **相机适配**：按包围球半径 + 垂直/水平视角中较小者计算距离，竖屏手机也不会把模型裁出画面；同时按尺寸调整 `near/far`，兼容 0.1 mm 的微型件和 1000 mm 的大件。
- **离线策略**：构建时把版本号写入 `sw.js` 的缓存名，`install` 阶段预缓存全部资源；导航请求「缓存优先 + 后台更新」，弱网或断网时不会白屏，联网后自动拿到新版本。
- **单位**：STL 没有单位信息，这里按 3D 打印惯例假定为毫米（mm）。

## 已知限制

- 体积为三角网格有向体积的绝对值，模型不封闭（有孔洞）时结果只是近似值。
- 超大模型（数十万面以上）在低端手机上可能卡顿，建议先减面。
- 截图在 iOS Safari 中会以「下载图片」的方式触发，若被拦截可在文件 App 中查看。
