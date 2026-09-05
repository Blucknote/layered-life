/**
 * Отображение на Three.js: камера, InstancedMesh по одному на слой,
 * сетки этажей, контур целевой клетки, OrbitControls.
 * Координаты модели (x, y, z) отображаются в сцену так:
 *   sceneX = x - (width-1)/2,  sceneY = z * layerGap,  sceneZ = y - (height-1)/2.
 * Раздвижение этажей (layerGap) — только визуальное, на правила не влияет.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { type World, type WorldSize } from '../core/world';

export const LAYER_COLORS = [0x6fa8dc, 0x82c9a0, 0xd9b36c];

export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export interface CellHit {
  x: number;
  y: number;
}

export class LifeRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly size: WorldSize;
  private readonly canvas: HTMLCanvasElement;
  private readonly groups: THREE.Group[] = [];
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly hoverOutline: THREE.LineSegments;
  private readonly activeBorder: THREE.LineLoop;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hitPoint = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private gap: number;

  constructor(canvas: HTMLCanvasElement, size: WorldSize, initialGap: number) {
    this.canvas = canvas;
    this.size = size;
    this.gap = initialGap;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      // Позволяет читать пиксели канваса (самодиагностика и скриншоты сцены).
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene.background = new THREE.Color(0x0d1117);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const light = new THREE.DirectionalLight(0xffffff, 0.9);
    light.position.set(20, 40, 25);
    this.scene.add(light);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);

    const stackHeight = (size.depth - 1) * initialGap;
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.target.set(0, stackHeight / 2, 0);

    this.camera.position.set(size.width * 1.05, stackHeight + size.width * 0.85, size.height * 1.25);
    this.camera.lookAt(0, stackHeight / 2, 0);

    const boxGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);

    for (let z = 0; z < size.depth; z++) {
      const group = new THREE.Group();
      group.position.set(0, z * initialGap, 0);
      this.groups.push(group);
      this.scene.add(group);

      const grid = new THREE.GridHelper(size.width, size.width, 0x3b4a55, 0x25303a);
      group.add(grid);

      const material = new THREE.MeshLambertMaterial({ color: LAYER_COLORS[z] });
      const mesh = new THREE.InstancedMesh(boxGeometry, material, size.width * size.height);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      this.meshes.push(mesh);
      group.add(mesh);
    }

    const outlineEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.86, 0.86, 0.86));
    this.hoverOutline = new THREE.LineSegments(
      outlineEdges,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
    );
    this.hoverOutline.visible = false;
    this.scene.add(this.hoverOutline);

    const border = new Float32Array([
      -size.width / 2, 0.02, -size.height / 2,
      size.width / 2, 0.02, -size.height / 2,
      size.width / 2, 0.02, size.height / 2,
      -size.width / 2, 0.02, size.height / 2,
    ]);
    const borderGeometry = new THREE.BufferGeometry();
    borderGeometry.setAttribute('position', new THREE.BufferAttribute(border, 3));
    this.activeBorder = new THREE.LineLoop(
      borderGeometry,
      new THREE.LineBasicMaterial({ color: 0xdfe9f0 }),
    );
    this.groups[1].add(this.activeBorder);

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const resize = () => this.resize();
    window.addEventListener('resize', resize);
    resize();
  }

  private resize(): void {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Обновить матрицы кубиков по состоянию мира. */
  update(world: World): void {
    const { width, height } = this.size;
    const cx = (width - 1) / 2;
    const cz = (height - 1) / 2;
    for (let z = 0; z < this.size.depth; z++) {
      const mesh = this.meshes[z];
      let n = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (world.cells[x + width * (y + height * z)] === 1) {
            this.matrix.makeTranslation(x - cx, 0, y - cz);
            mesh.setMatrixAt(n, this.matrix);
            n++;
          }
        }
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  setLayerVisible(z: number, visible: boolean): void {
    this.groups[z].visible = visible;
  }

  setGap(gap: number): void {
    this.gap = gap;
    for (let z = 0; z < this.size.depth; z++) {
      this.groups[z].position.y = z * gap;
    }
  }

  setActiveLayer(z: number): void {
    this.groups[z].add(this.activeBorder);
  }

  setEditRotationEnabled(enabled: boolean): void {
    // В режимах добавления/удаления вращение левым перетаскиванием отключено;
    // зум (колесо) и панорамирование правой кнопкой остаются.
    this.controls.enableRotate = enabled;
  }

  setHover(cell: CellHit | null, layerZ: number): void {
    if (!cell) {
      this.hoverOutline.visible = false;
      return;
    }
    const cx = (this.size.width - 1) / 2;
    const cz = (this.size.height - 1) / 2;
    this.hoverOutline.position.set(cell.x - cx, layerZ * this.gap, cell.y - cz);
    this.hoverOutline.visible = true;
  }

  /** Пересечение луча камеры с плоскостью активного слоя; null вне поля. */
  pick(clientX: number, clientY: number, layerZ: number): CellHit | null {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    this.plane.constant = -layerZ * this.gap;
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hitPoint)) return null;
    const x = Math.floor(this.hitPoint.x + this.size.width / 2);
    const y = Math.floor(this.hitPoint.z + this.size.height / 2);
    if (x < 0 || x >= this.size.width || y < 0 || y >= this.size.height) return null;
    return { x, y };
  }

  resetView(): void {
    const stackHeight = (this.size.depth - 1) * this.gap;
    this.camera.position.set(
      this.size.width * 1.05,
      stackHeight + this.size.width * 0.85,
      this.size.height * 1.25,
    );
    this.controls.target.set(0, stackHeight / 2, 0);
    this.controls.update();
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
