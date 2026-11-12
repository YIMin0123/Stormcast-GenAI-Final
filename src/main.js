import * as THREE from 'three';
import { makeTerrain, computeShelter, computeShoreDist, ISLANDS } from './terrain.js';
import { waterVert, waterFrag, terrainVert, terrainFrag, grassVert, grassFrag, skyVert, skyFrag, HAZE, RAIN_HAZE } from './renderShaders.js';
import { FftOcean, makeFoamTexture } from './ocean.js';
import { Boat, BOAT_TYPES, BOX_CAP } from './boat.js';
import { BOAT_ORDER, CAN, newKit, shopItem } from './boatdata.js';
import { Player } from './player.js';
import { ShallowWater, SWE } from './shallow.js';
import { makeSwimFx } from './swimfx.js';
import { makeHarbor, PILES, SOLIDS, WALLS, DECKS, HARBOR_ROCKS, EXTRA_LAMPS, POOLS, GLOW, DECK_Y, SHOP, LIGHTHOUSE, SELL, setBoard, BOLLARDS, MoorLine, SHELF, SHELF_X, SHELF_Z, setTag, PLAYER_SPAWN, onDeck, LAMPS, UNLIT, WET } from './harbor.js';
import { BERTHS, berthPose, pontoonY, PONTOON_Y, inHarbor, BOARDS, BOARD_Z } from './layout.js';
import { fishLabel, FishWorld } from './fish.js';
import { money as cash } from './fishdata.js';
import { Fishing } from './fishing.js';
import { EmoteWheel } from './emotes.js';
import { TOUCH, TouchUI, touchText, touchSet, canFullscreen, isFullscreen, setFullscreen } from './touch.js';
import { REFL, addOutline, BULBS, softDisc } from './toon.js';   // 它會改掉內建材質的受光算法（改成手繪風）
import { makeScenery } from './scenery.js';
import { makeGroundDetail, makeGrassGeometry, WIND, SIGHT } from './foliage.js';
import { Spray } from './spray.js';
import { OceanAudio } from './audio.js';
import { Sea, Climate, computeDanger, computeOffshore, computeTsuK, TSU, SWELL, swellAt, WAVE_LOOP } from './weather.js';
import { Rain, Bolt, Spindrift, Spout, WaveSpray } from './skyfx.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SunRaysPass } from './glow.js';
import { ShadePass } from './ao.js';
import { Net, TEST } from './net.js';
import { Others } from './others.js';
import { Chat } from './chat.js';
import { Boards } from './boards.js';
import { runMenu } from './menu.js';
import { restyle } from './figure.js';
import { myLook, setMyLook } from './look.js';

// ---- 世界參數 -------------------------------------------------------------
const N = 512;          // 避浪、危險度這些粗略資料的解析度（4 m 一格）
const NF = 1024;        // 地形高度的解析度（2 m 一格）：海岸線才圓順
const L = 2048;         // 地圖邊長（公尺）
const DX = L / NF;      // 2 m
const WAVE_ANGLE = Math.PI / 2 + 0.15; // 風浪由北往南傳，母港在島的南側背風面
const HS = 2.2;         // 風浪強度 1.0 時的示性波高（公尺）

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r2 = (v) => Math.round(v * 100) / 100;

function fail(msg) {
  const el = $('err');
  el.style.display = 'flex';
  el.textContent = msg;
  throw new Error(msg);
}

// ---- Renderer -------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: false });   // 抗鋸齒改由後製的 FXAA 負責（內顯上比多重取樣省很多）
// 畫質由玩家自己在設定裡調，不會自動變，調過的記在瀏覽器裡（?test 分頁只記在那個分頁）：
//   解析度：沒調過的話，電腦跟著螢幕的縮放比例走（筆電常見 1.25、1.5 倍，畫面才不會被放大而糊掉）；
//           手機的螢幕很密、顯示晶片弱，用 1 倍
//   畫質等級：手機／低／中／高，管陰影的細緻度、草的數量、角落的暗影（AO）、濕地板的倒影、光暈和陽光光束。
//           電腦預設高；手機預設低，第一次進遊戲時量幾秒幀率，太慢就自動換成「手機」（只有沒調過的人才會換，換完就記住）。
//           「手機」這一檔不降解析度，省的是特效：沒有光暈、光束，陰影貼圖小一點、範圍收窄、取樣點減半，草少一半
const prefStore = (() => { try { return TEST ? window.sessionStorage : window.localStorage; } catch { return null; } })();
const getPref = (k) => { try { return prefStore ? prefStore.getItem(k) : null; } catch { return null; } };
const setPref = (k, v) => { try { if (prefStore) prefStore.setItem(k, String(v)); } catch { /* 存不了就下次重調 */ } };
const ratioFor = () => (TOUCH ? 1 : Math.round(clamp(window.devicePixelRatio || 1, 1, 1.5) * 10) / 10);
const RATIO_MAX = Math.round(clamp(window.devicePixelRatio || 1, 1.5, 2) * 10) / 10;
let BASE_RATIO = ratioFor();
let ratioSaved = parseFloat(getPref('stormcast.res')) >= 0.5;
let pixelRatio = ratioSaved ? clamp(parseFloat(getPref('stormcast.res')), 0.5, RATIO_MAX) : BASE_RATIO;
const GFX = [
  { name: '手機', shadow: 1024, shadowHalf: 40, grass: 3000, ao: false, wet: false, post: false, lite: true },
  { name: '低', shadow: 1536, shadowHalf: 54, grass: 6000, ao: false, wet: false, post: true, lite: false },
  { name: '中', shadow: 2048, shadowHalf: 54, grass: 10000, ao: true, wet: false, post: true, lite: false },
  { name: '高', shadow: 3072, shadowHalf: 54, grass: 14000, ao: true, wet: true, post: true, lite: false },
];
// 以前只有低中高三檔（0–2，存在 stormcast.gfx），現在前面多了「手機」，舊的設定往後挪一格
const oldGfx = getPref('stormcast.gfx'), newGfx = getPref('stormcast.gfx2');
let gfxSaved = /^[0-3]$/.test(newGfx || '') || /^[012]$/.test(oldGfx || '');
let gfxLv = /^[0-3]$/.test(newGfx || '') ? +newGfx : /^[012]$/.test(oldGfx || '') ? +oldGfx + 1 : TOUCH ? 1 : 3;
let gfx = GFX[gfxLv];
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);
const canvas = renderer.domElement;

// 要能畫進浮點貼圖：32 位元的最好；不少手機只支援 16 位元的，海浪模擬會退回 16 位元（見 ocean.js），一樣能玩。
// ?halffloat：在電腦上假裝不支援 32 位元，測試退路
if (new URLSearchParams(window.location.search).has('halffloat')) renderer.extensions.get = ((get) => (n) => (n === 'EXT_color_buffer_float' || n === 'OES_texture_float_linear' ? null : get(n)))(renderer.extensions.get.bind(renderer.extensions));
if (new URLSearchParams(window.location.search).has('halffloat')) renderer.extensions.has = ((has) => (n) => (n === 'EXT_color_buffer_float' || n === 'OES_texture_float_linear' ? false : has(n)))(renderer.extensions.has.bind(renderer.extensions));
if (!renderer.capabilities.isWebGL2 || !(renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'))) {
  fail('這個瀏覽器或顯示卡不支援浮點數渲染目標（WebGL2 + EXT_color_buffer_float／half_float），無法執行。');
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 90000);

// ---- 地圖 -----------------------------------------------------------------
const bedData = makeTerrain(NF, L).bed;
// 粗一半的版本（每 2×2 格取平均），給避浪、危險度、種樹用
const bedCoarse = new Float32Array(N * N);
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const k = 2 * j * NF + 2 * i;
    bedCoarse[j * N + i] = (bedData[k] + bedData[k + 1] + bedData[k + NF] + bedData[k + NF + 1]) / 4;
  }
}
const shelterData = computeShelter(bedCoarse, N, L, WAVE_ANGLE);

const bedTex = new THREE.DataTexture(bedData, NF, NF, THREE.RedFormat, THREE.FloatType);
bedTex.minFilter = bedTex.magFilter = THREE.NearestFilter;
bedTex.needsUpdate = true;
const shelterTex = new THREE.DataTexture(shelterData, N, N, THREE.RedFormat, THREE.UnsignedByteType);
shelterTex.minFilter = shelterTex.magFilter = THREE.LinearFilter;
shelterTex.needsUpdate = true;

// 離陸地越遠越危險：風暴與巨浪只在外海發威，島的周圍與港口不受影響
const dangerData = computeDanger(bedCoarse, N, L);
const offData = computeOffshore(bedCoarse, N, L);   // 每一格離最近的陸地幾公尺
const dangerTex = new THREE.DataTexture(dangerData, N, N, THREE.RedFormat, THREE.UnsignedByteType);
dangerTex.minFilter = dangerTex.magFilter = THREE.LinearFilter;
dangerTex.needsUpdate = true;

// 巨浪到了每個地方還剩幾成高：外海十成，岸邊剩一成多，沖上岸之後往內陸遞減
const tsuKData = computeTsuK(bedCoarse, dangerData, N, L);
const tsuKTex = new THREE.DataTexture(tsuKData, N, N, THREE.RedFormat, THREE.UnsignedByteType);
tsuKTex.minFilter = tsuKTex.magFilter = THREE.LinearFilter;
tsuKTex.needsUpdate = true;

// 離岸距離：岸邊的浪朝著岸捲過去用的
const shoreTex = new THREE.DataTexture(Uint16Array.from(computeShoreDist(bedData, NF, L), (v) => THREE.DataUtils.toHalfFloat(v)), NF, NF, THREE.RedFormat, THREE.HalfFloatType);
shoreTex.minFilter = shoreTex.magFilter = THREE.LinearFilter;
shoreTex.needsUpdate = true;

// 在任意位置對網格資料做雙線性取樣
function sampleGrid(arr, x, z, n = N) {
  const gx = clamp((x / L + 0.5) * n - 0.5, 0, n - 1.001), gz = clamp((z / L + 0.5) * n - 0.5, 0, n - 1.001);
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * n + i;
  return (arr[k] * (1 - fx) + arr[k + 1] * fx) * (1 - fz) + (arr[k + n] * (1 - fx) + arr[k + n + 1] * fx) * fz;
}
const bedAt = (x, z) => sampleGrid(bedData, x, z, NF);
const shelterAt = (x, z) => sampleGrid(shelterData, x, z) / 255;
const dangerAt = (x, z) => sampleGrid(dangerData, x, z) / 255;
const offAt = (x, z) => sampleGrid(offData, x, z);
const tsuKAt = (x, z) => sampleGrid(tsuKData, x, z) / 255;

// 商店與櫃檯、燈塔：玩家走不進去
const BLOCKS = [
  { x0: SHOP.x - SHOP.w / 2 - 0.3, x1: SHOP.x + SHOP.w / 2 + 0.3, z0: SHOP.z - SHOP.d / 2 - 0.3, z1: SHOP.z + SHOP.d / 2 + 0.3 },
  { x0: SHOP.x - 0.4, x1: SHOP.x + 3.6, z0: SHOP.z + SHOP.d / 2, z1: SHOP.z + SHOP.d / 2 + 1.1 },
  { x0: SELL.basket.x - 0.5, x1: SELL.basket.x + 0.5, z0: SELL.basket.z - 0.5, z1: SELL.basket.z + 0.5 },   // 籃子
  { x0: SELL.button.x - 0.2, x1: SELL.button.x + 0.2, z0: SELL.button.z - 0.2, z1: SELL.button.z + 0.2 },   // 按鈕柱
  { x0: SHELF_X[0], x1: SHELF_X[1], z0: SHELF_Z - 0.65, z1: SHELF_Z + 0.65 },   // 商品架的長桌
  ...WALLS,   // 防波堤的胸牆、魚市場的魚箱堆、自動販賣機、晒網架
];
// 大石頭：用格子分區，查詢某個位置有沒有石頭擋著（回傳石頭頂端的高度，沒有就是 null）
const ROCK_CELL = 8, rockGrid = new Map();
function addRocks(list) {
  for (const r of list) {
    for (let gx = Math.floor((r.x - r.r) / ROCK_CELL); gx <= Math.floor((r.x + r.r) / ROCK_CELL); gx++) {
      for (let gz = Math.floor((r.z - r.r) / ROCK_CELL); gz <= Math.floor((r.z + r.r) / ROCK_CELL); gz++) {
        const k = gx * 4096 + gz;
        if (!rockGrid.has(k)) rockGrid.set(k, []);
        rockGrid.get(k).push(r);
      }
    }
  }
}
function rockAt(x, z) {
  const cell = rockGrid.get(Math.floor(x / ROCK_CELL) * 4096 + Math.floor(z / ROCK_CELL));
  if (!cell) return null;
  let top = null;
  for (const r of cell) if ((x - r.x) ** 2 + (z - r.z) ** 2 < r.r * r.r && (top === null || r.top > top)) top = r.top;
  return top;
}

// 玩家腳下的高度：棧板、地面，或擋路的牆（回傳很高的值）
function walkGround(x, z, under = false) {
  for (const r of BLOCKS) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return 99;
  if (rockAt(x, z) !== null) return 99;
  if (Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.z) < LIGHTHOUSE.r) return 99;
  if (!under) for (const c of SOLIDS) if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) return 99;   // 棧板上的樁、燈柱、木桶…（在棧板底下游泳時不算）
  if (onDeck(x, z)) return under ? 99 : DECK_Y;   // 岸壁和防波堤是實心的：游泳的人鑽不到底下
  const py = pontoonY(x, z);
  // 浮在水上的浮橋鑽不過去；從岸壁斜下來的跳板底下是空的，離水面還有一點高度的地方游得過去
  if (py !== null) return !under ? py : py > PONTOON_Y + 0.05 && py > playerWater(x, z) + 0.6 ? bedAt(x, z) : 99;
  return bedAt(x, z);
}
// 船眼中的地面：棧橋也算障礙物
const boatGround = (x, z) => {
  if (onDeck(x, z, 0.4) || pontoonY(x, z, 0.3) !== null) return DECK_Y;
  const rk = rockAt(x, z);
  return rk === null ? bedAt(x, z) : Math.max(bedAt(x, z), rk);
};

// ---- 場景物件 -------------------------------------------------------------
// 地形網格：高度與法線直接放進頂點；深海的格子不畫（反正看不到）
function makeTerrainGeometry() {
  const n = NF, at = (i, j) => bedData[clamp(j, 0, n - 1) * n + clamp(i, 0, n - 1)];
  // 先挑出要畫的格子，只替用得到的頂點建資料（大部分的地圖是深海）
  const slot = new Int32Array(n * n).fill(-1), idx = [];
  let count = 0;
  const use = (k) => (slot[k] < 0 ? (slot[k] = count++) : slot[k]);
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + n, c = a + 1, d = b + 1;
      if (Math.max(bedData[a], bedData[b], bedData[c], bedData[d]) < -26) continue;
      idx.push(use(a), use(b), use(c), use(b), use(d), use(c));
    }
  }
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const sl = slot[j * n + i];
      if (sl < 0) continue;
      const k = sl * 3;
      pos[k] = ((i + 0.5) / n - 0.5) * L; pos[k + 1] = at(i, j); pos[k + 2] = ((j + 0.5) / n - 0.5) * L;
      const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * DX), gz = (at(i, j + 1) - at(i, j - 1)) / (2 * DX);
      const inv = 1 / Math.hypot(gx, 1, gz);
      nor[k] = -gx * inv; nor[k + 1] = inv; nor[k + 2] = -gz * inv;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  return g;
}

// 海面網格：以鏡頭注視點為中心的極座標網格，近處密、遠處疏，一路鋪到地平線
function makePolarGeometry(nA = 384, nR = 420, r0 = 0.8, rMax = 34000) {
  const pos = new Float32Array((1 + nA * nR) * 3);
  for (let i = 0; i < nR; i++) {
    const r = r0 * Math.pow(rMax / r0, i / (nR - 1));
    for (let j = 0; j < nA; j++) {
      const a = (j / nA) * Math.PI * 2, k = (1 + i * nA + j) * 3;
      pos[k] = r * Math.cos(a); pos[k + 2] = r * Math.sin(a);
    }
  }
  const idx = new Uint32Array(nA * 3 + (nR - 1) * nA * 6);
  let t = 0;
  for (let j = 0; j < nA; j++) { idx[t++] = 0; idx[t++] = 1 + ((j + 1) % nA); idx[t++] = 1 + j; }
  for (let i = 0; i < nR - 1; i++) {
    for (let j = 0; j < nA; j++) {
      const a = 1 + i * nA + j, b = 1 + i * nA + ((j + 1) % nA), c = a + nA, d = b + nA;
      idx[t++] = a; idx[t++] = b; idx[t++] = c;
      idx[t++] = b; idx[t++] = d; idx[t++] = c;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

const ocean = new FftOcean(renderer, { hs: HS, windAngle: WAVE_ANGLE });
const sunDir = new THREE.Vector3(-0.5, 0.52, 0.6).normalize(); // 太陽在西南方，店面與碼頭是向陽面
const wake = Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, -1e6, 0));

// ---- 海況：平常是普通風浪，偶爾來一場風暴或幾道巨浪 ---------------------------
const sea = new Sea();
const climate = new Climate();   // 時間與每天的天氣
sea.remote = climate.remote = true;   // 時間、天氣、海上事件都聽伺服器的（這裡只負責演出來）
const seaEnv = { near: { x: 0, z: 0 }, dangerAt };   // 給海上事件用：玩家的船在哪、哪裡算外海
let wind = climate.wind;         // 今天的風浪強度（由天氣決定，慢慢變）
// 這裡的風浪比平常大幾倍（風暴時外海變大，颱風時連島邊也變大）；與 shader 的 waveScale() 一致
const FAR_SEA = 0.8;   // 離陸地越遠浪越大：島周圍 60 公尺內是原本的大小，到 320 公尺外多八成
const stormK = (x, z) => {
  const d = dangerAt(x, z);
  return Math.min(1 + FAR_SEA * d + sea.storm * (d + (1 - d) * sea.surge), 3.4 / Math.max(ocean.scale, 0.1));
};
const waveK = (x, z) => shelterAt(x, z) * stormK(x, z);
// 巨浪在這裡的高度：外海是整道水牆，靠岸變矮，沖上岸、淹進港口（浪腳前面是負的：海水先退下去）
const surgeAt = (x, z) => { if (!sea.tsu.on) return 0; const k = tsuKAt(x, z); return sea.heightCurl(x, z, k, shared.uTime.value) * k + sea.ebbAt(x, z, k); };
// 風浪以外的水面起伏：巨浪的浪牆、漩渦的漏斗、水龍捲腳下的隆起
const WDX = Math.cos(WAVE_ANGLE), WDZ = Math.sin(WAVE_ANGLE);
// 風：平常每秒幾公尺，風暴二十上下，颱風平均三十幾、陣風五十。v 是當下的風速（含陣風），x、z 是它的向量
const gale = { v: 3, x: WDX * 3, z: WDZ * 3, steady: 3 };
const windK = (x, z) => 0.5 + 0.5 * shelterAt(x, z);   // 島的背風面風小一半（雨、風聲、飛沫用；船受的風另外算，港內吹不動船）
// 颱風的長浪在這裡的高度（外海才有，靠近島就消掉；跟 shader 的 swellK() × longSwell() 一致）
const swellAmp = (x, z) => {
  if (sea.swell < 0.01) return 0;
  const d = clamp((dangerAt(x, z) - 0.15) / 0.7, 0, 1);
  return SWELL.amp * sea.swell * d * d * (3 - 2 * d) * (0.35 + 0.65 * shelterAt(x, z));
};
const swellH = (x, z) => {
  const a = swellAmp(x, z);
  return a > 0 ? a * swellAt(x, z, shared.uTime.value, WDX, WDZ) : 0;
};
const tsuAt = (x, z) => surgeAt(x, z) + (sea.vortices.length ? sea.vortexH(x, z) : 0) + swellH(x, z);

WIND.dir.value.set(Math.cos(WAVE_ANGLE), Math.sin(WAVE_ANGLE));   // 樹被風吹的方向跟風浪一致
const groundDetail = makeGroundDetail();
for (const t of [groundDetail.detail, groundDetail.normal]) t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
const TIME_U = { value: 0 };
const shared = {
  uBed: { value: bedTex }, uShelter: { value: shelterTex }, uShore: { value: shoreTex }, uN: { value: NF }, uL: { value: L },
  uSunDir: { value: sunDir }, uTime: TIME_U, uSwellT: TIME_U,
  uCenter: { value: new THREE.Vector2() }, uWaveScale: { value: 1 },
  uPixelAngle: { value: 0.001 }, uWake: { value: wake }, uRip: { value: null }, uSwimmer: { value: null },
  uDisp0: { value: null }, uDisp1: { value: null },
  uSlope0: { value: ocean.cascades[0].slope.texture },
  uSlope1: { value: ocean.cascades[1].slope.texture },
  uSlope2: { value: ocean.cascades[2].slope.texture },
  uPatch: { value: new THREE.Vector3(...ocean.patches) }, uTexN: { value: ocean.N },
  uSlopeVar: { value: new THREE.Vector3(...ocean.cascades.map((c) => c.slopeVar)) },
  uFoamTex: { value: makeFoamTexture() }, uHs: { value: HS },
  uDetail: { value: groundDetail.detail }, uDetailN: { value: groundDetail.normal },
  uWindT: WIND.t, uWindAmp: WIND.amp, uWindDir: WIND.dir,
  uUnder: { value: 0 }, uCamDepth: { value: 0 },
  uReflTex: { value: null }, uReflMat: { value: new THREE.Matrix4() }, uReflOn: { value: 0 },
  uReflPass: REFL, uReflY: { value: 0 },
  uShTri: { value: Array.from({ length: 6 }, () => new THREE.Vector2(1e6, 1e6)) },
  uShHull: { value: new THREE.Vector4(1e6, 1e6, 1, 0) }, uShSize: { value: new THREE.Vector2(5, 1.3) },
  uQuay: { value: Array.from({ length: 3 }, () => new THREE.Vector4(1e6, 1e6, 1e6, 1e6)) },
  uHull: { value: Array.from({ length: 3 }, () => new THREE.Vector4(1e6, 1e6, 1, 0)) },
  uHullSize: { value: Array.from({ length: 3 }, () => new THREE.Vector3(1, 1, 0)) },
  uDanger: { value: dangerTex }, uTsuK: { value: tsuKTex }, uStorm: { value: 0 }, uTsu: { value: new THREE.Vector4(0, 1, 0, 0) }, uTsu2: { value: new THREE.Vector2() }, uGloom: { value: 0 },
  uSunCol: { value: new THREE.Vector3(1, 0.93, 0.8) }, uAmbient: { value: new THREE.Vector3(1, 1, 1) },
  uDay: { value: 1 }, uDusk: { value: 0 }, uFog: { value: 0 }, uFlash: { value: 0 }, uFlashDir: { value: new THREE.Vector3(0, 1, 0) }, uRain: { value: 0 }, uCloudT: { value: new THREE.Vector2() }, uSwell: { value: 0 }, uSurge: { value: 0 },
  uVortex: { value: Array.from({ length: 3 }, () => new THREE.Vector4()) },
  uLamp: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
  uBlob: { value: new THREE.Vector3() }, uWet: { value: 0 }, uRainbow: { value: 0 },
  uBeam: { value: new THREE.Vector4(0, 0, 1, 0) }, uBeamOn: { value: 0 },
  uIsle: { value: ISLANDS.map((o) => new THREE.Vector4(o.x, o.z, o.R, 0)) },
  uIsleLook: { value: ISLANDS.map((o) => new THREE.Vector4(o.look.rock, o.look.veg, o.look.white, o.look.dry)) },
  uShadowMap: { value: null }, uShadowMat: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 }, uShadowTexel: { value: 1 / 2048 },
  uSwe: { value: null }, uSweWet: { value: null }, uSweOrigin: { value: new THREE.Vector2() }, uSweSize: { value: 1 }, uSweOn: { value: 0 },
};

const terrain = new THREE.Mesh(makeTerrainGeometry(), new THREE.ShaderMaterial({
  vertexShader: terrainVert, fragmentShader: terrainFrag, uniforms: shared,
}));
terrain.frustumCulled = false;
scene.add(terrain);

const water = new THREE.Mesh(makePolarGeometry(), new THREE.ShaderMaterial({
  vertexShader: waterVert, fragmentShader: waterFrag, uniforms: shared, transparent: true,
  blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, // 畫面的 alpha 是「這裡是不是天空」的記號（光暈用）：海面要把它蓋成 1。
  // 以前海面不動 alpha，底下沒有海床模型的深海就被當成天空加亮，有海床的地方沒有，結果把每座島在水面下的輪廓描了出來
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  side: THREE.DoubleSide,
}));
water.frustumCulled = false;
water.renderOrder = 2;
// 海面的記號：海面畫完之後，同一張網格再畫一次，只把畫面的 alpha 寫成 3（顏色不動、只蓋在看得到海面的像素上）。
// 環境光遮蔽靠這個記號跳過海面：它是從深度反推表面的，貼著海面往遠處看時會誤判，在海上壓出一塊塊有直線邊的暗影
const waterFlag = new THREE.Mesh(water.geometry, new THREE.ShaderMaterial({
  vertexShader: waterVert, fragmentShader: 'void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 3.0); }', uniforms: shared, transparent: true,
  blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor,
  depthWrite: false, depthFunc: THREE.LessEqualDepth, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, side: THREE.DoubleSide,
}));
waterFlag.frustumCulled = false;
waterFlag.renderOrder = 2.1;
water.add(waterFlag);   // 跟著海面一起顯示、隱藏（畫倒影時海面是藏起來的）
scene.add(water);
DECKS.slice(0, 3).forEach((r, i) => shared.uQuay.value[i].set(r.x0, r.z0, r.x1, r.z1));   // 岸壁、防波堤的位置：海面要在牆腳畫水線

const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
  vertexShader: skyVert, fragmentShader: skyFrag, uniforms: shared,
  side: THREE.BackSide, depthWrite: false,
}));
sky.frustumCulled = false;
// 天空在所有不透明的東西（地形、港口、樹、船）畫完之後才畫，而且做深度測試：被山和房子擋住的地方就不用算天空。
// 以前天空最先畫、不做深度測試，整個畫面每一點都算一次雲，佔了一幀三分之一左右的時間。
// 它還是在海面（半透明，排在後面）之前畫，海面照樣疊在天空上
sky.renderOrder = 1e6;
scene.add(sky);

// 船、人、港口、樹用 three.js 內建材質，補上對應的光源
const sun = new THREE.DirectionalLight(0xfff0d8, 3.0);
const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x8088a6, 1.4);   // 卡通風：背光面是偏藍紫的亮陰影
scene.add(sun, sun.target, hemi);

// ---- 陰影 -------------------------------------------------------------------
// 太陽（晚上是月亮）投一張陰影貼圖，範圍是鏡頭注視點周圍一塊方形，跟著鏡頭走。
// 樹、石頭、船、人、港口的建築、山坡都會投影；地形用自己的著色器取樣這張貼圖。
// 每隔一幀更新一次，跟水面倒影輪流畫，省一半的成本
// 貼圖 3072：在 Iris Xe 上比 2048 每幀多 0.6 毫秒左右，4096 則要多 4.5 毫秒（量過），所以取 3072、範圍收到 54 公尺
let SHADOW_HALF = gfx.shadowHalf;   // 畫質「手機」收到 40 公尺（貼圖小，範圍也跟著收，影子才不會太粗）
let SHADOW_SIZE = gfx.shadow;   // 畫質「高」是 3072，中 2048，低 1536，手機 1024
renderer.shadowMap.enabled = true;
renderer.shadowMap.autoUpdate = false;
sun.castShadow = true;
sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 460 });
// 貼圖一格 3.5 公分。偏移量（防止表面自己遮到自己）要小：太大的話影子會從物件的腳邊「脫開」一截
sun.shadow.bias = -0.00012;
sun.shadow.normalBias = 0.03;
// 影子的邊緣要利落（卡通風）：取樣的範圍只留一格左右，剛好蓋掉貼圖的鋸齒；再把漸層收窄，
// 邊緣就是一條乾淨的線，細的東西（燈柱、桿子）的影子也不會被抹淡。地形那邊（sunShadow）用同一組數字
sun.shadow.radius = 1.0;
THREE.ShaderChunk.shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment.replace(') * 0.2;', ') * 0.2;\n\t\t\t\tshadow = smoothstep( 0.22, 0.78, shadow );');
shared.uShadowMat.value = sun.shadow.matrix;
shared.uShadowTexel.value = 1 / SHADOW_SIZE;
const _sr = new THREE.Vector3(), _su = new THREE.Vector3(), _sc = new THREE.Vector3();
// 投影用的太陽方向：太陽每走過 0.35 度才跟上一次（約兩秒）。每一幀都跟的話，貼圖的格子一直在轉，
// 影子的邊緣會一格一格地爬（看起來在蠕動、細的影子忽粗忽細）；一步一步跟，兩步之間影子是完全靜止的
const shDir = sunDir.clone(), SH_STEP = Math.cos(0.35 * Math.PI / 180);
// 把光源擺到注視點上方。位置對齊陰影貼圖的格子，鏡頭移動時影子的邊緣才不會閃
function placeSun(center) {
  if (shDir.dot(sunDir) < SH_STEP) shDir.copy(sunDir);
  _sr.set(0, 1, 0).cross(shDir);
  if (_sr.lengthSq() < 1e-6) _sr.set(1, 0, 0);
  _sr.normalize();
  _su.copy(shDir).cross(_sr);
  const texel = (2 * SHADOW_HALF) / SHADOW_SIZE;
  const cx = Math.round(center.dot(_sr) / texel) * texel, cy = Math.round(center.dot(_su) / texel) * texel;
  _sc.copy(_sr).multiplyScalar(cx).addScaledVector(_su, cy).addScaledVector(shDir, center.dot(shDir));
  sun.target.position.copy(_sc);
  sun.position.copy(_sc).addScaledVector(shDir, 220);
  sun.target.updateMatrixWorld();
  renderer.shadowMap.needsUpdate = true;
}
// 哪些東西會投影、會被影子蓋到：半透明的（窗玻璃、光束）不算
function shade(obj) {
  obj.traverse((m) => {
    if (!m.isMesh || m.userData.hull) return;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    if (mat.transparent && !(mat.alphaTest > 0)) return;
    m.castShadow = !m.userData.noCast;   // noCast：貼在表面上的薄片（人物的臉），投影會在底下那層印出斑點
    m.receiveShadow = !mat.isMeshBasicMaterial && !mat.userData.noReceive;
  });
}
terrain.castShadow = true;

// ---- 雜草 -------------------------------------------------------------------
// 一塊 48 公尺見方的草皮跟著鏡頭走，上面一萬四千叢草；位置、高矮、顏色、隨風擺動都在顯示卡上算。
// 只有鏡頭附近二十公尺左右有立體的草，更遠的地方靠地面的草葉紋理撐著
const GRASS_T = 48;
let grassN = gfx.grass;   // 畫質「高」一萬四千叢，中一萬，低六千
const grass = new THREE.Mesh(makeGrassGeometry(grassN, GRASS_T), new THREE.ShaderMaterial({
  vertexShader: grassVert, fragmentShader: grassFrag, side: THREE.DoubleSide,
  uniforms: { ...shared, uGrassT: { value: GRASS_T }, uGrassCam: { value: new THREE.Vector3() }, uWindT: WIND.t, uWindAmp: WIND.amp, uWindDir: WIND.dir },
}));
grass.frustumCulled = false;
scene.add(grass);
const _gd = new THREE.Vector3();
// 水下時讓這些物件也罩上同樣的水霧
const underFog = new THREE.FogExp2(0x06323f, 0.032);
const airFog = new THREE.FogExp2(0xb4bcc6, HAZE);    // 遠景的薄霧；起霧時船、碼頭、樹也要罩在霧裡

const scenery = makeScenery({
  L, heightAt: bedAt, light: LIGHTHOUSE,
  // 母港平台周圍和燈塔腳下不種樹
  skip: (x, z) => (x > -47 && x < 28 && z > 93) || Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.z) < 6,
  // 港口和進出港的水道不放石頭
  clear: (x, z) => (Math.abs(x) < 75 && z > 88 && z < 250) || Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.z) < 7,
});
addRocks(scenery.rocks);
shade(scenery.group);
scene.add(scenery.group);

const harbor = makeHarbor(bedAt);
scene.add(harbor);
addRocks(HARBOR_ROCKS);   // 消波塊
shade(harbor);

// 岸邊的淺水模擬：鏡頭附近一塊範圍，浪真的沖上沙灘再退回去，也會繞過木樁與礁石
const shallow = new ShallowWater(renderer);
shallow.obstacles.push(...PILES, ...scenery.obstacles);
shared.uSwe.value = shallow.texture;
shared.uSweSize.value = shallow.size;
const SWE_ON = false;   // 淺水模擬：停用中（岸邊的浪改用 renderShaders.js 的 swell()）
const sweEnv = { bedTex, bedN: NF, L, shelterTex, dangerTex, shoreTex, time: 0, disp0: null, patch0: ocean.patches[0], waveScale: 1, storm: 0, surge: 0 };
// 鏡頭附近有沒有淺水（整片都是深海就不用算）
function shallowNear(c) {
  const half = shallow.size / 2;
  for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) if (bedAt(c.x + (i / 3) * half, c.z + (j / 3) * half) > -SWE.cap) return true;
  return false;
}

// 世界裡的每一艘船：自己的那一艘（myBoat）和同房其他人的。每個人同時只有一艘放在世界裡，
// 其他買了的收在倉庫（garage），到魚市場前的停船位置牌換出來
const boats = [];
function addBoat(type, pose, boxLv = 0) {
  const b = new Boat(type, pose.x, pose.z, pose.heading);
  if (boxLv > 0) b.setBox(boxLv);
  boats.push(b);
  scene.add(b.mesh);
  shade(b.mesh);
  addOutline(b.mesh);
  b.mesh.add(b.waterMask);   // 描邊、陰影設好之後才掛上去（它是看不見的遮罩，不該被描邊或投影）
  return b;
}
// 把一艘船從世界裡拿掉（別人的船被收走、換掉、沉完了）：上面自己的東西沒了，站在上面的人掉下來
function dropBoat(b) {
  const i = boats.indexOf(b);
  if (i >= 0) boats.splice(i, 1);
  b.mesh.removeFromParent();
  fish.wreck(b, false);
  if (player.boat === b && mode === 'walk') player.place(walkWorld, player.x, player.z);
  if (boat === b) { boat = myBoat; camHeading = boat.heading; }
  b.mesh.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); for (const mat of [].concat(m.material)) mat.dispose(); } });
}
let kit = newKit();                                             // 自己的家當（伺服器保管，這裡只是照著顯示）
let berth = { label: '', ...berthPose(BERTHS[0], 'skiff') };   // 自己分到的停船格
const garage = new Map();                                       // 收在倉庫裡的船：船種 → Boat（油量、破洞、魚箱裡的魚都留在上面）
const garageState = new Map();                                  // 重新整理頁面後，倉庫裡的船是什麼樣子（伺服器記著的）：船種 → { fuel, cracks }
let myBoat = addBoat('skiff', berth);                           // 自己放在世界裡的那一艘
let boat = myBoat;   // 「目前這艘」：最後踩上去的船（可能是別人的）。鏡頭、浪、船燈以它為準

// ---- 多人：連線、同房的其他人、聊天室、看板 ----
const net = new Net();
const boards = new Boards();   // 魚市場前的停船位置牌和兩塊排行榜
scene.add(boards.group);
shade(boards.group);
const others = new Others({
  scene,
  decorate: (m) => { shade(m); addOutline(m); },
  makeBoat: addBoat, dropBoat,
  boatOf: (id) => (id === net.id ? myBoat : others.boat(id)),
});
const chat = new Chat({
  send: (text) => net.send({ t: 'chat', text }),
  onOpen() { for (const k in keys) keys[k] = false; closeWheel(false); },
  onClose() {},
});
let room = { id: 0, name: '', max: 30 };

const player = new Player(PLAYER_SPAWN.x, PLAYER_SPAWN.z, PLAYER_SPAWN.yaw);
// 人所在位置的水面高度。浪高每幀只向 GPU 讀一次（讀人腳下那一點），周圍幾步之內共用
let swimWave = 0;
function playerWater(x, z) {
  const d = -bedAt(x, z);
  const near = clamp(1 - d / 2.5, 0, 1);   // 岸邊沖上來的水（取平均高度）
  return swimWave * clamp((d - 0.3) / 7.7, 0, 1) * waveK(x, z) + tsuAt(x, z)
    + 0.2 * clamp(shelterAt(x, z) * ocean.scale / 1.3, 0.18, 1.5) * near * near * (3 - 2 * near);
}
// 每艘船都可以直接走上去；水深過胸就浮起來游
const walkWorld = { ground: walkGround, water: playerWater, boats };
player.place(walkWorld, PLAYER_SPAWN.x, PLAYER_SPAWN.z);
scene.add(player.mesh);
shade(player.mesh);
addOutline(player.mesh);
// 人物腳下貼地的暗影：站在岸壁、船上時是一片貼在腳下的圓；站在島上時由地形的著色器畫（斜坡上才不會穿幫）
const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ map: softDisc(), color: 0x121a30, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
blob.position.y = 0.03;
player.mesh.add(blob);

const spray = new Spray(3000);
// 游泳的水花、波紋、身邊的白沫、近岸推出的水波（swimfx.js）
const swimFx = makeSwimFx({ spray, waterY: (x, z) => waterY(x, z), shallow });
shared.uRip.value = swimFx.rip;
shared.uSwimmer.value = swimFx.swimmers;
scene.add(spray.points);

// 晚上的燈：碼頭四盞加上目前這艘船的油燈；還有雨、閃電、水龍捲的水柱
const lampLights = LAMPS.map((p) => {
  const l = new THREE.PointLight(0xffb866, 0, 17, 1.3);
  l.position.set(p.x, p.y, p.z);
  scene.add(l);
  return l;
});
const boatLight = new THREE.PointLight(0xffb866, 0, 15, 1.3);
const rain = new Rain();
const bolt = new Bolt(shared.uPixelAngle);
const spindrift = new Spindrift({ uTime: shared.uTime, uWindDir: shared.uWindDir });
const spoutEnv = { uTime: shared.uTime, uAmbient: shared.uAmbient, uSunCol: shared.uSunCol, uGloom: shared.uGloom, fog: airFog };
const spouts = [new Spout(spoutEnv), new Spout(spoutEnv)];
const waveSpray = new WaveSpray({ ...spoutEnv, uTsu: shared.uTsu, uTsu2: shared.uTsu2, uTsuK: shared.uTsuK, uL: shared.uL });   // 巨浪浪頂的飛沫
scene.add(rain.lines, bolt.mesh, spindrift.mesh,...spouts.map((s) => s.group), waveSpray.mesh);

// ---- 釣魚與魚 ---------------------------------------------------------------
let money = 0;
let inGame = false;   // 已經進到房間裡（還在主選單、大廳時不能操作）
let landing = false;  // 剛把魚拉上來，等伺服器承認
const toastState = { until: 0 };
function toast(text) {
  touchSet($('toast'), text);
  $('toast').style.display = 'block';
  toastState.until = performance.now() + 3200;
}
function splash(x, y, z, n = 14) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * 1.4;
    spray.emit(x, y, z, Math.cos(a) * r, 1.5 + Math.random() * 2.5, Math.sin(a) * r, 0.4 + Math.random() * 0.5, 0.25 + Math.random() * 0.4);
  }
}
// 某處是不是可以拋竿的水面（不是岸、不是棧板、不是船上）
function isWater(x, z) {
  if (bedAt(x, z) > -0.6 || onDeck(x, z, 0.2) || pontoonY(x, z, 0.2) !== null) return false;
  return !boats.some((b) => { const l = b.toLocal(x, z); return b.deckContains(l.x, l.z); });
}
const waterY = (x, z) => ocean.sampleHeight(x, z) * clamp((-bedAt(x, z) - 0.3) / 7.7, 0, 1) * waveK(x, z) + tsuAt(x, z);

const fish = new FishWorld({
  player, boats, scene, ground: walkGround, splash, toast, basket: SELL.basket,
  waveAt: (x, z) => ocean.sampleCached(x, z) * waveK(x, z) + tsuAt(x, z),
  onLost: (uids) => net.send({ t: 'fishGone', uids }),   // 魚掉回海裡、跟著船沉了：告訴伺服器這幾條沒了
});
// 釣魚：這裡只管手感和畫面。魚什麼時候咬、是哪條、多大、值多少、算不算釣起來，都由伺服器決定
const fishing = new Fishing({
  player, scene, isWater, surfaceY: waterY, splash, toast,
  net: {
    cast: (x, z) => net.send({ t: 'cast', x: r2(x), z: r2(z) }),
    hook: () => net.send({ t: 'hook' }),
    miss: () => net.send({ t: 'miss' }),
    land: () => { if (net.online) { landing = true; net.send({ t: 'land' }); } else toast('連線中斷，這條魚沒算到'); },
    lose: (why) => net.send({ t: 'lose', why }),
  },
  canFish: () => inGame && net.online && mode === 'walk' && !fish.held && !player.swim,
  rodLv: () => rodLv,
  broken: () => rodBroken,
  sound: (name, vol) => audio.play(name, vol, name === 'plop' || name === 'bite' || name === 'hook' || name === 'land' ? fishing.bob.position : null),   // 水花聲從浮標那裡傳過來
  // 爆桿：魚跑了，釣竿斷了，要拿回商店的攤位花錢修
  onSnap() {
    rodBroken = true;
    refreshTags();
    toast('爆桿了！釣竿斷了，魚也跑了——要拿回商店的攤位修理');
  },
  viewYaw: () => view.walk.yaw,
});
function refreshBoard(last) {
  if (!fish.basket.length) setBoard(['把魚放進籃子', '$0']);
  else setBoard([`${last.sp.name} ${Math.round(last.len * 100)}cm ${last.kg.toFixed(2)}kg`, `這條 $${last.value}　共 ${fish.basket.length} 條`, `$${fish.basketTotal}`]);
}

// ---- 船在水面上的影子（船身 + 駕駛艙屋頂）-----------------------------------
const _sv = new THREE.Vector3();
const HULL_WL = [0.49, 0.47];   // 水線那一圈的半長、半寬（佔船長、船寬的比例）
function updateBoatShadow() {
  boat.mesh.updateMatrixWorld(true);
  const wy = boat.mesh.position.y, sy = Math.max(sunDir.y, 0.25), kx = sunDir.x / sy, kz = sunDir.z / sy;
  const tri = shared.uShTri.value;
  const corner = boat.parts.roof.map((c) => {
    _sv.copy(c).applyMatrix4(boat.mesh.matrixWorld);
    const hgt = Math.max(_sv.y - wy, 0);
    return [_sv.x - kx * hgt, _sv.z - kz * hgt];
  });
  [0, 1, 2, 0, 2, 3].forEach((c, n) => tri[n].set(corner[c][0], corner[c][1]));
  shared.uShHull.value.set(boat.x - kx * 0.9, boat.z - kz * 0.9, Math.cos(boat.heading), Math.sin(boat.heading));
  shared.uShSize.value.set(boat.spec.len * 0.385, boat.spec.beam * 0.28);
  // 每艘船在水面上的位置、方向、水線那一圈的大小：海面要在船身周圍畫水線、漣漪
  const near = boats.filter((b) => !b.sinking).sort((p, q) => (p.x - target.x) ** 2 + (p.z - target.z) ** 2 - (q.x - target.x) ** 2 - (q.z - target.z) ** 2);
  for (let i = 0; i < 3; i++) {
    const b = near[i], on = !!b;
    shared.uHullSize.value[i].set(on ? b.spec.len * HULL_WL[0] : 1, on ? b.spec.beam * HULL_WL[1] : 1, on ? 1 : 0);
    if (on) shared.uHull.value[i].set(b.x, b.z, Math.cos(b.heading), Math.sin(b.heading));
  }
}

// ---- 水面倒影：用鏡像相機把水面以上的物體畫到貼圖 ---------------------------
// 抗鋸齒：場景先畫到緩衝區，轉成螢幕顏色後再做一次邊緣平滑（FXAA）。
// 水邊、泡沫這些用著色器切出來的邊緣也一併處理；實測在內顯上比多重取樣（MSAA）每幀省 5 毫秒以上
// 場景的深度也留成貼圖：環境光遮蔽要靠它算出哪裡是凹角、哪裡被擋住
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(4, 4) }));
composer.addPass(new RenderPass(scene, camera));
// 環境光遮蔽：牆腳、屋簷下、樹叢裡、東西和地面相接的地方壓暗（算在光效之前，光暈才不會被它弄髒）。
// 用一半的解析度算：在 Iris Xe 上全解析度每幀要多 11～17 毫秒，一半是 4 毫秒左右，疊回去時照深度對齊，看不太出差別
const aoPass = new ShadePass(scene, camera, 0.5);
composer.addPass(aoPass);
// 光效（都在轉成螢幕顏色之前做，亮度可以超過 1）：太陽的光束，接著是光暈——夠亮的地方往外暈開
const rays = new SunRaysPass();
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.45, 1.7);
composer.addPass(rays);
composer.addPass(bloom);
composer.addPass(new OutputPass());
composer.addPass(new FXAAPass());

const reflRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true });
shared.uReflTex.value = reflRT.texture;
const vcam = new THREE.PerspectiveCamera();
const UP = new THREE.Vector3(0, 1, 0);
const _rp = new THREE.Vector3(), _cw = new THREE.Vector3(), _vp = new THREE.Vector3();
const _look = new THREE.Vector3(), _tg = new THREE.Vector3(), _rot = new THREE.Matrix4();
const _cc = new THREE.Color();
const clipOn = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)], clipOff = [];
const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

let reflTick = 0, drawCount = 0;
function renderReflection(under, turn = true) {
  const alt = camera.position.y;
  const on = !under && alt > 0.3 && alt < 700;
  if (!on) { shared.uReflOn.value = 0; reflTick = 0; return; }
  // 隔一幀才重畫一次倒影；沒重畫的那幀沿用上一幀的貼圖與投影矩陣
  if (!turn && reflTick > 0) return;
  reflTick++;
  shared.uReflOn.value = 1;

  camera.updateMatrixWorld();
  _rp.set(0, 0, 0);
  _cw.setFromMatrixPosition(camera.matrixWorld);
  _rot.extractRotation(camera.matrixWorld);
  _vp.subVectors(_rp, _cw).reflect(UP).negate().add(_rp);
  _look.set(0, 0, -1).applyMatrix4(_rot).add(_cw);
  _tg.subVectors(_rp, _look).reflect(UP).negate().add(_rp);
  vcam.position.copy(_vp);
  vcam.up.set(0, 1, 0).applyMatrix4(_rot).reflect(UP);
  vcam.lookAt(_tg);
  vcam.near = camera.near; vcam.far = camera.far;
  vcam.updateMatrixWorld();
  vcam.projectionMatrix.copy(camera.projectionMatrix);
  // 倒影只照 450 公尺內的東西（船、碼頭、腳下這座島）。
  // 鏡頭貼近水面時，鏡面倒影會把幾百公尺外的島拉成一大塊深色，鋪在島和你之間的海面上，看起來像水面下的島身；
  // 真的海面有浪，那麼遠的倒影早就散掉了
  {
    const n = camera.near, f = 450, e = vcam.projectionMatrix.elements;
    e[10] = -(f + n) / (f - n); e[14] = (-2 * f * n) / (f - n);
  }
  vcam.projectionMatrixInverse.copy(vcam.projectionMatrix).invert();
  shared.uReflMat.value.copy(BIAS).multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse);

  water.visible = false; sky.visible = false; spray.points.visible = false;
  const rainOn = rain.lines.visible, driftOn = spindrift.mesh.visible;
  rain.lines.visible = false; spindrift.mesh.visible = false;
  scenery.update(camera.position, true);   // 倒影裡的樹和石頭用簡化版，雨省略
  grass.visible = false;                   // 倒影裡不畫雜草
  shared.uReflPass.value = 1;
  renderer.clippingPlanes = clipOn;
  const ca = renderer.getClearAlpha();
  renderer.getClearColor(_cc);
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(reflRT);
  renderer.clear();
  renderer.render(scene, vcam);
  renderer.setRenderTarget(null);
  renderer.setClearColor(_cc, ca);
  renderer.clippingPlanes = clipOff;
  shared.uReflPass.value = 0;
  water.visible = true; sky.visible = true; spray.points.visible = true;
  rain.lines.visible = rainOn; spindrift.mesh.visible = driftOn;
  scenery.update(camera.position);
  grass.visible = true;
}

// ---- 積水的倒影 -------------------------------------------------------------
// 下雨時碼頭的水泥地會積水。把碼頭平面以上的東西（房子、棚子、旗子、柱子、人、後面的山和樹）
// 用鏡像相機畫到另一張貼圖，積水就映得出它們，而不是只有一片天色。做法跟上面的海面倒影一樣，只是鏡面在碼頭的高度
const deckRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true });
const deckClip = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -(DECK_Y + 0.04))];
function renderDeckReflection() {
  camera.updateMatrixWorld();
  _rp.set(0, DECK_Y, 0);
  _cw.setFromMatrixPosition(camera.matrixWorld);
  _rot.extractRotation(camera.matrixWorld);
  _vp.subVectors(_rp, _cw).reflect(UP).negate().add(_rp);
  _look.set(0, 0, -1).applyMatrix4(_rot).add(_cw);
  _tg.subVectors(_rp, _look).reflect(UP).negate().add(_rp);
  vcam.position.copy(_vp);
  vcam.up.set(0, 1, 0).applyMatrix4(_rot).reflect(UP);
  vcam.lookAt(_tg);
  vcam.near = camera.near; vcam.far = camera.far;
  vcam.updateMatrixWorld();
  vcam.projectionMatrix.copy(camera.projectionMatrix);
  {
    const n = camera.near, f = 260, e = vcam.projectionMatrix.elements;   // 只照港口和後面那片山坡
    e[10] = -(f + n) / (f - n); e[14] = (-2 * f * n) / (f - n);
  }
  vcam.projectionMatrixInverse.copy(vcam.projectionMatrix).invert();
  WET.reflMat.value.copy(BIAS).multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse);

  water.visible = false; sky.visible = false; spray.points.visible = false;
  const rainOn = rain.lines.visible, driftOn = spindrift.mesh.visible;
  rain.lines.visible = false; spindrift.mesh.visible = false;
  scenery.update(camera.position, true);
  grass.visible = false;
  shared.uReflPass.value = 1; shared.uReflY.value = DECK_Y;
  WET.reflTex.value = null;   // 正在畫這張貼圖的時候不能同時拿它來用
  renderer.clippingPlanes = deckClip;
  const ca = renderer.getClearAlpha();
  renderer.getClearColor(_cc);
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(deckRT);
  renderer.clear();
  renderer.render(scene, vcam);
  renderer.setRenderTarget(null);
  renderer.setClearColor(_cc, ca);
  renderer.clippingPlanes = clipOff;
  WET.reflTex.value = deckRT.texture;
  shared.uReflPass.value = 0; shared.uReflY.value = 0;
  water.visible = true; sky.visible = true; spray.points.visible = true;
  rain.lines.visible = rainOn; spindrift.mesh.visible = driftOn;
  scenery.update(camera.position);
  grass.visible = true;
}
let deckReady = false;

// ---- 玩家狀態與鏡頭 ---------------------------------------------------------
// mode：'walk' 用走的（陸地、棧道、船的甲板）；'helm' 握著方向盤掌舵。每種狀態各自記住視角。
// yaw / pitch 是視線方向（pitch 負值 = 往下看）；掌舵時 yaw 相對於船首。
let mode = 'walk';
const view = {
  walk: { fp: false, yaw: PLAYER_SPAWN.yaw, pitch: -0.25, dist: 9 },
  helm: { fp: true, yaw: 0, pitch: -0.04, dist: 22 },
  sink: { fp: false, yaw: 0.7, pitch: -0.28, dist: 24 },   // 船沉的時候從旁邊看著它
};
const DIST = { walk: [3, 45], helm: [10, 120], sink: [10, 60] };
const TP_PITCH = { walk: -0.25, helm: -0.3 };
const target = new THREE.Vector3();   // 鏡頭注視點（海面網格也以它為中心）
let camHeading = boat.heading;        // 第三人稱跟船時，鏡頭慢半拍跟上船首
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);

function applyViewSettings() {
  const v = view[mode];
  camera.near = v.fp ? 0.25 : 1;
  camera.fov = v.fp ? 68 : 50;
  player.mesh.visible = mode === 'walk';
  player.setFirstPerson(mode === 'walk' && v.fp);
  myBoat.setManned(mode === 'helm', v.fp);
  $('hSpeed').style.display = mode === 'helm' ? 'inline' : 'none';
  syncAim();
  onResize();
}

// 第一人稱：畫面中央有準心，滑鼠游標收起來（鎖在畫面裡，直接移動就轉視角）。
// 按 Esc 會放開滑鼠（要去點設定的時候），再點一下畫面就鎖回去；看地圖、切回第三人稱時自動放開
// 走路時不管第一、第三人稱畫面中央都有準心：要對準東西才能互動（第三人稱的滑鼠照舊按住拖曳，不鎖）
const aiming = () => mode !== 'sink' && view[mode].fp && !mapOpen;
const crosshair = () => !mapOpen && (mode === 'walk' || (mode === 'helm' && view.helm.fp));
const locked = () => document.pointerLockElement === canvas;
function grabMouse() {
  if (TOUCH || locked() || !canvas.requestPointerLock) return;
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* 瀏覽器不給鎖就算了，照舊按住拖曳 */ }
}
function syncAim() {
  $('aim').style.display = crosshair() ? 'block' : 'none';
  if (aiming()) grabMouse();
  else if (locked()) document.exitPointerLock();
}

function toggleFp() {
  if (mode === 'sink') return;
  const v = view[mode];
  v.fp = !v.fp;
  v.pitch = v.fp ? -0.04 : TP_PITCH[mode];
  if (mode === 'helm') v.yaw = 0;
  applyViewSettings();
}

// 會擋住鏡頭的東西：房子、屋頂、雨棚、棚架、牆、岸壁、燈塔。
// 柱子、燈桿、欄杆這類細的不算——它們只是從畫面前面掃過去，為了它把鏡頭拉近反而一跳一跳的
const camBlockers = [];
{
  const size = new THREE.Vector3(), sc = new THREE.Vector3();
  for (const root of [harbor, scenery.lighthouseMesh]) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.material.transparent) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      o.geometry.boundingBox.getSize(size).multiply(sc.setFromMatrixScale(o.matrixWorld));
      const d = [size.x, size.y, size.z].sort((p, q) => q - p);
      if (d[1] >= 1.0) camBlockers.push(o);   // 至少有兩個方向超過一公尺：是一個「面」，不是一根桿子
    });
  }
  // 攤位背面：一排價格牌，牌子之間有空隙。鏡頭繞到攤位後面時，人被牌子的背面擋掉大半，
  // 沿著攤位走還會從空隙裡忽隱忽現；整排當成一面牆（只給鏡頭用，不畫出來）
  const back = new THREE.Mesh(new THREE.BoxGeometry(SHELF_X[1] - SHELF_X[0] + 0.7, 2.7, 0.2));
  back.position.set((SHELF_X[0] + SHELF_X[1]) / 2, DECK_Y + 1.35, SHELF_Z - 0.5);
  back.updateMatrixWorld();
  camBlockers.push(back);
}
// ---- 港口合併成少數幾塊 ---------------------------------------------------------
// 港口是六百多個小零件（木板、樁、箱子、屋頂、欄杆），一個一個送去畫，光是送指令每幀就要十幾毫秒的 CPU，
// 陰影和倒影還各要再送一次；手機的 CPU 慢，這是最拖的地方。不會動的零件照材質（外觀一樣的算同一種）合併成一塊，
// 剩兩百個左右。不合併的：半透明的、藏起來的（晚上才出現的光圈）、會改顏色或換字的材質（窗戶、招牌、價格牌）、
// 鏡像擺放的、底下還掛著東西的。鏡頭的遮擋判斷（camBlockers）在上面已經用原本的零件建好，不受影響
{
  harbor.updateMatrixWorld(true);
  const keep = new Set([...GLOW, ...UNLIT]);
  const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const look = (m) => (keep.has(m) || m.onBeforeCompile.toString().length > 30 ? m.uuid
    : [m.type, m.color?.getHex(), m.emissive?.getHex(), m.map?.uuid, m.side, m.flatShading, m.vertexColors, m.alphaTest, m.opacity].join());
  const sets = new Map();
  harbor.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.material.transparent) return;
    if (o.children.length || o.renderOrder || !o.frustumCulled || o.morphTargetInfluences || !shown(o) || o.matrixWorld.determinant() < 0) return;
    const g = o.geometry, k = [look(o.material), o.castShadow, o.receiveShadow, !!g.index, Object.keys(g.attributes).sort().join()].join('|');
    if (!sets.has(k)) sets.set(k, []);
    sets.get(k).push(o);
  });
  const inv = harbor.matrixWorld.clone().invert();
  for (const list of sets.values()) {
    if (list.length < 2) continue;
    const geo = mergeGeometries(list.map((o) => { const g = o.geometry.clone(); g.morphAttributes = {}; g.clearGroups(); return g.applyMatrix4(o.matrixWorld); }));
    if (!geo) continue;
    const m = new THREE.Mesh(geo, list[0].material);
    m.castShadow = list[0].castShadow; m.receiveShadow = list[0].receiveShadow;
    m.applyMatrix4(inv);
    harbor.add(m);
    for (const o of list) o.removeFromParent();
  }
}

// 鏡頭要退到哪裡才不被擋，分兩步：
// 一、從人的頭往鏡頭看出去，中間有東西就把鏡頭拉到它前面。不只看正中間那一條線，
//     鏡頭的上下左右各多看一條：屋簷的邊角就算沒擋到正中間，也不會蓋住半個畫面。
// 二、頭沒被擋住，鏡頭的位置也可能很糟：懸在雨棚、屋頂正上方不到兩公尺，棚頂就鋪滿下半個畫面。
//     這種位置（腳下貼著一片架高的面，或往人的腳看過去、近處就被擋住）也不能停，再往人這邊找
const camRay = new THREE.Raycaster();
const CAM_PROBE = [[0, 0], [0.45, 0], [-0.45, 0], [0, 0.35], [0, -0.35]];
const DOWN = new THREE.Vector3(0, -1, 0);
const _cd = new THREE.Vector3(), _cr = new THREE.Vector3(), _cu = new THREE.Vector3(), _ce = new THREE.Vector3(), _co = new THREE.Vector3();
let camArm = null, camWant = 0;   // 鏡頭目前實際離人多遠、上一幀想要的距離
function sightArm(dist) {
  let clear = dist;
  for (const [a, b] of CAM_PROBE) {
    _ce.copy(_cd).multiplyScalar(dist).addScaledVector(_cr, a).addScaledVector(_cu, b);
    const len = _ce.length();
    camRay.set(target, _ce.divideScalar(len));
    camRay.far = len;
    const hit = camRay.intersectObjects(camBlockers, false)[0];
    if (hit) clear = Math.min(clear, dist * hit.distance / len - 0.35);
  }
  return clear;
}
function camSpotOk(arm) {
  const feet = player.pos.y;
  _co.copy(target).addScaledVector(_cd, arm);
  // 正下方兩公尺內有架高的面（比人的腳高一公尺以上：棚頂、屋頂、牆頭；地面和桌子不算）
  camRay.set(_co, DOWN);
  camRay.far = 2;
  let hit = camRay.intersectObjects(camBlockers, false)[0];
  if (hit && hit.point.y > feet + 1) return false;
  // 往人的腳看過去，離鏡頭近的這一段被架高的東西擋住
  _ce.set(target.x, feet + 0.15, target.z).sub(_co);
  const len = _ce.length();
  camRay.set(_co, _ce.divideScalar(len));
  camRay.far = Math.min(len, Math.max(3, 0.6 * len));
  hit = camRay.intersectObjects(camBlockers, false)[0];
  return !(hit && hit.point.y > feet + 1);
}
function clearArm(yaw, pitch, dist, dt) {
  const ce = Math.cos(pitch);
  _cd.set(-Math.cos(yaw) * ce, -Math.sin(pitch), -Math.sin(yaw) * ce);   // 人 → 鏡頭
  _cr.crossVectors(UP, _cd).normalize();
  _cu.crossVectors(_cd, _cr);
  const MIN = Math.min(dist, 1.2);
  let clear = Math.max(sightArm(dist), MIN);
  if (clear > MIN && !camSpotOk(clear)) {
    // 一步一步往人這邊找到第一個可以停的位置，再在最後那一步裡對半找，鏡頭才不會一格一格地跳
    let bad = clear, ok = clear;
    while (ok > MIN && !camSpotOk(ok)) { bad = ok; ok = Math.max(ok - 0.7, MIN); }
    for (let i = 0; i < 4; i++) {
      const mid = (ok + bad) / 2;
      if (camSpotOk(mid)) ok = mid; else bad = mid;
    }
    clear = Math.max(ok - 0.15, MIN);
  }
  // 被擋住時馬上拉近（慢慢拉的話中間幾幀會穿過去）；擋的東西移開後慢慢退回原位，不要彈回去
  const wasFree = camArm === null || camArm >= camWant - 0.01;
  camArm = wasFree || clear <= camArm ? clear : camArm + (clear - camArm) * (1 - Math.exp(-dt * 4));
  camWant = dist;
  return camArm;
}

// 第三人稱：鏡頭繞著注視點，不鑽進地面或棧板
function orbit(yaw, pitch, dist) {
  const ce = Math.cos(pitch), cp = camera.position;
  cp.set(target.x - Math.cos(yaw) * ce * dist, target.y - Math.sin(pitch) * dist, target.z - Math.sin(yaw) * ce * dist);
  // 巨浪經過時鏡頭跟著浮上去，不要被浪蓋住
  const floor = Math.max(onDeck(cp.x, cp.z, 0.6) ? Math.max(DECK_Y, bedAt(cp.x, cp.z)) : bedAt(cp.x, cp.z), tsuAt(cp.x, cp.z) + 0.6) + 0.6;
  if (cp.y < floor) cp.y = floor;
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
}

let debugCam = null;   // 測試用：把鏡頭釘在指定的位置 [x, y, z, 看向 x, y, z]
let menuYaw = 0;
// 鏡頭多近的東西開始被裁掉：第一人稱 0.25（applyViewSettings 也是這個數字），第三人稱 1（鏡頭被牆擠近時 0.3）。
// 第一人稱不能用 1：船艙口那片擋海水用的隱形蓋子（boat.js 的 buildWaterMask）就在眼睛下方不到一公尺，
// 往下看時它靠近鏡頭的那一段會被裁掉，切口在深度上是一道落差，環境光遮蔽會把它當成一面牆，把切口以下的船板壓黑
function setNear(n) {
  if (camera.near !== n) { camera.near = n; camera.updateProjectionMatrix(); }
}
const _sightM = new THREE.Matrix4();
function updateCamera(dt) {
  if (debugCam) {
    camera.position.set(debugCam[0], debugCam[1], debugCam[2]);
    camera.lookAt(debugCam[3], debugCam[4], debugCam[5]);
    target.copy(camera.position);
    return;
  }
  // 還在主選單、大廳：鏡頭在海這一側、對著港口慢慢左右擺（繞整圈的話會轉到山上的樹後面）
  if (!inGame) {
    menuYaw += dt * 0.05;
    target.set(-4, 5, 128);
    orbit(-Math.PI / 2 + 0.75 * Math.sin(menuYaw), -0.28, 82);
    setNear(1);
    return;
  }
  const v = view[mode];
  let dh = boat.heading - camHeading;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  camHeading += dh * (1 - Math.exp(-dt * 2.5));
  if (mode === 'sink') {
    const b = wreck.boat;
    target.set(b.x, Math.max(b.mesh.position.y, 0) + 1.5, b.z);
    orbit(camHeading + v.yaw, v.pitch, v.dist);
  } else if (mode === 'walk') {
    if (v.fp) {
      player.eye(camera.position);
      _qa.setFromAxisAngle(UP, -Math.PI / 2 - v.yaw);
      _qb.setFromAxisAngle(X_AXIS, v.pitch);
      camera.quaternion.copy(_qa).multiply(_qb);
      target.copy(camera.position);
      setNear(0.25);
    } else {
      // 鏡頭被擠到貼在人背後時（背靠著牆、攤位），注視點抬高一點，從頭頂上方看出去，不然整個畫面都是後腦勺
      const cramped = camArm === null ? 0 : clamp(1 - (camArm - 1.2) / 2.3, 0, 1);
      target.set(player.pos.x, player.pos.y + 1.5 + 0.6 * cramped, player.pos.z);
      const arm = clearArm(v.yaw, v.pitch, v.dist, dt);
      orbit(v.yaw, v.pitch, arm);
      // 鏡頭被拉到牆或屋簷前面時離它很近：近的那一面裁切要跟著縮，不然牆會被切出一個洞
      setNear(arm < v.dist - 0.05 ? 0.3 : 1);
    }
  } else if (v.fp) {
    // 眼睛固定在舵位，視線 = 船的姿態 × 滑鼠拖曳出的偏轉
    boat.mesh.updateMatrixWorld(true);
    camera.position.copy(boat.parts.eye).applyMatrix4(boat.mesh.matrixWorld);
    _qa.setFromAxisAngle(UP, -Math.PI / 2 - v.yaw);
    _qb.setFromAxisAngle(X_AXIS, v.pitch);
    camera.quaternion.copy(boat.mesh.quaternion).multiply(_qa).multiply(_qb);
    target.copy(camera.position);
    setNear(0.25);
  } else {
    target.set(boat.x, boat.mesh.position.y + 2.5, boat.z);
    orbit(camHeading + v.yaw, v.pitch, v.dist);
    setNear(1);
  }
}

// ---- 掌舵 -----------------------------------------------------------------
// 人直接走上船、在甲板上走動；走到方向盤（小舢舨是舵柄）前按 E 才接手掌舵，再按一次放手
const nearHelm = () => player.boat && player.h <= 0
  && Math.hypot(player.lx - player.boat.spec.helmX, player.lz) < player.boat.spec.helmR;

function takeHelm() {
  fishing.cancel();
  player.seat = null;
  boat = player.boat;
  mode = 'helm';
  camHeading = boat.heading;
  view.helm.yaw = 0;
  view.helm.dist = clamp(boat.spec.len * 1.7, ...DIST.helm);
  applyViewSettings();
}

function releaseHelm() {
  player.place(walkWorld, boat.spec.helmX - 0.3, 0, boat);
  player.yaw = boat.heading;
  view.walk.yaw = boat.heading + (view.helm.fp ? view.helm.yaw : 0);
  mode = 'walk';
  applyViewSettings();
}

// 賣魚的籃子與按鈕
const nearBasket = () => !player.boat && Math.hypot(player.x - SELL.basket.x, player.z - SELL.basket.z) < 2.0;
const nearButton = () => !player.boat && Math.hypot(player.x - SELL.button.x, player.z - SELL.button.z) < 1.7;
// 腳下這艘船的魚箱（要站在箱子旁邊）
function nearBox() {
  const b = player.boat;
  if (!b || b !== myBoat || !b.boxLv) return null;
  const B = b.spec.box;
  return Math.hypot(player.lx - B.x, player.lz - B.z) < Math.max(B.w, B.d) / 2 + 0.9 ? b : null;
}

// 腳下這艘船的油箱（要站在油箱旁邊）
const nearTank = () => (player.boat && player.boat === myBoat && Math.hypot(player.lx - player.boat.parts.tank.x, player.lz - player.boat.parts.tank.z) < 1.9 ? player.boat : null);
// 腳邊的破洞
function nearCrack() {
  const b = player.boat === myBoat ? myBoat : null, c = b && b.nearDamage(player.lx, player.lz);
  return c ? { boat: b, crack: c } : null;
}
// ---- 纜繩 -------------------------------------------------------------------
// 船停在岸壁邊時，人下船走到繫纜樁旁邊按 E，把船的纜繩綁上去；綁住的船不會被水流、風帶走（也開不走，要先解開）。
// 拉力太大纜繩會繃斷：水龍捲靠得夠近、或巨浪湧進港口把船抬得太高
const MOOR_REACH = 7.5;               // 船舷離樁多遠以內綁得到（公尺）
const MOOR_FLOW = 4, MOOR_LIFT = 2;   // 斷掉的限度：水流每秒幾公尺、水位被抬高幾公尺
const moorLines = new Map();          // 每艘船的纜繩模型
const QUAY_Z = 118, _mv = new THREE.Vector3();   // 岸壁朝海那一側的邊緣（繫纜樁都在這條邊上）
let moorToast = false;
// 船上綁繩子的地方（船頭或船尾、靠岸的那一側的船舷）在世界座標的哪裡
const cleatXZ = (b, lx, lz) => {
  const c = Math.cos(b.heading), s = Math.sin(b.heading);
  return [b.x + c * lx - s * lz, b.z + s * lx + c * lz];
};
// 第 i 根繫纜樁能做什麼：上面已經綁著船就回傳那艘（可以解開），否則找一艘停得夠近、還沒綁的船
function bollardAt(i) {
  const b = myBoat;   // 只管自己的船
  if (b.moor && b.moor.i === i) return { i, boat: b, tied: true };
  return b.moor || b.sinking ? null : moorSpot(i, [b]);
}
// 人站在哪根繫纜樁旁邊
function nearBollard() {
  if (player.boat || player.swim) return null;
  let i = -1, bd = 1.5;
  BOLLARDS.forEach((p, k) => { const d = Math.hypot(player.x - p.x, player.z - p.z); if (d < bd) { bd = d; i = k; } });
  return i < 0 ? null : bollardAt(i);
}
// 這幾艘船裡，哪一艘的哪個位置離第 i 根樁最近（太遠的不算）
function moorSpot(i, list, reach = MOOR_REACH) {
  const post = BOLLARDS[i];
  let best = null;
  for (const b of list) {
    for (const lx of [b.spec.len * 0.36, -b.spec.len * 0.36]) for (const lz of [b.spec.beam * 0.3, -b.spec.beam * 0.3]) {
      const [cx, cz] = cleatXZ(b, lx, lz), d = Math.hypot(cx - post.x, cz - post.z);
      if (d < reach) { reach = d; best = { i, boat: b, lx, lz, d, tied: false }; }
    }
  }
  return best;
}
// 船身放在 (x, z) 會不會卡進岸壁或擱在太淺的地方（船頭、船尾、兩舷各取幾點）
function hullBlocked(b, x, z) {
  const c = Math.cos(b.heading), s = Math.sin(b.heading), S = b.spec, h = S.len / 2, w = S.beam / 2;
  return [[h * 0.8, 0], [-h * 0.8, 0], [h * 0.6, w * 0.6], [h * 0.6, -w * 0.6], [-h * 0.6, w * 0.6], [-h * 0.6, -w * 0.6], [0, w * 0.8], [0, -w * 0.8]]
    .some(([a, e]) => boatGround(x + c * a - s * e, z + s * a + c * e) > -S.draft * 0.7);
}
// 船跟船會互相擋住。每個人只算自己的船：把兩艘船各當成一條「兩頭圓的長條」，疊在一起就把自己的船推開、往對方衝的速度歸零。
// 開著（或還在滑行）的船才會被擋、被推開；停著沒人開的船不讓位——所以停好的船不會被別人擠走，別人的船也推不動
const hullGap = { d: 0, nx: 0, nz: 0 };
function boatGap(a, b) {
  const ha = Math.max(0, (a.spec.len - a.spec.beam) / 2), hb = Math.max(0, (b.spec.len - b.spec.beam) / 2);
  const d1x = 2 * ha * Math.cos(a.heading), d1z = 2 * ha * Math.sin(a.heading), d2x = 2 * hb * Math.cos(b.heading), d2z = 2 * hb * Math.sin(b.heading);
  const p1x = a.x - d1x / 2, p1z = a.z - d1z / 2, p2x = b.x - d2x / 2, p2z = b.z - d2z / 2;
  const rx = p1x - p2x, rz = p1z - p2z;
  const A = d1x * d1x + d1z * d1z, E = d2x * d2x + d2z * d2z, C = d1x * rx + d1z * rz, F = d2x * rx + d2z * rz, B = d1x * d2x + d1z * d2z;
  // 兩條線段上最近的兩點
  const den = A * E - B * B;
  let s = den > 1e-6 ? clamp((B * F - C * E) / den, 0, 1) : 0, t = E > 1e-6 ? (B * s + F) / E : 0;
  if (t < 0) { t = 0; s = A > 1e-6 ? clamp(-C / A, 0, 1) : 0; } else if (t > 1) { t = 1; s = A > 1e-6 ? clamp((B - C) / A, 0, 1) : 0; }
  let cx = p1x + d1x * s - (p2x + d2x * t), cz = p1z + d1z * s - (p2z + d2z * t);
  const d = Math.hypot(cx, cz);
  if (d < 1e-4) { cx = a.x - b.x; cz = a.z - b.z; const l = Math.hypot(cx, cz) || 1; cx /= l; cz /= l; } else { cx /= d; cz /= d; }
  hullGap.d = d - (a.spec.beam + b.spec.beam) / 2; hullGap.nx = cx; hullGap.nz = cz;   // d < 0：疊在一起了；n：從對方指向自己
  return hullGap;
}
let bumpAt = 0;
function collideBoats(b, helm) {
  if (b.sinking || !(helm || Math.abs(b.speed) > 0.5)) return;
  let moved = false;
  for (const o of boats) {
    if (o === b || o.sinking) continue;
    if (Math.hypot(o.x - b.x, o.z - b.z) > (o.spec.len + b.spec.len) / 2 + 1) continue;
    const g = boatGap(b, o);
    if (g.d >= 0) continue;
    // 推開（推過去會卡進岸壁就不推，只把速度擋下來）
    const nx = b.x - g.nx * g.d, nz = b.z - g.nz * g.d;
    if (!hullBlocked(b, nx, nz) || hullBlocked(b, b.x, b.z)) { b.x = nx; b.z = nz; moved = true; }
    const along = Math.cos(b.heading) * g.nx + Math.sin(b.heading) * g.nz, into = b.speed * along;   // 往對方衝的速度（負的才是）
    if (into < 0) {
      b.speed -= into * along;
      if (into < -1.2 && time - bumpAt > 0.6) {
        bumpAt = time;
        audio.play('drop', clamp(-into / 5, 0.4, 1));
        if (player.boat === b) jetShake = Math.max(jetShake, clamp(-into / 12, 0.1, 0.5));
      }
    }
  }
  if (moved) b._pose();
}
const tieBoat = (m) => { m.boat.moor = { i: m.i, lx: m.lx, lz: m.lz, len: Math.max(m.d + 1, 2.5) }; };
function updateMooring(dt, helm) {
  for (const b of boats) {
    const m = b.moor;
    if (!m) continue;
    if (b.sinking) { b.moor = null; continue; }
    const post = BOLLARDS[m.i];
    const f = sea.vortices.length ? sea.flowAt(b.x, b.z) : null;
    if ((f && Math.hypot(f.x, f.z) > MOOR_FLOW) || surgeAt(b.x, b.z) > MOOR_LIFT) {
      b.moor = null;
      toast(`${b.spec.name}的纜繩被扯斷了！`);
      continue;
    }
    // 繩子拉直了：船被拉住，出不去
    const [cx, cz] = cleatXZ(b, m.lx, m.lz), dx = cx - post.x, dz = cz - post.z, d = Math.hypot(dx, dz);
    if (d > m.len) {
      // 往樁的方向拉回來；但船身不能被拉進岸壁裡（會卡進去的那個方向就不拉，船貼著岸壁滑）
      const k = (d - m.len) / d, sx = -dx * k, sz = -dz * k;
      if (d > m.len + 1 || hullBlocked(b, b.x, b.z) || !hullBlocked(b, b.x + sx, b.z + sz)) { b.x += sx; b.z += sz; }   // 繩子不會被拉長超過一公尺：真的拉不回來就硬拉
      else if (!hullBlocked(b, b.x + sx, b.z)) b.x += sx;
      else if (!hullBlocked(b, b.x, b.z + sz)) b.z += sz;
      if ((Math.cos(b.heading) * dx + Math.sin(b.heading) * dz) * b.speed > 0) {
        b.speed *= Math.exp(-dt * 6);
        if (helm && b === boat && Math.abs(b.throttle) > 0.3 && !moorToast) { moorToast = true; toast('纜繩還綁在岸上，要先下船解開'); }
      }
    }
    // 畫出來
    let ln = moorLines.get(b);
    if (!ln) { ln = new MoorLine(); moorLines.set(b, ln); scene.add(ln.mesh); }
    b.mesh.updateMatrixWorld();
    _rv.set(m.lx, b.spec.deck + b.spec.bul + 0.04, m.lz).applyMatrix4(b.mesh.matrixWorld);
    _rf.set(post.x, post.y, post.z);
    // 船在岸壁外、比碼頭面低：繩子先貼著碼頭面拉到邊緣，再垂到船上（不然會直直穿過岸壁的牆角）
    const edge = QUAY_Z + 0.05, over = _rv.z > edge + 0.1 && _rv.y < DECK_Y + 0.4;
    if (over) _mv.set(post.x + (_rv.x - post.x) * (edge - post.z) / (_rv.z - post.z), DECK_Y + 0.045, edge);
    ln.set(_rv, _rf, m.len + 0.5, tsuAt(_rv.x, _rv.z), over ? _mv : null);
  }
  for (const [b, ln] of moorLines) if (!b.moor || !boats.includes(b)) ln.mesh.visible = false;
  if (!helm) moorToast = false;
}
const hpText = (b) => `${Math.round(100 * (b.remote ? b.net?.[11] ?? 1 : b.hp / b.spec.hp))}%`;
const litres = (v) => (v >= 9.95 ? v.toFixed(0) : v.toFixed(1));
const itemLabel = (it) => (it.can ? `油桶（${litres(it.liters)} 公升）` : fishLabel(it));

// ---- 商店的商品架 -----------------------------------------------------------
// 錢、釣竿、扳手、買了哪些船都由伺服器保管（kit）；這幾個變數只是照著它顯示。買賣是送請求過去，伺服器算好再回來
let rodLv = 0;
let rodBroken = false;   // 釣竿斷了（爆桿）：要回商店修好才能再釣
let wrench = false;      // 有沒有扳手（修船用，買一次就一直有）
let buying = false;      // 已經送出購買、還在等伺服器回話
// 每樣商品現在賣什麼：lines = 價格牌上的三行字；price 為 null 表示沒得買。引擎和魚箱是裝在自己放在世界裡的那艘船上
function offer(id) {
  const o = shopItem(id, kit), cur = kit.boats[kit.active] ?? { engineLv: 0, boxLv: 0 }, bn = BOAT_TYPES[kit.active].name;
  if (id === 'fuel') return { name: `一桶油（${CAN} 公升）`, lines: [`油桶 ${CAN}公升`, '提到船尾倒進油箱', `$${o.price}`], price: o.price };
  if (id === 'wrench') {
    if (o.price === null) return { name: '扳手', lines: ['扳手', '已經有了', '售完'], price: null };
    return { name: '扳手', lines: ['扳手', '修補船上的破洞', `$${o.price}`], price: o.price };
  }
  if (id === 'rod') {
    // 錢不夠也修得起：身上有多少算多少（不然釣竿斷了又沒錢，就再也賺不到錢了）
    if (o.repair) return { name: '修理釣竿', act: '修理釣竿', lines: ['修理釣竿', '斷掉的釣竿修好', `$${o.price}`], price: o.price };
    if (o.price === null) return { name: '釣竿', lines: ['釣竿', '已經是最好的', '售完'], price: null };
    return { name: `第 ${kit.rodLv + 1} 級釣竿`, lines: [`釣竿 第${kit.rodLv + 1}級`, '拋更遠、更好拉', `$${o.price}`], price: o.price };
  }
  if (id === 'engine') {
    if (o.price === null) return { name: '引擎', lines: ['引擎', `${bn}已升到頂`, '售完'], price: null };
    return { name: `${bn}的第 ${cur.engineLv + 1} 級引擎`, lines: [`引擎 第${cur.engineLv + 1}級`, `裝在${bn}，更快`, `$${o.price}`], price: o.price };
  }
  if (id === 'box') {
    if (o.price === null) return { name: '魚箱', lines: ['魚箱', `${bn}已是最大`, '售完'], price: null };
    return { name: `${bn}的魚箱（${BOX_CAP[cur.boxLv + 1]} 條）`, lines: [`魚箱 ${BOX_CAP[cur.boxLv + 1]}條`, `放在${bn}，魚不跑`, `$${o.price}`], price: o.price };
  }
  const S = BOAT_TYPES[id];
  if (o.price === null) return { name: S.name, lines: [S.name, '已經買了', kit.active === id ? '停在港裡' : '收在倉庫'], price: null };
  return { name: S.name, lines: [S.name, id === 'fisher' ? '有駕駛艙，快又穩' : '最大、最快、最穩', `$${S.price}`], price: S.price };
}
function refreshTags() { SHELF.forEach((it, i) => setTag(i, offer(it.id).lines)); }
refreshTags();
// 站在哪樣商品前面（取最近的那一樣）
function nearShelf() {
  if (player.boat) return null;
  let best = null, bd = 1.1;
  for (const it of SHELF) {
    const d = Math.hypot(player.x - it.x, player.z - (SHELF_Z + 1.3));
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}
// 伺服器說家當變了（進房、買賣之後）：照著更新畫面
function applyKit(k) {
  kit = k;
  money = k.money; rodLv = k.rodLv; rodBroken = k.rodBroken; wrench = k.wrench;
  $('hMoney').textContent = cash(money);
  const cur = k.boats[k.active];
  if (cur && myBoat.spec.id === k.active) {
    myBoat.engineLv = cur.engineLv;
    if (cur.boxLv > 0 && cur.boxLv !== myBoat.boxLv) myBoat.setBox(cur.boxLv);
  }
  refreshTags();
  boards.setBerth(berth.label, BOAT_TYPES[k.active].name, Object.keys(k.boats).length > 1);
}
// 換一艘船放到世界裡（換船、沉了之後）。原本那艘收進倉庫（沉了的就沒了）；要的那艘倉庫裡有就拿出來，沒有就是新的
function useBoat(type, pose) {
  const old = myBoat;
  boats.splice(boats.indexOf(old), 1);
  old.mesh.removeFromParent();
  old.moor = null;
  old.setManned(false);
  if (old.sinking || old._lost) fish.wreck(old, false); else { old.stored = true; garage.set(old.spec.id, old); }
  let b = garage.get(type);
  const kept = garageState.get(type);
  garageState.delete(type);
  if (b) {
    garage.delete(type);
    b.stored = false;
    b.x = pose.x; b.z = pose.z; b.heading = pose.heading; b.speed = 0; b.throttle = 0;
    boats.push(b);
    scene.add(b.mesh);
  } else {
    const lv = kit.boats[type] ?? { engineLv: 0, boxLv: 0 };
    b = addBoat(type, pose, lv.boxLv);
    b.engineLv = lv.engineLv;
    if (kept) {   // 收進倉庫之後重新整理過頁面：油量、破洞照收進去時的樣子
      b.fuel = clamp(kept.fuel, 0, b.spec.tank);
      for (const c of kept.cracks) b.restoreCrack(c[0], c[1], c[2]);
    }
  }
  if (player.boat === old && mode === 'walk') player.place(walkWorld, player.x, player.z);
  myBoat = b;
  boat = b;
  camHeading = b.heading;
  b.update(0.016, calmEnv);
  lastBoatMsg = lastBoatDetail = '';
}

// ---- 坐下、站起來 -----------------------------------------------------------
// 船上的坐板、長椅可以坐：坐著照樣能釣魚、能轉頭看；按移動鍵、空白鍵或再按一次 E 就站起來
function sitDown(b, seat) {
  player.seat = { boat: b, x: seat.x, z: seat.z, h: seat.h, yaw: seat.yaw, out: seat.out, src: seat };
  player.lx = seat.x; player.lz = seat.z; player.h = 0; player.vy = 0;
  audio.play('sit');
}
function standUp() {
  const s = player.seat;
  if (!s) return;
  player.seat = null;
  // 站到位子旁邊的空位（長椅本身是擋路的，不能站在上面）
  for (const [dx, dz] of [s.out, [-s.out[0], -s.out[1]], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) {
    const lx = s.x + dx, lz = s.z + dz;
    if (s.boat.deckContains(lx, lz) && !s.boat.blockedLocal(lx, lz)) { player.lx = lx; player.lz = lz; break; }
  }
}

// ---- 準心：要對準東西才能互動 -------------------------------------------------
// 畫面正中央那條視線（第一人稱從眼睛看出去；第三人稱從鏡頭穿過人的頭看出去，也就是人物正在看的方向）
// 離哪樣東西最近，就是對準了它；人還要站得夠近才算。每樣東西當成一顆球：球越大越好對。
// 第三人稱比較難瞄，多放寬三十公分；鏡頭和人之間（人背後）的東西不算
const _aimO = new THREE.Vector3(), _aimD = new THREE.Vector3(), _aimV = new THREE.Vector3();
function aimTarget() {
  if (mode !== 'walk' || player.swim || drown) return null;
  const list = [], b = player.boat, px = player.x, pz = player.z;
  const add = (kind, pos, r, data = {}) => list.push({ kind, pos, r, ...data });
  if (b && !b.sinking) {
    b.mesh.updateMatrixWorld();
    const S = b.spec, D = S.deck, P = b.parts;
    const at = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(b.mesh.matrixWorld);
    const near = (x, z, r) => Math.hypot(player.lx - x, player.lz - z) < r;
    // 舵、魚箱、油箱、破洞、船燈只有自己的船能動；別人的船只能搭（坐下）
    if (b === myBoat) {
      if (nearHelm()) add('helm', at(P.helm.x, P.helm.y, P.helm.z), 0.5, { boat: b });
      if (nearBox()) add('box', at(S.box.x, D + 0.3, S.box.z), Math.max(S.box.w, S.box.d) / 2 + 0.05, { boat: b });
      if (near(P.tank.x, P.tank.z, 1.9)) add('tank', at(P.tank.x, P.tank.y, P.tank.z), 0.36, { boat: b });
      for (const c of b.damage) if (near(c.lx, c.lz, 1.7)) add('crack', at(c.lx, D + 0.05, c.lz), 0.4, { boat: b, crack: c });
      if (near(P.switch.x, P.switch.z, 2.3)) add('lamp', at(P.switch.x, P.switch.y, P.switch.z), P.switchR, { boat: b });
    }
    for (const s of P.seats) if (near(s.x, s.z, 1.7)) add('seat', at(s.x, D + s.h + 0.05, s.z), 0.42, { boat: b, seat: s });
  } else if (!b) {
    BOLLARDS.forEach((p, i) => {
      if (Math.hypot(px - p.x, pz - p.z) > 1.9) return;
      const m = bollardAt(i);
      if (m) add('bollard', new THREE.Vector3(p.x, p.y - 0.05, p.z), 0.36, { moor: m });
    });
    if (nearBasket()) add('basket', new THREE.Vector3(SELL.basket.x, DECK_Y + 0.3, SELL.basket.z), 0.5);
    if (nearButton()) add('button', new THREE.Vector3(SELL.button.x, DECK_Y + 1.1, SELL.button.z), 0.26);
    // 攤位上的商品：對準桌上的東西或後面的價格牌都算
    for (const it of SHELF) {
      if (Math.hypot(px - it.x, pz - (SHELF_Z + 1.3)) > 1.7) continue;
      add('shelf', new THREE.Vector3(it.x, DECK_Y + 1.1, SHELF_Z), 0.5, { shelf: it });
      add('shelf', new THREE.Vector3(it.x, DECK_Y + 1.95, SHELF_Z - 0.44), 0.6, { shelf: it });
    }
    // 停船位置牌
    if (Math.hypot(px - BOARDS.berth.x, pz - (BOARD_Z + 1.2)) < 2.4) add('berth', new THREE.Vector3(BOARDS.berth.x, DECK_Y + 1.7, BOARD_Z), 0.65);
  }
  // 放在甲板或地上的魚、油桶
  for (const it of fish.items) {
    if (it.boat && it.boat.stored) continue;   // 在收進倉庫的船上
    const v = fish.worldPos(it, new THREE.Vector3());
    if (Math.hypot(v.x - player.pos.x, v.z - player.pos.z) > 1.8 || Math.abs(v.y - player.pos.y) > 1.3) continue;
    v.y += it.can ? 0.2 : it.thick / 2;
    add('item', v, it.can ? 0.3 : clamp(it.len * 0.45, 0.22, 0.55), { item: it });
  }
  if (!list.length) return null;
  const fp = view.walk.fp;
  _aimO.copy(camera.position);
  camera.getWorldDirection(_aimD);
  const t0 = fp ? 0 : _aimV.set(player.pos.x, player.pos.y + 1.3, player.pos.z).sub(_aimO).dot(_aimD) - 0.3;
  let best = null, bs = 1;
  for (const c of list) {
    _aimV.copy(c.pos).sub(_aimO);
    const t = _aimV.dot(_aimD);
    if (t < t0) continue;
    const off = Math.sqrt(Math.max(0, _aimV.lengthSq() - t * t)), score = off / (c.r + (fp ? 0.03 * t : 0.3));
    if (score < bs) { bs = score; best = c; }
  }
  return best;
}

// E：對準什麼就做什麼——掌舵／拿起魚／開魚箱／加油／修船／開關船燈／坐下／綁纜繩／賣魚／買東西。
// 手上拿著東西時：對準魚箱、籃子、油箱就放進去（倒進去），沒對準就放在面前
function interact() {
  if (mode === 'sink') return;
  if (mode === 'helm') return releaseHelm();
  if (player.swim || drown) return;   // 在水裡騰不出手
  const a = aimTarget(), kind = a ? a.kind : '';
  if (fish.held && fish.held.can) {
    // 提著油桶：對準油箱的加油口就倒進去，倒不完的留在桶裡；沒對準就放下
    const can = fish.held, b = kind === 'tank' ? a.boat : null, room = b ? b.spec.tank - b.fuel : 0;
    if (room < 0.1) return fish.drop();
    const pour = Math.min(can.liters, room);
    b.fuel += pour; can.liters -= pour;
    audio.play('pour');
    if (can.liters < 0.1) { fish.discardHeld(); toast(`油倒進去了，油箱 ${litres(b.fuel)} / ${b.spec.tank} 公升`); }
    else toast(`油箱加滿了，桶裡還剩 ${litres(can.liters)} 公升`);
    return;
  }
  if (fish.held) {
    if (kind === 'basket') refreshBoard(fish.toBasket());
    else if (kind === 'box' && a.boat.boxFish.length < a.boat.boxCap) fish.toBox(a.boat);
    else fish.drop();
    audio.play('drop');
    return;
  }
  if (kind === 'seat' && player.seat && player.seat.src === a.seat) return standUp();
  if (fishing.state !== 'idle') return;   // 手上拿著釣竿
  switch (kind) {
    case 'helm': return takeHelm();
    case 'crack':
      if (!wrench) return toast('要有扳手才能修，商店有賣');
      a.boat.repair(a.crack);
      audio.play('repair');
      return toast(a.boat.damage.length ? `修好一處，還有 ${a.boat.damage.length} 處（耐久 ${hpText(a.boat)}）` : `都修好了（耐久 ${hpText(a.boat)}）`);
    case 'bollard': {
      const mr = a.moor;
      if (mr.tied) { mr.boat.moor = null; toast(`解開了${mr.boat.spec.name}的纜繩`); } else { tieBoat(mr); toast(`${mr.boat.spec.name}的纜繩綁好了`); }
      audio.play('rope');
      return;
    }
    case 'item': audio.play('pick'); return fish.pick(a.item);
    case 'box': if (a.boat.boxFish.length) { audio.play('pick'); fish.fromBox(a.boat); } return;
    case 'lamp':
      a.boat.lampOn = !a.boat.lampOn;
      audio.play('switch');
      return toast(a.boat.lampOn ? '船燈打開了' : '船燈關掉了');
    case 'seat': return sitDown(a.boat, a.seat);
    case 'button': {
      // 賣魚：把籃子裡每條魚的編號送給伺服器，它算好錢再回來（見下面的 sold）
      if (!fish.basket.length) return;
      if (!net.online) return toast('連線中斷，等接回去再賣');
      return net.send({ t: 'sell', uids: fish.basket.map((it) => it.uid) });
    }
    case 'shelf': {
      const o = offer(a.shelf.id);
      if (o.price === null) return toast(`${o.lines[0]}：${o.lines[1]}`);
      if (money < o.price) return toast(`錢不夠，${o.name}要 $${o.price}`);
      if (buying || !net.online) return;
      buying = true;
      window.setTimeout(() => { buying = false; }, 1500);
      return net.send({ t: 'buy', id: a.shelf.id });
    }
    case 'berth': {
      // 換船：倉庫裡還有別的船，就輪流換出來
      const types = BOAT_ORDER.filter((t) => kit.boats[t]);
      if (types.length < 2) return toast(`你的${myBoat.spec.name}停在 ${berth.label}。買了別的船可以來這裡換`);
      if (myBoat.sinking || !inHarbor(myBoat.x, myBoat.z)) return toast('船不在港裡，要先開回來才能換');
      sendBoatDetail();   // 先把這艘船現在的油量、破洞告訴伺服器（收進倉庫時它要記著）
      return net.send({ t: 'swap', type: types[(types.indexOf(kit.active) + 1) % types.length] });
    }
    default: if (player.seat) standUp();
  }
}

// 畫面下方的提示：能做什麼就顯示什麼
let promptText = null, aimHit = false;
function updatePrompt() {
  let text = '';
  const a = aimTarget(), kind = a ? a.kind : '';
  if (!!a !== aimHit) { aimHit = !!a; $('aim').classList.toggle('hit', aimHit); }   // 對準了東西：準心變成金色的大圈
  if (mode === 'walk') {
    const ab = a && a.boat;
    if (player.swim) {
      text = stamina < 0.3 ? '快沒力了！趕快上岸，或游到船邊爬上去'
        : fish.held ? `捧著${fish.held.sp.name}游：比較慢，也比較累` : '';
    } else if (fish.held && fish.held.can) {
      const b = kind === 'tank' ? ab : null;
      text = b && b.spec.tank - b.fuel >= 0.1 ? `按 E 把油倒進油箱（${litres(b.fuel)} / ${b.spec.tank} 公升）`
        : `${itemLabel(fish.held)}${b ? '　油箱是滿的' : ''}　按 E 放下${!b && nearTank() ? '（對準油箱可以加油）' : ''}`;
    } else if (fish.held) {
      text = kind === 'basket' ? '按 E 把魚放進籃子'
        : kind === 'box' ? (ab.boxFish.length < ab.boxCap ? `按 E 放進魚箱（${ab.boxFish.length}/${ab.boxCap}）` : `魚箱滿了（${ab.boxCap}/${ab.boxCap}）　按 E 放在地上`)
          : `${fishLabel(fish.held)}　按 E 放下${nearBox() ? '（對準魚箱可以放進去）' : nearBasket() ? '（對準籃子可以放進去）' : ''}`;
    } else if (fishing.state === 'wait') text = '等魚上鉤…（按 F 收回）';
    else if (fishing.state === 'bite') text = '魚咬了！快按 F';
    else if (fishing.state !== 'idle') text = '';
    else if (kind === 'helm') text = '按 E 掌舵';
    else if (kind === 'crack') text = wrench ? '按 E 用扳手修補破洞' : '船板破了一個洞（要有扳手才能修）';
    else if (kind === 'bollard') text = a.moor.tied ? `按 E 解開${a.moor.boat.spec.name}的纜繩` : `按 E 把${a.moor.boat.spec.name}的纜繩綁在這根樁上`;
    else if (kind === 'item') text = `按 E 拿起${a.item.can ? itemLabel(a.item) : a.item.sp.name}`;
    else if (kind === 'box') text = ab.boxFish.length ? `按 E 從魚箱拿一條出來（${ab.boxFish.length}/${ab.boxCap}）` : `魚箱是空的（0/${ab.boxCap}）`;
    else if (kind === 'tank') text = `油箱　${litres(ab.fuel)} / ${ab.spec.tank} 公升（提著油桶對準這裡按 E 加油）`;
    else if (kind === 'lamp') text = ab.lampOn ? '按 E 關掉船燈' : '按 E 打開船燈';
    else if (kind === 'seat') text = player.seat && player.seat.src === a.seat ? '按 E 站起來' : '按 E 坐下';
    else if (kind === 'button') text = fish.basket.length ? `按 E 按下按鈕賣出（$${fish.basketTotal}）` : '把魚拿過來放進籃子，就會顯示價格';
    else if (kind === 'basket') text = '把魚拿過來放進籃子，就會顯示價格';
    else if (kind === 'shelf') {
      const o = offer(a.shelf.id);
      text = o.price === null ? `${o.lines[0]}：${o.lines[1]}` : money >= o.price ? `按 E ${o.act || `購買${o.name}`}　$${o.price}` : `${o.name}　$${o.price}（錢不夠）`;
    } else if (kind === 'berth') {
      const types = BOAT_ORDER.filter((t) => kit.boats[t]);
      text = types.length > 1 ? `按 E 換船：${myBoat.spec.name} → ${BOAT_TYPES[types[(types.indexOf(kit.active) + 1) % types.length]].name}` : `你的${myBoat.spec.name}停在 ${berth.label}`;
    } else if (player.boat && player.boat.remote && nearHelm()) text = `這是 ${player.boat.owner.name} 的${player.boat.spec.name}：可以搭，只有船主能開`;
    else if (player.seat) text = '坐著（按 E 或移動鍵站起來）';
    else if (!player.boat && Math.hypot(player.x - (SHOP.x + 1.6), player.z - (SHOP.z + SHOP.d / 2 + 2)) < 3.2) {
      text = `${SHOP.name}　${SHOP.hint}`;
    }
  } else if (mode === 'helm') {
    $('hBoat').textContent = boat.aground ? '擱淺' : `${(Math.abs(boat.speed) * 1.944).toFixed(1)} 節`;
  }
  $('hClock').textContent = climate.label;
  $('hRoom').textContent = inGame ? `${room.name}　${others.count + 1} 人` : '';
  // 準備合併：倒數到最後半秒畫面先暗下來（換過去之後再亮起來）
  if (mergeAt && !wreck && !drown) {
    const left = mergeAt - performance.now();
    if (left < 700) $('fade').style.opacity = clamp(1 - left / 700, 0, 1);
    if (left < -4000) { mergeAt = 0; $('fade').style.opacity = 0; }   // 等太久沒合併成：恢復
  }
  // 人在船上時顯示這艘船的耐久與燃油
  const hb = mode === 'helm' ? boat : mode === 'walk' ? player.boat : null;
  $('hShip').style.display = hb ? 'inline' : 'none';
  if (hb) {
    $('hHp').textContent = hpText(hb);
    $('hHp').className = hb.hp < hb.spec.hp * 0.35 ? 'low' : '';
    $('hFuel').textContent = `${litres(hb.fuel)} / ${hb.spec.tank} 公升`;
    $('hFuel').className = hb.fuel < hb.spec.tank * 0.15 ? 'low' : '';
  }
  if (toastState.until && performance.now() > toastState.until) { toastState.until = 0; $('toast').style.display = 'none'; }
  if (!inGame) text = '';
  if (text !== promptText) {
    promptText = text;
    touchSet($('prompt'), text);
    $('prompt').style.display = text ? 'block' : 'none';
  }
  touch.update({
    on: inGame && !mapOpen && !chat.isOpen && !wheel.isOpen, helm: mode === 'helm', sink: mode === 'sink',
    target: !!a || mode === 'helm' || !!fish.held || !!player.seat,
    act: mode === 'helm' ? '放手' : fish.held ? (kind === 'tank' || kind === 'basket' || kind === 'box' ? '放進去' : '放下') : player.seat && !a ? '站起來' : '互動',
  });
}

// ---- 介面 -----------------------------------------------------------------
const audio = new OceanAudio();

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);
  const db = renderer.getDrawingBufferSize(new THREE.Vector2());
  const fovRad = THREE.MathUtils.degToRad(camera.fov);
  shared.uPixelAngle.value = fovRad / db.y;
  reflRT.setSize(Math.max(2, Math.floor(db.x / 2)), Math.max(2, Math.floor(db.y / 2)));
  deckRT.setSize(Math.max(2, Math.floor(db.x / 2)), Math.max(2, Math.floor(db.y / 2)));
  spray.material.uniforms.uScale.value = db.y / (2 * Math.tan(fovRad / 2));
}
window.addEventListener('resize', onResize);

// 畫質設定（解析度、低／中／高），見最上面 Renderer 那一段的說明
function setPixelRatio(q) {
  pixelRatio = q;
  renderer.setPixelRatio(q);
  onResize();
  $('quality').value = q;
  $('vQuality').textContent = `${q.toFixed(1)}×`;
}
$('quality').max = RATIO_MAX;
$('quality').value = pixelRatio;
$('vQuality').textContent = `${pixelRatio.toFixed(1)}×`;
$('quality').addEventListener('input', () => { setPixelRatio(+$('quality').value); ratioSaved = true; setPref('stormcast.res', pixelRatio); });
// 畫質「手機」：海面、地形、草的陰影取樣點減半（著色器裡的 LITE），要重新編譯這幾個材質
function applyLite() {
  scene.traverse((o) => {
    const m = o.material;
    if (!m || !m.isShaderMaterial || !m.fragmentShader.includes('sunShadow(')) return;
    if (!!m.defines.LITE === gfx.lite) return;
    if (gfx.lite) m.defines.LITE = 1; else delete m.defines.LITE;
    m.needsUpdate = true;
  });
}
function setGfx(lv) {
  gfxLv = lv; gfx = GFX[lv];
  if (SHADOW_HALF !== gfx.shadowHalf) {
    SHADOW_HALF = gfx.shadowHalf;
    Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF });
    sun.shadow.camera.updateProjectionMatrix();
  }
  if (SHADOW_SIZE !== gfx.shadow) {
    // 陰影貼圖換大小：舊的丟掉，下一幀會照新的大小重做一張
    SHADOW_SIZE = gfx.shadow;
    sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    shared.uShadowMap.value = null; shared.uShadowOn.value = 0;
    shared.uShadowTexel.value = 1 / SHADOW_SIZE;
  }
  if (grassN !== gfx.grass) {
    grassN = gfx.grass;
    grass.geometry.dispose();
    grass.geometry = makeGrassGeometry(grassN, GRASS_T);
  }
  applyLite();
  for (const b of $('gfx').children) b.classList.toggle('on', +b.dataset.v === lv);
}
for (const b of $('gfx').children) {
  b.classList.toggle('on', +b.dataset.v === gfxLv);
  b.addEventListener('click', () => { b.blur(); setGfx(+b.dataset.v); setPref('stormcast.gfx2', gfxLv); gfxSaved = true; });
}
applyLite();
// 設定裡換角色：記下來、重新載入（伺服器 30 秒內認得回來的人，會直接接回原本的房間）
for (const b of $('lookSet').children) {
  b.classList.toggle('on', b.dataset.look === myLook());
  b.addEventListener('click', () => {
    b.blur();
    if (b.dataset.look === myLook()) return;
    setMyLook(b.dataset.look);
    window.location.reload();
  });
}
// 手機：設定裡的全螢幕開關（收掉瀏覽器上面那條網址列）；瀏覽器不給全螢幕的（iPhone）改成教人加到主畫面
if (TOUCH && canFullscreen) {
  $('fullRow').style.display = 'flex';
  const show = () => { $('fullBtn').textContent = isFullscreen() ? '開' : '關'; $('fullBtn').classList.toggle('on', isFullscreen()); };
  $('fullBtn').addEventListener('click', () => { $('fullBtn').blur(); setFullscreen(!isFullscreen()); });
  document.addEventListener('fullscreenchange', show);
  document.addEventListener('webkitfullscreenchange', show);
  show();
} else if (TOUCH && !window.navigator.standalone && !window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches) {
  $('fullNote').style.display = 'block';
}
// 螢幕的縮放比例中途變了（視窗被縮放、拖到另一個螢幕、載入當下抓到的比例不對），解析度要跟著改；
// 不然畫面是用較低的解析度畫好再放大，邊緣就會糊掉、出現鋸齒。玩家自己調過解析度的話就不動它
function syncRatio() {
  const r = ratioFor();
  if (r === BASE_RATIO) return;
  BASE_RATIO = r;
  if (!ratioSaved) setPixelRatio(r);
}
window.addEventListener('resize', syncRatio);
window.setInterval(syncRatio, 2000);

// 離開房間：進度清空，回到大廳（船會在原地留 30 秒才被收走）
$('reset').addEventListener('click', () => {
  $('reset').blur();
  if (!inGame || !window.confirm('確定要離開房間嗎？這一局的進度會清空。')) return;
  net.leave();
  window.setTimeout(() => window.location.reload(), 200);
});

$('sound').addEventListener('click', () => {
  if (audio.on) audio.stop(); else audio.start();
  $('sound').textContent = audio.on ? '開' : '關';
  $('sound').classList.toggle('on', audio.on);
  $('sound').blur();
});

// 用實體按鍵位置（e.code）判斷，開著注音輸入法也能操作
const KEYMAP = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', ShiftLeft: 'shift', ShiftRight: 'shift', Space: 'space', KeyF: 'f' };
const keys = { w: false, a: false, s: false, d: false, shift: false, space: false, f: false, mouse: false };
// 動作與表情的輪盤：走路時按住 G 叫出來，移動滑鼠選，放開 G 播放
const wheel = new EmoteWheel();
function closeWheel(play) {
  const pick = wheel.close();
  if (!play || !pick) return;
  if (pick.kind === 'face') player.setMood(pick.id);
  else if (!player.playAction(pick.id)) toast('現在不能做這個動作（游泳、坐著、手上拿著東西時不行）');
}
// 手機的觸控操作：搖桿、滑動轉視角、右下角的按鈕、右上角的小按鈕（電腦上這個物件是空的，搖桿永遠是 0）
const touch = new TouchUI({
  canvas,
  look(dx, dy) {
    const v = view[mode], k = 0.0052;
    v.yaw += dx * k;
    if (mode === 'helm' && v.fp) v.yaw = clamp(v.yaw, -2.7, 2.7);
    v.pitch = clamp(v.pitch - dy * k, v.fp ? -1.1 : -1.4, v.fp ? 1.1 : 0.5);
  },
  zoom(k) { const v = view[mode]; v.dist = clamp(v.dist * k, ...DIST[mode]); },
  interact: () => { if (inGame) interact(); },
  fishDown() { if (!inGame) return; keys.f = true; fishing.press(); },
  fishUp() { keys.f = false; fishing.release(); },
  jump(on) { keys.space = on && inGame; },
  map: () => { if (inGame) toggleMap(); },
  chat: () => chat.open(),
  emote() { if (wheel.isOpen) closeWheel(false); else if (inGame && mode === 'walk' && !mapOpen) wheel.open(); },
  view: () => { if (inGame) toggleFp(); },
});
if (TOUCH) {
  // 表情輪盤：直接點那一格就播放，點在外面是取消
  wheel.root.style.pointerEvents = 'auto';
  wheel.root.style.touchAction = 'none';
  wheel.hint = '點一格';
  $('chatInput').placeholder = '說點什麼…（點畫面其他地方關閉）';
  const at = (e) => { e.preventDefault(); wheel.point(e.clientX, e.clientY); };
  wheel.root.addEventListener('pointerdown', at);
  wheel.root.addEventListener('pointermove', at);
  wheel.root.addEventListener('pointerup', (e) => { at(e); closeWheel(mode === 'walk'); });
  $('map').addEventListener('click', () => { if (mapOpen) toggleMap(); });
  $('mapNote').textContent = '紅色箭頭是你，黃色是你的船，白色是其他人　點一下地圖關閉';
}
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || !inGame) return;
  if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); chat.open(); return; }
  const k = KEYMAP[e.code];
  if (k) keys[k] = true;
  if (e.code === 'Space') e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'KeyC') toggleFp();
  if (e.code === 'KeyM') toggleMap();
  if (e.code === 'Escape' && mapOpen) toggleMap();
  if (e.code === 'KeyE') interact();
  if (e.code === 'KeyF') fishing.press();
  if (e.code === 'KeyG' && mode === 'walk' && !mapOpen) wheel.open();
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) keys[k] = false;
  if (e.code === 'KeyF') fishing.release();
  if (e.code === 'KeyG') closeWheel(mode === 'walk');
  if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) e.preventDefault();
});
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; closeWheel(false); });

// 按住滑鼠拖曳轉視角；滾輪調整第三人稱的距離
canvas.addEventListener('pointerdown', (e) => {
  if (TOUCH) { if (chat.isOpen) chat.close(); return; }   // 手機：畫面上的手指由觸控操作那邊接手（見 touch.js）；點一下畫面順便把聊天收起來
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); // 免得空白鍵按到面板上的按鈕
  if (aiming() && !locked()) { grabMouse(); return; }   // 第一人稱：點一下畫面就把滑鼠收回去
  if (e.button === 0) { if (!locked()) canvas.setPointerCapture(e.pointerId); keys.mouse = true; }
});
canvas.addEventListener('pointerup', () => { keys.mouse = false; });
canvas.addEventListener('pointercancel', () => { keys.mouse = false; });
// 瀏覽器偶爾會回報一筆大得離譜的滑鼠位移（滑鼠鎖在畫面裡時，游標被拉回中央的那一下漏進來；
// 剛鎖上、剛放開、視窗剛切回來的第一筆也常常是這樣），照單全收的話鏡頭會自己猛轉一大圈。
// 所以：鎖定狀態剛變、視窗剛切回來的那一小段時間不收；平常則跟前一筆比，突然冒出來的一大步丟掉。
// 手真的甩得很快時位移是一筆一筆變大的，不會被擋（頂多少掉開頭的一筆）
let lookSkip = 0, lookT = 0, lookMag = 0;
const lookPause = () => { lookSkip = performance.now() + 120; lookMag = 0; };
document.addEventListener('pointerlockchange', lookPause);
window.addEventListener('focus', lookPause);
function lookJump(e) {
  const mag = Math.hypot(e.movementX, e.movementY), now = performance.now();
  const calm = now - lookT > 120 ? 0 : lookMag;   // 停了一下再動：從零算起
  lookT = now;
  if (now < lookSkip) { lookMag = 0; return true; }
  if (mag > 150 && mag > 4 * calm + 40) { lookMag = Math.min(mag, 2 * calm + 60); return true; }
  lookMag = mag;
  return false;
}
canvas.addEventListener('pointermove', (e) => {
  if (TOUCH) return;
  if (wheel.isOpen) { if (!lookJump(e)) wheel.move(e.movementX, e.movementY); return; }   // 輪盤開著：滑鼠拿來選，不轉視角
  const free = locked();   // 滑鼠鎖在畫面裡：不用按著也能轉
  if (!free && !(e.buttons & 1)) return;
  if (lookJump(e)) return;
  const v = view[mode], k = free ? 0.0028 : 0.0045;
  v.yaw += e.movementX * k;
  if (mode === 'helm' && v.fp) v.yaw = clamp(v.yaw, -2.7, 2.7);
  v.pitch = clamp(v.pitch - e.movementY * k, v.fp ? -1.1 : -1.4, v.fp ? 1.1 : 0.5);
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const v = view[mode];
  v.dist = clamp(v.dist * Math.exp(e.deltaY * 0.001), ...DIST[mode]);
}, { passive: false });

// ---- 主迴圈 ---------------------------------------------------------------
const RAYS = 0.34;   // 太陽光束的強度
const _rv = new THREE.Vector3(), _rf = new THREE.Vector3(), _sp = new THREE.Vector3();
let time = 0;
// 閃電：三種——
//   雲裡的閃電（看不到閃電本身，只有那一片雲從裡面亮起來閃幾下，雷聲是遠遠的悶響）
//   打到海面或島上的閃電：大多在幾百公尺到兩三公里外，偶爾落在一兩百公尺內（爆裂的一聲、畫面跟著震）
//   在外海時偶爾直接打中船
// 光是立刻看到的，雷聲照距離晚到（每秒 343 公尺）：先看到閃、數幾秒才聽到，數得越久就是越遠
let flash = 0, boltIn = 4, boltK = 1, sheet = 0, sheetLeft = 0, thunderShake = 0;
const flashAt = new THREE.Vector3(0, 1, 0), thunderDue = [];
function lightning(kind) {
  const dg = dangerAt(boat.x, boat.z), r = Math.random();
  let x, z, d;
  if (kind !== 'far' && kind !== 'near' && kind !== 'cloud' && inGame && player.boat === myBoat && mode !== 'sink' && !myBoat.sinking && dg > 0.3 && Math.random() < 0.035 * dg) kind = 'hit';
  else if (!kind) kind = r < 0.38 ? 'cloud' : r < 0.5 ? 'near' : 'far';
  if (kind === 'cloud') {
    const a = Math.random() * Math.PI * 2, el = 0.35 + Math.random() * 0.5;
    flashAt.set(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
    sheetLeft = 0.25 + Math.random() * 0.45;
    d = 1500 + Math.random() * 2500;
    audio.thunder(d, _sp.copy(flashAt).multiplyScalar(d).add(camera.position));
    return;
  }
  if (kind === 'hit') {
    x = myBoat.x; z = myBoat.z;
    myBoat.hurt(myBoat.spec.hp * 0.22);
    splash(myBoat.x, myBoat.mesh.position.y + 1, myBoat.z, 40);
    toast('閃電打中了船！');
  } else {
    const a = Math.random() * Math.PI * 2;
    d = kind === 'near' ? 80 + Math.random() * 140 : 260 + 2300 * Math.random() ** 1.5;
    x = target.x + Math.cos(a) * d; z = target.z + Math.sin(a) * d;
  }
  bolt.strike(x, z, Math.max(0, bedAt(x, z)));
  d = Math.hypot(x - camera.position.x, z - camera.position.z);
  boltK = clamp(1.15 - d / 2600, 0.3, 1);          // 遠的閃電照過來沒那麼亮
  audio.thunder(d, _sp.set(x, 200, z));
  if (d < 900) thunderDue.push({ at: time + d / 343, k: (1 - d / 900) ** 2 });
}

// 時間、天氣與光線：每幀更新一次
let gloom = 0, rainNow = 0, night = 0;
function updateWeather(dt) {
  climate.update(dt);
  seaEnv.near.x = boat.x; seaEnv.near.z = boat.z;
  sea.update(dt, seaEnv);
  wind = climate.wind * (1 + 0.7 * climate.rain);   // 下雨的日子風浪跟著變大（中雨多三成、大雨多四成半）
  rainNow = Math.max(sea.rain, climate.rain);
  // 下雨的時候天一定是陰的：雨一開始下，雲就蓋滿整片天（不然會是藍天白雲、晚上滿天星星卻在下雨）
  const rainSky = clamp((rainNow - 0.02) / 0.23, 0, 1) * (0.78 + 0.22 * clamp(rainNow / 0.6, 0, 1));
  gloom = Math.max(sea.gloom, climate.cloud, rainSky);
  const fog = climate.fog * (1 - 0.6 * clamp(sea.storm, 0, 1));
  const L = climate.light();
  night = 1 - L.day;

  if (sea.thunder > 0.05 && (boltIn -= dt * sea.thunder) <= 0) { lightning(); boltIn = 2.5 + Math.random() * 4; }
  bolt.update(dt);
  if (bolt.mesh.visible) flashAt.copy(bolt.at).sub(camera.position).normalize();
  // 雲裡的閃電：那一片雲亂閃個零點幾秒
  if (sheetLeft > 0) { sheetLeft -= dt; if (Math.random() < dt * 16) sheet = Math.max(sheet, 0.22 + 0.4 * Math.random()); }
  sheet *= Math.exp(-dt * 13);
  flash = Math.max(bolt.light * boltK, sheet);
  // 雷聲到了：近的落雷畫面跟著震一下
  for (let i = thunderDue.length - 1; i >= 0; i--) if (time >= thunderDue[i].at) { thunderShake = Math.max(thunderShake, thunderDue[i].k); thunderDue.splice(i, 1); }
  thunderShake *= Math.exp(-dt * 2.4);

  // 海面、地形、天空的 shader
  sunDir.set(L.dir[0], L.dir[1], L.dir[2]);
  shared.uSunCol.value.set(L.col[0], L.col[1], L.col[2]);
  const wetDark = 1 - 0.22 * rainNow;   // 下大雨時雲層厚，整體再暗一階
  shared.uAmbient.value.set(L.amb[0] * wetDark + flash * 0.9, L.amb[1] * wetDark + flash * 0.95, L.amb[2] * wetDark + flash * 1.1);
  shared.uDay.value = L.day; shared.uDusk.value = L.dusk;
  shared.uFog.value = fog; shared.uFlash.value = flash; shared.uRain.value = rainNow; shared.uSurge.value = sea.surge;
  shared.uFlashDir.value.copy(flashAt);
  shared.uWaveScale.value = wind * sea.lull;
  shared.uStorm.value = sea.storm;
  shared.uGloom.value = gloom;
  shared.uTsu.value.set(sea.tsu.dx, sea.tsu.dz, sea.tsu.front, sea.tsu.on ? sea.tsu.H : 0);
  shared.uTsu2.value.set(sea.tsu.seed || 0, 0);
  waveSpray.update(sea.tsu.on);
  shared.uVortex.value.forEach((u, i) => {
    const v = sea.vortices[i];
    if (v) u.set(v.x, v.z, v.s, v.kind === 'whirl' ? 1 : 2); else u.set(0, 0, 0, 0);
  });

  // 船、人、港口、樹用的 three.js 光源
  const lv = Math.max(L.col[0], L.col[1], L.col[2], 1e-3);
  sun.color.setRGB(L.col[0] / lv, L.col[1] / lv, L.col[2] / lv);
  sun.intensity = 2.5 * lv * (1 - 0.75 * gloom);
  hemi.intensity = 2.2 * L.amb[1] * wetDark * (1 - 0.35 * gloom) + flash * 2.5;

  // 天黑了燈才亮：碼頭燈、船上的油燈、燈塔的光束
  const glow = clamp((night - 0.35) / 0.45, 0, 1);
  if (boatLight.parent !== boat.mesh) { boat.mesh.add(boatLight); boatLight.position.copy(boat.parts.lamp); }
  boatLight.intensity = boat.lampOn ? 10 * glow : 0;   // 船燈可以自己關掉
  lampLights.forEach((l, i) => {
    l.intensity = 10 * glow;
    shared.uLamp.value[i].set(l.position.x, l.position.z, 0.55 * glow);
  });
  EXTRA_LAMPS.forEach((p, i) => shared.uLamp.value[5 + i].set(p.x, p.z, p.k * glow));
  for (const m of BULBS) m.color.copy(m.userData.base).multiplyScalar(0.7 + 1.5 * glow * m.userData.k);   // 燈泡：天黑後亮到會暈開
  for (const b of boats) b.showLamp(glow);   // 船上的燈另外看開關
  for (const p of POOLS) { p.mesh.visible = glow > 0.02; p.mat.opacity = p.k * glow; }
  bloom.strength = 0.22 + 0.16 * glow;
  shared.uLamp.value[4].set(boat.x, boat.z, boat.sinking || !boat.lampOn ? 0 : 0.45 * glow);
  const lit = clamp(0.3 + L.amb[1], 0, 1);
  for (const m of UNLIT) m.color.setScalar(lit);
  boards.light(lit, glow);   // 看板晚上自己打燈
  for (const m of GLOW) m.emissiveIntensity = 1.3 * glow;   // 天黑了，窗戶透出燈光
  scenery.beam.visible = glow > 0.02;
  scenery.beamMat.uniforms.opacity.value = 0.34 * glow * (1 + 1.5 * fog);
  scenery.beam.rotation.y += dt * 0.55;
  shared.uBeam.value.set(scenery.beam.position.x, scenery.beam.position.z, Math.cos(scenery.beam.rotation.y), -Math.sin(scenery.beam.rotation.y));
  shared.uBeamOn.value = glow;

  airFog.density = Math.hypot(HAZE, fog / 200, RAIN_HAZE * Math.sqrt(rainNow));   // 下大雨時遠處罩在雨幕裡（跟 shader 的 applyFog 一致）
  // 霧的顏色：平常是地平線的天色（跟 shader 裡的 skyGradient 一致），起霧時偏灰白
  const mixv = (a, b, t) => a + (b - a) * t;
  const hz = [[0.50, 0.36, 0.016], [0.71, 0.40, 0.028], [0.88, 0.44, 0.055]].map(([clear, dull, dark], i) =>
    mixv(mixv(dark, mixv(clear, dull, gloom) * (1 - 0.3 * rainNow), L.day) + [1.0, 0.40, 0.10][i] * L.dusk * (1 - gloom) * 0.2, [0.70, 0.74, 0.78][i] * L.amb[i], fog));
  airFog.color.setRGB(hz[0], hz[1], hz[2]);

  // 水龍捲：暗雲、漏斗、水霧、被捲起來的水花（都在 skyfx.js 裡畫）
  const light = clamp(L.amb[1] + flash, 0.14, 1);
  const list = sea.vortices.filter((v) => v.kind === 'spout');
  spouts.forEach((m, i) => m.update(list[i]));
  // 風：一陣強一陣弱（幾道快慢不同的起伏疊在一起）
  const sg = clamp(sea.storm, 0, 1.8);
  gale.steady = 3 + 8 * sg + 7 * sg * sg;
  gale.v = gale.steady * (1 + 0.28 * Math.sin(time * 0.37) + 0.17 * Math.sin(time * 1.13 + 2) + 0.1 * Math.sin(time * 2.9 + 5));
  gale.x = WDX * gale.v; gale.z = WDZ * gale.v;
  // 雲跟著風飄：平常慢慢的，颱風時低雲整片飛過去
  shared.uCloudT.value.x -= WDX * 0.0005 * gale.steady * dt; shared.uCloudT.value.y -= WDZ * 0.0005 * gale.steady * dt;
  shared.uSwell.value = SWELL.amp * sea.swell;
  // 雨被風吹斜：颱風時幾乎是橫著飛的
  const cpos = camera.position, wk = windK(cpos.x, cpos.z);
  rain.update(time, cpos, rainNow, light, gale.x * wk, gale.z * wk);
  // 飛沫：風夠大、人在開闊的海面上才有
  spindrift.update(time, cpos, clamp((gale.v * wk - 15) / 22, 0, 1) * clamp(dangerAt(cpos.x, cpos.z) * 2.5, 0, 1), swellAmp(cpos.x, cpos.z), light, gale.x, gale.z);
  // 雨跟地面的互動：地面慢慢淋濕（雨停了慢慢乾）；雨點打在地上、岸壁上濺起小水花（水面上的是漣漪，在海面的 shader 裡）
  // 彩虹：下過一陣像樣的雨之後，雨停、雲散、太陽露臉才出現，掛個兩三分鐘慢慢淡掉；晚上沒有
  if (rainNow > 0.15) bowLeft = 1;
  const bowShow = bowLeft * clamp(1 - rainNow / 0.12, 0, 1) * clamp(1.5 - gloom * 3, 0, 1) * clamp(L.day * 2 - 1, 0, 1);
  if (bowShow > 0.05) bowLeft = Math.max(0, bowLeft - dt / 160);   // 開始看得到才倒數（天還陰著就先留著）
  shared.uRainbow.value += (bowShow - shared.uRainbow.value) * (1 - Math.exp(-dt / 5));
  shared.uWet.value = clamp(shared.uWet.value + (rainNow > 0.05 ? dt / 12 * (0.4 + rainNow) : -dt / 80), 0, 1);
  WET.wet.value = shared.uWet.value; WET.rain.value = rainNow; WET.time.value = time;   // 港口的水泥地跟著濕、積水
  if (rainNow > 0.05) {
    splashAcc = Math.min(splashAcc + dt * 720 * rainNow, 60);
    for (; splashAcc >= 1; splashAcc--) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 12;
      const x = target.x + Math.cos(a) * r, z = target.z + Math.sin(a) * r, y = walkGround(x, z);
      if (y < 0.05 || y > 50) continue;   // 落在水裡的、牆和石頭上的不算
      for (let k = 0; k < 2; k++) {
        const b = Math.random() * Math.PI * 2, v = 0.3 + Math.random() * 0.7;
        spray.emit(x, y + 0.03, z, Math.cos(b) * v, 0.9 + Math.random() * 0.9, Math.sin(b) * v, 0.14 + Math.random() * 0.1, 0.11 + Math.random() * 0.08);
      }
    }
  }
}
let splashAcc = 0, bowLeft = 0;

function updateOcean(dt) {
  updateWeather(dt);
  ocean.update(time, dt, shared.uWaveScale.value, shared.uWaveScale.value * (1 + 0.7 * sea.storm));
  shared.uDisp0.value = ocean.cascades[0].disp[ocean.cascades[0].cur].texture;
  shared.uDisp1.value = ocean.cascades[1].disp[ocean.cascades[1].cur].texture;

  sweEnv.disp0 = shared.uDisp0.value; sweEnv.time = shared.uTime.value;
  sweEnv.waveScale = shared.uWaveScale.value; sweEnv.storm = shared.uStorm.value; sweEnv.surge = shared.uSurge.value;
  shallow.update(dt, target, SWE_ON && shallowNear(target), sweEnv);
  shared.uSweOn.value = shallow.on ? 1 : 0;
  shared.uSweOrigin.value.copy(shallow.origin);
  shared.uSweWet.value = shallow.wetTexture;
}
updateOcean(0);

const calmEnv = { ground: boatGround, wave: surgeAt, base: surgeAt, limit: L / 2 - 30 };   // 停在港裡、沒人用的船：平常不動，巨浪淹進港口時跟著浮起來
const boatEnv = {
  ground: boatGround,
  wave: (x, z) => ocean.sampleCached(x, z) * waveK(x, z) + tsuAt(x, z),
  // 畫面上看得到的那片水面（長浪加中浪、含浪頭的水平位移）：船身貼著它浮。fade：淺水裡浪變小幾成
  waveFine: (x, z, fade) => ocean.sampleSurface(x, z, waveK(x, z) * fade) + tsuAt(x, z),
  base: (x, z) => surgeAt(x, z) + swellH(x, z),   // 巨浪把整艘船托起來的高度
  bank: (x, z) => (sea.vortices.length ? sea.vortexH(x, z) : 0),   // 大漩渦的漏斗：船貼著斜面跟著水轉，這個坡度不算被浪搖歪
  // 漩渦與水龍捲的拉扯；巨浪的浪頭上，水是往前衝的，船會被帶著走
  flow: (x, z) => {
    let f = sea.vortices.length ? sea.flowAt(x, z) : null;
    // 強風（風暴、颱風）：船被吹著往下風處漂；橫著受風時整艘被壓歪（gx、gz：風速相對於 40 公尺／秒）
    const gv = gale.v * (0.2 + 0.8 * shelterAt(x, z));
    if (gv > 14) {
      f = f || { x: 0, z: 0, spin: 0, wx: 0, wz: 0 };
      const drift = 0.022 * (gv - 14);
      f.x += WDX * drift; f.z += WDZ * drift;
      f.gx = WDX * gv / 40; f.gz = WDZ * gv / 40;
    }
    if (!sea.tsu.on) return f;
    const h = surgeAt(x, z) / sea.tsu.H;
    if (h < 0.05) return f;
    const o = f || { x: 0, z: 0, spin: 0, wx: 0, wz: 0 }, p = TSU.push * TSU.speed * Math.min(h, 1) ** 1.5;
    o.x += sea.tsu.dx * p; o.z += sea.tsu.dz * p;
    return o;
  },
  limit: L / 2 - 30,
};

// ---- 沉船 -------------------------------------------------------------------
// 船被打翻或破得太嚴重就會沉。人在船上的話畫面漸漸變暗，再回到港口；
// 還有別艘船就沒事，一艘都不剩的話碼頭邊會有一艘小舢舨留給你
let wreck = null;   // 正在沉的船 { boat, t, aboard 自己在不在上面, mine 是不是自己的船, sent 已經告訴伺服器沉完了 }
let fadeIn = 0;     // 回到港口後，畫面由暗轉亮還剩幾秒
const SUNK_TEXT = { capsize: '被浪打翻了！', flood: '破得太嚴重，沉了！', whirl: '被漩渦吞下去了！', spout: '被水龍捲捲翻了！', curl: '被捲下來的浪頭壓進海裡了！' };
function beginWreck(b) {
  const aboard = player.boat === b, mine = b === myBoat;
  b._wrecked = true;
  wreck = { boat: b, t: 0, aboard, mine, sent: false };
  fish.wreck(b, aboard);
  toast((mine ? b.spec.name : `${b.owner.name} 的${b.spec.name}`) + (SUNK_TEXT[b.sunkBy] ?? '沉了！'));
  if (mine) net.send({ t: 'sink', why: b.sunkBy, side: b._side });
  if (!aboard) return;
  fishing.cancel();
  mode = 'sink';
  camHeading = b.heading;
  view.sink.dist = clamp(b.spec.len * 1.8, ...DIST.sink);
  applyViewSettings();
}
// 被救回港口
function rescue(text) {
  mode = 'walk';
  player.place(walkWorld, PLAYER_SPAWN.x, PLAYER_SPAWN.z);
  player.yaw = view.walk.yaw = PLAYER_SPAWN.yaw;
  applyViewSettings();
  fadeIn = 1.6;
  toast(text);
}
function endWreck() {
  // 自己的船：告訴伺服器沉完了，等它回話（swapped）——倉庫裡還有船就換一艘出來，一艘都不剩就送一艘小舢舨
  if (wreck.mine) {
    if (!wreck.sent && net.online) { wreck.sent = true; net.send({ t: 'boatLost' }); }
    return;
  }
  const { aboard } = wreck;
  wreck = null;
  if (aboard) rescue('你被救回港口');
}
function updateWreck(dt) {
  if (!wreck) {
    if (myBoat.sinking && !myBoat._wrecked) beginWreck(myBoat);
    else if (mode === 'walk' && player.boat && player.boat.remote && player.boat.sinking && !player.boat._wrecked) beginWreck(player.boat);   // 搭的那艘船沉了
  }
  if (wreck) {
    wreck.t += dt;
    if (wreck.aboard) $('fade').style.opacity = clamp((wreck.t - 1.5) / 3, 0, 1);
    if (wreck.t > 5) endWreck();
  } else if (fadeIn > 0) {
    fadeIn = Math.max(0, fadeIn - dt);
    $('fade').style.opacity = fadeIn / 1.6;
  }
}
let fuelWarned = false;

// ---- 游泳 -------------------------------------------------------------------
// 水深過胸就會浮起來游；從碼頭或船上要用跳的才會下水。游泳耗體力，回到岸上或船上會慢慢恢復；
// 體力用完會溺水：畫面變暗，被救回港口，手上的東西就沒了
const SWIM_SECONDS = 50;   // 不拿東西、慢慢游，可以游多久
let stamina = 1, drown = null, wasSwim = false, stamShown = false, surgeToast = false, whirlToast = false;
function beginDrown(text) {
  drown = { t: 0, text };
  fishing.cancel();
}
// 浪推著游泳的人：浪峰經過時把人往浪前進的方向推、浪谷時拉回來（跟浪高同相，所以人在原地前後晃），
// 暴風雨裡另外有一股順著風浪的漂流，人會被慢慢沖走；身體也跟著浪面前後左右傾斜
const _ws = { f: 0, r: 0 };
function waveRide(dt) {
  const x = player.x, z = player.z, d = -bedAt(x, z);
  const k = clamp((d - 0.3) / 7.7, 0, 1) * waveK(x, z);
  if (k <= 0) { player.waveSlope(0, 0); return; }
  const eta = swimWave * k;
  const storm = clamp(sea.storm, 0, 1) * clamp(stormK(x, z) - 1, 0, 1);
  const u = 0.6 * eta + 0.5 * storm + 0.12 * clamp(shared.uWaveScale.value - 1, 0, 2);
  player.drift(WDX * u * dt, WDZ * u * dt, walkWorld);
  const e = 0.9, gx = (ocean.sampleHeight(x + e, z) - ocean.sampleHeight(x - e, z)) / (2 * e) * k;
  const gz = (ocean.sampleHeight(x, z + e) - ocean.sampleHeight(x, z - e)) / (2 * e) * k;
  player.waveSlope(gx, gz);
}

function updateSwim(dt) {
  if (drown) {
    drown.t += dt;
    $('fade').style.opacity = clamp(drown.t / 2, 0, 1);
    if (drown.t > 2.4) {
      const lost = fish.held ? `，手上的${fish.held.sp.name}掉進海裡了` : '';
      if (fish.held) fish._gone([fish.held]);
      fish.discardHeld();
      player.place(walkWorld, PLAYER_SPAWN.x, PLAYER_SPAWN.z);
      player.yaw = view.walk.yaw = PLAYER_SPAWN.yaw;
      stamina = 1;
      fadeIn = 1.6;
      toast(drown.text + lost);
      drown = null;
    }
  } else if (mode === 'walk' && player.swim) {
    // 用力游、捧著東西、浪大都比較累；停著踩水比較省力
    const rough = clamp(ocean.scale * stormK(player.x, player.z) - 1.3, 0, 2);
    const k = (player.moving ? (keys.shift || touch.run ? 1.45 : 1) : 0.6) * (player.carry ? 1.35 : 1) * (1 + 0.4 * rough);
    stamina -= dt * k / SWIM_SECONDS;
    // 巨浪沖上岸：人浮在湧進來的水裡，被水帶著往浪前進的方向沖
    const sg = surgeAt(player.x, player.z);
    if (sg > 0.4) {
      const p = 4.5 * clamp(sg / 3, 0, 1);
      player.drift(sea.tsu.dx * p * dt, sea.tsu.dz * p * dt, walkWorld);
      if (!surgeToast) { surgeToast = true; toast('大浪沖上岸了！'); }
    }
    if (sea.vortices.length) {
      // 漩渦和水龍捲也會把人拉過去
      const f = sea.flowAt(player.x, player.z);
      player.drift(f.x * dt, f.z * dt, walkWorld);
      const core = sea.coreAt(player.x, player.z);
      if (core) beginDrown(core === 'whirl' ? '你被漩渦捲了下去，被救回港口' : '你被水龍捲捲了進去，被救回港口');
    }
    if (stamina <= 0 && !drown) { stamina = 0; beginDrown('你游到沒力，被救回港口'); }
  } else if (!player.onWater) stamina = Math.min(1, stamina + dt / 12);   // 從水裡跳起來、還在半空中時不回體力
  if (wasSwim && !player.swim && player.onWater && player.h > 0) stamina = Math.max(0, stamina - 0.04);   // 在水裡跳一下要花一點力氣

  if (player.swim && !wasSwim) { splash(player.x, playerWater(player.x, player.z) + 0.1, player.z, 18); audio.play('dive'); }
  wasSwim = player.swim;

  const show = mode === 'walk' && (player.swim || stamina < 0.999);
  if (show !== stamShown) { stamShown = show; $('stam').style.display = show ? 'flex' : 'none'; }
  if (show) {
    $('stamFill').style.width = `${stamina * 100}%`;
    $('stamFill').className = stamina < 0.3 ? 'low' : '';
  }
}

// ---- 地圖（M） ---------------------------------------------------------------
// 上方是北。畫出每座島、母港、自己的每艘船，還有自己的位置與面向
const MAP_PX = 560;
let mapOpen = false, mapBase = null;
function makeMapBase() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = MAP_PX;
  const g = cv.getContext('2d'), img = g.createImageData(MAP_PX, MAP_PX), d = img.data;
  const mix = (a, b, t) => a + (b - a) * t;
  for (let py = 0; py < MAP_PX; py++) {
    for (let px = 0; px < MAP_PX; px++) {
      const x = ((px + 0.5) / MAP_PX - 0.5) * L, z = ((py + 0.5) / MAP_PX - 0.5) * L;
      const h = bedAt(x, z);
      let r, gr, b;
      if (h > 0.15) {
        // 陸地：沙灘 → 草地 → 山頂，西北面受光、東南面背光
        const t = clamp((h - 0.8) / 2.6, 0, 1), u = clamp((h - 5) / 13, 0, 1);
        const shade = clamp(1 + (h - bedAt(x - 4, z - 4)) * 0.07, 0.78, 1.18);
        r = mix(mix(232, 128, t), 92, u) * shade; gr = mix(mix(214, 168, t), 130, u) * shade; b = mix(mix(168, 96, t), 78, u) * shade;
      } else {
        // 海：淺灘比較亮，越深越藍
        const t = clamp(-h / 16, 0, 1), k = Math.sqrt(t);
        r = mix(168, 36, k); gr = mix(222, 92, k); b = mix(220, 132, k);
      }
      const o = (py * MAP_PX + px) * 4;
      d[o] = r; d[o + 1] = gr; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}
function drawMap() {
  const g = $('mapCv').getContext('2d');
  g.drawImage(mapBase, 0, 0);
  const P = (x, z) => [(x / L + 0.5) * MAP_PX, (z / L + 0.5) * MAP_PX];
  g.lineJoin = 'round';
  g.textBaseline = 'middle';
  g.font = '600 13px system-ui, "Microsoft JhengHei", sans-serif';
  const placed = [];
  // 文字標在記號右邊；跟別的標籤疊在一起就往下排
  const label = (text, x, y, color) => {
    let ly = y;
    while (placed.some((p) => Math.abs(p.x - x) < 70 && Math.abs(p.y - ly) < 15)) ly += 15;
    placed.push({ x, y: ly });
    g.lineWidth = 3.5; g.strokeStyle = 'rgba(20, 30, 40, 0.85)'; g.fillStyle = color;
    g.strokeText(text, x + 11, ly); g.fillText(text, x + 11, ly);
  };
  // 尖頭朝行進方向的記號
  const arrow = (x, y, yaw, len, wid, fill) => {
    g.save();
    g.translate(x, y); g.rotate(yaw);
    g.beginPath(); g.moveTo(len, 0); g.lineTo(-len * 0.75, wid); g.lineTo(-len * 0.35, 0); g.lineTo(-len * 0.75, -wid); g.closePath();
    g.lineWidth = 2.5; g.strokeStyle = 'rgba(20, 30, 40, 0.9)'; g.stroke();
    g.fillStyle = fill; g.fill();
    g.restore();
  };

  // 指北
  g.fillStyle = 'rgba(20, 30, 40, 0.55)';
  g.beginPath(); g.moveTo(MAP_PX - 26, 14); g.lineTo(MAP_PX - 19, 30); g.lineTo(MAP_PX - 33, 30); g.closePath(); g.fill();
  g.textAlign = 'center'; g.fillText('北', MAP_PX - 26, 42); g.textAlign = 'left';

  // 母港
  const [hx, hy] = P(0, 122);
  g.beginPath(); g.arc(hx, hy, 5, 0, Math.PI * 2);
  g.lineWidth = 2.5; g.strokeStyle = 'rgba(20, 30, 40, 0.9)'; g.stroke();
  g.fillStyle = '#fff'; g.fill();
  label('母港', hx, hy - 12, '#fff');

  // 同房的其他人和他們的船（白色）
  for (const o of others.list()) {
    if (o.boat) { const [bx, by] = P(o.boat.x, o.boat.z); arrow(bx, by, o.boat.heading, 5.5, 3.5, 'rgba(255, 255, 255, 0.75)'); }
    if (!o.here) continue;
    const [ox, oy] = P(o.x, o.z);
    g.beginPath(); g.arc(ox, oy, 3.2, 0, Math.PI * 2);
    g.lineWidth = 2; g.strokeStyle = 'rgba(20, 30, 40, 0.9)'; g.stroke();
    g.fillStyle = '#fff'; g.fill();
    label(o.name, ox, oy, '#fff');
  }
  // 自己的船
  if (!myBoat.sinking) {
    const [bx, by] = P(myBoat.x, myBoat.z);
    arrow(bx, by, myBoat.heading, 7, 4.5, '#ffd257');
    label(myBoat.spec.name, bx, by, '#ffe9a8');
  }

  // 自己：掌舵時就是船的位置與船首方向
  const helm = mode !== 'walk';
  const [mx, my] = helm ? P(boat.x, boat.z) : P(player.x, player.z);
  arrow(mx, my, helm ? boat.heading : player.yaw, 9, 6, '#ff5a3c');
  label('你', mx, my + (helm ? 15 : 0), '#ffb9a6');
}
function toggleMap() {
  mapOpen = !mapOpen;
  $('map').style.display = mapOpen ? 'block' : 'none';
  syncAim();
  if (!mapOpen) return;
  if (!mapBase) mapBase = makeMapBase();
  drawMap();
}


// 釣魚時的介面：拋竿是力道條；收線是「亂跑的區間 + 自己的力道指標 + 拉近的進度」
let fishUiOn = false;
function updateFishUi() {
  const st = fishing.state, on = st === 'charge' || st === 'fight';
  if (on !== fishUiOn) { fishUiOn = on; $('fishui').style.display = on ? 'block' : 'none'; }
  if (!on) return;
  const fight = st === 'fight';
  $('barSafe').style.display = $('barMark').style.display = $('prog').style.display = fight ? 'block' : 'none';
  // 釣竿的負荷：只有魚的力氣大到可能把竿子拉斷時才顯示；快滿的時候整塊介面跟著抖
  const strain = fight ? fishing.strain : 0;
  $('strain').style.display = fight && fishing.risk > 0 ? 'flex' : 'none';
  $('strainFill').style.width = `${Math.min(strain, 1) * 100}%`;
  $('fishui').style.marginLeft = strain > 0.35 ? `${(Math.random() - 0.5) * 10 * strain}px` : '0';
  if (!fight) {
    $('barFill').style.width = `${fishing.power * 100}%`;
    $('barFill').style.background = '#e2b21c';
    $('fishLabel').textContent = '拋竿力道';
    touchSet($('fishHint'), '放開 F 拋出去');
    return;
  }
  $('barFill').style.width = '0';
  $('barSafe').style.left = `${(fishing.zone - fishing.zoneW / 2) * 100}%`;
  $('barSafe').style.width = `${fishing.zoneW * 100}%`;
  $('barMark').style.left = `${fishing.force * 100}%`;
  $('barMark').style.background = fishing.inZone ? '#fff' : '#ff8a70';
  $('progFill').style.width = `${clamp(fishing.progress, 0, 1) * 100}%`;
  $('fishLabel').textContent = `把白色指標維持在綠色區間內　還有 ${Math.max(fishing.dist, 0).toFixed(0)} 公尺`;
  touchSet($('fishHint'), strain > 0.5 ? '釣竿快斷了！放開 F！' : fishing.inZone ? '很好，保持住' : fishing.force < fishing.zone ? '力道不夠：按住 F' : '太用力了：放開 F');
}

// ---- 多人：跟伺服器對時、送出自己的狀態、照伺服器說的更新 -----------------------
let mergeAt = 0;   // 這間房幾時要合併到別間（倒數用；0 = 沒有）
// 海浪是「時間的函數」，每 WAVE_LOOP 秒循環一次：時間跟房間對齊，每個人看到的浪就一模一樣
// （別人的船是照他那邊的浪在搖的，放到這邊的海面上才會剛好貼著水）
// 進房之後，時間不是一幀一幀加上去的，而是「房間的時間 = clockBase + 這台電腦的時鐘」：畫面再卡，浪也不會慢慢跟別人錯開
let clockBase = null;
function syncTime(roomT, snap) {
  const est = roomT - performance.now() / 1000;
  if (clockBase === null) { clockBase = est - Math.floor(roomT / WAVE_LOOP) * WAVE_LOOP; return; }   // 從 0 到 WAVE_LOOP 之間開始（數字小，畫面上的動畫才細）
  const d = ((est - clockBase) % WAVE_LOOP + WAVE_LOOP * 1.5) % WAVE_LOOP - WAVE_LOOP / 2;
  // 差很多就直接對過去。差一點點：訊息只會晚到、不會早到，所以「比現在早」的那一筆比較準，跟得快；「比現在晚」的多半只是網路慢了一下，跟得很慢
  clockBase += snap || Math.abs(d) > 1.5 ? d : d * (d > 0 ? 0.5 : 0.02);
}
// 伺服器每半秒送一次時間、天氣、海上事件：照著蓋過去（兩次之間這邊自己往前推）
function applyWorld(w, snap = false) {
  Object.assign(climate, w.climate);
  const oldV = sea.vortices, oldFront = sea.tsu.on ? sea.tsu.front : null;
  for (const k in w.sea) sea[k] = w.sea[k];
  for (const k of ['spoutIn', 'next', 'typhoonIn']) if (sea[k] >= 1e9) sea[k] = Infinity;
  if (!snap) {
    // 浪頭和漩渦的位置：差一點點就慢慢靠過去，不要每半秒頓一下
    if (oldFront !== null && sea.tsu.on && Math.abs(sea.tsu.front - oldFront) < 25) sea.tsu.front = oldFront + (sea.tsu.front - oldFront) * 0.15;
    sea.vortices.forEach((v, i) => {
      const o = oldV[i];
      if (o && o.kind === v.kind && Math.hypot(o.x - v.x, o.z - v.z) < 25) { v.x = o.x + (v.x - o.x) * 0.15; v.z = o.z + (v.z - o.z) * 0.15; }
    });
  }
  sea.remote = climate.remote = true;
  syncTime(w.time, snap);
}

// 每 0.1 秒把自己的位置和船的狀態送出去（沒變就不送，每秒至少一次）
let sendAcc = 0, lastPosMsg = '', lastPosAt = 0, lastBoatMsg = '', lastBoatAt = 0, lastBoatDetail = '', detailN = 0, lastHold = '', lastLine = '';
// 自己的船的油量、破洞、纜繩（伺服器記著，斷線重連和換船時還回來）：有變才送
function sendBoatDetail() {
  if (myBoat.sinking || myBoat._lost) return;
  net.send({ t: 'b', s: myBoat.netState() });
  const d = { t: 'bd', cracks: myBoat.damage.slice(0, 8).map((c) => [r2(c.lx), r2(c.lz), r2(c.dmg)]), moor: myBoat.moor ? myBoat.moor.i : -1 };
  const dm = JSON.stringify(d);
  if (dm !== lastBoatDetail) { lastBoatDetail = dm; net.send(d); }
}
const r3 = (v) => Math.round(v * 1000) / 1000;
function sendState(dt) {
  if (!inGame || !net.online) return;
  if ((sendAcc += dt) < 0.1) return;
  sendAcc = Math.min(sendAcc - 0.1, 0.1);
  const now = performance.now(), helm = mode === 'helm';
  // 人：[x, y, z, 面向, 狀態, 跳多高, 視線左右, 上下, 站在誰的船上, 船上座標 x, z, 動作, 表情]。站在船上時 y 是離甲板多高
  let st;
  if (mode === 'sink' && wreck) st = [r2(wreck.boat.x), 0, r2(wreck.boat.z), r3(player.yaw), 4, 0, 0, 0, 0, 0, 0, '', ''];
  else {
    const b = helm ? myBoat : player.boat, l = b ? b.toLocal(player.x, player.z) : null;
    const flags = (player.moving ? 1 : 0) | (player.run ? 2 : 0) | (player.swim ? 4 : 0) | (player.carry ? 8 : 0) | (player.rod ? 16 : 0) | (helm ? 32 : 0) | (player.seat ? 64 : 0);
    st = [r2(helm ? myBoat.x : player.x), r2(b ? player.y - b.deckY(player.x, player.z) : player.y), r2(helm ? myBoat.z : player.z), r3(player.yaw), flags, r2(Math.max(player.h, 0)),
      r3(player.lookYaw), r3(player.lookPitch), b ? (b === myBoat ? net.id : b.owner.id) : 0, l ? r2(l.x) : 0, l ? r2(l.z) : 0, player.act ? player.act.id : '', player.mood || ''];
  }
  let msg = JSON.stringify(st);
  if (msg !== lastPosMsg || now - lastPosAt > 1000) { lastPosMsg = msg; lastPosAt = now; net.send({ t: 'p', s: st }); }
  // 手上拿著什麼、釣線另一頭的浮標在哪：給別人看的，有變才送
  const h = fish.held, hk = h ? `${h.id}:${r2(h.len)}` : '';
  if (hk !== lastHold) { lastHold = hk; net.send({ t: 'h', id: h ? h.id : '', len: h ? r2(h.len) : 0 }); }
  const bp = fishing.bob.position, fs = fishing.state;
  const ln = fishing.bob.visible && mode === 'walk' ? [r2(bp.x), r2(bp.y), r2(bp.z), fs === 'fly' ? 1 : fs === 'fight' ? 3 : 2] : null;
  const lk = ln ? ln.join() : '';
  if (lk !== lastLine) { lastLine = lk; net.send({ t: 'fl', s: ln }); }
  // 船：停著沒人開的時候不用送那麼勤
  if (myBoat.sinking || myBoat._lost) return;
  const bs = myBoat.netState(), idle = !myBoat.manned && Math.abs(myBoat.speed) < 0.3;
  msg = JSON.stringify(bs);
  if ((msg !== lastBoatMsg && (!idle || now - lastBoatAt > 400)) || now - lastBoatAt > 1000) { lastBoatMsg = msg; lastBoatAt = now; net.send({ t: 'b', s: bs }); }
  // 破洞和纜繩：兩秒看一次
  if (++detailN >= 20) { detailN = 0; sendBoatDetail(); }
}

// 自己身上、船上、籃子裡所有魚的編號
function myFishUids() {
  const all = [...fish.items, ...fish.basket, fish.held, ...myBoat.boxFish];
  for (const b of garage.values()) all.push(...b.boxFish);
  return all.filter((it) => it && it.uid).map((it) => it.uid);
}

net.on('k', (m) => {
  for (const q of m.p) if (q[0] !== net.id) others.setPos(q[0], q.slice(1));
  for (const q of m.b) if (q[0] !== net.id) others.setBoatState(q[0], q.slice(1));
});
net.on('world', (m) => applyWorld(m));
net.on('join', (m) => others.add({ id: m.id, name: m.name, look: m.look, here: m.here, boat: m.boat }));
net.on('h', (m) => others.setHold(m.id, m.s));
net.on('fl', (m) => others.setLine(m.id, m.s));
net.on('leave', (m) => others.leave(m.id));
net.on('boatGone', (m) => others.boatGone(m.id));
net.on('boat', (m) => { if (m.id !== net.id) others.setBoat(m.id, m.boat); });
net.on('sunk', (m) => { const b = others.boat(m.id); if (b) b.founder(m.why, m.side); });
net.on('chat', (m) => chat.say(m.name, m.text, m.id === net.id));
net.on('sys', (m) => chat.sys(m.text, m.kind));
net.on('boards', (m) => boards.set(m));
net.on('kit', (m) => applyKit(m.kit));
net.on('no', (m) => { buying = false; if (m.msg) toast(m.msg); });

// ---- 釣魚：咬了、是哪條魚、算不算釣起來，都是伺服器說了算 ----
net.on('bite', () => fishing.serverBite());
net.on('fight', (m) => fishing.serverFight(m.fish));
net.on('fishNo', (m) => {
  if (landing) { landing = false; if (m.msg) toast(m.msg); } else fishing.serverNo(m.msg);
});
net.on('caught', (m) => {
  landing = false;
  const f = m.fish;
  if (fish.held) return fish.stowDeck(myBoat, 0, 0, f.id, f.kg, f.len, f.uid, f.value);   // 手上有東西（只有測試指令會這樣）：放到船上
  const it = fish.spawnHeld(f.id, f.kg, f.len, f.uid, f.value);
  toast(`釣到 ${fishLabel(it)}　值 ${cash(it.value)}`);
});

// ---- 買賣、換船 ----
net.on('sold', (m) => {
  fish.sell();   // 籃子裡的都送去賣了：伺服器不認的（不該有）也一起清掉
  applyKit(m.kit);
  refreshBoard();
  if (m.total > 0) { audio.play('coin'); toast(`賣出，得到 ${cash(m.total)}`); }
});
net.on('bought', (m) => {
  buying = false;
  const o = offer(m.id);   // 買之前的說明（要它的名字）
  applyKit(m.kit);
  audio.play('coin');
  if (m.id === 'fuel') fish.spawnCan(CAN);
  toast(m.repair ? (m.cheap ? '釣竿修好了（錢不夠，老闆算你便宜）' : '釣竿修好了')
    : BOAT_TYPES[m.id] ? `買了${o.name}，先收在倉庫。到魚市場前的「停船位置」牌子可以換出來` : `買了${o.name}`);
});
// 換了一艘船放到世界裡：在牌子前換船、或是船沉了之後伺服器補一艘
net.on('swapped', (m) => {
  const w = wreck && wreck.mine ? wreck : null, wasLost = !!myBoat._lost;
  kit = m.kit;
  berth = m.berth;
  useBoat(m.kit.active, m.berth);
  applyKit(m.kit);
  const where = `${myBoat.spec.name}停在 ${berth.label}`;
  if (!m.wreck) { audio.play('rope'); return toast(`換好了：${where}`); }
  if (w) wreck = null;
  const text = m.gift ? `港口留了一艘小舢舨給你，停在 ${berth.label}` : `倉庫裡的${where}`;
  if ((w && w.aboard) || wasLost) rescue(`你被救回港口。${text}`); else toast(text);
});

// ---- 合併房間 ----
net.on('merge', (m) => {
  if (m.text) { chat.sys(m.text, 'merge'); toast(m.text); }
  if (m.phase === 'count' && m.move) mergeAt = performance.now() + m.sec * 1000;
  else if (m.phase === 'cancel') { mergeAt = 0; if (!wreck && !drown) $('fade').style.opacity = 0; }
});
// 被搬到另一間房了：位置、船、錢、魚都照舊，其他人和時間天氣換成那一間的（畫面暗著換，再亮起來）
net.on('merged', (m) => {
  mergeAt = 0;
  room = m.room;
  fishing.cancel(null);
  landing = false;
  others.sync(m.players);
  berth = m.berth;
  if (m.repark) {   // 原本的停船格在那間房有人用了：船跟著移到新的格子
    myBoat.x = m.repark.x; myBoat.z = m.repark.z; myBoat.heading = m.repark.heading; myBoat.speed = 0; myBoat.moor = null;
  }
  applyKit(m.kit);
  boards.set(m.boards);
  applyWorld(m.world, true);
  lastPosMsg = lastBoatMsg = lastBoatDetail = '';
  if (!wreck && !drown) fadeIn = 1.6;
  chat.sys(`已經合併到${room.name}${m.repark ? `，你的船移到 ${berth.label}` : ''}`, 'merge');
});

// ---- 連線狀態 ----
net.on('status', (st) => {
  const box = $('net'), msg = $('netMsg'), btn = $('netRetry');
  if (st === 'online') { box.style.display = 'none'; return; }
  if (!inGame) return;   // 還在大廳：選單自己會處理
  if (st === 'offline') { msg.textContent = '連線中斷，正在接回去…（30 秒內接得回來，進度都還在）'; btn.style.display = 'none'; }
  else {
    msg.textContent = st === 'expired' ? '斷線太久，這一局的進度已經清空了' : st.startsWith('kicked:') ? st.slice(7) : '和伺服器斷線了';
    btn.style.display = 'inline-block';
    inGame = false;
  }
  for (const k in keys) keys[k] = false;
  box.style.display = 'flex';
});
$('netRetry').addEventListener('click', () => window.location.reload());
// 斷線後接回來了（分頁沒關）：這邊的東西都還在，只要把別人和世界對回來，再把斷線時沒送到的事補送
net.on('rejoin', (j) => {
  room = j.room;
  others.sync(j.players);
  berth = j.berth;
  applyKit(j.kit);
  boards.set(j.boards);
  applyWorld(j.world, true);
  const mine = new Set(myFishUids());
  const gone = (j.resume?.fish ?? []).filter((f) => !mine.has(f.uid)).map((f) => f.uid);
  if (gone.length) net.send({ t: 'fishGone', uids: gone });
  if (myBoat._wrecked && !j.resume?.boat?.sunk) net.send({ t: 'sink', why: myBoat.sunkBy, side: myBoat._side });
  lastPosMsg = lastBoatMsg = lastBoatDetail = '';
  lastHold = lastLine = '?';
});

// 進到房間裡（從大廳點進來，或是關掉分頁後 30 秒內回來）
function enterRoom(j) {
  room = j.room;
  fish.clearAll();
  garage.clear();
  garageState.clear();
  for (const [type, v] of Object.entries(j.resume?.stored ?? {})) garageState.set(type, v);
  others.sync(j.players);
  kit = j.kit;
  berth = j.berth;
  // 自己的船：新進房的停在分到的格子；回來的照離開時的位置、油量、破洞
  const rb = j.resume?.boat, lv = kit.boats[kit.active] ?? { engineLv: 0, boxLv: 0 };
  const old = myBoat;
  boats.splice(boats.indexOf(old), 1);
  old.mesh.removeFromParent();
  myBoat = boat = addBoat(kit.active, rb && !rb.sunk ? { x: rb.s[0], z: rb.s[1], heading: rb.s[2] } : berth, lv.boxLv);
  myBoat.engineLv = lv.engineLv;
  if (rb && !rb.sunk) {
    myBoat.fuel = clamp(rb.s[10], 0, myBoat.spec.tank);
    myBoat.lampOn = !!(rb.s[9] & 1);
    for (const c of rb.cracks ?? []) myBoat.restoreCrack(c[0], c[1], c[2]);
    if (rb.moor >= 0 && BOLLARDS[rb.moor]) { const m = moorSpot(rb.moor, [myBoat], MOOR_REACH + 2); if (m) tieBoat(m); }
  }
  camHeading = myBoat.heading;
  wreck = null; mergeAt = 0; mode = 'walk';
  applyKit(kit);
  boards.set(j.boards);
  applyWorld(j.world, true);
  ocean.cacheBlock(myBoat.x, myBoat.z);
  myBoat.update(0.016, calmEnv);
  // 回來的人：魚還給他（魚箱放得下就放魚箱，其餘放甲板），人回到原本的位置
  const back = j.resume, pos = back?.pos;
  if (back && rb && rb.sunk) {
    // 斷線前船就沉了：魚跟著沒了，請伺服器補一艘船（回話在 swapped）
    if (back.fish.length) net.send({ t: 'fishGone', uids: back.fish.map((f) => f.uid) });
    myBoat._lost = true;
    net.send({ t: 'boatLost' });
  } else if (back) {
    const S = myBoat.spec;
    for (const f of back.fish) {
      if (myBoat.boxFish.length < myBoat.boxCap) fish.stowFish(myBoat, f.id, f.kg, f.len, f.uid, f.value);
      else fish.stowDeck(myBoat, S.box.x + (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * S.beam * 0.4, f.id, f.kg, f.len, f.uid, f.value);
    }
  }
  let px = PLAYER_SPAWN.x + (Math.random() - 0.5) * 3, pz = PLAYER_SPAWN.z + (Math.random() - 0.5) * 2, yaw = PLAYER_SPAWN.yaw, deck = null;
  if (pos && !(rb && rb.sunk)) {
    deck = pos[8] ? (pos[8] === j.id ? myBoat : others.boat(pos[8])) : null;
    if (deck && deck.deckContains(pos[9], pos[10])) { px = pos[9]; pz = pos[10]; } else { deck = null; if (!pos[8]) { px = pos[0]; pz = pos[2]; } }   // 在船上的：照甲板上的位置放回去
    yaw = pos[3];
  }
  player.seat = null;
  player.place(walkWorld, px, pz, deck);
  player.yaw = view.walk.yaw = yaw;
  applyViewSettings();
  lastPosMsg = lastBoatMsg = lastBoatDetail = '';
  lastHold = lastLine = '?';
  chat.clear();
  chat.show(true);
  chat.sys(back ? `回到${room.name}了` : touchText(`歡迎來到${room.name}。按 Enter 可以聊天`), 'info');
  $('net').style.display = 'none';
  inGame = true;
  fadeIn = 1.2;
}

let wakeIdx = 0, wakeTimer = 0, sprayAcc = 0, crestSide = 1, crestI = -1, jetShake = 0, lastStep = 0;
function advance(dt) {
  time = inGame && clockBase !== null ? clockBase + performance.now() / 1000 : time + dt;
  updateOcean(dt);

  // 掌舵時鍵盤控制船，走路時控制人
  const helm = mode === 'helm';
  // 踩上另一艘船，它就變成「目前這艘」（可能是別人的）；不在別人的船上了，就回到自己的
  if (mode === 'walk' && player.boat && player.boat !== boat) { boat = player.boat; camHeading = boat.heading; }
  else if (mode === 'walk' && !player.boat && boat.remote) { boat = myBoat; camHeading = boat.heading; }
  const mb = myBoat;   // 自己的船：只有它的物理、損傷在這裡算（別人的船由船主那邊算好傳過來）
  mb.keys.w = helm && (keys.w || touch.my > 0.38); mb.keys.s = helm && (keys.s || touch.my < -0.38);
  mb.keys.a = helm && (keys.a || touch.mx < -0.38); mb.keys.d = helm && (keys.d || touch.mx > 0.38);
  ocean.cacheBlock(boat.x, boat.z);
  mb.update(dt, mb === boat ? boatEnv : calmEnv);
  others.update(dt);
  collideBoats(mb, helm);
  updateMooring(dt, helm);
  const core = !mb.sinking && sea.vortices.length ? sea.coreAt(mb.x, mb.z) : null;
  if (core) mb.founder(core, 1);   // 被拉進漩渦或水龍捲的中心
  // 大漩渦：被拉到七十幾公尺內，水流又急又亂，船板被扯得越來越厲害（越靠近中心越傷）
  if (!mb.sinking && sea.vortices.length) {
    const w = sea.whirlNear(mb.x, mb.z);
    if (w.r < 75) mb.hurt(mb.spec.hp * 0.03 * w.s * ((75 - w.r) / 55) ** 2 * dt);
    if (helm && w.r < 120 && w.s > 0.4 && !whirlToast) { whirlToast = true; toast('被漩渦拉住了！全速往外開！'); }
    if (w.r > 220) whirlToast = false;
  }
  // 巨浪淹進港口：停在岸邊的船被湧進來的水抬起來、退水時摔回去，會撞壞一些
  for (const b of [mb]) {
    if (b.sinking || tsuKAt(b.x, b.z) > 0.45) { b._surgePeak = 0; continue; }
    const h = surgeAt(b.x, b.z);
    b._surgePeak = Math.max(b._surgePeak || 0, h);
    if (h < 0.3 && b._surgePeak > 1.2) {
      b.hurt(b.spec.hp * Math.min(0.1, 0.025 * (b._surgePeak - 1.2)));   // 三道浪加起來大約扣兩成血
      toast(`${b.spec.name}被湧進港口的浪撞壞了一些`);
      b._surgePeak = 0;
    }
  }
  if (!sea.tsu.on) surgeToast = false;
  // 巨浪的浪頭掃過船的那一刻。還沒破的那一段是一道長坡：船頭對準就能翻過去。
  // 正在捲的那一段不一樣：浪壁是往前倒的（爬不上去），浪頂的水拋出去、落在浪頂前方幾十公尺——
  // 船在落點上，就是被好幾層樓高的水從上面直接壓下來，船頭對不對準都一樣。浪越高、船越小越撐不住
  jetShake *= Math.exp(-dt * 2.2);
  if (sea.tsu.on && !mb.sinking) {
    const tK = tsuKAt(mb.x, mb.z), c = sea.jetAt(mb.x, mb.z, tK, shared.uTime.value), side = c.q > c.land ? 1 : -1;
    if (side < 0 && crestSide > 0 && c.i === crestI && c.q > -20) {
      const jet = c.Bw * c.Hc / (5 + mb.spec.len);         // 捲舌砸下來的力道，1 以上船就沒了
      const hit = c.B * Math.min(c.k, 1.1) * tK;            // 翻白的浪頭拍在船上（還沒捲起來也算）
      if (jet >= 1 || hit > 0.15) {
        const aboard = player.boat === mb;
        splash(mb.x, mb.mesh.position.y + 1, mb.z, jet >= 1 ? 90 : 50);
        if (aboard) jetShake = Math.max(jetShake, clamp(0.5 + jet, 0.5, 1.6));
        // 巨浪不會一下子把船打沉：砸得再重，一道浪頭最多扣三成耐久。三道都被正面砸中、或船本來就破破爛爛的，耐久歸零才沉
        mb.hurt(mb.spec.hp * Math.min(0.3, 0.12 * hit + 0.2 * Math.min(jet, 1.5)));
        mb.jolt = Math.max(mb.jolt || 0, 2.5 + jet);   // 甲板上沒收進魚箱的魚會被拋起來
        if (mb.hp <= 0) mb.founder('curl', sea.tsu.dx * -Math.sin(mb.heading) + sea.tsu.dz * Math.cos(mb.heading) > 0 ? 1 : -1);   // 順著浪的方向被掀翻
        else if (aboard) toast(jet > 0.25 ? '捲下來的浪頭砸在船上！' : '浪頭砸在船上！');
      }
    }
    crestSide = side; crestI = c.i;
  } else { crestSide = 1; crestI = -1; }
  updateWreck(dt);
  if (helm && boat.fuel <= 0 && !fuelWarned) toast('沒油了，只能慢慢漂回去');
  fuelWarned = boat.fuel <= 0;

  if (mode === 'walk') {
    const v = view.walk;
    if (player.seat && (keys.w || keys.a || keys.s || keys.d || keys.space || touch.mx || touch.my)) standUp();
    const f = drown ? 0 : (keys.w ? 1 : 0) - (keys.s ? 1 : 0) + touch.my, r = drown ? 0 : (keys.d ? 1 : 0) - (keys.a ? 1 : 0) + touch.mx;
    const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
    // 人在水邊或水裡才需要知道浪高
    swimWave = !player.boat && bedAt(player.x, player.z) < -0.4 ? ocean.sampleHeight(player.x, player.z) : 0;
    player.look(v.yaw, v.pitch);
    player.update(dt, cy * f - sy * r, sy * f + cy * r, keys.shift || touch.run, keys.space && !drown, walkWorld);
    if (v.fp) { player.yaw = v.yaw; player.mesh.rotation.y = -v.yaw; } // 第一人稱時身體跟著視線
    if (player.onWater && !drown) waveRide(dt);
    // 腳步聲：腳每落地一次（走路動作每半圈）播一聲，木板和草地沙地各一組
    const stepN = Math.floor(player.phase / Math.PI);
    if (stepN !== lastStep) {
      lastStep = stepN;
      if (inGame && player.moving && player.h <= 0 && !player.swim && !player.seat) audio.play(player.boat || onDeck(player.x, player.z) || pontoonY(player.x, player.z) !== null ? 'stepWood' : 'stepGrass', keys.shift ? 1 : 0.7);
    }
  }

  updateSwim(dt);

  // 魚與釣魚
  fish.update(dt);
  fishing.reel = keys.f || keys.mouse;
  fishing.update(dt);
  updateFishUi();
  sendState(dt);

  // 船首破浪的飛沫
  const fx = Math.cos(boat.heading), fz = Math.sin(boat.heading);
  const sp = Math.abs(boat.speed);
  if (sp > 2 && !boat.aground) {
    const sc = boat.spec.len / 13;   // 小船濺起的水花也小
    sprayAcc += (sp - 2) * 14 * sc * dt;
    const dir = Math.sign(boat.speed);
    const bow = boat.spec.len * 0.46;
    const bx = boat.x + fx * bow * dir, bz = boat.z + fz * bow * dir, by = boat.mesh.position.y + 0.3;
    while (sprayAcc >= 1) {
      sprayAcc -= 1;
      const side = Math.random() < 0.5 ? -1 : 1, out = (1.2 + Math.random() * 3.0) * sc;
      spray.emit(bx + (Math.random() - 0.5), by, bz + (Math.random() - 0.5),
        fx * boat.speed * 0.35 - fz * side * out, (1.6 + Math.random() * 3.0) * Math.sqrt(sc), fz * boat.speed * 0.35 + fx * side * out,
        0.6 + Math.random() * 0.7, (0.5 + Math.random() * 0.9) * sc);
    }
  }
  swimFx.update(dt, [player, ...[...others.map.values()].map((o) => o.fig)], time, camera.position);
  spray.update(Math.min(dt, 0.1));

  // 航跡：船在動就定時在船尾留下一點泡沫
  wakeTimer += dt;
  if (wakeTimer > 0.3 && sp > 0.8 && !boat.aground) {
    wakeTimer = 0;
    wake[wakeIdx].set(boat.x - fx * boat.spec.len * 0.46, boat.z - fz * boat.spec.len * 0.46, time, clamp(sp / 5, 0, 1) * Math.min(1, boat.spec.len / 13));
    wakeIdx = (wakeIdx + 1) % wake.length;
  }
}

function drawFrame(dt) {
  updateCamera(dt);
  const cp = camera.position;

  // 最近的水龍捲：呼嘯聲的大小與方向；靠得很近時鏡頭被風吹得發抖
  let spoutNear = 0, spoutPan = 0, shake = 0;
  const spots = {};   // 有方位的聲音各自在哪：[x, y, z, 散開的程度]
  for (const m of spouts) {
    if (!m.group.visible) continue;
    const dx = m.group.position.x - cp.x, dz = m.group.position.z - cp.z, d = Math.hypot(dx, dz);
    const k = (0.25 * m.u.uFade.value + 0.75 * m.touch) * clamp(1 - d / 1100, 0, 1) ** 2;
    if (k > spoutNear) {
      spoutNear = k;
      spots.spout = [m.group.position.x, cp.y + 25, m.group.position.z, clamp(1 - d / 160, 0.1, 0.7)];
      camera.getWorldDirection(_rf);
      spoutPan = clamp((dx * -_rf.z + dz * _rf.x) / Math.max(d, 1), -1, 1) * 0.8;
    }
    shake = Math.max(shake, m.touch * clamp(1 - d / 380, 0, 1) ** 1.5);
  }
  // 巨浪：浪牆逼近時轟鳴越來越大，浪頭從身邊過去的那一下最響、鏡頭跟著震
  let crestRoar = 0;
  if (sea.tsu.on) {
    const c = sea.crestNear(cp.x, cp.z), big = Math.min(c.k, 1.1) * Math.sqrt(tsuKAt(cp.x, cp.z));   // 在岸上也聽得到、感覺得到
    crestRoar = big * clamp(1 - Math.abs(c.q) / (c.q > 0 ? 650 : 280), 0, 1) ** 2;
    spots.roar = [cp.x - c.q * sea.tsu.dx, cp.y, cp.z - c.q * sea.tsu.dz, clamp(1 - Math.abs(c.q) / 120, 0.2, 1)];   // 浪牆離這裡最近的那一點
    shake = Math.max(shake, 0.9 * big * clamp(1 - Math.abs(c.q) / 150, 0, 1) ** 1.5);
  }
  // 大漩渦：幾百公尺外就聽得到水在轟隆隆地轉，越靠近越響；被拉到漏斗邊上時鏡頭跟著抖
  let whirlRoar = 0;
  if (sea.vortices.length) {
    const w = sea.whirlNear(cp.x, cp.z);
    whirlRoar = w.s * clamp(1 - w.r / 520, 0, 1) ** 2;
    if (1.3 * whirlRoar > 1.5 * crestRoar) spots.roar = [w.x, 0, w.z, clamp(1 - w.r / 150, 0.2, 0.9)];
    shake = Math.max(shake, 0.7 * w.s * clamp(1 - w.r / 110, 0, 1) ** 1.5);
  }
  const galeHere = gale.v * windK(cp.x, cp.z);
  shake = Math.max(shake, 0.3 * clamp((galeHere - 22) / 24, 0, 1));   // 強風：鏡頭被陣風吹得晃
  shake = Math.max(shake, 0.9 * thunderShake, jetShake);   // 近處落雷的雷聲到了；捲浪砸在船上
  if (shake > 0.003) {
    cp.x += shake * 0.12 * Math.sin(time * 31.7); cp.y += shake * 0.10 * Math.sin(time * 27.3 + 1);
    camera.rotateZ(shake * 0.012 * Math.sin(time * 23.1 + 2));
  }

  // 判斷鏡頭是否在水面下
  const bedHere = bedAt(cp.x, cp.z), tsuHere = tsuAt(cp.x, cp.z);
  let depth = -1;
  if (bedHere < Math.max(0, tsuHere)) {   // 平常只有海上；巨浪淹上岸的時候，岸上也可能在水裡
    depth = tsuHere - cp.y;
    if (Math.abs(depth) < 6) {
      depth += ocean.sampleHeight(cp.x, cp.z) * clamp((-bedHere - 0.3) / 7.7, 0, 1) * waveK(cp.x, cp.z);
    }
  }
  const under = depth > 0;
  shared.uUnder.value = under ? 1 : 0;
  shared.uCamDepth.value = Math.max(depth, 0);
  if (under) {
    const k = (0.35 + 0.8 * Math.max(sunDir.y, 0)) * Math.max(shared.uAmbient.value.y, 0.1) * Math.exp(-shared.uCamDepth.value / 45);
    underFog.color.setRGB(0.012 * k, 0.17 * k, 0.22 * k);
  }
  // 水面上一律掛著空氣的霧（沒起霧時濃度是 0）：切換時不用重新編譯材質，畫面不會頓一下
  const fogWanted = under ? underFog : airFog;
  if (scene.fog !== fogWanted) scene.fog = fogWanted;

  audio.set(shared.uWaveScale.value * stormK(cp.x, cp.z) * (0.35 + 0.65 * shelterAt(cp.x, cp.z)), Math.max(sea.rumble * 0.6, 1.5 * crestRoar, 1.3 * whirlRoar), under,
    boat.fuel > 0 ? Math.abs(boat.throttle) : 0, Math.abs(boat.speed) / 7, rainNow, spoutNear, spoutPan, under ? 0 : clamp((galeHere - 5) / 32, 0, 1.4));

  // 實地錄音的那一層：外海的浪、岸邊的小浪、港口的海鷗、雨、引擎、捲線器、腳步
  {
    const off = offAt(cp.x, cp.z), helm = mode === 'helm';
    // ---- 聲音的方位 ----
    camera.getWorldDirection(_rf);
    _sp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    audio.listen(cp.x, cp.y, cp.z, _rf.x, _rf.y, _rf.z, _sp.x, _sp.y, _sp.z);
    if (!spots.roar || sea.rumble * 0.6 > Math.max(1.5 * crestRoar, 1.3 * whirlRoar)) spots.roar = [cp.x, cp.y, cp.z, 1];   // 說不出從哪來的隆隆聲
    // 引擎：在船尾油箱那一帶
    const tk = boat.parts.tank;
    _sp.set(tk ? tk.x : -2, 0.5, tk ? tk.z : 0).applyMatrix4(boat.mesh.matrixWorld);
    spots.engine = [_sp.x, _sp.y, _sp.z, 0.3];
    // 海鷗：在港口上空盤旋；人就在港口裡的時候是頭頂一大片
    spots.gulls = [-4, 22, 118, clamp(1 - Math.hypot(cp.x + 4, cp.z - 118) / 70, 0, 0.75)];
    // 岸邊的浪：從最近的岸那個方向來（看離岸距離往哪邊變小）；人在岸上、或緊貼著岸，就是四周都有
    const gx = offAt(cp.x + 6, cp.z) - offAt(cp.x - 6, cp.z), gz = offAt(cp.x, cp.z + 6) - offAt(cp.x, cp.z - 6), gl = Math.hypot(gx, gz);
    spots.shore = gl > 1 && off > 2 ? [cp.x - gx / gl * Math.max(off, 5), 0, cp.z - gz / gl * Math.max(off, 5), clamp(1 - (off - 3) / 30, 0.3, 1)] : [cp.x, cp.y, cp.z, 1];
    audio.place(spots);
    // 島上的環境音：鏡頭在陸地上（離岸二十幾公尺內漸漸淡掉）。港口那一帶是人住的地方，鳥叫蟲鳴小聲一點
    const land = clamp(1 - off / 25, 0, 1) * (0.45 + 0.55 * clamp((Math.hypot(cp.x + 4, cp.z - 118) - 30) / 60, 0, 1));
    audio.ambient({
      birds: land * clamp(1 - night * 1.8, 0, 1) * clamp(1 - rainNow * 3, 0, 1),
      night: land * clamp((night - 0.45) / 0.35, 0, 1) * clamp(1 - rainNow * 2, 0, 1),
      trees: land * clamp(0.25 + 0.35 * WIND.amp.value, 0, 1),
      under,
      sea: clamp(0.2 + 0.17 * shared.uWaveScale.value * stormK(cp.x, cp.z), 0, 1) * clamp((off - 15) / 90, 0, 1),   // 平常的外海約五成，暴風雨裡八成
      shore: clamp(1 - off / 70, 0, 1) * clamp(0.4 + 0.6 * shelterAt(cp.x, cp.z), 0, 1),
      gulls: clamp(1 - Math.hypot(cp.x + 4, cp.z - 118) / 260, 0, 1) * clamp(1 - night * 1.6, 0, 1) * clamp(1 - rainNow * 3, 0, 1),
      rain: rainNow,
      engine: helm && boat.fuel > 0 && !boat.sinking ? 1 : 0,
      throttle: Math.max(Math.abs(boat.throttle), Math.abs(boat.speed) / boat.maxSpeed),
      pitch: boat.spec.id === 'skiff' ? 1.25 : boat.spec.id === 'fisher' ? 1 : 0.82,
      reel: fishing.state === 'fight' && fishing.reel ? 1 : 0,
    });
  }

  shared.uTime.value = time;
  // 樹搖的幅度跟著風：平常微微晃，暴風圈裡晃得厲害
  WIND.amp.value = clamp(0.38 * wind + 1.5 * clamp(sea.storm, 0, 1) * (stormK(cp.x, cp.z) - 1), 0.15, 2.6);
  WIND.t.value += dt * (0.75 + 0.45 * WIND.amp.value);
  shared.uCenter.value.set(target.x, target.z);
  scenery.update(cp);   // 近的島畫精細的樹和石頭，遠的畫簡化版，霧裡的不畫
  // 草皮的中心放在鏡頭前方十幾公尺：畫面裡看得到的近處都有草
  camera.getWorldDirection(_gd);
  _gd.y = 0;
  grass.material.uniforms.uGrassCam.value.copy(cp).addScaledVector(_gd.normalize(), 13);
  grass.visible = true;
  updateBoatShadow();
  // 偶數幀重畫倒影，奇數幀重畫陰影
  const even = (drawCount++ & 1) === 0;
  // 地面是濕的、鏡頭在港口附近時，還要畫積水的倒影：跟海面倒影輪流，各自每四幀更新一次
  const deckWet = gfx.wet && !under && WET.wet.value > 0.04 && cp.y > DECK_Y + 0.3 && Math.hypot(cp.x + 4, cp.z - 128) < 120;
  const deckTurn = deckWet && even && (drawCount & 2) !== 0;
  renderReflection(under, even && !deckTurn);
  if (deckTurn || (deckWet && !deckReady)) { renderDeckReflection(); deckReady = true; }
  if (!deckWet) deckReady = false;
  WET.reflOn.value = deckWet ? 1 : 0;
  if (!even || !sun.shadow.map) placeSun(target);
  if (sun.shadow.map) { shared.uShadowMap.value = sun.shadow.map.depthTexture; shared.uShadowOn.value = 1; }
  // 太陽（月亮）在畫面上的位置；背對著它、或人在水裡時沒有光束
  _rv.copy(camera.position).addScaledVector(sunDir, 1000).project(camera);
  rays.sun.set(_rv.x * 0.5 + 0.5, _rv.y * 0.5 + 0.5);
  rays.color.setRGB(shared.uSunCol.value.x, shared.uSunCol.value.y, shared.uSunCol.value.z);
  rays.strength = under ? 0 : RAYS * clamp((camera.getWorldDirection(_rf).dot(sunDir) - 0.15) / 0.35, 0, 1) * (1 - 0.8 * gloom);
  // 腳下的暗影
  const onFloor = !!player.boat || onDeck(player.x, player.z) || pontoonY(player.x, player.z) !== null, lift = clamp(1 - (player.h || 0) / 1.2, 0, 1);
  blob.visible = onFloor && !player.swim;
  shared.uBlob.value.set(player.x, player.z, onFloor || player.swim ? 0 : lift);
  aoPass.enabled = !under && gfx.ao;   // 水裡一片混濁，不需要；畫質「低」也省掉
  waterFlag.visible = aoPass.enabled;    // 海面的記號只有角落暗影要用：沒開就不必再把整片海面的網格畫一次
  rays.enabled = bloom.enabled = gfx.post;   // 畫質「手機」沒有光暈和陽光光束
  // 擋在鏡頭和人之間的枝葉散開（只有走路時）。第三人稱：從鏡頭到人身上這條線周圍；第一人稱：只有貼著鏡頭的那一圈
  if (mode === 'walk' && inGame && !debugCam) {
    camera.updateMatrixWorld();
    if (view.walk.fp) { SIGHT.p.value.set(0, 0, 0); SIGHT.r.value.set(0.5, 1.1); }
    else {
      SIGHT.p.value.set(player.pos.x, player.pos.y + 1.1, player.pos.z).applyMatrix4(_sightM.copy(camera.matrixWorld).invert());
      SIGHT.r.value.set(1.3, 2.7);
    }
  } else SIGHT.r.value.set(0, 0);
  composer.render();
}

applyViewSettings();
ocean.cacheBlock(boat.x, boat.z);
boat.update(0.016, boatEnv);
player.place(walkWorld, PLAYER_SPAWN.x, PLAYER_SPAWN.z);

let frame = 0, last = performance.now();
const fpsEl = new URLSearchParams(window.location.search).has('fps') ? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'fps' })) : null;
let fpsN = 0, fpsT = performance.now(), gpuName = '';
if (fpsEl) {
  const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  gpuName = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).replace(/ANGLE \(|\)$/g, '').slice(0, 60);
}
// 手機第一次進遊戲（還沒自己調過畫質）：進房三秒後量五秒的幀率，平均低於每秒 25 幀就換成「手機」這一檔，量完就記住，之後不再量
let probe = TOUCH && !gfxSaved ? { t0: 0, n: 0, sum: 0 } : null;
function probeGfx(ms, rawMs) {
  if (!inGame || document.hidden) { if (probe.t0) probe.t0 = ms; return; }
  if (!probe.t0) { probe.t0 = ms; return; }
  if (ms - probe.t0 < 3000 || rawMs > 250) return;
  probe.n++; probe.sum += rawMs;
  if (ms - probe.t0 < 8000) return;
  const avg = probe.sum / probe.n;
  if (avg > 40 && gfxLv > 0) { setGfx(0); toast('畫面有點卡，畫質自動換成「手機」（可在設定裡改回來）'); }
  setPref('stormcast.gfx2', gfxLv); gfxSaved = true;
  probe = null;
}
renderer.setAnimationLoop((ms) => {
  const rawMs = ms - last;
  const dt = Math.min(rawMs / 1000, 0.05);
  last = ms;
  if (probe) probeGfx(ms, rawMs);
  if (dt > 0) advance(dt);
  drawFrame(dt);
  if (frame++ % 6 === 0) { updatePrompt(); if (mapOpen) drawMap(); }
  if (fpsEl && ++fpsN && ms - fpsT >= 1000) {
    fpsEl.textContent = `${Math.round(fpsN * 1000 / (ms - fpsT))} fps　${pixelRatio.toFixed(1)}×　${canvas.width}×${canvas.height}　畫質${gfx.name}　${TOUCH ? '手機' : '電腦'}　${gpuName}`;
    fpsN = 0; fpsT = ms;
  }
});

// 供除錯與測試使用
window.__sim = {
  advance, drawFrame, get boat() { return boat; }, boats, addBoat, offer, refreshTags, nearBox, nearShelf, SHELF,
  get rodLv() { return rodLv; }, get rodBroken() { return rodBroken; },
  aimTarget, wheel, closeWheel, sitDown, standUp, offAt, audio, player, ocean, keys, view, bedAt, walkGround, walkWorld, shelterAt, nearHelm, interact, toggleFp,
  fish, fishing, isWater, SELL, get money() { return money; },
  // 多人
  net, others, chat, boards, garage, enterRoom, applyWorld, myFishUids, takeHelm, releaseHelm, touch, setGfx, setPixelRatio,
  get gfxLv() { return gfxLv; }, get pixelRatio() { return pixelRatio; }, GFX, get gfx() { return gfx; },
  get kit() { return kit; }, get myBoat() { return myBoat; }, get berth() { return berth; }, get room() { return room; }, get inGame() { return inGame; }, get time() { return time; },
  dev: (cmd, o = {}) => net.send({ t: 'dev', cmd, ...o }),   // 測試指令（伺服器開了開發模式才收）：event / calm / skip / money / fish
  sea, dangerAt, tsuAt, stormK, waterY, nearTank, nearCrack, get wrench() { return wrench; },
  get wreck() { return wreck; }, climate, lightning, updateWeather, boatEnv, rain, bolt, spouts,
  get rainNow() { return rainNow; }, get gloom() { return gloom; }, lampLights, boatLight,
  updatePrompt, N, DX, L, ISLANDS, camera, scene, water, terrain, scenery, harbor, shared, spray, renderer,
  get mode() { return mode; }, NF, sun, placeSun, WIND, rays, bloom, aoPass, camBlockers, SIGHT, grass, SOLIDS, rockAt, composer, shallow, shallowNear, target, playerWater, updateSwim, toggleMap, drawMap,
  get stamina() { return stamina; }, set stamina(v) { stamina = v; }, get drown() { return drown; }, get mapOpen() { return mapOpen; },
  set cam(v) { debugCam = v; }, tsuKAt, BOLLARDS, nearBollard, surgeAt, hullBlocked, boatGround,
  // 量測實際每幀成本（毫秒）：連續算 n 幀並強制 GPU 完成
  bench(n = 20) {
    const gl = renderer.getContext(), px = new Uint8Array(4);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      advance(1 / 60);
      drawFrame(1 / 60);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    return (performance.now() - t0) / n;
  },
};

// 先填名字、挑房間；進房之後才能動
// 選單裡換角色：港口裡自己的人偶、自己船上的舵手跟著換
runMenu(net, (look) => { restyle(player.mesh, look); restyle(myBoat.parts.helmsman, look); }).then(enterRoom);
