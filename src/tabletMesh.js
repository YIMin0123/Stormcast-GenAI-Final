// 拿在手上的平板（3D）：自己拿出平板時角色雙手捧著，別人也看得到。
// 螢幕上畫的是他正在看的畫面（主畫面或哪個 app，簡化過的樣子，每種畫一次重複用）
import * as THREE from 'three';

// 平板的大小（公尺）：寬（左右）、高（螢幕上下，寬高比跟網頁上的平板一樣 1.42）。兩手握在左右下側邊框，不擋螢幕也不穿背面
const W = 0.44, H = W / 1.42, T = 0.018, BEZEL = 0.02;
export const TABLET_SIZE = { w: W, h: H, t: T, bezel: BEZEL };
const CARRY = 1.15;   // 捧著平板時手臂往前抬的角度（跟 player.js 的 tabHold 一致）
const TILT = 0.85;    // 螢幕往人臉與上方斜的角度（玩家與旁人都看得見）
const UP_OFF = 0.130; // 沿螢幕往上推（貼近下緣左右角），讓雙手從下方托住而不擋到螢幕
const FRONT = 0.048;  // 沿螢幕法線往前推 4.8cm，讓背面穩靠雙手掌心且手掌不會穿過平板正面
// 螢幕畫面的順序：0 主畫面，1~8 對應伺服器 scr 0..8，9~10 為擴充畫面
export const SCREENS = ['home', 'map', 'boat', 'weather', 'dex', 'bag', 'room', 'notice', 'set', 'rank', 'shrine'];
const DOCK_COL = ['#2c8fc9', '#ff7f5c', '#e2a03d', '#1d6f9f'];
const GRID_COL = ['#5fb3dd', '#d89628', '#7a62d8', '#3dbb7a', '#ff7f5c', '#6f8394'];
const APP_NAME = { map: '地圖', boat: '船', bag: '背包', dex: '圖鑑', weather: '天氣', rank: '榜單', shrine: '祭壇', room: '房間', notice: '公告', set: '設定' };
const FONT = '"Huninn", "Microsoft JhengHei", "PingFang TC", sans-serif';

const tex = new Map();
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); }
function header(g, title, w) {
  g.fillStyle = '#cdedf9'; g.fillRect(0, 0, w, 263);
  g.fillStyle = 'rgba(255,255,255,0.6)'; rr(g, 16, 14, 72, 22, 11);
  g.fillStyle = '#1d6f9f'; g.font = `15px ${FONT}`; g.fillText('‹ 主畫面', 25, 30);
  g.font = `bold 20px ${FONT}`; g.fillText(title, 100, 32);
}
function drawAppGlyph(g, idx, cx, cy) {
  g.save();
  g.strokeStyle = g.fillStyle = '#fff';
  g.lineWidth = 2.6; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  if (idx === 0) {   // 地圖
    g.arc(cx, cy - 3, 7, Math.PI, 0); g.lineTo(cx, cy + 11); g.closePath(); g.stroke();
    g.beginPath(); g.arc(cx, cy - 3, 2.5, 0, 7); g.fill();
  } else if (idx === 1) {   // 船
    g.moveTo(cx - 12, cy + 2); g.lineTo(cx + 12, cy + 2); g.lineTo(cx + 8, cy + 10); g.lineTo(cx - 8, cy + 10); g.closePath(); g.fill();
    g.moveTo(cx, cy + 2); g.lineTo(cx, cy - 11); g.lineTo(cx + 9, cy - 1); g.stroke();
  } else if (idx === 2) {   // 天氣
    g.arc(cx - 5, cy + 2, 6, 0, 7); g.arc(cx + 2, cy - 2, 7, 0, 7); g.arc(cx + 8, cy + 3, 5, 0, 7); g.fill();
  } else if (idx === 3) {   // 圖鑑（魚）
    g.ellipse(cx - 1, cy, 9, 5.5, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(cx + 7, cy); g.lineTo(cx + 13, cy - 5); g.lineTo(cx + 13, cy + 5); g.closePath(); g.fill();
  } else if (idx === 4) {   // 背包
    g.roundRect(cx - 8, cy - 5, 16, 15, 4); g.stroke();
    g.beginPath(); g.arc(cx, cy - 5, 4.5, Math.PI, 0); g.stroke();
  } else if (idx === 5) {   // 房間（兩人）
    g.arc(cx - 4, cy - 4, 4, 0, 7); g.arc(cx + 5, cy - 3, 3.5, 0, 7); g.fill();
    g.beginPath(); g.arc(cx - 4, cy + 9, 7, Math.PI, 0); g.arc(cx + 5, cy + 9, 6, Math.PI, 0); g.fill();
  } else if (idx === 6) {   // 公告（鈴鐺）
    g.arc(cx, cy - 2, 7, Math.PI, 0); g.lineTo(cx + 9, cy + 7); g.lineTo(cx - 9, cy + 7); g.closePath(); g.fill();
    g.beginPath(); g.arc(cx, cy + 10, 2.5, 0, 7); g.fill();
  } else {   // 設定（齒輪）
    g.arc(cx, cy, 5, 0, 7); g.stroke();
    for (let a = 0; a < 6; a++) { const r = a * Math.PI / 3; g.moveTo(cx + Math.cos(r) * 7, cy + Math.sin(r) * 7); g.lineTo(cx + Math.cos(r) * 10, cy + Math.sin(r) * 10); }
    g.stroke();
  }
  g.restore();
}
// 畫一個畫面（384 × 263，跟螢幕同比例）
function screenTexture(i) {
  const key = SCREENS[i] || 'home';
  if (tex.has(key)) return tex.get(key);
  const cv = document.createElement('canvas');
  cv.width = 384; cv.height = 263;
  const g = cv.getContext('2d'), w = cv.width, h = cv.height;
  if (key === 'home') {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#6fc1ec'); sky.addColorStop(0.49, '#ffe2b4'); sky.addColorStop(0.51, '#4aa3d6'); sky.addColorStop(1, '#1d6f9f');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.6)'; rr(g, 18, 6, 92, 6, 3); rr(g, 280, 6, 86, 6, 3);
    g.fillStyle = 'rgba(214, 241, 251, 0.92)'; rr(g, 18, 20, 166, 68, 14); rr(g, 200, 20, 166, 68, 14);
    g.fillStyle = '#1d6f9f'; rr(g, 32, 34, 72, 18, 5); rr(g, 32, 60, 110, 8, 4);
    g.fillStyle = '#3dbb7a'; rr(g, 214, 44, 120, 8, 4); rr(g, 214, 62, 96, 8, 4);
    // 實際平板主畫面：中間 6 個桌面圖示 ＋ 底部毛玻璃 Dock 4 個圖示
    GRID_COL.forEach((c, k) => {
      const ix = 22 + k * 58, iy = 108;
      g.fillStyle = c; rr(g, ix, iy, 40, 40, 11);
      drawAppGlyph(g, (k + 2) % 8, ix + 20, iy + 20);
    });
    g.fillStyle = 'rgba(214, 241, 251, 0.36)'; rr(g, 74, 186, 236, 56, 16);
    DOCK_COL.forEach((c, k) => {
      const ix = 90 + k * 54, iy = 194;
      g.fillStyle = c; rr(g, ix, iy, 40, 40, 11);
      drawAppGlyph(g, k, ix + 20, iy + 20);
    });
    g.fillStyle = 'rgba(255,255,255,0.85)'; rr(g, w / 2 - 44, h - 10, 88, 4, 2);
  } else {
    header(g, APP_NAME[key] || '', w);
    const card = (x, y, cw, ch) => { g.fillStyle = 'rgba(240, 250, 254, 0.95)'; rr(g, x, y, cw, ch, 12); };
    if (key === 'map') {
      g.fillStyle = '#2a6e9e'; rr(g, 18, 48, 202, 202, 12);
      g.fillStyle = '#9fc07a'; g.beginPath(); g.ellipse(72, 92, 18, 13, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(160, 198, 34, 28, 0, 0, 7); g.fill();
      g.fillStyle = '#ffd257'; g.beginPath(); g.moveTo(92, 104); g.lineTo(80, 98); g.lineTo(82, 110); g.fill();
      g.fillStyle = '#2c8fc9'; [0, 1, 2, 3].forEach((k) => rr(g, 232, 54 + k * 34, 126, 24, 12));
    } else if (key === 'boat') {
      for (const y of [48, 150]) { card(18, y, 348, 92); g.fillStyle = '#3dbb7a'; rr(g, 34, y + 26, 250, 10, 5); rr(g, 34, y + 46, 190, 10, 5); g.fillStyle = '#ff7f5c'; rr(g, 34, y + 66, 94, 16, 8); }
    } else if (key === 'weather') {
      card(18, 48, 170, 196); card(200, 48, 166, 196);
      g.strokeStyle = '#8fd0ea'; g.lineWidth = 5; g.beginPath(); g.arc(103, 144, 54, 0, 7); g.stroke();
      g.fillStyle = '#2c8fc9'; g.beginPath(); g.moveTo(138, 109); g.lineTo(70, 172); g.lineTo(80, 182); g.fill();
      g.fillStyle = 'rgba(63, 97, 120, 0.4)'; [0, 1, 2, 3].forEach((k) => rr(g, 216, 78 + k * 36, 130 - k * 14, 12, 6));
    } else if (key === 'dex') {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
        card(18 + c * 52, 48 + r * 68, 46, 60);
        g.fillStyle = (r * 4 + c) % 3 === 0 ? '#2c8fc9' : 'rgba(31, 58, 80, 0.25)';
        g.beginPath(); g.ellipse(41 + c * 52, 76 + r * 68, 14, 7, 0, 0, 7); g.fill();
      }
      card(230, 48, 136, 196);
    } else if (key === 'bag') {
      card(18, 48, 348, 82); card(18, 140, 168, 106); card(198, 140, 168, 106);
      g.fillStyle = '#e2a03d'; rr(g, 34, 66, 120, 16, 8); rr(g, 34, 96, 86, 20, 10);
      g.fillStyle = '#ff7f5c'; rr(g, 214, 198, 110, 26, 10);
      g.fillStyle = 'rgba(63, 97, 120, 0.4)'; rr(g, 34, 164, 120, 12, 6); rr(g, 214, 164, 120, 12, 6);
    } else if (key === 'rank') {
      card(18, 48, 348, 196);
      for (let k = 0; k < 4; k++) {
        g.fillStyle = k === 0 ? '#d89628' : '#8fd0ea';
        rr(g, 34, 64 + k * 44, 24, 24, 12);
        g.fillStyle = 'rgba(63, 97, 120, 0.45)'; rr(g, 70, 70 + k * 44, 170, 12, 6);
        g.fillStyle = '#e2603d'; rr(g, 276, 70 + k * 44, 70, 12, 6);
      }
    } else if (key === 'shrine') {
      card(18, 48, 348, 66); card(18, 124, 168, 120); card(198, 124, 168, 120);
      g.fillStyle = '#7a62d8'; rr(g, 34, 66, 160, 16, 8);
      g.fillStyle = '#ff7f5c'; rr(g, 34, 204, 120, 24, 12); rr(g, 214, 204, 120, 24, 12);
    } else if (key === 'room') {
      card(18, 48, 348, 186);
      for (let k = 0; k < 4; k++) {
        g.fillStyle = k < 3 ? '#3dbb7a' : '#9eb2bf';
        g.beginPath(); g.arc(40, 74 + k * 42, 7, 0, 7); g.fill();
        g.fillStyle = 'rgba(63, 97, 120, 0.48)'; rr(g, 58, 68 + k * 42, 130, 12, 6);
        g.fillStyle = 'rgba(44, 143, 201, 0.35)'; rr(g, 266, 68 + k * 42, 82, 12, 6);
      }
    } else if (key === 'notice') {
      card(18, 48, 168, 88); card(198, 48, 168, 88); card(18, 148, 348, 102);
      g.fillStyle = '#1d6f9f'; rr(g, 224, 72, 116, 24, 6);
      g.fillStyle = '#ff7f5c'; rr(g, 196, 158, 32, 16, 8);
      g.fillStyle = 'rgba(63, 97, 120, 0.45)'; rr(g, 34, 66, 128, 10, 5); rr(g, 34, 88, 110, 10, 5);
      rr(g, 34, 160, 146, 12, 6); rr(g, 34, 186, 290, 10, 5); rr(g, 34, 206, 260, 10, 5);
    } else {   // 設定：兩欄卡片，裡面有開關
      for (let k = 0; k < 4; k++) {
        const x = 18 + (k % 2) * 178, y = 48 + Math.floor(k / 2) * 100;
        card(x, y, 170, 90);
        g.fillStyle = 'rgba(63, 97, 120, 0.45)'; rr(g, x + 14, y + 16, 70, 10, 5); rr(g, x + 14, y + 52, 80, 10, 5);
        g.fillStyle = k % 3 ? '#2c8fc9' : 'rgba(31, 58, 80, 0.25)'; rr(g, x + 112, y + 46, 44, 24, 12);
      }
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  tex.set(key, t);
  return t;
}

let caseMat = null, caseGeo = null;
function getCaseGeo() {
  if (caseGeo) return caseGeo;
  const hx = H / 2, hz = W / 2, r = W * (12 / 720);
  const sh = new THREE.Shape();
  sh.moveTo(-hx + r, -hz);
  sh.lineTo(hx - r, -hz); sh.quadraticCurveTo(hx, -hz, hx, -hz + r);
  sh.lineTo(hx, hz - r); sh.quadraticCurveTo(hx, hz, hx - r, hz);
  sh.lineTo(-hx + r, hz); sh.quadraticCurveTo(-hx, hz, -hx, hz - r);
  sh.lineTo(-hx, -hz + r); sh.quadraticCurveTo(-hx, -hz, -hx + r, -hz);
  const g = new THREE.ExtrudeGeometry(sh, { depth: T, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -T / 2);
  g.rotateX(-Math.PI / 2);
  return (caseGeo = g);
}
// 一塊平板：躺在 XZ 平面、螢幕朝上（+Y），寬邊沿 Z（人的左右）、螢幕的「上」朝 +X（人的前方）
export function makeTabletMesh(screen = 0, { fullFace = false } = {}) {
  if (!caseMat) caseMat = new THREE.MeshLambertMaterial({ color: 0x1b2731 });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(getCaseGeo(), caseMat));
  const gw = fullFace ? W : W - 2 * BEZEL, gh = fullFace ? H : H - 2 * BEZEL;
  const geo = new THREE.PlaneGeometry(gw, gh);
  geo.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)));
  const mat = new THREE.MeshBasicMaterial({ map: screenTexture(screen), toneMapped: false, transparent: fullFace, alphaTest: fullFace ? 0.1 : 0 });
  const scr = new THREE.Mesh(geo, mat);
  scr.position.y = T / 2 + 0.001;
  g.add(scr);
  if (!fullFace) {
    const camDot = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.001, 10), new THREE.MeshBasicMaterial({ color: 0x0b1218 }));
    camDot.position.set(H / 2 - BEZEL / 2, T / 2 + 0.0006, 0);
    g.add(camDot);
  }
  g.rotation.z = TILT;   // 螢幕往人臉那邊斜
  g.userData.tablet = true;
  g.userData.screen = scr;
  g.userData.shown = screen;
  return g;
}
// 換螢幕上的畫面（已有高解析即時貼圖 ownLive 時保留它，不蓋回簡化靜態畫）
export function setTabletScreen(tab, screen) {
  if (tab.userData.shown === screen) return;
  tab.userData.shown = screen;
  if (!tab.userData.ownLive) tab.userData.screen.material.map = screenTexture(screen);
}

// 放到人偶的雙手之間：掛在上半身（腰那根骨頭）上，彎腰、晃動都跟著
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
export function holdTablet(fig, tab) {
  tab.userData.fig = fig;
  fig.userData.upper.add(tab);
  poseTablet(tab);
}
// 每一幀跟著兩隻手：手臂抬起後雙手剛好拖在平板左右下角邊框下緣，完全不擋螢幕也不穿模。
// 回傳抬起來幾成（0 垂著、1 捧好了）：收起來時等手放下去再拿掉
export function poseTablet(tab) {
  const u = tab.userData.fig.userData, up = u.upper;
  const [l, r] = u.arms.map((a, i) => up.worldToLocal(a.userData.grip.getWorldPosition(i ? _b : _a)));
  const k = Math.min(1, Math.max(0, (u.arms[0].rotation.z + u.arms[1].rotation.z) / (2 * CARRY)));
  const a = tab.rotation.z = TILT + (1 - k) * 0.5;   // 剛拿起來時較垂直，抬到胸前斜向眼睛與身旁視線
  const upX = Math.cos(a) * UP_OFF - Math.sin(a) * FRONT, upY = Math.sin(a) * UP_OFF + Math.cos(a) * FRONT;
  tab.position.set((l.x + r.x) / 2 + upX, (l.y + r.y) / 2 + upY, (l.z + r.z) / 2);
  return k;
}
