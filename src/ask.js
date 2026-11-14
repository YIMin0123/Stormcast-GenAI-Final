// 畫面上方跳出來問一個是／否的小卡片（別人送東西給你、買魚箱要清掉舊的那個）。
// 鍵盤 Y／N 也能回答；sec 秒沒回答就當作「否」。樣式用 index.html 的介面顏色變數，不另外寫死顏色
let card = null, cur = null;

function build() {
  card = document.createElement('div');
  card.style.cssText = 'position:fixed;left:50%;top:14%;transform:translateX(-50%);z-index:30;display:none;min-width:260px;max-width:min(440px,92vw);'
    + 'padding:14px 16px 12px;border-radius:16px;background:var(--paper);border:2px solid var(--edge);box-shadow:var(--shadow);'
    + 'color:var(--ink);font:16px/1.5 var(--font);text-align:center;backdrop-filter:blur(6px)';
  card.innerHTML = '<div data-q style="margin-bottom:10px;white-space:pre-line"></div>'
    + '<div style="display:flex;gap:10px;justify-content:center">'
    + '<button data-y style="flex:1;padding:8px 0;border-radius:12px;border:0;background:var(--coral-a);color:#fff;font:600 16px var(--font);cursor:pointer"></button>'
    + '<button data-n style="flex:1;padding:8px 0;border-radius:12px;border:1px solid var(--line);background:var(--btn);color:var(--ink);font:600 16px var(--font);cursor:pointer"></button></div>'
    + '<div data-t style="margin-top:6px;font-size:12px;opacity:.7"></div>';
  document.body.appendChild(card);
  card.querySelector('[data-y]').addEventListener('click', () => answer(true));
  card.querySelector('[data-n]').addEventListener('click', () => answer(false));
  // Y／N：問的時候先攔下來，不讓遊戲吃到
  window.addEventListener('keydown', (e) => {
    if (!cur || e.repeat) return;
    const k = e.key.toLowerCase();
    if (k !== 'y' && k !== 'n') return;
    e.preventDefault(); e.stopPropagation();
    answer(k === 'y');
  }, true);
}

function answer(yes) {
  if (!cur) return;
  const c = cur;
  cur = null;
  card.style.display = 'none';
  clearInterval(c.timer);
  c.done(yes);
}

// 問一個問題：回傳 Promise<boolean>。tag：之後可以用 cancel(tag) 收掉（例如對方已經取消）
export function ask(text, { yes = '好', no = '不要', sec = 0, tag = '' } = {}) {
  if (!card) build();
  if (cur) answer(false);   // 上一個還沒回答：當作不要
  return new Promise((done) => {
    card.querySelector('[data-q]').textContent = text;
    card.querySelector('[data-y]').textContent = `${yes}（Y）`;
    card.querySelector('[data-n]').textContent = `${no}（N）`;
    const t = card.querySelector('[data-t]');
    const end = performance.now() + sec * 1000;
    const tick = () => { if (sec) { const left = Math.ceil((end - performance.now()) / 1000); t.textContent = `${left} 秒後自動當作「${no}」`; if (left <= 0) answer(false); } else t.textContent = ''; };
    cur = { done, tag, timer: sec ? setInterval(tick, 250) : 0 };
    tick();
    card.style.display = 'block';
  });
}
// 收掉某個還在問的問題（當作「否」）
export function cancelAsk(tag) { if (cur && cur.tag === tag) answer(false); }
export const asking = () => !!cur;
