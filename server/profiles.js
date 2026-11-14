// 每台裝置的進度（錢、船、裝備、還沒賣的魚）：跟著瀏覽器存的認人代碼走，關掉網頁、隔天再來、換房間、伺服器重開都還在，
// 到下一次定時刷新（見 config.js 的 SERVER.refresh）才清空。照 daily.js 的存法放在 DATA 資料夾的一個檔案裡。
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { SERVER } from '../src/config.js';

const FIRST = Date.parse(SERVER.refresh.first), EVERY = SERVER.refresh.everyHours * 3600 * 1000;
// 現在是第幾期：第一次刷新之前是 0，之後每刷新一次加 1
export const epochAt = (now = Date.now()) => (now < FIRST ? 0 : Math.floor((now - FIRST) / EVERY) + 1);


export class Profiles {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'profiles.json');
    this.epoch = epochAt();
    this.raw = new Map();      // 代碼 → 存檔的 JSON 字串（比字串就知道有沒有變）
    this.stale = false;        // 檔案是上一期的：伺服器關著的時候刷新過了
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8'));
      if (d.epoch === this.epoch && d.list && typeof d.list === 'object') {
        for (const [k, v] of Object.entries(d.list)) this.raw.set(k, JSON.stringify(v));
      } else this.stale = true;
    } catch { /* 沒有檔案、或檔案壞了：從空的開始 */ }
    this.dirty = this.stale;
  }

  get(token) {
    const s = token && this.raw.get(token);
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  }

  // 記下這個人現在的進度（跟上次一樣就不動）
  put(token, prof) {
    const s = JSON.stringify(prof);
    if (this.raw.get(token) === s) return;
    this.raw.set(token, s);
    this.dirty = true;
  }

  // 刷新：全部清掉，進到新的一期
  clear(epoch = this.epoch) {
    this.epoch = epoch;
    this.raw.clear();
    this.dirty = true;
    this.save();
  }

  save() {
    if (!this.dirty) return;
    try {
      const list = [...this.raw].map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(',');
      writeFileSync(this.file + '.tmp', `{"epoch":${this.epoch},"list":{${list}}}`);
      renameSync(this.file + '.tmp', this.file);
      this.dirty = false;
    } catch (err) { console.error('[profiles] 存檔失敗', err.message); }
  }
}
