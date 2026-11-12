// 自己選的角色（女版 girl／男版 boy）：記在瀏覽器裡，下次打開預設就是它。
// 網址加 ?boy／?girl 優先（測試用）。連線時告訴伺服器（net.js），伺服器再轉給同房間的人
export const LOOKS = ['girl', 'boy'];
const QS = new URLSearchParams(location.search);
export function myLook() {
  if (QS.has('boy')) return 'boy';
  if (QS.has('girl')) return 'girl';
  try { const v = localStorage.getItem('stormcast.look'); if (LOOKS.includes(v)) return v; } catch { /* 不能用瀏覽器儲存就用預設 */ }
  return 'girl';
}
export function setMyLook(look) {
  try { localStorage.setItem('stormcast.look', look); } catch { /* 存不了就算了 */ }
}
