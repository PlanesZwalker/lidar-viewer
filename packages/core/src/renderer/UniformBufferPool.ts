// packages/core/src/renderer/UniformBufferPool.ts
// WebGL2 Uniform Buffer Object pool.
// Replaces the 1-call-per-uniform pattern of WebGL 1 with a single bufferData
// upload per frame, dramatically reducing CPU→GPU state-change overhead.

import * as THREE from 'three';

/** Describes one field inside the UBO layout (std140 alignment). */
export interface UBOField {
  name: string;
  /** Byte offset within the UBO block (must satisfy std140 alignment). */
  offset: number;
  /** Number of float32 elements (1 = scalar, 3 = vec3, 16 = mat4, …). */
  size: number;
}

export interface UBODescriptor {
  name: string;
  /** Total byte size of the block (padded to 16-byte boundary). */
  byteSize: number;
  fields: UBOField[];
  /** Binding index registered in shaders via `layout(std140, binding = N)`. */
  bindingIndex: number;
}

export class UniformBufferPool {
  private readonly gl: WebGL2RenderingContext;
  private readonly buffers = new Map<string, WebGLBuffer>();
  private readonly data = new Map<string, Float32Array>();
  private readonly descriptors = new Map<string, UBODescriptor>();

  constructor(renderer: THREE.WebGLRenderer) {
    const ctx = renderer.getContext();
    if (!(ctx instanceof WebGL2RenderingContext)) {
      throw new Error('UniformBufferPool requires WebGL2');
    }
    this.gl = ctx;
  }

  /** Register a UBO layout. Call once on init. */
  register(desc: UBODescriptor): void {
    const gl = this.gl;
    const buf = gl.createBuffer();
    if (!buf) throw new Error(`UniformBufferPool: could not create buffer for "${desc.name}"`);

    gl.bindBuffer(gl.UNIFORM_BUFFER, buf);
    gl.bufferData(gl.UNIFORM_BUFFER, desc.byteSize, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, desc.bindingIndex, buf);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);

    this.buffers.set(desc.name, buf);
    this.data.set(desc.name, new Float32Array(desc.byteSize / 4));
    this.descriptors.set(desc.name, desc);
  }

  /** Write float data into the CPU-side backing array. */
  set(uboName: string, fieldName: string, values: ArrayLike<number>): void {
    const desc = this.descriptors.get(uboName);
    const arr = this.data.get(uboName);
    if (!desc || !arr) throw new Error(`UniformBufferPool: unknown UBO "${uboName}"`);

    const field = desc.fields.find((f) => f.name === fieldName);
    if (!field) throw new Error(`UniformBufferPool: unknown field "${fieldName}" in "${uboName}"`);

    const startFloat = field.offset / 4;
    for (let i = 0; i < field.size && i < values.length; i++) {
      arr[startFloat + i] = (values as number[])[i] ?? 0;
    }
  }

  /** Convenience: write a THREE.Matrix4. */
  setMatrix4(uboName: string, fieldName: string, mat: THREE.Matrix4): void {
    this.set(uboName, fieldName, mat.elements);
  }

  /** Convenience: write a THREE.Vector3. */
  setVector3(uboName: string, fieldName: string, vec: THREE.Vector3): void {
    this.set(uboName, fieldName, [vec.x, vec.y, vec.z]);
  }

  /** Upload all pending CPU-side changes to the GPU for a given UBO. */
  upload(uboName: string): void {
    const gl = this.gl;
    const buf = this.buffers.get(uboName);
    const arr = this.data.get(uboName);
    if (!buf || !arr) return;

    gl.bindBuffer(gl.UNIFORM_BUFFER, buf);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, arr);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
  }

  /** Bind a UBO block in a compiled program by block name → binding index. */
  bind(program: WebGLProgram, uboName: string): void {
    const gl = this.gl;
    const desc = this.descriptors.get(uboName);
    if (!desc) return;
    const blockIndex = gl.getUniformBlockIndex(program, uboName);
    if (blockIndex !== gl.INVALID_INDEX) {
      gl.uniformBlockBinding(program, blockIndex, desc.bindingIndex);
    }
  }

  dispose(): void {
    for (const buf of this.buffers.values()) {
      this.gl.deleteBuffer(buf);
    }
    this.buffers.clear();
    this.data.clear();
    this.descriptors.clear();
  }
}

// ─── Standard UBO descriptors used by the point cloud material ───────────────

/** Layout for the per-frame camera/scene transforms (binding 0). */
export const CAMERA_UBO: UBODescriptor = {
  name: 'CameraBlock',
  bindingIndex: 0,
  byteSize: 256, // 4 mat4 = 4 × 64 bytes
  fields: [
    { name: 'projectionMatrix',     offset: 0,   size: 16 },
    { name: 'viewMatrix',           offset: 64,  size: 16 },
    { name: 'modelMatrix',          offset: 128, size: 16 },
    { name: 'normalMatrix',         offset: 192, size: 16 },
  ],
};

/** Layout for rendering parameters (binding 1). */
export const RENDER_PARAMS_UBO: UBODescriptor = {
  name: 'RenderParamsBlock',
  bindingIndex: 1,
  byteSize: 64,
  fields: [
    { name: 'pointSize',      offset: 0,  size: 1 },
    { name: 'opacity',        offset: 4,  size: 1 },
    { name: 'edlStrength',    offset: 8,  size: 1 },
    { name: 'edlRadius',      offset: 12, size: 1 },
    { name: 'screenWidth',    offset: 16, size: 1 },
    { name: 'screenHeight',   offset: 20, size: 1 },
    { name: 'near',           offset: 24, size: 1 },
    { name: 'far',            offset: 28, size: 1 },
    { name: 'cameraPosition', offset: 32, size: 3 },
    // 4 bytes padding to reach next 16-byte boundary
    { name: 'colorMode',      offset: 48, size: 1 },
  ],
};
