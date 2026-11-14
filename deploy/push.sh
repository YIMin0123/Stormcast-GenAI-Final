#!/usr/bin/env bash
# 把遊戲上線到 GCP 的 valheim-tw（網頁＋伺服器都在那台，不經過 GitHub）。在自己電腦上、專案資料夾裡跑：
#   bash deploy/push.sh              上線目前 main 最新一次提交（HEAD）：網頁＋伺服器（伺服器會重開，房裡的人會斷線重連）
#   bash deploy/push.sh web          只換網頁（不動伺服器、不踢人）
#   bash deploy/push.sh all origin/main   指定要上線哪個版本（任何 git 版本都可以）
# 只會上線「已經提交」的內容（用 git archive 取出來、在暫存資料夾打包），沒提交的改動不會被帶上去。
# 打包在自己電腦上做（伺服器那台還跑著瓦爾海姆，不拿它的記憶體來編譯）。需要 gcloud 已登入。
set -euo pipefail
MODE="${1:-all}"; REF="${2:-HEAD}"
VM=valheim-tw; ZONE=asia-east1-b
cd "$(dirname "$0")/.."

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
echo "==> 取出版本 $REF（$(git rev-parse --short "$REF")）"
git archive "$REF" | tar -x -C "$T"
echo "==> 打包網頁"
(cd "$T" && npm ci --silent && npm run build --silent)
tar -czf "$T/dist.tgz" -C "$T/dist" .
FILES=("$T/dist.tgz" deploy/remote-update.sh)
if [ "$MODE" != "web" ]; then
  tar -czf "$T/server.tgz" -C "$T" server src package.json
  FILES+=("$T/server.tgz")
fi
echo "==> 傳到 $VM"
gcloud compute scp "${FILES[@]}" "$VM:/tmp/" --zone "$ZONE" --quiet
echo "==> 在伺服器上更新（$MODE）"
gcloud compute ssh "$VM" --zone "$ZONE" --quiet --command "sudo bash /tmp/remote-update.sh $MODE"
echo "==> 完成：https://35-229-248-193.sslip.io/"
