// 遊戲裡的平板（仿 iPad）：Tab 拿出來、再按一次收起來。
// 主畫面：上面兩塊小工具（時間天氣、我的船），下面是 app 圖示；有事時圖示上亮紅色角標。
// 點 app 打開（佔滿整塊螢幕），左上「‹ 主畫面」或下方的橫條回主畫面。
// 每個 app 的內容在 tabletApps.js；這裡只管外框、主畫面、開關與切換。顏色用 index.html 的介面變數
import { ICON } from './icons.js';

const CSS = `
#tab { position: fixed; inset: 0; z-index: 26; display: none; align-items: center; justify-content: center; background: rgba(14, 53, 80, 0.16); }
#tab.on { display: flex; }
#tab.on:not(.show) { pointer-events: none; background: transparent; }
/* 拿起來的動畫：從畫面下方（手放著的地方）抬上來、轉正；收起來反過來（秒數 --lift 由 main.js 照 config.js 的 TABLET.lift 設） */
#tab { --lift: 0.35s; perspective: 1400px; transition: background var(--lift); }
.tbDev { position: relative; width: min(900px, 94vw, calc(88vh * 1.42)); aspect-ratio: 1.42; padding: 13px; box-sizing: border-box; border-radius: 34px;
  background: #1b2731; box-shadow: inset 0 0 0 2px #3b4b59, 0 18px 50px rgba(5, 20, 35, 0.45);
  transform: translateY(78vh) rotateX(38deg) scale(0.8); transform-origin: 50% 100%; opacity: 0.4;
  transition: transform var(--lift) cubic-bezier(0.22, 0.8, 0.3, 1), opacity calc(var(--lift) * 0.6); }
#tab.show .tbDev { transform: none; opacity: 1; }
/* 拿在手上：介面貼在手上那台平板的螢幕上（main.js 每幀照 3D 平板四個角算好透視，寫進 transform）；大螢幕不出現 */
#tab.held { background: transparent; perspective: none; }
#tab.held .tbDev { position: fixed; left: 0; top: 0; width: var(--dw, 900px); height: calc(var(--dw, 900px) / 1.42); aspect-ratio: auto; transform-origin: 0 0;
  transition: opacity 0.12s; box-shadow: inset 0 0 0 2px #3b4b59; border-radius: 12px; padding: 12px; }   /* 圓角小一點，貼齊 3D 平板的方角 */
#tab.held .tbScr { border-radius: 9px; }
/* 拿在手上時主畫面的小工具和 app 圖示大一號，填滿螢幕 */
#tab.held .tbHome { padding: 16px 28px 30px; gap: 26px; }
#tab.held .tbW { min-height: 132px; padding: 14px 18px; font-size: 15px; }
#tab.held .tbW .big { font-size: 42px; }
#tab.held .tbGrid { grid-template-columns: repeat(4, 1fr); gap: 26px 10px; }
#tab.held .tbIco { font-size: 15px; gap: 8px; }
#tab.held .tbIco b { width: 84px; height: 84px; border-radius: 22px; }
#tab.held .tbIco b .ic { width: 46px; height: 46px; }
body.touch #tab.held .tbHome { padding: 8px 18px 22px; gap: 12px; }
body.touch #tab.held .tbW { min-height: 104px; padding: 9px 14px; font-size: 13px; }
body.touch #tab.held .tbW .big { font-size: 34px; }
body.touch #tab.held .tbGrid { grid-template-columns: repeat(4, 1fr); gap: 8px 6px; }   /* 手機也兩排（四個＋三個），圖示小一點才放得下 */
body.touch #tab.held .tbIco { font-size: 13px; }
body.touch #tab.held .tbIco b { width: 54px; height: 54px; border-radius: 15px; }
body.touch #tab.held .tbIco b .ic { width: 30px; height: 30px; }
.tbScr { position: relative; width: 100%; height: 100%; border-radius: 22px; overflow: hidden; font-family: var(--font); color: var(--ink); user-select: none;
  background: linear-gradient(180deg, #6fc1ec 0%, #a9def5 40%, #ffe2b4 49.5%, #4aa3d6 50.5%, #2c8fc9 64%, #1d6f9f 100%); }
.tbScr.night { background: linear-gradient(180deg, #0f2440 0%, #1f3f66 42%, #3b5f86 49.5%, #17406a 50.5%, #123556 70%, #0b2440 100%); }
.tbSun { position: absolute; left: 88%; top: 45%; width: 70px; height: 70px; border-radius: 50%; background: #fff3c8; box-shadow: 0 0 40px 14px rgba(255, 236, 170, 0.55); }
.tbScr.night .tbSun { background: #e8eef8; box-shadow: 0 0 30px 8px rgba(220, 230, 255, 0.3); width: 46px; height: 46px; }
.tbBar { position: absolute; top: 0; left: 0; right: 0; height: 28px; z-index: 5; display: flex; align-items: center; gap: 12px; padding: 0 20px;
  font-size: 13px; color: #fff; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35); font-variant-numeric: tabular-nums; white-space: nowrap; }
.tbBar span { display: inline-flex; align-items: center; gap: 4px; }
.tbBar .ic { width: 15px; height: 15px; }
.tbBar .r { margin-left: auto; }
.tbScr.inApp .tbBar { color: var(--ink); text-shadow: none; }
.tbHome { position: absolute; inset: 28px 0 0; padding: 12px 30px 34px; display: flex; flex-direction: column; gap: 20px; }
.tbWid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.tbW { position: relative; border-radius: 22px; background: rgba(214, 241, 251, 0.84); backdrop-filter: blur(10px); padding: 12px 16px; min-height: 104px;
  box-sizing: border-box; cursor: pointer; box-shadow: 0 4px 14px rgba(5, 30, 50, 0.18); font-size: 14px; line-height: 1.55; }
.tbW .big { font-size: 34px; line-height: 1.1; color: var(--sea-d); font-variant-numeric: tabular-nums; }
.tbW .sub { color: var(--ink-2); font-size: 13px; }
.tbW .ic { width: 1.15em; height: 1.15em; vertical-align: -0.2em; color: var(--sea); }
.tbGrid { display: grid; grid-template-columns: repeat(auto-fill, 92px); gap: 20px 24px; }
.tbIco { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 0; border: 0; border-radius: 0; background: none;
  color: #fff; font-size: 13px; text-shadow: 0 1px 2px rgba(10, 30, 50, 0.85), 0 0 6px rgba(10, 30, 50, 0.55); cursor: pointer; }
.tbIco:hover { background: none; }
.tbIco b { width: 66px; height: 66px; border-radius: 17px; display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 9px rgba(5, 25, 45, 0.32), inset 0 -3px 0 rgba(0, 0, 0, 0.12);
  transition: transform 0.1s; }
.tbIco b .ic { width: 36px; height: 36px; color: #fff; }
.tbIco:active b { transform: scale(0.92); }
.tbBadge { position: absolute; top: -6px; right: 6px; min-width: 21px; height: 21px; padding: 0 6px; box-sizing: border-box; border-radius: 999px; background: var(--bad);
  color: #fff; font-size: 12px; line-height: 21px; text-align: center; text-shadow: none; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3); }
.tbBadge.dot { min-width: 0; width: 15px; height: 15px; padding: 0; top: -3px; right: 12px; border: 2px solid #fff; }
.tbApp { position: absolute; inset: 0; z-index: 2; padding-top: 28px; box-sizing: border-box; display: flex; flex-direction: column; background: #cdedf9; }
.tbApp.zoom { animation: tbZoom 0.2s ease-out; }
@keyframes tbZoom { from { transform: scale(0.35); opacity: 0; } to { transform: none; opacity: 1; } }
.tbHead { display: flex; align-items: center; gap: 12px; padding: 4px 18px 8px; }
.tbHead h3 { margin: 0; font-size: 20px; font-weight: 400; color: var(--sea-d); }
.tbHead .r { margin-left: auto; color: var(--ink-2); font-size: 13px; }
.tbBack { padding: 4px 12px 4px 9px; font-size: 14px; }
.tbBody { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 18px 34px; scrollbar-width: thin; font-size: 14px; line-height: 1.55; }
.tbHomeBar { position: absolute; left: 50%; bottom: 7px; z-index: 6; width: 150px; height: 6px; margin-left: -75px; padding: 0; border: 0; border-radius: 999px;
  background: rgba(255, 255, 255, 0.88); cursor: pointer; box-shadow: 0 0 0 6px transparent; }
.tbHomeBar:hover { background: #fff; }
.tbScr.inApp .tbHomeBar { background: rgba(31, 58, 80, 0.45); }
body.touch .tbDev { width: min(97vw, calc(95vh * 1.9)); height: 95vh; aspect-ratio: auto; padding: 8px; border-radius: 24px; }
body.touch .tbScr { border-radius: 17px; }
body.touch .tbHome { padding: 8px 22px 26px; gap: 12px; }
body.touch .tbW { min-height: 84px; padding: 9px 13px; font-size: 13px; }
body.touch .tbW .big { font-size: 26px; }
body.touch .tbGrid { grid-template-columns: repeat(auto-fill, 78px); gap: 12px 16px; }
body.touch .tbIco b { width: 54px; height: 54px; border-radius: 14px; }
body.touch .tbIco b .ic { width: 30px; height: 30px; }
body.touch .tbBody { font-size: 13px; padding: 0 14px 26px; }
body.touch .tbHead { padding: 2px 14px 6px; }
body.touch .tbHead h3 { font-size: 17px; }
`;

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// env：
//   status()：{ time, day, sky: { icon, text }, room, n, ping, night }　頂端狀態列
//   widgets()：[html, html]　主畫面的兩塊小工具（點了會打開 data-go 指定的 app）
//   changed(open)：拿出來／收起來了（main.js 用來放開滑鼠、讓角色拿著平板）
// apps：tabletApps.js 的 app 清單：{ id, name, icon, color, badge(), mount(el, tab), update(el), leave() }
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
    root.innerHTML = `<div class="tbDev"><div class="tbScr"><div class="tbSun"></div><div class="tbBar"></div><div class="tbHome"><div class="tbWid"></div><div class="tbGrid"></div></div>
      <button class="tbHomeBar" aria-label="回主畫面"></button></div></div>`;
    document.body.appendChild(root);
    this.dev = root.querySelector('.tbDev');   // 外框（拿在手上時 main.js 把它貼到 3D 平板的螢幕上）
    this.scr = root.querySelector('.tbScr');
    this.bar = root.querySelector('.tbBar');
    this.home = root.querySelector('.tbHome');
    this.wid = root.querySelector('.tbWid');
    this.grid = root.querySelector('.tbGrid');
    this.grid.innerHTML = apps.map((a) => `<button class="tbIco" data-go="${a.id}"><b style="background:${a.color}">${ICON[a.icon] || ''}</b>${esc(a.name)}<i class="tbBadge" hidden></i></button>`).join('');
    this.badges = new Map([...this.grid.querySelectorAll('.tbIco')].map((b) => [b.dataset.go, b.querySelector('.tbBadge')]));
    // 點平板外面：收起來；點 app 圖示、小工具：打開；橫條：回主畫面（在主畫面就收起來）
    root.addEventListener('click', (e) => {
      if (e.target === root) return this.hide();
      const go = e.target.closest('[data-go]');
      if (go && this.home.contains(go)) return this.go(go.dataset.go, go);
      if (e.target.closest('.tbHomeBar')) return this.cur ? this.go(null) : this.hide();
      if (e.target.closest('[data-home]')) return this.go(null);
    });
    for (const ev of ['pointerdown', 'wheel', 'contextmenu']) root.addEventListener(ev, (e) => e.stopPropagation());   // 不讓底下的遊戲畫面收到
    this._sKey = this._wKey = '';
  }

  // 拿出來：停在上次的畫面；app 指定了就直接開那個
  show(app = undefined) {
    if (!this.open) {
      this.open = true;
      clearTimeout(this._off);
      this.root.classList.add('on');
      requestAnimationFrame(() => this.root.classList.add('show'));
      this.env.changed(true);
    }
    this.go(app === undefined ? this.last : app);
  }
  hide() {
    if (!this.open) return;
    this.last = this.cur;
    this._leave();
    this.open = false;
    this.root.classList.remove('show');   // 放下去的動畫跑完才真的藏起來
    clearTimeout(this._off);
    this._off = setTimeout(() => { if (!this.open) this.root.classList.remove('on'); }, (parseFloat(getComputedStyle(this.root).getPropertyValue('--lift')) || 0.35) * 1000);
    this.env.changed(false);
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
    this._leave();
    this.cur = app ? id : null;
    this.scr.classList.toggle('inApp', !!app);
    this.home.style.visibility = app ? 'hidden' : '';
    if (app) {
      const el = this.appEl = document.createElement('div');
      el.className = 'tbApp zoom';
      if (from) { const r = from.getBoundingClientRect(), s = this.scr.getBoundingClientRect(); el.style.transformOrigin = `${r.left + r.width / 2 - s.left}px ${r.top + r.height / 2 - s.top}px`; }
      el.innerHTML = `<div class="tbHead"><button class="tbBack" data-home>‹ 主畫面</button><h3>${esc(app.name)}</h3><span class="r"></span></div><div class="tbBody"></div>`;
      this.scr.insertBefore(el, this.scr.querySelector('.tbHomeBar'));
      this.head = el.querySelector('.tbHead .r');
      this.body = el.querySelector('.tbBody');
      app.mount(this.body, this);
    }
    this.update(true);
  }
  _leave() {
    const a = this.cur && this.apps.find((x) => x.id === this.cur);
    if (a && a.leave) a.leave();
    if (this.appEl) { this.appEl.remove(); this.appEl = this.body = this.head = null; }
  }

  // 每秒幾次：狀態列、主畫面的小工具與角標、打開中的 app
  update(force = false) {
    // 角標收起來的時候也要算（畫面上的平板圖示……目前沒有，留著給以後）；主畫面看得到時才更新
    if (!this.open) return;
    const s = this.env.status();
    this.scr.classList.toggle('night', !!s.night);
    const sk = `<span>${esc(s.time)}</span><span>第 ${s.day} 天</span><span class="r">${ICON[s.sky.icon] || ''}${esc(s.sky.text)}</span><span>${esc(s.room)}${s.n ? `・${s.n} 人` : ''}</span><span>${ICON.signal}${s.ping ? `${s.ping}ms` : '—'}</span>`;
    if (sk !== this._sKey || force) { this._sKey = sk; this.bar.innerHTML = sk; }
    if (!this.cur) {
      const wk = this.env.widgets().map((h, i) => `<div class="tbW" data-go="${['weather', 'boat'][i]}">${h}</div>`).join('');
      if (wk !== this._wKey || force) { this._wKey = wk; this.wid.innerHTML = wk; }
      for (const a of this.apps) {
        const el = this.badges.get(a.id), v = a.badge ? a.badge() : '';
        const dot = v === '•';   // 小紅點（不寫數字）：只有「有」跟「沒有」
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
