// packages/core/src/renderer/EDLPass.ts
// Eye-Dome Lighting post-process pass using WebGL2 Float32 MRT textures.
// Significantly improves visual depth cues at near-zero rendering cost on desktop.

import * as THREE from 'three';

const EDL_VERT = /* glsl */`
  in vec2 position;
  out vec2 vUv;
  void main() {
    vUv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const EDL_FRAG = /* glsl */`
  precision highp float;

  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform float uRadius;
  uniform float uStrength;
  uniform float uNear;
  uniform float uFar;
  uniform vec2  uResolution;

  in vec2 vUv;
  out vec4 fragColor;

  float linearizeDepth(float d) {
    return (2.0 * uNear * uFar) / (uFar + uNear - (d * 2.0 - 1.0) * (uFar - uNear));
  }

  void main() {
    vec2 texel = 1.0 / uResolution;
    float depth = texture(tDepth, vUv).r;
    float linDepth = linearizeDepth(depth);

    // Sample 8 neighbours
    vec2 offsets[8];
    offsets[0] = vec2( 1.0,  0.0);
    offsets[1] = vec2(-1.0,  0.0);
    offsets[2] = vec2( 0.0,  1.0);
    offsets[3] = vec2( 0.0, -1.0);
    offsets[4] = vec2( 0.707,  0.707);
    offsets[5] = vec2(-0.707,  0.707);
    offsets[6] = vec2( 0.707, -0.707);
    offsets[7] = vec2(-0.707, -0.707);

    float sum = 0.0;
    for (int i = 0; i < 8; i++) {
      vec2 coord = vUv + offsets[i] * texel * uRadius;
      float neighbourDepth = texture(tDepth, coord).r;
      float linNeighbour = linearizeDepth(neighbourDepth);
      float diff = max(0.0, linDepth - linNeighbour);
      sum += diff;
    }

    float edl = exp(-uStrength * sum);
    vec4 color = texture(tColor, vUv);
    fragColor = vec4(color.rgb * edl, color.a);
  }
`;

export interface EDLPassOptions {
  radius?: number;
  strength?: number;
}

export class EDLPass {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.RawShaderMaterial;
  private colorTarget: THREE.WebGLRenderTarget;
  private enabled = true;

  radius: number;
  strength: number;

  constructor(renderer: THREE.WebGLRenderer, options: EDLPassOptions = {}) {
    this.renderer = renderer;
    this.radius = options.radius ?? 1.5;
    this.strength = options.strength ?? 0.55;

    const { width, height } = renderer.getSize(new THREE.Vector2());
    this.colorTarget = this.createTarget(width, height);

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: EDL_VERT,
      fragmentShader: EDL_FRAG,
      uniforms: {
        tColor:       { value: this.colorTarget.texture },
        tDepth:       { value: this.colorTarget.depthTexture },
        uRadius:      { value: this.radius },
        uStrength:    { value: this.strength },
        uNear:        { value: 0.1 },
        uFar:         { value: 1000.0 },
        uResolution:  { value: new THREE.Vector2(width, height) },
      },
      depthTest: false,
      depthWrite: false,
    });

    const quad = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(quad, this.material);
    this.mesh.frustumCulled = false;

    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Render the scene into the EDL target, then composite onto the screen.
   * Call this instead of renderer.render(scene, camera) when EDL is on.
   */
  render(
    threeScene: THREE.Scene,
    threeCamera: THREE.Camera,
    near: number,
    far: number,
  ): void {
    if (!this.enabled) {
      this.renderer.render(threeScene, threeCamera);
      return;
    }

    // Ensure target matches current renderer size
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.width !== this.colorTarget.width || size.height !== this.colorTarget.height) {
      this.resize(size.width, size.height);
    }

    // Pass 1: render scene to color + depth target
    this.renderer.setRenderTarget(this.colorTarget);
    this.renderer.clear(true, true, true);
    this.renderer.render(threeScene, threeCamera);

    // Update uniforms
    this.material.uniforms['uNear']!.value = near;
    this.material.uniforms['uFar']!.value = far;
    this.material.uniforms['uRadius']!.value = this.radius;
    this.material.uniforms['uStrength']!.value = this.strength;
    this.material.uniforms['uResolution']!.value.set(size.width, size.height);

    // Pass 2: composite EDL quad to screen
    this.renderer.setRenderTarget(null);
    this.renderer.clear(false, true, false);
    this.renderer.render(this.scene, this.camera);
  }

  resize(width: number, height: number): void {
    this.colorTarget.setSize(width, height);
    if (this.colorTarget.depthTexture) {
      this.colorTarget.depthTexture.image.width = width;
      this.colorTarget.depthTexture.image.height = height;
      this.colorTarget.depthTexture.needsUpdate = true;
    }
    this.material.uniforms['uResolution']!.value.set(width, height);
  }

  dispose(): void {
    this.colorTarget.dispose();
    this.material.dispose();
  }

  private createTarget(width: number, height: number): THREE.WebGLRenderTarget {
    const depthTexture = new THREE.DepthTexture(width, height);
    depthTexture.type = THREE.UnsignedIntType;
    return new THREE.WebGLRenderTarget(width, height, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      depthTexture,
    });
  }
}
