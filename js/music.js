"use strict";

/* =========================================================
 * 白噪音组件:雨声 / 海浪 / 篝火 / 风声 / 溪流
 * 音源:扩展本地打包的 mixkit 免费音效(mp3,循环播放)
 * 零网络、无版权费用,循环播放可掩盖接缝
 * ======================================================== */

const NOISE_LIST = [
  { title: "雨声", emoji: "🌧", url: "audio/rain.mp3", grad: "linear-gradient(135deg,#4facfe,#00f2fe)", color: "#4facfe" },
  { title: "海浪", emoji: "🌊", url: "audio/ocean.mp3", grad: "linear-gradient(135deg,#2193b0,#6dd5ed)", color: "#2193b0" },
  { title: "篝火", emoji: "🔥", url: "audio/fire.mp3", grad: "linear-gradient(135deg,#f7971e,#ffd200)", color: "#f7971e" },
  { title: "风声", emoji: "🍃", url: "audio/wind.mp3", grad: "linear-gradient(135deg,#56ab2f,#a8e063)", color: "#56ab2f" },
  { title: "溪流", emoji: "🏞", url: "audio/stream.mp3", grad: "linear-gradient(135deg,#43e97b,#38f9d7)", color: "#43e97b" },
];

const NOISE_IDX_KEY = "noiseIdx";      // local: 当前音效索引(刷新/导入导出恢复)
const NOISE_PLAYING_KEY = "noisePlaying"; // local: 播放状态(刷新后尝试续播,受自动播放策略限制)
const NOISE_SUSPEND_KEY = "noiseSuspend"; // local: 因隐藏卡片/切清爽模式暂停 → 恢复时续播标志

const noise = {
  idx: 0,
  playing: false,
  audio: null,
  skipGuard: 0, // 连续加载失败自动跳音效计数(防止无限循环)
  wasPlaying: false, // 因隐藏/切清爽被暂停前的播放状态(恢复时续播)
};

/* ===== 拾音频谱图(打砖块样式) ===== */
let spectrumCtx = null;
let spectrumAnalyser = null;
let spectrumCanvas = null;
let spectrumRaf = 0;
let spectrumInited = false;

/** 初始化频谱:AudioContext + Analyser + canvas(封面 2/4+ 高度显示) */
function noiseSpectrumInit() {
  if (spectrumInited || !noise.audio) return;
  const cover = document.getElementById("music-cover");
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!cover || !AC) return;
  try {
    spectrumCtx = new AC();
    spectrumAnalyser = spectrumCtx.createAnalyser();
    spectrumAnalyser.fftSize = 256;
    spectrumAnalyser.smoothingTimeConstant = 0.82;
    const src = spectrumCtx.createMediaElementSource(noise.audio);
    src.connect(spectrumAnalyser);
    spectrumAnalyser.connect(spectrumCtx.destination);

    spectrumCanvas = document.createElement("canvas");
    spectrumCanvas.className = "music-spectrum";
    cover.appendChild(spectrumCanvas);
    const card = document.querySelector(".music-card");
    spectrumCanvas.style.display =
      card && parseInt(card.dataset.height, 10) >= 2 ? "block" : "none";

    // 按设备像素比适配封面尺寸
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const r = cover.getBoundingClientRect();
      if (!r.width || !r.height) return;
      spectrumCanvas.width = Math.round(r.width * dpr);
      spectrumCanvas.height = Math.round(r.height * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    spectrumInited = true;
    noiseSpectrumDraw();
  } catch (e) { /* 忽略(不支持或音频源已被占用) */ }
}

/** 绘制循环:点阵柱——每个方块 = 4 列 × 3 行白点矩阵,点小且密,柱数更多 */
function noiseSpectrumDraw() {
  spectrumRaf = requestAnimationFrame(noiseSpectrumDraw);
  const cv = spectrumCanvas;
  const an = spectrumAnalyser;
  if (!cv || !an) return;
  const g = cv.getContext("2d");
  const w = cv.width;
  const h = cv.height;
  g.clearRect(0, 0, w, h);
  // 未播放或音频上下文未激活:频谱静止
  if (!spectrumCtx || spectrumCtx.state === "suspended") return;

  const data = new Uint8Array(an.frequencyBinCount);
  an.getByteFrequencyData(data);

  const BARS = 44;          // 柱数(方块变小后更多)
  const dot = 1.5;          // 圆点直径(小)
  const cols = 3;           // 每方块横向 3 列(横三)
  const rows = 2;           // 每方块纵向 2 行(纵二)
  const dotGap = 0.5;       // 点间距(更密)
  const blockW = cols * dot + (cols - 1) * dotGap; // 方块宽
  const blockH = rows * dot + (rows - 1) * dotGap; // 方块高
  const gap = 1;            // 柱间距
  const blockGap = dotGap;  // 方块纵向间距 = 点阵点纵向间距(视觉连续一致)
  const maxBlocks = Math.max(1, Math.floor((h - 6) / (blockH + blockGap)));
  const totalW = BARS * blockW + (BARS - 1) * gap;
  const startX = Math.max(0, (w - totalW) / 2); // 整组居中
  // 白噪音能量集中在中低频,取前 60% 频段
  for (let i = 0; i < BARS; i++) {
    const idx = Math.floor((i / BARS) * data.length * 0.6);
    const v = data[idx] / 255;
    const blocks = Math.round(v * v * maxBlocks); // 平方曲线,低能量时更细腻
    const bx = startX + i * (blockW + gap);
    for (let b = 0; b < blocks; b++) {
      const by = h - 5 - (b + 1) * (blockH + blockGap);
      // 3×2 白点矩阵填充方块(横三纵二)
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          g.beginPath();
          g.arc(bx + c * (dot + dotGap) + dot / 2, by + r * (dot + dotGap) + dot / 2, dot / 2, 0, Math.PI * 2);
          g.fillStyle = "rgba(255,255,255,0.55)"; // 白色点阵(半透明)
          g.fill();
        }
      }
    }
  }
}

/** 暂停并记忆续播意图:隐藏白噪音卡片 / 切换到清爽模式时调用 */
function noiseSuspend() {
  if (!noise.audio) return;
  if (noise.playing) {
    noise.wasPlaying = true;
    try { chrome.storage.local.set({ [NOISE_SUSPEND_KEY]: true }); } catch (e) { /* 忽略 */ }
    noise.audio.pause(); // onpause 正常置 playing=false(界面按钮同步)
  }
}

/** 确保音频 src 为当前音效索引:刷新后 initMusic 提前创建的 audio 可能是默认雨声(src 未随 idx 恢复更新) */
function noiseEnsureSrc() {
  if (!noise.audio) { noiseLoad(); return; }
  const expectUrl = noiseCurrent().url;
  const cur = noise.audio.src || "";
  if (!cur.endsWith(expectUrl)) noiseLoad(); // 换过音效:重新加载正确 src
}

/** 恢复续播:重新显示白噪音卡片 / 切回网格模式时调用 */
function noiseResume() {
  if (!noise.audio || !noise.wasPlaying) return;
  noise.wasPlaying = false;
  try { chrome.storage.local.remove(NOISE_SUSPEND_KEY); } catch (e) { /* 忽略 */ }
  noiseEnsureSrc(); // 确保播放当前音效(刷新后 src 可能还是默认雨声)
  noiseResumeCtx();
  noise.audio.play().catch(() => { /* 忽略 */ });
}
window.__noiseSuspend = noiseSuspend; // 供 main.js 隐藏卡片/模式切换调用
window.__noiseResume = noiseResume;

/** 播放时唤醒音频上下文(需用户手势) */
function noiseResumeCtx() {
  if (spectrumCtx && spectrumCtx.state === "suspended") {
    spectrumCtx.resume().catch(() => { /* 忽略 */ });
  }
}

function noiseCurrent() {
  return NOISE_LIST[noise.idx % NOISE_LIST.length];
}

/** 秒 → m:ss */
function fmtTime(s) {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ":" + String(sec).padStart(2, "0");
}

/** 持久化当前音效索引与播放状态(刷新/导入导出后恢复) */
function noiseSave() {
  try {
    chrome.storage.local.set({ [NOISE_IDX_KEY]: noise.idx, [NOISE_PLAYING_KEY]: noise.playing });
  } catch (e) { /* 忽略 */ }
}

function noiseRender() {
  const n = noiseCurrent();
  const cover = document.getElementById("music-cover");
  const emoji = document.getElementById("music-cover-emoji");
  const title = document.getElementById("music-title");
  if (cover) cover.style.background = n.grad;
  if (emoji) emoji.textContent = n.emoji;
  if (title) title.innerHTML = '<span class="title-icon">🎵</span> 白噪音 · ' + n.title;
  // 主色 CSS 变量:进度条/按钮色系与封面渐变联动
  document.documentElement.style.setProperty("--noise-accent", n.color);
  const toggle = document.getElementById("music-toggle");
  if (toggle) {
    toggle.textContent = noise.playing ? "⏸" : "▶";
    toggle.title = noise.playing ? "暂停" : "播放";
  }
}

function noiseLoad() {
  const n = noiseCurrent();
  if (!noise.audio) noise.audio = new Audio();
  const a = noise.audio;
  // 先彻底停止旧播放,避免换 src 时旧 play() 的 rejection 干扰
  a.onerror = null;
  a.onended = null;
  try { a.pause(); } catch (e) { /* 忽略 */ }
  try { a.removeAttribute("src"); a.load(); } catch (e) { /* 忽略 */ }
  a.src = n.url;
  a.loop = true; // 白噪音循环播放(不自动切下一个音效)
  a.volume = 0.8;

  // 进度条 + 时长(单曲循环,进度展示当前播放段)
  a.onloadedmetadata = () => {
    const dur = document.getElementById("music-time-dur");
    const bar = document.getElementById("music-bar");
    const cur = document.getElementById("music-time-cur");
    if (dur && a.duration) dur.textContent = fmtTime(a.duration);
    if (bar) bar.style.width = "0%";
    if (cur) cur.textContent = "0:00";
  };
  a.ontimeupdate = () => {
    const bar = document.getElementById("music-bar");
    const cur = document.getElementById("music-time-cur");
    if (bar && a.duration) bar.style.width = Math.min(100, (a.currentTime / a.duration) * 100) + "%";
    if (cur) cur.textContent = fmtTime(a.currentTime);
  };

  // 真正加载失败(本地文件缺失等):有限次数自动跳音效,防止无限循环
  a.onerror = () => {
    if (noise.playing && noise.skipGuard < NOISE_LIST.length) {
      noise.skipGuard++;
      noiseNext();
    } else {
      noise.skipGuard = 0;
      noise.playing = false;
      noiseRender();
    }
  };
  a.onplay = () => { noise.playing = true; noiseSave(); noiseRender(); };
  a.onpause = () => { noise.playing = false; noiseSave(); noiseRender(); };
  noiseRender();
  noiseSpectrumInit(); // 音频元素就绪后初始化频谱图(仅一次)
}

function noisePlay() {
  if (!noise.audio) noiseLoad();
  noiseResumeCtx(); // 用户手势:激活频谱音频上下文
  // 忽略 play() rejection:切换时 src 变更会让旧 play 报错,那是正常现象;
  // 真正的加载失败由 audio.onerror 处理(带跳音效上限)
  noise.audio.play().catch(() => { /* 忽略 */ });
}

function noiseToggle() {
  if (!noise.audio) { noiseLoad(); noisePlay(); return; }
  if (noise.playing) { noise.audio.pause(); }
  else { noiseResumeCtx(); noise.audio.play().catch(() => { /* 忽略 */ }); }
  noiseSave();
}

function noiseNext() {
  noise.idx = (noise.idx + 1) % NOISE_LIST.length;
  const wasPlaying = noise.playing;
  noiseLoad();
  if (wasPlaying) noise.audio.play().catch(() => { /* 忽略 */ });
  else noiseRender();
  noiseSave();
}

function noisePrev() {
  const a = noise.audio;
  if (a && a.currentTime > 3) { a.currentTime = 0; return; }
  noise.idx = (noise.idx - 1 + NOISE_LIST.length) % NOISE_LIST.length;
  const wasPlaying = noise.playing;
  noiseLoad();
  if (wasPlaying) noise.audio.play().catch(() => { /* 忽略 */ });
  else noiseRender();
  noiseSave();
}

function initMusic() {
  const toggle = document.getElementById("music-toggle");
  const prev = document.getElementById("music-prev");
  const next = document.getElementById("music-next");
  if (toggle) toggle.addEventListener("click", noiseToggle);
  if (prev) prev.addEventListener("click", noisePrev);
  if (next) next.addEventListener("click", noiseNext);
  noiseRender();
  // 档位变化:2/4+ 显示频谱图,1/4 隐藏(封面整个隐藏)
  window.onCardHeight && window.onCardHeight(function () {
    if (!spectrumCanvas) return;
    const card = document.querySelector(".music-card");
    spectrumCanvas.style.display =
      card && parseInt(card.dataset.height, 10) >= 2 ? "block" : "none";
  });
  // 页面加载即初始化音频元素(不播放)与频谱图:2/4+ 封面频谱即时可用(未播放时静止)
  if (!noise.audio) noiseLoad();
  noiseSpectrumInit();
  // 恢复上次的音效选择与播放状态(刷新/导入后);
  // 优先级:因隐藏/切清爽暂停的标志(恢复续播) > 上次播放中(尝试续播)
  try {
    chrome.storage.local.get([NOISE_IDX_KEY, NOISE_PLAYING_KEY, NOISE_SUSPEND_KEY]).then((r) => {
      const savedIdx = r[NOISE_IDX_KEY];
      if (typeof savedIdx === "number" && savedIdx >= 0 && savedIdx < NOISE_LIST.length) {
        noise.idx = savedIdx;
        // 同步音频 src 为恢复的音效:页面加载初期已用默认雨声创建 audio,
        // 若只更新封面而不重载 src,点击播放会用雨声(与封面不符)——
        // 「上次播放中」分支有 noiseEnsureSrc,暂停分支此前遗漏
        noiseEnsureSrc();
        noiseRender();
      }
      if (r[NOISE_SUSPEND_KEY]) {
        // 之前因隐藏卡片/切清爽模式暂停:切回网格后恢复续播
        noise.wasPlaying = true;
        noiseResume();
      } else if (r[NOISE_PLAYING_KEY] === true) {
        // 上次在播放:尝试续播。受浏览器自动播放策略限制,无用户手势会被拒绝。
        // 此时仅把 UI 置为暂停(实际无声,按钮显示 ▶);**不回写 storage**,
        // 保留"上次播放中"的真实记录(导出配置/下次刷新仍可见并会再次尝试)。
        noiseEnsureSrc(); // 确保音频 src 为当前音效(换过音效时重新加载,避免播放默认雨声)
        noise.audio.play().catch(() => {
          noise.playing = false;
          noiseRender();
        });
      }
    }).catch(() => { /* 忽略 */ });
  } catch (e) { /* 忽略 */ }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMusic);
} else {
  initMusic();
}
