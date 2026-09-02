"use strict";

/* ===== 搜索引擎(可管理,参照 LimeStart 逻辑) ===== */
const DEFAULT_ENGINES = [
  { id: "baidu",  name: "百度",  url: "https://www.baidu.com/s?wd=%s",     icon: "", gradient: "linear-gradient(135deg, #2932e1, #4a6cff)", shadow: "rgba(41,50,225,0.45)" },
  { id: "bing",   name: "必应",  url: "https://www.bing.com/search?q=%s",   icon: "", gradient: "linear-gradient(135deg, #008373, #3f7ae0)", shadow: "rgba(63,122,224,0.45)" },
  { id: "google", name: "Google", url: "https://www.google.com/search?q=%s", icon: "", gradient: "linear-gradient(135deg, #4285f4, #ea4335, #fbbc05, #34a853)", shadow: "rgba(66,133,244,0.45)" },
  { id: "github", name: "GitHub", url: "https://github.com/search?q=%s",    icon: "", gradient: "linear-gradient(135deg, #24292e, #57606a)", shadow: "rgba(36,41,46,0.5)" },
  { id: "so360",  name: "360搜索", url: "https://www.so.com/s?q=%s",          icon: "", gradient: "linear-gradient(135deg, #19a04f, #2f9e44)", shadow: "rgba(25,160,79,0.45)" },
  { id: "sogou",  name: "搜狗",   url: "https://www.sogou.com/web?query=%s",  icon: "", gradient: "linear-gradient(135deg, #fb6c2c, #7a4df0)", shadow: "rgba(251,108,44,0.45)" },
  { id: "zhihu",  name: "知乎",   url: "https://www.zhihu.com/search?type=content&q=%s", icon: "", gradient: "linear-gradient(135deg, #0066ff, #0084ff)", shadow: "rgba(0,102,255,0.45)" },
  { id: "bilibili", name: "哔哩哔哩", url: "https://search.bilibili.com/all?keyword=%s", icon: "", gradient: "linear-gradient(135deg, #fb7299, #fc8bab)", shadow: "rgba(251,114,153,0.45)" },
  { id: "douyin", name: "抖音",   url: "https://www.douyin.com/search/%s",    icon: "", gradient: "linear-gradient(135deg, #161823, #25f4ee)", shadow: "rgba(37,244,238,0.45)" },
  { id: "weibo",  name: "微博",   url: "https://s.weibo.com/weibo?q=%s",      icon: "", gradient: "linear-gradient(135deg, #e6162d, #ff8200)", shadow: "rgba(230,22,45,0.45)" },
];
const ENGINES_KEY = "engines";           // local: 引擎列表
const ENGINE_CURRENT_KEY = "currentEngine"; // local: 当前引擎 id

function getCurrentEngine() {
  return state.engines.find((e) => e.id === state.currentEngineId) || state.engines[0];
}
function engineOrigin(e) {
  try { return new URL(e.url).origin; } catch (err) { return e.url; }
}

function engineSearchUrl(e, q) {
  return e.url.replace("%s", encodeURIComponent(q));
}

/** 根据名称哈希生成专属配色(自定义引擎,动态获取,每个引擎不同且稳定) */
function autoEngineColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return {
    gradient: "linear-gradient(135deg, hsl(" + h + ", 55%, 45%), hsl(" + h + ", 55%, 35%))",
    shadow: "hsla(" + h + ", 55%, 45%, 0.45)",
  };
}

/** 应用引擎动态颜色并持久化 */
function applyEngineColor(e, rgb) {
  if (!e || !rgb) return;
  e.gradient = "linear-gradient(135deg, " + rgb + ", " + rgb + ")";
  e.shadow = rgb.replace("rgb(", "rgba(").replace(")", ",0.45)");
  e.colorAuto = true;
  persistEngines();
  applyEngineGradient();
}

/** 图标来源依次尝试:自定义 icon → 站点 /favicon.ico → chrome._favicon → 地球 */
function setEngineIcon(img, e, onLoaded) {
  const fallbacks = [];
  if (e.icon) fallbacks.push(e.icon);
  try { fallbacks.push(new URL(engineOrigin(e) + "/favicon.ico").href); } catch (err) { /* 忽略 */ }
  fallbacks.push(buildFavicon(engineOrigin(e)));
  fallbacks.push(FALLBACK_ICON);
  let idx = 0;
  img.onload = () => {
    // 图标有效时回调(用于动态提取颜色)
    if ((img.naturalWidth > 1 || img.naturalHeight > 1) && onLoaded) onLoaded(img);
  };
  img.onerror = () => {
    idx += 1;
    if (idx < fallbacks.length) img.src = fallbacks[idx];
  };
  img.src = fallbacks[0];
}

/** 搜索按钮背景 + 搜索栏阴影颜色:跟随当前搜索引擎 */
function applyEngineGradient() {
  const cfg = getCurrentEngine();
  const btn = document.getElementById("search-btn");
  if (btn && cfg) btn.style.background = cfg.gradient;
  const bar = document.querySelector(".search-bar");
  if (bar) bar.style.setProperty("--search-glow", cfg ? cfg.shadow : "rgba(108,140,255,0.45)");
}

/** 搜索框左侧:当前引擎图标(仅图标) */
function renderEngineSwitch() {
  const btn = document.getElementById("engine-switch");
  if (!btn) return;
  const e = getCurrentEngine();
  btn.innerHTML = "";
  const img = document.createElement("img");
  img.alt = e.name;
  setEngineIcon(img, e, (loadedImg) => {
    // 自定义引擎:尝试从图标提取真实主色,动态更新按钮/阴影颜色
    if (e.colorAuto) {
      let c = null;
      try { c = extractColor(loadedImg); } catch (err) { c = null; }
      if (c) {
        applyEngineColor(e, c);
      } else {
        // 跨域图标(canvas 受限):后台抓取原图转 dataURL 再提取
        const candidates = [];
        if (e.icon) candidates.push(e.icon);
        try { candidates.push(new URL(engineOrigin(e) + "/favicon.ico").href); } catch (err) { /* 忽略 */ }
        const target = candidates[0];
        if (target) {
          chrome.runtime.sendMessage({ type: "getEngineIconData", url: target }, (res) => {
            if (chrome.runtime.lastError || !res || res.status !== "ok" || !res.dataUrl) return;
            const im = new Image();
            im.onload = () => {
              let c2 = null;
              try { c2 = extractColor(im); } catch (err) { c2 = null; }
              if (c2) applyEngineColor(e, c2);
            };
            im.src = res.dataUrl;
          });
        }
      }
    }
  });
  btn.appendChild(img);
}

/** 选择浮层:网格展示全部引擎,点击切换 */
function renderEnginePicker() {
  const picker = document.getElementById("engine-picker");
  if (!picker) return;
  picker.innerHTML = "";
  for (const e of state.engines) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "engine-opt" + (e.id === state.currentEngineId ? " active" : "");
    item.title = e.name + "\n" + e.url;
    const img = document.createElement("img");
    img.alt = "";
    setEngineIcon(img, e);
    const name = document.createElement("span");
    name.textContent = e.name;
    item.append(img, name);
    item.addEventListener("click", () => selectEngine(e.id));
    picker.appendChild(item);
  }

  // 末尾:管理入口
  const manage = document.createElement("button");
  manage.type = "button";
  manage.className = "engine-opt engine-manage-opt";
  manage.textContent = "⚙️ 管理搜索引擎";
  manage.addEventListener("click", () => {
    document.getElementById("engine-picker").hidden = true;
    openEngineManageDialog();
  });
  picker.appendChild(manage);
}
function toggleEnginePicker() {
  const picker = document.getElementById("engine-picker");
  if (!picker) return;
  const show = picker.hidden;
  picker.hidden = !show;
  if (show) {
    renderEnginePicker();
    const sb = document.querySelector(".search-box");
    if (sb) {
      const r = sb.getBoundingClientRect();
      picker.style.left = r.left + "px";
      picker.style.top = r.bottom + 8 + "px";
    }
  }
}
function selectEngine(id) {
  if (!state.engines.some((x) => x.id === id)) return;
  state.currentEngineId = id;
  try { chrome.storage.local.set({ [ENGINE_CURRENT_KEY]: id }); } catch (err) { /* 忽略 */ }
  renderEngineSwitch();
  applyEngineGradient();
  document.getElementById("engine-picker").hidden = true;
}

/** 引擎管理弹窗列表:可拖拽排序,行内操作(设为当前/编辑/删除) */
function renderEngineManage() {
  const box = document.getElementById("engine-manage-list");
  if (!box) return;
  box.innerHTML = "";
  let dragIdx = null;

  state.engines.forEach((e, idx) => {
    const row = document.createElement("div");
    row.className = "engine-row" + (e.id === state.currentEngineId ? " current" : "");
    row.draggable = true;

    row.addEventListener("dragstart", (ev) => {
      dragIdx = idx;
      ev.dataTransfer.effectAllowed = "move";
      ev.dataTransfer.setData("text/plain", String(idx));
      row.classList.add("dragging");
    });
    row.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      box.querySelectorAll(".engine-row").forEach((r) => r.classList.remove("drag-over"));
      if (dragIdx !== null && dragIdx !== idx) row.classList.add("drag-over");
    });
    row.addEventListener("drop", (ev) => {
      ev.preventDefault();
      if (dragIdx === null || dragIdx === idx) return;
      const arr = [...state.engines];
      const [it] = arr.splice(dragIdx, 1);
      arr.splice(idx, 0, it);
      state.engines = arr;
      persistEngines();
      renderEngineManage();
    });
    row.addEventListener("dragend", () => {
      dragIdx = null;
      box.querySelectorAll(".engine-row").forEach((r) => r.classList.remove("dragging", "drag-over"));
    });

    const img = document.createElement("img");
    img.alt = "";
    setEngineIcon(img, e);

    const name = document.createElement("span");
    name.className = "engine-row-name";
    name.textContent = e.name + (e.id === state.currentEngineId ? "（当前）" : "");
    name.title = e.url;

    const ops = document.createElement("span");
    ops.className = "engine-row-ops";
    const mk = (t, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = t;
      b.title = t;
      b.addEventListener("click", fn);
      return b;
    };
    ops.appendChild(mk("★", () => selectEngine(e.id)));   // 设为当前
    ops.appendChild(mk("✎", () => openEngineDialog(idx))); // 编辑
    ops.appendChild(mk("×", () => removeEngine(idx)));      // 删除
    row.append(img, name, ops);
    box.appendChild(row);
  });
}

/** 打开引擎管理弹窗 */
function openEngineManageDialog() {
  renderEngineManage();
  document.getElementById("engine-manage-dialog").showModal();
}

async function persistEngines() {
  try { await chrome.storage.local.set({ [ENGINES_KEY]: state.engines }); } catch (err) { /* 忽略 */ }
}

async function removeEngine(idx) {
  const e = state.engines[idx];
  if (!e) return;
  state.engines.splice(idx, 1);
  if (!state.engines.length) {
    state.engines = [DEFAULT_ENGINES[0]];
  }
  if (state.currentEngineId === e.id) state.currentEngineId = state.engines[0].id;
  await persistEngines();
  try { chrome.storage.local.set({ [ENGINE_CURRENT_KEY]: state.currentEngineId }); } catch (err) { /* 忽略 */ }
  renderEngineManage();
  renderEngineSwitch();
  applyEngineGradient();
}
let editingEngineIndex = null;
function openEngineDialog(idx) {
  editingEngineIndex = idx;
  const isEdit = idx != null;
  document.getElementById("engine-dialog-title").textContent = isEdit ? "编辑搜索引擎" : "添加搜索引擎";
  document.getElementById("engine-dialog-submit").textContent = isEdit ? "保存" : "添加";
  const e = isEdit ? state.engines[idx] : null;
  document.getElementById("engine-name").value = e ? e.name : "";
  document.getElementById("engine-url").value = e ? e.url : "";
  document.getElementById("engine-icon").value = e ? (e.icon || "") : "";
  document.getElementById("engine-dialog").showModal();
}
async function saveEngine() {
  const name = document.getElementById("engine-name").value.trim();
  const url = document.getElementById("engine-url").value.trim();
  const icon = document.getElementById("engine-icon").value.trim();
  if (!name || !url) return;
  if (editingEngineIndex != null) {
    state.engines[editingEngineIndex] = { ...state.engines[editingEngineIndex], name, url, icon };
  } else {
    const auto = autoEngineColor(name);
    state.engines.push({ id: "e" + Date.now(), name, url, icon, gradient: auto.gradient, shadow: auto.shadow, colorAuto: true });
  }
  editingEngineIndex = null;
  await persistEngines();
  renderEngineManage();
  document.getElementById("engine-dialog").close();
}

const BOOKMARK_KEY = "bookmarks";   // session: 书签列表
const DESC_KEY = "descriptions";    // local:  { [url]: 一句话描述 }
const TITLE_KEY = "titles";         // local:  { [url]: 简短标题 }
const DESC_FAIL_KEY = "descFailed"; // local:  { [url]: true } 生成失败
const MANUAL_KEY = "manualDesc";    // local:  { [url]: true } 手动维护过
const API_KEY_STORAGE = "deepseekApiKey";
const MODEL_KEY = "model";
const BASE_URL_KEY = "baseUrl";
const AUTO_KEY = "autoDescribe";
const ALPHA_KEY = "cardAlphas"; // local: { search, widget, bm, ql, main }
const ALPHA_KEYS = {
  search: "--search-glass", // 搜索栏
  widget: "--widget-glass", // 左侧小组件(时间/名言/天气)
  bm: "--bm-glass",         // 收藏夹卡片
  ql: "--ql-glass",         // 快捷方式卡片
  main: "--main-glass",     // 最外层主卡片
};
const DEFAULT_ALPHAS = { search: 10, widget: 10, bm: 8, ql: 8, main: 4 };
const BLUR_KEY = "cardBlurs"; // local: { search, widget, bm, ql, main }
const BG_COLOR_KEY = "bgColor";


const QL_NAME_KEY = "showQuickNames";
const HOME_MODE_KEY = "homeMode"; // local: "grid" 网格(默认) | "clean" 清爽
const THUMB_BM_KEY = "thumbPreviewBM"; // 书签网页预览开关
const THUMB_QL_KEY = "thumbPreviewQL"; // 快捷方式网页预览开关   // local: bool 是否显示快捷方式名称
const FAB_AUTO_KEY = "fabAutoHide";   // local: bool 右上角控制按钮自动隐藏(WeTab 风格)
const NAV_COLLAPSED_KEY = "navCollapsed"; // local: string[] 折叠的文件夹路径
const BM_SCROLL_KEY = "bmScrollPos";     // local: number 收藏夹栏滚动位置
const BLUR_KEYS = {
  search: "--search-blur",
  widget: "--widget-blur",
  bm: "--bm-blur",
  ql: "--ql-blur",
  main: "--main-blur",
};
const DEFAULT_BLURS = { search: 12, widget: 12, bm: 10, ql: 8, main: 8 };
const CLEAN_BG_KEY = "cleanBgStyle"; // local: { blur, alpha } 清爽模式聚焦搜索栏时的背景蒙版(磨砂度 px / 透明度 %)
const DEFAULT_CLEAN_BG = { blur: 14, alpha: 100 };
const QUICK_KEY = "quickLinks"; // local: 快捷方式数组

/* 默认快捷方式 */
const DEFAULT_QUICK = [
  { icon: "📺", name: "哔哩哔哩", url: "https://www.bilibili.com" },
  { icon: "", name: "抖音", url: "https://www.douyin.com/" },
  { icon: "", name: "deepseek", url: "https://www.deepseek.com" },
  { icon: "▶️", name: "YouTube", url: "https://www.youtube.com" },
  { icon: "", name: "飞车图鉴", url: "https://www.678.tax/" },
  { icon: "🔍", name: "百度", url: "https://www.baidu.com" },
  { icon: "📰", name: "微博", url: "https://weibo.com" },
  { icon: "🐙", name: "GitHub", url: "https://github.com" },
  { icon: "💬", name: "知乎", url: "https://www.zhihu.com" },
  { icon: "", name: "淘宝", url: "https://www.taobao.com/" },
  { icon: "", name: "站酷", url: "https://www.zcool.com.cn/" },
  { icon: "", name: "装备前线", url: "https://www.zfrontier.com/" },
  { icon: "", name: "汽车之家", url: "https://www.autohome.com.cn/" },
  { icon: "", name: "谷歌", url: "https://www.google.com" },
  { icon: "", name: "百度贴吧", url: "https://tieba.baidu.com/" },
  { icon: "", name: "wikiHow", url: "https://zh.wikihow.com/" },
  { icon: "", name: "虫部落", url: "https://search.chongbuluo.com/" },
  { icon: "", name: "removebg", url: "https://www.remove.bg/zh" },
  { icon: "", name: "码力全开", url: "https://design.maliquankai.com/" },
  { icon: "", name: "今日热榜", url: "https://tophub.today/" },
  { icon: "", name: "超星读书", url: "https://www.chaoxing.com/" },
  { icon: "", name: "图灵社区", url: "https://www.ituring.com.cn/" },
  { icon: "", name: "NewsNow", url: "https://newsnow.busiyi.world/" },
  { icon: "", name: "青柠起始页", url: "https://www.limestart.cn/" },
  { icon: "", name: "花间社", url: "https://www.huajianshe.com" },
  { icon: "", name: "时光靓女", url: "http://www.shiguangliangnv.com/" },
  { icon: "", name: "斯诺克", url: "http://www.heyzxz.me/pcol/" },
  { icon: "", name: "元素周期表", url: "https://pt.ziziyi.com/" },
  { icon: "", name: "老游戏在线玩", url: "https://zaixianwan.app/zh-Hans/" },
  { icon: "", name: "艾里艾里", url: "https://alaau.top/ptl.php?mb=ptl&pages=MTc4NTgzODc4Mg&t=eHpfYVp2WQ&time=2026_08_04_18_19_46&akey=Sm91bmc&alog=Sm91bmc&times=0&suourl=tzmmz.top" },
  { icon: "", name: "慕课网", url: "https://www.icourse163.org/" },
  { icon: "", name: "英语真题", url: "https://zhenti.burningvocabulary.cn/" },
  { icon: "", name: "幻想ACG", url: "https://acgccc.com/" },
  { icon: "", name: "明源资源", url: "http://www.mingyuanziyuan.com/" },
  { icon: "", name: "AGE动漫", url: "https://www.agedm.io/" },
  { icon: "", name: "在线解压文件", url: "https://cn.fileunzip.com/" },
  { icon: "", name: "优客资源", url: "http://www.youkeziyuan.com/" },
  { icon: "", name: "ChatGPT", url: "https://chatgpt.com/" },
  { icon: "", name: "人类评测", url: "https://humanbenchmark.com/" },
  { icon: "", name: "语言学习", url: "https://www.languageguide.org/" },
  { icon: "", name: "通义千问", url: "https://www.qianwen.com/" },
  { icon: "", name: "Qwen", url: "https://chat.qwenlm.ai/" },
  { icon: "", name: "WeTab起始页", url: "https://wetab.link/" },
  { icon: "", name: "Spotify", url: "https://www.spotify.com" },
];

/* 通用网站图标回退(SVG 地球,不显示文字) */
const FALLBACK_ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="1.6">' +
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z"/></svg>'
  );

/* ===== 应用状态 ===== */
const state = {
  bookmarks: [],
  descriptions: {}, // url -> 描述(AI 或手动)
  titles: {},       // url -> 简短标题(AI 或手动)
  failed: {},       // url -> true 生成失败
  manual: {},       // url -> true 手动维护过
  auto: true,
  model: "deepseek-chat", // 当前使用的 DeepSeek 模型
  baseUrl: "https://api.deepseek.com", // API Base URL
  generating: false,
  quickLinks: [],
  showQuickNames: true,
  showThumbPreview: true,
  showThumbPreviewBM: true, // 书签预览开关
  showThumbPreviewQL: true, // 快捷方式预览开关 // 是否显示快捷方式名称(默认显示)
  engines: [...DEFAULT_ENGINES],
  currentEngineId: "baidu",
  collapsed: new Set(), // 导航中已折叠的文件夹路径
  currentFolder: null, // 面包屑导航:当前选中的文件夹(分组标题);null = 全部
  editingUrl: null,
};

/* ===== 工具 ===== */
function isExtensionEnv() {
  return typeof chrome !== "undefined" &&
    !!chrome.storage && !!chrome.runtime && !!chrome.runtime.id;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** 网站真实图标:优先 Chrome 本地 favicon 缓存,失败回退通用地球图标(无文字) */
let faviconStamp = 0; // 切回页面时递增,强制图标重新获取(读取 Chrome 最新 favicon 缓存)

function buildFavicon(url, size = 64) {
  if (chrome.runtime?.id) {
    let u = "/_favicon/?pageUrl=" + encodeURIComponent(url) + "&size=" + size;
    if (faviconStamp) u += "&v=" + faviconStamp; // 缓存击穿,避免用旧的空图标结果
    return chrome.runtime.getURL(u);
  }
  return FALLBACK_ICON;
}

/* 阴影颜色:从图标(favicon)提取主色,失败回退随机柔和色 */
const GLOW_COLORS = [
  "#6c8cff", "#ff6c8c", "#6cffb0", "#ffb86c",
  "#c56cff", "#6cd5ff", "#ffd56c", "#7cff6c",
];

function randomGlow() {
  return GLOW_COLORS[Math.floor(Math.random() * GLOW_COLORS.length)];
}

/** 从已加载的图标 img 提取平均主色;失败返回 null(保持随机色) */
function extractColor(img) {
  try {
    const w = img.naturalWidth || 32;
    const h = img.naturalHeight || 32;
    if (w < 2 || h < 2) return null;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 100) continue;
      if (d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245) continue;
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
    if (!n) return null;
    return "rgb(" + Math.round(r / n) + "," + Math.round(g / n) + "," + Math.round(b / n) + ")";
  } catch (e) {
    return null;
  }
}

/* ===== 时钟与问候语 ===== */
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
let clockDateCache = ""; // 日期文本缓存:仅跨天时重写,避免每秒重复写 DOM

function updateClock() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  document.getElementById("time").textContent =
    `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const dateText =
    `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${WEEKDAYS[now.getDay()]}`;
  if (dateText !== clockDateCache) {
    clockDateCache = dateText;
    document.getElementById("date").textContent = dateText;
  }
}

/* ===== 名言警句(每日一句) ===== */
const QUOTES = [
  { text: "天行健,君子以自强不息。", author: "《周易》" },
  { text: "不积跬步,无以至千里;不积小流,无以成江海。", author: "《荀子·劝学》" },
  { text: "学而不思则罔,思而不学则殆。", author: "《论语·为政》" },
  { text: "路漫漫其修远兮,吾将上下而求索。", author: "屈原《离骚》" },
  { text: "千里之行,始于足下。", author: "《老子》" },
  { text: "业精于勤,荒于嬉;行成于思,毁于随。", author: "韩愈" },
  { text: "博观而约取,厚积而薄发。", author: "苏轼" },
  { text: "纸上得来终觉浅,绝知此事要躬行。", author: "陆游" },
  { text: "长风破浪会有时,直挂云帆济沧海。", author: "李白" },
  { text: "会当凌绝顶,一览众山小。", author: "杜甫" },
  { text: "有志者,事竟成。", author: "《后汉书》" },
  { text: "锲而不舍,金石可镂。", author: "《荀子·劝学》" },
  { text: "宝剑锋从磨砺出,梅花香自苦寒来。", author: "《警世贤文》" },
  { text: "少壮不努力,老大徒伤悲。", author: "《长歌行》" },
  { text: "黑发不知勤学早,白首方悔读书迟。", author: "颜真卿" },
  { text: "书山有路勤为径,学海无涯苦作舟。", author: "韩愈" },
  { text: "海纳百川,有容乃大;壁立千仞,无欲则刚。", author: "林则徐" },
  { text: "勿以恶小而为之,勿以善小而不为。", author: "刘备" },
  { text: "穷则独善其身,达则兼济天下。", author: "《孟子》" },
  { text: "知不足而奋进,望远山而前行。", author: "佚名" },
  { text: "人生的价值,并不是用时间,而是用深度去衡量的。", author: "列夫·托尔斯泰" },
  { text: "生活不止眼前的苟且,还有诗和远方的田野。", author: "高晓松" },
  { text: "世界上只有一种真正的英雄主义,那就是在认清生活的真相后依然热爱生活。", author: "罗曼·罗兰" },
  { text: "种一棵树最好的时间是十年前,其次是现在。", author: "佚名" },
  { text: "星光不问赶路人,时光不负有心人。", author: "佚名" },
];

/**
 * 名言警句:优先使用开源免费 API「Hitokoto(一言)」v1.hitokoto.cn,
 * 每次调用随机返回一句;网络失败时降级到内置 QUOTES 列表。
 */
async function fetchQuote() {
  const textEl = document.getElementById("quote-text");
  const authorEl = document.getElementById("quote-author");
  if (!textEl) return;
  textEl.textContent = "名言加载中…";
  authorEl.textContent = "";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const resp = await fetch("https://v1.hitokoto.cn/?c=k&c=i&c=j&c=h", { signal: ctrl.signal });
    clearTimeout(timer);
    if (resp.ok) {
      const d = await resp.json();
      if (d && d.hitokoto) {
        window._currentQuote = { text: d.hitokoto, from: d.from || "" };
        const ex = document.getElementById("quote-explain");
        if (ex) { ex.hidden = true; ex.textContent = ""; }
        textEl.textContent = d.hitokoto;
        explainQuoteText(d.hitokoto, d.from || ""); // 自动生成释义(下一行显示)
        const who = d.from_who ? d.from_who : "";
        const src = d.from ? d.from : "";
        authorEl.textContent = "—— " + (who ? who : src ? src : "佚名") + (who && src ? "·" + src : "");
        return;
      }
    }
  } catch {
    /* 网络失败,走内置兜底 */
  }
  showLocalQuote();
}

/** 离线兜底:从内置列表随机取一句 */
function showLocalQuote() {
  const textEl = document.getElementById("quote-text");
  const authorEl = document.getElementById("quote-author");
  if (!textEl) return;
  const idx = Math.floor(Math.random() * QUOTES.length);
  textEl.textContent = QUOTES[idx].text;
  authorEl.textContent = "—— " + QUOTES[idx].author;
}

function nextQuote() {
  fetchQuote(); // 点击卡片换一句(网络 API 随机)
}

/* ===== 搜索历史 + 关联建议 ===== */
const SEARCH_HISTORY_KEY = "searchHistory";
let suggestTimer = null;

/** 记录搜索历史(去重,最新在前,最多 10 条) */
function addSearchHistory(q) {
  q = (q || "").trim();
  if (!q) return;
  try {
    chrome.storage.local.get(SEARCH_HISTORY_KEY, (r) => {
      let h = Array.isArray(r[SEARCH_HISTORY_KEY]) ? r[SEARCH_HISTORY_KEY] : [];
      h = h.filter((x) => x !== q);
      h.unshift(q);
      h = h.slice(0, 10);
      chrome.storage.local.set({ [SEARCH_HISTORY_KEY]: h });
    });
  } catch (e) { /* 忽略 */ }
}

/** 删除单条搜索历史 */
function deleteHistoryItem(q) {
  try {
    chrome.storage.local.get(SEARCH_HISTORY_KEY, (r) => {
      let h = Array.isArray(r[SEARCH_HISTORY_KEY]) ? r[SEARCH_HISTORY_KEY] : [];
      h = h.filter((x) => x !== q);
      chrome.storage.local.set({ [SEARCH_HISTORY_KEY]: h }, () => {
        // 恢复 hover 预览前的原输入,并总是重新渲染历史下拉(保持打开)
        const input = document.getElementById("search-input");
        if (input && hoverOriginal !== null && !hoverClicked) input.value = hoverOriginal;
        hoverOriginal = null;
        renderSearchDropdown(h, "🕘 ");
      });
    });
  } catch (e) { /* 忽略 */ }
}

/** 打开清空历史确认弹窗 */
function confirmClearHistory() {
  const dlg = document.getElementById("history-clear-confirm");
  if (dlg && typeof dlg.showModal === "function") dlg.showModal();
}

/** 渲染下拉(历史或建议) */
function renderSearchDropdown(items, prefix) {
  const dd = document.getElementById("search-dropdown");
  const input = document.getElementById("search-input");
  if (!dd || !input) return;
  dd.innerHTML = "";
  if (!items || !items.length) { dd.hidden = true; return; }
  const isHistory = prefix === "🕘 ";
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "search-suggest-item" + (isHistory ? " history-row" : "");
    const label = document.createElement("span");
    label.className = "ss-label";
    label.textContent = (prefix || "") + item;
    row.appendChild(label);
    if (isHistory) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "ss-del";
      del.textContent = "×";
      del.title = "删除该条记录";
      del.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        deleteHistoryItem(item);
      });
      row.appendChild(del);
    }
    // 悬浮预览:显示到搜索栏;点击则填入并搜索
    row.addEventListener("mouseenter", () => {
      if (hoverOriginal === null) hoverOriginal = input.value;
      input.value = item;
    });
    row.addEventListener("mouseleave", () => {
      if (!hoverClicked && hoverOriginal !== null) input.value = hoverOriginal;
      hoverOriginal = null;
    });
    row.addEventListener("mousedown", (e) => {
      e.preventDefault(); // 避免 input 失焦
      hoverClicked = true;
      input.value = item; // 只填入输入框,不自动搜索
      dd.hidden = true;
      input.focus();
    });
    dd.appendChild(row);
  }
  if (isHistory) {
    const foot = document.createElement("div");
    foot.className = "search-dropdown-footer";
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "search-clear-btn";
    clearBtn.textContent = "清空历史记录";
    clearBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      confirmClearHistory();
    });
    foot.appendChild(clearBtn);
    dd.appendChild(foot);
  }
  dd.onmouseleave = () => {
    if (hoverOriginal !== null && !hoverClicked) {
      const inp = document.getElementById("search-input");
      if (inp) inp.value = hoverOriginal;
    }
    hoverOriginal = null;
  };
  // 定位到输入框正下方:宽度 = 两个分割线之间(输入框区域)
  const box = document.querySelector(".search-bar");
  if (box && input) {
    const r = input.getBoundingClientRect();
    dd.style.top = (r.bottom + 6) + "px";
    dd.style.left = r.left + "px";
    dd.style.width = r.width + "px";
  }
  dd.hidden = false;
}

/** 解析各源联想响应 */
function parseSuggestText(text, type) {
  try {
    if (type === "bing" || type === "google") {
      const d = JSON.parse(text);
      return Array.isArray(d) && Array.isArray(d[1]) ? d[1] : [];
    }
    if (type === "so360") {
      const d = JSON.parse(text);
      return Array.isArray(d.result) ? d.result.map((x) => x.word || "").filter(Boolean) : [];
    }
    if (type === "baidu") {
      const m = text.match(/s\s*:\s*\[([\s\S]*?)\]/);
      if (m) return JSON.parse("[" + m[1] + "]");
      const d = JSON.parse(text);
      return Array.isArray(d.s) ? d.s : [];
    }
    if (type === "sogou") {
      const m = text.match(/\[([\s\S]*?)\]/);
      if (m) return JSON.parse("[" + m[1] + "]");
      const d = JSON.parse(text);
      return Array.isArray(d.items) ? d.items : [];
    }
  } catch (e) { /* 忽略 */ }
  return [];
}

/** 获取关联建议(前端直连,扩展页面有 host_permissions 可绕过 CORS) */
function fetchSuggest(q) {
  try {
    const eng = getCurrentEngine();
    const id = eng ? eng.id : "";
    const kw = encodeURIComponent(q.trim());
    const sources = [];
    if (id === "baidu") sources.push({ u: "https://suggestion.baidu.com/su?wd=" + kw + "&p=3", t: "baidu" });
    else if (id === "bing") sources.push({ u: "https://api.bing.com/osjson.aspx?query=" + kw, t: "bing" });
    else if (id === "sogou") sources.push({ u: "https://www.sogou.com/suggnew/ajajjson?key=" + kw + "&type=web", t: "sogou" });
    else if (id === "so360") sources.push({ u: "https://sug.so.360.cn/suggest?word=" + kw, t: "so360" });
    else sources.push({ u: "https://api.bing.com/osjson.aspx?query=" + kw, t: "bing" });
    // 兜底源:百度系兜底必应,其他兜底百度
    sources.push(
      id === "baidu" || id === "sogou" || id === "so360"
        ? { u: "https://api.bing.com/osjson.aspx?query=" + kw, t: "bing" }
        : { u: "https://suggestion.baidu.com/su?wd=" + kw + "&p=3", t: "baidu" }
    );
    let idx = 0;
    const tryNext = () => {
      if (idx >= sources.length) return;
      const src = sources[idx++];
      fetch(src.u, { credentials: "omit" })
        .then((r) => r.arrayBuffer())
        .then((buf) => {
          // 百度/搜狗建议接口返回 GBK 编码,必应/360 为 UTF-8
          const enc = src.t === "baidu" || src.t === "sogou" ? "gbk" : "utf-8";
          const text = new TextDecoder(enc).decode(buf);
          const items = parseSuggestText(text, src.t);
          if (items.length) renderSearchDropdown(items, "🔎 ");
          else tryNext();
        })
        .catch(() => tryNext());
    };
    tryNext();
  } catch (e) { /* 忽略 */ }
}

/** 显示下拉:空输入=历史,有输入=建议 */
function showSearchDropdown() {
  const dd = document.getElementById("search-dropdown");
  const input = document.getElementById("search-input");
  if (!dd || !input) return;
  const q = input.value.trim();
  clearTimeout(suggestTimer);
  if (!q) {
    try {
      chrome.storage.local.get(SEARCH_HISTORY_KEY, (r) => {
        const h = Array.isArray(r[SEARCH_HISTORY_KEY]) ? r[SEARCH_HISTORY_KEY] : [];
        renderSearchDropdown(h, "🕘 ");
      });
    } catch (e) { renderSearchDropdown([], ""); }
  } else {
    dd.hidden = true; // 立即收起历史,等待联想结果
    suggestTimer = setTimeout(() => fetchSuggest(q), 250); // 防抖
  }
}

/** 悬浮预览状态:首次悬浮时保存原输入,未点击时移出恢复 */
let hoverOriginal = null;
let hoverClicked = false;

/** 关闭下拉(未点击时恢复原输入) */
function hideSearchDropdown() {
  clearTimeout(suggestTimer);
  if (hoverOriginal !== null && !hoverClicked) {
    const input = document.getElementById("search-input");
    if (input) input.value = hoverOriginal;
  }
  hoverOriginal = null;
  hoverClicked = false;
  const dd = document.getElementById("search-dropdown");
  if (dd) dd.hidden = true;
}

/* ===== 搜索 ===== */
function doSearch() {
  const q = document.getElementById("search-input").value.trim();
  if (!q) return;
  addSearchHistory(q); // 记录搜索历史
  hideSearchDropdown();
  window.open(engineSearchUrl(getCurrentEngine(), q), "_blank");
}

/* ===== 收藏夹分组 ===== */
function groupBookmarks(items) {
  const groups = [];
  const index = new Map();
  for (const item of items) {
    const key = (item.path || []).join(" / ") || "未分类";
    let group = index.get(key);
    if (!group) {
      group = { title: key, items: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/* ===== 维护弹窗 ===== */
let pendingDeleteUrl = null;

function openMaintainDialog(item) {
  state.editingUrl = item.url;
  document.getElementById("maint-url").value = item.url;
  document.getElementById("maint-title").value = state.titles[item.url] || item.title;
  document.getElementById("maint-desc").value = state.descriptions[item.url] || "";
  // 记录打开时的标题/链接,保存时对比:用户改动过才同步到 Chrome 书签
  window._maintOrigTitle = document.getElementById("maint-title").value;
  window._maintOrigUrl = item.url;

  const regen = document.getElementById("maint-regenerate");
  regen.textContent = "AI 重新生成";
  regen.disabled = false;

  document.getElementById("maintain-dialog").showModal();
  setTimeout(() => document.getElementById("maint-title").focus(), 50);
}

async function saveMaintain() {
  const oldUrl = state.editingUrl;
  if (!oldUrl) return;
  const rawUrl = document.getElementById("maint-url").value.trim();
  if (!rawUrl) return;
  // 与快捷方式一致:缺协议自动补 https://
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const title = document.getElementById("maint-title").value.trim();
  const desc = document.getElementById("maint-desc").value.trim();
  const urlChanged = url !== oldUrl;
  const titleChanged = !!title && title !== window._maintOrigTitle;
  if (!title && !desc && !urlChanged) return; // 至少填一项

  const item = state.bookmarks.find((b) => b.url === oldUrl);

  // 链接或标题有改动 → 同步到 Chrome 书签(触发 onChanged → 收藏夹实时刷新)
  if (item && item.id && (urlChanged || titleChanged)) {
    const changes = {};
    if (urlChanged) changes.url = url;
    if (titleChanged) changes.title = title;
    try {
      await chrome.bookmarks.update(item.id, changes);
    } catch (e) {
      /* 同步失败不影响主页缓存 */
    }
  }

  // 链接变更:把该 URL 的 AI/手动数据迁移到新 URL(标题/简介/手动标记/失败标记)
  if (urlChanged) {
    for (const map of [state.titles, state.descriptions, state.manual, state.failed]) {
      if (map && oldUrl in map) {
        map[url] = map[oldUrl];
        delete map[oldUrl];
      }
    }
    state.editingUrl = url;
  }

  if (title) state.titles[url] = title;
  if (desc) state.descriptions[url] = desc;
  state.manual[url] = true; // 手动维护过,自动生成不再覆盖
  delete state.failed[url];

  await chrome.storage.local.set({
    [TITLE_KEY]: state.titles,
    [DESC_KEY]: state.descriptions,
    [MANUAL_KEY]: state.manual,
    [DESC_FAIL_KEY]: state.failed,
  });
  document.getElementById("maintain-dialog").close();
  renderBookmarks();
}

async function regenerateMaintain() {
  const url = state.editingUrl;
  if (!url) return;

  const btn = document.getElementById("maint-regenerate");
  btn.textContent = "AI 重新生成中…";
  btn.disabled = true;

  // 允许 AI 覆盖:清除手动标记与失败标记
  delete state.manual[url];
  delete state.failed[url];
  await chrome.storage.local.set({ [MANUAL_KEY]: state.manual, [DESC_FAIL_KEY]: state.failed });

  const item = state.bookmarks.find((b) => b.url === url);
  try {
    const res = await chrome.runtime.sendMessage({
      type: "describeBookmark",
      url,
      title: item ? item.title : url,
      force: true,
    });
    if (res && res.status === "ok") {
      if (res.title) state.titles[url] = res.title;
      if (res.text) state.descriptions[url] = res.text;
      delete state.failed[url];
    } else if (res && res.status === "failed") {
      state.failed[url] = true;
    }
  } catch {
    state.failed[url] = true;
  }

  document.getElementById("maintain-dialog").close();
  renderBookmarks();
}

/** 点击"删除书签":弹出确认/取消弹窗 */
function askDeleteBookmark() {
  const url = state.editingUrl;
  if (!url) return;
  const item = state.bookmarks.find((b) => b.url === url);
  pendingDeleteUrl = url;
  document.getElementById("confirm-text").textContent = item
    ? `确定要删除书签「${item.title}」吗?此操作会同时从 Chrome 收藏夹中删除。`
    : "确定要删除该书签吗?";
  document.getElementById("confirm-dialog").showModal();
}

/** 确认删除 */
async function confirmDelete() {
  const url = pendingDeleteUrl;
  pendingDeleteUrl = null;
  if (!url) return;
  const item = state.bookmarks.find((b) => b.url === url);
  document.getElementById("confirm-dialog").close();
  if (!item || !item.id) return;
  await chrome.bookmarks.remove(item.id); // 触发 onRemoved → 收藏夹实时刷新
  document.getElementById("maintain-dialog").close();
}

/* ===== 悬浮缩略图弹窗 ===== */
let hoverTimer = null;
let hoverUrl = null;

let thumbLoadTimer = null;

function createThumbPopup() {
  const popup = document.createElement("div");
  popup.id = "thumb-popup";
  popup.className = "thumb-popup";
  popup.innerHTML =
    '<div class="thumb-body">' +
    '  <iframe class="thumb-frame" id="thumb-frame" src="about:blank" title="网页预览" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>' +
    '  <div class="thumb-overlay" id="thumb-overlay">正在加载网页…</div>' +
    "</div>" +
    '<div class="thumb-title" id="thumb-title"></div>';
  document.body.appendChild(popup);

  // 鼠标进入弹窗:暂停隐藏(避免弹窗跟随鼠标时鼠标移到弹窗上导致反复隐藏/重载)
  popup.addEventListener("mouseenter", () => {
    clearTimeout(hoverTimer);
    clearTimeout(hideTimer);
  });
  // 鼠标离开弹窗:恢复延迟隐藏
  popup.addEventListener("mouseleave", () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => hideThumb(), 200);
  });
}

let hideTimer = null;

let hoverMouseX = 0;
let hoverMouseY = 0;

function bindHover(card, item, kind) {
  card.addEventListener("mouseenter", (e) => {
    hoverMouseX = e.clientX;
    hoverMouseY = e.clientY;
    clearTimeout(hoverTimer);
    clearTimeout(hideTimer); // 取消延迟隐藏(边缘抖动/位置变化仍在卡片内)
    hoverTimer = setTimeout(() => {
      // 书签与快捷方式的预览弹窗分开控制
      const enabled = kind === "ql" ? state.showThumbPreviewQL : state.showThumbPreviewBM;
      if (!enabled) return;
      showThumb(card, item);
    }, 300); // 防抖:快速扫过不触发
  });
  card.addEventListener("mouseleave", () => {
    clearTimeout(hoverTimer);
    // 延迟隐藏:卡片 hover 上浮可能让光标短暂"出界",200ms 内回到卡片则取消,避免弹窗刷新闪烁
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => hideThumb(), 200);
  });
}

function showThumb(card, item) {
  const popup = document.getElementById("thumb-popup");
  if (!popup) return;
  const frame = document.getElementById("thumb-frame");
  const overlay = document.getElementById("thumb-overlay");
  const titleEl = document.getElementById("thumb-title");
  if (!frame || !overlay) return;

  // 底部文字:网页标题(AI 标题优先,其次书签标题/快捷方式名)
  titleEl.textContent = state.titles[item.url] || item.title || "";

  // 先显示再测量,同一同步块内不触发重绘,测量精确后定位
  popup.classList.add("show");

  // 同一链接已在显示:仅跟随鼠标更新位置,不重新加载 iframe(避免反复刷新)
  if (hoverUrl === item.url) {
    const pw = popup.offsetWidth || 360;
    const ph = popup.offsetHeight || 300;
    let l2 = hoverMouseX + 14;
    let t2 = hoverMouseY + 14;
    if (l2 + pw > window.innerWidth - 8) l2 = hoverMouseX - pw - 14;
    if (t2 + ph > window.innerHeight - 8) t2 = hoverMouseY - ph - 14;
    popup.style.left = Math.max(8, l2) + "px";
    popup.style.top = Math.max(8, t2) + "px";
    return;
  }

  const popupW = popup.offsetWidth || 360;
  const popupH = popup.offsetHeight || 300;
  const pad = 14;

  // 定位:跟随鼠标位置(鼠标右下方),超出视口自动翻转
  let left = hoverMouseX + pad;
  let top = hoverMouseY + pad;
  if (left + popupW > window.innerWidth - 8) left = hoverMouseX - popupW - pad;
  if (top + popupH > window.innerHeight - 8) top = hoverMouseY - popupH - pad;
  left = Math.max(8, left);
  top = Math.max(8, top);
  popup.style.left = left + "px";
  popup.style.top = top + "px";

  // 实时访问当前链接,并按弹窗可视区等比缩小显示整页
  hoverUrl = item.url;
  overlay.hidden = false;
  overlay.textContent = "正在加载网页…";
  frame._loaded = false;
  frame.onload = () => {
    frame._loaded = true;
    if (hoverUrl === item.url) overlay.hidden = true; // 加载完成,立即关闭提示
  };

  // 等比缩放:iframe 以 1280x800 标准视口渲染,按弹窗可视区宽度等比缩小
  const body = popup.querySelector(".thumb-body");
  const boxW = body ? body.clientWidth : 384;
  const scale = Math.min(1, boxW / 1280);
  frame.style.width = "1280px";
  frame.style.height = "800px";
  frame.style.transform = "scale(" + scale.toFixed(4) + ")";
  if (body) body.style.height = Math.round(800 * scale) + "px";

  // 正常加载预览
  const startPreview = () => {
    frame.src = item.url;
    clearTimeout(thumbLoadTimer);
    thumbLoadTimer = setTimeout(() => {
      if (hoverUrl === item.url) overlay.hidden = true;
    }, 1200);
    frame._failTimer = setTimeout(() => {
      if (hoverUrl === item.url && !frame._loaded) {
        overlay.textContent = "网页无法访问";
        overlay.hidden = false;
        frame.src = "about:blank";
      }
    }, 4000);
  };
  // 站点禁止嵌入(X-Frame-Options / CSP):显示友好提示而非空白错误页
  const showBlocked = () => {
    frame.src = "about:blank";
    overlay.hidden = false;
    overlay.textContent = "⚠️ 该网站禁止网页预览,点击卡片访问原网页";
  };
  try {
    chrome.runtime.sendMessage({ type: "checkFrameable", url: item.url }, (res) => {
      if (chrome.runtime.lastError || !res || res.status === "ok") startPreview();
      else showBlocked();
    });
  } catch (e) {
    startPreview();
  }
}

function hideThumb() {
  const url = hoverUrl;
  hoverUrl = null;
  clearTimeout(hoverTimer);
  clearTimeout(thumbLoadTimer);
  const popup = document.getElementById("thumb-popup");
  if (popup) popup.classList.remove("show");
  // 停止 iframe 加载,释放资源
  const frame = document.getElementById("thumb-frame");
  if (frame) {
    frame.src = "about:blank";
    clearTimeout(frame._failTimer); // 清理失败判定定时器
  }
}

/* ===== 卡片渲染 ===== */
function createCard(item) {
  const card = document.createElement("a");
  card.className = "bm-card";
  card.href = item.url;
  card.target = "_blank";
  card.rel = "noopener noreferrer";

  // 头部:网站图标 + 标题 + 域名
  const head = document.createElement("div");
  head.className = "bm-card-head";

  // 阴影颜色:默认随机柔和色,图标加载成功后从图标提取
  card.style.setProperty("--glow-color", randomGlow());

  const icon = document.createElement("span");
  icon.className = "bm-icon";
  const img = document.createElement("img");
  img.src = buildFavicon(item.url);
  img.alt = "";
  img.loading = "lazy";
  img.addEventListener("error", () => {
    if (img.dataset.fallback) return;
    img.dataset.fallback = "1";
    img.src = FALLBACK_ICON; // 失败显示通用地球图标,不用文字
  });
  img.addEventListener("load", () => {
    const c = extractColor(img);
    if (c) card.style.setProperty("--glow-color", c);
  });
  icon.appendChild(img);

  const textBox = document.createElement("div");
  textBox.style.minWidth = "0";

  const aiTitle = state.titles[item.url];
  const title = document.createElement("div");
  title.className = "bm-title";
  title.textContent = aiTitle || item.title;
  if (aiTitle && aiTitle !== item.title) title.title = `原书签标题:${item.title}`;

  const host = document.createElement("div");
  host.className = "bm-host";
  host.textContent = hostOf(item.url);
  textBox.append(title, host);

  head.append(icon, textBox);

  // 描述行(三态:成功 / 失败可维护 / 未处理占位)
  const desc = document.createElement("div");
  desc.className = "bm-desc";

  const text = state.descriptions[item.url];
  if (text) {
    desc.textContent = text;
  } else if (state.failed[item.url]) {
    desc.classList.add("desc-failed");
    desc.textContent = "⚠️ 无法生成简介,请手动维护";
    desc.title = "点击手动维护卡片信息";
    desc.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMaintainDialog(item);
    });
  } else {
    desc.classList.add("desc-empty");
    desc.textContent = state.generating ? "生成中…" : "✨ 点右上角\"一键 AI 生成\"";
  }

  // 右下角 ⋮ 按钮:维护卡片信息
  const more = document.createElement("button");
  more.className = "bm-more";
  more.textContent = "⋯";
  more.title = "维护卡片信息";
  more.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openMaintainDialog(item);
  });

  bindHover(card, item);

  card.append(head, desc, more);
  return card;
}

/** 保存导航折叠状态与滚动位置 */
/** 背景颜色:应用所选颜色(覆盖渐变与壁纸) */
function applyBgColor(color) {
  const bg = document.getElementById("bg");
  if (!bg) return;
  bg.style.background = color;
  bg.style.backgroundImage = "none";
  bg.classList.remove("has-image");
  // 清除壁纸保存,避免下次打开恢复壁纸
  try { chrome.storage.local.remove(SAVED_WP_KEY); } catch (e) { /* 忽略 */ }
}

/** 恢复默认渐变背景 */
function resetBgColor() {
  const bg = document.getElementById("bg");
  if (!bg) return;
  bg.style.background = "";
  bg.style.backgroundImage = "";
  bg.classList.remove("has-image");
  try { chrome.storage.local.remove(BG_COLOR_KEY); } catch (e) { /* 忽略 */ }
}

/** 打开主页时恢复保存的背景颜色 */
async function initBgColor() {
  try {
    const { [BG_COLOR_KEY]: c } = await chrome.storage.local.get(BG_COLOR_KEY);
    if (c) applyBgColor(c);
  } catch (e) { /* 忽略 */ }
}

function saveNavState() {
  try {
    chrome.storage.local.set({ [NAV_COLLAPSED_KEY]: Array.from(state.collapsed) });
  } catch (e) { /* 忽略 */ }
}

async function initNavState() {
  try {
    const { [NAV_COLLAPSED_KEY]: arr, [BM_SCROLL_KEY]: pos } = await chrome.storage.local.get([
      NAV_COLLAPSED_KEY,
      BM_SCROLL_KEY,
    ]);
    if (Array.isArray(arr)) state.collapsed = new Set(arr);
    if (typeof pos === "number") window._bmScrollRestore = pos;
    const { [BM_FOLDER_KEY]: folder } = await chrome.storage.local.get(BM_FOLDER_KEY);
    if (folder) state.currentFolder = folder;
  } catch (e) { /* 忽略 */ }
}

/** 横向面包屑导航:当前文件夹路径,点击各级切换显示 */
const BM_FOLDER_KEY = "bmFolder"; // local: 当前选中的文件夹



/** 按当前文件夹过滤分组:精确匹配;中间文件夹返回其子树分组 */




/** 书签栏右边缘按钮:向左收起 / 向右展开(状态持久化) */
const NAV_COLLAPSE_KEY = "bmNavCollapsed";

function initNavCollapse() {
  const btn = document.getElementById("bm-collapse-btn");
  const nav = document.getElementById("bm-nav");
  if (!btn || !nav) return;

  const apply = (collapsed) => {
    nav.classList.toggle("collapsed", collapsed);
    btn.textContent = collapsed ? "▶" : "◀";
    btn.title = collapsed ? "展开书签目录" : "收起书签目录";
  };

  try {
    chrome.storage.local.get(NAV_COLLAPSE_KEY).then(({ [NAV_COLLAPSE_KEY]: c }) => {
      apply(c === true);
    });
  } catch (e) { /* 忽略 */ }

  btn.addEventListener("click", () => {
    const collapsed = nav.classList.toggle("collapsed");
    apply(collapsed);
    try {
      chrome.storage.local.set({ [NAV_COLLAPSE_KEY]: collapsed });
    } catch (e) { /* 忽略 */ }
  });
}
function renderBookmarks() {
  // 清爽模式守卫:不渲染网格内容(书签/快捷方式/favicon 请求都不触发)
  if (document.body.classList.contains("mode-clean")) return;
  const groupsEl = document.getElementById("bm-groups");
  const navEl = document.getElementById("bm-nav");
  const emptyEl = document.getElementById("bm-empty");

  groupsEl.innerHTML = "";
  if (navEl) navEl.innerHTML = "";
  if (state.bookmarks.length === 0) {
    emptyEl.textContent = "暂无收藏夹内容。在 Chrome 中添加收藏夹后会自动出现在这里。";
  }
  emptyEl.hidden = state.bookmarks.length > 0;

  const groups = groupBookmarks(state.bookmarks);
  // 仅"书签栏"根分组排最前,其余保持 Chrome 原始顺序(稳定排序)
  groups.sort((a, b) => (a.title === "书签栏" ? 0 : 1) - (b.title === "书签栏" ? 0 : 1));
  groups.forEach((group) => {
    const section = document.createElement("section");
    section.className = "bm-group";
    section.dataset.navTitle = group.title;

    const h = document.createElement("div");
    h.className = "bm-group-title";
    h.textContent = group.title;

    // 分组标题后显示该分组书签数量
    const gCount = document.createElement("span");
    gCount.className = "bm-group-count";
    gCount.textContent = "(" + group.items.length + ")";
    h.appendChild(gCount);

    const grid = document.createElement("div");
    grid.className = "bm-grid";
    for (const item of group.items) grid.appendChild(createCard(item));

    section.append(h, grid);
    groupsEl.appendChild(section);
  });

  // 构建并渲染书签树导航(仿 chrome://bookmarks 层级)
  const root = buildNavTree(groups);
  renderNavWrapper(root, navEl);

  updateNavActive();
}

/**
 * 构建文件夹树:以"书签栏"为唯一根,
 * 其他顶级文件夹(其他书签/移动设备书签)作为书签栏子级。
 * 返回 { name, path, folder, level, children } 树。
 */
function buildNavTree(groups) {
  const root = { name: "书签栏", path: "书签栏", folder: null, level: 0, children: [] };
  const nodes = new Map();
  nodes.set(root.path, root);

  for (const g of groups) {
    if (!g.title || !g.title.trim()) continue; // 跳过空标题分组
    const parts = g.title.split(" / ").filter((p) => p.length > 0); // 过滤空路径段
    if (!parts.length) continue;
    const navParts = parts[0] === "书签栏" ? parts : ["书签栏", ...parts];
    let cur = root;
    let curPath = root.path;
    for (let i = 1; i < navParts.length; i++) {
      curPath += " / " + navParts[i];
      let node = nodes.get(curPath);
      if (!node) {
        node = {
          name: navParts[i],
          path: curPath,
          folder: null,   // 该路径是否有独立书签分组
          firstGroup: null, // 子树中第一个有书签的分组标题(点击兜底定位用)
          level: i,
          parent: cur,
          children: [],
        };
        nodes.set(curPath, node);
        cur.children.push(node);
      }
      if (i === navParts.length - 1) {
        // 基于原始分组首段判断:非"书签栏"顶级需要去掉导航前缀,用于右侧定位
        const originalTitle =
          parts[0] === "书签栏" ? curPath : curPath.replace(/^书签栏 \/ /, "");
        if (g.title === originalTitle) node.folder = g.title;
        // 回溯设置祖先的 firstGroup,保证点击任意文件夹都能定位到其内容
        let cur2 = node;
        while (cur2 && !cur2.firstGroup) {
          cur2.firstGroup = g.title;
          cur2 = cur2.parent;
        }
      }
      cur = node;
    }
  }
  return root;
}

/** 渲染树到导航容器 */
function renderNav(root, navEl) {
  if (!navEl) return;
  navEl.innerHTML = "";
  renderNavNode(root, navEl);
}

/* 导航路径自定义 tooltip:即时显示,无原生 title 延迟 */
function createNavTooltip() {
  if (document.getElementById("nav-tooltip")) return;
  const t = document.createElement("div");
  t.id = "nav-tooltip";
  t.className = "nav-tooltip";
  t.hidden = true;
  document.body.appendChild(t);
}

function showNavTooltip(e, path) {
  const t = document.getElementById("nav-tooltip");
  if (!t) return;
  t.textContent = path;
  t.hidden = false;
  moveNavTooltip(e);
}

function moveNavTooltip(e) {
  const t = document.getElementById("nav-tooltip");
  if (!t || t.hidden) return;
  const pad = 12;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  const tw = t.offsetWidth;
  const th = t.offsetHeight;
  if (x + tw > window.innerWidth - 8) x = e.clientX - tw - pad;
  if (y + th > window.innerHeight - 8) y = e.clientY - th - pad;
  t.style.left = x + "px";
  t.style.top = y + "px";
}

function hideNavTooltip() {
  const t = document.getElementById("nav-tooltip");
  if (t) t.hidden = true;
}

function renderNavNode(node, parent) {
  const row = document.createElement("div");
  row.className = "bm-nav-node";
  // 缩进由嵌套子容器(bm-nav-children)提供,此处不再按层级设 padding
  row.dataset.level = String(node.level);
  row.dataset.path = node.path;
  row.dataset.title = node.folder || ""; // 原始分组标题,滚动定位高亮匹配用

  // 展开/折叠箭头(仅含子文件夹时)
  const arrow = document.createElement("span");
  arrow.className = "bm-nav-arrow";
  if (node.children.length) {
    arrow.textContent = state.collapsed.has(node.path) ? "▸" : "▾";
    arrow.addEventListener("click", (e) => {
      e.stopPropagation();
      if (state.collapsed.has(node.path)) state.collapsed.delete(node.path);
      else state.collapsed.add(node.path);
      renderNav(document.getElementById("bm-nav").__root, document.getElementById("bm-nav"));
      updateNavActive();
      saveNavState(); // 持久化折叠状态
    });
  } else {
    arrow.textContent = "";
  }

  const name = document.createElement("span");
  name.className = "bm-nav-name";
  name.textContent = node.name;
  // 自定义即时 tooltip:悬浮立即显示完整路径(原生 title 有约 1s 延迟且易被重绘打断)
  name.addEventListener("mouseenter", (e) => showNavTooltip(e, node.path));
  name.addEventListener("mousemove", moveNavTooltip);
  name.addEventListener("mouseleave", hideNavTooltip);

  row.append(arrow, name);

  // 根节点"书签栏"名称后显示书签总数
  if (node.level === 0) {
    const cnt = document.createElement("span");
    cnt.className = "bm-nav-count";
    cnt.textContent = state.bookmarks.length ? "(" + state.bookmarks.length + ")" : "";
    row.appendChild(cnt);
  }

  // 点击节点:立即显示选中状态,并滚动定位到该文件夹的书签分组;
  // 滚动过程中/结束后由 updateNavActive 按位置接管选中
  row.addEventListener("click", () => {
    const navEl2 = document.getElementById("bm-nav");
    if (navEl2) {
      navEl2.querySelectorAll(".bm-nav-node").forEach((n) => n.classList.remove("active"));
    }
    row.classList.add("active"); // 点击即选中
    if (node.level === 0) {
      // 最上级"书签栏":滚动条滑到最上面(根分组在最前)
      const gEl = document.getElementById("bm-groups");
      if (gEl) gEl.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const target = groupsElOf(node.folder || node.firstGroup || node.path);
    if (target) scrollToGroup(target);
  });

  parent.appendChild(row);

  // 递归子级(折叠时隐藏):子级放进嵌套容器,左边框即层级连接线(贯穿子级,末项不悬空)
  if (node.children.length && !state.collapsed.has(node.path)) {
    const sub = document.createElement("div");
    sub.className = "bm-nav-children";
    for (const c of node.children) renderNavNode(c, sub);
    parent.appendChild(sub);
  }
}

/** 供箭头折叠时重渲染导航使用:记录根节点引用 */
function renderNavWrapper(root, navEl) {
  if (navEl) navEl.__root = root;
  renderNav(root, navEl);
}

/** 平滑滚动收藏夹容器,使分组顶部对齐(容器内差值定位,比 scrollIntoView 更稳) */
function scrollToGroup(target) {
  const groupsEl = document.getElementById("bm-groups");
  if (!groupsEl || !target) return;
  const containerRect = groupsEl.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  groupsEl.scrollTo({
    top: groupsEl.scrollTop + (targetRect.top - containerRect.top),
    behavior: "smooth",
  });
}

function groupsElOf(title) {
  const groupsEl = document.getElementById("bm-groups");
  if (!groupsEl) return null;
  const all = groupsEl.querySelectorAll(".bm-group");
  for (const g of all) {
    if (g.dataset.navTitle === title) return g;
  }
  return null;
}

/** 高亮当前可见文件夹对应的导航节点(scroll 高频调用,rAF 节流到每帧一次) */
let navActiveRaf = null;
function updateNavActive() {
  if (navActiveRaf) return; // 已有待执行帧,合并本次
  navActiveRaf = requestAnimationFrame(() => {
    navActiveRaf = null;
    const groupsEl = document.getElementById("bm-groups");
    const navEl = document.getElementById("bm-nav");
    if (!groupsEl || !navEl) return;
    const groups = groupsEl.querySelectorAll(".bm-group");
    if (!groups.length) return;

    const top = groupsEl.getBoundingClientRect().top;
    let active = null;
    for (const g of groups) {
      if (g.getBoundingClientRect().top <= top + 60) {
        active = g.dataset.navTitle;
      } else {
        break;
      }
    }
    navEl.querySelectorAll(".bm-nav-node").forEach((n) => {
      // 将分组标题统一为导航路径(非书签栏顶级加"书签栏 / "前缀),与节点 path 匹配
      const navPath =
        active && active !== "书签栏" && active.indexOf("书签栏 / ") !== 0
          ? "书签栏 / " + active
          : active;
      n.classList.toggle("active", n.dataset.path === navPath);
    });

    // 右侧书签分组同步选中状态:当前可见分组的标题高亮
    groups.forEach((g) => {
      g.classList.toggle("active", g.dataset.navTitle === active);
    });
  });
}

function bindNavScroll() {
  const groupsEl = document.getElementById("bm-groups");
  if (!groupsEl) return;
  groupsEl.addEventListener("scroll", () => updateNavActive(), { passive: true });
}

/* ===== AI 生成队列 ===== */
async function loadInitialData() {
  // 搜索引擎(搜索栏必需,立即加载)+ API key/AUTO 开关
  const eng = await chrome.storage.local.get([ENGINES_KEY, ENGINE_CURRENT_KEY, "enginesMerged", API_KEY_STORAGE, AUTO_KEY]);
  if (Array.isArray(eng[ENGINES_KEY]) && eng[ENGINES_KEY].length) {
    state.engines = eng[ENGINES_KEY];
    // 一次性合并默认引擎:缺的默认引擎补到末尾,之后尊重用户删减
    if (!eng.enginesMerged) {
      const ids = new Set(state.engines.map((e) => e.id));
      let changed = false;
      for (const d of DEFAULT_ENGINES) {
        if (!ids.has(d.id)) {
          state.engines.push({ ...d });
          ids.add(d.id);
          changed = true;
        }
      }
      try {
        chrome.storage.local.set({ [ENGINES_KEY]: state.engines, enginesMerged: true });
      } catch (e) { /* 忽略 */ }
    }
  } else {
    state.engines = [...DEFAULT_ENGINES];
  }

  // 清理重复引擎(同名或同站点源,如手动添加的 360/搜狗 与默认项):保留第一个
  const seenN = new Set();
  const seenU = new Set();
  state.engines = state.engines.filter((e) => {
    const nk = String(e.name || "").trim();
    let uk = "";
    try { uk = new URL(e.url).origin; } catch (err) { uk = String(e.url || ""); }
    if ((nk && seenN.has(nk)) || (uk && seenU.has(uk))) return false;
    if (nk) seenN.add(nk);
    if (uk) seenU.add(uk);
    return true;
  });
  try {
    chrome.storage.local.set({ [ENGINES_KEY]: state.engines });
  } catch (e) { /* 忽略 */ }

  if (eng[ENGINE_CURRENT_KEY]) state.currentEngineId = eng[ENGINE_CURRENT_KEY];
  if (typeof eng[AUTO_KEY] === "boolean") state.auto = eng[AUTO_KEY];
  return { hasKey: !!(eng[API_KEY_STORAGE] && eng[API_KEY_STORAGE].trim()) };
}

/** 书签 + 快捷方式数据(网格内容):清爽模式刷新时不加载,切回网格模式再加载(网格资源门控) */
async function loadGridBookmarks() {
  const [cached, local] = await Promise.all([
    chrome.storage.session.get(BOOKMARK_KEY),
    chrome.storage.local.get([DESC_KEY, TITLE_KEY, DESC_FAIL_KEY, MANUAL_KEY, QUICK_KEY]),
  ]);

  if (Array.isArray(cached[BOOKMARK_KEY]) && cached[BOOKMARK_KEY].length > 0) {
    state.bookmarks = cached[BOOKMARK_KEY];
  } else {
    // 冷启动:session 缓存为空,主动向后台拉取
    try {
      const items = await chrome.runtime.sendMessage({ type: "getBookmarks" });
      if (Array.isArray(items) && items.length) state.bookmarks = items;
    } catch {
      /* 后台未就绪,稍后 storage.onChanged 会刷新 */
    }
  }
  state.descriptions = local[DESC_KEY] || {};
  state.titles = local[TITLE_KEY] || {};
  state.failed = local[DESC_FAIL_KEY] || {};
  state.manual = local[MANUAL_KEY] || {};
  // 快捷方式:完全以用户 storage 数据为准,不再合并/备份/回写
  // 注意:仅当从未设置(undefined)时用默认值;空数组([])是用户清空后的合法状态,须原样保留
  state.quickLinks = Array.isArray(local[QUICK_KEY]) ? local[QUICK_KEY] : [...DEFAULT_QUICK];
}



/* ===== 接口列表(设置弹窗查看所有 API 状态) ===== */
/* ===== 配置导出 / 导入 ===== */
const EXPORT_KEYS = [
  // 基础设置
  "quickLinks",
  "selfStocks",             // 自选股列表(用户数据,随配置导出/导入)
  API_KEY_STORAGE,
  "baseUrl",
  "model",
  ENGINES_KEY,
  ENGINE_CURRENT_KEY,
  ALPHA_KEY,
  BLUR_KEY,
  BG_COLOR_KEY,
  QL_NAME_KEY,
  AUTO_KEY,
  "hotBoardIdx",
  // 外观与交互设置
  HOME_MODE_KEY,        // 清爽/网格模式
  THUMB_BM_KEY,         // 书签网页预览开关
  THUMB_QL_KEY,         // 快捷方式网页预览开关
  FAB_AUTO_KEY,         // 右上角按钮自动隐藏
  CLEAN_BG_KEY,         // 清爽背景蒙版(磨砂度/透明度)
  "savedWallpaper",     // 自定义壁纸 URL(常量 SAVED_WP_KEY 定义在下方,用字面量避免 TDZ)
  "weatherEffectEnabled", // 天气效果开关(同上)
  NAV_COLLAPSE_KEY,     // 收藏夹导航栏折叠状态
  NAV_COLLAPSED_KEY,    // 折叠的收藏夹文件夹路径
  "petIndex",           // 上次选择的宠物
  "dcAutoRotate",       // 梦想之车自动旋转开关
  "noiseIdx",           // 白噪音当前音效索引
  "noisePlaying",       // 白噪音播放状态(导入后按浏览器策略尝试恢复)
  "cardHeights",        // 各组件卡片高度档位(1/4-4/4)
  "cardHidden",         // 组件卡片隐藏状态
  "cardOrder",          // 组件卡片显示顺序
  // 用户数据(书签 AI 标题/描述,含手动维护)
  DESC_KEY,
  TITLE_KEY,
  MANUAL_KEY,
  DESC_FAIL_KEY,
];

/** 导出全部配置为 JSON 文件 */
function exportConfig() {
  try {
    chrome.storage.local.get(EXPORT_KEYS, (r) => {
      const data = {};
      for (const k of EXPORT_KEYS) {
        if (r[k] !== undefined) data[k] = r[k];
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const d = new Date();
      a.href = url;
      a.download = "banana-home-config-" + d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0") + ".json";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 500);
    });
  } catch (e) {
    alert("导出失败:" + e.message);
  }
}

/** 从 JSON 文件导入配置并恢复 */
function importConfig() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || typeof data !== "object") throw new Error("格式错误");
        const out = {};
        let count = 0;
        for (const k of EXPORT_KEYS) {
          if (data[k] !== undefined) { out[k] = data[k]; count++; }
        }
        if (!count) { alert("导入失败:未找到可识别的配置数据"); return; }
        chrome.storage.local.set(out, () => {
          alert("已导入 " + count + " 项配置,正在刷新生效…");
          setTimeout(() => location.reload(), 600);
        });
      } catch (e) {
        alert("导入失败:配置文件格式错误");
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

/** 动态构建接口列表:统一注册表(页面) + 后台注册表(异步合并) */
function buildApiList() {
  const year = new Date().getFullYear();
  const baseUrl = (state.baseUrl || "https://api.deepseek.com").replace(/\/+$/, "");
  // 兼容用户可能把完整端点填进 base_url:避免重复拼接
  const chatUrl = /\/chat\/completions$/i.test(baseUrl) ? baseUrl : baseUrl + "/chat/completions";
  const modelsUrl = /\/models$/i.test(baseUrl) ? baseUrl : baseUrl + "/models";
  const pageApis = (typeof window !== "undefined" && window.__apiRegistry) || [];
  const list = [];

  // 1) 页面注册表(热榜/腾讯行情/节假日等已自动登记)
  const seen = new Set();
  pageApis.forEach((a) => {
    if (!a || !a.name || !a.url) return;
    const k = a.name + "|" + a.url;
    if (seen.has(k)) return;
    seen.add(k);
    list.push({ name: a.name, desc: a.desc || "", url: a.url });
  });

  // 2) 后台注册表(抖音/DeepSeek/Bing/IP/天气等,异步合并)
  const bg = window._bgApis || [];
  bg.forEach((a) => {
    if (!a || !a.name || !a.url) return;
    const k = a.name + "|" + a.url;
    if (seen.has(k)) return;
    seen.add(k);
    list.push({ name: a.name, desc: a.desc || "", url: a.url });
  });

  // 3) DeepSeek 条目始终用当前配置的 base_url 重建(覆盖任何旧登记)
  for (let i = list.length - 1; i >= 0; i--) {
    if (/deepseek/i.test(list[i].name)) list.splice(i, 1);
  }
  list.unshift(
    { name: "DeepSeek API", desc: "AI 生成书签标题与简介", url: chatUrl },
    { name: "DeepSeek 模型", desc: "获取可用模型版本", url: modelsUrl }
  );

  // 4) 其他兜底:未注册的静态项
  if (!list.some((a) => a.name === "一言")) {
    list.push({ name: "一言", desc: "名言警句", url: "https://v1.hitokoto.cn/" });
  }
  if (!list.some((a) => a.name === "Open-Meteo")) {
    list.push({ name: "Open-Meteo", desc: "天气查询", url: "https://api.open-meteo.com/v1/forecast" });
  }
  if (!list.some((a) => a.name === "IP 定位")) {
    list.push({ name: "IP 定位", desc: "出口 IP 与地理定位", url: "http://ip-api.com/json/" });
  }
  if (!list.some((a) => a.name === "BigDataCloud")) {
    list.push({ name: "BigDataCloud", desc: "经纬度反查城市名", url: "https://api.bigdatacloud.net/data/reverse-geocode-client" });
  }
  if (!list.some((a) => a.name === "Bing 壁纸")) {
    list.push({ name: "Bing 壁纸", desc: "每日背景壁纸", url: "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN" });
  }
  if (!list.some((a) => a.name === "地图瓦片")) {
    list.push({ name: "地图瓦片", desc: "位置地图底图(高德)", url: "https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x=125&y=73&z=8" });
  }
  return list;
}

/** 从接口获取模型列表并填充下拉(带 base_url + key) */
function loadModelList(silent) {
  const sel = document.getElementById("set-model");
  if (!sel) return;
  const keyInput = document.getElementById("set-key");
  const baseInput = document.getElementById("set-base-url");
  const key = keyInput ? keyInput.value.trim() : "";
  const base = baseInput ? baseInput.value.trim() : state.baseUrl;
  if (!key) {
    if (!silent) alert("请先填写并保存 API Key");
    return;
  }
  try {
    chrome.runtime.sendMessage({ type: "getDeepSeekModels", key, baseUrl: base }, (res) => {
      if (chrome.runtime.lastError || !res || res.status !== "ok" || !Array.isArray(res.models) || !res.models.length) {
        if (!silent) alert("获取模型列表失败,请检查 Base URL 与 API Key");
        return;
      }
      const cur = sel.value || state.model;
      sel.innerHTML = "";
      for (const id of res.models) {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = id;
        sel.appendChild(opt);
      }
      if (res.models.indexOf(cur) >= 0) sel.value = cur;
      else { sel.value = res.models[0]; state.model = res.models[0]; }
    });
  } catch (e) {
    if (!silent) alert("获取模型列表失败");
  }
}

function renderApiList() {
  const box = document.getElementById("api-list-body");
  if (!box) return;
  // 立即渲染当前已知注册表(避免第一次打开空白),再异步补全后台注册表
  renderApiListInner();
  try {
    chrome.runtime.sendMessage({ type: "getApiRegistry" }, (res) => {
      if (!chrome.runtime.lastError && res && res.status === "ok") {
        window._bgApis = res.registry || [];
      }
      renderApiListInner(); // 补全后刷新(状态重新检测)
    });
  } catch (e) { /* 忽略 */ }
  function renderApiListInner() {
    const apiList = buildApiList();
    window._apiList = apiList;
    box.innerHTML = "";
  apiList.forEach((api, i) => {
    const row = document.createElement("div");
    row.className = "api-row";
    const info = document.createElement("div");
    info.className = "api-info";
    const name = document.createElement("div");
    name.className = "api-name";
    name.textContent = api.name;
    const desc = document.createElement("div");
    desc.className = "api-desc";
    desc.textContent = api.desc;
    const addr = document.createElement("div");
    addr.className = "api-url";
    addr.textContent = api.url;
    addr.title = api.url;
    info.append(name, desc, addr);
    const status = document.createElement("span");
    status.className = "api-status checking";
    status.textContent = "检测中…";
    status.dataset.idx = String(i);
    row.append(info, status);
      box.appendChild(row);
    });
    checkApis();
  }
}

function checkApis() {
  const apiList = window._apiList || buildApiList();
  const urls = apiList.map((a) => a.url);
  // API Key 来源:输入框当前值优先,其次 storage 已保存的 key
  const keyInput = document.getElementById("set-key");
  const inputKey = keyInput ? keyInput.value.trim() : "";
  chrome.storage.local.get(API_KEY_STORAGE).then((r) => {
    const apiKey = inputKey || r[API_KEY_STORAGE] || "";
    doCheckApis(apiKey);
  }).catch(() => doCheckApis(inputKey));
  function doCheckApis(apiKey) {
  try {
    chrome.runtime.sendMessage({ type: "checkApis", urls, apiKey }, (res) => {
      if (chrome.runtime.lastError) {
        // Service Worker 无此分支:通常是扩展未重新加载/浏览器未重启
        document.querySelectorAll(".api-status").forEach((el) => {
          el.textContent = "请重启浏览器";
          el.className = "api-status warn";
        });
        return;
      }
      if (!res || res.status !== "ok") {
        document.querySelectorAll(".api-status").forEach((el) => {
          el.textContent = "检测失败";
          el.className = "api-status fail";
        });
        return;
      }
      const hasKey = (apiKey || "").trim().length > 0;
      apiList.forEach((api, i) => {
        const el = document.querySelector('.api-status[data-idx="' + i + '"]');
        if (!el) return;
        const st = res.results[api.url] || {};
        if (st.skipped || (/deepseek/i.test(api.url) && !hasKey)) {
          el.textContent = "未配置 Key";
          el.className = "api-status warn";
          return;
        }
        const r = res.results[api.url];
        if (r && r.ok) {
          el.textContent = "✓ 可用";
          el.className = "api-status ok";
        } else {
          el.textContent = "✗ 不可用" + (r && r.status ? " (" + r.status + ")" : "");
          el.className = "api-status fail";
        }
      });
    });
  } catch (e) {
    document.querySelectorAll(".api-status").forEach((el) => {
      el.textContent = "检测失败";
      el.className = "api-status fail";
    });
  }
  }
}

/** AI 生成名言释义(DeepSeek,按文本缓存),显示在名言下一行 */
async function explainQuoteText(text, from) {
  const box = document.getElementById("quote-explain");
  if (!box || !text) return;
  // 未配置 API Key:直接提示,不发后台消息(避免无谓往返)
  try {
    const { [API_KEY_STORAGE]: savedKey } = await chrome.storage.local.get(API_KEY_STORAGE);
    if (!savedKey || !savedKey.trim()) {
      box.textContent = "释义:未配置 API Key";
      box.hidden = false;
      return;
    }
  } catch (e) { /* 忽略 */ }
  // 缓存 key 直接用文本原文(旧版按 hash 取模,不同名言可能碰撞显示错缓存)
  const cacheKey = "quoteExplain_" + text;
  try {
    const cached = await chrome.storage.local.get(cacheKey);
    if (cached[cacheKey]) { box.textContent = "释义:" + cached[cacheKey]; box.hidden = false; return; }
  } catch (e) { /* 忽略 */ }
  box.textContent = "释义:生成中…";
  box.hidden = false;
  // 重试机制:端口关闭/超时自动重试(最多 3 次)
  const tryExplain = (attempt) => {
    try {
      chrome.runtime.sendMessage({ type: "explainQuote", text, from }, (res) => {
        if (chrome.runtime.lastError) {
          if (attempt < 2) { setTimeout(() => tryExplain(attempt + 1), 800); return; }
          box.textContent = "释义:生成失败(网络超时,点击名言重试)";
          box.hidden = false;
          return;
        }
        if (!res || res.status !== "ok" || !res.explain) {
          box.textContent = res && res.status === "no-key" ? "释义:未配置 API Key" : "释义:生成失败";
          box.hidden = false;
          return;
        }
        box.textContent = "释义:" + res.explain;
        box.hidden = false;
        try { chrome.storage.local.set({ [cacheKey]: res.explain }); } catch (e) { /* 忽略 */ }
      });
    } catch (e) {
      if (attempt < 2) { setTimeout(() => tryExplain(attempt + 1), 800); return; }
      box.textContent = "释义:生成失败";
      box.hidden = false;
    }
  };
  tryExplain(0);
}

function updateGenButton(label, disabled) {
  // 进度显示在主页右上角设置按钮旁(弹窗可关闭,不影响生成)
  const prog = document.getElementById("gen-progress");
  if (!prog) return;
  const bar = document.querySelector(".top-right-bar");
  if (disabled && label && label.indexOf("生成中") === 0) {
    prog.textContent = label;
    prog.hidden = false;
    if (bar) bar.classList.add("fab-bar-pinned"); // 生成期间强制显示,避免自动隐藏看不到进度
  } else {
    prog.hidden = true;
    if (bar) bar.classList.remove("fab-bar-pinned");
  }
}

/** 发送单个书签生成请求:回调式 + 显式超时,保证单个书签绝不挂起整个队列 */
function sendDescribe(url, title) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (res) => { if (!settled) { settled = true; resolve(res); } };
    try {
      chrome.runtime.sendMessage({ type: "describeBookmark", url, title, model: state.model, baseUrl: state.baseUrl }, (res) => {
        if (chrome.runtime.lastError) return done({ status: "failed" });
        done(res || { status: "failed" });
      });
    } catch (e) {
      done({ status: "failed" });
    }
    setTimeout(() => done({ status: "timeout" }), 9000); // 9s 兜底:超时按失败跳过
  });
}

/** 串行为缺少标题或描述、且未失败/未手动维护的书签生成 */
async function runDescribeQueue() {
  const pending = state.bookmarks.filter((b) => {
    if (state.failed[b.url] || state.manual[b.url]) return false;
    return !(state.titles[b.url] && state.descriptions[b.url]);
  });
  if (!pending.length) {
    updateGenButton("✨ 一键 AI 生成", false);
    return;
  }

  state.generating = true;
  renderBookmarks();
  updateGenButton("生成中 0/" + pending.length + "…", true);

  let done = 0;
  for (const item of pending) {
    let noKey = false;
    try {
      const res = await sendDescribe(item.url, item.title);
      if (res && res.status === "ok") {
        if (res.title) state.titles[item.url] = res.title;
        if (res.text) state.descriptions[item.url] = res.text;
        done += 1;
      } else if (res && res.status === "failed") {
        state.failed[item.url] = true; // 网页访问失败/超时:标记跳过,继续下一个
      } else if (res && res.status === "timeout") {
        state.failed[item.url] = true;
      } else if (res && res.status === "no-key") {
        noKey = true;
      }
    } catch (e) {
      state.failed[item.url] = true; // 单个异常也跳过,不中断队列
    }
    try {
      updateGenButton("生成中 " + done + "/" + pending.length + "…", true);
    } catch (e) { /* 忽略 */ }
    if (noKey) break;
    // 每次让出主线程,避免单书签问题连带阻塞
    await new Promise((r) => setTimeout(r, 30));
  }

  state.generating = false;
  renderBookmarks();
  updateGenButton("✨ 一键 AI 生成", false);
}

/* ===== 快捷方式 ===== */
let qlPageSize = 14; // 每页数量(自适应:按窗口高度计算行数) // 每页快捷方式数量(2 列 × 7 行)
let quickPage = 0;              // 当前页(0 起)

/** 翻页(左右平移动画):direction=1 下一页,-1 上一页 */


/** 跳转到指定页(圆点点击),按方向播放动画 */
/** 圆点翻页:三页平铺平移(当前页滑出,相邻页滑入),无逐列挤压 */
function turnPageTo(p) {
  const total = state.quickLinks.length;
  let totalPages = Math.max(1, Math.ceil(total / qlPageSize));
  if (total > 0 && total % qlPageSize === 0) totalPages += 1; // 满页时"＋"顺延页
  if (p < 0 || p >= totalPages || p === quickPage) return;
  const dir = p > quickPage ? 1 : -1;
  const grid = document.getElementById("ql-grid");
  const ng = document.getElementById("ql-grid-next");
  const pg = document.getElementById("ql-grid-prev");
  const vp = document.getElementById("ql-viewport");
  const W = vp ? vp.clientWidth : 200;

  if (dir === 1 && ng) {
    // 下一页:当前页平铺滑出左,下一页(右侧层)平铺滑到原位
    grid.style.transition = "transform 0.18s ease";
    grid.style.transform = "translateX(-" + W + "px)";
    ng.style.transition = "transform 0.18s ease";
    ng.style.transform = "translateX(0)";
    setTimeout(() => {
      grid.style.transition = "";
      ng.style.transition = "";
      quickPage = p;
      renderQuickLinks();
    }, 180);
  } else if (dir === -1 && pg) {
    // 上一页:当前页平铺滑出右,前一页(左侧层)滑到原位
    grid.style.transition = "transform 0.18s ease";
    grid.style.transform = "translateX(" + W + "px)";
    pg.style.transition = "transform 0.18s ease";
    pg.style.transform = "translateX(" + W + "px)";
    setTimeout(() => {
      grid.style.transition = "";
      pg.style.transition = "";
      quickPage = p;
      renderQuickLinks();
    }, 180);
  } else {
    quickPage = p;
    renderQuickLinks();
  }
}

function makeQuickIcon(q, onLoaded) {
  const icon = document.createElement("span");
  icon.className = "ql-icon";

  // 显示网站 favicon(chrome._favicon),无图标则留空
  // 不用 lazy:分页重建后图标需立即加载,否则翻页后新页图标空白
  const img = document.createElement("img");
  img.alt = "";
  let retried = false;

  const tryLoad = () => {
    // 重试时追加时间戳,打破 _favicon 空结果缓存
    img.src = buildFavicon(q.url) + (retried ? "&t=" + Date.now() : "");
  };

  img.addEventListener("load", () => {
    if (img.naturalWidth > 1 || img.naturalHeight > 1) {
      if (onLoaded) onLoaded(img);
    } else if (!retried) {
      retried = true;
      setTimeout(() => { if (document.body.contains(img)) tryLoad(); }, 700);
    } else {
      img.remove(); // 两次都是空白,留空
    }
  });
  img.addEventListener("error", () => {
    if (!retried) {
      retried = true;
      setTimeout(() => { if (document.body.contains(img)) tryLoad(); }, 700);
    } else {
      img.remove();
    }
  });

  tryLoad();
  icon.appendChild(img);
  return icon;
}

/** 按指定可用高度计算快捷方式每页数量(2 列;高度未定/过小时回退 14) */
function pageSizeForHeight(h) {
  const usable = h - 26; // 预留圆点导航区
  if (usable <= 0) return 14;
  const rows = Math.max(2, Math.floor(usable / 88)); // 行高 88 = 82px 行 + 6px 间距
  return rows * 2;
}

/** 计算快捷方式每页数量:按可用高度动态调整行数(2 列) */
function computeQlPageSize() {
  // 用稳定容器(.quick-links,flex 固定高度)计算,避免被网格内容撑开导致震荡
  const ql = document.querySelector(".quick-links");
  if (!ql) return 14;
  return pageSizeForHeight(ql.clientHeight);
}

/** 重算快捷方式每页数量;useHeight 可传入指定高度(模式切换等过渡场景用最终高度) */
function recalcQlPageSize(useHeight) {
  const np = useHeight != null ? pageSizeForHeight(useHeight) : computeQlPageSize();
  if (np !== qlPageSize) {
    qlPageSize = np;
    const totalPages = getQlTotalPages();
    if (quickPage >= totalPages) quickPage = totalPages - 1;
    if (quickPage < 0) quickPage = 0;
    renderQuickLinks();
  }
}

function initQlResponsive() {
  // 首次计算(等布局完成)
  setTimeout(recalcQlPageSize, 600); // 等布局稳定后再算,避免首屏高度未定导致行数回跳
  window.addEventListener("resize", () => {
    clearTimeout(window.__qlResizeTimer);
    window.__qlResizeTimer = setTimeout(recalcQlPageSize, 200);
  });
}

/* ===== 快捷方式跨页拖拽排序 ===== */
let qlDrag = null;

function qlStartDrag(e, fromIndex, itemEl) {
  qlDrag = {
    fromIndex,
    startX: e.clientX,
    startY: e.clientY,
    active: false,
    page: quickPage,
    el: itemEl,
    ghost: null,
    lastFlip: 0,
  };
  document.addEventListener("mousemove", qlDragMove);
  document.addEventListener("mouseup", qlDragEnd);
}

function qlDragMove(e) {
  if (!qlDrag) return;
  if (!qlDrag.active) {
    if (Math.abs(e.clientX - qlDrag.startX) + Math.abs(e.clientY - qlDrag.startY) < 8) return;
    // 进入拖拽:创建跟随代理
    qlDrag.active = true;
    qlDrag.el.classList.add("dragging");
    const gridEl = document.getElementById("ql-grid");
    if (gridEl) gridEl.classList.add("ql-dragging"); // 拖动中禁止其他快捷方式点击
    qlDrag.ghost = document.createElement("div");
    qlDrag.ghost.className = "ql-drag-ghost";
    const icon = qlDrag.el.querySelector(".ql-icon");
    if (icon) {
      const cl = icon.cloneNode(true);
      qlDrag.ghost.appendChild(cl);
    } else {
      qlDrag.ghost.textContent = "⇢";
    }
    document.body.appendChild(qlDrag.ghost);
    qlDrag.el.style.opacity = "0.35";
  }
  // 代理跟随鼠标
  qlDrag.ghost.style.left = e.clientX - 26 + "px";
  qlDrag.ghost.style.top = e.clientY - 26 + "px";
  // 边缘自动翻页(靠近视口左右边缘);拖拽中用"立即切换"(无动画),
  // 保证释放瞬间当前网格就是目标页,释放位置才准确
  const vp = document.getElementById("ql-viewport");
  if (vp) {
    const rect = vp.getBoundingClientRect();
    const now = Date.now();
    if (now - qlDrag.lastFlip > 450) {
      if (e.clientX < rect.left + 50) {
        qlDrag.lastFlip = now;
        const np = Math.max(0, quickPage - 1);
        if (np !== quickPage) { quickPage = np; renderQuickLinks(); }
        qlDrag.page = quickPage;
      } else if (e.clientX > rect.right - 50) {
        qlDrag.lastFlip = now;
        const total = getQlTotalPages();
        const np = Math.min(total - 1, quickPage + 1);
        if (np !== quickPage) { quickPage = np; renderQuickLinks(); }
        qlDrag.page = quickPage;
      }
    }
  }
}

function qlDragEnd(e) {
  document.removeEventListener("mousemove", qlDragMove);
  document.removeEventListener("mouseup", qlDragEnd);
  if (!qlDrag) return;
  const drag = qlDrag;
  qlDrag = null;
  const acted = drag.active || drag.flipped; // 移动过 或 按住后翻页过
  if (!acted) return; // 未移动未翻页,视为普通点击

  // 拦截本次点击,避免误打开其他快捷方式链接
  document.addEventListener(
    "click",
    function block(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      document.removeEventListener("click", block, true);
    },
    true
  );

  // 计算目标页插入位置(按鼠标行定位)
  let insertIdx = 0;
  const grid = document.getElementById("ql-grid");
  if (grid) {
    const items = Array.from(grid.querySelectorAll(".ql-item"));
    const rect = grid.getBoundingClientRect();
    const rowH = 88;
    const row = Math.max(0, Math.min(Math.ceil(items.length / 2) - 1, Math.floor((e.clientY - rect.top) / rowH)));
    insertIdx = Math.min(items.length, row * 2);
  }
  const arr = [...state.quickLinks];
  const [moved] = arr.splice(drag.fromIndex, 1);
  let target = drag.page * qlPageSize + insertIdx;
  if (target > arr.length) target = arr.length;
  if (target < 0) target = 0;
  arr.splice(target, 0, moved);
  state.quickLinks = arr;
  const gridAfter = document.getElementById("ql-grid");
  if (gridAfter) gridAfter.classList.remove("ql-dragging");
  if (drag.ghost) drag.ghost.remove();
  if (drag.el && drag.el.style) drag.el.style.opacity = "";
  // 确保渲染页与拖拽目标页同步(按住+滚轮翻页动画中 quickPage 可能未更新,
  // 否则会在旧页渲染,导致"添加快捷方式"框等最后一页元素消失)
  quickPage = Math.min(Math.max(0, drag.page), Math.max(0, getQlTotalPages() - 1));
  persistQuick();
  renderQuickLinks();
}

/** 快捷方式总页数(含满页时"＋"添加框顺延的额外一页) */
function getQlTotalPages() {
  const total = state.quickLinks.length;
  let pages = Math.max(1, Math.ceil(total / qlPageSize));
  if (total > 0 && total % qlPageSize === 0) pages += 1; // 满页:添加框独占下一页
  return pages;
}

function renderQuickLinks() {
  // 清爽模式守卫:不渲染网格内容
  if (document.body.classList.contains("mode-clean")) return;
  const grid = document.getElementById("ql-grid");
  grid.style.transform = ""; // 重置拖动/动画遗留的位移
  grid.innerHTML = "";
  let dragIndex = null; // 正在拖拽的源下标(闭包内共享)

  const total = state.quickLinks.length;
  let totalPages = Math.max(1, Math.ceil(total / qlPageSize));
  // 最后一页恰好满时,"＋"添加框自动顺延到下一页(否则被网格行数裁剪看不到)
  if (total > 0 && total % qlPageSize === 0) totalPages += 1;
  quickPage = Math.min(quickPage, totalPages - 1);
  const startIdx = quickPage * qlPageSize;
  const pageItems = state.quickLinks.slice(startIdx, startIdx + qlPageSize);

  pageItems.forEach((q, j) => {
    const i = startIdx + j; // 全局下标(编辑/删除用)
    const a = document.createElement("a");
    a.className = "ql-item";
    a.href = q.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = q.name + "\n" + q.url;
    // ===== 跨页拖拽排序(自定义:mousedown 启动,边缘自动翻页) =====
    a.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest(".ql-remove") || e.target.closest(".ql-edit")) return;
      qlStartDrag(e, i, a);
    });

    // 阴影颜色:默认随机柔和色,图标加载成功后从图标提取
    a.style.setProperty("--glow-color", randomGlow());

    // 图标:有 favicon 显示,否则显示名称首字默认图标(随机底色)
    const icon = makeQuickIcon(q, (img) => {
      const c = extractColor(img);
      if (c) a.style.setProperty("--glow-color", c);
    });

    // 删除按钮(右键显示)
    const remove = document.createElement("button");
    remove.className = "ql-remove";
    remove.textContent = "×";
    remove.title = "删除快捷方式";
    remove.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeQuick(i);
    });

    // 编辑按钮(右键显示,蒙版居中,点击打开编辑弹窗)
    const edit = document.createElement("button");
    edit.className = "ql-edit";
    edit.title = "编辑快捷方式";
    const editIcon = document.createElement("img");
    editIcon.src = "img/edit.png";
    editIcon.alt = "编辑";
    edit.appendChild(editIcon);
    edit.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      editQuickDialog(i, q);
    });

    // 鼠标右键点击:显示删除 + 编辑按钮
    a.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      document.querySelectorAll(".ql-remove.visible, .ql-edit.visible").forEach((r) => r.classList.remove("visible"));
      remove.classList.add("visible");
      // 编辑图标以快捷方式图标位置为准,中心对齐
      const iconRect = icon.getBoundingClientRect();
      const aRect = a.getBoundingClientRect();
      edit.style.left = iconRect.left - aRect.left + iconRect.width / 2 + "px";
      edit.style.top = iconRect.top - aRect.top + iconRect.height / 2 + "px";
      edit.classList.add("visible");
    });

    // 悬浮显示网页缩略图
    bindHover(a, { url: q.url, title: q.name }, "ql");

    a.append(icon, remove, edit);

    // 名称(可选显示,由设置开关控制;置于图标下方)
    if (state.showQuickNames) {
      const qname = document.createElement("span");
      qname.className = "ql-name";
      // 超长名称截断加省略号,完整名称保留在 title(悬停可见)
      const nm = q.name || "";
      qname.textContent = nm.length > 8 ? nm.slice(0, 8) + "…" : nm;
      qname.title = q.name;
      a.appendChild(qname);
    }

    grid.appendChild(a);
  });

  // 末尾追加"添加快捷方式"方形框(只在最后一页显示;拖拽中隐藏,释放后重新显示)
  if (quickPage === totalPages - 1 && !qlDrag) {
    const slot = document.createElement("div");
    slot.className = "ql-add-slot";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "ql-add";
    addBtn.textContent = "＋";
    addBtn.title = "添加快捷方式";
    addBtn.addEventListener("click", openQuickDialog);
    slot.appendChild(addBtn);
    // "添加"名称,与快捷方式名称一起受显示开关控制
    if (state.showQuickNames) {
      const label = document.createElement("span");
      label.className = "ql-name ql-add-name";
      label.textContent = "添加";
      slot.appendChild(label);
    }
    grid.appendChild(slot);
  }


  // 渲染"前一页/下一页"旁页层(拖动时露出),简化卡片
  renderSidePage(document.getElementById("ql-grid-prev"), quickPage - 1);
  renderSidePage(document.getElementById("ql-grid-next"), quickPage + 1);

  renderPager(totalPages);
}

/** 渲染旁页(前一页/下一页)到指定容器:简化卡片(图标+名称+链接+悬浮预览) */
function renderSidePage(container, pageIdx) {
  if (!container) return;
  container.innerHTML = "";
  container.style.transform = "";
  if (pageIdx < 0) return; // 无前一页
  const startIdx = pageIdx * qlPageSize;
  const items = state.quickLinks.slice(startIdx, startIdx + qlPageSize);
  items.forEach((q) => {
    const a = document.createElement("a");
    a.className = "ql-item";
    a.href = q.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = q.name + "\n" + q.url;
    const icon = makeQuickIcon(q);
    a.appendChild(icon);
    if (state.showQuickNames) {
      const qname = document.createElement("span");
      qname.className = "ql-name";
      qname.textContent = q.name;
      a.appendChild(qname);
    }
    bindHover(a, { url: q.url, title: q.name }, "ql");
    container.appendChild(a);
  });
}

/** 翻页指示器:底部圆点(点击跳页,当前页高亮) */
function renderPager(totalPages) {
  const dots = document.getElementById("ql-dots");
  if (!dots) return;
  dots.innerHTML = "";
  for (let p = 0; p < totalPages; p++) {
    const dot = document.createElement("span");
    dot.className = "ql-dot" + (p === quickPage ? " active" : "");
    dot.title = "第 " + (p + 1) + " 页";
    // 鼠标悬停即切换(点击同样生效)
    dot.addEventListener("mouseenter", () => turnPageTo(p));
    dot.addEventListener("click", () => turnPageTo(p));
    dots.appendChild(dot);
  }
}

async function persistQuick() {
  await chrome.storage.local.set({ [QUICK_KEY]: state.quickLinks });
}

async function removeQuick(index) {
  state.quickLinks = state.quickLinks.filter((_, i) => i !== index);
  await persistQuick();
  renderQuickLinks();
}

let editingQuickIndex = null; // null=添加模式;数字=编辑中的下标

/** 打开编辑弹窗(预填当前快捷方式信息) */
function editQuickDialog(i, q) {
  editingQuickIndex = i;
  document.getElementById("quick-dialog-title").textContent = "编辑快捷方式";
  document.getElementById("quick-submit").textContent = "保存";
  document.getElementById("quick-name").value = q.name;
  document.getElementById("quick-url").value = q.url;
  document.getElementById("quick-icon").value = q.icon || "";
  document.getElementById("quick-dialog").showModal();
  setTimeout(() => document.getElementById("quick-name").focus(), 50);
}

function openQuickDialog() {
  editingQuickIndex = null; // 添加模式
  document.getElementById("quick-dialog-title").textContent = "添加快捷方式";
  document.getElementById("quick-submit").textContent = "添加";
  const d = document.getElementById("quick-dialog");
  document.getElementById("quick-name").value = "";
  document.getElementById("quick-url").value = "";
  document.getElementById("quick-icon").value = "";
  d.showModal();
  setTimeout(() => document.getElementById("quick-name").focus(), 50);
}

async function saveQuick() {
  const name = document.getElementById("quick-name").value.trim();
  const url = document.getElementById("quick-url").value.trim();
  const icon = document.getElementById("quick-icon").value.trim();
  if (!name || !url) return;
  const fullUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  if (editingQuickIndex !== null && editingQuickIndex >= 0) {
    // 编辑模式:更新该快捷方式
    state.quickLinks[editingQuickIndex] = { name, url: fullUrl, icon };
  } else {
    // 添加模式
    state.quickLinks.push({ name, url: fullUrl, icon });
    // 跳到新项所在页,确保添加后立即可见
    quickPage = Math.floor((state.quickLinks.length - 1) / qlPageSize);
  }
  editingQuickIndex = null;
  await persistQuick();
  renderQuickLinks();
  document.getElementById("quick-dialog").close();
}

/* ===== IP 地理位置 + 天气 ===== */

/** WMO 天气代码 → emoji 图标(自绘天气卡片,零网络依赖,图标与天气严格对应) */
function weatherEmoji(code) {
  if (code === 0) return "☀️";
  if (code === 1) return "🌤️";
  if (code === 2) return "⛅";
  if (code === 3) return "☁️";
  if (code >= 45 && code <= 48) return "🌫️";
  if (code >= 51 && code <= 57) return "🌦️";
  if (code >= 61 && code <= 67) return "🌧️";
  if (code >= 71 && code <= 77) return "❄️";
  if (code >= 80 && code <= 82) return "🌦️";
  if (code >= 85 && code <= 86) return "❄️";
  if (code >= 95) return "⛈️";
  return "🌤";
}

/** 渲染自绘天气卡片(替代原天气网 iframe 组件,图标不再错配) */
/* 最近天气数据(档位变化重渲染用) */
let lastWeatherData = null;

function renderWeather(data) {
  const iconEl = document.getElementById("weather-icon");
  const tempEl = document.getElementById("weather-temp");
  const descEl = document.getElementById("weather-desc");
  const dailyEl = document.getElementById("weather-daily");
  if (!iconEl || !tempEl || !descEl) return;

  const w = data && data.weather;
  if (w) lastWeatherData = data; // 记住最新数据,档位切换时按新档位重渲染
  const card = document.getElementById("geo-weather-card");
  const height = card ? parseInt(card.dataset.height, 10) : 1;

  if (!w) {
    tempEl.textContent = "--°C";
    descEl.textContent = "天气获取失败";
    if (dailyEl) dailyEl.hidden = true;
    return;
  }
  iconEl.textContent = weatherEmoji(w.code);
  tempEl.textContent = w.temp + "°C";
  descEl.textContent = (w.desc || "未知") + (w.wind != null ? " · 风" + w.wind + "km/h" : "");

  // 未来六天预报:仅 2/4 高度显示(两行三列;1/4 只显示当天,保持内容紧凑)
  if (dailyEl) {
    if (height >= 2 && w.daily && w.daily.length) {
      dailyEl.hidden = false;
      dailyEl.innerHTML = w.daily
        .slice(0, 6)
        .map((d) => {
          const date = new Date(d.date + "T00:00:00");
          const wd = "周" + "日一二三四五六"[date.getDay()];
          return (
            '<div class="weather-day"><span class="weather-day-wd">' + wd + "</span>" +
            '<span class="weather-day-icon">' + weatherEmoji(d.code) + "</span>" +
            '<span class="weather-day-temp">' + d.tempMin + "°/" + d.tempMax + "°</span></div>"
          );
        })
        .join("");
    } else {
      dailyEl.hidden = true;
    }
  }

  // 天气效果:按当前真实天气自动匹配(晴/多云/刮风/雨/雪)
  weatherAutoType = weatherEffectType(w);
  applyWeatherEffect();
}

/* 天气卡档位变化(1/4 当天 / 2/4 三天)时重渲染 */
window.onCardHeight && window.onCardHeight(function () {
  const c = document.getElementById("geo-weather-card");
  if (c && c.dataset.height && lastWeatherData) renderWeather(lastWeatherData);
});

function renderGeoInfo(data) {
  // 数据来源:IP 定位(有 ip)或浏览器精确定位(有 lat/lon);两者都没有则忽略
  if (!data) return;
  if (!data.ip && (data.lat == null || data.lon == null)) return;
  // IP 行已移除;地图卡片由 geo-map-frame 展示当前位置

  // 地图卡片:显示当前位置(追加时间戳强制 iframe 重新加载,刷新页面时位置同步刷新)
  const mapFrame = document.getElementById("geo-map-frame");
  if (mapFrame && data.lat != null && data.lon != null) {
    const label = encodeURIComponent(
      [data.region, data.city].filter(Boolean).join(" ") || "当前位置"
    );
    mapFrame.src =
      "map.html?lat=" + data.lat + "&lon=" + data.lon + "&label=" + label + "&t=" + Date.now();
    // 左上角坐标标题:城市名 + 经纬度
    const titleEl = document.getElementById("map-title");
    if (titleEl) {
      const place = [data.region, data.city].filter(Boolean).join(" ") || "当前位置";
      titleEl.textContent = place + " · " + data.lat.toFixed(4) + ", " + data.lon.toFixed(4);
    }
  }

  // 自绘天气卡片(Open-Meteo 数据 + emoji 图标)
  renderWeather(data);
}

/** 定位失败/无位置时显示默认地图(太原),避免 iframe 空白;
 * iframe 初始 src 为空(清爽模式零资源),网格模式定位完成后才设置 */
function setDefaultMap() {
  const mapFrame = document.getElementById("geo-map-frame");
  if (!mapFrame || mapFrame.getAttribute("src")) return;
  mapFrame.src =
    "map.html?lat=37.87&lon=112.55&label=" + encodeURIComponent("太原市") + "&t=" + Date.now();
  const titleEl = document.getElementById("map-title");
  if (titleEl) titleEl.textContent = "太原市 · 37.8700, 112.5500";
}

/** 浏览器精确定位:优先于 IP 定位(基于 WiFi/基站/GPS,可到区县级) */
function useBrowserLocation() {
  if (!navigator.geolocation) {
    showMapTip("当前浏览器不支持定位", true);
    return;
  }
  showMapTip("正在精确定位…", true);
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      try {
        const data = await chrome.runtime.sendMessage({ type: "setGeoCoords", lat, lon });
        if (data && data.lat != null && data.lon != null) {
          renderGeoInfo(data); // 更新地图/天气/城市
          showMapTip("✅ 已定位到精确位置");
        }
      } catch (e) { showMapTip("定位失败,请重试", true); }
    },
    () => {
      // 失败/被拒:明确提示,不静默
      showMapTip("⚠️ 定位失败:权限被拒绝或未开启。请点击浏览器地址栏左侧图标 → 将“位置信息”改为“允许”,然后重试", true);
    },
    { timeout: 8000, maximumAge: 600000 }
  );
}

/** 地图卡片内定位提示(persist=true 停留,否则几秒后自动隐藏) */
function showMapTip(msg, persist) {
  const tip = document.getElementById("map-tip");
  if (!tip) return;
  tip.textContent = msg;
  tip.hidden = false;
  clearTimeout(showMapTip._t);
  if (!persist) {
    showMapTip._t = setTimeout(() => { tip.hidden = true; }, 3500);
  }
}

/* ===== 设置面板 ===== */

/** 应用五类磨砂度:分别设置各区域 backdrop-filter 模糊值 */
function applyBlurs(blurs) {
  const root = document.documentElement;
  for (const k of Object.keys(BLUR_KEYS)) {
    const v = typeof blurs[k] === "number" ? blurs[k] : DEFAULT_BLURS[k];
    const px = Math.max(0, Math.min(30, v));
    root.style.setProperty(BLUR_KEYS[k], px + "px");
  }
}

/** 从滑块读取当前五类磨砂度 */
function readBlurSliders() {
  const blurs = {};
  document.querySelectorAll(".blur-slider").forEach((sl) => {
    blurs[sl.dataset.key] = parseInt(sl.value, 10);
  });
  return blurs;
}

/** 读取保存的五类磨砂度(与默认合并) */
async function getBlurPrefs() {
  const { [BLUR_KEY]: saved } = await chrome.storage.local.get(BLUR_KEY);
  return { ...DEFAULT_BLURS, ...(saved || {}) };
}

/** 打开主页时恢复保存的磨砂度 */
async function initCardBlur() {
  try {
    const blurs = await getBlurPrefs();
    applyBlurs(blurs);
  } catch (e) {
    /* 忽略 */
  }
}

/** 应用五类透明度:分别设置各区域 CSS 变量 */
function applyAlphas(alphas) {
  const root = document.documentElement;
  for (const k of Object.keys(ALPHA_KEYS)) {
    const v = typeof alphas[k] === "number" ? alphas[k] : DEFAULT_ALPHAS[k];
    const a = Math.max(0, Math.min(0.4, v / 100));
    root.style.setProperty(ALPHA_KEYS[k], String(a));
  }
}

/** 从滑块读取当前五类透明度 */
function readAlphaSliders() {
  const alphas = {};
  document.querySelectorAll(".alpha-slider").forEach((sl) => {
    alphas[sl.dataset.key] = parseInt(sl.value, 10);
  });
  return alphas;
}

/** 读取保存的五类透明度(与默认合并) */
async function getAlphaPrefs() {
  const { [ALPHA_KEY]: saved } = await chrome.storage.local.get(ALPHA_KEY);
  return { ...DEFAULT_ALPHAS, ...(saved || {}) };
}

/** 打开主页时恢复保存的卡片透明度 */
async function initCardAlpha() {
  try {
    const alphas = await getAlphaPrefs();
    applyAlphas(alphas);
  } catch (e) {
    /* 忽略 */
  }
}

/* ===== 清爽模式聚焦搜索栏时的背景蒙版:磨砂度(px)与透明度(%) ===== */

/** 应用清爽模式背景蒙版样式(设置 CSS 变量,仅在清爽模式聚焦搜索栏时 .bg.has-image 使用) */
function applyCleanBg(style) {
  const root = document.documentElement;
  const blur = Math.max(0, Math.min(30, typeof style.blur === "number" ? style.blur : DEFAULT_CLEAN_BG.blur));
  const alpha = Math.max(0, Math.min(100, typeof style.alpha === "number" ? style.alpha : DEFAULT_CLEAN_BG.alpha));
  root.style.setProperty("--clean-bg-blur", blur + "px");
  root.style.setProperty("--clean-bg-alpha", String(alpha / 100));
}

/** 读取保存的清爽背景样式(与默认合并) */
async function getCleanBgPrefs() {
  const { [CLEAN_BG_KEY]: saved } = await chrome.storage.local.get(CLEAN_BG_KEY);
  return { ...DEFAULT_CLEAN_BG, ...(saved || {}) };
}

/** 打开主页时恢复保存的清爽背景样式 */
async function initCleanBg() {
  try {
    applyCleanBg(await getCleanBgPrefs());
  } catch (e) {
    /* 忽略 */
  }
}

/** 读取磨砂度滑块当前值 */
function readCleanBlur() {
  const el = document.querySelector(".clean-blur-slider");
  return el ? parseInt(el.value, 10) : DEFAULT_CLEAN_BG.blur;
}

/** 读取透明度滑块当前值 */
function readCleanAlpha() {
  const el = document.querySelector(".clean-alpha-slider");
  return el ? parseInt(el.value, 10) : DEFAULT_CLEAN_BG.alpha;
}

async function openSettings() {
  const dialog = document.getElementById("settings-dialog");
  // 一次读取全部设置键,避免多次串行 get
  const stored = await chrome.storage.local.get([
    API_KEY_STORAGE,
    AUTO_KEY,
    ALPHA_KEY,
    BLUR_KEY,
    CLEAN_BG_KEY,
    BG_COLOR_KEY,
  ]);
  const key = stored[API_KEY_STORAGE] || "";
  const auto = stored[AUTO_KEY];
  const prefs = { ...DEFAULT_ALPHAS, ...(stored[ALPHA_KEY] || {}) };
  const blurPrefs = { ...DEFAULT_BLURS, ...(stored[BLUR_KEY] || {}) };
  const cleanBgPrefs = { ...DEFAULT_CLEAN_BG, ...(stored[CLEAN_BG_KEY] || {}) };
  const bgc = stored[BG_COLOR_KEY];
  document.getElementById("set-key").value = key;
  document.getElementById("set-auto").checked = auto !== false;
  document.getElementById("set-key").placeholder =
    key ? "已保存,如需更换请重新输入" : "sk-…";
  // 填充五个透明度滑块
  document.querySelectorAll(".alpha-slider").forEach((sl) => {
    const v = typeof prefs[sl.dataset.key] === "number" ? prefs[sl.dataset.key] : DEFAULT_ALPHAS[sl.dataset.key];
    sl.value = String(v);
    const label = document.querySelector('[data-label="' + sl.dataset.key + '"]');
    if (label) label.textContent = v + "%";
  });
  // 填充五个磨砂度滑块
  document.querySelectorAll(".blur-slider").forEach((sl) => {
    const v = typeof blurPrefs[sl.dataset.key] === "number" ? blurPrefs[sl.dataset.key] : DEFAULT_BLURS[sl.dataset.key];
    sl.value = String(v);
    const label = document.querySelector('[data-blur-label="' + sl.dataset.key + '"]');
    if (label) label.textContent = v + "px";
  });
  // 填充清爽模式背景滑块(磨砂度 + 透明度)
  const cleanBlurSlider = document.querySelector(".clean-blur-slider");
  if (cleanBlurSlider) {
    cleanBlurSlider.value = String(cleanBgPrefs.blur);
    const lb = document.getElementById("clean-blur-value");
    if (lb) lb.textContent = cleanBgPrefs.blur + "px";
  }
  const cleanAlphaSlider = document.querySelector(".clean-alpha-slider");
  if (cleanAlphaSlider) {
    cleanAlphaSlider.value = String(cleanBgPrefs.alpha);
    const la = document.getElementById("clean-alpha-value");
    if (la) la.textContent = cleanBgPrefs.alpha + "%";
  }
  // 填充背景颜色调色盘
  const bgPickerFill = document.getElementById("set-bgcolor");
  if (bgPickerFill) {
    bgPickerFill.value = bgc || "#1e3c72";
  }
  // 填充 Base URL 与模型名称(手动输入)
  const baseUrlInput = document.getElementById("set-base-url");
  if (baseUrlInput) baseUrlInput.value = state.baseUrl;
  const modelInput = document.getElementById("set-model");
  if (modelInput) modelInput.value = state.model;
  loadModelList(true); // 自动从接口获取模型列表(已有 key 时)
  // 记录打开时的五类透明度与磨砂度,供"取消"回滚
  window._alphaPrev = { ...prefs };
  window._blurPrev = { ...blurPrefs };
  window._cleanBgPrev = { ...cleanBgPrefs };
  dialog.showModal();
  setTimeout(() => document.getElementById("set-key").focus(), 50);
}

async function saveSettings() {
  const key = document.getElementById("set-key").value.trim();
  const auto = document.getElementById("set-auto").checked;
  const alphas = readAlphaSliders();
  applyAlphas(alphas); // 立即生效
  const blurs = readBlurSliders();
  applyBlurs(blurs); // 立即生效
  const cleanBg = { blur: readCleanBlur(), alpha: readCleanAlpha() };
  applyCleanBg(cleanBg); // 立即生效
  const model = document.getElementById("set-model") ? document.getElementById("set-model").value.trim() || "deepseek-chat" : state.model;
  const baseUrl = document.getElementById("set-base-url") ? document.getElementById("set-base-url").value.trim() || "https://api.deepseek.com" : state.baseUrl;
  state.model = model;
  state.baseUrl = baseUrl;
  await chrome.storage.local.set({
    [API_KEY_STORAGE]: key,
    [AUTO_KEY]: auto,
    [ALPHA_KEY]: alphas,
    [BLUR_KEY]: blurs,
    [CLEAN_BG_KEY]: cleanBg,
    [MODEL_KEY]: model,
    [BASE_URL_KEY]: baseUrl,
  });
  state.auto = auto;
  document.getElementById("settings-dialog").close();
}

/* ===== 初始化 ===== */
/** 背景壁纸:Bing 每日壁纸轮换 */
const SAVED_WP_KEY = "savedWallpaper"; // local: 保存的当前背景 URL
let wpList = [];

let wpUsed = new Set(); // 已使用过的壁纸索引(避免一轮内重复)

async function loadWallpapers() {
  // 清爽模式不请求壁纸接口(网格资源门控);切回网格模式由 onGridResume/__whenGrid 触发
  if (document.body.classList.contains("mode-clean")) return;
  try {
    const res = await chrome.runtime.sendMessage({ type: "getWallpapers" });
    if (res && Array.isArray(res.urls) && res.urls.length) {
      wpList = res.urls;
    }
  } catch {
    /* 忽略 */
  }
}

function applyWallpaper(url) {
  const bg = document.getElementById("bg");
  if (!bg || !url) return;
  bg.style.backgroundImage = "url('" + url + "')";
  bg.style.backgroundSize = "cover";
  bg.style.backgroundPosition = "center";
  bg.classList.add("has-image");
}

function nextWallpaper() {
  // 清除背景色设置(壁纸优先)
  const bgEl = document.getElementById("bg");
  if (bgEl) bgEl.style.background = "";
  try { chrome.storage.local.remove(BG_COLOR_KEY); } catch (e) { /* 忽略 */ }
  let url = null;
  if (wpList.length) {
    // 未用过的索引池
    const unused = [];
    for (let i = 0; i < wpList.length; i++) if (!wpUsed.has(i)) unused.push(i);
    if (!unused.length) {
      // 本轮已全部用过:重新拉取新池(新的 picsum 随机图)后从头开始
      // 清爽模式下 loadWallpapers 内部守卫不请求;切回网格后由 onGridResume 拉取
      wpUsed = new Set();
      loadWallpapers();
      for (let i = 0; i < wpList.length; i++) unused.push(i);
    }
    const idx = unused[Math.floor(Math.random() * unused.length)];
    wpUsed.add(idx);
    url = wpList[idx];
  } else {
    // 兜底:picsum 随机 seed 图(URL 稳定,可保存)
    url = "https://picsum.photos/seed/wp" + Math.random().toString(36).slice(2, 10) + "/1920/1080";
  }
  applyWallpaper(url);
  // 持久化保存当前背景,重新打开主页后恢复
  try {
    chrome.storage.local.set({ [SAVED_WP_KEY]: url });
  } catch (e) { /* 忽略 */ }
}

/** 打开主页时恢复上次保存的背景 */
async function restoreWallpaper() {
  try {
    const { [SAVED_WP_KEY]: url } = await chrome.storage.local.get(SAVED_WP_KEY);
    if (url) applyWallpaper(url);
  } catch (e) {
    /* 忽略 */
  }
}

/* ===== 天气效果(粒子特效,整合进天气卡片) ===== */
const WEATHER_EFFECT_KEY = "weatherEffectEnabled"; // local: 是否跟随天气显示效果
const effectState = { current: null, manual: null, enabled: true };
let weatherAutoType = null; // 当前真实天气对应的效果类型

/** WMO 天气代码 + 风速 → 5 种效果之一(sun/cloud/wind/rain/snow) */
function weatherEffectType(w) {
  if (!w) return null;
  const c = w.code;
  if (w.wind != null && w.wind >= 30) return "wind"; // 大风优先
  if (c === 0 || c === 1) return "sun";
  if (c === 2 || c === 3 || (c >= 45 && c <= 48)) return "cloud";
  if (c >= 51 && c <= 67) return "rain";
  if (c >= 71 && c <= 77) return "snow";
  if (c >= 80 && c <= 82) return "rain";
  if (c >= 85 && c <= 86) return "snow";
  if (c >= 95) return "rain";
  return null;
}

/** 应用当前效果:手动选择优先,否则按真实天气自动匹配 */
function applyWeatherEffect() {
  const type = effectState.manual || (effectState.enabled ? weatherAutoType : null);
  if (type) {
    spawnParticles(type);
    effectState.current = type;
  } else {
    clearWeatherEffect();
    effectState.current = null;
  }
  syncTestButtons();
}

/** 同步右下角测试按钮高亮(显示当前生效的效果) */
function syncTestButtons() {
  const bar = document.getElementById("weather-test-bar");
  if (!bar) return;
  bar.querySelectorAll(".weather-test-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.type === effectState.current);
  });
}

function clearWeatherEffect() {
  const c = document.getElementById("weather-effect");
  if (!c) return;
  c.className = "weather-effect";
  c.innerHTML = "";
}

function spawnParticles(type) {
  const c = document.getElementById("weather-effect");
  if (!c) return;
  c.className = "weather-effect " + type + "-mode";
  const rnd = (a, b) => a + Math.random() * (b - a);

  if (type === "sun") {
    // 晴天:粒子化散射光线——每条射线由沿光线方向分布的微尘粒子组成
    const rayCount = 9;
    for (let i = 0; i < rayCount; i++) {
      const ray = document.createElement("div");
      ray.className = "sun-ray";
      const angle = rnd(12, 55); // 固定倾斜区间内的随机角度
      const len = rnd(40, 80);   // 光线长度(vw)
      ray.style.cssText =
        "left:0;top:0;width:" + len + "vw;height:1px;" +
        "transform:rotate(" + angle + "deg);transform-origin:left center;";
      // 该射线内的光尘粒子(数量随机)
      const count = 6 + Math.floor(Math.random() * 5);
      for (let j = 0; j < count; j++) {
        const pt = document.createElement("div");
        pt.className = "sun-particle";
        const x = rnd(2, 98);          // 沿光线百分比位置
        const y = rnd(-8, 8);          // 垂直方向微抖(px)
        const size = rnd(1.5, 3.5);    // 粒子大小(px)
        pt.style.cssText =
          "left:" + x + "%;top:" + y + "px;width:" + size + "px;height:" + size + "px;" +
          "animation-delay:" + rnd(0, 3) + "s;animation-duration:" + rnd(3, 7) + "s;";
        ray.appendChild(pt);
      }
      c.appendChild(ray);
    }
  } else if (type === "cloud") {
    // 多云:大云朵缓慢漂移
    for (let i = 0; i < 3; i++) {
      const p = document.createElement("div");
      p.className = "cloud-puff";
      const size = rnd(130, 230);
      p.style.cssText =
        "width:" + size + "px;height:" + size * 0.5 + "px;top:" + rnd(5, 45) + "vh;" +
        "animation-delay:" + rnd(0, 25) + "s;animation-duration:" + rnd(30, 50) + "s;";
      c.appendChild(p);
    }
  } else if (type === "wind") {
    // 刮风:落叶随风飘落(向右下飘 + 旋转 + S 形摆动)
    const leafColors = ["#e8c15a", "#e89a5a", "#d46a4a", "#9acd5a", "#c9a34a"];
    for (let i = 0; i < 18; i++) {
      const p = document.createElement("div");
      p.className = "leaf";
      const size = rnd(10, 18);
      p.style.cssText =
        "left:" + rnd(0, 95) + "vw;top:" + rnd(-15, 5) + "vh;" +
        "width:" + size + "px;height:" + size * 0.7 + "px;" +
        "background:" + leafColors[Math.floor(Math.random() * leafColors.length)] + ";" +
        "animation-delay:" + rnd(0, 6) + "s;animation-duration:" + rnd(7, 11) + "s;";
      c.appendChild(p);
    }
  } else if (type === "rain") {
    // 下雨:斜向雨滴
    for (let i = 0; i < 50; i++) {
      const p = document.createElement("div");
      p.className = "rain-drop";
      // top 统一在视口上方,确保雨滴始终从顶部进入,不在页面中间初始化
      p.style.cssText =
        "left:" + rnd(0, 100) + "vw;top:" + rnd(-10, 0) + "vh;" +
        "animation-delay:" + rnd(0, 1.5) + "s;animation-duration:" + rnd(0.5, 0.9) + "s;";
      c.appendChild(p);
    }
  } else if (type === "snow") {
    // 下雪:雪花缓缓飘落(旋转 + 左右摆动)
    for (let i = 0; i < 60; i++) {
      const p = document.createElement("div");
      p.className = "snowflake";
      const size = rnd(2, 6);
      p.style.cssText =
        "left:" + rnd(0, 100) + "vw;top:" + rnd(-10, 0) + "vh;" +
        "width:" + size + "px;height:" + size + "px;" +
        "animation-delay:" + rnd(0, 8) + "s;animation-duration:" + rnd(6, 12) + "s;";
      c.appendChild(p);
    }
  }
}

/** 天气卡片开关:是否跟随当前天气显示页面效果 */
function initWeatherToggle() {
  const tg = document.getElementById("weather-effect-toggle");
  if (!tg) return;
  try {
    chrome.storage.local.get(WEATHER_EFFECT_KEY).then(({ [WEATHER_EFFECT_KEY]: v }) => {
      effectState.enabled = v !== false; // 默认开启
      tg.classList.toggle("active", effectState.enabled);
    });
  } catch (e) { /* 忽略 */ }
  tg.addEventListener("click", () => {
    effectState.enabled = !effectState.enabled;
    if (!effectState.enabled) effectState.manual = null;
    tg.classList.toggle("active", effectState.enabled);
    applyWeatherEffect();
    try {
      chrome.storage.local.set({ [WEATHER_EFFECT_KEY]: effectState.enabled });
    } catch (e) { /* 忽略 */ }
  });
}

function initWindmill() {
  const wm = document.getElementById("windmill-btn");
  if (!wm) return;
  // 风车叶片图运行时创建(不写死在 index.html:清爽模式不静态引用媒体文件,见 AGENTS.md 规范)
  let blade = wm.querySelector(".windmill-blade");
  if (!blade) {
    blade = document.createElement("img");
    blade.className = "windmill-blade";
    blade.src = "img/windmill.svg";
    blade.alt = "风车";
    blade.draggable = false;
    const wrap = wm.querySelector(".windmill-wrap");
    if (wrap) wrap.appendChild(blade);
  }
  // 恢复上次保存的背景
  restoreWallpaper();

  // 风车旋转:JS 驱动,速度经指数平滑过渡,加速/减速流畅无跳变
  // 默认 30 deg/s(12s/圈)缓转;点击目标速度 720 deg/s(0.5s/圈),1.6s 后恢复
  let angle = 0;
  let speed = 30;
  let targetSpeed = 30;
  let last = performance.now();
  let raf = null;

  let lastFrame = 0;
  function tick(now) {
    raf = requestAnimationFrame(tick);
    // 约 30fps 更新:视觉仍流畅,大幅降低主线程占用(消除卡顿)
    if (now - lastFrame < 33) return;
    lastFrame = now;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // 指数平滑:速度平滑趋向目标,加速/减速过渡自然
    speed += (targetSpeed - speed) * Math.min(1, dt * 5);
    angle = (angle + speed * dt) % 360;
    blade.style.transform = "rotate(" + angle.toFixed(1) + "deg)";
  }
  raf = requestAnimationFrame(tick);

  wm.addEventListener("click", () => {
    targetSpeed = 720; // 点击加速
    clearTimeout(wm._spinTimer);
    wm._spinTimer = setTimeout(() => {
      targetSpeed = 30; // 恢复缓转
    }, 1600);
    // 更换背景
    nextWallpaper();
  });
  // 壁纸列表:清爽模式刷新时不请求,网格模式加载;切回网格时立即拉取
  if (window.__whenGrid) window.__whenGrid(loadWallpapers);
  else loadWallpapers();
  if (window.onGridResume) window.onGridResume(loadWallpapers);
}

/** 设置按钮与搜索输入框纵向居中对齐(清爽模式下按钮固定右上角,不跟随搜索栏移动) */
function alignSettingsFab() {
  if (document.body.classList.contains("mode-clean")) return; // 清爽模式:保持按钮当前位置
  const bar = document.querySelector(".search-box .search-bar");
  const trb = document.querySelector(".top-right-bar");
  if (!bar || !trb) return;
  const r = bar.getBoundingClientRect();
  const center = r.top + r.height / 2;
  trb.style.top = Math.max(4, Math.round(center - trb.offsetHeight / 2)) + "px";
}

/** 计算清爽模式搜索栏居中位移(CSS 变量 --clean-search-shift,px;20 = 容器顶部 padding) */
function updateCleanShift() {
  const container = document.querySelector(".container");
  const box = document.querySelector(".search-box");
  if (!container || !box) return;
  const shift = Math.max(0, (container.clientHeight - box.offsetHeight) / 2 - 20);
  document.documentElement.style.setProperty("--clean-search-shift", shift + "px");
}

/** 应用页面模式:grid 网格(默认三栏) / clean 清爽(只留搜索栏,带切换动画) */
function applyHomeMode(mode) {
  const clean = mode === "clean";
  document.body.classList.toggle("mode-clean", clean);
  // 白噪音:切换到清爽模式时暂停播放(轻量模式),切回网格时恢复
  if (clean) { if (window.__noiseSuspend) window.__noiseSuspend(); }
  else { if (window.__noiseResume) window.__noiseResume(); }
  const gridIcon = document.getElementById("mode-icon-grid");
  const leafIcon = document.getElementById("mode-icon-clean");
  const btn = document.getElementById("btn-mode");
  // 注意:SVG 元素上 hidden 的 property/attribute 不反射,
  // 必须直接操作 attribute,CSS 的 [hidden] 选择器才会响应
  if (gridIcon) gridIcon.toggleAttribute("hidden", clean);
  if (leafIcon) leafIcon.toggleAttribute("hidden", !clean);
  if (btn) btn.title = clean ? "切换为网格模式" : "切换为清爽模式";
  updateCleanShift(); // 计算搜索栏居中位移(触发 margin-top 过渡动画)
  // 注:按钮位置不随搜索栏移动(清爽模式下固定右上角)
  // 切回网格模式:搜索栏回顶后 main-row 恢复全高,快捷方式每页数量需按最终高度重算。
  // 用"当前高度 + 搜索栏 margin-top 位移"推算过渡结束后的高度,切换瞬间同步重算,
  // 避免 main-row 淡入期间先显示旧分页、再跳变。
  if (!clean) {
    // 执行清爽模式期间排队的网格资源加载(热榜/股票/天气/名言等)。
    // 注:gridgate 的 applyMode 也 flush 一次,但那时(页面加载早期)队列必为空,
    // 任务在此处统一执行——双 flush 不重复(见 js/gridgate.js 注释)。
    const tasks = window.__gridTasks || [];
    window.__gridTasks = [];
    tasks.forEach((t) => { try { t(); } catch (e) { /* 忽略 */ } });
    // 组件恢复回调:切回网格立即刷新一次(热榜/股票/监控/宠物/壁纸等)
    (window.__gridResumeCbs || []).forEach((fn) => { try { fn(); } catch (e) { /* 忽略 */ } });
    // 切回网格模式:搜索栏回顶后 main-row 恢复全高,快捷方式每页数量需按最终高度重算。
    // 用"当前高度 + 搜索栏 margin-top 位移"推算过渡结束后的高度,切换瞬间同步重算,
    // 避免 main-row 淡入期间先显示旧分页、再跳变。
    const ql = document.querySelector(".quick-links");
    const sb = document.querySelector(".search-box");
    if (ql && sb) {
      const shift = parseFloat(window.getComputedStyle(sb).marginTop) || 0;
      recalcQlPageSize(ql.clientHeight + shift);
    }
  }
  // 模式已确定(首次恢复完成):解锁门控,后续任务按当前模式即时执行
  window.__gridLocked = false;
}

/** 模式切换按钮:点击在清爽/网格之间切换,并持久化 */
function initModeSwitch() {
  const btn = document.getElementById("btn-mode");
  if (!btn) {
    document.body.classList.remove("no-anim"); // 无切换按钮时也要恢复过渡
    return;
  }
  // 恢复上次的模式(默认网格);恢复完成后移除禁用动画类(首次加载不播放切换动画)
  const restore = (mode) => {
    applyHomeMode(mode === "clean" ? "clean" : "grid");
    document.body.classList.remove("no-anim");
  };
  try {
    chrome.storage.local
      .get(HOME_MODE_KEY)
      .then(({ [HOME_MODE_KEY]: m }) => restore(m))
      .catch(() => document.body.classList.remove("no-anim"));
  } catch (e) {
    restore(null);
  }
  btn.addEventListener("click", () => {
    const next = document.body.classList.contains("mode-clean") ? "grid" : "clean";
    applyHomeMode(next);
    try {
      chrome.storage.local.set({ [HOME_MODE_KEY]: next });
    } catch (e) { /* 忽略 */ }
  });
}

/** 鸣谢页付款码:点击放大预览(lightbox,dialog top layer 最上层),点击遮罩/按 Esc 关闭 */
function initDonateZoom() {
  const zoom = document.getElementById("donate-zoom");
  const zoomImg = document.getElementById("donate-zoom-img");
  if (!zoom) return;
  const openZoom = () => { if (typeof zoom.showModal === "function") zoom.showModal(); else zoom.setAttribute("open", ""); };
  const closeZoom = () => { if (typeof zoom.close === "function") zoom.close(); else zoom.removeAttribute("open"); };
  document.querySelectorAll(".donate-item img").forEach((img) => {
    img.addEventListener("click", () => {
      if (zoomImg) zoomImg.src = img.src;
      openZoom();
    });
  });
  zoom.addEventListener("click", closeZoom);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && zoom.open) closeZoom();
  });
}

async function init() {
  document.body.classList.add("no-anim"); // 初始化期间禁用模式切换过渡(刷新不播放动画)
  alignSettingsFab();
  window.addEventListener("resize", () => {
    alignSettingsFab();
    updateCleanShift(); // 窗口尺寸变化时重算搜索栏居中位移
  });
  initModeSwitch(); // 清爽 / 网格模式切换(完成后移除 no-anim)
  updateCleanShift(); // 计算初始搜索栏居中位移
  createNavTooltip(); // 导航路径提示
  createThumbPopup();
  initWeatherToggle(); // 天气卡片效果开关
  initDonateZoom(); // 鸣谢页付款码点击放大

  // 快捷方式:添加/编辑弹窗绑定
  document.getElementById("quick-dialog").addEventListener("submit", (e) => {
    e.preventDefault();
    saveQuick();
  });
  document.getElementById("quick-cancel").addEventListener("click", () => {
    document.getElementById("quick-dialog").close();
  });

  // 点击其他区域时隐藏快捷方式删除按钮
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".ql-remove") && !e.target.closest(".ql-edit")) {
      document.querySelectorAll(".ql-remove.visible, .ql-edit.visible").forEach((r) => r.classList.remove("visible"));
    }
  });
  initBgColor();    // 恢复保存的背景颜色
  initCardAlpha(); // 恢复保存的卡片透明度
  initCardBlur();  // 恢复保存的卡片磨砂度
  initCleanBg();   // 恢复保存的清爽模式背景样式
  initWindmill();
  updateClock();
  initQlResponsive(); // 快捷方式分页自适应窗口高度

  setInterval(updateClock, 1000);
  if (window.__whenGrid) window.__whenGrid(fetchQuote); // 名言(网络 API):清爽模式刷新时不请求,切回网格再加载
  else fetchQuote();
  const quoteCard = document.getElementById("quote-card");
  if (quoteCard) {
    quoteCard.addEventListener("click", nextQuote);
  }

  document.getElementById("search-btn").addEventListener("click", doSearch);
  document.getElementById("search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch();
  });
  // 搜索引擎:图标按钮切换 + 选择浮层(参照 LimeStart)
  document.getElementById("engine-switch").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleEnginePicker();
  });
  document.addEventListener("click", () => {
    document.getElementById("engine-picker").hidden = true;
  });
  // 引擎管理弹窗
  document.getElementById("engine-manage-close").addEventListener("click", () => {
    document.getElementById("engine-manage-dialog").close();
  });
  document.getElementById("btn-add-engine").addEventListener("click", () => openEngineDialog(null));
  document.getElementById("engine-dialog").addEventListener("submit", (e2) => {
    e2.preventDefault();
    saveEngine();
  });
  document.getElementById("engine-dialog-cancel").addEventListener("click", () => {
    document.getElementById("engine-dialog").close();
  });
  // 引擎图标/渐变不再在此首次渲染(数据未加载时会显示错误引擎),
  // 统一在 loadInitialData 完成后渲染一次,避免"先显示第一个引擎再刷新"的闪烁

  if (!isExtensionEnv()) {
    document.getElementById("bm-empty").hidden = false;
    document.getElementById("bm-empty").textContent =
      "当前不是 Chrome 扩展环境。请在 chrome://extensions 中加载本项目文件夹后,通过新标签页打开。";
    return;
  }

  // 设置面板
  document.getElementById("btn-settings").addEventListener("click", openSettings);
  document.getElementById("settings-dialog").addEventListener("submit", (e) => {
    e.preventDefault();
    saveSettings();
  });
  // 快捷方式名称开关
  const quickNameToggle = document.getElementById("set-quick-name");
  if (quickNameToggle) {
    try {
      chrome.storage.local.get(QL_NAME_KEY).then(({ [QL_NAME_KEY]: v }) => {
        state.showQuickNames = v !== false; // 默认显示
        quickNameToggle.checked = state.showQuickNames;
      });
    } catch (e) { /* 忽略 */ }
    quickNameToggle.addEventListener("change", () => {
      state.showQuickNames = quickNameToggle.checked;
      renderQuickLinks(); // 立即刷新快捷方式显示
      try {
        chrome.storage.local.set({ [QL_NAME_KEY]: state.showQuickNames });
      } catch (e) { /* 忽略 */ }
    });
  }

  // 模型列表刷新按钮
  const refreshModels = document.getElementById("btn-refresh-models");
  if (refreshModels) refreshModels.addEventListener("click", () => loadModelList(false));

  // 设置弹窗标签页切换(常规/外观/AI/组件/数据/鸣谢)
  const settingsTabs = document.querySelectorAll(".settings-tab");
  settingsTabs.forEach((tb) => {
    tb.addEventListener("click", () => {
      settingsTabs.forEach((t) => t.classList.remove("active"));
      tb.classList.add("active");
      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.hidden = panel.dataset.panel !== tb.dataset.tab;
      });
      // 鸣谢页签:接口列表渲染在页签内,首次切入时构建(含后台注册表异步补全)
      if (tb.dataset.tab === "credits") renderApiList();
    });
  });

  // 配置导出/导入
  const btnExport = document.getElementById("btn-export-config");
  if (btnExport) btnExport.addEventListener("click", exportConfig);
  const btnImport = document.getElementById("btn-import-config");
  if (btnImport) btnImport.addEventListener("click", importConfig);

  // 接口列表(位于鸣谢页签内)
  const apiRecheck = document.getElementById("btn-api-recheck");
  if (apiRecheck) apiRecheck.addEventListener("click", renderApiList);

  // 加载已保存的模型与 Base URL
  try {
    chrome.storage.local.get([MODEL_KEY, BASE_URL_KEY]).then((r) => {
      if (r[MODEL_KEY]) state.model = r[MODEL_KEY];
      if (r[BASE_URL_KEY]) state.baseUrl = r[BASE_URL_KEY];
    });
  } catch (e) { /* 忽略 */ }

  // 网页预览弹窗开关(书签 / 快捷方式分开)
  const setupThumbToggle = (id, stateKey, storageKey) => {
    const toggle = document.getElementById(id);
    if (!toggle) return;
    try {
      chrome.storage.local.get(storageKey).then(({ [storageKey]: v }) => {
        state[stateKey] = v !== false; // 默认显示
        toggle.checked = state[stateKey];
      });
    } catch (e) { /* 忽略 */ }
    toggle.addEventListener("change", () => {
      state[stateKey] = toggle.checked;
      if (!state.showThumbPreviewBM && !state.showThumbPreviewQL) hideThumb();
      try {
        chrome.storage.local.set({ [storageKey]: state[stateKey] });
      } catch (e) { /* 忽略 */ }
    });
  };
  setupThumbToggle("set-thumb-preview-bm", "showThumbPreviewBM", THUMB_BM_KEY);
  setupThumbToggle("set-thumb-preview-ql", "showThumbPreviewQL", THUMB_QL_KEY);

  // 右上角控制按钮自动隐藏(复刻 WeTab:平时透明,鼠标移到右上角显示)
  const fabAutoToggle = document.getElementById("set-fab-auto");
  if (fabAutoToggle) {
    const applyFabAuto = (flag) => {
      document.body.classList.toggle("fab-auto", flag);
    };
    try {
      chrome.storage.local.get(FAB_AUTO_KEY).then(({ [FAB_AUTO_KEY]: v }) => {
        fabAutoToggle.checked = v === true;
        applyFabAuto(v === true);
      });
    } catch (e) { /* 忽略 */ }
    fabAutoToggle.addEventListener("change", () => {
      applyFabAuto(fabAutoToggle.checked);
      try { chrome.storage.local.set({ [FAB_AUTO_KEY]: fabAutoToggle.checked }); } catch (e) { /* 忽略 */ }
    });
  }

  // 卡片高度档位(设置窗口组件栏):读存档标 active(未设置用默认档位),点击保存并重算
  const cardHeightOpts = document.querySelectorAll(".card-height-opts");
  if (cardHeightOpts.length) {
    const defOf = (key) => {
      const d = parseInt((window.DEFAULT_CARD_HEIGHTS || {})[key], 10);
      return d >= 1 && d <= 4 ? d : 1;
    };
    // 档位按钮:置灰不支持项(不支持的档位禁用+title 提示)
    cardHeightOpts.forEach((o) => {
      const key = o.dataset.card;
      const supported = (window.SUPPORTED_CARD_HEIGHTS || {})[key] || [1, 2, 3, 4];
      o.querySelectorAll("button").forEach((b) => {
        const v = parseInt(b.dataset.v, 10);
        if (supported.indexOf(v) < 0) {
          b.disabled = true;
          b.title = "该卡片不支持 " + v + "/4 高度";
        } else {
          b.title = "设为 " + v + "/4 高度";
        }
      });
    });
    try {
      chrome.storage.local.get(["cardHeights", "cardHidden"]).then((r) => {
        const saved = r.cardHeights || {};
        cardHeightOpts.forEach((o) => {
          const v = parseInt(saved[o.dataset.card], 10);
          const val = v >= 1 && v <= 4 ? v : defOf(o.dataset.card);
          o.querySelectorAll("button").forEach((b) =>
            b.classList.toggle("active", parseInt(b.dataset.v, 10) === val));
        });
        // 眼睛按钮状态与隐藏卡同步
        const hidden = r.cardHidden || {};
        document.querySelectorAll(".card-eye").forEach((b) => {
          applyEyeState(b, !!hidden[b.dataset.card]);
        });
      }).catch(() => { /* 忽略 */ });
    } catch (e) { /* 忽略 */ }
    cardHeightOpts.forEach((o) => {
      o.querySelectorAll("button").forEach((b) => {
        b.addEventListener("click", () => {
          o.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
          const key = o.dataset.card;
          const v = parseInt(b.dataset.v, 10);
          // 更新内存缓存 + storage + 立即重算卡片栏高度(档位影响分页,需重排)
          if (window.cardHeights) window.cardHeights[key] = v;
          try {
            chrome.storage.local.get("cardHeights").then((r) => {
              const next = Object.assign({}, r.cardHeights || {}, { [key]: v });
              chrome.storage.local.set({ cardHeights: next });
            });
          } catch (e) { /* 忽略 */ }
          if (window.rebuildPages) window.rebuildPages();
          else if (window.fillPage) window.fillPage();
        });
      });
    });
    // 「默认」按钮:恢复该卡片的默认档位
    document.querySelectorAll(".card-height-reset").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.card;
        const def = defOf(key);
        const opts = document.querySelector('.card-height-opts[data-card="' + key + '"]');
        if (opts) {
          opts.querySelectorAll("button").forEach((x) =>
            x.classList.toggle("active", parseInt(x.dataset.v, 10) === def));
        }
        if (window.cardHeights) window.cardHeights[key] = def;
        try {
          chrome.storage.local.get("cardHeights").then((r) => {
            const next = Object.assign({}, r.cardHeights || {});
            delete next[key];
            chrome.storage.local.set({ cardHeights: next });
          });
        } catch (e) { /* 忽略 */ }
        if (window.rebuildPages) window.rebuildPages();
        else if (window.fillPage) window.fillPage();
      });
    });
    // 眼睛按钮:显示 / 隐藏组件(隐藏卡不参与布局与高度分配)
    // 图标:可见 = 眼睛,已隐藏 = 眼睛+斜杠(标准 eye-off,替代原来的 🙈/👁 emoji)
    const EYE_SVG =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    const EYE_SLASH_SVG =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><path d="M1 1l22 22"/></svg>';
    const cardElOf = (key) => document.getElementById(key) || document.querySelector("." + key);
    const applyEyeState = (btn, hidden) => {
      btn.innerHTML = hidden ? EYE_SLASH_SVG : EYE_SVG;
      btn.classList.toggle("off", !!hidden);
      btn.title = hidden ? "显示组件" : "隐藏组件";
    };
    document.querySelectorAll(".card-eye").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.card;
        const el = cardElOf(key);
        if (!el) return;
        const willHide = el.style.display !== "none";
        el.style.display = willHide ? "none" : "";
        applyEyeState(btn, willHide);
        // 白噪音卡片:隐藏时暂停播放,显示时恢复(保持播放状态体验)
        if (key === "music-card") {
          if (willHide) { if (window.__noiseSuspend) window.__noiseSuspend(); }
          else { if (window.__noiseResume) window.__noiseResume(); }
        }
        try {
          chrome.storage.local.get("cardHidden").then((r) => {
            const next = Object.assign({}, r.cardHidden || {});
            if (willHide) next[key] = true;
            else delete next[key];
            chrome.storage.local.set({ cardHidden: next });
          });
        } catch (e) { /* 忽略 */ }
        // 隐藏/显示都重新分页:隐藏后该页若变空,空页与多余圆点立即消失,
        // 隐藏卡由 rebuildPages 保留在末页 DOM(display:none)供「显示」找回;
        // 旧逻辑隐藏时不重建,空页需刷新页面才消失
        if (window.rebuildPages) window.rebuildPages();
        else if (window.fillPage) window.fillPage();
      });
    });
    // 「全部默认」按钮:恢复所有卡片默认档位(清空 cardHeights)
    const resetAll = document.getElementById("btn-card-heights-reset-all");
    if (resetAll) {
      resetAll.addEventListener("click", () => {
        cardHeightOpts.forEach((o) => {
          const def = defOf(o.dataset.card);
          o.querySelectorAll("button").forEach((x) =>
            x.classList.toggle("active", parseInt(x.dataset.v, 10) === def));
        });
        if (window.cardHeights) Object.keys(window.cardHeights).forEach((k) => delete window.cardHeights[k]);
        try {
          chrome.storage.local.remove("cardHeights");
        } catch (e) { /* 忽略 */ }
        if (window.rebuildPages) window.rebuildPages();
        else if (window.fillPage) window.fillPage();
      });
    }
    // 组件排序:拖拽行(HTML5 drag & drop)调整全局卡片顺序
    const cardRows = Array.from(document.querySelectorAll(".card-height-row"));
    const rowKeyOf = (row) => {
      const o = row.querySelector(".card-height-opts");
      return o ? o.dataset.card : "";
    };
    // 同步全局顺序与设置窗口行 DOM 顺序(顺序变化后重排行 + 主页分页)
    const applyOrder = (keys) => {
      window.__cardOrder = keys;
      const rows = Array.from(document.querySelectorAll(".card-height-row"));
      const list = rows[0] ? rows[0].parentNode : null;
      if (list) keys.forEach((k) => {
        const r = rows.find((x) => rowKeyOf(x) === k);
        if (r) list.appendChild(r); // 按新顺序重排行
      });
      if (window.saveCardOrder) window.saveCardOrder();
      if (window.rebuildPages) window.rebuildPages();
      else if (window.fillPage) window.fillPage();
    };
    cardRows.forEach((row) => {
      row.setAttribute("draggable", "true");
      row.addEventListener("dragstart", (e) => {
        const key = rowKeyOf(row);
        if (!key) { e.preventDefault(); return; }
        e.dataTransfer.setData("text/plain", key);
        e.dataTransfer.effectAllowed = "move";
        row.classList.add("dragging");
      });
      row.addEventListener("dragend", () => row.classList.remove("dragging"));
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        row.classList.add("drag-over");
      });
      row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.classList.remove("drag-over");
        const fromKey = e.dataTransfer.getData("text/plain");
        const toKey = rowKeyOf(row);
        if (!fromKey || !toKey || fromKey === toKey) return;
        // 基于当前行顺序(含所有卡片)重排
        const rowsAll = Array.from(document.querySelectorAll(".card-height-row"));
        const keys = rowsAll.map(rowKeyOf).filter(Boolean);
        const fi = keys.indexOf(fromKey);
        const ti = keys.indexOf(toKey);
        if (fi < 0 || ti < 0) return;
        keys.splice(fi, 1);
        keys.splice(ti, 0, fromKey);
        applyOrder(keys);
      });
    });
  }

  // 背景颜色:原生 input type=color(点击直接弹出系统调色盘,点击外部自动关闭)
  const bgPicker = document.getElementById("set-bgcolor");
  if (bgPicker) {
    bgPicker.addEventListener("input", () => {
      applyBgColor(bgPicker.value);
      try { chrome.storage.local.set({ [BG_COLOR_KEY]: bgPicker.value }); } catch (e) { /* 忽略 */ }
    });
  }
  const bgReset = document.getElementById("bgcolor-reset");
  if (bgReset) {
    bgReset.addEventListener("click", () => {
      resetBgColor();
      const bp = document.getElementById("set-bgcolor");
      if (bp) bp.value = "#1e3c72";
    });
  }
  // 为滑块追加"默认"按钮(恢复该区域默认值)
  function addDefaultBtn(slider, defs, labelSel) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "alpha-default";
    btn.textContent = "默认";
    btn.title = "恢复默认值";
    btn.addEventListener("click", () => {
      const v = defs[slider.dataset.key];
      slider.value = String(v);
      const label = document.querySelector(labelSel + slider.dataset.key + '"]');
      const isBlur = slider.classList.contains("blur-slider");
      if (label) label.textContent = v + (isBlur ? "px" : "%");
      if (isBlur) applyBlurs(readBlurSliders());
      else applyAlphas(readAlphaSliders());
    });
    const item = slider.closest(".alpha-item");
    if (item) item.appendChild(btn);
  }
  // 清爽模式背景滑块专用"默认"按钮(key: "blur" | "alpha")
  function addCleanDefaultBtn(slider, key, labelId) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "alpha-default";
    btn.textContent = "默认";
    btn.title = "恢复默认值";
    btn.addEventListener("click", () => {
      const v = DEFAULT_CLEAN_BG[key];
      slider.value = String(v);
      const label = document.getElementById(labelId);
      if (label) label.textContent = v + (key === "blur" ? "px" : "%");
      applyCleanBg({ blur: readCleanBlur(), alpha: readCleanAlpha() });
    });
    const item = slider.closest(".alpha-item");
    if (item) item.appendChild(btn);
  }

  // 五个透明度滑块:拖动实时预览对应区域
  document.querySelectorAll(".alpha-slider").forEach((slider) => {
    slider.addEventListener("input", () => {
      const v = parseInt(slider.value, 10);
      const label = document.querySelector('[data-label="' + slider.dataset.key + '"]');
      if (label) label.textContent = v + "%";
      applyAlphas(readAlphaSliders());
    });
    addDefaultBtn(slider, DEFAULT_ALPHAS, '[data-label="');
  });
  // 五个磨砂度滑块:拖动实时预览对应区域
  document.querySelectorAll(".blur-slider").forEach((slider) => {
    slider.addEventListener("input", () => {
      const v = parseInt(slider.value, 10);
      const label = document.querySelector('[data-blur-label="' + slider.dataset.key + '"]');
      if (label) label.textContent = v + "px";
      applyBlurs(readBlurSliders());
    });
    addDefaultBtn(slider, DEFAULT_BLURS, '[data-blur-label="');
  });
  // 清爽模式背景:磨砂度滑块实时预览(叠加透明度当前值)
  const cleanBlurSlider = document.querySelector(".clean-blur-slider");
  if (cleanBlurSlider) {
    cleanBlurSlider.addEventListener("input", () => {
      const v = parseInt(cleanBlurSlider.value, 10);
      const lb = document.getElementById("clean-blur-value");
      if (lb) lb.textContent = v + "px";
      applyCleanBg({ blur: v, alpha: readCleanAlpha() });
    });
    addCleanDefaultBtn(cleanBlurSlider, "blur", "clean-blur-value");
  }
  // 清爽模式背景:透明度滑块实时预览(叠加磨砂度当前值)
  const cleanAlphaSlider = document.querySelector(".clean-alpha-slider");
  if (cleanAlphaSlider) {
    cleanAlphaSlider.addEventListener("input", () => {
      const v = parseInt(cleanAlphaSlider.value, 10);
      const la = document.getElementById("clean-alpha-value");
      if (la) la.textContent = v + "%";
      applyCleanBg({ blur: readCleanBlur(), alpha: v });
    });
    addCleanDefaultBtn(cleanAlphaSlider, "alpha", "clean-alpha-value");
  }
  document.getElementById("dialog-cancel").addEventListener("click", () => {
    // 取消:回滚透明度预览到打开时的值
    if (window._alphaPrev) {
      applyAlphas(window._alphaPrev);
    }
    if (window._blurPrev) {
      applyBlurs(window._blurPrev);
    }
    if (window._cleanBgPrev) {
      applyCleanBg(window._cleanBgPrev);
    }
    document.getElementById("settings-dialog").close();
  });

  // 维护弹窗
  document.getElementById("maintain-dialog").addEventListener("submit", (e) => {
    e.preventDefault();
    saveMaintain();
  });
  document.getElementById("maint-cancel").addEventListener("click", () => {
    document.getElementById("maintain-dialog").close();
  });
  document.getElementById("maint-regenerate").addEventListener("click", () => {
    regenerateMaintain();
  });
  document.getElementById("maint-delete").addEventListener("click", () => {
    askDeleteBookmark();
  });
  document.getElementById("confirm-ok").addEventListener("click", () => {
    confirmDelete();
  });
  document.getElementById("confirm-cancel").addEventListener("click", () => {
    pendingDeleteUrl = null;
    document.getElementById("confirm-dialog").close();
  });

  // 位置:点击地图卡片 → 用户手势触发浏览器精确定位(权限弹窗更友好);
  // 定位被拒绝/不可用时自动回退到 IP 定位刷新
  const mapCard = document.getElementById("geo-map-card");
  if (mapCard) {
    mapCard.addEventListener("click", async () => {
      // 先检查定位权限状态,给出明确反馈
      let permState = "unknown";
      try {
        if (navigator.permissions && navigator.permissions.query) {
          permState = (await navigator.permissions.query({ name: "geolocation" })).state;
        }
      } catch (e) { /* 忽略 */ }
      if (permState === "denied") {
        showMapTip("⚠️ 定位权限已被屏蔽:请点击浏览器地址栏左侧图标 → 将“位置信息”改为“允许”,然后重新点击地图", true);
        return;
      }
      if (permState === "prompt") {
        showMapTip("请在弹出窗口中允许定位授权", true);
      }
      useBrowserLocation();
    });
  }

  // 一键 AI 生成(设置在弹窗内):点击后关闭弹窗,进度显示在主页右上角
  document.getElementById("btn-gen-all").addEventListener("click", async () => {
    if (state.generating) return;
    const { [API_KEY_STORAGE]: key } = await chrome.storage.local.get(API_KEY_STORAGE);
    if (!key || !key.trim()) return; // 未配置 Key,留在弹窗内填写
    runDescribeQueue();
    document.getElementById("settings-dialog").close(); // 关闭弹窗,生成继续
  });

  // 清空搜索历史确认弹窗
  const hcCancel = document.getElementById("history-clear-cancel");
  if (hcCancel) hcCancel.addEventListener("click", () => {
    const d = document.getElementById("history-clear-confirm");
    if (d) d.close();
  });
  const hcOk = document.getElementById("history-clear-ok");
  if (hcOk) hcOk.addEventListener("click", () => {
    try {
      chrome.storage.local.set({ [SEARCH_HISTORY_KEY]: [] }, () => {
        const d = document.getElementById("history-clear-confirm");
        if (d) d.close();
        const dd = document.getElementById("search-dropdown");
        if (dd) dd.hidden = true;
      });
    } catch (e) { /* 忽略 */ }
  });

  // 搜索历史与关联建议下拉
  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("focus", showSearchDropdown);
    searchInput.addEventListener("input", showSearchDropdown);
    searchInput.addEventListener("blur", () => setTimeout(hideSearchDropdown, 180));
  }

  // 首次数据
  await initNavState(); // 恢复折叠状态与上次滚动位置
  const { hasKey } = await loadInitialData(); // 引擎等搜索栏必需数据(立即加载)
  // 引擎图标按已加载的 currentEngineId 重新渲染(修复首屏显示第一个引擎的问题)
  renderEngineSwitch();
  applyEngineGradient();

  // 网格内容(书签/快捷方式):清爽模式刷新时不加载,切回网格再加载渲染(网格资源门控)
  // 组件脚本(日历/宠物/音乐/热榜/股票/梦想之车等)也在此动态注入,清爽模式不下载
  const GRID_SCRIPTS = ["calendar", "colpager", "pet", "music", "monitor", "hot", "stock", "dreamcar", "poker", "bagua", "compass"];
  const loadGridScripts = () => {
    for (const name of GRID_SCRIPTS) {
      try {
        const s = document.createElement("script");
        s.src = "js/" + name + ".js";
        document.head.appendChild(s);
      } catch (e) { /* 忽略 */ }
    }
  };
  const loadGridContent = async () => {
    loadGridScripts(); // 注入组件脚本(异步加载,加载后自初始化;清爽模式不触发)
    await loadGridBookmarks();
    renderBookmarks();
    renderQuickLinks();
    bindNavScroll(); // 滚动高亮/滚动位置保存
    initNavCollapse(); // 书签栏收起/展开
    // 自动 AI 描述生成(默认开启,且已配置 key 时):依赖书签数据,随网格内容一起触发
    if (state.auto && hasKey) runDescribeQueue();
    // 恢复上次收藏夹滚动位置
    if (window._bmScrollRestore) {
      const g = document.getElementById("bm-groups");
      if (g) g.scrollTop = window._bmScrollRestore;
      window._bmScrollRestore = null;
    }
    // 返回顶部按钮:滚动超过 300px 显示,点击平滑回顶
    const topBtn = document.getElementById("bm-top-btn");
    const groupsEl2 = document.getElementById("bm-groups");
    if (topBtn && groupsEl2) {
      topBtn.addEventListener("click", () => {
        groupsEl2.scrollTo({ top: 0, behavior: "smooth" });
      });
      let scrollSaveTimer = null;
      groupsEl2.addEventListener(
        "scroll",
        () => {
          topBtn.classList.toggle("show", groupsEl2.scrollTop > 300);
          clearTimeout(scrollSaveTimer);
          scrollSaveTimer = setTimeout(() => {
            try {
              chrome.storage.local.set({ [BM_SCROLL_KEY]: groupsEl2.scrollTop });
            } catch (e) { /* 忽略 */ }
          }, 300);
        },
        { passive: true }
      );
    }
  };
  if (window.__whenGrid) window.__whenGrid(loadGridContent);
  else loadGridContent();

  // 首次获取 IP / 位置 / 天气(5s 超时兜底,防止后台异常时卡死初始化)
  // 清爽模式刷新时不请求(网格资源门控),切回网格模式时再加载
  const loadGeo = async () => {
    try {
      const req = chrome.runtime.sendMessage({ type: "getGeoInfo" });
      const t = new Promise((resolve) => setTimeout(() => resolve(null), 5000));
      const geo = await Promise.race([req, t]);
      renderGeoInfo(geo);
      // 定位未提供坐标(IP 定位可能只有 ip/城市名,无经纬度)→ 默认地图兜底,避免 iframe 空白
      const mapFrame = document.getElementById("geo-map-frame");
      if (mapFrame && !mapFrame.getAttribute("src")) setDefaultMap();
    } catch {
      renderGeoInfo(null);
      setDefaultMap();
    }
  };
  if (window.__whenGrid) window.__whenGrid(loadGeo);
  else loadGeo();

  // 浏览器精确定位不再自动调用(避免权限弹窗被 Chrome 屏蔽);
  // 改为用户点击地图卡片时触发(见 geo-map-card 点击绑定)

  // 快捷方式:翻页由底部圆点控制(renderPager 内绑定);添加入口为最后一页末尾方形框

  // 快捷方式区域:空白处按住左键水平拖动,当前页跟随鼠标、下一页从右侧露出;
  // 松手时超过阈值平滑换页,否则回弹原位
  const qlViewport = document.getElementById("ql-viewport");
  if (qlViewport) {
    // 鼠标滚轮切换快捷方式页(向上=上一页,向下=下一页;500ms 节流)
    let qlWheelLock = 0;
    qlViewport.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const now = Date.now();
        if (now - qlWheelLock < 500) return;
        qlWheelLock = now;
        const total = getQlTotalPages();
        const go = (np) => {
          if (qlDrag) {
            // 按住拖拽中:立即切换(无动画),记录目标页,避免动画排队导致无法翻页
            if (np !== quickPage) { quickPage = np; renderQuickLinks(); }
            qlDrag.page = quickPage;
            qlDrag.flipped = true;
          } else {
            turnPageTo(np);
          }
        };
        if (e.deltaY > 0) go(Math.min(total - 1, quickPage + 1));
        else go(Math.max(0, quickPage - 1));
      },
      { passive: false }
    );
    let swipe = null;
    const SWIPE_THRESHOLD = 60; // px
    qlViewport.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest(".ql-item") || e.target.closest(".ql-add")) return;
      const g = document.getElementById("ql-grid");
      const ng = document.getElementById("ql-grid-next");
      const pg = document.getElementById("ql-grid-prev");
      swipe = { startX: e.clientX, dx: 0, pageBefore: quickPage, grid: g, next: ng, prev: pg };
      qlViewport.style.cursor = "grabbing";
      // prev/next 由 CSS left 定位(±100%),transform 0 即紧贴左右边缘
      if (g) { g.style.transition = "none"; g.style.transform = "translateX(0)"; }
      if (ng) { ng.style.transition = "none"; ng.style.transform = "translateX(0)"; }
      if (pg) { pg.style.transition = "none"; pg.style.transform = "translateX(0)"; }
    });
    document.addEventListener("mousemove", (e) => {
      if (!swipe) return;
      swipe.dx = e.clientX - swipe.startX;
      const W = qlViewport.clientWidth || 200;
      // 三页同 dx 联动:当前页跟手,前/后页紧贴边缘同步移动,无空白
      if (swipe.grid) swipe.grid.style.transform = "translateX(" + swipe.dx + "px)";
      if (swipe.next) swipe.next.style.transform = "translateX(" + swipe.dx + "px)";
      if (swipe.prev) swipe.prev.style.transform = "translateX(" + swipe.dx + "px)";
    });
    document.addEventListener("mouseup", () => {
      if (!swipe) return;
      const dx = swipe.dx;
      const pageBefore = swipe.pageBefore;
      const grid = swipe.grid;
      const nextGrid = swipe.next;
      const prevGrid = swipe.prev;
      swipe = null; // 取值完毕后再清空
      qlViewport.style.cursor = "";
      if (!grid) return;

      const W = qlViewport.clientWidth || 200;
      // 满页时"＋"顺延页,与渲染/圆点一致
      const qTotal = state.quickLinks.length;
      let totalPages = Math.max(1, Math.ceil(qTotal / qlPageSize));
      if (qTotal > 0 && qTotal % qlPageSize === 0) totalPages += 1;
      let dir = 0;
      if (dx < -SWIPE_THRESHOLD && pageBefore < totalPages - 1) dir = 1;   // 左拖:下一页
      else if (dx > SWIPE_THRESHOLD && pageBefore > 0) dir = -1;            // 右拖:上一页
      if (dir === 1 && nextGrid) {
        // 下一页:当前页滑出左,下一页(在 W 处)滑到原位(0)
        grid.style.transition = "transform 0.18s ease";
        grid.style.transform = "translateX(-" + W + "px)";
        nextGrid.style.transition = "transform 0.18s ease";
        nextGrid.style.transform = "translateX(0)";
        setTimeout(() => {
          quickPage = pageBefore + 1;
          renderQuickLinks(); // 重建三页,下一页成为当前页
        }, 180);
      } else if (dir === -1 && prevGrid) {
        // 上一页:当前页滑出右,前一页(在 -W 处)滑到原位(需 +W)
        grid.style.transition = "transform 0.18s ease";
        grid.style.transform = "translateX(" + W + "px)";
        prevGrid.style.transition = "transform 0.18s ease";
        prevGrid.style.transform = "translateX(" + W + "px)";
        setTimeout(() => {
          quickPage = pageBefore - 1;
          renderQuickLinks();
        }, 180);
      } else {
        // 未翻页:三页回弹原位(transform 0)
        grid.style.transition = "transform 0.25s ease";
        grid.style.transform = "translateX(0)";
        if (nextGrid) { nextGrid.style.transition = "transform 0.25s ease"; nextGrid.style.transform = "translateX(0)"; }
        if (prevGrid) { prevGrid.style.transition = "transform 0.25s ease"; prevGrid.style.transform = "translateX(0)"; }
        setTimeout(() => {
          grid.style.transition = "";
          if (nextGrid) nextGrid.style.transition = "";
          if (prevGrid) prevGrid.style.transition = "";
        }, 260);
      }
    });
  }

  // 天气定时自动刷新(30 分钟):天气变化时页面天气效果自动切换
  setInterval(async () => {
    if (document.body.classList.contains("mode-clean")) return; // 清爽模式不刷新天气(零网格资源)
    try {
      const geo = await chrome.runtime.sendMessage({ type: "getGeoInfo" });
      renderGeoInfo(geo); // 更新天气卡片 + 重新匹配天气效果
    } catch (e) { /* 忽略 */ }
  }, 30 * 60 * 1000);

  // 从其他标签页/网站切回主页时自动刷新 favicon(chrome._favicon 读最新缓存)。
  // 只重刷已存在卡片的图标 src,不整页重建 DOM(书签/快捷方式数据变化由 storage.onChanged 驱动重渲染)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    faviconStamp = Date.now(); // 强制 favicon 重新从 Chrome 缓存获取(访问过的站点图标会刷新)
    document.querySelectorAll(".bm-card").forEach((card) => {
      const img = card.querySelector(".bm-icon img");
      if (img && card.href) {
        delete img.dataset.fallback; // 允许重新尝试加载(之前失败的站点可能有新图标)
        img.src = buildFavicon(card.href);
      }
    });
    document.querySelectorAll(".ql-item").forEach((a) => {
      const img = a.querySelector(".ql-icon img");
      if (img && a.href) {
        delete img.dataset.fallback;
        img.src = buildFavicon(a.href);
      }
    });
  });

  // 渲染防抖:按区域分开——书签变化只重渲染书签,快捷方式变化只重渲染快捷方式
  // (避免 AI 批量生成书签描述时,快捷方式被无关地反复重建导致图标闪烁)
  let bmTimer = null;
  let qlTimer = null;
  function scheduleBookmarksRerender() {
    clearTimeout(bmTimer);
    bmTimer = setTimeout(() => renderBookmarks(), 250);
  }
  function scheduleQuickRerender() {
    clearTimeout(qlTimer);
    qlTimer = setTimeout(() => renderQuickLinks(), 250);
  }

  // 实时监听:收藏夹 / 标题 / 描述 / 失败标记 / 手动标记 → 仅刷新收藏夹
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && changes[BOOKMARK_KEY]) {
      state.bookmarks = changes[BOOKMARK_KEY].newValue || [];
      scheduleBookmarksRerender();
    }
    if (area === "local" && changes[DESC_KEY]) {
      Object.assign(state.descriptions, changes[DESC_KEY].newValue || {});
      scheduleBookmarksRerender();
    }
    if (area === "local" && changes[TITLE_KEY]) {
      Object.assign(state.titles, changes[TITLE_KEY].newValue || {});
      scheduleBookmarksRerender();
    }
    if (area === "local" && changes[DESC_FAIL_KEY]) {
      Object.assign(state.failed, changes[DESC_FAIL_KEY].newValue || {});
      scheduleBookmarksRerender();
    }
    if (area === "local" && changes[MANUAL_KEY]) {
      Object.assign(state.manual, changes[MANUAL_KEY].newValue || {});
      scheduleBookmarksRerender();
    }
    // 快捷方式变化 → 仅刷新快捷方式
    if (area === "local" && changes[QUICK_KEY]) {
      state.quickLinks = changes[QUICK_KEY].newValue || [];
      scheduleQuickRerender();
    }
  });
}

document.addEventListener("DOMContentLoaded", init);