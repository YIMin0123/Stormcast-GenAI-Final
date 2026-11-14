// 髒話過濾：名字裡有就不給用，聊天裡有就換成＊。
// 比對前先把全形轉半形、去掉空白與常見的夾字符號、英文轉小寫，「幹　你」「F.U.C.K」這類也擋得到。
const WORDS = [
  // 中文
  '幹你', '幹妳', '幹您', '操你', '操妳', '肏', '屌你', '他媽的', '你媽的', '妳媽的', '媽的', '靠北', '靠腰', '靠杯', '哭爸', '哭夭', '三小', '啥小', '殺小',
  '雞掰', '雞巴', '機掰', '機巴', '雞八', '機八', '雞歪', '懶叫', '懶覺', '覽趴', '懶趴', '賤人', '賤貨', '婊子', '臭婊', '破麻', '北七', '白癡', '白痴', '智障', '低能',
  '王八蛋', '混蛋', '狗娘養', '狗屎', '去死', '吃屎', '垃圾人', '廢物', '腦殘', '強姦', '強暴', '做愛', '打砲', '打炮', '約砲', '約炮', '色情', '淫蕩', '陰道', '陰莖', '龜頭', '乳頭',
  '傻逼', '傻屄', '煞筆', '草泥馬', '操你媽', '幹你娘', '幹拎娘', '拎娘', '你娘', '妳娘', '尼瑪', '你妈', '他妈', '傻b', '妈的', '贱人', '鸡巴', '强奸', '做爱',
  '支那', '納粹', '希特勒',
  // 英文
  'fuck', 'fuk', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'pussy', 'cunt', 'cock', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut', 'porn', 'sex', 'rape', 'nazi', 'hitler',
];
// 英文短字只在「整個字」出現時才算（不然 Essex、cocktail、assassin 這些都會中）
const WHOLE = new Set(['sex', 'dick', 'cock', 'rape', 'fuk']);

// 轉成比對用的樣子，同時記下每個字在原文的位置（遮蔽時要用）
function normalize(text) {
  const chars = [], at = [];
  let i = 0;
  for (const ch of text) {
    let c = ch.normalize('NFKC').toLowerCase();
    if (!/[\s.\-_*~·・,，。!！?？'"`^|/\\+=()[\]{}<>]/.test(c) && c) { chars.push(c); at.push(i); }
    i += ch.length;
  }
  return { s: chars.join(''), chars, at };
}

function hits(text) {
  const n = normalize(text), out = [];
  // chars 的每一格可能是多個字元（全形轉半形後），所以另外算每格在 s 裡的起點
  const start = [];
  let acc = 0;
  for (const c of n.chars) { start.push(acc); acc += c.length; }
  for (const w of WORDS) {
    let from = 0;
    for (;;) {
      const k = n.s.indexOf(w, from);
      if (k < 0) break;
      from = k + 1;
      if (WHOLE.has(w)) {
        const before = n.s[k - 1], after = n.s[k + w.length];
        if ((before && /[a-z]/.test(before)) || (after && /[a-z]/.test(after))) continue;
      }
      const a = start.findIndex((s) => s >= k), b = start.findIndex((s) => s >= k + w.length);
      out.push([n.at[a < 0 ? 0 : a], b < 0 ? text.length : n.at[b]]);
    }
  }
  return out;
}

export const isRude = (text) => hits(text).length > 0;

// 把髒話換成＊（其餘原樣）
export function mask(text) {
  const h = hits(text);
  if (!h.length) return text;
  const bad = new Uint8Array(text.length);
  for (const [a, b] of h) for (let i = a; i < b; i++) bad[i] = 1;
  let out = '', i = 0;
  for (const ch of text) { out += bad[i] && !/\s/.test(ch) ? '＊' : ch; i += ch.length; }
  return out;
}

// 名字：去掉控制字元與角括號，頭尾空白拿掉，最多 12 個字
export const cleanName = (s) => typeof s === 'string' ? [...s.replace(/[\u0000-\u001f\u007f<>]/g, '').trim()].slice(0, 12).join('') : '';
