// 拿在手上的平板（3D）：自己拿出平板時角色雙手捧著，別人也看得到。
// 螢幕上畫的是他正在看的畫面（主畫面或哪個 app，簡化過的樣子，每種畫一次重複用）
import * as THREE from 'three';

// 平板的大小（公尺）：寬（左右，兩隻手握在兩側）、高（螢幕上下）
const W = 0.38, H = 0.26, T = 0.014, BEZEL = 0.014;
const CARRY = 1.15;   // 捧東西時手臂往前抬的角度（跟 player.js 的 carry 一樣）
const TILT = 1.0;     // 螢幕往人臉那邊斜的角度
// 螢幕畫面的順序：0 主畫面，之後照平板上 app 的順序（tabletApps.js）
export const SCREENS = ['home', 'map', 'boat', 'weather', 'dex', 'bag', 'room', 'set'];
const ICON_COL = ['#2c8fc9', '#ff7f5c', '#5fb3dd', '#1d6f9f', '#e2a03d', '#3dbb7a', '#6f8394'];
const APP_NAME = { map: '地圖', boat: '船', weather: '天氣', dex: '圖鑑', bag: '背包', room: '房間', set: '設定' };
const FONT = '"Huninn", "Microsoft JhengHei", "PingFang TC", sans-serif';

const tex = new Map();
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); }
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
    g.fillStyle = 'rgba(214, 241, 251, 0.9)'; rr(g, 18, 22, 166, 70, 14); rr(g, 200, 22, 166, 70, 14);
    g.fillStyle = '#1d6f9f'; g.font = `30px ${FONT}`; g.fillText('8:00', 32, 66);
    g.fillStyle = '#3dbb7a'; rr(g, 214, 52, 120, 8, 4); rr(g, 214, 70, 90, 8, 4);
    ICON_COL.forEach((c, k) => { g.fillStyle = c; rr(g, 22 + (k % 6) * 58, 112 + Math.floor(k / 6) * 62, 42, 42, 11); });
  } else {
    g.fillStyle = '#cdedf9'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d6f9f'; g.font = `22px ${FONT}`; g.fillText(APP_NAME[key], 20, 36);
    const card = (x, y, cw, ch) => { g.fillStyle = 'rgba(240, 250, 254, 0.95)'; rr(g, x, y, cw, ch, 12); };
    if (key === 'map') {
      g.fillStyle = '#2a6e9e'; rr(g, 18, 50, 200, 200, 12);
      g.fillStyle = '#9fc07a'; g.beginPath(); g.ellipse(70, 92, 18, 13, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(160, 200, 34, 28, 0, 0, 7); g.fill();
      g.fillStyle = '#ffd257'; g.beginPath(); g.moveTo(92, 104); g.lineTo(80, 98); g.lineTo(82, 110); g.fill();
      g.fillStyle = '#2c8fc9'; [0, 1, 2, 3].forEach((k) => rr(g, 232, 54 + k * 34, 120, 24, 12));
    } else if (key === 'boat') {
      for (const y of [52, 152]) { card(18, y, 348, 90); g.fillStyle = '#3dbb7a'; rr(g, 36, y + 34, 250, 10, 5); rr(g, 36, y + 56, 190, 10, 5); g.fillStyle = '#ff7f5c'; rr(g, 36, y + 72, 90, 12, 6); }
    } else if (key === 'weather') {
      card(18, 52, 170, 190); card(200, 52, 166, 190);
      g.strokeStyle = '#8fd0ea'; g.lineWidth = 5; g.beginPath(); g.arc(103, 140, 54, 0, 7); g.stroke();
      g.fillStyle = '#2c8fc9'; g.beginPath(); g.moveTo(138, 105); g.lineTo(70, 168); g.lineTo(80, 178); g.fill();
      g.fillStyle = 'rgba(63, 97, 120, 0.4)'; [0, 1, 2, 3].forEach((k) => rr(g, 216, 80 + k * 36, 130 - k * 14, 12, 6));
    } else if (key === 'dex') {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
        card(18 + c * 58, 52 + r * 66, 52, 58);
        g.fillStyle = (r * 6 + c) % 4 === 0 ? '#2c8fc9' : 'rgba(31, 58, 80, 0.25)';
        g.beginPath(); g.ellipse(44 + c * 58, 78 + r * 66, 17, 8, 0, 0, 7); g.fill();
      }
    } else if (key === 'set') {   // 設定：兩欄卡片，裡面有開關
      for (let k = 0; k < 4; k++) {
        const x = 18 + (k % 2) * 178, y = 52 + Math.floor(k / 2) * 98;
        card(x, y, 170, 88);
        g.fillStyle = 'rgba(63, 97, 120, 0.45)'; rr(g, x + 14, y + 16, 70, 10, 5); rr(g, x + 14, y + 52, 80, 10, 5);
        g.fillStyle = k % 3 ? '#2c8fc9' : 'rgba(31, 58, 80, 0.25)'; rr(g, x + 112, y + 44, 44, 24, 12);
      }
    } else {   // 背包、房間：一排一排
      for (let k = 0; k < 4; k++) {
        card(18, 52 + k * 50, 348, 40);
        g.fillStyle = key === 'room' ? '#3dbb7a' : '#e2a03d'; g.beginPath(); g.arc(40, 72 + k * 50, 8, 0, 7); g.fill();
        g.fillStyle = 'rgba(63, 97, 120, 0.45)'; rr(g, 60, 66 + k * 50, 160 - k * 20, 12, 6);
      }
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  tex.set(key, t);
  return t;
}

let caseMat = null;
// 一塊平板：躺在 XZ 平面、螢幕朝上（+Y），寬邊沿 Z（人的左右）、螢幕的「上」朝 +X（人的前方）
export function makeTabletMesh(screen = 0) {
  if (!caseMat) caseMat = new THREE.MeshLambertMaterial({ color: 0x1b2731 });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(H, T, W), caseMat));
  const geo = new THREE.PlaneGeometry(W - 2 * BEZEL, H - 2 * BEZEL);
  geo.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)));
  const scr = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: screenTexture(screen), toneMapped: false }));
  scr.position.y = T / 2 + 0.001;
  g.add(scr);
  g.rotation.z = TILT;   // 螢幕往人臉那邊斜
  g.userData.tablet = true;
  g.userData.screen = scr;
  g.userData.shown = screen;
  return g;
}
// 換螢幕上的畫面
export function setTabletScreen(tab, screen) {
  if (tab.userData.shown === screen) return;
  tab.userData.shown = screen;
  tab.userData.screen.material.map = screenTexture(screen);
}

// 放到人偶的雙手之間：掛在上半身（腰那根骨頭）上，彎腰、晃動都跟著
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
export function holdTablet(fig, tab) {
  tab.userData.fig = fig;
  fig.userData.upper.add(tab);
  poseTablet(tab);
}
// 每一幀跟著兩隻手：手臂從垂下慢慢抬到「捧著」的姿勢，平板就從腰邊被拿起來、轉成螢幕朝臉。
// 回傳抬起來幾成（0 垂著、1 捧好了）：收起來時等手放下去再拿掉
export function poseTablet(tab) {
  const u = tab.userData.fig.userData, up = u.upper;
  const [l, r] = u.arms.map((a, i) => up.worldToLocal(a.userData.grip.getWorldPosition(i ? _b : _a)));
  const k = Math.min(1, Math.max(0, (u.arms[0].rotation.z + u.arms[1].rotation.z) / (2 * CARRY)));
  tab.position.set((l.x + r.x) / 2 + 0.01, (l.y + r.y) / 2 + 0.03, (l.z + r.z) / 2);
  tab.rotation.z = TILT + (1 - k) * 0.55;   // 剛拿起來時比較直立，抬到胸前才斜成看得到螢幕
  return k;
}
