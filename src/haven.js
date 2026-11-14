// 探險大港灣島和海上的礁石群：遊戲這一側。模型由 lowpoly/haven3d.js、lowpoly/reefs3d.js 蓋（各自的設計圖座標），
// 這裡把它們擺進世界、把擋路的東西轉成世界座標，並負責每幀的小事（燈標閃光、太遠就不畫）。
import * as THREE from 'three';
import { rng, tagSurfaces } from './lowpoly/kit.js';
import { palette } from './lowpoly/palette.js';
import { buildHaven } from './lowpoly/haven3d.js';
import { buildArch, buildAtoll, buildBeacon } from './lowpoly/reefs3d.js';
import { GROUND } from './lowpoly/havenPlan.js';
import { BEACON } from './lowpoly/reefPlan.js';
import { HAVEN, REEF_FRAMES, placeInFrame } from './frame.js';
import { TOUCH } from './touch.js';
import { HAZE } from './renderShaders.js';

// 大港灣島畫出來的地面多高（大港座標）：at(x, z)。走路踩的是它（見 main.js 的 landAt）
export const HAVEN_LAND = { at: null };
export const HAVEN_GROUND = GROUND;

// mat：全場共用的那個低面材質（港口建的那一個）。
// 回傳 { groups 要加進場景的東西, rocks 擋路的岩塊與樹幹（世界座標）[{ x, z, r, top }], update(時間, 鏡頭位置) 每幀呼叫 }
export function makeSeascape(mat) {
  const P = palette('warm');
  tagSurfaces(!TOUCH);   // 電腦版：每一面記下材質種類（岩石的程式貼圖），跟港口一樣
  const rocks = [], groups = [], parts = [];
  // 會重複很多個的東西（岩塊、樹）：一個樣板＋實例
  const placer = (group) => (geo, list, cast, recv) => {
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
    m.computeBoundingSphere();
    group.add(m);
    return m;
  };
  // 蓋一組：用它自己的座標蓋，整個擺進世界；擋路的東西轉成世界座標。reach：離它多遠以內才畫（再遠已經被霧蓋掉了）
  const add = (frame, build, seed, reach) => {
    const group = new THREE.Group();
    const out = build({ P, r: rng(seed), place: placer(group), mat, group, phone: TOUCH });
    placeInFrame(group, frame);
    for (const k of out.rocks) { const [x, z] = frame.toWorld(k.x, k.z); rocks.push({ ...k, x, z }); }
    groups.push(group);
    parts.push({ group, x: frame.origin.x, z: frame.origin.z, reach });
    return out;
  };
  // 霧濃到剩不到 2% 的距離（公尺）：比這更遠的東西畫了也看不到
  const SEE = Math.sqrt(-Math.log(0.02)) / HAZE;
  const haven = add(HAVEN, buildHaven, 4409, SEE + GROUND.size * 0.75);
  HAVEN_LAND.at = haven.groundAt;
  add(REEF_FRAMES.arch, buildArch, 5501, SEE + 40);
  add(REEF_FRAMES.atoll, buildAtoll, 5503, SEE + 90);
  const beacon = add(REEF_FRAMES.beacon, buildBeacon, 5507, 1e9);   // 燈標的燈不吃霧，再遠都要看得到
  tagSurfaces(false);
  const F = BEACON.flash;
  let tick = false;
  return {
    groups, rocks,
    beaconLamp: (() => { const [x, z] = REEF_FRAMES.beacon.toWorld(beacon.lamp[0], beacon.lamp[2]); return { x, y: beacon.lamp[1], z }; })(),
    update(time, cam) {
      beacon.bulb.visible = (time % F.period) < F.on;
      for (const p of parts) p.group.visible = (cam.x - p.x) ** 2 + (cam.z - p.z) ** 2 < p.reach * p.reach;
      // 小河的水：鏡頭在島附近才動（手機兩幀換一次顏色）
      if ((cam.x - parts[0].x) ** 2 + (cam.z - parts[0].z) ** 2 < 360 * 360 && (!TOUCH || (tick = !tick))) haven.river.update(time);
    },
  };
}
