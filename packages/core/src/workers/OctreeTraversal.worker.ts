// packages/core/src/workers/OctreeTraversal.worker.ts
// Runs octree frustum culling and LOD selection off the main thread.
// Communicated via postMessage to avoid blocking the render loop.

import type { OctreeTraversalRequest, OctreeTraversalResult, WorkerNodeDescriptor } from './OctreeTraversalWorkerHost.js';

// ─── Frustum culling helper (no Three.js — plain math for worker context) ────

function sphereInFrustum(
  frustumPlanes: Float32Array, // 6 × 4 floats: [nx, ny, nz, d] per plane
  cx: number, cy: number, cz: number,
  radius: number,
): boolean {
  for (let p = 0; p < 6; p++) {
    const base = p * 4;
    const nx = frustumPlanes[base + 0]!;
    const ny = frustumPlanes[base + 1]!;
    const nz = frustumPlanes[base + 2]!;
    const d  = frustumPlanes[base + 3]!;
    if (nx * cx + ny * cy + nz * cz + d < -radius) return false;
  }
  return true;
}

function computeSSE(
  cx: number, cy: number, cz: number,
  spacing: number,
  camX: number, camY: number, camZ: number,
  screenHeight: number,
  halfFovTan: number,
): number {
  const dx = cx - camX;
  const dy = cy - camY;
  const dz = cz - camZ;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist === 0) return Infinity;
  return (spacing / dist) * (screenHeight / (2 * halfFovTan));
}

// ─── Worker main ──────────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<OctreeTraversalRequest>): void => {
  const req = e.data;
  const {
    nodes,
    frustumPlanes,
    cameraPosition,
    screenHeight,
    halfFovTan,
    pointBudget,
    minNodeSize,
  } = req;

  const [camX, camY, camZ] = cameraPosition;
  const visibleNames: string[] = [];
  const loadNames: string[] = [];
  const unloadNames: string[] = [];

  let pointsAccumulated = 0;

  // BFS through the node descriptors (sorted by SSE descending = most important first)
  const queue: WorkerNodeDescriptor[] = [];

  // Add root
  const root = nodes.find((n) => n.name === 'r');
  if (root) queue.push(root);

  const byName = new Map(nodes.map((n) => [n.name, n]));

  while (queue.length > 0) {
    const node = queue.shift()!;

    const inFrustum = sphereInFrustum(
      frustumPlanes,
      node.sphereCenter[0]!, node.sphereCenter[1]!, node.sphereCenter[2]!,
      node.sphereRadius,
    );
    if (!inFrustum) {
      if (node.loaded) unloadNames.push(node.name);
      continue;
    }

    const sse = computeSSE(
      node.sphereCenter[0]!, node.sphereCenter[1]!, node.sphereCenter[2]!,
      node.spacing,
      camX!, camY!, camZ!,
      screenHeight,
      halfFovTan,
    );

    if (sse < minNodeSize) {
      // Node is small enough on screen — don't recurse
      if (!node.loaded) loadNames.push(node.name);
      else {
        visibleNames.push(node.name);
        pointsAccumulated += node.numPoints;
      }
      continue;
    }

    if (pointsAccumulated + node.numPoints > pointBudget) {
      // Budget exhausted
      if (node.loaded) unloadNames.push(node.name);
      continue;
    }

    if (!node.loaded) {
      loadNames.push(node.name);
    } else {
      visibleNames.push(node.name);
      pointsAccumulated += node.numPoints;
    }

    // Enqueue children
    for (const childName of node.childNames) {
      const child = byName.get(childName);
      if (child) queue.push(child);
    }
  }

  const result: OctreeTraversalResult = { visibleNames, loadNames, unloadNames };
  self.postMessage(result);
};
