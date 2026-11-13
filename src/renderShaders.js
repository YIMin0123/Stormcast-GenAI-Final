// 畫面用的 GLSL：海面、地形、天空。海平面固定在 y = 0，起伏全部來自 FFT 風浪。
import { SEA_FLOOR, ISLANDS } from './terrain.js';
import { homeGlsl } from './homeGl.js';
import { TSU, CURL, EBB, VORTEX, SWELL_K, SEA_LV, TSU_H } from './weather.js';

// 遠景的薄霧：越遠越淡，約 800 公尺外就融進天色裡（更遠的樹和石頭乾脆不畫）
export const HAZE = 1 / 480;
export const RAIN_HAZE = 1 / 600;   // 下大雨時多出來的那層灰濛濛：雨越大看得越不遠
const f1 = (v) => v.toFixed(2);
const SH = f1(VORTEX.spout.h), SW2 = f1(VORTEX.spout.hw ** 2);
const WD = f1(-VORTEX.whirl.h), WRC = f1(VORTEX.whirl.rc), WVT = f1(VORTEX.whirl.vt), WFAR = f1(VORTEX.whirl.far), WFAR2 = f1(VORTEX.whirl.far - 120);

export const swellLib = /* glsl */ `
uniform float uSwellT;       // = uTime
uniform vec2 uWindDir;       // 風（和浪）往哪邊走
uniform float uSwell;        // 颱風的長浪：最高的高度（公尺），0 = 沒有
// 長浪在這裡的 (高度, 斜率 x, 斜率 z)，還沒乘上 uSwell。跟 weather.js 的 swellAt() 一致
vec3 longSwell(vec2 xz) {
  vec3 o = vec3(0.0);
${SWELL_K.map((w) => `  { vec2 dr = vec2(${w.c.toFixed(5)} * uWindDir.x - ${w.s.toFixed(5)} * uWindDir.y, ${w.s.toFixed(5)} * uWindDir.x + ${w.c.toFixed(5)} * uWindDir.y); float p = dot(xz, dr) * ${w.k.toFixed(6)} - uSwellT * ${w.w.toFixed(8)}; o += ${w.a.toFixed(3)} * vec3(sin(p), cos(p) * ${w.k.toFixed(6)} * dr); }`).join('\n')}
  return o;
}
`;

const common = /* glsl */ `
uniform vec3 uSunDir;
uniform float uTime;
uniform float uGloom;      // 天色：0 晴朗、1 陰沉（風暴或巨浪來之前慢慢變暗）
uniform vec3 uSunCol;      // 主光的顏色與強度：白天是太陽、晚上是月亮（uSunDir 是它的方向）
uniform vec3 uAmbient;     // 環境光：白天 1、夜晚很暗、黃昏偏暖（閃電時瞬間變亮）
uniform float uDay;        // 0 夜晚、1 白天
uniform float uDusk;       // 日出日落的那一段
uniform float uFog;        // 霧
uniform float uHazeK;      // 遠景薄霧的濃度倍數（畫質「手機」比較濃：看得比較近）
uniform float uFlash;      // 閃電
uniform vec3 uFlashDir;    // 閃電在哪個方向（從鏡頭看過去）：那一片天空和雲被照得最亮
uniform float uRain;       // 雨勢
uniform vec2 uCloudT;      // 雲飄了多遠（風越大飄越快，所以是累加的，不是「速度 × 時間」）
// 晴天的積雲：先畫好的一張環景圖（見 clouds.js）。有開 PAINT_SKY 的材質才會用到（天空一定開；海面的倒影看機器）
#ifdef PAINT_SKY
uniform samplerCube uCloudMap;   // RGB 雲表面朝哪個方向、A 有沒有雲
uniform vec3 uPaint;             // (用不用 0–1, 整片雲繞著天頂轉了多少的 cos, sin)：雲慢慢飄
#endif
float gCloud = 0.0;              // skyBase 算完之後：這個方向被畫好的積雲擋住幾成（太陽、月亮躲在雲後面用）

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < oct; i++) {
    s += a * vnoise(p); n += a;
    p = p * 2.03 + vec2(17.3, 9.1); a *= 0.5;
  }
  return s / n;
}

#define SUN_COL (uSunCol * (1.0 - 0.8 * uGloom))
// 雲和雨幕用的環境光：閃電時海面和島會被照得很亮，但整片雲不能跟著全白（閃電本身會被蓋掉），所以扣掉大半
#define SKY_AMB (uAmbient - uFlash * 0.72)

vec3 skyGradient(vec3 d) {
  float y = max(d.y, 0.0);
  vec3 zen = mix(vec3(0.035, 0.25, 0.76), vec3(0.13, 0.16, 0.21), uGloom) * (1.0 - 0.3 * uRain);   // 卡通風：飽和的藍天
  vec3 hor = mix(vec3(0.55, 0.80, 0.97), vec3(0.36, 0.40, 0.44), uGloom) * (1.0 - 0.3 * uRain);
  zen = mix(vec3(0.005, 0.009, 0.026), zen, uDay);
  hor = mix(vec3(0.016, 0.028, 0.055), hor, uDay);
  vec3 c = mix(hor, zen, pow(y, 0.5));
  float s = max(dot(d, uSunDir), 0.0);
  // 日出日落：靠近太陽那一側的地平線染成橘紅
  c += vec3(1.0, 0.40, 0.10) * uDusk * (1.0 - uGloom) * pow(1.0 - y, 5.0) * (0.22 + 0.78 * pow(s, 3.0)) * 0.75;
  c += uSunCol * vec3(1.0, 0.78, 0.53) * (pow(s, 10.0) * 0.16 + pow(s, 80.0) * 0.25) * (1.0 - uGloom);
  // 閃電：整片天微微亮一下，閃電所在的那個方向亮得多
  c += vec3(0.50, 0.56, 0.80) * uFlash * (0.05 + 0.32 * pow(max(dot(d, uFlashDir), 0.0), 4.0));
  return c;
}

// 天空加雲。oct 控制雲的細緻度（反射用少一點即可）
vec3 skyBase(vec3 d, int oct) {
  vec3 c = skyGradient(d);
  if (oct >= 5 && uDay < 0.98 && d.y > 0.0) {
    // 星星：把天空切成小格子，少數格子裡有一顆
    vec2 uv = d.xz / (d.y + 0.4) * 70.0;
    vec2 ip = floor(uv), fp = fract(uv) - 0.5;
    vec2 o = (vec2(hash21(ip + 3.1), hash21(ip + 7.7)) - 0.5) * 0.6;
    float st = step(0.90, hash21(ip)) * smoothstep(0.10, 0.0, length(fp - o)) * (0.4 + 0.6 * hash21(ip + 1.3));
    c += vec3(0.9, 0.95, 1.0) * st * (1.0 - uDay) * (1.0 - uGloom) * (1.0 - uFog) * 1.3;
  }
  // 晴天用畫好的積雲，天色一沉就換回下面這套會變厚、變暗、會被閃電照亮的雲（paint：畫好的積雲佔幾成）
  float paint = 0.0;
#ifdef PAINT_SKY
  paint = uPaint.x * (1.0 - smoothstep(0.08, 0.42, uGloom));
#endif
  if (d.y > 0.015 && paint < 0.995) {
    vec2 uv = d.xz / (d.y + 0.14) * 1.15 + uCloudT;
    float n = fbm(uv, oct);
    float soft = oct >= 5 ? 0.0 : 0.13;   // 倒影用的（oct 少的那份）邊緣放柔很多
    float dens = smoothstep(0.55 - 0.36 * uGloom - soft, 0.66 - 0.2 * uGloom + soft, n) * smoothstep(0.015, 0.16, d.y) * (1.0 - paint);   // 雲的邊緣是清楚的塊面；天色越沉雲越厚
    float s = max(dot(d, uSunDir), 0.0);
    vec3 lit = mix(vec3(1.0, 0.99, 0.97), vec3(0.70, 0.77, 0.93), smoothstep(0.71, 0.75, n)) * SKY_AMB;   // 雲只有亮面和偏藍的暗面兩階
    if (oct >= 5) {
      // 往太陽方向再取一次密度：朝陽的雲緣亮、背陽面暗，做出厚度感
      float n2 = fbm(uv + normalize(uSunDir.xz + 1e-4) * 0.10, 3);
      lit *= mix(0.80, 1.06, smoothstep(0.44, 0.56, (n - n2) * 4.0 + 0.5));
    }
    lit += SUN_COL * pow(s, 6.0) * 0.35 * (1.0 - smoothstep(0.6, 0.9, n));
    lit *= (1.0 - 0.5 * uGloom) * (1.0 - 0.3 * uRain);
    // 閃電從雲裡面把雲照亮：薄的地方透出來特別亮、厚的地方還是暗的，一瞬間看得出雲的厚薄
    lit += vec3(0.62, 0.68, 0.95) * uFlash * 0.38 * pow(max(dot(d, uFlashDir), 0.0), 3.0) * (1.0 - 0.75 * smoothstep(0.5, 0.8, n));
    c = mix(c, lit, dens * 0.92);
  }
  if (oct >= 5 && d.y > -0.03 && d.y < 0.5 && paint < 0.995) {
    // 夏天的積雨雲：從地平線往上堆，有的方向堆得特別高；頂端亮白、底部藍灰、朝太陽的一側更亮
    vec2 ap = normalize(d.xz + 1e-5) * 2.3;
    float tower = fbm(ap + 3.0, 3);
    float top = 0.035 + 0.30 * smoothstep(0.40, 0.72, tower);
    float billow = fbm(ap * 5.0 + vec2(d.y * 11.0, -d.y * 7.0) + uTime * 0.0015, 4);
    float cum = smoothstep(0.014, -0.014, d.y - top * (0.55 + 0.9 * billow)) * smoothstep(-0.03, 0.02, d.y);
    float hgt = clamp(d.y / max(top, 0.01), 0.0, 1.0);
    float sunSide = 0.5 + 0.5 * dot(normalize(d.xz + 1e-5), normalize(uSunDir.xz + 1e-5));
    vec3 ccol = mix(vec3(0.60, 0.69, 0.87), vec3(1.0, 0.99, 0.95), smoothstep(0.15, 0.7, hgt * 0.7 + (billow - 0.45) * 0.9 + 0.25 * sunSide));
    ccol = ccol * SKY_AMB * (1.0 - 0.62 * uGloom) * (1.0 - 0.3 * uRain) + vec3(1.0, 0.45, 0.15) * uDusk * 0.25 * sunSide * (1.0 - 0.9 * uGloom);   // 天陰下來就沒有夕陽把它染紅
    c = mix(c, ccol, cum * 0.96 * (1.0 - paint));
  }
#ifdef PAINT_SKY
  if (paint > 0.004 && d.y > -0.02) {
    // 畫好的積雲：只有幾個平塗的顏色——照到太陽的白、半亮、背光的藍灰、雲底的暖灰，交界都是乾淨的線
    vec3 q = vec3(d.x * uPaint.y - d.z * uPaint.z, d.y, d.x * uPaint.z + d.z * uPaint.y);
    vec4 cm = textureCube(uCloudMap, q);
    float a = smoothstep(0.32, 0.60, cm.a) * smoothstep(-0.012, 0.012, d.y);   // 圖放大了邊緣會糊：收成一條利落的邊
    if (a > 0.0) {
      vec3 n = cm.rgb * 2.0 - 1.0;
      n = normalize(vec3(n.x * uPaint.y + n.z * uPaint.z, n.y, n.z * uPaint.y - n.x * uPaint.z));
      vec3 sc = SUN_COL;
      float sm = max(sc.r, max(sc.g, sc.b));
      vec3 tint = sm > 0.001 ? sc / sm : vec3(1.0);   // 太陽（月亮）光的顏色：黃昏是橘的
      float s = max(dot(d, uSunDir), 0.0);
      float ndl = dot(n, uSunDir);
      float litK = smoothstep(-0.03, 0.06, ndl - 0.10);    // 背光 → 半亮
      float fullK = smoothstep(0.44, 0.54, ndl);            // 半亮 → 全亮（正對著太陽的那幾塊）
      float under = smoothstep(-0.45, -0.80, n.y);
      vec3 amb = SKY_AMB * (1.0 - 0.3 * uRain);
      float glow = uDusk * (1.0 - uGloom);                  // 朝霞、晚霞：受光面自己發亮的橘粉色
      vec3 top = vec3(1.0, 0.99, 0.96) * mix(vec3(1.0), tint, 0.45 + 0.3 * uDusk) * amb + vec3(1.0, 0.60, 0.40) * glow * 0.42 + SUN_COL * pow(s, 8.0) * 0.18;
      vec3 shade = vec3(0.57, 0.68, 0.91) * amb;
      vec3 belly = mix(vec3(0.76, 0.76, 0.84), vec3(0.95, 0.66, 0.56), uDusk) * amb + vec3(0.9, 0.42, 0.34) * glow * 0.16;   // 雲底：白天是暖灰，黃昏被低低的太陽染成粉橘
      vec3 cc = mix(mix(shade, belly, under), mix(mix(shade, top, 0.62), top, fullK), litK * (1.0 - under));
      // 越靠近地平線的雲越遠：淡進天色裡，才有一層一層往後退的感覺
      cc = mix(c, cc, 0.50 + 0.50 * smoothstep(0.0, 0.22, d.y));
      c = mix(c, cc, a * paint);
      gCloud = a * paint;
    }
  }
#endif
  if (oct >= 5 && uRain > 0.02 && d.y > -0.03 && d.y < 0.55) {
    // 遠處的雨幕：雲底垂下來一道一道灰濛濛的雨簾，有的方向下得大、有的方向稀，被風吹得斜斜的
    vec2 ap = normalize(d.xz + 1e-5);
    float where = smoothstep(0.34, 0.64, fbm(ap * 1.7 + 11.0 + uTime * 0.003, 3));
    float str = fbm(ap * 13.0 + vec2(d.y, -d.y) * 2.5 + vec2(0.0, uTime * 0.02), 3);
    // 人就在雨裡面：靠近地平線的地方全是雨，遠方的雲和島都糊成一片（顏色跟遠景的霧一致）；往上才看得出一道一道的雨簾
    float low = smoothstep(0.26, 0.02, d.y);
    float shaft = (0.25 + 0.75 * where) * smoothstep(0.3, 0.7, str) * smoothstep(0.6, 0.12, d.y);
    float veil = uRain * max(0.92 * low, 0.7 * shaft) * smoothstep(-0.03, 0.01, d.y);
    vec3 vc = skyGradient(normalize(vec3(d.x, 0.02, d.z))) * mix(0.62, 1.0, mix(str, 1.0, low * low));
    c = mix(c, vc, veil);
  }
  return c;
}

vec3 skyColor(vec3 d) {
  float s = max(dot(d, uSunDir), 0.0);
  vec3 c = skyBase(d, 5);
  return c + SUN_COL * pow(s, 1200.0) * 14.0 * (1.0 - gCloud);
}

// 雲在海面與陸地上的影子（固定在世界座標，隨雲飄移）
float cloudShadow(vec2 xz) {
  vec2 hit = xz + uSunDir.xz / max(uSunDir.y, 0.15) * 2500.0;
  float n = fbm(hit / 2500.0 * 1.15 + uCloudT, 2);
  return mix(1.0 - 0.5 * smoothstep(0.47, 0.74, n), 0.45, uGloom);
}

uniform float uReflPass;   // 正在畫倒影時為 1
uniform float uReflY;      // 那面鏡子的高度（海面 0；碼頭積水的倒影是碼頭的高度）

// 燈塔的光束掃到的地方：兩道光往相反方向照，各是一個細長的扇形
uniform vec4 uBeam;        // (燈塔 x, z, 光束方向 x, z)
uniform float uBeamOn;     // 亮度（白天是 0）
float beamSweep(vec2 xz) {
  if (uBeamOn <= 0.0) return 0.0;
  vec2 bd = xz - uBeam.xy;
  float bl = length(bd);
  float ca = abs(dot(bd / max(bl, 1.0), uBeam.zw));
  return uBeamOn * smoothstep(0.9982, 0.9997, ca) * smoothstep(35.0, 120.0, bl) * exp(-bl / 240.0);
}

// ---- 水下 ----
uniform float uUnder;      // 鏡頭在水面下時為 1
uniform float uCamDepth;   // 鏡頭在水面下多深（公尺）

vec3 underFogCol() {
  return vec3(0.012, 0.17, 0.22) * (0.35 + 0.8 * max(uSunDir.y, 0.0)) * max(uAmbient.g, 0.10) * exp(-uCamDepth / 45.0);
}

vec3 applyUnderFog(vec3 col, vec3 world) {
  float dist = length(world - cameraPosition);
  return mix(underFogCol(), col, exp(-dist / 28.0));
}

vec3 applyFog(vec3 col, vec3 world) {
  vec3 dv = world - cameraPosition;
  float dist = length(dv);
  vec3 dir = dv / dist;
  float f = 1.0 - exp(-dist * dist * (${(HAZE * HAZE).toExponential(3)} * uHazeK * uHazeK + uRain * ${(RAIN_HAZE * RAIN_HAZE).toExponential(3)}) - dist * uFog / 170.0);   // 平常是遠景的薄霧；起霧時一兩百公尺外就看不清
  return mix(col, mix(skyGradient(normalize(vec3(dir.x, 0.02, dir.z))), vec3(0.70, 0.74, 0.78) * uAmbient, uFog), f);
}
`;

// 海床高度與避浪係數：地圖範圍外一律當成深海
const bed = /* glsl */ `
uniform sampler2D uBed;
uniform sampler2D uShelter;
uniform int uN;
uniform float uL;

float bedAt(vec2 xz) {
  float n = float(uN);
  vec2 g = clamp((xz / uL + 0.5) * n - 0.5, vec2(0.0), vec2(n - 1.001));
  ivec2 p = ivec2(floor(g));
  vec2 f = g - vec2(p);
  ivec2 q = min(p + 1, ivec2(uN - 1));
  float b = mix(mix(texelFetch(uBed, p, 0).r, texelFetch(uBed, ivec2(q.x, p.y), 0).r, f.x),
                mix(texelFetch(uBed, ivec2(p.x, q.y), 0).r, texelFetch(uBed, q, 0).r, f.x), f.y);
  vec2 o = abs(xz) - uL * 0.5;
  return mix(b, ${SEA_FLOOR.toFixed(1)}, smoothstep(-40.0, 0.0, max(o.x, o.y)));
}

// 港內與島的背風面接近 0，開闊海面為 1
float shelterAt(vec2 xz) { return textureLod(uShelter, clamp(xz / uL + 0.5, 0.0, 1.0), 0.0).r; }
`;

// 岸邊的浪：從岸外幾十公尺開始，一道一道朝著岸捲過來，越靠岸越陡，破成白沫，沖上沙灘再退回去。
// 海面、地形（濕沙）、淺水模擬用同一組函式，位置才對得上。這一段只有算式，不取貼圖
export const shoreWaves = /* glsl */ `
float shNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 k = vec2(127.1, 311.7);
  vec4 h = fract(sin(vec4(dot(i, k), dot(i + vec2(1.0, 0.0), k), dot(i + vec2(0.0, 1.0), k), dot(i + vec2(1.0, 1.0), k))) * 43758.5453);
  return mix(mix(h.x, h.y, f.x), mix(h.z, h.w, f.x), f.y);
}
float shHash(float n) { return fract(sin(n * 91.345 + 1.7) * 47453.5453); }
// 泡沫的網紋：水面上一顆一顆的圓洞（泡泡破掉的地方），洞和洞之間留下來的就是連成網的白沫。
// 回傳離最近的洞的中心多遠：比洞的半徑大的地方是白沫。洞越大，白沫越細、最後斷成一小塊一小塊。t：洞慢慢游動
float foamNet(vec2 p, float t) {
  p += 0.3 * vec2(shNoise(p * 0.6 + 3.1), shNoise(p * 0.6 + 8.4));   // 整張網微微扭曲，洞才不會排得太整齊
  vec2 i = floor(p), f = fract(p);
  float f1 = 9.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 h = fract(sin(vec2(dot(i + g, vec2(127.1, 311.7)), dot(i + g, vec2(269.5, 183.3)))) * 43758.5453);
      vec2 o = g + 0.5 + 0.36 * sin(t + 6.2832 * h) - f;
      f1 = min(f1, dot(o, o) * (0.75 + 0.5 * h.x));   // 洞有大有小
    }
  }
  return sqrt(f1);
}
// 白沫的網：大洞之間還有小洞，洞的大小才不會都一樣。hole：洞的半徑（越大白沫越細、越碎）。回傳 0–1，1 = 白沫
float foamLace(vec2 p, float t, float hole) {
  return smoothstep(0.0, 0.07, min(foamNet(p, t) - hole, foamNet(p * 2.3 + 5.0, t * 1.3) - hole * 0.85));
}
// 浪的相位隨離岸距離怎麼變：越靠岸浪越密、走得越慢（岸外 40 公尺約 14 公尺一道，岸邊約 5 公尺一道）
float shK(float s) { return 28.56 * log(5.0 + 0.22 * s); }
const float SH_K0 = 45.97;   // shK(0)
// 這段海岸的浪打到第幾拍：約 5 秒一道，沿著海岸錯開，浪頭不會跟海岸線完全平行，也不會整條海岸同時漲退
// （兩層：大的一層讓整段海岸先後到，小的一層讓同一道浪線彎彎曲曲，不是一條跟海岸平行的弧）
float shorePhase(vec2 xz, float t) { return t * 1.25 + 6.0 * shNoise(xz * 0.012) + 2.4 * shNoise(xz * 0.045 + 7.3); }
// 這裡的浪有多大：港內與背風面只是輕輕拍岸
float shoreExpo(float shelter, float scale) { return clamp(shelter * scale / 1.3, 0.18, 2.3); }
// 今天的風浪有多大（岸邊用）：平常跟著風力，颱風時再放大
#define SHORE_SEA (${SEA_LV.shore.toFixed(2)} * uWaveScale + ${SEA_LV.shoreStorm.toFixed(2)} * uStorm * uSurge)
// 這一拍的浪頭到岸之後過了多久（0–1）：0 = 剛到，接著往上沖，然後慢慢退
float swashAge(float ph) { return fract((ph + SH_K0) / 6.2832 - 0.25); }
// 沖上岸的水有多高（公尺）：上得快、退得慢；每一道浪沖的高度不一樣
float runup(float ph, float expo) {
  float c = (ph + SH_K0) / 6.2832 - 0.25;
  float a = fract(c);
  float up = smoothstep(0.0, 0.2, a) * (1.0 - smoothstep(0.2, 0.92, a));
  return (0.05 + 0.45 * up * (0.75 + 0.5 * shHash(floor(c)))) * expo;
}
// 沖上沙灘的水，前緣不是一條平滑的線：有的地方多伸出去一舌、有的地方縮回來（回傳高度差，公尺），慢慢沿著岸邊移動
float swashLobe(vec2 xz, float t) { return 0.10 * (shNoise(xz * 0.33 + vec2(2.7 + t * 0.04, 0.0)) - 0.5) + 0.04 * (shNoise(xz * 0.9 + vec2(6.1, t * 0.07)) - 0.5); }
// 往岸上捲的浪。s：離岸幾公尺；ph：shorePhase()。
// 回傳 (浪高, 破了沒 0–1, 在這道浪裡的位置 0–1（0.5 是浪頭，小於 0.5 是朝岸的那一面）, 這一段浪頭的大小)；pre：快要破了（浪頭開始冒白）
vec4 swell(float s, float ph, vec2 xz, float expo, out float pre) {
  float th = (shK(s) + ph) / 6.2832;
  float n = floor(th), f = th - n;
  float rn = shHash(n);
  float sb = 8.0 + 5.0 * rn + 6.0 * shNoise(xz * 0.05 + n * 2.1);   // 這道浪在離岸多遠的地方破（沿著海岸各段不一樣：有的地方先破）
  float along = 0.5 + 0.65 * shNoise(xz * 0.035 + n * 5.3) + 0.35 * shNoise(xz * 0.11 + n * 3.1);   // 同一道浪沿著海岸有高有低（大段、小段各一層）
  float fc = mix(0.25, 0.5, smoothstep(sb * 0.6, 40.0, s));   // 越靠岸，朝岸的那一面越陡
  float w = f < fc ? 0.5 * f / fc : 0.5 + 0.5 * (f - fc) / (1.0 - fc);
  float p = 0.5 - 0.5 * cos(6.2832 * w);
  float env = pow(smoothstep(50.0, sb, s), 1.5) * (0.18 + 0.82 * smoothstep(0.0, sb, s));   // 岸外 50 公尺才慢慢隆起來；破了之後一路矮下去
  pre = 1.0 - smoothstep(sb + 1.0, sb + 9.0, s);
  return vec4(0.55 * expo * (0.7 + 0.5 * rn) * along * env * p * p, 1.0 - smoothstep(sb - 3.0, sb + 1.0, s), w, along);
}
`;

const shore = /* glsl */ `
uniform sampler2D uShore;   // 離岸距離（公尺，最多 96）
float shoreDist(vec2 xz) { return textureLod(uShore, clamp(xz / uL + 0.5, 0.0, 1.0), 0.0).r; }
${shoreWaves}
`;

// 淺水模擬的結果：鏡頭附近一塊方形範圍。範圍邊緣漸漸交還給上面那組公式
const swe = /* glsl */ `
uniform sampler2D uSwe;      // (水深, 水面坡度 x, 水面坡度 z, 泡沫)
uniform sampler2D uSweWet;   // 濕沙
uniform vec2 uSweOrigin;
uniform float uSweSize;
uniform float uSweOn;
#ifdef SWE_ON
float sweWin(vec2 xz, out vec2 suv) {
  suv = (xz - uSweOrigin) / uSweSize;
  vec2 e = min(suv, 1.0 - suv);
  return uSweOn * smoothstep(0.0, 0.07, min(e.x, e.y));
}
#else
// 淺水模擬停用中（main.js 的 SWE_ON）：固定回傳 0，編譯器會把用到它的取樣和算式整段丟掉，海面和地形的程式都短一截
float sweWin(vec2 xz, out vec2 suv) { suv = vec2(0.0); return 0.0; }
#endif
`;

// 捲浪與退潮（數字與 weather.js 的 CURL、EBB 相同）。海面和浪花（skyfx.js）共用，所以時間用參數傳進來
const f3 = (v) => v.toFixed(3);
const TOPU = 1 / Math.cosh(CURL.aU) ** 2, TOPL = 1 / Math.cosh(CURL.aL) ** 2;   // 捲舌上面、底面起點的高度（佔浪高的比例）
export const tsuExtra = /* glsl */ `
// 浪頭的這一段捲得多兇（0–1）。外海不捲（那裡只是一道矮矮的隆起）；靠近島、水變淺，浪堆高了才開始破：
// 先是比較高的那幾段，沿著浪線一陣一陣地輪流；再近一點整道浪撐不住，全部往前倒；再往裡就垮成一道白水，不捲了
float tsuBreak(float l, float br, float tK, float time) {
  float pulse = smoothstep(0.15, 0.75, 0.5 + 0.5 * sin(time * 0.45 + l * 0.018));
  return max(br * pulse * smoothstep(0.95, 0.80, tK), smoothstep(0.85, 0.60, tK)) * smoothstep(0.30, 0.50, tK);
}
// 巨浪到這裡多高（佔 H 的比例；跟 weather.js 的 tsuHK() 一致）：外海只是一道矮矮的隆起，靠近陸地才堆高，破了之後往岸上遞減
float tsuHK(float p) {
  if (p <= ${f3(TSU_H.shore)}) return p;
  if (p <= ${f3(TSU_H.at)}) return ${f3(TSU_H.shore)} + ${f3(TSU_H.peak - TSU_H.shore)} * smoothstep(${f3(TSU_H.shore)}, ${f3(TSU_H.at)}, p);
  return ${f3(TSU_H.peak)} - ${f3(TSU_H.peak - TSU_H.far)} * smoothstep(${f3(TSU_H.at)}, 0.92, p);
}
// 浪頂被往前推了幾公尺（浪的正面跟著被推成陡壁）
float tsuLeanS(float B, float H) { return ${f3(CURL.lean * CURL.a0 * TSU.wf)} * B * H; }
// 捲起來之後，這道浪的斷面上「離浪頂 a」的那一點跑到哪：回傳 (往前幾公尺, 高度)，原點在浪頂原本的位置
// a：離浪頂多遠 ÷ 浪寬（正的是正面）；Hc：這一段的浪高；B：捲得多兇；Bw：捲舌伸出去幾成（0 = 只有陡壁，還沒往前拋）
// 浪頂後面一小段的水面是捲舌的上面，前面一小段是底面，兩條都是自由落體的拋物線，同時落到尖端；再往下是浪壁
vec2 tsuCurlPos(float a, float Hc, float B, float Bw, float H) {
  float wf = ${f1(TSU.wf)} * H, wb = ${f1(TSU.wb)} * H, S = tsuLeanS(B, H);
  float c = 1.0 / cosh(clamp(a, -12.0, 12.0)), top = c * c;
  if (a < -${f3(CURL.aU)}) return vec2(a * wb + (S + Bw * ${f3(CURL.aU)} * wb) * pow(top / ${f3(TOPU)}, 1.5), Hc * top);
  float T = sqrt(${f3(2 * CURL.fall / CURL.g)} * max(Hc, 0.1));
  vec2 tip = vec2(S + ${f1(CURL.u)} * T, Hc * ${f3(TOPU)} - ${f1(CURL.g / 2)} * T * T);
  if (a < 0.0) {
    float tau = T * (1.0 + a / ${f3(CURL.aU)});
    return vec2(S + (1.0 - Bw) * a * wb + Bw * ${f1(CURL.u)} * tau, mix(Hc * top, Hc * ${f3(TOPU)} - ${f1(CURL.g / 2)} * tau * tau, Bw));
  }
  float x = 1.0 - min(a / ${f1(CURL.a0)}, 1.0);
  vec2 P = vec2(a * wf + S * x * sqrt(x), Hc * top);
  if (a < ${f3(CURL.aL)}) {
    vec2 R = vec2(${f3(CURL.aL)} * wf + S * ${f3((1 - CURL.aL / CURL.a0) ** 1.5)}, Hc * ${f3(TOPL)});   // 浪壁的頂端：捲舌的底面從這裡出發
    float tau = T * (1.0 - a / ${f3(CURL.aL)});
    vec2 v = (tip - R) / T + vec2(0.0, ${f1(CURL.g / 2)} * T);
    P = mix(P, R + v * tau - vec2(0.0, ${f1(CURL.g / 2)} * tau * tau), Bw);
  }
  return P;
}
// 海嘯到之前岸邊的海水先退下去（公尺，負的）
float tsuEbb(vec2 xz, float tK, vec4 tsu) {
  if (tK > ${f1(EBB.k0)}) return 0.0;
  float s = dot(xz, tsu.xy) - tsu.z, e = 0.0;
  for (int i = 0; i < 3; i++) {
    float q = s + float(i) * ${TSU.gap.toFixed(1)};
    if (q > 0.0) e = max(e, smoothstep(${f1(EBB.n0)}, ${f1(EBB.n1)}, q) * (i == 0 ? smoothstep(${f1(EBB.far)}, ${f1(EBB.full)}, q) : ${f1(EBB.between)} * smoothstep(${f1(EBB.g0)}, ${f1(EBB.g1)}, q)));
  }
  return -${EBB.depth.toFixed(3)} * tsu.w * e * smoothstep(${f1(EBB.k0)}, ${f1(EBB.k1)}, tK);
}
`;

const waveDecl = /* glsl */ `
uniform sampler2D uDisp0;
uniform sampler2D uDisp1;
uniform vec3 uPatch;      // 三層級聯各自的鋪面邊長（公尺）
uniform float uTexN;
uniform float uWaveScale;
uniform sampler2D uDanger;   // 離陸地越遠越接近 1；島的周圍與港口是 0
uniform float uStorm;        // 風暴強度：外海的浪放大 (1 + uStorm) 倍
uniform vec4 uTsu;           // 巨浪：(前進方向 x, z, 浪頭位置, 高度)；高度 0 = 沒有
varying vec3 vTsu;           // 巨浪在這裡的 (高度, 斜率 x, 斜率 z)

float dangerAt(vec2 xz) { return textureLod(uDanger, clamp(xz / uL + 0.5, 0.0, 1.0), 0.0).r; }
uniform float uSurge;        // 颱風：連島邊的浪也變大（港內靠避浪係數保持平靜）
// 這裡的浪高倍率（跟 weather.js 的 seaLevel() 一致）：外海比島邊大，迎風面一路大到岸邊（shel 接近 1），
// 背風面和港內才小；風暴是另外加上去的，只在外海（颱風時連島邊也有）
float waveScale(float danger, float shel) {
  return min(uWaveScale * (1.0 + ${SEA_LV.far.toFixed(2)} * max(danger, smoothstep(0.8, 0.98, shel))) + ${SEA_LV.storm.toFixed(2)} * uStorm * mix(danger, 1.0, uSurge), ${SEA_LV.cap.toFixed(2)});
}
uniform vec2 uWaveRot;       // 風向比原本轉了多少（cos, sin）：整片風浪跟著轉
uniform float uTide;         // 潮汐：現在的海平面（公尺）
vec2 toWave(vec2 p) { return vec2(p.x * uWaveRot.x + p.y * uWaveRot.y, p.y * uWaveRot.x - p.x * uWaveRot.y); }
vec2 fromWave(vec2 d) { return vec2(d.x * uWaveRot.x - d.y * uWaveRot.y, d.x * uWaveRot.y + d.y * uWaveRot.x); }
${swellLib}
// 長浪在外海才有，靠近島就消掉；島的背風面小很多
float swellK(float danger, float shel) { return uSwell * smoothstep(0.15, 0.85, danger) * (0.35 + 0.65 * shel); }
uniform vec4 uVortex[3];     // 漩渦與水龍捲：(x, z, 強度, 種類：1 漩渦、2 水龍捲)
// 大漩渦的水面凹下去多深（公尺，正的；還沒乘上強度）。r2：離中心距離的平方。
// 蘭金渦的自由液面：核心裡是一個拋物面的碗，核心外跟距離平方成反比
float whirlDepth(float r2) {
  float rc2 = ${WRC} * ${WRC};
  return ${WD} * (r2 < rc2 ? 1.0 - r2 / (2.0 * rc2) : rc2 / (2.0 * r2)) * smoothstep(${WFAR}, ${WFAR2}, sqrt(r2));
}

// 巨浪：三道前緣陡、背面緩的水牆，浪腳前面的海面先陷下去；浪線高低、前後都參差（數字與 weather.js 的 TSU、tsuCrest 相同）
// 回傳 (高度, 斜率 x, 斜率 z)。minW：網格比浪還粗的遠處把浪畫寬一點，免得浪頭閃爍
// info：離最近那道浪頭多遠（÷ 浪寬，正的是浪的正面）、浪頂程度 0–1、這一段有沒有在破 0–1、那道浪的高度比例
uniform vec2 uTsu2;          // (這一次巨浪的亂數, 保留)
uniform sampler2D uTsuK;     // 巨浪到了這裡還剩幾成高：外海十成，岸邊一成多，沖上岸後往內陸遞減
float tsuKAt(vec2 xz) { return textureLod(uTsuK, clamp(xz / uL + 0.5, 0.0, 1.0), 0.0).r; }
vec3 tsuWave(vec2 xz, float minW, out vec4 info) {
  float H = uTsu.w;
  vec2 dir = uTsu.xy, perp = vec2(dir.y, -dir.x);
  float s = dot(xz, dir) - uTsu.z, l = dot(xz, perp);
  float wf = max(${f1(TSU.wf)} * H, minW), wb = max(${f1(TSU.wb)} * H, minW), wt = ${f1(TSU.tW)} * wf;
  vec3 K = vec3(${TSU.k.map((v) => v.toFixed(2)).join(', ')});
  vec3 r = vec3(0.0);
  info = vec4(99.0, 0.0, 0.0, 0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float amp = 1.0 + 0.16 * sin(l * 0.009 + 1.7 * fi + uTsu2.x) + 0.09 * sin(l * 0.023 + 2.9 * fi + 2.0 * uTsu2.x);
    float a1 = l * 0.0052 + 2.3 * fi + 1.3 * uTsu2.x, a2 = l * 0.0151 + 4.1 * fi + 0.7 * uTsu2.x;
    float q = s + fi * ${TSU.gap.toFixed(1)} + 26.0 * sin(a1) + 10.0 * sin(a2);
    float dshift = 0.1352 * cos(a1) + 0.151 * cos(a2);
    float w = q > 0.0 ? wf : wb;
    float a = clamp(q / w, -12.0, 12.0), c = 1.0 / cosh(a), c2 = c * c;
    float b = clamp((q - ${f1(TSU.tAt)} * wf) / wt, -12.0, 12.0), t = 1.0 / cosh(b), t2 = t * t;
    float dq = K[i] * amp * (-2.0 * c2 * tanh(a) / w + ${f1(TSU.trough)} * 2.0 * t2 * tanh(b) / wt);
    r += vec3(K[i] * amp * (c2 - ${f1(TSU.trough)} * t2), dq * (dir + dshift * perp));
    if (abs(a) < abs(info.x)) info = vec4(a, c2, smoothstep(0.98, 1.14, amp + 0.06 * sin(l * 0.061 + 5.0 * fi)), K[i] * amp);
  }
  return r * H;
}
${tsuExtra}
varying vec3 vCurlN;         // 捲浪：浪的大形狀在這裡的法線（捲舌的底面是朝下的，不能用高度圖的斜率算）
varying vec2 vCurl;          // (捲舌伸出去幾成, 這裡的法線要用 vCurlN 的比重)
// 海面的網格往浪頂附近擠：捲起來的那一段才有夠多的頂點、形狀才圓滑。回傳沿著浪前進的方向要挪幾公尺
float tsuPull(vec2 xz) {
  vec2 dir = uTsu.xy, perp = vec2(dir.y, -dir.x);
  float s = dot(xz, dir) - uTsu.z, l = dot(xz, perp), b = ${f3(0.46 * TSU.wf)} * uTsu.w, r = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float q = s + fi * ${TSU.gap.toFixed(1)} + 26.0 * sin(l * 0.0052 + 2.3 * fi + 1.3 * uTsu2.x) + 10.0 * sin(l * 0.0151 + 4.1 * fi + 0.7 * uTsu2.x);
    r += tanh(clamp(q / b - 0.17, -8.0, 8.0));
  }
  return ${f3(1 - 1 / CURL.dense)} * b * r;
}
`;

const vortexFn = /* glsl */ `
// 漩渦讓水面凹成漏斗，水龍捲腳下的水面隆起（數字與 weather.js 的 VORTEX 相同）
// 回傳 (高度, 風浪在這裡剩幾成)：漏斗裡的水被捲著走，風浪被拉平
vec2 vortexY(vec2 xz) {
  vec2 h = vec2(0.0, 1.0);
  for (int i = 0; i < 3; i++) {
    vec4 v = uVortex[i];
    if (v.z <= 0.0) continue;
    vec2 dd = xz - v.xy;
    float r2 = dot(dd, dd);
    if (v.w < 1.5) {
      h.x -= v.z * whirlDepth(r2);
      h.y *= 1.0 - 0.8 * v.z * smoothstep(130.0, 35.0, sqrt(r2));
    } else h.x += v.z * ${SH} * exp(-r2 / ${SW2});
  }
  return h;
}
`;

export const waterVert = /* glsl */ `
#ifdef DIAG
varying vec4 vDiagOut;
#endif
${bed}
${waveDecl}
${shore}
${swe}
uniform vec2 uCenter;
uniform vec2 uMeshRot;   // 海面的網格轉了多少（cos, sin）：遠處只鋪鏡頭看得到的那個方向，整張網格轉過去對準
uniform float uTime;

varying vec3 vWorld;
varying vec2 vP0;
varying float vWaveH;

${vortexFn}
// 手機（Adreno）的驅動程式連結不了完整版的海面頂點程式（太複雜，連結失敗、海面整片畫不出來）。
// 那種機器改用拆開的兩版（WATER_SPLIT）：平常沒有巨浪的程式；巨浪來的時候（TSU_ON）換成有巨浪、但岸邊不捲浪也不沖上沙灘的程式（反正都被巨浪淹過去了）
#if !defined(WATER_SPLIT) || defined(TSU_ON)
  #define W_TSU 1
#endif
#if !defined(WATER_SPLIT) || !defined(TSU_ON)
  #define W_SWL 1
#endif
void main() {
  vec2 xz = vec2(position.x * uMeshRot.x - position.z * uMeshRot.y, position.x * uMeshRot.y + position.z * uMeshRot.x) + uCenter;
#ifdef W_TSU
  if (uTsu.w > 0.0) xz -= uTsu.xy * tsuPull(xz);
#endif
  // 大漩渦：海面的網格往漩渦中心擠，漏斗的壁才圓滑
  for (int i = 0; i < 3; i++) {
    vec4 v = uVortex[i];
    if (v.z <= 0.0 || v.w > 1.5) continue;
    vec2 dd = xz - v.xy;
    xz = v.xy + dd * (1.0 - 0.62 * exp(-length(dd) / 70.0));
  }
  vec2 vY = vortexY(xz);
  float danger = dangerAt(xz);
  float bedH = bedAt(xz), shel = shelterAt(xz);
  float depthFade = smoothstep(0.3, 8.0, -bedH) * waveScale(danger, shel) * shel;
  // 依這裡的網格間距挑 mip 層：網格越粗，取越模糊的位移，避免遠處鋸齒與抖動
  float spacing = 0.024 * length(position.xz) + 0.3;
  float lod0 = log2(max(spacing * 1.6 * uTexN / uPatch.x, 1.0));
  float lod1 = log2(max(spacing * 1.6 * uTexN / uPatch.y, 1.0));
#ifdef WLOD0
  lod0 = 0.0; lod1 = 0.0;   // 測試（?wlod0）：不用縮小版的浪高圖
#endif
  // 淺水模擬管得到的地方：最大那一層 FFT 的浪交給模擬去算（它會自己變陡、破碎、沖上岸）
  vec2 suv;
  float win = sweWin(xz, suv);
  float hS = 0.0;
  if (win > 0.0) {
    // 依這裡的網格間距取四點平均：浪頭比網格還窄的時候，頂端才不會變成鋸齒
    vec2 o = vec2(spacing * 0.55 / uSweSize, 0.0);
    hS = 0.25 * (textureLod(uSwe, suv + o.xy, 0.0).r + textureLod(uSwe, suv - o.xy, 0.0).r
               + textureLod(uSwe, suv + o.yx, 0.0).r + textureLod(uSwe, suv - o.yx, 0.0).r);
  }
  // 巨浪：外海是整道水牆，靠岸變矮，沖上岸、淹進港口
  vec4 ti;
  vec3 tw = vec3(0.0);
  vec2 tCurl = vec2(0.0);
  vCurlN = vec3(0.0, 1.0, 0.0);
  vCurl = vec2(0.0);
#ifdef W_TSU
  if (uTsu.w > 0.0) {
    float tK = tsuKAt(xz);
    tw = tsuWave(xz, spacing * 1.5, ti) * tsuHK(tK);
    tw.x += tsuEbb(xz, tK, uTsu);
    // 正在捲的那幾段：海面本身往前捲（浪壁變陡、浪頂的水拋出去再落下）。遠到網格太粗的地方只留陡壁
    float B = tsuBreak(dot(xz, vec2(uTsu.y, -uTsu.x)), ti.z, tK, uTime), a = ti.x;
    if (B > 0.0 && abs(a) < 4.0) {
      float Bw = smoothstep(0.25, 0.85, B) * smoothstep(22.0, 12.0, spacing), Hc = ti.w * uTsu.w * tsuHK(tK);
      vec2 dP = tsuCurlPos(a + 0.012, Hc, B, Bw, uTsu.w) - tsuCurlPos(a - 0.012, Hc, B, Bw, uTsu.w);
      tCurl = tsuCurlPos(a, Hc, B, Bw, uTsu.w) - vec2(a * (a < 0.0 ? ${f1(TSU.wb)} : ${f1(TSU.wf)}) * uTsu.w, Hc * ti.y);
      vCurlN = vec3(-dP.y * uTsu.x, dP.x, -dP.y * uTsu.y);
      vCurl = vec2(Bw, smoothstep(0.0, 0.2, B) * (1.0 - smoothstep(2.5, 4.0, abs(a))));
    }
  }
#endif
  vTsu = tw;
  // 巨浪的水位湧進來（或浪前海水退下去）的那幾秒，岸邊交還給整片海面去畫：淺水模擬不知道有這道浪
  win *= 1.0 - smoothstep(0.25, 1.2, abs(tw.x));

  float aS = win * (1.0 - smoothstep(3.0, 5.0, -bedH));
  vec2 wq = toWave(xz);
  vec3 d = textureLod(uDisp0, wq / uPatch.x, lod0).xyz * (1.0 - aS) + textureLod(uDisp1, wq / uPatch.y, lod1).xyz;
  d *= depthFade * vY.y;
  d.xz = fromWave(d.xz);
  // 颱風的長浪：整片海面一座一座地起伏（遠到網格比浪還粗的地方不抬，只留明暗）
  float swY = uSwell > 0.01 ? swellK(danger, shel) * longSwell(xz).x * smoothstep(70.0, 25.0, spacing) : 0.0;

  // 岸邊：一道道朝著岸捲過來的浪；水面隨著每一拍漲上沙灘、再退回去
  float ph = shorePhase(xz, uTime), expo = shoreExpo(shel, SHORE_SEA);
  float lift = runup(ph, expo) * (1.0 - smoothstep(0.0, 2.5, -bedH));
  float sd = shoreDist(xz), pre;
  // 網格比浪還粗的遠處不抬（那裡只畫浪花的線條）
#ifdef W_SWL
  float swl = sd < 66.0 ? swell(sd, ph, xz, expo, pre).x * smoothstep(6.0, 2.2, spacing) : 0.0;
#else
  float swl = 0.0;
  lift = 0.0;
#endif

  // 模擬範圍內：水面 = 海床 + 模擬出來的水深（略為墊高，薄薄一層水才不會被沙灘吃掉）
  // 周圍都是乾的陸地：把水面壓到地面下，省得白畫
  float shoreY = lift * (1.0 - win) + swl * (1.0 - aS) + aS * (bedH + hS + 0.03 - (hS <= 0.0 && bedH > 0.05 ? 1.0 : 0.0));
  // 測試（?wno=fsvtw）：單獨關掉海面高度的某一項，查手機上海面被抬高是哪一項造成的
#ifdef NO_F
  d = vec3(0.0);
#endif
#ifdef NO_S
  shoreY = 0.0;
#endif
#ifdef NO_V
  vY.x = 0.0;
#endif
#ifdef NO_T
  tw = vec3(0.0); tCurl = vec2(0.0);
#endif
#ifdef NO_W
  swY = 0.0;
#endif
  vec3 pos = vec3(xz.x + d.x + uTsu.x * tCurl.x, d.y + tw.x + tCurl.y + vY.x + swY + shoreY + uTide, xz.y + d.z + uTsu.y * tCurl.x);
  vP0 = xz;
  vWaveH = d.y;
#ifdef WFLAT
  pos.y = 0.0;   // 測試（?wflat）：海面強制放平
#endif
  vWorld = pos;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
#ifdef DIAG
  // 診斷（?diag）：用這段頂點程式本身算幾個點，畫進一排 6 格的貼圖（position.y 是第幾格）：
  // 偶數格 (海面高度, FFT 浪, 岸邊浪, 漩渦)，奇數格 (巨浪, 颱風長浪, 取第幾層縮小版, 網格間距)
  float dk = position.y;
  vDiagOut = mod(dk, 2.0) < 0.5 ? vec4(pos.y, d.y, shoreY, vY.x) : vec4(tw.x, swY, lod0, spacing);
  gl_Position = vec4((dk + 0.5) / 3.0 - 1.0, 0.0, 0.0, 1.0);
  gl_PointSize = 1.0;
#endif
}
`;

// 接收太陽的陰影（海面、地形、雜草共用）
const shadowRecv = /* glsl */ `
precision highp sampler2DShadow;
#ifndef SH_TAPS
  #define SH_TAPS 8
#endif
uniform sampler2DShadow uShadowMap;   // 太陽（月亮）的陰影貼圖
uniform mat4 uShadowMat;
uniform float uShadowOn;
uniform float uShadowTexel;
// 電腦版（SH_PLUS）：舊方向的那張（太陽換方向時新舊淡入淡出，uShadowFade 是舊的佔幾成）、近處高解析度的那兩張（新、舊）
#ifdef SH_PLUS
uniform sampler2DShadow uShadowMapOld, uShadowMapNear, uShadowMapNearOld;
uniform mat4 uShadowMatOld, uShadowMatNear, uShadowMatNearOld;
uniform float uShadowFade, uShadowNearOn, uShadowTexelNear;
#endif

// 一張陰影貼圖：1 = 照得到，0 = 在影子裡；edge：這一點在貼圖範圍裡多深（範圍外 0、邊緣漸漸到 1）
float shOne(sampler2DShadow map, mat4 M, vec3 wp, float texel, float ang, out float edge) {
  vec4 sc = M * vec4(wp, 1.0);
  vec3 p = sc.xyz / sc.w;
  edge = 0.0;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  p.z -= 0.00015;
  // 繞著一圈取幾個點平均（每個位置轉一個不同的角度）：範圍只有一格左右，蓋掉貼圖的鋸齒就好，影子的邊緣是利落的
  float sh = 0.0;
  // 畫質「手機」（LITE）：取樣點減半
#ifdef LITE
  const int SH_N = SH_TAPS / 2;
#else
  const int SH_N = SH_TAPS;
#endif
  for (int i = 0; i < SH_N; i++) {
    float r = sqrt((float(i) + 0.5) / float(SH_N)) * 1.1 * texel;
    float t = float(i) * 2.39996323 + ang;
    sh += texture(map, vec3(p.xy + r * vec2(cos(t), sin(t)), p.z));
  }
  vec2 e = min(p.xy, 1.0 - p.xy);
  edge = smoothstep(0.0, 0.07, min(e.x, e.y));   // 陰影範圍的邊緣漸漸淡出
  return smoothstep(0.22, 0.78, sh / float(SH_N));
}

#ifdef SH_PLUS
// 近處那張：3×3 格、中間重四周輕，不轉角度、不加雜訊、不拉陡（格子細，這樣邊緣最平順；跟 main.js 的 sunNearPCF 同一套）
float shNear(sampler2DShadow map, mat4 M, vec3 wp, float texel, out float edge) {
  vec4 sc = M * vec4(wp, 1.0);
  vec3 p = sc.xyz / sc.w;
  edge = 0.0;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  p.z -= 0.00015;
  vec2 t = vec2(texel);
  float s = texture(map, p) * 4.0;
  s += (texture(map, vec3(p.xy + vec2(t.x, 0.0), p.z)) + texture(map, vec3(p.xy - vec2(t.x, 0.0), p.z))
      + texture(map, vec3(p.xy + vec2(0.0, t.y), p.z)) + texture(map, vec3(p.xy - vec2(0.0, t.y), p.z))) * 2.0;
  s += texture(map, vec3(p.xy + t, p.z)) + texture(map, vec3(p.xy - t, p.z))
     + texture(map, vec3(p.xy + vec2(t.x, -t.y), p.z)) + texture(map, vec3(p.xy + vec2(-t.x, t.y), p.z));
  vec2 e = min(p.xy, 1.0 - p.xy);
  edge = smoothstep(0.0, 0.08, min(e.x, e.y));
  return s / 16.0;
}
#endif

// 這一點有沒有被樹、船、建築、山坡擋住陽光：1 = 照得到，0 = 在影子裡
float sunShadow(vec3 wp, vec3 n) {
  if (uShadowOn < 0.5) return 1.0;
  float ang = fract(sin(dot(wp.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  float e, e2;
  float s = shOne(uShadowMap, uShadowMat, wp + n * 0.04, uShadowTexel, ang, e);
#ifdef SH_PLUS
  if (uShadowFade > 0.001) s = mix(s, shOne(uShadowMapOld, uShadowMatOld, wp + n * 0.04, uShadowTexel, ang, e2), uShadowFade);
#endif
  s = mix(1.0, s, e);
#ifdef SH_PLUS
  // 近處：換成高解析度的那張（範圍邊緣跟遠的那張接起來）
  if (uShadowNearOn > 0.5) {
    float sn = shNear(uShadowMapNear, uShadowMatNear, wp + n * 0.015, uShadowTexelNear, e2);
    if (e2 > 0.0) {
      float e3;
      if (uShadowFade > 0.001) sn = mix(sn, shNear(uShadowMapNearOld, uShadowMatNearOld, wp + n * 0.015, uShadowTexelNear, e3), uShadowFade);
      s = mix(s, sn, e2);
    }
  }
#endif
  return s;
}
// 這一點在不在陰影貼圖涵蓋的範圍裡（1 = 在，邊緣漸漸到 0）。w：邊緣多寬的一段用來淡出（佔範圍的比例）
float shadowRange(vec3 wp, float w) {
  if (uShadowOn < 0.5) return 0.0;
  vec4 sc = uShadowMat * vec4(wp, 1.0);
  vec3 p = sc.xyz / sc.w;
  vec2 e = min(p.xy, 1.0 - p.xy);
  return p.z >= 1.0 ? 0.0 : smoothstep(0.0, w, min(e.x, e.y));
}
`;

export const waterFrag = /* glsl */ `
${common}
${bed}
${waveDecl}
${shore}
${swe}
uniform sampler2D uSlope0;
uniform sampler2D uSlope1;
uniform sampler2D uSlope2;
uniform sampler2D uFoamTex;
uniform vec3 uSlopeVar;
uniform float uPixelAngle;
uniform float uHs;
uniform vec4 uWake[16];   // (x, z, 產生時間, 強度)
uniform vec4 uWakeBox;    // 還看得到的航跡都在這個圓裡：(x, z, 半徑, 有沒有)。圓外的像素整段跳過
uniform vec4 uRip[24];    // 游泳的人推出來的波紋：(x, z, 產生時間, 強度)（swimfx.js）
uniform vec4 uSwimmer[4]; // 水裡的人：(x, z, 游的速度, 有沒有人)
uniform sampler2D uReflTex;
uniform mat4 uReflMat;
uniform float uReflOn;
uniform vec2 uShTri[6];   // 駕駛艙屋頂投在水面上的影子（兩個三角形）
${homeGlsl}
uniform vec4 uQuay[3];   // 岸壁、防波堤的矩形（港座標，用 homeLocal 轉）
uniform vec4 uHull[3];
uniform vec3 uHullSize[3];
uniform vec4 uShHull;     // 船身影子 (x, z, cos, sin)
uniform vec2 uShSize;     // 船身影子的半長、半寬
uniform vec3 uLamp[8];    // 晚上的燈：(x, z, 亮度)
uniform float uLampOn;    // 有沒有任何一盞燈亮著（白天整段跳過）

#define SH_TAPS 4
${shadowRecv}
// 離岸壁、防波堤的牆面多遠（公尺；在牆外是正的）
float quayDist(vec2 pw) {
  vec2 p = homeLocal(pw);
  float d = 1e3;
  for (int i = 0; i < 3; i++) {
    vec2 q = abs(p - 0.5 * (uQuay[i].xy + uQuay[i].zw)) - 0.5 * (uQuay[i].zw - uQuay[i].xy);
    d = min(d, length(max(q, 0.0)) + min(max(q.x, q.y), 0.0));
  }
  return d;
}
// 離最近一艘船的船身（水線那一圈）多遠（公尺；船外是正的）。dir：從船往外的方向
// 船身的輪廓是近似的：船頭那一半收尖，船尾那一半接近方的
float hullDist(vec2 p, out vec2 dir) {
  float d = 1e3;
  dir = vec2(0.0);
  for (int i = 0; i < 3; i++) {
    if (uHullSize[i].z < 0.5) continue;
    vec2 o = p - uHull[i].xy;
    if (abs(o.x) + abs(o.y) > 40.0) continue;
    vec2 l = vec2(dot(o, uHull[i].zw), dot(o, vec2(-uHull[i].w, uHull[i].z))) / uHullSize[i].xy;
    float px = l.x > 0.0 ? 2.0 : 5.0;
    float e = (pow(pow(abs(l.x), px) + pow(abs(l.y), px), 1.0 / px) - 1.0) * uHullSize[i].y;
    if (e < d) { d = e; dir = o / max(length(o), 0.1); }
  }
  return d;
}

float triIn(vec2 p, vec2 a, vec2 b, vec2 c) {
  float s = sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  float d1 = s * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / max(length(b - a), 1e-3);
  float d2 = s * ((c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x)) / max(length(c - b), 1e-3);
  float d3 = s * ((a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x)) / max(length(a - c), 1e-3);
  return smoothstep(-0.3, 0.4, min(d1, min(d2, d3)));
}

float boatShadow(vec2 p) {
  vec2 d = p - uShHull.xy;
  if (dot(d, d) > 90.0 * 90.0) return 1.0;
  float sh = max(triIn(p, uShTri[0], uShTri[1], uShTri[2]), triIn(p, uShTri[3], uShTri[4], uShTri[5]));
  vec2 l = vec2(dot(d, uShHull.zw), dot(d, vec2(-uShHull.w, uShHull.z)));
  vec2 q = abs(l) - uShSize;
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.9;
  sh = max(sh, smoothstep(0.5, -0.4, sd));
  return 1.0 - 0.8 * sh;
}

varying vec3 vWorld;
varying vec2 vP0;
varying float vWaveH;

vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(p.x * c - p.y * s, p.x * s + p.y * c); }
// 大漩渦水面上的白沫：不是一片一片的，是沿著雜訊的等高線畫出來的細絲（粗的一層、細的一層），有濃有淡
float whirlFoam(vec2 p) {
  float a = shNoise(p * 0.028), b = shNoise(p * 0.075 + 5.3), c = shNoise(p * 0.19 + 11.0);
  return pow(1.0 - abs(2.0 * a - 1.0), 5.0) * (0.55 + 0.45 * c) + 0.7 * pow(1.0 - abs(2.0 * b - 1.0), 5.0) * smoothstep(0.35, 0.6, a);
}
// 大塊的濃淡：白沫聚成幾條寬寬的帶子（順著水流被拉成旋臂），帶子之間是乾淨的水
float whirlArm(vec2 p) { return smoothstep(0.52, 0.74, 0.65 * shNoise(p * 0.0085 + 3.1) + 0.35 * shNoise(p * 0.021 + 8.0)); }

// 從水下往上看水面：臨界角內是折射進來的天空（斯涅爾窗），臨界角外是全反射
vec3 underSurface(vec3 N, vec3 V, float foam) {
  vec3 Nd = -N;
  if (dot(Nd, V) < 0.0) Nd = N;
  vec3 tir = underFogCol() * 1.35 + vec3(0.0, 0.025, 0.03);
  vec3 T = refract(-V, Nd, 1.33);
  vec3 c = tir;
  if (dot(T, T) > 0.0) {
    float Fr = 0.02 + 0.98 * pow(1.0 - clamp(dot(T, -Nd), 0.0, 1.0), 5.0);
    vec3 sky = skyColor(normalize(vec3(T.x, max(T.y, 0.02), T.z))) * vec3(0.78, 0.96, 1.0);
    c = mix(sky, tir, Fr);
  }
  c *= 1.0 - 0.55 * foam;   // 泡沫從下面看是遮光的暗影
  return applyUnderFog(c, vWorld);
}

void main() {
  float bedH = bedAt(vWorld.xz);
  float shel = shelterAt(vWorld.xz);
  float ph = shorePhase(vWorld.xz, uTime), expo = shoreExpo(shel, SHORE_SEA);
  // 淺水模擬範圍內用模擬出來的水深
  vec2 suv;
  float win = sweWin(vWorld.xz, suv);
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  // 巨浪：每個像素自己再算一次（比頂點內插出來的細，浪面的明暗和白沫才有細節）。tK：浪到這裡剩幾成高
  vec4 ti = vec4(99.0, 0.0, 0.0, 0.0);
  vec3 tw = vec3(0.0);
  float tK = 0.0;
  // tB：浪頭的這一段捲得多兇；tX：在浪的正面上的位置（0 浪頂、1 被往前推的範圍的下緣）；
  // tSig：在捲舌上的位置（0 根部、1 尖端）；tFringe：捲舌裂開的邊緣（翻白）
  float tB = 0.0, tX = 2.0, tSig = 0.0, tFringe = 0.0;
  if (uTsu.w > 0.0) {
    tK = tsuKAt(vP0);
    tw = tsuWave(vP0, 0.036 * dist + 0.45, ti) * tsuHK(tK);
    tw.x += tsuEbb(vP0, tK, uTsu);
    tB = tsuBreak(dot(vP0, vec2(uTsu.y, -uTsu.x)), ti.z, tK, uTime);
    if (ti.x >= 0.0) tX = ti.x / ${f1(CURL.a0)};
    if (tB > 0.0) tSig = clamp(ti.x < 0.0 ? 1.0 + ti.x / ${f3(CURL.aU)} : 1.0 - ti.x / ${f3(CURL.aL)}, 0.0, 1.0);
    if (vCurl.x > 0.02 && tSig > 0.0) {
      // 捲舌越往尖端越薄，撐不住，裂成一條一條往下掉（上面、底面在同一個地方裂開）
      float lat = dot(vP0, vec2(uTsu.y, -uTsu.x));
      float n = 0.6 * shNoise(vec2(lat * 0.5, tSig * 1.2 - uTime * 0.5)) + 0.4 * shNoise(vec2(lat * 1.6 + 3.0, tSig * 4.0 - uTime * 1.8));
      float cut = 1.0 - 0.45 * n * vCurl.x;
      if (tSig > cut) discard;
      tFringe = smoothstep(cut - 0.14, cut - 0.02, tSig) * vCurl.x;
    }
  }
  float tFlood = smoothstep(0.25, 1.2, abs(tw.x));   // 巨浪的水位湧進來（或退下去）的程度
  win *= 1.0 - tFlood;                               // 那幾秒岸邊交還給整片海面去畫（跟頂點那邊一致）
  vec4 sw = win > 0.0 ? texture2D(uSwe, suv) : vec4(0.0);
  float aS = win * (1.0 - smoothstep(3.0, 5.0, -bedH));
  // 朝著岸捲過來的浪：浪高、往哪邊是岸、浪面的坡度
  float sd = shoreDist(vWorld.xz), pre = 0.0, swlSlope = 0.0;
  vec4 swl = vec4(0.0);
  vec2 sdir = vec2(0.0);   // 離岸的方向
  if (sd < 66.0) {
    swl = swell(sd, ph, vWorld.xz, expo, pre);
    sdir = vec2(shoreDist(vWorld.xz + vec2(2.0, 0.0)) - sd, shoreDist(vWorld.xz + vec2(0.0, 2.0)) - sd) * 0.5;
    sdir /= max(length(sdir), 0.3);
    float pre2;
    swlSlope = (swell(sd + 0.5, ph, vWorld.xz, expo, pre2).x - swl.x) * 2.0;
  }
  // 水有多深：岸邊要算上這一拍沖上來的高度，水才會真的漫上沙灘
  float depth = runup(ph, expo) * (1.0 - smoothstep(0.0, 2.5, -bedH)) + swl.x - bedH - swashLobe(vWorld.xz, uTime) * (1.0 - smoothstep(0.0, 0.8, -bedH));
  depth = mix(depth, mix(sw.r, -bedH, smoothstep(4.5, 5.5, -bedH)), win);
  depth += tw.x + uTide;   // 潮汐；巨浪：水位整個抬高，漫過沙灘和碼頭；浪腳前面是負的，海水先退、露出海床
  if (depth < 0.004) discard;
  // 船身、岸壁離這裡多遠：水線上的細沫、船晃出來的漣漪要用
  vec2 hDir = vec2(0.0);
  float hd = 1e3, qd = 1e3;
  if (dist < 260.0) { hd = hullDist(vWorld.xz, hDir); qd = quayDist(vWorld.xz); }

  // ---- 風浪：三層 FFT 斜率圖相加（貼圖的 mipmap 與各向異性過濾負責遠處的抗鋸齒）----
  float ws = waveScale(dangerAt(vP0), shelterAt(vP0));
  float depthFade = smoothstep(0.3, 8.0, depth) * ws * shelterAt(vP0);
  vec2 wq = toWave(vP0);
  vec4 w0 = texture2D(uSlope0, wq / uPatch.x);
  vec4 w1 = texture2D(uSlope1, wq / uPatch.y);
  vec4 w2 = texture2D(uSlope2, wq / uPatch.z);
  // 風暴時外海的浪放大、島邊照舊（船停在岸邊不會被掀翻），但畫面上不能像罩了一個罩子：
  // 水面的碎浪和白沫從外海一路延伸到岸邊，只有港內、貼岸十來公尺比較平靜。這只影響看起來的樣子，浪高不變
  float rough = uStorm * smoothstep(8.0, 70.0, sd) * smoothstep(0.3, 6.0, depth) * (0.35 + 0.65 * smoothstep(0.03, 0.15, shel));
  float visFade = max(depthFade, 0.7 * rough * min(uWaveScale * ${(1 + SEA_LV.far).toFixed(2)} + ${SEA_LV.storm.toFixed(2)} * uStorm, ${SEA_LV.cap.toFixed(2)}));
  float shadeFade = max(visFade, ws * shel * smoothstep(2.0, 16.0, sd) * smoothstep(0.2, 1.5, depth));   // 畫面用的：只看離岸多遠，不看海床形狀
  float ripple = max(shadeFade, 0.5 * smoothstep(0.0, 1.0, depth) * ws * max(shel, 0.55));   // 淺灘、背風面、港內也有細碎的波紋（再平靜的港口，水面也在晃），不會平得像一塊板子
  float tDng = min(tsuHK(tK) / ${f3(TSU_H.peak)}, 1.0);   // 巨浪在這裡有多大（0–1）：外海很小，快到岸邊時最大
  vec2 sl = fromWave(w0.rg * (1.0 - aS) * mix(depthFade, visFade, 0.5) + (w1.rg + w2.rg) * ripple) + aS * sw.gb + tw.yz + sdir * swlSlope * (1.0 - aS) * clamp(2.5 * max(V.y, 0.06) / (dist * uPixelAngle), 0.0, 1.0);
  if (uSwell > 0.01) sl += swellK(dangerAt(vP0), shelterAt(vP0)) * longSwell(vP0).yz;   // 颱風的長浪
  // 船在水上晃，從船身往外推出一圈一圈的小漣漪，兩三公尺外就散掉了
  if (hd < 4.0) sl += hDir * 0.05 * sin(hd * 7.0 - uTime * 4.2 + 3.0 * shNoise(vWorld.xz * 0.4)) * exp(-max(hd, 0.0) / 1.3) * smoothstep(-0.2, 0.2, hd);
  // 游泳的人推出來的波紋：從那一點往外擴散的細浪。不畫白線——看得出來是因為倒影和反光被它扭歪了；
  // 圈被既有的小浪扭得不正，越擴越淡。波紋擴散得比人游得慢（約 0.55 公尺／秒），
  // 一邊游一邊留下的圈疊起來，外緣就是身後那道窄窄的 V 字。遠到浪比像素還細就不畫（不然會閃）
  float ripFoam = 0.0;
  float ripFine = clamp(0.35 * max(V.y, 0.06) / (dist * uPixelAngle) - 0.5, 0.0, 1.0);
  if (dist < 70.0) {
    for (int i = 0; i < 24; i++) {
      vec4 rp = uRip[i];
      float age = uTime - rp.z;
      if (rp.w <= 0.0 || age < 0.0 || age > 3.5) continue;
      vec2 dd = vWorld.xz - rp.xy;
      float r = length(dd);
      float front = 0.15 + age * 0.55 + 0.16 * (shNoise(vWorld.xz * 1.6 + rp.xy) - 0.5);
      if (r > front + 0.5) continue;
      float x = front - r;                                   // 在波前後面多遠（0 = 最外面那圈）
      float pk = exp(-x * x / (0.03 + 0.05 * age));
      float fade = rp.w * exp(-age / 1.2) / (1.0 + 2.0 * r);
      sl += dd / max(r, 0.05) * (0.85 * fade * pk * sin(x * 14.0) * ripFine);
      // 手拍下去那一下：零零碎碎的一小撮泡沫，一下子就散掉
      ripFoam += rp.w * exp(-age / 0.35) * exp(-r * r / (0.03 + 0.15 * age)) * 0.55 * (0.3 + 0.7 * shNoise(vWorld.xz * 6.0 + rp.z));
    }
    // 人身邊：游的時候頭前面推起一小片碎白（越快越明顯）；不論動不動，身體一上一下推出細細的波
    for (int i = 0; i < 4; i++) {
      vec4 sw4 = uSwimmer[i];
      if (sw4.w <= 0.0) continue;
      vec2 dd = vWorld.xz - sw4.xy;
      float r = length(dd);
      if (r > 2.0) continue;
      vec2 fw = vec2(cos(sw4.w - 1.0), sin(sw4.w - 1.0));
      float along = dot(dd, fw), side = dot(dd, vec2(-fw.y, fw.x));
      float bow = smoothstep(0.5, 0.15, length(vec2(along - 0.3, side * 1.5))) * smoothstep(0.35, 0.75, shNoise(vWorld.xz * 5.0 + uTime * vec2(1.3, -0.9)));
      ripFoam += 0.35 * sw4.z * bow;
      sl += dd / max(r, 0.05) * 0.07 * sin(r * 12.0 - uTime * 4.0) * exp(-r / 0.5) * ripFine;
    }
  }
  // 漩渦的漏斗與旋臂、水龍捲腳下的白沫
  float vcov = 0.0, wHole = 0.0, wBoil = 0.0, wCalm = 0.0;   // wHole：這裡在大漩渦的漏斗裡陷下去多深；wBoil：漏斗底那鍋白沫的陰影；wCalm：風浪的白沫被壓掉幾成
  for (int i = 0; i < 3; i++) {
    vec4 v = uVortex[i];
    if (v.z <= 0.0) continue;
    vec2 dd = vWorld.xz - v.xy;
    float r2 = dot(dd, dd), r = sqrt(r2);
    if (v.w < 1.5) {
      if (r < ${WFAR}) {
        float s = v.z, rr = max(r, 1.0), rc = ${WRC};
        float fadeF = smoothstep(${WFAR}, ${WFAR2}, r);
        // 漏斗的坡度（往外是上坡）
        sl += dd / rr * (s * ${WD} * (r < rc ? r / (rc * rc) : rc * rc / (rr * rr * rr)) * fadeF);
        wHole = max(wHole, s * whirlDepth(r2));
        // 水面上的白沫跟著水流走：繞圈的角速度在核心裡是固定的、核心外跟距離平方成反比（越靠近轉得越快），
        // 一邊繞一邊往中心收，所以一團白沫會被拉成一絲一絲、順著螺旋線排（兩份錯開半拍的紋路輪流淡入淡出，才不會越捲越緊）
        float om = s * ${WVT} * (r < rc ? 1.0 / rc : rc / (rr * rr));
        float c0 = fract(uTime / 8.0), t0 = (c0 - 0.5) * 8.0, t1 = (fract(c0 + 0.5) - 0.5) * 8.0;
        float twist = -log(max(r, 8.0)) / 0.27;
        float fil = mix(whirlFoam(rot2(dd, twist + om * t0) * (1.0 + 0.22 * om * t0)),
                        whirlFoam(rot2(dd, twist + om * t1) * (1.0 + 0.22 * om * t1) + 91.0), abs(2.0 * c0 - 1.0));
        fil = mix(0.2, fil, clamp(3.0 * max(V.y, 0.06) / (dist * uPixelAngle), 0.0, 1.0));   // 遠到一絲一絲比像素還細就改成淡淡的一層（不然會閃）
        // 幾條又長又粗的旋臂一路拖到幾百公尺外（遠遠就看得出整片海在轉），越靠近漏斗細絲越密
        float arm = whirlArm(rot2(dd, twist + om * t0) * (1.0 + 0.22 * om * t0)) * (1.0 - abs(2.0 * c0 - 1.0))
                  + whirlArm(rot2(dd, twist + om * t1) * (1.0 + 0.22 * om * t1) + 91.0) * abs(2.0 * c0 - 1.0);
        float dens = 0.24 * smoothstep(${WFAR2}, 200.0, r) + 0.75 * smoothstep(230.0, 50.0, r);
        fil = 1.5 * dens * fil * (0.8 + 0.7 * arm) + 0.85 * arm * (0.12 + 0.88 * fil) * smoothstep(${WFAR2}, 280.0, r) * smoothstep(45.0, 120.0, r);
        dens = 1.0;
        wCalm = max(wCalm, 0.85 * s * smoothstep(330.0, 120.0, r));   // 漩渦周圍的海面被水流拉平，沒有平常那種零零碎碎的白浪
        // 漏斗底：水攪成一鍋白沫，整團跟著轉
        float bowl = smoothstep(rc * 1.05, rc * 0.45, r);
        vec2 bp = rot2(dd, uTime * 0.6);
        float lump = 0.6 * shNoise(bp * 0.22) + 0.4 * shNoise(bp * 0.6 + 4.0);
        vcov += s * fadeF * (dens * fil + bowl * (0.45 + 0.6 * lump));
        wBoil = max(wBoil, s * bowl * (1.0 - smoothstep(0.35, 0.65, lump)));
      }
    } else {
      sl += dd * (-2.0 * v.z * ${SH} / ${SW2} * exp(-r2 / ${SW2}));
      // 水龍捲腳下：一圈翻白的水、正中央一團碎沫，外面拖著幾道被風捲進來的白沫（跟著風繞的方向轉）
      if (r < 560.0) {
        // 強風刮過的海面不是一片片白泡沫，而是被風拉成一絲一絲的白線，順著風繞的方向排；越靠近漏斗越密
        float th = atan(dd.y, dd.x), lr = log(r + 20.0);
        float ph = 3.0 * th + 9.0 * lr + uTime * 1.5;
        float arm = smoothstep(0.15, 0.85, sin(ph));
        // 線條不是整齊的同心弧：被浪推得歪歪扭扭，一區濃一區淡
        float patchy = 0.3 + 0.7 * smoothstep(0.32, 0.62, shNoise(vWorld.xz * 0.03 + 4.0));
        ph += 0.5 * (shNoise(vWorld.xz * 0.045) - 0.5);
        float l1 = pow(0.5 + 0.5 * sin(ph * 10.0 + 2.5 * sin(lr * 13.0 + th * 2.0)), 22.0);
        float l2 = pow(0.5 + 0.5 * sin(ph * 6.0 - uTime * 0.7 + 3.0 * sin(lr * 7.0 - th * 3.0)), 22.0);
        // 每一絲都是斷斷續續的：有的地方濃、有的地方斷掉
        float gap = 0.5 + 0.5 * sin(th * 7.0 - lr * 23.0 + uTime * 0.9 + 2.0 * sin(th * 4.0 + lr * 9.0));
        float streak = max(l1, 0.8 * l2) * (0.3 + 0.7 * arm) * (0.25 + 0.75 * smoothstep(0.25, 0.7, gap)) * patchy;
        // 遠到一絲一絲比像素還細的地方，改成淡淡的幾道寬帶（不然會閃）
        float fine = clamp(4.0 / (dist * uPixelAngle / max(V.y, 0.06)), 0.0, 1.0);
        streak = mix(0.42 * arm * smoothstep(330.0, 150.0, r), streak, fine);
        vcov += v.z * (smoothstep(560.0, 130.0, r) * smoothstep(40.0, 90.0, r) * streak * 0.8
                     + smoothstep(95.0, 40.0, r) * 0.5);
      }
    }
  }
  float div = w0.b * (1.0 - aS) * mix(depthFade, visFade, 0.5) + (w1.b + w2.b) * visFade;
  vec3 N = normalize(vec3(-sl.x, clamp(1.0 + div, 0.25, 2.0), -sl.y));
  if (vCurl.y > 0.001) {
    // 捲起來的那一段：大形狀的法線由頂點那邊算好傳過來（浪壁是陡的、捲舌的底面朝下），細浪的起伏再疊上去
    vec2 fine = sl - tw.yz;
    N = normalize(mix(N, normalize(normalize(vCurlN) + 0.7 * vec3(-fine.x, 0.0, -fine.y)), vCurl.y));
  }

  // 被過濾掉的細浪改算成粗糙度（像素涵蓋範圍越大，損失越多）
  float fp = dist * uPixelAngle / max(V.y, 0.06);
  vec3 texel = uPatch / uTexN;
  vec3 lostF = smoothstep(texel * 0.7, texel * 40.0, vec3(fp));
  float lost = dot(lostF, uSlopeVar) * shadeFade * shadeFade * 0.5;

  float ndv = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  F = mix(F, 0.30, clamp(lost * 5.0, 0.0, 0.55) * F);
  float calmW = 1.0 - smoothstep(0.08, 0.40, shel);   // 港內、背風面：水面平靜，倒影比外海清楚
  F *= mix(mix(mix(0.3, 0.55, calmW), 0.72, uGloom), 1.0, smoothstep(120.0, 700.0, dist));   // 近處少反射一點天空，看得到水本身的顏色：越深越暗
  float cav = tB * step(0.0, ti.x) * smoothstep(1.15, 0.7, tX);   // 捲舌的底面和它底下的浪壁：頭上被水蓋住，照不到天光
  F *= 1.0 - 0.75 * cav;

  vec3 R = reflect(-V, N);
  R.y = abs(R.y) + 0.02;
  vec3 refl = skyBase(normalize(R), 3);
  // ---- 朝霞、晚霞映在海面上 ----
  // 太陽很低的時候，照進水裡的光很少，水體本身是暗的，海面上看到的主要是天空的倒影：
  // 朝著太陽的那一大片是橘金色，往兩旁轉成粉紫，背著太陽的那一側才是暗暗的藍綠。越貼著水面看越濃；
  // 倒影的方向跟著波紋晃，所以霞光是一道一道碎開、會動的
  float glow = uDusk * (1.0 - uGloom), glowK = 0.0;
  if (glow > 0.01) {
    vec2 sunAz = normalize(uSunDir.xz + 1e-4);
    float s2 = max(dot(normalize(R.xz + 1e-4), sunAz), 0.0);
    vec3 dawn = mix(vec3(0.78, 0.38, 0.50), vec3(1.05, 0.55, 0.22), s2 * s2) * (0.45 + 0.60 * max(uSunCol.r, max(uSunCol.g, uSunCol.b)));
    dawn = mix(skyGradient(normalize(vec3(R.x, R.y * 0.35 + 0.05, R.z))), dawn, 0.75);
    float hgt = mix(0.5, 1.0, 1.0 - smoothstep(0.04, 0.45, R.y));   // 翹向天頂的小波面映到的是高處的天空，霞光淡一些：水面上才有深淺，不是整片一樣
    refl = mix(refl, dawn, glow * (0.30 + 0.70 * s2));
    glowK = glow * (0.14 + 0.60 * s2 * s2) * (0.40 + 0.60 * pow(1.0 - ndv, 1.5)) * hgt;
    F = max(F, glowK * (1.0 - 0.75 * cav));
  }
  if (uReflOn > 0.5) {
    // 船、碼頭、島的倒影：鏡像相機畫出的貼圖，依法線扭曲
    vec4 rc = uReflMat * vec4(vWorld, 1.0);
    // 波紋把倒影打散：小波面往哪邊翹，倒影就往哪邊偏（上下拉得比左右長），所以倒影是晃動、碎開的，不是一面鏡子
    vec2 fw = normalize(-V.xz + 1e-5);
    vec2 ns = vec2(N.x * fw.y - N.z * fw.x, dot(N.xz, fw)) / max(N.y, 0.3);
    vec2 ruv = rc.xy / rc.w + ns * vec2(0.10, 0.26) * clamp(14.0 / dist, 0.2, 1.0);
    vec4 ro = texture2D(uReflTex, clamp(ruv, 0.002, 0.998));
    // 遠處海面上的倒影被浪打散了；巨浪把水位抬高（或抽低）的地方鏡面對不上，也不貼（不然水下的碼頭牆會印在水面上）
    refl = mix(refl, ro.rgb, ro.a * (1.0 - smoothstep(200.0, 450.0, dist)) * (1.0 - tFlood) * (1.0 - smoothstep(0.5, 3.0, wHole)));   // 大漩渦的漏斗裡也一樣
  }
  // 大漩渦的漏斗裡：越深越照不到天光（洞口那一圈還亮，往下一路暗到底）
  float holeOcc = exp(-wHole / 13.0);
  refl *= mix(1.0, holeOcc, 0.9);
  // 樹、船、岸壁、建築投在水面上的影子：陰影貼圖涵蓋的範圍內用貼圖（跟碼頭上的影子是同一張），更遠的只算自己這艘船。
  // 範圍的邊緣要淡出得很寬：太陽低的時候整片港口都在山的影子裡，邊界太窄的話海面上會看到一條直直的線
  float shIn = shadowRange(vWorld, 0.35);
  float sunVis = cloudShadow(vP0) * min(mix(boatShadow(vWorld.xz), 1.0, shIn), mix(1.0, sunShadow(vWorld, vec3(0.0, 1.0, 0.0)), shIn)) * mix(1.0, holeOcc, 0.85);

  // ---- 太陽反光 ----
  vec3 Hh = normalize(V + uSunDir);
  float ndh = max(dot(N, Hh), 1e-3);
  float var = 0.0010 + 1.3 * lost + 0.004 * glow;   // 清晨、黃昏：太陽貼著海面，反光拉成一條長長的、碎碎的光路
  float tan2 = (1.0 - ndh * ndh) / (ndh * ndh);
  float D = exp(-tan2 / var) / (3.14159 * var * ndh * ndh * ndh * ndh);
  float Fh = 0.02 + 0.98 * pow(1.0 - max(dot(V, Hh), 0.0), 5.0);
  vec3 spec = SUN_COL * smoothstep(0.35, 0.55, min(D * Fh * 0.10 / max(ndv, 0.15), 2.2)) * (1.5 + 1.5 * glow) * sunVis * sunVis;   // 反光是一顆一顆清楚的亮點

  // ---- 水體顏色：岸邊的淺灘是透亮的土耳其綠，往外變成青藍，再到深海的鈷藍 ----
  float sunUp = max(uSunDir.y, 0.0);
  vec3 shallow = vec3(0.10, 0.74, 0.64);
  vec3 midsea = vec3(0.015, 0.42, 0.64);
  vec3 deep = vec3(0.006, 0.12, 0.42);
  float dcol = min(depth, 0.35 + 0.17 * sd);   // 顏色用的水深：離岸每遠一公尺最多只深 17 公分，海床陡降的地方顏色不會跟著跳
  float surgeUp = tFlood * step(0.0, tw.x);
  float onLand = surgeUp * smoothstep(-3.0, 0.5, bedH);   // 巨浪沖上岸的水：又急又濁，不是清澈見底的淺灘
  float murk = surgeUp * max(smoothstep(-3.0, 0.5, bedH), 0.8 * smoothstep(45.0, 12.0, sd));   // 岸邊、港裡的水也被攪濁（看不到水底下的碼頭牆）
  dcol = max(dcol, min(depth, 2.5) * murk);
  shallow = mix(shallow, vec3(0.11, 0.36, 0.37), 0.8 * uGloom);
  midsea = mix(midsea, vec3(0.02, 0.17, 0.29), 0.8 * uGloom);
  deep = mix(deep, vec3(0.006, 0.075, 0.22), 0.6 * uGloom);
  float dz = 1.0 - exp(-dcol * (0.20 + 0.30 * uGloom));
  vec3 scatter = mix(mix(shallow, midsea, smoothstep(0.0, 0.5, dz)), deep, smoothstep(0.4, 0.95, dz));
  float lv = max(uSunCol.r, max(uSunCol.g, uSunCol.b));   // 主光有多亮（夜晚的月光很弱）
  scatter = mix(scatter, vec3(0.20, 0.33, 0.32), 0.65 * murk);
  // 照進水裡的光帶著太陽的顏色（清晨、黃昏是暖的），不是只有亮度；太陽很低的時候水體本身暗下來，讓給霞光的倒影
  scatter *= (0.40 * uAmbient + 0.75 * sunUp * sunVis * mix(vec3(lv), uSunCol, 0.6)) * (1.0 - 0.45 * cav) * mix(1.0, holeOcc, 0.6) * (1.0 - 0.40 * glow);

  // 浪越高、越逆光、浪面越朝向鏡頭，透出的青綠色越強
  float h01 = clamp(vWaveH / max(uHs * ws * 0.55, 0.3), 0.0, 1.3);
  vec3 Lh = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
  float back = pow(max(dot(V, -Lh), 0.0), 3.0);
  float facing = pow(clamp(0.6 - 0.6 * dot(Lh, N) + 0.2, 0.0, 1.0), 2.0);
  float sss = h01 * (0.20 + 1.5 * back * facing) + 0.10 * ndv * ndv;
  scatter += vec3(0.0, 0.50, 0.38) * sss * min(shadeFade, 1.0) * (0.3 + 0.9 * sunUp) * (0.3 + 0.7 * sunVis) * max(lv, uAmbient.g * 0.6);
  // 巨浪的水牆：越靠近浪頂水越薄，透出青綠色（浪腳是深色的）
  scatter += vec3(0.02, 0.40, 0.35) * step(0.0, ti.x) * smoothstep(0.45, 0.95, ti.y) * min(ti.w * tDng, 1.0) * (0.35 + 0.65 * sunUp) * max(lv, uAmbient.g * 0.6) * 0.5;

  scatter += vec3(0.02, 0.40, 0.35) * vCurl.x * tSig * (0.35 + 0.65 * sunUp) * max(lv, uAmbient.g * 0.6) * 0.6;   // 捲舌越往尖端越薄，透著光
  // 水有多透：只有腳邊一兩公尺深的地方看得到底；遠處的水是不透的（不然遠遠就看到島在水面下的那一截）
  float T = exp(-1.15 * dcol - 0.5 * max(depth - dcol, 0.0) - dist / 110.0);
  float alpha = 1.0 - (1.0 - F) * T;
  vec3 col = (F * refl + spec + (1.0 - F) * (1.0 - T) * scatter) / max(alpha, 1e-3);
  // 波紋的明暗：朝太陽那一側翹起來的小波面亮一點、背著的暗一點，水面才看得出在動。遠到波紋比像素還細就沒有了
  float facet = clamp(dot(N.xz, normalize(uSunDir.xz + 1e-4)) / max(N.y, 0.3) * 9.0, -1.0, 1.0) * clamp(0.3 / fp, 0.0, 1.0);
  col *= 1.0 + 0.10 * facet * (0.45 + 0.55 * sunVis);

  alpha *= smoothstep(0.0, 0.10, depth) * (0.5 + 0.5 * smoothstep(0.0, 0.5, depth));   // 漫上沙灘的那層薄水是透的，最邊緣淡到沒有（岸線不是一條硬邊）

  // ---- 泡沫 ----
  float texFade = clamp(1.2 / fp, 0.0, 1.0);
  float ft = texture2D(uFoamTex, vP0 * 0.045 + uTime * vec2(0.004, 0.002)).r * 0.6
           + texture2D(uFoamTex, vP0 * 0.17 - uTime * vec2(0.006, 0.003)).r * 0.4;
  ft = mix(0.55, ft, texFade);

  float cov = (w0.a * 1.1 + w1.a * 0.75 + w2.a * 0.3) * min(visFade, 1.0);            // FFT 累積白浪
  float gale = smoothstep(0.75, 1.55, uStorm);
  if (gale > 0.0) {
    // 強風下的海面不是整片白：白沫被風扯成一條一條，順著風向排（越強的風條紋越密、越長），條紋之間露出深色的水；
    // 整片白的只有正在破碎的浪頭。條紋跟著水慢慢往下風處漂
    float wu = dot(vWorld.xz, uWindDir), wv = dot(vWorld.xz, vec2(-uWindDir.y, uWindDir.x));
    float s1 = shNoise(vec2(wv * 1.1, (wu - uTime * 5.0) * 0.026));
    float s2 = shNoise(vec2(wv * 3.3 + 5.0, (wu - uTime * 7.0) * 0.08 + 3.0));
    float thick = shNoise(vWorld.xz * 0.011 + 7.0);                                       // 一區濃、一區稀
    float streak = smoothstep(0.54, 0.72, 0.58 * s1 + 0.42 * s2 + 0.26 * (thick - 0.5));
    streak *= 0.35 + 0.65 * smoothstep(0.30, 0.62, shNoise(vec2(wv * 0.35 + 9.0, (wu - uTime * 5.0) * 0.1)));   // 每一條都斷斷續續的，不是一根長棍
    streak = mix(0.26, streak, clamp(3.5 / fp, 0.0, 1.0));                               // 遠到條紋比像素還細就改成淡淡的一層（不然會閃）
    cov = mix(cov, min(cov, 0.60) * (0.14 + 1.15 * streak), gale);
    // 風暴裡的水攪進大量空氣和碎沫，顏色偏灰綠、沒那麼藍
    col = mix(col, vec3(dot(col, vec3(0.30, 0.50, 0.20))) * vec3(0.76, 0.97, 1.0), 0.45 * gale);
  }
  cov += smoothstep(0.20, 0.50, -div) * 0.95;                                            // 當下正在翻折的浪頭
  cov *= 1.0 - wCalm;
  // ---- 岸邊的浪花 ----
  float shoreZone = (1.0 - aS) * smoothstep(52.0, 36.0, sd);
  if (shoreZone > 0.0) {
    // 浪花的紋理跟著水往岸上流（兩份錯開半拍的紋理輪流淡入淡出），不是固定往一個方向飄
    vec2 flow = sdir * mix(1.1, 2.2, smoothstep(2.0, 30.0, sd));
    float c0 = fract(uTime * 0.25), c1 = fract(uTime * 0.25 + 0.5);
    float fs = mix(texture2D(uFoamTex, (vWorld.xz + flow * (c0 - 0.5) * 4.0) * 0.105).r,
                   texture2D(uFoamTex, (vWorld.xz + flow * (c1 - 0.5) * 4.0) * 0.105 + 0.37).r, abs(2.0 * c0 - 1.0));
    // 貼著水面看過去時紋理糊掉了，改用大塊的雜訊撐住破碎感，浪花才不會變成一整片白板
    fs = mix(0.28 + 0.55 * shNoise(vWorld.xz * 0.23 + 9.1), fs * 0.7 + 0.3 * texture2D(uFoamTex, vWorld.xz * 0.31 + 0.5).r, texFade);
    ft = mix(ft, fs, smoothstep(52.0, 26.0, sd) * (1.0 - win));
    float w = swl.z, big = smoothstep(0.75, 1.2, swl.w), calm = smoothstep(0.12, 0.6, expo);
    float rag = 0.6 * shNoise(vWorld.xz * 0.23 + 9.1) + 0.4 * shNoise(vWorld.xz * 0.71 + 3.3);   // 邊緣參差不齊
    float part = smoothstep(0.80, 1.12, swl.w + 0.3 * (rag - 0.5));                           // 浪是一段一段破的：高的那幾段先翻白，矮的還沒
    part = mix(part, 1.0, 0.2 + 0.5 * smoothstep(9.0, 2.5, sd));                              // 越靠岸破得越多，但還是一段一段的
    // 快破的浪頭：只有比較高的那幾段冒白，斷斷續續的一條
    float lip = pre * (1.0 - swl.y) * smoothstep(0.41, 0.49, w) * smoothstep(0.60, 0.51, w) * big;
    // 破了以後：朝岸的那一面翻成一整道白沫，前緣參差；後面拖著一片慢慢散開的碎泡沫
    float wid = shNoise(vWorld.xz * 0.06 + 4.0);   // 白帶的粗細沿著海岸慢慢變（有的地方一大片、有的地方細細一條）
    float front = smoothstep(0.16 + 0.20 * rag + 0.12 * wid, 0.40 + 0.16 * rag, w) * smoothstep(0.64 - 0.12 * rag - 0.12 * (1.0 - wid), 0.47, w) * part;
    // 白帶裡面有破洞：大的一層照上面的泡沫紋理，細的一層再取一次（近處才看得出來，遠處淡掉免得閃），不是一整條實心的白
    float holes = smoothstep(0.22, 0.58, ft) * mix(1.0, smoothstep(0.25, 0.6, texture2D(uFoamTex, vWorld.xz * 0.43 + vec2(0.21, 0.67) + flow * c0 * 0.6).r), texFade);
    front *= 0.3 + 0.7 * holes;
    float trail = smoothstep(0.44, 0.58, w) * pow(1.0 - smoothstep(0.5, 1.0, w), 1.2) * (0.45 + 0.6 * rag) * (0.4 + 0.6 * part) * (0.15 + 0.85 * holes);   // 後面拖的碎泡沫：破洞更多
    float thin = 0.35 + 0.65 * smoothstep(0.1, 0.7, depth);   // 水很薄的地方（已經上了沙灘）浪頭的白沫散掉
    cov += shoreZone * calm * (0.9 * lip + swl.y * thin * (1.05 * front + 0.7 * trail * (0.35 + 0.65 * texFade)));   // 遠處只留浪頭那一道白線
    // 沖上沙灘的那層薄水：浪剛到的時候整片是白的，退下去的時候散成一絲一絲
    float age = swashAge(ph);
    float fresh = 1.0 - 0.75 * smoothstep(0.12, 0.85, age);
    cov += (1.0 - win) * (0.5 + 0.5 * calm) * (0.25 + 0.75 * fresh)
         * (0.95 * smoothstep(0.07, 0.01, depth) * (0.6 + 0.4 * rag) + 0.46 * smoothstep(0.8, 0.05, depth) * (0.35 + 0.65 * rag) * (0.25 + 0.75 * holes))
         * (0.3 + 0.7 * smoothstep(0.28, 0.62, shNoise(vWorld.xz * 0.13 + vec2(uTime * 0.05, 1.7))));   // 沖上岸的白邊一段一段的（斷口沿著岸慢慢移動）
  }
  cov += win * (0.72 * sw.a + 0.4 * smoothstep(0.85, 1.3, sw.a));
  cov += smoothstep(0.07, 0.0, depth) * (0.15 + 0.6 * ft) * (1.0 - 0.6 * smoothstep(0.3, 0.9, swashAge(ph)));   // 最前緣一圈碎泡沫（退潮時淡掉）
  cov += vcov;
  float tBoil = 0.0;
  if (uTsu.w > 0.0 && tDng > 0.01) {
    // 巨浪的白沫。浪的正面大半是一堵深色的水牆，只有：
    float q = ti.x, top = ti.y, br = ti.z, front = step(0.0, q);
    float lat = dot(vP0, vec2(uTsu.y, -uTsu.x));
    float rag = 0.6 * shNoise(vec2(lat * 0.045, q * 1.6 - uTime * 0.25)) + 0.4 * shNoise(vec2(lat * 0.17 + 7.0, q * 4.0 - uTime * 0.6));
    // 浪頂：正在破的那幾段翻成一道厚厚的白沫，還沒破的只有頂上一條細線
    float lip = (0.55 * smoothstep(0.84 - 0.26 * br, 0.99, top + 0.14 * (rag - 0.5)) + 0.6 * smoothstep(0.93, 1.0, top)) * (0.3 + 0.9 * br);
    // 破掉的白沫順著浪面往下崩，前緣一舌一舌的
    float tongue = shNoise(vec2(lat * 0.33 + 7.0, q * 0.8 - uTime * 0.5));                    // 細長的一道一道，順著浪面往下流
    float spill = front * br * smoothstep(0.36, 0.92, top + 0.22 * (rag - 0.5) + 0.5 * (tongue - 0.5));
    // 浪面上被往上抽的水紋：一絲一絲、斷斷續續的細白線
    float pull = front * pow(0.5 + 0.5 * sin(lat * 0.62 + 4.0 * shNoise(vec2(lat * 0.06, 2.7))), 12.0)
               * smoothstep(0.12, 0.4, top) * smoothstep(0.9, 0.7, top) * (0.4 + 0.6 * rag);
    // 浪過去之後，背面拖著一大片翻攪過的碎白沫，越往後越散
    float churn = (1.0 - front) * exp(0.85 * q) * (0.35 + 0.65 * br) * (0.55 + 0.9 * rag);
    // 靠近島的地方浪撐不住、整道垮成白水
    float shoal = smoothstep(0.25, 0.7, top) * smoothstep(0.45, 0.25, tK);
    // 捲起來的那幾段：捲舌底下的浪壁是光滑的深色水面（白沫都被拋到前面去了），只剩被往上抽的水紋；
    // 捲舌砸下來的地方炸成一大片白水，被浪推著往前滾，前緣一舌一舌的
    float hit = tB * front * smoothstep(0.86, 1.08, tX + 0.14 * (rag - 0.5)) * smoothstep(2.1, 1.3, tX + 0.5 * (tongue - 0.5));
    spill *= 1.0 - cav;
    lip *= 1.0 - 0.85 * vCurl.x;
    churn *= 1.0 - 0.92 * vCurl.x * smoothstep(-1.3, -0.25, q);   // 還在捲的浪，背面靠浪頂那一段是光滑的（白水在捲舌砸下去之後才有）
    // 捲舌本身是一片光滑的水，上面只有順著水流的幾絲白沫；裂開的邊緣才整圈翻白
    cov += 1.3 * tFringe + 1.1 * vCurl.x * tSig * pow(shNoise(vec2(lat * 0.9 + 11.0, tSig * 0.8 - uTime * 0.35)), 3.0);
    pull *= 1.0 + 1.2 * cav;
    cov += min(ti.w * tDng, 1.0) * (1.15 * lip + 0.62 * spill + 0.45 * pull + 1.25 * churn + 0.8 * shoal) + min(ti.w * tDng * 1.6, 1.0) * hit * (0.62 + 0.5 * rag);
    // 翻滾的白水不是一片平平的白：一團一團鼓起來，凹下去的地方是帶藍的陰影
    tBoil = clamp(hit + 0.6 * churn + 0.7 * onLand, 0.0, 1.0)
          * (1.0 - smoothstep(0.30, 0.62, 0.6 * shNoise(vec2(lat * 0.11, q * 2.6 - uTime * 0.7)) + 0.4 * shNoise(vec2(lat * 0.37 + 2.0, q * 8.0 - uTime * 1.5))));
    // 沖上岸的水：白沫順著水流被拉成一道一道，中間露出濁濁的水色；只有最前緣那層薄水整片翻白
    float along = dot(vWorld.xz, uTsu.xy);
    float f1 = shNoise(vec2(lat * 0.42, (along - uTime * 5.0) * 0.07));
    float f2 = shNoise(vec2(lat * 1.3 + 3.0, (along - uTime * 7.0) * 0.21 + 5.0));
    float streak = smoothstep(0.42, 0.78, 0.55 * f1 + 0.45 * f2);
    float edge = smoothstep(0.7, 0.08, depth);
    cov += onLand * (0.12 + 0.40 * streak + 0.55 * edge * (0.5 + 0.5 * rag)) + (murk - onLand) * 0.3 * streak;
  }
  vec2 wkd = vWorld.xz - uWakeBox.xy;
  if (uWakeBox.w > 0.5 && dot(wkd, wkd) < uWakeBox.z * uWakeBox.z)
  for (int i = 0; i < 16; i++) {                                                         // 船的航跡
    vec4 wk = uWake[i];
    float age = uTime - wk.z;
    if (wk.w <= 0.0 || age < 0.0 || age > 30.0) continue;
    vec2 dd = vWorld.xz - wk.xy;
    float r = 1.8 + age * 0.9;
    cov += wk.w * exp(-dot(dd, dd) / (r * r)) * exp(-age / 4.5) * 0.4;
  }
  cov += ripFoam * smoothstep(0.02, 0.2, depth);   // 游泳的人身邊、手拍下去的地方的白沫
  // 水線：水貼著船身、岸壁的地方有一圈細碎的白沫，隨著水一進一退；有的地方濃、有的地方斷掉，不是一條等寬的線
  float wl = min(hd, qd);
  if (wl < 0.8) {
    float lap = 0.5 + 0.5 * sin(uTime * 1.1 + 6.2831 * shNoise(vWorld.xz * 0.21));
    float wrag = shNoise(vWorld.xz * 1.9 + uTime * vec2(0.11, -0.07));
    cov += smoothstep(0.10 + 0.32 * lap * wrag, 0.0, wl) * (0.45 + 0.55 * wrag) * smoothstep(0.02, 0.15, depth);
  }
  cov = clamp(cov, 0.0, 1.2);
  // 覆蓋率低時只留下紋理最亮的網狀線條，高時才整片變白
  float fraw = smoothstep(0.0, 0.35, cov - (1.0 - ft) * 1.05) * smoothstep(0.0, 0.07, depth);
  fraw = max(fraw, smoothstep(0.75, 1.15, cov) * 0.85);
  float foam = smoothstep(0.24, 0.52, fraw);                   // 厚的白沫：成片的白色，邊緣帶一點筆觸的柔
  float lace = smoothstep(0.02, 0.26, fraw) * (1.0 - foam);    // 外圍一圈薄薄的泡沫：半透明，透出底下的水色
  tBoil = max(tBoil, wBoil);
  vec3 foamCol = vec3(0.99) * (0.60 * uAmbient + (0.34 + 0.22 * sunUp) * sunVis * lv) * mix(vec3(1.0), vec3(0.70, 0.80, 0.90), 0.85 * tBoil) * mix(1.0, holeOcc, 0.55);
  col = mix(col, foamCol * vec3(0.84, 0.96, 1.0), lace * 0.40);
  col = mix(col, foamCol * (0.90 + 0.10 * smoothstep(0.35, 0.75, ft)), foam * 0.93);   // 厚的地方也有一點深淺，不是一整片死白
  alpha = max(alpha, max(foam, lace * 0.55));
  // 漫上沙灘的那層薄水上漂著一層網狀的泡沫（一圈圈相連的細白線）：跟著水一起沖上來、退下去；
  // 浪剛到的時候到處都是，退的時候一塊一塊地消掉。不然那層水只是一片平平的水色
  if (depth < 0.5 && bedH > -0.7 && texFade > 0.05) {
    float dens = shNoise(vWorld.xz * 0.23 + 9.1), age = smoothstep(0.1, 0.85, swashAge(ph)), g = mix(-0.2, 0.35, age);
    float lk = smoothstep(0.5, 0.1, depth) * smoothstep(-0.7, -0.15, bedH) * (0.3 + 0.7 * smoothstep(0.12, 0.6, expo)) * smoothstep(g, g + 0.3, dens);
    if (lk > 0.01) {
      // 要淡掉的地方不是整片變透明，而是洞越來越大、白沫越來越細，最後斷開
      float hole = mix(0.26, 0.48, age) + 0.12 * (0.5 - dens) + 0.4 * (1.0 - lk);
      float ln = foamLace((vWorld.xz + sdir * runup(ph, expo) * 6.0) * 1.5, uTime * 0.5, hole) * texFade * (1.0 - foam) * (1.0 - win);
      col = mix(col, foamCol, ln * 0.85);
      alpha = max(alpha, ln * 0.85);
    }
  }
  // 雨點打在海面上的小白點
  // 每個雨點是一圈往外擴、慢慢淡掉的小漣漪；位置、出現的時間每一格都不一樣
  float drop = 0.0;
  if (uRain > 0.01 && texFade > 0.02) {
    vec2 rc = vP0 * 2.2, ri = floor(rc), rf = fract(rc) - 0.5;
    float r0 = fract(sin(dot(ri, vec2(127.1, 311.7))) * 43758.5453);
    float rt = uTime * (1.3 + 0.9 * r0) + r0 * 53.0;                  // 每一格有自己的節拍，不會同時閃
    float rk = floor(rt), age = rt - rk;
    vec3 rr = fract(sin(dot(ri, vec2(269.5, 183.3)) + rk * vec3(12.9898, 78.233, 37.719)) * vec3(43758.5453, 28001.8384, 50849.4141));
    float dr = length(rf - (rr.xy - 0.5) * 0.5);
    drop = step(1.0 - 0.45 * uRain, rr.z) * smoothstep(0.07, 0.0, abs(dr - (0.04 + 0.26 * age))) * (1.0 - age) * (1.0 - age) * texFade;
  }
  col += (0.34 * uAmbient + 0.14 * lv) * drop;
  // 晚上燈光照在水面上
  if (uLampOn > 0.0)
  for (int i = 0; i < 8; i++) {
    if (uLamp[i].z <= 0.0) continue;
    vec2 ld = vWorld.xz - uLamp[i].xy;
    float d2 = dot(ld, ld);
    col += vec3(1.0, 0.70, 0.36) * uLamp[i].z * exp(-d2 / 70.0) * (0.10 + 0.45 * foam);
    // 燈的倒影：一道朝鏡頭拉長、隨著波紋碎開晃動的光
    // 水面哪裡的坡度剛好把燈反射進眼睛就亮；沿著「人看向燈」的方向放寬很多，所以是一條細長的光
    vec3 Lv = vec3(uLamp[i].x, 4.0, uLamp[i].y) - vWorld;
    vec3 Hl = normalize(V + normalize(Lv));
    vec2 dev = N.xz / max(N.y, 0.2) - Hl.xz / max(Hl.y, 0.05);
    vec2 tl = normalize(Lv.xz + 1e-4);
    float al = dot(dev, tl), ac = dot(dev, vec2(-tl.y, tl.x));
    col += vec3(1.0, 0.72, 0.38) * uLamp[i].z * exp(-ac * ac / 0.0016 - al * al / 0.06) * 2.6 * (1.0 - foam) / (1.0 + d2 * 0.0012);
  }

  col += vec3(1.0, 0.93, 0.70) * beamSweep(vWorld.xz) * (0.16 + 0.24 * foam);   // 燈塔的光掃過海面
  if (uUnder > 0.5) { col = underSurface(N, V, foam); alpha = 1.0; }
  else col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// 地形：高度與法線已經烘進頂點

// 每座島的地表長相（地形與雜草共用）
const isle = /* glsl */ `
uniform vec4 uIsle[${ISLANDS.length}];      // 每座島：(x, z, 半徑, 0)
uniform vec4 uIsleLook[${ISLANDS.length}];  // 每座島的地表：(裸岩多寡, 草木多寡, 沙子多白, 草有多乾黃)

// 這裡是哪座島，地表就長那座島的樣子
vec4 isleLook(vec2 q) {
  vec4 acc = vec4(0.0);
  float ws = 0.0;
  for (int i = 0; i < ${ISLANDS.length}; i++) {
    float d = length(q - uIsle[i].xy) / uIsle[i].z;
    float w = exp(-d * d * 3.0) + 1e-6;
    acc += uIsleLook[i] * w; ws += w;
  }
  return acc / ws;
}
`;

// ---- 雜草 ----
// 幾千叢草鋪成一塊方形草皮，跟著鏡頭捲動；哪裡長草、長什麼顏色，跟地形著色器用同一套算法，所以草一定長在草地上
export const grassVert = /* glsl */ `
${common}
${bed}
#define SH_TAPS 4
${shadowRecv}
${isle}
uniform float uGrassT;     // 草皮的邊長
uniform vec3 uGrassCam;    // 草皮的中心（鏡頭前方）
uniform float uWindT;
uniform float uWindAmp;
uniform vec2 uWindDir;
attribute vec2 aLean;      // 這片草葉往哪邊倒
attribute float aTone;
attribute vec4 aSeed;      // 這一叢：(x, z, 轉向, 亂數)
varying vec3 vCol;

void main() {
  vec2 q = aSeed.xy + floor((uGrassCam.xz - aSeed.xy) / uGrassT + 0.5) * uGrassT;
  float dist = length(q - uGrassCam.xz);
  float h = bedAt(q);
  vec2 grad = vec2(bedAt(q + vec2(1.0, 0.0)) - h, bedAt(q + vec2(0.0, 1.0)) - h);
  float n = vnoise(q * 0.05) * 0.6 + vnoise(q * 0.18) * 0.4;
  vec4 look = isleLook(q);
  float lo = mix(0.52, 0.14, look.r);
  float rockAmt = max(smoothstep(lo, lo + 0.28, length(grad) + look.r * 0.3 * (n - 0.35)), smoothstep(0.78, 0.98, look.r));
  float grassAmt = smoothstep(1.4, 3.0, h + (n - 0.5) * 1.5) * clamp(look.g * 1.7 + (n - 0.5) * 1.3, 0.0, 1.0);
  float grow = smoothstep(0.45, 0.8, grassAmt * (1.0 - rockAmt)) * smoothstep(uGrassT * 0.5, uGrassT * 0.36, dist);
  // 有的地方草長得高、有的地方矮
  float hs = grow * mix(0.22, 0.70, aSeed.w * aSeed.w) * (0.5 + 1.0 * vnoise(q * 0.21 + 7.0));
  if (hs < 0.02) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }   // 這裡不長草

  float cs = cos(aSeed.z), sn = sin(aSeed.z), y = position.y;
  mat2 rot = mat2(cs, sn, -sn, cs);
  // 風：一陣一陣掃過草地，草尖擺得最多
  float gw = sin(uWindT * 2.0 - dot(q, uWindDir) * 0.33 + n * 9.0);   // 風的波紋：一道一道順著風向掃過整片草地（地面的顏色也跟著同一道波紋）
  vec2 sway = uWindDir * uWindAmp * (0.16 + 0.24 * gw + 0.05 * sin(uWindT * 5.1 + q.x * 2.1 + aSeed.w * 6.0));
  vec2 xz = q + rot * position.xz * (0.7 + 0.6 * aSeed.w) + (rot * aLean + sway) * y * y * hs;
  vec3 world = vec3(xz.x, h - 0.04 + y * hs + dot(grad, xz - q), xz.y);

  // 顏色跟腳下的草地一樣：根部暗、葉尖亮；少數幾叢是枯黃的
  float dry = clamp(look.a + (n - 0.5) * 0.9, 0.0, 1.0);
  vec3 col = mix(vec3(0.21, 0.49, 0.085), vec3(0.55, 0.55, 0.18), dry);
  col = mix(col, vec3(0.095, 0.28, 0.09), smoothstep(6.0, 14.0, h + (n - 0.5) * 6.0) * look.g);
  col = mix(col, col * vec3(1.32, 1.12, 0.52), 0.6 * smoothstep(0.50, 0.72, vnoise(q * 0.06 + 3.0)));
  col = mix(col, vec3(0.50, 0.46, 0.22), 0.6 * step(0.93, fract(aSeed.w * 17.0)));
  col *= mix(0.62, 1.22, smoothstep(0.15, 0.7, y)) * (0.95 + 0.1 * step(1.0, aTone)) * (0.9 + 0.2 * step(0.5, fract(aSeed.w * 7.0))) * (1.0 + 0.13 * gw * y);   // 草根深、草尖亮；被風壓彎的那一道泛著亮光

  vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
  float diff = smoothstep(0.02, 0.40, dot(N, uSunDir)) * cloudShadow(q) * sunShadow(vec3(q.x, h + 0.2, q.y), N);
  vec3 light = vec3(0.30, 0.41, 0.52) * uAmbient * (1.0 - 0.3 * uGloom) * (0.78 + 0.22 * N.y) + SUN_COL * vec3(1.13, 1.0, 0.80) * diff * 0.72;   // 陽光偏暖、陰影偏青   // 陰影偏藍、不死黑
  vCol = applyFog(col * light, world);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export const grassFrag = /* glsl */ `
varying vec3 vCol;
void main() {
  gl_FragColor = vec4(vCol, 2.0);   // alpha 大於 1 = 「這裡是草」：環境光遮蔽在草上只套一點點（細草葉互相遮來遮去，整片會變得又黑又髒）
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const terrainVert = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;

void main() {
  vWorld = position;
  vN = normal;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

export const terrainFrag = /* glsl */ `
${common}
${bed}
${shore}
${swe}
uniform float uWaveScale;
uniform float uStorm;
uniform float uSurge;
uniform float uWet;       // 地面被雨淋濕的程度（雨停了慢慢乾）

varying vec3 vWorld;
varying vec3 vN;
uniform sampler2D uFoamTex;
uniform vec3 uLamp[8];    // 晚上的燈：(x, z, 亮度)
uniform vec3 uBlob;       // 人物腳下的暗影：(x, z, 濃度)
${shadowRecv}
${isle}
uniform float uWindT;
uniform vec2 uWindDir;
uniform sampler2D uDetail;    // 地面細節：紅 = 草葉、綠 = 沙粒、藍 = 岩石裂紋
uniform sampler2D uDetailN;   // 凹凸：紅綠 = 草、藍與透明度 = 岩石
void main() {
  if (uReflPass > 0.5 && vWorld.y < uReflY) discard;   // 倒影裡不畫鏡面以下的地形
  vec2 q = vWorld.xz;
  float h = vWorld.y;
  vec3 N = normalize(vN);
  float slope = sqrt(max(1.0 - N.y * N.y, 0.0)) / max(N.y, 0.05);
  float n = vnoise(q * 0.05) * 0.6 + vnoise(q * 0.18) * 0.4;        // 大塊的深淺變化
  float fine = vnoise(q * 0.7) * 0.6 + vnoise(q * 2.3) * 0.4;       // 細部
  vec4 look = isleLook(q);
  float near = smoothstep(110.0, 18.0, length(cameraPosition - vWorld));   // 近處才看得到的細節
  // 地面的細節貼圖：近看一份（每 3.7 公尺重複一次），再疊一份大的蓋掉重複感。
  // 座標順著高度錯開，陡坡上的紋路才不會被拉成一條一條
  vec2 dq = q + vec2(h, h * 0.6);
  vec3 detFar = texture2D(uDetail, vec2(dq.y, -dq.x) / 19.0 + 0.37).rgb;
  vec3 det = mix(detFar, 0.7 * texture2D(uDetail, dq / 3.7).rgb + 0.3 * detFar, near);
  vec4 detN = texture2D(uDetailN, dq / 3.7) * 2.0 - 1.0;

  // ---- 岩石：坡陡的地方、礁岩島整片 ----
  float lo = mix(0.52, 0.14, look.r);
  float rockAmt = smoothstep(lo, lo + 0.28, slope + (fine - 0.5) * 0.16 + look.r * 0.3 * (n - 0.35));
  rockAmt = max(rockAmt, smoothstep(0.78, 0.98, look.r));
  float strata = vnoise(vec2(h * 1.5 + n * 6.0 + vnoise(q * 0.23) * 5.0, dot(q, vec2(0.13, 0.08))));   // 一層一層的岩理（扭曲過，不會像等高線）
  vec3 rock = mix(vec3(0.50, 0.45, 0.41), vec3(0.30, 0.32, 0.38), smoothstep(0.55, 1.0, look.r));
  rock *= (0.88 + 0.20 * smoothstep(0.44, 0.56, strata)) * mix(0.60, 1.07, smoothstep(0.16, 0.30, det.b));   // 平塗的岩面上幾道深色的裂紋
  rock = mix(rock, vec3(0.26, 0.31, 0.15), 0.55 * look.g * smoothstep(0.55, 0.95, N.y) * smoothstep(0.35, 0.7, n));   // 平的岩面長青苔
  // 浪打得到的那一段岩石：顏色深、長海藻
  float tide = smoothstep(1.1, 0.2, h);
  rock = mix(rock, rock * vec3(0.42, 0.46, 0.40) + vec3(0.0, 0.035, 0.012) * smoothstep(0.7, -0.5, h), tide);

  // ---- 沙：平常是米黃色，沙洲島是白沙；礁岩多的島沙灘上有小石子 ----
  float grain = det.g;
  vec3 sand = mix(vec3(0.90, 0.76, 0.50), vec3(0.95, 0.89, 0.74), look.b);
  sand *= 0.98 + 0.12 * (grain - 0.5) + 0.08 * (n - 0.5);
  float pebble = near > 0.0 ? smoothstep(0.70, 0.80, vnoise(q * 3.3 + 5.0)) * smoothstep(0.25, 0.6, look.r) * (1.0 - look.b) : 0.0;
  sand = mix(sand, vec3(0.33, 0.31, 0.29) * (0.7 + 0.6 * grain), pebble * near);

  // ---- 草地：有綠有黃，高處的林地顏色深；草木少的島只長成一塊一塊 ----
  float dry = clamp(look.a + (n - 0.5) * 0.9, 0.0, 1.0);
  vec3 grass = mix(vec3(0.21, 0.49, 0.085), vec3(0.55, 0.55, 0.18), dry);
  grass = mix(grass, vec3(0.095, 0.28, 0.09), smoothstep(6.0, 14.0, h + (n - 0.5) * 6.0) * look.g);
  // 草葉：葉尖亮而偏黃，葉縫裡露出深色的土
  grass = mix(grass, grass * vec3(1.32, 1.12, 0.52), 0.6 * smoothstep(0.50, 0.72, vnoise(q * 0.06 + 3.0)));   // 一塊一塊被太陽曬得偏黃的草
  grass *= mix(0.82, 1.13, smoothstep(0.30, 0.70, det.r)) * (0.95 + 0.10 * smoothstep(0.42, 0.58, fine));     // 像一筆一筆塗上去的深淺綠
  grass *= 1.0 + 0.07 * sin(uWindT * 2.0 - dot(q, uWindDir) * 0.33 + n * 9.0);                               // 風吹過草地的波紋
  float cover = clamp(look.g * 1.7 + (n - 0.5) * 1.3, 0.0, 1.0);
  float grassAmt = smoothstep(1.4, 3.0, h + (n - 0.5) * 1.5) * cover;

  vec3 col = mix(sand, grass, grassAmt);
  col = mix(col, rock, rockAmt);
  // 水面下：越深長越多海藻，顏色偏暗綠
  col = mix(col, col * vec3(0.52, 0.66, 0.50), smoothstep(-0.8, -4.5, h) * smoothstep(0.42, 0.7, n));

  // 地表的細小起伏：岩石最粗糙、草地其次、沙最平
  {
    vec2 bg = detN.rg * grassAmt * (1.0 - rockAmt) * 0.15 + detN.ba * rockAmt * 0.45;
    N = normalize(N - vec3(bg.x, 0.0, bg.y) * near);
  }
  // 濕沙：浪打得到的範圍顏色比較深；這一拍剛被水漫過的地方最深、還會反光
  float expo = shoreExpo(shelterAt(q), SHORE_SEA);
  float lift = runup(shorePhase(q, uTime), expo);
  float reach = 0.60 * expo;
  // 乾沙和濕沙的交界是一條看得出來、彎彎曲曲的線（浪上一次漲到最高的地方），從那裡往水邊越來越深
  float hh = h + 0.12 * (vnoise(q * 0.45 + 4.0) - 0.5);
  float damp = 0.55 * smoothstep(reach + 0.17, reach + 0.09, hh) + 0.70 * smoothstep(reach + 0.09, reach - 0.3, hh);
  float hl = h + swashLobe(q, uTime);   // 水的前緣一舌一舌的（跟海面那邊同一個算式）
  float wetNow = smoothstep(lift + 0.09, lift - 0.02, hl);
  float lace = 0.0;   // 水退下去之後留在濕沙上的泡沫
  {
    // 這一拍的浪沖到最高之後往下退：退過的地方沙還是亮的（反光），上面留著一層網狀的泡沫，幾秒內一絲一絲消掉
    float sc = (shorePhase(q, uTime) + SH_K0) / 6.2832 - 0.25, sa = fract(sc);
    float peak = (0.05 + 0.45 * (0.75 + 0.5 * shHash(floor(sc)))) * expo;
    float left = (1.0 - smoothstep(peak - 0.05, peak, hl)) * smoothstep(0.16, 0.24, sa);
    wetNow = max(wetNow, left * (1.0 - smoothstep(0.35, 0.95, sa)));
    lace = left * (1.0 - smoothstep(0.25, 0.8, sa)) * smoothstep(lift - 0.01, lift + 0.03, hl) * (0.3 + 0.7 * smoothstep(0.12, 0.6, expo));
  }
  // 淺水模擬範圍內：真的被水漫過的地方才是濕的，之後慢慢變乾
  vec2 suv;
  float win = sweWin(q, suv);
  if (win > 0.0) {
    // 取四點平均，濕沙的邊緣才不會一格一格的
    vec2 o = vec2(0.6 / uSweSize, 0.0);
    float wetS = 0.25 * (texture2D(uSweWet, suv + o.xy).r + texture2D(uSweWet, suv - o.xy).r
                       + texture2D(uSweWet, suv + o.yx).r + texture2D(uSweWet, suv - o.yx).r);
    float wetE = wetS + 0.035 * (vnoise(q * 0.8 + 4.0) - 0.5) * step(0.01, wetS);
    damp = mix(damp, 0.55 * smoothstep(0.05, 0.10, wetE) + 0.70 * smoothstep(0.10, 0.70, wetE), win);
    wetNow = mix(wetNow, smoothstep(0.82, 1.0, wetS), win);
    lace = mix(lace, smoothstep(0.70, 0.92, wetS) * (1.0 - smoothstep(0.0, 0.03, texture2D(uSwe, suv).r)), win);
  }
  float sandW = (1.0 - rockAmt) * (1.0 - grassAmt);
  float wetK = max(damp * 0.75, wetNow);
  if (sandW > 0.01 && h > -0.5) {
    // 乾沙：一塊一塊深淺略有不同
    float dryK = sandW * (1.0 - smoothstep(0.0, 0.4, wetK));
    col *= 1.0 + dryK * 0.07 * (smoothstep(0.35, 0.65, vnoise(q * 0.09 + 21.0)) - 0.5);
    // 被風吹出來的沙紋：一道道彎彎的平行細紋，一片有、一片沒有；浪打得到的地方被沖平了，沒有。遠處不畫（會閃）
    float ripK = dryK * smoothstep(45.0, 12.0, length(cameraPosition - vWorld)) * smoothstep(0.38, 0.62, vnoise(q * 0.05 + 11.0));
    if (ripK > 0.0) {
      float rs = sin(dot(q, vec2(0.83, 0.56)) * 9.0 + 11.0 * vnoise(q * 0.12 + 3.0) + 3.0 * vnoise(q * 0.5 + 8.0));   // 彎來彎去、有分有合，不是一排整齊的條紋
      col *= 1.0 + ripK * (0.05 * smoothstep(0.5, 0.95, rs) - 0.07 * smoothstep(0.2, 0.9, -rs));
    }
    // 水剛退下去的地方留著一層網狀的泡沫，幾秒內一絲一絲地消掉
    if (lace > 0.0) col = mix(col, vec3(0.96), 0.7 * sandW * foamLace(q * 1.5, 0.0, mix(0.75, 0.40, lace) + 0.12 * (0.5 - shNoise(q * 0.23 + 9.1))));
  }
  // 濕的沙顏色深、偏暖（不是灰的）；岩石和水面下維持原本的深淺
  col *= mix(vec3(1.0), mix(vec3(0.74), vec3(0.64, 0.57, 0.47), sandW * smoothstep(-0.5, 0.0, h)), wetK);
  float rainWet = uWet * step(0.0, h) * (1.0 - 0.55 * grassAmt);   // 沙和岩石濕了最明顯，草地只深一點
  col *= 1.0 - 0.24 * rainWet;

  float shade = sunShadow(vWorld, normalize(vN));
  shade = mix(1.0, shade, exp(min(h, 0.0) / 5.0));   // 水越深，海床上的影子越淡
  float diff = smoothstep(0.02, 0.40, dot(N, uSunDir)) * cloudShadow(q) * shade;   // 受光面大致是同一個亮度，背光面才暗下去
  vec3 light = vec3(0.30, 0.41, 0.52) * uAmbient * (1.0 - 0.3 * uGloom) * (0.78 + 0.22 * N.y) + SUN_COL * vec3(1.13, 1.0, 0.80) * diff * 0.72;   // 陽光偏暖、陰影偏青   // 陰影偏藍、不死黑
  for (int i = 0; i < 8; i++) {
    vec2 ld = q - uLamp[i].xy;
    light += vec3(1.0, 0.70, 0.36) * uLamp[i].z * exp(-dot(ld, ld) / 60.0) * 0.8;
  }
  light += vec3(1.0, 0.93, 0.70) * beamSweep(q) * 0.3;   // 燈塔的光掃過地面
  light *= 1.0 - 0.42 * uBlob.z * smoothstep(0.85, 0.12, length(q - uBlob.xy));   // 人物腳下貼地的一圈暗影

  // 海床上的光紋：兩層反向流動的細胞紋理取交集
  float wd = -h;
  if (wd > 0.0) {
    vec2 cq = q * 0.055;
    float c1 = texture2D(uFoamTex, cq + uTime * vec2(0.013, 0.007)).r;
    float c2 = texture2D(uFoamTex, cq * 1.37 - uTime * vec2(0.009, 0.014) + 0.37).r;
    float ca = pow(min(c1, c2) * 1.9, 4.0);
    light += SUN_COL * ca * 0.9 * smoothstep(0.0, 1.0, wd) * exp(-wd / 16.0) * max(uSunDir.y, 0.0) * 2.0;
  }
  col *= light;
  // 剛被水漫過的沙像一面鏡子：越斜著看映出的天色越多，朝太陽的方向有一片柔柔的反光。雨天的地面只泛一點天光
  {
    vec3 Vv = normalize(cameraPosition - vWorld);
    vec3 R = reflect(-Vv, vec3(0.0, 1.0, 0.0));
    float gloss = wetNow * sandW;
    float shine = max(wetNow * 0.22, max(gloss * (0.14 + 0.45 * pow(1.0 - clamp(Vv.y, 0.0, 1.0), 3.0)), rainWet * 0.13 * (1.0 - grassAmt)));
    col = mix(col, skyGradient(R) * 0.7, shine * step(0.0, h));
    col += SUN_COL * 0.22 * gloss * step(0.0, h) * shade * pow(max(dot(R, uSunDir), 0.0), 60.0);
  }

  if (uUnder > 0.5) {
    col *= exp(-max(wd, 0.0) * vec3(0.085, 0.03, 0.022));   // 越深紅光越先被吸收
    col = applyUnderFog(col, vWorld);
  } else {
    // 從水面上看下去：水越深，海床越暗、越偏藍綠（紅光先被吸收），不會在深處還看到亮亮的沙
    col *= exp(-max(wd, 0.0) * vec3(0.50, 0.20, 0.11));
    col = applyFog(col, vWorld);
  }
  // 長草的地面 alpha 也大於 1（同上：草葉之間露出來的地面不要被壓黑）
  gl_FragColor = vec4(col, uReflPass > 0.5 ? 1.0 - smoothstep(300.0, 440.0, length(cameraPosition - vWorld)) : 1.0 + grassAmt);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = viewMatrix * vec4(position, 0.0);
  gl_Position = (projectionMatrix * vec4(mv.xyz, 1.0)).xyww;
  gl_Position.z *= 0.999999;   // 貼著最遠的那一層，但不能剛好等於 1（會被清空時的深度擋掉）
}
`;

export const skyFrag = /* glsl */ `
${common}
varying vec3 vDir;
uniform float uRainbow;   // 彩虹有多明顯（雨停、太陽出來之後才有）

// 彩虹：一道以「背對太陽的方向」為圓心、半徑約 42 度的弧。太陽越低弧越高；太陽太高時整道弧都在地平線下，看不到。
// 卡通風：七條清楚的色帶，帶與帶之間稍微暈開，內外兩緣淡出
vec3 rainbow(vec3 d) {
  if (uRainbow <= 0.002 || d.y <= 0.0) return vec3(0.0);
  float ang = degrees(acos(clamp(dot(d, -uSunDir), -1.0, 1.0)));
  float t = (ang - 39.4) / 3.4;   // 0 = 內緣（紫）、1 = 外緣（紅）
  if (t < -0.2 || t > 1.2) return vec3(0.0);
  const vec3 BOW[7] = vec3[7](vec3(0.56, 0.36, 0.92), vec3(0.34, 0.42, 0.95), vec3(0.25, 0.68, 1.0), vec3(0.35, 0.90, 0.48),
                              vec3(1.0, 0.93, 0.35), vec3(1.0, 0.62, 0.25), vec3(1.0, 0.32, 0.30));
  float x = clamp(t, 0.0, 0.999) * 7.0;
  int i = int(floor(x));
  vec3 c = mix(BOW[i], BOW[min(i + 1, 6)], smoothstep(0.62, 1.0, fract(x)));
  float band = smoothstep(-0.06, 0.10, t) * smoothstep(1.06, 0.90, t);
  return c * band * uRainbow * smoothstep(0.0, 0.07, d.y);   // 靠近地平線的兩隻腳淡進霧裡
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyColor(d);
  col = mix(col, col * 0.80, 0.5 * length(rainbow(d))) + rainbow(d) * 0.70 * (1.0 - 0.5 * clamp(col, 0.0, 1.0));   // 疊在天空和雲上；雲很白的地方淡一點，不會過曝
  col = mix(col, mix(vec3(0.52, 0.68, 0.80), vec3(0.37, 0.41, 0.45), uGloom) * uAmbient, smoothstep(0.0, -0.08, d.y));
  col = mix(col, vec3(0.70, 0.74, 0.78) * uAmbient, uFog * (0.35 + 0.6 * (1.0 - smoothstep(0.0, 0.45, d.y))));
  if (uUnder > 0.5) col = underFogCol();
  gl_FragColor = vec4(col, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---- 診斷（?diag）----
// 在顯示晶片上照海面頂點著色器的算法，算一次某一點的輸入值，畫進一張 3×1 的浮點貼圖再讀回來顯示：
// 手機上海面形狀不對時，拿來比對哪一項跟電腦算的不一樣
export const diagPtFrag = /* glsl */ `
varying vec4 vDiagOut;
void main() { gl_FragColor = vDiagOut; }
`;
export const diagVert = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
export const diagFrag = /* glsl */ `
${bed}
${waveDecl}
${shore}
${swe}
uniform float uTime;
uniform vec2 uDiagP;
void main() {
  vec2 xz = uDiagP;
  float bedH = bedAt(xz), shel = shelterAt(xz), dg = dangerAt(xz), sd = shoreDist(xz);
  float ph = shorePhase(xz, uTime), expo = shoreExpo(shel, SHORE_SEA);
  float lift = runup(ph, expo) * (1.0 - smoothstep(0.0, 2.5, -bedH));
  float pre;
  float sw = sd < 66.0 ? swell(sd, ph, xz, expo, pre).x : 0.0;
  float depthFade = smoothstep(0.3, 8.0, -bedH) * waveScale(dg, shel) * shel;
  vec3 d = (textureLod(uDisp0, xz / uPatch.x, 0.0).xyz + textureLod(uDisp1, xz / uPatch.y, 0.0).xyz) * depthFade;
  vec2 suv;
  float win = sweWin(xz, suv);
  int i = int(gl_FragCoord.x);
  vec2 q0 = xz / uPatch.x;
  gl_FragColor = i == 0 ? vec4(bedH, shel, dg, sd) : i == 1 ? vec4(lift, sw, d.y, win) : i == 2 ? vec4(expo, ph, uWaveScale, depthFade)
    : vec4(textureLod(uDisp0, q0, 2.0).y, textureLod(uDisp0, q0, 4.0).y, textureLod(uDisp0, q0, 6.0).y, textureLod(uDisp1, xz / uPatch.y, 4.0).y);   // 浪高圖的縮小版（第 2、4、6 層；第二層浪的第 4 層）
}
`;

// ---- 手機版的海面 -----------------------------------------------------------
// 同一片海（浪高、浪向、巨浪、漩渦、潮汐都跟電腦版一樣，別人的船才會浮在你看到的水面上），但畫法便宜很多：
//   浪：不讓顯示晶片每幀算 FFT，直接拿背景執行緒替船算好的那兩層（ocean.js 的 lite），前後兩張之間內插
//   網格：頂點只有電腦版的七分之一
//   上色：卡通式的——幾個平塗的水色、天空只映漸層、白沫是簡單的色塊；沒有倒影貼圖、影子、岸邊捲浪的細節
const LITE_GRID = 0.07;   // 手機版網格的間距（公尺）大約是離中心距離的幾倍（見 main.js 的 makePolarGeometry(160, 150)）
const liteDecl = /* glsl */ `
uniform sampler2D uBed16;   // 海床高度（16 位元浮點、可以直接線性取樣：一次就拿到，不用自己取四格內插）
uniform vec2 uLK;           // 前後兩張浪之間，現在落在哪（兩層各一個 0–1）
uniform float uLOff;        // 背景執行緒的格子跟畫面貼圖差的那半格
float bedLite(vec2 xz) { return textureLod(uBed16, clamp(xz / uL + 0.5, 0.0, 1.0), 0.0).r; }
`;
export const liteWaterVert = /* glsl */ `
${bed}
${waveDecl}
${shore}
${liteDecl}
${vortexFn}
uniform sampler2D uLD0A, uLD0B, uLD1A, uLD1B;   // 兩層浪的位移 (Dx, h, Dz)，各有前後兩張
uniform vec2 uCenter;
uniform vec2 uMeshRot;
uniform float uTime;
varying vec3 vWorld;
varying vec2 vP0;
varying vec4 vInfo;   // (這裡的浪剩幾成, 這裡的浪高倍率, 風浪的高度, 避浪係數)
varying vec3 vBig;    // (水位：巨浪＋潮汐, 大形狀的斜率 x, z：巨浪、長浪)
varying vec2 vFx;     // (巨浪浪頭的白沫, 在漩渦的漏斗裡陷下去多深)
void main() {
  vec2 xz = vec2(position.x * uMeshRot.x - position.z * uMeshRot.y, position.x * uMeshRot.y + position.z * uMeshRot.x) + uCenter;
  for (int i = 0; i < 3; i++) {
    vec4 v = uVortex[i];
    if (v.z <= 0.0 || v.w > 1.5) continue;
    vec2 dd = xz - v.xy;
    xz = v.xy + dd * (1.0 - 0.62 * exp(-length(dd) / 70.0));
  }
  vec2 vY = vortexY(xz);
  float bedH = bedLite(xz), shel = shelterAt(xz), danger = dangerAt(xz);
  float ws = waveScale(danger, shel);
  float amp = smoothstep(0.3, 8.0, -bedH) * ws * shel * vY.y;
  float spacing = ${LITE_GRID.toFixed(3)} * length(position.xz) + 0.3;
  float lod0 = log2(max(spacing * 1.6 * 128.0 / uPatch.x, 1.0));
  float lod1 = log2(max(spacing * 1.6 * 128.0 / uPatch.y, 1.0));
  vec2 wq = toWave(xz), u0 = wq / uPatch.x + uLOff, u1 = wq / uPatch.y + uLOff;
  vec3 d = mix(textureLod(uLD0A, u0, lod0).xyz, textureLod(uLD0B, u0, lod0).xyz, uLK.x)
         + mix(textureLod(uLD1A, u1, lod1).xyz, textureLod(uLD1B, u1, lod1).xyz, uLK.y);
  d *= amp;
  d.xz = fromWave(d.xz);
  vec3 big = vec3(uTide, 0.0, 0.0);
  float swY = 0.0, crest = 0.0;
  if (uSwell > 0.01) {
    vec3 s = swellK(danger, shel) * longSwell(xz);
    swY = s.x * smoothstep(70.0, 25.0, spacing);
    big.yz += s.yz;
  }
  if (uTsu.w > 0.0) {
    float tK = tsuKAt(xz), hk = tsuHK(tK);
    vec4 ti;
    vec3 tw = tsuWave(xz, spacing * 1.5, ti) * hk;
    tw.x += tsuEbb(xz, tK, uTsu);
    big += tw;
    // 浪頂翻白：靠近島、堆高了的那一段才有；背面拖著一片碎白沫
    float strong = min(ti.w * hk / ${f3(TSU_H.peak)}, 1.0);
    crest = strong * (smoothstep(0.55, 0.95, ti.y) * (0.35 + 0.65 * tsuBreak(dot(xz, vec2(uTsu.y, -uTsu.x)), ti.z, tK, uTime))
                    + 0.8 * step(ti.x, 0.0) * exp(0.85 * ti.x) * smoothstep(0.85, 0.45, tK));
  }
  float ph = shorePhase(xz, uTime), expo = shoreExpo(shel, SHORE_SEA);
  float lift = runup(ph, expo) * (1.0 - smoothstep(0.0, 2.5, -bedH));
  vec3 pos = vec3(xz.x + d.x, d.y + big.x + vY.x + swY + lift, xz.y + d.z);
  vP0 = xz;
  vInfo = vec4(amp, ws, d.y, shel);
  vBig = big;
  vFx = vec2(crest, -vY.x);
  vWorld = pos;
  vTsu = vec3(0.0); vCurlN = vec3(0.0, 1.0, 0.0); vCurl = vec2(0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

export const liteWaterFrag = /* glsl */ `
${common}
${bed}
${waveDecl}
${shore}
${liteDecl}
uniform sampler2D uLS0A, uLS0B, uLS1A, uLS1B;   // 兩層浪的 (斜率 x, 斜率 z, 白浪)，各有前後兩張
uniform sampler2D uFoamTex;
uniform sampler2D uRipTex;   // 細碎的波紋（固定的一張圖，兩份錯開著流動）
uniform float uPixelAngle;
uniform float uHs;
uniform vec4 uWake[16];
uniform vec4 uWakeBox;
uniform vec3 uLamp[8];
uniform float uLampOn;
uniform float uVortexOn;
varying vec3 vWorld;
varying vec2 vP0;
varying vec4 vInfo;
varying vec3 vBig;
varying vec2 vFx;
void main() {
  float bedH = bedLite(vWorld.xz);
  float sd = shoreDist(vWorld.xz);
  float shel = vInfo.w, amp = vInfo.x, ws = vInfo.y;
  float ph = shorePhase(vWorld.xz, uTime), expo = shoreExpo(shel, SHORE_SEA);
  float depth = runup(ph, expo) * (1.0 - smoothstep(0.0, 2.5, -bedH)) - bedH + vBig.x;
  if (depth < 0.004) discard;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float fp = dist * uPixelAngle / max(V.y, 0.06);
  float texFade = clamp(1.2 / fp, 0.0, 1.0);

  // ---- 水面的坡度：兩層浪（前後兩張內插）＋巨浪、長浪的大形狀＋細碎的波紋 ----
  vec2 wq = toWave(vP0);
  vec2 u0 = wq / uPatch.x + uLOff, u1 = wq / uPatch.y + uLOff;
  vec4 s0 = mix(texture2D(uLS0A, u0), texture2D(uLS0B, u0), uLK.x);
  vec4 s1 = mix(texture2D(uLS1A, u1), texture2D(uLS1B, u1), uLK.y);
  vec2 rp = texture2D(uRipTex, vP0 * 0.115 + uTime * vec2(0.021, 0.013)).rg + texture2D(uRipTex, vP0 * 0.047 - uTime * vec2(0.011, 0.017)).rg - 1.0;
  float ripK = (0.05 + 0.09 * min(ws, 1.6) * max(shel, 0.45)) * smoothstep(0.0, 1.0, depth) * texFade;
  vec2 sl = fromWave((s0.rg + s1.rg) * amp) + vBig.yz + rp * ripK;
  vec3 N = normalize(vec3(-sl.x, 1.0, -sl.y));
  float ndv = max(dot(N, V), 0.0);
  float sunUp = max(uSunDir.y, 0.0);
  float lv = max(uSunCol.r, max(uSunCol.g, uSunCol.b));

  // ---- 映著天空（只有漸層，沒有雲和倒影貼圖）----
  float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  F *= mix(mix(0.42, 0.72, uGloom), 1.0, smoothstep(120.0, 700.0, dist));
  vec3 R = reflect(-V, N);
  R.y = abs(R.y) + 0.02;
  vec3 refl = skyGradient(normalize(R));
  float glow = uDusk * (1.0 - uGloom);
  F = max(F, glow * 0.45 * pow(1.0 - ndv, 1.5));

  // ---- 水體顏色：淺灘土耳其綠 → 青藍 → 深海鈷藍 ----
  vec3 shallow = mix(vec3(0.10, 0.74, 0.64), vec3(0.11, 0.36, 0.37), 0.8 * uGloom);
  vec3 midsea = mix(vec3(0.015, 0.42, 0.64), vec3(0.02, 0.17, 0.29), 0.8 * uGloom);
  vec3 deep = mix(vec3(0.006, 0.12, 0.42), vec3(0.006, 0.075, 0.22), 0.6 * uGloom);
  float dcol = min(depth, 0.35 + 0.17 * sd);
  float dz = 1.0 - exp(-dcol * (0.20 + 0.30 * uGloom));
  vec3 scatter = mix(mix(shallow, midsea, smoothstep(0.0, 0.5, dz)), deep, smoothstep(0.4, 0.95, dz));
  float hole = exp(-vFx.y / 13.0);   // 漩渦的漏斗裡越深越暗
  scatter *= (0.40 * uAmbient + 0.75 * sunUp * mix(vec3(lv), uSunCol, 0.6)) * (1.0 - 0.40 * glow) * mix(1.0, hole, 0.6);
  // 浪頭透出青綠色
  float h01 = clamp(vInfo.z / max(uHs * ws * 0.55, 0.3), 0.0, 1.3);
  scatter += vec3(0.0, 0.50, 0.38) * h01 * 0.28 * min(amp, 1.0) * (0.3 + 0.9 * sunUp) * max(lv, uAmbient.g * 0.6);

  // ---- 太陽的反光：一顆一顆清楚的亮點 ----
  vec3 Hh = normalize(V + uSunDir);
  float ndh = max(dot(N, Hh), 0.0);
  vec3 spec = SUN_COL * smoothstep(0.55, 0.75, pow(ndh, 260.0 - 180.0 * glow)) * (1.5 + 1.5 * glow) * texFade;

  float T = exp(-1.15 * dcol - 0.5 * max(depth - dcol, 0.0) - dist / 110.0);
  float alpha = 1.0 - (1.0 - F) * T;
  vec3 col = (F * refl * mix(1.0, hole, 0.9) + spec + (1.0 - F) * (1.0 - T) * scatter) / max(alpha, 1e-3);
  // 朝太陽的小波面亮一階、背著的暗一階
  float facet = clamp(dot(N.xz, normalize(uSunDir.xz + 1e-4)) / max(N.y, 0.3) * 9.0, -1.0, 1.0) * clamp(0.3 / fp, 0.0, 1.0);
  col *= 1.0 + 0.10 * facet;
  alpha *= smoothstep(0.0, 0.10, depth) * (0.5 + 0.5 * smoothstep(0.0, 0.5, depth));

  // ---- 白沫 ----
  float ft = texture2D(uFoamTex, vP0 * 0.045 + uTime * vec2(0.004, 0.002)).r;
  ft = mix(0.55, ft, texFade);
  float cov = (s0.b * 1.1 + s1.b * 0.8) * min(amp * 1.4, 1.0);                         // 風浪的白浪
  float gale = smoothstep(0.75, 1.55, uStorm);
  if (gale > 0.0) col = mix(col, vec3(dot(col, vec3(0.30, 0.50, 0.20))) * vec3(0.76, 0.97, 1.0), 0.45 * gale);   // 風暴裡的水偏灰綠
  // 岸邊：一道一道往岸上推的白線，最前緣一圈碎泡沫
  if (sd < 46.0) {
    float th = (shK(sd) + ph) / 6.2832, f = fract(th);
    float calm = smoothstep(0.12, 0.6, expo);
    float line = smoothstep(0.38, 0.5, f) * smoothstep(0.66, 0.5, f) * smoothstep(46.0, 26.0, sd) * smoothstep(13.0, 7.0, sd) * (0.35 + 0.65 * shHash(floor(th)));
    float trail = smoothstep(0.5, 0.62, f) * (1.0 - smoothstep(0.62, 1.0, f)) * smoothstep(12.0, 5.0, sd) * 0.6;
    cov += calm * (0.9 * line + trail) * (0.6 + 0.4 * ft);
    cov += smoothstep(0.30, 0.02, depth) * (0.35 + 0.6 * ft) * (0.5 + 0.5 * calm) * (1.0 - 0.6 * smoothstep(0.3, 0.9, swashAge(ph)));
  }
  cov += vFx.x * (0.75 + 0.5 * ft);                                                    // 巨浪的浪頭、背面的白水
  if (uVortexOn > 0.5) {
    for (int i = 0; i < 3; i++) {
      vec4 v = uVortex[i];
      if (v.z <= 0.0) continue;
      vec2 dd = vWorld.xz - v.xy;
      float r = length(dd), th = atan(dd.y, dd.x), lr = log(r + 20.0);
      // 順著水流（風）繞的幾道白沫，越靠近中心越密
      float arm = smoothstep(0.35, 0.85, sin(3.0 * th + 9.0 * lr + uTime * (v.w < 1.5 ? 0.9 : 1.5)));
      float near = v.w < 1.5 ? smoothstep(330.0, 40.0, r) : smoothstep(480.0, 60.0, r);
      cov += v.z * near * (0.25 + 0.75 * arm) * (0.5 + 0.6 * ft) + v.z * smoothstep(v.w < 1.5 ? 30.0 : 90.0, 10.0, r) * 0.6;
    }
  }
  vec2 wkd = vWorld.xz - uWakeBox.xy;
  if (uWakeBox.w > 0.5 && dot(wkd, wkd) < uWakeBox.z * uWakeBox.z)
  for (int i = 0; i < 16; i++) {                                                       // 船的航跡
    vec4 wk = uWake[i];
    float age = uTime - wk.z;
    if (wk.w <= 0.0 || age < 0.0 || age > 30.0) continue;
    vec2 dd = vWorld.xz - wk.xy;
    float r = 1.8 + age * 0.9;
    cov += wk.w * exp(-dot(dd, dd) / (r * r)) * exp(-age / 4.5) * 0.4;
  }
  cov = clamp(cov, 0.0, 1.2);
  float fraw = smoothstep(0.0, 0.35, cov - (1.0 - ft) * 1.05) * smoothstep(0.0, 0.07, depth);
  fraw = max(fraw, smoothstep(0.75, 1.15, cov) * 0.85);
  float foam = smoothstep(0.24, 0.52, fraw);
  float lace = smoothstep(0.02, 0.26, fraw) * (1.0 - foam);
  vec3 foamCol = vec3(0.99) * (0.60 * uAmbient + (0.34 + 0.22 * sunUp) * lv) * mix(1.0, hole, 0.55);
  col = mix(col, foamCol * vec3(0.84, 0.96, 1.0), lace * 0.40);
  col = mix(col, foamCol, foam * 0.93);
  alpha = max(alpha, max(foam, lace * 0.55));
  // 晚上燈光照在水面上
  if (uLampOn > 0.0)
  for (int i = 0; i < 8; i++) {
    if (uLamp[i].z <= 0.0) continue;
    vec2 ld = vWorld.xz - uLamp[i].xy;
    col += vec3(1.0, 0.70, 0.36) * uLamp[i].z * exp(-dot(ld, ld) / 70.0) * (0.22 + 0.45 * foam);
  }
  col += vec3(1.0, 0.93, 0.70) * beamSweep(vWorld.xz) * (0.16 + 0.24 * foam);
  if (uUnder > 0.5) {
    // 從水下往上看：正上方透著天光，斜著看是水的顏色
    col = applyUnderFog(mix(underFogCol() * 1.35, skyGradient(vec3(0.0, 1.0, 0.0)) * vec3(0.78, 0.96, 1.0), smoothstep(0.55, 0.9, abs(V.y))) * (1.0 - 0.55 * foam), vWorld);
    alpha = 1.0;
  } else col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
