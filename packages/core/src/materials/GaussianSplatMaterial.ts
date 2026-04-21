// packages/core/src/materials/GaussianSplatMaterial.ts
// Gaussian Splat rendering material — converts LiDAR points into
// soft alpha-blended ellipsoidal discs, giving a surface-like appearance.
//
// Each point is expanded to a billboard quad (via gl_PointSize) whose
// fragment alpha is a 2-D Gaussian: α = exp(-2.5 · r²).
// The disc size is 3× the standard point size so adjacent splats overlap
// and fill the gaps that expose the sparse point structure underneath.
// Depth writes are disabled so overlapping transparent splats blend cleanly.

import * as THREE from 'three';
import type { ColorMode } from './PointCloudMaterial.js';

export { COLOR_MODE_INDEX } from './PointCloudMaterial.js';
export type { ColorMode };

const VERT_SHADER = /* glsl */`
  precision highp float;

  in vec3 position;
  in vec3 color;
  in vec3 colorClass;
  in vec3 colorIntensity;

  uniform mat4 projectionMatrix;
  uniform mat4 modelViewMatrix;
  uniform float uPointSize;
  uniform float uScreenHeight;
  // Per-node world-space spacing — used to size splats so they cover neighbour gaps.
  uniform float uSpacing;

  out vec3 vColor;
  out vec3 vColorClass;
  out vec3 vColorIntensity;
  out float vElevation;

  void main() {
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position  = projectionMatrix * viewPos;

    float dist = max(-viewPos.z, 0.001);

    // Base size: same formula as PointCloudMaterial.
    float baseSize = (uPointSize * uScreenHeight) / (dist * 2.0);

    // Spacing-driven size: project the world-space inter-point distance to
    // screen pixels so splats always cover the gap to their nearest neighbour.
    // uSpacing comes from OctreeGeometryNode.spacing (metres between points).
    // We use half the projection matrix X scale as the focal-length factor.
    float focalX = projectionMatrix[0][0]; // = 1 / tan(fovY/2 * aspect)
    float spacingPx = (uSpacing * focalX * uScreenHeight) / (dist * 2.0);

    // Take the larger of the two so we're never smaller than the standard dot.
    float splatSize = max(baseSize, spacingPx);

    // Clamp generously — we want large splats for low-density nodes.
    gl_PointSize = clamp(splatSize, 2.0, 256.0);

    vColor          = color;
    vColorClass     = colorClass;
    vColorIntensity = colorIntensity;
    // Altitude is swapped to Three.js Y in the COPC loader (LAS Z → position.y)
    vElevation      = position.y;
  }
`;

const FRAG_SHADER = /* glsl */`
  precision highp float;

  uniform float uColorMode;
  uniform float uElevationMin;
  uniform float uElevationMax;

  in vec3  vColor;
  in vec3  vColorClass;
  in vec3  vColorIntensity;
  in float vElevation;

  out vec4 fragColor;

  // HSL → RGB helper (reused from PointCloudMaterial)
  float hue2rgb(float p, float q, float t) {
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
    if (t < 1.0/2.0) return q;
    if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
    return p;
  }
  vec3 hslToRgb(float h, float s, float l) {
    float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
    float p = 2.0 * l - q;
    return vec3(hue2rgb(p, q, h + 1.0/3.0),
                hue2rgb(p, q, h),
                hue2rgb(p, q, h - 1.0/3.0));
  }

  void main() {
    // Compute squared distance from disc centre (normalised to [0, 1] at edge).
    vec2 uv = gl_PointCoord - 0.5;
    float r2 = dot(uv, uv) * 4.0; // 0 at centre → 1 at edge of inscribed circle

    // Gaussian falloff: softer sigma (-2.0 vs -2.5) so edges stay more opaque
    // and neighbouring splats fill the gaps better, giving a solid surface look.
    float alpha = exp(-2.0 * r2);
    if (alpha < 0.015) discard;

    vec3 finalColor;
    int mode = int(uColorMode + 0.5);

    if (mode == 1) {
      finalColor = vColorClass;
    } else if (mode == 2) {
      float t = clamp((vElevation - uElevationMin) / max(uElevationMax - uElevationMin, 0.001), 0.0, 1.0);
      finalColor = hslToRgb(0.667 - t * 0.667, 1.0, 0.5);
    } else if (mode == 3) {
      finalColor = vColorIntensity;
    } else {
      finalColor = vColor;
    }

    fragColor = vec4(finalColor, alpha);
  }
`;

export class GaussianSplatMaterial extends THREE.RawShaderMaterial {
  colorMode: ColorMode = 'rgb';
  elevationMin = 0;
  elevationMax = 100;

  constructor() {
    super({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER,
      uniforms: {
        projectionMatrix: { value: new THREE.Matrix4() },
        modelViewMatrix:  { value: new THREE.Matrix4() },
        uPointSize:    { value: 2.0 },
        uScreenHeight: { value: 600 },
        uColorMode:    { value: 0 },
        uElevationMin: { value: 0 },
        uElevationMax: { value: 100 },
        uSpacing:      { value: 1.0 },
      },
      // Transparent splats with depth write ON so they're visible in the EDL
      // depth buffer. For mostly-flat terrain viewed from above, the depth
      // sort artefacts from back-to-front overlap are negligible and the
      // Gaussian alpha still gives the smooth, splat-like appearance.
      transparent: true,
      depthWrite: true,
      blending: THREE.NormalBlending,
    });

    // Update camera matrices per draw call (same pattern as PointCloudMaterial).
    this.onBeforeRender = (_renderer, _scene, camera, _geometry, object) => {
      this.uniforms['projectionMatrix']!.value = (camera as THREE.PerspectiveCamera).projectionMatrix;
      this.uniforms['modelViewMatrix']!.value = (object as THREE.Object3D).modelViewMatrix;
    };
  }

  setPointSize(v: number)    { this.uniforms['uPointSize']!.value = v; }
  setScreenHeight(v: number) { this.uniforms['uScreenHeight']!.value = v; }
  setColorMode(mode: ColorMode) {
    this.colorMode = mode;
    const map: Record<ColorMode, number> = { rgb: 0, classification: 1, elevation: 2, intensity: 3 };
    this.uniforms['uColorMode']!.value = map[mode];
  }
  setElevationRange(min: number, max: number) {
    this.uniforms['uElevationMin']!.value = min;
    this.uniforms['uElevationMax']!.value = max;
  }
  /** Called per visible node so splat sizes match local point density. */
  setSpacing(v: number) { this.uniforms['uSpacing']!.value = v; }
}
