import './style.css';
import { StlViewer } from './viewer.js';
import { registerServiceWorker, createInstaller } from './pwa.js';

const $ = (selector) => document.querySelector(selector);

const canvas = $('#view');
const fileInput = $('#file');
const modelList = $('#model-list');
const modelsPanel = $('#models');
const modelCount = $('#model-count');
const infoPanel = $('#info');
const emptyState = $('#empty');
const toastEl = $('#toast');
const dropEl = $('#drop');
const btnInstall = $('#btn-install');
const toolbar = $('#toolbar');
const colorPicker = $('#color-picker');
const colorSwatches = $('#color-swatches');
const colorInput = $('#color-input');
const colorCustomSwatch = $('#color-custom-swatch');
const rotatePanel = $('#rotate-panel');

const COLOR_PRESETS = [
  '#3b82f6', '#0ea5e9', '#22d3ee',
  '#22c55e', '#a3e635',
  '#f59e0b', '#f97316',
  '#ef4444', '#ec4899', '#a855f7', '#8b5cf6',
  '#94a3b8', '#64748b', '#f8fafc',
];

const MAX_FILE_SIZE = 300 * 1024 * 1024;
const numberFormat = new Intl.NumberFormat('zh-CN');

const viewer = new StlViewer(canvas);

/* ---------------- 提示 ---------------- */
let toastTimer = 0;
function toast(message, duration = 2400) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, duration);
}

let busyCount = 0;
function setBusy(on, message = '') {
  if (on) {
    busyCount += 1;
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.hidden = false;
  } else {
    busyCount = Math.max(0, busyCount - 1);
    if (busyCount === 0) toastEl.hidden = true;
  }
}

/* ---------------- 格式化 ---------------- */
const formatCount = (value) => numberFormat.format(value);

function formatLength(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 100) return `${value.toFixed(1)} mm`;
  if (value >= 10) return `${value.toFixed(2)} mm`;
  return `${value.toFixed(3)} mm`;
}

function formatVolume(mm3) {
  const cm3 = mm3 / 1000;
  if (cm3 >= 1000) return `${(cm3 / 1000).toFixed(2)} L`;
  if (cm3 >= 1) return `${cm3.toFixed(2)} cm³`;
  return `${(cm3 * 1000).toFixed(2)} mm³`;
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/* ---------------- 界面刷新 ---------------- */
function infoRow(label, value) {
  const row = document.createElement('div');
  const strong = document.createElement('b');
  strong.textContent = value;
  row.append(`${label} `, strong);
  return row;
}

function renderModels() {
  const models = viewer.models;
  modelCount.textContent = String(models.length);
  modelsPanel.hidden = models.length === 0;
  emptyState.hidden = models.length > 0;

  modelList.textContent = '';
  for (const model of models) {
    const row = document.createElement('div');
    row.className = 'model-row';
    row.dataset.id = String(model.id);
    if (model.id === viewer.selectedId) row.classList.add('is-selected');
    if (!model.visible) row.classList.add('is-hidden');

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = model.color;

    const name = document.createElement('span');
    name.className = 'model-name';
    name.textContent = model.name;
    name.title = model.name;

    const meta = document.createElement('span');
    meta.className = 'model-meta';
    meta.textContent = `${formatCount(model.stats.triangles)} 面`;

    const colorButton = document.createElement('button');
    colorButton.type = 'button';
    colorButton.className = 'icon-btn';
    colorButton.dataset.role = 'color';
    colorButton.title = '更改颜色';
    colorButton.innerHTML = '<svg class="icon"><use href="#i-palette" /></svg>';

    const rotateButton = document.createElement('button');
    rotateButton.type = 'button';
    rotateButton.className = 'icon-btn';
    rotateButton.dataset.role = 'rotate';
    rotateButton.title = '旋转模型';
    rotateButton.innerHTML = '<svg class="icon"><use href="#i-rotate" /></svg>';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'icon-btn';
    toggle.dataset.role = 'toggle';
    toggle.title = model.visible ? '隐藏' : '显示';
    toggle.innerHTML = `<svg class="icon"><use href="#i-${model.visible ? 'eye' : 'eye-off'}" /></svg>`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-btn';
    remove.dataset.role = 'remove';
    remove.title = '移除';
    remove.innerHTML = '<svg class="icon"><use href="#i-close" /></svg>';

    row.append(dot, name, meta, rotateButton, colorButton, toggle, remove);
    modelList.append(row);
  }
}

function renderInfo() {
  const models = viewer.models;
  if (models.length === 0) {
    infoPanel.hidden = true;
    infoPanel.textContent = '';
    return;
  }
  infoPanel.hidden = false;
  infoPanel.textContent = '';

  const selected = viewer.selectedId ? viewer.getModel(viewer.selectedId) : null;
  const title = document.createElement('div');
  title.className = 'info-title';

  if (selected) {
    title.textContent = selected.name;
    title.title = selected.name;
    infoPanel.append(
      title,
      infoRow('面数', formatCount(selected.stats.triangles)),
      infoRow(
        '尺寸',
        `${formatLength(selected.stats.size.x)} × ${formatLength(selected.stats.size.y)} × ${formatLength(selected.stats.size.z)}`,
      ),
      infoRow('体积', `≈ ${formatVolume(selected.stats.volume)}`),
      infoRow('文件', formatBytes(selected.stats.fileSize)),
    );
    return;
  }

  const visible = viewer.visibleModels;
  const totalTris = visible.reduce((sum, m) => sum + m.stats.triangles, 0);
  const totalBytes = visible.reduce((sum, m) => sum + m.stats.fileSize, 0);
  const bounds = visible.length ? viewer.bounds() : null;

  title.textContent = `全部模型（${visible.length}）`;
  infoPanel.append(title, infoRow('总面数', formatCount(totalTris)));
  if (bounds) {
    infoPanel.append(
      infoRow(
        '整体尺寸',
        `${formatLength(bounds.size.x)} × ${formatLength(bounds.size.y)} × ${formatLength(bounds.size.z)}`,
      ),
    );
  }
  if (totalBytes) infoPanel.append(infoRow('文件', formatBytes(totalBytes)));
}

function refresh() {
  renderModels();
  renderInfo();
}

/* ---------------- 更换颜色 ---------------- */
let colorTargetId = null;

// 构建预设色板（一次性）
for (const preset of COLOR_PRESETS) {
  const swatch = document.createElement('button');
  swatch.type = 'button';
  swatch.className = 'swatch';
  swatch.dataset.color = preset;
  swatch.style.background = preset;
  swatch.setAttribute('aria-label', `颜色 ${preset}`);
  colorSwatches.append(swatch);
}

function syncColorPicker(id) {
  const model = viewer.getModel(id);
  if (!model) return;
  colorInput.value = model.color;
  colorCustomSwatch.style.background = model.color;
  for (const swatch of colorSwatches.children) {
    swatch.classList.toggle('is-active', swatch.dataset.color.toLowerCase() === model.color.toLowerCase());
  }
}

function openColorPicker(id) {
  colorTargetId = id;
  syncColorPicker(id);
  colorPicker.hidden = false;
}

function closeColorPicker() {
  colorPicker.hidden = true;
  colorTargetId = null;
}

colorSwatches.addEventListener('click', (event) => {
  const swatch = event.target.closest('.swatch');
  if (!swatch || colorTargetId == null) return;
  viewer.setModelColor(colorTargetId, swatch.dataset.color);
  refresh();
  syncColorPicker(colorTargetId);
});

colorInput.addEventListener('input', () => {
  if (colorTargetId == null) return;
  viewer.setModelColor(colorTargetId, colorInput.value);
  colorCustomSwatch.style.background = colorInput.value;
  refresh();
});

colorInput.addEventListener('change', () => {
  if (colorTargetId == null) return;
  syncColorPicker(colorTargetId);
});

document.addEventListener('click', (event) => {
  if (colorPicker.hidden) return;
  if (event.target.closest('#color-picker') || event.target.closest('[data-role="color"]')) return;
  closeColorPicker();
});

/* ---------------- 旋转模型 ---------------- */
let rotateTargetId = null;

function openRotatePanel(id) {
  rotateTargetId = id;
  rotatePanel.hidden = false;
}

function closeRotatePanel() {
  rotatePanel.hidden = true;
  rotateTargetId = null;
}

rotatePanel.addEventListener('click', (event) => {
  const btn = event.target.closest('.rotate-btn');
  if (!btn || rotateTargetId == null) return;
  const axis = btn.dataset.axis;
  const deg = Number(btn.dataset.deg);
  viewer.rotateModel(rotateTargetId, axis, deg);
  refresh();
});

document.addEventListener('click', (event) => {
  if (rotatePanel.hidden) return;
  if (event.target.closest('#rotate-panel') || event.target.closest('[data-role="rotate"]')) return;
  closeRotatePanel();
});

/* ---------------- 加载文件 ---------------- */
async function loadFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  let loaded = 0;
  const added = [];

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      toast(`${file.name} 超过 300 MB，已跳过`, 3200);
      continue;
    }
    setBusy(true, `正在解析 ${file.name}…`);
    // 用 setTimeout 让出主线程：后台标签页里 requestAnimationFrame 不会触发，会一直卡住
    await new Promise((resolve) => setTimeout(resolve, 16));
    try {
      const buffer = await file.arrayBuffer();
      added.push(viewer.addModel(buffer, file.name, file.size));
      loaded += 1;
    } catch (error) {
      console.error(error);
      toast(`无法解析 ${file.name}，可能不是有效的 STL 文件`, 3600);
    } finally {
      setBusy(false);
    }
  }

  if (loaded > 0) {
    viewer.select(added[added.length - 1].id);
    viewer.fit();
    refresh();
    toast(`已加载 ${loaded} 个模型`, 1800);
  } else {
    refresh();
  }
}

async function loadDemo() {
  setBusy(true, '正在加载示例模型…');
  try {
    const response = await fetch('./demo.stl');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    const model = viewer.addModel(buffer, '示例：圆环（demo.stl）', buffer.byteLength);
    viewer.select(model.id);
    viewer.fit();
    refresh();
    toast('已加载示例模型', 1800);
  } catch (error) {
    console.error(error);
    toast('示例模型加载失败，请改用自己的 STL 文件', 3000);
  } finally {
    setBusy(false);
  }
}

/* ---------------- 工具动作 ---------------- */
function setToolActive(action, active) {
  const button = toolbar.querySelector(`[data-action="${action}"]`);
  if (!button) return;
  button.classList.toggle('is-active', active);
  if (button.hasAttribute('data-toggle')) button.setAttribute('aria-pressed', String(active));
}

const actions = {
  fit() {
    if (viewer.models.length === 0) {
      toast('请先打开一个 STL 文件');
      return;
    }
    if (viewer.visibleModels.length === 0) {
      toast('当前没有可见的模型');
      return;
    }
    viewer.fit();
  },
  rotate() {
    if (viewer.models.length === 0) {
      toast('请先打开一个 STL 文件');
      return;
    }
    const on = !viewer.controls.autoRotate;
    viewer.setAutoRotate(on);
    setToolActive('rotate', on);
  },
  wireframe() {
    const on = !viewer.wireframe;
    viewer.setWireframe(on);
    setToolActive('wireframe', on);
  },
  grid() {
    const on = !viewer.gridVisible;
    viewer.setGridVisible(on);
    setToolActive('grid', on);
  },
  async shot() {
    if (viewer.models.length === 0) {
      toast('请先打开一个 STL 文件');
      return;
    }
    const dataUrl = viewer.screenshot();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `stl-${stamp}.png`;

    let url = dataUrl;
    try {
      const blob = await (await fetch(dataUrl)).blob();
      url = URL.createObjectURL(blob);
    } catch {
      // 极老的浏览器不支持 fetch(data:)，直接用 dataURL
    }

    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('截图已保存', 1800);
  },
  async fullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch (error) {
      console.warn(error);
      toast('当前浏览器不支持全屏，可把本应用“添加到主屏幕”获得全屏体验', 3600);
    }
  },
  clear() {
    if (viewer.models.length === 0) return;
    viewer.clear();
    viewer.select(null);
    refresh();
    toast('已清空', 1500);
  },
};

toolbar.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const handler = actions[button.dataset.action];
  if (handler) handler();
});

$('#btn-open').addEventListener('click', () => fileInput.click());
$('#btn-open-empty').addEventListener('click', () => fileInput.click());
$('#btn-demo').addEventListener('click', loadDemo);

fileInput.addEventListener('change', () => {
  loadFiles(fileInput.files);
  fileInput.value = '';
});

modelList.addEventListener('click', (event) => {
  const row = event.target.closest('.model-row');
  if (!row) return;
  const id = Number(row.dataset.id);
  const model = viewer.getModel(id);
  if (!model) return;

  const role = event.target.closest('button[data-role]')?.dataset.role;
  if (role === 'toggle') {
    viewer.setModelVisible(id, !model.visible);
    refresh();
    return;
  }
  if (role === 'remove') {
    viewer.removeModel(id);
    closeColorPicker();
    closeRotatePanel();
    refresh();
    if (viewer.models.length > 0) viewer.fit();
    return;
  }
  if (role === 'color') {
    viewer.select(id);
    refresh();
    closeRotatePanel();
    openColorPicker(id);
    return;
  }
  if (role === 'rotate') {
    viewer.select(id);
    refresh();
    closeColorPicker();
    openRotatePanel(id);
    return;
  }

  viewer.select(viewer.selectedId === id ? null : id);
  closeColorPicker();
  closeRotatePanel();
  const target = viewer.selectedId ? id : null;
  if (target) viewer.fit([target]);
  refresh();
});

canvas.addEventListener('dblclick', () => {
  if (viewer.visibleModels.length > 0) viewer.fit();
});

/* ---------------- 拖放 ---------------- */
const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');
let dragDepth = 0;

window.addEventListener('dragenter', (event) => {
  if (!hasFiles(event)) return;
  dragDepth += 1;
  dropEl.hidden = false;
});

window.addEventListener('dragover', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});

window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropEl.hidden = true;
});

window.addEventListener('drop', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  dropEl.hidden = true;
  loadFiles(event.dataTransfer.files);
});

/* ---------------- 键盘快捷键 ---------------- */
window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const map = {
    r: 'fit',
    a: 'rotate',
    w: 'wireframe',
    g: 'grid',
    s: 'shot',
    f: 'fullscreen',
    Delete: 'clear',
  };
  const action = map[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  if (!action) return;
  event.preventDefault();
  actions[action]();
});

/* ---------------- 尺寸 / 可见性 ---------------- */
let resizeTimer = 0;
const handleResize = () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => viewer.resize(), 80);
};
window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', handleResize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', viewer.resize.bind(viewer));

document.addEventListener('visibilitychange', () => {
  viewer.setPaused(document.hidden);
});

/* ---------------- 安装 / 离线 ---------------- */
registerServiceWorker();

const installer = createInstaller();
installer.subscribe((instance) => {
  btnInstall.hidden = instance.isStandalone || (!instance.canPrompt && !instance.isIOS);
});

btnInstall.addEventListener('click', async () => {
  if (installer.canPrompt) {
    const outcome = await installer.install();
    if (outcome === 'accepted') toast('正在安装…', 2000);
    return;
  }
  if (installer.isIOS) {
    toast('在 Safari 点“分享”按钮 → “添加到主屏幕”即可安装', 6000);
    return;
  }
  toast('请在浏览器菜单中选择“安装应用”或“添加到主屏幕”', 5000);
});

refresh();