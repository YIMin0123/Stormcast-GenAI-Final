#!/usr/bin/env bash
# 對所有線上的人發跑馬燈公告，可以順便倒數、強制重開伺服器（在自己電腦上跑，需要 gcloud 已登入）：
#   bash deploy/announce.sh "今晚 10 點維修"             只發公告（一直掛著，直到 clear）
#   bash deploy/announce.sh "新版本更新" 60             發公告，並且 60 秒後存檔、重開伺服器（畫面上有倒數；玩家斷線後自動接回）
#   bash deploy/announce.sh "" 60                       只倒數、不寫字
#   bash deploy/announce.sh clear                       取消公告和重開倒數
# 重開 = 伺服器存好所有人的進度後結束，systemd 幾秒內自己再開起來。上線新版時：先發倒數公告，倒數結束前跑 push.sh 即可
# （push.sh 本身也會重開伺服器，所以也可以直接：發公告 → 等一會兒 → push.sh）。
# 公告只能從伺服器本機發（外面打不進來）。
set -euo pipefail
VM=valheim-tw; ZONE=asia-east1-b
if [ "${1:-}" = "clear" ]; then
  CMD="curl -s http://127.0.0.1:8787/admin/clear"
else
  TEXT="${1:-}"; SEC="${2:-0}"
  ENC="$(python -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$TEXT")"
  CMD="curl -s 'http://127.0.0.1:8787/admin/notice?text=${ENC}&restart=${SEC}'"
fi
gcloud compute ssh "$VM" --zone "$ZONE" --quiet --command "$CMD"
