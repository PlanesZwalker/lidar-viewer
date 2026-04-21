// packages/core/src/PointCloudOctree.ts
import * as THREE from 'three';
import { OctreeGeometry } from './geometry/OctreeGeometry.js';
import { OctreeGeometryNode, NodeState } from './geometry/OctreeGeometryNode.js';
import { PointCloudMaterial } from './materials/PointCloudMaterial.js';
import { GaussianSplatMaterial } from './materials/GaussianSplatMaterial.js';
import { PointCloudOctreeNode } from './PointCloudOctreeNode.js';

export class PointCloudOctree extends THREE.Object3D {
  readonly geometry: OctreeGeometry;
  readonly material: PointCloudMaterial;
  readonly gaussianMaterial: GaussianSplatMaterial;
  private _splatMode = false;

  visibleNodes = new Map<string, PointCloudOctreeNode>();
  allNodes = new Map<string, OctreeGeometryNode>();

  constructor(geometry: OctreeGeometry) {
    super();
    this.geometry = geometry;
    this.material = new PointCloudMaterial();
    this.gaussianMaterial = new GaussianSplatMaterial();

    // Apply coordinate offset so the cloud is centered near the world origin
    this.position.copy(geometry.offset).negate();

    // Elevation range from real LAS header extents (not the padded COPC cube)
    const [eMin, eMax] = geometry.metadata.elevationRange ?? [geometry.boundingBox.min.y, geometry.boundingBox.max.y];
    this.material.uniforms['uElevationMin']!.value = eMin;
    this.material.uniforms['uElevationMax']!.value = eMax;
    this.gaussianMaterial.uniforms['uElevationMin']!.value = eMin;
    this.gaussianMaterial.uniforms['uElevationMax']!.value = eMax;

    this.indexNode(geometry.root);
  }

  private indexNode(node: OctreeGeometryNode): void {
    this.allNodes.set(node.name, node);
    for (const child of node.children) {
      if (child) this.indexNode(child);
    }
  }

  /** Show or hide individual octree nodes based on traversal results. */
  applyVisibility(visibleNames: Set<string>): void {
    const activeMat = this._splatMode ? this.gaussianMaterial : this.material;

    // Remove nodes that are no longer visible
    for (const [name, sceneNode] of this.visibleNodes) {
      if (!visibleNames.has(name)) {
        this.remove(sceneNode);
        sceneNode.dispose();
        this.visibleNodes.delete(name);
      }
    }

    // Add newly visible nodes
    for (const name of visibleNames) {
      if (this.visibleNodes.has(name)) continue;
      const geoNode = this.allNodes.get(name);
      if (!geoNode || geoNode.state !== NodeState.LOADED) continue;

      // In splat mode: pre-set the per-node spacing so disc size matches density.
      if (this._splatMode) {
        this.gaussianMaterial.setSpacing(geoNode.spacing);
      }

      const sceneNode = new PointCloudOctreeNode(geoNode, activeMat);
      this.visibleNodes.set(name, sceneNode);
      this.add(sceneNode);
    }
  }

  /** Switch between classic point rendering and Gaussian splat rendering. */
  setSplatMode(enabled: boolean): void {
    if (this._splatMode === enabled) return;
    this._splatMode = enabled;
    const activeMat = enabled ? this.gaussianMaterial : this.material;
    for (const node of this.visibleNodes.values()) {
      if (enabled) {
        this.gaussianMaterial.setSpacing(node.geometryNode.spacing);
      }
      node.setMaterial(activeMat);
    }
  }

  /** Returns the estimated world-space bounding box of the full cloud. */
  getWorldBoundingBox(): THREE.Box3 {
    return this.geometry.boundingBox.clone().translate(this.position);
  }

  dispose(): void {
    for (const node of this.visibleNodes.values()) {
      node.dispose();
    }
    this.visibleNodes.clear();
    this.material.dispose();
    this.gaussianMaterial.dispose();
  }
}
