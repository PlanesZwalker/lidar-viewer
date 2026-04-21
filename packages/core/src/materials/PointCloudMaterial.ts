// packages/core/src/materials/PointCloudMaterial.ts
// WebGL2 point cloud shader material using standard Three.js uniforms.

import * as THREE from 'three';

/** 0=rgb  1=classification  2=elevation  3=intensity */
export type ColorMode = 'rgb' | 'classification' | 'elevation' | 'intensity';
export const COLOR_MODE_INDEX: Record<ColorMode, number> = {
  rgb: 0, classification: 1, elevation: 2, intensity: 3,
};

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

  out vec3 vColor;
  out vec3 vColorClass;
  out vec3 vColorIntensity;
  out float vElevation;

  void main() {
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position  = projectionMatrix * viewPos;

    // Perspective point size attenuation
    float dist = max(-viewPos.z, 0.001);
    gl_PointSize = clamp((uPointSize * uScreenHeight) / (dist * 2.0), 1.0, 64.0);

    vColor         = color;
    vColorClass    = colorClass;
    vColorIntensity = colorIntensity;
    // Altitude is swapped to Three.js Y in the COPC loader (LAS Z → position.y)
    vElevation = position.y;
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

  // HSL → RGB helper for elevation ramp
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
    // Smooth anti-aliased circular disc (fwidth is built-in GLSL3/WebGL2)
    vec2 coord = gl_PointCoord - 0.5;
    float r = length(coord);
    float fw = fwidth(r);
    float alpha = 1.0 - smoothstep(0.5 - fw * 1.5, 0.5 + fw * 0.5, r);
    if (alpha < 0.02) discard;

    vec3 finalColor;
    int mode = int(uColorMode + 0.5);

    if (mode == 1) {
      finalColor = vColorClass;
    } else if (mode == 2) {
      // Elevation ramp: blue (low) → green → red (high)
      float t = clamp((vElevation - uElevationMin) / max(uElevationMax - uElevationMin, 0.001), 0.0, 1.0);
      finalColor = hslToRgb(0.667 - t * 0.667, 1.0, 0.5);
    } else if (mode == 3) {
      finalColor = vColorIntensity;
    } else {
      finalColor = vColor; // mode 0: RGB
    }

    fragColor = vec4(finalColor, alpha);
  }
`;

export class PointCloudMaterial extends THREE.RawShaderMaterial {
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
        uElevationMax: { value: 500 },
      },
      vertexColors: true,
      transparent: true,
      depthWrite: true,
    });

    // Update camera matrices per draw call
    this.onBeforeRender = (_renderer, _scene, camera, _geometry, object) => {
      this.uniforms['projectionMatrix']!.value = (camera as THREE.PerspectiveCamera).projectionMatrix;
      this.uniforms['modelViewMatrix']!.value = object.modelViewMatrix;
    };
  }

  updateElevationRange(min: number, max: number): void {
    this.elevationMin = min;
    this.elevationMax = max;
    this.uniforms['uElevationMin']!.value = min;
    this.uniforms['uElevationMax']!.value = max;
  }
}

