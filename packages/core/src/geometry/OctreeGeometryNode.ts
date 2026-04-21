// packages/core/src/geometry/OctreeGeometryNode.ts
import * as THREE from 'three';
import type { BoundingBox, NodeData, PointAttribute } from './types.js';

export enum NodeState {
  UNLOADED = 0,
  LOADING = 1,
  LOADED = 2,
  FAILED = 3,
}

export class OctreeGeometryNode {
  readonly name: string;
  readonly boundingBox: THREE.Box3;
  readonly level: number;
  readonly numPoints: number;
  readonly spacing: number;
  readonly byteOffset: number;
  readonly byteSize: number;

  state: NodeState = NodeState.UNLOADED;
  geometry: THREE.BufferGeometry | null = null;
  loaded = false;
  failed = false;

  readonly children: (OctreeGeometryNode | null)[] = new Array(8).fill(null);
  parent: OctreeGeometryNode | null = null;

  // WebGL2: vertex buffer object handle (set by renderer)
  vbo: WebGLBuffer | null = null;

  constructor(
    name: string,
    boundingBox: BoundingBox,
    data: NodeData,
    public readonly attributes: PointAttribute[],
  ) {
    this.name = name;
    this.level = name.length - 1;
    this.numPoints = data.numPoints;
    this.spacing = data.spacing;
    this.byteOffset = data.byteOffset ?? 0;
    this.byteSize = data.byteSize ?? 0;

    const [minX, minY, minZ] = boundingBox.min;
    const [maxX, maxY, maxZ] = boundingBox.max;
    this.boundingBox = new THREE.Box3(
      new THREE.Vector3(minX, minY, minZ),
      new THREE.Vector3(maxX, maxY, maxZ),
    );
  }

  get isLeaf(): boolean {
    return this.children.every((c) => c === null);
  }

  computeScreenSpaceError(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer): number {
    const fov = camera.fov * (Math.PI / 180);
    const screenHeight = renderer.domElement.clientHeight;

    const center = this.boundingBox.getCenter(new THREE.Vector3());
    const distance = camera.position.distanceTo(center);

    if (distance === 0) return Infinity;

    return (this.spacing / distance) * (screenHeight / (2 * Math.tan(fov / 2)));
  }
}
