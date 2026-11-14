// 座標系：世界座標 ↔ 各個島自己的設計圖座標。
// 港口、岸壁、商店、停船格……全是用「港座標」寫的（原點旁邊就是母島，+z 是港口面海的那一側，像是一張正南朝向的設計圖）。
// 世界座標則是整張地圖的座標（+x 東、+z 南）。這個檔案只負責兩邊互轉：
//   世界 = 原點 + 旋轉(港座標)。港座標的 +z（港口朝海）轉過去就是東南方。
// 大港灣島、海上的礁石群也各有一套自己的座標（+z 朝灣口／朝船穿過去的方向），同一個算法（makeFrame）。
// 只有數字，不碰畫面：瀏覽器和伺服器共用。

import { WORLD } from './config.js';

// 一套設計圖座標。center：設計圖上 local 那一點放在世界的哪裡；facingDeg：設計圖的 +z 朝世界的哪個方向（正北為 0、順時針）。
// 設計圖原本朝正南（180 度），要轉多少就是 (180 - 朝向) 度
export function makeFrame({ center, facingDeg, local = { x: 0, z: 0 } }) {
  const yaw = (180 - facingDeg) * Math.PI / 180, C = Math.cos(yaw), S = Math.sin(yaw);
  const OX = center.x - (local.x * C + local.z * S), OZ = center.z - (-local.x * S + local.z * C);
  return {
    yaw,
    origin: { x: OX, z: OZ },   // 設計圖原點在世界的位置（給 three.js 的 Group 擺位用，rotation.y = yaw）
    toWorld: (lx, lz) => [OX + lx * C + lz * S, OZ - lx * S + lz * C],
    toLocal: (x, z) => { const dx = x - OX, dz = z - OZ; return [dx * C - dz * S, dx * S + dz * C]; },
    // 方向（船頭、人面向，朝 (cos h, sin h)）
    headingToWorld: (h) => h - yaw,
    headingToLocal: (h) => h + yaw,
  };
}

// ---- 母港 ----
const HOME = makeFrame({ center: WORLD.home.center, facingDeg: WORLD.home.harborFacingDeg, local: WORLD.home.islandLocal });
export const HOME_YAW = HOME.yaw;
// 母島的中心（港座標 islandLocal）放在世界的哪裡
export const HOME_CENTER = WORLD.home.center;
// 港座標 → 世界座標（three.js 的 rotation.y = HOME_YAW 也是同一個轉法）
export const toWorld = HOME.toWorld;
// 世界座標 → 港座標
export const toLocal = HOME.toLocal;
// 方向（船頭、人面向，朝 (cos h, sin h)）：港座標 ↔ 世界座標
export const headingToWorld = HOME.headingToWorld;
export const headingToLocal = HOME.headingToLocal;
// 港座標系原點在世界的位置（給 three.js 的 Group 擺位用）
export const HOME_ORIGIN = HOME.origin;

// ---- 大港灣島：原點是島的中心，+z 朝灣口 ----
export const HAVEN = makeFrame({ center: WORLD.haven.center, facingDeg: WORLD.haven.bayFacingDeg });
export const havenToWorld = HAVEN.toWorld;
export const havenToLocal = HAVEN.toLocal;

// ---- 海上的礁石群：每一組各一套（原點是那一組的中心）----
export const REEF_FRAMES = Object.fromEntries(Object.entries(WORLD.reefs).map(([k, v]) => [k, makeFrame(v)]));

// 把用某一套設計圖座標蓋好的東西擺進世界：原點移過去、轉到該朝的方向
export function placeInFrame(obj, frame) {
  obj.position.set(frame.origin.x, 0, frame.origin.z);
  obj.rotation.y = frame.yaw;
  obj.updateMatrix();
  return obj;
}
