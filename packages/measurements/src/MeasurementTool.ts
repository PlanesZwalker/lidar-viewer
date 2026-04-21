// packages/measurements/src/MeasurementTool.ts
// Three.js scene tool — handles raycasting, marker placement, and line drawing.
// Ported and TypeScript-ified from Potree 1.8 src/utils/MeasuringTool.js + Measure.js

import * as THREE from 'three';
import { MeasurementStore } from './MeasurementStore.js';
import type { MeasurementType, MeasurementPoint } from './types.js';

export interface MeasurementToolOptions {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  domElement: HTMLElement;
  /** Objects to raycast against (loaded point cloud meshes). */
  targets: THREE.Object3D[];
}

export class MeasurementTool {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly scene: THREE.Scene;
  private readonly domElement: HTMLElement;
  private readonly targets: THREE.Object3D[];
  private readonly raycaster = new THREE.Raycaster();
  private readonly store: MeasurementStore;

  private active = false;
  private activeMeasurementId: string | null = null;
  private activeMeasurementType: MeasurementType | null = null;

  // Scene objects
  private readonly markerGroup = new THREE.Group();
  private readonly lineGroup = new THREE.Group();

  private readonly markers = new Map<string, THREE.Mesh[]>();
  private readonly lines = new Map<string, THREE.Line>();

  constructor(store: MeasurementStore, options: MeasurementToolOptions) {
    this.store = store;
    this.camera = options.camera;
    this.scene = options.scene;
    this.domElement = options.domElement;
    this.targets = options.targets;

    this.scene.add(this.markerGroup);
    this.scene.add(this.lineGroup);

    this.domElement.addEventListener('click', this.onClick);
  }

  /** Start a new measurement of the given type. */
  startMeasurement(type: MeasurementType): string {
    this.activeMeasurementType = type;
    this.activeMeasurementId = this.store.add(type);
    this.active = true;
    this.domElement.style.cursor = 'crosshair';
    return this.activeMeasurementId;
  }

  /** Finish the current measurement (e.g. double-click or explicit call). */
  finishMeasurement(): void {
    this.active = false;
    this.activeMeasurementId = null;
    this.activeMeasurementType = null;
    this.domElement.style.cursor = '';
  }

  /** Remove all Three.js objects for a measurement. */
  removeMeasurement(id: string): void {
    const existingMarkers = this.markers.get(id);
    if (existingMarkers) {
      for (const m of existingMarkers) {
        this.markerGroup.remove(m);
        m.geometry.dispose();
      }
      this.markers.delete(id);
    }
    const line = this.lines.get(id);
    if (line) {
      this.lineGroup.remove(line);
      line.geometry.dispose();
      this.lines.delete(id);
    }
    this.store.remove(id);
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (!this.active || !this.activeMeasurementId) return;

    const point = this.getWorldPoint(event);
    if (!point) return;

    const mp: MeasurementPoint = { x: point.x, y: point.y, z: point.z };
    this.store.addPoint(this.activeMeasurementId, mp);
    this.addMarker(this.activeMeasurementId, point, this.store.getById(this.activeMeasurementId)?.color ?? '#ffffff');
    this.updateLine(this.activeMeasurementId);

    // Auto-finish single-gesture measurements after 2 points
    const m = this.store.getById(this.activeMeasurementId);
    if (m?.type === 'distance' && m.points.length >= 2) {
      this.finishMeasurement();
    }
    if (m?.type === 'height' && m.points.length >= 2) {
      this.finishMeasurement();
    }
    if (m?.type === 'volume' && m.points.length >= 2) {
      this.finishMeasurement();
    }
  };

  private getWorldPoint(event: MouseEvent): THREE.Vector3 | null {
    const rect = this.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );

    // Threshold: 4 screen pixels — tight enough to avoid stray hits on trees/roofs.
    const camDist = this.camera.position.length();
    const halfFovTan = Math.tan((this.camera.fov * Math.PI) / 360);
    const pixelSize = (2 * halfFovTan * camDist) / this.domElement.clientHeight;
    this.raycaster.params.Points = { threshold: Math.max(0.5, pixelSize * 4) };

    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.targets, true);
    if (hits.length === 0) return null;

    // Among all hits, prefer the lowest-altitude point (ground over tree canopy / rooftop).
    // Y is altitude in this viewer's coordinate system (Three.js Y-up).
    const groundHit = hits.reduce((best, h) => (h.point.y < best.point.y ? h : best));
    const raw = groundHit.point.clone();

    // For area: lock altitude to the first point so all vertices stay on the same horizontal plane.
    if (this.activeMeasurementId) {
      const m = this.store.getById(this.activeMeasurementId);
      if (m && m.type === 'area' && m.points.length > 0) {
        raw.y = m.points[0]!.y;
      }
    }

    return raw;
  }

  private addMarker(measurementId: string, position: THREE.Vector3, color: string): void {
    // Scale marker size to be visible regardless of scene scale (~8 screen pixels)
    const dist = position.distanceTo(this.camera.position);
    const halfFovTan = Math.tan((this.camera.fov * Math.PI) / 360);
    const pixelSize = (2 * halfFovTan * dist) / this.domElement.clientHeight;
    const radius = Math.max(0.01, pixelSize * 8);

    const geo = new THREE.SphereGeometry(radius, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color });
    const sphere = new THREE.Mesh(geo, mat);
    sphere.position.copy(position);
    this.markerGroup.add(sphere);

    if (!this.markers.has(measurementId)) this.markers.set(measurementId, []);
    this.markers.get(measurementId)!.push(sphere);
  }

  private updateLine(measurementId: string): void {
    const m = this.store.getById(measurementId);
    if (!m || m.points.length < 2) return;

    // Remove old line
    const oldLine = this.lines.get(measurementId);
    if (oldLine) {
      this.lineGroup.remove(oldLine);
      oldLine.geometry.dispose();
    }

    const pts = m.points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    // Close polygon for area/volume
    if (m.type === 'area' || m.type === 'volume') pts.push(pts[0]!);

    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: m.color, linewidth: 2 });
    const line = new THREE.Line(geo, mat);
    this.lineGroup.add(line);
    this.lines.set(measurementId, line);
  }

  dispose(): void {
    this.domElement.removeEventListener('click', this.onClick);
    this.scene.remove(this.markerGroup);
    this.scene.remove(this.lineGroup);
  }
}
