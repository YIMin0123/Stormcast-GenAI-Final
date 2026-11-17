// 平板上的 10 大內置 App：
// Dock 船塢列（4 個）：地圖、船、背包、圖鑑
// 桌面主畫面（6 個）：天氣、榜單、祭壇、房間、公告、設定
import { ICON } from './icons.js';
import { RARITY, SPECIES } from './fishdata.js';
import { BOAT_TYPES, BOAT_MODS, BOAT_PAINTS, BLESSINGS, DONATION_MILESTONES, SPECIAL_TITLES, CHUM_SPEC } from './boatdata.js';
import { GUILD, PARTY, LEVEL } from './config.js';
import { NOTICE, UPDATES, nextRefreshAt, countdownText, refreshLabel, refreshPeriodTag } from './announce.js';
import { unreadCount, isUnread, markRead } from './updates.js';

const FRESH_BOAT = Object.values(BOAT_TYPES).reduce((a, b) => ((b.freshBonus || 0) > (a.freshBonus || 0) ? b : a));   // 有急凍魚艙的那艘船（房間頁講同隊好處時要它的名字和加成）

const CSS = `
.tbc { background: rgba(242, 251, 255, 0.92); border: 2px solid var(--edge); border-radius: 16px; padding: 10px 14px; margin: 0 0 10px; box-shadow: 0 2px 8px rgba(15, 50, 80, 0.06); }
.tbc.on { border-color: var(--sea); box-shadow: 0 0 0 1px var(--sea), 0 4px 12px rgba(44, 143, 201, 0.14); }
.tbc.warn { border-color: var(--coral); background: rgba(255, 245, 240, 0.94); }
.tbc.gold { border-color: #d8a32a; background: linear-gradient(135deg, rgba(255, 250, 230, 0.95), rgba(242, 251, 255, 0.92)); }
.tbc h4 { margin: 0; font-size: 16px; font-weight: 400; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tbc h4 .r { margin-left: auto; font-size: 13px; color: var(--ink-2); }
.tbTag { font-size: 12px; padding: 1px 9px; border-radius: 999px; background: var(--sea-a); color: #fff; white-space: nowrap; }
.tbTag.c { background: var(--coral-a); }
.tbTag.g { background: rgba(61, 187, 122, 0.88); }
.tbTag.q { background: rgba(63, 97, 120, 0.55); }
.tbTag.gold { background: linear-gradient(135deg, #2b2418, #4a3b22); color: #ffd86b; border: 1px solid #d8a32a; }
.tbc h4 .tbTag { color: #fff; }
.tbc h4 .tbTag.gold { color: #ffd86b; }
.tbNote { color: var(--ink-2); font-size: 13px; margin: 4px 0 0; line-height: 1.5; }
.tbBad { color: var(--coral-d); }
.tbRows { display: grid; grid-template-columns: auto 1fr auto; gap: 6px 10px; align-items: center; margin: 8px 0; font-size: 13px; }
.tbMeter { height: 9px; border-radius: 999px; background: rgba(35, 57, 77, 0.14); overflow: hidden; }
.tbMeter i { display: block; height: 100%; border-radius: 999px; background: var(--good); transition: width 0.2s; }
.tbMeter i.low { background: var(--bad); }
.tbMeter i.sea { background: var(--sea); }
.tbBtns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.tbBtns button.main { background: var(--coral-a); border-color: var(--coral); color: #fff; }
.tbBtns button.main:hover { background: var(--coral); }
.tbTwo { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.tbTwo .tbc { margin: 0; }
.tbBig { font-size: 24px; color: var(--sea-d); font-variant-numeric: tabular-nums; }
.tbList { margin: 4px 0 0; padding-left: 18px; }
.tbList li { margin: 3px 0; }
.tbSec { margin: 12px 0 6px; font-size: 13px; color: var(--sea-d); letter-spacing: 1px; display: flex; align-items: center; justify-content: space-between; }

/* 頂部分段頁籤 (Segmented Tabs) */
.tbTabs { display: inline-flex; background: rgba(29, 111, 159, 0.12); padding: 3px; border-radius: 999px; margin-bottom: 10px; gap: 2px; border: 1.5px solid rgba(44, 143, 201, 0.22); }
.tbTabs button { border: 0; background: transparent; padding: 5px 16px; border-radius: 999px; font-size: 13.5px; color: var(--ink-2); }
.tbTabs button:hover { background: rgba(255, 255, 255, 0.45); }
.tbTabs button.on { background: var(--sea); color: #fff; box-shadow: 0 2px 6px rgba(29, 111, 159, 0.28); }

/* 地圖：左側互動畫布（支援縮放、平移、點擊導航標記）＋ 右側雷達與導航欄 */
.tbMap { display: flex; gap: 14px; height: 100%; }
.tbMapWrap { position: relative; height: 100%; aspect-ratio: 1; border-radius: 16px; border: 2px solid var(--edge); overflow: hidden; background: #1e5780; flex: none; box-shadow: 0 3px 10px rgba(10, 35, 58, 0.16); }
.tbMap canvas { width: 100%; height: 100%; display: block; cursor: crosshair; touch-action: none; }
.tbMapZoom { position: absolute; right: 8px; bottom: 8px; display: flex; gap: 4px; background: rgba(18, 42, 62, 0.72); padding: 3px; border-radius: 999px; backdrop-filter: blur(6px); }
.tbMapZoom button { padding: 2px 9px; font-size: 12.5px; color: #fff; background: transparent; border: 0; border-radius: 999px; min-width: 28px; }
.tbMapZoom button:hover { background: rgba(255, 255, 255, 0.2); }
.tbMapSide { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; font-size: 13px; overflow-y: auto; padding-right: 2px; }
.tbChip { padding: 4px 11px; font-size: 12.5px; }
.tbChip.on { background: var(--sea-a); border-color: var(--sea); color: #fff; }

/* 設定：進房後原本左上角的設定整塊搬進來（main.js 的 env.settings），一區一張卡、排兩欄 */
#panel.inTab { position: static; width: auto !important; max-height: none; overflow: visible; padding: 0; border: 0; border-radius: 0; background: none; box-shadow: none;
  column-count: 2; column-gap: 12px; }
#panel.inTab > summary { display: none; }
#panel.inTab .sec { break-inside: avoid; background: rgba(240, 250, 254, 0.9); border: 2px solid var(--edge); border-radius: 16px; margin: 0 0 10px; }
#panel.inTab #gfxPage { column-span: all; }
#panel.inTab.gfx { column-count: 1; }
body.touch #panel.inTab { column-count: 1; }

/* 圖鑑：iPad 經典左右雙欄 Split View */
.tbDexLayout { display: flex; flex-direction: column; height: 100%; gap: 8px; }
.tbDexFilter { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; flex: none; }
.tbDexSplit { flex: 1; min-height: 0; display: grid; grid-template-columns: 1.35fr 1fr; gap: 12px; }
.tbDexLeft { overflow-y: auto; padding-right: 4px; scrollbar-width: thin; }
.tbDexRight { overflow-y: auto; scrollbar-width: thin; display: flex; flex-direction: column; }
.tbDex { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 7px; }
.tbFish { position: relative; padding: 5px 4px 6px; border-radius: 14px; border: 2px solid var(--edge); background: rgba(242, 251, 255, 0.92); text-align: center; font-size: 12px; cursor: pointer; transition: transform 0.1s, border-color 0.1s; }
.tbFish:hover { border-color: var(--sea); transform: translateY(-1px); }
.tbFish.sel { border-color: var(--sea); box-shadow: 0 0 0 2px var(--sea); background: #fff; }
.tbFish img { display: block; width: 100%; aspect-ratio: 1.55; object-fit: contain; }
.tbFish.no img { filter: brightness(0); opacity: 0.22; }
.tbFish.no { color: var(--ink-2); }
.tbFish .new { position: absolute; top: 3px; left: 3px; font-size: 10.5px; padding: 0 5px; border-radius: 999px; background: var(--bad); color: #fff; }
.tbFish .rar { position: absolute; top: 4px; right: 5px; width: 8px; height: 8px; border-radius: 50%; }
.tbSpecCard { flex: 1; display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 12px 14px; }
.tbSpecHero { display: flex; align-items: center; justify-content: center; background: radial-gradient(circle, rgba(255,255,255,0.85) 0%, rgba(188,230,248,0.45) 100%);
  border-radius: 14px; padding: 8px; border: 1.5px solid rgba(44, 143, 201, 0.2); }
.tbSpecHero img { width: 165px; aspect-ratio: 1.6; object-fit: contain; }
.tbSpecHero.no img { filter: brightness(0); opacity: 0.22; }
.tbClueBox { background: rgba(214, 241, 251, 0.55); border-radius: 12px; padding: 8px 11px; font-size: 12.5px; line-height: 1.55; border: 1px solid rgba(44, 143, 201, 0.2); }
.tbClueBox div + div { margin-top: 4px; }

.tbBaits { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 8px; }
.tbBait { text-align: left; border-radius: 14px; padding: 8px 12px; white-space: normal; line-height: 1.45; }
.tbBait.on { background: var(--sea-a); border-color: var(--sea); color: #fff; }
.tbBait small { display: block; font-size: 12px; opacity: 0.85; margin-top: 2px; }

/* 排行榜與魚箱明細列 */
.tbRankRow { display: grid; grid-template-columns: 34px 48px 1fr auto; align-items: center; gap: 10px; padding: 7px 12px; border-top: 1.5px solid var(--line); font-size: 13.5px; }
.tbRankRow:first-child { border-top: 0; }
.tbRankRow.top1 { background: linear-gradient(90deg, rgba(255, 215, 80, 0.22), transparent); }
.tbRankNum { font-weight: 700; text-align: center; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.tbRankNum.n1 { color: #c88a00; font-size: 17px; }
.tbRankNum.n2 { color: #647888; font-size: 15px; }
.tbRankNum.n3 { color: #a86432; font-size: 15px; }
.tbRankImg { width: 46px; height: 30px; object-fit: contain; }
.tbRankVal { font-weight: 700; color: var(--coral-d); font-variant-numeric: tabular-nums; }

.tbWho { display: flex; align-items: center; gap: 10px; padding: 8px 12px; }
.tbWho .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--good); flex: none; }
.tbWho .dot.off { background: rgba(63, 97, 120, 0.4); }
.tbWho .r { margin-left: auto; color: var(--ink-2); font-size: 13px; text-align: right; }
.tbMini { padding: 3px 11px; font-size: 12.5px; flex: none; }
.tbMini.main { background: var(--coral-a); border-color: var(--coral); color: #fff; }
.tbWho .tbMini + .tbMini { margin-left: -4px; }
/* 船殼塗裝預覽、捐款 */
.tbPv { border-radius: 12px; background: linear-gradient(180deg, #e9f7fd 0%, #cfeaf7 100%); border: 1.5px solid var(--line); overflow: hidden; line-height: 0; }
.tbPv svg { width: 100%; height: auto; max-height: min(190px, 30vh); display: block; }
.tbSws { display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
.tbSw { width: 34px; height: 34px; padding: 0; border-radius: 50%; border: 2.5px solid rgba(0, 0, 0, 0.25); font-size: 13px; line-height: 1; }
.tbSw.on { box-shadow: 0 0 0 3px var(--sea); border-color: #fff; }
.tbGive { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; }
.tbGive input { flex: 1; min-width: 120px; padding: 6px 12px; border-radius: 999px; border: 2px solid var(--edge); background: rgba(255, 255, 255, 0.8); color: var(--ink); font: inherit; font-variant-numeric: tabular-nums; }
.tbGive button { padding: 4px 11px; font-size: 12.5px; }
.tbRankRow.txt { grid-template-columns: 34px 1fr auto; }

body.touch .tbDexSplit { grid-template-columns: 1.15fr 1fr; gap: 8px; }
body.touch .tbDex { grid-template-columns: repeat(auto-fill, minmax(74px, 1fr)); gap: 5px; }
body.touch .tbSpecHero img { width: 118px; }
body.touch .tbMap { gap: 10px; }
`;
export const APPS_CSS = CSS;

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (v) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
const meter = (v, low, cls = '') => `<div class="tbMeter"><i style="width:${pct(v)}" class="${low ? 'low' : cls}"></i></div>`;
const RAR_COL = { common: 'rgba(63, 97, 120, 0.45)', uncommon: '#2c8fc9', rare: '#ffc23c' };

const ZONE_NAME = {
  home: '潮汐灣周邊', haven: '大港灣島周邊', arch: '石拱門礁區',
  atoll: '沉船環礁', beacon: '燈標岩海域', reef: '各處海上礁石',
  cave: '透天洞穴深潭', river: '大港灣高山小河', open: '一般與開闊海域',
};

// 從 SPECIES 自動整理魚種的棲息水域、出沒時段與垂釣線索（未釣過也能看線索尋魚）
function fishClues(id) {
  const sp = SPECIES[id];
  if (!sp) return { where: '未知海域', time: '全天', tip: '換個地方試試' };
  const spots = sp.spots || [{}];
  const whSet = new Set(sp.where || []);
  let deepOff = false, shallow = false, dayOnly = false, nightOnly = false;
  for (const s of spots) {
    if (s.where) for (const w of s.where) whSet.add(w);
    if (s.off && s.off[0] >= 200) deepOff = true;
    if (s.depth && s.depth[1] <= 12) shallow = true;
    if (s.time === 'day') dayOnly = true;
    if (s.time === 'night') nightOnly = true;
  }
  const places = [...whSet].map((k) => ZONE_NAME[k] || k);
  if (!places.length) places.push(deepOff ? '遠洋外海（離岸 200m 外）' : shallow ? '沿岸淺水區' : '一般開闊海域');
  else if (deepOff && !whSet.has('open')) places.push('遠洋外海');

  const times = [];
  if (sp.need === 'after') times.push('⚡ 僅限風暴剛過後現身');
  else {
    if (nightOnly && !dayOnly) times.push('🌙 僅在夜晚出沒');
    else if (dayOnly && !nightOnly) times.push('☀️ 白天較常出沒');
    else times.push('🕒 全天皆可垂釣');
    if (sp.nightK) times.push(`🌙 夜間機率 ×${sp.nightK}`);
    if (sp.twilight) times.push(`🌅 清晨與黃昏機率 ×${sp.twilight}`);
    if (sp.rain) times.push(`🌧️ 雨天機率 ×${sp.rain}`);
    if (sp.before) times.push(`⛈️ 風暴前夕機率 ×${sp.before}`);
    if (sp.after) times.push(`🌈 風暴過後機率 ×${sp.after}`);
  }
  const kgRange = sp.kg ? `${sp.kg[0]} ~ ${sp.kg[1]} 公斤` : '未知';
  const baitTip = sp.kind === 'junk' ? '屬於水域雜物，近岸、洞穴與小河的淺水較容易鉤到'
    : sp.rarity === 'rare' ? '建議使用「花枝餌 / 特級亮片餌」或趁海神魚潮、魚群熱點垂釣'
    : sp.rarity === 'uncommon' ? '使用「小魚餌」以上或尋找海鳥盤旋的魚群更容易上鉤'
    : '使用基本餌或蝦餌即可輕鬆釣獲';
  return { where: places.join('、'), time: times.join('・'), kgRange, baitTip };
}

// 船殼塗裝預覽：照船種畫一張側面圖（小舢舨、有遮陽棚的近海漁船、雙層艦橋加 A 字吊架的遠洋大漁船），船舷和駕駛艙屋頂塗上那個顏色
const cssRgb = (rgb, k = 1) => `rgb(${rgb.map((v) => Math.round(Math.min(1, v * k) * 255)).join(',')})`;
export function svgBoatPaintPreview(paintId, boatType = 'skiff') {
  const type = BOAT_TYPES[boatType] ? boatType : 'skiff', S = BOAT_TYPES[type], P = BOAT_PAINTS.find((p) => p.id === paintId);
  const rgb = (P && P.rgb) || S.paint || [0.8, 0.8, 0.8];
  const hull = cssRgb(rgb, 1.25), roof = cssRgb(rgb, 1.6), keel = '#3b2f2a', white = '#f4f1ea', glass = '#2f5d7c', steel = '#3a3f43', wood = '#b98a55';
  let body = '';
  if (type === 'skiff') {
    body = `<path d="M64,86 L270,80 Q258,110 236,112 L88,112 Q70,106 64,86 Z" fill="${keel}"/>
      <path d="M64,86 L270,80 L263,98 L70,100 Z" fill="${hull}"/><path d="M62,85 L272,79" stroke="${white}" stroke-width="3" stroke-linecap="round"/>
      <rect x="128" y="76" width="44" height="6" rx="2" fill="${wood}"/><rect x="196" y="75" width="30" height="6" rx="2" fill="${wood}"/>
      <path d="M76,78 L104,66" stroke="${wood}" stroke-width="4" stroke-linecap="round"/><rect x="60" y="80" width="9" height="20" rx="2" fill="${steel}"/>`;
  } else if (type === 'fisher') {
    const stripes = Array.from({ length: 6 }, (_, i) => `<rect x="${164 + i * 14}" y="38" width="14" height="6" fill="${i % 2 ? white : '#2f6fb0'}"/>`).join('');
    body = `<path d="M30,80 L292,70 Q282,108 256,112 L58,112 Q36,106 30,80 Z" fill="${keel}"/>
      <path d="M30,80 L292,70 L285,95 L37,99 Z" fill="${hull}"/><path d="M28,79 L294,69" stroke="${white}" stroke-width="3" stroke-linecap="round"/>
      <rect x="92" y="42" width="62" height="36" fill="${white}"/><rect x="100" y="48" width="20" height="14" rx="2" fill="${glass}"/><rect x="126" y="48" width="20" height="14" rx="2" fill="${glass}"/>
      <rect x="86" y="35" width="74" height="8" rx="2" fill="${roof}"/>
      <path d="M170,74 L170,44 M240,71 L240,44" stroke="${white}" stroke-width="2.5"/>${stripes}
      <path d="M98,35 L93,6" stroke="#b99a4a" stroke-width="1.6"/><rect x="60" y="52" width="6" height="26" fill="${steel}"/>
      <circle cx="266" cy="62" r="6" fill="none" stroke="#e2582a" stroke-width="3.5"/>`;
  } else {
    const rail = Array.from({ length: 6 }, (_, i) => `<path d="M${106 + i * 17.2},28 L${106 + i * 17.2},16" stroke="${steel}" stroke-width="2"/>`).join('');
    body = `<path d="M14,78 L306,64 Q296,108 268,113 L44,113 Q20,106 14,78 Z" fill="${keel}"/>
      <path d="M14,78 L306,64 L299,92 L22,99 Z" fill="${hull}"/><path d="M12,77 L308,63" stroke="${white}" stroke-width="3" stroke-linecap="round"/>
      <rect x="110" y="36" width="78" height="40" fill="${white}"/><rect x="118" y="42" width="18" height="14" rx="2" fill="${glass}"/><rect x="140" y="42" width="18" height="14" rx="2" fill="${glass}"/><rect x="162" y="42" width="18" height="14" rx="2" fill="${glass}"/>
      <rect x="104" y="28" width="90" height="8" rx="2" fill="${roof}"/>${rail}<path d="M104,16 L194,16" stroke="${steel}" stroke-width="2.4"/>
      <path d="M162,28 L162,4" stroke="${white}" stroke-width="4"/><rect x="146" y="1" width="32" height="5" rx="2" fill="${white}"/><rect x="150" y="1" width="24" height="2" fill="#c8352a"/>
      <path d="M30,76 L62,10 M62,10 L74,76" stroke="#e8c13a" stroke-width="6" stroke-linecap="round"/><path d="M30,76 L62,10 M62,10 L74,76" stroke="#1d1b1a" stroke-width="6" stroke-dasharray="9 9" stroke-linecap="butt"/>
      <rect x="84" y="40" width="7" height="36" fill="#1d1b1a"/><rect x="82" y="37" width="11" height="4" fill="#c8352a"/><rect x="95" y="46" width="7" height="30" fill="#1d1b1a"/><rect x="93" y="43" width="11" height="4" fill="#c8352a"/>
      <rect x="200" y="66" width="34" height="7" rx="2" fill="#2f6fb0"/><circle cx="252" cy="64" r="9" fill="#4f7a5a"/><rect x="266" y="58" width="22" height="10" rx="5" fill="${white}" stroke="#c8352a" stroke-width="1.5"/>`;
  }
  return `<svg viewBox="0 0 320 140" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(S.name)}・${esc(P ? P.name : '原廠塗裝')}">
    ${body}<path d="M0,112 Q20,107 40,112 T80,112 T120,112 T160,112 T200,112 T240,112 T280,112 T320,112 L320,140 L0,140 Z" fill="#5fb3dd" opacity="0.78"/>
    <path d="M0,121 Q20,116 40,121 T80,121 T120,121 T160,121 T200,121 T240,121 T280,121 T320,121" fill="none" stroke="#fff" stroke-width="1.5" opacity="0.5"/></svg>`;
}

// 用滑鼠按住拖曳捲動（像手機用手指滑）：sel 是 el 裡面的捲動區（整頁重畫換掉也照樣有效）。
// 拖超過幾個像素才算拖曳，放開時那一下點擊就不算（不會拖完順手選到一條魚）；手指本來就能滑，只管滑鼠
function dragScroll(el, sel) {
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const box = e.target.closest(sel);
    if (!box || !el.contains(box) || box.scrollHeight <= box.clientHeight) return;
    // 平板可能整台縮放過（CSS transform）：畫面上移動幾個像素換算成捲動區自己的像素
    const k = box.offsetHeight ? box.getBoundingClientRect().height / box.offsetHeight : 1;
    drag = { box, y: e.clientY, top: box.scrollTop, k: k || 1, moved: false, id: e.pointerId };
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = (e.clientY - drag.y) / drag.k;
    if (!drag.moved && Math.abs(dy) < 5) return;
    if (!drag.moved) { drag.moved = true; drag.box.setPointerCapture?.(e.pointerId); drag.box.style.cursor = 'grabbing'; }
    drag.box.scrollTop = drag.top - dy;
    e.preventDefault();
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.box.style.cursor = '';
    if (drag.moved) el._dragged = performance.now();
    drag = null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  // 拖完放開的那一下點擊吞掉
  el.addEventListener('click', (e) => { if (el._dragged && performance.now() - el._dragged < 250) { el._dragged = 0; e.stopPropagation(); e.preventDefault(); } }, true);
}

function htmlApp(base, render, env) {
  return {
    ...base,
    renderHtml: render,
    mount(el, tab) {
      this._tab = tab;
      el._h = '';
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (b) env.act(b.dataset.act, b.dataset.arg, this, el);
      });
      el.addEventListener('input', (e) => { const k = e.target.dataset?.bind; if (k) this[k] = e.target.value; });
      this.update(el, tab);
    },
    update(el, tab = this._tab) {
      const h = render.call(this, tab);
      if (h !== el._h) {
        // 整頁換掉時，標了 data-keep 的捲動區記住捲到哪（例如圖鑑點一條魚，左邊清單不會跳回最上面）
        const keep = {};
        for (const k of el.querySelectorAll('[data-keep]')) keep[k.dataset.keep] = k.scrollTop;
        el._h = h; el.innerHTML = h;
        for (const i of el.querySelectorAll('[data-bind]')) i.value = this[i.dataset.bind] ?? '';
        for (const k of el.querySelectorAll('[data-keep]')) if (keep[k.dataset.keep]) k.scrollTop = keep[k.dataset.keep];
      }
    },
  };
}

export function makeApps(env, { noStyle = false } = {}) {
  if (!noStyle) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ---- 1. 地圖（Dock 1）：支援縮放平移、點擊插針導航（Waypoint）、聲納雷達 ----
  const filt = { boat: true, box: true, others: true, hot: true };
  const map = {
    id: 'map', name: '地圖', icon: 'map', color: '#2c8fc9',
    filt, zoom: 1, panX: 0, panY: 0,
    mount(el, tab) {
      el.style.overflow = 'hidden';
      el.innerHTML = `<div class="tbMap">
        <div class="tbMapWrap">
          <canvas width="560" height="560"></canvas>
          <div class="tbMapZoom">
            <button data-z="in" title="放大">＋</button>
            <button data-z="out" title="縮小">－</button>
            <button data-z="reset" title="重置縮放">1×</button>
          </div>
        </div>
        <div class="tbMapSide">
          <div class="tbBtns" style="margin:0">${[['boat', '我的船'], ['box', '魚箱'], ['others', '其他人'], ['hot', '魚群']].map(([k, t]) => `<button class="tbChip${filt[k] ? ' on' : ''}" data-f="${k}">${t}</button>`).join('')}</div>
          <div class="tbc" style="margin:0;padding:8px 11px"><div class="tbNote" style="margin:0" data-v="hint"></div></div>
          <div class="tbc" style="margin:0;padding:8px 11px" data-v="wp"></div>
          <div class="tbc" style="margin:0;padding:8px 11px;color:var(--sea-d);line-height:1.5" data-v="sonar"></div>
          <div class="tbNote" style="margin-top:auto">💡 滾輪縮放、拖曳平移；點海面或魚群可設「導航標記」（同步顯示於頂部羅盤），點自己的船打開「船」</div>
        </div></div>`;
      this.cv = el.querySelector('canvas');
      const side = el.querySelector('.tbMapSide');
      side.addEventListener('click', (e) => {
        const b = e.target.closest('[data-f]');
        if (b) {
          filt[b.dataset.f] = !filt[b.dataset.f];
          b.classList.toggle('on', filt[b.dataset.f]);
          this.update(el, tab);
          env.onFilter?.();
          return;
        }
        if (e.target.closest('[data-act="clearWp"]')) {
          env.setWaypoint?.(null);
          this.update(el, tab);
          return;
        }
        if (e.target.closest('[data-act="navHot"]')) {
          env.act?.('navHot', '', map);
        }
      });
      el.querySelector('.tbMapZoom').addEventListener('click', (e) => {
        const z = e.target.closest('[data-z]')?.dataset.z;
        if (!z) return;
        if (z === 'in') this._setZoom(this.zoom * 1.35);
        else if (z === 'out') this._setZoom(this.zoom / 1.35);
        else { this.zoom = 1; this.panX = 0; this.panY = 0; }
        this.update(el, tab);
      });
      this.cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        this._setZoom(this.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
        this.update(el, tab);
      }, { passive: false });

      let dragging = false, moved = false, sx = 0, sy = 0, px0 = 0, py0 = 0;
      this.cv.addEventListener('pointerdown', (e) => {
        dragging = true; moved = false;
        sx = e.clientX; sy = e.clientY;
        px0 = this.panX; py0 = this.panY;
        this.cv.setPointerCapture?.(e.pointerId);
      });
      this.cv.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.hypot(dx, dy) > 5) moved = true;
        if (this.zoom > 1.01 && moved) {
          const r = this.cv.getBoundingClientRect();
          const scale = 560 / Math.max(1, r.width) / this.zoom;
          this._clampPan(px0 - dx * scale, py0 - dy * scale);
          this.update(el, tab);
        }
      });
      this.cv.addEventListener('pointerup', (e) => {
        if (!dragging) return;
        dragging = false;
        if (moved) return;
        const r = this.cv.getBoundingClientRect();
        const vx = (e.clientX - r.left) / r.width * 560, vy = (e.clientY - r.top) / r.height * 560;
        const mx = (vx - 280) / this.zoom + 280 + this.panX;
        const my = (vy - 280) / this.zoom + 280 + this.panY;
        const h = (this.hits || []).find((o) => Math.hypot(o.x - mx, o.y - my) < o.r / Math.sqrt(this.zoom));
        if (h && h.go) return tab.go(h.go);
        if (h && h.nav) { env.setWaypoint?.(h.nav); return this.update(el, tab); }
        env.setWaypoint?.({ mx, my });
        this.update(el, tab);
      });
      this.update(el, tab);
    },
    _setZoom(z) {
      this.zoom = Math.max(1, Math.min(3.2, z));
      this._clampPan(this.panX, this.panY);
    },
    _clampPan(px, py) {
      const lim = 280 * (1 - 1 / this.zoom);
      this.panX = Math.max(-lim, Math.min(lim, px));
      this.panY = Math.max(-lim, Math.min(lim, py));
    },
    update(el, tab) {
      if (!this.cv) return;
      this.hits = env.drawMap(this.cv, filt, null, null, { zoom: this.zoom, panX: this.panX, panY: this.panY });
      const zBtn = el.querySelector('[data-z="reset"]');
      if (zBtn) zBtn.textContent = `${this.zoom.toFixed(this.zoom === 1 ? 0 : 1)}×`;
      const hint = el.querySelector('[data-v="hint"]'), t = env.mapHint();
      if (hint && hint.textContent !== t) hint.textContent = t;
      const wpEl = el.querySelector('[data-v="wp"]'), wpHtml = env.mapWaypoint ? env.mapWaypoint() : '';
      if (wpEl && wpEl.innerHTML !== wpHtml) wpEl.innerHTML = wpHtml;
      const sonar = el.querySelector('[data-v="sonar"]'), s = env.mapSonar ? env.mapSonar() : '';
      if (sonar) {
        sonar.style.display = s ? '' : 'none';
        if (sonar.innerHTML !== s) sonar.innerHTML = s;
      }
      if (tab?.head) tab.head.textContent = this.zoom > 1.02 ? `縮放 ${this.zoom.toFixed(1)}×` : '北朝上・點擊海面可標記導航';
    },
    leave() { this.cv = null; },
  };

  // ---- 2. 船（Dock 2）：頂部頁籤切換「船隊與調度」／「改裝與塗裝」 ----
  const boat = htmlApp({
    id: 'boat', name: '船', icon: 'boat', color: '#ff7f5c',
    tab: 'fleet',
    badge() { return env.boatWarn() ? '!' : ''; },
  }, function (tab) {
    const d = env.boats();
    const modCount = Object.values(BOAT_MODS).filter((m) => d.mods?.[m.id]).length;
    if (tab?.head) tab.head.textContent = `已擁有 ${d.list.length} 艘・改裝 ${modCount} / ${Object.keys(BOAT_MODS).length}`;
    const tabs = `<div class="tbTabs">
      <button class="${this.tab !== 'custom' ? 'on' : ''}" data-act="subTab" data-arg="fleet">⛵ 船隊與調度（${d.list.length}）</button>
      <button class="${this.tab === 'custom' ? 'on' : ''}" data-act="subTab" data-arg="custom">🔧 船隻改裝與塗裝</button>
    </div>`;
    if (this.tab === 'custom') {
      const ownedPaints = new Set(d.paints || ['default']);
      const pv = BOAT_PAINTS.some((p) => p.id === this.pv) ? this.pv : (d.paint || 'default');
      const P = BOAT_PAINTS.find((p) => p.id === pv), owned = ownedPaints.has(pv), cur = (d.paint || 'default') === pv, price = `$${P.price.toLocaleString('en-US')}`;
      const S = BOAT_TYPES[d.active] || BOAT_TYPES.skiff;
      const swatches = BOAT_PAINTS.map((p) => `<button class="tbSw${p.id === pv ? ' on' : ''}" data-act="pvPaint" data-arg="${p.id}" title="${esc(p.name)}" style="background:${cssRgb(p.rgb || S.paint || [0.8, 0.8, 0.8], 1.25)}">${ownedPaints.has(p.id) ? '' : '🔒'}</button>`).join('');
      const btn = cur ? '<button disabled>✓ 目前塗裝</button>'
        : owned ? `<button class="main" data-act="paint" data-arg="${pv}">套用此塗裝</button>`
          : d.atPaint ? `<button class="main" data-act="paint" data-arg="${pv}"${(d.money ?? 0) < P.price ? ' disabled' : ''}>${(d.money ?? 0) < P.price ? `錢不夠（${price}）` : `購買並套用　${price}`}</button>`
            : `<button disabled>${price}・到海上修船屋或大港船塢的塗裝櫃前購買</button>`;
      const paints = `<div class="tbSec"><span>船殼塗裝預覽（點色票看看；買過的隨時免費換）</span></div><div class="tbc on">
        <div class="tbPv">${svgBoatPaintPreview(pv, d.active)}</div><div class="tbSws">${swatches}</div>
        <h4 style="margin-top:10px">${esc(P.name)}<span class="tbTag ${cur ? 'g' : owned ? '' : 'q'} r">${cur ? '✓ 使用中' : owned ? '已擁有' : price}</span></h4>
        <div class="tbBtns">${btn}</div></div>`;
      const mods = `<div class="tbSec"><span>永久改裝（海上修船屋、大港船塢購買；裝一次，名下的漁船、大漁船都有）</span></div><div class="tbBaits">${Object.values(BOAT_MODS).map((m) => {
        const on = !!d.mods?.[m.id];
        const lamp = m.id === 'lamp' && on ? (d.canLamp ? `<div class="tbBtns"><button class="main" data-act="fishLamp">${d.fishLamp ? '關掉集魚燈' : '打開集魚燈'}</button></div>` : '<p class="tbNote">現在這艘是小舢舨，裝不了；換漁船或大漁船出來就有</p>') : '';
        return `<div class="tbc${on ? ' on' : ''}" style="margin:0;padding:10px 12px"><h4>${esc(m.name)}<span class="tbTag ${on ? 'g' : 'q'} r">${on ? '✓ 已安裝' : `$${m.price.toLocaleString('en-US')}`}</span></h4><p class="tbNote">${esc(m.desc)}</p>${lamp}</div>`;
      }).join('')}</div>`;
      return tabs + paints + mods;
    }
    const cards = d.list.map((b) => {
      const low = { hp: b.hp < env.low.hp, fuel: b.fuel < b.tank * env.low.fuel };
      const head = `<h4>${ICON.boat} ${esc(b.name)}${b.active ? '<span class="tbTag">使用中</span>' : '<span class="tbTag q">在倉庫</span>'}${b.engine ? `<span class="tbTag g">引擎 Lv${b.engine}</span>` : ''}<span class="r">${esc(b.where)}</span></h4>`;
      const rows = b.sunk ? '<p class="tbNote tbBad">沉了：等一下港口會補一艘給你</p>' : `<div class="tbRows"><span>耐久</span>${meter(b.hp, low.hp)}<span>${pct(b.hp)}</span><span>燃油</span>${meter(b.fuel / b.tank, low.fuel)}<span>${Math.floor(b.fuel)} / ${b.tank} 公升</span></div>`;
      const warn = !b.sunk && (low.hp || low.fuel) ? `<p class="tbNote tbBad">${low.fuel ? '⚠️ 油快沒了，到漁具行、海上修船屋或大港買油桶加油' : ''}${low.fuel && low.hp ? '；' : ''}${low.hp ? '⚠️ 船受損了，開到海上修船屋或大港船塢的修船台修' : ''}</p>` : '';
      const btns = b.sunk ? '' : b.active
        ? `<div class="tbBtns"><button class="main" data-act="call">叫到最近的船位</button><button data-act="mapBoat">在地圖上看位置</button></div>`
        : `<div class="tbBtns"><button class="main" data-act="swap" data-arg="${b.type}">換這艘船出來</button></div>`;
      return `<div class="tbc${b.active ? ' on' : ''}${warn ? ' warn' : ''}">${head}${rows}${warn}${btns}</div>`;
    }).join('');
    const why = d.block ? `<p class="tbNote">現在不能叫船、換船：${esc(d.block)}</p>` : '<p class="tbNote">💡 叫船、換船：人在港口岸上（潮汐灣、海上修船屋、大港灣島）時，船會停到離你最近的空船位</p>';
    return tabs + cards + why + (d.more ? `<p class="tbNote">${esc(d.more)}</p>` : '');
  }, env);

  // ---- 3. 背包（Dock 3）：頂部頁籤切換「釣具與打窩」／「魚箱明細（列出每條魚）」 ----
  const bag = htmlApp({
    id: 'bag', name: '背包', icon: 'bag', color: '#e2a03d',
    tab: 'gear',
  }, function (tab) {
    const b = env.bag(), th = env.thumbs();
    const boxFishCount = b.boxes.reduce((s, x) => s + x.n, 0);
    if (tab?.head) tab.head.textContent = `持有 $${(b.money ?? 0).toLocaleString('en-US')}・誘魚桶 ${b.chum || 0}/${b.chumMax ?? CHUM_SPEC.max}`;
    const tabs = `<div class="tbTabs">
      <button class="${this.tab !== 'box' ? 'on' : ''}" data-act="subTab" data-arg="gear">🎣 釣具與打窩</button>
      <button class="${this.tab === 'box' ? 'on' : ''}" data-act="subTab" data-arg="box">📦 魚箱與漁獲明細（${boxFishCount} 條）</button>
    </div>`;
    if (this.tab === 'box') {
      const heldCard = `<div class="tbc"><h4>✋ 目前雙手狀態<span class="r">${esc(b.held || '空手')}</span></h4><p class="tbNote">手上拿著的魚可放進魚箱、放進收購籃，或對準其他玩家按 E 贈送</p></div>`;
      if (!b.boxes.length) {
        return `${tabs}${heldCard}<div class="tbc"><p class="tbNote" style="margin:0">還沒有魚箱：到潮汐灣商店購買（每人限 1 個，加大容量可裝中大型魚，且別人拿不走箱內的魚）。</p></div>`;
      }
      const boxCards = b.boxes.map((x) => {
        const listHtml = x.fish && x.fish.length
          ? `<div style="margin-top:8px;border-top:1.5px solid var(--line)">${x.fish.map((f, idx) => {
            const sp = SPECIES[f.id] || { name: '魚', rarity: 'common' };
            const rar = RARITY[sp.rarity || 'common'];
            return `<div class="tbRankRow" style="grid-template-columns:28px 44px 1fr auto;padding:5px 6px">
              <span class="tbRankNum">${idx + 1}</span>
              <img class="tbRankImg" src="${th.get(f.id) || ''}" alt="">
              <span><b>${esc(sp.name)}</b> <span class="tbTag${sp.rarity === 'rare' ? ' c' : sp.rarity === 'common' ? ' q' : ''}" style="font-size:11px;padding:0 6px">${rar.label}</span><small style="display:block;color:var(--ink-2)">${Math.round(f.len * 100)} 公分・${f.kg.toFixed(2)} 公斤</small></span>
              <span class="tbRankVal">$${(f.value || 0).toLocaleString('en-US')}</span>
            </div>`;
          }).join('')}</div>`
          : '<p class="tbNote">魚箱目前是空的，釣到魚後對準魚箱按 E 即可放入。</p>';
        return `<div class="tbc on">
          <h4>${ICON.box} 專屬加大魚箱（${x.n} 條・${x.kg.toFixed(1)} 公斤）<span class="r">${esc(x.where)}</span></h4>
          <div class="tbRows"><span>箱內空間</span>${meter(x.used || 0, (x.used || 0) > 0.88, 'sea')}<span>${pct(x.used || 0)}</span></div>
          <p class="tbNote">箱內漁獲總值：<b>$${x.value.toLocaleString('en-US')}</b>（抱著魚箱對準收購籃按 E 可整箱賣出）</p>
          ${listHtml}
        </div>`;
      }).join('');
      return tabs + heldCard + boxCards;
    }
    const lvRatio = (b.rod.lv + 1) / 6;
    const rod = `<div class="tbc${b.rod.broken ? ' warn' : ' on'}">
      <h4>${ICON.rod} 釣竿 Lv${b.rod.lv}${b.rod.lv >= 5 ? '<span class="tbTag g">滿級</span>' : ''}<span class="r">拋竿最遠約 ${Math.round(b.rod.range)} 公尺</span></h4>
      ${b.rod.broken ? '<p class="tbNote tbBad">⚠️ 釣竿斷了：請回潮汐灣的漁具行修理</p>' : `<div class="tbRows">
        <span>拋竿距離</span>${meter(lvRatio, false, 'sea')}<span>${Math.round(b.rod.range)}m</span>
        <span>綠區與抗斷</span>${meter(lvRatio, false)}<span>Lv${b.rod.lv} / 5</span>
      </div><p class="tbNote">在潮汐灣漁具行可升級（上限 Lv5）：拋竿距離更遠、拉扯安全綠區更寬、大魚抗斷線更強</p>`}
    </div>`;
    const baits = `<div class="tbSec"><span>魚餌選擇（點一下換上；也可按快捷鍵 B）</span></div><div class="tbBaits">${b.baits.map((x) => `<button class="tbBait${x.id === b.bait ? ' on' : ''}" data-act="bait" data-arg="${x.id}">${esc(x.name)}${x.id ? `　× ${x.n}` : ''}<small>${esc(x.desc)}</small></button>`).join('')}</div>`;
    const chum = `<div class="tbSec"><span>誘魚桶打窩（漁具行、大港補給所購買；提在手上右鍵丟進海裡，或按 U 就地施放）</span></div><div class="tbc${b.chum > 0 ? ' on' : ''}"><h4>🪣 誘魚桶 × ${b.chum || 0} / ${b.chumMax ?? CHUM_SPEC.max}<span class="r">$${CHUM_SPEC.price} / 桶</span></h4><p class="tbNote">在面前水面產生半徑 ${CHUM_SPEC.radius}m、持續 ${CHUM_SPEC.life} 秒、可釣 ${CHUM_SPEC.quota} 尾的人工魚群（不會與黃金魚潮或既有魚群疊加）</p><div class="tbBtns"><button class="main" data-act="useChum"${b.chum > 0 ? '' : ' disabled'}>${b.chum > 0 ? '就地施放誘魚桶 (U)' : '目前沒有誘魚桶（漁具行、大港補給所有賣）'}</button></div></div>`;
    return tabs + rod + baits + chum;
  }, env);

  // ---- 4. 圖鑑（Dock 4）：iPad 左右雙欄 Split View ＋ 稀有度篩選 ＋ 生態垂釣線索 ----
  const dex = htmlApp({
    id: 'dex', name: '圖鑑', icon: 'fish', color: '#1d6f9f',
    filt: 'all',
    badge() { const n = env.dexNew(); return n ? String(n) : ''; },
    leave() { env.dexSeen(); },
  }, function (tab) {
    const d = env.dex(), th = env.thumbs();
    if (tab?.head) tab.head.textContent = `已收集 ${d.got} / ${d.total}（${Math.round(d.got / Math.max(1, d.total) * 100)}%）`;
    const match = (f) => {
      if (this.filt === 'common') return !f.junk && f.rarity === 'common';
      if (this.filt === 'uncommon') return !f.junk && f.rarity === 'uncommon';
      if (this.filt === 'rare') return !f.junk && f.rarity === 'rare';
      if (this.filt === 'junk') return !!f.junk;
      if (this.filt === 'missing') return !f.e;
      return true;
    };
    const shown = d.list.filter(match);
    if (!this.sel || !shown.some((f) => f.id === this.sel)) {
      this.sel = (shown.find((f) => f.isNew) || shown.find((f) => f.e) || shown[0] || d.list[0]).id;
    }
    const s = d.list.find((f) => f.id === this.sel) || d.list[0], rar = RARITY[s.rarity];
    const clues = fishClues(s.id);
    const chips = [
      ['all', `全部 ${d.list.length}`],
      ['common', '普通'],
      ['uncommon', '少見'],
      ['rare', '稀有'],
      ['junk', '雜物'],
      ['missing', `未釣過 ${d.list.filter((f) => !f.e).length}`],
    ].map(([k, label]) => `<button class="tbChip${this.filt === k ? ' on' : ''}" data-act="dexFilt" data-arg="${k}">${label}</button>`).join('');

    const cell = (f) => `<div class="tbFish${f.e ? '' : ' no'}${f.id === this.sel ? ' sel' : ''}" data-act="pick" data-arg="${f.id}">${f.isNew ? '<span class="new">新</span>' : ''}${f.junk ? '' : `<span class="rar" style="background:${RAR_COL[f.rarity]}"></span>`}<img src="${th.get(f.id) || ''}" alt="">${f.e ? esc(f.name) : '？？？'}</div>`;

    const rightCard = `<div class="tbc tbSpecCard">
      <div class="tbSpecHero${s.e ? '' : ' no'}"><img src="${th.get(s.id) || ''}" alt=""></div>
      <h4>${s.e ? esc(s.name) : '？？？'}<span class="tbTag${s.rarity === 'rare' ? ' c' : s.rarity === 'common' ? ' q' : ''}">${s.junk ? '雜物' : rar.label}</span></h4>
      ${s.e
        ? `<div class="tbNote" style="color:var(--ink)"><b>個人紀錄：</b>累計釣獲 ${s.e.n} 條<br>最大體長 <b>${Math.round(s.e.len * 100)} 公分</b>・最重 <b>${s.e.kg.toFixed(2)} 公斤</b><br>最大紀錄釣點：${esc(s.e.at || '海上')}</div>`
        : `<div class="tbNote">尚未捕獲此物種。可參考下方棲息地與時段線索前往垂釣：</div>`}
      <div class="tbClueBox">
        <div>📍 <b>出沒水域：</b>${esc(clues.where)}</div>
        <div>🕒 <b>活躍條件：</b>${esc(clues.time)}</div>
        <div>⚖️ <b>常見體型：</b>${esc(clues.kgRange)}</div>
        <div>💡 <b>垂釣情報：</b>${esc(clues.baitTip)}</div>
      </div>
    </div>`;

    return `<div class="tbDexLayout">
      <div class="tbDexFilter">${chips}</div>
      <div class="tbDexSplit">
        <div class="tbDexLeft" data-keep="dex-${this.filt}"><div class="tbDex">${shown.map(cell).join('')}</div></div>
        <div class="tbDexRight">${rightCard}</div>
      </div>
    </div>`;
  }, env);
  const dexMount = dex.mount;
  dex.mount = function (el, tab) { el.style.overflow = 'hidden'; dexMount.call(this, el, tab); dragScroll(el, '.tbDexLeft'); };

  // ---- 5. 天氣（Desktop 1）：風向羅盤、海浪、SVG 24h 即時潮汐曲線圖、預報與徵兆 ----
  const weather = htmlApp({ id: 'weather', name: '天氣', icon: 'cloud', color: '#5fb3dd' }, function (tab) {
    const w = env.weather();
    if (tab?.head) tab.head.textContent = `第 ${w.day} 天・${w.skyText}・風力 ${w.windLv} 級`;
    const compass = `<svg viewBox="0 0 120 120" width="108" height="108" style="display:block;margin:0 auto">
      <circle cx="60" cy="60" r="50" fill="rgba(44,143,201,0.1)" stroke="var(--edge)" stroke-width="3"/>
      ${[['北', 60, 21], ['東', 101, 64], ['南', 60, 106], ['西', 19, 64]].map(([t, x, y]) => `<text x="${x}" y="${y}" text-anchor="middle" font-size="13" fill="${t === '北' ? 'var(--coral-d)' : 'var(--ink-2)'}" font-family="var(--font)">${t}</text>`).join('')}
      <g transform="rotate(${Math.round(w.windTo)} 60 60)"><path d="M60 28 L70 50 L63 48 L63 88 L57 88 L57 48 L50 50 Z" fill="var(--sea)"/></g></svg>`;

    // SVG 即時潮汐曲線（取樣 25 個點，涵蓋過去 4 小時至未來 20 小時）
    const curve = w.tideCurve || [];
    let tideSvg = '';
    if (curve.length > 1) {
      const W = 520, H = 74, cy = H / 2, amp = 26;
      const pts = curve.map((p, i) => [Math.round(i / (curve.length - 1) * W), Math.round(cy - p.norm * amp)]);
      const lineD = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
      const areaD = `${lineD} L${W},${H} L0,${H} Z`;
      const nowIdx = curve.findIndex((p) => p.now);
      const [nx, ny] = pts[nowIdx >= 0 ? nowIdx : 4];
      tideSvg = `<div class="tbc" style="margin-top:10px;padding:9px 14px">
        <h4>${ICON.tide} 24 小時潮汐觀測曲線<span class="r">${esc(w.tide)}</span></h4>
        <svg viewBox="0 0 ${W} ${H + 18}" width="100%" height="84" style="display:block;margin-top:4px;overflow:visible">
          <path d="${areaD}" fill="rgba(44, 143, 201, 0.18)"/>
          <line x1="0" y1="${cy}" x2="${W}" y2="${cy}" stroke="rgba(29, 111, 159, 0.3)" stroke-dasharray="4 4" stroke-width="1.5"/>
          <path d="${lineD}" fill="none" stroke="var(--sea)" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="${nx}" cy="${ny}" r="5.5" fill="var(--coral)" stroke="#fff" stroke-width="2"/>
          <text x="${nx}" y="${Math.max(12, ny - 9)}" text-anchor="middle" font-size="11" fill="var(--coral-d)" font-family="var(--font)">現在</text>
          ${[[0, '-4h'], [Math.round(W * 4 / 24), '現在'], [Math.round(W * 10 / 24), '+6h'], [Math.round(W * 16 / 24), '+12h'], [Math.round(W * 22 / 24), '+18h']].map(([x, t]) => `<text x="${x}" y="${H + 14}" text-anchor="middle" font-size="11" fill="var(--ink-2)" font-family="var(--font)">${t}</text>`).join('')}
        </svg>
      </div>`;
    }

    return `<div class="tbTwo">
      <div class="tbc">${compass}<p style="text-align:center;margin:2px 0 0">${esc(w.windFrom)}風 ${w.windLv} 級・每秒 ${Math.round(w.windMs)} 公尺</p><p class="tbNote" style="text-align:center">箭頭指向風吹去的方向（上方是北）</p></div>
      <div class="tbc"><div class="tbBig">${esc(w.time)}</div><p style="margin:2px 0 6px">第 ${w.day} 天・${ICON[w.skyIcon] || ''} ${esc(w.skyText)}</p>
        <div class="tbRows" style="grid-template-columns:auto 1fr"><span>${ICON.wave}</span><span>外海浪高約 ${w.waveOpen.toFixed(1)} 公尺${w.waveHere !== null ? `，你這裡約 ${w.waveHere.toFixed(1)} 公尺` : ''}</span>
        <span>${ICON.tide}</span><span>${esc(w.tideShort)}</span>
        <span>${ICON.wind}</span><span>風力 ${w.windLv} 級：${esc(w.windWord)}</span></div></div></div>
      ${tideSvg}
      <div class="tbTwo" style="margin-top:10px">
        <div class="tbc"><h4>今天的預報</h4><ul class="tbList">${w.forecast.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
        <div class="tbc${w.danger ? ' warn' : ''}"><h4>海上徵兆與警報</h4><ul class="tbList">${w.signs.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
      </div>`;
  }, env);

  // ---- 6. 榜單（Desktop 2）：本房紀錄、今日全服紀錄、漁會捐贈榜（捐款、每週稱號） ----
  const rank = htmlApp({
    id: 'rank', name: '榜單', icon: 'trophy', color: '#d89628',
    tab: 'room', amt: '',
  }, function (tab) {
    const rk = env.ranks ? env.ranks() : { room: [], daily: [], donate: [], guild: null };
    const th = env.thumbs();
    const G = rk.guild || { amount: 0, rank: 0, titles: [], wear: '' }, cash = (v) => `$${Math.round(v || 0).toLocaleString('en-US')}`;
    if (tab?.head) tab.head.textContent = G.wear ? `配戴稱號：${G.wear}` : `本週捐款 ${cash(G.amount)}`;
    const tabs = `<div class="tbTabs">
      <button class="${this.tab === 'room' ? 'on' : ''}" data-act="subTab" data-arg="room">🏆 本房大魚榜</button>
      <button class="${this.tab === 'daily' ? 'on' : ''}" data-act="subTab" data-arg="daily">🌎 今日全服榜</button>
      <button class="${this.tab === 'guild' ? 'on' : ''}" data-act="subTab" data-arg="guild">📜 漁會捐贈榜・稱號</button>
    </div>`;
    if (this.tab === 'guild') {
      const left = G.endsAt ? countdownText(G.endsAt - Date.now()) : '', min = G.min || GUILD.min, owned = new Set(G.titles || []);
      const me = `<div class="tbc gold"><h4>📜 漁會捐贈榜<span class="tbTag gold r">${left ? `${esc(left)}後重置` : '每週一清晨 5 點重置'}</span></h4>
        <p class="tbNote">這一週你捐了 <b>${cash(G.amount)}</b>${G.rank ? `，排第 <b>${G.rank}</b> 名` : ''}。每週一清晨 5 點（台灣時間）榜單和稱號一起重新算，大家從零開始。</p></div>`;
      const give = !rk.guild ? '' : rk.atBox
        ? `<div class="tbc on"><h4>🪙 捐給漁會<span class="r">身上 ${cash(rk.money)}</span></h4>
          <div class="tbGive"><input type="number" inputmode="numeric" min="${min}" step="100" data-bind="amt" placeholder="捐多少（最少 $${min}）">
            <button data-act="amtAdd" data-arg="100">＋100</button><button data-act="amtAdd" data-arg="1000">＋1,000</button><button data-act="amtAdd" data-arg="10000">＋10,000</button><button data-act="amtAdd" data-arg="0">清除</button></div>
          <div class="tbBtns"><button class="main" data-act="donate">捐獻</button></div><p class="tbNote">捐出去的錢不會退；捐款有經驗值。</p></div>`
        : '<div class="tbc"><p class="tbNote" style="margin:0">🪙 要捐款：走到「漁會捐款箱」前面對著它按 E（潮汐灣魚市場東側、大港灣島的榜亭旁各有一座）。</p></div>';
      const card = (t, note) => {
        const has = owned.has(t.name), cur = G.wear === t.name;
        return `<button class="tbBait${cur ? ' on' : ''}" ${has ? `data-act="wear" data-arg="${esc(t.name)}"` : 'disabled'}${t.gold ? ' style="border-color:#d8a32a"' : ''}>
          <b>${t.gold ? '' : '🎖️ '}${esc(t.name)}</b><small>${cur ? '✓ 配戴中（點一下拿掉）' : has ? '✓ 這一週可以戴（點一下戴上）' : note}</small></button>`;
      };
      const basic = DONATION_MILESTONES.map((t) => card(t, `這一週再捐 ${cash(Math.max(0, t.minDonate - G.amount))} 解鎖`)).join('');
      const special = SPECIAL_TITLES.map((t) => card(t, `週榜第 ${t.rank} 名專屬（還要捐滿 ${cash(t.minDonate)}）`)).join('');
      const list = rk.donate || [];
      const rows = Array.from({ length: 10 }, (_, i) => {
        const e = list[i], numCls = i === 0 ? ' n1' : i === 1 ? ' n2' : i === 2 ? ' n3' : '', medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1);
        if (!e) return `<div class="tbRankRow txt"><span class="tbRankNum${numCls}">${medal}</span><span style="color:var(--ink-2)">— 還沒有人 —</span><span></span></div>`;
        return `<div class="tbRankRow txt${i === 0 ? ' top1' : ''}"><span class="tbRankNum${numCls}">${medal}</span>
          <span><b>${esc(e.name)}</b>${e.title ? `　<span class="tbTag ${e.gold ? 'gold' : ''}" style="font-size:11px;padding:0 7px">${esc(e.title)}</span>` : ''}</span><span class="tbRankVal">${cash(e.amount)}</span></div>`;
      }).join('');
      return `${tabs}${me}${give}<div class="tbSec"><span>基本稱號（自己這一週捐滿就有，挑一個戴）</span></div><div class="tbBaits">${basic}</div>
        <div class="tbSec"><span>特殊稱號（週榜前三名，被超過就換人）</span></div><div class="tbBaits">${special}</div>
        <div class="tbSec"><span>本週捐贈榜（所有房間合計）</span></div><div class="tbc" style="padding:2px 0">${rows}</div>`;
    }
    const list = this.tab === 'daily' ? (rk.daily || []) : (rk.room || []);
    const note = this.tab === 'daily' ? '所有房間合計・每人取最高價一條・每日午夜重置' : '本房間內賣出單條最值錢的魚前 10 名';
    const rows = Array.from({ length: 10 }, (_, i) => {
      const e = list[i];
      const numCls = i === 0 ? ' n1' : i === 1 ? ' n2' : i === 2 ? ' n3' : '';
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1);
      if (!e) return `<div class="tbRankRow"><span class="tbRankNum${numCls}">${medal}</span><span></span><span style="color:var(--ink-2)">— 尚無紀錄 —</span><span></span></div>`;
      const sp = SPECIES[e.id] || { name: '魚', rarity: 'common' };
      return `<div class="tbRankRow${i === 0 ? ' top1' : ''}">
        <span class="tbRankNum${numCls}">${medal}</span>
        <img class="tbRankImg" src="${th.get(e.id) || ''}" alt="">
        <span><b>${esc(e.name)}</b>　<span style="color:var(--sea-d)">${esc(sp.name)}</span><small style="display:block;color:var(--ink-2)">${Math.round(e.len * 100)} 公分・${e.kg.toFixed(e.kg >= 100 ? 0 : e.kg >= 10 ? 1 : 2)} 公斤</small></span>
        <span class="tbRankVal">$${(e.value || 0).toLocaleString('en-US')}</span>
      </div>`;
    }).join('');
    return `${tabs}<p class="tbNote" style="margin:0 0 6px">${note}</p><div class="tbc" style="padding:2px 0">${rows}</div>`;
  }, env);

  // ---- 7. 祭壇（Desktop 3）：海神祭壇（全服黃金魚潮、風暴召喚） ----
  const shrine = htmlApp({
    id: 'shrine', name: '祭壇', icon: 'shrine', color: '#7a62d8',
    badge() { const s = env.shrine ? env.shrine() : null; return (s?.blessing > 0 || s?.tideWait > 0 || s?.stormWait > 0) ? '•' : ''; },
  }, function (tab) {
    const s = env.shrine ? env.shrine() : { blessing: 0, tideWait: 0, stormWait: 0, money: 0, hot: null, chums: 0, skyText: '平靜' };
    if (tab?.head) tab.head.textContent = `持有 $${(s.money ?? 0).toLocaleString('en-US')}`;
    const banner = s.blessing > 0
      ? `<div class="tbc gold"><h4>✨ 黃金魚潮生效中！<span class="tbTag c r">剩餘 ${s.blessing} 秒</span></h4><p class="tbNote">全房所有玩家釣獲「少見、稀有」魚種的權重翻倍（×2.0），海上已湧現不限尾數的黃金魚群熱點！</p></div>`
      : s.tideWait > 0
        ? `<div class="tbc gold"><h4>⏳ 黃金魚潮倒數中<span class="tbTag c r">${s.tideWait} 秒後降臨</span></h4><p class="tbNote">海神即將回應獻祭！全體釣客可把握時間前往釣點迎接 10 分鐘黃金魚潮。</p></div>`
        : s.stormWait > 0
          ? `<div class="tbc gold"><h4>⏳ 風暴海神祭倒數中<span class="tbTag c r">${s.stormWait} 秒後降臨</span></h4><p class="tbNote">天空烏雲正在聚集，巨浪風暴即將壓境，請做好準備！</p></div>`
          : `<div class="tbc"><h4>🔱 潮汐灣海神祭壇<span class="r">目前海況：${esc(s.skyText)}</span></h4><p class="tbNote">向海神獻上金幣發動獻祭，倒數 3 分鐘後降臨全房共享恩澤，並會在全服聊天室廣播。</p></div>`;
    const tideBusy = s.blessing > 0 || s.tideWait > 0;
    const tideBtn = s.tideWait > 0 ? `倒數中（${s.tideWait}s）` : s.blessing > 0 ? `生效中（${s.blessing}s）` : `獻上 $${BLESSINGS.tide.price.toLocaleString('en-US')} 發動魚潮`;
    const stormBusy = s.stormWait > 0;
    const stormBtn = stormBusy ? `倒數中（${s.stormWait}s）` : `獻上 $${BLESSINGS.storm.price.toLocaleString('en-US')} 召喚風暴`;
    const cards = `<div class="tbTwo">
      <div class="tbc${tideBusy ? ' on' : ''}">
        <h4>🌊 ${esc(BLESSINGS.tide.name)}<span class="tbTag r">$${BLESSINGS.tide.price.toLocaleString('en-US')}</span></h4>
        <p class="tbNote">${esc(BLESSINGS.tide.desc)}（不會與誘魚桶疊加）。</p>
        <div class="tbBtns"><button class="main" data-act="bless" data-arg="tide"${tideBusy ? ' disabled' : ''}>${tideBtn}</button></div>
      </div>
      <div class="tbc${stormBusy ? ' on' : ''}">
        <h4>⛈️ ${esc(BLESSINGS.storm.name)}<span class="tbTag c r">$${BLESSINGS.storm.price.toLocaleString('en-US')}</span></h4>
        <p class="tbNote">${esc(BLESSINGS.storm.desc)}（風暴前夕與風暴過後會出現皇帶魚、鯊魚、鬼頭刀等限定大魚）。</p>
        <div class="tbBtns"><button class="main" data-act="bless" data-arg="storm"${stormBusy ? ' disabled' : ''}>${stormBtn}</button></div>
      </div>
    </div>`;
    const status = `<div class="tbc" style="margin-top:10px"><h4>🐟 目前海域魚群動態</h4><p class="tbNote">${s.hot ? (s.hot.unlimited ? '✓ 海上正湧現不限尾數黃金魚群，可打開「地圖」查看位置' : '✓ 海上目前有自然魚群（海鳥盤旋處），可打開「地圖」查看位置') : '目前海面上暫無自然魚群，發動「黃金魚潮」可召喚不限尾數黃金魚群'}；人工打窩魚群：${s.chums || 0} 處。</p></div>`;
    return banner + cards + status;
  }, env);

  // ---- 8. 房間（Desktop 4）：這間房的船隊（可以申請加入）、自己的船隊（隊長管理）、還沒組隊的人 ----
  const room = htmlApp({ id: 'room', name: '房間', icon: 'users', color: '#3dbb7a' }, function (tab) {
    const r = env.room(), pt = r.party || { n: 0, full: false }, max = PARTY.max;
    if (tab?.head) tab.head.textContent = `${r.name}・${r.list.length} / ${r.max} 人${pt.n ? `・船隊 ${pt.n} / ${max}` : ''}`;
    const tag = (text, cls) => `<span class="tbTag ${cls}" style="font-size:11px;padding:0 7px;margin-right:4px">${text}</span>`;
    const groups = r.groups || [], mine = groups.find((g) => g.mine), rest = groups.filter((g) => !g.mine);
    // 改隊名：整頁只放這一張（列表一直在更新，輸入框會被洗掉）
    if (this.pnEdit && mine && r.lead) {
      return `<div class="tbc on"><h4>✏️ 幫船隊取名字</h4>
        <p class="tbNote">最多 ${PARTY.nameMax} 個字，同房的人都看得到；留白就用「隊長的名字＋的船隊」。</p>
        <div class="tbGive"><input data-bind="pname" maxlength="${PARTY.nameMax}" placeholder="${esc(mine.custom ? '' : mine.name)}"><button class="main" data-act="pnSave">確定</button><button data-act="pnCancel">取消</button></div></div>`;
    }
    const sure = (act, id, label) => (this.sure === `${act}:${id}` ? `<button class="tbMini main" data-act="${act}" data-arg="${id}">確定${label}？</button>` : `<button class="tbMini" data-act="${act}" data-arg="${id}">${label}</button>`);
    const row = (p, i, btns = '', lead = 0) => {
      const badge = (p.lv ? tag(`Lv.${p.lv}`, 'q') : '') + (p.id === lead ? tag('隊長', 'g') : '') + (p.lfg ? tag('找船隊', 'c') : '') + (p.title ? tag(esc(p.title), p.gold ? 'gold' : '') : '');
      return `<div class="tbWho"${i ? ' style="border-top:1.5px solid var(--line)"' : ''}>
        <span class="dot${p.here ? '' : ' off'}"></span>
        <span>${badge}<b>${esc(p.name)}</b>${p.me ? '（你）' : ''}</span>
        <span class="r">${esc(p.where)}${p.far ? `<br>${esc(p.far)}` : ''}</span>${btns}
      </div>`;
    };
    const perks = `<p class="tbNote" style="margin:0 2px 10px">同隊好處：經驗 +${Math.round(LEVEL.party * 100)}%、隊友賣魚你也分紅 ${Math.round(PARTY.share * 100)}%、可以幫隊友掌舵、開關船燈和集魚燈、綁解纜繩、代付修船費，畫面上標出隊友在哪，隊友放在外面的油桶和誘魚桶會用藍色描邊標出來；隊裡有人開${FRESH_BOAT.name}，全隊賣魚再多 ${Math.round(FRESH_BOAT.freshBonus * 100)}%。聊天室可以切到「隊伍」頻道只跟隊友說話。離開房間就退隊。</p>`;

    // 自己的船隊
    let my = '';
    if (mine) {
      const rows = mine.members.map((p, i) => {
        const btns = p.me ? '<button class="tbMini" data-act="partyLeave">退出船隊</button>'
          : r.lead && p.here ? sure('partyLead', p.id, '交隊長') + sure('partyKick', p.id, '請離開')
            : r.lead ? sure('partyKick', p.id, '請離開') : '';
        return row(p, i, btns, mine.lead);
      }).join('');
      const tools = r.lead ? `<div class="tbBtns" style="margin-top:6px"><button class="tbMini" data-act="pnEdit">✏️ 改隊名</button>
          <button class="tbMini${mine.open ? ' main' : ''}" data-act="partyOpen" data-arg="${mine.open ? 0 : 1}">${mine.open ? '✓ 開放申請中' : '不開放申請'}</button></div>`
        : `<p class="tbNote" style="margin:4px 0 0">隊長是 ${esc(mine.members[0]?.name || '')}：他可以改隊名、交隊長、請人離開、決定開不開放申請。</p>`;
      my = `<div class="tbc on"><h4>⛵ ${esc(mine.name)}<span class="tbTag g">${mine.members.length} / ${max} 人</span>${mine.open ? '' : '<span class="tbTag q">不收人</span>'}</h4>${tools}</div>
        <div class="tbc" style="padding:0">${rows}</div>`;
    }

    // 別的船隊
    const cards = rest.map((g) => {
      const full = g.members.length >= max;
      const btn = pt.n ? '' : full ? '<span class="tbTag q">滿了</span>' : !g.open ? '<span class="tbTag q">不收人</span>'
        : r.applied === g.id ? '<button class="tbMini" disabled>申請中…</button>' : `<button class="tbMini main" data-act="partyApply" data-arg="${g.id}">申請加入</button>`;
      const names = g.members.map((p) => `${p.id === g.lead ? '👑' : ''}${esc(p.name)}${p.lv ? `<small> Lv.${p.lv}</small>` : ''}`).join('、');
      const where = g.members.find((p) => p.id === g.lead)?.where || g.members[0]?.where || '';
      return `<div class="tbc"><h4>⛵ ${esc(g.name)}<span class="tbTag g">${g.members.length} / ${max} 人</span><span class="r">${btn}</span></h4>
        <p class="tbNote" style="margin:2px 0 0">${names}${where ? `<br>隊長在${esc(where.replace(/^掌舵中・/, ''))}` : ''}</p></div>`;
    }).join('');
    const others = `<div class="tbSec"><span>這間房的船隊（${rest.length} 隊）</span></div>${cards || `<p class="tbNote">${mine ? '這間房還沒有別的船隊。' : '這間房還沒有船隊。可以按下面的「＋ 組隊」邀人，或打開「我在找船隊」等隊伍來邀你。'}</p>`}`;

    // 還沒組隊的人
    const solos = r.solos || [];
    const soloRows = solos.map((p, i) => {
      const btns = p.me ? `<button class="tbMini${r.lfg ? ' main' : ''}" data-act="lfg" data-arg="${r.lfg ? 0 : 1}">${r.lfg ? '✓ 我在找船隊' : '我在找船隊'}</button>`
        : !p.here ? '' : `<button class="tbMini" data-act="partyInvite" data-arg="${p.id}"${pt.full ? ' disabled' : ''}>＋ 組隊</button>`;
      return row(p, i, btns);
    }).join('');
    const soloSec = solos.length ? `<div class="tbSec"><span>還沒組隊的人（${solos.length}）</span></div><div class="tbc" style="padding:0">${soloRows}</div>` : '';

    const head = mine ? '' : `<div class="tbc"><h4>⛵ 船隊<span class="r">最多 ${max} 人；申請加入現有的船隊，或按「＋ 組隊」邀人</span></h4></div>`;
    return `${head}${my}${perks}${others}${soloSec}
      <p class="tbNote">${esc(r.name)}・目前 ${r.list.length} 人（最多 ${r.max} 人）。灰點代表暫時斷線中，保留進度等待重連。</p>`;
  }, env);

  // ---- 9. 公告（Desktop 5）：固定的說明、下次全服刷新的倒數、更新資訊 ----
  const notice = htmlApp({
    id: 'notice', name: '公告', icon: 'bell', color: '#ff7f5c',
    badge() { return unreadCount() ? '•' : ''; },
  }, function () {
    const at = nextRefreshAt();
    const top = `<div class="tbTwo"><div class="tbc"><h4>${esc(NOTICE.title)}</h4><ul class="tbList">${NOTICE.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
      <div class="tbc" style="text-align:center"><p class="tbNote" style="margin:0">距離下次全服刷新</p><div class="tbBig" style="margin:4px 0">${esc(countdownText(at - Date.now()))}</div><p class="tbNote" style="margin:0">${esc(refreshLabel(at))}（台灣時間）</p></div></div>`;
    const ups = UPDATES.map((u, i) => `<div class="tbc${i === 0 && this.fresh ? ' on' : ''}"><h4>${esc(u.title)}${i === 0 && this.fresh ? '<span class="tbTag c">新</span>' : ''}<span class="r">${esc(u.date)}</span></h4><ul class="tbList">${u.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`).join('');
    return `${top}<div class="tbSec"><span>更新資訊</span></div>${ups}`;
  }, env);
  const noticeMount = notice.mount;
  notice.mount = function (el, tab) {
    this.fresh = Boolean(UPDATES[0] && isUnread(UPDATES[0]));
    markRead();
    noticeMount.call(this, el, tab);
  };

  // ---- 10. 設定（Desktop 6）：畫質、角色、聲音、操作說明 ----
  const set = {
    id: 'set', name: '設定', icon: 'gear', color: '#6f8394',
    mount(el) { env.settings.mount(el); },
    update() {},
    leave() { env.settings.unmount(); },
  };

  return [map, boat, bag, dex, weather, rank, shrine, room, notice, set];
}
