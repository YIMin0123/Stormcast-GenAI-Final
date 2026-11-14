// 更新資訊的「看過沒」：瀏覽器記著最後看到哪一條（announce.js 的 UPDATES），比它新的就是未讀，拿來亮小紅點。
// 打開平板的「公告」app 才算看過（主頁的公告只是露出來，不算）。
// ?test 分頁記在分頁自己（sessionStorage），不動正式的紀錄，跟 net.js 的名字、代碼一樣
import { UPDATES } from './announce.js';
import { TEST } from './net.js';

const KEY = 'stormcast.seenUpdate';
const store = (() => { try { return TEST ? window.sessionStorage : window.localStorage; } catch { return null; } })();
let seen = '';
try { seen = store?.getItem(KEY) ?? ''; } catch { /* 讀不到就當全部沒看過 */ }

// 還沒看過的更新有幾條（UPDATES 最新的在最上面；id 是日期字串，比大小就是新舊）
export const unreadCount = () => UPDATES.filter((u) => u.id > seen).length;
export const isUnread = (u) => u.id > seen;

// 看過了：記下目前最新的那條
export function markRead() {
  const last = UPDATES[0]?.id ?? '';
  if (last <= seen) return;
  seen = last;
  try { store?.setItem(KEY, seen); } catch { /* 存不了就下次再亮 */ }
}
