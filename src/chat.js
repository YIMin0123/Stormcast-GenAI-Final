// 聊天室：畫面左下角。平常只顯示最近幾則（過一陣子淡掉）；按 Enter 打開輸入框，可以自己打字，也可以點預設短句。
// 系統訊息（有人加入、合併、有人上榜）用不同的顏色。髒話過濾和防洗版在伺服器那邊做。
// 兩個頻道：全部（整間房）、隊伍（只有同船隊的人）。打開時上面有分頁，停在哪個分頁就送到哪個頻道（輸入框裡按 Tab 也能切）；
// 「全部」分頁也看得到隊伍訊息（前面標 [隊伍]），「隊伍」分頁只看隊伍的。
const PRESETS = ['你好！', '謝謝', '哈哈', '這裡魚很多', '釣到大魚了！', '小心天氣！', '一起出海嗎？', '我先回港了'];
const PARTY_PRESETS = ['來我船上', '等我一下', '要出海了', '我先回港', '幫我拖船', '這裡魚很多', '收到！'];
const HOLDER = { all: '對全房說…（Enter 送出，Esc 關閉）', party: '對隊友說…（Enter 送出，Tab 換頻道）' };
const SHOW_FOR = 14000;   // 一則訊息顯示多久之後淡掉（聊天室開著的時候不淡）
const KEEP = 60;

// env：send(text, ch)：送出一則（ch：'all'／'party'）；onOpen()、onClose()：輸入框打開、關上時（外面要放開按鍵、收回滑鼠）
export class Chat {
  constructor(env) {
    this.env = env;
    this.isOpen = false;
    const root = this.root = document.createElement('div');
    root.id = 'chat';
    root.innerHTML = '<div id="chatTabs"><button data-ch="all">全部</button><button data-ch="party" disabled>隊伍<i></i></button></div><div id="chatLog"></div><div id="chatBox"><div id="chatPresets"></div><input id="chatInput" maxlength="80" autocomplete="off" /></div><div id="chatHint">按 Enter 聊天</div>';
    document.body.appendChild(root);
    this.log = root.querySelector('#chatLog');
    this.box = root.querySelector('#chatBox');
    this.input = root.querySelector('#chatInput');
    this.hint = root.querySelector('#chatHint');
    this.presets = root.querySelector('#chatPresets');
    this.tabs = root.querySelector('#chatTabs');
    this.ch = 'all';
    this.inParty = false;
    this.tabs.addEventListener('click', (e) => { const b = e.target.closest('button[data-ch]'); if (b && !b.disabled) { this.setChannel(b.dataset.ch); this.input.focus({ preventScroll: true }); } });
    this.setChannel('all');
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        if (text) this.env.send(text, this.ch);
        this.close();
      } else if (e.key === 'Escape') this.close();
      else if (e.key === 'Tab') { e.preventDefault(); if (this.inParty) this.setChannel(this.ch === 'all' ? 'party' : 'all'); }
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    root.style.display = 'none';
    const syncVv = this._syncVv = () => {
      const vv = window.visualViewport, h = vv ? vv.height : window.innerHeight;
      document.documentElement.style.setProperty('--vv', `${Math.round(h)}px`);
      const kbOpen = document.body.classList.contains('touch') && this.isOpen && (window.innerHeight - h > 80 || h < 280);
      document.body.classList.toggle('kb', kbOpen);
      if (vv && (vv.offsetTop || window.scrollY)) window.scrollTo(0, 0);
      if (this.isOpen) this._scroll();
    };
    syncVv();
    window.addEventListener('resize', syncVv);
    window.visualViewport?.addEventListener('resize', syncVv);
    window.visualViewport?.addEventListener('scroll', syncVv);
    window.setInterval(() => this._fade(), 1000);
  }

  show(on) { this.root.style.display = on ? '' : 'none'; if (!on) this.close(); }

  // 換頻道：分頁、輸入框提示、預設短句都跟著換
  setChannel(ch) {
    if (ch === 'party' && !this.inParty) ch = 'all';
    this.ch = ch;
    this.root.classList.toggle('chParty', ch === 'party');
    for (const b of this.tabs.children) b.classList.toggle('on', b.dataset.ch === ch);
    if (ch === 'party') this.tabs.children[1].classList.remove('dot');
    this.input.placeholder = HOLDER[ch];
    this.presets.textContent = '';
    for (const text of ch === 'party' ? PARTY_PRESETS : PRESETS) {
      const b = document.createElement('button');
      b.textContent = text;
      b.addEventListener('click', () => { this.env.send(text, this.ch); this.close(); });
      this.presets.appendChild(b);
    }
    this._scroll();
  }
  // 有沒有在船隊裡：沒有的話隊伍分頁不能按，停在隊伍分頁的話切回全部
  setParty(on) {
    if (on === this.inParty) return;
    this.inParty = on;
    const b = this.tabs.children[1];
    b.disabled = !on;
    b.title = on ? '' : '加入船隊後才能用';
    if (!on) { b.classList.remove('dot'); if (this.ch === 'party') this.setChannel('all'); }
  }

  open() {
    if (this.isOpen || this.root.style.display === 'none') return;
    this.isOpen = true;
    this.root.classList.add('open');
    this.input.value = '';
    this.env.onOpen();
    this.input.focus({ preventScroll: true });
    this._syncVv();
    this._fade();
    this._scroll();
    requestAnimationFrame(() => this._scroll());
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('open');
    this.input.blur();
    this._syncVv();
    this.env.onClose();
    this._fade();
    this._scroll();   // 收起來時訊息區變矮：捲回最底下，不然最新的幾則會被藏在下面、只露出半個泡泡
    requestAnimationFrame(() => this._scroll());
  }

  _scroll() { this.log.scrollTop = this.log.scrollHeight; }

  _line(cls) {
    const el = document.createElement('div');
    el.className = `msg ${cls}`;
    el.dataset.at = Date.now();
    this.log.appendChild(el);
    while (this.log.children.length > KEEP) this.log.firstChild.remove();
    return el;
  }

  // 玩家說的話。badge：{ lv 等級, title 本週稱號, gold 是不是週榜前三名的金色稱號 }；ch 'party' 是隊伍頻道
  say(name, text, mine = false, badge = {}, ch = 'all') {
    const party = ch === 'party';
    const el = this._line(`${mine ? 'mine' : ''}${party ? ' party' : ''}`);
    const tag = (t, color) => { const s = document.createElement('span'); s.textContent = `[${t}] `; s.style.color = color; s.style.fontWeight = '700'; el.append(s); };
    if (party) { tag('隊伍', '#2a8a57'); if (this.ch !== 'party' && !mine) this.tabs.children[1].classList.add('dot'); }
    if (badge.lv > 0) tag(`Lv.${badge.lv}`, '#9fe3b4');
    if (badge.title) tag(badge.title, badge.gold ? '#ffd24a' : '#7fd8ff');
    const who = document.createElement('b');
    who.textContent = `${name}：`;
    el.append(who, document.createTextNode(text));
    this._scroll();   // 文字與稱號放進泡泡之後再捲到底，避免多行換行後最新一句被擠出底邊外
  }

  // 系統訊息。kind：join（有人加入）、merge（合併）、record（上榜）、warn（提醒）、info
  sys(text, kind = 'info', ch = 'all') { this._line(`sys ${kind}${ch === 'party' ? ' party' : ''}`).textContent = text; this._scroll(); }

  clear() { this.log.textContent = ''; }

  _fade() {
    const now = Date.now();
    for (const el of this.log.children) el.classList.toggle('old', !this.isOpen && now - el.dataset.at > SHOW_FOR);
  }
}
