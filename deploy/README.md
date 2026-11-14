# 上線與部署

網頁和遊戲伺服器都放在 GCP 的 `valheim-tw`（跟瓦爾海姆共用一台），同一個網址：`https://35-229-248-193.sslip.io/`。
不經過 GitHub（GitHub 倉庫是私人的、只當備份）。

## 日常上線

在自己電腦、專案資料夾裡（需要 `gcloud` 已登入）：

```bash
bash deploy/push.sh                  # 網頁＋伺服器（伺服器會重開，房裡的人斷線重連；錢、船、魚等進度存在檔案裡不會掉）
bash deploy/push.sh web              # 只換網頁（不踢人）
bash deploy/push.sh all origin/main  # 指定版本（任何 git 版本都可以，預設是目前的 HEAD）
```

- 只會上線**已經提交**的內容（用 `git archive` 取出、在暫存資料夾打包），沒提交的改動不會被帶上去。
- 打包在自己電腦上做，不吃伺服器的記憶體。
- 只改畫面用 `web`；改到 `server/` 或兩邊共用的檔（`src/fishdata.js`、`boatdata.js`、`layout.js`、`terrain.js`、`weather.js`、`config.js` 等）要用完整的。
- 舊版會留在伺服器的 `/opt/stormcast.old`、`/var/www/stormcast.old`（下次更新才刪），出事可以換回來。

檢查：瀏覽器打開網址能玩；`https://35-229-248-193.sslip.io/status` 看到「Stormcast 伺服器運作中」。

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
gcloud compute scp deploy/Caddyfile deploy/stormcast.service valheim-tw:/tmp/ --zone asia-east1-b
gcloud compute ssh valheim-tw --zone asia-east1-b --command "sudo caddy validate --config /tmp/Caddyfile --adapter caddyfile && sudo cp /tmp/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy && sudo cp /tmp/stormcast.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl restart stormcast"
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
每個這樣的分頁都是不同的玩家。伺服器的自動測試：`node server/test/smoke.mjs`。

## 投稿 4388.fun

網頁和伺服器都通了之後，把上面那個網址投過去（網域是自己的才不會有 GitHub Pages 的 7 天觀察期問題；用 sslip.io 的話投稿前確認他們接不接受）。
