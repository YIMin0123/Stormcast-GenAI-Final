// 母島的木造漁港：一條轉彎的木棧橋（兩側 32 格停船格）、橋頭的商店和魚市場、坡上的小屋、岩岬上的燈塔。
// 模型在 lowpoly/harbor3d.js，這裡再加上遊戲才需要的東西（賣魚的電子板、價格牌、纜繩）。
// 除了模型，也回傳可行走的棧板範圍、商店與燈塔位置、出生點，給玩家與船的邏輯用。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildBoatMesh, BOAT_TYPES } from './boat.js';
import { makeCanMesh } from './fish.js';
import { HOME_U, homeGlsl } from './homeGl.js';
import { toWorld, HOME_YAW } from './frame.js';
import { bulb, softDisc, softSquare } from './toon.js';
import { DECK_Y, DECKS, WALLS, SHOP, LIGHTHOUSE, SELL, SHELF, PLAYER_SPAWN } from './layout.js';
import * as H from './lowpoly/harborPlan.js';
import { buildHarbor } from './lowpoly/harbor3d.js';
import { rng, makeMaterial, tagSurfaces } from './lowpoly/kit.js';
import { addSurfaceDetail } from './lowpoly/surfaceDetail.js';
import { TOUCH } from './touch.js';
import { palette } from './lowpoly/palette.js';
// 港口的配置（哪裡是岸壁、商店、攤位、停船格）在 layout.js，伺服器也用同一份；這裡照著它蓋模型
export { DECK_Y, DECKS, WALLS, SHOP, LIGHTHOUSE, SELL, SHELF, PLAYER_SPAWN };
// 這個檔案的座標全是港座標（見 frame.js）；makeHarbor 回傳的 group 由呼叫的人擺到世界裡（位置、轉向）

export const HARBOR_ROCKS = [];   // 母島的大石頭（照模型的高度圖）、燈塔的石墩（平頂橢圓）：格式見 harbor3d.js 的 rockShape、main.js 的 rockAt

// 電子板的畫面：黑底綠字
const boardCanvas = document.createElement('canvas');
boardCanvas.width = 512; boardCanvas.height = 256;
const boardTex = new THREE.CanvasTexture(boardCanvas);
boardTex.colorSpace = THREE.SRGBColorSpace;
boardTex.anisotropy = 8;
export function setBoard(lines) {
  const g = boardCanvas.getContext('2d');
  g.fillStyle = '#07140c'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#39ff7a';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((t, i) => {
    g.font = `bold ${i === lines.length - 1 ? 64 : 40}px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", monospace`;
    g.fillText(t, 256, 256 * (i + 0.5) / lines.length + (i === lines.length - 1 ? 0 : 6));
  });
  boardTex.needsUpdate = true;
}

const tags = SHELF.map(() => {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;   // 斜著看遠處的地面、牆面時紋路才不會閃爍
  return { c, t };
});
// 更新第 i 樣商品的價格牌：[品名, 說明, 價錢]
export function setTag(i, lines) {
  const { c, t } = tags[i], g = c.getContext('2d');
  g.fillStyle = '#5b3a1e'; g.fillRect(0, 0, 256, 160);
  g.fillStyle = '#efe2bd'; g.fillRect(5, 5, 246, 150);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const font = (px) => `bold ${px}px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif`;
  g.fillStyle = '#3a2412'; g.font = font(lines[0].length > 5 ? 28 : 36); g.fillText(lines[0], 128, 34);
  g.fillStyle = '#6a4a2a'; g.font = font(lines[1].length > 9 ? 19 : 22); g.fillText(lines[1], 128, 78);
  g.fillStyle = '#a3261a'; g.font = font(40); g.fillText(lines[2], 128, 124);
  t.needsUpdate = true;
}
// 招牌的字：wood 深色木頭看板＋米白色的字、chalk 黑板＋粉筆字、nobori 直式的布旗（字由上往下排）
function signFace(sg) {
  const PX = 160, c = document.createElement('canvas');
  c.width = Math.round(sg.w * PX); c.height = Math.round(sg.h * PX);
  const g = c.getContext('2d'), W = c.width, Hh = c.height;
  const font = (px) => 'bold ' + Math.round(px) + 'px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", serif';
  const r = trng(sg.text.length * 31 + Math.round(sg.x * 7));
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (sg.style === 'nobori') {
    g.fillStyle = sg.col; g.fillRect(0, 0, W, Hh);
    g.fillStyle = 'rgba(255,255,255,0.92)'; g.fillRect(0, 0, W, Hh * 0.06); g.fillRect(0, Hh * 0.94, W, Hh * 0.06);
    const n = sg.text.length, cell = Hh * 0.82 / n;
    g.fillStyle = '#fbf6ea'; g.font = font(Math.min(cell * 0.82, W * 0.8));
    [...sg.text].forEach((ch, i) => g.fillText(ch, W / 2, Hh * 0.09 + cell * (i + 0.5)));
  } else if (sg.style === 'chalk') {
    g.fillStyle = '#2d3a33'; g.fillRect(0, 0, W, Hh);
    for (let i = 0; i < 300; i++) { g.fillStyle = 'rgba(255,255,255,' + (0.02 + r() * 0.04) + ')'; g.fillRect(r() * W, r() * Hh, 2 + r() * 20, 1 + r() * 3); }   // 擦過的粉筆痕
    const [a, b] = sg.text.split('・');
    g.fillStyle = '#f4f0e2'; g.font = font(Hh * 0.2); g.fillText(a, W / 2, Hh * 0.22);
    g.fillStyle = '#f2d36b'; g.font = font(Hh * 0.13); g.fillText(b || '', W / 2, Hh * 0.42);
    g.strokeStyle = 'rgba(244,240,226,0.7)'; g.lineWidth = 3; g.beginPath(); g.moveTo(W * 0.12, Hh * 0.53); g.lineTo(W * 0.88, Hh * 0.53); g.stroke();
    // 幾條魚的簡筆畫
    for (let i = 0; i < 3; i++) {
      const x = W * (0.25 + i * 0.25), y = Hh * 0.76, s = Hh * 0.08;
      g.strokeStyle = ['#f4f0e2', '#f29a8a', '#9fd3e6'][i]; g.lineWidth = 4;
      g.beginPath(); g.ellipse(x, y, s * 1.7, s, 0, 0, Math.PI * 2); g.moveTo(x - s * 1.7, y); g.lineTo(x - s * 2.6, y - s * 0.8); g.lineTo(x - s * 2.6, y + s * 0.8); g.closePath(); g.stroke();
    }
  } else {
    // 木頭看板：橫向的木紋、一圈深色的框、字有一點陰影（像刻進去再上色）
    g.fillStyle = '#4a2f1c'; g.fillRect(0, 0, W, Hh);
    for (let i = 0; i < 60; i++) { g.strokeStyle = 'rgba(' + (r() < 0.5 ? '255,220,170' : '0,0,0') + ',' + (0.04 + r() * 0.06) + ')'; g.lineWidth = 1 + r() * 2; const y = r() * Hh; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(W * 0.3, y + (r() - 0.5) * 12, W * 0.7, y + (r() - 0.5) * 12, W, y + (r() - 0.5) * 8); g.stroke(); }
    g.strokeStyle = '#2b1a0e'; g.lineWidth = Hh * 0.08; g.strokeRect(0, 0, W, Hh);
    g.font = font(Hh * 0.62);
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillText(sg.text, W / 2 + 3, Hh / 2 + 4);
    g.fillStyle = '#f3e3bd'; g.fillText(sg.text, W / 2, Hh / 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// 碼頭的四盞燈（晚上會亮）；UNLIT：招牌、價格牌這些不吃光照的材質，晚上要跟著變暗
export const LAMPS = H.LAMPS.map((l) => ({ x: l.x + l.ax * 0.75, y: DECK_Y + 3.2, z: l.z + l.az * 0.75 }));   // 燈籠（燈桿往棧橋中間伸出去 0.75 公尺）
export const UNLIT = [];
export const POOLS = [];   // 晚上燈光照在地上的光圈：{ mesh, mat, k }
// 路燈以外、晚上也會照到水面和地上的光源（燈籠、販賣機、魚市場的燈泡）：{ x, z, k }
export const EXTRA_LAMPS = [
  { x: H.SHOP.x0 + 0.8, z: H.SHOP.z1 + 0.45, k: 0.35 },                                       // 商店門口的燈
  { x: (H.MARKET.x0 + H.MARKET.x1) / 2, z: -9.5, k: 0.5 },                                     // 魚市場棚下的燈泡
];
export const GLOW = [];   // 晚上會透出燈光的材質（窗戶）
// 室內燈（店裡、魚市場）：每一區的燈泡材質、手機版地上的光圈。開關是整間房共用的（伺服器記著），setRoomLights 照著換亮暗
export const ROOM_LAMPS = H.ROOM_LAMPS;   // 室內燈打光的位置（港座標）
export const ROOM_LIGHTS = Object.fromEntries(H.LIGHT_ZONES.map((z) => [z, { on: true, bulbs: [], pools: [] }]));
const BULB_ON = new THREE.Color(1.0, 0.82, 0.5).multiplyScalar(2.4), BULB_OFF = new THREE.Color(0.42, 0.39, 0.33);
export function setRoomLights(state) {
  for (const [zone, z] of Object.entries(ROOM_LIGHTS)) {
    if (!(zone in state)) continue;
    z.on = !!state[zone];
    for (const m of z.bulbs) m.color.copy(z.on ? BULB_ON : BULB_OFF);
    for (const p of z.pools) p.visible = z.on;
  }
}

// 畫貼圖用的亂數（固定種子：每次開遊戲畫出來的都一樣）
const trng = (seed) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };

// 一張木板貼圖：四條並排的木板（沿著貼圖的橫向）。畫的東西：每條深淺不同、板面上亮下暗、
// 順著板子走的幾道彎彎的木紋、偶爾一個木節（木紋繞過去）、板和板之間的縫（縫的下緣一道亮邊）；
// joints：每條板中間有一處接縫，兩邊釘著釘子（地板、桌面用；牆板是整片的，不畫）。上下左右都接得起來
function plankTexture(base = [150, 108, 66], seed = 1, joints = true) {
  const S = 512, n = 4, ph = S / n, r = trng(seed * 97 + 5);
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rgb = (v, a = 1) => `rgba(${base.map((b) => Math.round(Math.min(255, b * v))).join(',')},${a})`;
  for (let i = 0; i < n; i++) {
    const y0 = i * ph, v = 0.86 + 0.26 * r();
    g.fillStyle = rgb(v);
    g.fillRect(0, y0, S, ph);
    const gr = g.createLinearGradient(0, y0, 0, y0 + ph);
    gr.addColorStop(0, 'rgba(255,240,210,0.10)'); gr.addColorStop(0.5, 'rgba(255,240,210,0)'); gr.addColorStop(1, 'rgba(30,16,6,0.15)');
    g.fillStyle = gr;
    g.fillRect(0, y0, S, ph);
    const knots = r() < 0.6 ? [[r() * S, y0 + ph * (0.3 + 0.4 * r()), 8 + 6 * r()]] : [];
    for (let k = 0; k < 6; k++) {
      const yy = y0 + 4 + (ph * (k + 0.6 + 0.5 * (r() - 0.5))) / 6.4, f1 = 1 + Math.floor(r() * 2), f2 = 3 + Math.floor(r() * 3);
      const a1 = 2 + 3.5 * r(), a2 = 0.8 + 1.4 * r(), p1 = r() * 6.2832, p2 = r() * 6.2832;
      g.strokeStyle = rgb(v * 0.62, 0.28 + 0.25 * r());
      g.lineWidth = 1.2 + 1.6 * r();
      g.beginPath();
      for (let x = 0; x <= S; x += 8) {
        let y = yy + a1 * Math.sin((x / S) * 6.2832 * f1 + p1) + a2 * Math.sin((x / S) * 6.2832 * f2 + p2);
        for (const [kx, ky, kr] of knots) {   // 木紋繞過木節
          let dx = x - kx;
          dx -= S * Math.round(dx / S);
          const dy = y - ky;
          y += (dy < 0 ? -1 : 1) * kr * 1.3 * Math.exp(-(dx * dx) / (kr * kr * 6)) * Math.exp(-Math.abs(dy) / (kr * 2.5));
        }
        if (x) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
    for (const [kx, ky, kr] of knots) for (const ox of [-S, 0, S]) {
      g.fillStyle = rgb(v * 0.52, 0.85); g.beginPath(); g.ellipse(kx + ox, ky, kr * 1.25, kr * 0.75, 0, 0, 6.2832); g.fill();
      g.fillStyle = rgb(v * 0.36, 0.9); g.beginPath(); g.ellipse(kx + ox, ky, kr * 0.62, kr * 0.36, 0, 0, 6.2832); g.fill();
    }
    if (joints) {
      const jx = r() * S;
      for (const ox of [-S, 0, S]) {
        g.fillStyle = 'rgba(36,22,10,0.8)'; g.fillRect(jx + ox - 1.5, y0, 3, ph);
        g.fillStyle = 'rgba(255,240,210,0.16)'; g.fillRect(jx + ox + 1.5, y0, 1.5, ph);
        g.fillStyle = 'rgba(40,30,24,0.85)';
        for (const sx of [-14, 14]) for (const fy of [0.28, 0.74]) { g.beginPath(); g.arc(jx + ox + sx, y0 + ph * fy, 3.2, 0, 6.2832); g.fill(); }
      }
    }
  }
  for (let i = 0; i < n; i++) {
    g.fillStyle = 'rgba(34,20,9,0.85)'; g.fillRect(0, i * ph, S, 5);
    g.fillStyle = 'rgba(255,238,205,0.20)'; g.fillRect(0, i * ph + 5, S, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;   // 斜著看遠處的地面、牆面時紋路才不會閃爍
  return t;
}

// 屋頂的木瓦：一排一排交錯的瓦片，上一排壓著下一排（貼圖往下 = 往屋簷）。
// 每片瓦下緣是圓角、深淺各自不同，壓在下一排上的地方有一道影子，下緣一道亮邊，瓦面上兩三道淡淡的直紋
function shingleTexture(color, seed = 3) {
  const S = 512, rows = 8, cols = 6, rh = S / rows, cw = S / cols, r = trng(seed * 131 + 7);
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), base = new THREE.Color(color);
  const tone = (v) => `rgb(${Math.round(Math.min(255, base.r * 255 * v))}, ${Math.round(Math.min(255, base.g * 255 * v))}, ${Math.round(Math.min(255, base.b * 255 * v))})`;
  const info = Array.from({ length: rows }, () => Array.from({ length: cols }, () => [0.74 + 0.4 * r(), 0.15 + 0.2 * r(), 0.45 + 0.15 * r(), 0.7 + 0.2 * r()]));
  g.fillStyle = tone(0.4);
  g.fillRect(0, 0, S, S);
  const tile = (x, y, [v, g1, g2, g3]) => {
    const w = cw - 3, h = rh + 14, rad = 13, x0 = x + 1.5;
    const path = (dy) => {
      g.beginPath();
      g.moveTo(x0, y + dy); g.lineTo(x0 + w, y + dy); g.lineTo(x0 + w, y + dy + h - rad);
      g.quadraticCurveTo(x0 + w, y + dy + h, x0 + w - rad, y + dy + h); g.lineTo(x0 + rad, y + dy + h);
      g.quadraticCurveTo(x0, y + dy + h, x0, y + dy + h - rad);
      g.closePath();
    };
    path(7); g.fillStyle = 'rgba(12,4,2,0.42)'; g.fill();   // 影子落在下一排上
    path(0); g.fillStyle = tone(v); g.fill();
    g.save();
    path(0); g.clip();
    g.fillStyle = 'rgba(255,225,200,0.15)'; g.fillRect(x, y + h - 5, cw, 5);
    g.strokeStyle = 'rgba(20,6,2,0.15)'; g.lineWidth = 1.5;
    for (const gx of [g1, g2, g3]) { g.beginPath(); g.moveTo(x + cw * gx, y + 4); g.lineTo(x + cw * gx + 2, y + h - 8); g.stroke(); }
    g.restore();
  };
  const row = (j, dy) => { for (let i = -1; i <= cols; i++) tile((i + (j % 2) * 0.5) * cw, j * rh + dy, info[j][((i % cols) + cols) % cols]); };
  for (let j = rows - 1; j >= 0; j--) row(j, 0);
  row(rows - 1, -S);   // 最下面那排壓到貼圖外的部分，接回最上面
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;   // 斜著看遠處的地面、牆面時紋路才不會閃爍
  return t;
}

// 漁網：透明底上的菱形網格
function netTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(70, 92, 84, 1)';
  g.lineWidth = 2;
  for (let i = -128; i < 256; i += 16) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke();
    g.beginPath(); g.moveTo(i + 128, 0); g.lineTo(i, 128); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;   // 斜著看遠處的地面、牆面時紋路才不會閃爍
  return t;
}

function signTexture(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#5b3a1e'; g.fillRect(0, 0, 256, 96);
  g.fillStyle = '#e9d9b0'; g.fillRect(6, 6, 244, 84);
  g.fillStyle = '#3a2412';
  g.font = 'bold 56px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;   // 斜著看遠處的地面、牆面時紋路才不會閃爍
  return t;
}

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;   // 斜著看遠處的地面、牆面時紋路才不會閃爍
  return t;
}
// 水泥地。一張貼圖是 16 公尺見方（4×4 塊四公尺的板）：範圍夠大，同一道裂縫、同一塊水漬不會每隔幾公尺就重複一次。
// 畫的東西：每塊板深淺略有不同、抹平時留下的大片色差、掃帚掃過的細紋、露出來的小石粒、
// 水漬和鏽漬、補過的方塊、細裂縫、板和板之間的伸縮縫（縫邊積灰、缺角）
const CONC_M = 16;   // 一張貼圖鋪幾公尺
function concreteTexture() {
  const S = 2048, N = 4, P = S / N;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let seed = 20261;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  // 一團邊緣柔和的色塊；靠近貼圖邊緣的會在對面再畫一次，鋪起來才接得上
  const blob = (x, y, rx, ry, rot, rgb, a) => {
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        if (x + ox + rx < 0 || x + ox - rx > S || y + oy + rx < 0 || y + oy - rx > S) continue;
        g.save();
        g.translate(x + ox, y + oy);
        g.rotate(rot);
        g.scale(1, ry / rx);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
        gr.addColorStop(0, `rgba(${rgb},${a})`);
        gr.addColorStop(0.55, `rgba(${rgb},${a * 0.7})`);
        gr.addColorStop(1, `rgba(${rgb},0)`);
        g.fillStyle = gr;
        g.beginPath(); g.arc(0, 0, rx, 0, 6.2832); g.fill();
        g.restore();
      }
    }
  };
  // 1. 每塊板是分次灌的，顏色略有差異
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const v = 0.955 + 0.075 * rnd(), warm = rnd();
      g.fillStyle = `rgb(${Math.round(201 * v)},${Math.round(197 * v)},${Math.round((187 - 7 * warm) * v)})`;
      g.fillRect(i * P, j * P, P, P);
    }
  }
  // 2. 大片的深淺
  for (let i = 0; i < 70; i++) blob(rnd() * S, rnd() * S, 110 + 200 * rnd(), 70 + 150 * rnd(), rnd() * 3.14, rnd() < 0.5 ? '255,251,242' : '104,99,90', 0.05 + 0.05 * rnd());
  // 3. 掃帚紋：每塊板各自一個方向
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      g.save();
      g.beginPath(); g.rect(i * P, j * P, P, P); g.clip();
      const ang = ((i + j) % 2 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.12, dx = Math.cos(ang), dy = Math.sin(ang);
      for (let k = 0; k < 110; k++) {
        const x = i * P + rnd() * P, y = j * P + rnd() * P, len = 80 + 320 * rnd();
        g.strokeStyle = rnd() < 0.5 ? `rgba(255,252,244,${0.03 + 0.04 * rnd()})` : `rgba(96,92,84,${0.025 + 0.035 * rnd()})`;
        g.lineWidth = 1.5 + 2.5 * rnd();
        g.beginPath(); g.moveTo(x - dx * len / 2, y - dy * len / 2); g.lineTo(x + dx * len / 2, y + dy * len / 2); g.stroke();
      }
      g.restore();
    }
  }
  // 4. 小石粒：一撮一撮的，不是均勻撒滿
  for (let k = 0; k < 260; k++) {
    const cx = rnd() * S, cy = rnd() * S, n = 5 + Math.floor(12 * rnd()), spread = 16 + 34 * rnd();
    for (let i = 0; i < n; i++) {
      g.fillStyle = rnd() < 0.6 ? `rgba(82,78,71,${0.16 + 0.16 * rnd()})` : `rgba(255,253,246,${0.25 + 0.2 * rnd()})`;
      g.beginPath(); g.arc(cx + (rnd() - 0.5) * 2 * spread, cy + (rnd() - 0.5) * 2 * spread, 1 + 1.8 * rnd(), 0, 6.2832); g.fill();
    }
  }
  // 5. 水漬、油漬、鏽漬：幾團疊在一起，中間深、邊緣不規則
  for (let k = 0; k < 16; k++) {
    const cx = rnd() * S, cy = rnd() * S, sp = 40 + 90 * rnd(), rgb = k % 4 === 0 ? '150,98,60' : '80,75,66';
    for (let i = 0, n = 5 + Math.floor(4 * rnd()); i < n; i++) blob(cx + (rnd() - 0.5) * 2 * sp, cy + (rnd() - 0.5) * 2 * sp, 40 + 70 * rnd(), 28 + 55 * rnd(), rnd() * 3.14, rgb, 0.05 + 0.045 * rnd());
  }
  // 6. 補過的地方：顏色比較新的一塊方形
  for (let k = 0; k < 3; k++) {
    const w = 130 + 150 * rnd(), h = 90 + 120 * rnd(), x = 80 + rnd() * (S - 160 - w), y = 80 + rnd() * (S - 160 - h);
    g.save();
    g.translate(x + w / 2, y + h / 2);
    g.rotate((rnd() - 0.5) * 0.08);
    g.fillStyle = 'rgba(226,223,214,0.6)';
    g.fillRect(-w / 2, -h / 2, w, h);
    g.strokeStyle = 'rgba(88,83,75,0.4)';
    g.lineWidth = 2.5;
    g.strokeRect(-w / 2, -h / 2, w, h);
    g.restore();
  }
  // 7. 細裂縫：歪歪扭扭地走，偶爾分岔，越走越細
  const crack = (x, y, ang, steps, wid) => {
    for (let i = 0; i < steps; i++) {
      const t = i / steps, nx = x + Math.cos(ang) * 13, ny = y + Math.sin(ang) * 13;
      if (nx < 20 || nx > S - 20 || ny < 20 || ny > S - 20) return;
      g.strokeStyle = 'rgba(255,253,246,0.22)';
      g.lineWidth = wid * (1 - 0.6 * t);
      g.beginPath(); g.moveTo(x + 1.5, y + 1.5); g.lineTo(nx + 1.5, ny + 1.5); g.stroke();
      g.strokeStyle = `rgba(56,52,46,${0.62 - 0.25 * t})`;
      g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
      x = nx; y = ny;
      ang += (rnd() - 0.5) * 0.75;
      if (wid > 1.6 && rnd() < 0.07) crack(x, y, ang + (rnd() < 0.5 ? -1 : 1) * (0.6 + 0.5 * rnd()), Math.round(steps * 0.4), wid * 0.65);
    }
  };
  g.lineCap = 'round';
  for (let k = 0; k < 10; k++) crack(60 + rnd() * (S - 120), 60 + rnd() * (S - 120), rnd() * 6.2832, 14 + Math.floor(34 * rnd()), 1.8 + 1.4 * rnd());
  // 8. 伸縮縫：縫的兩邊積了灰，縫本身是一道深溝，一側有受光的亮邊；沿縫有些缺角
  for (let k = 0; k <= N; k++) {
    const q = k * P;
    for (const vert of [false, true]) {
      const band = vert ? g.createLinearGradient(q - 22, 0, q + 22, 0) : g.createLinearGradient(0, q - 22, 0, q + 22);
      band.addColorStop(0, 'rgba(84,79,70,0)'); band.addColorStop(0.5, 'rgba(84,79,70,0.2)'); band.addColorStop(1, 'rgba(84,79,70,0)');
      g.fillStyle = band;
      if (vert) g.fillRect(q - 22, 0, 44, S); else g.fillRect(0, q - 22, S, 44);
      g.fillStyle = 'rgba(60,56,50,0.8)';
      if (vert) g.fillRect(q - 2.5, 0, 5, S); else g.fillRect(0, q - 2.5, S, 5);
      g.fillStyle = 'rgba(255,253,246,0.4)';
      if (vert) g.fillRect(q + 2.5, 0, 2, S); else g.fillRect(0, q + 2.5, S, 2);
    }
  }
  g.fillStyle = 'rgba(60,56,50,0.75)';
  for (let k = 0; k < 46; k++) {
    const line = Math.floor(rnd() * N) * P, along = 30 + rnd() * (S - 60), vert = rnd() < 0.5, r0 = 5 + 9 * rnd(), n = 3 + Math.floor(3 * rnd()), a0 = rnd() * 6.2832;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * 6.2832, rr = r0 * (0.6 + 0.6 * rnd()), px = (vert ? line : along) + Math.cos(a) * rr, py = (vert ? along : line) + Math.sin(a) * rr;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;   // 斜著看遠處的地面時紋路才不會閃爍
  return t;
}
// ---- 下雨時的水泥地 ----
// 淋到雨的地面顏色變深、斜著看過去泛一層天光；低窪的地方積水，積水像鏡子一樣映著天色，雨點打出一圈圈漣漪。
// 雨越下越久積水越大片，雨停後慢慢乾、積水慢慢縮回去。屋頂和雨棚底下淋不到雨，是乾的。
// main.js 每幀更新：wet 地面有多濕（0～1）、rain 現在雨多大、time 時間；dry 是有遮蔽的範圍 (x0, z0, x1, z1)；
// reflTex / reflMat / reflOn 是碼頭平面以上的景物鏡射出來的畫面（積水裡的倒影），沒有的時候積水只映天色
export const WET = {
  wet: { value: 0 }, rain: { value: 0 }, time: { value: 0 },
  dry: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
  reflTex: { value: null }, reflMat: { value: new THREE.Matrix4() }, reflOn: { value: 0 },
};
function wetGround(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWetK = WET.wet;
    sh.uniforms.uRainK = WET.rain;
    sh.uniforms.uWetT = WET.time;
    sh.uniforms.uDry = WET.dry;
    sh.uniforms.uHome = HOME_U;
    sh.uniforms.uDeckRefl = WET.reflTex;
    sh.uniforms.uDeckReflMat = WET.reflMat;
    sh.uniforms.uDeckReflOn = WET.reflOn;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWetPos;\nvarying float vWetUp;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n\tvWetPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n\tvWetUp = normalize( mat3( modelMatrix ) * objectNormal ).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${homeGlsl}
uniform float uWetK;
uniform float uRainK;
uniform float uWetT;
uniform vec4 uDry[ 4 ];
uniform sampler2D uDeckRefl;
uniform mat4 uDeckReflMat;
uniform float uDeckReflOn;
varying vec3 vWetPos;
varying float vWetUp;
float wetHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float wetNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( wetHash( i ), wetHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( wetHash( i + vec2( 0.0, 1.0 ) ), wetHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
// 雨點打在積水上的漣漪：地面分成一格一格，每格裡一個位置、時機都不同的圈，從一點擴開、越擴越淡
float wetRings( vec2 p, float rain ) {
	float acc = 0.0;
	for ( int k = 0; k < 2; k ++ ) {
		vec2 g = p * ( k == 0 ? 2.3 : 3.4 ) + float( k ) * 13.7, id = floor( g ), f = fract( g ) - 0.5;
		float h = wetHash( id + 3.1 );
		if ( h > rain * 0.75 ) continue;
		float t = fract( uWetT * ( 0.8 + 0.6 * wetHash( id + 9.7 ) ) + h * 11.0 );
		vec2 c = ( vec2( wetHash( id + 1.7 ), wetHash( id + 5.3 ) ) - 0.5 ) * 0.45;
		float size = 0.22 + 0.2 * wetHash( id + 2.9 );   // 有大圈有小圈
		acc += ( 1.0 - smoothstep( 0.0, 0.05, abs( length( f - c ) - t * size ) ) ) * ( 1.0 - t ) * ( 1.0 - t );
	}
	return acc;
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
	float wetHere = 0.0, wetPud = 0.0;
	if ( uWetK > 0.001 && vWetUp > 0.5 ) {
		vec2 wq = homeLocal( vWetPos.xz );   // 淋不到雨的範圍、積水的位置都用港座標
		float roof = 0.0;
		for ( int i = 0; i < 4; i ++ ) {
			vec4 r = uDry[ i ];
			roof = max( roof, 1.0 - smoothstep( - 0.7, 0.3, max( max( r.x - wq.x, wq.x - r.z ), max( r.y - wq.y, wq.y - r.w ) ) ) );
		}
		wetHere = uWetK * ( 1.0 - roof );
		float low = wetNoise( wq * 0.33 ) * 0.65 + wetNoise( wq * 0.9 + 7.3 ) * 0.35;
		float deep = low - ( 0.81 - 0.17 * wetHere );   // 大於 0 的地方有積水；濕透了也只有最低的那一成多會積
		float flatK = smoothstep( 0.05, 0.3, wetHere ) * step( 0.996, vWetUp );   // 斜坡上積不了水
		wetPud = smoothstep( 0.0, 0.025, deep ) * flatK;
		float rim = ( 1.0 - smoothstep( 0.0, 0.03, abs( deep ) ) ) * flatK;   // 水邊一圈顏色最深
		diffuseColor.rgb *= mix( 1.0, 0.6, wetHere ) * mix( 1.0, 0.7, wetPud ) * ( 1.0 - 0.22 * rim );
	}`)
      .replace('#include <opaque_fragment>', `#if NUM_HEMI_LIGHTS > 0
	if ( wetHere > 0.0 ) {
		float wetF = 0.1 + 0.9 * pow( 1.0 - saturate( dot( normalize( vViewPosition ), normal ) ), 3.0 );   // 越斜著看，映出來的天光越多
		vec3 wetSky = hemisphereLights[ 0 ].skyColor * 0.5;
		vec3 wetRefl = wetSky;
		if ( uDeckReflOn > 0.5 && vWetUp > 0.996 ) {
			// 積水映出碼頭上的東西（旗子、柱子、棚子、人）；沒被東西擋到的地方映的是天。雨點讓倒影微微晃動
			vec4 rc = uDeckReflMat * vec4( vWetPos, 1.0 );
			vec2 wob = vec2( wetNoise( vWetPos.xz * 2.7 + uWetT * 0.7 ), wetNoise( vWetPos.xz * 2.7 - uWetT * 0.6 + 5.0 ) ) - 0.5;
			vec4 rt = texture2D( uDeckRefl, rc.xy / rc.w + wob * 0.006 * ( 0.3 + uRainK ) );
			wetRefl = mix( wetSky, rt.rgb * 0.85, clamp( rt.a, 0.0, 1.0 ) );   // 水裡的倒影比本尊暗一點
		}
		outgoingLight = mix( outgoingLight, wetRefl, wetPud * wetF ) + wetRefl * wetF * 0.22 * wetHere * ( 1.0 - wetPud );
		if ( wetPud > 0.0 && uRainK > 0.02 ) outgoingLight += wetSky * 0.4 * wetPud * wetRings( vWetPos.xz, uRainK );
	}
	#endif
	#include <opaque_fragment>`);
  };
  return mat;
}
// 石砌的護岸、擋土牆：一排一排錯開的石塊，每塊寬窄、深淺、冷暖都不一樣，邊角是圓的，
// 上緣亮、下緣暗（看得出一塊塊凸出來），有幾塊缺了角、有幾塊裂了一道；石塊之間是深色的灰縫
const seawallTexture = () => canvasTex(512, 512, (g) => {
  const r = trng(4242), S = 512, rows = 8, rh = S / rows;
  const rr = (x, y, w, h, q) => { g.beginPath(); g.moveTo(x + q, y); g.arcTo(x + w, y, x + w, y + h, q); g.arcTo(x + w, y + h, x, y + h, q); g.arcTo(x, y + h, x, y, q); g.arcTo(x, y, x + w, y, q); g.closePath(); };
  const MORTAR = 'rgb(90,86,80)';
  g.fillStyle = MORTAR;
  g.fillRect(0, 0, S, S);
  for (let j = 0; j < rows; j++) {
    const ws = [0, 0, 0, 0].map(() => 0.72 + 0.6 * r()), sum = ws.reduce((a, b) => a + b, 0), y = j * rh;
    let x = r() * S;
    for (const wk of ws) {
      const w = (wk / sum) * S, v = 136 + 44 * r(), warm = r() < 0.7 ? 1 : -1, crack = r() < 0.2, chip = r() < 0.18, cx = 0.2 + 0.6 * r(), side = r() < 0.5, cs = 9 + 12 * r();
      // 裂縫：從上緣（或下緣）歪歪斜斜地裂進來，有長有短
      const up = r() < 0.5, cl = 0.45 + 0.55 * r(), kink = [0, 1, 2, 3].map((i) => [(r() - 0.5) * 16, (i + 0.6 + 0.4 * r()) / 4]);
      for (const ox of [-S, 0, S]) {
        const bx = x + ox + 3, by = y + 3, bw = w - 6, bh = rh - 6;
        rr(bx, by, bw, bh, 7);
        g.fillStyle = `rgb(${Math.round(v + 3 * warm)},${Math.round(v)},${Math.round(v - 8 * warm)})`;
        g.fill();
        g.save();
        g.clip();
        const gr = g.createLinearGradient(0, by, 0, by + bh);
        gr.addColorStop(0, 'rgba(255,255,255,0.13)'); gr.addColorStop(0.45, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.16)');
        g.fillStyle = gr; g.fillRect(bx, by, bw, bh);
        g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(bx, by, bw, 2.5);
        if (crack) {
          g.strokeStyle = 'rgba(50,47,44,0.6)'; g.lineWidth = 1.6; g.lineJoin = 'round';
          g.beginPath(); g.moveTo(bx + bw * cx, up ? by + bh : by);
          let ox2 = 0;
          for (const [kx, ky] of kink) { ox2 += kx; const yy = ky * cl * bh; g.lineTo(bx + bw * cx + ox2, up ? by + bh - yy : by + yy); }
          g.stroke();
        }
        if (chip) {
          g.fillStyle = MORTAR;
          g.beginPath();
          if (side) { g.moveTo(bx - 1, by + bh - cs); g.lineTo(bx + cs * 1.5, by + bh + 1); g.lineTo(bx - 1, by + bh + 1); } else { g.moveTo(bx + bw + 1, by + bh - cs); g.lineTo(bx + bw - cs * 1.5, by + bh + 1); g.lineTo(bx + bw + 1, by + bh + 1); }
          g.fill();
        }
        g.restore();
      }
      x += w;
    }
  }
});
// 泡在海裡的牆面：水面附近一圈顏色深（濕的），水線上下長著一道青苔，邊緣高高低低
function tideBand(mat) {
  mat.customProgramCacheKey = () => 'tide';
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTideW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvTideW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTideW;')
      .replace('#include <color_fragment>', `#include <color_fragment>
	float tideQ = vTideW.x + vTideW.z;
	float tideY = vTideW.y + 0.05 * sin( tideQ * 1.7 ) + 0.03 * sin( tideQ * 4.3 + 1.0 );
	diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.62, 0.64, 0.67 ), 1.0 - smoothstep( 0.32, 0.40, tideY ) );
	float tideWeed = smoothstep( -0.30, -0.05, tideY ) * ( 1.0 - smoothstep( 0.14, 0.22, tideY ) );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.13, 0.22, 0.10 ), 0.5 * tideWeed );`);
  };
  return mat;
}
const stripeTexture = (a, b) => canvasTex(64, 16, (g) => { for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? a : b; g.fillRect(i * 16, 0, 16, 16); } });
const tinTexture = () => canvasTex(64, 16, (g) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#6f8ea3' : '#84a5b8'; g.fillRect(i * 8, 0, 8, 16); } });
// 大漁旗：紅太陽、藍色的浪、兩個大字
const flagTexture = (text, bg) => canvasTex(256, 160, (g) => {
  g.fillStyle = bg; g.fillRect(0, 0, 256, 160);
  g.fillStyle = '#e8402e'; g.beginPath(); g.arc(196, 52, 34, 0, 6.3); g.fill();
  g.fillStyle = '#2a63b8';
  for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(22 + i * 44, 168, 34, Math.PI, 0); g.fill(); }
  g.fillStyle = '#fff'; g.strokeStyle = '#1c2f55'; g.lineWidth = 6;
  g.font = 'bold 76px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.strokeText(text, 100, 74); g.fillText(text, 100, 74);
}, false);

// 立在水裡的木樁（給淺水模擬當障礙物）
export const PILES = [];
export const BOLLARDS = [];  // 岸壁上的繫纜樁：{ x, z, y }（y 是纜繩套在樁上的高度）。船的纜繩可以綁在上面

// 繫船的纜繩：從船舷拉到岸上的繫纜樁。繩子比兩頭的距離長時中間垂下去（垂到水面就浮在水上），拉緊了就是直的
export class MoorLine {
  constructor() {
    const SEG = this.SEG = 14, RING = this.RING = 5;
    const g = new THREE.BufferGeometry(), idx = [];
    this.pos = new THREE.BufferAttribute(new Float32Array((SEG + 1) * RING * 3), 3);
    this.nor = new THREE.BufferAttribute(new Float32Array((SEG + 1) * RING * 3), 3);
    g.setAttribute('position', this.pos); g.setAttribute('normal', this.nor);
    for (let i = 0; i < SEG; i++) for (let k = 0; k < RING; k++) {
      const a = i * RING + k, b = i * RING + (k + 1) % RING, c = a + RING, d = b + RING;
      idx.push(a, c, b, b, c, d);
    }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xb59a68 }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this._p = new THREE.Vector3(); this._q = new THREE.Vector3(); this._t = new THREE.Vector3(); this._n1 = new THREE.Vector3(); this._n2 = new THREE.Vector3();
  }

  // a：船上那一頭；b：樁上那一頭；len：繩長；floor：水面的高度（繩子不會沉到水面下）；
  // via：繩子翻過岸壁邊緣的那一點（有的話，樁到邊緣這段貼著碼頭面走，邊緣到船那段才垂下去）
  set(a, b, len, floor, via = null) {
    const { SEG, RING, _p: p, _q: q, _t: t, _n1: n1, _n2: n2 } = this, P = this.pos.array, N = this.nor.array, R = 0.035;
    const e = via || b, cut = via ? 0.75 : 1;   // 前四分之三的節數給垂下去的那一段
    const d = a.distanceTo(e), hang = len - (via ? via.distanceTo(b) : 0);
    const sag = Math.sqrt(Math.max(0, 3 * d * (hang - d) / 8));   // 拋物線近似：弧長 ≈ 距離 + 8·垂度²／(3·距離)
    const at = (s, out) => {
      if (s > cut) return out.lerpVectors(via, b, (s - cut) / (1 - cut));
      const u = s / cut;
      out.lerpVectors(a, e, u);
      out.y = Math.max(out.y - sag * 4 * u * (1 - u), Math.min(floor + R, a.y, e.y));
      return out;
    };
    for (let i = 0; i <= SEG; i++) {
      const s = i / SEG;
      at(s, p);
      t.subVectors(at(Math.min(1, s + 0.02), q), at(Math.max(0, s - 0.02), n1)).normalize();
      n1.set(-t.z, 0, t.x);
      if (n1.lengthSq() < 1e-6) n1.set(1, 0, 0);
      n1.normalize(); n2.crossVectors(t, n1);
      for (let k = 0; k < RING; k++) {
        const ang = k / RING * Math.PI * 2, c = Math.cos(ang), sn = Math.sin(ang), v = (i * RING + k) * 3;
        const nx = c * n1.x + sn * n2.x, ny = c * n1.y + sn * n2.y, nz = c * n1.z + sn * n2.z;
        P[v] = p.x + R * nx; P[v + 1] = p.y + R * ny; P[v + 2] = p.z + R * nz;
        N[v] = nx; N[v + 1] = ny; N[v + 2] = nz;
      }
    }
    this.pos.needsUpdate = this.nor.needsUpdate = true;
    this.mesh.visible = true;
  }
}

export const SOLIDS = [];   // 棧板上擋路的東西（高出棧板的樁、燈柱、木桶、木箱、繫纜樁）：{ x, z, r }

// 蓋整座港口（港座標）：低面平塗的小島漁港（lowpoly/harbor3d.js：島的地形、岸壁、建築、消波塊、岩石、樹、草），
// 再加上遊戲才需要的東西（賣魚的電子板、價格牌），順便把擋路的東西、繫纜樁記進清單
export function makeHarbor() {
  const group = new THREE.Group();
  const mat = makeMaterial(), P = palette('warm'), r = rng(7919);
  // 電腦版：每一面記下材質種類，著色器畫木紋、石紋這些程式貼圖（手機不畫，也不記）
  tagSurfaces(!TOUCH);
  if (!TOUCH) addSurfaceDetail(mat);
  // 會重複很多個的東西（消波塊、岩石、樹、草、繫纜樁）：一個樣板＋實例
  const place = (geo, list, cast, recv) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    m.count = list.length;
    const q = new THREE.Quaternion(), qf = new THREE.Quaternion(), qy = new THREE.Quaternion(), M = new THREE.Matrix4(), col = new THREE.Color();
    list.forEach((t, i) => {
      qy.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
      qf.setFromAxisAngle(new THREE.Vector3(1, 0, 0), t.flip ? Math.PI : 0);
      q.multiplyQuaternions(qy, qf);
      M.compose(t.pos, q, t.scl);
      m.setMatrixAt(i, M);
      m.setColorAt(i, col.setScalar(t.tint ?? 1));
    });
    m.castShadow = cast; m.receiveShadow = recv;
    group.add(m);
    return m;
  };
  const out = buildHarbor({ P, r, place, mat, group, templates: [], game: true, detail: !TOUCH });   // 手機不畫店裡的小東西
  tagSurfaces(false);
  group.userData.lowpolyMat = mat;
  HARBOR_ROCKS.push(...out.rocks);   // 海岸的大岩石：船和人都過不去
  PILES.push(...out.piles);          // 立在水裡的木樁（淺水模擬的障礙物）
  SOLIDS.push(...out.solids);        // 燈桿、高出棧板的樁、魚市場的柱子、木箱木桶
  // 鏡頭用的擋牆（看不見，只給 main.js 的 camBlockers 打射線）
  const pm = new THREE.MeshBasicMaterial({ visible: false });
  for (const b of out.camBoxes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), pm);
    m.position.set(b.cx, b.cy, b.cz); m.rotation.y = b.rot;
    m.userData.camProxy = true;
    group.add(m);
  }

  // 繫船柱：每格停船格的棧橋邊一根（纜繩套在樁頂下面一點）
  for (const b of H.BOLLARDS) {
    BOLLARDS.push({ x: b.x, z: b.z, y: DECK_Y + 0.42 });
    SOLIDS.push({ x: b.x, z: b.z, r: 0.27 });   // 繫船柱：底部半徑 0.23
  }

  // 室內燈的燈泡：開著的時候很亮（會暈開），關掉變成灰灰的玻璃
  const bulbGeo = new THREE.IcosahedronGeometry(1, 1);
  for (const b of out.bulbs) {
    const m = new THREE.MeshBasicMaterial({ color: BULB_ON.clone() });
    const mesh = new THREE.Mesh(bulbGeo, m);
    mesh.position.set(b.x, b.y, b.z); mesh.scale.setScalar(b.r);
    group.add(mesh);
    ROOM_LIGHTS[b.zone].bulbs.push(m);
  }
  // 手機不打真的光（每多一盞光源，整個畫面每一點都要多算一次）：燈下的地板鋪一圈淡淡的暖色光暈代替
  if (TOUCH) {
    for (const l of H.ROOM_LAMPS) {
      const m = new THREE.MeshBasicMaterial({ map: softDisc(), color: 0xffc27a, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
      const sz = l.zone === 'shop' ? 11 : 7, mesh = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), m);
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(l.x, DECK_Y + 0.04, l.z); mesh.renderOrder = 2;
      group.add(mesh);
      ROOM_LIGHTS[l.zone].pools.push(mesh);
    }
  }

  // 有字的招牌：屋頂上的店名、魚市場的招牌、黑板、旗子（見 harborPlan.js 的 SIGNS）
  for (const sg of H.SIGNS) {
    const m = new THREE.MeshBasicMaterial({ map: signFace(sg), toneMapped: false, side: sg.style === 'nobori' ? THREE.DoubleSide : THREE.FrontSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sg.w, sg.h), m);
    mesh.position.set(sg.x, sg.y, sg.z); mesh.rotation.y = sg.rot;
    group.add(mesh);
    UNLIT.push(m);
  }

  // 賣魚的電子板：黑底綠字（setBoard 畫的），貼在魚市場中間那根柱子上的板子正面
  const bm = new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false });
  const bp = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), bm);
  bp.position.set(H.SELL.board.x, DECK_Y + 1.55, H.SELL.board.z + 0.085);
  group.add(bp);
  UNLIT.push(bm);
  // 價格牌（setTag 畫的）：貼在櫃台、展示台的正面（商品正下方），都面向店門口
  SHELF.forEach((it, i) => {
    const tm = new THREE.MeshBasicMaterial({ map: tags[i].t, toneMapped: false });
    const tp = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.45), tm);
    tp.position.set(it.tag.x, it.tag.y, it.tag.z);
    tp.rotation.x = it.tag.tilt;
    group.add(tp);
    UNLIT.push(tm);
  });
  return group;
}


// makeHarbor 蓋完之後呼叫一次：把給世界用的清單（立在水裡的樁、擋路的東西、消波塊、繫纜樁、路燈）從港座標就地轉成世界座標。
// 清單裡其他欄位（半徑、高度、亮度）不變
export function worldizeHarborLists() {
  for (const list of [PILES, SOLIDS, HARBOR_ROCKS, BOLLARDS, LAMPS, EXTRA_LAMPS]) {
    for (const p of list) [p.x, p.z] = toWorld(p.x, p.z);
  }
  // 石頭的橢圓也要跟著港口轉向（港座標轉 HOME_YAW 就是世界座標）
  const C = Math.cos(HOME_YAW), S = Math.sin(HOME_YAW);
  for (const k of HARBOR_ROCKS) if (k.c !== undefined) [k.c, k.s] = [k.c * C - k.s * S, k.s * C + k.c * S];
}
