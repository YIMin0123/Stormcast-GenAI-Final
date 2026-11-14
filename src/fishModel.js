// 魚的模型（只在瀏覽器用）：身體是一條沿著身長收放的管子，花紋用小畫布畫成貼圖貼上去；
// 鰭是平的多邊形（顏色從根部到尖端漸層），再配上眼睛。每一種魚的長相寫在下面的 LOOKS，沒寫的欄位用預設值。
// 座標：+X 是頭、Y 是背、Z 是側面；先照身長 1 蓋好，最後整個乘上 len。
import * as THREE from 'three';

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
  sardine: { belly: '#eef3f4', tail: 'fork', dorsal: [[0.55, 0], [0.5, 1], [0.38, 0]], dh: 0.07, pect: 0.7, paint: [['stripe', { y: 0.5, t: 0.06, c: '#8fb6c8', a: 0.5 }], ['dots', { y: 0.38, n: 5, r: 2.4, c: '#1f3a55', x: [0.5, 0.85] }]] },
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
  mullet: { belly: '#eef0f0', tail: 'fork', dorsal: [[0.6, 0], [0.56, 1], [0.48, 0]], dh: 0.07, pect: 0.7,
    extra: [{ pts: [[0.24, 0], [0.2, 0.8], [0.13, 0]], on: 'dorsal', k: 0.065 }],
    paint: [['stripe', { y: 0.2, t: 0.04, c: '#4d5961', x: [0.15, 0.9], a: 0.5 }], ['stripe', { y: 0.32, t: 0.04, c: '#4d5961', x: [0.15, 0.9], a: 0.45 }], ['stripe', { y: 0.44, t: 0.04, c: '#4d5961', x: [0.15, 0.9], a: 0.4 }]] },
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
  saury: { belly: '#eef0f2', tail: 'fork', tailH: 0.12, ped: 0.1, head: 0.7, pointy: 0.9, dorsal: [[0.3, 0], [0.27, 1], [0.2, 0]], dh: 0.05, pect: 0.5,
    extra: [{ pts: [[0.2, 0], [0.17, 0.6], [0.1, 0]], on: 'dorsal', k: 0.04 }],
    paint: [['stripe', { y: 0.42, t: 0.05, c: '#a8b9c4', x: [0.2, 0.9], a: 0.7 }], ['bars', { n: 1, x: [0.96, 1], w: 1, c: '#e8b62a', y: [0, 1], a: 0.95 }]] },
  spanish: { belly: '#eef1f3', tail: 'lunate', tailH: 0.2, head: 0.6, dorsal: [[0.62, 0], [0.58, 1], [0.44, 0.9], [0.42, 0]], dh: 0.07, pect: 0.8, pointy: 0.55,
    extra: [{ pts: [[0.28, 0], [0.25, 0.6], [0.18, 0]], on: 'dorsal', k: 0.07 }],
    paint: [['spots', { n: 36, c: '#3a4a54', r: [1.4, 3], y: [0.05, 0.6], x: [0.2, 0.95], a: 0.7, seed: 14 }]] },
  yellowfin: { belly: '#e6ecf1', tail: 'lunate', tailH: 0.27, ped: 0.08, dorsal: [[0.6, 0], [0.52, 1.4], [0.2, 0.9], [0.15, 0]], dh: 0.09, anal: [[0.45, 0], [0.38, 1.2], [0.15, 0.8], [0.12, 0]], pect: 1, fin: '#e8c53a',
    paint: [['stripe', { y: 0.45, t: 0.05, c: '#f0d24a', x: [0.2, 0.9], a: 0.9 }], ['fade', { c: '#ffffff', a: 0.3, y: [0.6, 1] }]] },
  sunfish: { disc: true, sunfish: true, belly: '#d5dadd', tail: 'none', head: 0.74, pointy: 0.05, ped: 0.5, dorsal: [[0.4, 0], [0.1, 3.2], [0.02, 0]], dh: 0.12, anal: [[0.4, 0], [0.1, 3.0], [0.02, 0]], pect: 0.5, eye: 1.2, bellyK: 1,
    paint: [['spots', { n: 40, c: '#6d777d', r: [3, 7], y: [0, 0.9], x: [0.05, 0.95], a: 0.35, seed: 31 }]] },
  shark: { belly: '#f1f3f4', tail: 'shark', tailH: 0.3, ped: 0.1, head: 0.7, pointy: 0.85, dorsal: [[0.56, 0], [0.5, 1.9], [0.38, 0]], dh: 0.1, anal: [[0.2, 0], [0.17, 0.7], [0.1, 0]], pect: 1.9, eye: 0.6, eyeColor: '#05080a', fin: '#5d6b77', bellyAt: 0.45, gills: true,
    extra: [{ pts: [[0.2, 0], [0.17, 0.7], [0.1, 0]], on: 'dorsal', k: 0.05 }],
    paint: [['fade', { c: '#ffffff', a: 0.4, y: [0.5, 1] }]] },
  oarfish: { tube: true, belly: '#e4eaee', fin: '#d8352f', tail: 'none', ped: 0.5, head: 0.88, pointy: 0.4, dorsal: [[0.1, 0], [0.18, 1.2], [0.85, 1], [0.92, 2.4], [0.96, 0]], dh: 0.045, pect: 0.5, eye: 1.5,
    paint: [['spots', { n: 36, c: '#4d5a66', r: [2, 4], y: [0, 0.7], x: [0.05, 0.95], a: 0.45, seed: 41 }], ['stripe', { y: 0.2, t: 0.03, c: '#ffffff', a: 0.6 }]] },
  hairtail: { tube: true, belly: '#e6ecf4', fin: '#bcc6d4', tail: 'none', ped: 0.12, head: 0.88, pointy: 0.9, dorsal: [[0.1, 0], [0.16, 1], [0.9, 1], [0.94, 0]], dh: 0.03, pect: 0.4, eye: 0.9,
    paint: [['fade', { c: '#ffffff', a: 0.4, y: [0, 1] }], ['stripe', { y: 0.2, t: 0.08, c: '#ffffff', a: 0.4 }]] },
  swordfish: { belly: '#d4dce8', tail: 'lunate', tailH: 0.26, ped: 0.07, head: 0.62, pointy: 0.9, bill: 0.36, dorsal: [[0.64, 0], [0.62, 1.8], [0.3, 1.1], [0.26, 0]], dh: 0.1, anal: [[0.3, 0], [0.26, 0.8], [0.18, 0]], pect: 1.2, fin: '#1e2e5c', eye: 1.3,
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

const DEF = { belly: '#eef2f4', tail: 'fork', tailH: 0.2, head: 0.6, tailStart: 0.34, ped: 0.15, pointy: 0.35, bellyK: 1.05, dh: 0.07, pect: 1, eye: 1, forehead: 0, lowerLobe: 1, paint: [] };

// ---- 貼圖：身體一圈攤平（橫向是從尾到頭，縱向是從背到肚子，再鏡射到另一側）----
const texCache = new Map();
function paintTexture(id, L, back) {
  if (texCache.has(id)) return texCache.get(id);
  const W = 256, H = 128, half = H / 2;
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
    h.strokeStyle = 'rgba(255,255,255,0.10)'; h.lineWidth = 1;
    const sw = 9;
    for (let row = 0, y = 4; y < half; row++, y += sw * 0.55) for (let x = (row % 2) * sw / 2; x < W; x += sw) { h.beginPath(); h.arc(x, y, sw * 0.55, Math.PI * 0.15, Math.PI * 0.85); h.stroke(); }
    h.strokeStyle = 'rgba(0,0,0,0.07)';
    for (let row = 0, y = 7; y < half; row++, y += sw * 0.55) for (let x = (row % 2) * sw / 2 + 2; x < W; x += sw) { h.beginPath(); h.arc(x, y, sw * 0.55, Math.PI * 0.2, Math.PI * 0.8); h.stroke(); }
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
        const rad = o.r[0] + r() * (o.r[1] - o.r[0]);
        h.fillStyle = c; h.beginPath(); h.ellipse(px(x0 + r() * (x1 - x0)), py(y0 + r() * (y1 - y0)), rad * 1.25, rad, 0, 0, TAU); h.fill();
      }
    } else if (kind === 'stripe') {
      const [x0, x1] = o.x ?? [0, 1], t = o.t * half;
      for (const [grow, al] of [[2, 0.4], [1, 1]]) {
        h.globalAlpha = (o.a ?? 1) * al; h.fillStyle = c; h.fillRect(px(x0), py(o.y) - t * grow / 2, px(x1 - x0), t * grow);
      }
    } else if (kind === 'dots') {
      const [x0, x1] = o.x ?? [0, 1];
      h.fillStyle = c;
      for (let i = 0; i < o.n; i++) { h.beginPath(); h.arc(px(x0 + (i + 0.5) / o.n * (x1 - x0)), py(o.y), o.r, 0, TAU); h.fill(); }
    } else if (kind === 'fade') {
      const [y0, y1] = o.y ?? [0, 1], gg = h.createLinearGradient(0, py(y0), 0, py(y1));
      gg.addColorStop(0, 'rgba(255,255,255,0)'); gg.addColorStop(1, c);
      h.globalAlpha = o.a ?? 1; h.fillStyle = gg; h.fillRect(0, py(y0), W, py(y1 - y0));
    }
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

// ---- 身體 ----
function profile(t, L) {
  let m;
  if (t >= L.head) { const u = (t - L.head) / (1 - L.head); m = Math.pow(Math.max(0, 1 - u * u), 0.5 + 0.5 * L.pointy); if (L.forehead) m *= 1 + L.forehead * (1 - u); }
  else if (L.tube) { m = t < 0.14 ? L.ped + (1 - L.ped) * smooth(t / 0.14) : 1; }
  else if (t > L.tailStart) m = 1 + 0.06 * Math.sin((t - L.tailStart) / (L.head - L.tailStart) * Math.PI);
  else m = L.ped + (1 - L.ped) * smooth(t / L.tailStart);
  return m;
}
const xAt = (t) => X0 + t * (X1 - X0);

function bodyGeometry(L, hh, ww) {
  const NS = 36, NR = 16, pos = [], uv = [], idx = [];
  const bellyK = L.bellyK;
  for (let i = 0; i <= NS; i++) {
    const t = i / NS, m = profile(t, L);
    for (let j = 0; j <= NR; j++) {
      const th = j / NR * TAU, cy = Math.cos(th), sz = Math.sin(th);
      pos.push(xAt(t), cy * (cy < 0 ? bellyK : 1) * hh * m, sz * ww * m);
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
  return geo;
}

// ---- 鰭：平的多邊形，根部到尖端顏色漸層 ----
function finGeometry(polys, base, tip) {
  const P = [], C = [], I = [];
  const cb = new THREE.Color(base), ct = new THREE.Color(tip), c = new THREE.Color();
  for (const poly of polys) {
    // poly：{ pts: [[x, y, z, k], …]（k：0 根部到 1 尖端）}
    const start = P.length / 3;
    // 用 x、y（或 x、z）平面做三角化
    const plane = poly.plane ?? 'xy';
    const pts2 = poly.pts.map((p) => (plane === 'xy' ? new THREE.Vector2(p[0], p[1]) : new THREE.Vector2(p[0], p[2])));
    const tris = THREE.ShapeUtils.triangulateShape(pts2, []);
    for (const p of poly.pts) { P.push(p[0], p[1], p[2] ?? 0); c.copy(cb).lerp(ct, clamp(p[3] ?? 0, 0, 1)); C.push(c.r, c.g, c.b); }
    for (const t of tris) I.push(start + t[0], start + t[1], start + t[2]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  geo.setIndex(I);
  geo.computeVertexNormals();
  return geo;
}

// 背鰭、臀鰭：沿著身體上緣（或下緣）；spec：[[位置, 高度倍數], …]
function ridgeFin(spec, L, hh, dh, sign) {
  const pts = [];
  const top = (t) => sign * hh * profile(t, L) * (sign < 0 ? L.bellyK : 1);
  const t0 = spec[0][0], t1 = spec[spec.length - 1][0];
  // 輪廓（從尾端往頭端：先走過尖端的點）
  const outline = spec.map(([t, k]) => [xAt(t), top(t) + sign * k * dh, 0, k > 0 ? 1 : 0]);
  // 根部：沿著身體貼回去（頭端往尾端）
  const base = [], nb = 6;
  for (let k = 1; k < nb - 1; k++) { const t = t1 + (t0 - t1) * k / (nb - 1); base.push([xAt(t), top(t) - sign * 0.004, 0, 0]); }
  pts.push(...outline, ...base);   // 輪廓走一圈（從第一點到最後一點），再沿著身體貼回第一點
  return { pts, plane: 'xy' };
}

function tailPolys(kind, L, hh) {
  const x0 = X0 + 0.01, p = L.ped * hh * 0.9, th = L.tailH, k = L.lowerLobe;
  const T = (pts) => ({ pts: pts.map(([x, y, kk]) => [x0 + x, y, 0, kk]), plane: 'xy' });
  switch (kind) {
    case 'fork': return [T([[0, p, 0], [-0.2, th, 1], [-0.13, 0, 0.55], [-0.2 * k, -th * k, 1], [0, -p, 0]])];
    case 'lunate': return [T([[0, p, 0], [-0.1, th * 0.7, 0.6], [-0.24, th * 1.15, 1], [-0.15, 0, 0.7], [-0.24, -th * 1.15, 1], [-0.1, -th * 0.7, 0.6], [0, -p, 0]])];
    case 'round': return [T([[0, p, 0], [-0.08, th * 0.9, 0.7], [-0.17, th * 0.55, 1], [-0.2, 0, 1], [-0.17, -th * 0.55, 1], [-0.08, -th * 0.9, 0.7], [0, -p, 0]])];
    case 'trunc': return [T([[0, p, 0], [-0.17, th, 1], [-0.17, -th, 1], [0, -p, 0]])];
    case 'shark': return [T([[0, p, 0], [-0.1, th * 0.9, 0.6], [-0.3, th * 1.2, 1], [-0.16, th * 0.1, 0.8], [-0.2, -th * 0.6, 1], [-0.04, -th * 0.5, 0.4], [0, -p, 0]])];
    case 'point': return [T([[0, p, 0], [-0.2, 0, 1], [0, -p, 0]])];
    default: return [];
  }
}

// ---- 眼睛、胸鰭等小東西 ----
const eyeG = { ring: new THREE.SphereGeometry(1, 10, 8), pupil: new THREE.SphereGeometry(1, 8, 6) };
function addEyes(g, L, hh, ww, t) {
  const m = profile(t, L), r = 0.032 * L.eye, ringC = L.ring ?? '#f4f4ec', pupilC = L.eyeColor ?? '#0b0b0b';
  const ringM = new THREE.MeshLambertMaterial({ color: ringC }), pupM = new THREE.MeshBasicMaterial({ color: pupilC });
  const sides = L.eyeFlat ? [1, 1] : [1, -1];
  sides.forEach((s, i) => {
    const e = new THREE.Mesh(eyeG.ring, ringM);
    const y = hh * m * (L.eyeFlat ? (i ? 0.28 : 0.55) : 0.22);
    e.scale.setScalar(r); e.position.set(xAt(t), y, s * ww * m * 0.82); g.add(e);
    const p = new THREE.Mesh(eyeG.pupil, pupM); p.scale.setScalar(r * 0.62); p.position.set(xAt(t) + r * 0.2, y, s * (ww * m * 0.82 + r * 0.55)); g.add(p);
  });
}

function pectoralFins(L, hh, ww, finC, tipC) {
  if (!L.pect) return null;
  const polys = [], t = L.head - 0.05, m = profile(t, L), size = 0.14 * L.pect;
  for (const s of [1, -1]) {
    const x = xAt(t), y = -hh * m * 0.3, z = s * ww * m * 0.92, wing = L.pect > 2;
    // 胸鰭：一片圓潤的扇形（根部窄、尖端寬），往後下方斜出去
    polys.push({ plane: 'xz', pts: [[x + 0.025, y, z, 0], [x - 0.02, y + 0.012, z, 0], [x - size * (wing ? 2.6 : 1.1), y - size * (wing ? 0.1 : 0.45) + 0.02, z + s * size * (wing ? 2.0 : 0.6), 1], [x - size * (wing ? 1.8 : 0.8), y - size * (wing ? 0.05 : 0.55), z + s * size * (wing ? 2.3 : 0.75), 1]] });
    // 腹鰭：肚子下面一小片
    if (!L.tube && !wing && L.pelvic !== false) {
      const t2 = L.head - 0.16, m2 = profile(t2, L), x2 = xAt(t2), y2 = -hh * m2 * L.bellyK * 0.92;
      polys.push({ plane: 'xz', pts: [[x2 + 0.02, y2, s * ww * m2 * 0.35, 0], [x2 - 0.015, y2, s * ww * m2 * 0.35, 0], [x2 - size * 0.55, y2 - size * 0.55, s * ww * m2 * 0.55 + s * size * 0.2, 1]] });
    }
  }
  return polys;
}

function build(sp, len) {
  const id = sp.id;
  const L0 = LOOKS[id] ?? {}, L = { ...DEF, ...L0 };
  const back = new THREE.Color(sp.color);
  let hh = sp.h * 0.5, ww = sp.w * 0.5;
  if (L.round || L.disc) { hh *= 1; }
  const finC = L.fin ?? shade(back, 0.78), tipC = L.fin ? shade(L.fin, 0.8) : shade(back, 0.55);
  const g = new THREE.Group();

  const tex = paintTexture(id, L, back);
  const body = new THREE.Mesh(bodyGeometry(L, hh, ww), new THREE.MeshLambertMaterial({ map: tex, ...(L.glow ? { emissive: new THREE.Color(back).multiplyScalar(0.35) } : {}) }));
  g.add(body);

  // 鰭
  const polys = [];
  if (L.dorsal && L.dorsal !== 'rim') polys.push(ridgeFin(L.dorsal, L, hh, L.dh, 1));
  const anal = L.anal ?? (L.dorsal && L.dorsal !== 'rim' && !L.tube ? [[0.34, 0], [0.28, 1], [0.18, 0]] : null);
  if (anal) polys.push(ridgeFin(anal, L, hh, L.dh * 0.85, -1));
  for (const e of L.extra ?? []) polys.push(ridgeFin(e.pts, L, hh, e.k ?? 0.05, e.on === 'anal' ? -1 : 1));
  if (L.dorsal === 'rim') {   // 比目魚：沿著整圈身體邊緣一圈鰭
    for (const sign of [1, -1]) polys.push(ridgeFin([[0.08, 0], [0.2, 1], [0.7, 1], [0.82, 0]], L, hh, 0.04, sign));
  }
  polys.push(...tailPolys(L.tail, L, hh));
  const pf = pectoralFins(L, hh, ww, finC, tipC);
  if (pf) polys.push(...pf);
  if (polys.length) {
    const fins = new THREE.Mesh(finGeometry(polys, finC, tipC), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, ...(L.glow ? { emissive: new THREE.Color(L.fin ?? '#a8ecff').multiplyScalar(0.3) } : {}) }));
    g.add(fins);
  }
  // 劍
  if (L.bill) {
    const bill = new THREE.Mesh(new THREE.ConeGeometry(0.018, L.bill, 6), new THREE.MeshLambertMaterial({ color: shade(back, 0.9) }));
    bill.rotation.z = -Math.PI / 2; bill.position.set(X1 + L.bill / 2 - 0.02, 0, 0); g.add(bill);
  }
  // 河豚的刺
  if (L.spines) {
    const sg = new THREE.ConeGeometry(0.012, 0.04, 4), sm = new THREE.MeshLambertMaterial({ color: '#e8dcb0' }), r = rng(7);
    for (let i = 0; i < 26; i++) {
      const t = 0.2 + r() * 0.65, th = r() * TAU, m = profile(t, L), s = new THREE.Mesh(sg, sm);
      const dir = new THREE.Vector3(0, Math.cos(th) * hh, Math.sin(th) * ww).normalize();
      s.position.set(xAt(t), Math.cos(th) * hh * m, Math.sin(th) * ww * m);
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      g.add(s);
    }
  }
  // 鯊魚的鰓裂
  if (L.gills) {
    const gm = new THREE.MeshBasicMaterial({ color: '#2a3138' });
    for (const s of [1, -1]) for (let i = 0; i < 4; i++) {
      const t = L.head - 0.04 - i * 0.025, m = profile(t, L), e = new THREE.Mesh(new THREE.BoxGeometry(0.004, hh * m * 0.7, 0.002), gm);
      e.position.set(xAt(t), hh * m * 0.05, s * ww * m * 0.99); g.add(e);
    }
  }
  // 嘴線、鰓蓋（兩側各一條細線，魚的臉才有層次）
  {
    const dark = new THREE.MeshBasicMaterial({ color: shade(back, 0.35) });
    const tm = Math.min(0.97, L.bill ? 0.9 : 0.955), mm = profile(tm, L);
    for (const s of [1, -1]) {
      if (!L.bill && !L.sunfish) {
        const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.004, 0.003), dark);
        mouth.position.set(xAt(tm) - 0.012, -hh * mm * 0.28, s * ww * mm * 0.97); mouth.rotation.z = 0.12; g.add(mouth);
      }
      if (!L.tube || L.head < 0.9) {
        const m2 = profile(L.head - 0.025, L), r = Math.max(0.02, hh * m2 * 0.55);
        const arc = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0035, 3, 10, Math.PI * 0.8), dark);
        arc.rotation.z = Math.PI * 0.6; arc.position.set(xAt(L.head - 0.025) + r * 0.45, -hh * m2 * 0.05, s * ww * m2 * 0.985); g.add(arc);
      }
    }
  }
  // 眼睛
  const et = Math.min(0.9, L.head + (1 - L.head) * 0.22);
  addEyes(g, L, hh, ww, L.tube ? 0.9 : et);

  g.scale.setScalar(len);
  return g;
}

// ---- 章魚、小卷 ----
function buildOctopus(sp, len) {
  const g = new THREE.Group(), col = new THREE.Color(sp.color), mat = new THREE.MeshLambertMaterial({ color: col });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), mat); head.scale.set(0.95, 1.2, 0.95); head.position.set(-0.26, 0.4, 0); g.add(head);
  const dots = new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(0.6) }), r = rng(5);
  for (let i = 0; i < 14; i++) { const a = r() * TAU, b = (r() - 0.3) * 1.6, d = new THREE.Mesh(new THREE.SphereGeometry(0.022 + r() * 0.02, 5, 4), dots); d.position.set(-0.26 + Math.cos(a) * 0.24 * Math.cos(b), 0.4 + Math.sin(b) * 0.3, Math.sin(a) * 0.24 * Math.cos(b)); g.add(d); }
  for (const s of [-1, 1]) {
    const ey = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshLambertMaterial({ color: '#f1e9c8' })); ey.position.set(-0.08, 0.36, s * 0.16); g.add(ey);
    const pu = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 5), new THREE.MeshBasicMaterial({ color: '#0b0b0b' })); pu.position.set(-0.04, 0.36, s * 0.195); g.add(pu);
  }
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
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, l * 1.05, 6), mat);
      seg.position.copy(a).add(b).multiplyScalar(0.5);
      seg.quaternion.setFromUnitVectors(up, d.normalize());
      g.add(seg);
    }
  }
  g.scale.setScalar(len * 1.2);
  return g;
}

function buildSquid(sp, len, glow) {
  const g = new THREE.Group(), col = new THREE.Color(sp.color);
  const mat = new THREE.MeshLambertMaterial({ color: col, ...(glow ? { emissive: col.clone().multiplyScalar(0.4) } : {}) });
  const L = { ...DEF, head: 0.7, tailStart: 0.1, ped: 0.02, pointy: 0.1 };
  const mantle = new THREE.Mesh(bodyGeometry({ ...L, bellyK: 1 }, 0.1, 0.1), mat);
  mantle.scale.set(1.15, 1, 1); g.add(mantle);
  const fin = finGeometry([{ plane: 'xz', pts: [[-0.4, 0, 0, 0], [-0.2, 0, 0.2, 1], [-0.5, 0, 0.02, 0.5], [-0.2, 0, -0.2, 1]] }], col.clone().multiplyScalar(0.95), col.clone().multiplyScalar(0.7));
  g.add(new THREE.Mesh(fin, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, ...(glow ? { emissive: col.clone().multiplyScalar(0.3) } : {}) })));
  for (const s of [-1, 1]) {
    const ey = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshLambertMaterial({ color: '#f4f0d8' })); ey.position.set(0.4, 0.04, s * 0.1); g.add(ey);
    const pu = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 5), new THREE.MeshBasicMaterial({ color: '#0b0b0b' })); pu.position.set(0.42, 0.04, s * 0.13); g.add(pu);
  }
  const r = rng(3);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU, cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.022, i % 4 === 0 ? 0.36 : 0.24, 5), mat);
    cyl.rotation.z = Math.PI / 2; cyl.position.set(0.58 + (i % 4 === 0 ? 0.08 : 0.02), Math.sin(a) * 0.05 + (r() - 0.5) * 0.01, Math.cos(a) * 0.05); g.add(cyl);
  }
  const dm = new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(0.65) });
  for (let i = 0; i < 18; i++) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 3), dm), a = r() * TAU; d.position.set(-0.3 + r() * 0.65, Math.cos(a) * 0.1, Math.sin(a) * 0.1); g.add(d); }
  g.scale.setScalar(len * 0.95);
  return g;
}

export function makeFishModel(sp, len) {
  if (sp.model === 'octopus') return buildOctopus(sp, len);
  if (sp.model === 'squid') return buildSquid(sp, len, !!(LOOKS[sp.id] && LOOKS[sp.id].glow));
  return build(sp, len);
}
