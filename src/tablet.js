// 遊戲裡的平板（仿 iPadOS）：Tab 拿出來、再按一次收起來。
// 主畫面：上面兩塊毛玻璃小工具（時間天氣、我的船），中間是桌面 App 網格，底部是 iPadOS 風格毛玻璃 Dock 船塢列與 Home 橫條。
// 支援開啟／關閉雙向縮放動畫（Zoom-in / Zoom-out）、底部橫條上滑手勢回主畫面、數字鍵 1~0 快捷切換。
// 每個 app 的內容在 tabletApps.js；這裡管外框、狀態列、主畫面、Dock 與手勢動畫。
import { ICON } from './icons.js';

export const DOCK_IDS = ['map', 'boat', 'bag', 'dex'];

const CSS = `
#tab { position: fixed; inset: 0; z-index: 26; display: none; align-items: center; justify-content: center; background: rgba(14, 53, 80, 0.16); }
#tab.on { display: flex; }
#tab.on:not(.show) { pointer-events: none; background: transparent; }
/* 拿起來的動畫：從畫面下方（手放著的地方）抬上來、轉正；收起來反過來（秒數 --lift 由 main.js 照 config.js 的 TABLET.lift 設） */
#tab { --lift: 0.35s; --view: 0.5s; perspective: 1400px; transition: background var(--lift); }
.tbDev { position: relative; width: min(900px, 94vw, calc(88vh * 1.42)); aspect-ratio: 1.42; padding: 13px; box-sizing: border-box; border-radius: 34px;
  background: #1b2731; box-shadow: inset 0 0 0 2px #3b4b59, 0 18px 50px rgba(5, 20, 35, 0.45);
  transform: translateY(78vh) rotateX(38deg) scale(0.8); transform-origin: 50% 100%; opacity: 0.4;
  transition: transform var(--lift) cubic-bezier(0.22, 0.8, 0.3, 1), opacity calc(var(--lift) * 0.6); }
#tab.show .tbDev { transform: none; opacity: 1; }
/* 相機鏡頭點綴（外框頂部正中央） */
.tbCamDot { position: absolute; top: 5px; left: 50%; width: 6px; height: 6px; margin-left: -3px; border-radius: 50%; background: #0d161d; box-shadow: inset 0 0 0 1.5px #2d3e4c; pointer-events: none; z-index: 8; }
/* 拿在手上：保留原本圓角外框與鏡頭孔（無透明度漸變）；定位完成後 DOM 精準貼齊外框四角無縫接手 */
#tab.held { background: transparent; perspective: none; transition: none; }
#tab.held .tbDev { position: fixed; left: 0; top: 0; width: var(--dw, 720px); height: calc(var(--dw, 720px) / 1.42); aspect-ratio: auto; transform-origin: 0 0;
  transition: none; box-shadow: inset 0 0 0 2px #3b4b59; border-radius: 12px; padding: 12px; }
#tab.held .tbScr { border-radius: 9px; }
/* 拿在手上時主畫面的小工具、桌面圖示與 Dock 比例 */
#tab.held .tbHome { padding: 12px 26px 22px; gap: 14px; }
#tab.held .tbW { min-height: 112px; padding: 12px 16px; font-size: 14px; }
#tab.held .tbW .big { font-size: 36px; }
#tab.held .tbGrid { grid-template-columns: repeat(6, 1fr); gap: 12px 8px; }
#tab.held .tbIco { font-size: 14px; gap: 6px; }
#tab.held .tbIco b { width: 66px; height: 66px; border-radius: 18px; }
#tab.held .tbIco b .ic { width: 36px; height: 36px; }
#tab.held .tbDock { padding: 8px 20px; gap: 22px; border-radius: 24px; }
#tab.held .tbDock .tbIco b { width: 62px; height: 62px; border-radius: 17px; }
#tab.held .tbDock .tbIco b .ic { width: 34px; height: 34px; }
body.touch #tab.held .tbHome { padding: 6px 16px 18px; gap: 8px; }
body.touch #tab.held .tbW { min-height: 82px; padding: 7px 12px; font-size: 12px; }
body.touch #tab.held .tbW .big { font-size: 28px; }
body.touch #tab.held .tbGrid { grid-template-columns: repeat(6, 1fr); gap: 6px 4px; }
body.touch #tab.held .tbIco { font-size: 12px; gap: 4px; }
body.touch #tab.held .tbIco b { width: 48px; height: 48px; border-radius: 13px; }
body.touch #tab.held .tbIco b .ic { width: 26px; height: 26px; }
body.touch #tab.held .tbDock { padding: 6px 14px; gap: 14px; border-radius: 18px; }
body.touch #tab.held .tbDock .tbIco b { width: 46px; height: 46px; border-radius: 13px; }
body.touch #tab.held .tbDock .tbIco b .ic { width: 25px; height: 25px; }

.tbScr { position: relative; width: 100%; height: 100%; border-radius: 22px; overflow: hidden; font-family: var(--font); color: var(--ink); user-select: none;
  background: linear-gradient(180deg, #57b5e6 0%, #9ad8f3 38%, #ffe5b8 48.5%, #46a0d4 50%, #2686c0 68%, #165e8a 100%); }
.tbScr.night { background: linear-gradient(180deg, #0b1c33 0%, #183456 40%, #31547a 48.5%, #153a60 50%, #0f2c49 72%, #081c33 100%); }
/* 日月與海面波光：置於右上角天際線（小工具後方），不再卡在圖示背後 */
.tbSun { position: absolute; right: 7%; top: 36px; width: 54px; height: 54px; border-radius: 50%; background: #fff5ce;
  box-shadow: 0 0 36px 12px rgba(255, 236, 170, 0.55); pointer-events: none; transition: all 0.5s; }
.tbScr.night .tbSun { background: #e8f0fc; box-shadow: 0 0 28px 8px rgba(205, 225, 255, 0.32); width: 40px; height: 40px; right: 8%; top: 40px; }
.tbSeaGlow { position: absolute; left: 10%; right: 10%; top: 49.5%; height: 32%; pointer-events: none;
  background: radial-gradient(ellipse at 82% 0%, rgba(255, 238, 188, 0.32) 0%, rgba(255, 238, 188, 0.08) 38%, transparent 70%); }
.tbScr.night .tbSeaGlow { background: radial-gradient(ellipse at 82% 0%, rgba(200, 222, 255, 0.20) 0%, rgba(160, 195, 240, 0.05) 38%, transparent 70%); }

/* 頂部狀態列 */
.tbBar { position: absolute; top: 0; left: 0; right: 0; height: 28px; z-index: 5; display: flex; align-items: center; gap: 10px; padding: 0 18px;
  font-size: 12.5px; color: #fff; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35); font-variant-numeric: tabular-nums; white-space: nowrap;
  background: linear-gradient(180deg, rgba(8, 28, 46, 0.24) 0%, transparent 100%); }
.tbBar span { display: inline-flex; align-items: center; gap: 4px; }
.tbBar .ic { width: 14px; height: 14px; }
.tbBar .r { margin-left: auto; }
.tbBar .tbCash { background: rgba(255, 198, 64, 0.92); color: #4e3200; text-shadow: none; padding: 1px 9px 1px 6px; border-radius: 999px; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
.tbBar .tbCash .ic { color: #7a4f00; }
.tbBar .tbBuff { background: rgba(255, 127, 92, 0.9); color: #fff; text-shadow: none; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; }
.tbBar .tbLv { background: rgba(61, 187, 122, 0.92); color: #fff; text-shadow: none; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; }
.tbBar .tbTitle { background: rgba(29, 111, 159, 0.9); color: #fff; text-shadow: none; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; }
.tbBar .tbTitle.gold { background: linear-gradient(135deg, #2b2418, #4a3b22); color: #ffd86b; }
.tbBar .tbBat { opacity: 0.92; gap: 3px; }
.tbScr.inApp .tbBar { color: var(--ink); text-shadow: none; background: rgba(255, 255, 255, 0.35); border-bottom: 1px solid rgba(44, 143, 201, 0.14); }

/* 主畫面：小工具 ＋ 桌面 App 網格 ＋ 底部毛玻璃 Dock */
.tbHome { position: absolute; inset: 28px 0 0; padding: 12px 28px 22px; display: flex; flex-direction: column; gap: 16px; z-index: 1; }
.tbWid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.tbW { position: relative; border-radius: 22px; background: rgba(222, 244, 253, 0.86); backdrop-filter: blur(12px); padding: 12px 16px; min-height: 102px;
  border: 1.5px solid rgba(255, 255, 255, 0.65); box-sizing: border-box; cursor: pointer;
  box-shadow: 0 6px 18px rgba(5, 30, 50, 0.18); font-size: 14px; line-height: 1.5; transition: transform 0.12s, box-shadow 0.12s; }
.tbW:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(5, 30, 50, 0.24); }
.tbW:active { transform: scale(0.98); }
.tbW .big { font-size: 34px; line-height: 1.08; color: var(--sea-d); font-variant-numeric: tabular-nums; }
.tbW .sub { color: var(--ink-2); font-size: 12.5px; }
.tbW .ic { width: 1.15em; height: 1.15em; vertical-align: -0.2em; color: var(--sea); }

.tbGrid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 14px 12px; align-items: start; margin: auto 0; }
.tbIco { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 0; border: 0; border-radius: 0; background: none;
  color: #fff; font-size: 13px; text-shadow: 0 1px 3px rgba(8, 26, 44, 0.88), 0 0 8px rgba(8, 26, 44, 0.5); cursor: pointer; }
.tbIco:hover { background: none; }
.tbIco:hover b { transform: translateY(-2px); filter: brightness(1.05); }
.tbIco b { position: relative; width: 62px; height: 62px; border-radius: 16px; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(5, 25, 45, 0.34), inset 0 1px 1px rgba(255, 255, 255, 0.35), inset 0 -3px 0 rgba(0, 0, 0, 0.14);
  transition: transform 0.12s, filter 0.12s; }
.tbIco b .ic { width: 33px; height: 33px; color: #fff; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2)); }
.tbIco:active b { transform: scale(0.91); }

/* 底部毛玻璃 Dock 船塢列 */
.tbDockWrap { display: flex; justify-content: center; margin-top: auto; }
.tbDock { display: inline-flex; align-items: center; justify-content: center; gap: 22px; padding: 8px 22px; border-radius: 24px;
  background: rgba(214, 241, 251, 0.30); backdrop-filter: blur(14px); border: 1.5px solid rgba(255, 255, 255, 0.42);
  box-shadow: 0 8px 24px rgba(5, 22, 38, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.45); }
.tbDock .tbIco { font-size: 12.5px; gap: 4px; }
.tbDock .tbIco b { width: 58px; height: 58px; border-radius: 15px; }
.tbDock .tbIco b .ic { width: 31px; height: 31px; }

.tbBadge { position: absolute; top: -5px; right: -5px; min-width: 20px; height: 20px; padding: 0 6px; box-sizing: border-box; border-radius: 999px; background: var(--bad);
  color: #fff; font-size: 11.5px; line-height: 20px; text-align: center; text-shadow: none; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.32); border: 1.5px solid #fff; z-index: 2; }
.tbBadge.dot { min-width: 0; width: 13px; height: 13px; padding: 0; top: -3px; right: -3px; border: 2px solid #fff; }

/* App 視窗與雙向縮放過場動畫 */
.tbApp { position: absolute; inset: 0; z-index: 2; padding-top: 28px; box-sizing: border-box; display: flex; flex-direction: column;
  background: linear-gradient(180deg, #d7f1fc 0%, #c6e9f8 100%); }
.tbApp.zoom { animation: tbZoomIn 0.2s cubic-bezier(0.2, 0.85, 0.25, 1); }
.tbApp.closing { pointer-events: none; z-index: 3; animation: tbZoomOut 0.18s cubic-bezier(0.32, 0, 0.67, 0) forwards; }
@keyframes tbZoomIn { from { transform: scale(0.32); opacity: 0; border-radius: 28px; } to { transform: none; opacity: 1; border-radius: 0; } }
@keyframes tbZoomOut { from { transform: none; opacity: 1; border-radius: 0; } to { transform: scale(0.28); opacity: 0; border-radius: 32px; } }

.tbHead { display: flex; align-items: center; gap: 12px; padding: 6px 18px 8px; border-bottom: 1.5px solid rgba(44, 143, 201, 0.16); background: rgba(240, 250, 254, 0.45); }
.tbHead h3 { margin: 0; font-size: 19px; font-weight: 400; color: var(--sea-d); display: flex; align-items: center; gap: 7px; }
.tbHead h3 .ic { width: 20px; height: 20px; color: var(--sea); }
.tbHead .r { margin-left: auto; color: var(--ink-2); font-size: 13px; display: flex; align-items: center; gap: 8px; }
.tbBack { padding: 4px 12px 4px 9px; font-size: 13.5px; display: inline-flex; align-items: center; gap: 2px; }
.tbBody { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 18px 30px; scrollbar-width: thin; font-size: 14px; line-height: 1.55; }

/* 底部 Home 橫條（支援點擊與上滑手勢） */
.tbHomeBar { position: absolute; left: 50%; bottom: 6px; z-index: 6; width: 146px; height: 6px; margin-left: -73px; padding: 0; border: 0; border-radius: 999px;
  background: rgba(255, 255, 255, 0.88); cursor: pointer; box-shadow: 0 0 0 8px transparent; touch-action: none; transition: transform 0.12s, background 0.12s; }
.tbHomeBar:hover { background: #fff; transform: scaleX(1.06); }
.tbScr.inApp .tbHomeBar { background: rgba(31, 58, 80, 0.48); }

body.touch .tbDev { width: min(97vw, calc(95vh * 1.9)); height: 95vh; aspect-ratio: auto; padding: 8px; border-radius: 24px; }
body.touch .tbScr { border-radius: 17px; }
body.touch .tbHome { padding: 6px 18px 20px; gap: 8px; }
body.touch .tbW { min-height: 78px; padding: 7px 12px; font-size: 12.5px; }
body.touch .tbW .big { font-size: 25px; }
body.touch .tbGrid { grid-template-columns: repeat(6, 1fr); gap: 8px 6px; }
body.touch .tbIco { font-size: 12px; gap: 4px; }
body.touch .tbIco b { width: 48px; height: 48px; border-radius: 13px; }
body.touch .tbIco b .ic { width: 26px; height: 26px; }
body.touch .tbDock { padding: 5px 14px; gap: 14px; border-radius: 18px; }
body.touch .tbDock .tbIco b { width: 46px; height: 46px; border-radius: 13px; }
body.touch .tbDock .tbIco b .ic { width: 25px; height: 25px; }
body.touch .tbBody { font-size: 13px; padding: 8px 14px 24px; }
body.touch .tbHead { padding: 4px 14px 6px; }
body.touch .tbHead h3 { font-size: 16.5px; }
`;
export const TABLET_CSS = CSS;

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderStatusBar(s) {
  const bless = s.blessing > 0 ? `<span class="tbBuff">✨ 魚潮 ${s.blessing}s</span>`
    : s.tideWait > 0 ? `<span class="tbBuff">⏳ 魚潮 ${s.tideWait}s</span>`
    : s.stormWait > 0 ? `<span class="tbBuff">⛈ 風暴 ${s.stormWait}s</span>` : '';
  const cash = s.money !== undefined ? `<span class="tbCash">${ICON.coin}$${Number(s.money).toLocaleString('en-US')}</span>` : '';
  // 等級（這一級走了幾成）和現在戴的稱號
  const lv = s.lv ? `<span class="tbLv">Lv.${s.lv.lv}${s.lv.need ? `（${Math.floor(s.lv.into / s.lv.need * 100)}%）` : ''}</span>${s.title ? `<span class="tbTitle${s.gold ? ' gold' : ''}">${esc(s.title)}</span>` : ''}` : '';
  return `<span>${esc(s.time)}</span><span>第 ${s.day} 天</span><span>${ICON[s.sky.icon] || ''}${esc(s.sky.text)}</span>`
    + `<span class="r">${bless}${lv}${cash}</span><span>${esc(s.room)}${s.n ? `・${s.n} 人` : ''}</span>`
    + `<span>${ICON.signal}${s.ping ? `${s.ping}ms` : '—'}</span><span class="tbBat">100%${ICON.battery || ''}</span>`;
}

export class Tablet {
  constructor(apps, env) {
    this.apps = apps; this.env = env;
    this.open = false;
    this.cur = null;        // 打開的 app（null = 主畫面）
    this.last = null;       // 上次收起來時停在哪
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    const root = this.root = document.createElement('div');
    root.id = 'tab';
    root.innerHTML = `<div class="tbDev"><div class="tbCamDot"></div><div class="tbScr"><div class="tbSun"></div><div class="tbSeaGlow"></div><div class="tbBar"></div>`
      + `<div class="tbHome"><div class="tbWid"></div><div class="tbGrid"></div><div class="tbDockWrap"><div class="tbDock"></div></div></div>`
      + `<button class="tbHomeBar" aria-label="回主畫面（可上滑）"></button></div></div>`;
    document.body.appendChild(root);
    this.dev = root.querySelector('.tbDev');
    this.scr = root.querySelector('.tbScr');
    this.bar = root.querySelector('.tbBar');
    this.home = root.querySelector('.tbHome');
    this.wid = root.querySelector('.tbWid');
    this.grid = root.querySelector('.tbGrid');
    this.dock = root.querySelector('.tbDock');

    const dockSet = new Set(DOCK_IDS);
    const dockApps = DOCK_IDS.map((id) => apps.find((a) => a.id === id)).filter(Boolean);
    const gridApps = apps.filter((a) => !dockSet.has(a.id));
    const renderIco = (a) => {
      const idx = apps.indexOf(a);
      const keyHint = idx >= 0 && idx < 10 ? `（快捷鍵 ${(idx + 1) % 10}）` : '';
      return `<button class="tbIco" data-go="${a.id}" title="${esc(a.name + keyHint)}"><b style="background:${a.color}">${ICON[a.icon] || ''}<i class="tbBadge" hidden></i></b><span>${esc(a.name)}</span></button>`;
    };
    this.grid.innerHTML = gridApps.map(renderIco).join('');
    this.dock.innerHTML = dockApps.map(renderIco).join('');
    this.badges = new Map([...this.home.querySelectorAll('.tbIco')].map((b) => [b.dataset.go, b.querySelector('.tbBadge')]));

    // 點平板外面：收起來；點 app 圖示、小工具：打開；橫條：回主畫面（在主畫面就收起來）
    let swipedAt = 0;
    root.addEventListener('click', (e) => {
      if (performance.now() - swipedAt < 260) return;
      if (e.target === root) return this.hide();
      const go = e.target.closest('[data-go]');
      if (go && this.home.contains(go)) return this.go(go.dataset.go, go);
      if (e.target.closest('.tbHomeBar')) return this.cur ? this.go(null) : this.hide();
      if (e.target.closest('[data-home]')) return this.go(null);
    });

    // 底部 Home 橫條上滑手勢（Swipe-up 回桌面或收起平板）
    const hb = root.querySelector('.tbHomeBar');
    let sy = null, pid = null;
    hb.addEventListener('pointerdown', (e) => {
      sy = e.clientY; pid = e.pointerId;
      hb.setPointerCapture?.(pid);
    });
    hb.addEventListener('pointermove', (e) => {
      if (sy === null || e.pointerId !== pid) return;
      const dy = e.clientY - sy;
      hb.style.transform = dy < 0 ? `translateY(${Math.max(-14, dy * 0.35)}px) scaleX(1.08)` : '';
      if (dy < -22) {
        sy = null; hb.style.transform = '';
        swipedAt = performance.now();
        if (this.cur) this.go(null); else this.hide();
      }
    });
    const endSwipe = () => { sy = null; pid = null; hb.style.transform = ''; };
    hb.addEventListener('pointerup', endSwipe);
    hb.addEventListener('pointercancel', endSwipe);

    for (const ev of ['pointerdown', 'wheel', 'contextmenu']) root.addEventListener(ev, (e) => e.stopPropagation());
    this._sKey = this._wKey = '';
  }

  _originOf(el) {
    if (!el) return '50% 85%';
    const r = el.getBoundingClientRect(), s = this.scr.getBoundingClientRect();
    if (!s.width || !s.height) return '50% 50%';
    return `${Math.round(r.left + r.width / 2 - s.left)}px ${Math.round(r.top + r.height / 2 - s.top)}px`;
  }

  // 拿出來：停在上次的畫面；app 指定了就直接開那個
  show(app = undefined) {
    const reopening = this._closing;
    this._closing = false;
    clearTimeout(this._off);
    if (!this.open) {
      this.open = true;
      this.root.classList.add('on');
      requestAnimationFrame(() => { if (this.open) this.root.classList.add('show'); });
    }
    if (reopening && (app === undefined || app === this.cur)) {
      this.update(true);
      this.env.changed?.(true, this.cur);
      return;
    }
    if (!this.cur && !reopening) this.env.changed?.(true);
    this.go(app === undefined ? this.last : app);
  }
  hide() {
    if (!this.open) return;
    this.last = this.cur;
    this.open = false;
    this._closing = true;
    this.root.classList.remove('show');
    this.env.changed?.(false, this.cur);
    const ms = ((this.root.classList.contains('held') ? parseFloat(getComputedStyle(this.root).getPropertyValue('--view')) : 0)
      || parseFloat(getComputedStyle(this.root).getPropertyValue('--lift')) || 0.35) * 1000;
    clearTimeout(this._off);
    this._off = setTimeout(() => {
      if (this.open) return;
      this._closing = false;
      this._leave(false);
      this.cur = null;
      this.scr.classList.remove('inApp');
      this.home.style.visibility = '';
      this.root.classList.remove('on', 'held');
    }, ms);
  }
  // M：直接開地圖；地圖開著再按就收起來
  toggle(app = undefined) {
    if (this.open && (app === undefined || this.cur === app)) this.hide();
    else this.show(app);
  }
  // Esc：app 裡回主畫面，主畫面就收起來
  back() { if (this.cur) this.go(null); else this.hide(); }

  // 切換：null = 主畫面
  go(id, from = null) {
    const app = id && this.apps.find((a) => a.id === id);
    const animateClose = !app && !!this.cur && this.open && !this._closing;
    this._closing = false;
    this._leave(animateClose);
    this.cur = app ? id : null;
    this.scr.classList.toggle('inApp', !!app);
    this.home.style.visibility = app ? 'hidden' : '';
    if (app) {
      const srcEl = from || this.home.querySelector(`[data-go="${app.id}"]`);
      const origin = this._originOf(srcEl);
      const el = this.appEl = document.createElement('div');
      el.className = 'tbApp zoom';
      el.style.transformOrigin = origin;
      el.dataset.origin = origin;
      el.innerHTML = `<div class="tbHead"><button class="tbBack" data-home>‹ 主畫面</button><h3>${ICON[app.icon] || ''}${esc(app.name)}</h3><span class="r"></span></div><div class="tbBody"></div>`;
      this.scr.insertBefore(el, this.scr.querySelector('.tbHomeBar'));
      this.head = el.querySelector('.tbHead .r');
      this.body = el.querySelector('.tbBody');
      this.body.addEventListener('scroll', () => this.env.scroll?.(), { passive: true });
      app.mount(this.body, this);
    }
    this.update(true);
    this.env.changed?.(this.open, this.cur);
  }
  get scroll() { return this.body ? Math.round(this.body.scrollTop) : 0; }
  _leave(animate = false) {
    const prevId = this.cur;
    const a = prevId && this.apps.find((x) => x.id === prevId);
    if (a && a.leave) a.leave();
    if (this.appEl) {
      const closingEl = this.appEl;
      this.appEl = this.body = this.head = null;
      if (animate) {
        const ico = prevId && this.home.querySelector(`[data-go="${prevId}"]`);
        closingEl.style.transformOrigin = ico ? this._originOf(ico) : (closingEl.dataset.origin || '50% 80%');
        closingEl.className = 'tbApp closing';
        setTimeout(() => closingEl.remove(), 190);
      } else {
        closingEl.remove();
      }
    }
  }

  // 每秒幾次：狀態列、主畫面的小工具與角標、打開中的 app
  update(force = false) {
    if (!this.open && !force) return;
    const s = this.env.status();
    this.scr.classList.toggle('night', !!s.night);
    const sk = renderStatusBar(s);
    if (sk !== this._sKey || force) { this._sKey = sk; this.bar.innerHTML = sk; }
    if (!this.cur) {
      const wk = this.env.widgets().map((h, i) => `<div class="tbW" data-go="${['weather', 'boat'][i]}">${h}</div>`).join('');
      if (wk !== this._wKey || force) { this._wKey = wk; this.wid.innerHTML = wk; }
      for (const a of this.apps) {
        const el = this.badges.get(a.id), v = a.badge ? a.badge() : '';
        if (!el) continue;
        const dot = v === '•';
        el.classList.toggle('dot', dot);
        if (el.textContent !== (dot ? '' : String(v))) el.textContent = dot ? '' : v;
        el.hidden = !v;
      }
    } else {
      const a = this.apps.find((x) => x.id === this.cur);
      if (a) a.update(this.body, this);
    }
  }
}
