// packages/core/src/renderer/BatchedDrawCall.ts
// Batches multiple octree node draw calls into instanced draws using WebGL2
// drawArraysInstanced, collapsing N gl.drawArrays calls (one per node) into
// a much smaller number of batched calls.

import * as THREE from 'three';

export interface DrawBatch {
  /** Combined position VBO for all nodes in this batch. */
  positionBuffer: WebGLBuffer;
  /** Per-instance offsets: [offsetX, offsetY, offsetZ] × numInstances */
  instanceOffsetBuffer: WebGLBuffer;
  /** Total number of points across all nodes in this batch. */
  totalPoints: number;
  /** Number of nodes (instances) in this batch. */
  numInstances: number;
  /** Point counts per node — used to unpack the combined VBO. */
  instancePointCounts: number[];
}

const MAX_BATCH_POINTS = 2_000_000;

export class BatchedDrawCall {
  private readonly gl: WebGL2RenderingContext;
  private readonly batches: DrawBatch[] = [];
  private readonly vao: WebGLVertexArrayObject | null;

  constructor(renderer: THREE.WebGLRenderer) {
    const ctx = renderer.getContext();
    if (!(ctx instanceof WebGL2RenderingContext)) {
      throw new Error('BatchedDrawCall requires WebGL2');
    }
    this.gl = ctx;
    this.vao = ctx.createVertexArray();
  }

  /**
   * Build batched buffers from a set of loaded node geometries.
   * Call this whenever the visible node set changes.
   */
  buildBatches(nodes: Array<{ geometry: THREE.BufferGeometry; worldOffset: THREE.Vector3 }>): void {
    const gl = this.gl;

    // Release previous batches
    for (const b of this.batches) {
      gl.deleteBuffer(b.positionBuffer);
      gl.deleteBuffer(b.instanceOffsetBuffer);
    }
    this.batches.length = 0;

    let batchPositions: number[] = [];
    let batchOffsets: number[] = [];
    let batchCounts: number[] = [];
    let batchTotal = 0;

    const flush = (): void => {
      if (batchPositions.length === 0) return;

      const posBuffer = gl.createBuffer();
      const offBuffer = gl.createBuffer();
      if (!posBuffer || !offBuffer) return;

      gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(batchPositions), gl.STATIC_DRAW);

      gl.bindBuffer(gl.ARRAY_BUFFER, offBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(batchOffsets), gl.STATIC_DRAW);

      this.batches.push({
        positionBuffer: posBuffer,
        instanceOffsetBuffer: offBuffer,
        totalPoints: batchTotal,
        numInstances: batchCounts.length,
        instancePointCounts: [...batchCounts],
      });

      batchPositions = [];
      batchOffsets = [];
      batchCounts = [];
      batchTotal = 0;
    };

    for (const node of nodes) {
      const posAttr = node.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!posAttr) continue;

      const count = posAttr.count;
      if (batchTotal + count > MAX_BATCH_POINTS) flush();

      // Append positions
      const arr = posAttr.array as Float32Array;
      for (let i = 0; i < arr.length; i++) batchPositions.push(arr[i] ?? 0);

      // Append instance offset (one vec3 per node)
      batchOffsets.push(node.worldOffset.x, node.worldOffset.y, node.worldOffset.z);
      batchCounts.push(count);
      batchTotal += count;
    }

    flush();
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  get drawBatches(): readonly DrawBatch[] {
    return this.batches;
  }

  dispose(): void {
    const gl = this.gl;
    for (const b of this.batches) {
      gl.deleteBuffer(b.positionBuffer);
      gl.deleteBuffer(b.instanceOffsetBuffer);
    }
    this.batches.length = 0;
    if (this.vao) gl.deleteVertexArray(this.vao);
  }
}
