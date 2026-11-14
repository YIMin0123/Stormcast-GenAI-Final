// 手機的觸控操作（只支援橫放）：
//   左半邊畫面：手指按下去的地方冒出搖桿，推它移動（推到底是跑；開船時是油門和方向盤）
//   其餘的畫面：滑動轉視角，兩指捏合調鏡頭遠近
//   右下角：互動、釣魚、跳、丟（拿著東西時）；右上角：地圖、聊天、表情、視角、換餌、全螢幕（都是圖示，見 icons.js）
// 電腦上網址加 ?touch 可以強制打開（測試用）。
import { ICON } from './icons.js';

const params = new URLSearchParams(window.location.search);
// 怎麼判斷是手機、平板：不能只問瀏覽器「主要的指標是不是手指」——有觸控筆的手機（Galaxy Note、S Ultra…）會回答「是滑鼠那種精細的指標」。
// 所以先看瀏覽器自己報的裝置名稱，再看有沒有觸控加上螢幕夠小；網址加 ?notouch 可以強制關掉
const ua = navigator.userAgent || '', touchPoints = navigator.maxTouchPoints || 0;
const phone = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(ua)
  || (touchPoints > 1 && /Macintosh/i.test(ua))   // iPad 會假裝自己是 Mac
  || (touchPoints > 0 && (window.matchMedia('(pointer: coarse)').matches || Math.min(window.screen.width, window.screen.height) < 600));
export const TOUCH = params.has('touch') || (phone && !params.has('notouch'));

// 提示文字裡的按鍵換成手機上的按鈕名稱
export function touchText(s) {
  if (!TOUCH || !s) return s;
  return s.replace(/按 Enter 可以聊天/g, '點右上角的對話框圖示可以聊天').replace(/按住 F（或滑鼠左鍵）/g, '按住「釣魚」').replace(/按住 F ?/g, '按住「釣魚」').replace(/放開 F ?/g, '放開「釣魚」').replace(/按 F ?/g, '按「釣魚」')
    .replace(/再按一次 E ?/g, '再按一次「互動」').replace(/按 E ?/g, '按「互動」')
    .replace(/按移動鍵、空白鍵/g, '推搖桿、按「跳」')
    .replace(/右鍵蓄力丟出去/g, '按住「丟」丟出去');
}

// 把提示文字放進元素裡；手機上「互動」「釣魚」「跳」「丟」這幾個按鈕名稱換成按鈕上的那個圖示。
// 「互動」鈕的圖示會變（手、放下、離開），提示裡畫的是它現在的樣子（actIcon，由 TouchUI.update 更新）
const NAMED = { 互動: 'hand', 釣魚: 'fish', 跳: 'jump', 丟: 'throw' };
let actIcon = 'hand';
export function touchSet(node, s) {
  s = touchText(s);
  const key = `${s}|${actIcon}`;
  if (node._shown === key) return;   // 每一幀都會被叫到：字和圖示都沒變就不動
  node._shown = key;
  if (!TOUCH || !s || !/「(?:互動|釣魚|跳|丟)」/.test(s)) { node.textContent = s; return; }
  node.textContent = '';
  for (const part of s.split(/(「(?:互動|釣魚|跳|丟)」)/)) {
    const name = part.slice(1, -1) === '互動' ? actIcon : NAMED[part.slice(1, -1)];
    if (!name || part[0] !== '「') { if (part) node.append(part); continue; }
    const i = document.createElement('i');
    i.className = 'key';
    i.innerHTML = ICON[name];
    node.append(i);
  }
}

// 全螢幕（把瀏覽器上面那條網址列收掉）。iPhone 的瀏覽器不給網頁進全螢幕，只能「加入主畫面」再從主畫面打開
const fsRoot = document.documentElement;
const fsEnter = fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen;
const fsExit = document.exitFullscreen || document.webkitExitFullscreen;
export const canFullscreen = !!fsEnter && !!fsExit;
export const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
export function setFullscreen(on) {
  if (!canFullscreen || on === isFullscreen()) return;
  try {
    const r = on ? fsEnter.call(fsRoot, { navigationUI: 'hide' }) : fsExit.call(document);
    if (r && r.then) {
      r.then(() => { if (on && window.screen.orientation && window.screen.orientation.lock) window.screen.orientation.lock('landscape').catch(() => {}); })
        .catch(() => {});
    }
  } catch { /* 不給就算了 */ }
}

const el = (tag, id, text) => { const e = document.createElement(tag); if (id) e.id = id; if (text) e.textContent = text; return e; };

// env：
//   canvas
//   look(dx, dy)：手指滑了這麼多像素，轉視角；zoom(k)：鏡頭遠近乘上 k
//   interact()、fishDown()、fishUp()、jump(on)、throwDown()、throwUp()（拿著東西時按住「丟」蓄力、放開丟出去）
//   tablet()、chat()、emote()、view()、bait()：右上角的小按鈕（tablet 拿出平板、bait 換餌）
export class TouchUI {
  constructor(env) {
    this.env = env;
    this.mx = 0; this.my = 0;     // 搖桿：-1 到 1（my 往前是正的）
    this.run = false;             // 推到底
    this.stickId = null;          // 正在推搖桿的那根手指
    this.looks = new Map();       // 正在滑視角的手指：pointerId → { x, y }
    this.pinch = 0;
    if (!TOUCH) return;
    document.body.classList.add('touch');
    document.documentElement.classList.add('touch');

    const root = this.root = el('div', 'touch');
    // 搖桿（按下去才出現在手指的位置）
    this.base = el('div', 'tBase'); this.knob = el('div', 'tKnob');
    this.base.appendChild(this.knob);
    // 右下角：動作
    const hold = (id, text, down, up) => {
      const b = el('button', id);
      b.className = 'tBtn';
      b.setAttribute('aria-label', text);
      const off = (e) => { if (b.classList.contains('on')) { b.classList.remove('on'); up && up(); } e.preventDefault(); };
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch { /* 沒關係 */ } b.classList.add('on'); down(); });
      b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      return b;
    };
    this.bAct = hold('tAct', '互動', () => env.interact());
    this.bFish = hold('tFish', '釣魚', () => env.fishDown(), () => env.fishUp());
    this.bJump = hold('tJump', '跳', () => env.jump(true), () => env.jump(false));
    this.bThrow = hold('tThrow', '丟', () => env.throwDown(), () => env.throwUp());
    this.bThrow.innerHTML = ICON.throw;
    this.bFish.innerHTML = ICON.fish; this.bJump.innerHTML = ICON.jump;
    // 右上角：小按鈕
    const bar = this.bar = el('div', 'tBar');
    const tap = (icon, text, fn) => {
      const b = el('button');
      b.innerHTML = ICON[icon]; b.setAttribute('aria-label', text);
      b.addEventListener('click', (e) => { e.preventDefault(); b.blur(); fn(); });
      bar.appendChild(b);
      return b;
    };
    tap('tablet', '平板', () => env.tablet()); tap('chat', '聊天', () => env.chat()); this.bEmote = tap('emote', '表情', () => env.emote()); tap('view', '視角', () => env.view()); tap('bait', '換餌', () => env.bait());
    if (canFullscreen) tap('full', '全螢幕', () => setFullscreen(!isFullscreen()));
    root.append(this.base, this.bAct, this.bFish, this.bJump, this.bThrow, bar);
    // 直著拿的時候蓋住整個畫面
    const rot = el('div', 'tRotate');
    rot.append(el('div', null, '請把手機橫過來'));
    document.body.append(root, rot);

    // 手指按在畫面上：左下那一塊是搖桿，其他地方是轉視角
    const cv = env.canvas;
    cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && !params.has('touch')) return;
      e.preventDefault();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      try { cv.setPointerCapture(e.pointerId); } catch { /* 沒關係 */ }
      if (this.stickId === null && this.active && e.clientX < window.innerWidth * 0.42 && e.clientY > window.innerHeight * 0.22) {
        this.stickId = e.pointerId;
        this.sx = e.clientX; this.sy = e.clientY;
        this.base.style.left = `${e.clientX}px`; this.base.style.top = `${e.clientY}px`;
        this.base.style.display = 'block';
        this._stick(e);
      } else {
        this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.pinch = 0;
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) { e.preventDefault(); this._stick(e); return; }
      const p = this.looks.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.looks.size >= 2) {
        // 兩根手指：捏合調鏡頭遠近
        const [a, b] = [...this.looks.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch > 0 && d > 0) env.zoom(this.pinch / d);
        this.pinch = d;
      } else env.look(dx, dy);
    });
    const end = (e) => {
      if (e.pointerId === this.stickId) { this.stickId = null; this.mx = this.my = 0; this.run = false; this.base.style.display = 'none'; }
      this.looks.delete(e.pointerId);
      this.pinch = 0;
    };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    // 不要讓瀏覽器自己捲動、縮放、長按跳選單
    document.addEventListener('contextmenu', (e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('gesturechange', (e) => e.preventDefault());
    // 兩根手指同時在畫面上：不要讓瀏覽器把整個網頁放大縮小（有些瀏覽器不理會網頁說的「不准縮放」）
    document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    document.addEventListener('dblclick', (e) => e.preventDefault());
    // 第一次點畫面（點選單上的按鈕也算）就進全螢幕、鎖成橫的。瀏覽器只在「手指放開」的那一刻才准網頁進全螢幕，
    // 所以掛在放開和點擊上；沒成功就下一次再試，試三次還不行（那個瀏覽器不給）就算了。之後要開要關按右上角的全螢幕圖示
    let tries = 0;
    const auto = () => {
      if (isFullscreen() || tries >= 3) { document.removeEventListener('pointerup', auto, true); document.removeEventListener('click', auto, true); return; }
      tries++;
      setFullscreen(true);
    };
    if (canFullscreen) { document.addEventListener('pointerup', auto, true); document.addEventListener('click', auto, true); }
    this.active = false;
  }

  _stick(e) {
    const R = 52, dx = e.clientX - this.sx, dy = e.clientY - this.sy, d = Math.hypot(dx, dy), k = d > R ? R / d : 1;
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const m = Math.min(d / R, 1);
    if (m < 0.22) { this.mx = this.my = 0; this.run = false; return; }
    this.mx = dx / d; this.my = -dy / d;   // 只取方向：輕推是走、推到底是跑
    this.run = m > 0.92;
  }

  // 每隔幾幀：照現在的狀況顯示該有的按鈕。st：{ on 在遊戲裡而且沒被選單、地圖、聊天蓋住, helm 掌舵中, sink 船正在沉, held 手上拿著東西（可以丟）, target 準心對著可以互動的東西, act 互動鈕上的字 }
  update(st) {
    if (!TOUCH) return;
    const on = !!st.on;
    if (on !== this.active) {
      this.active = on;
      this.root.style.display = on ? 'block' : 'none';
      if (!on && this.stickId !== null) { this.stickId = null; this.mx = this.my = 0; this.run = false; this.base.style.display = 'none'; }
    }
    if (!on) return;
    const walk = !st.helm && !st.sink;
    this.bFish.style.display = this.bJump.style.display = walk ? 'block' : 'none';
    this.bThrow.style.display = walk && st.held ? 'block' : 'none';
    this.bEmote.style.display = walk ? '' : 'none';
    this.bAct.style.display = st.sink ? 'none' : 'block';
    this.bAct.classList.toggle('hit', !!st.target);
    if (st.act !== this.actText) {
      this.actText = st.act;
      actIcon = st.act === '互動' ? 'hand' : st.act === '放下' || st.act === '放進去' ? 'drop' : 'leave';
      this.bAct.innerHTML = ICON[actIcon];
      this.bAct.setAttribute('aria-label', st.act);
    }
  }
}
