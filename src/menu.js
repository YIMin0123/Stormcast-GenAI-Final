// 進遊戲前的畫面：先填名字，再從大廳的房間列表挑一間，點下去就進房（沒有「開始」鈕）。
// 背景照常畫著港口，只是人還不能動。
import { TEST, QUERY } from './net.js';
import { startLookPick } from './lookPick.js';
import { NOTICE, UPDATES, nextRefreshAt, countdownText } from './announce.js';
import { unreadCount } from './updates.js';

const $ = (id) => document.getElementById(id);

// 回傳伺服器給的整包進房資料（Promise）。在寬限內回來會跳過大廳，接回原本的房間。
// onLook(look)：在選單裡換了角色（讓港口裡自己的人偶也跟著換）
export function runMenu(net, onLook) {
  return new Promise((done) => {
    const box = $('menu'), nameStep = $('menuName'), lobbyStep = $('menuLobby');
    const input = $('nameInput'), go = $('nameGo'), nameMsg = $('nameMsg'), list = $('roomList'), lobbyMsg = $('lobbyMsg');
    const notice = $('notice'), noticeBtn = $('noticeBtn'), setBtn = $('menuSetBtn'), panel = $('panel');
    const rulesBox = $('noticeRules'), updList = $('updList');
    const tabBtns = [...document.querySelectorAll('#noticeTabs button')];
    let busy = false, finished = false;
    const lookPick = startLookPick(onLook);

    // 公告與更新抽屜、刷新倒數（每秒更新，進了房間就停）
    $('noticeList').replaceChildren(...NOTICE.items.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
    // 更新資訊：最近 3 條（全部在進遊戲後平板的「公告」app 裡；看過沒、小紅點見 updates.js）
    const mk = (tag, text) => Object.assign(document.createElement(tag), { textContent: text });
    updList.replaceChildren(...UPDATES.slice(0, 3).map((u) => {
      const sec = document.createElement('section'), h = mk('h4', u.title), ul = document.createElement('ul');
      h.append(mk('small', u.date));
      ul.append(...u.items.map((t) => mk('li', t)));
      sec.append(h, ul);
      return sec;
    }));
    const hasNew = unreadCount() > 0;
    noticeBtn.classList.toggle('hasNew', hasNew);
    tabBtns.find((b) => b.dataset.ntab === 'updates')?.classList.toggle('hasNew', hasNew);

    const setNoticeOpen = (open) => {
      notice.classList.toggle('open', open);
      noticeBtn.classList.toggle('on', open);
      noticeBtn.setAttribute('aria-expanded', String(open));
      if (open) panel.open = false;
    };
    const setNoticeTab = (tab) => {
      for (const b of tabBtns) b.classList.toggle('on', b.dataset.ntab === tab);
      rulesBox.hidden = tab !== 'rules';
      updList.hidden = tab !== 'updates';
    };
    for (const b of tabBtns) b.addEventListener('click', () => setNoticeTab(b.dataset.ntab));
    noticeBtn.addEventListener('click', () => setNoticeOpen(!notice.classList.contains('open')));
    $('noticeClose').addEventListener('click', () => setNoticeOpen(false));
    setBtn.addEventListener('click', () => {
      const next = !panel.open;
      panel.open = next;
      if (next) setNoticeOpen(false);
    });
    const onPanelToggle = () => {
      if (finished) return;
      setBtn.classList.toggle('on', panel.open);
      setBtn.setAttribute('aria-expanded', String(panel.open));
      if (panel.open) setNoticeOpen(false);
    };
    panel.addEventListener('toggle', onPanelToggle);
    box.addEventListener('click', (e) => {
      if (!notice.contains(e.target) && !noticeBtn.contains(e.target)) setNoticeOpen(false);
      if (!panel.contains(e.target) && !setBtn.contains(e.target)) panel.open = false;
    });

    const tick = () => { $('refreshLeft').textContent = countdownText(nextRefreshAt() - Date.now()); };
    tick();
    const timer = setInterval(tick, 1000);

    const finish = (joined) => {
      finished = true;
      clearInterval(timer);
      setNoticeOpen(false);
      panel.open = false;
      panel.removeEventListener('toggle', onPanelToggle);
      lookPick.dispose();
      box.style.display = 'none';
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      done(joined);
    };
    const step = (which) => {
      nameStep.style.display = which === 'name' ? 'block' : 'none';
      lobbyStep.style.display = which === 'lobby' ? 'block' : 'none';
      lookPick.setVisible(which === 'name');
      if (which === 'name') input.focus();
    };

    // 房間列表：房名、人數、天氣；滿的反灰、不能點
    const showRooms = (rooms) => {
      list.textContent = '';
      for (const r of rooms) {
        const full = r.n >= r.max, b = document.createElement('button');
        b.className = 'room';
        b.disabled = full;
        const name = document.createElement('b'), n = document.createElement('span'), w = document.createElement('span');
        name.textContent = r.name;
        n.textContent = full ? `${r.n}/${r.max}　滿了` : `${r.n}/${r.max}`;
        n.className = 'n';
        w.textContent = r.weather;
        w.className = 'w';
        b.append(name, w, n);
        b.addEventListener('click', () => enter(r.id));
        list.appendChild(b);
      }
      $('lobbyWho').textContent = net.name;
    };
    net.on('lobby', (m) => { if (!finished && !busy) showRooms(m.rooms); });

    const enter = async (room) => {
      if (busy) return;
      busy = true;
      lobbyMsg.textContent = '進房中…';
      try {
        const r = await net.join(room);
        finish(r.joined);
      } catch (e) {
        lobbyMsg.textContent = e.message;
        if (e.lobby) showRooms(e.lobby.rooms);
      }
      busy = false;
    };

    const hello = async () => {
      const name = input.value.trim();
      if (!name) { nameMsg.textContent = '請先填好名字'; input.focus(); return; }
      if (busy) return;
      busy = true;
      go.disabled = input.disabled = true;
      nameMsg.textContent = '連線中…';
      try {
        const r = await net.hello(name);
        if (r.joined) { busy = false; return finish(r.joined); }
        nameMsg.textContent = '';
        lobbyMsg.textContent = '';
        showRooms(r.lobby.rooms);
        step('lobby');
        // 測試分頁：網址帶 room 就直接進那間
        const want = +QUERY.get('room');
        busy = false;
        if (TEST && want) enter(want);
      } catch (e) {
        nameMsg.textContent = e.message;
        busy = false;
      }
      go.disabled = input.disabled = false;
      if (nameStep.style.display !== 'none') input.focus();
    };

    go.addEventListener('click', hello);
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') hello(); });
    $('lobbyBack').addEventListener('click', () => { nameMsg.textContent = ''; step('name'); });
    // 還在大廳時斷線：回到填名字那一步
    net.on('status', (s) => { if (!finished && s === 'lobbylost') { nameMsg.textContent = '和伺服器斷線了，再試一次'; step('name'); } });

    input.value = QUERY.get('name') || net.name || '';
    box.style.display = 'flex';
    step('name');
    if (TEST && QUERY.get('name')) hello();   // 測試分頁：網址帶名字就直接連
  });
}
