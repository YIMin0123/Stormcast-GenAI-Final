// 雨點打在地上（只有電腦有，手機只有 spray.js 的細水滴）：
//  - 皇冠：雨滴砸下去的那一瞬間彈起一圈幾公分高的薄水牆，邊上一根根尖刺，0.1 秒多就塌掉
//  - 漣漪：地面濕透、有積水的時候，落點再往外擴一圈淡淡的水紋
// 位置和時間在發射時寫一次，之後的動畫全在著色器裡算（不用每幀搬資料）。
import * as THREE from 'three';

export const RAIN_SPLASH = {
  crown: { w: 0.08, h: 0.06, life: 0.13 },   // 皇冠的寬、高（公尺）、多久塌掉（秒）
  ripple: { r: 0.16, life: 0.55, wet: 0.35 }, // 漣漪擴到多大、多久、地面濕到幾成才有
  max: 600,                                   // 同時最多幾個
};

const MIN_PX = 1.2;   // 遠處最細畫成幾個像素，再小就淡掉
const SEG = 14;       // 皇冠一圈切幾段（上緣每個點高高低低，就是一根根尖刺）

// 皇冠是真的一圈小水牆（立體的、有透視）：底下貼地、往上往外張開成喇叭口，上緣參差不齊
const crownVert = /* glsl */ `
attribute vec2 ring;     // x：這個點在圈上的角度；y：0 底、1 上緣
attribute vec4 iP;       // (x, y, z, 出生時間)
attribute float iSeed;
uniform float uNow, uScale;
varying float vT, vRow, vEdge, vA;
void main() {
  float t = (uNow - iP.w) / ${RAIN_SPLASH.crown.life.toFixed(3)};
  if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float s = 0.75 + 0.5 * iSeed;
  float w = ${(RAIN_SPLASH.crown.w / 2).toFixed(3)} * s, hgt = ${RAIN_SPLASH.crown.h.toFixed(3)} * s;
  float rise = sin(3.14159 * min(t * 1.25, 1.0));          // 先往上衝、再塌下去
  float ang = ring.x + iSeed * 6.2832;
  float k = mod(floor(ring.x * ${(SEG / (2 * Math.PI)).toFixed(5)} + 0.5), ${SEG.toFixed(1)});   // 第幾個點（接縫的頭尾是同一點）
  float spike = fract(sin(k * 12.9898 + iSeed * 78.233) * 43758.5453);   // 上緣每一點高低不同
  float R = w * (0.35 + 0.65 * sqrt(t)) * (1.0 + 0.45 * ring.y);              // 越往上越張開
  float H = hgt * rise * ring.y * (0.45 + 0.75 * spike * spike);
  vec3 n = vec3(cos(ang), 0.0, sin(ang));
  vec3 p = iP.xyz + n * R + vec3(0.0, H, 0.0);
  vec3 toCam = cameraPosition - p;
  float dist = length(toCam);
  float a = smoothstep(0.4, 1.2, dist);
  float px = w * 2.0 * uScale / dist;
  if (px < ${MIN_PX.toFixed(1)}) a *= px / ${MIN_PX.toFixed(1)};
  vEdge = 1.0 - abs(dot(normalize(n + vec3(0.0, -0.35, 0.0)), toCam / dist));   // 側著看的那兩邊是水牆的厚度，看起來亮
  vT = t; vRow = ring.y; vA = a;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

// 水是透明的：正對著看幾乎透過去，側邊和上緣（水膜捲起來的地方）反光
const crownFrag = /* glsl */ `
uniform vec3 uAmbient, uSunCol;
uniform float uGloom;
varying float vT, vRow, vEdge, vA;
void main() {
  float edge = vEdge * vEdge;
  float rim = smoothstep(0.55, 1.0, vRow);
  float a = (0.08 + 0.85 * edge + 0.45 * rim) * vA * (1.0 - vT * vT) * smoothstep(0.0, 0.15, vRow);
  if (a < 0.004) discard;
  vec3 light = max(0.62 * uAmbient + 0.38 * uSunCol * (1.0 - 0.8 * uGloom), vec3(0.20, 0.22, 0.26));
  vec3 col = mix(vec3(0.60, 0.68, 0.76), vec3(0.95, 0.96, 0.98), max(edge, rim)) * light;
  gl_FragColor = vec4(col, min(a, 1.0) * 0.6);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const rippleVert = /* glsl */ `
attribute vec2 corner;
attribute vec4 iP;
attribute float iSeed;
uniform float uNow, uScale;
varying vec2 vUv;
varying float vT, vA;
void main() {
  float t = (uNow - iP.w) / ${RAIN_SPLASH.ripple.life.toFixed(3)};
  if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float R = ${RAIN_SPLASH.ripple.r.toFixed(3)} * (0.7 + 0.6 * iSeed);
  float dist = length(cameraPosition - iP.xyz);
  float a = smoothstep(0.5, 1.5, dist) * smoothstep(14.0, 8.0, dist);
  float px = R * 2.0 * uScale / dist;
  if (px < 3.0) a *= px / 3.0;
  vec3 p = iP.xyz + vec3(corner.x * R, 0.006, corner.y * R);
  vUv = corner; vT = t; vA = a;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

// 漣漪：一圈細細的亮紋往外擴、越擴越淡（後面跟著第二圈更淡的）
const rippleFrag = /* glsl */ `
uniform vec3 uAmbient, uSunCol;
uniform float uGloom;
varying vec2 vUv;
varying float vT, vA;
void main() {
  float d = length(vUv);
  if (d > 1.0) discard;
  float r1 = sqrt(vT), r2 = r1 * 0.6;
  float ring = smoothstep(0.05, 0.0, abs(d - r1)) + 0.35 * smoothstep(0.04, 0.0, abs(d - r2));
  float a = ring * vA * (1.0 - vT) * (1.0 - vT) * 0.22;
  if (a < 0.004) discard;
  vec3 light = max(0.7 * uAmbient + 0.3 * uSunCol * (1.0 - 0.8 * uGloom), vec3(0.20, 0.22, 0.26));
  gl_FragColor = vec4(vec3(0.80, 0.86, 0.92) * light, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// 皇冠的一圈：SEG 段，每段兩個三角形（底、上緣各一排點）
function crownShape(g) {
  const v = [], idx = [];
  for (let i = 0; i <= SEG; i++) { const a = i / SEG * Math.PI * 2; v.push(a, 0, a, 1); }
  for (let i = 0; i < SEG; i++) { const b = i * 2; idx.push(b, b + 2, b + 3, b, b + 3, b + 1); }
  g.setAttribute('ring', new THREE.Float32BufferAttribute(v, 2));
  g.setIndex(idx);
}
function quadShape(g) {
  g.setAttribute('corner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
}

function pool(max, vert, frag, uniforms, flat) {
  const g = new THREE.InstancedBufferGeometry();
  (flat ? quadShape : crownShape)(g);
  const p = new Float32Array(max * 4).fill(-1e6), s = new Float32Array(max);
  g.setAttribute('iP', new THREE.InstancedBufferAttribute(p, 4).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(s, 1).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = max;
  const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: flat, polygonOffsetFactor: flat ? -2 : 0, polygonOffsetUnits: flat ? -2 : 0 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  let next = 0;
  return {
    mesh,
    emit(x, y, z, now) {
      const i = next; next = (i + 1) % max;
      p[i * 4] = x; p[i * 4 + 1] = y; p[i * 4 + 2] = z; p[i * 4 + 3] = now; s[i] = Math.random();
      g.attributes.iP.needsUpdate = true; g.attributes.iSeed.needsUpdate = true;
    },
  };
}

// light：場景共用的 uniform（uAmbient、uSunCol、uGloom）；scale：spray 的 uScale（距離 1 公尺時一公尺幾個像素）
export function makeRainSplash(light, scale) {
  const now = { value: 0 };
  const u = { uNow: now, uScale: scale, uAmbient: light.uAmbient, uSunCol: light.uSunCol, uGloom: light.uGloom };
  const crowns = pool(RAIN_SPLASH.max, crownVert, crownFrag, u, false);
  const ripples = pool(RAIN_SPLASH.max, rippleVert, rippleFrag, u, true);
  const group = new THREE.Group();
  group.add(crowns.mesh, ripples.mesh);
  let clock = 0;
  return {
    group,
    update(dt) { clock += dt; now.value = clock; },
    // 一滴雨打在 (x, y, z)；flat：落點是平的（才放得下漣漪）；wet：地面濕到幾成
    hit(x, y, z, flat, wet) {
      crowns.emit(x, y, z, clock);
      if (flat && wet > RAIN_SPLASH.ripple.wet && Math.random() < 0.55) ripples.emit(x, y, z, clock);
    },
  };
}
