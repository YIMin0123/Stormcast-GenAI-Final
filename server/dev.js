// 開發用的伺服器：node server/dev.js
// 開著測試指令（引發海上事件、快轉、加錢、多開一間房），合併等得比較短，今日紀錄另外存一份（不動正式的）
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.STORMCAST_DEV ??= '1';
process.env.MERGE_AFTER_SEC ??= '40';
process.env.MERGE_COUNT_SEC ??= '12';
process.env.DATA_DIR ??= join(dirname(fileURLToPath(import.meta.url)), 'data', 'dev');
await import('./index.js');
