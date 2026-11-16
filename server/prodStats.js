// 本機測試伺服器（server/dev.js）的 /admin/stats 不記自己的玩家，改成透過 IAP 通道向正式機（GCP valheim-tw）要統計資料，
// 這樣在 http://localhost:8787/admin/stats 看到的就是上線版的玩家。需要這台電腦的 gcloud 已登入（跟 deploy/stats.sh 一樣）。
// 只有 DEV 才會呼叫；指令和參數都是固定的字串，不含任何外部輸入。
import { execFile } from 'node:child_process';

const VM = process.env.PROD_VM || 'valheim-tw', ZONE = process.env.PROD_ZONE || 'asia-east1-b';
const REMOTE = 'curl -fsS http://127.0.0.1:8787/admin/stats.json';
const TTL = 20000, TIMEOUT = 45000;

let cache = null;     // { at, report }
let inflight = null;

function run() {
  const win = process.platform === 'win32';
  // Windows 的 gcloud 是 .cmd，要經過 shell；參數是固定字串，--command 的值自己加引號
  const args = ['compute', 'ssh', VM, '--zone', ZONE, '--tunnel-through-iap', '--quiet', win ? `--command="${REMOTE}"` : `--command=${REMOTE}`];
  return new Promise((resolve, reject) => {
    execFile(win ? 'gcloud.cmd' : 'gcloud', args, { shell: win, timeout: TIMEOUT, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message).trim().split('\n').slice(-3).join(' ') || '連不上正式機'));
      try {
        const report = JSON.parse(stdout);
        if (!report || !Array.isArray(report.days)) throw new Error('格式不對');
        resolve(report);
      } catch {
        reject(new Error('正式機沒有回統計資料（程式可能還沒上線這個功能）：' + stdout.trim().slice(0, 80)));
      }
    });
  });
}

// 20 秒內重複要就用上一份；同時要的只跑一次
export async function prodReport() {
  if (cache && Date.now() - cache.at < TTL) return cache.report;
  inflight ??= run().then((report) => { cache = { at: Date.now(), report: { ...report, source: 'prod', fetchedAt: Date.now() } }; return cache.report; }).finally(() => { inflight = null; });
  return inflight;
}
