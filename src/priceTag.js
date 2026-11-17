// 商品的價格牌：一塊小畫布貼在一片面上（母港的商店、海上修船屋、大港灣島都用這個）。只碰 three.js，不碰遊戲狀態
import * as THREE from 'three';

// 一塊價格牌的畫布和貼圖
export function makeTag() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;   // 斜著看遠處的地面、牆面時紋路才不會閃爍
  return { c, t };
}
// 把三行字 [品名, 說明, 價錢] 畫到一塊價格牌上（tag = makeTag() 的回傳）
export function drawTag(tag, lines) {
  const { c, t } = tag, g = c.getContext('2d');
  g.fillStyle = '#5b3a1e'; g.fillRect(0, 0, 256, 160);
  g.fillStyle = '#efe2bd'; g.fillRect(5, 5, 246, 150);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const font = (px) => `bold ${px}px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif`;
  g.fillStyle = '#3a2412'; g.font = font(lines[0].length > 6 ? 24 : lines[0].length > 5 ? 28 : 36); g.fillText(lines[0], 128, 34);
  g.fillStyle = '#6a4a2a'; g.font = font(lines[1].length > 11 ? 16 : lines[1].length > 9 ? 19 : 22); g.fillText(lines[1], 128, 78);
  g.fillStyle = '#a3261a'; g.font = font(lines[2].length > 7 ? 30 : 40); g.fillText(lines[2], 128, 124);
  t.needsUpdate = true;
}
// 價格牌的那片面（寬 0.72、高 0.45）。回傳 { mesh, mat }；mat 不吃光（晚上要跟著環境變暗的話由外面處理）
export function tagPlane(tag) {
  const mat = new THREE.MeshBasicMaterial({ map: tag.t, toneMapped: false });
  return { mesh: new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.45), mat), mat };
}
// 一塊有字的招牌貼圖（深色木頭看板＋米白色的字）：w × h 公尺
export function signTexture(text, w, h) {
  const PX = 160, c = document.createElement('canvas');
  c.width = Math.round(w * PX); c.height = Math.round(h * PX);
  const g = c.getContext('2d'), W = c.width, H = c.height;
  g.fillStyle = '#4a2f1c'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(${i % 2 ? '255,220,170' : '0,0,0'},${0.04 + (i * 37 % 10) / 160})`; g.lineWidth = 1 + (i % 3); const y = (i * 53 % 97) / 97 * H; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + ((i * 17) % 9) - 4); g.stroke(); }
  g.strokeStyle = '#2b1a0e'; g.lineWidth = H * 0.08; g.strokeRect(0, 0, W, H);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold ${Math.round(Math.min(H * 0.62, W * 0.86 / Math.max(1, text.length)))}px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", serif`;
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillText(text, W / 2 + 3, H / 2 + 4);
  g.fillStyle = '#f3e3bd'; g.fillText(text, W / 2, H / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
