// packages/core/src/workers/OctreeTraversalWorkerHost.ts
// Main-thread host for OctreeTraversal.worker — manages the worker lifecycle
// and exposes a typed async API.

import * as THREE from 'three';
import type { OctreeGeometryNode } from '../geometry/OctreeGeometryNode.js';

// ─── Message types shared between host and worker ────────────────────────────

export interface WorkerNodeDescriptor {
  name: string;
  sphereCenter: [number, number, number];
  sphereRadius: number;
  spacing: number;
  numPoints: number;
  loaded: boolean;
  childNames: string[];
}

export interface OctreeTraversalRequest {
  nodes: WorkerNodeDescriptor[];
  frustumPlanes: Float32Array; // 6 × 4 floats
  cameraPosition: [number, number, number];
  screenHeight: number;
  halfFovTan: number;
  pointBudget: number;
  minNodeSize: number;
}

export interface OctreeTraversalResult {
  visibleNames: string[];
  loadNames: string[];
  unloadNames: string[];
}

// ─── Host ─────────────────────────────────────────────────────────────────────

export class OctreeTraversalWorkerHost {
  private readonly worker: Worker;
  private pending: ((result: OctreeTraversalResult) => void) | null = null;

  constructor() {
    this.worker = new Worker(new URL('./OctreeTraversal.worker.js', import.meta.url), {
      type: 'module',
    });

    this.worker.onmessage = (e: MessageEvent<OctreeTraversalResult>): void => {
      if (this.pending) {
        this.pending(e.data);
        this.pending = null;
      }
    };
  }

  /**
   * Traverse the octree off the main thread.
   * Skips posting a new message if the previous one hasn't resolved yet
   * (prevents backpressure from fast camera movements).
   */
  traverse(
    nodes: Map<string, OctreeGeometryNode>,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    pointBudget: number,
    minNodeSize: number,
    /** World-space offset applied to all node bounding boxes (PointCloudOctree.position). */
    nodeOffset?: THREE.Vector3,
  ): Promise<OctreeTraversalResult> {
    return new Promise((resolve) => {
      if (this.pending) {
        // Previous frame not yet resolved — resolve immediately with empty result
        // so the render loop keeps running without stall
        resolve({ visibleNames: [], loadNames: [], unloadNames: [] });
        return;
      }

      this.pending = resolve;

      const frustum = new THREE.Frustum();
      const projScreenMatrix = new THREE.Matrix4()
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projScreenMatrix);

      const planes = new Float32Array(24); // 6 planes × 4 floats
      frustum.planes.forEach((plane, i) => {
        planes[i * 4 + 0] = plane.normal.x;
        planes[i * 4 + 1] = plane.normal.y;
        planes[i * 4 + 2] = plane.normal.z;
        planes[i * 4 + 3] = plane.constant;
      });

      const ox = nodeOffset?.x ?? 0;
      const oy = nodeOffset?.y ?? 0;
      const oz = nodeOffset?.z ?? 0;

      const fov = camera.fov * (Math.PI / 180);
      const descriptors: WorkerNodeDescriptor[] = [];

      for (const [name, node] of nodes) {
        const sphere = new THREE.Sphere();
        node.boundingBox.getBoundingSphere(sphere);
        descriptors.push({
          name,
          // Apply world offset so sphere centers are in world space for frustum culling
          sphereCenter: [sphere.center.x + ox, sphere.center.y + oy, sphere.center.z + oz],
          sphereRadius: sphere.radius,
          spacing: node.spacing,
          numPoints: node.numPoints,
          loaded: node.loaded,
          childNames: node.children
            .filter((c): c is OctreeGeometryNode => c !== null)
            .map((c) => c.name),
        });
      }

      const req: OctreeTraversalRequest = {
        nodes: descriptors,
        frustumPlanes: planes,
        cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
        screenHeight: renderer.domElement.clientHeight,
        halfFovTan: Math.tan(fov / 2),
        pointBudget,
        minNodeSize,
      };

      this.worker.postMessage(req, [planes.buffer]);
    });
  }

  dispose(): void {
    this.worker.terminate();
  }
}
