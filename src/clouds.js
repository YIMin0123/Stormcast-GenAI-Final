// 晴天的積雲（手繪動畫背景那種：一朵一朵堆起來、平塗的色塊）。
// 做法參考 Painted valley（@blendi，MIT）：一朵雲是一堆球疊成的，載入時把整片天空的雲「畫」進一張環景圖，
// 之後每一幀只是查這張圖，再照當下的太陽打光（見 renderShaders.js 的 skyBase）。跟每一幀重算雜訊的舊雲比，幾乎不花效能。
// 圖裡存的不是顏色：RGB 是雲表面朝哪個方向（打光用），A 是這一點有沒有雲。所以太陽怎麼走、白天晚上，都不用重畫。
import * as THREE from 'three';

// 固定的亂數：每個人看到的雲都一樣
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_BALLS = 61;   // 一朵雲最多幾顆球（貼圖一列 64 格：前三格是整朵雲的資料）

// 一朵雲：az 在哪個方位、dist 多遠、base 雲底多高、w 多寬、h 堆多高（單位：公里，人在原點）
function heap(R, az, dist, base, w, h, n) {
  const cx = Math.cos(az) * dist, cz = Math.sin(az) * dist;
  const tx = -Math.sin(az), tz = Math.cos(az);   // 橫向（從人看過去的左右）
  const rx = Math.cos(az), rz = Math.sin(az);    // 縱深
  const balls = [];
  const peak = (R() - 0.5) * 0.7;                // 最高的那一團偏左還是偏右
  const top = (u) => h * Math.max(0, 1 - Math.abs(u - peak) ** 1.7 / (1 + Math.abs(peak)) ** 1.7) ** 0.75;   // 這個橫向位置可以堆到多高
  const add = (u, y, r, dep) => balls.push([cx + tx * u * w * 0.5 + rx * dep, base + y, cz + tz * u * w * 0.5 + rz * dep, r]);
  // 最底下一排：寬寬扁扁的，雲底才是連續的一條
  const r0 = Math.min(h * 0.30, w * 0.16);
  const nb = Math.max(3, Math.round(w / (r0 * 1.25)));
  for (let i = 0; i < nb; i++) {
    const u = -1 + 2 * (i + 0.5) / nb;
    add(u * 0.92, r0 * (0.35 + 0.25 * R()), r0 * (0.85 + 0.4 * R()) * (0.6 + 0.4 * Math.min(1, top(u) / (h * 0.5))), (R() - 0.5) * w * 0.18);
  }
  // 往上堆：越高的球越小，集中在最高的那一團附近
  while (balls.length < n * 0.7) {
    const u = (R() + R() + R()) / 1.5 - 1, H = top(u);
    if (H < h * 0.12) continue;
    const k = R() ** 0.8, y = k * H * 0.92;
    add(u, y, Math.max(h * 0.07, r0 * (1.25 - 0.75 * k) * (0.7 + 0.5 * R())), (R() - 0.5) * w * 0.22 * (1 - 0.5 * k));
  }
  // 輪廓上的小疙瘩：花椰菜那種一球一球的邊
  while (balls.length < n) {
    const u = (R() + R()) - 1, H = top(u);
    if (H < h * 0.15) continue;
    add(u + (R() - 0.5) * 0.08, H * (0.72 + 0.3 * R()), h * (0.05 + 0.07 * R()), (R() - 0.5) * w * 0.12);
  }
  // 包住整朵雲的大球（畫的時候先問這顆，沒碰到就整朵跳過）
  let mx = 0, my = 0, mz = 0;
  for (const b of balls) { mx += b[0]; my += b[1]; mz += b[2]; }
  mx /= balls.length; my /= balls.length; mz /= balls.length;
  let br = 0;
  for (const b of balls) br = Math.max(br, Math.hypot(b[0] - mx, b[1] - my, b[2] - mz) + b[3]);
  return { bound: [mx, my, mz, br], info: [base, balls.length, h, 0], core: [cx, base + h * 0.22, cz, 0], balls };
}

function layout(seed) {
  const R = rng(seed), heaps = [], TAU = Math.PI * 2;
  const ring = (count, dist, base, w, h, n, skip) => {
    const off = R() * TAU;
    for (let i = 0; i < count; i++) {
      if (R() < skip) continue;   // 留幾個缺口：不是一整圈牆
      const az = off + (i + (R() - 0.5) * 0.7) * TAU / count;
      heaps.push(heap(R, az, dist[0] + R() * (dist[1] - dist[0]), base[0] + R() * (base[1] - base[0]),
        w[0] + R() * (w[1] - w[0]), h[0] + R() ** 1.6 * (h[1] - h[0]), n));
    }
  };
  ring(13, [95, 120], [-1.2, -0.6], [36, 64], [9, 20], 46, 0.10);    // 最遠的一排：矮矮的，貼著地平線
  ring(11, [46, 64], [-0.6, -0.2], [22, 42], [9, 36], 60, 0.20);     // 地平線上的大積雲：有幾朵堆得特別高
  ring(9, [10, 17], [1.9, 2.5], [4.5, 8.5], [1.8, 4.2], 46, 0.25);   // 半空中的
  ring(5, [4.2, 6.5], [2.3, 2.8], [1.8, 3.2], [0.8, 1.6], 30, 0.2);  // 比較高、比較近的小朵
  return heaps;
}

const bakeVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const bakeFrag = /* glsl */ `
precision highp float;
uniform sampler2D uHeaps;   // 一列一朵雲：[0] 外接球、[1] (雲底高度, 球數, 雲高)、[2] 雲的重心、[3..] 每顆球 (中心, 半徑)
uniform int uCount;
varying vec3 vDir;

// 從原點往 d 看出去，最先碰到哪朵雲的哪裡。回傳 (表面的方向, 有沒有碰到)
vec4 trace(vec3 d) {
  float best = 1e9;
  vec3 bn = vec3(0.0);
  for (int i = 0; i < uCount; i++) {
    vec4 bs = texelFetch(uHeaps, ivec2(0, i), 0);
    float bb = dot(d, bs.xyz);
    if (bb < 0.0 || bb * bb - dot(bs.xyz, bs.xyz) + bs.w * bs.w < 0.0) continue;
    vec4 inf = texelFetch(uHeaps, ivec2(1, i), 0);
    // 雲底是平的：視線要先穿過雲底那個高度才算進到雲裡
    float tb = 0.0;
    if (inf.x > 0.0) { if (d.y < 1e-4) continue; tb = inf.x / d.y; }
    vec3 core = texelFetch(uHeaps, ivec2(2, i), 0).xyz;
    int n = int(inf.y);
    for (int j = 0; j < n; j++) {
      vec4 s = texelFetch(uHeaps, ivec2(3 + j, i), 0);
      float b = dot(d, s.xyz), disc = b * b - dot(s.xyz, s.xyz) + s.w * s.w;
      if (disc < 0.0) continue;
      float sq = sqrt(disc), t0 = b - sq, t1 = b + sq, te = max(t0, tb);
      if (te >= t1 || te <= 0.0 || te >= best) continue;
      best = te;
      vec3 p = d * te;
      if (t0 < tb) { bn = vec3(0.0, -1.0, 0.0); continue; }   // 從雲底看進去：朝下的平面
      // 打光用的方向：這顆球自己的弧度，加上整朵雲的大弧度（亮暗才會是一大塊一大塊，不是每顆球各一道月牙），
      // 再照高度偏一點：頂端朝上（亮）、靠近雲底朝下（暗）
      float hh = clamp((p.y - inf.x) / inf.z, 0.0, 1.0);
      bn = normalize((p - s.xyz) / s.w * 0.42 + normalize(p - core) * 0.58 + vec3(0.0, (hh - 0.42) * 0.7, 0.0));
    }
  }
  return vec4(bn, best < 1e8 ? 1.0 : 0.0);
}

void main() {
  // 一格取四個點平均：雲的邊緣才不會是鋸齒
  vec3 dx = dFdx(vDir), dy = dFdy(vDir), n = vec3(0.0);
  float a = 0.0;
  const vec2 OFF[4] = vec2[4](vec2(-0.375, -0.125), vec2(0.125, -0.375), vec2(0.375, 0.125), vec2(-0.125, 0.375));
  for (int k = 0; k < 4; k++) {
    vec4 h = trace(normalize(vDir + dx * OFF[k].x + dy * OFF[k].y));
    n += h.xyz * h.w; a += h.w;
  }
  n = a > 0.0 ? normalize(n) : vec3(0.0);
  gl_FragColor = vec4(n * 0.5 + 0.5, a * 0.25);
}
`;

// 把雲畫進一張環景圖（立方體六個面，每面 size × size）。回傳 { texture, dispose }
export function bakeClouds(renderer, size = 1024, seed = 20261112) {
  const heaps = layout(seed);
  const W = 64, data = new Float32Array(W * heaps.length * 4);
  heaps.forEach((hp, i) => {
    const row = i * W * 4;
    data.set(hp.bound, row); data.set(hp.info, row + 4); data.set(hp.core, row + 8);
    hp.balls.slice(0, MAX_BALLS).forEach((b, j) => data.set(b, row + 12 + j * 4));
    data[row + 5] = Math.min(hp.balls.length, MAX_BALLS);
  });
  const tex = new THREE.DataTexture(data, W, heaps.length, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  const rt = new THREE.WebGLCubeRenderTarget(size, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  const mat = new THREE.ShaderMaterial({ vertexShader: bakeVert, fragmentShader: bakeFrag, uniforms: { uHeaps: { value: tex }, uCount: { value: heaps.length } }, side: THREE.BackSide, depthTest: false, depthWrite: false });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mat));
  const cam = new THREE.CubeCamera(0.1, 10, rt);
  const tm = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  cam.update(renderer, scene);
  renderer.toneMapping = tm;
  tex.dispose(); mat.dispose();
  return { texture: rt.texture, size, dispose: () => rt.dispose() };
}
