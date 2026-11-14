// 慢連線的發送佇列有上限，避免廣播堆在記憶體裡。
const MAX_QUEUED_BYTES = 1024 * 1024;

export function sendRaw(ws, raw) {
  if (ws?.readyState !== 1) return;
  if (ws.bufferedAmount > MAX_QUEUED_BYTES) {
    ws.terminate();
    return;
  }
  ws.send(raw);
}
