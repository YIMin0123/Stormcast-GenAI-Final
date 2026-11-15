// 大港灣島的幾樣會動的東西。前兩樣是伺服器說了算、同房的人一起看得到的：
//   魚群熱點——幾隻海鳥在上空盤旋、水面一直翻白沫
//   漂流寶箱——一口木箱（在水裡的會跟著浪浮沉）
// 什麼時候有、在哪裡，照伺服器送來的狀態（見 server/extras.js 的 state）
//   瀑布的水花——每道瀑布落水的地方、小河沖進透天洞穴深潭的地方，一直濺著水花（鏡頭夠近才噴）
import * as THREE from 'three';
import { CHEST_SPOTS_W, CHESTS } from './extrasPlan.js';
import { riverHits } from './lowpoly/havenShape.js';
import { RIVER } from './lowpoly/havenPlan.js';
import { HAVEN } from './frame.js';
import { TOUCH } from './touch.js';

// scene 場景；shade(物件)：照遊戲的規則設定投影；splash(x, y, z, 幾滴)：水花；waterY(x, z)：海面高度；
// groundAt(x, z)：地面（或海底）高度；mist(x, y, z, 往哪邊 vx, vy, vz, 活幾秒, 多大)：噴一顆水珠；
// flood()：小河暴漲了幾成（0–1）；onHot(熱點)：冒出新的魚群時呼叫
export function makeHavenFx({ scene, shade, splash, mist, flood, waterY, groundAt, onHot }) {
  const group = new THREE.Group();
  scene.add(group);
  const lam = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const now = () => performance.now() / 1000;

  // ---- 魚群熱點：海鳥 ＋ 誘魚桶人工魚群 ----
  let hot = null, chums = [], foamAcc = 0, chumAcc = 0;
  const birds = [], flock = new THREE.Group();
  flock.visible = false;
  group.add(flock);
  {
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.14, 0, 0, 0.14, 0.62, 0, 0.02], 3));
    wing.computeVertexNormals();
    const body = new THREE.BoxGeometry(0.13, 0.1, 0.46), white = lam(0xf4f4ee), grey = new THREE.MeshLambertMaterial({ color: 0xb9c0c8, side: THREE.DoubleSide, flatShading: true });
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Group(), wl = new THREE.Mesh(wing, grey), wr = new THREE.Mesh(wing, grey);
      wr.scale.x = -1;
      g.add(new THREE.Mesh(body, white), wl, wr);
      flock.add(g);
      birds.push({ g, wl, wr, ang: Math.random() * 6.28, rad: 7 + Math.random() * 12, h: 8 + Math.random() * 7, sp: (0.35 + Math.random() * 0.35) * (i % 2 ? 1 : -1), ph: Math.random() * 6.28 });
    }
    shade(flock);
  }

  // ---- 瀑布落水的地方 ----
  const hits = riverHits().map((h) => { const [x, z] = HAVEN.toWorld(h.x, h.z); return { x, y: h.y, z, big: h.big, acc: 0 }; });
  const SPLASH_NEAR = 150, RATE = TOUCH ? 45 : 90;   // 多近才噴；一秒幾顆（手機減半）

  // ---- 漂流寶箱 ----
  const chests = new Map();   // id → { g, k, x, z, y, float }
  const chestGeo = [new THREE.BoxGeometry(0.9, 0.5, 0.6), new THREE.BoxGeometry(0.96, 0.18, 0.66), new THREE.BoxGeometry(0.08, 0.72, 0.68)];
  const chestMat = [lam(0x9a6b3c), lam(0x6e4a28), lam(0xd9b03a)];
  function addChest(id, k) {
    const s = CHEST_SPOTS_W[k];
    if (!s) return;
    const g = new THREE.Group(), body = new THREE.Mesh(chestGeo[0], chestMat[0]), lid = new THREE.Mesh(chestGeo[1], chestMat[1]);
    body.position.y = 0.25; lid.position.y = 0.59;
    g.add(body, lid);
    for (const a of [-0.3, 0.3]) { const band = new THREE.Mesh(chestGeo[2], chestMat[2]); band.position.set(a, 0.35, 0); g.add(band); }
    const gy = s.y ?? groundAt(s.x, s.z);
    g.rotation.y = (k * 1.7) % 6.28;
    g.position.set(s.x, Math.max(gy, -0.25), s.z);
    shade(g);
    group.add(g);
    chests.set(id, { g, k, x: s.x, z: s.z, float: gy < -0.25 });
  }

  return {
    // 伺服器送來的狀態：{ hot: { x, z, r, left, count, maxCount } | null, chums: [...], chests: [[id, 第幾個地點]] }
    sync(st) {
      const t = now();
      if (st.hot) {
        const fresh = !hot || Math.hypot(hot.x - st.hot.x, hot.z - st.hot.z) > 1;
        hot = { x: st.hot.x, z: st.hot.z, r: st.hot.r, until: t + st.hot.left, count: st.hot.count, maxCount: st.hot.maxCount };
        if (fresh && onHot) onHot(hot);
      } else hot = null;
      chums = Array.isArray(st.chums) ? st.chums.map((c) => ({ ...c, until: t + c.left })) : [];
      const keep = new Set(st.chests.map((c) => c[0]));
      for (const [id, c] of chests) if (!keep.has(id)) { c.g.removeFromParent(); chests.delete(id); }
      for (const [id, k] of st.chests) if (!chests.has(id)) addChest(id, k);
    },
    update(dt, time, cam) {
      const t = now();
      if (hot && t > hot.until) hot = null;
      chums = chums.filter((c) => t <= c.until && c.count > 0);
      flock.visible = !!hot;
      if (hot) {
        for (const b of birds) {
          b.ang += b.sp * dt;
          b.g.position.set(hot.x + Math.cos(b.ang) * b.rad, b.h, hot.z + Math.sin(b.ang) * b.rad);
          b.g.rotation.y = -b.ang + (b.sp < 0 ? Math.PI : 0);
          const f = Math.sin(time * 9 + b.ph) * 0.6;
          b.wl.rotation.z = f; b.wr.rotation.z = -f;
        }
        // 水面翻白沫（鏡頭夠近才噴）
        if ((cam.x - hot.x) ** 2 + (cam.z - hot.z) ** 2 < 260 * 260 && (foamAcc += dt) > 0.1) {
          foamAcc = 0;
          const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * hot.r * 0.8, x = hot.x + Math.cos(a) * d, z = hot.z + Math.sin(a) * d;
          splash(x, waterY(x, z), z, 5);
        }
      }
      if (chums.length && (chumAcc += dt) > 0.18) {
        chumAcc = 0;
        for (const c of chums) {
          if ((cam.x - c.x) ** 2 + (cam.z - c.z) ** 2 < 180 * 180) {
            const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * c.r * 0.75, x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
            splash(x, waterY(x, z), z, 3);
          }
        }
      }
      // 瀑布的水花：落水的那一點往四周、往上濺，沖進深潭的那一道濺得比較高、比較散
      for (const h of hits) {
        if ((cam.x - h.x) ** 2 + (cam.z - h.z) ** 2 > SPLASH_NEAR * SPLASH_NEAR) { h.acc = 0; continue; }
        const fl = flood(), k = (h.big ? 1.5 : 1) * (1 + 0.5 * fl), hy = h.y + (h.big ? 0 : RIVER.flood.rise * fl);   // 暴漲時濺得更多、更高
        for (h.acc += Math.min(dt, 0.05) * RATE * k * (1 + fl); h.acc >= 1; h.acc--) {
          const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * 1.5 * k, v = (0.6 + Math.random() * 1.8) * k;
          mist(h.x + Math.cos(a) * r, hy + 0.05, h.z + Math.sin(a) * r, Math.cos(a) * v, (1.6 + Math.random() * 2.6) * k, Math.sin(a) * v, 0.45 + Math.random() * 0.55, 0.22 + Math.random() * 0.4 * k);
        }
      }
      for (const c of chests.values()) if (c.float) { c.g.position.y = waterY(c.x, c.z) - 0.22; c.g.rotation.z = Math.sin(time * 1.3 + c.k) * 0.08; }
    },
    hot: () => hot,
    chums: () => chums,
    // 人站在哪個寶箱旁邊：回傳 { id, pos }；沒有就 null
    chestNear(x, y, z) {
      for (const [id, c] of chests) if (Math.hypot(x - c.x, z - c.z) < CHESTS.reach && Math.abs(y - c.g.position.y) < 3) return { id, pos: c.g.position.clone().setY(c.g.position.y + 0.4) };
      return null;
    },
  };
}
