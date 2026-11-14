// 魚市場前的一排看板：停船位置牌、本房紀錄、今日紀錄。
// 兩塊排行榜各顯示前 10 名，依單條魚的價值排：每筆有魚的標本（遊戲裡的魚模型，第 1 名那一格最大）、身長、重量、價值、玩家名字。
// 看板的字是畫在貼圖上的，晚上跟著碼頭的燈亮起來。
import * as THREE from 'three';
import { SPECIES, money } from './fishdata.js';
import { makeFishMesh } from './fish.js';
import { BOARDS, BOARD_Z, BOARD_H, BOARD_Y0, DECK_Y } from './layout.js';

const PX = 300;                       // 貼圖上一公尺幾個像素
const HEAD = 100, TOP = 150, ROW = 72; // 標題、第 1 名那一格、其餘每一格的高度（像素）
const FONT = '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
const wood = new THREE.MeshLambertMaterial({ color: 0x5b3d22 }), post = new THREE.MeshLambertMaterial({ color: 0x4a3320 }), roofMat = new THREE.MeshLambertMaterial({ color: 0xb5503a });

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

// 一塊立在地上的看板：兩根柱子、木框、上面一道小屋簷。回傳 { group, face }
function stand(x, w, h, y0) {
  const group = new THREE.Group(), f = face(w, h);
  const box = (bw, bh, bd, mat, bx, by, bz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat); m.position.set(bx, by, bz); group.add(m); return m; };
  box(w + 0.16, h + 0.16, 0.1, wood, 0, y0 + h / 2, -0.06);
  for (const side of [-1, 1]) box(0.12, y0 + h + 0.1 - DECK_Y, 0.12, post, side * (w / 2 + 0.02), (DECK_Y + y0 + h + 0.1) / 2, -0.1);
  box(w + 0.5, 0.08, 0.5, roofMat, 0, y0 + h + 0.2, 0.05).rotation.x = 0.28;
  f.mesh.position.set(0, y0 + h / 2, 0.001);
  group.add(f.mesh);
  group.position.set(x, 0, BOARD_Z);
  return { group, face: f };
}

export class Boards {
  constructor() {
    this.group = new THREE.Group();
    this.unlit = [];   // 不吃光照的材質（貼圖、標本）：白天照天色、晚上照燈光調亮度
    this.fish = { room: new THREE.Group(), daily: new THREE.Group() };
    this.boards = {};
    for (const key of ['room', 'daily']) {
      const s = stand(BOARDS[key].x, BOARDS[key].w, BOARD_H, BOARD_Y0);
      s.group.add(this.fish[key]);
      this.group.add(s.group);
      this.boards[key] = s.face;
      this.unlit.push(s.face.mat);
    }
    const b = stand(BOARDS.berth.x, BOARDS.berth.w, 1.5, DECK_Y + 0.95);
    this.group.add(b.group);
    this.berth = b.face;
    this.unlit.push(b.face.mat);
    this.set({ room: [], daily: [] });
    this.setBerth('', '', false);
  }

  // 伺服器給的兩份名單：[{ name, id 魚種, len, kg, value }]（已經照價值排好）
  set({ room, daily }) {
    this._draw('room', '本房紀錄', '這間房裡的人賣出最值錢的魚', room ?? []);
    this._draw('daily', '今日紀錄', '所有房間・每人一條・午夜重置', daily ?? []);
  }

  _draw(key, title, note, list) {
    const { cv, tex } = this.boards[key], g = cv.getContext('2d'), W = cv.width, H = cv.height;
    g.fillStyle = '#efe2bd'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#5b3a1e'; g.fillRect(0, 0, W, HEAD);
    g.textBaseline = 'middle';
    g.fillStyle = '#ffe9a8'; g.textAlign = 'left'; g.font = `bold 52px ${FONT}`; g.fillText(title, 28, HEAD / 2 + 2);
    g.fillStyle = '#dccba6'; g.textAlign = 'right'; g.font = `24px ${FONT}`; g.fillText(note, W - 26, HEAD / 2 + 8);
    const holder = this.fish[key];
    for (const m of [...holder.children]) { holder.remove(m); m.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); const i = this.unlit.indexOf(o.material); if (i >= 0) this.unlit.splice(i, 1); o.material.dispose(); } }); }
    const longest = Math.max(0.01, ...list.map((e) => e.len));
    for (let i = 0; i < 10; i++) {
      const y0 = HEAD + (i === 0 ? 0 : TOP + (i - 1) * ROW), h = i === 0 ? TOP : ROW, yc = y0 + h / 2, e = list[i];
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
      const boxW = 0.78, boxH = (h - 14) / PX;
      let len = boxW * (0.5 + 0.5 * e.len / longest);
      len = Math.min(len, boxH / sp.h);
      const m = makeFishMesh(sp, len);
      m.traverse((o) => {
        if (!o.isMesh) return;
        const old = o.material;
        o.material = new THREE.MeshBasicMaterial({ color: old.color, map: old.map, vertexColors: old.vertexColors, side: old.side });   // 魚身的顏色在貼圖上（貼圖是各魚種共用的快取，不跟著材質丟掉）
        o.material.userData.base = old.color.clone();
        old.dispose();
        this.unlit.push(o.material);
      });
      m.position.set(-cv.width / PX / 2 + (88 / PX) + boxW / 2 + 0.02, BOARD_Y0 + BOARD_H - yc / PX, 0.03 + len * sp.w * 0.5);
      holder.add(m);
    }
    tex.needsUpdate = true;
  }

  // 停船位置牌：你的船停在哪一格、是哪一艘；有別的船收在倉庫時提示可以換
  setBerth(label, boatName, canSwap) {
    const { cv, tex } = this.berth, g = cv.getContext('2d'), W = cv.width, H = cv.height;
    g.fillStyle = '#efe2bd'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#34507a'; g.fillRect(0, 0, W, 86);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#f3ead6'; g.font = `bold 44px ${FONT}`; g.fillText('停船位置', W / 2, 46);
    g.fillStyle = '#6a4a2a'; g.font = `30px ${FONT}`; g.fillText('你的船停在', W / 2, 140);
    g.fillStyle = '#a3261a'; g.font = `bold ${label.length > 3 ? 72 : 96}px ${FONT}`; g.fillText(label || '—', W / 2, 232);
    g.fillStyle = '#3a2412'; g.font = `bold 40px ${FONT}`; g.fillText(boatName, W / 2, 330);
    g.fillStyle = '#6a4a2a'; g.font = `26px ${FONT}`;
    g.fillText(canSwap ? '對準這裡按 E 換船' : '買了別的船', W / 2, 394);
    if (!canSwap) g.fillText('可以在這裡換', W / 2, 428);
    tex.needsUpdate = true;
  }

  // 亮度：白天跟著天色，天黑了看板自己的燈打亮
  light(lit, glow) {
    const v = Math.max(lit, 0.3 + 0.7 * glow);
    for (const m of this.unlit) m.color.copy(m.userData.base).multiplyScalar(v);
  }
}
