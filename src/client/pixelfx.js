// Pixel-art renderer:
//  1. draw the scene at low resolution into an HDR render target
//  2. bloom: bright-pass at half that resolution, then a separable blur (ping-pong)
//  3. final pass: outlines from depth, + bloom, tone mapping, color grading, vignette,
//     sRGB, then quantize colors with ordered dithering
//  4. CSS scales the low-res canvas up with `image-rendering: pixelated`

import * as THREE from 'three';

export const PIXEL_SIZE = () => (window.innerWidth < 700 ? 2 : 3); // CSS px per art pixel, close up
// zooming out shrinks the art pixels: camera distances where the pixel size drops by 1, then 2
export const ZOOM_PIXEL_STEPS = [15]; // one step only: full resolution (size 1) zoomed out was too slow
const ZOOM_HYSTERESIS = 1; // distance slack so the size doesn't flicker at a boundary
export const COLOR_LEVELS = 26; // per color channel (higher = less dither grain)
export const OUTLINE_DARKEN = 0.7; // 0 = black outlines, 1 = none
export const OUTLINE_THRESHOLD = 0.03; // relative depth jump that counts as an edge
export const BLOOM = { threshold: 1.1, knee: 0.35, strength: 0.55, radius: 1.4 };
// tilt-shift: sharp horizontal band through the screen centre (the player), soft blur above/below.
// `strength` 0..1 scales the max blur radius (in low-res texels); main.js raises it a bit when zoomed out.
export const TILT = { band: 0.16, fade: 0.32, radius: 1.8, strength: 0.6 };
// cozy and calm (at the user's request): a little dimmer and less saturated, warmer highlights
export const GRADE = { exposure: 0.94, saturation: 0.93, warmth: 0.03, vignette: 0.3, shadowTint: 0.03 };

const fullscreenVert = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// bright-pass with a 4-tap downsample
const brightFrag = /* glsl */`
  uniform sampler2D tColor;
  uniform vec2 texel;
  uniform float threshold;
  uniform float knee;
  varying vec2 vUv;
  void main() {
    vec3 c = 0.25 * (texture2D(tColor, vUv + texel * vec2(-0.5, -0.5)).rgb + texture2D(tColor, vUv + texel * vec2(0.5, -0.5)).rgb
                   + texture2D(tColor, vUv + texel * vec2(-0.5, 0.5)).rgb + texture2D(tColor, vUv + texel * vec2(0.5, 0.5)).rgb);
    float l = max(c.r, max(c.g, c.b));
    float soft = clamp(l - threshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    float w = max(soft, l - threshold) / max(l, 1e-4);
    gl_FragColor = vec4(c * w, 1.0);
  }`;

// 9-tap gaussian along `dir`
const blurFrag = /* glsl */`
  uniform sampler2D tInput;
  uniform vec2 dir;
  varying vec2 vUv;
  void main() {
    vec3 s = texture2D(tInput, vUv).rgb * 0.2270270270;
    s += texture2D(tInput, vUv + dir * 1.3846153846).rgb * 0.3162162162;
    s += texture2D(tInput, vUv - dir * 1.3846153846).rgb * 0.3162162162;
    s += texture2D(tInput, vUv + dir * 3.2307692308).rgb * 0.0702702703;
    s += texture2D(tInput, vUv - dir * 3.2307692308).rgb * 0.0702702703;
    gl_FragColor = vec4(s, 1.0);
  }`;

const finalFrag = /* glsl */`
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tBloom;
  uniform vec2 res;
  uniform float levels;
  uniform float edge;
  uniform float darken;
  uniform float near;
  uniform float far;
  uniform float bloomStrength;
  uniform float exposure;
  uniform float saturation;
  uniform float warmth;
  uniform float vignette;
  uniform float shadowTint;
  uniform float tiltBand;
  uniform float tiltFade;
  uniform float tiltRadius;
  varying vec2 vUv;

  float bayer4(vec2 p) {
    ivec2 i = ivec2(mod(p, 4.0));
    float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
    return m[i.x + i.y * 4] / 16.0;
  }
  vec3 toSRGB(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
  }
  // ACES filmic curve (Narkowicz fit): soft highlights instead of hard clipping
  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
  // 1 / view-space depth: affine in screen space on flat surfaces, so its second
  // derivative is ~0 except at silhouettes.
  float invZ(vec2 uv) {
    float d = texture2D(tDepth, uv).r;
    return (far - d * (far - near)) / (near * far);
  }
  void main() {
    vec2 t = 1.0 / res;
    vec3 c = texture2D(tColor, vUv).rgb;
    float d = texture2D(tDepth, vUv).r;
    bool sky = d >= 1.0;

    // tilt-shift: blur grows with distance from the centre band (12-tap golden-angle disc)
    float tilt = smoothstep(tiltBand, tiltBand + tiltFade, abs(vUv.y - 0.5));
    float rad = tilt * tiltRadius;
    if (rad > 0.15) {
      vec3 acc = c;
      for (int k = 1; k < 12; k++) {
        float fk = float(k);
        float r = sqrt(fk / 11.0) * rad;
        float a = fk * 2.39996;
        acc += texture2D(tColor, vUv + vec2(cos(a), sin(a)) * r * t).rgb;
      }
      c = acc / 12.0;
    }

    if (!sky && tilt < 0.98) {
      float w = invZ(vUv);
      float lx = (2.0 * w - invZ(vUv + vec2(t.x, 0.0)) - invZ(vUv - vec2(t.x, 0.0))) / w;
      float ly = (2.0 * w - invZ(vUv + vec2(0.0, t.y)) - invZ(vUv - vec2(0.0, t.y))) / w;
      if (max(lx, ly) > edge) c *= mix(darken, 1.0, tilt); // outlines soften where it's blurred
    }

    c += texture2D(tBloom, vUv).rgb * bloomStrength;
    c = aces(c * exposure);

    // grading: saturation, warm highlights / cool shadows, vignette
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, saturation);
    c += vec3(warmth, warmth * 0.4, -warmth) * (l - 0.35);
    c += vec3(0.6, 0.2, 1.0) * shadowTint * (1.0 - smoothstep(0.0, 0.45, l)); // soft lavender in the shadows
    vec2 v = vUv - 0.5;
    c *= 1.0 - vignette * dot(v, v) * 2.0;

    c = toSRGB(c);
    if (!sky) c = floor(c * levels + bayer4(gl_FragCoord.xy)) / levels;
    gl_FragColor = vec4(c, 1.0);
  }`;

function makeTarget(w, h, { depth = false, linear = false } = {}) {
  const filter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, minFilter: filter, magFilter: filter,
    depthBuffer: depth,
    stencilBuffer: depth, // used by the character silhouette (see character.js)
  });
  if (depth) {
    rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedInt248Type);
    rt.depthTexture.format = THREE.DepthStencilFormat;
  }
  return rt;
}

function pass(fragmentShader, uniforms) {
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: fullscreenVert, fragmentShader, depthTest: false, depthWrite: false });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  return { material, scene, u: uniforms };
}

export class PixelRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false }));
    r.setPixelRatio(1);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.BasicShadowMap; // hard shadows suit pixel art

    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.bright = pass(brightFrag, {
      tColor: { value: null }, texel: { value: new THREE.Vector2() },
      threshold: { value: BLOOM.threshold }, knee: { value: BLOOM.knee },
    });
    this.blur = pass(blurFrag, { tInput: { value: null }, dir: { value: new THREE.Vector2() } });
    this.final = pass(finalFrag, {
      tColor: { value: null }, tDepth: { value: null }, tBloom: { value: null },
      res: { value: new THREE.Vector2(1, 1) },
      levels: { value: COLOR_LEVELS }, edge: { value: OUTLINE_THRESHOLD }, darken: { value: OUTLINE_DARKEN },
      near: { value: 0.1 }, far: { value: 100 },
      bloomStrength: { value: BLOOM.strength },
      exposure: { value: GRADE.exposure }, saturation: { value: GRADE.saturation },
      warmth: { value: GRADE.warmth }, vignette: { value: GRADE.vignette }, shadowTint: { value: GRADE.shadowTint },
      tiltBand: { value: TILT.band }, tiltFade: { value: TILT.fade }, tiltRadius: { value: TILT.radius * TILT.strength },
    });
    this.zoomLevel = 0;
    this.resize();
  }

  /** Call every frame with the camera distance; re-sizes the low-res target when the level changes. */
  setZoom(dist) {
    let lvl = this.zoomLevel;
    while (lvl < ZOOM_PIXEL_STEPS.length && dist > ZOOM_PIXEL_STEPS[lvl] + ZOOM_HYSTERESIS) lvl++;
    while (lvl > 0 && dist < ZOOM_PIXEL_STEPS[lvl - 1] - ZOOM_HYSTERESIS) lvl--;
    const before = this.pixelSize;
    this.zoomLevel = lvl;
    if (Math.max(1, PIXEL_SIZE() - lvl) !== before) this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    const px = (this.pixelSize = Math.max(1, PIXEL_SIZE() - this.zoomLevel));
    const w = Math.max(1, Math.ceil(this.cssW / px)), h = Math.max(1, Math.ceil(this.cssH / px));
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    for (const t of [this.rt, this.bloomA, this.bloomB]) t?.dispose();
    this.rt = makeTarget(w, h, { depth: true });
    const bw = Math.max(1, Math.ceil(w / 2)), bh = Math.max(1, Math.ceil(h / 2));
    this.bloomA = makeTarget(bw, bh, { linear: true });
    this.bloomB = makeTarget(bw, bh, { linear: true });
    this.final.u.res.value.set(w, h);
    this.bright.u.texel.value.set(1 / w, 1 / h);
    this.bloomTexel = new THREE.Vector2(1 / bw, 1 / bh);
  }

  get aspect() { return this.cssW / this.cssH; }

  /** Tilt-shift strength 0..1 (0 = off). */
  setTiltShift(strength) { this.final.u.tiltRadius.value = TILT.radius * strength * (PIXEL_SIZE() / this.pixelSize); } // same on-screen blur at any pixel size

  render(scene, camera) {
    const r = this.renderer;
    // 1. scene
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    // 2. bloom
    this.bright.u.tColor.value = this.rt.texture;
    r.setRenderTarget(this.bloomA);
    r.render(this.bright.scene, this.cam);
    for (let i = 0; i < 2; i++) {
      const spread = BLOOM.radius * (i + 1) * (PIXEL_SIZE() / this.pixelSize); // same on-screen glow at any pixel size
      this.blur.u.tInput.value = this.bloomA.texture;
      this.blur.u.dir.value.set(this.bloomTexel.x * spread, 0);
      r.setRenderTarget(this.bloomB);
      r.render(this.blur.scene, this.cam);
      this.blur.u.tInput.value = this.bloomB.texture;
      this.blur.u.dir.value.set(0, this.bloomTexel.y * spread);
      r.setRenderTarget(this.bloomA);
      r.render(this.blur.scene, this.cam);
    }
    // 3. final
    const u = this.final.u;
    u.tColor.value = this.rt.texture;
    u.tDepth.value = this.rt.depthTexture;
    u.tBloom.value = this.bloomA.texture;
    u.near.value = camera.near;
    u.far.value = camera.far;
    r.setRenderTarget(null);
    r.render(this.final.scene, this.cam);
  }
}
