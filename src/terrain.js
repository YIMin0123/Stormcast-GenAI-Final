import { toWorld, toLocal } from './frame.js';
import { WORLD } from './config.js';

import { homeBed } from './lowpoly/homeShape.js';
import * as H from './lowpoly/harborPlan.js';
const IL = WORLD.home.islandLocal;

// 地圖：開闊海洋上的一座母島（低面的小島漁港，形狀見 lowpoly/homeShape.js），沒有大陸。高程單位公尺，海平面 = 0，負值為海底。
// 座標原點在地圖中心，+z 是南方。

export const SEA_FLOOR = -30;

// 島的資料（港座標）。R：島的大概半徑（著色與佈景用）；look：地表的樣子；flora：舊的佈景（樹、石頭）—— 新島的樹和岩石是低面模型，這裡不種
const LOCAL_ISLANDS = [
  {
    id: 'home', name: '母港島', x: H.ISLAND.x, z: H.ISLAND.z, R: 85, bumps: [{ x: H.HILL.x, z: H.HILL.z, r: 50, peak: H.HILL.peak }],
    shape: { beach: 0, bw: 1, jag: 0, cliff: 0, hill: 0 },
    look: { rock: 0.12, veg: 1.0, white: 0.15, dry: 0.15 },
    flora: { broadleaf: 0, conifer: 0, palm: 0, bush: 0, shoreRock: 0, landRock: 0 },
  },
];

// 世界座標版（佈景、著色器、伺服器用）：島的位置、圓丘的位置都轉成世界座標。地形本身用港座標算（見 makeTerrain）
export const ISLANDS = LOCAL_ISLANDS.map((o) => {
  const [x, z] = toWorld(o.x, o.z);
  return { ...o, x, z, bumps: o.bumps.map((b) => { const [bx, bz] = toWorld(b.x, b.z); return { ...b, x: bx, z: bz }; }) };
});

// 海床高度圖：每一格換成港座標，照母港島的形狀算（島、水泥平台、港池、往外慢慢變深的海底）
export function makeTerrain(N, L) {
  const bed = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const [x, z] = toLocal(((i + 0.5) / N - 0.5) * L, ((j + 0.5) / N - 0.5) * L);
      // 離島 260 公尺外都是外海的海底（homeBed 在那裡早就到底了），不用算
      bed[j * N + i] = (x - H.ISLAND.x) ** 2 + (z - H.ISLAND.z) ** 2 > 260 * 260 ? SEA_FLOOR : Math.max(SEA_FLOOR, homeBed(x, z));
    }
  }
  return { bed };
}

// 避浪係數（0 = 完全平靜，1 = 完全暴露）：逆著浪的來向看出去，若近處有陸地擋著就比較平靜。
// 島的背風面與港灣因此會是靜水。
export function computeShelter(bed, N, L, waveAngle) {
  const DX = L / N, STEP = 1.25, REACH = 260;
  const MAXS = Math.ceil(REACH / (STEP * DX));
  const out = new Float32Array(N * N).fill(1);
  const rays = [-0.22, 0, 0.22].map((da) => [-Math.cos(waveAngle + da) * STEP, -Math.sin(waveAngle + da) * STEP]);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (bed[k] > 0.5) { out[k] = 0; continue; }
      let sum = 0;
      for (const [sx, sz] of rays) {
        let e = 1, x = i, z = j;
        for (let s = 1; s <= MAXS; s++) {
          x += sx; z += sz;
          const xi = Math.round(x), zi = Math.round(z);
          if (xi < 0 || zi < 0 || xi >= N || zi >= N) break;
          if (bed[zi * N + xi] > 0.5) { e = Math.min(1, ((s * STEP * DX) / REACH) ** 1.5); break; }
        }
        sum += e;
      }
      out[k] = sum / 3;
    }
  }
  // 模糊幾次，模擬波浪繞射進遮蔽區
  const tmp = new Float32Array(N * N);
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        let s = 0, c = 0;
        for (let dj = -2; dj <= 2; dj++) {
          const jj = j + dj; if (jj < 0 || jj >= N) continue;
          for (let di = -2; di <= 2; di++) {
            const ii = i + di; if (ii < 0 || ii >= N) continue;
            s += out[jj * N + ii]; c++;
          }
        }
        tmp[j * N + i] = s / c;
      }
    }
    out.set(tmp);
  }
  const bytes = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) bytes[k] = Math.round(Math.min(1, Math.max(0, out[k])) * 255);
  return bytes;
}

// 離岸距離（公尺，最多 max）：水裡的每一格離最近的陸地多遠。
// 岸邊的浪靠它知道岸在哪裡、朝哪個方向捲過去（跟風向無關，每一面海岸的浪都是朝著岸來的）。
export function computeShoreDist(bed, N, L, max = 96) {
  const DX = L / N, INF = 1e12;
  const f = new Float64Array(N * N);
  for (let k = 0; k < N * N; k++) f[k] = bed[k] >= 0 ? 0 : INF;
  // 精確的歐氏距離轉換：先每一欄、再每一列各做一次一維的（Felzenszwalb）
  const g = new Float64Array(N), d = new Float64Array(N), v = new Int32Array(N), z = new Float64Array(N + 1);
  const pass = () => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < N; q++) {
      let sx;
      for (;;) {
        const p = v[k];
        sx = ((g[q] + q * q) - (g[p] + p * p)) / (2 * q - 2 * p);
        if (sx <= z[k] && k > 0) k--; else break;
      }
      k++; v[k] = q; z[k] = sx; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < N; q++) {
      while (z[k + 1] < q) k++;
      const p = v[k];
      d[q] = (q - p) * (q - p) + g[p];
    }
  };
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) g[j] = f[j * N + i];
    pass();
    for (let j = 0; j < N; j++) f[j * N + i] = d[j];
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) g[i] = f[j * N + i];
    pass();
    for (let i = 0; i < N; i++) f[j * N + i] = d[i];
  }
  let out = new Float32Array(N * N), tmp = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) out[k] = Math.min(Math.max(Math.sqrt(f[k]) * DX - 0.5 * DX, 0), max);
  // 稍微抹平：海岸線是一格一格的，不抹的話浪頭的線條會跟著鋸齒
  for (let n = 0; n < 2; n++) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, N - 1), j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, N - 1);
        tmp[j * N + i] = (out[j * N + i] * 4 + (out[j * N + i0] + out[j * N + i1] + out[j0 * N + i] + out[j1 * N + i]) * 2
          + out[j0 * N + i0] + out[j0 * N + i1] + out[j1 * N + i0] + out[j1 * N + i1]) / 16;
      }
    }
    [out, tmp] = [tmp, out];
  }
  return out;
}
