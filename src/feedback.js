// 漁會意見信箱的小卡片（對著港口的郵筒按 E 打開）：三選一的分類、最多 FEEDBACK.maxLen 個字，送出去存在伺服器給管理網頁看。
// 只送分類和文字，不附帶任何環境資料。樣式用 index.html 的介面顏色變數，不另外寫死顏色
import { FEEDBACK } from './config.js';

let card = null, env = null, kind = 'bug', waiting = 0;   // waiting：送出去了、在等伺服器回答（計時器；沒回答就把按鈕放回來）

function build() {
  card = document.createElement('div');
  card.id = 'feedback';
  card.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:32;display:none;width:min(430px,92vw);box-sizing:border-box;'
    + 'padding:16px 18px 14px;border-radius:18px;background:var(--paper);border:2px solid var(--edge);box-shadow:var(--shadow);'
    + 'color:var(--ink);font:15px/1.5 var(--font);backdrop-filter:blur(6px)';
  const chip = 'flex:1;padding:6px 4px;border-radius:999px;border:2px solid var(--line);background:var(--btn);color:var(--ink);font:14px var(--font);cursor:pointer;white-space:nowrap';
  card.innerHTML = '<div style="font-size:17px;color:var(--sea-d);margin-bottom:8px">📮 漁會意見信箱</div>'
    + `<div data-kinds style="display:flex;gap:6px;margin-bottom:8px">${Object.entries(FEEDBACK.kinds).map(([k, t]) => `<button data-k="${k}" style="${chip}">${t}</button>`).join('')}</div>`
    + `<textarea maxlength="${FEEDBACK.maxLen}" rows="5" placeholder="想說什麼都可以寫（最多 ${FEEDBACK.maxLen} 個字）" style="width:100%;box-sizing:border-box;resize:none;padding:8px 10px;border-radius:12px;border:2px solid var(--edge);background:rgba(255,255,255,.8);color:var(--ink);font:15px/1.5 var(--font)"></textarea>`
    + '<div data-n style="font-size:12px;opacity:.7;text-align:right;margin:2px 2px 8px"></div>'
    + '<div style="display:flex;gap:10px"><button data-send style="flex:1;padding:8px 0;border-radius:12px;border:0;background:var(--coral-a);color:#fff;font:600 16px var(--font);cursor:pointer">送出投遞</button>'
    + '<button data-cancel style="flex:1;padding:8px 0;border-radius:12px;border:1px solid var(--line);background:var(--btn);color:var(--ink);font:600 16px var(--font);cursor:pointer">取消</button></div>';
  document.body.appendChild(card);
  const ta = card.querySelector('textarea'), n = card.querySelector('[data-n]');
  const count = () => { n.textContent = `${ta.value.length} / ${FEEDBACK.maxLen}`; };
  ta.addEventListener('input', count);
  // 在框裡打字：按鍵不要漏給遊戲（不然 W A S D 會讓人走開、E 會再按一次郵筒）；Esc 關掉
  for (const ev of ['keydown', 'keyup', 'keypress']) card.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === 'keydown' && e.key === 'Escape') closeFeedback(); });
  card.querySelector('[data-kinds]').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) pick(b.dataset.k); });
  card.querySelector('[data-cancel]').addEventListener('click', () => closeFeedback());
  card.querySelector('[data-send]').addEventListener('click', () => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    if (waiting || env.send(kind, text) === false) return;
    // 先留著寫的字：伺服器收下了（feedbackDone(true)）才清掉關卡片；被擋下來（剛投過、離郵筒太遠）字還在，不用重打
    card._busy(true);
    waiting = setTimeout(() => feedbackDone(false), 6000);
  });
  card._busy = (on) => { const b = card.querySelector('[data-send]'); b.disabled = on; b.textContent = on ? '投遞中…' : '送出投遞'; b.style.opacity = on ? '.6' : '1'; };
  card._reset = () => { count(); setTimeout(() => { if (feedbackOpen()) ta.focus({ preventScroll: true }); }, 0); };   // 晚一步才把游標放進去：不然打開卡片的那一下 E 會被打進框裡
}
function pick(k) {
  kind = k;
  for (const b of card.querySelectorAll('[data-k]')) {
    const on = b.dataset.k === k;
    b.style.background = on ? 'var(--sea-a)' : 'var(--btn)'; b.style.color = on ? '#fff' : 'var(--ink)'; b.style.borderColor = on ? 'var(--sea)' : 'var(--line)';
  }
}

export const feedbackOpen = () => !!card && card.style.display !== 'none';
// e：{ send(kind, text)：送出（回傳 false = 沒送成，卡片留著）, onOpen(), onClose() }
export function openFeedback(e) {
  if (!card) build();
  env = e;
  pick(kind);
  card.style.display = 'block';
  env.onOpen?.();
  card._reset();
}
// 伺服器回答了：ok 收下了（清掉字、關卡片）；不然只把按鈕放回來，寫的字留著
export function feedbackDone(ok) {
  if (!waiting) return;
  clearTimeout(waiting); waiting = 0;
  card._busy(false);
  if (ok) { card.querySelector('textarea').value = ''; closeFeedback(); }
}
export function closeFeedback() {
  if (!feedbackOpen()) return;
  card.style.display = 'none';
  card.querySelector('textarea').blur();
  env?.onClose?.();
}
