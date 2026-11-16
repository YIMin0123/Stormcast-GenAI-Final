#!/usr/bin/env bash
# 看玩家活動統計（每日人數、進出時間、換名、電腦／手機、IP、遊玩摘要）。在自己電腦上跑，需要 gcloud 已登入：
#   bash deploy/stats.sh           從伺服器抓一份最新的統計頁，存成檔案並用瀏覽器開啟
#   bash deploy/stats.sh json      只印原始資料（JSON）
# 統計頁只在伺服器本機提供（Caddy 把 /admin 擋成 404，外面看不到），所以用 ssh 在伺服器上取回來；
# 頁面是自給自足的一個 HTML 檔，抓回來之後離線也能開。要更新就再跑一次。
# 本機開發版直接開 http://localhost:8787/admin/stats 就行。
set -euo pipefail
VM=valheim-tw; ZONE=asia-east1-b
if [ "${1:-}" = "json" ]; then
  gcloud compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap --quiet --command "curl -fsS http://127.0.0.1:8787/admin/stats.json"
  exit 0
fi
OUT="${TEMP:-${TMPDIR:-/tmp}}/stormcast-stats.html"
gcloud compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap --quiet --command "curl -fsS http://127.0.0.1:8787/admin/stats" > "$OUT"
echo "已存到 $OUT"
if command -v cygpath >/dev/null 2>&1; then cmd.exe //c start "" "$(cygpath -w "$OUT")"
elif command -v open >/dev/null 2>&1; then open "$OUT"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$OUT"
fi
