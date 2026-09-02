"use strict";

/* =========================================================
 * 今日热榜:百度热搜 / 抖音 / 头条 / B站 / 知乎,点击切换榜单
 * ======================================================== */

const HOT_BOARDS = [
  {
    name: "百度热搜",
    url: "https://top.baidu.com/api/board?platform=wise&tab=realtime",
    parse: (data) => {
      // 百度热搜返回嵌套结构:cards[0].content[].content[] 才是条目
      const cards = data && data.data && data.data.cards;
      const blocks = cards && cards[0] && cards[0].content;
      if (!Array.isArray(blocks)) return [];
      const items = [];
      for (const b of blocks) {
        if (b && Array.isArray(b.content)) items.push.apply(items, b.content);
      }
      return items.map((c) => ({ title: c.word || "", url: c.url || "" })).filter((c) => c.title);
    },
  },
  {
    name: "抖音热榜",
    kind: "message",
  },
  {
    name: "今日头条",
    url: "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc",
    parse: (data) => {
      const list = data && data.data;
      if (!Array.isArray(list)) return [];
      return list.map((c) => ({ title: c.Title || "", url: c.Url || "" })).filter((c) => c.title);
    },
  },
  {
    name: "B站热门",
    url: "https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all",
    parse: (data) => {
      const list = data && data.data && data.data.list;
      if (!Array.isArray(list)) return [];
      return list.map((v) => ({
        title: v.title || "",
        url: v.bvid ? "https://www.bilibili.com/video/" + v.bvid : "",
      })).filter((c) => c.title);
    },
  },
  {
    name: "知乎热榜",
    url: "https://api.zhihu.com/topstory/hot-list?limit=50",
    parse: (data) => {
      const list = data && data.data;
      if (!Array.isArray(list)) return [];
      return list.map((d) => {
        const t = d && d.target;
        if (!t || !t.title) return null;
        // target.url 形如 https://api.zhihu.com/questions/123 或 /articles/456
        // target.id 是数字会丢精度,须从 url 提取真实 id 再转 www 可打开链接
        const m = /\/questions\/(\d+)/.exec(t.url || "");
        const a = /\/articles\/(\d+)/.exec(t.url || "");
        const url = m ? "https://www.zhihu.com/question/" + m[1] : a ? "https://www.zhihu.com/p/" + a[1] : "";
        return { title: t.title, url };
      }).filter(Boolean);
    },
  },
];

// 注册热榜 API 到统一注册表(接口列表读取)
try {
  window.__apiRegistry = window.__apiRegistry || [];
  HOT_BOARDS.forEach((bd) => {
    if (bd && bd.url) window.__apiRegistry.push({ name: bd.name, desc: "今日热榜", url: bd.url });
  });
} catch (e) { /* 忽略 */ }

// 暴露给 main.js 接口列表(读取真实使用的榜单 URL)
try { window.HOT_BOARDS = HOT_BOARDS; } catch (e) { /* 忽略 */ }
const hot = { idx: 0, loading: false, lastItems: [] };

/** 渲染热榜列表:全部条目渲染(上限 50 防过长),档位越高列表区越大,条目超出纵向滚动 */
function hotRenderList(items) {
  const box = document.getElementById("hot-list");
  if (!box) return;
  box.innerHTML = "";
  if (!items.length) {
    box.innerHTML = '<div class="widget-empty">获取失败,点击 ⇄ 重试</div>';
    return;
  }
  // 全部条目渲染,超出卡片高度由 hot-list 纵向滚动(上限 50 条防列表过长)
  items.slice(0, 50).forEach((item, i) => {
    const a = document.createElement("a");
    a.className = "hot-item";
    a.href = item.url || "#";
    a.target = "_blank";
    a.rel = "noopener";
    const idx = document.createElement("span");
    idx.className = "hot-index" + (i < 3 ? " top" : "");
    idx.textContent = i + 1;
    const title = document.createElement("span");
    title.className = "hot-title";
    title.textContent = item.title;
    title.title = item.title;
    a.append(idx, title);
    box.appendChild(a);
  });
}

/** 持久化当前选中的榜单 */
function hotSaveIdx() {
  try {
    chrome.storage.local.set({ hotBoardIdx: hot.idx % HOT_BOARDS.length });
  } catch (e) { /* 忽略 */ }
}

async function hotLoad() {
  // 清爽模式守卫:会话内切到清爽模式后停止轮询(脚本仍注入,但不再请求接口)
  if (document.body.classList.contains("mode-clean")) return;
  const board = HOT_BOARDS[hot.idx % HOT_BOARDS.length];
  hotSetActiveTab();
  const box = document.getElementById("hot-list");
  if (box) box.innerHTML = '<div class="widget-empty">加载中…</div>';
  if (hot.loading) return;
  hot.loading = true;
  // 消息型榜单(如抖音:经后台请求)
  if (board.kind === "message") {
    let items = [];
    try {
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "getDouyinHot" }, (r) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(r);
        });
      });
      if (res && res.status === "ok" && Array.isArray(res.items)) items = res.items;
    } catch (e) {
      /* 忽略:后台失败走页面直连兜底 */
    }
    // 后台失败 → 页面直连兜底(部分环境页面 fetch 可用)
    if (!items.length) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 9000);
        const resp = await fetch(
          "https://aweme.snssdk.com/aweme/v1/hot/search/list/?aid=1128&device_platform=android&version_code=300&os_version=10&channel=online&app_name=aweme",
          { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }
        );
        clearTimeout(timer);
        if (resp.ok) {
          const data = await resp.json();
          const list = data && data.data && data.data.word_list;
          if (Array.isArray(list)) {
            items = list
              .map((k) => ({
                title: (k && k.word) || "",
                url: k && k.sentence_id ? "https://www.douyin.com/hot/" + k.sentence_id : "",
              }))
              .filter((x) => x.title);
          }
        }
      } catch (e) {
        /* 忽略 */
      }
    }
    hotRenderList(items);
    hot.lastItems = items; // 记住列表,档位变化时按新条数重渲染
    hot.loading = false;
    return;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const resp = await fetch(board.url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    clearTimeout(timer);
    if (!resp.ok) { hotRenderList([]); return; }
    const data = await resp.json();
    const parsed = board.parse(data);
    hotRenderList(parsed);
    hot.lastItems = parsed; // 记住列表,档位变化时按新条数重渲染
  } catch (e) {
    hotRenderList([]);
  } finally {
    hot.loading = false;
  }
}

/** 渲染榜单切换 tab 页签:由 HOT_BOARDS 驱动,卡片宽度有限用简称展示,title 提示全称 */
function renderHotTabs() {
  const box = document.getElementById("hot-tabs");
  if (!box) return;
  box.innerHTML = "";
  const SHORT = { "百度热搜": "百度", "抖音热榜": "抖音", "今日头条": "头条", "B站热门": "B站", "知乎热榜": "知乎" };
  HOT_BOARDS.forEach((bd, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hot-tab";
    btn.textContent = SHORT[bd.name] || bd.name;
    btn.title = bd.name;
    btn.addEventListener("click", () => {
      if (hot.idx % HOT_BOARDS.length === i) return; // 已是当前榜单,忽略
      hot.idx = i;
      hotSaveIdx();
      hotLoad();
    });
    box.appendChild(btn);
  });
  hotSetActiveTab();
}

/** 高亮当前选中的榜单 tab */
function hotSetActiveTab() {
  const tabs = document.querySelectorAll("#hot-tabs .hot-tab");
  tabs.forEach((tb, i) => tb.classList.toggle("active", i === hot.idx % HOT_BOARDS.length));
}

function initHot() {
  renderHotTabs();
  // 恢复上次选择的榜单,再加载
  try {
    chrome.storage.local.get("hotBoardIdx").then((r) => {
      if (typeof r.hotBoardIdx === "number" && r.hotBoardIdx >= 0 && r.hotBoardIdx < HOT_BOARDS.length) {
        hot.idx = r.hotBoardIdx;
      }
      hotLoad();
    }).catch(() => hotLoad());
  } catch (e) {
    hotLoad();
  }
  // 每 10 分钟自动刷新
  setInterval(hotLoad, 10 * 60 * 1000);
  // 切回网格模式:立即刷新一次(清爽模式期间定时器被守卫跳过,数据可能陈旧)
  if (window.onGridResume) window.onGridResume(hotLoad);
}

const startHot = () => (window.__whenGrid ? window.__whenGrid(initHot) : initHot());
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startHot);
} else {
  startHot();
}

// 档位变化(列表区高度变化,条目超出自动滚动)时重渲染
window.onCardHeight && window.onCardHeight(function () {
  const c = document.querySelector(".hot-card");
  if (c && c.dataset.height && hot.lastItems.length) hotRenderList(hot.lastItems);
});
