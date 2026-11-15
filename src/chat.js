// 聊天室：畫面左下角。平常只顯示最近幾則（過一陣子淡掉）；按 Enter 打開輸入框，可以自己打字，也可以點預設短句。
// 系統訊息（有人加入、合併、有人上榜）用不同的顏色。髒話過濾和防洗版在伺服器那邊做。
const PRESETS = ['你好！', '謝謝', '哈哈', '這裡魚很多', '釣到大魚了！', '小心天氣！', '一起出海嗎？', '我先回港了'];
const SHOW_FOR = 14000;   // 一則訊息顯示多久之後淡掉（聊天室開著的時候不淡）
const KEEP = 60;

// env：send(text)：送出一則；onOpen()、onClose()：輸入框打開、關上時（外面要放開按鍵、收回滑鼠）
export class Chat {
  constructor(env) {
    this.env = env;
    this.isOpen = false;
    const root = this.root = document.createElement('div');
    root.id = 'chat';
    root.innerHTML = '<div id="chatLog"></div><div id="chatBox"><div id="chatPresets"></div><input id="chatInput" maxlength="80" placeholder="說點什麼…（Enter 送出，Esc 關閉）" autocomplete="off" /></div><div id="chatHint">按 Enter 聊天</div>';
    document.body.appendChild(root);
    this.log = root.querySelector('#chatLog');
    this.box = root.querySelector('#chatBox');
    this.input = root.querySelector('#chatInput');
    this.hint = root.querySelector('#chatHint');
    const presets = root.querySelector('#chatPresets');
    for (const text of PRESETS) {
      const b = document.createElement('button');
      b.textContent = text;
      b.addEventListener('click', () => { this.env.send(text); this.close(); });
      presets.appendChild(b);
    }
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        if (text) this.env.send(text);
        this.close();
      } else if (e.key === 'Escape') this.close();
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    root.style.display = 'none';
    window.setInterval(() => this._fade(), 1000);
  }

  show(on) { this.root.style.display = on ? 'block' : 'none'; if (!on) this.close(); }

  open() {
    if (this.isOpen || this.root.style.display === 'none') return;
    this.isOpen = true;
    this.root.classList.add('open');
    this.input.value = '';
    this.env.onOpen();
    this.input.focus();
    this._fade();
    this.log.scrollTop = this.log.scrollHeight;
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('open');
    this.input.blur();
    this.env.onClose();
    this._fade();
    this.log.scrollTop = this.log.scrollHeight;   // 收起來時訊息區變矮：捲回最底下，不然最新的幾則會被藏在下面、只露出半個泡泡
  }

  _line(cls) {
    const el = document.createElement('div');
    el.className = `msg ${cls}`;
    el.dataset.at = Date.now();
    this.log.appendChild(el);
    while (this.log.children.length > KEEP) this.log.firstChild.remove();
    this.log.scrollTop = this.log.scrollHeight;
    return el;
  }

  // 玩家說的話
  say(name, text, mine = false, title = '') {
    const el = this._line(mine ? 'mine' : '');
    if (title) {
      const badge = document.createElement('span');
      badge.textContent = `[${title}] `;
      badge.style.color = title === '七海龍王' ? '#ffd24a' : '#7fd8ff';
      badge.style.fontWeight = '700';
      el.append(badge);
    }
    const who = document.createElement('b');
    who.textContent = `${name}：`;
    el.append(who, document.createTextNode(text));
  }

  // 系統訊息。kind：join（有人加入）、merge（合併）、record（上榜）、warn（提醒）、info
  sys(text, kind = 'info') { this._line(`sys ${kind}`).textContent = text; }

  clear() { this.log.textContent = ''; }

  _fade() {
    const now = Date.now();
    for (const el of this.log.children) el.classList.toggle('old', !this.isOpen && now - el.dataset.at > SHOW_FOR);
  }
}
