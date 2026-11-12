// 手機的觸控操作（只支援橫放）：
//   左半邊畫面：手指按下去的地方冒出搖桿，推它移動（推到底是跑；開船時是油門和方向盤）
//   其餘的畫面：滑動轉視角，兩指捏合調鏡頭遠近
//   右下角：互動、釣魚、跳；右上角：地圖、聊天、表情、視角
// 電腦上網址加 ?touch 可以強制打開（測試用）。
const params = new URLSearchParams(window.location.search);
export const TOUCH = params.has('touch') || (navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches);

// 提示文字裡的按鍵換成手機上的按鈕名稱
export function touchText(s) {
  if (!TOUCH || !s) return s;
  return s.replace(/按住 F（或滑鼠左鍵）/g, '按住「釣魚」').replace(/按住 F ?/g, '按住「釣魚」').replace(/放開 F ?/g, '放開「釣魚」').replace(/按 F ?/g, '按「釣魚」')
    .replace(/再按一次 E ?/g, '再按一次「互動」').replace(/按 E ?/g, '按「互動」').replace(/按 Enter 可以聊天/g, '點右上角的「聊天」可以聊天')
    .replace(/按移動鍵、空白鍵/g, '推搖桿、按「跳」');
}

const el = (tag, id, text) => { const e = document.createElement(tag); if (id) e.id = id; if (text) e.textContent = text; return e; };

// env：
//   canvas
//   look(dx, dy)：手指滑了這麼多像素，轉視角；zoom(k)：鏡頭遠近乘上 k
//   interact()、fishDown()、fishUp()、jump(on)
//   map()、chat()、emote()、view()：右上角四顆按鈕
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

    const root = this.root = el('div', 'touch');
    // 搖桿（按下去才出現在手指的位置）
    this.base = el('div', 'tBase'); this.knob = el('div', 'tKnob');
    this.base.appendChild(this.knob);
    // 右下角：動作
    const hold = (id, text, down, up) => {
      const b = el('button', id, text);
      b.className = 'tBtn';
      const off = (e) => { if (b.classList.contains('on')) { b.classList.remove('on'); up && up(); } e.preventDefault(); };
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch { /* 沒關係 */ } b.classList.add('on'); down(); });
      b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      return b;
    };
    this.bAct = hold('tAct', '互動', () => env.interact());
    this.bFish = hold('tFish', '釣魚', () => env.fishDown(), () => env.fishUp());
    this.bJump = hold('tJump', '跳', () => env.jump(true), () => env.jump(false));
    // 右上角：小按鈕
    const bar = this.bar = el('div', 'tBar');
    const tap = (text, fn) => { const b = el('button', null, text); b.addEventListener('click', (e) => { e.preventDefault(); b.blur(); fn(); }); bar.appendChild(b); return b; };
    tap('地圖', () => env.map()); tap('聊天', () => env.chat()); this.bEmote = tap('表情', () => env.emote()); tap('視角', () => env.view());
    root.append(this.base, this.bAct, this.bFish, this.bJump, bar);
    // 直著拿的時候蓋住整個畫面
    const rot = el('div', 'tRotate');
    rot.append(el('div', null, '請把手機橫過來'));
    document.body.append(root, rot);

    // 手指按在畫面上：左下那一塊是搖桿，其他地方是轉視角
    const cv = env.canvas;
    cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && !params.has('touch')) return;
      e.preventDefault();
      this._full();
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
    document.addEventListener('dblclick', (e) => e.preventDefault());
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

  // 第一次碰畫面時進全螢幕、鎖成橫的（Android 才有用；iPhone 的瀏覽器不給）
  _full() {
    if (this.fullTried) return;
    this.fullTried = true;
    const d = document.documentElement;
    try {
      const p = d.requestFullscreen && d.requestFullscreen({ navigationUI: 'hide' });
      if (p && p.then) p.then(() => window.screen.orientation && window.screen.orientation.lock && window.screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
    } catch { /* 不給就算了 */ }
  }

  // 每隔幾幀：照現在的狀況顯示該有的按鈕。st：{ on 在遊戲裡而且沒被選單、地圖、聊天蓋住, helm 掌舵中, sink 船正在沉, target 準心對著可以互動的東西, act 互動鈕上的字 }
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
    this.bEmote.style.display = walk ? '' : 'none';
    this.bAct.style.display = st.sink ? 'none' : 'block';
    this.bAct.classList.toggle('hit', !!st.target);
    if (st.act !== this.actText) { this.actText = st.act; this.bAct.textContent = st.act; }
  }
}
