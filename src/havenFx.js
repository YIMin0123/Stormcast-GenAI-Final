// 伺服器說了算、同房的人一起看得到的三樣東西的畫面：
//   魚群熱點——幾隻海鳥在上空盤旋、水面一直翻白沫
//   漂流寶箱——一口木箱（在水裡的會跟著浪浮沉）
//   山頂的烽火——火焰和一柱往上飄的煙（遠遠在海上就看得到），還有古鐘的鐘聲（用算的，沒有錄音檔）
// 什麼時候有、在哪裡，照伺服器送來的狀態（見 server/extras.js 的 state）
import * as THREE from 'three';
import { CHEST_SPOTS_W, SUMMIT_W, CHESTS } from './extrasPlan.js';

// scene 場景；shade(物件)：照遊戲的規則設定投影；splash(x, y, z, 幾滴)：水花；waterY(x, z)：海面高度；
// groundAt(x, z)：地面（或海底）高度；audio：音效；onHot(熱點)：冒出新的魚群時呼叫
export function makeHavenFx({ scene, shade, splash, waterY, groundAt, audio, onHot }) {
  const group = new THREE.Group();
  scene.add(group);
  const lam = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const now = () => performance.now() / 1000;

  // ---- 魚群熱點：海鳥 ----
  let hot = null, foamAcc = 0;
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

  // ---- 山頂的烽火 ----
  let fireUntil = 0;
  const fire = new THREE.Group(), flames = [], smoke = [];
  fire.visible = false;
  group.add(fire);
  {
    const y0 = groundAt(SUMMIT_W.fire.x, SUMMIT_W.fire.z) + 2.5;
    fire.position.set(SUMMIT_W.fire.x, y0, SUMMIT_W.fire.z);
    const cone = new THREE.ConeGeometry(0.55, 1.6, 6);
    for (const [c, s, dx] of [[0xff7a1a, 1.25, 0], [0xffb02e, 0.9, 0.3], [0xffe07a, 0.6, -0.25]]) {
      const m = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: c, fog: false }));
      m.position.set(dx, 0.8 * s, dx * 0.6); m.scale.setScalar(s);
      fire.add(m); flames.push({ m, s, ph: dx * 7 });
    }
    const blob = new THREE.IcosahedronGeometry(0.7, 0), sm = lam(0x7d7f85);
    for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(blob, sm); m.castShadow = false; fire.add(m); smoke.push({ m, ph: i / 8 }); }
  }

  // 古鐘：幾個泛音疊起來、各自慢慢消掉。vol：0–1（離得遠的人聽到的比較小聲）
  function bell(vol) {
    const ctx = audio.ctx;
    if (!ctx || !audio.on || vol <= 0) return;
    const t = ctx.currentTime, out = ctx.createGain();
    out.gain.value = vol * 0.5;
    out.connect(audio.master || ctx.destination);
    for (const [ratio, amp, dec] of [[0.5, 0.5, 5], [1, 1, 4], [1.19, 0.6, 3], [1.5, 0.35, 2.4], [2, 0.5, 2], [2.51, 0.25, 1.4], [3.01, 0.18, 1]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 196 * ratio;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp * 0.3, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + dec + 0.1);
    }
  }

  return {
    // 伺服器送來的狀態：{ hot: { x, z, r, left } | null, chests: [[id, 第幾個地點]], fire: 還燒幾秒 }
    sync(st) {
      const t = now();
      if (st.hot) {
        const fresh = !hot || Math.hypot(hot.x - st.hot.x, hot.z - st.hot.z) > 1;
        hot = { x: st.hot.x, z: st.hot.z, r: st.hot.r, until: t + st.hot.left };
        if (fresh && onHot) onHot(hot);
      } else hot = null;
      const keep = new Set(st.chests.map((c) => c[0]));
      for (const [id, c] of chests) if (!keep.has(id)) { c.g.removeFromParent(); chests.delete(id); }
      for (const [id, k] of st.chests) if (!chests.has(id)) addChest(id, k);
      fireUntil = st.fire > 0 ? t + st.fire : 0;
    },
    update(dt, time, cam) {
      const t = now();
      if (hot && t > hot.until) hot = null;
      flock.visible = !!hot;
      if (hot) {
        for (const b of birds) {
          b.ang += b.sp * dt;
          b.g.position.set(hot.x + Math.cos(b.ang) * b.rad, b.h + Math.sin(time * 0.7 + b.ph) * 0.8, hot.z + Math.sin(b.ang) * b.rad);
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
      for (const c of chests.values()) if (c.float) { c.g.position.y = waterY(c.x, c.z) - 0.22; c.g.rotation.z = Math.sin(time * 1.3 + c.k) * 0.08; }
      const burning = fireUntil > t;
      fire.visible = burning;
      if (burning) {
        for (const f of flames) { const k = 1 + 0.25 * Math.sin(time * 11 + f.ph) + 0.12 * Math.sin(time * 23 + f.ph * 2); f.m.scale.set(f.s, f.s * k, f.s); f.m.position.y = 0.8 * f.s * k; }
        for (const s of smoke) {
          const a = (time / 9 + s.ph) % 1, k = 0.8 + a * 2.6;
          s.m.position.set(a * a * 7 + Math.sin(a * 9 + s.ph * 20) * 0.6, 1.5 + a * 26, Math.cos(a * 7 + s.ph * 13) * 0.6);
          s.m.scale.setScalar(k * Math.min(1, a * 8) * Math.min(1, (1 - a) * 5));
        }
      }
    },
    hot: () => hot,
    burning: () => fireUntil > now(),
    // 人站在哪個寶箱旁邊：回傳 { id, pos }；沒有就 null
    chestNear(x, y, z) {
      for (const [id, c] of chests) if (Math.hypot(x - c.x, z - c.z) < CHESTS.reach && Math.abs(y - c.g.position.y) < 3) return { id, pos: c.g.position.clone().setY(c.g.position.y + 0.4) };
      return null;
    },
    bell,
  };
}
