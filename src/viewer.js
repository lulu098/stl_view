import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

const MODEL_COLORS = [
  '#7dd3fc', '#f9a8d4', '#fde68a', '#86efac',
  '#c4b5fd', '#fdba74', '#5eead4', '#fca5a5',
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
    this._resize();

    this._frame = this._frame.bind(this);
    this.renderer.setAnimationLoop(this._frame);
  }

  _setupLights() {
    this.scene.add(new THREE.HemisphereLight('#dbeafe', '#0f172a', 0.85));

    const key = new THREE.DirectionalLight('#ffffff', 1.9);
    key.position.set(1, 1.6, 1.1);
    this.scene.add(key);

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
  }

  clear() {
    for (const model of [...this.models]) this.removeModel(model.id);
    this._clearGrid();
  }

  setWireframe(on) {
    this.wireframe = on;
    for (const model of this.models) model.mesh.material.wireframe = on;
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

    this._updateGrid(box, radius);
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
    this.controls.dispose();
    this.renderer.dispose();
  }
}
