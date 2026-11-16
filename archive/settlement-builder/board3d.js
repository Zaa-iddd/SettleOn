// 3D board with a pixel-art look.
// The scene renders at low resolution into a render target. A post-process pass then adds
// depth-based outlines, quantizes colors with ordered dithering, and writes to a low-res
// canvas that CSS scales up with `image-rendering: pixelated`.

import * as THREE from 'three';
import { MAP_W, MAP_H, idx, canBuild } from '../shared/game.js';

// ---------- look & feel knobs ----------
const PIXEL_SIZE = () => (window.innerWidth < 700 ? 2 : 3); // CSS px per "art" pixel
const COLOR_LEVELS = 10; // per channel, after dithering
const OUTLINE_DARKEN = 0.5; // 0 = black outlines, 1 = none
const BG = 0x1b2230;

const TOP = { p: 0.2, f: 0.24, m: 0.3, w: 0.02 }; // tile top heights
const WATER_Y = 0.13;
const TILE_COLORS = { p: 0x7fb84e, f: 0x3f7f3a, m: 0x8d8a80, w: 0x2a5d86 };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const world = (x, y) => [x - MAP_W / 2 + 0.5, y - MAP_H / 2 + 0.5];
const topOf = (state, i) => (state.cells[i]?.t === 'dock' ? WATER_Y : TOP[state.tiles[i]]);
const jit = (x, y, k) => { const v = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return v - Math.floor(v); };

// ---------- shared geometry / materials ----------
const geoCache = new Map();
const geo = (key, make) => geoCache.get(key) ?? geoCache.set(key, make()).get(key);
const BOX = (w, h, d) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0));
const PYR = (w, h) => geo(`p${w},${h}`, () => new THREE.ConeGeometry(w / Math.SQRT2, h, 4).rotateY(Math.PI / 4).translate(0, h / 2, 0));
const CYL = (rt, rb, h, seg) => geo(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg).translate(0, h / 2, 0));
const LOG = () => geo('log', () => new THREE.CylinderGeometry(0.06, 0.06, 0.42, 6).rotateZ(Math.PI / 2));

const matCache = new Map();
function mat(color, ghost = false) {
  const key = `${color}:${ghost}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshLambertMaterial({
      color, transparent: ghost, opacity: ghost ? 0.55 : 1, depthWrite: !ghost,
    }));
  }
  return matCache.get(key);
}

function part(g, m, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  return mesh;
}

// Builds a building model whose origin is the center of the tile's top surface.
export function makeBuilding(type, color, roadMask = 0, ghost = false) {
  const g = new THREE.Group();
  const M = (c) => mat(c, ghost);
  const add = (...parts) => parts.forEach((p) => g.add(p));
  switch (type) {
    case 'town': {
      add(part(BOX(0.56, 0.32, 0.46), M(0xf1e3c6)));
      const roof = part(PYR(0.72, 0.3), M(0xa8452c), 0, 0.32, 0);
      roof.scale.z = 0.85;
      add(roof, part(BOX(0.12, 0.17, 0.02), M(0x5a3a22), 0, 0, 0.235));
      add(part(BOX(0.03, 0.66, 0.03), M(0x3b2a1c), 0.3, 0, -0.22));
      const pivot = new THREE.Group();
      pivot.position.set(0.3, 0.52, -0.22);
      pivot.add(part(BOX(0.22, 0.13, 0.02), M(color), 0.11, 0, 0));
      pivot.userData.flag = true;
      add(pivot);
      break;
    }
    case 'road': {
      const m = M(0xc9a66b);
      add(part(BOX(0.3, 0.03, 0.3), m));
      DIRS.forEach(([dx, dy], k) => {
        if (!(roadMask & (1 << k))) return;
        add(dx ? part(BOX(0.35, 0.03, 0.3), m, dx * 0.325, 0, 0) : part(BOX(0.3, 0.03, 0.35), m, 0, 0, dy * 0.325));
      });
      break;
    }
    case 'farm': {
      add(part(BOX(0.84, 0.04, 0.84), M(0x7a5532)));
      for (let k = 0; k < 4; k++) add(part(BOX(0.8, 0.09, 0.11), M(0xe0c04a), 0, 0.04, -0.3 + k * 0.2));
      break;
    }
    case 'mill': {
      add(part(BOX(0.34, 0.24, 0.3), M(0x9a6a3f), 0.14, 0, -0.14));
      const roof = part(PYR(0.46, 0.18), M(0x6b4226), 0.14, 0.24, -0.14);
      roof.scale.z = 0.9;
      add(roof);
      const wood = M(0x8a5a35);
      add(part(LOG(), wood, -0.1, 0.06, 0.16), part(LOG(), wood, -0.1, 0.06, 0.3), part(LOG(), wood, -0.1, 0.16, 0.23));
      break;
    }
    case 'quarry': {
      add(part(BOX(0.5, 0.02, 0.32), M(0x5d5a52), 0, 0, -0.16));
      const stone = M(0xd8d3c4);
      add(part(BOX(0.24, 0.16, 0.24), stone, -0.18, 0, 0.18), part(BOX(0.24, 0.16, 0.24), stone, 0.14, 0, 0.2));
      add(part(BOX(0.22, 0.14, 0.22), M(0xc4bfb0), -0.02, 0.16, 0.19));
      break;
    }
    case 'dock': {
      // origin is at water level
      add(part(BOX(0.82, 0.04, 0.32), M(0x8a5a35), 0, 0.03, -0.08));
      const post = M(0x5c3a20);
      for (const [px, pz] of [[-0.36, -0.2], [0.36, -0.2], [-0.36, 0.04], [0.36, 0.04]]) add(part(CYL(0.03, 0.03, 0.2, 5), post, px, -0.12, pz));
      add(part(BOX(0.32, 0.07, 0.14), M(0xa0522d), 0.1, -0.01, 0.26));
      break;
    }
    case 'house': {
      add(part(BOX(0.4, 0.28, 0.36), M(0xefe0c4)));
      const roof = part(PYR(0.54, 0.24), M(0xc0613a), 0, 0.28, 0);
      roof.scale.z = 0.9;
      add(roof, part(BOX(0.06, 0.2, 0.06), M(0x8a6a5a), 0.1, 0.3, -0.06), part(BOX(0.1, 0.14, 0.02), M(0x5a3a22), 0, 0, 0.185));
      break;
    }
    case 'monument': {
      add(part(BOX(0.62, 0.08, 0.62), M(0xb8b2a0)), part(BOX(0.44, 0.08, 0.44), M(0xcfc9b7), 0, 0.08, 0));
      const shaft = part(CYL(0.09, 0.14, 0.8, 4), M(0xeee9dc), 0, 0.16, 0);
      shaft.rotation.y = Math.PI / 4;
      add(shaft, part(PYR(0.13, 0.16), M(0xf2c94c), 0, 0.96, 0), part(BOX(0.19, 0.06, 0.19), M(color), 0, 0.42, 0));
      break;
    }
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = !ghost; o.receiveShadow = !ghost; } });
  return g;
}

// ---------- post-process shader ----------
function makePostMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: null },
      tDepth: { value: null },
      res: { value: new THREE.Vector2(1, 1) },
      levels: { value: COLOR_LEVELS },
      edge: { value: 0.001 },
      darken: { value: OUTLINE_DARKEN },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tColor;
      uniform sampler2D tDepth;
      uniform vec2 res;
      uniform float levels;
      uniform float edge;
      uniform float darken;
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
      void main() {
        vec2 t = 1.0 / res;
        vec3 c = toSRGB(texture2D(tColor, vUv).rgb);
        float d = texture2D(tDepth, vUv).r;
        if (d >= 1.0) { gl_FragColor = vec4(c, 1.0); return; } // empty background: no dither
        // Second derivative of depth: ~0 on any flat or sloped surface, large where this
        // pixel sits in front of a depth jump. Outline only the nearer side of the edge.
        float lx = texture2D(tDepth, vUv + vec2(t.x, 0.0)).r + texture2D(tDepth, vUv - vec2(t.x, 0.0)).r - 2.0 * d;
        float ly = texture2D(tDepth, vUv + vec2(0.0, t.y)).r + texture2D(tDepth, vUv - vec2(0.0, t.y)).r - 2.0 * d;
        if (max(lx, ly) > edge) c *= darken;
        c = floor(c * levels + bayer4(gl_FragCoord.xy)) / levels;
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
}

function makeTarget(w, h, type = THREE.HalfFloatType) {
  const rt = new THREE.WebGLRenderTarget(w, h, { type, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  rt.depthTexture = new THREE.DepthTexture(w, h);
  return rt;
}

// ---------- board ----------
export class Board3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = null;
    this.ui = null;
    this.version = 0;

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false }));
    r.setPixelRatio(1);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.BasicShadowMap; // hard-edged shadows suit pixel art

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(BG);
    scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a3b2a, 1.6));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    sun.position.set(7, 14, 9);
    sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 40 });
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0008;
    scene.add(sun);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 120);
    this.az = this.azTarget = Math.PI / 4;
    this.el = 0.62;
    this.zoom = 1;
    this.target = new THREE.Vector3();

    const N = MAP_W * MAP_H;
    // tiles
    this.tiles = new THREE.InstancedMesh(BOX(1, 1, 1), new THREE.MeshLambertMaterial(), N);
    this.tiles.receiveShadow = true;
    scene.add(this.tiles);
    // water surfaces
    this.water = new THREE.InstancedMesh(BOX(1, 0.05, 1), new THREE.MeshLambertMaterial({ color: 0x4f9fe0, transparent: true, opacity: 0.8 }), N);
    this.water.receiveShadow = true;
    scene.add(this.water);
    // decorations
    this.treeTops = new THREE.InstancedMesh(CYL(0, 0.17, 0.42, 6), mat(0x2f6b33), N * 3);
    this.trunks = new THREE.InstancedMesh(CYL(0.035, 0.035, 0.1, 5), mat(0x6b4a2b), N * 3);
    this.peaks = new THREE.InstancedMesh(CYL(0, 0.42, 0.62, 5), mat(0x77756c), N);
    this.snow = new THREE.InstancedMesh(CYL(0, 0.14, 0.2, 5), mat(0xf4f4f0), N);
    for (const m of [this.treeTops, this.trunks, this.peaks, this.snow]) { m.castShadow = m.receiveShadow = true; scene.add(m); }
    // territory borders
    this.borders = new THREE.InstancedMesh(BOX(1, 1, 1), new THREE.MeshBasicMaterial(), N * 4);
    scene.add(this.borders);
    // valid-placement highlights
    this.highlights = new THREE.InstancedMesh(BOX(0.84, 0.02, 0.84), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }), N);
    this.highlights.count = 0;
    scene.add(this.highlights);
    this.hlKey = '';
    // buildings
    this.buildingGroup = new THREE.Group();
    scene.add(this.buildingGroup);
    this.buildings = new Map(); // tile index -> { key, obj }
    // hover outline + ghost
    this.hoverBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.04, 1).translate(0, 0.02, 0)),
      new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }),
    );
    this.hoverBox.renderOrder = 10;
    this.hoverBox.visible = false;
    scene.add(this.hoverBox);
    this.ghost = null;
    this.ghostKey = '';

    // post-processing
    this.post = makePostMaterial();
    this.postScene = new THREE.Scene();
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.rt = null;

    this.raycaster = new THREE.Raycaster();
    this.clock = new THREE.Clock();
    this.seed = null;
    this.waterTiles = [];

    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ----- sizing & camera -----
  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    const px = PIXEL_SIZE();
    const w = Math.max(1, Math.ceil(this.cssW / px));
    const h = Math.max(1, Math.ceil(this.cssH / px));
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    this.rt?.dispose();
    this.rt = makeTarget(w, h);
    this.post.uniforms.res.value.set(w, h);
    this.updateCamera();
  }

  updateCamera() {
    const aspect = this.cssW / this.cssH;
    const diag = (MAP_W + MAP_H) / Math.SQRT2;
    const viewH = (Math.max(diag * Math.sin(this.el) + 1.2, diag / aspect) * 1.04) / this.zoom;
    this.viewH = viewH;
    const c = this.camera;
    c.top = viewH / 2; c.bottom = -viewH / 2;
    c.left = (-viewH * aspect) / 2; c.right = (viewH * aspect) / 2;
    const dist = 50;
    c.position.set(
      this.target.x + dist * Math.cos(this.el) * Math.sin(this.az),
      this.target.y + dist * Math.sin(this.el),
      this.target.z + dist * Math.cos(this.el) * Math.cos(this.az),
    );
    c.lookAt(this.target);
    c.updateProjectionMatrix();
    // depth is linear for an orthographic camera; outline when depth jumps by ~0.06 world units
    this.post.uniforms.edge.value = 0.06 / (c.far - c.near);
  }

  rotate(dir) { this.azTarget += (dir * Math.PI) / 2; }

  zoomBy(f) {
    this.zoom = Math.min(4, Math.max(1, this.zoom * f));
    if (this.zoom === 1) this.target.set(0, 0, 0);
    this.updateCamera();
  }

  pan(dx, dy) {
    const u = this.viewH / this.cssH;
    const right = new THREE.Vector3(Math.cos(this.az), 0, -Math.sin(this.az));
    const away = new THREE.Vector3(-Math.sin(this.az), 0, -Math.cos(this.az));
    this.target.addScaledVector(right, -dx * u).addScaledVector(away, (dy * u) / Math.sin(this.el));
    this.target.x = Math.max(-MAP_W / 2, Math.min(MAP_W / 2, this.target.x));
    this.target.z = Math.max(-MAP_H / 2, Math.min(MAP_H / 2, this.target.z));
    this.updateCamera();
  }

  // CSS px relative to the canvas -> {x, y} tile or null
  pick(px, py) {
    if (!this.state) return null;
    const ndc = new THREE.Vector2((px / this.cssW) * 2 - 1, -(py / this.cssH) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects([this.tiles, this.buildingGroup], true)[0];
    if (!hit) return null;
    let i = hit.object === this.tiles ? hit.instanceId : null;
    for (let o = hit.object; i == null && o; o = o.parent) if (o.userData.tile != null) i = o.userData.tile;
    return i == null ? null : { x: i % MAP_W, y: Math.floor(i / MAP_W) };
  }

  // ----- state -> scene -----
  setState(state) {
    this.state = state;
    this.version++;
    if (state.seed !== this.seed) {
      this.seed = state.seed;
      for (const { obj } of this.buildings.values()) this.buildingGroup.remove(obj);
      this.buildings.clear();
    }
    this.rebuildTiles();
    this.rebuildDecor();
    this.rebuildBuildings();
    this.rebuildBorders();
  }

  rebuildTiles() {
    const { state } = this;
    const m = new THREE.Matrix4(), col = new THREE.Color(), owner = new THREE.Color();
    this.waterTiles = [];
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = idx(x, y), t = state.tiles[i];
        const [wx, wz] = world(x, y);
        const h = TOP[t] + 0.5;
        m.makeScale(1, h, 1).setPosition(wx, -0.5, wz);
        this.tiles.setMatrixAt(i, m);
        col.setHex(TILE_COLORS[t]).multiplyScalar((x + y) % 2 ? 1 : 0.93);
        const c = state.cells[i];
        if (c && state.players[c.o]) col.lerp(owner.set(state.players[c.o].color), 0.3);
        this.tiles.setColorAt(i, col);
        if (t === 'w') this.waterTiles.push([i, wx, wz, x, y]);
      }
    }
    this.tiles.instanceMatrix.needsUpdate = true;
    this.tiles.instanceColor.needsUpdate = true;
    this.water.count = this.waterTiles.length;
  }

  rebuildDecor() {
    const { state } = this;
    const m = new THREE.Matrix4();
    let trees = 0, peaks = 0;
    const tree = (wx, wz, top, s) => {
      m.makeScale(s, s, s).setPosition(wx, top, wz);
      this.trunks.setMatrixAt(trees, m);
      m.makeScale(s, s, s).setPosition(wx, top + 0.09 * s, wz);
      this.treeTops.setMatrixAt(trees++, m);
    };
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = idx(x, y), t = state.tiles[i], b = state.cells[i]?.t;
        const [wx, wz] = world(x, y);
        if (t === 'f') {
          const spots = b ? [[-0.32, -0.32]] : [[-0.2, -0.22], [0.22, -0.05], [-0.08, 0.24]];
          for (const [k, [ox, oz]] of spots.entries()) {
            tree(wx + ox + (jit(x, y, k) - 0.5) * 0.1, wz + oz + (jit(x, y, k + 5) - 0.5) * 0.1, TOP.f, 0.85 + jit(x, y, k + 9) * 0.35);
          }
        } else if (t === 'm' && b !== 'monument') {
          const s = b ? 0.55 : 0.85 + jit(x, y, 1) * 0.3;
          const ox = b ? -0.24 : (jit(x, y, 2) - 0.5) * 0.15, oz = b ? -0.24 : (jit(x, y, 3) - 0.5) * 0.15;
          m.makeScale(s, s, s).setPosition(wx + ox, TOP.m, wz + oz);
          this.peaks.setMatrixAt(peaks, m);
          m.makeScale(s, s, s).setPosition(wx + ox, TOP.m + 0.42 * s, wz + oz);
          this.snow.setMatrixAt(peaks++, m);
        }
      }
    }
    this.trunks.count = this.treeTops.count = trees;
    this.peaks.count = this.snow.count = peaks;
    for (const im of [this.trunks, this.treeTops, this.peaks, this.snow]) im.instanceMatrix.needsUpdate = true;
  }

  roadMask(i, owner) {
    const x = i % MAP_W, y = Math.floor(i / MAP_W);
    let mask = 0;
    DIRS.forEach(([dx, dy], k) => {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) return;
      if (this.state.cells[idx(nx, ny)]?.o === owner) mask |= 1 << k;
    });
    return mask;
  }

  rebuildBuildings() {
    const { state } = this;
    state.cells.forEach((c, i) => {
      const prev = this.buildings.get(i);
      if (!c) {
        if (prev) { this.buildingGroup.remove(prev.obj); this.buildings.delete(i); }
        return;
      }
      const color = state.players[c.o]?.color ?? '#ffffff';
      const mask = c.t === 'road' ? this.roadMask(i, c.o) : 0;
      const key = `${c.t}:${color}:${mask}`;
      if (prev?.key === key) return;
      if (prev) this.buildingGroup.remove(prev.obj);
      const obj = makeBuilding(c.t, color, mask);
      const [wx, wz] = world(i % MAP_W, Math.floor(i / MAP_W));
      obj.position.set(wx, topOf(state, i), wz);
      obj.rotation.y = c.t === 'road' ? 0 : this.facing(i);
      obj.userData.tile = i;
      this.buildingGroup.add(obj);
      this.buildings.set(i, { key, obj });
    });
  }

  // small deterministic variety in which way buildings face
  facing(i) {
    return Math.floor(jit(i % MAP_W, Math.floor(i / MAP_W), 7) * 4) * (Math.PI / 2);
  }

  rebuildBorders() {
    const { state } = this;
    const m = new THREE.Matrix4(), col = new THREE.Color();
    let n = 0;
    state.cells.forEach((c, i) => {
      if (!c) return;
      const x = i % MAP_W, y = Math.floor(i / MAP_W);
      const [wx, wz] = world(x, y);
      const top = topOf(state, i);
      col.set(state.players[c.o]?.color ?? '#ffffff');
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        const same = nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H && state.cells[idx(nx, ny)]?.o === c.o;
        if (same) continue;
        if (dx) m.makeScale(0.07, 0.05, 1).setPosition(wx + dx * 0.465, top, wz);
        else m.makeScale(1, 0.05, 0.07).setPosition(wx, top, wz + dy * 0.465);
        this.borders.setMatrixAt(n, m);
        this.borders.setColorAt(n++, col);
      }
    });
    this.borders.count = n;
    this.borders.instanceMatrix.needsUpdate = true;
    if (this.borders.instanceColor) this.borders.instanceColor.needsUpdate = true;
  }

  updateHighlights() {
    const { state, ui } = this;
    const key = `${this.version}:${ui?.selected}:${ui?.me}`;
    if (key === this.hlKey) return;
    this.hlKey = key;
    let n = 0;
    if (state && ui?.me && ui.selected) {
      const m = new THREE.Matrix4();
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          if (!canBuild(state, ui.me, ui.selected, x, y).ok) continue;
          const [wx, wz] = world(x, y);
          const i = idx(x, y);
          m.makeTranslation(wx, (state.tiles[i] === 'w' ? WATER_Y + 0.03 : TOP[state.tiles[i]]) + 0.005, wz);
          this.highlights.setMatrixAt(n++, m);
        }
      }
    }
    this.highlights.count = n;
    this.highlights.instanceMatrix.needsUpdate = true;
  }

  updateHover() {
    const { state, ui } = this;
    const hover = ui?.hover;
    if (!state || !hover) {
      this.hoverBox.visible = false;
      this.setGhost(null);
      return;
    }
    const i = idx(hover.x, hover.y);
    const [wx, wz] = world(hover.x, hover.y);
    const top = state.tiles[i] === 'w' && !state.cells[i] ? WATER_Y : topOf(state, i);
    const ok = ui.me && ui.selected && canBuild(state, ui.me, ui.selected, hover.x, hover.y).ok;
    this.hoverBox.visible = true;
    this.hoverBox.position.set(wx, top, wz);
    this.hoverBox.material.color.set(ok || !ui.selected ? 0xffffff : 0xff5a5a);
    if (ok) {
      const color = state.players[ui.me].color;
      const mask = ui.selected === 'road' ? this.roadMask(i, ui.me) : 0;
      this.setGhost(`${ui.selected}:${color}:${mask}:${i}`, () => {
        const g = makeBuilding(ui.selected, color, mask, true);
        g.position.set(wx, ui.selected === 'dock' ? WATER_Y : top, wz);
        if (ui.selected !== 'road') g.rotation.y = this.facing(i);
        return g;
      });
    } else this.setGhost(null);
  }

  setGhost(key, make) {
    if (key === this.ghostKey) return;
    if (this.ghost) this.scene.remove(this.ghost);
    this.ghost = key ? make() : null;
    this.ghostKey = key ?? '';
    if (this.ghost) this.scene.add(this.ghost);
  }

  // ----- per-frame -----
  frame() {
    const t = this.clock.getElapsedTime();
    if (Math.abs(this.azTarget - this.az) > 0.001) {
      this.az += (this.azTarget - this.az) * 0.15;
      this.updateCamera();
    }
    // water bob
    const m = new THREE.Matrix4();
    this.waterTiles.forEach(([, wx, wz, x, y], k) => {
      m.makeTranslation(wx, WATER_Y - 0.05 + Math.sin(t * 1.6 + x * 0.8 + y * 1.3) * 0.015, wz);
      this.water.setMatrixAt(k, m);
    });
    this.water.instanceMatrix.needsUpdate = true;
    // flags
    this.buildingGroup.traverse((o) => { if (o.userData.flag) o.rotation.y = Math.sin(t * 3 + o.parent.position.x) * 0.35; });
    // placement hints
    this.updateHighlights();
    this.highlights.material.opacity = 0.25 + 0.15 * Math.sin(t * 4);
    this.updateHover();

    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
    this.post.uniforms.tColor.value = this.rt.texture;
    this.post.uniforms.tDepth.value = this.rt.depthTexture;
    r.render(this.postScene, this.postCam);
  }

  // ----- pixel-art building icons for the UI, rendered with the same filter -----
  icon(type, color, terrain) {
    this.iconCache ??= new Map();
    const key = `${type}:${color}`;
    if (this.iconCache.has(key)) return this.iconCache.get(key);

    const S = 24;
    if (!this.iconScene) {
      this.iconScene = new THREE.Scene();
      this.iconScene.background = new THREE.Color(0x2f3540);
      this.iconScene.add(new THREE.HemisphereLight(0xdfefff, 0x4a3b2a, 1.6));
      const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
      sun.position.set(7, 14, 9);
      this.iconScene.add(sun);
      this.iconCam = new THREE.OrthographicCamera(-0.62, 0.62, 0.62, -0.62, 0.1, 50);
      this.iconCam.position.set(10 * Math.sin(Math.PI / 4), 7.5, 10 * Math.cos(Math.PI / 4));
      this.iconCam.lookAt(0, 0.22, 0);
      this.iconRT = makeTarget(S, S);
      this.iconOut = new THREE.WebGLRenderTarget(S, S);
    }
    const holder = new THREE.Group();
    const top = type === 'dock' ? WATER_Y : TOP[terrain];
    const tile = part(BOX(1, 1, 1), mat(TILE_COLORS[terrain]), 0, -0.5, 0);
    tile.scale.y = TOP[terrain] + 0.5;
    const b = makeBuilding(type, color, type === 'road' ? 0b0011 : 0);
    b.position.y = top;
    holder.add(tile, b);
    if (type === 'dock') holder.add(part(BOX(1, 0.05, 1), mat(0x4f9fe0), 0, WATER_Y - 0.05, 0));
    this.iconScene.add(holder);

    const r = this.renderer;
    const prevEdge = this.post.uniforms.edge.value;
    r.setRenderTarget(this.iconRT);
    r.render(this.iconScene, this.iconCam);
    this.post.uniforms.tColor.value = this.iconRT.texture;
    this.post.uniforms.tDepth.value = this.iconRT.depthTexture;
    this.post.uniforms.res.value.set(S, S);
    this.post.uniforms.edge.value = 0.06 / (this.iconCam.far - this.iconCam.near);
    r.setRenderTarget(this.iconOut);
    r.render(this.postScene, this.postCam);
    const buf = new Uint8Array(S * S * 4);
    r.readRenderTargetPixels(this.iconOut, 0, 0, S, S, buf);
    r.setRenderTarget(null);
    this.post.uniforms.res.value.set(this.rt.width, this.rt.height);
    this.post.uniforms.edge.value = prevEdge;
    this.iconScene.remove(holder);

    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const img = cv.getContext('2d').createImageData(S, S);
    for (let y = 0; y < S; y++) img.data.set(buf.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
    cv.getContext('2d').putImageData(img, 0, 0);
    this.iconCache.set(key, cv);
    return cv;
  }
}
