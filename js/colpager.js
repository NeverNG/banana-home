"use strict";

/* =========================================================
 * 左栏组件分页:去掉滚动条,左侧纵向圆点切换组件页
 * 悬停/点击圆点即切换(与快捷方式翻页点一致)
 *
 * 档位语义(用户约定):每张卡片高度 = 卡片栏可用高度的 档位/4(绝对比例,
 * 不随内容变化、不瓜分同页剩余空间)。一页可容纳的档位总和 ≤ 4(4/4);
 * 放不下的卡片自动顺延到下一页(rebuildPages 动态重建分页)。
 * ======================================================== */

const colPager = { pages: [], idx: 0 };

function colGo(i) {
  if (i < 0 || i >= colPager.pages.length || i === colPager.idx) return;
  colPager.idx = i;
  colPager.pages.forEach((p, k) => p.classList.toggle("active", k === i));
  const dots = document.querySelectorAll(".col-dot");
  dots.forEach((d, k) => d.classList.toggle("active", k === i));
  // 等布局稳定后把当前页卡片拉伸填满组件栏(两次:布局稳定 + 内容渲染后)
  setTimeout(fillPage, 60);
  setTimeout(fillPage, 350);
}

function colRenderDots() {
  const box = document.getElementById("col-dots");
  if (!box) return;
  box.innerHTML = "";
  colPager.pages.forEach((_, i) => {
    const d = document.createElement("button");
    d.type = "button";
    d.className = "col-dot" + (i === colPager.idx ? " active" : "");
    d.title = "第 " + (i + 1) + " 页";
    d.addEventListener("click", () => colGo(i));
    d.addEventListener("mouseenter", () => colGo(i));
    box.appendChild(d);
  });
}

/* 卡片档位内存缓存(全局共享,设置窗口组件栏可读写):
 * key = 卡片元素 id 或首个 class,值 = 档位 1(1/4)~4(4/4) */
window.cardHeights = {};

/* 各卡片默认档位(未设置/恢复默认时使用)——定义在 gridgate.js(全模式共享),
 * 清爽模式设置窗口也能读到;此处引用,注入异常时兜底为空表(档位回退 1)。 */
const DEFAULT_CARD_HEIGHTS = window.DEFAULT_CARD_HEIGHTS || {};

/** 卡片档位 key:优先 id,否则首个 class */
function cardKeyOf(el) {
  if (el.id) return el.id;
  const cls = (el.className || "").trim().split(/\s+/)[0];
  return cls || "card";
}
window.cardKeyOf = cardKeyOf; // 供设置窗口(全局顺序移动)使用

/** 读取卡片有效档位:用户设置优先(且须在支持表内),否则默认档位,兜底 1 */
function cardRatioOf(el) {
  const key = cardKeyOf(el);
  const supported = window.SUPPORTED_CARD_HEIGHTS || {};
  const list = supported[key];
  const inList = (v) => (Array.isArray(list) ? list.indexOf(v) >= 0 : v >= 1 && v <= 4);
  const r = parseInt(window.cardHeights[key], 10);
  if (r >= 1 && r <= 4 && inList(r)) return r;
  const d = parseInt(DEFAULT_CARD_HEIGHTS[key], 10);
  return d >= 1 && d <= 4 && inList(d) ? d : 1;
}

/** 全局卡片顺序:cardOrder(全局数组)优先,否则 DOM 顺序;隐藏卡不参与分页 */
function orderedCards() {
  const pagesEl = document.getElementById("col-pages");
  if (!pagesEl) return [];
  const all = Array.from(pagesEl.querySelectorAll(":scope > .col-page > div")).filter(
    (c) => c.style.display !== "none"
  );
  const order = window.__cardOrder || [];
  if (order.length) {
    const byKey = new Map(all.map((c) => [cardKeyOf(c), c]));
    const sorted = order.map((k) => byKey.get(k)).filter(Boolean);
    const inOrder = new Set(order);
    const rest = all.filter((c) => !inOrder.has(cardKeyOf(c)));
    return sorted.concat(rest);
  }
  return all;
}

/* 动态分页:按全局顺序贪心分组(每页档位和 ≤ 4),重建 col-pages 并定位活动页。
 * 设置档位/顺序/隐藏变化后调用;卡片高度精确 = 栏高 × 档位/4,放不下的顺延下一页。 */
function rebuildPages() {
  const pagesEl = document.getElementById("col-pages");
  if (!pagesEl) return;
  // 收集隐藏卡(display:none):重建后保留在 DOM——它们不参与布局,
  // 但必须留在文档里,否则设置窗口的眼睛按钮(通过 querySelector 查找)找不到卡片,点击"显示"无反应。
  const hiddenCards = Array.from(
    pagesEl.querySelectorAll(":scope > .col-page > div")
  ).filter((c) => c.style.display === "none");
  const cards = orderedCards();
  if (!cards.length) return;
  // 贪心分页:顺序填入当前页,档位和 + 下一张 > 4 → 开新页
  const groups = [];
  let cur = [];
  let curSum = 0;
  cards.forEach((c) => {
    const r = cardRatioOf(c);
    if (cur.length && curSum + r > 4) {
      groups.push(cur);
      cur = [];
      curSum = 0;
    }
    cur.push(c);
    curSum += r;
  });
  if (cur.length) groups.push(cur);
  // 记住当前活动页首卡,重建后定位到同一卡片所在页
  const prevIdx = colPager.idx || 0;
  const prevPage = colPager.pages[prevIdx];
  const prevFirst = prevPage && prevPage.children && prevPage.children[0]
    ? cardKeyOf(prevPage.children[0])
    : null;
  // 重建 DOM(移动卡片元素,事件绑定保留)
  pagesEl.innerHTML = "";
  const newPages = groups.map((g) => {
    const page = document.createElement("div");
    page.className = "col-page";
    g.forEach((c) => page.appendChild(c));
    pagesEl.appendChild(page);
    return page;
  });
  let newIdx = 0;
  if (prevFirst) {
    const hit = newPages.findIndex((p) =>
      Array.from(p.children).some((c) => cardKeyOf(c) === prevFirst)
    );
    if (hit >= 0) newIdx = hit;
  }
  if (newIdx >= newPages.length) newIdx = newPages.length - 1;
  colPager.pages = newPages;
  colPager.idx = newIdx;
  newPages.forEach((p, i) => p.classList.toggle("active", i === newIdx));
  // 隐藏卡放回最后一个 col-page 末尾(display:none,不参与布局;
  // 必须留在 .col-page 内——orderedCards 只查询 .col-page > div,否则显示时找不到卡片)
  const lastPage = newPages[newPages.length - 1];
  hiddenCards.forEach((c) => lastPage.appendChild(c));
  colRenderDots();
  fillPage();
}
window.rebuildPages = rebuildPages;

/** 按绝对档位填充当前页卡片高度:卡高 = floor(可用高 × 档位/4),
 * 不做内容保底、不瓜分剩余(同档严格同高,不随内容变化) */
function fillPage() {
  const pagesEl = document.getElementById("col-pages");
  const page = colPager.pages[colPager.idx];
  if (!pagesEl || !page) return;
  // 预留底部空间:分页圆点区域(bottom 8 + 圆点 17 + 余量)
  const avail = pagesEl.clientHeight - 40;
  if (avail <= 0) return;
  // 先重置全部子元素 minHeight/height(含隐藏卡,避免隐藏前残留的高度值)
  const allChildren = Array.from(page.children);
  allChildren.forEach((c) => { c.style.minHeight = ""; c.style.height = ""; });
  const cards = allChildren.filter((c) => c.style.display !== "none");
  if (!cards.length) return;
  // 卡片间距(margin-bottom 14px × n-1)从可用高度扣除
  const gapTotal = Math.max(0, (cards.length - 1) * 14);
  const usable = Math.max(0, avail - gapTotal);
  cards.forEach((c) => {
    const ratioH = Math.floor((usable * cardRatioOf(c)) / 4);
    // 用 height 而非 minHeight:卡片内部 flex:1 子元素(宠物舞台/音乐封面等)
    // 在只有 min-height 的 flex 容器里不拉伸(min-height 不参与 flex 分配),
    // height 确定后 flex 子元素正常填满(宠物舞台曾因高度 0 图片不可见)
    c.style.height = ratioH + "px";
    c.style.overflow = "hidden";
    // 记录当前档位:卡片内部 CSS/JS 按 data-height 调整内容(周/月视图、条数等)
    c.dataset.height = String(cardRatioOf(c));
  });
  // 卡片高度/档位已变:通知订阅方(股票分页重算、各卡片按档位重渲染内容)
  try { if (window.__onCardsRefit) window.__onCardsRefit(); } catch (e) { /* 忽略 */ }
  try {
    (window.__cardHeightCbs || []).forEach((fn) => { try { fn(); } catch (e) { /* 忽略 */ } });
  } catch (e) { /* 忽略 */ }
}

/** 从 storage 加载卡片档位并应用(设置窗口组件栏修改后也会调用) */
function loadCardHeights() {
  try {
    chrome.storage.local.get("cardHeights").then((r) => {
      const h = r.cardHeights || {};
      Object.keys(h).forEach((k) => {
        const v = parseInt(h[k], 10);
        if (v >= 1 && v <= 4) window.cardHeights[k] = v;
      });
      rebuildPages(); // 档位影响分页,需重排
    }).catch(() => rebuildPages());
  } catch (e) { rebuildPages(); }
}

/* ---------- 卡片隐藏 / 顺序(设置窗口组件栏) ---------- */

const CARD_ORDER_KEY = "cardOrder";   // local: { order: [cardKey...] } 全局卡片顺序
const CARD_HIDDEN_KEY = "cardHidden"; // local: { cardKey: true } 隐藏的卡片

/** 保存全局卡片顺序到 storage */
function saveCardOrder() {
  try {
    const order = { order: orderedCards().map(cardKeyOf) };
    chrome.storage.local.set({ [CARD_ORDER_KEY]: order });
  } catch (e) { /* 忽略 */ }
}
window.saveCardOrder = saveCardOrder;

/** 恢复卡片顺序与隐藏状态(按全局顺序重排,隐藏卡 display:none) */
function loadCardOrder() {
  try {
    chrome.storage.local.get([CARD_ORDER_KEY, CARD_HIDDEN_KEY]).then((r) => {
      const saved = r[CARD_ORDER_KEY] || {};
      let order = saved.order;
      if (!Array.isArray(order)) {
        // 旧版格式 {页index: [keys]} → 按页序拼成全局顺序
        order = Object.keys(saved)
          .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
          .flatMap((k) => saved[k] || []);
      }
      if (Array.isArray(order) && order.length) window.__cardOrder = order;
      // 应用隐藏状态
      const hidden = r[CARD_HIDDEN_KEY] || {};
      document.querySelectorAll("#col-pages > .col-page > div").forEach((c) => {
        if (hidden[cardKeyOf(c)]) c.style.display = "none";
      });
      rebuildPages();
    }).catch(() => rebuildPages());
  } catch (e) { rebuildPages(); }
}

// 暴露给其他组件(如股票分页/条数变化后重新适配卡片高度)
window.fillPage = fillPage;

function initColPager() {
  colPager.pages = Array.from(document.querySelectorAll(".col-page"));
  if (!colPager.pages.length) return;
  colPager.pages.forEach((p, i) => p.classList.toggle("active", i === 0));
  colRenderDots();
  loadCardHeights(); // 加载档位并应用(内部 rebuildPages)
  loadCardOrder();   // 恢复卡片顺序与隐藏状态(内部 rebuildPages)
  setTimeout(fillPage, 150); // 初始填充(布局稳定后)
  setTimeout(fillPage, 400); // 内容渲染完成后再校一次
  let fillTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(fillTimer);
    fillTimer = setTimeout(fillPage, 200);
  });

  // 鼠标滚轮切换组件页(向上=上一页,向下=下一页;500ms 节流)
  const pagesEl = document.getElementById("col-pages");
  if (pagesEl) {
    let wheelLock = 0;
    pagesEl.addEventListener(
      "wheel",
      (e) => {
        // 内部滚动列表(如热榜):列表还能滚时放行给列表;滚到边界后自动放行给切页
        // 列表滚轮放行:热榜列表 / 梦想之车下拉列表
        const scroller = e.target && e.target.closest ? e.target.closest(".hot-list, .dc-dropdown-list, .bagua-detail") : null;
        if (scroller) {
          const atTop = scroller.scrollTop <= 1;
          const atBottom =
            scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1;
          const wantUp = e.deltaY < 0;
          const wantDown = e.deltaY > 0;
          // 列表方向还能滚动 → 让列表滚(不拦截)
          if ((wantDown && !atBottom) || (wantUp && !atTop)) return;
          // 已到边界 → 落到下方切页逻辑
        }
        e.preventDefault();
        const now = Date.now();
        if (now - wheelLock < 500) return;
        wheelLock = now;
        if (e.deltaY > 0) colGo(colPager.idx + 1);
        else colGo(colPager.idx - 1);
      },
      { passive: false }
    );
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initColPager);
} else {
  initColPager();
}
