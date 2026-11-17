// 魚的模型（只在瀏覽器用）：身體是一條沿著身長收放的管子（截面上寬下窄、頭往下收），花紋、側線、鰓蓋、嘴用小畫布畫成貼圖貼上去；
// 鰭是一根根鰭條排成的帶子（膜有起伏、越靠邊越透），眼睛是嵌在頭上的圓頂。身體跟鰭在著色器裡左右擺（flexFish），銀色的魚邊緣會反光。
// 每一種魚的長相寫在下面的 LOOKS，質感與擺法寫在 FEEL，沒寫的欄位用 DEF。座標：+X 是頭、Y 是背、Z 是側面；先照身長 1 蓋好，最後整個乘上 len。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const rng = (seed) => { let s = (seed | 0) || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; }; };
const hex = (c) => `#${new THREE.Color(c).getHexString()}`;
const mixHex = (a, b, k) => hex(new THREE.Color(a).lerp(new THREE.Color(b), k));
const shade = (c, k) => hex(new THREE.Color(c).multiplyScalar(k));

// 身體在 X 方向的範圍：尾端 X0、鼻尖 X1
const X0 = -0.4, X1 = 0.47;

// ---- 每種魚的長相 ----
// belly 肚子色、fin 鰭色（沒寫就用背色壓暗）、tail 尾鰭種類（fork 叉形、lunate 月牙、round 圓、trunc 平、shark 鯊魚、point 尖、none 沒有）、tailH 尾鰭高
// head 頭從身體的哪裡開始（0–1）、tailStart 尾柄從哪裡開始、ped 尾柄粗細比例、pointy 鼻子尖的程度、bellyK 肚子比背高多少
// dorsal / anal：[[位置 0–1, 高度倍數], …]，第一點與最後一點貼在身體上；dh 鰭的高度（身長的比例）
// pect 胸鰭大小（0 沒有）；eye 眼睛大小；eyeColor / ring 眼珠與眼圈；
// paint：花紋，依序畫在貼圖上（見 paintTexture）
const LOOKS = {
  sardine: { belly: '#f2f6f8', tail: 'fork', tailH: 0.22, pointy: 0.55, snout: 0.12, mouth: 0.05, dorsal: [[0.55, 0], [0.5, 1], [0.4, 0]], dh: 0.07, pect: 0.7,
    paint: [['fade', { c: '#4cc0b8', a: 0.45, y: [0.38, 0] }], ['stripe', { y: 0.47, t: 0.05, c: '#b9dbea', a: 0.6 }], ['dots', { y: 0.38, n: 6, r: 3, c: '#14243a', x: [0.26, 0.58] }]] },
  mackerel: { belly: '#eaf0f0', tail: 'fork', dorsal: [[0.6, 0], [0.56, 1], [0.46, 0.8], [0.44, 0]], dh: 0.06, pect: 0.8,
    extra: [{ pts: [[0.3, 0], [0.27, 0.6], [0.2, 0]], on: 'dorsal', k: 0.07 }],
    paint: [['bars', { n: 14, x: [0.18, 0.88], w: 0.4, c: '#10373d', y: [0, 0.6], slant: 0.25, a: 0.85 }], ['fade', { c: '#ffffff', a: 0.25, y: [0.55, 1] }]] },
  bream: { belly: '#c9c9c3', tail: 'fork', tailH: 0.2, head: 0.6, dorsal: [[0.64, 0], [0.62, 1], [0.46, 1.2], [0.3, 0.6], [0.28, 0]], dh: 0.09, anal: [[0.46, 0], [0.4, 1], [0.3, 0]], bellyK: 1.1,
    paint: [['bars', { n: 7, x: [0.3, 0.82], w: 0.22, c: '#23262b', y: [0, 0.8], a: 0.45 }], ['dots', { y: 0.32, n: 18, r: 1.4, c: '#d8dadd', x: [0.2, 0.85], a: 0.5 }]] },
  flounder: { flat: true, belly: '#e8e2cf', tail: 'round', tailH: 0.14, ped: 0.5, head: 0.66, pointy: 0.1, dorsal: 'rim', pect: 0.5, eyeFlat: true,
    paint: [['spots', { n: 34, c: '#4e3a1e', r: [2, 5], y: [0.05, 0.95], x: [0.1, 0.95], a: 0.7, seed: 4 }], ['spots', { n: 14, c: '#c9b07a', r: [3, 6], y: [0.05, 0.95], x: [0.1, 0.95], a: 0.6, seed: 9 }]] },
  grouper: { belly: '#c99a6c', tail: 'round', tailH: 0.2, head: 0.56, pointy: 0.1, dorsal: [[0.6, 0], [0.57, 0.9], [0.3, 1], [0.12, 0.9], [0.1, 0]], dh: 0.085, anal: [[0.28, 0], [0.2, 1], [0.12, 0]], bellyK: 1.1, pect: 1.1,
    paint: [['spots', { n: 52, c: '#4c2813', r: [2, 6], y: [0, 0.9], x: [0.1, 0.95], a: 0.75, seed: 3 }], ['bars', { n: 5, x: [0.25, 0.8], w: 0.25, c: '#6b3b1d', y: [0, 0.7], a: 0.3 }]] },
  eel: { tube: true, head: 0.86, belly: '#d6d18c', tail: 'none', dorsal: [[0.1, 0], [0.2, 1], [0.8, 1], [0.9, 0]], dh: 0.035, anal: [[0.2, 0], [0.3, 1], [0.85, 1], [0.9, 0]], pect: 0.5, ped: 0.45, eye: 0.7,
    paint: [['spots', { n: 40, c: '#2b2a12', r: [2, 4], y: [0, 0.6], x: [0.05, 0.95], a: 0.55, seed: 5 }]] },
  mullet: { belly: '#eef0f0', tail: 'emarg', tailH: 0.17, head: 0.68, pointy: 0.02, snout: 0.04, mouth: 0.035, ring: '#e6d79c', eye: 0.9, dorsal: [[0.58, 0], [0.55, 1], [0.5, 0]], dh: 0.07, pect: 0.7,
    extra: [{ pts: [[0.24, 0], [0.2, 0.8], [0.13, 0]], on: 'dorsal', k: 0.065 }],
    paint: [['stripe', { y: 0.2, t: 0.04, c: '#4d5961', x: [0.15, 0.9], a: 0.5 }], ['stripe', { y: 0.32, t: 0.04, c: '#4d5961', x: [0.15, 0.9], a: 0.45 }], ['stripe', { y: 0.44, t: 0.04, c: '#4d5961', x: [0.15, 0.9], a: 0.4 }], ['spots', { n: 1, c: '#283642', r: [5, 5], x: [0.63, 0.63], y: [0.6, 0.6], a: 0.7 }]] },
  snapper: { belly: '#f4d2c8', fin: '#c9362a', tail: 'fork', tailH: 0.22, head: 0.58, dorsal: [[0.62, 0], [0.6, 1], [0.34, 1.1], [0.24, 0]], dh: 0.08, bellyK: 1.08, pect: 1, ring: '#f3c24a',
    paint: [['fade', { c: '#ffffff', a: 0.3, y: [0.55, 1] }], ['dots', { y: 0.34, n: 16, r: 1.4, c: '#f4a59a', x: [0.18, 0.85], a: 0.5 }]] },
  puffer: { round: true, belly: '#f2ebd0', tail: 'round', tailH: 0.1, ped: 0.5, head: 0.7, pointy: 0.2, dorsal: [[0.3, 0], [0.26, 1], [0.2, 0]], dh: 0.05, anal: [[0.3, 0], [0.26, 1], [0.2, 0]], pect: 0.9, eye: 1.5, spines: true,
    paint: [['spots', { n: 34, c: '#3b2f1c', r: [2, 5], y: [0, 0.7], x: [0.1, 0.95], a: 0.7, seed: 11 }], ['bars', { n: 4, x: [0.3, 0.8], w: 0.35, c: '#5a4528', y: [0, 0.6], a: 0.4 }]] },
  stonebream: { belly: '#e8e6e0', tail: 'fork', head: 0.6, dorsal: [[0.64, 0], [0.62, 1], [0.35, 1], [0.28, 0]], dh: 0.09, anal: [[0.46, 0], [0.4, 1], [0.3, 0]], bellyK: 1.1, pect: 0.9, fin: '#2e3138',
    paint: [['bars', { n: 7, x: [0.22, 0.86], w: 0.5, c: '#17181b', y: [0, 1], a: 0.92 }]] },
  pomfret: { disc: true, belly: '#f0f4f6', tail: 'fork', tailH: 0.18, ped: 0.12, head: 0.7, pointy: 0.3, dorsal: [[0.55, 0], [0.5, 1.6], [0.4, 0.6], [0.34, 0]], dh: 0.11, anal: [[0.55, 0], [0.5, 1.6], [0.4, 0.6], [0.34, 0]], pect: 0.7, bellyK: 1,
    paint: [['dots', { y: 0.35, n: 22, r: 1.2, c: '#ffffff', x: [0.2, 0.85], a: 0.4 }], ['fade', { c: '#ffffff', a: 0.25, y: [0.3, 1] }]] },
  seabass: { belly: '#eef0ee', tail: 'trunc', tailH: 0.2, head: 0.6, dorsal: [[0.62, 0], [0.6, 1], [0.46, 0.9], [0.44, 0.2], [0.4, 0.8], [0.22, 0.7], [0.2, 0]], dh: 0.07, pect: 0.9,
    paint: [['spots', { n: 34, c: '#2e3a40', r: [1.6, 3.2], y: [0, 0.55], x: [0.15, 0.9], a: 0.7, seed: 6 }]] },
  amberjack: { belly: '#eef0e4', fin: '#7d8f54', tail: 'fork', tailH: 0.2, dorsal: [[0.6, 0], [0.57, 1], [0.48, 0.5], [0.46, 0.2], [0.15, 0.4], [0.1, 0]], dh: 0.07, pect: 0.8,
    paint: [['stripe', { y: 0.38, t: 0.12, c: '#e7c447', x: [0.05, 0.95], a: 0.9 }], ['stripe', { y: 0.12, t: 0.1, c: '#3e5642', x: [0.05, 0.95], a: 0.45 }]] },
  grouperGiant: { belly: '#b28a62', tail: 'round', tailH: 0.2, head: 0.54, pointy: 0.05, dorsal: [[0.6, 0], [0.58, 0.9], [0.3, 1], [0.12, 0.9], [0.1, 0]], dh: 0.075, anal: [[0.28, 0], [0.2, 1], [0.12, 0]], bellyK: 1.12, pect: 1.2, eye: 0.9,
    paint: [['spots', { n: 60, c: '#2d1a0e', r: [2, 7], y: [0, 0.95], x: [0.08, 0.95], a: 0.8, seed: 13 }], ['bars', { n: 5, x: [0.2, 0.8], w: 0.3, c: '#4d2e1a', y: [0, 0.8], a: 0.3 }]] },
  mahi: { belly: '#f2e9a6', tail: 'fork', tailH: 0.24, head: 0.62, pointy: 0.0, forehead: 0.22, dorsal: [[0.78, 0], [0.74, 1], [0.3, 1], [0.1, 0.6], [0.08, 0]], dh: 0.08, anal: [[0.45, 0], [0.4, 1], [0.12, 0]], pect: 0.9, fin: '#3d8fb3',
    paint: [['fade', { c: '#f4d94a', a: 0.7, y: [0.45, 1] }], ['spots', { n: 40, c: '#4fd0e8', r: [1.5, 3], y: [0, 0.6], x: [0.1, 0.95], a: 0.7, seed: 8 }], ['spots', { n: 20, c: '#e8b830', r: [1.5, 3], y: [0.5, 1], x: [0.1, 0.95], a: 0.6, seed: 2 }]] },
  clown: { belly: '#ee7a14', fin: '#f08a1e', tail: 'round', tailH: 0.17, head: 0.6, pointy: 0.1, dorsal: [[0.58, 0], [0.5, 1], [0.3, 0.9], [0.18, 0]], dh: 0.1, anal: [[0.4, 0], [0.34, 1], [0.2, 0]], pect: 1, eye: 1.2, bellyK: 1,
    paint: [['bars', { n: 1, x: [0.62, 0.7], w: 1, c: '#000000', y: [0, 1], a: 1 }], ['bars', { n: 1, x: [0.64, 0.68], w: 1, c: '#ffffff', y: [0, 1], a: 1 }], ['bars', { n: 1, x: [0.36, 0.44], w: 1, c: '#000000', y: [0, 1], a: 1 }], ['bars', { n: 1, x: [0.38, 0.42], w: 1, c: '#ffffff', y: [0, 1], a: 1 }], ['bars', { n: 1, x: [0.04, 0.08], w: 1, c: '#000000', y: [0, 1], a: 1 }], ['bars', { n: 1, x: [0.05, 0.07], w: 1, c: '#ffffff', y: [0, 1], a: 1 }]] },
  wreckEel: { tube: true, belly: '#9c9877', tail: 'none', dorsal: [[0.08, 0], [0.18, 1], [0.8, 1], [0.92, 0]], dh: 0.05, anal: [[0.2, 0], [0.3, 1], [0.85, 1], [0.92, 0]], pect: 0.7, ped: 0.4, eye: 0.8, head: 0.8,
    paint: [['spots', { n: 70, c: '#241f0e', r: [2, 7], y: [0, 0.8], x: [0.05, 0.95], a: 0.7, seed: 21 }], ['spots', { n: 30, c: '#d9d28a', r: [2, 4], y: [0, 0.6], x: [0.05, 0.95], a: 0.4, seed: 22 }]] },
  lanternfish: { belly: '#6b8bb0', tail: 'fork', tailH: 0.15, head: 0.55, pointy: 0.1, dorsal: [[0.55, 0], [0.5, 1], [0.4, 0]], dh: 0.06, pect: 0.7, eye: 1.5, ring: '#9fe8ff',
    paint: [['dots', { y: 0.7, n: 14, r: 2.2, c: '#bff6ff', x: [0.15, 0.85], a: 1 }], ['dots', { y: 0.86, n: 10, r: 1.8, c: '#bff6ff', x: [0.25, 0.8], a: 1 }]] },
  bonito: { belly: '#e9eef2', tail: 'lunate', tailH: 0.24, ped: 0.1, head: 0.62, dorsal: [[0.6, 0], [0.57, 1], [0.46, 0.8], [0.44, 0]], dh: 0.07, pect: 0.7,
    extra: [{ pts: [[0.3, 0], [0.27, 0.6], [0.2, 0]], on: 'dorsal', k: 0.07 }],
    paint: [['stripe', { y: 0.55, t: 0.05, c: '#27384e', x: [0.2, 0.9], a: 0.8 }], ['stripe', { y: 0.7, t: 0.05, c: '#27384e', x: [0.2, 0.9], a: 0.8 }], ['stripe', { y: 0.85, t: 0.05, c: '#27384e', x: [0.2, 0.9], a: 0.8 }], ['bars', { n: 9, x: [0.25, 0.9], w: 0.3, c: '#0e1c36', y: [0, 0.4], slant: 0.3, a: 0.7 }]] },
  tuna: { belly: '#e4eaf0', tail: 'lunate', tailH: 0.28, ped: 0.08, head: 0.6, dorsal: [[0.62, 0], [0.58, 1], [0.44, 0.8], [0.42, 0]], dh: 0.08, pect: 0.8, fin: '#223a73',
    extra: [{ pts: [[0.34, 0], [0.31, 0.6], [0.2, 0]], on: 'dorsal', k: 0.07, c: '#e8c53a' }, { pts: [[0.34, 0], [0.31, 0.6], [0.2, 0]], on: 'anal', k: 0.07, c: '#e8c53a' }],
    paint: [['stripe', { y: 0.58, t: 0.03, c: '#9fb4d8', x: [0.2, 0.9], a: 0.7 }], ['fade', { c: '#ffffff', a: 0.3, y: [0.6, 1] }]] },
  flyingfish: { belly: '#eef4f6', tail: 'fork', tailH: 0.26, lowerLobe: 1.4, dorsal: [[0.3, 0], [0.26, 1], [0.2, 0]], dh: 0.06, pect: 3.4, pectFin: '#8fc2e0', paint: [['fade', { c: '#ffffff', a: 0.3, y: [0.55, 1] }]] },
  saury: { belly: '#eef0f2', tail: 'fork', tailH: 0.12, ped: 0.1, head: 0.7, pointy: 0.9, snout: 0, mouth: 0.12, mouthV: 0.5, dorsal: [[0.3, 0], [0.27, 1], [0.21, 0]], dh: 0.05, pect: 0.5,
    anal: [[0.32, 0], [0.29, 1], [0.21, 0]], finlets: 5,
    paint: [['fade', { c: '#1e3d70', a: 0.85, y: [0.42, 0] }], ['stripe', { y: 0.42, t: 0.05, c: '#a8b9c4', x: [0.2, 0.9], a: 0.7 }], ['bars', { n: 1, x: [0.96, 1], w: 1, c: '#e8b62a', y: [0, 1], a: 0.95 }]] },
  spanish: { belly: '#eef1f3', tail: 'lunate', tailH: 0.2, head: 0.6, dorsal: [[0.62, 0], [0.58, 1], [0.44, 0.9], [0.42, 0]], dh: 0.07, pect: 0.8, pointy: 0.55,
    extra: [{ pts: [[0.28, 0], [0.25, 0.6], [0.18, 0]], on: 'dorsal', k: 0.07 }],
    paint: [['spots', { n: 36, c: '#3a4a54', r: [1.4, 3], y: [0.05, 0.6], x: [0.2, 0.95], a: 0.7, seed: 14 }]] },
  yellowfin: { belly: '#e6ecf1', tail: 'lunate', tailH: 0.27, ped: 0.08, dorsal: [[0.6, 0], [0.52, 1.4], [0.2, 0.9], [0.15, 0]], dh: 0.09, anal: [[0.45, 0], [0.38, 1.2], [0.15, 0.8], [0.12, 0]], pect: 1, fin: '#e8c53a',
    paint: [['stripe', { y: 0.45, t: 0.05, c: '#f0d24a', x: [0.2, 0.9], a: 0.9 }], ['fade', { c: '#ffffff', a: 0.3, y: [0.6, 1] }]] },
  sunfish: { disc: true, sunfish: true, snout: 0.05, belly: '#d5dadd', tail: 'clavus', head: 0.74, pointy: 0.05, ped: 0.5, dorsal: [[0.4, 0], [0.1, 3.2], [0.02, 0]], dh: 0.12, anal: [[0.4, 0], [0.1, 3.0], [0.02, 0]], pect: 0.5, eye: 1.2, bellyK: 1,
    paint: [['spots', { n: 40, c: '#6d777d', r: [3, 7], y: [0, 0.9], x: [0.05, 0.95], a: 0.35, seed: 31 }]] },
  shark: { belly: '#f1f3f4', tail: 'shark', tailH: 0.3, ped: 0.1, head: 0.7, pointy: 0.85, dorsal: [[0.56, 0], [0.5, 1.9], [0.38, 0]], dh: 0.1, anal: [[0.2, 0], [0.17, 0.7], [0.1, 0]], pect: 1.9, eye: 0.6, eyeColor: '#05080a', fin: '#5d6b77', bellyAt: 0.45, gills: true, snout: 0,
    extra: [{ pts: [[0.2, 0], [0.17, 0.7], [0.1, 0]], on: 'dorsal', k: 0.05 }],
    paint: [['fade', { c: '#ffffff', a: 0.4, y: [0.5, 1] }]] },
  oarfish: { tube: true, belly: '#e4eaee', fin: '#d8352f', tail: 'none', ped: 0.5, head: 0.88, pointy: 0.4, dorsal: [[0.1, 0], [0.18, 1.2], [0.85, 1], [0.92, 2.4], [0.96, 0]], dh: 0.045, pect: 0.5, eye: 1.5,
    paint: [['spots', { n: 36, c: '#4d5a66', r: [2, 4], y: [0, 0.7], x: [0.05, 0.95], a: 0.45, seed: 41 }], ['stripe', { y: 0.2, t: 0.03, c: '#ffffff', a: 0.6 }]] },
  hairtail: { tube: true, belly: '#e6ecf4', fin: '#bcc6d4', tail: 'none', ped: 0.02, taper: 0.62, whip: 1.6, head: 0.88, pointy: 0.9, snout: 0, mouth: 0.08, ring: '#e8e2b0', dorsal: [[0.1, 0], [0.16, 1], [0.9, 1], [0.94, 0]], dh: 0.03, pect: 0.4, eye: 0.9,
    paint: [['fade', { c: '#ffffff', a: 0.4, y: [0, 1] }], ['stripe', { y: 0.2, t: 0.08, c: '#ffffff', a: 0.4 }]] },
  swordfish: { belly: '#d4dce8', tail: 'lunate', tailH: 0.26, ped: 0.07, head: 0.62, pointy: 0.9, bill: 0.36, snout: 0.06, dorsal: [[0.64, 0], [0.62, 1.8], [0.3, 1.1], [0.26, 0]], dh: 0.1, anal: [[0.3, 0], [0.26, 0.8], [0.18, 0]], pect: 1.2, fin: '#1e2e5c', eye: 1.3,
    paint: [['fade', { c: '#ffffff', a: 0.35, y: [0.55, 1] }]] },
  moonfish: { belly: '#d8f6ff', fin: '#a8ecff', tail: 'fork', tailH: 0.2, head: 0.62, dorsal: [[0.6, 0], [0.54, 1.2], [0.28, 0.8], [0.22, 0]], dh: 0.09, anal: [[0.5, 0], [0.44, 1], [0.26, 0]], pect: 1, eye: 1.2, ring: '#ffffff', glow: true,
    paint: [['dots', { y: 0.35, n: 22, r: 1.6, c: '#ffffff', x: [0.15, 0.88], a: 0.8 }], ['fade', { c: '#ffffff', a: 0.4, y: [0.4, 1] }]] },
  glassfish: { belly: '#c0b8ff', fin: '#8f9fff', tail: 'fork', tailH: 0.2, head: 0.6, dorsal: [[0.58, 0], [0.54, 1.1], [0.28, 0.8], [0.22, 0]], dh: 0.09, anal: [[0.48, 0], [0.42, 1], [0.26, 0]], pect: 1, eye: 1.2, glow: true,
    paint: [['fade', { c: '#ffffff', a: 0.4, y: [0.4, 1] }], ['bars', { n: 5, x: [0.25, 0.8], w: 0.2, c: '#2f3fd0', y: [0, 0.8], a: 0.3 }]] },
  trout: { belly: '#f5e8a0', fin: '#e8a020', tail: 'trunc', tailH: 0.17, head: 0.62, dorsal: [[0.56, 0], [0.52, 1], [0.42, 0.9], [0.4, 0]], dh: 0.07, pect: 0.9,
    extra: [{ pts: [[0.2, 0], [0.18, 0.6], [0.12, 0]], on: 'dorsal', k: 0.05 }],
    paint: [['stripe', { y: 0.36, t: 0.08, c: '#e86a4a', x: [0.15, 0.9], a: 0.6 }], ['spots', { n: 38, c: '#3a2a10', r: [1, 2.6], y: [0, 0.5], x: [0.15, 0.95], a: 0.7, seed: 51 }]] },
  ayu: { belly: '#f1f0d8', tail: 'fork', tailH: 0.16, head: 0.6, dorsal: [[0.55, 0], [0.5, 1], [0.4, 0]], dh: 0.06, pect: 0.9,
    extra: [{ pts: [[0.2, 0], [0.18, 0.5], [0.12, 0]], on: 'dorsal', k: 0.045 }],
    paint: [['bars', { n: 1, x: [0.5, 0.62], w: 1, c: '#f4d848', y: [0.1, 0.6], a: 0.95 }], ['stripe', { y: 0.35, t: 0.05, c: '#d9e08c', x: [0.15, 0.9], a: 0.5 }]] },
  octopus: { model: 'octopus' },
  squid: { model: 'squid' },
  glowsquid: { model: 'squid', glow: true },
};

// ---- 質感與動作（跟長相分開寫）----
// shine 光澤：0 霧面（石斑、鰻）～ 2.5 很亮的銀（白帶魚）；spiny 背鰭是硬棘（棘跟棘之間的膜凹下去）
// 擺動：pivot 身體從哪裡開始擺（X 座標，越小越只有尾巴在擺，像鮪魚）、wave 波有多密（越大越像蛇那樣扭）、flex 擺幅倍數
const FEEL = {
  sardine: { shine: 2.2 }, mackerel: { shine: 2 }, mullet: { shine: 1.4 }, bream: { shine: 1.2, spiny: true, flex: 0.75 }, flounder: { shine: 0.3 },
  grouper: { shine: 0.4, spiny: true, flex: 0.85 }, eel: { shine: 0.8 }, snapper: { shine: 1.4, spiny: true, flex: 0.8 }, puffer: { shine: 0.3, flex: 0.45, pivot: -0.12 },
  stonebream: { shine: 1, spiny: true, flex: 0.75 }, pomfret: { shine: 2.3, flex: 0.6 }, seabass: { shine: 1.6, spiny: true }, amberjack: { shine: 1.8, pivot: 0.02 },
  grouperGiant: { shine: 0.4, spiny: true, flex: 0.7 }, mahi: { shine: 1.6 }, clown: { shine: 1, spiny: true, flex: 0.8 }, wreckEel: { shine: 0.6 },
  lanternfish: { shine: 1.6 }, bonito: { shine: 2.2, pivot: -0.08 }, tuna: { shine: 2.2, pivot: -0.08 }, flyingfish: { shine: 2.2 },
  saury: { shine: 2.3 }, spanish: { shine: 2.2, pivot: 0 }, yellowfin: { shine: 2.2, pivot: -0.08 }, sunfish: { shine: 0.3, flex: 0.25, pivot: -0.2 },
  shark: { shine: 0.5, pivot: 0.02, flex: 0.8 }, oarfish: { shine: 2.2 }, hairtail: { shine: 2.6 }, swordfish: { shine: 1.4, pivot: -0.08 },
  moonfish: { shine: 1.6 }, glassfish: { shine: 1.6 }, trout: { shine: 1.3 }, ayu: { shine: 1.7 },
};

// 沒寫的欄位：snout 鼻尖比身體中線低多少（額頭往下斜、嘴在下面）、keel 肚子收窄、taper 長條魚尾巴收細的範圍（whip 收得多急）、
// sweep 背鰭臀鰭往後掃、eyeY 眼睛高度、mouth 嘴巴長度（身長的比例）、gill 畫鰓蓋、lateral 畫側線
const DEF = { belly: '#eef2f4', tail: 'fork', tailH: 0.2, head: 0.6, tailStart: 0.34, ped: 0.15, pointy: 0.35, bellyK: 1.05, dh: 0.07, pect: 1, eye: 1, forehead: 0, lowerLobe: 1, paint: [],
  snout: 0.2, keel: 0.25, taper: 0.14, whip: 1, sweep: 0.45, eyeY: 0.32, mouth: 0.065, gill: true, lateral: true, shine: 1, flex: 1, pivot: 0.12, wave: 4.5 };
const TUBE = { snout: 0.05, gill: false, lateral: false, pivot: 0.36, wave: 11 };   // 鰻、皇帶魚、白帶魚：整條像蛇那樣扭
const V3 = THREE.Vector3;

// ---- 貼圖：身體一圈攤平（橫向是從尾到頭，縱向是從背到肚子，再鏡射到另一側）----
const texCache = new Map();
function paintTexture(id, L, back, hh, ww) {
  if (texCache.has(id)) return texCache.get(id);
  const W = 512, H = 256, half = H / 2, S = W / 256;   // S：花紋表裡的像素數字是照 256 寬寫的
  // 貼圖一格在身上橫的、直的各多長不一樣（越胖的魚直的越長）：斑點照這個比例壓扁，貼上去才是圓的
  const ak = Math.sqrt(clamp((Math.PI * (hh + ww) / 2 / half) / ((X1 - X0) / W), 0.8, 6)), ax = ak * 1.1, ay = 1.1 / ak;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const hc = document.createElement('canvas'); hc.width = W; hc.height = half;
  const h = hc.getContext('2d');
  const bellyAt = L.bellyAt ?? 0.55;
  // 底色：背 → 肚子
  const grad = h.createLinearGradient(0, 0, 0, half);
  grad.addColorStop(0, shade(back, 0.82)); grad.addColorStop(Math.max(0.05, bellyAt - 0.22), hex(back));
  grad.addColorStop(bellyAt + 0.12, L.belly); grad.addColorStop(1, shade(L.belly, 1.02));
  h.fillStyle = grad; h.fillRect(0, 0, W, half);
  if (!L.noScales) {   // 魚鱗：一排排淡淡的弧
    h.strokeStyle = 'rgba(255,255,255,0.08)'; h.lineWidth = S;
    const sw = 9 * S;
    for (let row = 0, y = 4 * S; y < half; row++, y += sw * 0.55) for (let x = (row % 2) * sw / 2; x < W; x += sw) { h.beginPath(); h.arc(x, y, sw * 0.55, Math.PI * 0.15, Math.PI * 0.85); h.stroke(); }
    h.strokeStyle = 'rgba(0,0,0,0.07)';
    for (let row = 0, y = 7 * S; y < half; row++, y += sw * 0.55) for (let x = (row % 2) * sw / 2 + 2 * S; x < W; x += sw) { h.beginPath(); h.arc(x, y, sw * 0.55, Math.PI * 0.2, Math.PI * 0.8); h.stroke(); }
  }
  const px = (u) => u * W, py = (v) => v * half;
  const hsh = (seed) => rng(seed * 977 + 13);
  for (const [kind, o] of L.paint) {
    h.globalAlpha = o.a ?? 1;
    const c = o.c ?? '#000';
    if (kind === 'bars') {
      const [x0, x1] = o.x, [y0, y1] = o.y ?? [0, 1], cell = (x1 - x0) / o.n, w = cell * (o.w ?? 0.5), sl = (o.slant ?? 0) * 0.04;
      for (let i = 0; i < o.n; i++) {
        const cx = x0 + (i + 0.5) * cell;
        for (const [grow, al] of [[1.5, 0.45], [1, 1]]) {
          h.globalAlpha = (o.a ?? 1) * al; h.fillStyle = c;
          const ww = w * grow / 2;
          h.beginPath();
          h.moveTo(px(cx - ww), py(y0)); h.lineTo(px(cx + ww), py(y0)); h.lineTo(px(cx + ww + sl), py(y1)); h.lineTo(px(cx - ww + sl), py(y1)); h.closePath(); h.fill();
        }
      }
    } else if (kind === 'spots') {
      const r = hsh(o.seed ?? 1), [x0, x1] = o.x ?? [0, 1], [y0, y1] = o.y ?? [0, 1];
      for (let i = 0; i < o.n; i++) {
        const rad = (o.r[0] + r() * (o.r[1] - o.r[0])) * S;
        h.fillStyle = c; h.beginPath(); h.ellipse(px(x0 + r() * (x1 - x0)), py(y0 + r() * (y1 - y0)), rad * ax, rad * ay, 0, 0, TAU); h.fill();
      }
    } else if (kind === 'stripe') {
      const [x0, x1] = o.x ?? [0, 1], t = o.t * half;
      for (const [grow, al] of [[2, 0.4], [1, 1]]) {
        h.globalAlpha = (o.a ?? 1) * al; h.fillStyle = c; h.fillRect(px(x0), py(o.y) - t * grow / 2, px(x1 - x0), t * grow);
      }
    } else if (kind === 'dots') {
      const [x0, x1] = o.x ?? [0, 1];
      h.fillStyle = c;
      for (let i = 0; i < o.n; i++) { h.beginPath(); h.ellipse(px(x0 + (i + 0.5) / o.n * (x1 - x0)), py(o.y), o.r * S * ax, o.r * S * ay, 0, 0, TAU); h.fill(); }
    } else if (kind === 'fade') {
      const [y0, y1] = o.y ?? [0, 1], gg = h.createLinearGradient(0, py(y0), 0, py(y1));
      gg.addColorStop(0, 'rgba(255,255,255,0)'); gg.addColorStop(1, c);
      h.globalAlpha = o.a ?? 1; h.fillStyle = gg; h.fillRect(0, py(y0), W, py(y1 - y0));
    }
    h.globalAlpha = 1;
  }
  const dark = shade(back, 0.3);
  // 側線：從鰓蓋後面沿著身體側邊一條細線，前面拱起來
  if (L.lateral) {
    const line = (dy, col, a) => {
      h.globalAlpha = a; h.strokeStyle = col; h.lineWidth = 1.2 * S; h.beginPath();
      for (let k = 0; k <= 24; k++) { const u = 0.04 + (L.head - 0.08) * k / 24, v = 0.42 - 0.12 * Math.sin(Math.min(1, k / 24 * 1.4) * Math.PI / 2); k ? h.lineTo(px(u), py(v) + dy) : h.moveTo(px(u), py(v) + dy); }
      h.stroke();
    };
    line(0, dark, 0.22); line(1.4 * S, '#ffffff', 0.16);
    h.globalAlpha = 1;
  }
  // 鰓蓋：頭跟身體交界一道往後拱的弧（後面一圈陰影、前面一道亮邊，看起來是一片蓋子）
  if (L.gill && !L.gills) {
    const ug = L.head - 0.012, bow = 0.03 + 0.02 * (1 - L.head);
    const arc = (dx, col, a, wdt) => {
      h.globalAlpha = a; h.strokeStyle = col; h.lineWidth = wdt; h.beginPath();
      for (let k = 0; k <= 20; k++) { const v = 0.12 + 0.76 * k / 20, u = ug - bow * Math.sin(Math.PI * (v - 0.12) / 0.76); k ? h.lineTo(px(u) + dx, py(v)) : h.moveTo(px(u) + dx, py(v)); }
      h.stroke();
    };
    arc(-3 * S, '#000000', 0.12, 5 * S); arc(0, dark, 0.6, 1.6 * S); arc(1.6 * S, '#ffffff', 0.22, 1.2 * S);
    h.globalAlpha = 1;
  }
  // 鯊魚：五條鰓裂
  if (L.gills) {
    h.strokeStyle = dark; h.globalAlpha = 0.75; h.lineWidth = 1.6 * S;
    for (let i = 0; i < 5; i++) { const u = L.head - 0.03 - i * 0.022; h.beginPath(); h.moveTo(px(u), py(0.3)); h.quadraticCurveTo(px(u - 0.008), py(0.47), px(u), py(0.64)); h.stroke(); }
    h.globalAlpha = 1;
  }
  // 嘴：鼻尖往後一條嘴縫，嘴角往下彎；鼻頭稍微深一點
  if (!L.bill && !L.sunfish) {
    const sn = h.createLinearGradient(px(0.93), 0, W, 0);
    sn.addColorStop(0, 'rgba(0,0,0,0)'); sn.addColorStop(1, 'rgba(0,0,0,0.18)');
    h.fillStyle = sn; h.fillRect(px(0.93), 0, W, half);
    const u0 = 1 - L.mouth, vm = L.mouthV ?? 0.56;
    h.strokeStyle = dark; h.globalAlpha = 0.85; h.lineWidth = 2.2 * S; h.lineCap = 'round';
    h.beginPath(); h.moveTo(W, py(vm)); h.quadraticCurveTo(px(1 - L.mouth * 0.5), py(vm + 0.01), px(u0), py(vm + 0.07)); h.stroke();
    h.strokeStyle = '#ffffff'; h.globalAlpha = 0.25; h.lineWidth = 1.2 * S;
    h.beginPath(); h.moveTo(W, py(vm) + 2.4 * S); h.quadraticCurveTo(px(1 - L.mouth * 0.5), py(vm + 0.01) + 2.4 * S, px(u0), py(vm + 0.07) + 2.4 * S); h.stroke();
    h.globalAlpha = 1;
  }
  // 上半貼圖 = 背到肚子（+Z 側）；下半是鏡射（-Z 側）。比目魚兩面不一樣：下面那一面是白的
  g.drawImage(hc, 0, 0);
  g.save(); g.translate(0, H); g.scale(1, -1);
  if (L.flat) { g.fillStyle = L.belly; g.fillRect(0, 0, W, half); } else g.drawImage(hc, 0, 0);
  g.restore();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  texCache.set(id, tex);
  return tex;
}

// ---- 身體的形狀 ----
// profile：身體在 t（0 尾端～1 鼻尖）的粗細倍數
function profile(t, L) {
  let m;
  if (t >= L.head) { const u = (t - L.head) / (1 - L.head); m = Math.pow(Math.max(0, 1 - u * u), 0.5 + 0.5 * L.pointy); if (L.forehead) m *= 1 + L.forehead * (1 - u); }
  else if (L.tube) { const tp = L.taper ?? 0.14; m = t < tp ? L.ped + (1 - L.ped) * Math.pow(smooth(t / tp), L.whip ?? 1) : 1; }
  else if (t > L.tailStart) m = 1 + 0.06 * Math.sin((t - L.tailStart) / (L.head - L.tailStart) * Math.PI);
  else m = L.ped + (1 - L.ped) * smooth(t / L.tailStart);
  return m;
}
const xAt = (t) => X0 + t * (X1 - X0);
// 頭那一段的中線往下壓：額頭往下斜、鼻尖跟嘴巴比身體中線低
const cOff = (t, L, hh) => (t > L.head ? -hh * (L.snout ?? 0) * Math.pow((t - L.head) / (1 - L.head), 1.6) : 0);
// 身體表面上的一點：t 前後位置、th 繞一圈的角度（0 背、π/2 是 +Z 那一側、π 肚子）
function surf(L, hh, ww, t, th, out = new V3()) {
  const m = profile(t, L), cy = Math.cos(th), sz = Math.sin(th);
  const k = cy < 0 ? 1 - (L.keel ?? 0) * cy * cy : 1 - 0.12 * cy * cy;   // 截面上寬下窄，像水滴
  return out.set(xAt(t), cOff(t, L, hh) + cy * (cy < 0 ? L.bellyK : 1) * hh * m, sz * ww * m * k);
}
// 那一點往外的方向
const _sa = new V3(), _sb = new V3(), _sc = new V3();
function surfNormal(L, hh, ww, t, th, out = new V3()) {
  const e = 1e-3;
  surf(L, hh, ww, Math.min(1, t + e), th, _sa).sub(surf(L, hh, ww, Math.max(0, t - e), th, _sb));
  surf(L, hh, ww, t, th + e, _sb).sub(surf(L, hh, ww, t, th - e, _sc));
  out.crossVectors(_sa, _sb).normalize();
  const p = surf(L, hh, ww, t, th, _sc);
  if (out.y * (p.y - cOff(t, L, hh)) + out.z * p.z < 0) out.negate();
  return out;
}

function bodyGeometry(L, hh, ww) {
  const NS = 48, NR = 24, pos = [], uv = [], idx = [], p = new V3();
  for (let i = 0; i <= NS; i++) {
    const t = i / NS;
    for (let j = 0; j <= NR; j++) {
      surf(L, hh, ww, t, j / NR * TAU, p);
      pos.push(p.x, p.y, p.z);
      uv.push(t, 1 - j / NR);
    }
  }
  const row = NR + 1;
  for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) {
    const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // 接縫（背中線）兩邊的法線平均，不然會多一條亮暗線
  const n = geo.attributes.normal;
  for (let i = 0; i <= NS; i++) {
    const a = i * row, b = a + NR;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  }
  // 尾端封口（尾柄粗的魚像翻車魚，從後面看不會看到身體裡面）：另外一圈點，法線朝後
  const base = pos.length / 3;
  for (let j = 0; j <= NR; j++) { pos.push(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]); uv.push(0, 1 - j / NR); }
  pos.push(X0, 0, 0); uv.push(0, 0.75);
  for (let j = 0; j < NR; j++) idx.push(base + NR + 1, base + j + 1, base + j);
  const nrm = [...n.array];
  for (let j = 0; j <= NR + 1; j++) nrm.push(-1, 0, 0);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  return geo;
}

// ---- 鰭 ----
// 鰭條貼圖（全部魚共用、灰階，顏色由頂點色給）：橫向一格一根鰭條，格子中間是膜；縱向下面是根部、上面是鰭的邊，越靠邊膜越透
let finTex = null;
function finTexture() {
  if (finTex) return finTex;
  const S = 64, cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  for (let y = 0; y < S; y++) { const v = 1 - y / S; g.fillStyle = `rgba(255,255,255,${(0.95 - 0.4 * smooth(v)).toFixed(3)})`; g.fillRect(0, y, S, 1); }
  for (const [w, c] of [[9, 'rgba(205,205,205,1)'], [4, 'rgba(150,150,150,1)']]) { g.fillStyle = c; g.fillRect(0, 0, w, S); g.fillRect(S - w, 0, w, S); }
  finTex = new THREE.CanvasTexture(cv);
  finTex.wrapS = THREE.RepeatWrapping;
  finTex.colorSpace = THREE.SRGBColorSpace;
  return finTex;
}

// 所有的鰭都是一條條「根部 → 邊緣」的帶子：每根鰭條一條，鰭條之間的膜一高一低（有起伏，不是一張平紙）
function finsGeometry(L, hh, ww, finC, tipC) {
  const P = [], UV = [], C = [], F = [], I = [];
  const cb0 = new THREE.Color(finC), ct0 = new THREE.Color(tipC), c = new THREE.Color();
  const push = (p, u, v, k, flap, cb, ct) => { P.push(p.x, p.y, p.z); UV.push(u, v); c.copy(cb).lerp(ct, clamp(k, 0, 1)); C.push(c.r, c.g, c.b); F.push(flap); return P.length / 3 - 1; };
  const strip = (roots, tips, us, ks, flaps, cb = cb0, ct = ct0) => {
    let prev = null;
    for (let i = 0; i < roots.length; i++) {
      const a = push(roots[i], us[i], 0, 0, 0, cb, ct), b = push(tips[i], us[i], 1, ks[i], flaps ? flaps[i] : 0, cb, ct);
      if (prev) I.push(prev[0], a, prev[1], prev[1], a, b);
      prev = [a, b];
    }
  };
  const edgeY = (t, sign) => cOff(t, L, hh) + sign * hh * profile(t, L) * (sign < 0 ? L.bellyK : 1);
  // 背鰭、臀鰭：沿著身體上緣（或下緣）；spec：[[位置, 高度倍數], …]
  const ridge = (spec, dh, sign, col) => {
    const tA = spec[0][0], tB = spec[spec.length - 1][0];
    const kAt = (t) => {
      for (let i = 0; i < spec.length - 1; i++) {
        const [ta, ka] = spec[i], [tb, kb] = spec[i + 1];
        if (t >= Math.min(ta, tb) - 1e-6 && t <= Math.max(ta, tb) + 1e-6) return ta === tb ? Math.max(ka, kb) : ka + (kb - ka) * (t - ta) / (tb - ta);
      }
      return 0;
    };
    const rays = Math.max(3, Math.round(Math.abs(tA - tB) * (X1 - X0) / 0.022)), N = rays * 2;
    const roots = [], tips = [], us = [], ks = [];
    for (let i = 0; i <= N; i++) {
      const t = tA + (tB - tA) * i / N;
      let k = kAt(t);
      if (L.spiny && sign > 0 && i % 2) k *= 0.8;   // 硬棘：棘跟棘之間的膜凹下去
      const hgt = k * dh, y = edgeY(t, sign) - sign * 0.004, x = xAt(t);
      roots.push(new V3(x, y, 0));
      tips.push(new V3(x - L.sweep * hgt, y + sign * (hgt + 0.004), (i % 2 ? 1 : -1) * Math.min(0.004, hgt * 0.12)));
      us.push(i / 2); ks.push(Math.min(1, k * 1.4));
    }
    strip(roots, tips, us, ks, null, col ? new THREE.Color(col) : cb0, col ? new THREE.Color(col).multiplyScalar(0.8) : ct0);
  };
  // 尾鰭：從尾柄那一小段直線，往外散成一圈
  const tail = () => {
    const pts = tailPts(L.tail, L, hh);
    if (!pts) return;
    const x0 = X0 + 0.01, p = L.ped * hh * 0.9, out = pts.slice(1, -1).map(([x, y, k]) => [x0 + x, y, k]);
    const seg = [0];
    for (let i = 1; i < out.length; i++) seg.push(seg[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]));
    const total = seg[seg.length - 1] || 1, N = 18, roots = [], tips = [], us = [], ks = [];
    for (let i = 0; i <= N; i++) {
      const d = total * i / N;
      let j = 0;
      while (j < out.length - 2 && seg[j + 1] < d) j++;
      const f = clamp((d - seg[j]) / ((seg[j + 1] - seg[j]) || 1), 0, 1), A = out[j], B = out[Math.min(j + 1, out.length - 1)];
      roots.push(new V3(x0 + 0.004, p * (1 - 2 * i / N), 0));
      tips.push(new V3(A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, (i % 2 ? 1 : -1) * 0.004));
      us.push(i / 2); ks.push(A[2] + (B[2] - A[2]) * f);
    }
    strip(roots, tips, us, ks);
  };
  // 胸鰭、腹鰭：從身體側邊一個點像扇子一樣張開；flapK：鰭會搧多大
  const fan = (R, D1, D2, len, rays, shape, rootW, flapK) => {
    const N = rays * 2, nrm = new V3().crossVectors(D1, D2).normalize(), span = D2.clone().sub(D1).normalize();
    const roots = [], tips = [], us = [], ks = [], flaps = [];
    for (let i = 0; i <= N; i++) {
      const s = i / N, dir = D1.clone().lerp(D2, s).normalize(), l = len * shape(s);
      const root = R.clone().addScaledVector(span, rootW * (s - 0.5));
      roots.push(root); tips.push(root.clone().addScaledVector(dir, l).addScaledVector(nrm, (i % 2 ? 1 : -1) * l * 0.03));
      us.push(i / 2); ks.push(1); flaps.push(flapK * l);
    }
    strip(roots, tips, us, ks, flaps);
  };

  if (L.dorsal && L.dorsal !== 'rim') ridge(L.dorsal, L.dh, 1);
  const anal = L.anal ?? (L.dorsal && L.dorsal !== 'rim' && !L.tube ? [[0.34, 0], [0.28, 1], [0.18, 0]] : null);
  if (anal) ridge(anal, L.dh * 0.85, -1);
  for (const e of L.extra ?? []) ridge(e.pts, e.k ?? 0.05, e.on === 'anal' ? -1 : 1, e.c);
  for (let i = 0; i < (L.finlets ?? 0); i++) {   // 小離鰭：背鰭、臀鰭後面一排小三角
    const t = 0.19 - i * 0.025;
    for (const s of [1, -1]) ridge([[t + 0.01, 0], [t, 1], [t - 0.008, 0]], 0.018, s);
  }
  if (L.dorsal === 'rim') {   // 比目魚：沿著整圈身體邊緣一圈鰭
    for (const sign of [1, -1]) ridge([[0.08, 0], [0.2, 1], [0.7, 1], [0.82, 0]], 0.04, sign);
  }
  tail();
  if (L.pect) {
    const t = L.head - 0.05, size = 0.14 * L.pect, wing = L.pect > 2;
    for (const s of [1, -1]) {
      const R = surf(L, hh, ww, t, s > 0 ? 1.95 : TAU - 1.95);
      R.z *= 0.96;
      const D1 = (wing ? new V3(-1, 0.08, s * 0.55) : new V3(-1, -0.12, s * 0.38)).normalize();
      const D2 = (wing ? new V3(-0.45, -0.12, s * 1) : new V3(-0.75, -0.55, s * 0.55)).normalize();
      fan(R, D1, D2, size * (wing ? 1.45 : 1.1), wing ? 12 : 7,
        wing ? (u) => 0.55 + 0.45 * Math.sin(Math.PI * Math.pow(u, 0.8)) : (u) => 0.72 + 0.28 * Math.sin(Math.PI * u),
        0.02 * Math.min(1.5, L.pect), wing ? 0.15 : 0.5);
      // 腹鰭：肚子下面一小片
      if (!L.tube && !wing && L.pelvic !== false) {
        const R2 = surf(L, hh, ww, L.head - 0.16, s > 0 ? 2.75 : TAU - 2.75);
        R2.z *= 0.9;
        fan(R2, new V3(-1, -0.4, s * 0.15).normalize(), new V3(-0.6, -0.8, s * 0.45).normalize(), size * 0.6, 4, (u) => 0.7 + 0.3 * Math.sin(Math.PI * u), 0.012, 0.3);
      }
    }
  }
  if (!I.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  geo.setAttribute('aFlap', new THREE.Float32BufferAttribute(F, 1));
  geo.setIndex(I);
  geo.computeVertexNormals();
  return geo;
}

// 尾鰭的輪廓：[[x, y, 尖端程度], …]，第一點和最後一點是尾柄上下兩端
function tailPts(kind, L, hh) {
  const p = L.ped * hh * 0.9, th = L.tailH, k = L.lowerLobe;
  switch (kind) {
    case 'fork': return [[0, p, 0], [-0.2, th, 1], [-0.13, 0, 0.55], [-0.2 * k, -th * k, 1], [0, -p, 0]];
    case 'emarg': return [[0, p, 0], [-0.16, th * 0.85, 1], [-0.135, 0, 0.8], [-0.16, -th * 0.85, 1], [0, -p, 0]];
    case 'lunate': return [[0, p, 0], [-0.1, th * 0.7, 0.6], [-0.24, th * 1.15, 1], [-0.15, 0, 0.7], [-0.24, -th * 1.15, 1], [-0.1, -th * 0.7, 0.6], [0, -p, 0]];
    case 'round': return [[0, p, 0], [-0.08, th * 0.9, 0.7], [-0.17, th * 0.55, 1], [-0.2, 0, 1], [-0.17, -th * 0.55, 1], [-0.08, -th * 0.9, 0.7], [0, -p, 0]];
    case 'trunc': return [[0, p, 0], [-0.17, th, 1], [-0.17, -th, 1], [0, -p, 0]];
    case 'shark': return [[0, p, 0], [-0.1, th * 0.9, 0.6], [-0.3, th * 1.2, 1], [-0.16, th * 0.1, 0.8], [-0.2, -th * 0.6, 1], [-0.04, -th * 0.5, 0.4], [0, -p, 0]];
    case 'point': return [[0, p, 0], [-0.2, 0, 1], [0, -p, 0]];
    case 'clavus': return [[0, p, 0], [-0.05, p * 0.85, 1], [-0.08, p * 0.4, 1], [-0.085, 0, 1], [-0.08, -p * 0.4, 1], [-0.05, -p * 0.85, 1], [0, -p, 0]];   // 翻車魚的舵鰭：後面一圈波浪邊
    default: return null;
  }
}

// 小卷的鰭（平的一片，根部到尖端顏色漸層）
function flatFin(pts, base, tip) {
  const P = [], C = [], cb = new THREE.Color(base), ct = new THREE.Color(tip), c = new THREE.Color();
  for (const p of pts) { P.push(p[0], p[1], p[2]); c.copy(cb).lerp(ct, p[3]); C.push(c.r, c.g, c.b); }
  const tris = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[2])), []);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  geo.setIndex(tris.flat());
  geo.computeVertexNormals();
  return geo;
}

// ---- 眼睛：一顆嵌在頭上的圓頂（眼眶、虹膜、瞳孔、亮點畫在貼圖上）----
let capGeo = null;
function eyeCap() {
  if (capGeo) return capGeo;
  const a = 1.0, geo = new THREE.SphereGeometry(1, 16, 6, 0, TAU, 0, a);
  geo.rotateX(Math.PI / 2);   // 圓頂原本朝 +Y，轉成朝 +Z
  const p = geo.attributes.position, uv = geo.attributes.uv, R = Math.sin(a);
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / R * 0.5 + 0.5, p.getY(i) / R * 0.5 + 0.5);
  geo.translate(0, 0, -Math.cos(a));   // 圓頂的底貼在 z = 0
  capGeo = geo;
  return geo;
}
const eyeMats = new Map();
function eyeMaterial(ring, pupil, glow) {
  const key = `${ring}|${pupil}|${glow ? 1 : 0}`;
  if (eyeMats.has(key)) return eyeMats.get(key);
  const S = 64, cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const g = cv.getContext('2d'), o = S / 2;
  g.fillStyle = shade(ring, 0.5); g.fillRect(0, 0, S, S);
  const ir = g.createRadialGradient(o, o, 4, o, o, S * 0.46);
  ir.addColorStop(0, mixHex(ring, '#ffffff', 0.25)); ir.addColorStop(1, shade(ring, 0.78));
  g.fillStyle = ir; g.beginPath(); g.arc(o, o, S * 0.45, 0, TAU); g.fill();
  g.fillStyle = pupil; g.beginPath(); g.arc(o, o + 1, S * 0.27, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.arc(o - 3, o - 9, S * 0.09, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(o + 6, o + 7, S * 0.045, 0, TAU); g.fill();
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshPhongMaterial({ map, specular: 0x777777, shininess: 90, ...(glow ? { emissive: new THREE.Color(ring).multiplyScalar(0.3) } : {}) });
  eyeMats.set(key, m);
  return m;
}
// ---- 省畫的次數：同一種魚、同一種材質的小零件（兩顆眼睛、河豚的刺、章魚的斑點和腳）先合成一個網格，一次畫完 ----
// make() 回傳 [幾何, 位置, 轉向, 縮放] 的清單；合好的照 key 存起來，同一種魚共用
const partCache = new Map();
const _m4 = new THREE.Matrix4();
function mergedParts(key, make) {
  let geo = partCache.get(key);
  if (!geo) {
    geo = mergeGeometries(make().map(([src, p, q, s]) => src.clone().applyMatrix4(_m4.compose(p, q, s))));
    partCache.set(key, geo);
  }
  return geo;
}
// ---- 合畫（實例化）用：每個零件標上「哪一種魚的第幾個零件」和一份大家共用、不會擺動的材質 ----
// 躺著不動的魚由 fishBatch.js 把同一種魚的同一個零件收在一起，一次畫完；special[i]：第 i 個零件的共用材質怎麼做（要擺動的身體、鰭），沒給就複製一份
const instMats = new Map();
function tagParts(g, id, special = {}) {
  g.children.forEach((c, i) => {
    const key = `${id}|${i}`;
    let m = instMats.get(key);
    if (!m) { m = special[i] ? special[i]() : c.material.clone(); instMats.set(key, m); }
    c.userData.inst = { key, mat: m };
  });
  g.userData.inst = true;
}
const Q0 = new THREE.Quaternion();
const S1 = (k = 1) => new V3(k, k, k);

function addEyes(g, L, hh, ww, t, id) {
  const r = 0.032 * L.eye, mat = eyeMaterial(L.ring ?? '#f4f4ec', L.eyeColor ?? '#0b0b0b', L.glow);
  // 一般的魚左右各一顆；比目魚兩顆都在上面那一側（+Z）。兩顆合成一個網格
  g.add(new THREE.Mesh(mergedParts(`eyes|${id}`, () => {
    const flip = new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), Math.PI);
    const spots = L.eyeFlat ? [[1, Math.acos(0.55)], [1, Math.acos(0.25)]] : [[1, Math.acos(L.eyeY)], [-1, TAU - Math.acos(L.eyeY)]];
    return spots.map(([s, th]) => {
      const p = surf(L, hh, ww, t, th), n = surfNormal(L, hh, ww, t, th);
      const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, s), n);
      if (s < 0) q.multiply(flip);
      return [eyeCap(), p.clone().addScaledVector(n, -r * 0.12), q, new V3(r, r, r * 0.75)];
    });
  }), mat));
}

// ---- 擺動：身體跟鰭的頂點在著色器裡左右彎（不另外算骨架），胸鰭上下搧；外加一圈邊緣反光 ----
function addFlex(mat, U, rim, flap) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, { uRim: { value: rim } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
uniform float uAmp, uPhase, uFlap, uPivot, uWave;${flap ? '\nattribute float aFlap;' : ''}`).replace('#include <begin_vertex>', `#include <begin_vertex>
{ float fd = max(uPivot - transformed.x, 0.0) / (uPivot + 0.46);
  transformed.z += uAmp * 0.14 * fd * fd * sin(uPhase - (uPivot - transformed.x) * uWave);${flap ? '\n  transformed.y += uFlap * aFlap * sin(uPhase * 1.6 + 1.0);' : ''} }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uRim;').replace('#include <opaque_fragment>', `{ float fr = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  vec3 amb = min(reflectedLight.indirectDiffuse / max(diffuseColor.rgb, vec3(0.15)), vec3(1.5));
  outgoingLight += uRim * amb * fr * fr * fr; }
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `fishflex${flap ? 1 : 0}`;
}

// 擺動的強度：0 不動（死魚、看板上的標本）、1 在手上掙扎、更大是在地上跳。每幀呼叫，會慢慢過渡過去
export function flexFish(mesh, effort, dt) {
  const f = mesh.userData.flex;
  if (!f) return;
  f.amp += (Math.min(1.4, effort) - f.amp) * Math.min(1, dt * 5);
  if (f.amp < 0.003) { f.U.uAmp.value = 0; f.U.uFlap.value = 0; return; }
  f.U.uPhase.value = (f.U.uPhase.value + dt * (5 + 10 * f.amp)) % (TAU * 64);
  f.U.uAmp.value = f.amp * f.k;
  f.U.uFlap.value = Math.min(1, f.amp);
}

// 身體、鰭的形狀每種魚只算一次（大小靠整組縮放）
const geoCache = new Map();
function build(sp, len) {
  const id = sp.id;
  const L0 = LOOKS[id] ?? {}, L = { ...DEF, ...(L0.tube ? TUBE : {}), ...L0, ...FEEL[id] };
  const back = new THREE.Color(sp.color);
  const hh = sp.h * 0.5, ww = sp.w * 0.5;
  const finC = L.fin ?? shade(back, 0.78), tipC = L.fin ? shade(L.fin, 0.8) : shade(back, 0.55);
  let geo = geoCache.get(id);
  if (!geo) { geo = { body: bodyGeometry(L, hh, ww), fins: finsGeometry(L, hh, ww, finC, tipC) }; geoCache.set(id, geo); }
  const g = new THREE.Group();
  const U = { uAmp: { value: 0 }, uPhase: { value: Math.random() * TAU }, uFlap: { value: 0 }, uPivot: { value: L.pivot }, uWave: { value: L.wave } };
  const rim = new THREE.Color(0.8, 0.9, 1).multiplyScalar(0.5 * L.shine);

  const bodyMat = (u) => {
    const m = new THREE.MeshPhongMaterial({ map: paintTexture(id, L, back, hh, ww), specular: new THREE.Color(1, 1, 1).multiplyScalar(0.03 + 0.11 * L.shine), shininess: 14 + 26 * L.shine,
      ...(L.glow ? { emissive: back.clone().multiplyScalar(0.35) } : {}) });
    addFlex(m, u, rim, false);
    return m;
  };
  const finMat = (u) => {
    const m = new THREE.MeshLambertMaterial({ map: finTexture(), vertexColors: true, side: THREE.DoubleSide, transparent: true, forceSinglePass: true,
      ...(L.glow ? { emissive: new THREE.Color(L.fin ?? '#a8ecff').multiplyScalar(0.3) } : {}) });
    addFlex(m, u, rim.clone().multiplyScalar(0.5), true);
    return m;
  };
  // 合畫用的共用材質：不擺動（uAmp 一直是 0）
  const still = () => ({ uAmp: { value: 0 }, uPhase: { value: 0 }, uFlap: { value: 0 }, uPivot: { value: L.pivot }, uWave: { value: L.wave } });
  g.add(new THREE.Mesh(geo.body, bodyMat(U)));
  if (geo.fins) g.add(new THREE.Mesh(geo.fins, finMat(U)));
  // 劍
  if (L.bill) {
    const bill = new THREE.Mesh(mergedParts(`bill|${id}`, () => [[new THREE.ConeGeometry(0.018, L.bill, 6), new V3(), Q0, S1()]]), new THREE.MeshLambertMaterial({ color: shade(back, 0.9) }));
    bill.rotation.z = -Math.PI / 2; bill.position.set(X1 + L.bill / 2 - 0.02, cOff(1, L, hh) * 0.6, 0); g.add(bill);
  }
  // 河豚的刺（只長在不太會擺的前半身）
  if (L.spines) {
    g.add(new THREE.Mesh(mergedParts(`spines|${id}`, () => {
      const sg = new THREE.ConeGeometry(0.012, 0.04, 4), r = rng(7), up = new V3(0, 1, 0), out = [];
      for (let i = 0; i < 26; i++) {
        const t = 0.32 + r() * 0.55, th = r() * TAU;
        out.push([sg, surf(L, hh, ww, t, th), new THREE.Quaternion().setFromUnitVectors(up, surfNormal(L, hh, ww, t, th)), S1()]);
      }
      return out;
    }), new THREE.MeshLambertMaterial({ color: '#e8dcb0' })));
  }
  const et = Math.min(0.9, L.head + (1 - L.head) * 0.22);
  addEyes(g, L, hh, ww, L.tube ? 0.9 : et, id);

  g.userData.flex = { U, amp: 0, k: L.flex };
  tagParts(g, id, { 0: () => bodyMat(still()), ...(geo.fins ? { 1: () => finMat(still()) } : {}) });
  g.scale.setScalar(len);
  return g;
}

// ---- 章魚、小卷 ----
function buildOctopus(sp, len) {
  const g = new THREE.Group(), col = new THREE.Color(sp.color), mat = new THREE.MeshLambertMaterial({ color: col });
  // 頭和八條腳合成一個網格、斑點一個、眼白一個、瞳孔一個（形狀只算一次）
  const dots = new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(0.6) });
  g.add(new THREE.Mesh(mergedParts('octo|dots', () => {
    const r = rng(5), out = [];
    for (let i = 0; i < 14; i++) { const a = r() * TAU, b = (r() - 0.3) * 1.6; out.push([new THREE.SphereGeometry(0.022 + r() * 0.02, 5, 4), new V3(-0.26 + Math.cos(a) * 0.24 * Math.cos(b), 0.4 + Math.sin(b) * 0.3, Math.sin(a) * 0.24 * Math.cos(b)), Q0, S1()]); }
    return out;
  }), dots));
  g.add(new THREE.Mesh(mergedParts('octo|eyes', () => [-1, 1].map((s) => [new THREE.SphereGeometry(0.06, 8, 6), new V3(-0.08, 0.36, s * 0.16), Q0, S1()])), new THREE.MeshLambertMaterial({ color: '#f1e9c8' })));
  g.add(new THREE.Mesh(mergedParts('octo|pupils', () => [-1, 1].map((s) => [new THREE.SphereGeometry(0.032, 6, 5), new V3(-0.04, 0.36, s * 0.195), Q0, S1()])), new THREE.MeshBasicMaterial({ color: '#0b0b0b' })));
  g.add(new THREE.Mesh(mergedParts('octo|body', () => {
    const out = [[new THREE.SphereGeometry(0.26, 14, 10), new V3(-0.26, 0.4, 0), Q0, new V3(0.95, 1.2, 0.95)]];
    // 八條腳：每條一串錐形圓柱接起來（由粗到細），從身體下面往外甩、尖端翹起來
    const up = new THREE.Vector3(0, 1, 0), pts = (i) => {
      const a = (i / 8) * TAU + 0.2, curl = (i % 2 ? 1 : -1) * 0.6, out = [];
      for (let k = 0; k <= 7; k++) {
        const s0 = k / 7, reach = 0.05 + s0 * 0.42, ang = a + curl * s0 * s0 * 1.3;
        out.push(new THREE.Vector3(-0.06 + Math.cos(ang) * reach, 0.2 - Math.sin(s0 * 2.4) * 0.17 + s0 * s0 * 0.1, Math.sin(ang) * reach));
      }
      return out;
    };
    for (let i = 0; i < 8; i++) {
      const P = pts(i);
      for (let k = 0; k < P.length - 1; k++) {
        const a = P[k], b = P[k + 1], d = b.clone().sub(a), l = d.length(), r0 = 0.05 * (1 - k / 7 * 0.85) + 0.005, r1 = 0.05 * (1 - (k + 1) / 7 * 0.85) + 0.005;
        out.push([new THREE.CylinderGeometry(r1, r0, l * 1.05, 6), a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(up, d.normalize()), S1()]);
      }
    }
    return out;
  }), mat));
  tagParts(g, sp.id);
  g.scale.setScalar(len * 1.2);
  return g;
}

function buildSquid(sp, len, glow) {
  const g = new THREE.Group(), col = new THREE.Color(sp.color);
  const mat = new THREE.MeshLambertMaterial({ color: col, ...(glow ? { emissive: col.clone().multiplyScalar(0.4) } : {}) });
  const L = { ...DEF, head: 0.7, tailStart: 0.1, ped: 0.02, pointy: 0.1, snout: 0, keel: 0 };
  const mantle = new THREE.Mesh(bodyGeometry({ ...L, bellyK: 1 }, 0.1, 0.1), mat);
  mantle.scale.set(1.15, 1, 1); g.add(mantle);
  const fin = flatFin([[-0.4, 0, 0, 0], [-0.2, 0, 0.2, 1], [-0.5, 0, 0.02, 0.5], [-0.2, 0, -0.2, 1]], col.clone().multiplyScalar(0.95), col.clone().multiplyScalar(0.7));
  g.add(new THREE.Mesh(fin, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, ...(glow ? { emissive: col.clone().multiplyScalar(0.3) } : {}) })));
  // 眼白、瞳孔、八隻腳、斑點各合成一個網格
  g.add(new THREE.Mesh(mergedParts('squid|eyes', () => [-1, 1].map((s) => [new THREE.SphereGeometry(0.045, 8, 6), new V3(0.4, 0.04, s * 0.1), Q0, S1()])), new THREE.MeshLambertMaterial({ color: '#f4f0d8' })));
  g.add(new THREE.Mesh(mergedParts('squid|pupils', () => [-1, 1].map((s) => [new THREE.SphereGeometry(0.025, 6, 5), new V3(0.42, 0.04, s * 0.13), Q0, S1()])), new THREE.MeshBasicMaterial({ color: '#0b0b0b' })));
  const r = rng(3), side = new THREE.Quaternion().setFromAxisAngle(new V3(0, 0, 1), Math.PI / 2);
  g.add(new THREE.Mesh(mergedParts('squid|arms', () => {
    const out = [];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU;
      out.push([new THREE.CylinderGeometry(0.008, 0.022, i % 4 === 0 ? 0.36 : 0.24, 5), new V3(0.58 + (i % 4 === 0 ? 0.08 : 0.02), Math.sin(a) * 0.05 + (r() - 0.5) * 0.01, Math.cos(a) * 0.05), side, S1()]);
    }
    return out;
  }), mat));
  const dm = new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(0.65) });
  g.add(new THREE.Mesh(mergedParts('squid|dots', () => {
    const out = [];
    for (let i = 0; i < 18; i++) { const a = r() * TAU; out.push([new THREE.SphereGeometry(0.012, 4, 3), new V3(-0.3 + r() * 0.65, Math.cos(a) * 0.1, Math.sin(a) * 0.1), Q0, S1()]); }
    return out;
  }), dm));
  tagParts(g, sp.id);
  g.scale.setScalar(len * 0.95);
  return g;
}

export function makeFishModel(sp, len) {
  if (sp.model === 'octopus') return buildOctopus(sp, len);
  if (sp.model === 'squid') return buildSquid(sp, len, !!(LOOKS[sp.id] && LOOKS[sp.id].glow));
  return build(sp, len);
}
