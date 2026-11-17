// 旁人手持 3D 平板的即時畫面貼圖：共用與自己平板相同的 HTML/CSS 版型，透過離屏 SVG foreignObject
// 繪製成高解析 CanvasTexture（只在距離夠近且內容或捲動改變時才節流重繪，不影響主迴圈幀率）。
import * as THREE from 'three';
import { ICON } from './icons.js';
import { TABLET_CSS, DOCK_IDS, renderStatusBar } from './tablet.js';
import { APPS_CSS, makeApps } from './tabletApps.js';
import { SCREENS, TABLET_SIZE } from './tabletMesh.js';

const SCR_AR = (TABLET_SIZE.w - 2 * TABLET_SIZE.bezel) / (TABLET_SIZE.h - 2 * TABLET_SIZE.bezel);
const SCR_W = 720, SCR_H = Math.round(SCR_W / SCR_AR);   // 對齊 3D 螢幕內框（W-2*bezel : H-2*bezel ≈ 1.482，720×486）

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const REMOTE_CSS = `
:root {
  --paper: rgba(191, 232, 248, 0.74); --btn: rgba(214, 241, 251, 0.6); --edge: #8fd0ea;
  --ink: #1f3a50; --ink-2: #3f6178; --line: rgba(29, 111, 159, 0.22);
  --sea: #2c8fc9; --sea-d: #1d6f9f; --sea-l: rgba(179, 226, 245, 0.75); --sea-a: rgba(44, 143, 201, 0.82);
  --coral-a: rgba(255, 127, 92, 0.86); --coral: #ff7f5c; --coral-d: #e2603d;
  --sun: #ffc23c; --good: #3dbb7a; --bad: #ef5b48;
  --font: "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", system-ui, sans-serif;
}
* { box-sizing: border-box; animation: none !important; transition: none !important; }
button { padding: 6px 14px; border-radius: 999px; border: 2px solid var(--line); background: var(--btn); color: var(--ink); font: inherit; white-space: nowrap; }
.ic { width: 1.3em; height: 1.3em; vertical-align: -0.28em; }
.sec { padding: 10px 14px 11px; border-bottom: 1.5px solid var(--line); }
.sec h4, details.sec > summary { margin: 0 0 7px; font-size: 12px; font-weight: 400; letter-spacing: 2px; color: var(--sea-d); }
details.sec > summary { margin: 0; cursor: pointer; list-style: none; }
.line { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 6px 0 0; }
.line:first-of-type { margin-top: 0; }
.note { margin: 5px 0 0; font-size: 12px; color: var(--ink-2); line-height: 1.5; }
.devGrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-top: 6px; }
.devGrid button { padding: 5px 4px; }
.row label { display: flex; justify-content: space-between; margin-bottom: 4px; }
input[type=range] { width: 100%; margin: 0; accent-color: var(--sea); }
#gfxPage { display: none; }
#panel.gfx #gfxPage { display: block; }
#panel.gfx .sec.main { display: none !important; }
#frameChoices { display: flex; flex-wrap: wrap; gap: 4px; }
#frameChoices button { padding: 4px 10px; }
#frameChoices button.on { background: var(--sea-a); border-color: var(--sea); color: #fff; }
.sw { min-width: 54px; padding: 4px 12px; }
.sw.on { background: var(--sea-a); border-color: var(--sea); color: #fff; }
.seg { display: flex; }
.seg button { padding: 4px 13px; border-radius: 0; margin-left: -2px; }
.seg button:first-child { border-radius: 999px 0 0 999px; margin-left: 0; }
.seg button:last-child { border-radius: 0 999px 999px 0; }
.seg button.on { background: var(--sea-a); border-color: var(--sea); color: #fff; }
${TABLET_CSS}
${APPS_CSS}
#tab.held { position: static; display: block; width: ${SCR_W}px; height: ${SCR_H}px; background: transparent; font-family: var(--font); color: var(--ink); }
#tab.held .tbScr { width: ${SCR_W}px; height: ${SCR_H}px; border-radius: 0; }
#tab.held .tbBody { overflow: hidden; }
#tab.held .tbHomeBar { pointer-events: none; }
#tab.held .tbMapImg, .tbMapWrap img { width: 100%; height: 100%; display: block; }
#tab.held .tbMapImg { aspect-ratio: 1; border-radius: 14px; border: 2px solid var(--edge); object-fit: cover; }
`;

function renderSettingsHtml(st, look) {
  const lv = st?.gfxLv ?? 1, snd = st?.sound !== false, vol = Math.round((st?.vol ?? 1) * 100);
  const segGfx = ['低', '中', '高'].map((t, i) => `<button class="${i === lv ? 'on' : ''}">${t}</button>`).join('');
  if (st?.gfxPage) {
    return `<div id="panel" class="inTab gfx"><div id="gfxPage">
      <div class="sec"><button class="back">‹ 返回</button></div>
      <div class="sec"><h4>快速套用</h4><div class="line"><span>畫質</span><div class="seg">${segGfx}</div></div></div>
      <div class="sec"><h4>解析度</h4><div class="line"><span>設定分頁</span><span class="r">${['低', '中', '高'][lv]}</span></div></div></div></div>`;
  }
  return `<div id="panel" class="inTab">
    <div class="sec main"><h4>畫面</h4><div class="line"><span>畫質</span><button class="sw">${['低', '中', '高'][lv]} ›</button></div><p class="note">光影、視野、特效、解析度都在這裡調</p></div>
    <div class="sec main"><h4>角色</h4><div class="line"><span>外觀</span><div class="seg"><button class="${look !== 'boy' ? 'on' : ''}">♀ 女</button><button class="${look === 'boy' ? 'on' : ''}">♂ 男</button></div></div></div>
    <div class="sec main"><h4>聲音</h4><div class="line"><span>遊戲音效</span><button class="sw${snd ? ' on' : ''}">${snd ? '開' : '關'}</button></div><div class="line" style="margin-top:9px"><span>音量</span><b>${vol}%</b></div></div>
    <div class="sec main"><h4>操作說明</h4><p class="note">WASD 移動・E 互動・F 釣魚・B 換餌・Tab 平板・M 地圖</p></div></div>`;
}

let scratchDom = null, serializer = null;
function toSvgDataUrl(html, w = SCR_W, h = SCR_H, extraCss = '') {
  if (!scratchDom) {
    scratchDom = document.createElement('div');
    serializer = new XMLSerializer();
  }
  scratchDom.innerHTML = html;
  const xhtml = serializer.serializeToString(scratchDom.firstElementChild);
  const css = extraCss ? `${REMOTE_CSS}\n${extraCss}` : REMOTE_CSS;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><style><![CDATA[${css}]]></style><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function uploadSvgToTablet(tab, html, w, h, resScale = 1, extraCss = '', ownLive = false) {
  const cw = Math.round(w * resScale), ch = Math.round(h * resScale);
  if (!tab.userData.ownCv || tab.userData.ownCv.width !== cw || tab.userData.ownCv.height !== ch) {
    const cv = tab.userData.ownCv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    tab.userData.ownTex?.dispose();
    const t = tab.userData.ownTex = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
  }
  const gen = tab.userData.gen = (tab.userData.gen || 0) + 1;
  const img = tab.userData.svgImg || (tab.userData.svgImg = new Image());
  img.onload = () => {
    if (tab.userData.gen !== gen || (!tab.parent && !ownLive) || !tab.userData.ownCv) return;
    const cv = tab.userData.ownCv, g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(img, 0, 0, cv.width, cv.height);
    if (ownLive) tab.userData.ownLive = true;
    tab.userData.screen.material.map = tab.userData.ownTex;
    tab.userData.ownTex.needsUpdate = true;
  };
  img.src = toSvgDataUrl(html, w, h, extraCss);
}

function cloneScr(scrEl) {
  const origCanvases = [...scrEl.querySelectorAll('canvas')];
  const origBodies = [...scrEl.querySelectorAll('.tbBody')];
  const origInputs = [...scrEl.querySelectorAll('input')];
  const clone = scrEl.cloneNode(true);
  clone.querySelectorAll('canvas').forEach((c, i) => {
    const oc = origCanvases[i];
    if (!oc || !oc.width || !oc.height) return;
    const img = document.createElement('img');
    img.className = c.className;
    if (c.getAttribute('style')) img.setAttribute('style', c.getAttribute('style'));
    img.alt = '';
    try { img.src = oc.toDataURL('image/png'); } catch { return; }
    c.replaceWith(img);
  });
  clone.querySelectorAll('input').forEach((inp, i) => {
    const oi = origInputs[i];
    if (oi) inp.setAttribute('value', oi.value);
  });
  clone.querySelectorAll('.tbBody').forEach((b, i) => {
    const sc = origBodies[i]?.scrollTop || 0;
    b.style.overflow = 'hidden';
    if (sc > 0) {
      const w = document.createElement('div');
      w.style.transform = `translateY(${-Math.round(sc)}px)`;
      while (b.firstChild) w.appendChild(b.firstChild);
      b.appendChild(w);
    }
  });
  clone.querySelectorAll('.tbApp').forEach((a) => a.classList.remove('zoom', 'closing'));
  return clone;
}

/** 渲染自己平板的目前 DOM 畫面（含圓角外框與鏡頭點綴）到 3D 正面貼圖，讓拿起來／收起來期間與實際介面完全一致、無殘影切換 */
export function renderOwnTablet(tab, rootEl, { width = 720, touch = false } = {}) {
  if (!tab?.userData?.tablet || !rootEl || typeof XMLSerializer === 'undefined') return;
  const scr = rootEl.querySelector('.tbScr');
  if (!scr) return;
  const w = width, h = Math.round(w / 1.42);
  const clone = cloneScr(scr);
  const html = `<body class="${touch ? 'touch' : ''}" style="margin:0;width:${w}px;height:${h}px;overflow:hidden"><div id="tab" class="on show held"><div class="tbDev"><div class="tbCamDot"></div>${clone.outerHTML}</div></div></body>`;
  const extraCss = `#tab.held { width: ${w}px !important; height: ${h}px !important; } #tab.held .tbDev { position: static; width: ${w}px; height: ${h}px; }`;
  uploadSvgToTablet(tab, html, w, h, 1, extraCss, true);
}

/** 釋放單一 3D 平板的專屬高解析貼圖（不動到 tabletMesh 的共用靜態快取） */
export function disposeTabletMesh(tab) {
  if (!tab?.userData) return;
  tab.userData.gen = (tab.userData.gen || 0) + 1;
  tab.userData.ownLive = false;
  if (tab.userData.ownTex) {
    tab.userData.ownTex.dispose();
    tab.userData.ownTex = null;
  }
  tab.userData.ownCv = null;
  tab.userData.liveHash = '';
}

/** 建立可渲染即時 SVG 平板畫面的繪圖器 */
export function createRemoteTabletRenderer({ buildEnv, renderMap }) {
  const state = { env: null };
  const proxyEnv = new Proxy({}, { get: (_t, k) => state.env?.[k] });
  const apps = makeApps(proxyEnv, { noStyle: true });
  let mapCv = null;

  return function renderRemote(o, tab, resScale = 1) {
    if (!tab?.userData?.tablet || typeof XMLSerializer === 'undefined') return;
    const st = o.tabState;
    const scrIdx = o.hold?.[0] === 'tablet' ? Math.round(o.hold[1] || 0) : (st?.scr ?? 0);
    const key = SCREENS[scrIdx] || 'home';
    const env = state.env = buildEnv(o, st);
    const s = env.status();
    const bar = renderStatusBar(s);

    let inner = '';
    if (key === 'home') {
      const w = env.widgets();
      const dockSet = new Set(DOCK_IDS);
      const dockApps = DOCK_IDS.map((id) => apps.find((a) => a.id === id)).filter(Boolean);
      const gridApps = apps.filter((a) => !dockSet.has(a.id));
      const renderIco = (a) => {
        const v = a.badge ? a.badge() : '';
        const dot = v === '•';
        const badge = v ? `<i class="tbBadge${dot ? ' dot' : ''}">${dot ? '' : esc(v)}</i>` : '';
        return `<button class="tbIco"><b style="background:${a.color}">${ICON[a.icon] || ''}${badge}</b><span>${esc(a.name)}</span></button>`;
      };
      inner = `<div class="tbSun"></div><div class="tbSeaGlow"></div><div class="tbBar">${bar}</div><div class="tbHome"><div class="tbWid"><div class="tbW">${w[0]}</div><div class="tbW">${w[1]}</div></div><div class="tbGrid">${gridApps.map(renderIco).join('')}</div><div class="tbDockWrap"><div class="tbDock">${dockApps.map(renderIco).join('')}</div></div></div><button class="tbHomeBar"></button>`;
    } else {
      const app = apps.find((a) => a.id === key) || apps[0];
      let body = '', headR = '', bodyStyle = '';
      const tabMock = { head: { set textContent(v) { headR = v; } } };
      if (key === 'map') {
        if (!mapCv) { mapCv = document.createElement('canvas'); mapCv.width = 560; mapCv.height = 560; }
        const mf = st?.mf ?? 15;
        const filt = { boat: !!(mf & 1), box: !!(mf & 2), others: !!(mf & 4), hot: !!(mf & 8) };
        renderMap(mapCv, filt, o, st);
        const chips = [['boat', '我的船'], ['box', '魚箱'], ['others', '其他人'], ['hot', '魚群']].map(([k, t]) => `<button class="tbChip${filt[k] ? ' on' : ''}">${t}</button>`).join('');
        body = `<div class="tbMap"><img class="tbMapImg" src="${mapCv.toDataURL('image/png')}" alt=""/><div class="tbMapSide">
          <div class="tbBtns" style="margin:0">${chips}</div>
          <div class="tbc" style="margin:0;padding:8px 11px"><div class="tbNote" style="margin:0">${esc(env.mapHint())}</div></div>
          <div class="tbc" style="margin:0;padding:8px 11px;color:var(--sea-d);line-height:1.5">${env.mapSonar()}</div></div></div>`;
        bodyStyle = ' style="overflow:hidden"';
      } else if (key === 'set') {
        body = renderSettingsHtml(st, o.look);
      } else if (key === 'dex') {
        app.sel = st?.dexSel || null;
        body = app.renderHtml.call(app, tabMock);
        bodyStyle = ' style="overflow:hidden"';
      } else if (key === 'notice') {
        body = app.renderHtml.call({ fresh: false }, tabMock);
      } else {
        body = app.renderHtml.call(app, tabMock);
      }
      const sc = st?.sc || 0;
      const wrapped = sc ? `<div class="tbScroll" style="transform:translateY(${-sc}px)">${body}</div>` : body;
      inner = `<div class="tbBar">${bar}</div><div class="tbApp"><div class="tbHead"><button class="tbBack">‹ 主畫面</button><h3>${ICON[app.icon] || ''}${esc(app.name)}</h3><span class="r">${esc(headR)}</span></div><div class="tbBody"${bodyStyle}>${wrapped}</div></div><button class="tbHomeBar"></button>`;
    }

    const html = `<div id="tab" class="on show held"><div class="tbScr${s.night ? ' night' : ''}${key !== 'home' ? ' inApp' : ''}">${inner}</div></div>`;
    uploadSvgToTablet(tab, html, SCR_W, SCR_H, resScale);
  };
}
