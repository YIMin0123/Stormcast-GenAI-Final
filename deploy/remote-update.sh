#!/usr/bin/env bash
# 在伺服器上跑（由 push.sh 傳上來執行，用 sudo）：換網頁、換伺服器程式。
#   web：只換網頁　all：網頁＋伺服器（伺服器會重開）
#   第二個參數 later：伺服器程式換好但不重開（由全服公告的倒數歸零時重開，那時才用新程式）
set -euo pipefail
MODE="${1:-all}"; WHEN="${2:-now}"
STAGE="$(cd -- "$(dirname -- "$0")" && pwd -P)"
if [[ ! "$STAGE" =~ ^/tmp/stormcast-deploy\.[A-Za-z0-9]{10}$ ]]; then echo "更新檔必須位於獨立的上傳目錄"; exit 1; fi
case "$MODE:$WHEN" in all:now|all:later|web:now) ;; *) echo "無效的更新模式"; exit 1 ;; esac
exec 9>/run/stormcast-deploy.lock
flock -x 9
WEB=/var/www/stormcast

# 網頁：先解到新資料夾再整個換過去，換的瞬間不會有人看到一半的檔案
mkdir -p "$WEB.new"; rm -rf "$WEB.new"/*
tar -xzf "$STAGE/dist.tgz" -C "$WEB.new"
chmod -R a+rX "$WEB.new"
rm -rf "$WEB.old"; [ -d "$WEB" ] && mv "$WEB" "$WEB.old"
mv "$WEB.new" "$WEB"
echo "網頁已更新"

if [ "$MODE" != "web" ]; then
  APP=/opt/stormcast
  rm -rf "$APP.new"; mkdir -p "$APP.new"
  tar -xzf "$STAGE/server.tgz" -C "$APP.new"
  (cd "$APP.new/server" && npm ci --omit=dev --ignore-scripts --silent)
  chown -R stormcast:stormcast "$APP.new"
  if [ "$WHEN" = "later" ]; then
    # 跑著的伺服器程式已經讀進記憶體，換資料夾不影響它；之後重開（倒數歸零）起來的就是新的
    rm -rf "$APP.old"; [ -d "$APP" ] && mv "$APP" "$APP.old"
    mv "$APP.new" "$APP"
    echo "伺服器程式已換好（還沒重開，等倒數歸零）"
  else
    systemctl stop stormcast
    rm -rf "$APP.old"; [ -d "$APP" ] && mv "$APP" "$APP.old"   # 舊的留著，出事可以換回來（下次更新才刪）
    mv "$APP.new" "$APP"
    systemctl start stormcast
    sleep 2
    systemctl is-active stormcast
    echo "伺服器已更新"
  fi
fi
