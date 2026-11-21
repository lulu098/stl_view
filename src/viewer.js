import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

const MODEL_COLORS = [
  '#3b82f6', '#ec4899', '#f59e0b', '#22c55e',
  '#8b5cf6', '#f97316', '#06b6d4', '#ef4444',
];

const loader = new STLLoader();

/** 有些 STL 文件的面法线全为 0，此时按顶点重新计算 */
function hasUsableNormals(geometry) {
  const attr = geometry.getAttribute('normal');
  if (!attr || attr.count === 0) return false;
  const a = attr.array;
  for (let i = 0; i < a.length; i += 3) {
    if (a[i] * a[i] + a[i + 1] * a[i + 1] + a[i + 2] * a[i + 2] > 1e-12) return true;
  }
  return false;
}

/** 有向体积（单位同 STL，通常是 mm³） */
function computeVolume(geometry) {
  const pos = geometry.getAttribute('position');
  let volume = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    volume += a.dot(b.cross(c)) / 6;
  }
  return Math.abs(volume);
}

export class StlViewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.models = [];
    this.nextId = 1;
    this.selectedId = null;
    this.wireframe = false;
    this.gridVisible = false;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0b1017');

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    this.camera.position.set(70, 60, 90);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.rotateSpeed = 0.85;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.8;
    this.controls.screenSpacePanning = true;
    this.controls.autoRotateSpeed = 1.6;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    this._setupLights();
    this._grid = null;
    this._platform = null;
    this._updatePlatform();
    this._resize();

    this._frame = this._frame.bind(this);
    this.renderer.setAnimationLoop(this._frame);
  }

  _setupLights() {
    this.scene.add(new THREE.HemisphereLight('#dbeafe', '#0f172a', 0.85));

    const key = new THREE.DirectionalLight('#ffffff', 1.9);
    key.position.set(1, 1.6, 1.1);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    const sc = key.shadow.camera;
    sc.near = 0.5;
    sc.far = 500;
    sc.left = -100;
    sc.right = 100;
    sc.top = 100;
    sc.bottom = -100;
    this._keyLight = key;
    this.scene.add(key);
    this.scene.add(key.target);

    const fill = new THREE.DirectionalLight('#93c5fd', 0.65);
    fill.position.set(-1.2, 0.5, -0.8);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight('#fbcfe8', 0.45);
    rim.position.set(-0.6, -1, 1);
    this.scene.add(rim);
  }

  _frame() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  setPaused(paused) {
    this.renderer.setAnimationLoop(paused ? null : this._frame);
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || window.innerWidth));
    const height = Math.max(1, Math.round(rect.height || window.innerHeight));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    this._resize();
  }

  addModel(buffer, name, fileSize = 0) {
    const geometry = loader.parse(buffer);
    const position = geometry.getAttribute('position');
    if (!position || position.count === 0) {
      geometry.dispose();
      throw new Error('文件中没有三角面数据');
    }
    if (!hasUsableNormals(geometry)) geometry.computeVertexNormals();
    geometry.computeBoundingBox();

    this._orientToStandUp(geometry);
    geometry.computeBoundingBox();

    const size = new THREE.Vector3();
    geometry.boundingBox.getSize(size);

    const color = MODEL_COLORS[this.models.length % MODEL_COLORS.length];
    const material = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.12,
      roughness: 0.55,
      side: THREE.DoubleSide,
      wireframe: this.wireframe,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    this.scene.add(mesh);

    const model = {
      id: this.nextId++,
      name,
      mesh,
      color,
      visible: true,
      stats: {
        triangles: Math.floor(position.count / 3),
        size: { x: size.x, y: size.y, z: size.z },
        volume: computeVolume(geometry),
        fileSize,
      },
    };
    this.models.push(model);
    this._relayout();
    return model;
  }

  get visibleModels() {
    return this.models.filter((m) => m.visible);
  }

  getModel(id) {
    return this.models.find((m) => m.id === id) || null;
  }

  removeModel(id) {
    const index = this.models.findIndex((m) => m.id === id);
    if (index === -1) return;
    const [model] = this.models.splice(index, 1);
    this.scene.remove(model.mesh);
    model.mesh.geometry.dispose();
    model.mesh.material.dispose();
    if (this.selectedId === id) this.select(null);
    if (this.models.length > 0) this._relayout();
  }

  clear() {
    for (const model of [...this.models]) this.removeModel(model.id);
    this._clearGrid();
    this._updatePlatform();
  }

  /** 将几何体的 Z 轴旋转为 Y 轴朝上（3D 打印 STL 的惯例：Z 轴竖直向上） */
  _orientToStandUp(geometry) {
    geometry.rotateX(-Math.PI / 2);
  }

  /** 把模型落地并按网格排开，底部对齐到平台面 y=0 */
  _relayout() {
    this._updatePlatform();
    if (this.models.length === 0) return;

    const items = this.models.map((model) => {
      const box = model.mesh.geometry.boundingBox;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      return { model, box, size, center };
    });

    const maxSide = Math.max(...items.map((it) => Math.max(it.size.x, it.size.y, it.size.z)));
    const gap = Math.max(maxSide * 0.5, 0.2);
    const cols = Math.ceil(Math.sqrt(items.length));

    let rowX = 0;
    let rowZ = 0;
    let rowDepth = 0;
    items.forEach((it, index) => {
      if (index > 0 && index % cols === 0) {
        rowX = 0;
        rowZ += rowDepth + gap;
        rowDepth = 0;
      }
      it.model.mesh.position.set(
        rowX + it.size.x / 2 - it.center.x,
        -it.box.min.y,
        rowZ + it.size.z / 2 - it.center.z,
      );
      rowX += it.size.x + gap;
      rowDepth = Math.max(rowDepth, it.size.z);
    });

    const box = this.boundingBox(true);
    if (box) {
      const center = box.getCenter(new THREE.Vector3());
      for (const it of items) {
        it.model.mesh.position.x -= center.x;
        it.model.mesh.position.z -= center.z;
        it.model.mesh.position.y -= box.min.y;
      }
      this._updatePlatform(center);
    }
  }

  _clearPlatform() {
    if (!this._platform) return;
    this.scene.remove(this._platform);
    this._platform.geometry.dispose();
    const mats = Array.isArray(this._platform.material)
      ? this._platform.material
      : [this._platform.material];
    for (const mat of mats) {
      mat.map?.dispose();
      mat.dispose();
    }
    this._platform = null;
  }

  _makePlatformTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, '#3b82f6');
    grad.addColorStop(1, '#1d4ed8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cell = canvas.width / 16;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    for (let i = 1; i < 16; i++) {
      const p = i * cell;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, canvas.height);
      ctx.moveTo(0, p);
      ctx.lineTo(canvas.width, p);
      ctx.stroke();
    }
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    for (let i = 4; i < 16; i += 4) {
      const p = i * cell;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, canvas.height);
      ctx.moveTo(0, p);
      ctx.lineTo(canvas.width, p);
      ctx.stroke();
    }
    ctx.lineWidth = 16;
    ctx.strokeStyle = '#dbeafe';
    ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return texture;
  }

  _updatePlatform(center) {
    let side;
    let c = center;
    if (this.models.length === 0) {
      side = 200;
      c = c || new THREE.Vector3(0, 0, 0);
    } else {
      const box = this.boundingBox(true);
      if (box) {
        const size = box.getSize(new THREE.Vector3());
        c = c || box.getCenter(new THREE.Vector3());
        const maxSide = Math.max(size.x, size.z);
        side = maxSide * 1.2 + maxSide;
      } else {
        side = 200;
        c = new THREE.Vector3(0, 0, 0);
      }
    }

    const thickness = Math.max(side * 0.025, 0.3);

    if (!this._platform) {
      const topMap = this._makePlatformTexture();
      const topMat = new THREE.MeshStandardMaterial({
        map: topMap,
        emissiveMap: topMap,
        emissive: new THREE.Color('#ffffff'),
        emissiveIntensity: 0.45,
        roughness: 0.85,
        metalness: 0,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      });
      const sideMat = new THREE.MeshStandardMaterial({
        color: '#2563eb',
        emissive: new THREE.Color('#2563eb'),
        emissiveIntensity: 0.3,
        roughness: 0.7,
        metalness: 0,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      });
      const bottomMat = new THREE.MeshBasicMaterial({
        color: '#1e3a8a',
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
      });

      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mesh = new THREE.Mesh(geo, [sideMat, sideMat, topMat, bottomMat, sideMat, sideMat]);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.renderOrder = -1;
      this._platform = mesh;
      this.scene.add(this._platform);
    }

    this._platform.scale.set(side, thickness, side);
    this._platform.position.set(c.x, -thickness / 2, c.z);
  }

  setWireframe(on) {
    this.wireframe = on;
    for (const model of this.models) model.mesh.material.wireframe = on;
  }

  setModelColor(id, color) {
    const model = this.getModel(id);
    if (!model) return;
    model.color = color;
    const base = new THREE.Color(color);
    const material = model.mesh.material;
    if (this.selectedId === id) {
      material.color.copy(base).multiplyScalar(1.08);
      material.emissive.copy(base).multiplyScalar(0.3);
    } else {
      material.color.copy(base);
      material.emissive.set('#000000');
    }
  }

  /**
   * 绕指定轴旋转模型（单位：度），旋转后自动重新落地并适配视角
   * @param {string} id 模型 id
   * @param {'x'|'y'|'z'} axis 旋转轴
   * @param {number} degrees 角度，正为逆时针
   */
  rotateModel(id, axis, degrees) {
    const model = this.getModel(id);
    if (!model) return;
    const geo = model.mesh.geometry;
    geo.center();
    const rad = THREE.MathUtils.degToRad(degrees);
    if (axis === 'x') geo.rotateX(rad);
    else if (axis === 'y') geo.rotateY(rad);
    else if (axis === 'z') geo.rotateZ(rad);
    geo.computeBoundingBox();
    this._relayout();
    if (typeof this.fit === 'function') this.fit();
  }

  setModelVisible(id, visible) {
    const model = this.getModel(id);
    if (!model) return;
    model.visible = visible;
    model.mesh.visible = visible;
    if (!visible && this.selectedId === id) this.select(null);
  }

  select(id) {
    this.selectedId = id;
    for (const model of this.models) {
      const base = new THREE.Color(model.color);
      const material = model.mesh.material;
      if (model.id === id) {
        material.color.copy(base).multiplyScalar(1.08);
        material.emissive.copy(base).multiplyScalar(0.3);
      } else {
        material.color.copy(base);
        material.emissive.set('#000000');
      }
    }
  }

  /** @returns {THREE.Box3|null} 可见模型的包围盒 */
  boundingBox(all = false) {
    const box = new THREE.Box3();
    for (const model of all ? this.models : this.visibleModels) box.expandByObject(model.mesh);
    return box.isEmpty() ? null : box;
  }

  /** @returns {{size: THREE.Vector3, center: THREE.Vector3}|null} */
  bounds(all = false) {
    const box = this.boundingBox(all);
    if (!box) return null;
    return { size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()) };
  }

  fit(targetIds = null) {
    const list = targetIds
      ? this.models.filter((m) => targetIds.includes(m.id) && m.visible)
      : this.visibleModels;
    if (list.length === 0) return;

    const box = new THREE.Box3();
    for (const model of list) box.expandByObject(model.mesh);
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 1e-6);

    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const distance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.08;

    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    if (dir.lengthSq() < 1e-9) dir.set(1, 0.85, 1.2);
    dir.normalize();

    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, distance);
    this.camera.near = Math.max(distance / 5000, 1e-4);
    this.camera.far = distance * 200;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = radius * 0.05;
    this.controls.maxDistance = distance * 20;
    this.controls.update();

    this._updateShadowCamera(box);
    this._updateGrid(box, radius);
  }

  _updateShadowCamera(box) {
    const key = this._keyLight;
    if (!key) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z) * 1.6;
    const half = Math.max(span * 0.5, 1);
    const sc = key.shadow.camera;
    sc.left = -half;
    sc.right = half;
    sc.top = half;
    sc.bottom = -half;
    sc.near = 0.5;
    sc.far = Math.max(half * 8, 200);
    key.position.set(center.x + 1, center.y + 1.6, center.z + 1.1);
    key.target.position.copy(center);
    key.target.updateMatrixWorld();
    sc.updateProjectionMatrix();
  }

  _clearGrid() {
    if (!this._grid) return;
    this.scene.remove(this._grid);
    this._grid.geometry.dispose();
    this._grid.material.dispose();
    this._grid = null;
  }

  _updateGrid(box, radius) {
    this._clearGrid();
    const center = box.getCenter(new THREE.Vector3());
    const grid = new THREE.GridHelper(radius * 4, 20, '#38bdf8', '#1e293b');
    grid.position.set(center.x, box.min.y, center.z);
    for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) {
      material.transparent = true;
      material.opacity = 0.4;
    }
    grid.visible = this.gridVisible;
    this._grid = grid;
    this.scene.add(grid);
  }

  setGridVisible(on) {
    this.gridVisible = on;
    if (on && !this._grid) {
      const box = new THREE.Box3();
      for (const model of this.visibleModels) box.expandByObject(model.mesh);
      if (!box.isEmpty()) {
        this._updateGrid(box, Math.max(box.getSize(new THREE.Vector3()).length() * 0.5, 1));
      }
    }
    if (this._grid) this._grid.visible = on;
  }

  setAutoRotate(on) {
    this.controls.autoRotate = on;
  }

  screenshot() {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/png');
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.clear();
    this._clearPlatform();
    this.controls.dispose();
    this.renderer.dispose();
  }
}