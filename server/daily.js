// 今日紀錄：所有房間一起比，每人只留最好的一條，台灣時間午夜重置。
// 存成一個小檔案，伺服器重開不會不見。
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

// 台灣現在是哪一天（UTC+8，沒有日光節約時間）
const today = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const pub = (e) => ({ name: e.name, id: e.id, len: e.len, kg: e.kg, value: e.value });

export class Daily {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'daily.json');
    this.date = today();
    this.list = [];
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8'));
      if (d.date === this.date && Array.isArray(d.list)) this.list = d.list;
    } catch { /* 沒有檔案、或檔案壞了：從空的開始 */ }
    this.dirty = false;
  }

  // 過了午夜就清空；有清回傳 true
  roll() {
    const d = today();
    if (d === this.date) return false;
    this.date = d; this.list = []; this.dirty = true;
    this.save();
    return true;
  }

  // 有人釣到一條魚。比他今天最好的那條還值錢就記下來，回傳名次（0 起算）；沒有就回傳 -1
  offer(e) {
    this.roll();
    const old = this.list.findIndex((o) => o.key === e.key);
    if (old >= 0 && this.list[old].value >= e.value) return -1;
    if (old >= 0) this.list.splice(old, 1);
    const rec = { key: e.key, ...pub(e) };
    this.list.push(rec);
    this.list.sort((a, b) => b.value - a.value);
    const rank = this.list.indexOf(rec);
    this.list.length = Math.min(this.list.length, 200);
    this.dirty = true;
    return rank < 200 ? rank : -1;
  }

  top() { return this.list.slice(0, 10).map(pub); }

  save() {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      writeFileSync(this.file + '.tmp', JSON.stringify({ date: this.date, list: this.list }));
      renameSync(this.file + '.tmp', this.file);   // 先寫到暫存檔再換過去：寫到一半當機也不會弄壞原本的檔
    } catch (err) { console.error('[daily] 存檔失敗', err.message); }
  }
}
