// 平板上的 app：地圖、船、天氣、圖鑑、背包、房間、設定。資料都跟 main.js 要（env），這裡只排版面。
// 版面用 html 字串畫，有變才換（按鈕用 data-act，點了交給 env.act）
import { ICON } from './icons.js';
import { RARITY } from './fishdata.js';
import { NOTICE, UPDATES, nextRefreshAt, countdownText, refreshLabel } from './announce.js';
import { unreadCount, isUnread, markRead } from './updates.js';

const CSS = `
.tbc { background: rgba(240, 250, 254, 0.9); border: 2px solid var(--edge); border-radius: 16px; padding: 10px 14px; margin: 0 0 10px; }
.tbc.on { border-color: var(--sea); }
.tbc.warn { border-color: var(--coral); }
.tbc h4 { margin: 0; font-size: 16px; font-weight: 400; display: flex; align-items: baseline; gap: 8px; }
.tbc h4 .r { margin-left: auto; font-size: 13px; color: var(--ink-2); }
.tbTag { font-size: 12px; padding: 1px 9px; border-radius: 999px; background: var(--sea-a); color: #fff; }
.tbTag.c { background: var(--coral-a); }
.tbTag.g { background: rgba(61, 187, 122, 0.85); }
.tbTag.q { background: rgba(63, 97, 120, 0.55); }
.tbNote { color: var(--ink-2); font-size: 13px; margin: 4px 0 0; }
.tbBad { color: var(--coral-d); }
.tbRows { display: grid; grid-template-columns: auto 1fr auto; gap: 6px 10px; align-items: center; margin: 8px 0; font-size: 13px; }
.tbMeter { height: 9px; border-radius: 999px; background: rgba(35, 57, 77, 0.14); overflow: hidden; }
.tbMeter i { display: block; height: 100%; border-radius: 999px; background: var(--good); }
.tbMeter i.low { background: var(--bad); }
.tbBtns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.tbBtns button.main { background: var(--coral-a); border-color: var(--coral); color: #fff; }
.tbBtns button.main:hover { background: var(--coral); }
.tbTwo { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.tbTwo .tbc { margin: 0; }
.tbBig { font-size: 24px; color: var(--sea-d); font-variant-numeric: tabular-nums; }
.tbList { margin: 4px 0 0; padding-left: 18px; }
.tbList li { margin: 2px 0; }
.tbMap { display: flex; gap: 14px; height: 100%; }
/* 設定：進房後原本左上角的設定整塊搬進來（main.js 的 env.settings），一區一張卡、排兩欄 */
#panel.inTab { position: static; width: auto !important; max-height: none; overflow: visible; padding: 0; border: 0; border-radius: 0; background: none; box-shadow: none;
  column-count: 2; column-gap: 12px; }
#panel.inTab > summary { display: none; }
#panel.inTab .sec { break-inside: avoid; background: rgba(240, 250, 254, 0.9); border: 2px solid var(--edge); border-radius: 16px; margin: 0 0 10px; }
#panel.inTab #gfxPage { column-span: all; }
#panel.inTab.gfx { column-count: 1; }
body.touch #panel.inTab { column-count: 1; }
.tbMap canvas { height: 100%; aspect-ratio: 1; border-radius: 14px; border: 2px solid var(--edge); cursor: pointer; display: block; }
.tbMapSide { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
.tbChip { padding: 4px 12px; font-size: 13px; }
.tbChip.on { background: var(--sea-a); border-color: var(--sea); color: #fff; }
.tbDex { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
.tbFish { position: relative; padding: 5px 4px 6px; border-radius: 14px; border: 2px solid var(--edge); background: rgba(240, 250, 254, 0.9); text-align: center; font-size: 12px; cursor: pointer; }
.tbFish:hover { border-color: var(--sea); }
.tbFish.sel { border-color: var(--sea); box-shadow: 0 0 0 2px var(--sea); }
.tbFish img { display: block; width: 100%; aspect-ratio: 1.6; object-fit: contain; }
.tbFish.no img { filter: brightness(0); opacity: 0.22; }
.tbFish.no { color: var(--ink-2); }
.tbFish .new { position: absolute; top: 3px; left: 3px; font-size: 11px; padding: 0 6px; border-radius: 999px; background: var(--bad); color: #fff; }
.tbFish .rar { position: absolute; top: 4px; right: 5px; width: 8px; height: 8px; border-radius: 50%; }
.tbDexTop { display: flex; gap: 14px; align-items: center; margin-bottom: 10px; }
.tbDexTop img { width: 150px; aspect-ratio: 1.6; object-fit: contain; flex: none; }
.tbDexTop.no img { filter: brightness(0); opacity: 0.22; }
.tbSec { margin: 12px 0 6px; font-size: 13px; color: var(--sea-d); letter-spacing: 1px; }
.tbBaits { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; }
.tbBait { text-align: left; border-radius: 14px; padding: 8px 12px; white-space: normal; line-height: 1.45; }
.tbBait.on { background: var(--sea-a); border-color: var(--sea); color: #fff; }
.tbBait small { display: block; font-size: 12px; opacity: 0.85; }
.tbWho { display: flex; align-items: center; gap: 10px; padding: 8px 12px; }
.tbWho .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--good); flex: none; }
.tbWho .dot.off { background: rgba(63, 97, 120, 0.4); }
.tbWho .r { margin-left: auto; color: var(--ink-2); font-size: 13px; text-align: right; }
body.touch .tbDex { grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 6px; }
body.touch .tbDexTop img { width: 110px; }
body.touch .tbMap { gap: 10px; }
`;

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (v) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
const meter = (v, low) => `<div class="tbMeter"><i style="width:${pct(v)}"${low ? ' class="low"' : ''}></i></div>`;
const RAR_COL = { common: 'rgba(63, 97, 120, 0.45)', uncommon: '#2c8fc9', rare: '#ffc23c' };

// 版面用 html 字串畫：有變才換，按鈕交給 env.act
function htmlApp(base, render, env) {
  return {
    ...base,
    mount(el) {
      el._h = '';
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (b) env.act(b.dataset.act, b.dataset.arg, this);
      });
      this.update(el);
    },
    update(el) {
      const h = render.call(this);
      if (h !== el._h) { el._h = h; el.innerHTML = h; }
    },
  };
}

export function makeApps(env) {
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
  // ---- 地圖：原本按 M 那張，加上自己的船、魚箱；可以切換要顯示什麼。點自己的船跳到「船」----
  const filt = { boat: true, box: true, others: true, hot: true };
  const map = {
    id: 'map', name: '地圖', icon: 'map', color: '#2c8fc9',
    mount(el, tab) {
      el.style.overflow = 'hidden';
      el.innerHTML = `<div class="tbMap"><canvas width="560" height="560"></canvas><div class="tbMapSide">
        <div class="tbBtns" style="margin:0">${[['boat', '我的船'], ['box', '魚箱'], ['others', '其他人'], ['hot', '魚群']].map(([k, t]) => `<button class="tbChip${filt[k] ? ' on' : ''}" data-f="${k}">${t}</button>`).join('')}</div>
        <div class="tbNote">紅色箭頭是你、黃色是你的船、白色是其他人、橘色方塊是你的魚箱。上方是北</div>
        <div class="tbNote" data-v="hint"></div></div></div>`;
      this.cv = el.querySelector('canvas');
      el.querySelector('.tbMapSide').addEventListener('click', (e) => {
        const b = e.target.closest('[data-f]');
        if (!b) return;
        filt[b.dataset.f] = !filt[b.dataset.f];
        b.classList.toggle('on', filt[b.dataset.f]);
        this.update(el);
      });
      this.cv.addEventListener('click', (e) => {
        const r = this.cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 560, y = (e.clientY - r.top) / r.height * 560;
        const h = (this.hits || []).find((o) => Math.hypot(o.x - x, o.y - y) < o.r);
        if (h && h.go) tab.go(h.go);
      });
      this.update(el);
    },
    update(el) {
      if (!this.cv) return;
      this.hits = env.drawMap(this.cv, filt);
      const hint = el.querySelector('[data-v="hint"]'), t = env.mapHint();
      if (hint.textContent !== t) hint.textContent = t;
    },
    leave() { this.cv = null; },
  };

  // ---- 船：每艘一張卡。使用中的可以叫到最近的船位；倉庫裡的可以換出來 ----
  const boat = htmlApp({
    id: 'boat', name: '船', icon: 'boat', color: '#ff7f5c',
    badge() { return env.boatWarn() ? '!' : ''; },
  }, function () {
    const d = env.boats();
    const cards = d.list.map((b) => {
      const low = { hp: b.hp < env.low.hp, fuel: b.fuel < b.tank * env.low.fuel };
      const head = `<h4>${esc(b.name)}${b.active ? '<span class="tbTag">使用中</span>' : '<span class="tbTag q">在倉庫</span>'}${b.engine ? `<span class="tbTag g">引擎 Lv${b.engine}</span>` : ''}<span class="r">${esc(b.where)}</span></h4>`;
      const rows = b.sunk ? '<p class="tbNote tbBad">沉了：等一下港口會補一艘給你</p>' : `<div class="tbRows"><span>耐久</span>${meter(b.hp, low.hp)}<span>${pct(b.hp)}</span><span>燃油</span>${meter(b.fuel / b.tank, low.fuel)}<span>${Math.floor(b.fuel)} / ${b.tank} 公升</span></div>`;
      const warn = !b.sunk && (low.hp || low.fuel) ? `<p class="tbNote tbBad">${low.fuel ? '油快沒了，到商店買油桶或大港的加油柱加油' : ''}${low.fuel && low.hp ? '；' : ''}${low.hp ? '船受損了，帶扳手對著破洞按 E 修' : ''}</p>` : '';
      const btns = b.sunk ? '' : b.active
        ? `<div class="tbBtns"><button class="main" data-act="call">叫到最近的船位</button><button data-act="mapBoat">在地圖上看</button></div>`
        : `<div class="tbBtns"><button data-act="swap" data-arg="${b.type}">換這艘出來</button></div>`;
      return `<div class="tbc${b.active ? ' on' : ''}${warn ? ' warn' : ''}">${head}${rows}${warn}${btns}</div>`;
    }).join('');
    const why = d.block ? `<p class="tbNote">現在不能叫船、換船：${esc(d.block)}</p>` : '<p class="tbNote">叫船、換船：船會停到離你最近的空船位</p>';
    return cards + why + (d.more ? `<p class="tbNote">${esc(d.more)}</p>` : '');
  }, env);

  // ---- 天氣：時間、風向羅盤、浪、潮汐、預報、徵兆 ----
  const weather = htmlApp({ id: 'weather', name: '天氣', icon: 'cloud', color: '#5fb3dd' }, function () {
    const w = env.weather();
    const compass = `<svg viewBox="0 0 120 120" width="120" height="120" style="display:block;margin:0 auto">
      <circle cx="60" cy="60" r="50" fill="rgba(44,143,201,0.1)" stroke="var(--edge)" stroke-width="3"/>
      ${[['北', 60, 21], ['東', 101, 64], ['南', 60, 106], ['西', 19, 64]].map(([t, x, y]) => `<text x="${x}" y="${y}" text-anchor="middle" font-size="13" fill="${t === '北' ? 'var(--coral-d)' : 'var(--ink-2)'}" font-family="var(--font)">${t}</text>`).join('')}
      <g transform="rotate(${Math.round(w.windTo)} 60 60)"><path d="M60 28 L70 50 L63 48 L63 88 L57 88 L57 48 L50 50 Z" fill="var(--sea)"/></g></svg>`;
    return `<div class="tbTwo">
      <div class="tbc">${compass}<p style="text-align:center;margin:4px 0 0">${esc(w.windFrom)}風 ${w.windLv} 級・每秒 ${Math.round(w.windMs)} 公尺</p><p class="tbNote" style="text-align:center">箭頭指向風吹過去的方向（上方是北）</p></div>
      <div class="tbc"><div class="tbBig">${esc(w.time)}</div><p style="margin:2px 0 8px">第 ${w.day} 天・${ICON[w.skyIcon] || ''} ${esc(w.skyText)}</p>
        <div class="tbRows" style="grid-template-columns:auto 1fr"><span>${ICON.wave}</span><span>外海浪高約 ${w.waveOpen.toFixed(1)} 公尺${w.waveHere !== null ? `，你這裡約 ${w.waveHere.toFixed(1)} 公尺` : ''}</span>
        <span>${ICON.tide}</span><span>${esc(w.tide)}</span>
        <span>${ICON.wind}</span><span>風力 ${w.windLv} 級：${esc(w.windWord)}</span></div></div></div>
      <div class="tbc" style="margin-top:10px"><h4>今天的預報</h4><ul class="tbList">${w.forecast.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
      <div class="tbc${w.danger ? ' warn' : ''}"><h4>徵兆</h4><ul class="tbList">${w.signs.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
  }, env);

  // ---- 圖鑑：釣過的魚（最大尺寸、條數、在哪釣到）。沒釣過的只看得到黑影 ----
  const dex = htmlApp({
    id: 'dex', name: '圖鑑', icon: 'fish', color: '#1d6f9f',
    badge() { const n = env.dexNew(); return n ? String(n) : ''; },
    leave() { env.dexSeen(); },
  }, function () {
    const d = env.dex(), th = env.thumbs();
    if (!this.sel || !d.list.some((f) => f.id === this.sel)) this.sel = (d.list.find((f) => f.isNew) || d.list.find((f) => f.e) || d.list[0]).id;
    const s = d.list.find((f) => f.id === this.sel), rar = RARITY[s.rarity];
    const top = `<div class="tbc tbDexTop${s.e ? '' : ' no'}"><img src="${th.get(s.id) || ''}" alt=""><div>
      <h4>${s.e ? esc(s.name) : '？？？'}<span class="tbTag${s.rarity === 'rare' ? ' c' : s.rarity === 'common' ? ' q' : ''}">${s.junk ? '雜物' : rar.label}</span></h4>
      ${s.e ? `<p style="margin:6px 0 0">釣過 ${s.e.n} 條・最大 ${Math.round(s.e.len * 100)} 公分、${s.e.kg.toFixed(2)} 公斤</p><p class="tbNote">最大的那條在${esc(s.e.at || '某處')}釣到</p>` : '<p class="tbNote">還沒釣過。換個地方、時間、天氣或餌試試看</p>'}</div></div>`;
    const cell = (f) => `<div class="tbFish${f.e ? '' : ' no'}${f.id === this.sel ? ' sel' : ''}" data-act="pick" data-arg="${f.id}">${f.isNew ? '<span class="new">新</span>' : ''}${f.junk ? '' : `<span class="rar" style="background:${RAR_COL[f.rarity]}"></span>`}<img src="${th.get(f.id) || ''}" alt="">${f.e ? esc(f.name) : '？？？'}</div>`;
    const fishList = d.list.filter((f) => !f.junk), junk = d.list.filter((f) => f.junk);
    return top + `<div class="tbSec">魚（${fishList.filter((f) => f.e).length} / ${fishList.length}）　<span style="color:var(--ink-2)">右上角小點：灰 普通・藍 少見・黃 稀有</span></div><div class="tbDex">${fishList.map(cell).join('')}</div>`
      + `<div class="tbSec">雜物（${junk.filter((f) => f.e).length} / ${junk.length}）</div><div class="tbDex">${junk.map(cell).join('')}</div>`;
  }, env);
  const dexMount = dex.mount;
  dex.mount = function (el, tab) { this.sel = null; dexMount.call(this, el, tab); const d = env.dex(); tab.head.textContent = `收集 ${d.got} / ${d.total}`; };

  // ---- 背包：釣竿、餌（點一下換）、魚箱在哪 ----
  const bag = htmlApp({ id: 'bag', name: '背包', icon: 'bag', color: '#e2a03d' }, function () {
    const b = env.bag();
    const rod = `<div class="tbc${b.rod.broken ? ' warn' : ''}"><h4>${ICON.rod} 釣竿 Lv${b.rod.lv}<span class="r">拋竿最遠約 ${Math.round(b.rod.range)} 公尺</span></h4>${b.rod.broken ? '<p class="tbNote tbBad">斷了：回潮汐灣的商店修</p>' : '<p class="tbNote">在商店可以升級：拋得更遠、魚咬得更快</p>'}</div>`;
    const baits = `<div class="tbSec">餌（點一下換上；也可以按 B）</div><div class="tbBaits">${b.baits.map((x) => `<button class="tbBait${x.id === b.bait ? ' on' : ''}" data-act="bait" data-arg="${x.id}">${esc(x.name)}${x.id ? `　× ${x.n}` : ''}<small>${esc(x.desc)}</small></button>`).join('')}</div>`;
    const boxes = `<div class="tbSec">魚箱（${b.boxes.length} / ${b.boxMax}）</div>${b.boxes.length ? b.boxes.map((x) => `<div class="tbc"><h4>${ICON.box} ${x.n} 條魚・${x.kg.toFixed(1)} 公斤<span class="r">${esc(x.where)}</span></h4><p class="tbNote">值 $${x.value.toLocaleString('en-US')}</p></div>`).join('') : '<p class="tbNote">還沒有魚箱：在商店買，抱著搬，魚放進去別人拿不走</p>'}`;
    return rod + baits + boxes;
  }, env);

  // ---- 房間：同房的人在哪 ----
  const room = htmlApp({ id: 'room', name: '房間', icon: 'users', color: '#3dbb7a' }, function () {
    const r = env.room();
    return `<div class="tbc" style="padding:0">${r.list.map((p, i) => `<div class="tbWho"${i ? ' style="border-top:1.5px solid var(--line)"' : ''}><span class="dot${p.here ? '' : ' off'}"></span><span>${esc(p.name)}${p.me ? '（你）' : ''}</span><span class="r">${esc(p.where)}${p.far ? `<br>${esc(p.far)}` : ''}</span></div>`).join('')}</div>
      <p class="tbNote">${esc(r.name)}・${r.list.length} 人（最多 ${r.max} 人）。灰點是斷線中，一陣子沒回來就會離開</p>`;
  }, env);

  // ---- 公告：固定的說明、下次全服刷新的倒數、更新資訊（沒看過的標「新」，打開就算看過、小紅點消失） ----
  const notice = htmlApp({
    id: 'notice', name: '公告', icon: 'bell', color: '#ff7f5c',
    badge() { return unreadCount() ? '•' : ''; },
  }, function () {
    const at = nextRefreshAt();
    const top = `<div class="tbTwo"><div class="tbc"><h4>${esc(NOTICE.title)}</h4><ul class="tbList">${NOTICE.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
      <div class="tbc" style="text-align:center"><p class="tbNote" style="margin:0">距離下次全服刷新</p><div class="tbBig" style="margin:4px 0">${esc(countdownText(at - Date.now()))}</div><p class="tbNote" style="margin:0">${esc(refreshLabel(at))}（台灣時間）</p></div></div>`;
    const ups = UPDATES.map((u) => `<div class="tbc${this.fresh.has(u.id) ? ' on' : ''}"><h4>${esc(u.title)}${this.fresh.has(u.id) ? '<span class="tbTag c">新</span>' : ''}<span class="r">${esc(u.date)}</span></h4><ul class="tbList">${u.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`).join('');
    return `${top}<div class="tbSec">更新資訊</div>${ups}`;
  }, env);
  const noticeMount = notice.mount;
  notice.mount = function (el, tab) {
    this.fresh = new Set(UPDATES.filter(isUnread).map((u) => u.id));   // 這一次打開前沒看過的：標「新」
    markRead();
    noticeMount.call(this, el, tab);
  };

  // ---- 設定：畫質、角色、聲音（開關、音量）、操作說明——就是原本的設定，搬進平板 ----
  const set = {
    id: 'set', name: '設定', icon: 'gear', color: '#6f8394',
    mount(el) { env.settings.mount(el); },
    update() {},
    leave() { env.settings.unmount(); },
  };

  return [map, boat, weather, dex, bag, room, notice, set];
}
