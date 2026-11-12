# 上線步驟

還沒做，等確認後才動。分兩邊：**網頁**放 GitHub Pages，**遊戲伺服器**放 GCP 的 `valheim-tw`。

## 伺服器（GCP valheim-tw）

會在機器上裝、改的東西只有這些：

| 東西 | 用途 |
| --- | --- |
| Node.js 22 | 跑遊戲伺服器（`server/`） |
| Caddy | 自動申請 https 憑證，把連線轉給遊戲伺服器 |
| 使用者 `stormcast` | 專門跑遊戲伺服器的帳號（沒有管理權限） |
| `/opt/stormcast` | 程式放這裡 |
| `/var/lib/stormcast` | 今日紀錄存這裡（一個小檔案） |
| 防火牆開 80、443（TCP） | 讓瀏覽器連得進來；瓦爾海姆用的埠不動 |

步驟：

```bash
# 1. 裝 Node.js 22 和 Caddy
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs caddy

# 2. 放程式
sudo useradd --system --home /opt/stormcast --shell /usr/sbin/nologin stormcast
sudo mkdir -p /opt/stormcast /var/lib/stormcast
sudo git clone -b multiplayer https://github.com/YIMin0123/Stormcast.git /opt/stormcast
cd /opt/stormcast/server && sudo npm ci --omit=dev
sudo chown -R stormcast:stormcast /opt/stormcast /var/lib/stormcast

# 3. 開機自動啟動
sudo cp /opt/stormcast/deploy/stormcast.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now stormcast

# 4. https
sudo cp /opt/stormcast/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

GCP 主控台 → VPC 網路 → 防火牆：新增一條規則，允許 TCP 80、443 進到這台。

檢查：瀏覽器打開 `https://35-229-248-193.sslip.io/`，看到「Stormcast 伺服器運作中」就是通了。

之後更新：

```bash
cd /opt/stormcast && sudo -u stormcast git pull && cd server && sudo -u stormcast npm ci --omit=dev && sudo systemctl restart stormcast
```

重開伺服器時，房間裡的人都會斷線、進度清空（今日紀錄會留著）。

## 網頁（GitHub Pages）

1. repo 要是公開的（免費帳號要公開才能用 Pages）。
2. repo 的 Settings → Pages → Source 選「GitHub Actions」。
3. 把 `multiplayer` 分支推上去（多人版目前從這個分支上線，合併進 main 之後再改回 main），`.github/workflows/pages.yml` 會自動打包、發佈到 `https://yimin0123.github.io/Stormcast/`。

網頁預設連 `wss://35-229-248-193.sslip.io`（寫在 `src/net.js` 的 `PROD_SERVER`）。伺服器換位址的話改那一行，
或是打包時設環境變數 `VITE_SERVER_URL`。

## 投稿 4388.fun

網頁和伺服器都通了之後，把 `https://yimin0123.github.io/Stormcast/` 這個網址投過去。
4388 對 GitHub Pages 的網址有 7 天觀察期；用自己的網域可以免。

## 在自己電腦上測

```bash
node server/dev.js
```

```bash
npm run dev
```

`server/dev.js` 是開發用的伺服器：開著測試指令、合併等得比較短。網址加 `?test&name=小明&room=1` 會直接用這個名字進 1 號港，
每個這樣的分頁都是不同的玩家。伺服器的自動測試：`node server/test/smoke.mjs`。
