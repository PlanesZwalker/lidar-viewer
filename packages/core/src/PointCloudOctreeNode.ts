// packages/core/src/PointCloudOctreeNode.ts
import * as THREE from 'three';
import { OctreeGeometryNode } from './geometry/OctreeGeometryNode.js';

export class PointCloudOctreeNode extends THREE.Object3D {
  readonly geometryNode: OctreeGeometryNode;
  private readonly points: THREE.Points;

  constructor(geometryNode: OctreeGeometryNode, material: THREE.RawShaderMaterial) {
    super();
    this.geometryNode = geometryNode;
    this.points = new THREE.Points(geometryNode.geometry ?? new THREE.BufferGeometry(), material);
    this.add(this.points);
  }

  updateGeometry(material: THREE.RawShaderMaterial): void {
    this.points.geometry = this.geometryNode.geometry ?? new THREE.BufferGeometry();
    this.points.material = material;
  }

  /** Switch to a different material without recreating the node. */
  setMaterial(material: THREE.RawShaderMaterial): void {
    this.points.material = material;
  }

  dispose(): void {
    this.points.geometry.dispose();
  }
}
