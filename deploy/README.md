# 上線與部署

網頁和遊戲伺服器都放在 GCP 的 `valheim-tw`（跟瓦爾海姆共用一台），同一個網址：`https://35-229-248-193.sslip.io/`。
不經過 GitHub（GitHub 倉庫是私人的、只當備份）。

## 日常上線

在自己電腦、專案資料夾裡（需要 `gcloud` 已登入）：

```bash
bash deploy/push.sh                  # 網頁＋伺服器（伺服器會重開，房裡的人斷線重連；錢、船、魚等進度存在檔案裡不會掉）
bash deploy/push.sh web              # 只換網頁（不踢人）
bash deploy/push.sh all origin/main  # 指定版本（任何 git 版本都可以，預設是目前的 HEAD）
bash deploy/push.sh --notice "新版本更新" --count 60   # 完整上線＋跑馬燈倒數（見下面）
```

- 上線前先在 `src/announce.js` 的 `UPDATES` 最上面加一條玩家看得懂的更新資訊（主頁公告和平板「公告」app 會顯示，沒看過的人會亮小紅點）。
- 只會上線**已經提交**的內容（用 `git archive` 取出、在暫存資料夾打包），沒提交的改動不會被帶上去。
- 打包在自己電腦上做，不吃伺服器的記憶體。
- 只改畫面用 `web`；改到 `server/` 或兩邊共用的檔（`src/fishdata.js`、`boatdata.js`、`layout.js`、`terrain.js`、`weather.js`、`config.js` 等）要用完整的。
- 舊版會留在伺服器的 `/opt/stormcast.old`、`/var/www/stormcast.old`（下次更新才刪），出事可以換回來。

檢查：瀏覽器打開網址能玩；`https://35-229-248-193.sslip.io/status` 看到「Stormcast 伺服器運作中」。

## 全服公告（跑馬燈）與強制重開

```bash
bash deploy/announce.sh "今晚 10 點維修"      # 發跑馬燈公告（一直掛著）
bash deploy/announce.sh "新版本更新" 60       # 公告＋60 秒倒數，倒數完伺服器存檔重開（玩家斷線後自動接回）
bash deploy/announce.sh "" 60                  # 只倒數、不寫字
bash deploy/announce.sh clear                  # 取消公告和倒數
```

重開 = 伺服器把所有人的進度存好後結束，systemd 幾秒內再開起來（錢、船、裝備、魚都存在檔案裡）。要上線新版又要倒數，直接用 `push.sh --notice "文字" --count 秒數`：先在自己電腦打包、上傳、把新程式換到伺服器上（這時還不重開），**換好之後才發公告開始倒數**，歸零那一刻伺服器重開，只重開一次、不會提早。（不要先發 `announce.sh` 倒數再另外跑不帶 `--count` 的 `push.sh`：`push.sh` 會立刻重開，倒數就被打斷了。）
伺服器重開後，客戶端會自動重新進同一間房（進度跟著代碼回來、人回港口、聊天欄提示「伺服器剛更新完」），不用玩家按任何東西；只有房間關了、滿了才會跳「斷線太久」。
管理端點只接受伺服器本機 CLI 的 POST。瀏覽器和反向代理轉發的請求會被拒絕。

## 伺服器上有什麼（第一次設定時裝的，已經裝好）

| 東西 | 用途 |
| --- | --- |
| Node.js 22 | 跑遊戲伺服器（`server/`） |
| Caddy | 自動申請 https 憑證；WebSocket 轉給遊戲伺服器，其他送 `/var/www/stormcast` 的網頁（設定檔 `deploy/Caddyfile`） |
| 服務 `stormcast` | 開機自動啟動、當掉自動重開（`deploy/stormcast.service`），程式在 `/opt/stormcast`，使用者 `stormcast`（沒有管理權限） |
| `/var/lib/stormcast` | 今日紀錄、玩家存檔（`profiles.json`、`daily.json`），重開不會掉 |
| 防火牆規則 `stormcast-allow-web` | TCP 80、443 |

改 `Caddyfile` 或 `stormcast.service` 之後要手動放到伺服器：

```bash
STAGE="$(gcloud compute ssh valheim-tw --zone asia-east1-b --command 'mktemp -d /tmp/stormcast-config.XXXXXXXXXX')"
[[ "$STAGE" =~ ^/tmp/stormcast-config\.[A-Za-z0-9]{10}$ ]] &&
  gcloud compute scp deploy/Caddyfile deploy/stormcast.service "valheim-tw:$STAGE/" --zone asia-east1-b &&
  gcloud compute ssh valheim-tw --zone asia-east1-b --command "sudo caddy validate --config '$STAGE/Caddyfile' --adapter caddyfile && sudo install -m 644 '$STAGE/Caddyfile' /etc/caddy/Caddyfile && sudo systemctl reload caddy && sudo install -m 644 '$STAGE/stormcast.service' /etc/systemd/system/stormcast.service && sudo systemctl daemon-reload && sudo systemctl restart stormcast && rm -rf -- '$STAGE'"
```

## 換網域

目前的 `35-229-248-193.sslip.io` 是把 IP 當網域用的免費服務（IP 一變就失效，所以 GCP 那個外部 IP 要是「靜態」）。買了自己的網域之後：

1. DNS 加一筆 A 記錄指到 `35.229.248.193`。
2. 改 `deploy/Caddyfile` 第一行、`deploy/stormcast.service` 的 `ORIGINS`、`src/net.js` 的 `PROD_SERVER`。
3. 照上面的方式放 Caddyfile 和 service，再 `bash deploy/push.sh` 上線。

## 在自己電腦上測

```bash
node server/dev.js
```

```bash
npm run dev
```

`server/dev.js` 是開發用的伺服器：開著測試指令、合併等得比較短。網址加 `?test&name=小明&room=1` 會直接用這個名字進 1 號港，
每個這樣的分頁都是不同的玩家。伺服器的安全回歸測試可用 `node --test tools/security.test.js`。

## 投稿 4388.fun

網頁和伺服器都通了之後，把上面那個網址投過去（網域是自己的才不會有 GitHub Pages 的 7 天觀察期問題；用 sslip.io 的話投稿前確認他們接不接受）。
