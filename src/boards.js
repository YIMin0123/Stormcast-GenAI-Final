// 港口的排行榜看板。
//   母港商店正面東半邊一排三塊：漁會捐贈榜、本房紀錄、今日紀錄（自己有柱子、木框、小屋簷）。
//   大港榮譽榜亭裡第二組四塊：本房紀錄、今日紀錄、圖鑑榜、漁會捐贈榜（亭子和木框在 port3d.js，這裡只貼板面）。
// 魚的兩塊榜各顯示前幾名，依單條魚的價值排：每筆有魚的標本（遊戲裡的魚模型，第 1 名那一格最大）、身長、重量、價值、玩家名字。
// 功德榜（這一週捐給漁會最多的人，每週一重置）、圖鑑榜（這間房誰釣過的魚種最多）只有字。
// 看板的字是畫在貼圖上的，晚上跟著碼頭的燈亮起來。
import * as THREE from 'three';
import { SPECIES, money } from './fishdata.js';
import { makeFishMesh } from './fish.js';
import { BOARDS, BOARD_Z, BOARD_H, BOARD_Y0, DECK_Y } from './layout.js';
import { PORT, TOWN } from './lowpoly/havenPlan.js';
import { HAVEN, placeInFrame } from './frame.js';

const PX = 300;                       // 貼圖上一公尺幾個像素
const HEAD = 100, TOP = 150, ROW = 72; // 魚榜：標題、第 1 名那一格、其餘每一格的高度（像素，照 840 像素寬的板子算；窄的板子整張等比縮小）
const FISH_W = 840;
const FONT = '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
const wood = new THREE.MeshLambertMaterial({ color: 0x5b3d22 }), post = new THREE.MeshLambertMaterial({ color: 0x4a3320 }), roofMat = new THREE.MeshLambertMaterial({ color: 0xb5503a });

// 兩組看板：cols 每一塊 { id 哪一種榜, x, w }；z 板面在哪、y0 底邊多高、h 多高；base 地面多高；stand 要不要自己立柱子
const HOME_SET = { cols: ['donate', 'room', 'daily'].map((id) => ({ id, ...BOARDS[id] })), z: BOARD_Z, y0: BOARD_Y0, h: BOARD_H, base: DECK_Y, stand: true };
const HAVEN_SET = { cols: PORT.boards.cols, z: PORT.boards.z, y0: TOWN.y + PORT.boards.y0, h: PORT.boards.h, base: TOWN.y, stand: false };
const TITLES = {
  room: ['本房紀錄', '這間房裡的人賣出最值錢的魚'], daily: ['今日紀錄', '所有房間・每人一條・午夜重置'],
  donate: ['漁會捐贈榜', '本週捐款・每週一重置'], dex: ['圖鑑榜', '這間房誰釣過的魚種最多'],
};

function face(w, h) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * PX); cv.height = Math.round(h * PX);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  mat.userData.base = new THREE.Color(1, 1, 1);
  return { cv, tex, mat, mesh: new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat) };
}

// 一塊看板。自己立在地上的（母港）：兩根柱子、木框、上面一道小屋簷。回傳 { group, face }
function stand(x, w, set) {
  const group = new THREE.Group(), f = face(w, set.h), y0 = set.y0, h = set.h;
  if (set.stand) {
    const box = (bw, bh, bd, mat, bx, by, bz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat); m.position.set(bx, by, bz); group.add(m); return m; };
    box(w + 0.16, h + 0.16, 0.1, wood, 0, y0 + h / 2, -0.06);
    for (const side of [-1, 1]) box(0.12, y0 + h + 0.1 - set.base, 0.12, post, side * (w / 2 + 0.02), (set.base + y0 + h + 0.1) / 2, -0.1);
    box(w + 0.5, 0.08, 0.5, roofMat, 0, y0 + h + 0.2, 0.05).rotation.x = 0.28;
  }
  f.mesh.position.set(0, y0 + h / 2, 0.001);
  group.add(f.mesh);
  group.position.set(x, 0, set.z);
  return { group, face: f };
}

export class Boards {
  constructor() {
    this.group = new THREE.Group();   // 母港那一組（main.js 把它擺進港座標）
    this.haven = new THREE.Group();   // 大港榜亭那一組（這裡就擺好在大港的位置）
    this.unlit = [];   // 不吃光照的材質（貼圖、標本）：白天照天色、晚上照燈光調亮度
    this.faces = [];   // 每一塊：{ id, face, holder 放標本的, set }
    for (const [set, root] of [[HOME_SET, this.group], [HAVEN_SET, this.haven]]) {
      for (const c of set.cols) {
        const s = stand(c.x, c.w, set), holder = new THREE.Group();
        s.group.add(holder);
        root.add(s.group);
        this.faces.push({ id: c.id, face: s.face, holder, set });
        this.unlit.push(s.face.mat);
      }
    }
    placeInFrame(this.haven, HAVEN);
    this.set({});
  }

  // 伺服器給的名單：room、daily [{ name, id 魚種, len, kg, value }]（已經照價值排好）；
  // donate [{ name, amount, title, gold }]；dex [{ name, n 幾種, lv }]
  set({ room, daily, donate, dex } = {}) {
    this.room = room ?? [];
    this.daily = daily ?? [];
    this.donate = donate ?? [];
    this.dex = dex ?? [];
    for (const f of this.faces) {
      if (f.id === 'room' || f.id === 'daily') this._drawFish(f, this[f.id]);
      else if (f.id === 'donate') this._drawList(f, this.donate.map((e) => ({ name: e.name, sub: e.title || '', gold: !!e.gold, val: money(e.amount) })));
      else this._drawList(f, this.dex.map((e) => ({ name: e.name, sub: `Lv.${e.lv || 1}`, gold: false, val: `${e.n} 種` })));
    }
  }

  // 只有字的榜：名次、名字（底下一行小字）、右邊數字
  _drawList(f, rows) {
    const { cv, tex } = f.face, g = cv.getContext('2d'), W = cv.width, H = cv.height, [title, note] = TITLES[f.id], HD = 112, RH = (H - HD) / 10;
    g.fillStyle = '#efe2bd'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#5b3a1e'; g.fillRect(0, 0, W, HD);
    g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillStyle = '#ffe9a8'; g.font = `bold 44px ${FONT}`; g.fillText(title, 22, 42, W - 40);
    g.fillStyle = '#dccba6'; g.font = `20px ${FONT}`; g.fillText(note, 24, 88, W - 44);
    for (let i = 0; i < 10; i++) {
      const y0 = HD + i * RH, yc = y0 + RH / 2, e = rows[i];
      if (i % 2 === 1) { g.fillStyle = 'rgba(91, 58, 30, 0.08)'; g.fillRect(0, y0, W, RH); }
      g.strokeStyle = 'rgba(91, 58, 30, 0.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(10, y0 + RH); g.lineTo(W - 10, y0 + RH); g.stroke();
      g.textAlign = 'center';
      g.fillStyle = i === 0 ? '#c8961a' : i < 3 ? '#8a5a2a' : '#8d7a5c';
      g.font = `bold ${i === 0 ? 40 : 30}px ${FONT}`;
      g.fillText(String(i + 1), 32, yc + 2);
      g.textAlign = 'left';
      if (!e) { g.fillStyle = 'rgba(91, 58, 30, 0.3)'; g.font = `24px ${FONT}`; g.fillText('—', 70, yc); continue; }
      g.font = `bold 24px ${FONT}`;
      const vw = g.measureText(e.val).width;
      g.fillStyle = '#3a2412'; g.font = `bold 25px ${FONT}`;
      g.fillText(e.name, 66, yc - (e.sub ? 11 : 0), W - 66 - vw - 30);
      if (e.sub) { g.fillStyle = e.gold ? '#b07a08' : '#6a4a2a'; g.font = `${e.gold ? 'bold ' : ''}18px ${FONT}`; g.fillText(e.sub, 66, yc + 15, W - 66 - vw - 30); }
      g.textAlign = 'right';
      g.fillStyle = '#a3261a'; g.font = `bold 24px ${FONT}`;
      g.fillText(e.val, W - 14, yc);
    }
    tex.needsUpdate = true;
  }

  // 魚的榜：照 840 像素寬排版，窄的板子整張等比縮小（標本也跟著縮）
  _drawFish(f, list) {
    const { cv, tex } = f.face, g = cv.getContext('2d'), k = Math.min(1, cv.width / FISH_W), W = cv.width / k, H = cv.height / k, [title, note] = TITLES[f.id];
    const top = f.set.y0 + f.set.h, wM = cv.width / PX;
    g.save();
    g.scale(k, k);
    g.fillStyle = '#efe2bd'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#5b3a1e'; g.fillRect(0, 0, W, HEAD);
    g.textBaseline = 'middle';
    g.fillStyle = '#ffe9a8'; g.textAlign = 'left'; g.font = `bold 52px ${FONT}`; g.fillText(title, 28, HEAD / 2 + 2);
    g.fillStyle = '#dccba6'; g.textAlign = 'right'; g.font = `24px ${FONT}`; g.fillText(note, W - 26, HEAD / 2 + 8);
    const holder = f.holder;
    for (const m of [...holder.children]) { holder.remove(m); m.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); const i = this.unlit.indexOf(o.material); if (i >= 0) this.unlit.splice(i, 1); o.material.dispose(); } }); }
    const longest = Math.max(0.01, ...list.map((e) => e.len));
    for (let i = 0; i < 10; i++) {
      const y0 = HEAD + (i === 0 ? 0 : TOP + (i - 1) * ROW), h = i === 0 ? TOP : ROW, yc = y0 + h / 2, e = list[i];
      if (y0 + h > H + 1) break;   // 板子不夠高：排到放得下為止
      if (i % 2 === 1) { g.fillStyle = 'rgba(91, 58, 30, 0.08)'; g.fillRect(0, y0, W, h); }
      g.strokeStyle = 'rgba(91, 58, 30, 0.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(14, y0 + h); g.lineTo(W - 14, y0 + h); g.stroke();
      g.textAlign = 'center';
      g.fillStyle = i === 0 ? '#c8961a' : i < 3 ? '#8a5a2a' : '#8d7a5c';
      g.font = `bold ${i === 0 ? 76 : 44}px ${FONT}`;
      g.fillText(String(i + 1), 46, yc + 3);
      if (!e) { g.fillStyle = 'rgba(91, 58, 30, 0.3)'; g.font = `26px ${FONT}`; g.textAlign = 'left'; g.fillText('—', 350, yc); continue; }
      const sp = SPECIES[e.id] ?? SPECIES.sardine, big = i === 0;
      g.textAlign = 'left';
      g.fillStyle = '#3a2412'; g.font = `bold ${big ? 40 : 28}px ${FONT}`;
      g.fillText(e.name, 350, yc - (big ? 34 : 15));
      g.fillStyle = '#6a4a2a'; g.font = `${big ? 28 : 22}px ${FONT}`;
      g.fillText(`${sp.name}　${Math.round(e.len * 100)} 公分　${e.kg.toFixed(e.kg >= 100 ? 0 : e.kg >= 10 ? 1 : 2)} 公斤`, 350, yc + (big ? 30 : 17));
      g.textAlign = 'right';
      g.fillStyle = '#a3261a'; g.font = `bold ${big ? 48 : 30}px ${FONT}`;
      g.fillText(money(e.value), W - 22, yc - (big ? 30 : 13));
      // 標本：放在名次和文字中間那一格。同一塊板上越長的魚畫得越長（最短的也有一半長），再照魚的身高收進格子裡
      const boxW = 0.78 * k, boxH = (h - 14) * k / PX;
      let len = boxW * (0.5 + 0.5 * e.len / longest);
      len = Math.min(len, boxH / sp.h);
      const m = makeFishMesh(sp, len);
      m.traverse((o) => {
        if (!o.isMesh) return;
        const old = o.material;
        o.material = new THREE.MeshBasicMaterial({ color: old.color, map: old.map, vertexColors: old.vertexColors, side: old.side });   // 魚身的顏色在貼圖上（貼圖是各魚種共用的快取，不能改；這裡只換成不吃光照的材質）
        o.material.userData.base = old.color.clone();
        old.dispose();
        this.unlit.push(o.material);
      });
      m.position.set(-wM / 2 + (88 * k / PX) + boxW / 2 + 0.02 * k, top - yc * k / PX, 0.03 + len * sp.w * 0.5);
      holder.add(m);
    }
    g.restore();
    tex.needsUpdate = true;
  }

  // 亮度：白天跟著天色，天黑了看板自己的燈打亮
  light(lit, glow) {
    const v = Math.max(lit, 0.3 + 0.7 * glow);
    for (const m of this.unlit) m.color.copy(m.userData.base).multiplyScalar(v);
  }
}
