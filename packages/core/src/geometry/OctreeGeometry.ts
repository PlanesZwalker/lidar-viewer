// packages/core/src/geometry/OctreeGeometry.ts
import * as THREE from 'three';
import { OctreeGeometryNode } from './OctreeGeometryNode.js';
import type { BoundingBox, PointAttribute, PointCloudMetadata } from './types.js';

export class OctreeGeometry {
  readonly root: OctreeGeometryNode;
  readonly boundingBox: THREE.Box3;
  readonly offset: THREE.Vector3;
  readonly scale: THREE.Vector3;
  readonly spacing: number;
  readonly attributes: PointAttribute[];
  readonly metadata: PointCloudMetadata;
  readonly baseUrl: string;

  constructor(metadata: PointCloudMetadata, baseUrl: string) {
    this.metadata = metadata;
    this.baseUrl = baseUrl;
    this.attributes = metadata.attributes;
    this.spacing = metadata.spacing;

    this.offset = new THREE.Vector3(...metadata.offset);
    this.scale = new THREE.Vector3(...metadata.scale);

    const bb = metadata.boundingBox;
    this.boundingBox = new THREE.Box3(
      new THREE.Vector3(...bb.min),
      new THREE.Vector3(...bb.max),
    );

    const rootNodeData = {
      name: 'r',
      numPoints: metadata.points,
      children: new Array(8).fill(null),
      spacing: metadata.spacing,
    };

    this.root = new OctreeGeometryNode('r', bb, rootNodeData, this.attributes);
  }

  /**
   * Returns the bounding sphere for a given node — used by frustum culling.
   */
  getNodeBoundingSphere(node: OctreeGeometryNode): THREE.Sphere {
    const sphere = new THREE.Sphere();
    node.boundingBox.getBoundingSphere(sphere);
    return sphere;
  }

  /**
   * Compute child bounding box for octree subdivision.
   */
  static childBoundingBox(parent: BoundingBox, childIndex: number): BoundingBox {
    const [minX, minY, minZ] = parent.min;
    const [maxX, maxY, maxZ] = parent.max;

    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const midZ = (minZ + maxZ) / 2;

    const x = childIndex & 1;
    const y = (childIndex >> 1) & 1;
    const z = (childIndex >> 2) & 1;

    return {
      min: [x ? midX : minX, y ? midY : minY, z ? midZ : minZ],
      max: [x ? maxX : midX, y ? maxY : midY, z ? maxZ : midZ],
    };
  }
}
