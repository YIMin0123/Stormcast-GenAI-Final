// 色板：全場的顏色都從這裡取。三組是給使用者比較用的（柔和偏暖、鮮豔飽和、清爽冷調）
import * as THREE from 'three';

const RAW = {
  warm: {
    name: '柔和偏暖',
    sand: '#d8c39a', sandWet: '#b9a67f', grass: '#8ea35a', grass2: '#7d9650', grassDark: '#66803f',
    rock: '#8e8a80', rock2: '#7b776d', rockWarm: '#9b8d77', cliff: '#a08f78', moss: '#73854a',
    trunk: '#6e5440', leaf: '#6f9a45', leaf2: '#5c873b', leaf3: '#87a74f',
    conifer: '#40684a', conifer2: '#4f7a4d', tuft: '#6f9446', tuftTip: '#a5bb65',
    water: '#2f6d78', waterFar: '#3d7f8a', fig: '#d9b27c',
  },
  vivid: {
    name: '鮮豔飽和',
    sand: '#f2d589', sandWet: '#d9ba6c', grass: '#5fbf3e', grass2: '#4fae35', grassDark: '#3d962c',
    rock: '#9a9aa4', rock2: '#83838e', rockWarm: '#a8957e', cliff: '#b89a7a', moss: '#4f9a3a',
    trunk: '#8a5a32', leaf: '#4ab83b', leaf2: '#38a031', leaf3: '#74d04b',
    conifer: '#27885a', conifer2: '#33a064', tuft: '#4fb036', tuftTip: '#9ae05c',
    water: '#1d7fcf', waterFar: '#2b93de', fig: '#f2b36a',
  },
  cool: {
    name: '清爽冷調',
    sand: '#eee5cf', sandWet: '#d6ceb8', grass: '#9cc49a', grass2: '#8bb88f', grassDark: '#70a385',
    rock: '#b3bbbf', rock2: '#9ea8ad', rockWarm: '#bdb6a8', cliff: '#c4c0b4', moss: '#86b394',
    trunk: '#8a7a6a', leaf: '#7fb79a', leaf2: '#6aa78b', leaf3: '#9bcaab',
    conifer: '#4e8e85', conifer2: '#5ea096', tuft: '#86b98f', tuftTip: '#c0dfb9',
    water: '#55b8bf', waterFar: '#7accd0', fig: '#e9c9a0',
  },
};

// 港口用的顏色（三組色板共用，之後再各自調）
const HARBOR = {
  concrete: '#cbc4b5', concreteSide: '#a9a395', stone: '#9a9488', parapet: '#bdb6a8', tetra: '#b3ad9f',
  wood: '#a5794f', woodDark: '#6e5440', woodLight: '#c49a6c', roofRed: '#b5503a', roofSlate: '#525d68', roofTin: '#7d93a6', metal: '#6f7a80',
  white: '#f1ede4', hullRed: '#a9443a', hullBlue: '#3f6f9a', hullGreen: '#4f8a5a', hullOrange: '#d9823e', cabinRoof: '#3f6f9a',
  board: '#2f5d86', flagRed: '#d64b3f', flagWhite: '#f4efe4', flagBlue: '#3b6fb0', crate: '#b08a5e', fishbox: '#4f8fc0',
  float: '#e8843c', net: '#4f7a5a', lampPole: '#454545', bulb: '#ffe2a0', pontoon: '#9c7a54', window: '#3c4f5c', yellow: '#e2b93b',
};
for (const k of Object.keys(RAW)) RAW[k] = { ...HARBOR, ...RAW[k] };
export const PALETTE_KEYS = Object.keys(RAW);
export function palette(key) {
  const p = {};
  for (const [k, v] of Object.entries(RAW[key])) p[k] = k === 'name' ? v : new THREE.Color(v);
  return p;
}

// 每一面的顏色加一點點亮度與色相的抖動，才不會像同一塊塑膠（量很小，仍然是平塗）
export function jitter(col, r, amt = 0.05) {
  const c = col.clone();
  const k = 1 + (r() - 0.5) * 2 * amt;
  c.multiplyScalar(k);
  c.offsetHSL((r() - 0.5) * amt * 0.25, 0, 0);
  return c;
}
