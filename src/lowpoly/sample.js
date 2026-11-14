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
import { buildHarbor, harborHeight, onPlatform } from './harbor3d.js';
import { makeRealSea } from './realSea.js';
import * as HP from './harborPlan.js';
import { rockGeo, broadleafGeo, tuftGeo, terrainGeo, waterGeo, heightAt, groundKind } from './shapes.js';
import { buildHaven } from './haven3d.js';
import { buildArch, buildAtoll, buildBeacon } from './reefs3d.js';
import { archBed, atollBed, beaconBed } from './reefShape.js';
import { havenHeight, havenBed } from './havenShape.js';
import * as HV from './havenPlan.js';
import { WORLD } from '../config.js';
import { HAVEN, HOME_YAW } from '../frame.js';

const $ = (id) => document.getElementById(id);
const isPhone = matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) < 820;

// ---- 畫面 ----
const renderer = new THREE.WebGLRenderer({ antialias: false });
// 像素比：手機跟遊戲一樣用 1（遊戲從做手機版起就是這樣，見 main.js 的 ratioFor）；電腦照螢幕。?pr=數字 可以強制指定，比較用
const PR = +(new URLSearchParams(location.search).get('pr') || 0) || (isPhone ? 1 : devicePixelRatio);
renderer.setPixelRatio(PR);
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
const state = { refl: !isPhone /* 海面倒影：手機拿掉、電腦保留 */, sea: new URLSearchParams(location.search).get('sea') || (isPhone ? 'lite' : 'real'), pal: 'warm', seed: 1, reuse: false, wire: false, scene: new URLSearchParams(location.search).get('scene') || 'harbor' };

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

// 遊戲裡的海：每個場景各算一份（海床跟著島的形狀），算好就留著
const seas = {};
let sea = null;
function seaFor(scn) {
  const lite = state.sea === 'lite', key = scn + (lite ? '-lite' : '');
  if (!seas[key]) {
    // 大港灣島：浪向跟遊戲一樣（世界的浪向轉成大港座標）
    const waveAngle = HAVEN.headingToLocal(Math.PI / 2 + WORLD.waveFromHarborBackDeg * Math.PI / 180 - HOME_YAW);
    seas[key] = scn === 'haven' ? makeRealSea(renderer, { heightAt: havenBed, waveAngle, fft16: isPhone, lite })
      : scn === 'reefs' ? makeRealSea(renderer, { heightAt: reefsHeight, fft16: isPhone, lite })
      : scn === 'harbor'
      ? makeRealSea(renderer, { heightAt: (x, z) => (onPlatform(x, z) ? HP.DECK_Y : harborHeight(x, z)), quays: [[-48, -14, 48, 0], [-52.5, 0, -48, 44.5], [48, 0, 52.5, 44.5]], fft16: isPhone, lite })
      : makeRealSea(renderer, { heightAt, fft16: isPhone, lite });
    if (state.hour != null) seas[key].setHour(state.hour, sun.position.clone().normalize());
  }
  return seas[key];
}

function build() {
  if (group) {
    for (const k in seas) group.remove(seas[k].water);   // 海面留著重用，不要被清掉
    group.traverse((o) => o.geometry?.dispose());
    scene.remove(group);
  }
  sea = state.sea !== 'flat' ? seaFor(state.scene) : null;
  group = new THREE.Group();
  templates = [];
  const P = palette(state.pal);
  const r = rng(state.seed * 7919);

  if (state.sea !== 'flat') group.add(seaFor(state.scene).water);
  else {
    const water = new THREE.Mesh(waterGeo(P), mat);
    water.receiveShadow = true;
    group.add(water);
  }
  if (state.scene === 'harbor') buildHarbor({ P, r, place, mat, group, templates });
  else if (state.scene === 'haven') havenOut = buildHaven({ P, r, place, mat, group, phone: isPhone });
  else if (state.scene === 'reefs') buildReefs(P, r);
  else buildIsland(P, r);
  applyView();
  addFigure(P);
  scene.add(group);
  applyReuse();
  mat.wireframe = state.wire;
}

// 海上的礁石：三組排成一排（中間石拱門、左邊環礁、右邊燈標岩嶼），只是擺在一起看，遊戲裡的位置見 config.js
const REEF_AT = { arch: 0, atoll: -190, beacon: 150 };
const reefsHeight = (x, z) => Math.max(archBed(x - REEF_AT.arch, z), atollBed(x - REEF_AT.atoll, z), beaconBed(x - REEF_AT.beacon, z));
function buildReefs(P, r) {
  const sub = (x, f) => { const g = new THREE.Group(); g.position.x = x; const root = group; group = g; f({ P, r, place, mat, group: g, phone: isPhone }); group = root; group.add(g); };
  sub(REEF_AT.arch, buildArch); sub(REEF_AT.atoll, buildAtoll); sub(REEF_AT.beacon, buildBeacon);
}

// 看得多遠：大港灣島有四百多公尺寬，鏡頭、霧、天空、陰影的範圍都要跟著放大
let havenOut = null;
const big = () => state.scene === 'haven' || state.scene === 'reefs';
function applyView() {
  const k = big() ? 5 : 1;
  camera.far = 1200 * k; camera.updateProjectionMatrix();
  controls.maxDistance = big() ? 900 : 220;
  controls.maxPolarAngle = Math.PI * (big() ? 0.99 : 0.495);   // 大港灣島要能從洞裡往上看
  sky.scale.setScalar(k);
  const s = big() ? 290 : 85;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: big() ? 1300 : 320 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.fog.near = (state.hi ? 90 : 60) * (big() ? 4 : 1);
  scene.fog.far = (state.hi ? 380 : 260) * (big() ? 5 : 1);
  if (state.hour != null) sun.position.copy(sun.position).normalize().multiplyScalar(big() ? 600 : 150);
}

// 樣品島：不規則三角形地形、岩塊、樹、草
function buildIsland(P, r) {
  const terrain = new THREE.Mesh(terrainGeo(P, 170, 2.8, 5), mat);
  terrain.castShadow = terrain.receiveShadow = true;
  group.add(terrain);

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

}

// 人物大小的參考（1.6 公尺）
function addFigure(P) {
  const fb = new FaceBuilder();
  const body = new THREE.CapsuleGeometry(0.28, 1.04, 3, 7);
  body.translate(0, 0.8, 0);
  fb.addGeometry(body, (m, n, i) => jitter(P.fig, rng(i), 0.04));
  fig = new THREE.Mesh(fb.build(), mat);
  fig.castShadow = fig.receiveShadow = true;
  fig.position.copy(figAt());
  group.add(fig);
}
const figAt = () => (state.scene === 'harbor' ? new THREE.Vector3(HP.SPAWN.x, HP.DECK_Y, HP.SPAWN.z) : state.scene === 'reefs' ? new THREE.Vector3(REEF_AT.beacon + 2.5, beaconBed(2.5, 0), 0) : big() ? HAVEN_FIG() : figPos);
// 大港灣島的人：站在灣底整平的那一片（之後的碼頭）
const HAVEN_FIG = () => { const z = -72; return new THREE.Vector3(0, havenOut ? havenOut.groundAt(0, z) : havenHeight(0, z), z); };

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
  sun.position.copy(dir).multiplyScalar(big() ? 600 : 150);
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
  if (sea) sea.setHour(h, dir);
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
  composer.setPixelRatio(PR);
  composer.setSize(innerWidth, innerHeight);
}

// ---- 鏡頭 ----
const HARBOR_CAMS = {
  出生點: () => { const f = figAt(); camera.position.set(f.x + 1.8, f.y + 2.0, f.z - 0.6); controls.target.set(f.x - 1, f.y + 0.6, f.z + 14); },   // 在雨棚外面（雨棚到 z -3.6）
  鳥瞰: () => { camera.position.set(0, 70, 105); controls.target.set(0, 0, 6); },
  浮橋: () => { camera.position.set(0, 2.6, 30); controls.target.set(-10, 1, 8); },
  大船: () => { camera.position.set(-18, 3, 40); controls.target.set(-38, 2, 18); },
  後山: () => { camera.position.set(12, 6.5, -17); controls.target.set(0, 8, -34); },
  岸壁: () => { camera.position.set(30, 4, -2); controls.target.set(0, 2, -8); },
};
const ISLAND_CAMS = {
  人物視角: () => { const f = figPos; camera.position.set(f.x + 4.5, f.y + 2.1, f.z + 1.5); controls.target.set(f.x - 10, f.y + 0.6, f.z - 3); },
  近看樹: () => { const f = figPos; camera.position.set(f.x - 6, f.y + 4, f.z - 6); controls.target.set(f.x - 14, f.y + 5, f.z - 20); },
  岩岸: () => { camera.position.set(-48, 6, 46); controls.target.set(-30, 0, 30); },
  斷崖: () => { camera.position.set(14, 12, 10); controls.target.set(0, 9, -14); },
  俯瞰: () => { camera.position.set(70, 95, 110); controls.target.set(0, 0, 0); },
};
// 大港灣島（大港座標：+z 是灣口）
const HAVEN_CAMS = {
  鳥瞰: () => { camera.position.set(-150, 330, 420); controls.target.set(0, 10, 0); },
  從海上看灣口: () => { camera.position.set(-20, 9, 330); controls.target.set(0, 22, 60); },
  進港: () => { camera.position.set(0, 5, 150); controls.target.set(0, 14, 0); },
  灣底看出去: () => { const f = HAVEN_FIG(); camera.position.set(f.x + 6, f.y + 2.4, f.z - 6); controls.target.set(0, 12, 110); },
  灣底看山: () => { camera.position.set(0, 4, 0); controls.target.set(30, 34, -110); },
  外海看背面: () => { camera.position.set(140, 30, -360); controls.target.set(20, 26, -100); },
  海岬: () => { camera.position.set(-170, 16, 190); controls.target.set(-95, 30, 95); },
  山頂俯瞰: () => { camera.position.set(70, 84, -128); controls.target.set(0, 0, 60); },
  小河瀑布: () => { camera.position.set(-14, 46, -150); controls.target.set(0, 40, -123); },
  跳水台: () => { camera.position.set(HV.CAVE.x + 22, 46, HV.CAVE.z + 30); controls.target.set(HV.CAVE.x + 2, 34, HV.CAVE.z + 8); },
  天窗上面: () => { camera.position.set(HV.CAVE.x + 16, 52, HV.CAVE.z + 22); controls.target.set(HV.CAVE.x, 30, HV.CAVE.z); },
  洞裡仰望: () => { camera.position.set(HV.CAVE.x + 9, 1.6, HV.CAVE.z + 8); controls.target.set(HV.CAVE.x - 2, 26, HV.CAVE.z - 2); },
  洞裡看暗門: () => { camera.position.set(HV.CAVE.x + 10, 2, HV.CAVE.z + 12); controls.target.set(HV.CAVE.x - 7, 1, HV.CAVE.z - 28); },
  暗門外面: () => { camera.position.set(HV.CAVE.x - 16, 4, HV.CAVE.z - 66); controls.target.set(HV.CAVE.x - 7, 3, HV.CAVE.z - 29); },
  海蝕溝外海: () => { camera.position.set(HV.CAVE.x - 40, 14, HV.CAVE.z - 110); controls.target.set(HV.CAVE.x - 7, 6, HV.CAVE.z - 29); },
};
const REEF_CAMS = {
  石拱門: () => { camera.position.set(-6, 5, 70); controls.target.set(0, 12, 0); },
  拱門側面: () => { camera.position.set(-62, 14, 34); controls.target.set(0, 12, 0); },
  拱門底下: () => { camera.position.set(0, 3, 14); controls.target.set(2, 16, -6); },
  環礁: () => { camera.position.set(REEF_AT.atoll - 30, 26, 95); controls.target.set(REEF_AT.atoll, 0, 0); },
  沉船: () => { camera.position.set(REEF_AT.atoll + 38, 5, 16); controls.target.set(REEF_AT.atoll + 20, 1.5, -2); },
  燈標: () => { camera.position.set(REEF_AT.beacon + 26, 7, 30); controls.target.set(REEF_AT.beacon, 4, 0); },
  全部: () => { camera.position.set(-20, 150, 300); controls.target.set(-20, 0, 0); },
};
const CAMS = () => (state.scene === 'harbor' ? HARBOR_CAMS : state.scene === 'reefs' ? REEF_CAMS : big() ? HAVEN_CAMS : ISLAND_CAMS);
function makeCamButtons() {
  $('cams').innerHTML = '';
  segment('cams', Object.keys(CAMS()).map((k) => [k, k]), () => null, (k) => CAMS()[k]());
}

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
segment('scene', [['harbor', '港口島'], ['haven', '大港灣島'], ['reefs', '海上礁石'], ['island', '樣品島']], () => state.scene, (v) => { state.scene = v; build(); makeCamButtons(); Object.values(CAMS())[0](); });
segment('sea', [['real', '電腦版的海'], ['lite', '手機輕量版'], ['flat', '平塗']], () => state.sea, (v) => { state.sea = v; build(); setHour(state.hour); });
segment('refl', [[true, '開'], [false, '關']], () => state.refl, (v) => { state.refl = v; });
segment('pal', PALETTE_KEYS.map((k) => [k, palette(k).name]), () => state.pal, (v) => { state.pal = v; build(); });
const hourSync = segment('hours', [[6.4, '清晨'], [12, '正午'], [17.4, '黃昏'], [21.5, '夜晚']], () => state.hour, (v) => { setHour(v); $('hour').value = v; });
$('hour').oninput = (e) => { setHour(+e.target.value); hourSync(); };
segment('shadow', [[true, '開'], [false, '關']], () => state.shadow, (v) => { state.shadow = v; applyShadow(); });
segment('hi', [[true, '開'], [false, '關']], () => state.hi, (v) => { state.hi = v; applyHi(); });
segment('aa', [['fxaa', 'FXAA'], ['smaa', 'SMAA'], ['msaa', 'MSAA 4x'], ['off', '關（比較用）']], () => state.aa, (v) => { state.aa = v; buildComposer(); });
makeCamButtons();
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
  scene.fog.near = (state.hi ? 90 : 60) * (big() ? 4 : 1);
  scene.fog.far = (state.hi ? 380 : 260) * (big() ? 5 : 1);
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
Object.values(CAMS())[0]();
if (isPhone) $('fold').click();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---- 每幀 ----
const clock = new THREE.Clock();
let ema = 16, last = performance.now(), prevT = performance.now();
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
  if (sea) { sea.update(Math.min(0.05, (now - prevT) / 1000), controls.target, camera, sun); sea.reflect(state.refl, scene, camera, [sky]); }
  else renderer.clippingPlanes = [];
  prevT = now;
  renderer.info.reset();
  composer.render();
  if (sea) sea.check();
  const inf = renderer.info.render;
  $('stats').textContent = `${(1000 / ema).toFixed(0)} fps  ${ema.toFixed(1)} ms\n繪製 ${inf.calls} 次\n三角形 ${(inf.triangles / 1000).toFixed(0)}k\n著色器 ${renderer.info.programs.length} 種\n像素比 ×${PR}`;
  requestAnimationFrame(frame);
}
frame();
window.__lp = { scene, camera, controls, renderer, state, setHour, build, seas, cams: CAMS };
// 量測實際每幀成本（毫秒）：連續畫 n 幀、每幀等顯示晶片畫完（跟遊戲的 __sim.bench 一樣的量法，不受螢幕更新率限制）
window.__lp.bench = (n = 20) => {
  const gl = renderer.getContext(), px = new Uint8Array(4), t0 = performance.now();
  for (let i = 0; i < n; i++) {
    controls.update();
    sky.position.copy(camera.position);
    if (sea) { sea.update(1 / 60, controls.target, camera, sun); sea.reflect(state.refl, scene, camera, [sky]); }
    composer.render();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  }
  return (performance.now() - t0) / n;
};
// 測試用：從指定位置畫一張、直接拿圖（不受滑鼠操作影響）
window.__lp.snap = (pos, tgt) => {
  const p0 = camera.position.clone(), t0 = controls.target.clone();
  camera.position.set(...pos); camera.lookAt(...tgt); camera.updateMatrixWorld();
  sky.position.copy(camera.position);
  scene.background = skyU.uHorizon.value;   // 截圖時天空的 alpha 是 0，直接讀畫布會變黑：先墊一層地平線的顏色
  composer.render();
  scene.background = null;
  const url = renderer.domElement.toDataURL('image/jpeg', 0.85);
  camera.position.copy(p0); controls.target.copy(t0); camera.lookAt(t0);
  return url;
};
