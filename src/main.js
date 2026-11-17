import * as THREE from 'three';
import { makeTerrain, computeShelter, computeShoreDist, ISLANDS } from './terrain.js';
import { hullCutGlsl, waterVert, waterFrag, liteWaterVert, liteWaterFrag, terrainVert, terrainFrag, grassVert, grassFrag, skyVert, skyFrag, diagVert, diagFrag, diagPtFrag, HAZE, RAIN_HAZE } from './renderShaders.js';
import { FftOcean, makeFoamTexture } from './ocean.js';
import { Boat, BOAT_TYPES, hullCutDims } from './boat.js';
import { BOAT_ORDER, CAN, CHUM_SPEC, BOAT_MODS, BOAT_PAINTS, BLESSINGS, HONOR_TITLES, PRICE, newKit, shopItem, baitCount, repairCost } from './boatdata.js';
import { Player } from './player.js';
import { ShallowWater, SWE } from './shallow.js';
import { makeSwimFx } from './swimfx.js';
import { makeSurfaceProbe } from './swimProbe.js';
import { makeHarbor, worldizeHarborLists, PILES, SOLIDS, WALLS, DECKS, HARBOR_ROCKS, EXTRA_LAMPS, POOLS, GLOW, DECK_Y, SELL, setBoard, BOLLARDS, MoorLine, SHELF, setTag, drawTag, LAMPS, UNLIT, WET, ROOM_LIGHTS, ROOM_LAMPS, setRoomLights, GLOW_KEEP, lightBulbs, updateFlags, updateScale, PORCHES, HOME_LAND } from './harbor.js';
import { WORLD, THROW, DEVMODE, SHORE_WIND, CLOUDS, FISHBOX, TABLET, GUILD, LEVEL, PARTY, TOW, BOATHIT, FEEDBACK, SERVER, levelOf, LOD } from './config.js';
import { Tablet } from './tablet.js';
import { makeApps } from './tabletApps.js';
import { unreadCount } from './updates.js';
import { makeTabletMesh, holdTablet, poseTablet, setTabletScreen, TABLET_SIZE, SCREENS } from './tabletMesh.js';
import { createRemoteTabletRenderer, renderOwnTablet } from './tabletLive.js';
import { fishThumbs } from './fishThumbs.js';
import { placeAt } from './places.js';
import { bearing, dirName, whereFrom, beaufort, windWord, clockOf, skyOf, tideText, tideShort, forecast, signsOf } from './tabletData.js';
import { CompassBar } from './compass.js';
import { ICON } from './icons.js';
import { BoxWorld } from './fishBox.js';
import { ask, asking, cancelAsk } from './ask.js';
import { openFeedback, feedbackOpen, feedbackDone } from './feedback.js';
import { HOME_U, placeInHome } from './homeGl.js';
import { HOME_YAW, toWorld, toLocal, headingToWorld, havenToLocal, HAVEN, seaYardToLocal } from './frame.js';
import { makeSeascape, HAVEN_LAND, HAVEN_GROUND } from './haven.js';
import { caveUnder, caveCeil, caveFloor, caveRock, havenLow, nearCave, caveGate, CAVE_AXIS, skyEdge, havenDeck, riverAt, portWall, portFoundation, portPier } from './lowpoly/havenShape.js';
import { CAVE, RIVER, PORT } from './lowpoly/havenPlan.js';
import { HAVEN_SELL_W, ALL_SHELF_W, SITE_SHELF_W, SITES, siteAt } from './layout.js';
import { yardGround, yardPier } from './lowpoly/seaYardShape.js';
import { riverLevel } from './fishzone.js';
import { makeHavenFx } from './havenFx.js';
import { makeWildlife } from './wildlife.js';
import { HOME_GROUND, ZONE_LABEL } from './lowpoly/harborPlan.js';
import { BERTHS, berthPose, deckY, ladderY, onDeck, inWall, inHarbor, SWITCHES_W, ROOFS_W, underRoof, SELL_W, LIGHTHOUSE_W, SHELF_W, SPAWN_W, QUAY_EDGE_Z, QUAY_CENTER_W, HARBOR_CENTER_W } from './layout.js';
import { fishLabel, FishWorld, makeCanMesh, makeChumMesh } from './fish.js';
import { money as cash, rarityOf, BAITS, SPECIES, castRange } from './fishdata.js';
import { Fishing } from './fishing.js';
import { EmoteWheel } from './emotes.js';
import { TOUCH, TouchUI, touchText, touchSet, canFullscreen, isFullscreen, setFullscreen } from './touch.js';
import { FramePacer, MOBILE_FRAME_LIMITS, DESKTOP_FRAME_LIMITS, RefreshRateProbe, fpsLabel } from './framePacer.js';
import { MAX_QUALITY_REDUCTION, QualityTiming, reducedQuality } from './adaptiveQuality.js';
import { REFL, addOutline, BULBS, softDisc } from './toon.js';   // 它會改掉內建材質的受光算法（改成手繪風）
import { makeScenery, SHADOW_LAYER } from './scenery.js';
import { makeGroundDetail, makeGrassGeometry, WIND, SIGHT } from './foliage.js';
import { Spray } from './spray.js';
import { makeRainSplash } from './rainSplash.js';
import { OceanAudio } from './audio.js';
import { Sea, Climate, computeDanger, computeOffshore, computeTsuK, TSU, SWELL, swellAt, WAVE_LOOP, windWave, seaLevel, seaOpen, shoreSea, openOf, windSpeed, tideAt, tsuHK, TSU_H } from './weather.js';
import { Rain, Bolt, Spindrift, Spout, WaveSpray } from './skyfx.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FishBatch } from './fishBatch.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SunRaysPass } from './glow.js';
import { lpUniforms } from './lowpoly/kit.js';
import { detailUniform } from './lowpoly/surfaceDetail.js';
import { ShadePass } from './ao.js';
import { AimOutlinePass } from './aimOutline.js';
import { Net, TEST } from './net.js';
import { bakeClouds, cloudCores } from './clouds.js';
import { Others } from './others.js';
import { Chat } from './chat.js';
import { Boards } from './boards.js';
import { runMenu } from './menu.js';
import { restyle } from './figure.js';
import { myLook, setMyLook } from './look.js';

// ---- 世界參數 -------------------------------------------------------------
const N = 512;          // 避浪、危險度這些粗略資料的解析度（4 m 一格）
const NF = 1024;        // 地形高度的解析度（2 m 一格）：海岸線才圓順
const L = WORLD.size;   // 地圖邊長（公尺，見 config.js）
const DX = L / NF;      // 2 m
// 風浪朝「港口面向的反方向」推進：港座標裡是由北往南（母港在島的背風面），轉到世界就是由西北往東南
const WAVE_ANGLE = Math.PI / 2 + WORLD.waveFromHarborBackDeg * Math.PI / 180 - HOME_YAW;
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
const renderer = new THREE.WebGLRenderer({ antialias: false });   // 抗鋸齒由後製的 SMAA 負責；「高」畫質另外在場景緩衝區開多重取樣（MSAA）
// 顯示晶片把畫面收走（WebGL 失效：驅動重開、顯示記憶體不夠……）時整個 3D 畫面會變成一片底色、救不回來：
// 告訴玩家、重新載入（寬限內會接回原本的房間）
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  console.warn('[gl] 畫面失效（webglcontextlost），重新載入');
  const n = document.createElement('div');
  n.textContent = '畫面出錯了，正在重新載入…（按「進入大廳」就會回到原本的房間，家當都在）';
  n.style.cssText = 'position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:99;padding:12px 22px;border-radius:16px;background:var(--paper);color:var(--ink);font:16px var(--font);box-shadow:0 4px 14px rgba(0,0,0,.3)';
  document.body.appendChild(n);
  window.setTimeout(() => window.location.reload(), 1500);
});
// 畫質設定記在瀏覽器裡（?test 分頁只記在那個分頁）。開啟動態畫質（手機、電腦都有）後，畫面不穩時會暫時減少特效。
//   解析度：沒調過的話，電腦跟著螢幕的縮放比例走（筆電常見 1.25、1.5 倍，畫面才不會被放大而糊掉）；
//           手機預設 1.5 倍，可手動選 1.0 到 2.0 倍。
//   畫質等級：低／中／高，管陰影的細緻度、草的數量、角落的暗影（AO）、濕地板的倒影、光暈和陽光光束。
//           電腦預設高、手機預設中。沒調過畫質的電腦第一次進房會量幀率，太慢就降一檔。
//           手機的畫面幀率獨立設定，預設上限 60 FPS；低畫質減少的是陰影與特效。
const prefStore = (() => { try { return TEST ? window.sessionStorage : window.localStorage; } catch { return null; } })();
const getPref = (k) => { try { return prefStore ? prefStore.getItem(k) : null; } catch { return null; } };
const setPref = (k, v) => { try { if (prefStore) prefStore.setItem(k, String(v)); } catch { /* 存不了就下次重調 */ } };
const mobileShadowClock = new FramePacer();
const simClock = new FramePacer(), drawClock = new FramePacer(), hudClock = new FramePacer();
const mobileRefresh = TOUCH ? new RefreshRateProbe() : null;
const qualityTiming = new QualityTiming();
const savedAdaptive = getPref('stormcast.adaptiveGfx');
let adaptiveEnabled = savedAdaptive === 'on', adaptiveAsked = savedAdaptive === 'on' || savedAdaptive === 'off';
let adaptivePrompt = false;
let qualityReduction = 0;
let homeTip = false;   // 這次進房要不要教「加入主畫面」（見 showHomeTip）
const desktopRatio = () => Math.round(clamp(window.devicePixelRatio || 1, 1, 1.5) * 10) / 10;
const RATIO_MIN = TOUCH ? 1 : 0.5;
const RATIO_MAX = TOUCH ? 2 : Math.round(clamp(window.devicePixelRatio || 1, 1.5, 2) * 10) / 10;
let baseRatio = TOUCH ? 1.5 : desktopRatio();
const savedRatio = Number(getPref('stormcast.res'));
let ratioSaved = Number.isFinite(savedRatio) && savedRatio >= 0.5;
let pixelRatio = ratioSaved ? clamp(savedRatio, RATIO_MIN, RATIO_MAX) : baseRatio;
// 畫質的每一項都能在設定的「畫質」頁單獨調；三個快速選項（低／中／高）是一整組的預設值，手機和電腦各一套（手機另外固定少畫一些東西，見 TOUCH）。
// 調過任何一項就變成「自訂」。整組記在瀏覽器（stormcast.gfx4）
//   shadow 陰影：0 關、1 低（1024、取樣點減半）、2 中（2048）、3 高（3072）、4 最高（4096）
//   shNear 近處陰影（電腦）：0 沒有、1 2048 格蓋 12 公尺、2 4096 格蓋 16 公尺——人物、柱子腳邊的影子靠它
//   shRange 陰影範圍：0 近（40 公尺）、1 中（54）、2 遠（72）——同一張貼圖蓋越大，影子越粗
//   view 可視距離：0 近（霧濃、520 公尺外的島不畫樹石）、1 中、2 遠
//   fov 第三人稱的鏡頭視角（度；第一人稱再寬 18 度）
//   grass 草叢：0 無、1 少（三分之一）、2 多（全部）
const SHADOW_SIZES = [0, 1024, 2048, 3072, 4096], SHADOW_HALVES = [40, 54, 72], GRASS_N = [0, 3000, 14000];
const VIEW_HAZE = [1.9, 1.35, 1], VIEW_FAR = [520, 680, 820];
const PRESETS = TOUCH ? [
  // 手機：不降解析度、不准有鋸齒，從陰影、特效、可視距離、草省
  { name: '低', shadow: 1, shNear: 0, shRange: 0, ao: false, view: 0, fov: 50, bloom: false, rays: false, refl: true, wet: false, grass: 0, msaa: false, tex: false },
  { name: '中', shadow: 2, shNear: 0, shRange: 1, ao: false, view: 1, fov: 50, bloom: true, rays: true, refl: true, wet: false, grass: 1, msaa: false, tex: false },
  { name: '高', shadow: 2, shNear: 0, shRange: 1, ao: true, view: 2, fov: 50, bloom: true, rays: true, refl: true, wet: false, grass: 2, msaa: false, tex: false },
] : [
  // 電腦：高是最高規格（不管效能；太卡的電腦第一次進遊戲會自動降到中，見 probeGfx）
  { name: '低', shadow: 2, shNear: 0, shRange: 1, ao: false, view: 2, fov: 50, bloom: true, rays: true, refl: true, wet: false, grass: 1, msaa: false, tex: false },
  { name: '中', shadow: 2, shNear: 1, shRange: 1, ao: true, view: 2, fov: 50, bloom: true, rays: true, refl: true, wet: false, grass: 2, msaa: false, tex: true },
  { name: '高', shadow: 4, shNear: 2, shRange: 2, ao: true, view: 2, fov: 50, bloom: true, rays: true, refl: true, wet: true, grass: 2, msaa: true, tex: true },
];
const GS_KEYS = Object.keys(PRESETS[0]).filter((k) => k !== 'name');
const DEF_LV = TOUCH ? 1 : 2;   // 預設：手機中、電腦高
// 舊的設定（以前是手機／低／中／高四檔、手機電腦同一套）：照當時是哪一檔換到新的那一檔；自訂的保留，補上新的欄位
const OLD_PRESETS = [
  { shadow: 1, shRange: 0, ao: false, view: 0, bloom: false, rays: false, wet: false, grass: 1 },
  { shadow: 2, shRange: 1, ao: false, view: 2, bloom: true, rays: true, wet: false, grass: 2 },
  { shadow: 2, shRange: 1, ao: true, view: 2, bloom: true, rays: true, wet: false, grass: 2 },
  { shadow: 3, shRange: 1, ao: true, view: 2, bloom: true, rays: true, wet: true, grass: 3 },
];
const OLD_TO_NEW = TOUCH ? [0, 1, 2, 2] : [0, 0, 1, 2];
const gs = (() => {
  try {
    const o = JSON.parse(getPref('stormcast.gfx4') || 'null');
    if (o && GS_KEYS.every((k) => k in o)) return o;
  } catch { /* 壞掉就用預設 */ }
  try {
    const o = JSON.parse(getPref('stormcast.gfx3') || 'null');
    if (o && typeof o === 'object') {
      const was = OLD_PRESETS.findIndex((p) => Object.keys(p).every((k) => p[k] === o[k]));
      if (was >= 0) return { ...PRESETS[OLD_TO_NEW[was]] };
      const g = { ...PRESETS[DEF_LV] };
      for (const k of GS_KEYS) if (k in o) g[k] = o[k];
      g.grass = [0, 1, 1, 2][o.grass] ?? g.grass;   // 草從四檔變三檔
      g.shNear = !TOUCH && o.shadow >= 2 ? 1 : 0;   // 以前電腦陰影中以上就有近處那張
      return g;
    }
  } catch { /* 壞掉就用預設 */ }
  const oldGfx = getPref('stormcast.gfx'), newGfx = getPref('stormcast.gfx2');
  const lv = /^[0-3]$/.test(newGfx || '') ? OLD_TO_NEW[+newGfx] : /^[012]$/.test(oldGfx || '') ? OLD_TO_NEW[+oldGfx + 1] : DEF_LV;
  return { ...PRESETS[lv] };
})();
delete gs.name;
if (TOUCH) { gs.shadow = Math.min(gs.shadow, 2); gs.shNear = 0; gs.tex = false; }   // 手機沒有的檔位（同一個瀏覽器存過電腦的設定時）收回來
let gfxSaved = !!(getPref('stormcast.gfx4') || getPref('stormcast.gfx3') || getPref('stormcast.gfx2') || getPref('stormcast.gfx'));
// 現在這組設定是哪個快速選項（都不像就是 -1：自訂）
const presetOf = () => PRESETS.findIndex((p) => GS_KEYS.every((k) => p[k] === gs[k]));
// 其他地方用的是換算好的數值
const deriveGfx = () => {
  const q = reducedQuality(gs, qualityReduction), preset = PRESETS[presetOf()];
  const name = preset?.name ?? '自訂';
  return {
    name: qualityReduction ? `${name}（動態）` : name,
    shadowOn: q.shadow > 0, shadow: SHADOW_SIZES[q.shadow] || 1024, shadowHalf: SHADOW_HALVES[q.shRange], lite: q.shadow === 1,
    grass: GRASS_N[q.grass], grassLevel: q.grass, ao: q.ao, wet: q.wet, bloom: q.bloom, rays: q.rays, refl: q.refl, msaa: q.msaa,
    haze: VIEW_HAZE[q.view], far: VIEW_FAR[q.view], fov: q.fov,
  };
};
let gfx = deriveGfx();
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);
const canvas = renderer.domElement;

// 要能畫進浮點貼圖：32 位元的最好；不少手機只支援 16 位元的，海浪模擬會退回 16 位元（見 ocean.js），一樣能玩。
// 測試用：在電腦上假裝不支援某些擴充功能。?halffloat：沒有 32 位元浮點緩衝（也不能平滑取樣）；
// ?nofloatlinear：只是不能平滑取樣 32 位元浮點貼圖（三星 Mali 這類手機）
{
  const q = new URLSearchParams(window.location.search);
  const off = new Set([...(q.has('halffloat') ? ['EXT_color_buffer_float', 'OES_texture_float_linear'] : []), ...(q.has('nofloatlinear') ? ['OES_texture_float_linear'] : [])]);
  if (off.size) {
    const ex = renderer.extensions, get = ex.get.bind(ex), has = ex.has.bind(ex);
    ex.get = (n) => (off.has(n) ? null : get(n));
    ex.has = (n) => (off.has(n) ? false : has(n));
  }
}
if (!renderer.capabilities.isWebGL2 || !(renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'))) {
  fail('這個瀏覽器或顯示卡不支援浮點數渲染目標（WebGL2 + EXT_color_buffer_float／half_float），無法執行。');
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 90000);

// ---- 地圖 -----------------------------------------------------------------
const { bed: bedData, main: bedMain } = makeTerrain(NF, L);
// 粗一半的版本（每 2×2 格取平均），給避浪、危險度、種樹用。
// bedCoarse 含海上的礁石（避浪用：礁石後面也有一小片靜水）；mainCoarse 只有兩座大島（離岸多遠、危險度、巨浪剩幾成：礁石不算陸地）
const bedCoarse = new Float32Array(N * N), mainCoarse = new Float32Array(N * N);
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const k = 2 * j * NF + 2 * i;
    bedCoarse[j * N + i] = (bedData[k] + bedData[k + 1] + bedData[k + NF] + bedData[k + NF + 1]) / 4;
    mainCoarse[j * N + i] = (bedMain[k] + bedMain[k + 1] + bedMain[k + NF] + bedMain[k + NF + 1]) / 4;
  }
}
const shelterData = computeShelter(bedCoarse, N, L, WAVE_ANGLE);

const bedTex = new THREE.DataTexture(bedData, NF, NF, THREE.RedFormat, THREE.FloatType);
bedTex.minFilter = bedTex.magFilter = THREE.NearestFilter;
bedTex.needsUpdate = true;
const shelterTex = new THREE.DataTexture(shelterData, N, N, THREE.RedFormat, THREE.UnsignedByteType);
shelterTex.minFilter = shelterTex.magFilter = THREE.LinearFilter;
shelterTex.needsUpdate = true;
// 風向變了，背風面跟著換邊：在背景執行緒重算避浪圖（要算一兩百毫秒，不能卡住畫面），算好了整張換掉
let shelterTurn = 0, shelterBusy = false, shelterWorker = null;
try {
  shelterWorker = new Worker(new URL('./shelterWorker.js', import.meta.url), { type: 'module' });
  shelterWorker.postMessage({ bed: bedCoarse, N, L });
  shelterWorker.onmessage = (ev) => { shelterData.set(ev.data.out); shelterTex.needsUpdate = true; shelterTurn = ev.data.turn; shelterBusy = false; };
  shelterWorker.onerror = () => { shelterWorker = null; };
} catch (err) { shelterWorker = null; }
function turnShelter(turn) {
  if (!shelterWorker || shelterBusy || Math.abs(turn - shelterTurn) < 0.05) return;
  shelterBusy = true;
  shelterWorker.postMessage({ angle: WAVE_ANGLE + turn, turn });
}

// 離陸地越遠越危險：風暴與巨浪只在外海發威，島的周圍與港口不受影響
const dangerData = computeDanger(mainCoarse, N, L);
const offData = computeOffshore(mainCoarse, N, L);   // 每一格離最近的陸地幾公尺
const dangerTex = new THREE.DataTexture(dangerData, N, N, THREE.RedFormat, THREE.UnsignedByteType);
dangerTex.minFilter = dangerTex.magFilter = THREE.LinearFilter;
dangerTex.needsUpdate = true;

// 巨浪到了每個地方還剩幾成高：外海十成，岸邊剩一成多，沖上岸之後往內陸遞減
const tsuKData = computeTsuK(mainCoarse, dangerData, N, L);
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

// 商店與櫃檯、燈塔：玩家走不進去（矩形是港座標）
const BLOCKS = [
  { x0: SELL.basket.x - 0.55, x1: SELL.basket.x + 0.55, z0: SELL.basket.z - 0.5, z1: SELL.basket.z + 0.5 },   // 磅秤和上面的籃子
  { x0: SELL.button.x - 0.22, x1: SELL.button.x + 0.22, z0: SELL.button.z - 0.22, z1: SELL.button.z + 0.22 },   // 按鈕柱
  ...WALLS,   // 商店的牆、看板、魚市場的桌子和矮牆、貨架、坡上的小屋（見 layout.js）
];
// 大石頭：用格子分區，查詢某個位置的石頭表面有多高（沒有石頭就是 null）。
// 母島的石頭照模型的形狀（高度圖）：低低的邊緣踩得上去，高的地方擋住（見 walkGround）
const ROCK_CELL = 8, ROCK_STAND = 0.5, rockGrid = new Map();
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
  for (const r of cell) {
    const dx = x - r.x, dz = z - r.z;
    if (dx * dx + dz * dz >= r.r * r.r) continue;
    let h;
    if (r.hgt) {   // 母島的石頭：照模型算好的高度圖（見 harbor3d.js 的 rockShape）
      const u = dx * r.c - dz * r.s + r.hx, v = dx * r.s + dz * r.c + r.hz;   // 轉回港座標、從高度圖的角落算起
      const i = Math.floor(u / r.cell), j = Math.floor(v / r.cell);
      if (i < 0 || j < 0 || i >= r.nx || j >= r.nz) continue;
      h = r.hgt[j * r.nx + i];
      if (h < -50) continue;   // 這格沒有石頭
    } else if (r.a !== undefined) {   // 平頂的橢圓（燈塔的石墩）
      const u = (dx * r.c - dz * r.s) / r.a, v = (dx * r.s + dz * r.c) / r.d;
      if (u * u + v * v >= 1) continue;
      h = r.top;
    } else h = r.top;   // 其他島佈景的石頭、樹幹：平頂的圓（樹幹的頂是 99，等於整根擋住）
    if (top === null || h > top) top = h;
  }
  return top;
}

const PIER_PLANK_PAD = 0.12;   // 木棧板（尤指指棧）左右凸出的木條寬度（harbor3d 的 skirt + off），讓腳踩範圍跟畫出的木板對齊

// 玩家腳下的高度：棧板、地面，或擋路的牆（回傳很高的值）
function walkGround(x, z, under = false) {
  const [hx, hz] = toLocal(x, z);   // 商店、牆這些矩形是用港座標寫的
  // 開發者模式飛得夠高（腳比底下的地面高 DEVMODE.wallTop）：房子、牆、燈塔、燈柱這些沒記高度的東西從上面飛過去
  const over = walker.fly && walker.feet !== null && walker.feet > Math.max(landAt(x, z, hx, hz), 0) + DEVMODE.wallTop;
  if (!under && !over) for (const r of BLOCKS) if (inWall(r, hx, hz)) return 99;
  if (!over && Math.hypot(x - LIGHTHOUSE_W.x, z - LIGHTHOUSE_W.z) < LIGHTHOUSE_W.r) return 99;
  // 棧板上的樁、燈柱、木桶…（在棧板底下游泳時不算）。有 top 的（木箱、木桶、魚箱）跳得上去：跟石頭一樣看玩家的腳（walker）——
  // 腳已經在箱頂的高度、或跳起來離箱頂不到 0.35 公尺就站得上去；矮的（不到半公尺）直接踏上去
  if (!under) {
    let top = null;
    for (const c of SOLIDS) {
      if (over || (x - c.x) ** 2 + (z - c.z) ** 2 >= c.r * c.r) continue;
      const f = walker.feet;
      if (c.top === undefined || f === null || c.top > f + (walker.air ? 0.35 : 0.5)) return 99;
      if (top === null || c.top > top) top = c.top;
    }
    if (top !== null) return top;
  } else for (const p of PILES) if ((x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r) return 99;   // 在棧板底下游：水裡的樁擋著
  for (const p of PORCHES) {   // 小屋的門廊（平的）和門前石階；上面的長椅、水桶照上面擋著
    if (p.steps) {
      // 石階：第 i 階從門廊邊伸出 run×(i+1)、半寬 w0 + dw×i、頂面低 rise×(i+1)。某一點落在哪一階 = 往外的距離、往旁邊的距離各算一個階數取大的。
      // 高度用連續的（踩在每一階的中間剛好貼齊，前後差不到半階），走上走下才不會一頓一頓的；兩側很陡，從旁邊走過去會擋住
      const dx = hx - p.cx, dz = hz - p.cz, lat = Math.abs(dx * p.ux + dz * p.uz), d = -dx * p.uz + dz * p.ux;
      if (d <= 0 || d >= p.run * p.n || lat >= p.w0 + p.dw * (p.n - 1)) continue;
      const k = Math.max(d / p.run, (lat - p.w0) / p.dw + 1, 0);
      return p.y0 + p.rise * (Math.min(k, p.n - 0.5) + 0.5);
    }
    if (inWall(p, hx, hz)) return p.y0;
  }
  const ly = ladderY(x, z);   // 梯子：落水的人從這裡爬上棧板
  if (ly !== null) return ly;
  const dy = deckY(x, z, PIER_PLANK_PAD);   // 木棧板（岸邊平台、棧橋、指棧、店裡的地板）
  if (dy !== null && !under) return dy;   // 棧板比水面高 1 公尺多，游泳的人直接爬不上去（要找梯子），可以從底下游過去
  // 石頭：比地面高不到半公尺的地方（石頭低低的邊緣）直接踩得上去。
  // 再高的地方不能只靠「一步踏不上 0.6 公尺」：石頭表面是連續變高的，一小步一小步會一路走到頂上，所以看玩家的腳（walker）：
  //   跳起來、腳離石頭頂不到 0.3 公尺 → 落得上去；已經站在石頭上 → 平的、往下的地方照走，往上只走得上不陡的坡
  const rk = rockAt(x, z), g = landAt(x, z, hx, hz);
  if (rk === null || rk <= g) return g;
  if (rk - g < ROCK_STAND) return rk;
  const f = walker.feet;
  if (f !== null) {
    if (rk <= f + 0.02) return rk;
    if (rk <= f + 0.3 && (walker.air || rockSlope(x, z) < 0.7)) return rk;
  }
  return 99;
}
// 走路踩的地面：母島照畫出來的那張三角面（一面一面的，跟平滑的海床高度差得多的地方有好幾十公分，腳會陷進去或浮起來），其他地方照海床
function landAt(x, z, hx, hz) {
  const HG = HOME_GROUND, half = HG.size / 2 - 1;
  if (HOME_LAND.at && Math.abs(hx - HG.cx) < half && Math.abs(hz - HG.cz) < half) return HOME_LAND.at(hx, hz);
  // 大港灣島也一樣照畫出來的那張地面（大港座標）
  if (HAVEN_LAND.at) {
    const VG = HAVEN_GROUND, vh = VG.size / 2 - 2, [vx, vz] = havenToLocal(x, z);
    if (Math.abs(vx - VG.cx) < vh && Math.abs(vz - VG.cz) < vh) {
      // 透天洞穴是上下兩層：人比洞頂低（在洞裡游泳、從天窗掉下去）就照洞底，在洞頂上面走就照山坡
      const over = walker.fly && walker.feet !== null && walker.feet > HAVEN_LAND.at(vx, vz) + DEVMODE.wallTop;   // 開發者模式飛得夠高：從屋頂上飛過去
      if (!over && portWall(vx, vz)) return 99;   // 山城的小屋：牆擋著
      const foundation = portFoundation(vx, vz, HAVEN_LAND.at);
      if (foundation !== null) return Math.max(foundation, HAVEN_LAND.at(vx, vz));
      // 天窗邊的跳水台、碼頭的棧板：踩在上面的人照板面
      const dk = havenDeck(vx, vz, walker.feet);
      if (dk !== null) return skyEdge(vx, vz) > 0 ? Math.max(dk, HAVEN_LAND.at(vx, vz)) : dk;
      const low = caveUnder(vx, vz, walker.feet);
      return low !== null ? low : HAVEN_LAND.at(vx, vz);
    }
  }
  // 海上修船屋：平台、爬梯、屋裡擋路的東西（修船屋座標；在平台底下游泳的人照海床）
  const [yx, yz] = seaYardToLocal(x, z), yg = yardGround(yx, yz, walker.feet);
  if (yg !== null) return walker.fly && yg > 90 && walker.feet !== null && walker.feet > DEVMODE.wallTop ? bedAt(x, z) : yg;
  return bedAt(x, z);
}
// 正在走的那個人的腳在多高（只有玩家自己移動的那一下有值；其他地方問地面高度時是 null，石頭照「比地面高半公尺就擋」）
const walker = { feet: null, air: false, fly: false };   // fly：開發者模式飛行中（見 walkGround）
// 丟出去、還在飛的東西底下的地面（y：東西的底在多高）：木箱、木桶、石頭照東西的高度看落不落得上去（跟跳起來的人一樣）；
// 繫船柱、燈桿、樁這類沒記高度的細東西只擋低低飛過去的（離棧板一公尺內），飛得比它高就過去
function flyGround(x, z, y) {
  const f = walker.feet, air = walker.air;
  walker.feet = y; walker.air = true;
  const g = walkGround(x, z);
  walker.feet = f; walker.air = air;
  if (g < 90 || y < DECK_Y + 1) return g;
  const [hx, hz] = toLocal(x, z);
  if (BLOCKS.some((r) => inWall(r, hx, hz)) || !SOLIDS.some((c) => c.top === undefined && (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r)) return g;
  return deckY(x, z, PIER_PLANK_PAD) ?? g;
}
// 石頭表面在這一點有多陡（高度每公尺變多少）；旁邊沒石頭的方向不算
function rockSlope(x, z) {
  const e = 0.2, c = rockAt(x, z);
  let m = 0;
  for (const [ax, az] of [[e, 0], [0, e]]) {
    const a = rockAt(x + ax, z + az), b = rockAt(x - ax, z - az);
    if (a !== null && b !== null) m = Math.max(m, Math.abs(a - b) / (2 * e));
    else if (a !== null) m = Math.max(m, Math.abs(a - c) / e);
    else if (b !== null) m = Math.max(m, Math.abs(c - b) / e);
  }
  return m;
}
// 船眼中的地面：棧橋也算障礙物
const boatGround = (x, z) => {
  if (deckY(x, z, 0.4) !== null) return DECK_Y;
  const rk = rockAt(x, z);
  // 透天洞穴附近照精確的形狀算（暗門水道只有 4.2 公尺寬，2 公尺一格的海床圖太粗）
  // 大港的棧橋、海上修船屋的平台底下都是樁，船過不去
  const [vx, vz] = havenToLocal(x, z), [yx, yz] = seaYardToLocal(x, z);
  const bed = portPier(vx, vz) || yardPier(yx, yz) ? 1 : nearCave(vx, vz) ? havenLow(vx, vz) : bedAt(x, z);
  return rk === null ? bed : Math.max(bed, rk);
};

// ---- 場景物件 -------------------------------------------------------------
// 地形網格：高度與法線直接放進頂點；深海的格子不畫（反正看不到）
// 這一格（四個角）是不是整個落在母島低面地形的範圍裡（往內縮一格，接縫處兩層稍微重疊，不會露出縫）
function underHomeGround(i, j) {
  const HG = HOME_GROUND, half = HG.size / 2 - DX, n = NF;
  for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const [hx, hz] = toLocal(((i + di + 0.5) / n - 0.5) * L, ((j + dj + 0.5) / n - 0.5) * L);
    if (Math.abs(hx - HG.cx) > half || Math.abs(hz - HG.cz) > half) return false;
  }
  return true;
}
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
      if (underHomeGround(i, j)) continue;   // 母島那一塊由港口的低面地形畫
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
// 遠處（rFull 公尺外）的三角形照「方位」一條一條排：只畫前面幾條，就是只鋪某個方向的一片扇形（見 fitWater）
function makePolarGeometry(nA = 384, nR = 420, r0 = 0.8, rMax = 34000, rFull = 150) {
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
  const quad = (i, j) => {
    const a = 1 + i * nA + j, b = 1 + i * nA + ((j + 1) % nA), c = a + nA, d = b + nA;
    idx[t++] = a; idx[t++] = b; idx[t++] = c;
    idx[t++] = b; idx[t++] = d; idx[t++] = c;
  };
  // 近處：一圈一圈排（整圈都要）
  let iF = 0;
  while (iF < nR - 1 && r0 * Math.pow(rMax / r0, iF / (nR - 1)) < rFull) iF++;
  for (let i = 0; i < iF; i++) for (let j = 0; j < nA; j++) quad(i, j);
  const inner = t;
  // 遠處：一條一條排
  for (let j = 0; j < nA; j++) for (let i = iF; i < nR - 1; i++) quad(i, j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.userData = { nA, inner, perCol: (nR - 1 - iF) * 6, rFull: r0 * Math.pow(rMax / r0, iF / (nR - 1)) };
  return g;
}

// 手機版海面用的海床高度：16 位元浮點、可以線性取樣（原本那張是 32 位元的，手機不一定能線性取樣，要自己取四格內插）
function makeBed16() {
  const t = new THREE.DataTexture(Uint16Array.from(bedData, (v) => THREE.DataUtils.toHalfFloat(v)), NF, NF, THREE.RedFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
// 手機版海面的細碎波紋：一張可以無縫拼接的圖，存的是坡度（紅 = x、綠 = z）。二十幾道方向、長短不一的小波疊起來
function makeRippleTexture(size = 128) {
  let seed = 7331;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const waves = Array.from({ length: 26 }, () => {
    const kx = Math.round((rnd() - 0.5) * 22), kz = Math.round((rnd() - 0.5) * 22), k = Math.hypot(kx, kz) || 1;
    return { kx, kz, a: 1 / (2 + k), p: rnd() * Math.PI * 2 };
  });
  const sx = new Float32Array(size * size), sz = new Float32Array(size * size);
  let mx = 1e-6;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let x = 0, z = 0;
    for (const w of waves) { const c = w.a * Math.cos(2 * Math.PI * (w.kx * i + w.kz * j) / size + w.p); x += c * w.kx; z += c * w.kz; }
    sx[j * size + i] = x; sz[j * size + i] = z;
    mx = Math.max(mx, Math.abs(x), Math.abs(z));
  }
  const data = new Uint8Array(size * size * 4);
  for (let k = 0; k < size * size; k++) { data[k * 4] = Math.round((sx[k] / mx * 0.5 + 0.5) * 255); data[k * 4 + 1] = Math.round((sz[k] / mx * 0.5 + 0.5) * 255); data[k * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// 手機：海浪的 FFT 用 16 位元算（每幀要搬的資料少一半，手機的記憶體頻寬吃不消 32 位元；浪高的誤差在毫米等級）。
// ?fft16 / ?fft32：強制用哪一種，比較用
const FFT16 = /[?&]fft16/.test(location.search) || (TOUCH && !/[?&]fft32/.test(location.search));
// 手機版的海面（另一套便宜很多的畫法，浪還是同一片；見 renderShaders.js 的 liteWaterVert）。
// 手機一律用它；?litesea 在電腦上也用（測試）、?fullsea 讓手機用回電腦版（比較用）
const LITE_SEA = /[?&]litesea/.test(location.search) || (TOUCH && !/[?&]fullsea/.test(location.search));
const ocean = new FftOcean(renderer, { hs: HS, windAngle: WAVE_ANGLE, fft16: FFT16, lite: LITE_SEA });
// 太陽的水平方向跟著港口轉：港座標裡太陽在西南方，店面與碼頭是向陽面，轉過去之後光照關係不變
const homeSun = (x, y, z) => [x * Math.cos(HOME_YAW) + z * Math.sin(HOME_YAW), y, -x * Math.sin(HOME_YAW) + z * Math.cos(HOME_YAW)];
const sunDir = new THREE.Vector3(...homeSun(-0.5, 0.52, 0.6)).normalize();
const wake = Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, -1e6, 0));

// ---- 海況：平常是普通風浪，偶爾來一場風暴或幾道巨浪 ---------------------------
const sea = new Sea();
const climate = new Climate();   // 時間與每天的天氣
sea.remote = climate.remote = true;   // 時間、天氣、海上事件都聽伺服器的（這裡只負責演出來）
const seaEnv = { near: { x: 0, z: 0 }, dangerAt };   // 給海上事件用：玩家的船在哪、哪裡算外海
let wind = climate.wind;         // 今天的風浪強度（由天氣決定，慢慢變）
// 這裡的浪高倍率（1 = 示性波高 HS 公尺；還沒乘避浪係數）：外海比島邊大、迎風面一路大到岸邊，風暴另外加上去。
// 式子在 weather.js 的 seaLevel()，與 shader 的 waveScale() 一致
const levelAt = (x, z) => seaLevel(ocean.scale, sea.storm, sea.surge, dangerAt(x, z), openOf(shelterAt(x, z)));
// 這裡的浪是「今天島邊的浪」的幾倍
const stormK = (x, z) => levelAt(x, z) / Math.max(ocean.scale, 0.02);
let tideNow = 0;   // 潮汐：現在的海平面（公尺）
const waveK = (x, z) => shelterAt(x, z) * stormK(x, z);
// 巨浪在這裡的高度：外海是整道水牆，靠岸變矮，沖上岸、淹進港口（浪腳前面是負的：海水先退下去）
const surgeAt = (x, z) => { if (!sea.tsu.on) return 0; const k = tsuKAt(x, z); return sea.heightCurl(x, z, k, shared.uTime.value) * tsuHK(k) + sea.ebbAt(x, z, k); };
// 風浪以外的水面起伏：巨浪的浪牆、漩渦的漏斗、水龍捲腳下的隆起
let WDX = Math.cos(WAVE_ANGLE), WDZ = Math.sin(WAVE_ANGLE);   // 風（和浪）往哪邊走：每天偏一點，颱風時一路轉
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
const tsuAt = (x, z) => surgeAt(x, z) + (sea.vortices.length ? sea.vortexH(x, z) : 0) + swellH(x, z) + tideNow;

WIND.dir.value.set(Math.cos(WAVE_ANGLE), Math.sin(WAVE_ANGLE));   // 樹被風吹的方向跟風浪一致
const groundDetail = makeGroundDetail();
for (const t of [groundDetail.detail, groundDetail.normal]) t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
const TIME_U = { value: 0 };
const CUT_N = 6;   // 海面著色器最多同時把幾艘船的船艙挖掉（離鏡頭最近的幾艘；跟 renderShaders.js 的 CUT_N 一樣）
const shared = {
  uBed: { value: bedTex }, uShelter: { value: shelterTex }, uShore: { value: shoreTex }, uN: { value: NF }, uL: { value: L },
  uSunDir: { value: sunDir }, uTime: TIME_U, uSwellT: TIME_U,
  uCenter: { value: new THREE.Vector2() }, uMeshRot: { value: new THREE.Vector2(1, 0) }, uWaveScale: { value: 1 },
  uPixelAngle: { value: 0.001 }, uWake: { value: wake }, uWakeBox: { value: new THREE.Vector4() }, uLampOn: { value: 0 }, uWaveRot: { value: new THREE.Vector2(1, 0) }, uTide: { value: 0 }, uRip: { value: null }, uSwimmer: { value: null },
  uDisp0: { value: null }, uDisp1: { value: null },
  uSlope0: { value: ocean.cascades[0].slope.texture },
  uSlope1: { value: ocean.cascades[1].slope.texture },
  uSlope2: { value: ocean.cascades[2].slope.texture },
  uPatch: { value: new THREE.Vector3(...ocean.patches) }, uTexN: { value: ocean.N },
  uSlopeVar: { value: new THREE.Vector3(...ocean.cascades.map((c) => c.slopeVar)) },
  uFoamTex: { value: makeFoamTexture() }, uHs: { value: HS },
  // 手機版的海面用的：兩層浪各有前後兩張（位移、斜率＋白浪），海床高度的 16 位元版，細碎波紋的貼圖
  uLD0A: { value: null }, uLD0B: { value: null }, uLD1A: { value: null }, uLD1B: { value: null },
  uLS0A: { value: null }, uLS0B: { value: null }, uLS1A: { value: null }, uLS1B: { value: null },
  uLK: { value: new THREE.Vector2() }, uLOff: { value: 0.5 / 128 - 0.5 / ocean.N }, uVortexOn: { value: 0 },
  uBed16: { value: LITE_SEA ? makeBed16() : null }, uRipTex: { value: LITE_SEA ? makeRippleTexture() : null },
  uDetail: { value: groundDetail.detail }, uDetailN: { value: groundDetail.normal },
  uWindT: WIND.t, uWindAmp: WIND.amp, uWindDir: WIND.dir,
  uShoreW: { value: new THREE.Vector4(Math.cos(WAVE_ANGLE), Math.sin(WAVE_ANGLE), 0, 0) }, uShoreP: { value: 0 },   // 岸邊的浪跟著風向（見 renderShaders.js 的 shoreFace、shoreTilt）
  uUnder: { value: 0 }, uCamDepth: { value: 0 },
  uReflTex: { value: null }, uReflMat: { value: new THREE.Matrix4() }, uReflOn: { value: 0 },
  uReflPass: REFL, uReflY: { value: 0 },
  uShTri: { value: Array.from({ length: 6 }, () => new THREE.Vector2(1e6, 1e6)) },
  uShHull: { value: new THREE.Vector4(1e6, 1e6, 1, 0) }, uShSize: { value: new THREE.Vector2(5, 1.3) },
  uQuay: { value: Array.from({ length: 3 }, () => new THREE.Vector4(1e6, 1e6, 1e6, 1e6)) },
  uHull: { value: Array.from({ length: 3 }, () => new THREE.Vector4(1e6, 1e6, 1, 0)) },
  uHullSize: { value: Array.from({ length: 3 }, () => new THREE.Vector3(1, 1, 0)) },
  uCutM: { value: Array.from({ length: CUT_N }, () => new THREE.Matrix4()) }, uCutA: { value: Array.from({ length: CUT_N }, () => new THREE.Vector4()) }, uCutB: { value: Array.from({ length: CUT_N }, () => new THREE.Vector4()) }, uCutC: { value: Array.from({ length: CUT_N }, () => new THREE.Vector3()) },
  uDanger: { value: dangerTex }, uTsuK: { value: tsuKTex }, uStorm: { value: 0 }, uTsu: { value: new THREE.Vector4(0, 1, 0, 0) }, uTsu2: { value: new THREE.Vector2() }, uGloom: { value: 0 },
  uSunCol: { value: new THREE.Vector3(1, 0.93, 0.8) }, uAmbient: { value: new THREE.Vector3(1, 1, 1) },
  uDay: { value: 1 }, uDusk: { value: 0 }, uFog: { value: 0 }, uHazeK: { value: 1 }, uFlash: { value: 0 }, uFlashDir: { value: new THREE.Vector3(0, 1, 0) }, uRain: { value: 0 }, uCloudMap: { value: null }, uPaint: { value: new THREE.Vector4(0, 0, CLOUDS.H, 0) }, uPaintOff: { value: new THREE.Vector4() }, uDeck: { value: new THREE.Vector4(0, 0, 1, 0) }, uSwell: { value: 0 }, uSurge: { value: 0 }, uFlood: { value: 0 },
  uCloudSh: { value: Array.from({ length: CLOUDS.shadowN }, () => new THREE.Vector4(1e6, 1e6, 1, 0)) },
  uVortex: { value: Array.from({ length: 3 }, () => new THREE.Vector4()) },
  uLamp: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
  uBlob: { value: new THREE.Vector3() }, uWet: { value: 0 }, uRainbow: { value: 0 },
  uBeam: { value: new THREE.Vector4(0, 0, 1, 0) }, uBeamOn: { value: 0 },
  uIsle: { value: ISLANDS.map((o) => new THREE.Vector4(o.x, o.z, o.R, 0)) },
  uIsleLook: { value: ISLANDS.map((o) => new THREE.Vector4(o.look.rock, o.look.veg, o.look.white, o.look.dry)) },
  uShadowMap: { value: null }, uShadowMat: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 }, uShadowTexel: { value: 1 / 2048 },
  // 電腦版的陰影：舊方向（淡出中）、近處高解析度（見「電腦版的陰影升級」）
  uShadowMapOld: { value: null }, uShadowMatOld: { value: new THREE.Matrix4() }, uShadowFade: { value: 0 },
  uShadowMapNear: { value: null }, uShadowMatNear: { value: new THREE.Matrix4() }, uShadowMapNearOld: { value: null }, uShadowMatNearOld: { value: new THREE.Matrix4() },
  uShadowNearOn: { value: 0 }, uShadowTexelNear: { value: 1 / 2048 },
  uSwe: { value: null }, uSweWet: { value: null }, uSweOrigin: { value: new THREE.Vector2() }, uSweSize: { value: 1 }, uSweOn: { value: 0 },
};

// 地形切成 128 公尺見方的一塊塊（共用同一份頂點），各自有邊界框：
// 陰影只照身邊幾十公尺、倒影只照 450 公尺內，只畫照得到的那幾塊（以前整座島每一趟都要畫一遍，手機上很吃力）
const terrain = new THREE.Group();
{
  const mat = new THREE.ShaderMaterial({ vertexShader: terrainVert, fragmentShader: terrainFrag, uniforms: shared });
  const g = makeTerrainGeometry(), idx = g.index.array, pos = g.attributes.position.array, T = 16;
  const buckets = Array.from({ length: T * T }, () => []);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const tx = clamp(Math.floor((pos[a] / L + 0.5) * T), 0, T - 1), tz = clamp(Math.floor((pos[a + 2] / L + 0.5) * T), 0, T - 1);
    buckets[tz * T + tx].push(idx[t], idx[t + 1], idx[t + 2]);
  }
  for (const b of buckets) {
    if (!b.length) continue;
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', g.attributes.position);
    cg.setAttribute('normal', g.attributes.normal);
    cg.setIndex(new THREE.BufferAttribute(new Uint32Array(b), 1));
    const box = new THREE.Box3(), v = new THREE.Vector3();
    for (const k of b) box.expandByPoint(v.fromArray(pos, k * 3));
    cg.boundingBox = box;
    cg.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    terrain.add(new THREE.Mesh(cg, mat));
  }
  terrain.material = mat;
}
scene.add(terrain);

const water = new THREE.Mesh(LITE_SEA ? makePolarGeometry(160, 150) : makePolarGeometry(), new THREE.ShaderMaterial({
  vertexShader: LITE_SEA ? liteWaterVert : waterVert, fragmentShader: LITE_SEA ? liteWaterFrag : waterFrag, uniforms: shared, transparent: true,
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
  vertexShader: LITE_SEA ? liteWaterVert : waterVert, uniforms: shared, transparent: true,
  fragmentShader: `${hullCutGlsl}
varying vec3 vWorld;
void main() { if (inHull(vWorld)) discard; gl_FragColor = vec4(0.0, 0.0, 0.0, 3.0); }`,   // 船艙裡跟海面一樣不畫
  blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor,
  depthWrite: false, depthFunc: THREE.LessEqualDepth, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, side: THREE.DoubleSide,
}));
waterFlag.frustumCulled = false;
waterFlag.renderOrder = 2.1;
water.add(waterFlag);   // 跟著海面一起顯示、隱藏（畫倒影時海面是藏起來的）
// 測試（?wlod0）：海面頂點不用縮小版的浪高圖，查手機上遠處海面翹起來的問題
if (new URLSearchParams(window.location.search).has('wlod0')) for (const m of [water.material, waterFlag.material]) m.defines.WLOD0 = 1;
// 測試（?wno=字母）：關掉海面高度的某幾項。f FFT 浪、s 岸邊的浪、v 漩渦／水龍捲、t 巨浪、w 颱風長浪
for (const c of new URLSearchParams(window.location.search).get('wno') || '') if ('fsvtw'.includes(c)) for (const m of [water.material, waterFlag.material]) m.defines['NO_' + c.toUpperCase()] = 1;
// 測試（?wflat）：海面強制放平，分辨「海面真的被抬高」還是「深度、繪製順序」造成的假象
if (new URLSearchParams(window.location.search).has('wflat')) for (const m of [water.material, waterFlag.material]) m.defines.WFLAT = 1;
// 有些手機（Adreno 顯示晶片）的驅動程式連結不了完整版的海面程式：連結失敗，海面整片畫不出來，看到的是底下的東西。
// 第一次畫完就檢查，失敗的話改用拆開的兩版（見 renderShaders.js 的 WATER_SPLIT）：平常不含巨浪，巨浪來的時候換成含巨浪、岸邊不捲浪的那一版。
// ?wsplit：電腦上也強制用拆開的兩版，測試用
let waterSplit = false, waterChecked = false;
function setWaterSplit() {
  waterSplit = true;
  for (const m of [water.material, waterFlag.material]) { m.defines.WATER_SPLIT = 1; m.needsUpdate = true; }
}
if (new URLSearchParams(window.location.search).has('wsplit')) setWaterSplit();
function checkWater() {
  if (waterChecked) return;
  const p = renderer.properties.get(water.material).currentProgram;
  if (!p) return;
  waterChecked = true;
  const gl = renderer.getContext();
  if (!waterSplit && !gl.getProgramParameter(p.program, gl.LINK_STATUS)) { console.warn('海面程式連結失敗，改用拆開的兩版'); setWaterSplit(); }
  // 巨浪那一版先在背後編好：手機上第一次編要卡一兩秒，不要等到巨浪來了才卡
  if (waterSplit) setTimeout(() => {
    const warm = water.material.clone();
    warm.defines = { ...water.material.defines, TSU_ON: 1 };
    waterWarm = new THREE.Mesh(water.geometry, warm);
    waterWarm.frustumCulled = false;
    renderer.compile(waterWarm, camera);
  }, 3000);
}
let waterWarm = null;   // 留著，編好的程式才不會被丟掉
// 海面的網格只鋪看得到的地方：身邊 150 公尺內整圈都鋪；更遠的只鋪鏡頭朝的那個方向（背後那一大半本來每一幀都白算）。
// 整張網格轉過去對準，轉的角度是「一格」的整數倍——每個頂點落在的位置跟整圈鋪的時候一模一樣，所以畫面不會因此抖動。
// 鏡頭很高、離中心很遠、幾乎垂直往下看、在水裡，或是有巨浪、漩渦（它們會把網格往旁邊拉）的時候，照舊整圈鋪
const _wd = new THREE.Vector3();
function fitWater(under) {
  const ud = water.geometry.userData, cp = camera.position, c = shared.uCenter.value, step = Math.PI * 2 / ud.nA;
  let cols = ud.nA, rot = 0;
  const off = Math.hypot(cp.x - c.x, cp.z - c.y);
  camera.getWorldDirection(_wd);
  if (!under && !NO_FIT && !sea.tsu.on && !sea.vortices.length && cp.y < 25 && off < 0.45 * ud.rFull && Math.hypot(_wd.x, _wd.z) > 0.3) {
    // 貼近水平的視線最遠只偏到畫面的半個水平視角（往上往下看都一樣）；再加上鏡頭不在中心的偏差、浪把頂點推歪的餘裕
    const th = Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect * 1.07) + Math.asin(off / ud.rFull) + 0.12;
    const n = Math.ceil(2 * th / step) + 2;
    if (n < ud.nA) { cols = n; rot = (Math.round((Math.atan2(_wd.z, _wd.x) - th) / step) - 1) * step; }
  }
  water.geometry.setDrawRange(0, ud.inner + cols * ud.perCol);
  shared.uMeshRot.value.set(Math.cos(rot), Math.sin(rot));
}
const NO_FIT = new URLSearchParams(window.location.search).has('nofit');   // 測試（?nofit）：海面照舊整圈鋪
function syncWaterTsu() {
  if (!waterSplit) return;
  const on = shared.uTsu.value.w > 0;
  for (const m of [water.material, waterFlag.material]) {
    if (!!m.defines.TSU_ON === on) continue;
    if (on) m.defines.TSU_ON = 1; else delete m.defines.TSU_ON;
    m.needsUpdate = true;
  }
}
scene.add(water);
DECKS.slice(0, 3).forEach((r, i) => shared.uQuay.value[i].set(r.x0, r.z0, r.x1, r.z1));   // 岸壁、防波堤的位置（港座標，著色器用 uHome 轉）：海面要在牆腳畫水線
shared.uHome = HOME_U;

const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
  vertexShader: skyVert, fragmentShader: skyFrag, uniforms: shared, defines: { PAINT_SKY: 1 },
  side: THREE.BackSide, depthWrite: false,
}));
// 手繪平塗的積雲：載入時畫成一張環景圖（clouds.js），之後只是查圖。手機和陰影「低」用小一半的圖。
// 電腦的海面倒影也映得出這些雲；手機的海面程式已經很吃緊（見上面 WATER_SPLIT），倒影只有低雲層。
// 變天時的低雲層（一整片的暴風雨天空）是著色器直接畫的，每個材質都有。網址加 ?nopaint 可以關掉積雲（比較用）
if (!new URLSearchParams(window.location.search).has('nopaint')) {
  const small = TOUCH || gfx.lite;
  shared.uCloudMap.value = bakeClouds(renderer, small ? 512 : 1024).texture;
  shared.uPaint.value.x = 1;
  if (!TOUCH) for (const m of [water.material, waterFlag.material]) m.defines.PAINT_SKY = 1;
}
// 雲順著風飄（見 config.js 的 CLOUDS）：雲固定在世界上，A、B 兩組位移都跟著風累加。
// A 飄出 loop/2 就讓 B 從上風處接手，交疊 morph 公里（看起來是雲慢慢變形），換完 B 變成新的 A
const drift = { a: [0, 0], b: [0, 0], w: 0, moved: 0, deck: [0, 0] };   // deck：低雲層一路飄過去的量（不用換組）
// 雲影用的每朵雲；m：天上那朵雲跟著飄移的比例（跟 renderShaders.js 的 paintDir 一樣：越靠近地平線的越遠、移得越少）
const CORES = cloudCores().map((c) => {
  const t = clamp((c.y / Math.hypot(c.x, c.y, c.z) - CLOUDS.nearLo) / (CLOUDS.nearHi - CLOUDS.nearLo), 0, 1);
  return { ...c, m: t * t * (3 - 2 * t) };
});
const shCand = [];
function driftClouds(dt) {
  const D = drift, v = gale.steady * CLOUDS.drift / 1000 * dt, dx = WDX * v, dz = WDZ * v;   // 這一幀飄了幾公里
  D.a[0] += dx; D.a[1] += dz; D.b[0] += dx; D.b[1] += dz; D.deck[0] += dx; D.deck[1] += dz;
  if (D.w > 0) {
    D.moved += v; D.w = Math.min(1, D.moved / CLOUDS.morph);
    if (D.w >= 1) { D.a[0] = D.b[0]; D.a[1] = D.b[1]; D.w = 0; }
  } else if (Math.hypot(D.a[0], D.a[1]) > CLOUDS.loop / 2) {
    D.b[0] = -WDX * CLOUDS.loop / 2; D.b[1] = -WDZ * CLOUDS.loop / 2; D.moved = 0; D.w = 1e-4;
  }
  const w = D.w * D.w * (3 - 2 * D.w), cx = camera.position.x / 1000, cz = camera.position.z / 1000;
  shared.uPaint.value.y = w;
  shared.uPaintOff.value.set(cx - D.a[0], cz - D.a[1], cx - D.b[0], cz - D.b[1]);
  shared.uDeck.value.set(cx - D.deck[0], cz - D.deck[1], WDX, WDZ);
  // 雲影：每朵雲投到雲那層平面上的位置（跟天上畫出來的對得上），再順著太陽光往下移到地面；只留離鏡頭最近的幾朵
  const H = CLOUDS.H, sy = Math.max(sunDir.y, 0.15), lx = sunDir.x / sy * H, lz = sunDir.z / sy * H;
  shCand.length = 0;
  for (const [o, k] of [[D.a, 1 - w], [D.b, w]]) {
    if (k < 0.02) continue;
    for (const c of CORES) {
      const f = H / c.y, m = c.m, x = c.x * f + o[0] * m + cx * (1 - m) - lx, z = c.z * f + o[1] * m + cz * (1 - m) - lz;   // 遠的雲有一部分是跟著人走的
      shCand.push({ x, z, r: c.w * f * 0.3, k: CLOUDS.shadow * k, d: (x - cx) ** 2 + (z - cz) ** 2 });
    }
  }
  shCand.sort((p, q) => p.d - q.d);
  shared.uCloudSh.value.forEach((u, i) => {
    const c = shCand[i];
    if (c) u.set(c.x * 1000, c.z * 1000, c.r * 1000, c.k); else u.set(1e6, 1e6, 1, 0);
  });
}
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
// 每一幀都更新（以前隔一幀，手機幀數低的時候人一走動，影子就落在後面一截）
// 貼圖 3072：在 Iris Xe 上比 2048 每幀多 0.6 毫秒左右，4096 則要多 4.5 毫秒（量過），所以取 3072、範圍收到 54 公尺
let SHADOW_HALF = gfx.shadowHalf;   // 畫質「手機」收到 40 公尺（貼圖小，範圍也跟著收，影子才不會太粗）
let SHADOW_SIZE = gfx.shadow;   // 陰影設定：最高 4096、高 3072、中 2048、低 1024
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
// 換方向淡入淡出的陰影（見下面「陰影升級」）：電腦四盞只投影、不發光的平行光排在最前面（遠新、遠舊、近新、近舊），
// 手機只有前兩盞（遠新、遠舊）；太陽排在它們後面（第五／第三盞）、自己不投影。
// 太陽那一盞的影子在這裡合起來：遠的新舊照比例混、近處（電腦）換成高解析度的那張（範圍邊緣接回遠的）。
// 每盞的 shadow.intensity 拿來傳比例：[0] 整體深淺、[1] 舊方向佔幾成、[2] 近處開不開
THREE.ShaderChunk.shadowmap_pars_fragment += `
#if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS == 4 || NUM_DIR_LIGHT_SHADOWS == 2 )
#if NUM_DIR_LIGHT_SHADOWS == 2
// 只有遠的那張（手機、電腦陰影「低」而且沒開近處陰影）：四個點各錯開半格、靠硬體的雙線性比較抹平，
// 不轉角度、不加雜訊。內建的取法每個像素轉一個亂數角度，貼圖格子大時影子邊緣是一片沙沙的雜點，人一走動還會跟著閃
float sunFarPCF( sampler2DShadow map, vec4 coord, vec2 size, float bias ) {
	vec3 c = coord.xyz / coord.w;
	if ( c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0 ) return 1.0;
	c.z += bias;
	vec2 h = 0.5 / size;
	return ( texture( map, vec3( c.xy + h, c.z ) ) + texture( map, vec3( c.xy - h, c.z ) )
		+ texture( map, vec3( c.xy + vec2( h.x, -h.y ), c.z ) ) + texture( map, vec3( c.xy + vec2( -h.x, h.y ), c.z ) ) ) * 0.25;
}
#endif
#if NUM_DIR_LIGHT_SHADOWS == 4
// 近處那張的取樣：3×3 格、中間重四周輕（每一格又是硬體的雙線性比較），不轉角度、不加雜訊、不再拉陡。
// 內建的取法每個像素轉一個亂數角度再拉陡邊緣，格子細的時候反而把邊緣弄成一坨一坨鋸齒
float sunNearPCF( sampler2DShadow map, vec4 coord, vec2 size, float bias ) {
\tvec3 c = coord.xyz / coord.w;
\tc.z += bias;
\tvec2 t = 1.0 / size;
\tfloat s = texture( map, c ) * 4.0;
\ts += ( texture( map, vec3( c.xy + vec2( t.x, 0.0 ), c.z ) ) + texture( map, vec3( c.xy - vec2( t.x, 0.0 ), c.z ) )
\t\t+ texture( map, vec3( c.xy + vec2( 0.0, t.y ), c.z ) ) + texture( map, vec3( c.xy - vec2( 0.0, t.y ), c.z ) ) ) * 2.0;
\ts += texture( map, vec3( c.xy + t, c.z ) ) + texture( map, vec3( c.xy - t, c.z ) )
\t\t+ texture( map, vec3( c.xy + vec2( t.x, -t.y ), c.z ) ) + texture( map, vec3( c.xy + vec2( -t.x, t.y ), c.z ) );
\treturn s / 16.0;
}
#endif
float sunShadowPlus() {
	DirectionalLightShadow s0 = directionalLightShadows[ 0 ], s1 = directionalLightShadows[ 1 ];
	float wOld = s1.shadowIntensity;
#if NUM_DIR_LIGHT_SHADOWS == 2
	float sh = sunFarPCF( directionalShadowMap[ 0 ], vDirectionalShadowCoord[ 0 ], s0.shadowMapSize, s0.shadowBias );
	if ( wOld > 0.001 ) sh = mix( sh, sunFarPCF( directionalShadowMap[ 1 ], vDirectionalShadowCoord[ 1 ], s1.shadowMapSize, s1.shadowBias ), wOld );
#else
	float sh = getShadow( directionalShadowMap[ 0 ], s0.shadowMapSize, 1.0, s0.shadowBias, s0.shadowRadius, vDirectionalShadowCoord[ 0 ] );
	if ( wOld > 0.001 ) sh = mix( sh, getShadow( directionalShadowMap[ 1 ], s1.shadowMapSize, 1.0, s1.shadowBias, s1.shadowRadius, vDirectionalShadowCoord[ 1 ] ), wOld );
#endif
#if NUM_DIR_LIGHT_SHADOWS == 4
	DirectionalLightShadow s2 = directionalLightShadows[ 2 ], s3 = directionalLightShadows[ 3 ];
	if ( s2.shadowIntensity > 0.5 ) {
		vec3 c = vDirectionalShadowCoord[ 2 ].xyz / vDirectionalShadowCoord[ 2 ].w;
		vec2 e = min( c.xy, 1.0 - c.xy );
		float w = c.z <= 1.0 ? smoothstep( 0.0, 0.08, min( e.x, e.y ) ) : 0.0;
		if ( w > 0.0 ) {
			float sn = sunNearPCF( directionalShadowMap[ 2 ], vDirectionalShadowCoord[ 2 ], s2.shadowMapSize, s2.shadowBias );
			if ( wOld > 0.001 ) sn = mix( sn, sunNearPCF( directionalShadowMap[ 3 ], vDirectionalShadowCoord[ 3 ], s3.shadowMapSize, s3.shadowBias ), wOld );
			sh = mix( sh, sn, w );
		}
	}
#endif
	return mix( 1.0, sh, s0.shadowIntensity );
}
#endif
`;
{
  const ORIG = `\t\t#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )\n\t\tdirectionalLightShadow = directionalLightShadows[ i ];`;
  // （打包過的 three.js 著色器片段空白行被壓掉了，這裡比對都不靠空白）
  const BODY0 = /(\n\s*directionalLight = directionalLights\[ i \];)/;
  const BODY1 = /(RE_Direct\( directLight, [^;]*;\s*)(\}\s*#pragma unroll_loop_end\s*#endif\s*#if \( NUM_RECT_AREA_LIGHTS)/;
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  if (!chunk.includes(ORIG) || !BODY0.test(chunk) || !BODY1.test(chunk)) console.warn('lights_fragment_begin 跟預期的不一樣：電腦版陰影接不上');
  // 只投影、不發光的那幾盞（前四盞／前兩盞）：整段光照都跳過
  THREE.ShaderChunk.lights_fragment_begin = chunk
    .replace(BODY0, '\n\t\t#if !( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS == 4 || NUM_DIR_LIGHT_SHADOWS == 2 ) && UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )$1')
    .replace(BODY1, '$1\t\t#endif\n\t$2');
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(ORIG,
    `\t\t#if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS == 4 || NUM_DIR_LIGHT_SHADOWS == 2 )\n\t\t#if UNROLLED_LOOP_INDEX == NUM_DIR_LIGHT_SHADOWS\n\t\tdirectLight.color *= ( directLight.visible && receiveShadow ) ? sunShadowPlus() : 1.0;\n\t\t#endif\n\t\t#elif defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )\n\t\tdirectionalLightShadow = directionalLightShadows[ i ];`);
}
shared.uShadowMat.value = sun.shadow.matrix;
shared.uShadowTexel.value = 1 / SHADOW_SIZE;
const _sr = new THREE.Vector3(), _su = new THREE.Vector3(), _sc = new THREE.Vector3();
const _shLast = new THREE.Vector3(1e9, 0, 0);   // 上一次畫陰影時的注視點（手機：動了就每一幀重畫）
// 投影用的太陽方向：每一幀都跟著太陽走（以前是每走 0.35 度才跟一次，影子每隔一兩秒就跳一下，使用者不要）。
// 陰影貼圖的格子方向用固定的參考軸（世界的 +Z，太陽的路徑大致繞著它轉）算，太陽移動時格子幾乎不轉，
// 影子的邊緣只會跟著平順地滑動，不會一格一格地蠕動
const shDir = sunDir.clone(), SH_REF = new THREE.Vector3(0, 0, 1);
// 把一盞平行光擺到注視點上方、朝 dir 照。位置對齊陰影貼圖的格子（half：範圍的一半、size：貼圖幾格），鏡頭移動時影子的邊緣才不會閃
function aimLight(l, dir, center, half, size) {
  _sr.copy(SH_REF).cross(dir);
  if (_sr.lengthSq() < 1e-6) _sr.set(1, 0, 0);
  _sr.normalize();
  _su.copy(dir).cross(_sr);
  const texel = (2 * half) / size;
  const cx = Math.round(center.dot(_sr) / texel) * texel, cy = Math.round(center.dot(_su) / texel) * texel;
  _sc.copy(_sr).multiplyScalar(cx).addScaledVector(_su, cy).addScaledVector(dir, center.dot(dir));
  l.target.position.copy(_sc);
  l.position.copy(_sc).addScaledVector(dir, 220);
  l.target.updateMatrixWorld();
  l.updateMatrixWorld();
}

// ---- 陰影升級（電腦：陰影畫質「低」以上全套；手機、陰影「低」：只有第 2 項，而且只用遠的那張）----
// 1. 近處另一張高解析度的陰影：注視點周圍 12 公尺見方、2048 格（一格約 0.6 公分；試過 4096 蓋 16 公尺，內顯每幀多 13 毫秒），人物、柱子的影子才清楚；遠處照舊用大的那張
// 2. 影子的方向不再每一幀跟著太陽轉（每一幀都轉，影子的邊緣每一幀都重新落格，看起來一直在抖）：
//    太陽走了 1 度才換一次，新舊兩組影子用 2 秒淡入淡出（不會一格一格跳）。太陽的光照方向照舊每一幀跟著走
// 做法：四盞不發光（亮度 0）的平行光只負責畫陰影貼圖——遠新、遠舊、近新、近舊；這時太陽本身不投影，
// 它的影子由 sunShadowPlus（上面改的 three.js 著色器）把四張合起來。舊的那兩張只在淡入淡出的那 2 秒裡畫
//    （2026-11-14 起預設改成即時：SH_LIVE。太陽每 5 秒走 1 度，淡入淡出那 2 秒會看到新舊兩個半透明的影子疊在一起，使用者不要；
//      想換回「每 1 度淡換一次」就把 SH_LIVE 改成 false）
const NEAR_SIZES = [2048, 2048, 4096], NEAR_HALVES = [6, 6, 8], SH_STEP = THREE.MathUtils.degToRad(1), SH_FADE = 2, SH_LIVE = true;
let NEAR_SIZE = NEAR_SIZES[gs.shNear], NEAR_HALF = NEAR_HALVES[gs.shNear];   // 近處那張：最高規格 4096 格蓋 16 公尺（一格 0.4 公分）
function shadowOnly(half, size, normalBias) {
  const l = new THREE.DirectionalLight(0xffffff, 0);
  l.castShadow = false; l.visible = false;
  l.shadow.autoUpdate = false;   // 要畫哪幾張由 placeSun 決定（needsUpdate）
  l.shadow.mapSize.set(size, size);
  Object.assign(l.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 460 });
  l.shadow.bias = sun.shadow.bias; l.shadow.normalBias = normalBias; l.shadow.radius = sun.shadow.radius;
  scene.add(l, l.target);   // 加在太陽後面：投影的燈排在前面時，這四盞的順序就是加進去的順序
  return l;
}
const farNew = shadowOnly(SHADOW_HALF, SHADOW_SIZE, sun.shadow.normalBias), farOld = shadowOnly(SHADOW_HALF, SHADOW_SIZE, sun.shadow.normalBias);
const nearNew = shadowOnly(NEAR_HALF, NEAR_SIZE, 0.008), nearOld = shadowOnly(NEAR_HALF, NEAR_SIZE, 0.008);
const SH_LIGHTS = [farNew, farOld, nearNew, nearOld];
const shOld = sunDir.clone();
let shPlus = 0, shWOld = 0, shFresh = true, shOldStale = false;   // shOldStale：剛換方向，舊的那張還是上上次的內容，這一幀一定要重畫
// 用哪一種陰影：0 = 一張、方向每一幀跟著太陽（?noshplus，比較用）；1 = 手機、陰影「低」：遠的新舊兩張淡入淡出；2 = 電腦全套（另加近處的兩張）
// 手機以前是 0：太陽每一幀轉一點點，1024 格的貼圖每一格 8 公分，細的東西（旗桿、樓梯、屋簷）每一幀落格都不一樣，影子一直閃
const wantShPlus = () => (!gfx.shadowOn || /[?&]noshplus/.test(location.search) ? 0 : !TOUCH && gs.shNear > 0 ? 2 : 1);
// 照畫質決定要不要用電腦版的陰影；遠的那兩張跟著陰影的大小、範圍
function syncShadowPlus() {
  const on = wantShPlus();
  // 近處那兩張的大小、範圍跟著設定
  if (gs.shNear > 0 && (NEAR_SIZE !== NEAR_SIZES[gs.shNear] || NEAR_HALF !== NEAR_HALVES[gs.shNear])) {
    NEAR_SIZE = NEAR_SIZES[gs.shNear]; NEAR_HALF = NEAR_HALVES[gs.shNear];
    for (const l of [nearNew, nearOld]) {
      Object.assign(l.shadow.camera, { left: -NEAR_HALF, right: NEAR_HALF, top: NEAR_HALF, bottom: -NEAR_HALF });
      l.shadow.camera.updateProjectionMatrix();
      l.shadow.mapSize.set(NEAR_SIZE, NEAR_SIZE);
      if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; }
    }
  }
  for (const l of [farNew, farOld]) {
    Object.assign(l.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF });
    l.shadow.camera.updateProjectionMatrix();
    if (l.shadow.mapSize.x !== SHADOW_SIZE) {
      l.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
      if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; }
    }
  }
  sun.castShadow = gfx.shadowOn && !on;
  if (on === shPlus) return;
  shPlus = on;
  for (const l of SH_LIGHTS) { const use = on === 2 || (on === 1 && (l === farNew || l === farOld)); l.castShadow = use; l.visible = use; }   // 沒用的整盞藏起來：著色器裡就沒有那幾盞（不多跑空的光照）
  shFresh = true;
  shared.uShadowMap.value = null; shared.uShadowOn.value = 0;
}

// 每一幀：擺好太陽和投影的燈（center：注視點）
function placeSun(center, dt = 0, even = true) {
  if (!shPlus) {
    // ?noshplus（比較用）：影子方向每一幀都跟著太陽，細的東西的影子會一直閃
    shDir.copy(sunDir);
    aimLight(sun, shDir, center, SHADOW_HALF, SHADOW_SIZE);
    renderer.shadowMap.needsUpdate = true;
    return;
  }
  aimLight(sun, sunDir, center, SHADOW_HALF, SHADOW_SIZE);   // 光照方向照舊每一幀跟著走（太陽自己不投影）
  if (shFresh || SH_LIVE) { shDir.copy(sunDir); shWOld = 0; shFresh = false; }   // 即時：影子方向每一幀跟著太陽，沒有新舊兩組疊在一起的殘影
  else if (shWOld > 0) shWOld = shDir.angleTo(sunDir) > SH_STEP * 4 ? 0 : Math.max(0, shWOld - dt / SH_FADE);   // 太陽動得快（時間被調、跟伺服器對時）：不等淡完，免得越落越遠
  else {
    const a = shDir.angleTo(sunDir);
    // 走了 1 度：新的方向從 0 淡進來。一下子差很多（白天換成月亮、時間被調過）就直接換
    if (a > SH_STEP) { shOld.copy(shDir); shDir.copy(sunDir); shWOld = a < 0.3 ? 1 : 0; shOldStale = shWOld > 0; }
  }
  if (shPlus === 1) {
    // 手機：沒在淡的時候遠的那張每一幀畫；淡入淡出的那 2 秒新舊輪流（一幀新、一幀舊），每一幀畫影子的量跟以前一樣
    const fading = shWOld > 0, fresh = !farNew.shadow.map || !farOld.shadow.map;
    if (!fading || even || fresh) { aimLight(farNew, shDir, center, SHADOW_HALF, SHADOW_SIZE); farNew.shadow.needsUpdate = true; }
    if (fading && (!even || fresh || shOldStale)) { aimLight(farOld, shOld, center, SHADOW_HALF, SHADOW_SIZE); farOld.shadow.needsUpdate = true; shOldStale = false; }
    farNew.shadow.intensity = 1; farOld.shadow.intensity = shWOld;
    renderer.shadowMap.needsUpdate = true;
    return;
  }
  // 近的那張每一幀都畫（人物、柱子腳邊的影子靠它）；遠的那張隔一幀畫一次（遠處會動的東西晚一幀跟上看不出來）。
  // 淡出中的舊方向那兩張也是隔一幀（跟遠的錯開）。沒畫的那一幀，貼圖和它的矩陣都是上一次的，兩個對得上
  const fresh = !farNew.shadow.map || !nearNew.shadow.map;
  aimLight(nearNew, shDir, center, NEAR_HALF, NEAR_SIZE);
  nearNew.shadow.needsUpdate = true;
  if (even || fresh) { aimLight(farNew, shDir, center, SHADOW_HALF, SHADOW_SIZE); farNew.shadow.needsUpdate = true; }
  if (shWOld > 0 && (!even || shOldStale || !farOld.shadow.map || !nearOld.shadow.map)) {
    shOldStale = false;
    aimLight(farOld, shOld, center, SHADOW_HALF, SHADOW_SIZE);
    aimLight(nearOld, shOld, center, NEAR_HALF, NEAR_SIZE);
    farOld.shadow.needsUpdate = nearOld.shadow.needsUpdate = true;
  }
  farNew.shadow.intensity = 1; farOld.shadow.intensity = shWOld; nearNew.shadow.intensity = 1; nearOld.shadow.intensity = shWOld;
  renderer.shadowMap.needsUpdate = true;
}
// 自己寫的著色器（海面、地形、草）要的陰影貼圖：每一幀照現在用的是哪一組接上
function shadowUniforms() {
  const tex = (l) => (l.shadow.map ? l.shadow.map.depthTexture : null);
  if (!shPlus) {
    if (sun.shadow.map) { shared.uShadowMap.value = sun.shadow.map.depthTexture; shared.uShadowMat.value = sun.shadow.matrix; shared.uShadowOn.value = 1; }
    shared.uShadowFade.value = 0; shared.uShadowNearOn.value = 0;
    return;
  }
  if (!farNew.shadow.map) return;
  shared.uShadowMap.value = tex(farNew); shared.uShadowMat.value = farNew.shadow.matrix; shared.uShadowOn.value = 1;
  shared.uShadowMapOld.value = tex(farOld); shared.uShadowMatOld.value = farOld.shadow.matrix;
  shared.uShadowFade.value = farOld.shadow.map && (shPlus === 1 || nearOld.shadow.map) ? shWOld : 0;
  // 手機沒有近處那兩張：取樣器還是接一張真的深度貼圖（不用，但空著有的顯示卡會報錯）
  shared.uShadowMapNear.value = tex(nearNew) || tex(farNew); shared.uShadowMatNear.value = nearNew.shadow.matrix;
  shared.uShadowMapNearOld.value = tex(nearOld) || tex(farNew); shared.uShadowMatNearOld.value = nearOld.shadow.matrix;
  shared.uShadowNearOn.value = shPlus === 2 && nearNew.shadow.map ? 1 : 0;
  shared.uShadowTexelNear.value = 1 / NEAR_SIZE;
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
for (const m of terrain.children) m.castShadow = true;

// ---- 雜草 -------------------------------------------------------------------
// 一塊 48 公尺見方的草皮跟著鏡頭走，上面一萬四千叢草；位置、高矮、顏色、隨風擺動都在顯示卡上算。
// 只有鏡頭附近二十公尺左右有立體的草，更遠的地方靠地面的草葉紋理撐著
const GRASS_T = 48;
let grassN = gfx.grass;   // 舊的草皮（沒在用，見 OLD_GRASS）
// 舊的草皮（跟著鏡頭的一大片草）：新島的草是低面的草叢（在港口模型裡），舊的先不畫
const OLD_GRASS = false;
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
  L, heightAt: bedAt, light: LIGHTHOUSE_W,
  // 母港平台周圍和燈塔腳下不種樹（範圍用港座標寫）
  skip: (x, z) => { const [hx, hz] = toLocal(x, z); return (hx > -47 && hx < 28 && hz > 93) || Math.hypot(x - LIGHTHOUSE_W.x, z - LIGHTHOUSE_W.z) < 6; },
  // 港口和進出港的水道不放石頭
  clear: (x, z) => { const [hx, hz] = toLocal(x, z); return (Math.abs(hx) < 75 && hz > 88 && hz < 250) || Math.hypot(x - LIGHTHOUSE_W.x, z - LIGHTHOUSE_W.z) < 7; },
});
addRocks(scenery.rocks);
shade(scenery.group);
scenery.setProxy(!/[?&]hishadow/.test(location.search));   // 精細的樹不投影，由簡化版代替（?hishadow：照舊，比較用）
if (/[?&]noocc/.test(location.search)) scenery.setOccl(false);   // ?noocc：不做「被山擋住不畫」，比較用
sun.shadow.camera.layers.enable(SHADOW_LAYER);   // 陰影貼圖也畫只投影用的那一層
for (const l of SH_LIGHTS) l.shadow.camera.layers.enable(SHADOW_LAYER);
scene.add(scenery.group);
// 景物（兩千多棵樹、石頭、燈塔）擺好就不會動：位置矩陣算一次就好，不用每一趟繪製都全部重算（燈塔的光束會轉，照舊）。
// 場景本身也不會動：它每次重算的話，底下每個物件都會被逼著跟著重算
scene.matrixAutoUpdate = false;
scenery.group.updateMatrixWorld(true);
scenery.group.traverse((o) => { o.matrixAutoUpdate = false; });
scenery.beam.traverse((o) => { o.matrixAutoUpdate = true; });

const harbor = placeInHome(makeHarbor());   // 港口（連同整座島的低面地形、樹、岩石）用港座標蓋，整個擺進世界
// 島的地形改由港口那一份低面模型畫：海床的高度圖只拿來算浪、走路、擱淺，舊的地形網格不畫
terrain.visible = false;
scenery.lighthouseMesh.visible = false;   // 舊的燈塔模型（新的白燈塔在港口模型裡；晚上的光束還用舊的那一組）
worldizeHarborLists();   // 樁、消波塊、繫纜樁、路燈的清單轉成世界座標
scene.add(harbor);
addRocks(HARBOR_ROCKS);   // 消波塊
shade(harbor);

// 探險大港灣島和海上的礁石群（石拱門、環礁、燈標岩嶼）：跟港口用同一個低面材質
const seascape = makeSeascape(harbor.userData.lowpolyMat, { uniforms: shared, paintSky: !!shared.uCloudMap.value });
for (const g of seascape.groups) { scene.add(g); g.updateMatrixWorld(true); g.traverse((o) => { o.matrixAutoUpdate = false; }); }
addRocks(seascape.rocks);
// 大港海岬大燈塔的旋轉光束：跟母港燈塔同一套（同一個材質，亮度一起調）
const havenBeam = scenery.beam.clone();
havenBeam.position.set(seascape.havenLamp.x, seascape.havenLamp.y, seascape.havenLamp.z);
havenBeam.visible = false;
scene.add(havenBeam);
BOLLARDS.push(...seascape.bollards);   // 大港碼頭、海上修船屋的繫纜樁接在母港的後面（編號不變）
UNLIT.push(...seascape.unlit);         // 修船屋、大港的招牌和價格牌：晚上跟著變暗
// 透天洞穴：海面的著色器要知道洞在哪（洞裡的水面壓暗、天窗底下亮一圈）
{
  const [cx, cz] = HAVEN.toWorld(CAVE.x, CAVE.z), [ex, ez] = HAVEN.toWorld(CAVE.x + CAVE_AXIS[0], CAVE.z + CAVE_AXIS[1]);
  shared.uCave = { value: new THREE.Vector4(cx, cz, CAVE.r, CAVE.sky.r) };
  shared.uCaveDoor = { value: new THREE.Vector4(ex - cx, ez - cz, CAVE.face, CAVE.door.half) };
}
// 人在不在洞裡（in）、在洞裡多深（k：0 洞外 … 1 洞裡，慢慢變）、頭上是不是天窗、鏡頭是不是在淋不到雨的地方：洞裡的光要暗、雨要停
const caveState = { in: false, k: 0, sky: 0, dry: 0 };
function updateCave(dt) {
  const e = 1 - Math.exp(-dt * 3), [px, pz] = havenToLocal(player.x, player.z), cp = camera.position, [qx, qz] = havenToLocal(cp.x, cp.z);
  const inside = nearCave(px, pz) && caveUnder(px, pz, player.y + 0.5) !== null;
  caveState.in = inside;
  caveState.k += ((inside ? 1 : 0) - caveState.k) * e;
  caveState.sky += ((inside && caveCeil(px, pz) === Infinity ? 1 : 0) - caveState.sky) * e;
  caveState.dry += ((nearCave(qx, qz) && caveUnder(qx, qz, cp.y) !== null && caveCeil(qx, qz) !== Infinity ? 1 : 0) - caveState.dry) * e;
}

// 山澗小河：人踩進河道就被水沖著往下滑——順著河道走、慢慢被帶回河中間，一路滑過瀑布，最後從天窗的缺口掉進深潭。
// 人離開河床後由 player.js 保留離開時的水平速度，不再每幀施加水流推力。
// 下大雨時小河暴漲（flood：漲了幾成）：水面抬高、流得更急更濁，沖人也更快；雨停了慢慢退。數字在 havenPlan.js 的 RIVER.flood
let riverOn = false, flood = 0, floodTest = null;
function riverRide(dt) {
  if (player.boat || drown || player.fly) { riverOn = false; player.flowVX = player.flowVZ = 0; return; }
  const [vx, vz] = havenToLocal(player.x, player.z), q = riverAt(vx, vz), air = player.h > 0, R = RIVER.slide;
  riverOn = !!q && q.s > R.from && q.d < RIVER.flat + (riverOn && air ? 3 : 0.3) && player.y < q.y + (riverOn ? 14 : 0.9) && player.y > q.y - 2.5;
  if (!riverOn || air) { player.flowVX = player.flowVZ = 0; return; }
  const sp = R.speed * (1 + RIVER.flood.push * flood), lx = q.tx * sp + q.tz * q.lat * R.center, lz = q.tz * sp - q.tx * q.lat * R.center;
  const [ax, az] = HAVEN.toWorld(vx, vz), [bx, bz] = HAVEN.toWorld(vx + lx, vz + lz);
  walker.feet = player.y; walker.air = air;
  player.riverDrift(bx - ax, bz - az, dt, walkWorld);
  walker.feet = null;
}

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
function addBoat(type, pose) {
  const b = new Boat(type, pose.x, pose.z, pose.heading);
  boats.push(b);
  scene.add(b.mesh);
  shade(b.mesh);
  addOutline(b.mesh);
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
// ---- 漁會、等級、船隊、拖船、副駕：都是伺服器說了算，這裡只是照著顯示（處理見後面「漁會、等級、船隊」那一段） ----
// 船隊：id 我在哪一隊、ids 同隊的人（不含自己）、of 整間房誰在哪一隊、info 每隊的隊名／隊長／開放申請、lfg 在找船隊的人、applied 我剛申請的那一隊
const party = { id: 0, ids: new Set(), of: {}, info: {}, lfg: new Set(), applied: null, has: (id) => party.ids.has(id) };
let guild = null;                                       // 漁會這一週：{ amount 我捐了多少, rank 第幾名, titles 能戴的稱號, wear 戴著哪個, endsAt 幾時重置, min }
let myBadge = { title: '', gold: false, lv: 1 }, myExp = 0;   // 自己的稱號、等級、總經驗
let tows = [];                                          // 拖纜：[{ tug 拖船的船主, tow 被拖的船主 }]（玩家 id）
let copilot = null;                                     // 我正在幫隊友開的那艘船：{ id 船主, boat }（那艘船的物理改在我這邊算）
let piloted = null;                                     // 我的船正被隊友開著：{ id, name }（我的船改照他傳來的位置擺）

// ---- 多人：連線、同房的其他人、聊天室、看板 ----
const net = new Net();
const boards = new Boards();   // 魚市場前的停船位置牌和兩塊排行榜
placeInHome(boards.group);
scene.add(boards.group, boards.haven);   // haven：大港榮譽榜亭裡的第二組
shade(boards.group);
shade(boards.haven);
let renderRemoteTab = null;
const others = new Others({
  scene,
  decorate: (m) => { shade(m); addOutline(m); },
  makeBoat: addBoat, dropBoat,
  boatOf: (id) => (id === net.id ? myBoat : others.boat(id)),
  updateTablet: (o, tab) => renderRemoteTab?.(o, tab),
});
const chat = new Chat({
  send: (text, ch) => net.send({ t: 'chat', text, ...(ch === 'party' ? { ch } : {}) }),
  onOpen() { for (const k in keys) keys[k] = false; closeWheel(false); syncAim(); },
  onClose() {},
});
let room = { id: 0, name: '', max: 30 };

const player = new Player(SPAWN_W.x, SPAWN_W.z, SPAWN_W.yaw);
// 人所在位置的水面高度。浪高每幀只向 GPU 讀一次（讀人腳下那一點），周圍幾步之內共用
let swimWave = 0;
// 人在水裡時，直接量人腳下那一點畫出來的水面（岸邊捲上來的浪、長浪、巨浪都算到），人才會跟著畫面上的浪起伏；量不到才用下面的估算
const surfProbe = makeSurfaceProbe(renderer, { uniforms: shared, defines: () => water.material.defines, lite: LITE_SEA, floatRT: ocean.floatRT, camera: ocean.cam });
function playerWater(x, z) {
  const ph = surfProbe.at(x, z);
  if (ph !== null) return ph;
  const d = -bedAt(x, z);
  const near = clamp(1 - d / 2.5, 0, 1);   // 岸邊沖上來的水（取平均高度）
  return swimWave * clamp((d - 0.3) / 7.7, 0, 1) * waveK(x, z) + tsuAt(x, z)
    + 0.2 * clamp(shelterAt(x, z) * shoreSea(ocean.scale, sea.storm, sea.surge) / 1.3, 0.18, 1.5) * near * near * (3 - 2 * near);
}
// 每艘船都可以直接走上去；水深過胸就浮起來游
const walkWorld = { ground: walkGround, water: playerWater, boats };
player.place(walkWorld, SPAWN_W.x, SPAWN_W.z);
scene.add(player.mesh);
shade(player.mesh);
addOutline(player.mesh);
// 人物腳下貼地的暗影：站在岸壁、船上時是一片貼在腳下的圓；站在島上時由地形的著色器畫（斜坡上才不會穿幫）
// 陰影全關時（沒有任何影子）：不管站在哪裡，自己和別人腳下都畫這一圈（地形那邊不畫，免得疊兩層），跳起來留在地上、變淡，斜坡上貼著坡面
const footBlob = (mesh) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: softDisc(), color: 0x121a30, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.position.y = 0.03;
  m.castShadow = m.receiveShadow = false;
  m.userData.noHull = true;
  mesh.add(m);
  return m;
};
const blob = footBlob(player.mesh);
// 陰影全關時用的圓影：比貼地暗影（softDisc，很淡、邊緣拉得很開）實一點，一眼看得出是一圈影子，邊緣仍是柔的
const FOOT_DISC = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  [[0, 1], [0.6, 0.95], [0.8, 0.6], [0.94, 0.14], [1, 0]].forEach(([t, a]) => gr.addColorStop(t, `rgba(255,255,255,${a})`));
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const SOFT_DISC = blob.material.map;
const BLOB_UP = new THREE.Vector3(0, 1, 0), _bn = new THREE.Vector3(), _bq = new THREE.Quaternion();
// 陰影全關時擺一個人腳下的圓影：h 離地多高；onBoat 在船上（甲板是平的，不必貼坡）
function placeFootBlob(m, mesh, x, z, h, onBoat) {
  const lift = clamp(1 - h / 1.2, 0, 1);
  m.visible = lift > 0.02;
  m.position.y = 0.03 - h;
  m.material.opacity = 0.75 * lift;
  m.material.map = FOOT_DISC;
  m.scale.setScalar(0.72);   // 一圈約 90 公分：比肩膀寬一點
  m.quaternion.identity();
  if (onBoat) return;
  // 斜坡：照腳下左右前後的地面高低把圓片斜過去（落差太大是牆、棧板邊，就不斜）
  const gx = (walkGround(x + 0.3, z) - walkGround(x - 0.3, z)) / 0.6, gz = (walkGround(x, z + 0.3) - walkGround(x, z - 0.3)) / 0.6;
  if (!(Math.abs(gx) < 1.2 && Math.abs(gz) < 1.2)) return;
  _bn.set(-gx, 1, -gz).normalize();
  m.quaternion.setFromUnitVectors(BLOB_UP, _bn).premultiply(_bq.copy(mesh.quaternion).invert());
}

const spray = new Spray(3000, shared);
// 雨點打在地上的小皇冠和積水上的漣漪：只有電腦有（手機只有細水滴）。掛在 spray 底下，畫倒影時跟著一起藏
const rainSplash = TOUCH ? null : makeRainSplash(shared, spray.material.uniforms.uScale);
if (rainSplash) spray.points.add(rainSplash.group);
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
const lampSlots = lampLights.map(() => ({ at: null, k: 0 }));   // 這盞燈現在借給修船屋／大港的哪一盞（見每幀調燈的地方）
const boatLight = new THREE.PointLight(0xffb866, 0, 15, 1.3);
// 室內燈（店裡、魚市場）：電腦版放真的光源照亮室內；手機不放（harbor.js 用地上的光暈代替）。開關整間房共用，跟時間無關
const roomLights = TOUCH ? [] : ROOM_LAMPS.map((p) => {
  const l = new THREE.PointLight(0xffc27a, 0, p.zone === 'shop' ? 10 : 8, 1.3);
  const [x, z] = toWorld(p.x, p.z);
  l.position.set(x, p.y, z);
  l.userData.zone = p.zone;
  scene.add(l);
  return l;
});
function applyRoomLights(state) {
  setRoomLights(state);
  for (const l of roomLights) l.intensity = ROOM_LIGHTS[l.userData.zone].on ? (l.userData.zone === 'shop' ? 13 : 10) : 0;
}
applyRoomLights({});
const rain = new Rain();
rain.setRoofs(ROOFS_W);
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
  // 濺起來的是一顆顆大小不一的水滴（少數大的、多數小的），往上衝再落回去
  for (let i = 0; i < n * 3; i++) {
    const a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * 1.4;
    spray.emit(x, y, z, Math.cos(a) * r, 1.5 + Math.random() * 2.5, Math.sin(a) * r, 0.4 + Math.random() * 0.5, 0.12 + Math.random() ** 2 * 0.4);
  }
}
// 某處是不是可以拋竿的水面（不是岸、不是棧板、不是船上）
function isWater(x, z) {
  if (riverLevel(x, z) !== null) return true;   // 山上的小河、湧泉池也可以釣
  if (bedAt(x, z) > -0.6 || onDeck(x, z, 0.2)) return false;
  return !boats.some((b) => { const l = b.toLocal(x, z); return b.deckContains(l.x, l.z); });
}
const waterY = (x, z) => ocean.sampleHeight(x, z) * clamp((-bedAt(x, z) - 0.3) / 7.7, 0, 1) * waveK(x, z) + tsuAt(x, z);

const fish = new FishWorld({
  player, boats, scene, ground: walkGround, splash, toast, basket: SELL_W.basket,
  lowHold: () => view.walk.fp,   // 第一人稱：提著的桶子放低（不然擋掉半個畫面）
  waveAt: (x, z) => ocean.sampleCached(x, z) * waveK(x, z) + tsuAt(x, z),
  onLost: (uids) => net.send({ t: 'fishGone', uids }),   // 魚掉回海裡、跟著船沉了：告訴伺服器這幾條沒了
  boxOver: (x, z, it) => boxes.over(x, z, it),   // 丟出去的魚從口掉進魚箱（誰的都可以：丟進別人的就是送給他）
  intoBox(it, bid) {   // 掉進魚箱了：請伺服器放進去；伺服器說不行就擺回箱子旁邊（見 boxNo）
    pendingIn.set(it.uid, { it, bid });
    if (net.online) net.send({ t: 'boxIn', bid, uid: it.uid }); else boxBounce(it.uid, '連線中斷');
  },
  flyGround,
  // 自己的魚放在外面了：告訴伺服器放在哪（大家都看得到、誰都撿得走）。放在倉庫的船上（別人看不到）就當作收回來
  placed(it) {
    if (!net.online) return;
    const base = { t: 'put', uid: it.uid, yaw: r2(it.yaw) };
    if (it.state === 'basket') { const p = it.mesh.position; return net.send({ ...base, k: 'b', x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(it.mesh.rotation.z) }); }
    if (it.state === 'boat') {
      const b = boatOwner(it.boat);
      if (b === null) { it.pub = false; return net.send({ t: 'take', uid: it.uid }); }
      return net.send({ ...base, k: 'd', b, x: r2(it.lx), y: 0, z: r2(it.lz) });
    }
    net.send({ ...base, k: 'g', x: r2(it.x), y: r2(it.y), z: r2(it.z) });
  },
  taken: (it) => net.online && net.send({ t: 'take', uid: it.uid }),
  boatOf: (id) => (id === net.id ? myBoat : others.boat(id)),
  landed(it, where, pos) {   // 丟出去的東西落地了：where = deck / ground / basket / box / water
    if (where === 'basket') refreshBoard(it);
    // 誘魚桶丟進海裡：施放（伺服器說不行的話，桶子會回到船上，見 syncChums）
    if (it.chum && where === 'water') { if (net.online) net.send({ t: 'useChum', x: r2(pos.x), z: r2(pos.z) }); else window.setTimeout(syncChums, 0); }
    audio.play(where === 'water' ? 'plop' : 'drop', 1, pos);
  },
});
// 魚箱：照伺服器傳來的狀態畫（抱在誰手上、放在哪、裡面有什麼）；怎麼動都由伺服器決定
const boxes = new BoxWorld({
  scene,
  figureOf: (id) => (id === net.id ? player.mesh : others.map.get(id)?.fig?.mesh ?? null),
  boatOf: (id) => (id === net.id ? myBoat : others.boat(id)),
  waveAt: (x, z) => ocean.sampleCached(x, z) * waveK(x, z) + tsuAt(x, z),
});
const pendingIn = new Map();   // 丟進魚箱、還在等伺服器回話的魚：uid → { it, bid }
// 自己抱著的箱子
const heldBox = () => (inGame && net.id ? boxes.held(net.id) : null);
// 丟進箱子卻放不進去：擺回箱子旁邊的地上（或甲板上）
function boxBounce(uid, msg) {
  const w = pendingIn.get(uid);
  if (!w) return;
  pendingIn.delete(uid);
  const d = boxes.get(w.bid), p = d ? boxes.worldPos(d) : new THREE.Vector3(player.pos.x, player.pos.y, player.pos.z);
  const s = fish._spot(p.x + 0.9, p.z), it = w.it;
  if (s && s !== 'water' && s.boat) fish._toBoat(it, s.boat, s.lx, s.lz);
  else fish._toGround(it, s && s !== 'water' ? p.x + 0.9 : player.pos.x, s && s !== 'water' ? p.z : player.pos.z);
  if (msg) toast(msg);
}
// 把抱著的箱子放下：面前、腳邊；面前是海就讓它浮著（water：直接放在腳下的水面，游泳時用）
let boxSent = 0;
function putBoxDown(d, water = false) {
  if (!net.online) return toast('連線中斷，等接回去再放');
  if (performance.now() - boxSent < 700) return;
  const fx = Math.cos(player.yaw), fz = Math.sin(player.yaw);
  let msg = null;
  for (const dd of water ? [0] : [0.95, 0.55, 0]) {
    const x = player.pos.x + fx * dd, z = player.pos.z + fz * dd, s = water ? 'water' : fish._spot(x, z);
    if (!s) continue;
    if (s === 'water') { msg = { k: 'w', x, y: 0, z, yaw: player.yaw }; break; }
    if (s.boat) {
      const o = boatOwner(s.boat);
      if (o === null || Math.abs((s.boat.walkDeckY?.(x, z) ?? s.boat.deckY(x, z)) - player.pos.y) > 0.9) continue;
      msg = { k: 'd', b: o, x: s.lx, y: 0, z: s.lz, yaw: player.yaw - s.boat.heading };
      break;
    }
    const y = walkGround(x, z);
    if (Math.abs(y - player.pos.y) > 0.9) continue;
    msg = { k: 'g', x, y, z, yaw: player.yaw };
    break;
  }
  if (!msg) return toast('這裡放不下');
  boxSent = performance.now();
  net.send({ t: 'boxPut', bid: d.bid, ...msg, x: r2(msg.x), y: r2(msg.y), z: r2(msg.z), yaw: r2(msg.yaw) });
}
// 手上的魚放進對準的箱子
function fishIntoBox(d) {
  const it = fish.held, why = boxes.fit(d, it.id, it.len), what = d.h ? '魚艙' : '魚箱';
  if (why) return toast(why === 'long' ? `這條${it.sp.name}太大，放不進${what}` : `${what}滿了`);
  if (!net.online) return toast('連線中斷，等接回去再放');
  net.send({ t: 'boxIn', bid: d.bid, uid: it.uid });
}
function boxInText(d) {
  const it = fish.held, why = boxes.fit(d, it.id, it.len), what = d.h ? '魚艙' : '魚箱';
  if (why) return why === 'long' ? `這條${it.sp.name}太大，放不進${what}` : `${what}滿了`;
  return d.o === net.id ? `按 E 放進${what}（已經 ${Math.round(boxes.used(d) * 100)}% 滿）` : `按 E 放進 ${others.map.get(d.o)?.name ?? '別人'} 的${what}（等於送給他）`;
}
// ---- 魚艙（前甲板的艙口）：艙蓋船主和隊友都能開關；開著才放得進、拿得出 ----
const hatchMine = (d) => d.o === net.id || party.has(d.o);
const hatchWho = (d) => (d.o === net.id ? '' : `${others.map.get(d.o)?.name ?? '別人'} 的`);
function hatchLid(d, open) {
  if (!hatchMine(d)) return toast(`這是 ${others.map.get(d.o)?.name ?? '別人'} 的魚艙，只有船主和他的隊友能開`);
  if (!net.online) return toast('連線中斷，等接回去再試');
  audio.play('drop');
  net.send({ t: 'hatchLid', bid: d.bid, open });
}
// 抱著魚箱對著自己打開的魚艙：箱子有魚就倒進去，空箱子就從艙裡裝滿
function hatchPour(d) {
  if (d.o !== net.id) return toast('只能倒進自己的魚艙（魚可以一條一條放進隊友的魚艙）');
  if (!d.open) return toast('艙蓋關著：先放下魚箱，把艙蓋打開');
  if (!net.online) return toast('連線中斷，等接回去再試');
  net.send({ t: 'hatchPour', bid: d.bid });
}
function hatchText(d) {
  const n = d.fish.length, fill = `${n} 條、${Math.round(boxes.used(d) * 100)}% 滿`;
  if (!hatchMine(d)) return `${hatchWho(d)}魚艙（${d.open ? `${n} 條` : '艙蓋關著'}）`;
  return d.open ? `按 E 蓋上${hatchWho(d)}艙蓋（魚艙 ${fill}）` : `按 E 打開${hatchWho(d)}艙蓋（魚艙 ${fill}）`;
}
// 送東西給對準的人（what：{ uid } 手上的魚、{ bid } 抱著的箱子），對方要按接受
function giveTo(a, what) {
  if (!net.online) return toast('連線中斷，等接回去再送');
  net.send({ t: 'give', to: a.pid, ...what });
}

// 釣魚：這裡只管手感和畫面。魚什麼時候咬、是哪條、多大、值多少、算不算釣起來，都由伺服器決定
const fishing = new Fishing({
  player, scene, isWater, surfaceY: (x, z) => { const r = riverLevel(x, z); return r === null ? waterY(x, z) : r + RIVER.flood.rise * flood; }, splash, toast,
  net: {
    cast: (x, z) => net.send({ t: 'cast', x: r2(x), z: r2(z) }),
    hook: () => net.send({ t: 'hook' }),
    earlyPull: () => net.send({ t: 'earlyPull' }),
    miss: () => net.send({ t: 'miss' }),
    land: () => { if (net.online) { landing = true; net.send({ t: 'land' }); } else toast('連線中斷，這條魚沒算到'); },
    lose: (why) => net.send({ t: 'lose', why }),
  },
  canFish: () => inGame && net.online && !landing && mode === 'walk' && !fish.held && !heldBox() && !player.swim,
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
function refreshBoard(last = fish.basket[fish.basket.length - 1]) {
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

// 船艙裡不畫海面（renderShaders.js 的 hullCutGlsl）：離鏡頭最近的 CUT_N 艘還沒進水的船，交出「世界 → 船」的矩陣和船殼尺寸。
// 用船這一幀的位置、姿態現算（不等場景更新矩陣），船開得快時挖掉的範圍才不會落後一幀
const _cutQ = [];
function syncHullCut() {
  _cutQ.length = 0;
  const cp = camera.position;
  for (const b of boats) if (b.dry && b.mesh.parent && b.mesh.visible) _cutQ.push(b);
  if (_cutQ.length > CUT_N) _cutQ.sort((p, q) => p.mesh.position.distanceToSquared(cp) - q.mesh.position.distanceToSquared(cp));
  const M = shared.uCutM.value, A = shared.uCutA.value, B = shared.uCutB.value, C = shared.uCutC.value;
  for (let i = 0; i < CUT_N; i++) {
    const b = _cutQ[i];
    if (!b) { A[i].set(0, 0, 0, 0); continue; }
    M[i].compose(b.mesh.position, b.mesh.quaternion, b.mesh.scale).invert();
    C[i].copy(cp).applyMatrix4(M[i]);   // 鏡頭在船的座標裡：隔著船艙口看到的海也不畫
    hullCutDims(b.spec, A[i], B[i]);
  }
}

// ---- 水面倒影：用鏡像相機把水面以上的物體畫到貼圖 ---------------------------
// 抗鋸齒：場景先畫到緩衝區，轉成螢幕顏色後再做一次邊緣平滑（SMAA，比 FXAA 認邊認得準，細線不會糊成一團）。
// 水邊、泡沫這些用著色器切出來的邊緣也一併處理。多重取樣（MSAA）在內顯上每幀多 5 毫秒以上，只放在「高」畫質（見 applyGfx）
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
// 光暈的輸入先把壞掉的像素（NaN、無限大）丟掉：只要畫面上有一點 NaN，模糊一層層擴散後整個畫面（或一大半）都會變成透明，露出網頁底色
bloom.materialHighPassFilter.fragmentShader = bloom.materialHighPassFilter.fragmentShader.replace('vec4 texel = texture2D( tDiffuse, vUv );',
  'vec4 texel = texture2D( tDiffuse, vUv ); texel = clamp( texel, vec4( 0.0 ), vec4( 64.0 ) ); if ( texel.r != texel.r || texel.g != texel.g || texel.b != texel.b || texel.a != texel.a ) texel = vec4( 0.0 );');
composer.addPass(rays);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const aimOutline = new AimOutlinePass(scene, camera);
composer.addPass(aimOutline);
composer.addPass(new SMAAPass());

const reflRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true });
shared.uReflTex.value = reflRT.texture;
const vcam = new THREE.PerspectiveCamera();
const UP = new THREE.Vector3(0, 1, 0);
const _rp = new THREE.Vector3(), _cw = new THREE.Vector3(), _vp = new THREE.Vector3();
const _look = new THREE.Vector3(), _tg = new THREE.Vector3(), _rot = new THREE.Matrix4();
const _cc = new THREE.Color();
// 平常也留一個裁切平面（放在一千萬公尺外，什麼都切不到）：倒影那一趟要切掉水面下的東西，
// 裁切平面的數量兩趟要一樣，不然每個材質每一幀都要在兩種程式之間換來換去（手機上每幀多花好幾毫秒）
const clipOn = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)], clipOff = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e7)];
renderer.clippingPlanes = clipOff;
const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

let reflTick = 0, drawCount = 0;
function renderReflection(under, turn = true) {
  const alt = camera.position.y;
  const on = !under && alt > 0.3 && alt < 700 && gfx.refl && !LITE_SEA;   // 設定裡可以關掉海面倒影；手機版的海面不映倒影（整個場景少畫一遍）
  if (!on) { shared.uReflOn.value = 0; reflTick = 0; return; }
  // 隔一幀才重畫一次倒影；沒重畫的那幀沿用上一幀的貼圖與投影矩陣
  if (!turn && reflTick > 0) return;
  reflTick++;
  shared.uReflOn.value = 1;

  camera.updateMatrixWorld();
  _rp.set(0, tideNow, 0);   // 鏡面跟著潮汐的海平面
  clipOn[0].constant = -tideNow;
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

  const sprayOn = spray.points.visible;
  water.visible = false; sky.visible = false; spray.points.visible = false;
  const rainOn = rain.lines.visible, driftOn = spindrift.mesh.visible;
  rain.lines.visible = false; spindrift.mesh.visible = false;
  scenery.update(camera.position, true, gfx.far);   // 倒影裡的樹和石頭用簡化版，雨省略
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
  water.visible = true; sky.visible = true; spray.points.visible = sprayOn;
  rain.lines.visible = rainOn; spindrift.mesh.visible = driftOn;
  scenery.update(camera.position, false, gfx.far);
  grass.visible = OLD_GRASS && gfx.grass > 0;
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

  const sprayOn = spray.points.visible;
  water.visible = false; sky.visible = false; spray.points.visible = false;
  const rainOn = rain.lines.visible, driftOn = spindrift.mesh.visible;
  rain.lines.visible = false; spindrift.mesh.visible = false;
  scenery.update(camera.position, true, gfx.far);
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
  shared.uReflPass.value = 0; shared.uReflY.value = tideNow;
  water.visible = true; sky.visible = true; spray.points.visible = sprayOn;
  rain.lines.visible = rainOn; spindrift.mesh.visible = driftOn;
  scenery.update(camera.position, false, gfx.far);
  grass.visible = OLD_GRASS && gfx.grass > 0;
}
let deckReady = false;

// ---- 玩家狀態與鏡頭 ---------------------------------------------------------
// mode：'walk' 用走的（陸地、棧道、船的甲板）；'helm' 握著方向盤掌舵。每種狀態各自記住視角。
// yaw / pitch 是視線方向（pitch 負值 = 往下看）；掌舵時 yaw 相對於船首。
let mode = 'walk';
const view = {
  walk: { fp: false, yaw: SPAWN_W.yaw, pitch: -0.25, dist: 9 },
  helm: { fp: true, yaw: 0, pitch: -0.04, dist: 22 },
  sink: { fp: false, yaw: 0.7, pitch: -0.28, dist: 24 },   // 船沉的時候從旁邊看著它
};
const DIST = { walk: [3, 45], helm: [10, 120], sink: [10, 60] };
const target = new THREE.Vector3();   // 鏡頭注視點（海面網格也以它為中心）
let camHeading = boat.heading;        // 第三人稱跟船時，鏡頭慢半拍跟上船首
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);

function applyViewSettings() {
  const v = view[mode];
  camera.near = v.fp ? 0.25 : 1;
  camera.fov = v.fp ? gfx.fov + 18 : gfx.fov;   // 鏡頭視角在設定的「畫質」頁調（預設 50，第一人稱寬 18 度）
  player.mesh.visible = mode === 'walk';
  player.setFirstPerson(mode === 'walk' && v.fp);
  myBoat.setManned(mode === 'helm' && boat === myBoat, v.fp);
  if (copilot) copilot.boat.setManned(mode === 'helm' && boat === copilot.boat, v.fp);
  $('hSpeed').style.display = mode === 'helm' ? 'inline-flex' : 'none';
  syncAim();
  onResize();
}

// 第一人稱：畫面中央有準心，滑鼠游標收起來（鎖在畫面裡，直接移動就轉視角）。
// 按 Esc 會放開滑鼠（要去點設定的時候），再點一下畫面就鎖回去；看地圖、打開設定、切回第三人稱時自動放開
// （設定開著時不鎖：以前在設定裡改畫質、視角會順手把滑鼠鎖回去，游標就不見了）
// 只有第一人稱顯示畫面中央準心；第三人稱隱藏準心（改由綠框＋互動提示顯示目前選中的物件，滑鼠照舊拖曳不鎖）
let tablet = null;   // 平板（下面「平板」那一段建出來）：拿出來的時候遊戲的按鍵不動、滑鼠放開
const tabOpen = () => !!tablet && tablet.open;
const lookAllowed = () => inGame && !tabOpen() && !chat.isOpen && !$('panel').open && !feedbackOpen();
const aiming = () => lookAllowed() && mode !== 'sink' && view[mode].fp;
const crosshair = () => !tabOpen() && !feedbackOpen() && !!view[mode]?.fp;
const locked = () => document.pointerLockElement === canvas;
function grabMouse() {
  if (TOUCH || locked() || !canvas.requestPointerLock) return;
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* 瀏覽器不給鎖就算了，照舊按住拖曳 */ }
}
function syncAim() {
  clearMouseDrag();
  $('aim').style.display = crosshair() ? 'block' : 'none';
  if (aiming()) grabMouse();
  else if (locked()) document.exitPointerLock();
}

function toggleFp() {
  if (mode === 'sink') return;
  const v = view[mode];
  v.fp = !v.fp;
  clampLookPitch(v);
  if (mode === 'helm') {
    // 兩個視角用的船首方向不同：切換時先換算成同一個世界朝向。
    v.yaw += v.fp ? camHeading - boat.heading : boat.heading - camHeading;
    const yaw = Math.atan2(Math.sin(v.yaw), Math.cos(v.yaw));
    v.yaw = v.fp ? clamp(yaw, -2.7, 2.7) : yaw;
  }
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
      if (o.material === harbor.userData.lowpolyMat) return;   // 港口的低面模型太細（十幾萬個三角形）：鏡頭改用它附的簡單擋牆（camProxy）
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      o.geometry.boundingBox.getSize(size).multiply(sc.setFromMatrixScale(o.matrixWorld));
      const d = [size.x, size.y, size.z].sort((p, q) => q - p);
      if (d[1] >= 1.0) camBlockers.push(o);   // 至少有兩個方向超過一公尺：是一個「面」，不是一根桿子
    });
  }
}
// ---- 港口合併成少數幾塊 ---------------------------------------------------------
// 港口是六百多個小零件（木板、樁、箱子、屋頂、欄杆），一個一個送去畫，光是送指令每幀就要十幾毫秒的 CPU，
// 陰影和倒影還各要再送一次；手機的 CPU 慢，這是最拖的地方。不會動的零件照材質（外觀一樣的算同一種）合併成一塊，
// 剩兩百個左右。不合併的：半透明的、藏起來的（晚上才出現的光圈）、會改顏色或換字的材質（窗戶、招牌、價格牌）、
// 鏡像擺放的、底下還掛著東西的。鏡頭的遮擋判斷（camBlockers）在上面已經用原本的零件建好，不受影響
{
  harbor.updateMatrixWorld(true);
  const keep = new Set([...GLOW, ...UNLIT, ...GLOW_KEEP]);
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
    const geo = mergeGeometries(list.map((o) => {
      const g = o.geometry.clone(); g.morphAttributes = {}; g.clearGroups();
      // 程式貼圖記的紋路方向（aSurf 的後三個數）也要跟著轉（applyMatrix4 只轉位置和法線）
      const sf = g.attributes.aSurf;
      if (sf) { const nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld), v = new THREE.Vector3(); for (let i = 0; i < sf.count; i++) { v.set(sf.getY(i), sf.getZ(i), sf.getW(i)).applyMatrix3(nm); sf.setXYZW(i, sf.getX(i), v.x, v.y, v.z); } }
      return g.applyMatrix4(o.matrixWorld);
    }));
    if (!geo) continue;
    const m = new THREE.Mesh(geo, list[0].material);
    m.castShadow = list[0].castShadow; m.receiveShadow = list[0].receiveShadow;
    m.applyMatrix4(inv);
    harbor.add(m);
    for (const o of list) o.removeFromParent();
  }
  // 陰影用不到材質：所有不會動、會投影的零件再合成一整塊「只投影」的網格（只在陰影那一層畫），
  // 原本的零件就不投影了。陰影一模一樣，畫陰影時從一百多次縮成一次
  harbor.updateMatrixWorld(true);
  const casters = [];
  harbor.traverse((o) => {
    if (!o.isMesh || !o.castShadow || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.material.transparent) return;
    if (o.children.length || !o.frustumCulled || o.morphTargetInfluences || !shown(o) || keep.has(o.material) || o.material.alphaTest > 0) return;
    if (o.customDepthMaterial || o.matrixWorld.determinant() < 0) return;
    casters.push(o);
  });
  const geo = mergeGeometries(casters.map((o) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', o.geometry.attributes.position.clone());
    if (o.geometry.index) g.setIndex(o.geometry.index.clone());
    return (g.index ? g.toNonIndexed() : g).applyMatrix4(o.matrixWorld);
  }));
  if (geo) {
    const proxy = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    proxy.layers.set(SHADOW_LAYER);
    proxy.castShadow = true;
    proxy.applyMatrix4(inv);
    harbor.add(proxy);
    for (const o of casters) o.castShadow = false;
  }
}

// 鏡頭要退到哪裡才不被擋，分兩步：
// 一、從人的頭往鏡頭看出去，中間有東西就把鏡頭拉到它前面。不只看正中間那一條線，
//     鏡頭的上下左右各多看一條：屋簷的邊角就算沒擋到正中間，也不會蓋住半個畫面。
// 二、頭沒被擋住，鏡頭的位置也可能很糟：懸在雨棚、屋頂正上方不到兩公尺，棚頂就鋪滿下半個畫面。
//     這種位置（腳下貼著一片架高的面，或往人的腳看過去、近處就被擋住）也不能停，再往人這邊找
const camRay = new THREE.Raycaster();
// 透天洞穴的洞壁：沿著這條線（從 o 往 d 方向、長 len）半公尺半公尺往外找，第一次碰到岩石的地方離 o 多遠（沒碰到 = Infinity）。
// 照洞穴的算式算，不拿模型去試（太慢）
function caveSight(o, d, len) {
  const [ax, az] = havenToLocal(o.x, o.z), [bx, bz] = havenToLocal(o.x + d.x * len, o.z + d.z * len);
  const rock = (t) => caveRock(ax + (bx - ax) * t / len, o.y + d.y * t, az + (bz - az) * t / len);
  for (let t = 0.5; ; t += 0.5) {
    const far = Math.min(t, len);
    if (rock(far)) {
      let lo = Math.max(0, t - 0.5), hi = far;
      for (let i = 0; i < 4; i++) { const mid = (lo + hi) / 2; if (rock(mid)) hi = mid; else lo = mid; }
      return lo;
    }
    if (far === len) return Infinity;
  }
}
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
    let near = hit ? hit.distance : Infinity;
    if (caveState.in) near = Math.min(near, caveSight(target, _ce, len));   // 人在洞裡：鏡頭不穿過洞壁
    if (near < Infinity) clear = Math.min(clear, dist * near / len - 0.35);
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
  // 擋不住的保險：鏡頭距離只要壞成 NaN 一次，下一幀的注視點也跟著壞、永遠回不來（整個畫面黑掉，只能重新整理）
  if (!Number.isFinite(camArm)) camArm = null;
  let clear = Math.max(sightArm(dist), MIN);
  if (!Number.isFinite(clear)) { if (!clearArm.warned) { clearArm.warned = true; console.warn('[cam] sightArm 算出 NaN', { yaw, pitch, dist, target: target.toArray(), cd: _cd.toArray(), cr: _cr.toArray() }); } clear = dist; }
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
  // 人在透天洞穴裡：鏡頭腳下的「地面」是洞底，不是頭上的山坡（不然鏡頭一靠近洞壁就被抬到山頂上去）；洞壁由 sightArm 擋。
  // 人在洞頂上面走的時候反過來：海床圖在洞的範圍記的是洞底，鏡頭要照山坡的高度擋，才不會鑽進洞頂裡
  let bed = bedAt(cp.x, cp.z);
  const [qx, qz] = havenToLocal(cp.x, cp.z);
  if (nearCave(qx, qz)) bed = caveState.in ? (caveFloor(qx, qz) ?? -99) : Math.max(bed, HAVEN_LAND.at(qx, qz));
  const floor = Math.max(onDeck(cp.x, cp.z, 0.6) ? Math.max(DECK_Y, bed) : bed, tsuAt(cp.x, cp.z) + 0.6) + 0.6;
  if (cp.y < floor) cp.y = floor;
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
}

let debugCam = null;   // 測試用：把鏡頭釘在指定的位置 [x, y, z, 看向 x, y, z]
let menuYaw = 0;
// 鏡頭多近的東西開始被裁掉：第一人稱 0.25（applyViewSettings 也是這個數字），第三人稱 1（鏡頭被牆擠近時 0.3）。
// 第一人稱不能用 1：近處的船板、欄杆會被裁掉（以前船艙口還有一片只寫深度的隱形蓋子，2026-11-17 起改成海面著色器自己挖掉船艙，見 hullCutGlsl）
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
    target.set(HARBOR_CENTER_W.x, 5, HARBOR_CENTER_W.z);
    orbit(headingToWorld(-Math.PI / 2) + 0.75 * Math.sin(menuYaw), -0.28, 82);
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
      target.set(player.pos.x, player.pos.y + 1.5, player.pos.z);
      const arm = clearArm(v.yaw, v.pitch, v.dist, dt);
      orbit(v.yaw, v.pitch, arm);
      // 鏡頭靠近時看向頭頂，但探測從固定高度起算，避免抬高探測起點又改變下一幀的碰撞結果。
      const cramped = clamp(1 - (arm - 1.2) / 2.3, 0, 1);
      if (cramped > 0) {
        target.y += 0.6 * cramped;
        camera.lookAt(target);
      }
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
  const b = player.boat;
  // 隊友的船：請伺服器讓我幫忙開（回話見 helmOk）
  if (b !== myBoat) { if (net.online) net.send({ t: 'helm', forId: b.owner.id, on: true }); else toast('連線中斷，等接回去再試'); return; }
  // 隊友正在幫我開：船主握方向盤就收回來
  if (piloted) { if (net.online) net.send({ t: 'helm', on: true }); toast(`從 ${piloted.name} 手上接回方向盤`); piloted = null; myBoat.net = null; }
  grabHelm(b);
}
function grabHelm(b) {
  fishing.cancel();
  player.seat = null;
  boat = b;
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
  if (copilot) endCopilot(true);
  applyViewSettings();
}
// 副駕：伺服器答應了，那艘船從現在起在我這邊算（照它現在的樣子接手：船速、油量、耐久）
function beginCopilot(id, s) {
  const b = others.boat(id);
  if (!b || b.sinking || player.boat !== b || mode !== 'walk') { if (net.online) net.send({ t: 'helm', forId: id, on: false }); return; }
  b.local = true;
  b.speed = s[6]; b.throttle = 0; b.fuel = clamp(s[10], 0, b.spec.tank); b.towK = 1;
  resetBoatFx(b);
  b.damage.slice().forEach((c) => b.repair(c));
  if (s[11] < 0.995) b.hurt(b.spec.hp * (1 - s[11]));
  for (const k in b.keys) b.keys[k] = false;
  copilot = { id, boat: b };
  grabHelm(b);
  toast(`你在幫 ${b.owner.name} 開船（按 E 放手；船主握方向盤就會收回去）`);
}
// 一艘船換一邊算（隊友接手、交還）：上一邊留下的災害狀態、被撞後的滑動都清掉（不然交還後浪頭可能再扣一次、船會自己滑一下）
function resetBoatFx(b) { b._hz = null; b._shove = null; b._hitSpin = 0; b._surgePeak = 0; }
// 不幫忙開了（自己放手 tell = true；被船主收回、退隊、船主離線 tell = false）：那艘船交回給船主那邊算
function endCopilot(tell) {
  if (!copilot) return;
  const { id, boat: b } = copilot;
  copilot = null;
  for (const k in b.keys) b.keys[k] = false;
  b.setManned(false);
  b.towK = 1;
  if (tell && net.online) { net.send({ t: 'b', forId: id, s: b.netState() }); net.send({ t: 'helm', forId: id, on: false }); }
  b.local = false;
  resetBoatFx(b);
  b.damage.slice().forEach((c) => b.repair(c));   // 破洞是我這邊算的時候畫的：收掉（別人的船平常不畫破洞）
  if (mode === 'helm' && boat === b) {
    player.place(walkWorld, b.spec.helmX - 0.3, 0, b);
    player.yaw = view.walk.yaw = b.heading;
    mode = 'walk';
    applyViewSettings();
  }
}

// ---- 大港：吊鉤大秤收購站（收購價比潮汐灣多 15%） ----
const boatWithin = (p, r) => !myBoat.sinking && !myBoat.stored && Math.hypot(myBoat.x - p.x, myBoat.z - p.z) < r;
// 這一秤要賣哪些魚：手上那一條；手上沒東西就是停在碼頭的船上整箱
const hookFish = () => { const hb = heldBox(); return hb ? hb.fish : fish.held ? (fish.held.can ? [] : [fish.held]) : []; };
const hookPrice = (list) => Math.round(list.reduce((s, it) => s + it.value, 0) * (1 + PORT.bonus));
function hookText() {
  const list = hookFish(), pct = Math.round(PORT.bonus * 100);
  if (fish.held && fish.held.can) return `大港收購站（比潮汐灣多 ${pct}%）　油桶不能賣`;
  if (!list.length) return heldBox() ? `大港收購站（比潮汐灣多 ${pct}%）　魚箱是空的` : `大港收購站（比潮汐灣多 ${pct}%）　手上拿一條魚過來，或抱著魚箱過來整箱秤`;
  return fish.held ? `按 E 把這條魚掛上大秤賣出（$${hookPrice(list)}，多 ${pct}%）` : `按 E 把整箱 ${list.length} 條魚吊上來賣出（$${hookPrice(list)}，多 ${pct}%）`;
}
function havenSell() {
  const list = hookFish();
  const hb = heldBox();
  if (!list.length) return toast(hb ? '魚箱是空的' : fish.held ? '油桶不能賣' : '手上拿一條魚過來，或抱著魚箱過來整箱秤');
  if (!net.online) return toast('連線中斷，等接回去再賣');
  net.send(hb ? { t: 'sell', at: 'haven', bid: hb.bid } : { t: 'sell', at: 'haven', uids: list.map((it) => it.uid) });
}
// ---- 修船台（海上修船屋、大港船塢）：船壞了海上修不了，要開進船塢、人站在修船台前按 E 付錢一次修滿 ----
// 修哪一艘：自己的船停在這個據點的範圍裡就修自己的；不然看有沒有同隊隊友的船停在這裡（幫他付）
function repairTarget(shelf) {
  const site = SITES[shelf.site], inR = (b) => !b.sinking && !b.stored && Math.hypot(b.x - site.x, b.z - site.z) < site.repairR;
  const cost = (b) => (b.remote ? repairCost(b.spec.id, b.net?.[11] ?? 1, 0) : repairCost(b.spec.id, b.hp / b.spec.hp, b.damage.length));
  if (inR(myBoat) && cost(myBoat) > 0) return { boat: myBoat, cost: cost(myBoat), mine: true };
  for (const o of others.list()) {
    const ob = party.has(o.id) ? others.map.get(o.id)?.boat : null;
    if (ob && inR(ob) && cost(ob) > 0) return { boat: ob, cost: cost(ob), mine: false, id: o.id, name: o.name };
  }
  return inR(myBoat) ? { boat: myBoat, cost: 0, mine: true } : null;
}
function repairText(shelf) {
  const t = repairTarget(shelf), site = SITES[shelf.site];
  if (!t) return `修船台　先把船開進${site.name}的船塢`;
  if (!t.cost) return '修船台　船體狀況完好，無須維修';
  const whose = t.mine ? t.boat.spec.name : `${t.name} 的${t.boat.spec.name}`;
  return money >= t.cost ? `按 E 修好${whose}（耐久 ${hpText(t.boat)}）　${t.mine ? '' : '約 '}$${t.cost}` : `修好${whose}要 ${t.mine ? '' : '約 '}$${t.cost}（錢不夠）`;
}
// 不是買東西的工位：漁會捐款箱 → 平板的榜單（捐款、稱號）；海神祭壇 → 平板的祭壇；塗裝架 → 平板的船（塗裝預覽）；意見信箱 → 意見小卡
function openStation(id) {
  if (id === 'mailbox') {
    return openFeedback({
      send(kind, text) { if (!net.online) { toast('連線中斷，等接回去再投'); return false; } net.send({ t: 'feedback', kind, text }); return true; },
      onOpen() { for (const k in keys) keys[k] = false; closeWheel(false); syncAim(); },   // 滑鼠從遊戲裡放開，才點得到卡片
      onClose() { syncAim(); },
    });
  }
  if (id === 'title' && net.online) net.send({ t: 'guild' });   // 捐款箱：先要一份最新的榜
  const appId = id === 'title' ? 'rank' : id === 'altar' ? 'shrine' : 'boat', app = tablet.apps.find((a) => a.id === appId);
  if (app && id === 'title') app.tab = 'guild';     // 榜單的「漁會功德榜・稱號」那一頁
  if (app && id === 'paint') { app.tab = 'custom'; app.pv = null; }   // 船的「改裝與塗裝」那一頁（預覽從船現在的顏色看起）
  tablet.show(appId);
}
function repairAt(shelf) {
  const t = repairTarget(shelf);
  if (!t) return toast(`先把船開進${SITES[shelf.site].name}的船塢`);
  if (!t.cost) return toast('船體狀況完好，無須維修');
  if (money < t.cost) return toast(`錢不夠，修理費要 $${t.cost}`);
  if (!net.online) return toast('連線中斷，等接回去再修');
  if (buying) return;
  buying = true;
  window.setTimeout(() => { buying = false; }, 1500);
  if (t.mine) { net.send({ t: 'b', s: myBoat.netState() }); lastBoatDetail = ''; sendBoatDetail(); }   // 先把最新的耐久、破洞告訴伺服器，修理費才算得準
  net.send(t.mine ? { t: 'repairBoat' } : { t: 'repairBoat', forId: t.id });
}

// 賣魚的籃子與按鈕
const nearBasket = () => !player.boat && Math.hypot(player.x - SELL_W.basket.x, player.z - SELL_W.basket.z) < 2.0;
const nearButton = () => !player.boat && Math.hypot(player.x - SELL_W.button.x, player.z - SELL_W.button.z) < 1.7;

// 腳下這艘船的油箱（要站在油箱旁邊）
const nearTank = () => (player.boat && player.boat === myBoat && Math.hypot(player.lx - player.boat.parts.tank.x, player.lz - player.boat.parts.tank.z) < 1.9 ? player.boat : null);
// ---- 纜繩 -------------------------------------------------------------------
// 船停在岸壁邊時，人下船走到繫纜樁旁邊按 E，把船的纜繩綁上去；綁住的船不會被水流、風帶走（也開不走，要先解開）。
// 拉力太大纜繩會繃斷：水龍捲靠得夠近、或巨浪湧進港口把船抬得太高
const MOOR_REACH = 7.5;               // 船舷離樁多遠以內綁得到（公尺）
const MOOR_FLOW = 4, MOOR_LIFT = 2;   // 斷掉的限度：水流每秒幾公尺、水位被抬高幾公尺
const moorLines = new Map();          // 每艘船的纜繩模型
const _mv = new THREE.Vector3();
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
// 第 i 根樁旁邊有沒有同隊隊友的船可以幫忙綁、解（船主在線上、沒人在開；纜繩實際上由船主那邊綁，見 boatCtl）
function mateBollard(i) {
  for (const id of party.ids) {
    const b = others.boat(id);
    if (!b || b.sinking || b.local || b.manned || Number.isFinite(b.reclaimAt)) continue;
    const m = moorSpot(i, [b], MOOR_REACH + (b.tied ? 2 : 0));
    if (m) return { ...m, tied: !!b.tied, mate: id };
  }
  return null;
}
// 請算那艘船的那一邊（船主，或正在幫他開的隊友）照做：開關燈、綁解纜繩
function mateCtl(b, what, text, sound, i = -1) {
  if (!net.online) return toast('連線中斷，等接回去再試');
  net.send({ t: 'boatCtl', forId: b === myBoat ? net.id : b.owner.id, what, i });
  audio.play(sound);
  toast(text);
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
// 船身放在 (x, z) 會不會卡進岸壁或擱在太淺的地方（沿完整船身外框與龍骨取樣）
function hullBlocked(b, x, z) {
  return b.hullBlocked(boatGround, x, z);
}
function pushBoatSafe(b, dx, dz) {
  const cur = b.hullProfile(boatGround, b.x, b.z), lim = -b.spec.draft * 0.7;
  const ok = (px, pz) => b._hullAllowed(cur, b.hullProfile(boatGround, px, pz), lim);
  if (ok(b.x + dx, b.z + dz)) { b.x += dx; b.z += dz; return true; }
  if (Math.abs(dx) >= Math.abs(dz) && ok(b.x + dx, b.z)) { b.x += dx; return true; }
  if (ok(b.x, b.z + dz)) { b.z += dz; return true; }
  if (ok(b.x + dx, b.z)) { b.x += dx; return true; }
  return false;
}
// 船跟船會互相擋住、互相推。每個人只算自己（和正在幫隊友開的）那艘船：把兩艘船各當成一條「兩頭圓的長條」，疊在一起就推開。
// 誰讓多少照噸位分：自己讓「對方噸位 ÷ 兩艘加起來」那麼多（對方那邊也照同一條規則讓他那一份）。
// 對方綁著岸上的纜繩、或船主離線沒人管：它不會動，自己全讓；自己綁著纜繩：不讓（對方會讓）。
// 船對船只有推擠、反彈、被扭開、搖晃，不扣耐久、不會破洞
const hullGap = { d: 0, nx: 0, nz: 0, lever: 0 };
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
  hullGap.lever = (s - 0.5) * 2 * ha;   // 碰到的地方在 a 的船身哪裡（離船身中心多遠，船頭是正的）
  return hullGap;
}
let bumpAt = 0;
function collideBoats(b, helm) {
  if (b.sinking) return;
  let moved = false;
  // 上次被撞之後船頭還在被扭開：慢慢停下來（不會把船身轉進岸壁）
  if (b._hitSpin) {
    const turn = b._hitSpin * dtSim;
    if (Math.abs(b._hitSpin) > 0.002 && !b.hullBlocked(boatGround, b.x, b.z, b.heading + turn)) { b.heading += turn; moved = true; }
    b._hitSpin *= Math.exp(-dtSim * 3);
    if (Math.abs(b._hitSpin) < 0.002) b._hitSpin = 0;
  }
  // 上次被撞之後還在被推著橫移：慢慢停下來（不會被推進岸壁、淺灘；綁著纜繩的不動）
  if (b._shove) {
    const sv = b._shove, k = Math.exp(-dtSim * BOATHIT.shoveDrag);
    if (!b.moor && pushBoatSafe(b, sv.x * dtSim, sv.z * dtSim)) moved = true; else sv.x = sv.z = 0;
    sv.x *= k; sv.z *= k;
    if (Math.hypot(sv.x, sv.z) < 0.03) b._shove = null;
  }
  const tick = b._hitTick = (b._hitTick || 0) + 1, seen = b._hitSeen || (b._hitSeen = new WeakMap());
  for (const o of boats) {
    if (o === b || o.sinking) continue;
    // 別人的船剛才最快開多快（慢慢忘掉）：它撞上來的時候自己那邊先煞住了，傳到這邊已經幾乎是停的
    if (o.remote && !o.local) { if (Math.abs(o.speed) >= Math.abs(o._vPeak || 0)) o._vPeak = o.speed; else o._vPeak *= Math.exp(-dtSim * BOATHIT.peakFade); }
    if (Math.hypot(o.x - b.x, o.z - b.z) > (o.spec.len + b.spec.len) / 2 + 1) continue;
    const g = boatGap(b, o);
    if (g.d >= BOATHIT.touch) continue;
    const first = (seen.get(o) ?? -9) < tick - 1;   // 這一幀才碰上（上一幀還沒碰到）
    seen.set(o, tick);
    const os = first && o.remote && !o.local ? o._vPeak ?? o.speed : o.speed;   // 剛碰上：用對方撞上來之前的速度；之後照它現在的速度
    const fixed = o.remote && !o.local ? (o.tied || Number.isFinite(o.reclaimAt)) : !!o.moor;   // 對方不會動
    const share = b.moor ? 0 : fixed ? 1 : o.spec.mass / (b.spec.mass + o.spec.mass);
    // 推開（絕不把船擠進棧橋或更淺的岸壁，只擋下速度）
    if (g.d < 0 && share > 0 && pushBoatSafe(b, -g.nx * g.d * share, -g.nz * g.d * share)) moved = true;
    const fx = Math.cos(b.heading), fz = Math.sin(b.heading), along = fx * g.nx + fz * g.nz;
    const rel = (fx * b.speed - Math.cos(o.heading) * os) * g.nx + (fz * b.speed - Math.sin(o.heading) * os) * g.nz
      + (b._shove ? b._shove.x * g.nx + b._shove.z * g.nz : 0);   // 自己已經被推著滑開的那一份也算（滑得比對方快就不算在靠近了）   // 兩艘船互相靠近的速度（負的才是）
    if (rel < (g.d < 0 ? 0 : -BOATHIT.touchMin) && share > 0) {
      const hit = -rel * share, lat = -fz * g.nx + fx * g.nz;   // lat：撞擊的力道有多少是橫著來的（往右舷是正的）
      b.speed += (1 + BOATHIT.bounce) * hit * along;            // 擋下來，再往回彈一點
      b._hitSpin = clamp((b._hitSpin || 0) + BOATHIT.yaw * hit * lat * g.lever / (b.spec.len / 2), -0.9, 0.9);   // 斜著擦到：船頭（或船尾）被扭開
      // 橫著被撞：整艘船往被撞的方向滑開一段（順著船頭的那一份已經算在船速裡）
      //   只補到「這一下該有的速度」為止：兩艘船頂在一起好幾幀也不會越加越快（跟畫面更新率無關）
      const ux = g.nx - along * fx, uz = g.nz - along * fz, ul = Math.hypot(ux, uz);
      if (ul > 1e-3) {
        const sv = b._shove || (b._shove = { x: 0, z: 0 }), have = (sv.x * ux + sv.z * uz) / ul;
        const add = Math.min((1 + BOATHIT.bounce) * hit * BOATHIT.shove * ul, BOATHIT.shoveMax) - have;
        if (add > 0) { sv.x += ux / ul * add; sv.z += uz / ul * add; }
      }
      b._wr = (b._wr || 0) + Math.min(BOATHIT.roll * hit * 5.5, BOATHIT.rollMax) * (lat >= 0 ? 1 : -1);   // 船身橫搖一下（有上限：不會把甲板上的魚甩出去）
      if (hit > BOATHIT.sound * share && time - bumpAt > 0.6) {
        bumpAt = time;
        audio.play('drop', clamp(-rel / 5, 0.4, 1));
        splash(b.x + fx * g.lever - g.nx * b.spec.beam / 2, b.mesh.position.y + 0.3, b.z + fz * g.lever - g.nz * b.spec.beam / 2, Math.round(clamp(-rel * 3, 4, 14)));
        if (player.boat === b || (helm && boat === b)) jetShake = Math.max(jetShake, clamp(-rel / 12, 0.1, 0.5));
      }
    }
  }
  if (moved) b._pose();
}

// ---- 海上救難拖船：對方同意才拖（伺服器記誰拖誰）；拉船的物理在「被拖那艘船是誰在算」的那一邊算 ----
const boatOfId = (id) => (id === net.id ? myBoat : others.boat(id));
const towOfId = (id) => tows.find((t) => t.tug === id || t.tow === id) || null;
const simmed = (b) => (b === myBoat ? !piloted : !!(copilot && copilot.boat === b));   // 這艘船的物理是不是我這邊在算
// 離 b 的船尾最近、搆得到的別人的船（船主要在線上）
function towTarget(b) {
  const sx = b.x - Math.cos(b.heading) * b.spec.len / 2, sz = b.z - Math.sin(b.heading) * b.spec.len / 2;
  let best = null, bd = TOW.reach;
  for (const [id, o] of others.map) {
    const ob = o.boat;
    if (!ob || ob === b || ob.sinking || !o.fig || towOfId(id)) continue;
    const d = Math.min(Math.hypot(sx - ob.x - Math.cos(ob.heading) * ob.spec.len / 2, sz - ob.z - Math.sin(ob.heading) * ob.spec.len / 2), Math.hypot(sx - ob.x, sz - ob.z));
    if (d < bd) { bd = d; best = { id, name: o.name, boat: ob }; }
  }
  return best;
}
// 現在能對拖纜做什麼（掌舵按 T、手機按拖船鈕、或對準船尾的拖船樁按 E）：已經連著就是解開；不然請求拖行附近的船
function towAction(b = myBoat) {
  if (!inGame || !b || b.sinking) return null;
  if (towOfId(b === myBoat ? net.id : b.owner?.id)) return { cut: true, text: '解開拖纜' };
  if (b !== myBoat) return null;   // 幫隊友開船時只能解開，不能替他去拖別人
  const t = towTarget(b);
  return t ? { cut: false, to: t.id, text: `請求拖行【${t.name} 的${t.boat.spec.name}】` } : null;
}
function doTow(act, me = false) {
  if (!act) return toast(`船尾 ${TOW.reach} 公尺內沒有別人的船`);
  if (!net.online) return toast('連線中斷，等接回去再試');
  net.send(act.cut ? { t: 'towCut' } : { t: 'towAsk', to: act.to, me });
}
const towLines = new Map();   // 每條拖纜的模型：'拖船-被拖' → MoorLine
const _ta = new THREE.Vector3(), _tb = new THREE.Vector3();
let towCutAt = 0;
function updateTows(dt) {
  myBoat.towK = 1;
  if (copilot) copilot.boat.towK = 1;
  const seen = new Set();
  for (const t of tows) {
    const A = boatOfId(t.tug), B = boatOfId(t.tow);
    if (!A || !B || A.sinking || B.sinking) continue;
    // 拖船：極速打折（大拖小掉得少、小拖大掉得多）
    if (simmed(A)) A.towK = TOW.speed[A.spec.mass > B.spec.mass ? 'big' : A.spec.mass < B.spec.mass ? 'small' : 'same'];
    A.mesh.updateMatrixWorld(); B.mesh.updateMatrixWorld();
    _ta.copy(A.parts.towPost).applyMatrix4(A.mesh.matrixWorld);
    _tb.copy(B.parts.bowEye).applyMatrix4(B.mesh.matrixWorld);
    if (simmed(B)) {
      // 被拖的船：拖纜拉直了就被拉著走，船頭慢慢轉向拖船的船尾（不會被拉進岸壁、淺灘）
      const dx = _ta.x - _tb.x, dz = _ta.z - _tb.z, d = Math.hypot(dx, dz);
      if (d > TOW.rope) {
        const k = (d - TOW.rope) / d;
        pushBoatSafe(B, dx * k, dz * k);
        const want = Math.atan2(dz, dx), turn = Math.atan2(Math.sin(want - B.heading), Math.cos(want - B.heading)) * (1 - Math.exp(-dt * TOW.turn));
        if (!B.hullBlocked(boatGround, B.x, B.z, B.heading + turn)) B.heading += turn;
        const vs = Math.max(0, A.speed) * Math.max(0, Math.cos(want - B.heading));   // 跟著拖船的速度走（別人看到的航跡、位置才順）
        B.speed += (vs - B.speed) * (1 - Math.exp(-dt * 2));
        B._pose();
      }
      // 被拖的船主自己踩油門：解開
      if (B === myBoat && mode === 'helm' && boat === myBoat && (myBoat.keys.w || myBoat.keys.s) && performance.now() - towCutAt > 1500) { towCutAt = performance.now(); if (net.online) net.send({ t: 'towCut' }); }
    }
    const key = `${t.tug}-${t.tow}`, mx = (_ta.x + _tb.x) / 2, mz = (_ta.z + _tb.z) / 2;
    seen.add(key);
    let ln = towLines.get(key);
    if (!ln) { ln = new MoorLine(); towLines.set(key, ln); scene.add(ln.mesh); }
    ln.set(_tb, _ta, TOW.rope + 0.5, ocean.sampleCached(mx, mz) * waveK(mx, mz) + tsuAt(mx, mz));
    ln.mesh.visible = true;
  }
  for (const [k, ln] of towLines) if (!seen.has(k)) { scene.remove(ln.mesh); ln.mesh.geometry.dispose(); ln.mesh.material.dispose(); towLines.delete(k); }   // 解開了：纜繩收掉
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
      if (!pushBoatSafe(b, sx, sz) && d > m.len + 1) pushBoatSafe(b, sx * 0.25, sz * 0.25);
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
    // 岸壁的邊緣是港座標的一條線（繫纜樁都在這條邊上）：先轉成港座標算，再轉回世界
    const [rlx, rlz] = toLocal(_rv.x, _rv.z), [plx, plz] = toLocal(post.x, post.z);
    const edge = QUAY_EDGE_Z + 0.05, over = rlz > edge + 0.1 && _rv.y < DECK_Y + 0.4;
    if (over) { const [mx, mz] = toWorld(plx + (rlx - plx) * (edge - plz) / (rlz - plz), edge); _mv.set(mx, DECK_Y + 0.045, mz); }
    ln.set(_rv, _rf, m.len + 0.5, tsuAt(_rv.x, _rv.z), over ? _mv : null);
  }
  for (const [b, ln] of moorLines) if (!b.moor || !boats.includes(b)) ln.mesh.visible = false;
  if (!helm) moorToast = false;
}
const hpText = (b) => `${Math.round(100 * (b.remote && !b.local ? b.net?.[11] ?? 1 : b.hp / b.spec.hp))}%`;
const litres = (v) => (v >= 9.95 ? v.toFixed(0) : v.toFixed(1));
const itemLabel = (it) => (it.chum ? '誘魚桶' : it.can ? `油桶（${litres(it.liters)} 公升）` : fishLabel(it));

// ---- 商店的商品架 -----------------------------------------------------------
// 錢、釣竿、買了哪些船都由伺服器保管（kit）；這幾個變數只是照著它顯示。買賣是送請求過去，伺服器算好再回來
let rodLv = 0;
let rodBroken = false;   // 釣竿斷了（爆桿）：要回商店修好才能再釣
let buying = false;      // 已經送出購買、還在等伺服器回話
let dexBook = {};        // 圖鑑（伺服器存的）：魚種 → { n, len, kg, at }，另外 _lv 記等級經驗。要宣告在 refreshTags() 第一次執行之前（價格牌的頭銜要用它）
// 每樣商品現在賣什麼：lines = 價格牌上的三行字；price 為 null 表示沒得買。引擎和魚箱是裝在自己放在世界裡的那艘船上
function offer(id) {
  // 不是買東西的工位：修船台、漁會捐款箱、意見信箱、海神祭壇（各有自己的互動，見 interact 的 shelf）
  if (id === 'repair') return { name: '修船台', lines: ['修船工作台', '船停進船塢・一次修滿', '依損壞計價'], price: null, station: true };
  if (id === 'title') return { name: '漁會捐款箱', lines: ['漁會捐款箱', '自由捐獻・週榜奪稱號', `最低 $${GUILD.min}`], price: null, station: true };
  if (id === 'mailbox') return { name: '漁會意見信箱', lines: ['意見信箱', 'Bug・建議・卡頓', '投遞'], price: null, station: true };
  if (id === 'altar') return { name: '海神祈福祭壇', lines: ['海神祈福', '魚潮・風暴召喚', `$${BLESSINGS.tide.price}`], price: null, station: true };
  const o = shopItem(id, kit), cur = kit.boats[kit.active] ?? { engineLv: 0 }, bn = BOAT_TYPES[kit.active].name;
  if (id === 'fuel') return { name: `一桶油（${CAN} 公升）`, lines: [`油桶 ${CAN}公升`, '提到船尾倒進油箱', `$${o.price}`], price: o.price };
  if (id === 'chum') {
    if (o.price === null) return { name: '誘魚桶', lines: ['誘魚桶', `這艘船最多帶 ${o.max ?? CHUM_SPEC.max} 桶`, '已滿'], price: null };
    return { name: '誘魚桶', lines: ['誘魚桶', `提著走・丟進海裡引魚`, `$${o.price}`], price: o.price };
  }
  if (id.startsWith('mod_') && BOAT_MODS[id.slice(4)]) {
    const M = BOAT_MODS[id.slice(4)];
    const tagDesc = M.id === 'sonar' ? '舵旁螢幕顯示魚群水深' : '夜裡趨光魚多 1.8～2.2 倍';
    if (o.why === 'boat') return { name: M.name, lines: [M.name, '漁船／大漁船專用', `$${M.price}`], price: null, why: '要先有近海漁船或遠洋大漁船才能裝' };
    if (o.price === null) return { name: M.name, lines: [M.name, '永久改裝已安裝', '已擁有'], price: null };
    return { name: M.name, lines: [M.name, tagDesc, `$${o.price}`], price: o.price };
  }
  if (id === 'paint' || id.startsWith('paint:')) {
    if (o.price === null) return { name: '船殼塗裝', lines: ['船殼塗裝', '已收錄全部塗裝', '全擁有'], price: null, station: true };
    return { name: `塗裝・${o.paint.name}`, lines: ['船殼塗裝', '按 E 預覽五種顏色', `$${BOAT_PAINTS[1].price} 起`], price: o.price, station: true };
  }
  if (id === 'bless_tide') return { name: BLESSINGS.tide.name, lines: [BLESSINGS.tide.name, '全服稀有×2', `$${o.price}`], price: o.price };
  if (id === 'bless_storm') return { name: BLESSINGS.storm.name, lines: [BLESSINGS.storm.name, '召喚巨浪風暴', `$${o.price}`], price: o.price };
  if (id === 'rod') {
    // 錢不夠也修得起：身上有多少算多少（不然釣竿斷了又沒錢，就再也賺不到錢了）
    if (o.repair) return { name: '修理釣竿', act: '修理釣竿', lines: ['修理釣竿', '斷掉的釣竿修好', `$${o.price}`], price: o.price };
    if (o.price === null) return { name: '釣竿', lines: ['釣竿', '已經是最好的', '售完'], price: null };
    return { name: `第 ${kit.rodLv + 1} 級釣竿`, lines: [`釣竿 第${kit.rodLv + 1}級`, '拋更遠、更好拉', `$${o.price}`], price: o.price };
  }
  if (id === 'engine') {
    // 引擎是一艘船一艘船分開升的：牌子上寫清楚現在裝的是哪一艘、從幾級升到幾級
    if (o.price === null) return { name: '引擎', lines: [`${bn}引擎`, `Lv.${cur.engineLv} 已升到頂`, '售完'], price: null };
    return { name: `${bn}的引擎 Lv.${cur.engineLv} → Lv.${cur.engineLv + 1}`, lines: [`${bn}引擎`, `Lv.${cur.engineLv} → Lv.${cur.engineLv + 1}・每艘分開升`, `$${o.price}`], price: o.price,
      note: '引擎裝在這艘船上，換船要另外升；船沉了，船和引擎一起沒了' };
  }
  if (id === 'box') return { name: '魚箱', lines: ['魚箱', '抱著搬，魚不會跑', `$${o.price}`], price: o.price };
  if (id.startsWith('bait_')) {
    const B = BAITS[id.slice(5)];
    if (o.price === null) return { name: B.name, lines: [B.name, '已經囤滿了', '售完'], price: null };
    return { name: `${B.name}（${B.pack} 個）`, lines: [`${B.name} ${B.pack}個`, B.desc, `$${o.price}`], price: o.price };
  }
  const S = BOAT_TYPES[id];
  if (o.price === null) return { name: S.name, lines: [S.name, '已經買了', kit.active === id ? '現在開的這艘' : '收在倉庫'], price: null };
  return { name: S.name, lines: [S.name, id === 'fisher' ? '輕快・遮陽棚海釣艇' : '雙層艦橋・急凍魚艙', `$${S.price}`], price: S.price, note: '新船引擎是 Lv.0（每艘分開升）；現在這艘收進倉庫' };
}
// 價格牌：母港的照 SHELF 的順序（harbor.js 的 setTag）；修船屋、大港的由各自的模型提供（seascape.tags，照 SITE_SHELF_W 的順序）
function refreshTags() {
  SHELF.forEach((it, i) => setTag(i, offer(it.id).lines));
  seascape.tags.forEach((tg, i) => drawTag(tg, offer(SITE_SHELF_W[i].id).lines));
}
refreshTags();
// 站在哪樣商品前面（取最近的那一樣）
function nearShelf() {
  if (player.boat) return null;
  let best = null, bd = 1.1;
  for (const it of ALL_SHELF_W) {
    const d = Math.hypot(player.x - it.stand.x, player.z - it.stand.z);
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}
// 伺服器說家當變了（進房、買賣之後）：照著更新畫面
// 餌：按 B（手機是右上角的鉤子）輪流換，或在平板的「背包」點一下換。基本餌不花錢也不加成
function cycleBait() {
  if (!inGame) return;
  const list = ['', ...Object.keys(BAITS).filter((t) => baitCount(kit, t) > 0)];
  if (list.length === 1) return toast('身上沒有餌。商店裡有賣');
  const next = list[(Math.max(0, list.indexOf(kit.bait)) + 1) % list.length];
  setBait(next);
}
function setBait(id) {
  net.send({ t: 'baitSel', id });
  toast(id ? `換上${BAITS[id].name}（剩 ${baitCount(kit, id)} 個）：${BAITS[id].desc}` : '換回基本餌（不加成，也不花錢）');
}
// 誘魚桶：身上有幾桶是伺服器記的（kit.chum），手上、甲板上的桶子照那個數字擺。
// 少了（進房、換船、船沉了補一艘）就補在自己船的船尾右側；多了（用掉了）就收掉
function syncChums() {
  const b = myBoat, ok = b && !b.sinking && !b._lost && !b.stored, want = kit.chum || 0;
  for (const it of fish.chums) if (it.boat && (it.boat.stored || !boats.includes(it.boat))) fish.removeChum(it);   // 留在收進倉庫的船上的：搬過來
  let have = fish.chums.length;
  if (have > want) fish.removeChums(have - want);
  if (!ok) return;
  const S = b.spec;
  for (; have < want; have++) {
    let lx = -S.len * 0.3, lz = S.beam * 0.2;
    for (let i = 0; i < 16; i++) {
      const x = -S.len * 0.36 + (i % 4) * 0.42, z = S.beam * 0.3 - Math.floor(i / 4) * 0.4;
      if (b.deckContains(x, z) && !b.blockedLocal(x, z) && !fish.chums.some((c) => c.boat === b && Math.hypot(c.lx - x, c.lz - z) < 0.36)) { lx = x; lz = z; break; }
    }
    fish.stowChum(b, lx, lz);
  }
}
// 船首集魚燈開關（對準燈按 E，或平板的「船」）
function toggleFishLamp(b = myBoat) {
  if (!b.mods.lamp || !b.parts.bowLamp) return toast('這艘船沒有船首集魚燈（海上修船屋、大港船塢有賣，小舢舨裝不了）');
  if (!simmed(b)) return mateCtl(b, 'fishLamp', b.fishLamp ? '集魚燈關掉了' : '集魚燈打開了', 'switch');   // 自己的船正被隊友開著（平板上按的）：請他那邊照做
  b.setFishLamp(!b.fishLamp);
  audio.play('switch');
  toast(b.fishLamp ? `集魚燈打開了：夜裡船邊 25 公尺內趨光魚多 ${b.spec.lampMul} 倍` : '集魚燈關掉了');
  if (tabOpen()) tablet.update();
}
// 探魚聲納（裝了才有）：人在那艘船上時舵旁的螢幕一直掃；掌舵時掃到魚群會「叮」一聲
const SONAR_PING = { every: 4.5, near: 140 };
let sonarWait = 0;
function updateSonar(dt) {
  const b = mode === 'helm' ? boat : mode === 'walk' ? player.boat : null;
  if (!inGame || !b || b.sinking || !b.sonarRange) return;
  const spots = [], hs = havenFx.hot();
  if (hs) spots.push({ x: hs.x, z: hs.z, n: hs.count ?? 0 });
  for (const c of havenFx.chums()) spots.push({ x: c.x, z: c.z, n: c.count ?? 0 });
  b.updateSonarScreen(dt, spots, -bedAt(b.x, b.z));
  if ((sonarWait -= dt) > 0 || mode !== 'helm') return;
  const hit = spots.some((s) => Math.hypot(s.x - b.x, s.z - b.z) < Math.min(SONAR_PING.near, b.sonarRange));
  sonarWait = hit ? SONAR_PING.every : 1;
  if (hit) audio.sonarPing();
}
function castChum() {
  if (!inGame || !net.online) return toast('連線中斷，等接回去再試');
  if ((kit.chum || 0) <= 0) return toast('身上沒有誘魚桶，漁具行、大港補給所有賣');
  if (fish.held && fish.held.chum) return toast(touchText('提著誘魚桶：按住右鍵蓄力，丟進海裡就施放'));
  const yaw = player.yaw;
  let tx = player.boat ? player.x : player.x + Math.cos(yaw) * 4;
  let tz = player.boat ? player.z : player.z + Math.sin(yaw) * 4;
  if (!isWater(tx, tz)) {
    for (const d of [3, 6, 10, 15, 20]) {
      const cx = player.x + Math.cos(yaw) * d, cz = player.z + Math.sin(yaw) * d;
      if (isWater(cx, cz)) { tx = cx; tz = cz; break; }
    }
  }
  if (!isWater(tx, tz)) return toast('請站在船上或面對水面再施放誘魚桶');
  net.send({ t: 'useChum', x: r2(tx), z: r2(tz) });
}
function applyKit(k) {
  const was = baitCount(kit, kit.bait), wasBait = kit.bait;
  kit = k;
  if (was > 0 && kit.bait === wasBait && BAITS[wasBait] && !baitCount(kit, wasBait)) toast(`${BAITS[wasBait].name}用完了，改用基本餌`);
  money = k.money; rodLv = k.rodLv; rodBroken = k.rodBroken;
  $('hMoney').textContent = cash(money);
  const cur = k.boats[k.active];
  if (cur && myBoat.spec.id === k.active) {
    myBoat.engineLv = cur.engineLv;
  }
  myBoat.setPaint?.(k.paint || 'default');
  myBoat.setMods?.(k.mods);
  syncChums();
  refreshTags();
  if (tabOpen()) tablet.update();
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
    const lv = kit.boats[type] ?? { engineLv: 0 };
    b = addBoat(type, pose);
    b.engineLv = lv.engineLv;
    if (kept) {   // 收進倉庫之後重新整理過頁面：油量、破洞照收進去時的樣子
      b.fuel = clamp(kept.fuel, 0, b.spec.tank);
      for (const c of kept.cracks) b.restoreCrack(c[0], c[1], c[2]);
    }
  }
  if (player.boat === old && mode === 'walk') player.place(walkWorld, player.x, player.z);
  myBoat = b;
  boat = b;
  b.setPaint?.(kit.paint || 'default');
  b.setMods?.(kit.mods);
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
const _aimFbO = new THREE.Vector3(), _aimFbD = new THREE.Vector3();
const _aimRay = new THREE.Raycaster(), _aimHits = [];
function aimTarget() {
  if (mode !== 'walk' || player.swim || drown || player.climb) return null;   // 爬梯子途中騰不出手
  const fp = view.walk.fp;
  _aimO.copy(camera.position);
  camera.getWorldDirection(_aimD);
  const t0 = fp ? 0 : _aimV.set(player.pos.x, player.pos.y + 1.3, player.pos.z).sub(_aimO).dot(_aimD) - 0.3;
  const hb = heldBox(), held = fish.held, carrying = !!(hb || held);
  const list = [], b = player.boat, px = player.x, pz = player.z;
  const add = (kind, pos, r, data = {}) => list.push({ kind, pos, r, ...data });
  // 大漁船的二樓瞭望台：上面只能爬梯子下去（甲板上的東西都搆不到）
  if (b && player.roof === b) {
    const L = b.parts.ladder;
    b.mesh.updateMatrixWorld();
    if (!carrying && Math.hypot(player.lx - L.top.x, player.lz - L.top.z) < 1.4) {
      add('ladder', L.atTop.clone().applyMatrix4(b.mesh.matrixWorld), 0.5, { boat: b, up: false, rayMesh: b.parts.ladderObj, rayR: 1.4 });
    }
  } else if (b && !b.sinking && (!carrying || held?.can)) {
    b.mesh.updateMatrixWorld();
    const S = b.spec, D = S.deck, P = b.parts;
    const at = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(b.mesh.matrixWorld);
    const near = (x, z, r) => Math.hypot(player.lx - x, player.lz - z) < r;
    // 爬上瞭望台的鐵梯：走到梯子前按 E 才爬（路過不會不小心爬上去）
    if (!carrying && !player.seat && P.ladder && near(P.ladder.foot.x, P.ladder.foot.z, 1.5)) {
      add('ladder', at(P.ladder.at.x, P.ladder.at.y, P.ladder.at.z), 0.5, { boat: b, up: true, rayMesh: P.ladderObj, rayR: 1.2 });
    }
    // 舵、魚箱、油箱只有自己的船能動；別人的船只能搭（坐下），同隊隊友的船另外可以幫忙掌舵、開關燈。破洞海上修不了（要開去修船屋）
    if (b === myBoat) {
      if (near(P.tank.x, P.tank.z, 1.9)) add('tank', at(P.tank.x, P.tank.y, P.tank.z), 0.36, { boat: b, rayMesh: P.tankObj, rayR: 0.65 });
      if (!carrying) {
        if (nearHelm()) add('helm', at(P.helm.x, P.helm.y, P.helm.z), 0.5, { boat: b, rayMesh: P.wheel || P.tiller, rayR: 0.9 });
      }
    }
    else if (!carrying && party.has(b.owner?.id) && !b.manned && !Number.isFinite(b.reclaimAt) && nearHelm()) add('helm', at(P.helm.x, P.helm.y, P.helm.z), 0.5, { boat: b, rayMesh: P.wheel || P.tiller, rayR: 0.9 });   // 同隊隊友的船：船主在線上、沒在開，可以幫忙掌舵
    // 船燈、船首集魚燈（裝了才有）：自己的船，或同隊隊友的船（船主在線上）
    if (!carrying && (b === myBoat || (party.has(b.owner?.id) && !Number.isFinite(b.reclaimAt)))) {
      if (near(P.switch.x, P.switch.z, 2.3)) add('lamp', at(P.switch.x, P.switch.y, P.switch.z), P.switchR, { boat: b, rayMesh: P.switchObj, rayR: 0.45 });
      if (b.mods.lamp && P.bowLampAt && near(P.bowLampAt.x, P.bowLampAt.z, 2.4)) add('fishLamp', at(P.bowLampAt.x, P.bowLampAt.y, P.bowLampAt.z), P.bowLampR, { boat: b, rayMesh: P.bowLamp, rayR: 0.8 });
    }
    if (!carrying) for (const s of P.seats) if (near(s.x, s.z, 1.7)) add('seat', at(s.x, D + s.h + 0.05, s.z), 0.28, { boat: b, seat: s, rayMesh: s.mesh, rayR: 1.15 });
    // 船尾的拖船樁：自己的船去拖別人、解開；別人的船可以請他拖自己的船
    if (!carrying && P.towPost && near(P.towPost.x, P.towPost.z, TOW.postReach)) add('tow', at(P.towPost.x, P.towPost.y, P.towPost.z), P.towR, { boat: b });
  } else if (!b) {
    if (!carrying) BOLLARDS.forEach((p, i) => {
      if (Math.hypot(px - p.x, pz - p.z) > 1.9) return;
      const m = bollardAt(i) || mateBollard(i);
      if (m) add('bollard', new THREE.Vector3(p.x, p.y - 0.05, p.z), 0.36, { moor: m });
    });
    if ((!held || !held.can) && nearBasket()) add('basket', new THREE.Vector3(SELL_W.basket.x, DECK_Y + 0.3, SELL_W.basket.z), 0.5);
    // 大港：吊鉤大秤
    if ((!held || !held.can) && Math.hypot(px - HAVEN_SELL_W.x, pz - HAVEN_SELL_W.z) < PORT.sell.reach) add('hook', new THREE.Vector3(HAVEN_SELL_W.x, PORT.sell.y, HAVEN_SELL_W.z), 0.7);
    if (!carrying) {
      if (nearButton()) add('button', new THREE.Vector3(SELL_W.button.x, DECK_Y + 1.1, SELL_W.button.z), 0.26);
      for (const sw of SWITCHES_W) if (Math.hypot(px - sw.stand.x, pz - sw.stand.z) < 1.8) add('switch', new THREE.Vector3(sw.x, sw.y, sw.z), 0.3, { sw });
      // 店裡的商品（母港漁具行、海上修船屋、大港灣島）：對準商品本身或它的價格牌都算
      for (const it of ALL_SHELF_W) {
        if (Math.hypot(px - it.stand.x, pz - it.stand.z) > 1.7) continue;
        add('shelf', new THREE.Vector3(it.x, it.y + 0.25, it.z), 0.5, { shelf: it });
        add('shelf', new THREE.Vector3(it.tagW.x, it.tag.y, it.tagW.z), 0.45, { shelf: it });
      }
    }
  }
  // 漂流寶箱（在船上也撿得到）
  {
    const c = havenFx.chestNear(player.pos.x, player.pos.y, player.pos.z);
    if (c) add('chest', c.pos, 0.6, { chest: c, rayMesh: c.mesh, rayR: 0.75 });
  }
  // 旁邊的人：手上拿著魚、抱著自己的箱子時可以送給他
  if (hb || (held && !held.can)) {
    for (const [id, o] of others.map) {
      const fig = o.fig && o.fig.mesh;
      if (!fig || !o.st || !fig.visible) continue;   // o.st：收到過他的位置（還在線上）
      const p = fig.getWorldPosition(new THREE.Vector3());
      if (Math.hypot(p.x - player.pos.x, p.z - player.pos.z) > FISHBOX.giveReach || Math.abs(p.y - player.pos.y) > 1.5) continue;
      add('player', p.setY(p.y + 1.1), 0.45, { pid: id, name: o.name });
    }
  }
  // 空手才能撿地上／甲板／籃子裡的魚或油桶（拿著魚或抱著箱子時不加入，避免要放進箱子／籃子卻被地上的魚搶走準心）
  if (!carrying && fishing.state === 'idle') for (const it of [...fish.items, ...fish.basket]) {
    if (it.fly || (it.boat && it.boat.stored)) continue;   // 還在飛／在收進倉庫的船上
    const v = fish.worldPos(it, new THREE.Vector3());
    if (Math.hypot(v.x - player.pos.x, v.z - player.pos.z) > 1.8 || Math.abs(v.y - player.pos.y) > 1.3) continue;
    v.y += it.can ? 0.2 : it.thick / 2;
    add('item', v, it.can ? 0.28 : clamp(it.len * 0.35, 0.2, 0.42), { item: it, rayMesh: it.mesh, rayR: it.can ? 0.45 : Math.max(0.5, (it.len || 0.6) * 0.7) });
  }
  const pickPass = (orig, dir, minT, maxT) => {
    const candidates = list.slice();
    if ((!held || !held.can) && !player.roof) {   // 抱著魚箱時只找魚艙（倒進去、裝出來）；在瞭望台上搆不到甲板的箱子
      for (const hit of boxes.pick(orig, dir, player.pos, { fp, myId: net.id, tMin: minT, wantOut: !hb && !held && fishing.state === 'idle', putOnly: !!(held && !held.can), onlyHatch: !!hb })) {
        candidates.push(hit);
      }
    }
    if (!candidates.length) return null;
    _aimRay.set(orig, dir);
    _aimRay.near = Math.max(0, minT);
    _aimRay.far = maxT;
    let best = null, bs = 1, bestDirect = false, bestT = Infinity;
    for (const c of candidates) {
      let t, off, tol, direct, hitT, score;
      if (c.obb) {
        if (c.t > maxT) continue;
        t = c.t; off = c.off; tol = c.r;
        direct = off <= 0.001;
        hitT = direct ? t : Infinity;
        score = off / tol;
      } else {
        _aimV.copy(c.pos).sub(orig);
        t = _aimV.dot(dir);
        if (t < minT || t > maxT) continue;
        tol = c.r + (fp ? 0.03 * t : 0.3);
        off = Math.sqrt(Math.max(0, _aimV.lengthSq() - t * t));
        if (c.rayMesh) {
          let hit = null;
          if (off <= (c.rayR ?? tol)) {
            c.rayMesh.updateMatrixWorld(true);
            _aimHits.length = 0;
            _aimRay.intersectObject(c.rayMesh, true, _aimHits);
            hit = _aimHits.find((h) => (h.object.visible || h.object.userData?.batched) && !h.object.userData?.hull && !h.object.userData?.camProxy) ?? null;
          }
          direct = !!hit;
          hitT = hit ? hit.distance : Infinity;
          score = direct ? off / Math.max(tol, c.rayR || 1) * 0.01 : off / tol;
        } else {
          direct = off <= c.r;
          hitT = direct ? Math.max(minT, t - c.r * 0.5) : Infinity;
          score = off / tol;
        }
      }
      if (!direct && score >= 1) continue;
      if (!best || (direct !== bestDirect ? direct : direct ? (hitT < bestT - 0.02 || (Math.abs(hitT - bestT) <= 0.02 && score < bs)) : score < bs)) {
        best = c; bs = score; bestDirect = direct; bestT = hitT;
      }
    }
    return best;
  };
  const best = pickPass(_aimO, _aimD, Math.max(0, t0), Math.max(6, t0 + 6));
  if (best || fp) return best;
  // 第三人稱隱藏準心時，若過頭頂的鏡頭視線未直接指到，改由胸前朝鏡頭水平方位補抓眼前的可互動物件
  _aimFbO.set(player.pos.x, player.pos.y + 0.92, player.pos.z);
  _aimFbD.set(Math.cos(view.walk.yaw), -0.25, Math.sin(view.walk.yaw)).normalize();
  return pickPass(_aimFbO, _aimFbD, 0, 2.3);
}

/**
 * 依目前準心對準的目標回傳要加上綠色粗描邊的 3D 物件與深度忽略物件。
 */
function aimOutlineTargets(a) {
  if (!a) return null;
  switch (a.kind) {
    case 'fpile': return { objs: [a.fishMesh], ignore: null };
    case 'fbox': return { objs: [a.mesh], ignore: [a.inner] };
    case 'hatch': return { objs: [a.mesh], ignore: [a.inner] };
    case 'item': return { objs: [a.item?.mesh], ignore: null };
    case 'chest': return { objs: [a.chest?.mesh], ignore: null };
    case 'player': return { objs: [others.map.get(a.pid)?.fig?.mesh], ignore: null };
    case 'helm': return { objs: [a.boat?.parts?.wheel || a.boat?.parts?.tiller], ignore: null };
    case 'tank': return { objs: [a.boat?.parts?.tankObj], ignore: null };
    case 'lamp': return { objs: [a.boat?.parts?.switchObj], ignore: null };
    case 'fishLamp': return { objs: [a.boat?.parts?.bowLamp], ignore: null };
    case 'seat': return { objs: [a.seat?.mesh], ignore: null };
    case 'ladder': return { objs: [a.boat?.parts?.ladderObj], ignore: null };
    default: return null;
  }
}

// E：對準什麼就做什麼——掌舵／拿起魚／開魚箱／加油／開關船燈／坐下／綁纜繩／賣魚／買東西／修船台修船。
// 手上拿著東西時：對準魚箱、籃子、油箱就放進去（倒進去），沒對準就放在面前
function interact() {
  if (mode === 'sink') return;
  if (mode === 'helm') return releaseHelm();
  if (player.swim || drown) return;   // 在水裡騰不出手
  const a = aimTarget(), kind = a ? a.kind : '';
  if (kind === 'hook') return havenSell();
  if (kind === 'chest') {
    if (!net.online) return toast('連線中斷，等接回去再試');
    return net.send({ t: 'chest', id: a.chest.id });
  }
  const hb = heldBox();
  if (hb) {
    // 抱著魚箱：對準籃子整箱賣、對準人送給他，其他就放下（大港的大秤在上面 havenSell）
    if (kind === 'basket') {
      if (!hb.fish.length) return toast('魚箱是空的');
      if (!net.online) return toast('連線中斷，等接回去再賣');
      return net.send({ t: 'sell', bid: hb.bid });
    }
    if (kind === 'player') return giveTo(a, { bid: hb.bid });
    if (kind === 'hatch' && a.box.open) return hatchPour(a.box);
    return putBoxDown(hb);
  }
  if (fish.held && fish.held.can) {
    // 提著油桶：對準油箱的加油口就倒進去，倒不完的留在桶裡；沒對準就放下
    const can = fish.held, b = kind === 'tank' && !can.chum ? a.boat : null, room = b ? b.spec.tank - b.fuel : 0;   // 誘魚桶不能倒進油箱：放下
    if (room < 0.1) return fish.drop();
    const pour = Math.min(can.liters, room);
    b.fuel += pour; can.liters -= pour;
    audio.play('pour');
    if (can.liters < 0.1) { fish.discardHeld(); toast(`油倒進去了，油箱 ${litres(b.fuel)} / ${b.spec.tank} 公升`); }
    else toast(`油箱加滿了，桶裡還剩 ${litres(can.liters)} 公升`);
    return;
  }
  if (fish.held) {
    if (kind === 'fbox') return fishIntoBox(a.box);
    if (kind === 'hatch') return a.box.open ? fishIntoBox(a.box) : hatchLid(a.box, true);   // 艙蓋關著：先打開（拿著魚也能用腳踢開）
    if (kind === 'player') return giveTo(a, { uid: fish.held.uid });
    if (kind === 'basket') refreshBoard(fish.toBasket());
    else fish.drop();
    audio.play('drop');
    return;
  }
  if (kind === 'seat' && player.seat && player.seat.src === a.seat) return standUp();
  if (fishing.state !== 'idle') return;   // 手上拿著釣竿
  switch (kind) {
    case 'helm': return takeHelm();
    case 'bollard': {
      const mr = a.moor;
      if (mr.mate) return mateCtl(mr.boat, mr.tied ? 'unmoor' : 'moor', mr.tied ? `幫 ${mr.boat.owner.name} 解開了${mr.boat.spec.name}的纜繩` : `幫 ${mr.boat.owner.name} 把${mr.boat.spec.name}的纜繩綁好了`, 'rope', mr.i);
      if (mr.tied) { mr.boat.moor = null; toast(`解開了${mr.boat.spec.name}的纜繩`); } else { tieBoat(mr); toast(`${mr.boat.spec.name}的纜繩綁好了`); }
      audio.play('rope');
      return;
    }
    case 'item':
      if (a.item.remote) {
        // 別人放在外面的魚：只有魚的主人、或主人的隊友能拿（伺服器也會擋）。先問伺服器（同時有人去拿，先到的拿到），回話見 grabbed / grabNo
        if (!canGrab(a.item)) return toast(`這是 ${others.map.get(a.item.mine)?.name ?? '別人'} 的魚，只有他和他的隊友能拿`);
        if (!net.online) return toast('連線中斷，等接回去再撿');
        if (grabbing) return;
        grabbing = a.item.uid;
        window.setTimeout(() => { if (grabbing === a.item.uid) grabbing = 0; }, 1500);
        return net.send({ t: 'grab', uid: a.item.uid });
      }
      audio.play('pick');
      fish.pick(a.item);
      if (a.item.state === 'held') refreshBoard();
      return;
    case 'fbox':   // 自己的箱子抱起來（裡面的魚一起）；別人的搬不動
      if (a.box.o !== net.id) return toast(`這是 ${others.map.get(a.box.o)?.name ?? '別人'} 的魚箱，只有他搬得動`);
      if (!net.online) return toast('連線中斷，等接回去再搬');
      return net.send({ t: 'boxTake', bid: a.box.bid });
    case 'hatch': return hatchLid(a.box, !a.box.open);
    case 'fpile':   // 從自己的箱子拿出指到的那一條魚
      if (!net.online) return toast('連線中斷，等接回去再拿');
      return net.send({ t: 'boxOut', bid: a.box.bid, uid: a.fish?.uid });
    case 'lamp':
      if (!simmed(a.boat)) return mateCtl(a.boat, 'lamp', a.boat === myBoat ? (a.boat.lampOn ? '船燈關掉了' : '船燈打開了') : a.boat.lampOn ? '幫隊友把船燈關掉了' : '幫隊友把船燈打開了', 'switch');   // 隊友的船：請算那艘船的那一邊照做
      a.boat.lampOn = !a.boat.lampOn;
      audio.play('switch');
      return toast(a.boat.lampOn ? '船燈打開了' : '船燈關掉了');
    case 'fishLamp':
      if (!simmed(a.boat)) return mateCtl(a.boat, 'fishLamp', a.boat === myBoat ? (a.boat.fishLamp ? '集魚燈關掉了' : '集魚燈打開了') : a.boat.fishLamp ? '幫隊友把集魚燈關掉了' : '幫隊友把集魚燈打開了', 'switch');
      return toggleFishLamp(a.boat);
    case 'tow':
      if (a.boat === myBoat) return doTow(towAction(myBoat));
      return doTow(towOfId(net.id) ? { cut: true } : { cut: false, to: a.boat.owner.id }, true);   // 別人的船：請他拖我的船
    case 'seat': return sitDown(a.boat, a.seat);
    case 'ladder': return player.startClimb(a.boat, a.up);
    case 'switch': {
      // 室內燈：先在自己這邊換（按下去馬上有反應），再告訴伺服器，它會轉給同房的每個人
      if (!net.online) return toast('連線中斷，等接回去再按');
      const on = !ROOM_LIGHTS[a.sw.zone].on;
      applyRoomLights({ [a.sw.zone]: on });
      audio.play('switch');
      return net.send({ t: 'light', zone: a.sw.zone, on });
    }
    case 'button': {
      // 賣魚：籃子是大家共用的，按一下整籃賣掉，每條的錢由伺服器付給釣到牠的人（送過人的付給收下的人；見下面的 sold）
      if (!fish.basket.length) return;
      if (!net.online) return toast('連線中斷，等接回去再賣');
      return net.send({ t: 'sell' });
    }
    case 'shelf': {
      const id = a.shelf.id;
      if (id === 'repair') return repairAt(a.shelf);
      // 油桶帶得了幾桶看現在這艘船（小舢舨 2、近海漁船 4、遠洋大漁船 6）
      if (id === 'fuel' && fish.cans.length >= myBoat.spec.maxCans) return toast(`${myBoat.spec.name}最多帶 ${myBoat.spec.maxCans} 桶油，手邊的先倒進油箱再買`);
      if (id === 'title' || id === 'mailbox' || id === 'altar' || id === 'paint') return openStation(id);
      const o = offer(id);
      if (o.price === null) return toast(o.why || `${o.lines[0]}：${o.lines[1]}`);
      if (money < o.price) return toast(`錢不夠，${o.name}要 $${o.price}`);
      if (buying || !net.online) return;
      buying = true;
      window.setTimeout(() => { buying = false; }, 1500);
      return net.send({ t: 'buy', id: a.shelf.id });
    }
    default: if (player.seat) standUp();
  }
}

// ---- 丟：拿著魚或油桶時按住右鍵（手機按住「丟」鈕）蓄力，放開就往準心的方向丟出去 ----
// 蓄越久丟越遠（THROW.charge 秒蓄滿）；從手的位置出手，飛出去之後的落地、彈跳、掉進籃子魚箱或海裡見 fish.js 的 _fly
let throwT = -1;   // 蓄力了多久（秒）；-1 = 沒在蓄力
const canThrow = () => inGame && mode === 'walk' && !!fish.held && !player.swim && !drown && !tabOpen() && !chat.isOpen && !wheel.isOpen && !$('panel').open;
const _thO = new THREE.Vector3(), _thD = new THREE.Vector3();
function throwStart() { if (canThrow()) throwT = 0; }
function throwCancel() { throwT = -1; $('throwBar').style.display = 'none'; }
function throwEnd() {
  if (throwT < 0) return;
  const k = clamp(throwT / THROW.charge, 0, 1);
  throwCancel();
  if (!canThrow()) return;
  const it = fish.held;
  camera.getWorldDirection(_thD);
  // 人先轉向要丟的方向（第三人稱時人不一定面對準心），東西才會從胸前正對著準心出手
  if (!player.seat) { player.yaw = Math.atan2(_thD.z, _thD.x); player.mesh.rotation.y = -player.yaw; player.mesh.updateMatrixWorld(true); }
  it.mesh.getWorldPosition(_thO);
  _thD.multiplyScalar(THROW.minSpeed + (THROW.maxSpeed - THROW.minSpeed) * k);
  const b = player.boat;   // 站在開著的船上：東西也帶著船的速度
  if (b) { _thD.x += Math.cos(b.heading) * b.speed; _thD.z += Math.sin(b.heading) * b.speed; }
  fish.throwHeld(_thO, _thD);
  audio.play('cast', 0.6);
}
function throwTick(dt) {
  if (throwT < 0) return;
  if (!canThrow()) return throwCancel();
  throwT += dt;
  const bar = $('throwBar');
  bar.style.display = 'block';
  bar.firstChild.style.width = `${Math.round(clamp(throwT / THROW.charge, 0, 1) * 100)}%`;
}

// 手機掌舵時的拖船鈕（電腦是按 T）
const towBtn = document.createElement('button');
towBtn.style.cssText = 'position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:17;display:none;padding:9px 18px;border-radius:999px;'
  + 'border:2px solid var(--edge);background:var(--paper);color:var(--ink);font:600 15px var(--font);box-shadow:var(--shadow);white-space:nowrap';
towBtn.addEventListener('click', (e) => { e.preventDefault(); towBtn.blur(); doTow(towAction(boat)); });
document.body.appendChild(towBtn);
// 畫面下方的提示：能做什麼就顯示什麼
let promptText = null, aimHit = false;
let hudSky = '';
function updatePrompt() {
  let text = '';
  const a = feedbackOpen() ? null : aimTarget(), kind = a ? a.kind : '';   // 意見卡開著：不顯示「按 E」
  if (!!a !== aimHit) { aimHit = !!a; $('aim').classList.toggle('hit', aimHit); }   // 對準了東西：準心變成金色的大圈
  if (mode === 'walk') {
    const ab = a && a.boat;
    if (player.swim) {
      text = stamina < 0.3 ? '快沒力了！趕快上岸，或游到船邊爬上去'
        : fish.held ? `捧著${fish.held.sp.name}游：比較慢，也比較累` : heldBox() ? '抱著魚箱游：比較慢，也比較累，上岸或爬上船再放下' : '';
    } else if (kind === 'hook') {
      text = hookText();
    } else if (kind === 'chest') {
      text = '按 E 打開漂流寶箱';
    } else if (heldBox()) {
      const hb = heldBox(), n = hb.fish.length;
      text = kind === 'basket' ? (n ? `按 E 整箱賣出（${n} 條，$${boxes.value(hb)}）` : '魚箱是空的')
        : kind === 'player' ? `按 E 把魚箱（${n} 條）送給 ${a.name}（對方要按接受）`
          : kind === 'hatch' && a.box.o === net.id && a.box.open ? (n ? `按 E 把魚箱裡的 ${n} 條倒進魚艙（艙內 ${a.box.fish.length} 條）` : a.box.fish.length ? `按 E 從魚艙裝魚到魚箱（艙內 ${a.box.fish.length} 條）` : '魚艙和魚箱都是空的')
          : `抱著魚箱（${n} 條、${boxes.kg(hb).toFixed(1)} 公斤${boxes.speed(hb) < 0.99 ? '，走得比較慢' : ''}）　按 E 放下`;
    } else if (fish.held && fish.held.chum) {
      text = `誘魚桶（身上 ${kit.chum || 0} 桶）　右鍵蓄力丟進海裡就施放，按 E 放下`;
    } else if (fish.held && fish.held.can) {
      const b = kind === 'tank' ? ab : null;
      text = b && b.spec.tank - b.fuel >= 0.1 ? `按 E 把油倒進油箱（${litres(b.fuel)} / ${b.spec.tank} 公升）`
        : `${itemLabel(fish.held)}${b ? '　油箱是滿的' : ''}　按 E 放下${!b && nearTank() ? '（對準油箱可以加油）' : ''}，右鍵蓄力丟出去`;
    } else if (fish.held) {
      text = kind === 'basket' ? '按 E 把魚放進籃子'
        : kind === 'fbox' ? boxInText(a.box)
          : kind === 'hatch' ? (a.box.open ? boxInText(a.box) : hatchMine(a.box) ? `按 E 打開${hatchWho(a.box)}艙蓋` : hatchText(a.box))
          : kind === 'player' ? `按 E 把${fish.held.sp.name}送給 ${a.name}（對方要按接受）`
            : `${fishLabel(fish.held)}　按 E 放下${nearBasket() ? '（對準籃子可以放進去）' : ''}，右鍵蓄力丟出去`;
    } else if (fishing.state === 'wait') text = '等魚上鉤…（按 F 收回）';
    else if (fishing.state === 'bite') text = '魚咬了！快按 F';
    else if (fishing.state !== 'idle') text = '';
    else if (kind === 'helm') text = ab === myBoat ? (piloted ? `按 E 從 ${piloted.name} 手上接回方向盤` : '按 E 掌舵') : `按 E 幫 ${ab.owner.name} 掌舵（同隊隊友）`;
    else if (kind === 'tow') {
      const act = ab === myBoat ? towAction(myBoat) : null;
      text = ab === myBoat ? (act ? `按 E ${act.text}` : `拖船樁　把船尾靠近別人的船（${TOW.reach} 公尺內），就能請求拖行他`)
        : towOfId(net.id) ? '按 E 解開拖纜' : `按 E 請 ${ab.owner.name} 拖行你的${myBoat.spec.name}（要停在他船尾 ${TOW.reach} 公尺內）`;
    }
    else if (kind === 'bollard') { const who = a.moor.mate ? ` ${a.moor.boat.owner.name} 的` : ''; text = a.moor.tied ? `按 E 解開${who}${a.moor.boat.spec.name}的纜繩` : `按 E 把${who}${a.moor.boat.spec.name}的纜繩綁在這根樁上`; }
    else if (kind === 'item') text = a.item.remote ? remoteFishText(a.item) : `按 E 拿起${a.item.can ? itemLabel(a.item) : a.item.sp.name}`;
    else if (kind === 'fbox') {
      const d = a.box, n = d.fish.length;
      text = d.o === net.id ? `按 E 抱起魚箱（${n ? `${n} 條、${boxes.kg(d).toFixed(1)} 公斤` : '空的'}）`
        : `${others.map.get(d.o)?.name ?? '別人'} 的魚箱（${n} 條）：只有他搬得動，可以把魚放進去送給他`;
    } else if (kind === 'hatch') text = hatchText(a.box);
    else if (kind === 'fpile') text = `按 E 拿出${a.name || '一條魚'}（${a.box.h ? '艙' : '箱'}內 ${a.box.fish.length} 條）`;
    else if (kind === 'tank') text = `油箱　${litres(ab.fuel)} / ${ab.spec.tank} 公升（提著油桶對準這裡按 E 加油）`;
    else if (kind === 'lamp') text = ab.lampOn ? '按 E 關掉船燈' : '按 E 打開船燈';
    else if (kind === 'fishLamp') text = ab.fishLamp ? '按 E 關掉船首集魚燈' : `按 E 打開船首集魚燈（夜裡船邊趨光魚多 ${ab.spec.lampMul} 倍）`;
    else if (kind === 'seat') text = player.seat && player.seat.src === a.seat ? '按 E 站起來' : '按 E 坐下';
    else if (kind === 'ladder') text = a.up ? '按 E 爬上瞭望台' : '按 E 爬下梯子';
    else if (kind === 'button') text = fish.basket.length ? `按 E 按下按鈕賣出（$${fish.basketTotal}）` : '把魚拿過來放進籃子，就會顯示價格';
    else if (kind === 'basket') text = '把魚拿過來放進籃子，就會顯示價格';
    else if (kind === 'switch') text = `按 E ${ROOM_LIGHTS[a.sw.zone].on ? '關掉' : '打開'}${ZONE_LABEL(a.sw.zone)}`;
    else if (kind === 'shelf') {
      const id = a.shelf.id, o = offer(id);
      text = id === 'repair' ? repairText(a.shelf)
        : id === 'title' ? '按 E 打開【漁會捐款箱】（自由捐獻，每週功德榜奪稱號）'
          : id === 'mailbox' ? '按 E 投遞【漁會意見信箱】'
            : id === 'altar' ? '按 E 向海神祈福（黃金魚潮／風暴海神祭）'
              : id === 'paint' ? '按 E 打開船殼塗裝預覽（五種顏色）'
                : o.price === null ? (o.why || `${o.lines[0]}：${o.lines[1]}`)
                  : money >= o.price ? `按 E ${o.act || `購買${o.name}`}　$${o.price}${o.note ? `（${o.note}）` : ''}` : `${o.name}　$${o.price}（錢不夠）`;
    } else if (player.boat && player.boat.remote && nearHelm()) text = party.has(player.boat.owner.id) ? `這是隊友 ${player.boat.owner.name} 的${player.boat.spec.name}：他沒在開的時候，對準方向盤按 E 可以幫忙掌舵` : `這是 ${player.boat.owner.name} 的${player.boat.spec.name}：可以搭，只有船主和他的隊友能開`;
    else if (player.seat) text = '坐著（按 E 或移動鍵站起來）';
  } else if (mode === 'helm') {
    $('hBoat').textContent = boat.aground ? '擱淺' : `${((boat.moveSpeed ?? Math.abs(boat.speed)) * 1.944).toFixed(1)} 節`;
    // 拖船：附近有船可以拖、或拖纜連著的時候才提示（電腦按 T，手機是畫面下方的拖船鈕）
    const act = tabOpen() ? null : towAction(boat), label = act ? `🪝 ${act.text}` : '';
    if (act && !TOUCH) text = `按 T ${act.text}`;
    if (TOUCH && towBtn.textContent !== label) towBtn.textContent = label;
    towBtn.style.display = TOUCH && act ? 'block' : 'none';
  }
  if (mode !== 'helm') towBtn.style.display = 'none';
  {
    // 右上角：時間和天氣的小圖示（詳細的在平板的「天氣」；拿著平板時隱藏，避免與平板頂部狀態列重複）
    $('hud').style.display = tabOpen() ? 'none' : '';
    const c = clockOf(climate.hour), sk = skyNow(), t = `${c.part} ${c.hm}`;
    if ($('hClock').textContent !== t) $('hClock').textContent = t;
    if (hudSky !== sk.icon + sk.text) { hudSky = sk.icon + sk.text; $('hSky').innerHTML = ICON[sk.icon]; $('hSky').title = sk.text; }
  }
  // 準備合併：倒數到最後半秒畫面先暗下來（換過去之後再亮起來）
  if (mergeAt && !wreck && !drown) {
    const left = mergeAt - performance.now();
    if (left < 700) $('fade').style.opacity = clamp(1 - left / 700, 0, 1);
    if (left < -4000) { mergeAt = 0; $('fade').style.opacity = 0; }   // 等太久沒合併成：恢復
  }
  // 人在船上時顯示這艘船的耐久與燃油
  const hb = mode === 'helm' ? boat : mode === 'walk' ? player.boat : null;
  $('hShip').style.display = hb ? 'flex' : 'none';
  if (hb) {
    $('hHp').textContent = hpText(hb);
    $('hHp').className = hb.hp < hb.spec.hp * 0.35 ? 'low' : '';
    $('hFuel').textContent = `${litres(hb.fuel)} / ${hb.spec.tank} 公升`;
    $('hFuel').className = hb.fuel < hb.spec.tank * 0.15 ? 'low' : '';
  }
  if (toastState.until && performance.now() > toastState.until) { toastState.until = 0; $('toast').style.display = 'none'; }
  if (!inGame) text = '';
  else if (mode === 'walk' && Number.isFinite(player.boat?.reclaimAt)) {
    const sec = Math.max(0, Math.ceil((player.boat.reclaimAt - performance.now()) / 1000));
    const warning = sec > 0 ? `船主已離線，${sec} 秒後回港` : '船主已離線，準備回港';
    text = text ? `${warning}　｜　${text}` : warning;
  }
  // 手機按鈕先更新：提示裡畫的「互動」圖示要跟按鈕現在的樣子一樣
  touch.update({
    on: inGame && !tabOpen() && !chat.isOpen && !wheel.isOpen, helm: mode === 'helm', sink: mode === 'sink', held: !!fish.held && !player.swim,
    target: !!a || mode === 'helm' || !!fish.held || !!heldBox() || !!player.seat,
    act: mode === 'helm' ? '放手' : kind === 'player' ? '送給他' : heldBox() ? (kind === 'basket' ? '賣出' : kind === 'hatch' && a.box.open && a.box.o === net.id ? (heldBox().fish.length ? '倒進去' : '裝魚') : '放下')
      : fish.held ? (kind === 'tank' || kind === 'basket' || kind === 'fbox' || (kind === 'hatch' && a.box.open) ? '放進去' : kind === 'hatch' ? '開艙' : '放下')
      : kind === 'hatch' ? (a.box.open ? '關艙' : '開艙')
      : kind === 'ladder' ? (a.up ? '爬上去' : '爬下去')
      : kind === 'fpile' ? '取出' : kind === 'fbox' && a.box.o === net.id ? '抱起' : player.seat && !a ? '站起來' : '互動',
  });
  touchSet($('prompt'), text);   // 字和圖示都沒變時它自己會跳過
  if (text !== promptText) {
    promptText = text;
    $('prompt').style.display = text ? 'block' : 'none';
  }
  updateKeybar();
  touch.bTab?.classList.toggle('hasNew', inGame && unreadCount() > 0);   // 手機右上角平板鈕的小紅點（有沒看過的更新資訊）
}

// 電腦版右下角的按鍵提示：走路、開船各一組，拿著東西時多一個「右鍵 丟」
const KEYBAR = {
  walk: [['F', '釣魚'], ['B', '換餌'], ['G', '表情'], ['Tab', '平板'], ['C', '視角'], ['Enter', '聊天']],
  held: [['E', '放下'], ['右鍵', '丟'], ['Tab', '平板'], ['C', '視角'], ['Enter', '聊天']],
  helm: [['W S', '油門'], ['A D', '方向'], ['E', '放手'], ['T', '拖船'], ['Tab', '平板'], ['C', '視角']],
};
let keybarSet = '';
function updateKeybar() {
  const set = TOUCH || !inGame || tabOpen() || chat.isOpen || wheel.isOpen || mode === 'sink' ? ''
    : mode === 'helm' ? 'helm' : fish.held && !player.swim ? 'held' : 'walk';
  const dot = set && unreadCount() > 0 ? '!' : '';   // 「Tab 平板」旁的小紅點：有沒看過的更新資訊
  if (set + dot === keybarSet) return;
  keybarSet = set + dot;
  const el = $('keybar');
  el.style.display = set ? 'flex' : 'none';
  el.innerHTML = set ? KEYBAR[set].map(([k, t]) => `<span>${k.split(' ').map((x) => `<kbd>${x}</kbd>`).join('')}${t}${dot && k === 'Tab' ? '<i class="kdot"></i>' : ''}</span>`).join('') : '';
}

// ---- 介面 -----------------------------------------------------------------
const audio = new OceanAudio();
// 魚群熱點、漂流寶箱的畫面（什麼時候有、在哪裡，照伺服器說的）
const havenFx = makeHavenFx({
  scene, shade, splash, waterY, flood: () => flood, mist: (x, y, z, vx, vy, vz, life, size) => spray.emit(x, y, z, vx, vy, vz, life, size),
  // 地面多高：大港灣島照畫出來的那張地面，其他地方照海床
  groundAt: (x, z) => { const [vx, vz] = havenToLocal(x, z), VG = HAVEN_GROUND, vh = VG.size / 2 - 2; return HAVEN_LAND.at && Math.abs(vx - VG.cx) < vh && Math.abs(vz - VG.cz) < vh ? HAVEN_LAND.at(vx, vz) : bedAt(x, z); },
  onHot: (h) => toast(`${h.unlimited ? '✨ 海上湧現黃金魚群（不限尾數）' : '海上出現魚群（海鳥在上空盤旋）'}，離你約 ${Math.round(Math.hypot(h.x - player.x, h.z - player.z) / 10) * 10} 公尺。按 M 看地圖`),
});
// 海鷗、海豚、海龜、魚群、螃蟹、鯨魚、鯊魚背鰭（純畫面，各人各的；只有海鷗偷魚會真的拿走一條小魚）。數字見 wildPlan.js、行為見 wildlife.js
const _wildPerches = [], _gullV = new THREE.Vector3();
const wildlife = makeWildlife({
  scene, camera, shade, splash, waterY, bedAt, offAt,
  mist: (x, y, z, vx, vy, vz, life, size) => spray.emit(x, y, z, vx, vy, vz, life, size),
  tier: () => { const p = Math.max(0, presetOf()); return TOUCH ? (p <= 0 ? 0 : 1) : (p >= 2 ? 3 : 2); },   // 畫質檔：0 手機低、1 手機中／高、2 電腦低／中、3 電腦高
  world: () => ({
    day: 1 - night,
    weatherK: clamp(1 - rainNow * 3, 0, 1) * clamp(1 - sea.storm * 0.8, 0, 1),
    omen: sea.fishStorm === 'before' || sea.phase === 'whirl',   // 風暴、水龍捲快來了
    storm: sea.storm > 0.6 || ['storm', 'thunder', 'typhoon', 'waves'].includes(sea.phase),
  }),
  player: () => player.pos,
  boats: () => boats,
  myBoat: () => myBoat,
  harbor: { x: QUAY_CENTER_W.x, z: QUAY_CENTER_W.z },
  haven: { x: HAVEN_SELL_W.x, z: HAVEN_SELL_W.z },
  perches: () => {   // 岸上海鷗能停的點：繫纜樁、燈柱頂（大港那邊的繫纜樁在 seascape 之後才接進 BOLLARDS，所以第一次要用才組）
    if (!_wildPerches.length) {
      for (const p of BOLLARDS) _wildPerches.push({ x: p.x, y: (p.y ?? DECK_Y + 0.5) + 0.12, z: p.z });
      for (const p of LAMPS) _wildPerches.push({ x: p.x, y: p.y + 0.38, z: p.z });
    }
    return _wildPerches;
  },
  toWorld: (x, z) => toWorld(x, z),
  crabGround: (x, z) => {   // 螃蟹能不能待在這：要是乾的沙地（不是牆、棧板、屋頂底下、水邊）
    const y = walkGround(x, z);
    if (y >= 50 || y < 0.12 || bedAt(x, z) < -0.3) return null;
    return underRoof(x, y + 0.5, z) ? null : y;
  },
  stealables: () => fish.items.filter((it) => !it.remote && it.uid && !it.can && (it.state === 'ground' || (it.state === 'boat' && it.boat && !it.boat.sinking))),
  itemPos: (it, out) => fish.worldPos(it, out),
  steal: (it) => fish.steal(it),
  cry: (x, y, z, v, rate) => audio.play('gull', 0.6 * v, { x, y, z }, rate),   // 單隻海鷗叫一聲：從牠的方向傳過來
});
// 在水裡游的人騰不出手按 E：游到自己浮在水面的魚箱旁邊就直接抱起來（抱著游比較慢、比較累，上岸或爬上船再放下）
const boxAsked = new Map();
function boxSwim() {
  if (!player.swim || !net.online || heldBox() || fish.held) return;
  const now = performance.now();
  for (const d of boxes.mine(net.id)) {
    if (d.k !== 'w') continue;
    const p = boxes.worldPos(d);
    if (Math.hypot(p.x - player.pos.x, p.z - player.pos.z) > FISHBOX.reach || now - (boxAsked.get(d.bid) ?? 0) < 1500) continue;
    boxAsked.set(d.bid, now);
    toast('抱起魚箱了：抱著游比較慢也比較累，上岸或爬上船再放下');
    return net.send({ t: 'boxTake', bid: d.bid });
  }
}
// 在水裡游的人騰不出手按 E：游到漂流寶箱旁邊就直接撿
let chestAsked = 0;
function chestSwim() {
  if (!player.swim || !net.online) return;
  const c = havenFx.chestNear(player.pos.x, player.pos.y, player.pos.z);
  if (c && c.id !== chestAsked) { chestAsked = c.id; net.send({ t: 'chest', id: c.id }); }
}

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
const quality = $('quality');
quality.min = RATIO_MIN;
quality.max = RATIO_MAX;
quality.value = pixelRatio;
$('vQuality').textContent = `${pixelRatio.toFixed(1)}×`;
if (TOUCH) $('resolutionNote').textContent = `預設 ${baseRatio.toFixed(1)}×。倍率越高，畫面越清楚，繪圖負載也越大。`;
quality.addEventListener('input', () => { setPixelRatio(quality.valueAsNumber); ratioSaved = true; setPref('stormcast.res', pixelRatio); });
// 陰影「低」：海面、地形、草的陰影取樣點減半（著色器裡的 LITE），要重新編譯這幾個材質
function applyLite() {
  scene.traverse((o) => {
    const m = o.material;
    if (!m || !m.isShaderMaterial || !m.fragmentShader.includes('sunShadow(')) return;
    const plus = wantShPlus(), tent = plus === 1;
    if (!!m.defines.LITE === gfx.lite && !!m.defines.SH_PLUS === !!plus && !!m.defines.SH_TENT === tent) return;
    if (gfx.lite) m.defines.LITE = 1; else delete m.defines.LITE;
    if (plus) m.defines.SH_PLUS = 1; else delete m.defines.SH_PLUS;
    if (tent) m.defines.SH_TENT = 1; else delete m.defines.SH_TENT;
    m.needsUpdate = true;
  });
}
// 照 gs 套用到畫面上（只動有變的部分）。viewReady：鏡頭、人物都建好之後才能動鏡頭視角
let viewReady = false;
function applyGfx() {
  gfx = deriveGfx();
  qualityTiming.reset();
  mobileShadowClock.reset();
  if (SHADOW_HALF !== gfx.shadowHalf) {
    SHADOW_HALF = gfx.shadowHalf;
    Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF });
    sun.shadow.camera.updateProjectionMatrix();
  }
  if (!gfx.shadowOn && shared.uShadowOn.value) {
    // 陰影整個關掉：太陽不投影（內建材質會自己換一份不算影子的程式），自己寫的著色器也不取樣
    shared.uShadowOn.value = 0; shared.uShadowMap.value = null;
  }
  if (SHADOW_SIZE !== gfx.shadow) {
    // 陰影貼圖換大小：舊的丟掉，下一幀會照新的大小重做一張
    SHADOW_SIZE = gfx.shadow;
    sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    shared.uShadowMap.value = null; shared.uShadowOn.value = 0;
    shared.uShadowTexel.value = 1 / SHADOW_SIZE;
  }
  syncShadowPlus();   // 太陽投不投影、電腦版那四盞投影燈開不開，都在這裡決定
  if (gfx.grass > 0 && grassN !== gfx.grass) {
    grassN = gfx.grass;
    grass.geometry.dispose();
    grass.geometry = makeGrassGeometry(grassN, GRASS_T);
  }
  // 島上的草叢（港口模型裡的低面草）：無、少（三分之一）、多（全部）
  harbor.traverse((o) => {
    if (!o.userData.tuft) return;
    o.userData.full ??= o.count;
    o.count = [0, Math.floor(o.userData.full / 3), o.userData.full][gfx.grassLevel] ?? o.userData.full;
    o.visible = o.count > 0;
  });
  applyLite();
  // 多重取樣：場景那兩張緩衝區（環境光遮蔽要的深度也在上面）改取樣數，換的時候丟掉舊的，下一幀照新的重做
  const ms = gfx.msaa ? 4 : 0;
  if (composer.renderTarget1.samples !== ms) for (const t of [composer.renderTarget1, composer.renderTarget2]) { t.samples = ms; t.dispose(); }
  shared.uHazeK.value = gfx.haze;
  detailUniform.value = gs.tex && !TOUCH ? 1 : 0;
  if (viewReady) { applyViewSettings(); onResize(); }
  syncGfxUi();
}
function saveGfx() { setPref('stormcast.gfx4', JSON.stringify(gs)); gfxSaved = true; }
// 套用一整組快速選項（0 低、1 中、2 高；手機電腦各自那一套）
function setGfx(lv) {
  const p = { ...PRESETS[lv] };
  delete p.name;
  Object.assign(gs, p);
  applyGfx();
}

// ---- 設定裡的「畫質」頁 ----
// 每一列：[欄位, 標題, 種類, 選項]。seg 是一排按鈕、sw 是開關、range 是滑桿
const GFX_ROWS = [
  ['光影'],
  ['shadow', '陰影', 'seg', TOUCH ? ['關', '低', '中'] : ['關', '低', '中', '高', '最高']],
  ...(TOUCH ? [] : [['shNear', '近處陰影（人物腳邊）', 'seg', ['關', '中', '高']]]),
  ['shRange', '陰影範圍', 'seg', ['近', '中', '遠']],
  ['ao', '角落暗影', 'sw'],
  ['視野'],
  ['view', '可視距離', 'seg', ['近', '中', '遠']],
  ['fov', '鏡頭視角', 'range', [40, 70]],
  ['特效'],
  ['bloom', '光暈', 'sw'],
  ['rays', '陽光光束', 'sw'],
  ['refl', '海面倒影', 'sw'],
  ['wet', '積水倒影', 'sw'],
  ['grass', '草叢', 'seg', ['無', '少', '多']],
  ['畫面'],
  ['msaa', '多重取樣抗鋸齒（MSAA）', 'sw'],
  ...(TOUCH ? [] : [['tex', '材質紋路（木紋、石紋、屋瓦）', 'sw']]),   // 手機不畫程式貼圖，不列
];
const gfxCtl = {};
{
  const page = $('gfxPage'), body = $('gfxRows');
  let sec = null;
  for (const [key, label, kind, opt] of GFX_ROWS) {
    if (!label) { sec = body.appendChild(Object.assign(document.createElement('div'), { className: 'sec' })); sec.appendChild(Object.assign(document.createElement('h4'), { textContent: key })); continue; }
    const line = sec.appendChild(Object.assign(document.createElement('div'), { className: kind === 'range' ? 'row' : 'line' }));
    if (kind === 'range') {
      const lab = line.appendChild(Object.assign(document.createElement('label'), { textContent: `${label} ` }));
      const val = lab.appendChild(document.createElement('b'));
      const inp = line.appendChild(Object.assign(document.createElement('input'), { type: 'range', min: opt[0], max: opt[1], step: 1 }));
      inp.addEventListener('input', () => { gs[key] = +inp.value; applyGfx(); saveGfx(); });
      gfxCtl[key] = () => { inp.value = gs[key]; val.textContent = `${gs[key]}°`; };
    } else if (kind === 'sw') {
      line.appendChild(Object.assign(document.createElement('span'), { textContent: label }));
      const b = line.appendChild(Object.assign(document.createElement('button'), { className: 'sw' }));
      b.addEventListener('click', () => { b.blur(); gs[key] = !gs[key]; applyGfx(); saveGfx(); });
      gfxCtl[key] = () => { b.textContent = gs[key] ? '開' : '關'; b.classList.toggle('on', gs[key]); };
    } else {
      line.appendChild(Object.assign(document.createElement('span'), { textContent: label }));
      const seg = line.appendChild(Object.assign(document.createElement('div'), { className: 'seg' }));
      const btns = opt.map((t, i) => {
        const b = seg.appendChild(Object.assign(document.createElement('button'), { textContent: t }));
        b.addEventListener('click', () => { b.blur(); gs[key] = i; applyGfx(); saveGfx(); });
        return b;
      });
      gfxCtl[key] = () => btns.forEach((b, i) => b.classList.toggle('on', i === gs[key]));
    }
  }
  // 打開、返回：畫質頁蓋掉設定的其他區塊
  const openGfxPage = (btn, scrollToFps = false) => {
    btn.blur();
    $('panel').classList.add('gfx');
    if (scrollToFps) $('frameLimit').scrollIntoView({ block: 'nearest' });
    else $('panel').scrollTop = 0;
  };
  $('gfxOpen').addEventListener('click', () => openGfxPage($('gfxOpen'), false));
  $('fpsOpen').addEventListener('click', () => openGfxPage($('fpsOpen'), true));
  $('gfxBack').addEventListener('click', () => { $('gfxBack').blur(); $('panel').classList.remove('gfx'); });
  $('panel').addEventListener('toggle', () => { if (!$('panel').open) $('panel').classList.remove('gfx'); syncAim(); });
  void page;
}
function syncGfxUi() {
  const p = presetOf();
  for (const b of $('gfx').children) b.classList.toggle('on', +b.dataset.v === p);
  $('gfxName').textContent = gfx.name;
  for (const k in gfxCtl) gfxCtl[k]();
}
for (const b of $('gfx').children) b.addEventListener('click', () => { b.blur(); setGfx(+b.dataset.v); saveGfx(); });
let frameLimit = 0, syncFrameChoices;
{
  const row = $('frameLimit'), group = $('frameChoices'), note = $('frameLimitNote');
  const limits = TOUCH ? MOBILE_FRAME_LIMITS : DESKTOP_FRAME_LIMITS;
  const prefKey = TOUCH ? 'stormcast.mobileFps' : 'stormcast.desktopFps';
  const fallback = TOUCH ? 60 : 0;
  const savedRaw = getPref(prefKey);
  const savedLimit = savedRaw === null || savedRaw === '' ? NaN : Number(savedRaw);
  let preferredLimit = limits.includes(savedLimit) ? savedLimit : fallback;
  row.hidden = false;
  if (note) {
    note.textContent = TOUCH
      ? '依瀏覽器偵測到的更新頻率顯示。上限越高，視角移動越流暢，也更耗電。'
      : '設定每秒繪製上限（實際仍受螢幕更新率限制）；選「不限」則依螢幕更新率全速執行。';
  }
  const buttons = limits.map((fps) => {
    const b = group.appendChild(Object.assign(document.createElement('button'), { type: 'button', textContent: fpsLabel(fps) }));
    b.dataset.fps = String(fps);
    b.addEventListener('click', () => {
      b.blur();
      preferredLimit = fps;
      setPref(prefKey, fps);
      syncFrameChoices();
    });
    return b;
  });
  syncFrameChoices = () => {
    frameLimit = TOUCH
      ? MOBILE_FRAME_LIMITS.filter((fps) => fps <= mobileRefresh.hz && fps <= preferredLimit).at(-1)
      : preferredLimit;
    for (const b of buttons) {
      const fps = +b.dataset.fps;
      b.hidden = TOUCH && fps > mobileRefresh.hz;
      b.classList.toggle('on', fps === frameLimit);
      b.setAttribute('aria-pressed', String(fps === frameLimit));
    }
    $('fpsName').textContent = fpsLabel(frameLimit);
    drawClock.reset();
    if (!TOUCH) simClock.reset();
  };
  syncFrameChoices();
  // 動態調整畫質：手機、電腦都有（電腦的目標幀率：有設上限就照上限，「不限」就以 60 FPS 為準）
  $('adaptiveGfxRow').hidden = false;
  $('adaptiveGfx').addEventListener('click', () => {
    adaptivePrompt = false;
    cancelAsk('adaptiveGfx');
    setAdaptiveQuality(!adaptiveEnabled);
  });
  syncAdaptiveButton();
}
applyGfx();

function syncAdaptiveButton() {
  const btn = $('adaptiveGfx');
  btn.textContent = adaptiveEnabled ? '開' : '關';
  btn.classList.toggle('on', adaptiveEnabled);
  btn.setAttribute('aria-pressed', String(adaptiveEnabled));
}

function setAdaptiveQuality(enabled) {
  adaptiveEnabled = enabled;
  adaptiveAsked = true;
  setPref('stormcast.adaptiveGfx', enabled ? 'on' : 'off');
  syncAdaptiveButton();
  qualityTiming.reset();
  if (!enabled && qualityReduction) { qualityReduction = 0; applyGfx(); }
}

function adjustQuality(direction) {
  const before = reducedQuality(gs, qualityReduction);
  for (let next = qualityReduction + direction; next >= 0 && next <= MAX_QUALITY_REDUCTION; next += direction) {
    const after = reducedQuality(gs, next);
    if (next && GS_KEYS.every((k) => before[k] === after[k])) continue;
    qualityReduction = next;
    applyGfx();
    return;
  }
}

const ADAPTIVE_DESKTOP_FPS = 60;   // 電腦幀率「不限」時，動態畫質以每秒 60 幀為目標
function checkAdaptiveQuality(ms) {
  // 電腦第一次進房量幀率（probeGfx）那幾秒先不算，免得兩邊一起降
  if (!inGame || !net.online || tabOpen() || fadeIn > 0 || mode === 'sink' || probe) { qualityTiming.reset(); return; }
  const change = qualityTiming.sample(ms, TOUCH ? frameLimit : frameLimit || ADAPTIVE_DESKTOP_FPS);
  if (adaptiveEnabled) {
    if (change) adjustQuality(change === 'lower' ? 1 : -1);
    return;
  }
  if (change !== 'lower' || asking() || chat.isOpen || wheel.isOpen || fishing.state === 'fight') return;
  const lowest = reducedQuality(gs, MAX_QUALITY_REDUCTION);
  if (GS_KEYS.every((k) => gs[k] === lowest[k])) return;
  adaptiveAsked = true;
  adaptivePrompt = true;
  ask('最近的幀率不穩。要開啟動態畫質，讓遊戲暫時減少部分特效嗎？設定裡可隨時切換。', {
    yes: '開啟', no: '保持關閉', tag: 'adaptiveGfx',
  }).then((enabled) => {
    if (!adaptivePrompt) return;
    adaptivePrompt = false;
    setAdaptiveQuality(enabled);
    if (enabled) adjustQuality(1);
  });
}
// 設定裡換角色：記下來、重新載入（寬限內接回原本的房間）
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
  homeTip = getPref('stormcast.homeTip') !== 'done';
}
// iPhone（瀏覽器不給網頁全螢幕）：進房幾秒後跳一張小卡，教玩家「加入主畫面」再從主畫面打開（就沒有網址列）。
// 按「知道了」之後不再跳；按「之後再說」下次重新整理進房再提醒。設定裡那行說明（fullNote）照舊留著
function showHomeTip() {
  if (!inGame) return;
  if (asking() || tabOpen() || chat.isOpen) { window.setTimeout(showHomeTip, 3000); return; }   // 別的小卡、平板、聊天開著：晚點再跳
  ask('想要全螢幕玩？\niPhone 的瀏覽器不能直接全螢幕：點 Safari 的「分享」（方框加向上箭頭）→「加入主畫面」，之後從主畫面的圖示打開，就沒有網址列、畫面更大。', {
    yes: '知道了', no: '之後再說', tag: 'homeTip',
  }).then((ok) => { if (ok) setPref('stormcast.homeTip', 'done'); });
}
// 電腦的預設跟著螢幕縮放比例。手機預設是固定值，手動設定則一直沿用。
if (!TOUCH) {
  const syncRatio = () => {
    const r = desktopRatio();
    if (r === baseRatio) return;
    baseRatio = r;
    if (!ratioSaved) setPixelRatio(r);
  };
  window.addEventListener('resize', syncRatio);
  window.setInterval(syncRatio, 2000);
}

// 離開房間：回到大廳，船留到寬限期結束，下次進房從港口出發。
$('reset').addEventListener('click', () => {
  $('reset').blur();
  if (!inGame || !window.confirm('確定要離開房間嗎？錢、船、裝備和還沒賣的魚都會留著，下次進房從港口出發。')) return;
  net.leave();
  window.setTimeout(() => window.location.reload(), 200);
});

// 音效預設開著（?test 測試分頁除外）：瀏覽器要等玩家第一次點擊或按鍵後才准出聲，所以那時才真的打開；玩家自己關掉的話記住（stormcast.sound）
const soundBtn = () => { $('sound').textContent = audio.on ? '開' : '關'; $('sound').classList.toggle('on', audio.on); };
// 音量（0–1，記在 stormcast.vol）：乘在總音量上
let soundVol = clamp(parseFloat(getPref('stormcast.vol') ?? '1') || 0, 0, 1);
const applyVol = () => { if (audio.on && audio.master) audio.master.gain.value = 0.9 * soundVol; $('vVol').textContent = `${Math.round(soundVol * 100)}%`; };
const soundStart = () => { audio.start(); applyVol(); };
$('vol').value = soundVol;
applyVol();
$('vol').addEventListener('input', () => { soundVol = +$('vol').value; setPref('stormcast.vol', soundVol); applyVol(); });
$('sound').addEventListener('click', () => {
  if (audio.on) audio.stop(); else soundStart();
  setPref('stormcast.sound', audio.on ? 'on' : 'off');
  soundBtn();
  $('sound').blur();
});
if (!TEST && getPref('stormcast.sound') !== 'off') {   // 內部測試（?test）不自動開
  const wake = (e) => {
    if (e.target && e.target.id === 'sound') return;   // 按的就是音效鈕：交給上面
    for (const ev of ['pointerdown', 'keydown']) window.removeEventListener(ev, wake, true);
    if (!audio.on && getPref('stormcast.sound') !== 'off') { soundStart(); soundBtn(); }
  };
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, wake, true);
}

// 用實體按鍵位置（e.code）判斷，開著注音輸入法也能操作
const KEYMAP = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', ShiftLeft: 'shift', ShiftRight: 'shift', KeyQ: 'q', KeyR: 'r', Space: 'space', KeyF: 'f' };
const keys = { w: false, a: false, s: false, d: false, shift: false, q: false, r: false, space: false, f: false, mouse: false };

// ---- 開發者模式（只有測試環境：伺服器開了開發模式，進房時 snapshot 帶 dev）----
// 飛行（連按兩下空白鍵、或設定裡的開關）、不會累、不會溺水、設定裡的測試指令按鈕
let devMode = false, lastSpace = -1;
player.flySpeed = DEVMODE.flySpeed; player.flyFast = DEVMODE.flyFast; player.flyVert = DEVMODE.flyVert; player.flyMaxH = DEVMODE.flyMaxH;
function setFly(on) {
  player.fly = devMode && on && mode === 'walk' && !player.seat;
  if (!player.fly && player.h > 0) player.vy = 0;   // 關掉飛行：從現在的高度掉下去
  $('devFly').textContent = player.fly ? '開' : '關';
  $('devFly').classList.toggle('on', player.fly);
}
function setDevMode(on) {
  devMode = !!on;
  $('devSec').hidden = !devMode;
  if (!devMode) setFly(false);
}
$('devFly').addEventListener('click', () => { setFly(!player.fly); toast(player.fly ? '飛行：Shift 上升、Q 下降、按住 R 衝刺，連按兩下空白鍵關掉' : '關掉飛行'); });
for (const b of document.querySelectorAll('[data-dev]')) {
  b.addEventListener('click', () => {
    const d = b.dataset, cmd = d.dev;
    if (cmd === 'refresh' && !confirm('立刻刷新：清掉測試伺服器上所有人的錢、船、魚和排行榜？')) return;
    net.send({ t: 'dev', cmd, kind: d.kind, n: d.n && +d.n, kg: d.kg && +d.kg, hours: d.hours && +d.hours });
    if (cmd === 'money') toast(`（測試）加了 ${(+d.n).toLocaleString()} 元`);
    else if (cmd === 'calm') toast('（測試）海況恢復平靜');
    else if (cmd === 'skip') toast(`（測試）快轉 ${d.hours} 小時`);
  });
}
// 動作與表情的輪盤：走路時按住 G 叫出來，移動滑鼠選，放開 G 播放
const wheel = new EmoteWheel();
function closeWheel(play) {
  wheelPointer = null;
  const pick = wheel.close();
  if (!play || !pick) return;
  if (pick.kind === 'face') player.setMood(pick.id);
  else if (!player.playAction(pick.id)) toast('現在不能做這個動作（游泳、坐著、手上拿著東西時不行）');
}
// 手機的觸控操作：搖桿、滑動轉視角、右下角的按鈕、右上角的小按鈕（電腦上這個物件是空的，搖桿永遠是 0）
const touch = new TouchUI({
  canvas,
  look(dx, dy) {
    if (lookAllowed() && !wheel.isOpen) turnView(dx, dy, 0.0052);
  },
  zoom(k) { if (lookAllowed() && !wheel.isOpen) { const v = view[mode]; v.dist = clamp(v.dist * k, ...DIST[mode]); } },
  interact: () => { if (inGame) interact(); },
  fishDown() { if (!inGame) return; keys.f = true; fishing.press(); },
  fishUp() { keys.f = false; fishing.release(); },
  jump(on) { keys.space = on && inGame; },
  throwDown: () => throwStart(),
  throwUp: () => throwEnd(),
  tablet: () => { if (inGame) tablet.toggle(); },
  chat: () => chat.open(),
  emote() { if (wheel.isOpen) closeWheel(false); else if (inGame && mode === 'walk' && !tabOpen()) wheel.open(); },
  view: () => { if (inGame) toggleFp(); },
  bait: () => cycleBait(),
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
}
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || !inGame || feedbackOpen()) return;
  if (chat.isOpen && e.code === 'Escape') { e.preventDefault(); chat.close(); return; }
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    e.preventDefault();
    if (chat.isOpen) { if (chat.input.value.trim()) chat.input.focus(); else chat.close(); }
    else chat.open();
    return;
  }
  // 平板：Tab 拿出來／收起來、M 直接開地圖；拿著平板時 Esc 回主畫面（主畫面就收起來）、數字鍵 1~0 快速切換 App
  if (e.code === 'Tab') { e.preventDefault(); if (!e.repeat) tablet.toggle(); return; }
  if (e.code === 'KeyM') { if (!e.repeat) tablet.toggle('map'); return; }
  if (tabOpen()) {
    if (e.code === 'Escape' && !e.repeat) tablet.back();
    else if (!e.repeat && /^Digit[0-9]$/.test(e.code)) {
      const n = +e.code.slice(5), idx = n === 0 ? 9 : n - 1;
      if (tablet.apps[idx]) tablet.go(tablet.apps[idx].id);
    }
    return;
  }
  const k = KEYMAP[e.code];
  if (k) keys[k] = true;
  if (e.code === 'Space') e.preventDefault();
  if (e.repeat) return;
  // 開發者模式：連按兩下空白鍵切換飛行
  if (e.code === 'Space' && devMode && mode === 'walk') {
    const now = performance.now() / 1000;
    if (now - lastSpace < DEVMODE.doubleTap) { setFly(!player.fly); lastSpace = -1; } else lastSpace = now;
  }
  if (e.code === 'KeyC') toggleFp();
  if (e.code === 'KeyB') cycleBait();
  if (e.code === 'KeyU') castChum();
  if (e.code === 'KeyT' && mode === 'helm') doTow(towAction(boat));
  if (e.code === 'KeyE') interact();
  if (e.code === 'KeyF') fishing.press();
  if (e.code === 'KeyG' && mode === 'walk') wheel.open();
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) keys[k] = false;
  if (e.code === 'KeyF') fishing.release();
  if (e.code === 'KeyG') closeWheel(mode === 'walk');
  if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) e.preventDefault();
});
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; clearMouseDrag(); closeWheel(false); throwCancel(); if (chat.isOpen && !chat.input.value.trim()) chat.close(); });

// 按住滑鼠拖曳轉視角；滾輪調整第三人稱的距離
let dragPointer = null, dragX = 0, dragY = 0, wheelPointer = null;
function clearMouseDrag() {
  dragPointer = null;
  wheelPointer = null;
  keys.mouse = false;
}
function clampLookPitch(v) {
  v.pitch = clamp(v.pitch, v.fp ? -1.1 : -1.4, v.fp ? 1.1 : 0.5);
}
function turnView(dx, dy, k) {
  const v = view[mode];
  v.yaw += dx * k;
  if (mode === 'helm' && v.fp) v.yaw = clamp(v.yaw, -2.7, 2.7);
  v.pitch -= dy * k;
  clampLookPitch(v);
}
canvas.addEventListener('pointerdown', (e) => {
  if (chat.isOpen) { chat.close(); if (TOUCH) return; }   // 點回遊戲畫面時順便關掉聊天輸入框，不擋住操作
  if (TOUCH) return;   // 手機：畫面上的手指由觸控操作那邊接手（見 touch.js）
  if (!lookAllowed() || e.button !== 0) return;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); // 免得空白鍵按到面板上的按鈕
  if (!locked()) {
    dragPointer = e.pointerId;
    dragX = e.clientX;
    dragY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    if (aiming()) { grabMouse(); return; }   // 瀏覽器拒絕鎖定時仍可按住拖曳
  }
  keys.mouse = true;
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(type, clearMouseDrag);
}
canvas.addEventListener('pointerleave', () => { wheelPointer = null; });
// 右鍵：拿著東西時按住蓄力、放開丟出去（用 mousedown／mouseup：左鍵按著拖曳視角時再按右鍵，pointerdown 不會再來一次）
canvas.addEventListener('mousedown', (e) => { if (!TOUCH && e.button === 2) throwStart(); });
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) clearMouseDrag();
  if (e.button === 2) throwEnd();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// 瀏覽器偶爾會回報一筆大得離譜的滑鼠位移（滑鼠鎖在畫面裡時，游標被拉回中央的那一下漏進來；
// 剛鎖上、剛放開、視窗剛切回來的第一筆也常常是這樣），照單全收的話鏡頭會自己猛轉一大圈。
// 鎖定狀態剛變、視窗剛切回來的那一小段時間不收；平常則跟「最近幾筆的平均」比（不是只跟前一筆）：
//   比平均大很多的一筆、或是方向突然反過來又特別大的一筆，丟掉。
// 以前門檻是 150 像素、只跟前一筆比，一兩百像素的怪值會漏過去，轉視角轉到一半畫面會突然甩到別的方向（使用者回報）。
// 手真的甩得很快時位移是一筆一筆變大的：被擋下的那一筆也會把平均往上拉，接下來一兩筆就會收（頂多少掉開頭一兩筆）
let lookSkip = 0, lookT = 0, lookAvg = 0, lookAx = 0, lookAy = 0;
const lookPause = () => {
  clearMouseDrag();
  lookSkip = performance.now() + 120;
  lookAvg = lookAx = lookAy = 0;
};
document.addEventListener('pointerlockchange', () => {
  lookPause();
  if (locked() && !aiming()) document.exitPointerLock();
});
window.addEventListener('focus', lookPause);
function lookJump(e, now = performance.now()) {
  const dx = e.movementX, dy = e.movementY, mag = Math.hypot(dx, dy);
  if (now - lookT > 120) lookAvg = lookAx = lookAy = 0;   // 停了一下再動：從零算起
  lookT = now;
  if (now < lookSkip || !Number.isFinite(mag) || mag > 96) return true;
  const back = dx * lookAx + dy * lookAy < 0 && mag > 2 * lookAvg + 20;   // 正在往一邊轉，突然冒出一大步往反方向
  if (mag > Math.max(70, 2.5 * lookAvg + 30) || back) {
    lookAvg = Math.min(mag, lookAvg * 1.6 + 25);
    return true;
  }
  lookAvg += (mag - lookAvg) * 0.35;
  lookAx += (dx - lookAx) * 0.35; lookAy += (dy - lookAy) * 0.35;
  return false;
}
canvas.addEventListener('pointermove', (e) => {
  if (TOUCH || locked() || !lookAllowed()) return;
  // 沒鎖定時直接使用同一次拖曳的畫面座標差，第一筆由按下的位置起算。
  if (wheel.isOpen) {
    const prev = wheelPointer;
    wheelPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
    if (prev?.id === e.pointerId) wheel.move(e.clientX - prev.x, e.clientY - prev.y);
    if (dragPointer === e.pointerId) { dragX = e.clientX; dragY = e.clientY; }
    return;
  }
  wheelPointer = null;
  if (dragPointer !== e.pointerId || !(e.buttons & 1)) return;
  turnView(e.clientX - dragX, e.clientY - dragY, 0.0045);
  dragX = e.clientX;
  dragY = e.clientY;
});
canvas.addEventListener('mousemove', (e) => {
  if (TOUCH || !locked() || !aiming() || lookJump(e)) return;
  if (wheel.isOpen) wheel.move(e.movementX, e.movementY);
  else turnView(e.movementX, e.movementY, 0.0028);
});
canvas.addEventListener('wheel', (e) => {
  if (!lookAllowed() || wheel.isOpen) return;
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
  // 風向：每天比盛行風向偏一點，風暴、颱風經過時再被帶著轉。整片風浪、長浪、雨、樹、背風面都跟著
  const turn = (climate.veer || 0) + (sea.veer || 0);
  WDX = Math.cos(WAVE_ANGLE + turn); WDZ = Math.sin(WAVE_ANGLE + turn);
  WIND.dir.value.set(WDX, WDZ);
  shared.uWaveRot.value.set(Math.cos(turn), Math.sin(turn));
  {
    // 岸浪斜推的參考點跟著鏡頭走；換位置時把相位補回來，浪才不會跳
    const sw = shared.uShoreW.value, cx = camera.position.x, cz = camera.position.z;
    shared.uShoreP.value -= SHORE_WIND.tilt * ((cx - sw.z) * WDX + (cz - sw.w) * WDZ);
    sw.set(WDX, WDZ, cx, cz);
  }
  ocean.setTurn(turn);
  turnShelter(turn);
  tideNow = tideAt(climate.day, climate.hour);
  shared.uTide.value = tideNow; shared.uReflY.value = tideNow;
  rainNow = Math.max(sea.rain, climate.rain);
  {
    const FL = RIVER.flood, fk = clamp((rainNow - FL.from) / (FL.full - FL.from), 0, 1), want = floodTest ?? fk * fk * (3 - 2 * fk);
    flood += (want - flood) * (1 - Math.exp(-dt / (want > flood ? FL.up : FL.down) * 3));   // 約 up（down）秒漲（退）到差不多
    shared.uFlood.value = flood;
  }
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
  sunDir.set(...homeSun(L.dir[0], L.dir[1], L.dir[2]));
  shared.uSunCol.value.set(L.col[0], L.col[1], L.col[2]);
  const wetDark = 1 - 0.22 * rainNow;   // 下大雨時雲層厚，整體再暗一階
  shared.uAmbient.value.set(L.amb[0] * wetDark + flash * 0.9, L.amb[1] * wetDark + flash * 0.95, L.amb[2] * wetDark + flash * 1.1);
  shared.uDay.value = L.day; shared.uDusk.value = L.dusk;
  shared.uFog.value = fog; shared.uFlash.value = flash; shared.uRain.value = rainNow; shared.uSurge.value = sea.surge;
  shared.uFlashDir.value.copy(flashAt);
  shared.uWaveScale.value = windWave(wind) * sea.lull;
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
  // 人在透天洞穴裡：照不到太陽（站在天窗底下除外），天光也只剩一半
  sun.intensity = 2.5 * lv * (1 - 0.75 * gloom) * (1 - 0.85 * caveState.k * (1 - caveState.sky));
  hemi.intensity = (2.2 * L.amb[1] * wetDark * (1 - 0.35 * gloom) + flash * 2.5) * (1 - 0.35 * caveState.k);

  // 天黑了燈才亮：碼頭燈、船上的油燈、燈塔的光束
  const glow = clamp((night - 0.35) / 0.45, 0, 1);
  if (boatLight.parent !== boat.mesh) { boat.mesh.add(boatLight); boatLight.position.copy(boat.parts.lamp); }
  boatLight.intensity = boat.lampOn ? 10 * glow : 0;   // 船燈可以自己關掉
  // 會照亮東西的燈只有這四盞（多一盞，畫面上每一點都要多算一次）：人在母港就是碼頭那四盞；
  // 到了海上修船屋、大港，搬去照離鏡頭最近的四盞（換燈時先淡出、搬過去、再淡入）
  const lampSite = [SITES.yard, SITES.haven].find((s) => (camera.position.x - s.x) ** 2 + (camera.position.z - s.z) ** 2 < 280 * 280);
  if (!lampSite) {
    lampLights.forEach((l, i) => {
      if (lampSlots[i].at) { lampSlots[i].at = null; lampSlots[i].k = 0; l.position.set(LAMPS[i].x, LAMPS[i].y, LAMPS[i].z); }
      const on = ROOM_LIGHTS[`dock${i}`]?.on !== false ? glow : 0;   // 路燈可以由玩家關掉
      l.intensity = 10 * on;
      shared.uLamp.value[i].set(l.position.x, l.position.z, 0.55 * on);
    });
  } else {
    const cp = camera.position, far = (p) => (p.x - cp.x) ** 2 + (p.z - cp.z) ** 2;
    const near = seascape.sites[lampSite.id].lamps.slice().sort((a, b) => far(a) - far(b)).slice(0, lampLights.length);
    lampLights.forEach((l, i) => {
      const sl = lampSlots[i];
      if (sl.at && near.includes(sl.at)) sl.k = Math.min(1, sl.k + dt * 3);
      else {
        sl.k = Math.max(0, sl.k - dt * 3);
        if (sl.k === 0) { sl.at = near.find((p) => !lampSlots.some((o) => o.at === p)) || null; if (sl.at) l.position.set(sl.at.x, sl.at.y, sl.at.z); }
      }
      l.intensity = sl.at ? 10 * glow * sl.k : 0;
      shared.uLamp.value[i].set(l.position.x, l.position.z, sl.at ? 0.55 * glow * sl.k : 0);
    });
  }
  seascape.light(glow);   // 修船屋的工作燈、大港的路燈和山城的窗
  EXTRA_LAMPS.forEach((p, i) => shared.uLamp.value[5 + i].set(p.x, p.z, p.k * glow));
  for (const m of BULBS) m.color.copy(m.userData.base).multiplyScalar(0.7 + 1.5 * glow * m.userData.k);   // 燈泡：天黑後亮到會暈開
  for (const b of boats) b.showLamp(glow);   // 船上的燈另外看開關
  for (const p of POOLS) { p.mesh.visible = glow > 0.02; p.mat.opacity = p.k * glow; }
  bloom.strength = 0.22 + 0.16 * glow;
  shared.uLamp.value[4].set(boat.x, boat.z, boat.sinking || !boat.lampOn ? 0 : 0.45 * glow);
  shared.uLampOn.value = shared.uLamp.value.reduce((m, l) => Math.max(m, l.z), 0);
  const lit = clamp(0.3 + L.amb[1], 0, 1);
  for (const m of UNLIT) m.color.setScalar(lit);
  lightBulbs(glow, lit);
  boards.light(lit, glow);   // 看板晚上自己打燈
  boards.haven.visible = Math.hypot(camera.position.x - HAVEN.origin.x, camera.position.z - HAVEN.origin.z) < 600;   // 大港那組：離遠了不畫
  for (const m of GLOW) m.emissiveIntensity = 1.3 * glow;   // 天黑了，窗戶透出燈光
  scenery.beam.visible = glow > 0.02;
  scenery.beamMat.uniforms.opacity.value = 0.34 * glow * (1 + 1.5 * fog);
  scenery.beam.rotation.y += dt * 0.55;
  havenBeam.visible = scenery.beam.visible;   // 大港海岬的大燈塔：一樣的光束，轉得慢一點
  havenBeam.rotation.y += dt * PORT.lighthouse.beam;
  shared.uBeam.value.set(scenery.beam.position.x, scenery.beam.position.z, Math.cos(scenery.beam.rotation.y), -Math.sin(scenery.beam.rotation.y));
  shared.uBeamOn.value = glow;

  airFog.density = Math.hypot(HAZE * shared.uHazeK.value, fog / 200, RAIN_HAZE * Math.sqrt(rainNow));   // 下大雨時遠處罩在雨幕裡（跟 shader 的 applyFog 一致）
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
  gale.steady = windSpeed(wind, sea.storm);   // 風速跟浪對得上：浪大的日子風也大
  gale.v = gale.steady * (1 + 0.28 * Math.sin(time * 0.37) + 0.17 * Math.sin(time * 1.13 + 2) + 0.1 * Math.sin(time * 2.9 + 5));
  gale.x = WDX * gale.v; gale.z = WDZ * gale.v;
  driftClouds(dt);   // 雲（積雲、低雲層）和雲影順著風飄：平常慢慢的，颱風時低雲整片飛過去
  shared.uSwell.value = SWELL.amp * sea.swell;
  // 雨被風吹斜：颱風時幾乎是橫著飛的
  const cpos = camera.position, wk = windK(cpos.x, cpos.z);
  rain.update(time, cpos, rainNow * (1 - caveState.dry), light, gale.x * wk, gale.z * wk);   // 鏡頭在洞裡（不是天窗底下）就沒有雨
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
    // 雨點打下去：電腦上先彈起一圈小皇冠（積水上再擴一圈漣漪），再往外甩幾顆細水滴；手機只有細水滴、少一半
    splashAcc = Math.min(splashAcc + dt * (rainSplash ? 900 : 450) * rainNow, 60);
    for (; splashAcc >= 1; splashAcc--) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 12;
      const x = target.x + Math.cos(a) * r, z = target.z + Math.sin(a) * r, y = walkGround(x, z);
      if (y < 0.05 || y > 50 || underRoof(x, y, z)) continue;   // 落在水裡的、牆和石頭上的、屋頂底下的不算
      if (rainSplash) {
        const flat = r < 9 && Math.abs(walkGround(x + 0.2, z) - y) < 0.02 && Math.abs(walkGround(x, z + 0.2) - y) < 0.02;
        rainSplash.hit(x, y + 0.005, z, flat, shared.uWet.value);
      }
      for (let k = 0, n = 1 + (Math.random() < 0.6); k < n; k++) {
        const b = Math.random() * Math.PI * 2, v = 0.4 + Math.random() * 0.8;
        spray.emit(x, y + 0.04, z, Math.cos(b) * v, 0.7 + Math.random() * 0.9, Math.sin(b) * v, 0.12 + Math.random() * 0.12, 0.1 + Math.random() * 0.1);
      }
    }
  }
}
let splashAcc = 0, bowLeft = 0;

function updateOcean(dt) {
  updateWeather(dt);
  // 白浪照外海的浪去累積；外海的示性波高決定今天是哪一種浪（小浪短而碎、大浪又長又慢）
  const openLv = seaOpen(shared.uWaveScale.value, sea.storm);
  ocean.update(time, dt, shared.uWaveScale.value, openLv, Math.round(HS * openLv * 50) / 50);
  shared.uSlopeVar.value.set(...ocean.shape.slopeVar);
  shared.uDisp0.value = ocean.cascades[0].disp[ocean.cascades[0].cur].texture;
  shared.uDisp1.value = ocean.cascades[1].disp[ocean.cascades[1].cur].texture;
  if (LITE_SEA && ocean._workers) {
    const [w0, w1] = ocean._workers;
    shared.uLD0A.value = w0.ta.d; shared.uLD0B.value = w0.tb.d; shared.uLS0A.value = w0.ta.s; shared.uLS0B.value = w0.tb.s;
    shared.uLD1A.value = w1.ta.d; shared.uLD1B.value = w1.tb.d; shared.uLS1A.value = w1.ta.s; shared.uLS1B.value = w1.tb.s;
    shared.uLK.value.set(w0.k, w1.k);
    shared.uVortexOn.value = sea.vortices.length ? 1 : 0;
  }

  sweEnv.disp0 = shared.uDisp0.value; sweEnv.time = shared.uTime.value;
  sweEnv.waveScale = shared.uWaveScale.value; sweEnv.storm = shared.uStorm.value; sweEnv.surge = shared.uSurge.value;
  shallow.update(dt, target, SWE_ON && shallowNear(target), sweEnv);
  shared.uSweOn.value = shallow.on ? 1 : 0;
  shared.uSweOrigin.value.copy(shallow.origin);
  shared.uSweWet.value = shallow.wetTexture;
}
updateOcean(0);

const tideSurge = (x, z) => surgeAt(x, z) + tideNow;
const calmEnv = { ground: boatGround, wave: tideSurge, base: tideSurge, limit: L / 2 - 30 };   // 停在港裡、沒人用的船：平常不動，巨浪淹進港口時跟著浮起來
const boatEnv = {
  ground: boatGround,
  // 這裡的水道多寬：暗門水道比船窄的話船進不去（其他地方不限）
  gate: (x, z) => { const [vx, vz] = havenToLocal(x, z); return nearCave(vx, vz) ? caveGate(vx, vz) : Infinity; },
  wave: (x, z) => ocean.sampleCached(x, z) * waveK(x, z) + tsuAt(x, z),
  // 畫面上看得到的那片水面（長浪加中浪、含浪頭的水平位移）：船身貼著它浮。fade：淺水裡浪變小幾成
  waveFine: (x, z, fade) => ocean.sampleSurface(x, z, waveK(x, z) * fade) + tsuAt(x, z),
  base: (x, z) => surgeAt(x, z) + swellH(x, z) + tideNow,   // 巨浪（和潮汐）把整艘船托起來的高度
  // 浪大的時候開不快：這裡的示性波高一公尺以下不受影響，六公尺時慢四成
  slow: (x, z) => 0.4 * clamp((HS * shelterAt(x, z) * levelAt(x, z) - 1) / 5, 0, 1),
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
  else if (copilot && copilot.boat === b) {   // 幫隊友開的船沉了：由我告訴伺服器（船主那邊也會收到）
    net.send({ t: 'sink', forId: copilot.id, why: b.sunkBy, side: b._side });
    copilot = null; b.local = false;
  }
  if (!aboard) return;
  fishing.cancel();
  mode = 'sink';
  camHeading = b.heading;
  view.sink.dist = clamp(b.spec.len * 1.8, ...DIST.sink);
  applyViewSettings();
}
// 被救回港口
function rescue(text, landing = SPAWN_W) {
  mode = 'walk';
  player.place(walkWorld, landing.x, landing.z);
  player.yaw = view.walk.yaw = landing.yaw;
  applyViewSettings();
  fadeIn = 1.6;
  toast(text);
}
function returnPassenger(destination) {
  fishing.cancel(null);
  throwCancel();
  landing = false;
  drown = null;
  if (wreck?.mine) wreck.aboard = false;
  else wreck = null;
  stamina = 1;
  for (const key in keys) keys[key] = false;
  lastPosMsg = '';
  rescue('船主離線，已帶你和隨身漁獲、魚箱回到潮汐灣', destination);
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
    else if (copilot && copilot.boat.sinking && !copilot.boat._wrecked) beginWreck(copilot.boat);
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
let stamina = 1, drown = null, wasSwim = false, stamShown = false, surgeToast = false;
function beginDrown(text) {
  if (devMode) return;   // 開發者模式不會溺水
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
  const u = 0.6 * eta + 0.5 * storm + 0.12 * clamp((levelAt(x, z) - 0.5) / 0.6, 0, 2);
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
      player.place(walkWorld, SPAWN_W.x, SPAWN_W.z);
      player.yaw = view.walk.yaw = SPAWN_W.yaw;
      stamina = 1;
      fadeIn = 1.6;
      toast(drown.text + lost);
      drown = null;
    }
  } else if (mode === 'walk' && player.swim) {
    // 用力游、捧著東西、浪大都比較累；停著踩水比較省力
    const rough = clamp((levelAt(player.x, player.z) - 0.45) * 1.5, 0, 2);
    const k = (player.moving ? (keys.shift || touch.run ? 1.45 : 1) : 0.6) * (player.carry ? 1.35 : 1) * (1 + 0.4 * rough);
    if (!devMode) stamina -= dt * k / SWIM_SECONDS;   // 開發者模式不會累
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
  if (!devMode && wasSwim && !player.swim && player.onWater && player.h > 0) stamina = Math.max(0, stamina - 0.04);   // 在水裡跳一下要花一點力氣

  if (player.swim && !wasSwim) { splash(player.x, playerWater(player.x, player.z) + 0.1, player.z, 18); audio.play('dive'); }
  wasSwim = player.swim;

  const show = mode === 'walk' && (player.swim || stamina < 0.999);
  if (show !== stamShown) { stamShown = show; $('stam').style.display = show ? 'flex' : 'none'; }
  if (show) {
    $('stamFill').style.width = `${stamina * 100}%`;
    $('stamFill').className = stamina < 0.3 ? 'low' : '';
  }
}

// ---- 地圖（平板的「地圖」app；M 直接打開） ------------------------------------
// 上方是北。畫出每座島、母港、自己的每艘船，還有自己的位置與面向
const MAP_PX = 560;
let mapBase = null;
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
// 地圖上島和礁石的名字（位置照 config.js 的 WORLD）
const MAP_PLACES = [
  ['大港灣島', WORLD.haven.center],
  ['石拱門', WORLD.reefs.arch.center],
  ['沉船環礁', WORLD.reefs.atoll.center],
  ['燈標岩', WORLD.reefs.beacon.center],
];
const MAP_FONT = '"Huninn", "Microsoft JhengHei", system-ui, sans-serif';
let waypoint = null;   // 地圖上點選的導航標記點：{ x, z, place }
const SEA_EVENT_NAME = { storm: '暴風雨', thunder: '雷暴雨', spout: '水龍捲', whirl: '大漩渦', tsunami: '海嘯', omen: '海嘯前兆', waves: '海嘯巨浪', brew: '颱風前兆', typhoon: '颱風' };
function seaEventText(ox, oz) {
  const out = [];
  for (const v of sea.vortices) {
    out.push(`${v.kind === 'whirl' ? '🌀 大漩渦' : '🌪 水龍捲'}：${whereFrom(v.x - ox, v.z - oz)}`);
  }
  if (sea.phase === 'omen' || sea.phase === 'waves') {
    out.push(`🌊 ${sea.phase === 'waves' ? '海嘯巨浪' : '海嘯前兆'}：自${dirName(-sea.tsu.dx, -sea.tsu.dz)}襲來`);
  } else if (sea.ev && (sea.phase === 'storm' || sea.phase === 'thunder' || sea.phase === 'brew' || sea.phase === 'typhoon')) {
    out.push(`⚠️ ${SEA_EVENT_NAME[sea.phase] || '海上事件'}：${whereFrom(sea.ev.x - ox, sea.ev.z - oz)}（外海危險）`);
  }
  return out;
}
// 畫在平板「地圖」app 的畫布上。filt：要畫哪些（boat 自己的船、box 魚箱、others 其他人、hot 魚群）。回傳點得到的東西（自己的船 → 「船」app）
function drawMap(cv, filt, who = null, st = null, viewOpt = null) {
  if (!mapBase) { mapBase = makeMapBase(); if (document.fonts) document.fonts.load(`13px ${MAP_FONT}`, '北潮汐灣大港灣島石拱門沉船環礁燈標岩你魚群魚箱條導航漩渦龍捲嘯巨浪雷暴雨颱區形成中來襲方向').catch(() => {}); }
  const selfId = who ? who.id : net.id;
  const selfSonar = who ? !!st?.mods?.sonar : !!kit.mods?.sonar;
  const selfBoat = who ? who.boat : myBoat;
  const selfHelm = who ? !!(who.boat && !who.boat.sinking && who.st && (who.st[4] & 32)) : (mode !== 'walk');
  const zoom = viewOpt?.zoom || 1, panX = viewOpt?.panX || 0, panY = viewOpt?.panY || 0;
  const g = cv.getContext('2d'), hits = [];
  g.clearRect(0, 0, MAP_PX, MAP_PX);
  g.save();
  if (zoom > 1.001 || panX || panY) {
    g.translate(MAP_PX / 2, MAP_PX / 2);
    g.scale(zoom, zoom);
    g.translate(-MAP_PX / 2 - panX, -MAP_PX / 2 - panY);
  }
  g.drawImage(mapBase, 0, 0);
  const P = (x, z) => [(x / L + 0.5) * MAP_PX, (z / L + 0.5) * MAP_PX];
  g.lineJoin = 'round';
  g.textBaseline = 'middle';
  // 標籤先收集起來，記號全畫完再依重要順序擺：每個標籤試右、左、上、下四個位置，挑第一個不跟別人疊的
  const labels = [];
  const label = (text, x, y, color, pri, size = 13) => labels.push({ text, x, y, color, pri, size });
  // 尖頭朝行進方向的記號
  const arrow = (x, y, yaw, len, wid, fill) => {
    g.save();
    g.translate(x, y); g.rotate(yaw);
    g.beginPath(); g.moveTo(len, 0); g.lineTo(-len * 0.75, wid); g.lineTo(-len * 0.35, 0); g.lineTo(-len * 0.75, -wid); g.closePath();
    g.lineWidth = 2.5; g.strokeStyle = 'rgba(20, 30, 40, 0.9)'; g.stroke();
    g.fillStyle = fill; g.fill();
    g.restore();
  };

  // 島和礁石的名字（最不重要，最後擺）
  for (const [name, c] of MAP_PLACES) { const [px, py] = P(c.x, c.z); label(name, px, py, 'rgba(255, 255, 255, 0.92)', 5, 12); }
  // 魚群熱點 ＋ 誘魚桶人工魚群
  const hs = filt.hot && havenFx.hot();
  if (hs) {
    const [hx, hy] = P(hs.x, hs.z);
    g.beginPath(); g.arc(hx, hy, 7, 0, Math.PI * 2);
    g.lineWidth = 3; g.strokeStyle = 'rgba(20, 30, 40, 0.9)'; g.stroke();
    g.fillStyle = '#ffd250'; g.fill();
    if (selfSonar) {
      const sec = Math.max(0, Math.ceil(hs.until - performance.now() / 1000));
      label(hs.count != null ? `魚群 ${hs.count}尾 ${sec}s` : `黃金魚群 ∞ ${sec}s`, hx, hy, '#ffe9a0', 2);
    } else {
      label('魚群', hx, hy, '#ffe9a0', 2);
    }
    if (!who) hits.push({ x: hx, y: hy, r: 16, nav: { x: hs.x, z: hs.z, place: '魚群熱點' } });
  }
  if (filt.hot) {
    for (const ch of havenFx.chums()) {
      const [cx, cy] = P(ch.x, ch.z);
      g.beginPath(); g.arc(cx, cy, 5.5, 0, Math.PI * 2);
      g.lineWidth = 2.5; g.strokeStyle = 'rgba(20, 30, 40, 0.9)'; g.stroke();
      g.fillStyle = '#ff9838'; g.fill();
      if (selfSonar) {
        const sec = Math.max(0, Math.ceil(ch.until - performance.now() / 1000));
        label(`誘魚 ${ch.count}尾 ${sec}s`, cx, cy, '#ffd09c', 2);
      } else {
        label('誘魚', cx, cy, '#ffd09c', 2);
      }
      if (!who) hits.push({ x: cx, y: cy, r: 14, nav: { x: ch.x, z: ch.z, place: '人工魚群' } });
    }
  }

  // 母港
  const [hx, hy] = P(QUAY_CENTER_W.x, QUAY_CENTER_W.z);
  g.beginPath(); g.arc(hx, hy, 5, 0, Math.PI * 2);
  g.lineWidth = 2.5; g.strokeStyle = 'rgba(20, 30, 40, 0.9)'; g.stroke();
  g.fillStyle = '#fff'; g.fill();
  label('潮汐灣', hx, hy, '#fff', 3);

  // 同房的其他人和他們的船（白色）
  const othersView = filt.others ? others.list().filter((o) => o.id !== selfId) : [];
  if (filt.others && who) {
    const meHelm = mode !== 'walk';
    othersView.push({
      id: net.id, name: net.name, here: true,
      x: meHelm ? boat.x : player.x, z: meHelm ? boat.z : player.z, yaw: meHelm ? boat.heading : player.yaw,
      boat: !myBoat.sinking ? myBoat : null,
    });
  }
  // 人是白點；名字擠在一起（地圖上 18 像素內）就合成一個「某某 等 N 人」，隊友另外合、用綠字
  const crowd = [], team = [];
  for (const o of othersView) {
    if (o.boat) { const [bx, by] = P(o.boat.x, o.boat.z); arrow(bx, by, o.boat.heading, 5.5, 3.5, 'rgba(255, 255, 255, 0.75)'); }
    if (!o.here) continue;
    const [ox, oy] = P(o.x, o.z);
    g.beginPath(); g.arc(ox, oy, 3.2, 0, Math.PI * 2);
    g.lineWidth = 2; g.strokeStyle = 'rgba(20, 30, 40, 0.9)'; g.stroke();
    g.fillStyle = '#fff'; g.fill();
    (o.mate ? team : crowd).push({ name: o.name, x: ox, y: oy });
  }
  while (crowd.length) {
    const a = crowd.shift();
    let n = 1;
    for (let i = crowd.length - 1; i >= 0; i--) if (Math.hypot(crowd[i].x - a.x, crowd[i].y - a.y) < 18) { crowd.splice(i, 1); n++; }
    label(n > 1 ? `${a.name} 等 ${n} 人` : a.name, a.x, a.y, '#fff', 4);
  }
  while (team.length) {
    const a = team.shift(), near = [a];
    for (let i = team.length - 1; i >= 0; i--) if (Math.hypot(team[i].x - a.x, team[i].y - a.y) < 18) near.push(...team.splice(i, 1));
    label(near.length === 1 ? a.name : near.length === 2 ? `${a.name}、${near[1].name}` : `${a.name} 等 ${near.length} 位隊友`, a.x, a.y, '#7dffad', 3);
  }
  // 自己的魚箱（橘色小方塊）
  if (filt.box) for (const d of boxes.mine(selfId)) {
    if (d.k === 'hand') continue;
    const w = boxes.worldPos(d), [bx, by] = P(w.x, w.z);
    g.lineWidth = 2; g.strokeStyle = 'rgba(20, 30, 40, 0.9)'; g.fillStyle = '#ff9a5c';
    g.fillRect(bx - 4, by - 4, 8, 8); g.strokeRect(bx - 4, by - 4, 8, 8);
    if (d.fish.length) label(`魚箱 ${d.fish.length} 條`, bx, by, '#ffd2b8', 3, 12);
  }
  // 自己的船（點了打開「船」）
  if (selfBoat && !selfBoat.sinking && filt.boat) {
    const [bx, by] = P(selfBoat.x, selfBoat.z);
    arrow(bx, by, selfBoat.heading, 7, 4.5, '#ffd257');
    if (!selfHelm) label(selfBoat.spec.name, bx, by, '#ffe9a8', 1);   // 掌舵時船就是「你」，不另外標
    if (!who) hits.push({ x: bx, y: by, r: 18, go: 'boat' });
  }

  // 自己：掌舵時就是船的位置與船首方向
  const [mx, my] = who
    ? P(selfHelm && selfBoat ? selfBoat.x : who.fig.x, selfHelm && selfBoat ? selfBoat.z : who.fig.z)
    : (selfHelm ? P(boat.x, boat.z) : P(player.x, player.z));

  // 導航標記點（只有自己看的地圖畫）
  if (!who && waypoint) {
    const [wx, wy] = P(waypoint.x, waypoint.z);
    g.save();
    g.setLineDash([6, 5]);
    g.lineWidth = 2.2;
    g.strokeStyle = 'rgba(120, 240, 255, 0.88)';
    g.beginPath(); g.moveTo(mx, my); g.lineTo(wx, wy); g.stroke();
    g.restore();
    g.beginPath(); g.arc(wx, wy, 9, 0, Math.PI * 2);
    g.lineWidth = 2; g.strokeStyle = 'rgba(120, 240, 255, 0.9)'; g.stroke();
    g.beginPath(); g.arc(wx, wy, 4.5, 0, Math.PI * 2);
    g.fillStyle = '#52f0ff'; g.fill();
    g.lineWidth = 2; g.strokeStyle = 'rgba(20, 30, 40, 0.9)'; g.stroke();
    const distM = Math.round(Math.hypot(waypoint.x - (selfHelm ? boat.x : player.x), waypoint.z - (selfHelm ? boat.z : player.z)));
    label(`導航 ${distM}m`, wx, wy, '#9ff7ff', 1, 12);
  }

  // 海上事件位置／波前標記（漩渦、水龍捲、海嘯來襲／浪頭、風暴與颱風區）
  if (sea.phase === 'omen' || sea.phase === 'waves') {
    const dx = sea.tsu.dx, dz = sea.tsu.dz, tx = -dz, tz = dx;
    const dFront = sea.tsu.on ? clamp(sea.tsu.front, -L * 0.48, L * 0.48) : -L * 0.42;
    const [cx, cz] = [dx * dFront, dz * dFront], span = L * 0.65;
    const [p1x, p1y] = P(cx - tx * span, cz - tz * span), [p2x, p2y] = P(cx + tx * span, cz + tz * span);
    g.save();
    g.setLineDash(sea.tsu.on ? [10, 6] : [6, 6]);
    g.lineWidth = sea.tsu.on ? 3.5 : 2.5;
    g.strokeStyle = sea.tsu.on ? '#ff7c61' : '#ffb86b';
    g.beginPath(); g.moveTo(p1x, p1y); g.lineTo(p2x, p2y); g.stroke();
    g.restore();
    const [ax, ay] = P(cx, cz), yawT = Math.atan2(dz, dx);
    arrow(ax, ay, yawT, 8, 5, sea.tsu.on ? '#ff6a4d' : '#ffb86b');
    label(sea.tsu.on ? '海嘯巨浪' : '海嘯來襲方向', ax, ay, '#ffd1b8', 1, 13);
  }
  for (const v of sea.vortices) {
    const [vx, vy] = P(v.x, v.z), whirl = v.kind === 'whirl';
    const warnR = Math.max(9, ((whirl ? 90 : 80) / L) * MAP_PX);
    g.save();
    g.beginPath(); g.arc(vx, vy, warnR, 0, Math.PI * 2);
    g.fillStyle = whirl ? 'rgba(155, 100, 255, 0.18)' : 'rgba(90, 225, 255, 0.18)'; g.fill();
    g.setLineDash([4, 4]); g.lineWidth = 2;
    g.strokeStyle = whirl ? 'rgba(195, 148, 255, 0.9)' : 'rgba(115, 240, 255, 0.9)'; g.stroke();
    g.restore();
    if (!whirl && Math.hypot(v.vx, v.vz) > 0.2) arrow(vx, vy, Math.atan2(v.vz, v.vx), 8, 4.5, '#8ff7ff');
    else {
      g.beginPath(); g.arc(vx, vy, 4.5, 0, Math.PI * 2);
      g.fillStyle = whirl ? '#d8b4ff' : '#8ff7ff'; g.fill();
      g.lineWidth = 2; g.strokeStyle = 'rgba(20, 30, 40, 0.9)'; g.stroke();
    }
    label(whirl ? (v.s < 0.25 ? '大漩渦（形成中）' : '大漩渦') : '水龍捲', vx, vy, whirl ? '#ead7ff' : '#b8faff', 1, 12);
  }
  if (sea.ev && (sea.phase === 'storm' || sea.phase === 'thunder' || sea.phase === 'brew' || sea.phase === 'typhoon')) {
    const [ex, ey] = P(sea.ev.x, sea.ev.z);
    g.save();
    g.beginPath(); g.arc(ex, ey, 22, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255, 185, 70, 0.16)'; g.fill();
    g.setLineDash([5, 4]); g.lineWidth = 2;
    g.strokeStyle = 'rgba(255, 210, 95, 0.9)'; g.stroke();
    g.restore();
    g.beginPath(); g.arc(ex, ey, 4.5, 0, Math.PI * 2);
    g.fillStyle = '#ffd978'; g.fill();
    g.lineWidth = 2; g.strokeStyle = 'rgba(20, 30, 40, 0.9)'; g.stroke();
    label(sea.phase === 'thunder' ? '雷暴雨觸發區' : sea.phase === 'storm' ? '暴風雨觸發區' : '颱風觸發區', ex, ey, '#ffe599', 1, 12);
  }

  arrow(mx, my, who ? (selfHelm && selfBoat ? selfBoat.heading : who.fig.yaw) : (selfHelm ? boat.heading : player.yaw), 9, 6, '#ff5a3c');
  label('你', mx, my, '#ffb9a6', 0, 14);

  // 擺標籤
  const taken = [];   // 已經擺好的標籤佔的位置
  const hit = (b) => taken.some((o) => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h);
  g.lineWidth = 3.5; g.strokeStyle = 'rgba(20, 30, 40, 0.85)';
  for (const l of labels.sort((a, b) => a.pri - b.pri)) {
    g.font = `${l.size}px ${MAP_FONT}`;
    const w = g.measureText(l.text).width, h = l.size + 3, gap = 11;
    const tries = l.pri === 5 ? [[l.x - w / 2, l.y]] : [[l.x + gap, l.y], [l.x - gap - w, l.y], [l.x - w / 2, l.y - 15], [l.x - w / 2, l.y + 15]];
    let at = tries.find(([x, y]) => !hit({ x, y: y - h / 2, w, h }));
    if (!at && l.pri === 4) continue;   // 其他玩家的名字擺不下就不畫（點還在），不往下疊成一長串
    if (!at) { let [x, y] = tries[0]; while (hit({ x, y: y - h / 2, w, h })) y += h; at = [x, y]; }
    taken.push({ x: at[0], y: at[1] - h / 2, w, h });
    g.fillStyle = l.color;
    g.strokeText(l.text, at[0], at[1]); g.fillText(l.text, at[0], at[1]);
  }
  g.restore();

  // 海上事件左上狀態膠囊（不受縮放平移影響）
  if (sea.phase !== 'calm' || sea.vortices.length) {
    const tag = `⚠ ${SEA_EVENT_NAME[sea.phase] || '海上事件'}${sea.vortices.length ? ` ×${sea.vortices.length}` : ''}`;
    g.font = `12px ${MAP_FONT}`;
    const tw = g.measureText(tag).width + 18;
    g.fillStyle = 'rgba(24, 38, 52, 0.82)';
    g.beginPath(); g.roundRect(10, 10, tw, 24, 12); g.fill();
    g.fillStyle = '#ffd584'; g.fillText(tag, 19, 22);
  }

  // 指北（固定在視窗右上角，不受縮放平移影響）
  g.fillStyle = 'rgba(20, 30, 40, 0.62)';
  g.beginPath(); g.moveTo(MAP_PX - 26, 14); g.lineTo(MAP_PX - 19, 30); g.lineTo(MAP_PX - 33, 30); g.closePath(); g.fill();
  g.font = `13px ${MAP_FONT}`;
  g.textAlign = 'center'; g.fillText('北', MAP_PX - 26, 42); g.textAlign = 'left';
  return hits;
}
// ---- 平板（Tab；仿 iPad：主畫面兩塊小工具＋app 圖示，見 tablet.js、tabletApps.js） ------------
// 這裡把遊戲裡的資料交給平板：時間天氣、自己的船、圖鑑、背包、同房的人；按鈕按下去要做的事也在這裡
let tabHand = false, tabMesh = null, tabScreen = 0;   // 手上拿著平板（給自己和別人看的 3D 模型）、螢幕上是哪個畫面（tabletMesh.js 的 SCREENS）
const SCREEN_IDX = { map: 1, boat: 2, weather: 3, dex: 4, bag: 5, shrine: 5, room: 6, rank: 6, notice: 7, set: 8 };
const tabletScreen = () => (tablet.cur ? (SCREEN_IDX[tablet.cur] ?? 0) : 0);
// 打開平板一律改用與開船時相同的置中介面（不切特寫、不露出貼近鏡頭的手）；走路姿勢、3D 平板與多人連線仍照舊保留
let ownTexAt = 0;
function syncOwnTabletTex(force = false) {
  const now = performance.now();
  if (!force && now - ownTexAt < 180) return;
  ownTexAt = now;
  tabMesh = tabMesh || makeTabletMesh(0, { fullFace: true });
  renderOwnTablet(tabMesh, tablet.root, { width: TOUCH ? TABLET.domWTouch : TABLET.domW, touch: TOUCH });
}
let storedInfo = {};                   // 伺服器說倉庫裡的船：船種 → { fuel, hp 0–1 }
const dexNew = new Set();              // 這次新釣到、還沒在圖鑑裡看過的魚種
// 釣到魚時伺服器帶來的圖鑑那一筆：記下來；第一次釣到回傳 true
function noteDex(d) {
  if (!d || !SPECIES[d.id] || !d.e) return false;
  dexBook[d.id] = d.e;
  if (d.isNew) dexNew.add(d.id);
  return !!d.isNew;
}
function skyNow() { return skyOf({ phase: sea.phase, rain: rainNow, fog: climate.fog, gloom, night: climate.night }); }
const meAt = () => (mode === 'helm' ? { x: boat.x, z: boat.z } : { x: player.x, z: player.z });
const onMyBoat = () => (mode === 'helm' && boat === myBoat) || player.boat === myBoat;
const placeHere = (x, z) => placeAt(x, z, offAt(x, z));
// 船在哪：停在第幾格／在港裡／某某附近，再加上離你哪個方向多遠
function boatWhere(b) {
  if (b.sinking) return '沉了';
  if (onMyBoat()) return '你在船上';
  const me = meAt(), parked = Math.hypot(b.x - berth.x, b.z - berth.z) < 4;
  return `${parked ? '停在港口' : inHarbor(b.x, b.z) ? '在港裡' : placeHere(b.x, b.z)}・${whereFrom(b.x - me.x, b.z - me.z)}`;
}
// 現在能不能叫船、換船（伺服器也會再檢查一次：見 server/boatCall.js）
function boatBlock() {
  if (myBoat.sinking) return '船已經沉了';
  const me = meAt();
  if (!siteAt(me.x, me.z)) return '要人在港口（潮汐灣、海上修船屋、大港灣島）才能叫船、換船';
  if (onMyBoat()) return '先下船才能叫船、換船';
  return '';
}
// 魚艙（有 h 的那個箱子）固定在船上、不算甲板上的魚箱（跟伺服器 swap 的判斷一樣）；艙裡有魚由伺服器另外擋
const deckLoaded = () => fish.items.some((it) => it.boat === myBoat && it.uid)
  || boxes.all().some((b) => b.k === 'd' && b.b === net.id && !('h' in b));
const boatWarn = () => !!myBoat.sinking || myBoat.fuel < myBoat.spec.tank * TABLET.lowFuel || myBoat.hp < myBoat.spec.hp * TABLET.lowHp;
// 魚箱在哪
function boxWhere(d) {
  if (d.k === 'hand') return d.o === net.id ? '抱在手上' : '在別人手上';
  const w = boxes.worldPos(d), me = meAt();
  const at = d.k === 'd' ? (d.b === net.id ? `在你的${myBoat.spec.name}上` : `在 ${others.map.get(d.b)?.name ?? '別人'} 的船上`) : d.k === 'w' ? '漂在海上' : placeHere(w.x, w.z);
  return `${at}・${whereFrom(w.x - me.x, w.z - me.z)}`;
}
function weatherNow() {
  const c = clockOf(climate.hour), sk = skyNow(), ms = gale.steady, lv = beaufort(ms), me = meAt();
  const wet = mode === 'helm' || !!player.boat || player.swim || bedAt(me.x, me.z) < 0;
  const sg = signsOf(sea);
  const tideCurve = Array.from({ length: 25 }, (_, i) => ({
    dh: i - 4,
    norm: clamp(tideAt(climate.day, climate.hour + (i - 4)) / 0.3, -1, 1),
    now: i === 4,
  }));
  return {
    time: `${c.part} ${c.hm}`, part: c.part, hm: c.hm, day: climate.day, skyIcon: sk.icon, skyText: sk.text,
    windTo: bearing(WDX, WDZ), windFrom: dirName(-WDX, -WDZ), windMs: ms, windLv: lv, windWord: windWord(lv),
    waveOpen: HS * seaOpen(ocean.scale, sea.storm), waveHere: wet ? HS * shelterAt(me.x, me.z) * levelAt(me.x, me.z) : null,
    tide: tideText(climate.day, climate.hour), tideShort: tideShort(climate.day, climate.hour), tideCurve,
    forecast: forecast(climate), signs: sg.list, danger: sg.danger,
  };
}
const tabEnv = {
  low: { hp: TABLET.lowHp, fuel: TABLET.lowFuel },
  boatWarn,
  boats() {
    const list = BOAT_ORDER.filter((t) => kit.boats[t]).map((t) => {
      const S = BOAT_TYPES[t], engine = kit.boats[t].engineLv || 0;
      if (t === kit.active) return { type: t, name: S.name, active: true, engine, hp: myBoat.hp / S.hp, fuel: myBoat.fuel, tank: S.tank, where: boatWhere(myBoat), sunk: !!myBoat.sinking };
      const g = garage.get(t), gs = garageState.get(t), si = storedInfo[t];
      const fuel = g ? g.fuel : gs ? gs.fuel : si ? si.fuel : S.tank;
      const hp = g ? g.hp / S.hp : gs ? Math.max(0, 1 - gs.cracks.reduce((a, c) => a + c[2], 0) / S.hp) : si ? si.hp : 1;
      return { type: t, name: S.name, active: false, engine, hp, fuel, tank: S.tank, where: '', sunk: false };
    });
    return { list, block: boatBlock(), mods: kit.mods || {}, paints: kit.paints || ['default'], paint: kit.paint || 'default', active: kit.active, money, fishLamp: myBoat.fishLamp, canLamp: !!myBoat.parts.bowLamp,
      atPaint: !player.boat && ALL_SHELF_W.some((s) => s.id === 'paint' && Math.hypot(player.x - s.stand.x, player.z - s.stand.z) < 3.5),
      more: list.length < 2 ? '海上修船屋、大港船塢可以買更大的船：買了原地換上新船，舊船收進倉庫，在這裡換出來' : '' };
  },
  weather: weatherNow,
  dex() {
    const list = Object.entries(SPECIES).map(([id, sp]) => ({ id, name: sp.name, rarity: sp.rarity || 'common', junk: sp.kind === 'junk', e: dexBook[id] || null, isNew: dexNew.has(id) }));
    return { list, got: list.filter((f) => f.e).length, total: list.length };
  },
  dexNew: () => dexNew.size,
  dexSeen: () => dexNew.clear(),
  thumbs: () => fishThumbs(renderer),
  bag() {
    const baits = [{ id: '', name: '基本餌', n: 0, desc: '不花錢，也不加成' },
      ...Object.keys(BAITS).filter((t) => baitCount(kit, t) > 0).map((t) => ({ id: t, name: BAITS[t].name, n: baitCount(kit, t), desc: BAITS[t].desc }))];
    const mine = boxes.mine(net.id).map((d) => ({ n: d.fish.length, kg: boxes.kg(d), value: boxes.value(d), used: boxes.used(d), fish: d.fish.slice(), where: boxWhere(d) }));
    const held = fish.held ? itemLabel(fish.held) : heldBox() ? '抱著魚箱' : '空手';
    return { money, held, rod: { lv: rodLv, broken: rodBroken, range: castRange(rodLv) }, bait: kit.bait && baitCount(kit, kit.bait) > 0 ? kit.bait : '', baits, chum: kit.chum || 0, chumMax: Math.min(CHUM_SPEC.max, BOAT_TYPES[kit.active].maxChums), blessing: blessingSec(), boxes: mine, boxMax: FISHBOX.max };
  },
  ranks() {
    // atBox：人站在漁會捐款箱前面（要在那裡才能捐）
    const atBox = mode === 'walk' && !player.boat && ALL_SHELF_W.some((s) => s.id === 'title' && Math.hypot(player.x - s.stand.x, player.z - s.stand.z) < 4);
    return { room: boards.room || [], daily: boards.daily || [], donate: boards.donate || [], guild, atBox, money };
  },
  shrine() {
    return { blessing: blessingSec(), tideWait: tideWaitSec(), stormWait: stormWaitSec(), money, hot: havenFx.hot(), chums: havenFx.chums().length, skyText: skyNow().text };
  },
  room() {
    const me = meAt();
    const list = [{ id: net.id, name: net.name, title: myBadge.title, gold: myBadge.gold, lv: myBadge.lv, me: true, here: true, where: (mode === 'helm' ? '掌舵中・' : onMyBoat() ? '在自己的船上・' : '') + placeHere(me.x, me.z), far: '' }];
    for (const o of others.list()) list.push({ id: o.id, name: o.name, title: o.title || '', gold: o.gold, lv: o.lv, mate: party.has(o.id), me: false, here: o.here, where: o.here ? (o.helm ? '掌舵中・' : '') + placeHere(o.x, o.z) : '斷線中', far: o.here ? whereFrom(o.x - me.x, o.z - me.z) : '' });
    for (const p of list) { p.pid = party.of[p.id] || 0; p.lfg = !p.pid && party.lfg.has(p.id); }
    const n = party.id ? party.ids.size + 1 : 0;
    // 每一隊：隊長排第一個，其他照名單順序
    const groups = Object.entries(party.info).map(([k, r]) => {
      const id = +k, members = list.filter((p) => p.pid === id).sort((a, b) => (b.id === r.lead) - (a.id === r.lead));
      const lead = members.find((p) => p.id === r.lead);
      return { id, name: r.name || `${lead ? lead.name : ''}的船隊`, custom: !!r.name, lead: r.lead, open: r.open, members, mine: id === party.id };
    }).filter((g) => g.members.length);
    const ap = party.applied && Date.now() - party.applied.at < PARTY.applySec * 1000 ? party.applied.id : 0;
    return { name: room ? room.name : '', max: room ? room.max : 0, list, canParty: true, party: { n, full: n >= PARTY.max }, groups, solos: list.filter((p) => !p.pid),
      lead: !!party.id && party.info[party.id]?.lead === net.id, lfg: party.lfg.has(net.id), applied: ap };
  },
  drawMap,
  setWaypoint(arg) {
    if (!arg) { waypoint = null; toast('已清除導航標記'); return; }
    const hasWorld = Number.isFinite(arg.x) && Number.isFinite(arg.z);
    const wx = hasWorld ? clamp(arg.x, -L * 0.5, L * 0.5) : (clamp(arg.mx, 0, MAP_PX) / MAP_PX - 0.5) * L;
    const wz = hasWorld ? clamp(arg.z, -L * 0.5, L * 0.5) : (clamp(arg.my, 0, MAP_PX) / MAP_PX - 0.5) * L;
    if (waypoint && Math.hypot(waypoint.x - wx, waypoint.z - wz) < 35) {
      waypoint = null; toast('已取消導航標記'); return;
    }
    waypoint = { x: wx, z: wz, place: arg.place || placeHere(wx, wz) };
    toast(`📍 已設定導航標記：${waypoint.place}`);
  },
  mapWaypoint() {
    const hs = havenFx.hot();
    const onHot = hs && waypoint && Math.hypot(waypoint.x - hs.x, waypoint.z - hs.z) < 45;
    const hotBtn = hs && !onHot ? '<button class="main" data-act="navHot">📍 導航至自然魚群</button>' : '';
    if (!waypoint) return `<div class="tbNote" style="margin:0">📍 <b>導航標記：</b>尚未設定（點地圖海面或魚群即可插針導航）</div>${hotBtn ? `<div class="tbBtns" style="margin-top:6px">${hotBtn}</div>` : ''}`;
    const me = meAt(), dx = waypoint.x - me.x, dz = waypoint.z - me.z;
    const far = whereFrom(dx, dz), deg = String(Math.round(bearing(dx, dz)) % 360).padStart(3, '0');
    return `<h4>📍 導航目標：${waypoint.place}</h4><p class="tbNote">方位與距離：<b>${far}（${deg}°）</b></p><div class="tbBtns">${hotBtn}<button data-act="clearWp">清除導航標記</button></div>`;
  },
  mapHint() { const me = meAt(); return `📍 你現在在${placeHere(me.x, me.z)}。紅箭頭是你、黃箭頭是你的船、橘方塊是魚箱${TOUCH ? '' : '（按 M 可直接開關地圖）'}`; },
  mapSonar() {
    const me = meAt(), out = seaEventText(me.x, me.z), bl = blessingSec(), tw = tideWaitSec(), sw = stormWaitSec();
    if (bl > 0) out.push(`✨ 黃金魚潮生效中（剩 ${bl} 秒）`);
    else if (tw > 0) out.push(`⏳ 黃金魚潮倒數中（${tw} 秒後降臨）`);
    if (sw > 0) out.push(`⏳ 風暴海神祭倒數中（${sw} 秒後降臨）`);
    if (!kit.mods?.sonar) {
      out.push('📡 探魚聲納：尚未安裝（可至魚市場購買，即時顯示魚群剩餘尾數與倒數）');
      return out.join('<br>');
    }
    const hs = havenFx.hot(), chs = havenFx.chums(), nowS = performance.now() / 1000;
    if (hs) out.push(`🐟 ${hs.count != null ? `自然魚群：剩 ${hs.count} 尾` : '黃金魚群：不限尾數'}・${Math.max(0, Math.ceil(hs.until - nowS))} 秒`);
    else out.push('🐟 自然魚群：目前無');
    if (chs.length) {
      const c = chs[0];
      out.push(`🪣 人工魚群 ×${chs.length}：剩 ${c.count} 尾・${Math.max(0, Math.ceil(c.until - nowS))} 秒`);
    }
    return out.join('<br>');
  },
  act(name, arg, app, el) {
    if (name === 'subTab') { app.tab = arg; tablet.update(); return; }
    if (name === 'dexFilt') { app.filt = arg; tablet.update(); return; }
    if (name === 'clearWp') { tabEnv.setWaypoint(null); tablet.update(); return; }
    if (name === 'navHot') { const hs = havenFx.hot(); if (hs) tabEnv.setWaypoint({ x: hs.x, z: hs.z, place: '魚群熱點' }); tablet.update(); return; }
    if (name === 'call' || name === 'swap') {
      const why = boatBlock();
      if (why) return toast(why);
      if (!net.online) return toast('連線中斷，等接回去再試');
      if (name === 'call') return net.send({ t: 'call' });
      if (deckLoaded()) return toast('請先把甲板上的漁獲和魚箱搬下船，再換船');
      sendBoatDetail();   // 先把這艘船現在的油量、破洞告訴伺服器（收進倉庫時它要記著）
      return net.send({ t: 'swap', type: arg });
    }
    if (name === 'useChum') return castChum();
    if (name === 'fishLamp') return toggleFishLamp(myBoat);
    if (name === 'paint') { if (!net.online) return toast('連線中斷，等接回去再試'); return net.send({ t: 'buy', id: `paint:${arg}` }); }
    if (name === 'pvPaint') { app.pv = arg; tablet.update(); return; }   // 塗裝預覽：只是看看
    if (name === 'amtAdd') {   // 捐款金額的快捷鈕（arg 0 = 清除）
      app.amt = arg === '0' ? '' : String(Math.min(GUILD.max, (Math.floor(+app.amt) || 0) + +arg));
      const inp = el?.querySelector('[data-bind="amt"]');
      if (inp) inp.value = app.amt;
      return;
    }
    if (name === 'donate') {
      const amount = Math.floor(+app.amt);
      if (!Number.isFinite(amount) || amount < GUILD.min) return toast(`一次最少捐 $${GUILD.min}`);
      if (amount > money) return toast('錢不夠');
      if (!net.online) return toast('連線中斷，等接回去再試');
      app.amt = '';
      const inp = el?.querySelector('[data-bind="amt"]');
      if (inp) inp.value = '';
      return net.send({ t: 'donate', amount });
    }
    if (name === 'wear') { if (!net.online) return toast('連線中斷，等接回去再試'); return net.send({ t: 'wear', title: guild && guild.wear === arg ? '' : arg }); }
    if (name === 'partyInvite') { if (!net.online) return toast('連線中斷，等接回去再試'); return net.send({ t: 'partyInvite', to: +arg }); }
    if (name === 'partyLeave') { if (!net.online) return toast('連線中斷，等接回去再試'); return net.send({ t: 'partyLeave' }); }
    if (name === 'partyApply') { if (!net.online) return toast('連線中斷，等接回去再試'); party.applied = { id: +arg, at: Date.now() }; net.send({ t: 'partyApply', party: +arg }); tablet.update(); return; }
    if (name === 'lfg') { if (!net.online) return toast('連線中斷，等接回去再試'); return net.send({ t: 'lfg', on: arg === '1' }); }
    if (name === 'partyOpen') { if (!net.online) return toast('連線中斷，等接回去再試'); return net.send({ t: 'partyOpen', on: arg === '1' }); }
    // 交隊長、請人離開：按一次變成「確定？」，再按一次才送
    if (name === 'partyKick' || name === 'partyLead') {
      const key = `${name}:${arg}`;
      if (app.sure !== key) { app.sure = key; tablet.update(); setTimeout(() => { if (app.sure === key) { app.sure = ''; tablet.update(); } }, 4000); return; }
      app.sure = '';
      if (!net.online) return toast('連線中斷，等接回去再試');
      net.send({ t: name, to: +arg });
      tablet.update();
      return;
    }
    if (name === 'pnEdit') { app.pnEdit = true; app.pname = party.info[party.id]?.name || ''; tablet.update(); el?.querySelector('[data-bind="pname"]')?.focus(); return; }
    if (name === 'pnCancel') { app.pnEdit = false; tablet.update(); return; }
    if (name === 'pnSave') { if (!net.online) return toast('連線中斷，等接回去再試'); app.pnEdit = false; net.send({ t: 'partyName', name: (app.pname || '').trim() }); tablet.update(); return; }
    if (name === 'bless') { if (!net.online) return toast('連線中斷，等接回去再試'); return net.send({ t: 'buy', id: `bless_${arg}` }); }
    if (name === 'mapBoat') return tablet.go('map');
    if (name === 'bait') { if ((kit.bait && baitCount(kit, kit.bait) > 0 ? kit.bait : '') !== arg) setBait(arg); return; }
    if (name === 'pick') { app.sel = arg; tablet.update(); flushTabState(true); }
  },
  onFilter() { flushTabState(true); },
};
// 平板的「設定」app：把原本的設定整塊（#panel）搬進去，離開時搬回原位
const panelHome = $('panel').parentNode, panelNext = $('panel').nextSibling;
tabEnv.settings = {
  mount(el) { const pn = $('panel'); pn.classList.add('inTab'); pn.open = true; el.appendChild(pn); },
  unmount() { const pn = $('panel'); pn.classList.remove('inTab', 'gfx'); pn.open = false; panelHome.insertBefore(pn, panelNext); },
};
tablet = new Tablet(makeApps(tabEnv), {
  status() {
    const c = clockOf(climate.hour);
    return { time: `${c.part} ${c.hm}`, day: climate.day, sky: skyNow(), money, blessing: blessingSec(), tideWait: tideWaitSec(), stormWait: stormWaitSec(), room: room ? room.name : '', n: inGame ? others.count + 1 : 0, ping: net.ping, night: climate.night,
      lv: inGame ? levelOf(myExp) : null, title: myBadge.title, gold: myBadge.gold };
  },
  widgets() {
    const w = weatherNow(), b = myBoat, S = b.spec;
    const clock = `<div class="sub">${w.part}</div><div class="big">${w.hm}</div><div>${ICON[w.skyIcon]} ${w.skyText}・${w.windFrom}風 ${w.windLv} 級</div><div class="sub">浪約 ${w.waveOpen.toFixed(1)} 公尺・${w.tideShort}</div>`;
    const lowF = b.fuel < S.tank * TABLET.lowFuel, lowH = b.hp < S.hp * TABLET.lowHp;
    const boatW = `<div style="display:flex;gap:8px;align-items:baseline"><span style="white-space:nowrap">${ICON.boat} ${S.name}</span><span class="sub" style="margin-left:auto;text-align:right">${boatWhere(b)}</span></div>`
      + (b.sinking ? '<div class="sub" style="color:var(--coral-d)">沉了：港口會補一艘給你</div>'
        : `<div class="tbRows" style="margin:6px 0 0"><span>耐久</span><div class="tbMeter"><i style="width:${Math.round(b.hp / S.hp * 100)}%"${lowH ? ' class="low"' : ''}></i></div><span>${Math.round(b.hp / S.hp * 100)}%</span>`
        + `<span>燃油</span><div class="tbMeter"><i style="width:${Math.round(b.fuel / S.tank * 100)}%"${lowF ? ' class="low"' : ''}></i></div><span>${Math.floor(b.fuel)} 公升</span></div>`);
    return [clock, boatW];
  },
  changed(open, cur = undefined) {
    syncAim();
    if (open) { closeWheel(false); throwCancel(); }
    if (inGame && (cur !== undefined || !open)) syncOwnTabletTex(true);
    flushHold();
    flushTabState(true);
  },
  scroll() { flushTabState(false); if (tabHand && !view.walk.fp) syncOwnTabletTex(false); },
});
tablet.root.style.setProperty('--lift', `${TABLET.lift}s`);   // 拿起／收起平板的動畫秒數

let lastTabState = '', tabSentAt = 0;
function collectTabState() {
  const mfObj = tablet.apps.find((a) => a.id === 'map')?.filt;
  const mf = mfObj ? (mfObj.boat ? 1 : 0) | (mfObj.box ? 2 : 0) | (mfObj.others ? 4 : 0) | (mfObj.hot ? 8 : 0) : 15;
  const dexApp = tablet.apps.find((a) => a.id === 'dex');
  const dexHave = Object.keys(dexBook).filter((id) => SPECIES[id]);
  const dexSel = dexApp?.sel || '';
  const selEntry = dexSel && dexBook[dexSel];
  const dexSelStat = selEntry ? [selEntry.n, r2(selEntry.len), r2(selEntry.kg)] : null;
  const baits = Object.keys(BAITS).filter((t) => baitCount(kit, t) > 0).map((t) => [t, baitCount(kit, t)]);
  const boxesMine = boxes.mine(net.id).map((d) => [d.fish.length, Math.round(boxes.kg(d) * 10) / 10, boxes.value(d)]);
  const stored = BOAT_ORDER.filter((t) => kit.boats[t] && t !== kit.active).map((t) => {
    const S = BOAT_TYPES[t], g = garage.get(t), gs = garageState.get(t), si = storedInfo[t];
    const fuel = g ? g.fuel : gs ? gs.fuel : si ? si.fuel : S.tank;
    const hp = g ? g.hp / S.hp : gs ? Math.max(0, 1 - gs.cracks.reduce((a, c) => a + c[2], 0) / S.hp) : si ? si.hp : 1;
    return [t, Math.round(clamp(fuel / S.tank, 0, 1) * 100) / 100, Math.round(clamp(hp, 0, 1) * 100) / 100, kit.boats[t].engineLv || 0];
  });
  const lv = presetOf();
  return {
    scr: tabletScreen(), sc: tablet.scroll, mf, dexSel, dexHave, dexSelStat,
    rodLv, rodBrk: rodBroken, bait: kit.bait && baitCount(kit, kit.bait) > 0 ? kit.bait : '', baits,
    chum: kit.chum || 0, mods: kit.mods || {}, paint: kit.paint || 'default',
    title: myBadge.title || '', titles: guild?.titles || [], boxes: boxesMine, stored, money,
    gfxLv: lv >= 0 ? lv : 1, gfxPage: $('panel').classList.contains('gfx'), sound: audio.on, vol: soundVol,
  };
}
function flushTabState(force = false) {
  if (!inGame || !net.online) return;
  const active = tabOpen() && !fish.held && !heldBox() && mode === 'walk' && !player.swim && !player.seat;
  if (!active) { lastTabState = ''; return; }
  const now = performance.now();
  const d = collectTabState(), msg = JSON.stringify(d);
  if (msg !== lastTabState && (force || now - tabSentAt > 400)) {
    lastTabState = msg; tabSentAt = now;
    net.send({ t: 'ts', d });
  }
}

function remotePlaceFrom(ox, oz, mx, mz) {
  const at = placeAt(ox, oz, offAt(ox, oz));
  return { at, far: whereFrom(ox - mx, oz - mz) };
}
function buildRemoteEnv(o, st) {
  const ob = o.boat, oPos = { x: o.fig?.x ?? 0, z: o.fig?.z ?? 0 };
  const boatWhereRemote = (b) => {
    if (!b) return '';
    if (b.sinking) return '沉了';
    if (!o.st?.[8] && o.fig?.boat === b) return '你在船上';
    return `${inHarbor(b.x, b.z) ? '在港裡' : placeAt(b.x, b.z, offAt(b.x, b.z))}・${whereFrom(b.x - oPos.x, b.z - oPos.z)}`;
  };
  const weatherRemote = () => {
    const c = clockOf(climate.hour), sk = skyNow(), ms = gale.steady, lv = beaufort(ms);
    const wet = !!(o.st?.[8]) || bedAt(oPos.x, oPos.z) < 0;
    const sg = signsOf(sea);
    const tideCurve = Array.from({ length: 25 }, (_, i) => ({
      dh: i - 4,
      norm: clamp(tideAt(climate.day, climate.hour + (i - 4)) / 0.3, -1, 1),
      now: i === 4,
    }));
    return {
      time: `${c.part} ${c.hm}`, part: c.part, hm: c.hm, day: climate.day, skyIcon: sk.icon, skyText: sk.text,
      windTo: bearing(WDX, WDZ), windFrom: dirName(-WDX, -WDZ), windMs: ms, windLv: lv, windWord: windWord(lv),
      waveOpen: HS * seaOpen(ocean.scale, sea.storm), waveHere: wet ? HS * shelterAt(oPos.x, oPos.z) * levelAt(oPos.x, oPos.z) : null,
      tide: tideText(climate.day, climate.hour), tideShort: tideShort(climate.day, climate.hour), tideCurve,
      forecast: forecast(climate), signs: sg.list, danger: sg.danger,
    };
  };
  const bActive = ob ? {
    type: ob.spec.id, name: ob.spec.name, active: true, engine: ob.engineLv || 0,
    hp: ob.hp / ob.spec.hp, fuel: ob.fuel, tank: ob.spec.tank, where: boatWhereRemote(ob), sunk: !!ob.sinking,
  } : null;
  const haveSet = new Set(st?.dexHave || []);
  const remMoney = Math.max(0, Math.round(st?.money ?? 0));
  return {
    low: { hp: TABLET.lowHp, fuel: TABLET.lowFuel },
    status() {
      const c = clockOf(climate.hour);
      return { time: `${c.part} ${c.hm}`, day: climate.day, sky: skyNow(), money: remMoney, blessing: blessingSec(), room: room ? room.name : '', n: inGame ? others.count + 1 : 0, ping: 0, night: climate.night };
    },
    widgets() {
      const w = weatherRemote();
      const clock = `<div class="sub">${w.part}</div><div class="big">${w.hm}</div><div>${ICON[w.skyIcon]} ${w.skyText}・${w.windFrom}風 ${w.windLv} 級</div><div class="sub">浪約 ${w.waveOpen.toFixed(1)} 公尺・${w.tideShort}</div>`;
      const boatW = !bActive
        ? `<div class="sub">目前沒有船隻資料</div>`
        : bActive.sunk
          ? `<div>${ICON.boat} ${bActive.name}</div><div class="sub" style="color:var(--coral-d)">沉了：港口會補一艘給你</div>`
          : `<div style="display:flex;gap:8px;align-items:baseline"><span style="white-space:nowrap">${ICON.boat} ${bActive.name}</span><span class="sub" style="margin-left:auto;text-align:right">${bActive.where}</span></div>`
            + `<div class="tbRows" style="margin:6px 0 0"><span>耐久</span><div class="tbMeter"><i style="width:${Math.round(bActive.hp * 100)}%"${bActive.hp < TABLET.lowHp ? ' class="low"' : ''}></i></div><span>${Math.round(bActive.hp * 100)}%</span>`
            + `<span>燃油</span><div class="tbMeter"><i style="width:${Math.round((bActive.fuel / bActive.tank) * 100)}%"${bActive.fuel < bActive.tank * TABLET.lowFuel ? ' class="low"' : ''}></i></div><span>${Math.floor(bActive.fuel)} 公升</span></div>`;
      return [clock, boatW];
    },
    boatWarn: () => !!bActive && (bActive.sunk || bActive.hp < TABLET.lowHp || bActive.fuel < bActive.tank * TABLET.lowFuel),
    boats() {
      const list = [];
      if (bActive) list.push(bActive);
      for (const s of st?.stored || []) {
        const S = BOAT_TYPES[s[0]];
        if (!S || bActive?.type === s[0]) continue;
        list.push({ type: s[0], name: S.name, active: false, engine: s[3] || 0, hp: s[2], fuel: s[1] * S.tank, tank: S.tank, where: '', sunk: false });
      }
      return { list, block: '', mods: st?.mods || {}, paints: [st?.paint || 'default'], paint: st?.paint || 'default', more: '' };
    },
    weather: weatherRemote,
    dex() {
      const list = Object.entries(SPECIES).map(([id, sp]) => {
        const caught = haveSet.has(id);
        const e = caught ? (id === st?.dexSel && st?.dexSelStat ? { n: st.dexSelStat[0], len: st.dexSelStat[1], kg: st.dexSelStat[2], at: '' } : { n: 1, len: sp.len || 0.4, kg: 1, at: '' }) : null;
        return { id, name: sp.name, rarity: sp.rarity || 'common', junk: sp.kind === 'junk', e, isNew: false };
      });
      return { list, got: haveSet.size, total: list.length };
    },
    dexNew: () => 0,
    dexSeen() {},
    thumbs: () => fishThumbs(renderer),
    bag() {
      const bMap = new Map(st?.baits || []);
      const baits = [{ id: '', name: '基本餌', n: 0, desc: '不花錢，也不加成' },
        ...Object.keys(BAITS).filter((t) => (bMap.get(t) || 0) > 0).map((t) => ({ id: t, name: BAITS[t].name, n: bMap.get(t), desc: BAITS[t].desc }))];
      const mine = (st?.boxes || []).map((x) => ({ n: x[0], kg: x[1], value: x[2], used: 0.3, fish: [], where: '持有中' }));
      return { money: remMoney, held: '使用平板中', rod: { lv: st?.rodLv ?? 0, broken: !!st?.rodBrk, range: castRange(st?.rodLv ?? 0) }, bait: st?.bait || '', baits, chum: st?.chum ?? 0, blessing: blessingSec(), boxes: mine, boxMax: FISHBOX.max };
    },
    ranks() {
      return { room: boards.room || [], daily: boards.daily || [], donate: boards.donate || [], guild: null };
    },
    shrine() {
      return { blessing: blessingSec(), money: remMoney, hot: havenFx.hot(), chums: havenFx.chums().length, skyText: skyNow().text };
    },
    room() {
      const list = [{ name: o.name, title: o.title || '', gold: o.gold, lv: o.lv, me: true, here: true, where: o.st?.[8] ? `在船上・${placeAt(oPos.x, oPos.z, offAt(oPos.x, oPos.z))}` : placeAt(oPos.x, oPos.z, offAt(oPos.x, oPos.z)), far: '' }];
      for (const p of others.list()) {
        if (p.id === o.id) continue;
        const r = remotePlaceFrom(p.x, p.z, oPos.x, oPos.z);
        list.push({ name: p.name, title: p.title || '', gold: p.gold, lv: p.lv, me: false, here: p.here, where: p.here ? r.at : '斷線中', far: p.here ? r.far : '' });
      }
      const mr = remotePlaceFrom(mode !== 'walk' ? boat.x : player.x, mode !== 'walk' ? boat.z : player.z, oPos.x, oPos.z);
      list.push({ name: net.name, title: myBadge.title, gold: myBadge.gold, lv: myBadge.lv, me: false, here: true, where: mr.at, far: mr.far });
      return { name: room ? room.name : '', max: room ? room.max : 0, list };
    },
    mapHint: () => `目前在${placeAt(oPos.x, oPos.z, offAt(oPos.x, oPos.z))}`,
    mapSonar: () => {
      const out = seaEventText(oPos.x, oPos.z);
      if (st?.mods?.sonar) out.push('✓ 已啟用探魚聲納');
      return out.join('<br>');
    },
  };
}

const renderRemoteHtml = createRemoteTabletRenderer({ buildEnv: buildRemoteEnv, renderMap: drawMap });
renderRemoteTab = function (o, tab) {
  if (!o?.fig || !tab?.parent) return;
  const dist = Math.hypot(o.fig.x - camera.position.x, o.fig.z - camera.position.z);
  if (dist > 18) return;
  const now = performance.now();
  if (!o.tabDirty && now - (o.tabAt || 0) < 1200) return;
  if (o.tabDirty && now - (o.tabAt || 0) < 120) return;
  const c = clockOf(climate.hour), scrIdx = o.hold?.[0] === 'tablet' ? Math.round(o.hold[1] || 0) : (o.tabState?.scr ?? 0), scr = SCREENS[scrIdx] || 'home';
  const bKey = o.boat ? `${Math.round((o.boat.hp / o.boat.spec.hp) * 50)}:${Math.floor(o.boat.fuel)}` : '';
  const tick = scr === 'map' || scr === 'notice' || scr === 'room' ? Math.floor(now / 1500) : 0;
  const evKey = scr === 'map' ? `${sea.phase}:${sea.vortices.length}:${sea.ev?.x ?? ''}` : '';
  const hash = `${scr}|${c.hm}|${climate.day}|${others.count}|${bKey}|${tick}|${evKey}|${JSON.stringify(o.tabState || null)}`;
  o.tabDirty = false;
  if (hash === tab.userData.liveHash) return;
  tab.userData.liveHash = hash;
  o.tabAt = now;
  renderRemoteHtml(o, tab, TOUCH || presetOf() === 0 ? 512 / 696 : 1);
};

// 畫面上指向自己的船：離船超過 TABLET.markFar 公尺（而且不在船上）時，看得到就標在船上方，看不到就貼在畫面邊上。
// 叫船、換船之後不管多近都標 TABLET.markSec 秒（亮珊瑚色、會跳），讓人知道船停在哪（不講第幾號船位）
const boatMarkEl = document.createElement('div');
boatMarkEl.style.cssText = 'position:fixed;z-index:6;pointer-events:none;transform:translate(-50%,-50%);padding:3px 10px 3px 7px;border-radius:12px;display:none;align-items:center;gap:4px;'
  + 'font:600 13px var(--font);white-space:nowrap;background:var(--paper);color:var(--ink);border:2px solid var(--sea);box-shadow:0 2px 6px rgba(0,0,0,.25)';
document.body.appendChild(boatMarkEl);
{
  const st = document.createElement('style');
  st.textContent = `.boatMark.flash { background: var(--coral) !important; color: #fff !important; border-color: #fff !important; font-size: 15px !important; animation: boatHop 0.8s ease-in-out infinite; }
@keyframes boatHop { 0%, 100% { translate: 0 0; } 50% { translate: 0 -8px; } }`;
  document.head.appendChild(st);
  boatMarkEl.className = 'boatMark';
}
const _bm = new THREE.Vector3();
let boatMarkText = '', boatMarkUntil = 0;
const flashMyBoat = () => { boatMarkUntil = performance.now() + TABLET.markSec * 1000; };
function markMyBoat() {
  const b = myBoat, me = meAt(), d = Math.hypot(b.x - me.x, b.z - me.z), flash = performance.now() < boatMarkUntil;
  const on = inGame && !tabOpen() && mode === 'walk' && !b.sinking && player.boat !== b && (d > TABLET.markFar || flash);
  boatMarkEl.classList.toggle('flash', on && flash);
  boatMarkEl.style.display = on ? 'flex' : 'none';
  if (!on) return;
  _bm.set(b.x, b.y + 3, b.z).project(camera);
  const behind = _bm.z > 1;
  let sx = behind ? -_bm.x : _bm.x, sy = behind ? -_bm.y : _bm.y;
  const edge = Math.max(Math.abs(sx), Math.abs(sy));
  if (behind || edge > 0.9) { const k = 0.9 / Math.max(edge, 1e-3); sx *= k; sy *= k; }
  boatMarkEl.style.left = `${(sx * 0.5 + 0.5) * window.innerWidth}px`;
  boatMarkEl.style.top = `${(-sy * 0.5 + 0.5) * window.innerHeight}px`;
  const t = flash && d <= TABLET.markFar ? `你的${b.spec.name}在這` : `你的${b.spec.name} ${Math.round(d / 10) * 10}m`;
  if (t !== boatMarkText) { boatMarkText = t; boatMarkEl.innerHTML = `${ICON.boat}${t}`; }
}

// 畫面上指向地圖設定的導航標記點（到達 18 公尺內自動完成清除）；標示抬高並以垂直虛線連到下方目標點，避免遮擋海面與船隻視線
const wpMarkEl = document.createElement('div');
wpMarkEl.style.cssText = 'position:fixed;z-index:6;pointer-events:none;display:none;flex-direction:column;align-items:center;'
  + 'filter:drop-shadow(0 1px 3px rgba(6,24,40,0.65));';
const wpPillEl = document.createElement('div');
wpPillEl.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 10px 3px 7px;border-radius:12px;'
  + 'font:600 13px var(--font);white-space:nowrap;background:rgba(16, 48, 72, 0.88);color:#8af3ff;border:2px solid #45e2ff;box-shadow:0 2px 8px rgba(0,0,0,.3)';
const wpLineEl = document.createElement('div');
wpLineEl.style.cssText = 'width:0;border-left:2px dashed rgba(138, 243, 255, 0.9);';
const wpDotEl = document.createElement('div');
wpDotEl.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#ffffff;border:2px solid #45e2ff;box-sizing:border-box;';
wpMarkEl.append(wpPillEl, wpLineEl, wpDotEl);
document.body.appendChild(wpMarkEl);
let wpMarkText = '';
function markWaypoint() {
  if (!inGame || !waypoint) { wpMarkEl.style.display = 'none'; return; }
  const me = meAt(), d = Math.hypot(waypoint.x - me.x, waypoint.z - me.z);
  if (d < 18) {
    toast(`✓ 已抵達導航標記點（${waypoint.place}）`);
    waypoint = null;
    wpMarkEl.style.display = 'none';
    return;
  }
  if (tabOpen()) { wpMarkEl.style.display = 'none'; return; }
  wpMarkEl.style.display = 'flex';
  const wy = Math.max(0, bedAt(waypoint.x, waypoint.z)) + 1.0;
  _bm.set(waypoint.x, wy, waypoint.z).project(camera);
  const behind = _bm.z > 1;
  let sx = behind ? -_bm.x : _bm.x, sy = behind ? -_bm.y : _bm.y;
  const edge = Math.max(Math.abs(sx), Math.abs(sy));
  const clamped = behind || edge > 0.9;
  if (clamped) { const k = 0.9 / Math.max(edge, 1e-3); sx *= k; sy *= k; }
  const W = window.innerWidth, H = window.innerHeight;
  const ax = (sx * 0.5 + 0.5) * W, ay = (-sy * 0.5 + 0.5) * H;
  const wantStem = Math.min(150, Math.max(84, Math.round(H * 0.17)));
  const stem = !clamped ? Math.min(wantStem, Math.max(0, Math.round(ay - 88))) : 0;
  if (stem >= 14) {
    wpLineEl.style.display = 'block';
    wpLineEl.style.height = `${stem}px`;
    wpDotEl.style.display = 'block';
    wpMarkEl.style.transform = 'translate(-50%, -100%)';
    wpMarkEl.style.left = `${ax}px`;
    wpMarkEl.style.top = `${ay + 4}px`;
  } else {
    wpLineEl.style.display = 'none';
    wpDotEl.style.display = 'none';
    wpMarkEl.style.transform = 'translate(-50%, -50%)';
    wpMarkEl.style.left = `${ax}px`;
    wpMarkEl.style.top = `${Math.max(66, ay)}px`;
  }
  const t = `導航・${waypoint.place} ${d < 100 ? `${Math.round(d)}m` : `${Math.round(d / 10) * 10}m`}`;
  if (t !== wpMarkText) { wpMarkText = t; wpPillEl.innerHTML = `${ICON.pin}${t}`; }
}

const compass = new CompassBar($('compass'));
const _cmpDir = new THREE.Vector3(), _cmpList = [];
function updateCompass() {
  const on = inGame && !tabOpen() && mode !== 'sink';
  if (!on) { compass.update(false, 0, _cmpList); return; }
  camera.getWorldDirection(_cmpDir);
  const camDeg = Math.hypot(_cmpDir.x, _cmpDir.z) > 0.02
    ? bearing(_cmpDir.x, _cmpDir.z)
    : ((player.lookYaw * 180 / Math.PI + 90) % 360 + 360) % 360;
  const me = meAt(), sonar = !!kit.mods?.sonar;
  _cmpList.length = 0;
  const hs = havenFx.hot();
  const wpOnHot = !!(waypoint && hs && Math.hypot(waypoint.x - hs.x, waypoint.z - hs.z) < 45);
  if (waypoint) {
    const dx = waypoint.x - me.x, dz = waypoint.z - me.z;
    _cmpList.push({ kind: 'wp', deg: bearing(dx, dz), dist: Math.hypot(dx, dz), count: wpOnHot && sonar && hs.count != null ? hs.count : null, hotLinked: wpOnHot, edge: true });
  }
  if (hs && !wpOnHot) {
    const dx = hs.x - me.x, dz = hs.z - me.z;
    _cmpList.push({ kind: 'hot', deg: bearing(dx, dz), dist: Math.hypot(dx, dz), count: sonar && hs.count != null ? hs.count : null, edge: true });
  }
  for (const ch of havenFx.chums()) {
    const dx = ch.x - me.x, dz = ch.z - me.z, dist = Math.hypot(dx, dz);
    if (dist < 360) _cmpList.push({ kind: 'chum', deg: bearing(dx, dz), dist, count: sonar ? ch.count : null, edge: dist > 25 });
  }
  const b = myBoat;
  if (b && !b.sinking && player.boat !== b) {
    const dx = b.x - me.x, dz = b.z - me.z, dist = Math.hypot(dx, dz);
    if (dist > TABLET.markFar || performance.now() < boatMarkUntil) {
      _cmpList.push({ kind: 'boat', deg: bearing(dx, dz), dist, edge: false });
    }
  }
  compass.update(true, camDeg, _cmpList);
}

// 叫船：伺服器分好最近的空船位，船直接放過去（纜繩解開、停下來）
net.on('called', (m) => {
  berth = m.berth;
  const b = myBoat;
  b.moor = null;
  b.x = m.berth.x; b.z = m.berth.z; b.heading = m.berth.heading; b.speed = 0; b.throttle = 0; b.rudder = 0;
  lastBoatMsg = lastBoatDetail = '';
  audio.play('rope');
  toast(`${b.spec.name}停到你附近了`);
  flashMyBoat();
  tablet.update(true);
});


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
    $('barFill').style.background = 'var(--sun)';
    $('fishLabel').textContent = '拋竿力道';
    touchSet($('fishHint'), '放開 F 拋出去');
    return;
  }
  $('barFill').style.width = '0';
  $('barSafe').style.left = `${(fishing.zone - fishing.zoneW / 2) * 100}%`;
  $('barSafe').style.width = `${fishing.zoneW * 100}%`;
  $('barMark').style.left = `${fishing.force * 100}%`;
  $('barMark').style.background = fishing.inZone ? 'var(--ink)' : 'var(--coral)';
  $('progFill').style.width = `${clamp(fishing.progress, 0, 1) * 100}%`;
  $('fishLabel').textContent = `把指標維持在綠色區間內　還有 ${Math.max(fishing.dist, 0).toFixed(0)} 公尺`;
  touchSet($('fishHint'), strain > 0.5 ? '釣竿快斷了！放開 F！' : fishing.inZone ? '很好，保持住' : fishing.force < fishing.zone ? '力道不夠：按住 F' : '太用力了：放開 F');
}

// ---- 多人：跟伺服器對時、送出自己的狀態、照伺服器說的更新 -----------------------
let mergeAt = 0;   // 這間房幾時要合併到別間（倒數用；0 = 沒有）
let blessingUntilMs = 0, tideWaitUntilMs = 0, stormWaitUntilMs = 0;
const secLeft = (untilMs) => Math.max(0, Math.ceil((untilMs - performance.now()) / 1000));
const blessingSec = () => secLeft(blessingUntilMs);
const tideWaitSec = () => secLeft(tideWaitUntilMs);
const stormWaitSec = () => secLeft(stormWaitUntilMs);
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
  if (w.lights) applyRoomLights(w.lights);
  if (w.extras) havenFx.sync(w.extras);
  if (typeof w.blessingLeft === 'number') blessingUntilMs = performance.now() + w.blessingLeft * 1000;
  if (typeof w.tideWait === 'number') tideWaitUntilMs = performance.now() + w.tideWait * 1000;
  if (typeof w.stormWait === 'number') stormWaitUntilMs = performance.now() + w.stormWait * 1000;
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
function flushHold() {
  if (!inGame || !net.online) return;
  const h = fish.held;
  const tab = tabOpen() && !h && !heldBox() && mode === 'walk' && !player.swim && !player.seat;
  const scr = tab ? tabletScreen() : 0;
  const hk = h ? `${h.id}:${r2(h.len)}` : tab ? `tablet:${scr}` : '';
  if (hk !== lastHold) {
    lastHold = hk;
    net.send({ t: 'h', id: h ? h.id : tab ? 'tablet' : '', len: h ? r2(h.len) : tab ? scr : 0 });   // 平板：len 是哪個畫面
  }
}
function sendState(dt) {
  if (!inGame || !net.online) return;
  if ((sendAcc += dt) < 0.1) return;
  sendAcc = Math.min(sendAcc - 0.1, 0.1);
  const now = performance.now(), helm = mode === 'helm';
  // 人：[x, y, z, 面向, 狀態, 跳多高, 視線左右, 上下, 站在誰的船上, 船上座標 x, z, 動作, 表情]。站在船上時 y 是離甲板多高
  let st;
  if (mode === 'sink' && wreck) st = [r2(wreck.boat.x), 0, r2(wreck.boat.z), r3(player.yaw), 4, 0, 0, 0, 0, 0, 0, '', ''];
  else {
    const b = helm ? boat : player.boat, l = b ? b.toLocal(player.x, player.z) : null;   // 掌舵的可能是隊友的船（副駕）
    const flags = (player.moving ? 1 : 0) | (player.run ? 2 : 0) | (player.swim ? 4 : 0) | (player.carry ? 8 : 0) | (player.rod ? 16 : 0) | (helm ? 32 : 0) | (player.seat ? 64 : 0);
    st = [r2(helm ? boat.x : player.x), r2(b ? player.y - b.deckY(player.x, player.z) : player.y), r2(helm ? boat.z : player.z), r3(player.yaw), flags, r2(Math.max(player.h, 0)),
      r3(player.lookYaw), r3(player.lookPitch), b ? (b === myBoat ? net.id : b.owner.id) : 0, l ? r2(l.x) : 0, l ? r2(l.z) : 0, player.act ? player.act.id : '', player.mood || ''];
  }
  let msg = JSON.stringify(st);
  if (msg !== lastPosMsg || now - lastPosAt > 1000) { lastPosMsg = msg; lastPosAt = now; net.send({ t: 'p', s: st }); }
  // 手上拿著什麼、平板摘要、釣線另一頭的浮標在哪：給別人看的，有變才送
  flushHold();
  flushTabState(false);
  const bp = fishing.bob.position, fs = fishing.state;
  const ln = fishing.bob.visible && mode === 'walk' ? [r2(bp.x), r2(bp.y), r2(bp.z), fs === 'fly' ? 1 : fs === 'fight' ? 3 : 2] : null;
  const lk = ln ? ln.join() : '';
  if (lk !== lastLine) { lastLine = lk; net.send({ t: 'fl', s: ln }); }
  // 幫隊友開的那艘：位置由我這邊送（帶著船主是誰）
  if (copilot && !copilot.boat.sinking) { const cs = copilot.boat.netState(); copilot.boat.net = cs; net.send({ t: 'b', forId: copilot.id, s: cs }); }
  // 船：停著沒人開的時候不用送那麼勤（隊友正在幫我開的話，由他那邊送）
  if (myBoat.sinking || myBoat._lost || piloted) return;
  const bs = myBoat.netState(), idle = !myBoat.manned && Math.abs(myBoat.speed) < 0.3;
  msg = JSON.stringify(bs);
  if ((msg !== lastBoatMsg && (!idle || now - lastBoatAt > 400)) || now - lastBoatAt > 1000) { lastBoatMsg = msg; lastBoatAt = now; net.send({ t: 'b', s: bs }); }
  // 破洞和纜繩：兩秒看一次（或自動抽水龍骨修完/累積修補時馬上送）
  if (++detailN >= 20) { detailN = 0; sendBoatDetail(); }
}

// 自己身上、船上、籃子裡所有魚的編號
function myFishUids() {
  const all = [...fish.items, ...fish.basket, fish.held];
  return all.filter((it) => it && it.uid && !it.remote).map((it) => it.uid);
}
// 這艘船是誰的（玩家編號）；放在倉庫裡、別人看不到的船是 null
function boatOwner(b) {
  if (b === myBoat) return net.id;
  for (const [id, o] of others.map) if (o.boat === b) return id;
  return null;
}

// ---- 大家放在外面的魚：別人放下、撿走、賣掉；自己的被撿走、放太久消失 ----
let grabbing = 0;   // 正在問伺服器能不能撿的那條（避免連按）
net.on('loose', (m) => {
  for (const uid of m.del ?? []) fish.removeRemote(uid);
  for (const d of m.add ?? []) if (d.o !== net.id) fish.addRemote(d);
  refreshBoard();
});
// 別人放在外面的魚（remote）：mine 是魚的主人（釣到的人／收下的人）。自己的、隊友的才能拿；主人走了（不在房裡）誰都能拿
const canGrab = (it) => it.mine === net.id || party.has(it.mine) || !others.map.has(it.mine);
function remoteFishText(it) {
  if (it.mine === net.id) return `按 E 拿回你的${it.sp.name}`;
  const who = others.map.get(it.mine)?.name;
  if (!who) return `按 E 撿起${it.sp.name}`;
  return canGrab(it) ? `按 E 幫 ${who} 拿起${it.sp.name}（還是他的，賣掉的錢給他）` : `${who} 的${it.sp.name}（只有他和他的隊友能拿）`;
}
net.on('grabbed', (m) => {
  grabbing = 0;
  const f = m.fish;
  fish.removeRemote(f.uid);
  refreshBoard();
  audio.play('pick');
  if (fish.held) fish.stowDeck(myBoat, 0, 0, f.id, f.kg, f.len, f.uid, f.value);   // 手上剛好有東西（按下去之後才拿起來的）：放到自己船上
  else fish.spawnHeld(f.id, f.kg, f.len, f.uid, f.value).lively = 0;
  toast(m.of ? `幫 ${m.of} 拿著他的魚（賣掉的錢還是給他）` : `拿起${m.from ? ` ${m.from} 放的` : ''}魚`);
});
net.on('grabNo', (m) => {
  grabbing = 0;
  if (m.msg) toast(m.msg); else { fish.removeRemote(m.uid); toast('被別人先撿走了'); }
});
net.on('taken', (m) => {
  const it = fish.removeOwn(m.uid);
  refreshBoard();
  if (it) toast(`${m.by} 撿走了你的${it.sp.name}`);
});
// ---- 魚箱：伺服器說箱子變了（誰抱著、放在哪、裡面有什麼）就照著重畫 ----
net.on('box', (m) => {
  for (const bid of m.del ?? []) boxes.del(bid);
  for (const d of m.add ?? []) boxes.set(d);
});
// 買魚箱：已經有兩個了，先問要不要清掉最舊的那個
net.on('boxFull', async (m) => {
  buying = false;
  const yes = await ask(`你已經有 ${FISHBOX.max} 個魚箱了。\n買新的會把最舊的那個收走${m.n ? `，裡面的 ${m.n} 條魚會一起不見` : ''}。`, { yes: '買新的', no: '不買了' });
  if (yes && net.online) net.send({ t: 'buy', id: 'box', replace: true });
});
net.on('boxedIn', (m) => {
  if (fish.held && fish.held.uid === m.uid) fish.discardHeld();
  pendingIn.delete(m.uid);
  audio.play('drop');
  if (m.to) toast(`放進 ${m.to} 的魚箱，送給他了`);
});
net.on('boxNo', (m) => { if (pendingIn.has(m.uid)) boxBounce(m.uid, m.msg); else if (m.msg) toast(m.msg); });
net.on('boxGift', (m) => toast(`${m.from} 放了一條${SPECIES[m.id]?.name ?? '魚'}到你的魚箱`));
net.on('hatchPoured', (m) => {
  if (!m.n) return toast(m.into ? '魚艙滿了，倒不進去' : '魚箱裝不下了');
  audio.play('drop');
  toast(m.into ? `倒了 ${m.n} 條進魚艙${m.left ? `，箱子裡還剩 ${m.left} 條（艙滿了）` : ''}` : `從魚艙裝了 ${m.n} 條到魚箱${m.left ? `，艙裡還剩 ${m.left} 條` : ''}`);
});
net.on('boxOut', (m) => {
  const f = m.fish;
  audio.play('pick');
  if (fish.held) fish.stowDeck(myBoat, 0, 0, f.id, f.kg, f.len, f.uid, f.value);
  else fish.spawnHeld(f.id, f.kg, f.len, f.uid, f.value).lively = 0;
});

// ---- 送東西：對方要按接受 ----
net.on('offering', (m) => toast(`等 ${m.to} 回答要不要收…`));
net.on('giveNo', (m) => toast(m.msg || '對方沒有收'));
net.on('offer', async (m) => {
  const w = m.what, what = w.box !== undefined ? `一個魚箱（裡面 ${w.box} 條魚、${w.kg.toFixed(1)} 公斤、值 ${cash(w.value)}）`
    : `一條${SPECIES[w.id]?.name ?? '魚'}（${Math.round(w.len * 100)} 公分、${w.kg.toFixed(2)} 公斤、值 ${cash(w.value)}）`;
  const yes = await ask(`${m.from} 想送你${what}`, { yes: '收下', no: '不要', sec: m.sec, tag: `offer${m.oid}` });
  if (net.online) net.send({ t: 'giveAns', oid: m.oid, yes });
});
net.on('offerGone', (m) => cancelAsk(`offer${m.oid}`));
net.on('gave', (m) => {   // 對方收下了：手上那條（或抱著的箱子，由 box 訊息重畫）給出去
  if (m.uid && fish.held && fish.held.uid === m.uid) fish.discardHeld();
  else if (m.uid) fish.removeOwn(m.uid);
  toast(`${m.to} 收下了`);
});
net.on('gift', (m) => {   // 收到別人送的：魚拿在手上（手上有東西就放到自己船上）；箱子由 box 訊息畫在手上
  if (m.fish) {
    const f = m.fish;
    if (fish.held || heldBox()) fish.stowDeck(myBoat, 0, 0, f.id, f.kg, f.len, f.uid, f.value);
    else fish.spawnHeld(f.id, f.kg, f.len, f.uid, f.value).lively = 0;
    toast(`收下 ${m.from} 送的${SPECIES[f.id]?.name ?? '魚'}`);
  } else {
    if (fish.held) fish.drop();
    toast(`收下 ${m.from} 送的魚箱（${m.n} 條魚）`);
  }
  audio.play('pick');
});
net.on('expired', (m) => {
  let n = 0;
  for (const uid of m.uids) if (fish.removeOwn(uid)) n++;
  refreshBoard();
  if (n) toast(m.msg || `放在外面太久沒人拿的 ${n} 條魚不見了`);
});

net.on('k', (m) => {
  for (const q of m.p) if (q[0] !== net.id) others.setPos(q[0], q.slice(1));
  for (const q of m.b) {
    if (q[0] !== net.id) others.setBoatState(q[0], q.slice(1));
    else if (piloted && !myBoat.sinking) {
      // 隊友正在幫我開：我的船照他傳來的位置擺；他那邊撞壞的也算在我的船上
      const s = q.slice(1), lost = myBoat.hp / myBoat.spec.hp - s[11], lamp = myBoat.fishLamp;
      myBoat.setNet(s);
      if (lamp !== myBoat.fishLamp && tabOpen()) tablet.update();   // 平板「船」頁的集魚燈按鈕跟著換字
      if (lost > 0.01) myBoat.hurt(lost * myBoat.spec.hp);
    }
  }
});
net.on('world', (m) => applyWorld(m));
net.on('join', (m) => others.add({ id: m.id, name: m.name, title: m.title || '', gold: m.gold, lv: m.lv, look: m.look, here: m.here, boat: m.boat }));
net.on('h', (m) => others.setHold(m.id, m.s));
net.on('ts', (m) => others.setTabState(m.id, m.d));
net.on('fl', (m) => others.setLine(m.id, m.s));
net.on('leave', (m) => { clearMateProps(m.id); others.leave(m.id, m.reclaimMs); });
net.on('passengerReturn', returnPassenger);
net.on('boatGone', (m) => others.boatGone(m.id));
net.on('boat', (m) => { if (m.id !== net.id) others.setBoat(m.id, m.boat); });
net.on('sunk', (m) => { const b = m.id === net.id ? myBoat : others.boat(m.id); if (m.id === net.id) piloted = null; if (b) b.founder(m.why, m.side); });   // 自己的：隊友幫我開的時候沉了

// ---- 漁會、等級、船隊、拖船、副駕 ----
// 右上角的等級、稱號徽章
function showBadge() {
  $('hLv').textContent = `Lv.${myBadge.lv}`;
  const el = $('hTitle');
  if (el.textContent !== myBadge.title) el.textContent = myBadge.title;
  el.classList.toggle('gold', !!myBadge.gold);
}
function setParty(of, info = {}, lfg = []) {
  if ((of[net.id] || 0) !== party.id) propsSent = '';   // 換了隊（或剛入隊）：伺服器那邊我的桶子清單清掉了，下一次整份重送
  party.id = of[net.id] || 0;
  party.of = of;
  party.info = info;
  party.lfg = new Set(lfg);
  if (party.id) party.applied = null;
  chat.setParty(!!party.id);
  party.ids = new Set(party.id ? Object.keys(of).map(Number).filter((id) => id !== net.id && of[id] === party.id) : []);
  others.setMates(party.ids);
  for (const id of [...mateProps.keys()]) if (!party.ids.has(id)) clearMateProps(id);   // 已經不是隊友：他的桶子不再看得到
  if (tabOpen()) tablet.update();
}
// ---- 隊友的桶子：同隊的人看得到彼此放在甲板、地上的油桶和誘魚桶，外面一圈藍色粗描邊（只是看得到，拿不走）；沒組隊的人看不到 ----
const mateProps = new Map();   // 隊友 id → { list 伺服器轉來的清單, objs 擺出來的模型, wait 有東西還擺不出來（那艘船還沒出現） }
// 描邊的畫法（都不透明，不動畫面的 alpha）：排在其他不透明的東西之後，分三步——
//   1. 先畫一個大一號的藍色外殼（不寫深度）；2. 再畫桶子本身，蓋在外殼上，四周就露出一圈藍邊；
//   3. 最後外殼只寫深度不上色：之後才畫的天空就不會把那圈藍邊蓋掉。
const propOutlineMat = new THREE.MeshBasicMaterial({ color: PARTY.propOutline, side: THREE.DoubleSide, depthWrite: false });
const propDepthMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false });
const PROP_ORDER = { shell: 990, body: 991, depth: 992 };   // 海面是 2、天空是 1e6
function makeMateProp(chum) {
  const g = chum ? makeChumMesh() : makeCanMesh(), w = PARTY.propOutlineW;
  g.traverse((o) => { if (o.isMesh) o.renderOrder = PROP_ORDER.body; });
  const geo = chum ? new THREE.CylinderGeometry(0.156 + w, 0.15 + w, 0.47 + w * 2, 14) : new THREE.BoxGeometry(0.30 + w * 2, 0.415 + w * 2, 0.18 + w * 2);
  const shell = new THREE.Mesh(geo, propOutlineMat), depth = new THREE.Mesh(geo, propDepthMat);
  shell.position.y = depth.position.y = chum ? 0.045 : 0.0275;
  shell.renderOrder = PROP_ORDER.shell; depth.renderOrder = PROP_ORDER.depth;
  g.add(shell, depth);
  return g;
}
function clearMateProps(id) {
  const e = mateProps.get(id);
  if (!e) return;
  for (const g of e.objs) {
    g.removeFromParent();
    g.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); if (o.material !== propOutlineMat && o.material !== propDepthMat) o.material.dispose(); } });
  }
  mateProps.delete(id);
}
function setMateProps(id, list) {
  clearMateProps(id);
  if (!party.has(id) || !Array.isArray(list) || !list.length) return;
  const e = { list, objs: [], on: new Map() };   // on：清單裡提到的每艘船（船主 id）→ 擺的當下是哪一艘（null = 那時候還沒有、或正在沉）
  for (const [kind, oid, a, y, c] of list.slice(0, PARTY.propsMax)) {
    const b = oid ? propBoat(oid) : null;
    if (oid) e.on.set(oid, b);
    if (oid && !b) continue;
    const g = makeMateProp(kind === 1);
    if (b) { b.mesh.add(g); g.position.set(a, (b.deckLocalY?.(a, c) ?? b.spec.deck) + 0.22, c); }
    else { scene.add(g); g.position.set(a, y + 0.22, c); }
    e.objs.push(g);
  }
  mateProps.set(id, e);
}
const propBoat = (oid) => { const b = boatOfId(oid); return b && !b.sinking ? b : null; };
net.on('props', (m) => { if (m.id !== net.id) setMateProps(m.id, m.list); });
// 把我放在外面的桶子告訴隊友（有變才送；沒組隊就送空的）。順便把之前擺不出來的隊友桶子再試一次
let propsSent = '[]', propsWait = 0, propsAge = 0;
function syncProps(dt) {
  propsWait -= dt;
  if (propsWait > 0 || !inGame || !net.online) return;
  propsWait = 0.5;
  // 隊友的桶子擺在哪艘船上：那艘船換了（換船、被收走又回來）或之前沒有、現在出現了，才整份重擺
  for (const [id, e] of mateProps) { let stale = false; for (const [oid, was] of e.on) if (propBoat(oid) !== was) { stale = true; break; } if (stale) setMateProps(id, e.list); }
  const list = [];
  if (party.id) for (const it of fish.items) {
    if (!it.can || it.fly || it.remote || list.length >= PARTY.propsMax || (it.state === 'boat' && it.boat.sinking)) continue;
    if (it.state === 'boat') { const oid = it.boat === myBoat ? net.id : it.boat.owner?.id; if (oid) list.push([it.chum ? 1 : 0, oid, r2(it.lx), 0, r2(it.lz)]); }
    else if (it.state === 'ground') list.push([it.chum ? 1 : 0, 0, r2(it.x), r2(it.y), r2(it.z)]);
  }
  const s = JSON.stringify(list);
  propsAge += 0.5;
  if (s === propsSent && (propsAge < PARTY.propsResend || s === '[]')) return;   // 沒變就不送；每隔一陣子整份再送一次（哪一則沒送到也會自己補回來）
  propsSent = s; propsAge = 0;
  net.send({ t: 'props', list });
}
// 進房、重連、合併時伺服器給的那一包
function applySocial(j) {
  for (const id of [...mateProps.keys()]) clearMateProps(id);
  propsSent = '[]';
  if (j.me) myBadge = { title: j.me.title || '', gold: !!j.me.gold, lv: j.me.lv || 1 };
  if (j.guild !== undefined) guild = j.guild;
  myExp = dexBook?._lv?.exp || 0;
  setParty(j.party || {}, j.parties || {}, j.lfg || []);
  tows = (j.tows || []).map(([tug, tow]) => ({ tug, tow }));
  endCopilot(false);
  piloted = j.pilot ? { id: j.pilot, name: others.map.get(j.pilot)?.name || '隊友' } : null;
  if (!piloted) myBoat.net = null;
  showBadge();
}
net.on('title', (m) => {
  if (m.id === net.id) { myBadge.title = m.title || ''; myBadge.gold = !!m.gold; showBadge(); if (tabOpen()) tablet.update(); } else others.setTitle(m.id, m.title || '', !!m.gold);
});
net.on('lv', (m) => { if (m.id !== net.id) others.setBadge(m.id, { lv: m.lv }); });
net.on('exp', (m) => {
  myExp = m.exp;
  if (m.up) { myBadge.lv = m.lv; showBadge(); audio.play('coin'); toast(`🎉 升級了！現在是 Lv.${m.lv}`); }
});
net.on('guild', (m) => { guild = m.guild; if (tabOpen()) tablet.update(); });
net.on('donated', (m) => {
  guild = m.guild;
  audio.play('coin');
  toast(`捐了 ${cash(m.amount)} 給漁會，這一週累積 ${cash(m.guild?.amount ?? m.amount)}${m.fresh?.length ? `　解鎖稱號：${m.fresh.join('、')}` : ''}`);
  if (tabOpen()) tablet.update();
});
net.on('party', (m) => setParty(m.of || {}, m.info || {}, m.lfg || []));
net.on('partyBonus', (m) => { applyKit(m.kit); audio.play('coin'); toast(`🤝 隊友 ${m.from} 賣魚，船隊分紅 +${cash(m.amount)}`); });
// 別人問我：要不要加入船隊、要不要拖船
net.on('ask', async (m) => {
  const lv = others.map.get(m.fromId)?.lv;
  const text = m.kind === 'party' ? `${m.from} 邀你加入船隊`
    : m.kind === 'apply' ? `${m.from}${lv ? `（Lv.${lv}）` : ''} 想加入你的船隊`
    : m.me ? `${m.from} 想請你用你的船拖他的【${m.boat}】，是否同意？` : `${m.from} 想用【${m.boat}】拖行你的船，是否同意？`;
  const yes = await ask(text, { yes: m.kind === 'party' ? '加入船隊' : m.kind === 'apply' ? '讓他加入' : '同意', no: m.kind === 'tow' ? '拒絕' : '婉拒', sec: m.sec, tag: `ask${m.aid}` });
  if (net.online) net.send({ t: 'askAns', aid: m.aid, yes });
});
net.on('askGone', (m) => cancelAsk(`ask${m.aid}`));
net.on('tow', (m) => {
  tows = tows.filter((t) => t.tug !== m.tugId && t.tow !== m.towId).concat({ tug: m.tugId, tow: m.towId });
  const name = (id) => others.map.get(id)?.name ?? '對方';
  if (m.towId === net.id) { myBoat.moor = null; lastBoatDetail = ''; toast(`拖纜接上了：${name(m.tugId)} 正在拖你的船（按 T、踩油門、或對準拖船樁按 E 就解開）`); audio.play('rope'); }
  else if (m.tugId === net.id) { toast(`拖纜接上了：你正在拖 ${name(m.towId)} 的船（極速會慢一些；按 T 解開）`); audio.play('rope'); }
});
net.on('towCut', (m) => {
  tows = tows.filter((t) => !(t.tug === m.tugId && t.tow === m.towId));
  if (m.tugId === net.id || m.towId === net.id || (copilot && (m.tugId === copilot.id || m.towId === copilot.id))) { toast(m.why || '拖纜解開了'); audio.play('rope'); }
});
// 副駕
net.on('helmOk', (m) => beginCopilot(m.forId, m.s));
// 隊友請我這邊動船（我的船，或我正在幫忙開的那艘）：開關船燈、集魚燈，綁、解岸上的纜繩
net.on('boatCtl', (m) => {
  const b = m.forId === net.id ? (piloted ? null : myBoat) : copilot && copilot.id === m.forId ? copilot.boat : null;
  if (!b || b.sinking) return;
  const mine = b === myBoat, who = m.by || '隊友';
  if (m.what === 'lamp') { b.lampOn = !b.lampOn; audio.play('switch'); toast(`${who} ${b.lampOn ? '打開' : '關掉'}了船燈`); }
  else if (m.what === 'fishLamp') { if (!b.mods.lamp || !b.parts.bowLamp) return; b.setFishLamp(!b.fishLamp); audio.play('switch'); toast(`${who} ${b.fishLamp ? '打開' : '關掉'}了集魚燈`); if (tabOpen()) tablet.update(); }
  else if (m.what === 'unmoor' && mine) { if (!b.moor) return; b.moor = null; audio.play('rope'); toast(`${who} 幫你解開了${b.spec.name}的纜繩`); }
  else if (m.what === 'moor' && mine) {
    const spot = !b.moor && BOLLARDS[m.i] ? moorSpot(m.i, [b], MOOR_REACH + 2) : null;
    if (!spot) return;
    tieBoat(spot); audio.play('rope'); toast(`${who} 幫你把${b.spec.name}的纜繩綁好了`);
  }
});
net.on('pilotEnd', (m) => { if (copilot && copilot.id === m.forId) { endCopilot(false); toast('方向盤交回給船主了'); } });
net.on('pilot', (m) => {
  resetBoatFx(myBoat);
  if (!m.id) { piloted = null; myBoat.net = null; lastBoatMsg = ''; return; }
  piloted = { id: m.id, name: m.name || '隊友' };
  myBoat.moor = null;   // 隊友要把船開走：岸上的纜繩解開
  for (const k in myBoat.keys) myBoat.keys[k] = false;
  if (mode === 'helm' && boat === myBoat) releaseHelm();
  toast(`${piloted.name} 在幫你開船（你握方向盤就收回來）`);
});
net.on('feedbackOk', () => { feedbackDone(true); toast('感謝投遞！漁會已收到你的寶貴意見 📮'); });
net.on('chumOk', () => { audio.play('plop'); toast(`已施放誘魚桶！吸引方圓 ${CHUM_SPEC.radius}m 魚群，持續 ${CHUM_SPEC.life} 秒`); });
net.on('chat', (m) => chat.say(m.name, m.text, m.id === net.id, { lv: m.lv, title: m.title || '', gold: !!m.gold }, m.ch));
net.on('sys', (m) => { if (m.kind === 'merge') mergeMarq(m.text, 0, 8); else chat.sys(m.text, m.kind, m.ch); });   // 合併相關的提示走跑馬燈，不進聊天室
// 跑馬燈：兩種內容共用同一條——伺服器的全服公告（可帶「幾秒後重開」的倒數），和房間合併的提示（可帶「幾秒後合併」的倒數）。
// 合併提示優先顯示，結束後回到全服公告；都沒有就收起來。重開之後新連線收到的公告是空的，舊的自然清掉
const marqEl = $('marquee');
let marqTimer = 0, marqNotice = null, marqMerge = null, marqMergeOff = 0;
function marqRender() {
  clearInterval(marqTimer);
  const it = marqMerge || marqNotice, span = marqEl.firstElementChild;
  if (!it) { marqEl.style.display = 'none'; document.body.classList.remove('marq'); return; }
  const draw = () => {
    const left = it.end ? Math.max(0, Math.ceil((it.end - performance.now()) / 1000)) : 0;
    const t = [it.text, it.end ? it.tail(left) : ''].filter(Boolean).join('　');
    if (span.textContent !== t) span.textContent = t;
  };
  draw();
  marqEl.style.setProperty('--dur', `${Math.max(12, span.textContent.length * 0.45)}s`);
  marqEl.style.display = 'block';
  document.body.classList.add('marq');
  if (it.end) marqTimer = setInterval(draw, 1000);
}
net.on('notice', (m) => {
  marqNotice = !m.text && m.left < 0 ? null : {
    text: m.text, end: m.left >= 0 ? performance.now() + m.left * 1000 : 0,
    tail: (left) => left > 0 ? `伺服器將在 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} 後重新啟動，進度會保存，斷線後會自動接回` : '伺服器重新啟動中，請稍候…',
  };
  marqRender();
});
// 合併提示：sec 是倒數秒數（0 = 只有文字）；holdSec 秒後自動收起來（倒數中的不收，等下一個階段或取消）
function mergeMarq(text, sec = 0, holdSec = 0) {
  clearTimeout(marqMergeOff);
  marqMerge = text ? { text, end: sec ? performance.now() + sec * 1000 : 0, tail: (left) => (left > 0 ? `${left} 秒後合併` : '合併中…') } : null;
  if (marqMerge && holdSec) marqMergeOff = setTimeout(() => { marqMerge = null; marqRender(); }, holdSec * 1000);
  marqRender();
}
net.on('boards', (m) => { boards.set(m); if (tabOpen()) tablet.update(); });
net.on('lights', (m) => applyRoomLights(m.lights));
net.on('kit', (m) => applyKit(m.kit));
net.on('no', (m) => { buying = false; if (m.msg) toast(m.msg); syncChums(); feedbackDone(false); });   // 誘魚桶丟出去卻沒放成：桶子回到船上

// ---- 釣魚：咬了、試探假咬、是哪條魚、算不算釣起來，都是伺服器說了算 ----
net.on('nibble', () => fishing.serverNibble());
net.on('bite', () => fishing.serverBite());
net.on('fight', (m) => fishing.serverFight(m.fish));
net.on('fishNo', (m) => {
  if (landing) { landing = false; if (m.msg) toast(m.msg); } else fishing.serverNo(m.msg);
});
net.on('caught', (m) => {
  landing = false;
  const f = m.fish;
  const isNew = noteDex(m.dex);   // 圖鑑：第一次釣到這種的話，平板的「圖鑑」亮角標
  if (fish.held) return fish.stowDeck(myBoat, 0, 0, f.id, f.kg, f.len, f.uid, f.value);   // 手上有東西（只有測試指令會這樣）：放到船上
  const it = fish.spawnHeld(f.id, f.kg, f.len, f.uid, f.value);
  if (it.sp.kind === 'junk') toast(`釣到 ${it.sp.name}（值 ${cash(it.value)}）　${isNew ? '新的！已記進圖鑑' : it.sp.notes[Math.floor(Math.random() * it.sp.notes.length)]}`);
  else toast(`釣到${it.sp.rarity === 'common' ? '' : `【${rarityOf(it.id).label}】`}${fishLabel(it)}　值 ${cash(it.value)}${isNew ? '　新的！已記進圖鑑' : ''}`);
});

// ---- 買賣、換船 ----
const freshText = (m) => (m.fresh > 0 ? `・急凍魚艙多 ${Math.round(m.fresh * 100)}%` : '');   // 自己或隊友開著遠洋大漁船
const othersText = (m) => (m.others ? `（其中 ${m.others} 條是隊友的，錢給了他們）` : '');
// 隊友幫忙把我的魚拿去大港大秤賣、或裝在他的箱子裡整箱賣：錢付給我
net.on('paidFor', (m) => {
  applyKit(m.kit);
  audio.play('coin');
  toast(`${m.from} 幫你賣了 ${m.n} 條魚，得到 ${cash(m.total)}`);
});
net.on('sold', (m) => {
  if (m.box) {   // 抱著魚箱整箱賣（箱子空了由 box 訊息重畫）
    applyKit(m.kit);
    if (m.total > 0) { audio.play('coin'); toast(`整箱 ${m.uids.length} 條賣出${m.at === 'haven' ? `（大港多 ${Math.round(PORT.bonus * 100)}%）` : ''}${freshText(m)}，得到 ${cash(m.total)}${othersText(m)}`); }
    else if (m.others) toast(`整箱 ${m.uids.length} 條賣出，都是隊友的魚，錢給了他們`);
    return;
  }
  if (m.at === 'haven') {
    // 成交回覆抵達時，魚可能已從手上放到地面或甲板。
    for (const uid of m.uids) fish.removeOwn(uid);
    applyKit(m.kit);
    if (m.total > 0) { audio.play('coin'); toast(`大港收購價（多 ${Math.round(PORT.bonus * 100)}%${freshText(m)}）：賣出 ${m.uids.length} 條，得到 ${cash(m.total)}${othersText(m)}`); }
    else if (m.others) toast(`賣出 ${m.uids.length} 條，都是隊友的魚，錢給了他們`);
    return;
  }
  fish.sell(m.uids);   // 自己放進籃子的魚賣掉了（別人的由 loose 拿掉）
  applyKit(m.kit);
  refreshBoard();
  // 籃子的錢付給釣到那條魚的人（送過人的付給收下的人），不管是誰放進去、誰按的
  if (m.total > 0) { audio.play('coin'); toast(m.by ? `${m.by} 按了賣出：你釣的 ${m.n} 條魚賣出，得到 ${cash(m.total)}` : `賣出 ${m.n} 條${freshText(m)}，得到 ${cash(m.total)}`); }
  else if (m.uids.length) toast(`你放進籃子的 ${m.uids.length} 條魚賣掉了，錢歸釣到牠們的人`);
  else if (m.helped) toast('幫大家把籃子裡的魚賣掉了（錢付給釣到每條魚的人）');
});
net.on('chestGot', (m) => {
  applyKit(m.kit);
  audio.play('coin');
  if (m.fuel) { if (fish.held) fish.drop(); fish.spawnCan(CAN); toast(`寶箱裡是一桶油（${CAN} 公升）`); }
  else toast(`寶箱裡有 ${cash(m.cash)}`);
});
// 修船台修好了一艘船（自己的、或隊友幫忙付的）：全房都收到，船主那邊把破洞補回去
net.on('repaired', (m) => {
  if (m.byId === net.id) buying = false;
  const mine = m.id === net.id;
  if (mine) {
    myBoat.damage.slice().forEach((c) => myBoat.repair(c));
    lastBoatMsg = lastBoatDetail = '';
    audio.play('repair');
    toast(m.byId === net.id ? `修好了，花了 ${cash(m.cost)}（耐久 ${hpText(myBoat)}）` : `${m.by} 幫你把船修好了（${cash(m.cost)}）`);
  } else if (m.byId === net.id) { audio.play('repair'); toast(`幫 ${others.map.get(m.id)?.name ?? '隊友'} 把船修好了，花了 ${cash(m.cost)}`); }
  if (copilot && copilot.id === m.id) copilot.boat.damage.slice().forEach((c) => copilot.boat.repair(c));   // 我正在幫忙開的那艘：我這邊算的耐久也要補滿，不然下一則位置又把舊的耐久送回去
});
net.on('bought', (m) => {
  buying = false;
  const o = offer(m.id);   // 買之前的說明（要它的名字）
  if (m.id === 'chum' && !fish.held && !heldBox() && mode === 'walk' && !player.swim) fish.spawnChum();   // 誘魚桶：買了直接提在手上（手上有東西就放到船上，見 syncChums）
  applyKit(m.kit);
  if (m.swap) {
    if (m.paint) toast(`已切換船殼塗裝：${m.paint}`);
    return;
  }
  if (m.boat) { audio.play('coin'); return; }   // 買新船：接著會收到 swapped（原地換船），話在那邊講
  audio.play('coin');
  if (m.id === 'fuel') {
    if (fish.held) fish.drop();
    if (heldBox()) fish.stowCan(myBoat, 0, 0, CAN);
    else fish.spawnCan(CAN);
  }
  if (m.id === 'box' && fish.held) fish.drop();   // 魚箱抱在手上：手上原本拿的先放下
  toast(m.repair ? (m.cheap ? '釣竿修好了（錢不夠，老闆算你便宜）' : '釣竿修好了')
    : m.id === 'bless_tide' ? `✨ 已獻上${BLESSINGS.tide.name}！將在 ${m.delay ?? BLESSINGS.tide.delay} 秒後全服降臨`
    : m.id === 'bless_storm' ? `⛈ 已獻上${BLESSINGS.storm.name}！風暴將於 ${m.delay ?? BLESSINGS.storm.delay} 秒後降臨`
    : m.paint ? `已解鎖並套用塗裝：${m.paint}`
    : m.id === 'engine' ? `${BOAT_TYPES[m.kit.active].name}的引擎升到 Lv.${m.kit.boats[m.kit.active]?.engineLv ?? 0}（每艘船分開升）`
    : `買了${o.name}`);
});
// 換了一艘船放到世界裡：平板上換船、或是船沉了之後伺服器補一艘
net.on('swapped', (m) => {
  const w = wreck && wreck.mine ? wreck : null, wasLost = !!myBoat._lost;
  storedInfo = m.stored || {};
  kit = m.kit;
  berth = m.berth;
  useBoat(m.kit.active, m.berth);
  applyKit(m.kit);
  flashMyBoat();
  const where = `${myBoat.spec.name}停在港口（畫面上標出來了）`;
  if (m.bought) { fish.rehome?.(myBoat); audio.play('rope'); return toast(`新船已停妥於船塢旁（畫面上標出來了）。新船引擎是 Lv.0，可以在這裡另外升級；舊船收進倉庫`); }
  if (!m.wreck) { audio.play('rope'); return toast(`換好了：${where}`); }
  if (w) wreck = null;
  const text = m.gift ? '港口留了一艘小舢舨給你（畫面上標出來了）' : `倉庫裡的${where}`;
  if ((w && w.aboard) || wasLost) rescue(`你被救回港口。${text}`); else toast(text);
});

// 定時刷新（時間見 config.js 的 SERVER.refresh）：家當變回新玩家的樣子（錢、船、裝備、魚都清掉），人送回港口
net.on('reset', (m) => {
  fishing.cancel(null);
  landing = buying = false;
  wreck = drown = null;
  stamina = 1;
  myBoat._lost = true;   // 舊的船不收進倉庫，直接換一艘新的小舢舨
  for (const b of garage.values()) b.mesh.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); for (const mat of [].concat(o.material)) mat.dispose(); } });
  garage.clear();
  garageState.clear();
  kit = m.kit;
  berth = m.berth;
  storedInfo = {};
  dexBook = m.dex || {}; dexNew.clear();
  myExp = dexBook?._lv?.exp || myExp;   // 等級不跟著刷新清掉
  useBoat(kit.active, berth);
  fish.clearAll();
  applyKit(kit);
  boards.set(m.boards);
  player.seat = null;
  rescue('刷新了：大家從港口重新開始');
  chat.sys(m.text, 'warn');
  lastPosMsg = lastBoatMsg = lastBoatDetail = '';
  lastHold = lastLine = '?';
});

// ---- 合併房間 ----
net.on('merge', (m) => {
  if (m.phase === 'count') mergeMarq(m.text, m.sec);
  else if (m.phase === 'wait') mergeMarq(m.text);
  else if (m.phase === 'cancel') mergeMarq(m.text, 0, 8);   // 沒有文字（正常中止）就直接收起來
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
  if (m.stored) storedInfo = m.stored;
  if (m.repark) {   // 原本的停船格在那間房有人用了：船跟著移到新的格子
    myBoat.x = m.repark.x; myBoat.z = m.repark.z; myBoat.heading = m.repark.heading; myBoat.speed = 0; myBoat.moor = null;
  }
  applyKit(m.kit);
  boards.set(m.boards);
  applySocial(m);
  applyWorld(m.world, true);
  fish.applyLoose(m.loose ?? [], net.id);
  boxes.apply(m.boxes);
  lastPosMsg = lastBoatMsg = lastBoatDetail = '';
  if (!wreck && !drown) fadeIn = 1.6;
  if (m.repark) flashMyBoat();
  mergeMarq(`已經合併到${room.name}${m.repark ? '，你的船移到港口另一個船位（畫面上標出來了）' : ''}`, 0, 10);   // 跑馬燈，不進聊天室
});

// ---- 閒置回報 ----
// 有人在操作（按鍵、滑鼠、觸控）就每隔 SERVER.actEverySec 秒跟伺服器說一聲；伺服器 SERVER.idleKickSec 沒聽到就請回大廳
let lastAct = 0;
function noteAct(force) {
  const t = performance.now();
  if (!inGame || !net.online || (!force && t - lastAct < SERVER.actEverySec * 1000)) return;
  lastAct = t;
  net.send({ t: 'act' });
}
for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'touchmove']) window.addEventListener(ev, () => noteAct(false), { capture: true, passive: true });

// ---- 連線狀態 ----
net.on('status', (st) => {
  const box = $('net'), msg = $('netMsg'), btn = $('netRetry');
  if (st === 'online') { box.style.display = 'none'; return; }
  if (!inGame) return;   // 還在大廳：選單自己會處理
  landing = false;
  fishing.cancel(null);
  if (st === 'offline') { msg.textContent = `連線中斷，正在接回去…（最多等 ${net.reconnectSec} 秒，進度都還在）`; btn.style.display = 'none'; }
  else {
    msg.textContent = st === 'expired' ? '斷線太久，已經離開房間了（錢、船、裝備和魚都存著，重新進房就好）' : st.startsWith('kicked:') ? st.slice(7) : '和伺服器斷線了';
    btn.style.display = 'inline-block';
    inGame = false;
    document.body.classList.remove('playing');
  }
  for (const k in keys) keys[k] = false;
  box.style.display = 'flex';
});
$('netRetry').addEventListener('click', () => window.location.reload());
// 斷線後接回來：以伺服器的結果補回漏掉的交易和漁獲。
net.on('rejoin', (j) => {
  if (j.kit.active !== myBoat.spec.id) { enterRoom(j); return; }
  room = j.room;
  others.sync(j.players);
  berth = j.berth;
  applyKit(j.kit);
  boards.set(j.boards);
  applyWorld(j.world, true);
  pendingIn.clear();
  dexBook = j.dex ?? {};
  applySocial(j);
  const catchupBoat = j.resume?.boat;
  if (catchupBoat && !catchupBoat.sunk && !myBoat.sinking) myBoat.fuel = clamp(catchupBoat.s[10], 0, myBoat.spec.tank);
  boxes.apply(j.boxes);
  fish.reconcileOwn(j.resume?.fish ?? [], j.loose ?? [], net.id, myBoat);
  refreshBoard();
  if (j.resume?.passengerReturn) returnPassenger(j.resume.passengerReturn);
  if (myBoat._wrecked && !j.resume?.boat?.sunk) net.send({ t: 'sink', why: myBoat.sunkBy, side: myBoat._side });
  lastPosMsg = lastBoatMsg = lastBoatDetail = '';
  lastHold = lastLine = '?';
});

// 伺服器重開（更新）之後自動重新進同一間房：房間位置清空了，進度存在檔案裡，照「回來的人」的流程放回港口
net.on('restarted', (j) => {
  if (!inGame) return;
  fishing.cancel();
  enterRoom(j);
  chat.sys('伺服器剛更新完，已經幫你重新進入；錢、船和還沒賣的魚都還在', 'info');
});

// 進到房間裡（從大廳進房，或是斷線後在寬限內回來）
function enterRoom(j) {
  room = j.room;
  pendingIn.clear();
  fish.clearAll();
  garage.clear();
  garageState.clear();
  for (const [type, v] of Object.entries(j.resume?.stored ?? {})) garageState.set(type, v);
  storedInfo = j.stored || {};
  dexBook = j.dex || {}; dexNew.clear();
  others.sync(j.players);
  kit = j.kit;
  berth = j.berth;
  // 自己的船：新進房的停在分到的格子；回來的照離開時的位置、油量、破洞
  const rb = j.resume?.boat, lv = kit.boats[kit.active] ?? { engineLv: 0 };
  const old = myBoat;
  boats.splice(boats.indexOf(old), 1);
  old.mesh.removeFromParent();
  myBoat = boat = addBoat(kit.active, rb && !rb.sunk ? { x: rb.s[0], z: rb.s[1], heading: rb.s[2] } : berth);
  myBoat.engineLv = lv.engineLv;
  if (rb && !rb.sunk) {
    myBoat.fuel = clamp(rb.s[10], 0, myBoat.spec.tank);
    myBoat.lampOn = !!(rb.s[9] & 1);
    for (const c of rb.cracks ?? []) myBoat.restoreCrack(c[0], c[1], c[2]);
    if (rb.moor >= 0 && BOLLARDS[rb.moor]) { const m = moorSpot(rb.moor, [myBoat], MOOR_REACH + 2); if (m) tieBoat(m); }
  }
  camHeading = myBoat.heading;
  wreck = null; mergeAt = 0; mode = 'walk';
  copilot = null;
  applySocial(j);
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
    // 魚箱裡的魚跟著箱子回來（boxes）；其他的（斷線時拿在手上的）放在甲板上
    for (const f of back.fish) fish.stowDeck(myBoat, (Math.random() - 0.5) * S.len * 0.3, (Math.random() - 0.5) * S.beam * 0.4, f.id, f.kg, f.len, f.uid, f.value);
  }
  boxes.apply(j.boxes);
  fish.applyLoose(j.loose ?? [], j.id);   // 大家放在外面的魚（地上、甲板上、籃子裡）；自己斷線前放在外面的也照原位放回去
  let px = SPAWN_W.x + (Math.random() - 0.5) * 3, pz = SPAWN_W.z + (Math.random() - 0.5) * 2, yaw = SPAWN_W.yaw, deck = null;
  if (pos && !(rb && rb.sunk)) {
    deck = pos[8] ? (pos[8] === j.id ? myBoat : others.boat(pos[8])) : null;
    if (deck && deck.deckContains(pos[9], pos[10])) { px = pos[9]; pz = pos[10]; } else { deck = null; if (!pos[8]) { px = pos[0]; pz = pos[2]; } }   // 在船上的：照甲板上的位置放回去
    yaw = pos[3];
  }
  player.seat = null;
  setDevMode(j.dev);
  player.place(walkWorld, px, pz, deck);
  player.yaw = view.walk.yaw = yaw;
  applyViewSettings();
  lastPosMsg = lastBoatMsg = lastBoatDetail = '';
  lastHold = lastLine = '?';
  chat.clear();
  chat.show(true);
  chat.sys(back ? (pos ? `回到${room.name}了` : `歡迎回到${room.name}，錢、船和還沒賣的魚都還在`) : touchText(`歡迎來到${room.name}。按 Enter 可以聊天`), 'info');
  $('net').style.display = 'none';
  inGame = true;
  noteAct(true);   // 進房那一刻就算有操作：伺服器從這裡開始算閒置
  document.body.classList.add('playing');   // 設定搬進平板（左上角的設定鈕收起來）
  tablet.update(true);
  syncOwnTabletTex(true);
  fadeIn = 1.2;
  if (back?.passengerReturn) returnPassenger(back.passengerReturn);
  if (homeTip) { homeTip = false; window.setTimeout(showHomeTip, 5000); }
}

let wakeIdx = 0, wakeTimer = 0, sprayAcc = 0, jetShake = 0, lastStep = 0, dtSim = 0.016;
// 一艘我這邊在算的船（自己的，或正在幫隊友開的那艘）這一幀遇到的海上災害：漩渦與水龍捲的中心、旋臂，湧進港口的浪，巨浪的浪頭與捲舌。
// helmHere：我正握著這艘船的方向盤（警告只講給掌舵的人聽）。每艘船各記各的狀態（b._hz）
function boatHazards(b, helmHere, dt) {
  const hz = b._hz || (b._hz = { crestSide: 1, crestI: -1, whirlToast: false, spoutToast: false });
  const hazard = !b.sinking;
  const core = hazard && sea.vortices.length ? sea.coreAt(b.x, b.z) : null;
  if (core) b.founder(core, 1);   // 被拉進漩渦或水龍捲的中心
  // 大漩渦與水龍捲：進入白浪旋臂就開始劇烈吸扯、水花四濺並扯傷船板
  if (hazard && sea.vortices.length) {
    const w = sea.whirlNear(b.x, b.z), spv = sea.spoutNear(b.x, b.z);
    if (w.r < 155) {
      const wk = w.s * ((155 - w.r) / 123) ** 2;
      b.hurt(b.spec.hp * 0.055 * wk * dt);
    }
    if (w.r < 210 && w.s > 0.25 && Math.random() < 16 * w.s * (1 - w.r / 210) * dt) {
      splash(b.x + (Math.random() - 0.5) * b.spec.len, b.mesh.position.y + 0.45, b.z + (Math.random() - 0.5) * b.spec.beam, 5);
    }
    if (helmHere && w.r < 240 && w.s > 0.25 && !hz.whirlToast) { hz.whirlToast = true; toast('捲入大漩渦吸流了！立刻全速往外衝！'); }
    if (w.r > 320) hz.whirlToast = false;
    if (helmHere && spv.r < 260 && spv.s > 0.35 && !hz.spoutToast) { hz.spoutToast = true; toast('捲入水龍捲暴風圈！頂風全速拉開距離！'); }
    if (spv.r > 340) hz.spoutToast = false;
    if (spv.r < 220 && spv.s > 0.35 && Math.random() < 16 * spv.s * (1 - spv.r / 220) * dt) {
      splash(b.x + (Math.random() - 0.5) * b.spec.len, b.mesh.position.y + 0.5, b.z + (Math.random() - 0.5) * b.spec.beam, 5);
    }
  } else { hz.whirlToast = false; hz.spoutToast = false; }
  // 巨浪淹進港口：停在岸邊的船被湧進來的水抬起來、退水時摔回去，會撞壞一些
  for (let once = 0; once < 1; once++) {
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
  if (sea.tsu.on && hazard) {
    const tK = tsuKAt(b.x, b.z), c = sea.jetAt(b.x, b.z, tK, shared.uTime.value), side = c.q > c.land ? 1 : -1;
    if (side < 0 && hz.crestSide > 0 && c.i === hz.crestI && c.q > -20) {
      const jet = c.Bw * c.Hc / (5 + b.spec.len);         // 捲舌砸下來的力道，1 以上船就沒了
      const hit = c.B * Math.min(c.k, 1.1) * Math.min(1, tsuHK(tK) / TSU_H.peak);            // 翻白的浪頭拍在船上（還沒捲起來也算）
      if (jet >= 1 || hit > 0.15) {
        const aboard = player.boat === b;
        splash(b.x, b.mesh.position.y + 1, b.z, jet >= 1 ? 90 : 50);
        if (aboard) jetShake = Math.max(jetShake, clamp(0.5 + jet, 0.5, 1.6));
        // 巨浪不會一下子把船打沉：砸得再重，一道浪頭最多扣三成耐久。三道都被正面砸中、或船本來就破破爛爛的，耐久歸零才沉
        b.hurt(b.spec.hp * Math.min(0.3, 0.12 * hit + 0.2 * Math.min(jet, 1.5)));
        b.jolt = Math.max(b.jolt || 0, 2.5 + jet);   // 甲板上沒收進魚箱的魚會被拋起來
        if (b.hp <= 0) b.founder('curl', sea.tsu.dx * -Math.sin(b.heading) + sea.tsu.dz * Math.cos(b.heading) > 0 ? 1 : -1);   // 順著浪的方向被掀翻
        else if (aboard) toast(jet > 0.25 ? '捲下來的浪頭砸在船上！' : '浪頭砸在船上！');
      }
    }
    hz.crestSide = side; hz.crestI = c.i;
  } else { hz.crestSide = 1; hz.crestI = -1; }
}
function advance(dt) {
  time = inGame && clockBase !== null ? clockBase + performance.now() / 1000 : time + dt;
  updateOcean(dt);

  // 掌舵時鍵盤控制船，走路時控制人
  const helm = mode === 'helm';
  // 踩上另一艘船，它就變成「目前這艘」（可能是別人的）；不在別人的船上了，就回到自己的
  if (mode === 'walk' && player.boat && player.boat !== boat) { boat = player.boat; camHeading = boat.heading; }
  else if (mode === 'walk' && !player.boat && boat.remote) { boat = myBoat; camHeading = boat.heading; }
  const mb = myBoat;   // 自己的船：它的物理、損傷在這裡算（別人的船由船主那邊算好傳過來）
  const cb = copilot ? copilot.boat : null;   // 正在幫隊友開的那艘：物理也在這裡算
  const drive = helm && !tabOpen();   // 拿著平板：放開油門和方向盤（船自己慢慢停）
  dtSim = dt;
  for (const b of cb ? [mb, cb] : [mb]) {
    const on = drive && boat === b && !(b === mb && piloted);
    b.keys.w = on && (keys.w || touch.my > 0.38); b.keys.s = on && (keys.s || touch.my < -0.38);
    b.keys.a = on && (keys.a || touch.mx < -0.38); b.keys.d = on && (keys.d || touch.mx > 0.38);
  }
  ocean.cacheBlock(boat.x, boat.z);
  if (piloted) mb.updateRemote(dt);   // 隊友在幫我開：照他傳來的位置擺
  else mb.update(dt, mb === boat ? boatEnv : calmEnv);
  if (cb) {
    cb.update(dt, cb === boat ? boatEnv : calmEnv);
  }
  others.update(dt);
  syncProps(dt);
  updateTows(dt);
  if (!piloted) collideBoats(mb, helm && boat === mb);
  if (cb) collideBoats(cb, true);
  updateMooring(dt, helm);
  jetShake *= Math.exp(-dt * 2.2);
  if (!piloted) boatHazards(mb, helm && boat === mb, dt);   // 隊友在幫我開的時候，漩渦、巨浪的傷害由他那邊算
  if (cb) boatHazards(cb, helm && boat === cb, dt);          // 我幫隊友開的那艘：這裡算，耐久跟著位置一起送回去
  updateWreck(dt);
  if (helm && boat.fuel <= 0 && !fuelWarned) toast('沒油了，只能慢慢漂回去');
  fuelWarned = boat.fuel <= 0;

  if (mode === 'walk') {
    const v = view.walk;
    if (player.seat && (keys.w || keys.a || keys.s || keys.d || keys.space || touch.mx || touch.my)) standUp();
    const still = drown || tabOpen();   // 拿著平板：站著不動
    const f = still ? 0 : (keys.w ? 1 : 0) - (keys.s ? 1 : 0) + touch.my, r = still ? 0 : (keys.d ? 1 : 0) - (keys.a ? 1 : 0) + touch.mx;
    const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
    // 人在水邊或水裡才需要知道浪高
    swimWave = !player.boat && bedAt(player.x, player.z) < -0.4 ? ocean.sampleHeight(player.x, player.z) : 0;
    if (!player.boat && !player.fly && bedAt(player.x, player.z) < 0.5) surfProbe.request(player.x, player.z);
    player.look(v.yaw, v.pitch);
    walker.feet = player.boat ? null : player.y; walker.air = player.h > 0 || player.fly; walker.fly = player.fly;
    const rise = player.fly ? (keys.shift ? 1 : 0) - (keys.q ? 1 : 0) : 0;   // 飛行：Shift 上升、Q 下降、按住 R 衝刺
    player.flyDash = keys.r;
    const holdTab = tabOpen() && !fish.held && !heldBox() && !player.swim && !player.seat;
    player.steady = holdTab; player.tabHold = holdTab;
    player.update(dt, cy * f - sy * r, sy * f + cy * r, (keys.shift || touch.run) && !player.fly, keys.space && !drown && !player.fly && !tabOpen(), walkWorld, rise);
    walker.feet = null; walker.fly = false;
    if (v.fp) { player.yaw = v.yaw; player.mesh.rotation.y = -v.yaw; } // 第一人稱時身體跟著視線
    if (player.onWater && !drown) waveRide(dt);
    riverRide(dt);
    chestSwim();
    boxSwim();
    // 腳步聲：腳每落地一次（走路動作每半圈）播一聲，木板和草地沙地各一組
    const stepN = Math.floor(player.phase / Math.PI);
    if (stepN !== lastStep) {
      lastStep = stepN;
      if (inGame && player.moving && player.h <= 0 && !player.swim && !player.seat) audio.play(player.boat || onDeck(player.x, player.z, PIER_PLANK_PAD + 0.18) ? 'stepWood' : 'stepGrass', keys.shift ? 1 : 0.7);
    }
  }

  updateSwim(dt);

  // 魚與釣魚
  fish.update(dt);
  // 魚箱：抱著的時候手往前抱、照重量走慢；抱著也能游（比較累），游到自己浮在水上的箱子旁會自動抱起
  const hbx = heldBox();
  // 拿著平板（空手、走路、沒在游泳時才拿在手上；別人也看得到）
  tabHand = tabOpen() && !fish.held && !hbx && mode === 'walk' && !player.swim && !player.seat;
  tabScreen = tabHand ? tabletScreen() : 0;
  // 拿起來：平板跟著手從腰邊抬到胸前（第一人稱自己隱藏 3D 平板與手只留動作與陰影）；收起來：等手放下去才拿掉
  if (tabHand && !(tabMesh && tabMesh.parent)) { tabMesh = tabMesh || makeTabletMesh(0, { fullFace: true }); holdTablet(player.mesh, tabMesh); }
  if (tabMesh && tabMesh.parent) {
    tabMesh.visible = !(mode === 'walk' && view.walk.fp);
    const k = poseTablet(tabMesh);
    if (!tabHand && (k < 0.3 || fish.held || hbx || mode !== 'walk' || player.swim || player.seat)) tabMesh.removeFromParent();
  }
  if (tabHand) setTabletScreen(tabMesh, tabScreen);   // 螢幕上畫的是現在開著的畫面（別人看到的也是）
  player.carry = !!fish.held || !!hbx || tabHand;
  player.steady = tabHand; player.tabHold = tabHand;
  player.load = hbx ? boxes.speed(hbx) : 1;
  // （抱著魚箱也能游：比較慢、比較累（player.carry 讓體力掉得快），騰不出手放下，要上岸或爬上船才能放）
  boxes.update(time);
  throwTick(dt);
  fishing.reel = keys.f || keys.mouse;
  fishing.update(dt);
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
      sprayAcc -= 1 / 3;   // 一團水拆成三顆小一點的水滴
      const side = Math.random() < 0.5 ? -1 : 1, out = (1.2 + Math.random() * 3.0) * sc;
      spray.emit(bx + (Math.random() - 0.5), by, bz + (Math.random() - 0.5),
        fx * boat.speed * 0.35 - fz * side * out, (1.6 + Math.random() * 3.0) * Math.sqrt(sc), fz * boat.speed * 0.35 + fx * side * out,
        0.6 + Math.random() * 0.7, (0.25 + Math.random() ** 2 * 0.8) * sc);
    }
  }
  swimFx.update(dt, [player, ...[...others.map.values()].map((o) => o.fig)], time, camera.position);
  spray.update(Math.min(dt, 0.1));
  if (rainSplash) rainSplash.update(Math.min(dt, 0.1));

  // 航跡：船在動就定時在船尾留下一點泡沫
  wakeTimer += dt;
  const wsp = Math.max(sp, boat.moveSpeed || 0);
  if (wakeTimer > 0.3 && wsp > 0.8 && !boat.aground) {
    wakeTimer = 0;
    wake[wakeIdx].set(boat.x - fx * boat.spec.len * 0.46, boat.z - fz * boat.spec.len * 0.46, time, clamp(wsp / 5, 0, 1) * Math.min(1, boat.spec.len / 13));
    wakeIdx = (wakeIdx + 1) % wake.length;
  }
  // 還看得到的航跡圈在一個圓裡：海面的著色器只在圓內才去算那 16 筆（以前整片海的每個像素都算）
  {
    let n = 0, cx = 0, cz = 0, r = 0;
    for (const w of wake) if (w.w > 0 && time - w.z < 30) { n++; cx += w.x; cz += w.y; }
    if (n) {
      cx /= n; cz /= n;
      for (const w of wake) if (w.w > 0 && time - w.z < 30) r = Math.max(r, Math.hypot(w.x - cx, w.y - cz) + 2.6 * (1.8 + (time - w.z) * 0.9));
    }
    shared.uWakeBox.value.set(cx, cz, r, n ? 1 : 0);
  }
}

let shadowElapsed = 0, shadowDraws = 0;
// 遠的東西省著畫（LOD）：甲板上、地上、魚箱裡的魚離鏡頭超過 LOD.fishFar 不畫（箱子照畫）；
// 別的玩家的人偶超過 LOD.figHullFar 不畫描邊、超過 LOD.figFar 整個不畫（名牌還在）。
// 人偶的 visible 每次 others.update 都會重設，所以這裡每幀在畫之前再蓋一次
const _lodP = new THREE.Vector3();
function farLod() {
  const cp = camera.position, fish2 = LOD.fishFar ** 2, hull2 = LOD.figHullFar ** 2, fig2 = LOD.figFar ** 2;
  const d2 = (m) => { m.updateWorldMatrix(true, false); return _lodP.setFromMatrixPosition(m.matrixWorld).distanceToSquared(cp); };   // 先更新：剛擺出來的東西矩陣還是原點
  for (const it of fish.items) it.mesh.visible = d2(it.mesh) < fish2;
  for (const e of boxes.map.values()) e.inner.visible = d2(e.mesh) < fish2;
  for (const o of others.map.values()) {
    const f = o.fig;
    if (!f || !f.mesh.visible) continue;
    const d = d2(f.mesh);
    if (d > fig2) { f.mesh.visible = false; continue; }
    const hull = d < hull2;
    if (f._hullOn !== hull) { f._hullOn = hull; f.mesh.traverse((m) => { if (m.userData.hull) m.visible = hull; }); }
  }
}
// 魚的合畫：甲板上、地上、魚箱裡躺著不動（沒在擺）而且看得到的魚，交給 fishBatch 同種一起畫，本身的零件藏起來；
// 正在擺、正被準心對著（要畫綠色描邊）的照原本一條一條畫。零件藏起來時標 userData.batched，瞄準照樣打得到
const fishBatch = new FishBatch(scene);
let batchedNow = new Set(), batchedNext = new Set();   // 這一幀、上一幀被收去合畫的魚（離開的要把零件放回來，例如被撿到手上）
function shownInScene(o) {
  for (; o; o = o.parent) { if (!o.visible) return false; if (o === scene) return true; }
  return false;
}
function showParts(root, on) {
  for (const c of root.children) if (c.userData.inst) { c.userData.batched = on; c.visible = !on; }
}
function batchFish(aim) {
  const skip = aim?.kind === 'item' ? aim.item?.mesh : aim?.kind === 'fpile' ? aim.fishMesh : null;
  const take = (root) => {
    if (!root.userData.inst) return;
    const flex = root.userData.flex;
    const on = (!flex || flex.amp < 0.003) && root !== skip && shownInScene(root);
    showParts(root, on);
    if (!on) return;
    batchedNext.add(root);
    root.updateWorldMatrix(true, true);
    for (const c of root.children) if (c.userData.inst) fishBatch.add(c);
  };
  fishBatch.begin();
  for (const it of fish.items) take(it.mesh);
  for (const e of boxes.map.values()) for (const m of e.inner.children) take(m);
  fishBatch.end();
  for (const r of batchedNow) if (!batchedNext.has(r)) showParts(r, false);
  [batchedNow, batchedNext] = [batchedNext, batchedNow];
  batchedNext.clear();
}
function drawFrame(dt, ms = performance.now()) {
  updateCamera(dt);
  farLod();
  boxes.marks(camera, meAt(), net.id, inGame && !tabOpen());   // 開船時用船的位置量距離
  markMyBoat();
  markWaypoint();
  updateCompass();
  updateSonar(dt);
  updateFishUi();
  lpUniforms.uTime.value = time;   // 低面模型（樹、草）隨風搖
  seascape.update(time, camera.position);   // 燈標閃光；太遠、被霧蓋掉的島不畫
  havenFx.update(dt, time, camera.position);
  wildlife.update(dt, time);
  updateCave(dt);
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
    shake = Math.max(shake, (0.35 + 0.9 * m.touch) * clamp(1 - d / 440, 0, 1) ** 1.4);
  }
  // 巨浪：浪牆逼近時轟鳴越來越大，浪頭從身邊過去的那一下最響、鏡頭跟著震
  let crestRoar = 0;
  if (sea.tsu.on) {
    const c = sea.crestNear(cp.x, cp.z), big = Math.min(c.k, 1.1) * Math.sqrt(Math.min(1, tsuHK(tsuKAt(cp.x, cp.z)) / TSU_H.peak));   // 在岸上也聽得到、感覺得到
    crestRoar = big * clamp(1 - Math.abs(c.q) / (c.q > 0 ? 650 : 280), 0, 1) ** 2;
    spots.roar = [cp.x - c.q * sea.tsu.dx, cp.y, cp.z - c.q * sea.tsu.dz, clamp(1 - Math.abs(c.q) / 120, 0.2, 1)];   // 浪牆離這裡最近的那一點
    shake = Math.max(shake, 0.9 * big * clamp(1 - Math.abs(c.q) / 150, 0, 1) ** 1.5);
  }
  // 大漩渦：幾百公尺外就聽得到水在轟隆隆地轉，越靠近越響；被拉到漏斗邊上時鏡頭跟著抖
  let whirlRoar = 0;
  if (sea.vortices.length) {
    const w = sea.whirlNear(cp.x, cp.z);
    whirlRoar = w.s * clamp(1 - w.r / 640, 0, 1) ** 1.8;
    if (1.45 * whirlRoar > 1.5 * crestRoar) spots.roar = [w.x, 0, w.z, clamp(1 - w.r / 190, 0.25, 0.95)];
    shake = Math.max(shake, 1.15 * w.s * clamp(1 - w.r / 230, 0, 1) ** 1.35);
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

  audio.set((0.45 + 0.95 * levelAt(cp.x, cp.z) ** 0.8) * (0.35 + 0.65 * shelterAt(cp.x, cp.z)), Math.max(sea.rumble * 0.6, 1.5 * crestRoar, 1.45 * whirlRoar), under,
    boat.fuel > 0 ? Math.abs(boat.throttle) : 0, Math.abs(boat.speed) / 7, rainNow, spoutNear, spoutPan, under ? 0 : clamp((galeHere - 5) / 32, 0, 1.4));

  // 實地錄音的那一層：外海的浪、岸邊的小浪、港口的海鷗、雨、引擎、捲線器、腳步
  {
    const off = offAt(cp.x, cp.z), helm = mode === 'helm';
    // ---- 聲音的方位 ----
    camera.getWorldDirection(_rf);
    _sp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    audio.listen(cp.x, cp.y, cp.z, _rf.x, _rf.y, _rf.z, _sp.x, _sp.y, _sp.z);
    if (!spots.roar || sea.rumble * 0.6 > Math.max(1.5 * crestRoar, 1.45 * whirlRoar)) spots.roar = [cp.x, cp.y, cp.z, 1];   // 說不出從哪來的隆隆聲
    // 引擎：在船尾油箱那一帶
    const tk = boat.parts.tank;
    _sp.set(tk ? tk.x : -2, 0.5, tk ? tk.z : 0).applyMatrix4(boat.mesh.matrixWorld);
    spots.engine = [_sp.x, _sp.y, _sp.z, 0.3];
    // 海鷗：在港口上空盤旋；人就在港口裡的時候是頭頂一大片
    // （畫面上有看得到的海鷗時，叫聲就從最近的那隻發出來）
    const gv = wildlife.nearestGull(cp.x, cp.z, _gullV);
    spots.gulls = gv ? [gv.x, gv.y, gv.z, clamp(1 - Math.hypot(cp.x - gv.x, cp.z - gv.z) / 90, 0, 0.8)]
      : [QUAY_CENTER_W.x, 22, QUAY_CENTER_W.z, clamp(1 - Math.hypot(cp.x - QUAY_CENTER_W.x, cp.z - QUAY_CENTER_W.z) / 70, 0, 0.75)];
    // 岸邊的浪：從最近的岸那個方向來（看離岸距離往哪邊變小）；人在岸上、或緊貼著岸，就是四周都有
    const gx = offAt(cp.x + 6, cp.z) - offAt(cp.x - 6, cp.z), gz = offAt(cp.x, cp.z + 6) - offAt(cp.x, cp.z - 6), gl = Math.hypot(gx, gz);
    spots.shore = gl > 1 && off > 2 ? [cp.x - gx / gl * Math.max(off, 5), 0, cp.z - gz / gl * Math.max(off, 5), clamp(1 - (off - 3) / 30, 0.3, 1)] : [cp.x, cp.y, cp.z, 1];
    audio.place(spots);
    // 島上的環境音：鏡頭在陸地上（離岸二十幾公尺內漸漸淡掉）。港口那一帶是人住的地方，鳥叫蟲鳴小聲一點
    const land = clamp(1 - off / 25, 0, 1) * (0.45 + 0.55 * clamp((Math.hypot(cp.x - QUAY_CENTER_W.x, cp.z - QUAY_CENTER_W.z) - 30) / 60, 0, 1));
    audio.ambient({
      night: land * clamp((night - 0.45) / 0.35, 0, 1) * clamp(1 - rainNow * 2, 0, 1),
      trees: land * clamp(0.25 + 0.35 * WIND.amp.value, 0, 1),
      under,
      sea: clamp(0.3 + 0.16 * levelAt(cp.x, cp.z), 0, 1) * clamp((off - 15) / 90, 0, 1),   // 平常的外海約四成，暴風雨裡六七成，颱風八成
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
  WIND.amp.value = clamp(gale.steady / 14, 0.15, 2.6);   // 樹搖得多厲害跟著風速
  WIND.t.value += dt * (0.75 + 0.45 * WIND.amp.value);
  updateFlags(dt, gale.x, gale.z);   // 大漁旗跟著風飄
  updateScale(fish.basketKg, dt);    // 磅秤的指針跟著籃子裡魚的總重量
  shared.uCenter.value.set(target.x, target.z);
  camera.updateMatrixWorld();
  scenery.cull(camera);   // 被山擋住的那幾塊樹不畫
  scenery.update(cp, false, gfx.far);   // 近的島畫精細的樹和石頭，遠的畫簡化版，霧裡的不畫（畫質「手機」霧比較濃，520 公尺外就不畫）
  // 草皮的中心放在鏡頭前方十幾公尺：畫面裡看得到的近處都有草
  camera.getWorldDirection(_gd);
  _gd.y = 0;
  grass.material.uniforms.uGrassCam.value.copy(cp).addScaledVector(_gd.normalize(), 13);
  grass.visible = OLD_GRASS && gfx.grass > 0;
  updateBoatShadow();
  // 倒影隔一幀重畫一次（偶數幀）
  const even = (drawCount++ & 1) === 0;
  // 地面是濕的、鏡頭在港口附近時，還要畫積水的倒影：跟海面倒影輪流，各自每四幀更新一次
  const deckWet = gfx.wet && !under && WET.wet.value > 0.04 && cp.y > DECK_Y + 0.3 && Math.hypot(cp.x - HARBOR_CENTER_W.x, cp.z - HARBOR_CENTER_W.z) < 120;
  const deckTurn = deckWet && even && (drawCount & 2) !== 0;
  renderReflection(under, even && !deckTurn);
  if (deckTurn || (deckWet && !deckReady)) { renderDeckReflection(); deckReady = true; }
  if (!deckWet) deckReady = false;
  WET.reflOn.value = deckWet ? 1 : 0;
  if (gfx.shadowOn) {
    shadowElapsed += dt;
    const shadowHz = !inGame ? 10 : gfx.lite ? 15 : 30;
    // 手機：注視點（人、船）在動就每一幀重畫，影子才會黏著人走；站著不動才照上限省著畫（大廳一樣省）
    const shMoved = TOUCH && inGame && _shLast.distanceToSquared(target) > 1e-5;
    const redraw = TOUCH ? (shMoved ? (mobileShadowClock.take(ms, 0), true) : mobileShadowClock.take(ms, shadowHz) !== null) : !gfx.lite || !even;
    if (redraw) _shLast.copy(target);
    if (redraw) {
      // 淡入淡出的新舊貼圖按實際更新次數輪流畫，並用累積時間推進。
      const shadowEven = TOUCH || gfx.lite ? (shadowDraws++ & 1) === 0 : even;
      placeSun(target, Math.min(shadowElapsed, 0.25), shadowEven);
      shadowElapsed = 0;
    }
    shadowUniforms();
  }
  // 太陽（月亮）在畫面上的位置；背對著它、或人在水裡時沒有光束
  _rv.copy(camera.position).addScaledVector(sunDir, 1000).project(camera);
  rays.sun.set(_rv.x * 0.5 + 0.5, _rv.y * 0.5 + 0.5);
  rays.color.setRGB(shared.uSunCol.value.x, shared.uSunCol.value.y, shared.uSunCol.value.z);
  rays.strength = under ? 0 : RAYS * clamp((camera.getWorldDirection(_rf).dot(sunDir) - 0.15) / 0.35, 0, 1) * (1 - 0.8 * gloom);
  // 腳下的暗影
  const onFloor = !!player.boat || onDeck(player.x, player.z, PIER_PLANK_PAD + 0.18), lift = clamp(1 - (player.h || 0) / 1.2, 0, 1);
  if (gfx.shadowOn) {
    blob.visible = onFloor && !player.swim;
    blob.position.y = 0.03; blob.material.opacity = 0.45; blob.quaternion.identity();
    blob.material.map = SOFT_DISC; blob.scale.setScalar(1);
    shared.uBlob.value.set(player.x, player.z, onFloor || player.swim ? 0 : lift);
  } else {
    // 陰影全關：沒有別的影子，到處都畫圓影（自己、別人）；地形那邊不另外畫
    placeFootBlob(blob, player.mesh, player.x, player.z, player.h || 0, !!player.boat);
    if (player.swim || drown || mode !== 'walk') blob.visible = false;
    shared.uBlob.value.set(player.x, player.z, 0);
  }
  for (const o of others.map.values()) {
    const f = o.fig, st = o.st;
    if (!f || !st) continue;
    const fb = f.footBlob ??= footBlob(f.mesh);
    if (gfx.shadowOn || !f.mesh.visible || f.swim) { fb.visible = false; continue; }
    placeFootBlob(fb, f.mesh, f.x, f.z, Math.max(0, f.h || 0), !!st[8]);
  }
  aoPass.enabled = !under && gfx.ao;   // 水裡一片混濁，不需要；畫質「低」也省掉
  waterFlag.visible = aoPass.enabled;    // 海面的記號只有角落暗影要用：沒開就不必再把整片海面的網格畫一次
  rays.enabled = gfx.rays; bloom.enabled = gfx.bloom;   // 設定裡可以各自關掉
  // 擋在鏡頭和人之間的枝葉散開（只有走路時）。第三人稱：從鏡頭到人身上這條線周圍；第一人稱：只有貼著鏡頭的那一圈
  if (mode === 'walk' && inGame && !debugCam) {
    camera.updateMatrixWorld();
    if (view.walk.fp) { SIGHT.p.value.set(0, 0, 0); SIGHT.r.value.set(0.5, 1.1); }
    else {
      SIGHT.p.value.set(player.pos.x, player.pos.y + 1.1, player.pos.z).applyMatrix4(_sightM.copy(camera.matrixWorld).invert());
      SIGHT.r.value.set(1.3, 2.7);
    }
  } else SIGHT.r.value.set(0, 0);
  syncWaterTsu();
  fitWater(under);
  syncHullCut();
  const aim = inGame && mode === 'walk' && !debugCam && !tabOpen() && !chat.isOpen && !wheel.isOpen && !$('panel').open ? aimTarget() : null;
  const outline = aimOutlineTargets(aim);
  aimOutline.setTargets(outline?.objs, outline?.ignore);
  batchFish(aim);
  composer.render();
  checkWater();
}

viewReady = true;
applyViewSettings();
onResize();
ocean.cacheBlock(boat.x, boat.z);
boat.update(0.016, boatEnv);
player.place(walkWorld, SPAWN_W.x, SPAWN_W.z);

// 角落一直顯示每秒幾幀、平均一幀幾毫秒；網址加 ?fps 的話，後面再加上解析度、畫質、顯示晶片這些細節
const fpsMore = new URLSearchParams(window.location.search).has('fps');
const fpsEl = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'fps', textContent: '-- fps　-- ms' }));
let fpsN = 0, fpsT = performance.now(), gpuName = '';
if (fpsMore) {
  const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  gpuName = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).replace(/ANGLE \(|\)$/g, '').slice(0, 60);
}
// 第一次進遊戲（還沒自己調過畫質）：進房三秒後量五秒的幀率，平均每幀超過 40 毫秒（每秒不到 25 幀）就降一檔——
// 手機降到「低」、電腦降到「中」（電腦的高是最高規格，不管效能）。量完就記住，之後不再量
let probe = !TOUCH && !gfxSaved ? { t0: 0, n: 0, sum: 0 } : null;
function probeGfx(ms, rawMs) {
  if (!inGame || document.hidden) { if (probe.t0) probe.t0 = ms; return; }
  if (!probe.t0) { probe.t0 = ms; return; }
  if (ms - probe.t0 < 3000 || rawMs > 250) return;
  probe.n++; probe.sum += rawMs;
  if (ms - probe.t0 < 8000) return;
  const avg = probe.sum / probe.n;
  const down = 1;
  if (avg > 40 && presetOf() > down) { setGfx(down); toast(`畫面有點卡，畫質自動換成「${PRESETS[down].name}」（可在設定裡改回來）`); }
  saveGfx();
  probe = null;
}
// ?diag：診斷手機上的海面。每秒在顯示晶片上算一次「人前方 12 公尺」那一點的海床、避浪、離岸距離、岸邊浪高、FFT 浪高，
// 跟這邊 CPU 算的對照著顯示在畫面左上角，連同顯示晶片名稱和支援的功能。截圖回報用
const diag = new URLSearchParams(window.location.search).has('diag') ? (() => {
  const gl = renderer.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).slice(0, 70);
  const vp = gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_FLOAT), fp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  const ext = ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'OES_texture_float_linear'].map((n) => `${n.replace(/^(EXT|OES)_/, '')}:${gl.getSupportedExtensions().includes(n) ? '有' : '無'}`).join(' ');
  const rt = new THREE.WebGLRenderTarget(4, 1, { type: ocean.floatRT ? THREE.FloatType : THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const u = { ...shared, uDiagP: { value: new THREE.Vector2() } };
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: diagVert, fragmentShader: diagFrag, uniforms: u, depthTest: false, depthWrite: false }));
  quad.frustumCulled = false;
  const dScene = new THREE.Scene(); dScene.add(quad);
  // 第二部分：用海面的頂點程式本身算人前方 12、40、150 公尺三點（見 renderShaders.js 的 DIAG）
  const DISTS = [12, 40, 150];
  const ptGeo = new THREE.BufferGeometry();
  ptGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
  const ptMat = new THREE.ShaderMaterial({ vertexShader: waterVert, fragmentShader: diagPtFrag, uniforms: shared, defines: { DIAG: 1, ...water.material.defines }, depthTest: false, depthWrite: false });
  const pts = new THREE.Points(ptGeo, ptMat);
  pts.frustumCulled = false;
  const pScene = new THREE.Scene(); pScene.add(pts);
  const rt2 = new THREE.WebGLRenderTarget(6, 1, { type: rt.texture.type, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const out2 = new Float32Array(24), hb2 = new Uint16Array(24);
  const el = document.body.appendChild(Object.assign(document.createElement('pre'), { id: 'diag' }));
  Object.assign(el.style, { position: 'fixed', left: '8px', top: '60px', zIndex: 99, margin: 0, padding: '6px 8px', font: '12px/1.35 monospace', color: '#fff', background: 'rgba(0,0,0,0.72)', whiteSpace: 'pre', pointerEvents: 'none' });
  const out = new Float32Array(16), hb = new Uint16Array(16), f = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
  let t = 0;
  return (ms) => {
    if (ms - t < 1000) return;
    t = ms;
    camera.getWorldDirection(_gd); _gd.y = 0; _gd.normalize();
    const px = player.x + _gd.x * 12, pz = player.z + _gd.z * 12;
    u.uDiagP.value.set(px, pz);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt); renderer.render(dScene, ocean.cam); 
    if (rt.texture.type === THREE.FloatType) gl.readPixels(0, 0, 4, 1, gl.RGBA, gl.FLOAT, out);
    else { gl.readPixels(0, 0, 4, 1, gl.RGBA, gl.HALF_FLOAT, hb); for (let i = 0; i < 16; i++) out[i] = THREE.DataUtils.fromHalfFloat(hb[i]); }
    // 頂點程式算的三點
    const pa = ptGeo.attributes.position.array, cx = shared.uCenter.value.x, cz = shared.uCenter.value.y;
    DISTS.forEach((D, i) => {
      for (let j = 0; j < 2; j++) { const o = (i * 2 + j) * 3; pa[o] = player.x + _gd.x * D - cx; pa[o + 1] = i * 2 + j; pa[o + 2] = player.z + _gd.z * D - cz; }
    });
    ptGeo.attributes.position.needsUpdate = true;
    const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    renderer.setRenderTarget(rt2); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(pScene, ocean.cam); renderer.setClearColor(cc, ca);
    if (rt2.texture.type === THREE.FloatType) gl.readPixels(0, 0, 6, 1, gl.RGBA, gl.FLOAT, out2);
    else { gl.readPixels(0, 0, 6, 1, gl.RGBA, gl.HALF_FLOAT, hb2); for (let i = 0; i < 24; i++) out2[i] = THREE.DataUtils.fromHalfFloat(hb2[i]); }
    renderer.setRenderTarget(prev);
    const vtx = DISTS.map((D, i) => { const a = i * 8; return `頂點${D}m 高${f(out2[a])} FFT${f(out2[a + 1])} 岸${f(out2[a + 2])} 漩${f(out2[a + 3])} 巨${f(out2[a + 4])} 長${f(out2[a + 5])} lod${f(out2[a + 6])}`; });
    el.textContent = [
      `${gpu}`, `高精度 頂點:${vp.precision} 像素:${fp.precision}  ${ext}`,
      `畫質${gfx.name} 浮點緩衝:${ocean.floatRT ? 32 : 16}位 位移圖:${ocean.cascades[0].disp[0].texture.type === THREE.FloatType ? 32 : 16}位`,
      `點 (${f(px)}, ${f(pz)})`,
      `海床   GPU ${f(out[0])}  CPU ${f(bedAt(px, pz))}`,
      `避浪   GPU ${f(out[1])}  CPU ${f(shelterAt(px, pz))}`,
      `危險度 GPU ${f(out[2])}  CPU ${f(dangerAt(px, pz))}`,
      `離岸   GPU ${f(out[3])}`,
      `沖岸 ${f(out[4])}  岸浪 ${f(out[5])}  FFT浪 ${f(out[6])}  淺水 ${f(out[7])}`,
      `expo ${f(out[8])}  ph ${f(out[9])}  浪強 ${f(out[10])}  衰減 ${f(out[11])}`,
      `縮小版浪高 L2 ${f(out[12])}  L4 ${f(out[13])}  L6 ${f(out[14])}  第二層L4 ${f(out[15])}${water.material.defines.WLOD0 ? '  (wlod0)' : ''}`,
      `浮力讀回 ${f(ocean.sampleHeight(px, pz))}`,
      ...vtx,
    ].join(String.fromCharCode(10));
  };
})() : null;
function animate(ms) {
  if (mobileRefresh?.sample(ms)) syncFrameChoices();
  const drawMs = drawClock.take(ms, TOUCH ? (inGame ? frameLimit : 20) : frameLimit);
  // 手機的走路、掌舵和釣魚獨立排程，模擬上限為每秒 60 次；電腦版跟隨畫面步調。
  const simMs = TOUCH ? simClock.take(ms, inGame ? 60 : 30) : drawMs;
  if (simMs > 0) advance(Math.min(simMs / 1000, 0.05));
  if (drawMs === null) return;
  if (diag) diag(ms);
  if (probe && !frameLimit) probeGfx(ms, drawMs);
  drawFrame(Math.min(drawMs / 1000, TOUCH && !inGame ? 0.075 : 0.05), ms);
  if (adaptiveEnabled || !adaptiveAsked) checkAdaptiveQuality(ms);
  if (hudClock.take(ms, TOUCH ? 10 : 20) !== null) { updatePrompt(); if (tabOpen()) { tablet.update(); if (tabHand && !view.walk.fp) syncOwnTabletTex(false); } }
  if (++fpsN && ms - fpsT >= 1000) {
    const span = ms - fpsT;
    fpsEl.textContent = `${Math.round(fpsN * 1000 / span)} fps　${(span / fpsN).toFixed(1)} ms`
      + (net.ping !== null ? `　ping ${net.ping} ms` : '')
      + (fpsMore ? `　${pixelRatio.toFixed(1)}×　${canvas.width}×${canvas.height}　畫質${gfx.name}　${TOUCH ? '手機' : '電腦'}　${gpuName}` : '');
    fpsN = 0; fpsT = ms;
  }
}
function syncAnimation() {
  simClock.reset(); drawClock.reset(); hudClock.reset(); mobileShadowClock.reset();
  mobileRefresh?.reset();
  qualityTiming.reset();
  shadowElapsed = 0;
  if (probe) { probe.t0 = 0; probe.n = 0; probe.sum = 0; }
  fpsN = 0; fpsT = performance.now();
  renderer.setAnimationLoop(document.hidden ? null : animate);
}
document.addEventListener('visibilitychange', syncAnimation);
syncAnimation();

// 供除錯與測試使用
window.__sim = {
  advance, drawFrame, get boat() { return boat; }, boats, addBoat, offer, refreshTags, boxes, heldBox, nearShelf, SHELF,
  get rodLv() { return rodLv; }, get rodBroken() { return rodBroken; },
  aimTarget, wheel, closeWheel, sitDown, standUp, offAt, audio, player, ocean, keys, view, bedAt, walkGround, walkWorld, shelterAt, nearHelm, interact, toggleFp,
  fish, fishing, isWater, SELL: SELL_W, get money() { return money; },
  // 多人
  net, others, chat, boards, garage, enterRoom, applyWorld, myFishUids, takeHelm, releaseHelm, touch, setGfx, setPixelRatio,
  get gfxLv() { return presetOf(); }, get waterSplit() { return waterSplit; }, get pixelRatio() { return pixelRatio; }, get frameLimit() { return frameLimit; }, gs, applyGfx, PRESETS, get gfx() { return gfx; }, diag,
  get kit() { return kit; }, get myBoat() { return myBoat; }, get berth() { return berth; }, get room() { return room; }, get inGame() { return inGame; }, get time() { return time; },
  dev: (cmd, o = {}) => net.send({ t: 'dev', cmd, ...o }),   // 測試指令（伺服器開了開發模式才收）：event / calm / skip / money / fish / refresh（立刻刷新）
  sea, dangerAt, tsuAt, stormK, waterY, nearTank,
  get wreck() { return wreck; }, surfProbe, climate, lightning, updateWeather, boatEnv, rain, bolt, spouts,
  showHomeTip,
  get rainNow() { return rainNow; }, get gloom() { return gloom; }, lampLights, boatLight, wildlife,
  updatePrompt, N, DX, L, ISLANDS, camera, scene, water, terrain, scenery, harbor, shared, spray, renderer,
  get mode() { return mode; }, NF, sun, placeSun, WIND, rays, bloom, aoPass, camBlockers, SIGHT, grass, SOLIDS, rockAt, composer, shallow, shallowNear, target, playerWater, updateSwim, toggleMap: () => tablet.toggle('map'), drawMap,
  get stamina() { return stamina; }, set stamina(v) { stamina = v; }, get drown() { return drown; }, get mapOpen() { return tabOpen() && tablet.cur === 'map'; }, get tablet() { return tablet; },
  set cam(v) { debugCam = v; }, get flood() { return flood; }, set flood(v) { floodTest = v; if (v !== null) flood = v; }, tsuKAt, BOLLARDS, nearBollard, surgeAt, hullBlocked, boatGround,
  // 量測實際每幀成本（毫秒）：連續算 n 幀並強制 GPU 完成
  bench(n = 20) {
    const gl = renderer.getContext(), px = new Uint8Array(4);
    mobileShadowClock.reset();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      advance(1 / 60);
      drawFrame(1 / 60, t0 + i * 1000 / 60);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    mobileShadowClock.reset();
    return (performance.now() - t0) / n;
  },
};

// 先填名字、挑房間；進房之後才能動
// 選單裡換角色：港口裡自己的人偶、自己船上的舵手跟著換
runMenu(net, (look) => { restyle(player.mesh, look); restyle(myBoat.parts.helmsman, look); }).then(enterRoom);
