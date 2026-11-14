// 跟多人伺服器的連線：填名字進大廳、挑房間、收發訊息、斷線時在 30 秒內自動接回去。
import { myLook } from './look.js';
// 伺服器位址：網址加 ?server=ws://… 可以指定；開發時（npm run dev）連本機的 8787；正式版連雲端那台
const PROD_SERVER = 'wss://35-229-248-193.sslip.io';
const params = new URLSearchParams(window.location.search);
export const TEST = params.has('test');
export const QUERY = params;
const RETRY_FOR = 30000;   // 斷線後試著接回去多久（伺服器只幫忙留 30 秒）
const PING_EVERY = 2000;   // 多久量一次延遲（毫秒）
const PING_STALE = 7000;   // 超過這麼久沒收到回覆，就不顯示延遲

function serverUrl() {
  if (params.get('server')) return params.get('server');
  if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL;
  if (import.meta.env.DEV) return `ws://${window.location.hostname || 'localhost'}:8787`;
  return PROD_SERVER;
}

// 名字和認人用的代碼記在瀏覽器裡：關掉分頁再打開，30 秒內接得回原本的位置；錢、船、裝備、魚跟著代碼存在伺服器，到定時刷新才清。
// ?test 分頁記在這個分頁自己（sessionStorage）：每個測試分頁都是不同的玩家，也不會動到正式的身分
const store = (() => {
  try { return TEST ? window.sessionStorage : window.localStorage; } catch { return null; }
})();
const getItem = (k) => { try { return store?.getItem(k) ?? null; } catch { return null; } };
const setItem = (k, v) => { try { store?.setItem(k, v); } catch { /* 存不了就每次重填 */ } };

export class Net {
  constructor() {
    this.url = serverUrl();
    this.ws = null;
    this.id = 0;
    this.name = getItem('stormcast.name') || '';
    this.token = getItem('stormcast.token') || '';
    this.handlers = {};
    this.inRoom = false;      // 已經進到房間裡
    this.online = false;      // 現在連線正常
    this.lostAt = 0;          // 從什麼時候開始斷線
    this._want = null;        // 正在等伺服器回話的那件事：{ resolve, reject }
    this.ping = null;         // 跟伺服器一來一回要幾毫秒（還沒量到、或伺服器沒回就是 null）
    this._pongAt = 0;
    setInterval(() => {
      if (this.ws && this.ws.readyState === 1) this._raw({ t: 'ping', k: performance.now() });
      if (this.ping !== null && performance.now() - this._pongAt > PING_STALE) this.ping = null;
    }, PING_EVERY);
  }

  on(type, fn) { (this.handlers[type] ??= []).push(fn); return this; }
  emit(type, msg) { for (const fn of this.handlers[type] ?? []) fn(msg); }
  send(msg) { if (this.ws && this.ws.readyState === 1 && this.inRoom && this.online) this.ws.send(JSON.stringify(msg)); }
  _raw(msg) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg)); }

  // 用這個名字連上伺服器。回傳 { lobby }（房間列表）或 { joined }（30 秒內回來，直接接回原本的房間）；被拒絕時丟出 Error(原因)
  hello(name) {
    this.name = name;
    return new Promise((resolve, reject) => {
      // 伺服器收下這個名字（沒被擋）就記住，下次打開直接填好
      this._want = { kind: 'hello', resolve: (r) => { setItem('stormcast.name', name); resolve(r); }, reject };
      if (this.ws && this.ws.readyState === 1) this._raw({ t: 'hello', name, look: myLook(), token: this.token });
      else this._connect();
    });
  }

  // 進這間房。成功回傳伺服器給的整包資料；滿了就丟出 Error(原因)，error.lobby 是最新的房間列表
  join(room) {
    return new Promise((resolve, reject) => {
      this._want = { kind: 'join', resolve, reject };
      this._raw({ t: 'join', room });
    });
  }

  // 離開房間（進度伺服器存著，下次進房從港口出發）
  leave() { this.leaving = true; this._raw({ t: 'leave' }); }

  _connect() {
    let ws;
    try { ws = new WebSocket(this.url); } catch { this._fail('連不上伺服器'); return; }
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name: this.name, look: myLook(), token: this.token }));
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      const want = this._want;
      switch (m.t) {
        case 'lobby':
          if (m.name) { this.name = m.name; setItem('stormcast.name', m.name); }
          if (this.inRoom) { this.inRoom = false; this.emit('status', 'expired'); return; }   // 斷線太久，位置已經被收走了
          if (want && want.kind === 'hello') { this._want = null; want.resolve({ lobby: m }); } else this.emit('lobby', m);
          return;
        case 'joined': {
          const back = this.inRoom;
          this.id = m.id; this.token = m.token; this.name = m.name;
          setItem('stormcast.token', m.token); setItem('stormcast.name', m.name);
          this.inRoom = true; this.online = true; this.lostAt = 0;
          if (want) { this._want = null; want.resolve({ joined: m }); } else if (back) this.emit('rejoin', m);
          this.emit('status', 'online');
          return;
        }
        case 'full':
          if (want) { this._want = null; const e = new Error(m.msg); e.lobby = m; want.reject(e); }
          return;
        case 'denied':
          if (want) { this._want = null; want.reject(new Error(m.msg)); }
          return;
        case 'kicked':
          this.kicked = m.msg;
          return;
        case 'pong':
          if (typeof m.k === 'number') { this.ping = Math.max(1, Math.round(performance.now() - m.k)); this._pongAt = performance.now(); }
          return;
        default:
          this.emit(m.t, m);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      const was = this.online;
      this.online = false;
      if (this.leaving) return;
      if (this.kicked) { this.emit('status', 'kicked:' + this.kicked); return; }
      if (!this.inRoom) { this._fail(was ? '和伺服器斷線了' : '連不上伺服器，等一下再試試看'); this.emit('status', 'lobbylost'); return; }
      // 玩到一半斷線：遊戲照常跑，背景一直試著接回去；超過時間就放棄
      if (!this.lostAt) this.lostAt = Date.now();
      if (Date.now() - this.lostAt > RETRY_FOR) { this.inRoom = false; this.emit('status', 'expired'); return; }
      this.emit('status', 'offline');
      setTimeout(() => this._connect(), 1500);
    };
  }

  _fail(msg) {
    if (this._want) { const w = this._want; this._want = null; w.reject(new Error(msg)); }
  }
}
