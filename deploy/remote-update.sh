#!/usr/bin/env bash
# 在伺服器上跑（由 push.sh 傳上來執行，用 sudo）：換網頁、換伺服器程式。
#   web：只換網頁　all：網頁＋伺服器（伺服器會重開）
set -euo pipefail
MODE="${1:-all}"
WEB=/var/www/stormcast

# 網頁：先解到新資料夾再整個換過去，換的瞬間不會有人看到一半的檔案
mkdir -p "$WEB.new"; rm -rf "$WEB.new"/*
tar -xzf /tmp/dist.tgz -C "$WEB.new"
chmod -R a+rX "$WEB.new"
rm -rf "$WEB.old"; [ -d "$WEB" ] && mv "$WEB" "$WEB.old"
mv "$WEB.new" "$WEB"
echo "網頁已更新"

if [ "$MODE" != "web" ]; then
  APP=/opt/stormcast
  rm -rf "$APP.new"; mkdir -p "$APP.new"
  tar -xzf /tmp/server.tgz -C "$APP.new"
  (cd "$APP.new/server" && npm ci --omit=dev --silent)
  chown -R stormcast:stormcast "$APP.new"
  systemctl stop stormcast
  rm -rf "$APP.old"; [ -d "$APP" ] && mv "$APP" "$APP.old"   # 舊的留著，出事可以換回來（下次更新才刪）
  mv "$APP.new" "$APP"
  systemctl start stormcast
  sleep 2
  systemctl is-active stormcast
  echo "伺服器已更新"
fi
rm -f /tmp/dist.tgz /tmp/server.tgz
