// 母港的座標系。
// 港口、岸壁、商店、停船格……全是用「港座標」寫的（原點旁邊就是母島，+z 是港口面海的那一側，像是一張正南朝向的設計圖）。
// 世界座標則是整張地圖的座標（+x 東、+z 南）。這個檔案只負責兩邊互轉：
//   世界 = 原點 + 旋轉(港座標)。港座標的 +z（港口朝海）轉過去就是東南方。
// 只有數字，不碰畫面：瀏覽器和伺服器共用。

import { WORLD } from './config.js';

// 港口朝向：港座標的 +z 轉到世界的哪個方向。設定裡用「正北為 0、順時針」的角度（135 = 東南），
// 這裡換成弧度：港座標原本朝正南（180 度），要轉多少就是 (180 - 朝向) 度
export const HOME_YAW = (180 - WORLD.home.harborFacingDeg) * Math.PI / 180;
// 母島的中心（港座標 islandLocal）放在世界的哪裡
export const HOME_CENTER = WORLD.home.center;

const C = Math.cos(HOME_YAW), S = Math.sin(HOME_YAW);
const IL = WORLD.home.islandLocal;
const OX = HOME_CENTER.x - (IL.x * C + IL.z * S), OZ = HOME_CENTER.z - (-IL.x * S + IL.z * C);

// 港座標 → 世界座標（three.js 的 rotation.y = HOME_YAW 也是同一個轉法）
export const toWorld = (lx, lz) => [OX + lx * C + lz * S, OZ - lx * S + lz * C];
// 世界座標 → 港座標
export const toLocal = (x, z) => { const dx = x - OX, dz = z - OZ; return [dx * C - dz * S, dx * S + dz * C]; };
// 方向（船頭、人面向，朝 (cos h, sin h)）：港座標 ↔ 世界座標
export const headingToWorld = (h) => h - HOME_YAW;
export const headingToLocal = (h) => h + HOME_YAW;
// 港座標系原點在世界的位置（給 three.js 的 Group 擺位用）
export const HOME_ORIGIN = { x: OX, z: OZ };
