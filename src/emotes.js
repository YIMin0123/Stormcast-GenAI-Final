// 動作與表情：按住 G 叫出輪盤，內圈選表情、外圈選動作，放開 G 播放。
// 表情維持 10 秒；動作播一次（揮手、點頭……）或一直重複到人走動為止（跳舞、坐在地上、躺下）。
// 人物這邊只有幾個關節可以轉（肩膀、髖部、腰、脖子），動作就是這幾個關節隨時間的角度，再加上整個人的高低、前後仰、左右晃。
import { FACES } from './figure.js';

export const MOOD_TIME = 10;   // 表情維持幾秒
export const FACE_NAMES = { normal: '普通', happy: '開心', surprised: '驚訝', thinking: '思考', closed: '閉眼', smile: '微笑', cry: '哭泣', wink: '眨眼' };

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
// 淡入、維持、淡出：0 → 1 → 0（inT 秒淡入，到 holdEnd 秒開始淡出，outT 秒淡完）
const env = (t, inT, holdEnd, outT) => smooth(t / inT) * (1 - smooth((t - holdEnd) / outT));
const both = (f) => [f(-1), f(1)];   // 左右各算一次（-1 = 左手邊，1 = 右手邊）

// 關節角度的意思（都是相對站好的姿勢）：
//   手臂 z：往前舉（正）／往後擺（負）；x：-side × 往外張開（張到 π 以上就是從旁邊舉過頭）；y：side × 往身體中間收
//   注意：手先用 z 舉高以後再加 x，方向會反過來往內收，所以舉過頭的動作用 x 從旁邊舉
//   腿 z：往前抬；腰 z：往前彎（負）／往後仰（正）、y：扭腰；頭 z：抬頭（正）／低頭（負）、x：歪頭
//   lift：整個人往上（負的是往下坐）；roll：整個人左右晃
// 只寫了的關節才會被動作接管，沒寫的照平常的樣子（例如點頭時手還是自然垂著）
export const ACTIONS = [
  { id: 'wave', name: '揮手', dur: 2.6, face: 'happy', pose: (t) => {
    const e = env(t, 0.3, 2.2, 0.4);
    return { arms: [null, { x: -(2.55 + 0.35 * Math.sin(t * 11)) * e, z: 0.25 * e }], head: { x: -0.08 * e, z: 0.06 * e } };
  } },
  { id: 'nod', name: '點頭', dur: 1.5, face: 'smile', pose: (t) => ({ head: { z: -0.32 * Math.max(0, Math.sin(t * Math.PI * 2 / 0.75)) } }) },
  { id: 'bow', name: '鞠躬', dur: 2.4, face: 'closed', pose: (t) => {
    const e = env(t, 0.5, 1.6, 0.6);
    return { waist: { z: -0.7 * e }, head: { z: -0.15 * e }, arms: both((s) => ({ z: 0.85 * e, y: s * 0.32 * e, x: 0 })) };
  } },
  { id: 'clap', name: '拍手', dur: 2.6, face: 'happy', pose: (t) => {
    const e = env(t, 0.25, 2.2, 0.4), k = 0.5 + 0.5 * Math.cos(t * 16);
    return { arms: both((s) => ({ z: 1.15 * e, y: s * (0.2 + 0.17 * k) * e, x: 0 })), head: { z: 0.05 * e } };
  } },
  { id: 'dance', name: '跳舞', loop: true, face: 'happy', pose: (t) => {
    const e = smooth(t / 0.3), b = t * Math.PI * 2 * 0.85, s1 = Math.sin(b);
    return {
      arms: [{ x: (1.2 + 1.0 * Math.max(0, -s1)) * e, z: 0.3 * e }, { x: -(1.2 + 1.0 * Math.max(0, s1)) * e, z: 0.3 * e }],
      legs: [{ z: 0.3 * Math.max(0, s1) * e }, { z: 0.3 * Math.max(0, -s1) * e }],
      waist: { y: 0.25 * s1 * e }, head: { x: -0.15 * s1 * e },
      lift: 0.05 * Math.abs(Math.sin(b)) * e, roll: 0.1 * s1 * e,
    };
  } },
  { id: 'hop', name: '開心跳', dur: 1.7, face: 'happy', pose: (t) => {
    const e = env(t, 0.15, 1.55, 0.15), ph = (t % 0.85) / 0.85, up = t < 1.7 ? Math.sin(Math.PI * ph) : 0;
    return { arms: both((s) => ({ x: -s * 2.4 * e, z: 0.2 * e })), legs: both(() => ({ z: -0.3 * up })), lift: 0.32 * up, head: { z: 0.15 * e } };
  } },
  { id: 'stretch', name: '伸懶腰', dur: 3.2, face: 'closed', pose: (t) => {
    const e = env(t, 0.7, 2.4, 0.6);
    // 雙手往上張成 Y 字（Q 版手短，直直舉高會被頭擋住）
    const sway = Math.sin(Math.max(0, t - 0.7) * 2.2) * e;   // 舉到頂以後身體左右彎一彎
    return { arms: both((s) => ({ x: -s * (2.2 + 0.12 * s * sway) * e, z: 0.1 * e })), waist: { z: 0.06 * e, y: 0 }, head: { z: 0.22 * e, x: 0.12 * sway }, roll: 0.07 * sway, lift: 0.015 * e };
  } },
  { id: 'sit', name: '坐在地上', loop: true, face: null, pose: (t) => {
    const e = smooth(t / 0.6);
    return { lift: -0.37 * e, legs: both(() => ({ z: 1.45 * e })), arms: both((s) => ({ z: -0.45 * e, x: -s * 0.25 * e })) };
  } },
  { id: 'lie', name: '躺下', loop: true, face: 'closed', pose: (t) => {
    const e1 = smooth(t / 0.6), e2 = smooth((t - 0.5) / 0.8);
    return {
      lift: -0.37 * e1 - 0.05 * e2, legs: both(() => ({ z: 1.45 * e1 })), waist: { z: 1.45 * e2 }, head: { z: 0.2 * e2 },
      arms: both((s) => ({ z: -0.45 * e1 * (1 - e2) + 0.1 * e2, x: -s * (0.25 * e1 * (1 - e2) + 0.15 * e2) })),
    };
  } },
];
export const ACTION_BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));

// ---- 輪盤 ----
// 滑鼠的移動量累積成一個看不見的游標（鎖住滑鼠的第一人稱、沒鎖的第三人稱都一樣），從中心往哪個方向推多遠就選哪一格：
// 離中心太近 = 沒選；內圈 = 表情；推到外圈 = 動作
const R_DEAD = 40, R_IN0 = 62, R_IN1 = 150, R_OUT0 = 158, R_OUT1 = 270, C = 300;
const SVGNS = 'http://www.w3.org/2000/svg';
function sector(r0, r1, a0, a1) {
  const p = (r, a) => `${(C + r * Math.sin(a)).toFixed(1)},${(C - r * Math.cos(a)).toFixed(1)}`;
  const big = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r0, a0)} L${p(r1, a0)} A${r1},${r1} 0 ${big} 1 ${p(r1, a1)} L${p(r0, a1)} A${r0},${r0} 0 ${big} 0 ${p(r0, a0)} Z`;
}

export class EmoteWheel {
  constructor() {
    const root = this.root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;pointer-events:none;z-index:30';
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 600 600');
    svg.style.cssText = 'width:min(600px,92vmin);height:min(600px,92vmin);overflow:visible;font-family:inherit;user-select:none';
    root.appendChild(svg);
    this.svg = svg;
    this.items = [];
    const ring = (list, r0, r1, kind, size) => {
      const n = list.length, step = (Math.PI * 2) / n;
      list.forEach(([id, name], i) => {
        const a = i * step;
        const path = document.createElementNS(SVGNS, 'path');
        path.setAttribute('d', sector(r0, r1, a - step / 2 + 0.012, a + step / 2 - 0.012));
        const text = document.createElementNS(SVGNS, 'text');
        const rm = (r0 + r1) / 2;
        text.setAttribute('x', (C + rm * Math.sin(a)).toFixed(1));
        text.setAttribute('y', (C - rm * Math.cos(a) + size * 0.36).toFixed(1));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-size', size);
        text.textContent = name;
        svg.append(path, text);
        this.items.push({ kind, id, name, path, text, i, n });
      });
    };
    ring(FACES.map((id) => [id, FACE_NAMES[id]]), R_IN0, R_IN1, 'face', 16);
    ring(ACTIONS.map((a) => [a.id, a.name]), R_OUT0, R_OUT1, 'action', 18);
    const hub = document.createElementNS(SVGNS, 'circle');
    hub.setAttribute('cx', C); hub.setAttribute('cy', C); hub.setAttribute('r', R_IN0 - 8);
    hub.setAttribute('fill', 'rgba(46,30,16,0.86)'); hub.setAttribute('stroke', 'rgba(240,214,160,0.35)');
    this.label = document.createElementNS(SVGNS, 'text');
    this.label.setAttribute('x', C); this.label.setAttribute('y', C + 6);
    this.label.setAttribute('text-anchor', 'middle'); this.label.setAttribute('font-size', 15); this.label.setAttribute('fill', '#dccba6');
    this.dot = document.createElementNS(SVGNS, 'circle');
    this.dot.setAttribute('r', 6); this.dot.setAttribute('fill', '#ffd24a'); this.dot.setAttribute('stroke', 'rgba(0,0,0,0.5)');
    svg.append(hub, this.label, this.dot);
    document.body.appendChild(root);
    this.isOpen = false;
    this.vx = this.vy = 0;
    this.hover = null;
    this._paint();
  }

  open() { this.isOpen = true; this.vx = this.vy = 0; this._pick(); this.root.style.display = 'flex'; }

  // 關掉輪盤，回傳選到的那一格（{ kind: 'face' | 'action', id }），沒選就是 null
  close() {
    if (!this.isOpen) return null;
    this.isOpen = false;
    this.root.style.display = 'none';
    const h = this.hover;
    this.hover = null;
    return h && { kind: h.kind, id: h.id };
  }

  // 手指（或滑鼠）指著畫面上的這一點：選到那一格（指在輪盤外面就是沒選）
  point(cx, cy) {
    if (!this.isOpen) return null;
    const r = this.svg.getBoundingClientRect(), k = 600 / (r.width || 600);
    this.vx = (cx - (r.left + r.width / 2)) * k; this.vy = (cy - (r.top + r.height / 2)) * k;
    if (Math.hypot(this.vx, this.vy) > R_OUT1 + 24) this.vx = this.vy = 0;
    this._pick();
    return this.hover;
  }

  move(dx, dy) {
    if (!this.isOpen) return;
    this.vx += dx; this.vy += dy;
    const r = Math.hypot(this.vx, this.vy);
    if (r > R_OUT1 - 20) { this.vx *= (R_OUT1 - 20) / r; this.vy *= (R_OUT1 - 20) / r; }
    this._pick();
  }

  _pick() {
    const r = Math.hypot(this.vx, this.vy);
    let hover = null;
    if (r >= R_DEAD) {
      const kind = r < (R_IN1 + R_OUT0) / 2 ? 'face' : 'action';
      const a = (Math.atan2(this.vx, -this.vy) + Math.PI * 2) % (Math.PI * 2);
      const list = this.items.filter((it) => it.kind === kind), n = list.length, step = (Math.PI * 2) / n;
      hover = list[Math.round(a / step) % n];
    }
    this.hover = hover;
    this._paint();
  }

  _paint() {
    for (const it of this.items) {
      const on = it === this.hover;
      it.path.setAttribute('fill', on ? '#e2b21c' : it.kind === 'face' ? 'rgba(58,38,22,0.84)' : 'rgba(46,30,16,0.80)');
      it.path.setAttribute('stroke', on ? '#ffe28a' : 'rgba(240,214,160,0.28)');
      it.text.setAttribute('fill', on ? '#2e1e10' : '#f3ead6');
      it.text.setAttribute('font-weight', on ? 700 : 400);
    }
    this.label.textContent = this.hover ? this.hover.name : this.hint ?? '移動滑鼠選擇';
    this.dot.setAttribute('cx', (C + this.vx).toFixed(1));
    this.dot.setAttribute('cy', (C + this.vy).toFixed(1));
  }
}
