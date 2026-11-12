// 開發用的人物檢視頁（figure.html）：正面、左側、背面、右側、斜前方並排（正交鏡頭），和角色設定圖對照用。
// ?pose=walk 看走路，?outline 加描邊，?n=1&v=2 只看第 2 個視角（放大看細節）
import * as THREE from 'three';
import { addOutline } from './toon.js';
import { buildFigure } from './figure.js';

const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0xfcf4ee);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xfff8f2, 0xc9b5a8, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-2, 4, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 3, bottom: -3 });
sun.target.position.set(0, 0, 0);
scene.add(sun, sun.target);

// 視角：人物面向哪裡（人物的前方是 +X；鏡頭在 +Z 往 -Z 看）
const ANGLES = [-Math.PI / 2, Math.PI, Math.PI / 2, 0, -2.2];
// ?ref=back / side / q34 / front：只畫一個視角，右半邊並排放參考圖（放大到同樣的身高、腳底和身體中線對齊）；?op=0.5 改成疊在上面
// 參考圖放在 figref/（不進版本庫）。img：哪張圖；ax：圖上身體中線的 x；sole：腳底的 y；h：腳底到頭頂幾像素；rot：人物轉向
const REFS = {
  back: { img: '6', ax: 882, sole: 846, h: 614, rot: Math.PI / 2, x0: 705, x1: 1040 },
  side: { img: '6', ax: 522, sole: 847, h: 614, rot: Math.PI + 0.3, x0: 400, x1: 705 },
  q34: { img: '6', ax: 1222, sole: 849, h: 614, rot: -2.2, x0: 1060, x1: 1420 },
  front6: { img: '6', ax: 208, sole: 846, h: 614, rot: -1.8, x0: 50, x1: 400 },
  front: { img: '10', ax: 510, sole: 1324, h: 1213, rot: -1.83, x0: 150, x1: 960 },
};
const ref = REFS[q.get('ref')];
if (ref) {
  if (q.has('rot')) ref.rot = +q.get('rot');
  ANGLES[0] = ref.rot;
  const im = document.createElement('img');
  im.src = `/figref/${ref.img}.webp`;
  im.style.cssText = `position:fixed;left:0;top:0;transform-origin:0 0;pointer-events:none;opacity:${q.get('op') ?? 1}`;
  document.body.appendChild(im);
  ref.el = im;
}
const pick = ref ? [0] : q.has('v') ? [+q.get('v')] : ANGLES.map((_, i) => i);
const figs = pick.map((v, i) => {
  const f = buildFigure();
  if (q.has('outline')) addOutline(f);
  f.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), new THREE.MeshBasicMaterial({ color: 0xcdbfbb }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  f.position.x = i * 3;
  f.rotation.y = ANGLES[v];
  shadow.position.x = f.position.x;
  scene.add(f, shadow);
  return f;
});
// ?zoom=3&cy=1.25：放大看某個高度（例如頭）
const ZOOM = +q.get('zoom') || 1, CY = +(q.get('cy') ?? 0.85);
const cams = figs.map((f) => {
  const c = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  c.position.set(f.position.x, CY, 10);
  c.lookAt(f.position.x, CY, 0);
  return c;
});

const pose = q.get('pose');
let t = 0;
function draw() {
  t += 1 / 60;
  for (const f of figs) {
    const { legs, arms } = f.userData;
    if (pose === 'walk') {
      const s = Math.sin(t * 7) * 0.6;
      legs[0].rotation.z = s; legs[1].rotation.z = -s;
      arms[0].rotation.z = -s * 0.8; arms[1].rotation.z = s * 0.8;
    } else {
      // 站著：手臂往兩旁微微張開（跟遊戲裡站著不動時一樣）
      for (const a of arms) a.rotation.x = -a.userData.side * +(q.get('out') ?? 0.3);
    }
  }
  const W = innerWidth, H = innerHeight;
  renderer.setSize(W, H);
  renderer.setScissorTest(true);
  const half = 0.9 / ZOOM, w = ref && !q.has('op') ? W / 2 : W / figs.length, asp = w / H;
  if (ref) {
    // 一公尺在畫面上幾像素 → 參考圖要放大幾倍；腳底對到世界的 y = 0，身體中線對到視窗的中線
    const ppm = H / (2 * half), s = (ppm * 1.62) / ref.h;
    const ox = (q.has('op') ? 0 : w) + w / 2 - ref.ax * s, oy = H / 2 + CY * ppm - ref.sole * s;
    ref.el.style.transform = `translate(${ox}px, ${oy}px) scale(${s})`;
    ref.el.style.clipPath = `inset(0 ${ref.el.naturalWidth - ref.x1}px 0 ${ref.x0}px)`;
  }
  cams.forEach((c, i) => {
    c.left = -half * asp; c.right = half * asp; c.top = half; c.bottom = -half;
    c.updateProjectionMatrix();
    renderer.setViewport(i * w, 0, w, H);
    renderer.setScissor(i * w, 0, w, H);
    renderer.render(scene, c);
  });
}
// 瀏覽器面板藏起來時 requestAnimationFrame 不會跑，可以從外面呼叫 __fig.draw() 畫一張
function frame() { draw(); requestAnimationFrame(frame); }
frame();
ref?.el.addEventListener('load', draw);
// 量測：每隔 step 公尺高，輪廓的左右範圍，以及各色（B 咖啡、S 皮膚、R 紅、N 深藍、W 白；連續 4 格以上才算）的左右範圍
// （公尺，畫面右邊為正）。拿參考圖用同一套規則量出來的數字逐行對照
const PAL = { B: [100, 58, 42], S: [245, 188, 148], R: [200, 48, 44], N: [60, 55, 100], W: [238, 222, 216] };
function measure(step = 0.04) {
  draw();
  const gl = renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, w = Math.round(ref && !q.has('op') ? W / 2 : W / figs.length);
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const ppm = H / 1.8, out = [], f = (v) => (v >= 0 ? '+' : '') + v.toFixed(2);
  for (let k = 0, y = 1.68; y >= -1e-6; k++, y = 1.68 - k * step) {
    const row = Math.round(H / 2 + (y - 0.85) * ppm), cls = [];
    let fg0 = null, fg1 = null;
    for (let x = 0; x < w; x++) {
      const i = (row * W + x) * 4, c = [px[i], px[i + 1], px[i + 2]];
      if (Math.abs(c[0] - 252) + Math.abs(c[1] - 244) + Math.abs(c[2] - 238) < 36) { cls.push(null); continue; }
      fg0 ??= x; fg1 = x;
      let best = null, bd = 1e9;
      for (const n in PAL) { const p = PAL[n], d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2; if (d < bd) { bd = d; best = n; } }
      cls.push(best);
    }
    const parts = [];
    const wx = (x) => (x - w / 2) / ppm;
    if (fg0 !== null) parts.push(`|${f(wx(fg0))}..${f(wx(fg1))}|`);
    for (const n in PAL) {
      let a = null, b = null;
      for (let x = 0; x + 3 < w; x++) if (cls[x] === n && cls[x + 1] === n && cls[x + 2] === n && cls[x + 3] === n) { a ??= x + 1; b = x + 2; }
      if (a !== null) parts.push(`${n}${f(wx(a))}..${f(wx(b))}`);
    }
    out.push(y.toFixed(2) + ' ' + parts.join(' '));
  }
  return out.join('\n');
}
window.__fig = { figs, scene, renderer, draw, measure };
