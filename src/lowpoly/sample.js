// 低面樣品間：一小塊島（不規則三角形地形）、3 種形狀複用出來的岩塊、闊葉樹、針葉樹、草叢、一個人物大小的參考柱。
// 可以換色板、換時段、開關陰影、切換抗鋸齒，看全場只用一個材質時的繪製次數。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShadePass } from '../ao.js';
import { SunRaysPass } from '../glow.js';
import { rng, mirrored, makeMaterial, lpUniforms, FaceBuilder } from './kit.js';
import { palette, PALETTE_KEYS, jitter } from './palette.js';
import { rockGeo, broadleafGeo, tuftGeo, terrainGeo, waterGeo, heightAt, groundKind } from './shapes.js';

const $ = (id) => document.getElementById(id);
const isPhone = matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) < 820;

// ---- 畫面 ----
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(devicePixelRatio);   // 不降解析度
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xa8cbe0, 70, 300);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 1.2;
controls.maxDistance = 220;
controls.maxPolarAngle = Math.PI * 0.495;

const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -85, right: 85, top: 85, bottom: -85, near: 1, far: 320 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xbcd4e6, 0x6f6a55, 1.1);
scene.add(hemi);

const mat = makeMaterial();   // 全場唯一的材質

// 天空：上深下淺的漸層＋太陽（太陽夠亮，電腦加強的光暈會把它暈開）。alpha 寫 0，光束只從天空發出
const skyU = { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uSunK: { value: 1 } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 12), new THREE.ShaderMaterial({
  uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 uTop, uHorizon, uSunDir, uSunCol; uniform float uSunK; varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      vec3 c = mix(uHorizon, uTop, pow(max(d.y, 0.0), 0.55));
      float s = dot(d, uSunDir);
      c += uSunCol * (smoothstep(0.99935, 0.99965, s) * 7.0 + pow(max(s, 0.0), 80.0) * 0.35) * uSunK;
      gl_FragColor = vec4(c, 0.0);
    }`,
}));
sky.renderOrder = -1;
sky.frustumCulled = false;
scene.add(sky);

// ---- 場景內容（換色板、換擺法時整個重建）----
let group = null, templates = [];   // templates：{ mesh, tint }，「顯示複用」用
const state = { pal: 'warm', seed: 1, reuse: false, wire: false };

function place(mesh, list, cast, recv) {
  const m = new THREE.InstancedMesh(mesh, mat, Math.max(1, list.length));
  m.count = list.length;
  const q = new THREE.Quaternion(), qf = new THREE.Quaternion(), qy = new THREE.Quaternion(), M = new THREE.Matrix4();
  const col = new THREE.Color();
  list.forEach((t, i) => {
    qy.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
    qf.setFromAxisAngle(new THREE.Vector3(1, 0, 0), t.flip ? Math.PI : 0);
    q.multiplyQuaternions(qy, qf);
    M.compose(t.pos, q, t.scl);
    m.setMatrixAt(i, M);
    m.setColorAt(i, col.setScalar(t.tint ?? 1));
  });
  m.castShadow = cast; m.receiveShadow = recv;
  m.userData.tints = list.map((t) => t.tint ?? 1);
  group.add(m);
  return m;
}

function build() {
  if (group) { group.traverse((o) => o.geometry?.dispose()); scene.remove(group); }
  group = new THREE.Group();
  templates = [];
  const P = palette(state.pal);
  const r = rng(state.seed * 7919);

  const terrain = new THREE.Mesh(terrainGeo(P, 170, 2.8, 5), mat);
  terrain.castShadow = terrain.receiveShadow = true;
  const water = new THREE.Mesh(waterGeo(P), mat);
  water.receiveShadow = true;
  group.add(terrain, water);

  // ---- 岩塊：3 種形狀 × 原版／鏡像 = 6 份樣板 ----
  const rockGeos = [];
  for (let k = 0; k < 3; k++) { const g = rockGeo(k, P, 100 + k * 13); rockGeos.push(g, mirrored(g)); }
  const rockLists = rockGeos.map(() => []);
  const addRock = (kind, pos, scl, opt = {}) => {
    const mir = r() < 0.5 ? 1 : 0;
    rockLists[kind * 2 + mir].push({ pos, scl, rot: r() * Math.PI * 2, flip: opt.flip ?? r() < 0.35, tint: 0.9 + r() * 0.18 });
  };
  const randPt = () => { const x = (r() - 0.5) * 160, z = (r() - 0.5) * 160; return [x, z, heightAt(x, z)]; };
  // 岸邊：一堆一堆的扁塊和圓塊（壓扁、拉長），一半泡在水裡
  for (let tries = 0, made = 0; made < 38 && tries < 4000; tries++) {
    const [x, z, h] = randPt();
    if (h < -1.2 || h > 0.9) continue;
    made++;
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const px = x + (r() - 0.5) * 3, pz = z + (r() - 0.5) * 3, s = 0.7 + r() * 1.6;
      const kind = r() < 0.6 ? 2 : 0;
      const scl = new THREE.Vector3(s * (0.8 + r() * 0.6), s * (0.6 + r() * 0.5), s * (0.8 + r() * 0.6));
      addRock(kind, new THREE.Vector3(px, heightAt(px, pz) - scl.y * (0.15 + r() * 0.35), pz), scl);
    }
  }
  // 斷崖：拉高的岩柱貼著崖壁，深深埋進去
  for (let tries = 0, made = 0; made < 46 && tries < 6000; tries++) {
    const [x, z, h] = randPt();
    if (groundKind(x, z) !== 'cliff' || h < 1) continue;
    made++;
    const s = 1.2 + r() * 1.2;
    const scl = new THREE.Vector3(s * (0.7 + r() * 0.4), s * (1.6 + r() * 1.4), s * (0.7 + r() * 0.4));
    addRock(1, new THREE.Vector3(x, h - scl.y * (0.35 + r() * 0.25), z), scl, { flip: r() < 0.5 });
  }
  // 草地上零星幾顆圓塊
  for (let tries = 0, made = 0; made < 26 && tries < 4000; tries++) {
    const [x, z, h] = randPt();
    if (groundKind(x, z) !== 'grass') continue;
    made++;
    const s = 0.35 + r() * 0.8;
    addRock(r() < 0.7 ? 0 : 2, new THREE.Vector3(x, h - s * 0.35, z), new THREE.Vector3(s * (0.9 + r() * 0.4), s * (0.7 + r() * 0.5), s * (0.9 + r() * 0.4)));
  }
  rockGeos.forEach((g, i) => templates.push({ mesh: place(g, rockLists[i], true, true), hue: [0.0, 0.05, 0.33, 0.38, 0.6, 0.66][i] }));

  // ---- 樹：闊葉 3 種 × 原版／鏡像（使用者不要針葉樹）----
  const trees = [];
  const farFrom = (x, z, d) => trees.every((t) => (t.x - x) ** 2 + (t.z - z) ** 2 > d * d);
  const bGeos = [];
  for (let k = 0; k < 3; k++) { const g = broadleafGeo(P, 300 + k * 41); bGeos.push(g, mirrored(g)); }
  const bLists = bGeos.map(() => []);
  for (let tries = 0; tries < 9000 && trees.length < 120; tries++) {
    const [x, z, h] = randPt();
    if (groundKind(x, z) !== 'grass' || h < 1.8) continue;
    if (!farFrom(x, z, 4.6)) continue;
    trees.push({ x, z });
    const s = 0.8 + r() * 0.45;
    const t = { pos: new THREE.Vector3(x, h - 0.15, z), scl: new THREE.Vector3(s, s * (0.9 + r() * 0.25), s), rot: r() * Math.PI * 2, flip: false, tint: 0.92 + r() * 0.14 };
    bLists[Math.floor(r() * bGeos.length)].push(t);
  }
  bGeos.forEach((g, i) => templates.push({ mesh: place(g, bLists[i], true, true), hue: 0.1 + i * 0.13 }));

  // ---- 草叢：2 種，只在草地上；離鏡頭遠了縮小到消失 ----
  const tGeos = [tuftGeo(P, 700), tuftGeo(P, 701)];
  const tLists = tGeos.map(() => []);
  for (let tries = 0, made = 0; made < 7000 && tries < 40000; tries++) {
    const [x, z, h] = randPt();
    if (groundKind(x, z) !== 'grass') continue;
    made++;
    const s = 0.8 + r() * 0.6;
    tLists[made % 2].push({ pos: new THREE.Vector3(x, h - 0.05, z), scl: new THREE.Vector3(s, s * (0.8 + r() * 0.5), s), rot: r() * 6.28, flip: false, tint: 0.9 + r() * 0.2 });
  }
  tGeos.forEach((g, i) => templates.push({ mesh: place(g, tLists[i], false, true), hue: 0.5 + i * 0.05 }));

  // ---- 人物大小的參考（1.6 公尺）----
  const fb = new FaceBuilder();
  const body = new THREE.CapsuleGeometry(0.28, 1.04, 3, 7);
  body.translate(0, 0.8, 0);
  fb.addGeometry(body, (m, n, i) => jitter(P.fig, rng(i), 0.04));
  fig = new THREE.Mesh(fb.build(), mat);
  fig.castShadow = fig.receiveShadow = true;
  fig.position.copy(figPos);
  group.add(fig);

  scene.add(group);
  applyReuse();
  mat.wireframe = state.wire;
}

// 人物站的地方：島的南岸，高度約 1.3 公尺的沙灘
let fig = null;
const figPos = (() => {
  for (let z = 70; z > 0; z -= 0.25) { const h = heightAt(6, z); if (h > 1.3) return new THREE.Vector3(6, h, z); }
  return new THREE.Vector3(6, 2, 40);
})();

// 顯示複用：每一份樣板塗成不同顏色，看得出全場就這幾種形狀
function applyReuse() {
  const c = new THREE.Color();
  for (const t of templates) {
    const tints = t.mesh.userData.tints;
    for (let i = 0; i < t.mesh.count; i++) {
      if (state.reuse) c.setHSL(t.hue, 0.75, 0.55); else c.setScalar(tints[i]);
      t.mesh.setColorAt(i, c);
    }
    if (t.mesh.instanceColor) t.mesh.instanceColor.needsUpdate = true;
  }
}

// ---- 時段 ----
const C = (h) => new THREE.Color(h);
const SKY = { day: C('#c9dfeb'), dusk: C('#efb48f'), night: C('#212c44') };
const TOP = { day: C('#6fa6d6'), dusk: C('#8b86b5'), night: C('#0c1322') };
const sunDir = new THREE.Vector3();
const HEMI_SKY = { day: C('#c4d8e8'), dusk: C('#e6b6a2'), night: C('#33416a') };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function setHour(h) {
  state.hour = h;
  $('hourLab').textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;
  const ang = ((h - 6) / 12) * Math.PI, elev = Math.sin(ang);
  const day = smooth(-0.06, 0.22, elev), high = smooth(0.08, 0.6, elev);
  const night = 1 - day;
  // 白天是太陽，晚上同一盞燈當月光（從另一邊、偏藍、很弱）
  const dir = elev > -0.02
    ? new THREE.Vector3(Math.cos(ang) * 0.85, Math.max(elev, 0.05), 0.45)
    : new THREE.Vector3(-0.4, 0.75, -0.5);
  dir.normalize();
  sun.position.copy(dir).multiplyScalar(150);
  sun.target.position.set(0, 0, 0);
  const sunCol = C('#ff9d5c').lerp(C('#fff1da'), high);
  sun.color.copy(day > 0.02 ? sunCol : C('#9fb4e6'));
  sun.intensity = day > 0.02 ? 3.1 * day : 0.45;
  const sky = SKY.dusk.clone().lerp(SKY.day, high).lerp(SKY.night, night);
  hemi.color.copy(HEMI_SKY.dusk.clone().lerp(HEMI_SKY.day, high).lerp(HEMI_SKY.night, night));
  hemi.groundColor.copy(C('#6d6450').lerp(C('#151820'), night));
  hemi.intensity = 1.6 - 1.0 * night;
  scene.background = null;
  scene.fog.color.copy(sky);
  skyU.uHorizon.value.copy(sky);
  skyU.uTop.value.copy(TOP.dusk.clone().lerp(TOP.day, high).lerp(TOP.night, night));
  sunDir.set(Math.cos(ang) * 0.85, elev, 0.45).normalize();
  skyU.uSunDir.value.copy(sunDir);
  skyU.uSunCol.value.copy(sunCol);
  skyU.uSunK.value = smooth(-0.08, 0.02, elev);
  lpUniforms.uRimCol.value.copy(sunCol).multiplyScalar(day);
}

// ---- 抗鋸齒 ----
let composer = null, aoPass = null, rays = null, bloom = null;
function buildComposer() {
  composer?.dispose();
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: state.aa === 'msaa' ? 4 : 0, depthTexture: state.hi ? new THREE.DepthTexture(4, 4) : null });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  aoPass = rays = bloom = null;
  if (state.hi) {
    // 電腦加強：角落暗影（半解析度算）→ 陽光光束 → 光暈，都在轉成螢幕顏色之前
    aoPass = new ShadePass(scene, camera, 0.5);
    rays = new SunRaysPass();
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.45, 1.7);
    composer.addPass(aoPass);
    composer.addPass(rays);
    composer.addPass(bloom);
  }
  composer.addPass(new OutputPass());
  if (state.aa === 'fxaa') composer.addPass(new FXAAPass());
  if (state.aa === 'smaa') composer.addPass(new SMAAPass());
  composer.setPixelRatio(devicePixelRatio);
  composer.setSize(innerWidth, innerHeight);
}

// ---- 鏡頭 ----
const CAMS = {
  人物視角: () => { const f = figPos; camera.position.set(f.x + 4.5, f.y + 2.1, f.z + 1.5); controls.target.set(f.x - 10, f.y + 0.6, f.z - 3); },
  近看樹: () => { const f = figPos; camera.position.set(f.x - 6, f.y + 4, f.z - 6); controls.target.set(f.x - 14, f.y + 5, f.z - 20); },
  岩岸: () => { camera.position.set(-48, 6, 46); controls.target.set(-30, 0, 30); },
  斷崖: () => { camera.position.set(14, 12, 10); controls.target.set(0, 9, -14); },
  俯瞰: () => { camera.position.set(70, 95, 110); controls.target.set(0, 0, 0); },
};

// ---- 介面 ----
function segment(id, items, get, set) {
  const box = $(id);
  const btns = items.map(([v, label]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { set(v); sync(); };
    box.appendChild(b);
    return [v, b];
  });
  const sync = () => btns.forEach(([v, b]) => b.classList.toggle('on', get() === v));
  sync();
  return sync;
}
segment('pal', PALETTE_KEYS.map((k) => [k, palette(k).name]), () => state.pal, (v) => { state.pal = v; build(); });
const hourSync = segment('hours', [[6.4, '清晨'], [12, '正午'], [17.4, '黃昏'], [21.5, '夜晚']], () => state.hour, (v) => { setHour(v); $('hour').value = v; });
$('hour').oninput = (e) => { setHour(+e.target.value); hourSync(); };
segment('shadow', [[true, '開'], [false, '關']], () => state.shadow, (v) => { state.shadow = v; applyShadow(); });
segment('hi', [[true, '開'], [false, '關']], () => state.hi, (v) => { state.hi = v; applyHi(); });
segment('aa', [['fxaa', 'FXAA'], ['smaa', 'SMAA'], ['msaa', 'MSAA 4x'], ['off', '關（比較用）']], () => state.aa, (v) => { state.aa = v; buildComposer(); });
segment('cams', Object.keys(CAMS).map((k) => [k, k]), () => null, (k) => CAMS[k]());
const dbgSync = segment('dbg', [['reuse', '顯示複用'], ['wire', '看三角形'], ['seed', '換一組擺法']], () => null, (v) => {
  if (v === 'reuse') { state.reuse = !state.reuse; applyReuse(); }
  if (v === 'wire') { state.wire = !state.wire; mat.wireframe = state.wire; }
  if (v === 'seed') { state.seed++; build(); }
  dbgSync2();
});
const dbgSync2 = () => [...$('dbg').children].forEach((b, i) => b.classList.toggle('on', (i === 0 && state.reuse) || (i === 1 && state.wire)));
$('fold').onclick = () => { $('ui').classList.toggle('min'); $('fold').textContent = $('ui').classList.contains('min') ? '展開' : '收起'; };

// 電腦加強：後製三件＋邊緣光＋大一點的陰影貼圖＋草長得更遠＋看得更遠
function applyHi() {
  lpUniforms.uRim.value = state.hi ? 0.9 : 0;
  lpUniforms.uGrassNear.value = state.hi ? 46 : 22;
  lpUniforms.uGrassFar.value = state.hi ? 64 : 34;
  scene.fog.near = state.hi ? 90 : 60;
  scene.fog.far = state.hi ? 380 : 260;
  const ms = state.hi ? 3072 : 2048;
  if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  buildComposer();
}

function applyShadow() {
  renderer.shadowMap.enabled = state.shadow;
  sun.castShadow = state.shadow;
  mat.needsUpdate = true;
}

// ---- 開始 ----
state.shadow = !isPhone;   // 手機預設關陰影
state.aa = isPhone ? 'msaa' : 'smaa';
state.hi = !isPhone;   // 電腦預設開加強
state.hour = 16.8;
build();
setHour(state.hour);
$('hour').value = state.hour;
hourSync();
applyShadow();
segment; // （按鈕狀態在 segment 建立時已同步）
[...$('shadow').children].forEach((b, i) => b.classList.toggle('on', (i === 0) === state.shadow));
[...$('aa').children].forEach((b) => b.classList.toggle('on', b.textContent.toLowerCase().startsWith(state.aa === 'msaa' ? 'msaa' : state.aa)));
applyHi();
[...$('hi').children].forEach((b, i) => b.classList.toggle('on', (i === 0) === state.hi));
CAMS['人物視角']();
if (isPhone) $('fold').click();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---- 每幀 ----
const clock = new THREE.Clock();
let ema = 16, last = performance.now();
function frame() {
  const now = performance.now();
  ema += (now - last - ema) * 0.05; last = now;
  lpUniforms.uTime.value = clock.getElapsedTime();
  controls.update();
  sky.position.copy(camera.position);
  lpUniforms.uSunView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
  if (rays) {
    const p = camera.position.clone().addScaledVector(sunDir, 500).project(camera);
    rays.sun.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    rays.color.copy(skyU.uSunCol.value);
    const facing = camera.getWorldDirection(new THREE.Vector3()).dot(sunDir);
    rays.strength = 0.55 * smooth(0.15, 0.5, facing) * skyU.uSunK.value;
  }
  renderer.info.reset();
  composer.render();
  const inf = renderer.info.render;
  $('stats').textContent = `${(1000 / ema).toFixed(0)} fps  ${ema.toFixed(1)} ms\n繪製 ${inf.calls} 次\n三角形 ${(inf.triangles / 1000).toFixed(0)}k\n著色器 ${renderer.info.programs.length} 種\n解析度 ×${devicePixelRatio}`;
  requestAnimationFrame(frame);
}
frame();
window.__lp = { scene, camera, controls, renderer, state, setHour, build };
