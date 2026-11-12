// 進遊戲前的畫面：先填名字，再從大廳的房間列表挑一間，點下去就進房（沒有「開始」鈕）。
// 背景照常畫著港口，只是人還不能動。
import { TEST, QUERY } from './net.js';
import { startLookPick } from './lookPick.js';

const $ = (id) => document.getElementById(id);

// 回傳伺服器給的整包進房資料（Promise）。30 秒內斷線回來的人會跳過大廳，直接接回原本的房間
// onLook(look)：在選單裡換了角色（讓港口裡自己的人偶也跟著換）
export function runMenu(net, onLook) {
  return new Promise((done) => {
    const box = $('menu'), nameStep = $('menuName'), lobbyStep = $('menuLobby');
    const input = $('nameInput'), go = $('nameGo'), nameMsg = $('nameMsg'), list = $('roomList'), lobbyMsg = $('lobbyMsg');
    let busy = false, finished = false;
    const stopPick = startLookPick(onLook);

    const finish = (joined) => {
      finished = true;
      stopPick();
      box.style.display = 'none';
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      done(joined);
    };
    const step = (which) => {
      nameStep.style.display = which === 'name' ? 'block' : 'none';
      lobbyStep.style.display = which === 'lobby' ? 'block' : 'none';
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
