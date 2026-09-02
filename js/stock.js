"use strict";

/* =========================================================
 * 股票行情:腾讯行情接口(GBK),30s 自动刷新,红涨绿跌
 * 自选股管理:⋮ 打开管理弹窗 —— 输入代码新增 / 拖拽排序 / 删除
 * A股大盘云图:🔍 弹窗内嵌 52etf.site 大盘云图(iframe 运行时创建,关闭即销毁)
 * 自选股列表持久化于 chrome.storage.local(selfStocks)
 * ======================================================== */

const STOCK_KEY = "selfStocks"; // local: 自选股数组 [{ code, name }]

const DEFAULT_STOCKS = [
  { code: "sh000001", name: "上证指数" },
  { code: "sz399001", name: "深证成指" },
  { code: "sz399006", name: "创业板指" },
  { code: "sh600519", name: "贵州茅台" },
  { code: "sz300750", name: "宁德时代" },
  { code: "sh601318", name: "中国平安" },
];

let STOCKS = [...DEFAULT_STOCKS];

// 注册腾讯行情到统一注册表
try {
  window.__apiRegistry = window.__apiRegistry || [];
  window.__apiRegistry.push({
    name: "腾讯行情",
    desc: "股票实时行情(当前自选股)",
    url: "https://qt.gtimg.cn/q=" + STOCKS.map((x) => x.code).join(","),
  });
} catch (e) { /* 忽略 */ }

// 暴露给 main.js 接口列表(真实自选股)
try { window.STOCKS = STOCKS; } catch (e) { /* 忽略 */ }

function stockSave() {
  try { chrome.storage.local.set({ [STOCK_KEY]: STOCKS }); } catch (e) { /* 忽略 */ }
}

/** 规范化用户输入的股票代码:600519→sh600519, 000001/300750→sz前缀, 已带前缀原样保留 */
function normalizeStockCode(input) {
  let code = String(input || "").trim().toLowerCase();
  if (!code) return null;
  if (/^[a-z]{2}\d{6}$/.test(code)) return code; // sh600519 / sz000001 / bj830799 等
  if (/^\d{6}$/.test(code)) {
    return (code.startsWith("6") ? "sh" : "sz") + code;
  }
  return null;
}

/* ---------- 行情 ---------- */

async function stockFetch() {
  try {
    if (!STOCKS.length) return [];
    const q = STOCKS.map((s) => s.code).join(",");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const resp = await fetch("https://qt.gtimg.cn/q=" + q, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    clearTimeout(timer);
    if (!resp.ok) return [];
    // 腾讯接口返回 GBK 编码
    const buf = await resp.arrayBuffer();
    const text = new TextDecoder("gbk").decode(buf);
    const list = [];
    const byCode = new Map();
    for (const line of text.split(";")) {
      const m = line.match(/v_([a-z0-9]+)="([^"]*)"/);
      if (!m || !m[2]) continue;
      const f = m[2].split("~");
      if (f.length < 33) continue;
      byCode.set(m[1], {
        code: m[1],
        name: f[1] || "",
        price: f[3] || "--",
        change: f[31] || "0",
        pct: f[32] || "0",
      });
    }
    // 名称回写自选股(用户新增的股票接口返回真实名称)
    let nameChanged = false;
    STOCKS.forEach((s) => {
      const hit = byCode.get(s.code);
      if (hit && hit.name && hit.name !== s.name) { s.name = hit.name; nameChanged = true; }
    });
    if (nameChanged) stockSave();
    list.push(...byCode.values());
    return list;
  } catch (e) {
    return [];
  }
}

/* ---------- 行情(滚动模式:全部自选股渲染,超出卡片高度列表滚动) ---------- */

const stockState = {
  lastList: [],  // 最近一次行情数据(档位变化重渲染用)
};

function stockRender(list) {
  const box = document.getElementById("stock-list");
  const upd = document.getElementById("stock-update");
  if (!box) return;
  box.innerHTML = "";
  if (!list.length) {
    box.innerHTML = '<div class="widget-empty">获取失败,自动重试中…</div>';
    return;
  }
  // 全部条目渲染,超出卡片高度由 stock-list 纵向滚动(不切片/不分页)
  for (const s of list) {
    const row = document.createElement("div");
    row.className = "stock-item";
    const name = document.createElement("span");
    name.className = "stock-name";
    name.textContent = s.name;
    const price = document.createElement("span");
    price.className = "stock-price";
    // 接口异常时价格字段可能是 "--"(停牌/解析失败),避免显示 NaN
    const pv = parseFloat(s.price);
    price.textContent = isFinite(pv) ? pv.toFixed(2) : "--";
    const pct = document.createElement("span");
    pct.className = "stock-pct";
    const v = parseFloat(s.pct);
    if (isFinite(v)) {
      pct.textContent = (v > 0 ? "+" : "") + v.toFixed(2) + "%";
      pct.classList.add(v >= 0 ? "up" : "down");
    } else {
      pct.textContent = "--";
    }
    row.append(name, price, pct);
    box.appendChild(row);
  }
  const now = new Date();
  if (upd) upd.textContent = now.getHours() + ":" + String(now.getMinutes()).padStart(2, "0");
}

// 滚动模式:无分页(全部条目 + 列表滚动)
/** 内容高度变化后重新适配卡片栏(列裁切 hidden,必须重算 fillPage) */
function refitCard() {
  try { if (window.fillPage) setTimeout(window.fillPage, 0); } catch (e) { /* 忽略 */ }
}

// 卡片高度档位变化后(fillPage 末尾回调):按新可用高度重渲染当前页,越界页自动钳制
try {
  window.__onCardsRefit = () => stockRender(stockState.lastList);
} catch (e) { /* 忽略 */ }

async function stockRefresh() {
  // 清爽模式守卫:会话内切到清爽模式后停止轮询(脚本仍注入,但不再请求行情接口)
  if (document.body.classList.contains("mode-clean")) return;
  const list = await stockFetch();
  stockState.lastList = list;
  stockRender(list);
}

/* ---------- 自选股管理弹窗 ---------- */

function renderStockManage() {
  const box = document.getElementById("stock-manage-list");
  if (!box) return;
  box.innerHTML = "";
  let dragIdx = null;

  STOCKS.forEach((s, idx) => {
    const row = document.createElement("div");
    row.className = "engine-row";
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
      const arr = [...STOCKS];
      const [it] = arr.splice(dragIdx, 1);
      arr.splice(idx, 0, it);
      STOCKS = arr;
      window.STOCKS = arr;
      stockSave();
      renderStockManage();
      stockRefresh();
    });
    row.addEventListener("dragend", () => {
      dragIdx = null;
      box.querySelectorAll(".engine-row").forEach((r) => r.classList.remove("dragging", "drag-over"));
    });

    // 排序把手提示
    const grip = document.createElement("span");
    grip.className = "engine-row-grip";
    grip.textContent = "⋮⋮";

    const name = document.createElement("span");
    name.className = "engine-row-name";
    name.textContent = s.name || s.code;
    name.title = s.code;

    const ops = document.createElement("span");
    ops.className = "engine-row-ops";
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "×";
    del.title = "删除";
    del.addEventListener("click", () => {
      STOCKS = STOCKS.filter((_, i) => i !== idx);
      window.STOCKS = STOCKS;
      stockSave();
      renderStockManage();
      stockRefresh();
      refitCard();
    });
    ops.appendChild(del);
    row.append(grip, name, ops);
    box.appendChild(row);
  });
}

function stockAdd() {
  const input = document.getElementById("stock-add-code");
  if (!input) return;
  const code = normalizeStockCode(input.value);
  if (!code) { input.focus(); return; }
  stockAddByCode(code);
  input.value = "";
  hideStockSuggest();
}

/** 直接按规范化代码添加自选股(已存在则忽略) */
function stockAddByCode(code) {
  if (!code || STOCKS.some((s) => s.code === code)) return;
  STOCKS.push({ code, name: "" });
  window.STOCKS = STOCKS;
  stockSave();
  renderStockManage();
  stockRefresh();
  refitCard();
}

/* ---------- 名称/代码模糊搜索下拉(腾讯 smartbox 接口) ---------- */

let stockSuggestTimer = 0;

function hideStockSuggest() {
  const box = document.getElementById("stock-suggest");
  if (box) box.hidden = true;
}

function renderStockSuggest(items) {
  const box = document.getElementById("stock-suggest");
  if (!box) return;
  box.innerHTML = "";
  if (!items.length) {
    box.innerHTML = '<div class="stock-suggest-empty">无匹配,可直接输入完整代码添加</div>';
    box.hidden = false;
    return;
  }
  items.slice(0, 8).forEach((it) => {
    const row = document.createElement("div");
    row.className = "stock-suggest-item" + (STOCKS.some((s) => s.code === it.code) ? " added" : "");
    row.dataset.code = it.code;
    const name = document.createElement("span");
    name.className = "stock-suggest-name";
    name.textContent = it.name;
    const code = document.createElement("span");
    code.className = "stock-suggest-code";
    code.textContent = it.code + (STOCKS.some((s) => s.code === it.code) ? " · 已添加" : "");
    row.append(name, code);
    // mousedown 而非 click:先于输入框 blur 触发,避免下拉先被隐藏
    // 交互:点选仅把代码填入输入框,由用户点「＋ 添加」确认后才加入列表
    row.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      const input = document.getElementById("stock-add-code");
      if (input) {
        input.value = it.code;
        input.focus();
      }
      hideStockSuggest();
    });
    box.appendChild(row);
  });
  box.hidden = false;
}

/** 请求腾讯 smartbox 搜索建议(GBK + \uXXXX 名称转义) */
async function stockSuggestFetch(kw) {
  const box = document.getElementById("stock-suggest");
  if (!box) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const resp = await fetch("https://smartbox.gtimg.cn/s3/?v=2&q=" + encodeURIComponent(kw) + "&t=all", {
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) { hideStockSuggest(); return; }
    const buf = await resp.arrayBuffer();
    const text = new TextDecoder("gbk").decode(buf);
    const m = text.match(/v_hint="([^"]*)"/);
    const items = m
      ? m[1].split("^").map((seg) => {
          const f = seg.split("~");
          if (f.length < 3 || !f[1] || !f[2]) return null;
          const market = f[0];
          if (market !== "sh" && market !== "sz" && market !== "bj") return null;
          const name = String(f[2]).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
          return { code: market + f[1], name, market };
        }).filter(Boolean)
      : [];
    renderStockSuggest(items);
  } catch (e) {
    hideStockSuggest();
  }
}

function stockSearchInput() {
  const input = document.getElementById("stock-add-code");
  const kw = (input ? input.value : "").trim();
  clearTimeout(stockSuggestTimer);
  if (!kw) { hideStockSuggest(); return; }
  stockSuggestTimer = setTimeout(() => stockSuggestFetch(kw), 250);
}

function initStock() {
  // 恢复自选股(持久化优先,否则默认)
  try {
    chrome.storage.local.get(STOCK_KEY).then((r) => {
      if (Array.isArray(r[STOCK_KEY]) && r[STOCK_KEY].length) {
        STOCKS = r[STOCK_KEY];
        window.STOCKS = STOCKS;
      }
      stockRefresh();
    }).catch(() => stockRefresh());
  } catch (e) { stockRefresh(); }
  setInterval(stockRefresh, 30000); // 30s 刷新
  // 切回网格模式:立即刷新一次(清爽模式期间定时器被守卫跳过,数据可能陈旧)
  if (window.onGridResume) window.onGridResume(stockRefresh);

  // 管理弹窗
  const mgrBtn = document.getElementById("stock-manage-btn");
  if (mgrBtn) mgrBtn.addEventListener("click", () => {
    renderStockManage();
    document.getElementById("stock-manage-dialog").showModal();
  });
  const addBtn = document.getElementById("btn-add-stock");
  if (addBtn) addBtn.addEventListener("click", stockAdd);
  const codeInput = document.getElementById("stock-add-code");
  if (codeInput) {
    codeInput.addEventListener("input", stockSearchInput);
    codeInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      // 有下拉结果:把第一项填入输入框(由用户点「＋ 添加」确认);无下拉:按输入框内容直接添加
      const box = document.getElementById("stock-suggest");
      const first = box && !box.hidden ? box.querySelector(".stock-suggest-item:not(.added)") : null;
      if (first && first.dataset.code) {
        codeInput.value = first.dataset.code;
        hideStockSuggest();
        return;
      }
      stockAdd();
    });
    codeInput.addEventListener("blur", () => setTimeout(hideStockSuggest, 150));
  }
  const closeBtn = document.getElementById("stock-manage-close");
  if (closeBtn) closeBtn.addEventListener("click", () => {
    hideStockSuggest();
    document.getElementById("stock-manage-dialog").close();
  });

  initCloudDialog(); // A股大盘云图弹窗
}

/* ---------- A股大盘云图(内嵌 52etf.site 大盘云图) ---------- */

/** 52etf 页面 meta viewport 固定 1024px 宽,按弹窗可用尺寸整体缩放适配 */
function fitCloudFrame() {
  const wrap = document.getElementById("stock-cloud-frame");
  if (!wrap) return;
  const frame = wrap.querySelector("iframe");
  if (!frame) return;
  const wrapW = wrap.clientWidth;
  const wrapH = wrap.clientHeight;
  if (!wrapW || !wrapH) {
    // 弹窗刚 showModal 首帧布局未就绪(clientWidth/Height 为 0)→ 稍后重试
    // (不重试则 iframe 保持 1024 原尺寸溢出被裁切,表现为首次打开显示不出来)
    clearTimeout(fitCloudFrame._t);
    fitCloudFrame._t = setTimeout(fitCloudFrame, 80);
    return;
  }
  const BASE = 1024; // 52etf 固定视口宽
  const scale = wrapW / BASE;
  frame.style.width = BASE + "px";
  frame.style.height = Math.ceil(wrapH / scale) + "px";
  frame.style.transformOrigin = "top left";
  frame.style.transform = "scale(" + scale + ")";
}

function openCloudDialog() {
  const dialog = document.getElementById("stock-cloud-dialog");
  const wrap = document.getElementById("stock-cloud-frame");
  const loading = document.getElementById("stock-cloud-loading");
  if (!dialog || !wrap) return;
  if (!dialog.open) dialog.showModal();
  // 以 iframe 是否存在为准(loading 遮罩常驻 wrap 内,不能用 firstChild 判断——
  // 曾因 firstChild 恒为 loading 元素导致 iframe 永不创建,首次打开只见遮罩)
  if (!wrap.querySelector("iframe")) {
    const frame = document.createElement("iframe");
    frame.src = "https://52etf.site/";
    frame.title = "52ETF 大盘云图";
    if (loading) {
      loading.hidden = false;
      loading.textContent = "正在加载 52ETF 大盘云图…";
      clearTimeout(loading._t);
      loading._t = setTimeout(() => {
        if (!loading.hidden) loading.textContent = "加载较慢或失败,请检查网络后重试";
      }, 12000);
    }
    frame.addEventListener("load", () => {
      if (loading) loading.hidden = true;
      fitCloudFrame(); // 内容就绪后按当前尺寸重新缩放
    });
    wrap.appendChild(frame);
  }
  fitCloudFrame(); // 容器尺寸就绪立即缩放(首次/每次打开都校正)
}

function initCloudDialog() {
  const btn = document.getElementById("stock-cloud-btn");
  const openBtn = document.getElementById("stock-cloud-open");
  const dialog = document.getElementById("stock-cloud-dialog");
  const closeBtn = document.getElementById("stock-cloud-close");
  if (btn) btn.addEventListener("click", openCloudDialog);
  if (openBtn) openBtn.addEventListener("click", () => window.open("https://52etf.site/", "_blank"));
  if (closeBtn && dialog) closeBtn.addEventListener("click", () => dialog.close());
  if (dialog) {
    dialog.addEventListener("close", () => {
      const wrap = document.getElementById("stock-cloud-frame");
      const loading = document.getElementById("stock-cloud-loading");
      if (wrap) {
        const fr = wrap.querySelector("iframe");
        if (fr) fr.remove(); // 只移除 iframe,保留 loading 遮罩元素(勿用 innerHTML 清空,会把 loading 一并删掉)
      }
      if (loading) {
        loading.hidden = false;
        loading.textContent = "正在加载 52ETF 大盘云图…";
      }
    });
  }
  // 弹窗打开期间窗口尺寸变化 → 按新尺寸重算 iframe 缩放
  let cloudResizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(cloudResizeTimer);
    cloudResizeTimer = setTimeout(() => {
      const d = document.getElementById("stock-cloud-dialog");
      if (d && d.open) fitCloudFrame();
    }, 120);
  });
}

const startStock = () => (window.__whenGrid ? window.__whenGrid(initStock) : initStock());
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startStock);
} else {
  startStock();
}
