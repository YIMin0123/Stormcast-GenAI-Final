// 游泳的人跟水面的互動：划水濺起的水花、踢腳的白沫、一圈一圈往外擴散的波紋、身邊那圈碎沫，
// 還有從水裡跳出來、落回去的水花。自己和別的玩家都算。
//
// 波紋：每一下划水、游動時每隔一小段時間，在水面上記一個「波紋事件」(x, z, 產生時間, 強度)，
// 海面的著色器從那一點畫出往外擴散的一圈小浪（幾個浪峰，越擴越淡）。人一邊游一邊留下事件，
// 一圈圈疊起來就成了身後那個 V 字形的尾波。
// 身邊的碎沫：最多四個人，(x, z, 速度, 有沒有在水裡) 交給著色器在身體周圍畫一圈白沫。
// 近岸的淺水模擬：人當成一個會推水的東西交給 shallow.js，在那裡真的推出會傳開、碰到岸壁反彈的水波。
import * as THREE from 'three';

export const RIP_N = 24;     // 同時記得幾個波紋事件
export const SWIMMER_N = 4;  // 身邊碎沫最多畫幾個人

export function makeSwimFx({ spray, waterY, shallow }) {
  const rip = Array.from({ length: RIP_N }, () => new THREE.Vector4(0, 0, -1e6, 0));
  const swimmers = Array.from({ length: SWIMMER_N }, () => new THREE.Vector4(0, 0, 0, 0));   // (x, z, 速度, 1 + 面向)
  let ripI = 0;
  const state = new WeakMap();   // 每個人上一幀的狀態

  function ripple(x, z, t, amp) {
    rip[ripI].set(x, z, t, amp);
    ripI = (ripI + 1) % RIP_N;
  }

  // 一小撮水花：n 顆，往上 up、往旁邊 out 公尺／秒
  function spurt(x, y, z, n, up, out, size, dirX = 0, dirZ = 0) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = out * (0.3 + 0.7 * Math.random());
      spray.emit(x, y, z, Math.cos(a) * r + dirX, up * (0.6 + 0.6 * Math.random()), Math.sin(a) * r + dirZ, 0.25 + 0.3 * Math.random(), size * (0.5 + 0.7 * Math.random()));
    }
  }

  // figs：這一幀要算的人（Player 物件：pos、yaw、phase、moving、run、swim、h）；cam：鏡頭位置（遠的人只畫波紋、不噴水花）
  function update(dt, figs, time, cam) {
    const near = [];
    for (const f of figs) {
      if (!f) continue;
      let s = state.get(f);
      if (!s) state.set(f, (s = { swim: f.swim, half: Math.floor(f.phase / Math.PI), tick: 0, kick: 0 }));
      const x = f.pos.x, z = f.pos.z, wy = waterY(x, z);
      const fx = Math.cos(f.yaw), fz = Math.sin(f.yaw);
      const close = Math.hypot(x - cam.x, z - cam.z) < 70;
      // 從水裡跳出來：一大撮水花、一圈大波紋（落回去的水花由 main.js 的下水那一下負責，這裡補波紋）
      if (s.swim && !f.swim && f.h > 0) {
        if (close) spurt(x, wy + 0.1, z, 30, 3.4, 1.3, 0.14);
        ripple(x, z, time, 1.3);
      }
      if (!s.swim && f.swim) ripple(x, z, time, 1.6);
      s.swim = f.swim;
      if (!f.swim) { s.half = Math.floor(f.phase / Math.PI); continue; }

      const fast = f.moving && f.run;
      // 划水：手臂每划半圈，一隻手在身體前面拍進水裡（兩手輪流）
      const half = Math.floor(f.phase / Math.PI);
      if (half !== s.half) {
        s.half = half;
        const side = half % 2 === 0 ? 1 : -1;
        const reach = f.moving ? 1.05 : 0.45;   // 趴著游時手伸到頭的前面
        const hx = x + fx * reach - fz * 0.28 * side, hz = z + fz * reach + fx * 0.28 * side;
        if (f.moving) {
          if (close) spurt(hx, wy + 0.05, hz, fast ? 14 : 9, fast ? 2.4 : 1.8, 0.5, 0.07, fx * 0.5, fz * 0.5);
          ripple(hx, hz, time, fast ? 0.7 : 0.5);
        } else {
          // 踩水：手在水面下輕輕撥，只有一點點波紋，偶爾一兩滴
          if (close && Math.random() < 0.4) spurt(hx, wy + 0.03, hz, 2, 0.7, 0.25, 0.05);
          ripple(x + fx * 0.3 * side, z + fz * 0.3 * side, time, 0.3);
        }
      }
      // 游動時每隔一小段在身體那裡留一個波紋（疊成身後的 V 字尾波）；踢腳在身後打出白沫
      s.tick += dt;
      if (f.moving && s.tick > 0.1) {
        s.tick = 0;
        ripple(x + fx * 0.6, z + fz * 0.6, time, fast ? 0.6 : 0.45);
      } else if (!f.moving && s.tick > 1.1) {
        s.tick = 0;
        ripple(x, z, time, 0.25);   // 停著不動，身體一上一下也會推出淡淡的一圈
      }
      s.kick += dt;
      if (f.moving && close && s.kick > (fast ? 0.07 : 0.11)) {
        s.kick = 0;
        const kx = x - fx * 0.9 + (Math.random() - 0.5) * 0.3, kz = z - fz * 0.9 + (Math.random() - 0.5) * 0.3;
        spurt(kx, wy + 0.02, kz, fast ? 5 : 3, fast ? 1.5 : 1.0, 0.3, 0.06, -fx * 0.3, -fz * 0.3);
      }
      // 人是趴著游的：身體的中心在腳的前面（停著踩水時是直的，只往前一點點）
      const c = f.moving ? 0.55 : 0.15;
      near.push({ f, x: x + fx * c, z: z + fz * c, d: Math.hypot(x - cam.x, z - cam.z) });
    }
    // 身邊那圈碎沫、近岸推水：取離鏡頭最近的幾個人
    near.sort((a, b) => a.d - b.d);
    const pokes = [];
    for (let i = 0; i < SWIMMER_N; i++) {
      const n = near[i];
      if (!n) { swimmers[i].set(0, 0, 0, 0); continue; }
      const sp = n.f.moving ? (n.f.run ? 2.3 : 1.6) : 0;
      const yaw = ((n.f.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      swimmers[i].set(n.x, n.z, sp, 1 + yaw);   // w：1 + 面向（> 0 表示有人）
      pokes.push({ x: n.x, z: n.z, vx: Math.cos(n.f.yaw) * sp, vz: Math.sin(n.f.yaw) * sp });
    }
    if (shallow) shallow.pokes = pokes;
  }

  return { rip, swimmers, update, ripple };
}
