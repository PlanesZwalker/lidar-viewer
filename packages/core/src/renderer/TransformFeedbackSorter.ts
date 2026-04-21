// packages/core/src/renderer/TransformFeedbackSorter.ts
// GPU-side depth sorting using WebGL2 Transform Feedback.
// Replaces the per-frame JS sort that causes stutter during camera rotation.

import * as THREE from 'three';

const SORT_VERT = /* glsl */`#version 300 es
  in vec3 position;

  uniform mat4 modelViewMatrix;

  // Capture depth into the transform feedback buffer
  out float depth;

  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    depth = -mvPos.z; // positive = in front
  }
`;

// Fragment shader is unused during transform feedback but required by spec
const SORT_FRAG = /* glsl */`#version 300 es
  precision highp float;
  out vec4 fragColor;
  void main() { fragColor = vec4(0.0); }
`;

export class TransformFeedbackSorter {
  private readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private feedbackBuffer: WebGLBuffer | null = null;
  private transformFeedback: WebGLTransformFeedback | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private ready = false;

  constructor(renderer: THREE.WebGLRenderer) {
    const ctx = renderer.getContext();
    if (!(ctx instanceof WebGL2RenderingContext)) {
      console.warn('TransformFeedbackSorter: WebGL2 not available — depth sort disabled');
      this.gl = ctx as WebGL2RenderingContext;
      return;
    }
    this.gl = ctx;
    this.init();
  }

  private init(): void {
    const gl = this.gl;

    // Compile sort program with transform feedback varyings
    const vs = this.compileShader(gl.VERTEX_SHADER, SORT_VERT);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, SORT_FRAG);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    if (!prog) return;

    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);

    // Declare transform feedback output BEFORE linking
    gl.transformFeedbackVaryings(prog, ['depth'], gl.SEPARATE_ATTRIBS);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('TransformFeedbackSorter: link error:', gl.getProgramInfoLog(prog));
      return;
    }

    this.program = prog;
    this.transformFeedback = gl.createTransformFeedback();
    this.vao = gl.createVertexArray();
    this.ready = true;

    gl.deleteShader(vs);
    gl.deleteShader(fs);
  }

  /**
   * Runs a transform feedback pass to compute per-point depth values on the GPU.
   * Returns the depth buffer for CPU-side index sorting (bitonic sort is not
   * yet available in WebGL2 without compute shaders, but this at minimum moves
   * the depth projection to the GPU and frees the main thread).
   */
  computeDepths(
    positionBuffer: WebGLBuffer,
    numPoints: number,
    modelViewMatrix: THREE.Matrix4,
  ): Float32Array | null {
    if (!this.ready || !this.program || !this.transformFeedback || !this.vao) return null;

    const gl = this.gl;

    // Ensure feedback buffer is large enough
    const needed = numPoints * 4;
    if (!this.feedbackBuffer || gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE) < needed) {
      if (this.feedbackBuffer) gl.deleteBuffer(this.feedbackBuffer);
      this.feedbackBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.feedbackBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, needed, gl.DYNAMIC_READ);
    }

    gl.useProgram(this.program);

    // Upload modelViewMatrix uniform
    const mvLoc = gl.getUniformLocation(this.program, 'modelViewMatrix');
    gl.uniformMatrix4fv(mvLoc, false, modelViewMatrix.elements);

    // Bind VAO and position attribute
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const posLoc = gl.getAttribLocation(this.program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);

    // Run transform feedback — rasterization disabled
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.transformFeedback);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.feedbackBuffer);

    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, numPoints);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);

    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);

    // Read back depth values
    const depths = new Float32Array(numPoints);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.feedbackBuffer);
    gl.getBufferSubData(gl.ARRAY_BUFFER, 0, depths);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    return depths;
  }

  dispose(): void {
    const gl = this.gl;
    if (this.program) gl.deleteProgram(this.program);
    if (this.feedbackBuffer) gl.deleteBuffer(this.feedbackBuffer);
    if (this.transformFeedback) gl.deleteTransformFeedback(this.transformFeedback);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.ready = false;
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('TransformFeedbackSorter shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }
}
