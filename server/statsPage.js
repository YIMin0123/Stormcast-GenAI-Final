// 管理網頁 /admin/stats 的畫面：把 Activity.report() 的結果嵌進一頁自給自足的 HTML（不載任何外部檔，存成檔案離線也能開）。
// 名字和 IP 都是玩家送來的，一律用 textContent 放進畫面，資料嵌進 <script> 時把 < 轉義，不會被當成標籤。
export function statsPage(report) {
  const data = JSON.stringify(report).replace(/</g, '\\u003c');   // JSON 裡的 < 轉義，名字裡的 </script> 不會把標籤提早關掉
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stormcast 玩家活動</title>
<style>
:root{--bg:#f3f7fa;--card:#fff;--ink:#16303f;--mute:#62798a;--line:#dbe5ec;--accent:#1d79a8;--bar:#4aa3cf;--pc:#1d79a8;--mob:#e8794d;--warn:#b4552d}
@media(prefers-color-scheme:dark){:root{--bg:#0e1a22;--card:#15262f;--ink:#e3eef4;--mute:#8aa3b3;--line:#24394a;--accent:#5bb6e0;--bar:#3b8bb3;--pc:#5bb6e0;--mob:#f0916a;--warn:#f0916a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,"Noto Sans TC","Microsoft JhengHei",sans-serif}
main{max-width:1180px;margin:0 auto;padding:20px 16px 60px}
h1{font-size:20px;margin:0 0 2px}h2{font-size:15px;margin:0 0 10px}.sub{color:var(--mute);font-size:12px}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-top:16px}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:560px}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);white-space:nowrap;font-variant-numeric:tabular-nums}
th{font-size:12px;color:var(--mute);font-weight:600}td.n,th.n{text-align:right}
tr.pick{cursor:pointer}tr.pick:hover td{background:color-mix(in srgb,var(--accent) 8%,transparent)}tr.sel td{background:color-mix(in srgb,var(--accent) 16%,transparent)}
.tag{display:inline-block;padding:0 7px;border-radius:9px;font-size:12px;color:#fff}.pc{background:var(--pc)}.mobile{background:var(--mob)}
.muted{color:var(--mute)}.warn{color:var(--warn)}
.chart{display:flex;align-items:flex-end;gap:3px;height:110px;margin:6px 0 2px}.chart i{flex:1;background:var(--bar);border-radius:3px 3px 0 0;min-height:1px;position:relative}
.axis{display:flex;gap:3px;font-size:10px;color:var(--mute)}.axis span{flex:1;text-align:center}
input[type=search]{padding:5px 9px;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--ink);width:240px;max-width:100%}
.names div{line-height:1.35}.top{display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:space-between}
.chips{display:flex;gap:8px;flex-wrap:wrap}.chip{border:1px solid var(--line);border-radius:8px;padding:4px 10px}.chip b{font-size:16px}
</style></head><body><main>
<h1>Stormcast 玩家活動</h1>
<div class="sub" id="meta"></div>
<div id="off" class="warn" hidden>這是測試伺服器，不記錄玩家活動（只統計正式機）。看正式機請在專案資料夾跑 bash deploy/stats.sh。</div>
<section><h2>現在線上</h2><div id="online"></div></section>
<section><div class="top"><h2>📮 玩家意見箱（共 <span id="fbN"></span> 則，最新的在上面）</h2><input type="search" id="fbQ" placeholder="找內容、名字、代碼"></div><div class="chips" id="fbKinds" style="margin:6px 0"></div><div class="wrap"><table id="fb"></table></div></section>
<section><h2>每日統計（近 <span id="keep"></span> 天，台灣時間；點一天看細節）</h2><div class="wrap"><table id="days"></table></div></section>
<section><div class="top"><h2 id="dayTitle">當天</h2><div class="chips" id="dayChips"></div></div>
<div class="sub">每小時同時在線的最高人數</div><div class="chart" id="chart"></div><div class="axis" id="axis"></div></section>
<section><h2>當天時間表</h2><div class="wrap"><table id="events"></table></div></section>
<section><div class="top"><h2>玩家（一個裝置代碼一筆；換名字、清掉瀏覽器資料重進會變成新代碼，可從「同 IP」看出來）</h2><input type="search" id="q" placeholder="找名字、IP、代碼"></div><div class="wrap"><table id="people"></table></div></section>
</main>
<script>
const R=${data};
const $=(id)=>document.getElementById(id);
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=text;if(cls)e.className=cls;return e};
const pad=(n)=>String(n).padStart(2,'0');
const tw=(ms)=>new Date(ms+8*3600*1000);
const hm=(ms)=>{const d=tw(ms);return pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())+':'+pad(d.getUTCSeconds())};
const full=(ms)=>{const d=tw(ms);return (d.getUTCMonth()+1)+'/'+d.getUTCDate()+' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())};
const dur=(s)=>s<60?s+' 秒':s<3600?Math.round(s/60)+' 分':(s/3600).toFixed(1)+' 時';
const money=(n)=>'$'+Math.round(n).toLocaleString();
const devTag=(t)=>el('span',t==='mobile'?'手機':'電腦','tag '+(t==='mobile'?'mobile':'pc'));
const WHY={leave:'按了離開',expire:'斷線太久被收走',idle:'閒置太久被請出',restart:'伺服器重開',crash:'異常結束（伺服器非正常關閉）'};
const NAME={};for(const p of R.people)NAME[p.pid]=p.names.length?p.names[p.names.length-1].name:p.pid;
function table(node,head,rows,numCols=[]){node.replaceChildren();const th=el('thead'),tr=el('tr');head.forEach((h,i)=>tr.append(el('th',h,numCols.includes(i)?'n':'')));th.append(tr);const tb=el('tbody');rows.forEach((r)=>tb.append(r));node.append(th,tb);return tb}
function row(cells,numCols=[]){const tr=el('tr');cells.forEach((c,i)=>{const td=el('td');if(numCols.includes(i))td.className='n';if(c instanceof Node)td.append(c);else td.textContent=c;tr.append(td)});return tr}

$('off').hidden=!R.off;
$('meta').textContent=R.source==='prod'?'資料來自正式機，抓取於 '+full(R.fetchedAt)+'（台灣時間）。重新整理這頁會重新向正式機要（約 5～10 秒，20 秒內用快取）。':'資料產生於 '+full(R.generatedAt)+'（台灣時間）。重新整理要再跑一次 deploy/stats.sh。';
$('keep').textContent=R.keepDays;

// 現在線上
{const box=$('online');if(!R.online.length){box.append(el('div','目前沒有人在線上。','muted'))}else{const t=el('table');box.append(el('div'),t);const wrap=box.children[0];wrap.className='wrap';wrap.append(t);
table(t,['名字','房間','裝置','IP','進來時間','連線'],R.online.map((o)=>row([o.name,o.room,devTag(o.dev),o.ip,full(o.since),o.connected?'連著':'斷線中（寬限內）'])))}}

// 每日統計
let day=R.days.length?R.days[0].date:'';
function drawDays(){const rows=R.days.map((d)=>{const r=row([d.date,d.players,d.pc,d.mobile,d.fresh,d.sessions,d.avgMin+' 分',d.peak,d.catches,money(d.earned),money(d.spent)],[1,2,3,4,5,6,7,8,9,10]);r.className='pick'+(d.date===day?' sel':'');r.onclick=()=>{day=d.date;drawDays();drawDay()};return r});
table($('days'),['日期','不同玩家','電腦','手機','新玩家','場次','平均每場','同時最高','釣到(條)','賺','花'],rows,[1,2,3,4,5,6,7,8,9,10]);
if(!R.days.length)$('days').append(el('caption','還沒有任何紀錄。'))}
function drawDay(){const d=R.days.find((x)=>x.date===day);$('dayTitle').textContent=day?day+'（星期'+'日一二三四五六'[new Date(day+'T00:00:00Z').getUTCDay()]+'）':'當天';
$('dayChips').replaceChildren();if(d){[['不同玩家',d.players],['電腦',d.pc],['手機',d.mobile],['新玩家',d.fresh],['場次',d.sessions],['同時最高',d.peak]].forEach(([k,v])=>{const c=el('div','','chip');c.append(el('b',v),el('span',' '+k,'muted'));$('dayChips').append(c)})}
const max=Math.max(1,...(d?d.hourly:[0]));$('chart').replaceChildren();$('axis').replaceChildren();
for(let h=0;h<24;h++){const v=d?d.hourly[h]:0,b=el('i');b.style.height=(v/max*100)+'%';b.title=pad(h)+':00 最高 '+v+' 人';$('chart').append(b);$('axis').append(el('span',h%3===0?pad(h):''))}
const ev=(R.events[day]||[]).filter((e)=>e.t==='join');   // 只列誰進了遊戲：離開、斷線、接回、換名、伺服器啟動都不列
const label={join:'進房',back:'斷線接回',drop:'斷線',end:'離開',rename:'換名',boot:'伺服器啟動'};
table($('events'),['時間','事件','名字','房間','裝置','IP','說明'],ev.map((e)=>{
 let note='';if(e.t==='end')note=(WHY[e.why]||e.why)+'；玩了 '+dur(e.sec)+'；釣到 '+e.catches+' 條；賺 '+money(e.earned)+'、花 '+money(e.spent)+(e.bought&&e.bought.length?'；買了 '+e.bought.join('、'):'');
 else if(e.t==='join')note=e.new?'新玩家（第一次出現）':'';else if(e.t==='rename')note=e.from+' → '+e.to;
 const name=e.t==='rename'?e.to:(e.name||NAME[e.pid]||'');
 const dev=e.dev?devTag(e.dev):'';return row([hm(e.at),label[e.t]||e.t,name,e.room||'',dev,e.ip||'',note])}));
if(!ev.length)$('events').append(el('caption','這天沒有紀錄。'))}

// 玩家
function drawPeople(){const q=$('q').value.trim().toLowerCase();
const list=R.people.filter((p)=>!q||p.pid.includes(q)||p.names.some((n)=>n.name.toLowerCase().includes(q))||(p.ips||[]).some((ip)=>ip.includes(q)));
table($('people'),['名字（舊→新）','裝置','IP','首次','最近','場次','總時長','釣到','賺','花','同 IP 的其他代碼'],list.map((p)=>{
 const names=el('div','','names');p.names.slice().reverse().forEach((n,i)=>{const d=el('div',n.name+(i?'':'（目前）'),i?'muted':'');d.title=full(n.at);names.append(d)});
 const same=p.same.length?p.same.map((x)=>NAME[x]+'（'+x.slice(0,4)+'）').join('、'):'';
 const r=row([names,el('span',(p.dev==='mobile'?'手機':'電腦')+' '+(p.os||'')+' '+(p.browser||''),'muted'),(p.ips||[]).join('、'),full(p.first),full(p.last),p.sessions,dur(p.sec),p.catches,money(p.earned),money(p.spent),same],[5,7,8,9]);
 r.title='代碼 '+p.pid;if(same)r.lastChild.className='warn';return r}),[5,7,8,9]);
if(!list.length)$('people').append(el('caption','沒有符合的玩家。'))}
$('q').oninput=drawPeople;
// 玩家意見箱（港口的漁會意見信箱收到的）：依分類篩選、找關鍵字。內容一律用 textContent 放進畫面
const FBK={bug:'🐛 Bug 回報',idea:'💡 玩法建議',perf:'📱 卡頓／操作問題'};let fbKind='';
function drawFb(){const q=$('fbQ').value.trim().toLowerCase(),all=R.feedback||[];
const list=all.filter((f)=>(!fbKind||f.kind===fbKind)&&(!q||(f.text+' '+f.name+' '+f.pid).toLowerCase().includes(q)));
$('fbN').textContent=all.length;
const ks=$('fbKinds');ks.replaceChildren();
[['','全部']].concat(Object.entries(FBK)).forEach(([k,t])=>{const b=el('button',t+'（'+all.filter((f)=>!k||f.kind===k).length+'）','chip');b.style.cursor='pointer';b.style.font='inherit';b.style.color='inherit';b.style.background=k===fbKind?'var(--bar)':'transparent';b.onclick=()=>{fbKind=k;drawFb()};ks.append(b)});
table($('fb'),['時間','分類','玩家（代碼）','意見內容'],list.map((f)=>row([full(f.at),FBK[f.kind]||f.kind,f.name+'（'+f.pid+'）',f.text])));
if(!list.length)$('fb').append(el('caption',all.length?'沒有符合的意見。':'還沒有人投遞意見。'))}
$('fbQ').oninput=drawFb;
drawDays();drawDay();drawPeople();drawFb();
</script></body></html>`;
}
