// 探險大港灣島和海上的礁石群：遊戲這一側。模型由 lowpoly/haven3d.js、lowpoly/reefs3d.js 蓋（各自的設計圖座標），
// 這裡把它們擺進世界、把擋路的東西轉成世界座標，並負責每幀的小事（燈標閃光、太遠就不畫）。
import * as THREE from 'three';
import { rng, tagSurfaces } from './lowpoly/kit.js';
import { palette } from './lowpoly/palette.js';
import { buildHaven } from './lowpoly/haven3d.js';
import { buildArch, buildAtoll, buildBeacon } from './lowpoly/reefs3d.js';
import { buildSeaYard } from './lowpoly/seaYard3d.js';
import { REACH as YARD_REACH } from './lowpoly/seaYardPlan.js';
import { SITE_SHELF_W } from './layout.js';
import { GROUND } from './lowpoly/havenPlan.js';
import { BEACON } from './lowpoly/reefPlan.js';
import { HAVEN, REEF_FRAMES, SEA_YARD, placeInFrame } from './frame.js';
import { TOUCH } from './touch.js';
import { HAZE, riverVert, riverFrag } from './renderShaders.js';

// 大港灣島畫出來的地面多高（大港座標）：at(x, z)。走路踩的是它（見 main.js 的 landAt）
export const HAVEN_LAND = { at: null };
export const HAVEN_GROUND = GROUND;

// mat：全場共用的那個低面材質（港口建的那一個）。sea：{ uniforms 海面那一組 uniforms, paintSky 倒影映不映畫好的積雲 }——小河的水跟海面用同一組，天色才一致
// 回傳 { groups 要加進場景的東西, rocks 擋路的岩塊與樹幹（世界座標）[{ x, z, r, top }], update(時間, 鏡頭位置) 每幀呼叫,
//   tags 修船屋和大港的價格牌（順序跟 layout.js 的 SITE_SHELF_W 一樣）, unlit 不吃光的材質, sites 兩個據點晚上的燈, light(glow) 每幀調燈 }
export function makeSeascape(mat, sea) {
  const P = palette('warm');
  tagSurfaces(!TOUCH);   // 電腦版：每一面記下材質種類（岩石的程式貼圖），跟港口一樣
  const rocks = [], groups = [], parts = [];
  // 小河、瀑布、水潭的水：跟海面同一種混色方式（畫面的 alpha 是「是不是天空」的記號，水要把它蓋成 1）
  const water = new THREE.ShaderMaterial({
    vertexShader: riverVert, fragmentShader: riverFrag, uniforms: sea.uniforms, transparent: true, side: THREE.DoubleSide,
    defines: TOUCH ? { RIVER_LITE: 1 } : sea.paintSky ? { PAINT_SKY: 1 } : {},
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
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
  const add = (frame, build, seed, reach, more = {}) => {
    const group = new THREE.Group();
    const out = build({ P, r: rng(seed), place: placer(group), mat, group, phone: TOUCH, water, ...more });
    placeInFrame(group, frame);
    for (const k of out.rocks) { const [x, z] = frame.toWorld(k.x, k.z); rocks.push({ ...k, x, z }); }
    groups.push(group);
    parts.push({ group, x: frame.origin.x, z: frame.origin.z, reach });
    return out;
  };
  // 霧濃到剩不到 2% 的距離（公尺）：比這更遠的東西畫了也看不到
  const SEE = Math.sqrt(-Math.log(0.02)) / HAZE;
  const haven = add(HAVEN, buildHaven, 4409, SEE + GROUND.size * 0.75, { shelves: SITE_SHELF_W.filter((s) => s.site === 'haven') });
  HAVEN_LAND.at = haven.groundAt;
  // 海上修船屋：引航燈不吃霧，再遠都要看得到
  const yard = add(SEA_YARD, buildSeaYard, 6101, 1e9, { shelves: SITE_SHELF_W.filter((s) => s.site === 'yard') });
  const yardGroup = groups[groups.length - 1];
  add(REEF_FRAMES.arch, buildArch, 5501, SEE + 40);
  add(REEF_FRAMES.atoll, buildAtoll, 5503, SEE + 90);
  const beacon = add(REEF_FRAMES.beacon, buildBeacon, 5507, 1e9);   // 燈標的燈不吃霧，再遠都要看得到
  tagSurfaces(false);
  const F = BEACON.flash;
  const toW = (frame, [x, y, z]) => { const [wx, wz] = frame.toWorld(x, z); return { x: wx, y, z: wz }; };
  return {
    groups, rocks,
    // 大港碼頭、海上修船屋的繫纜樁（世界座標）
    bollards: [...haven.bollards.map((b) => toW(HAVEN, [b.x, b.y, b.z])), ...yard.bollards.map((b) => toW(SEA_YARD, [b.x, b.y, b.z]))],
    // 價格牌（照 SITE_SHELF_W 的順序：修船屋的在前、大港的在後）、不吃光的材質（招牌、價格牌：晚上要跟著變暗）
    tags: [...yard.tags, ...haven.port.tags],
    unlit: [...yard.unlit, ...haven.port.unlit],
    // 兩個據點晚上的燈（世界座標）：人到了那裡，母港那幾盞會照亮東西的燈就搬過去用（見 main.js）
    sites: {
      yard: { x: SEA_YARD.origin.x, z: SEA_YARD.origin.z, lamps: yard.lamps.map((p) => toW(SEA_YARD, p)) },
      haven: { x: HAVEN.origin.x, z: HAVEN.origin.z, lamps: haven.port.lamps.map((p) => toW(HAVEN, p)) },
    },
    havenLamp: toW(HAVEN, haven.port.lamp),   // 大燈塔的燈（旋轉光束從這裡照出去）
    light(glow) { yard.light(glow); haven.port.light(glow); },
    beaconLamp: (() => { const [x, z] = REEF_FRAMES.beacon.toWorld(beacon.lamp[0], beacon.lamp[2]); return { x, y: beacon.lamp[1], z }; })(),
    update(time, cam) {
      beacon.bulb.visible = (time % F.period) < F.on;
      for (const p of parts) p.group.visible = (cam.x - p.x) ** 2 + (cam.z - p.z) ** 2 < p.reach * p.reach;
      // 修船屋：太遠就只留引航燈（整座平台已經被霧蓋掉）
      const near = (cam.x - SEA_YARD.origin.x) ** 2 + (cam.z - SEA_YARD.origin.z) ** 2 < (SEE + YARD_REACH) ** 2;
      for (const o of yardGroup.children) if (o !== yard.beaconMesh) o.visible = near;
    },
  };
}
