"use strict";

/* ===== 网格资源门控:最先加载(早于各组件脚本),模式初始化完成前任务一律排队。=====
 * 清爽模式刷新时不加载三栏数据接口;main.js 的 applyHomeMode 决定执行时机并解锁。
 * 注意:必须是外部脚本文件——MV3 扩展默认 CSP 禁止内联 <script>,内联版不会执行。 */
(function () {
  /* 卡片元数据:全项目唯一数据源(显示名 / 默认档位 / 支持档位)。
   * 设置面板「组件」页签的卡片行由 main.js 按此表生成,下面的 DEFAULT/SUPPORTED 也由它派生,
   * 避免 index.html、gridgate、colpager 三处各写一份导致漂移(曾出现设置窗口提示档位与真实默认值不一致)。
   * 新增卡片只需在这里加一行 + 在 index.html 放入对应元素。 */
  var CARD_META = [
    { key: "clock-card",       name: "时间",       def: 1, heights: [1] },
    { key: "calendar-card",    name: "日历",       def: 2, heights: [1, 2] },
    { key: "quote-card",       name: "名言警句",   def: 1, heights: [1, 2] },
    { key: "geo-map-card",     name: "地图",       def: 2, heights: [1, 2, 3] },
    { key: "geo-weather-card", name: "天气",       def: 1, heights: [1, 2] },
    { key: "pet-card",         name: "宠物",       def: 1, heights: [1, 2] },
    { key: "music-card",       name: "白噪音",     def: 1, heights: [1, 2] },
    { key: "stock-card",       name: "股票行情",   def: 2, heights: [1, 2, 3, 4] },
    { key: "monitor-card",     name: "系统监控",   def: 1, heights: [1] },
    { key: "hot-card",         name: "今日热榜",   def: 2, heights: [1, 2, 3, 4] },
    { key: "dreamcar-card",    name: "梦想之车",   def: 2, heights: [2, 3] },
    { key: "activity-card",    name: "访问活跃度", def: 1, heights: [1, 2] },
    { key: "poker-card",       name: "扑克牌",     def: 1, heights: [1, 2] },
    { key: "bagua-card",       name: "八卦罗盘",   def: 2, heights: [1, 2, 3] },
  ];
  window.CARD_META = CARD_META;

  /* 各卡片默认档位(1/4-4/4)。必须挂全局:清爽模式不注入 colpager.js,
   * 但设置窗口(所有模式可用)需读取默认值标 active / 恢复默认——放这里全模式共享。 */
  var defaults = {};
  CARD_META.forEach(function (c) { defaults[c.key] = c.def; });
  window.DEFAULT_CARD_HEIGHTS = defaults;

  /* 卡片档位变化通知注册器(多订阅)。必须定义在这里(最先加载的基础脚本):
   * calendar.js/main.js 等先于 colpager.js 注入执行,若在 colpager 里定义,
   * 它们的 onCardHeight 注册会因函数未定义而失败(日历切 1/4 不重渲染事故)。
   * fillPage(网格模式)仅在档位真的变化时统一触发;清爽模式无 fillPage,回调不执行。 */
  window.__cardHeightCbs = window.__cardHeightCbs || [];
  window.onCardHeight = function (fn) {
    if (typeof fn === "function") window.__cardHeightCbs.push(fn);
  };
  /* 切回网格模式时的组件恢复回调(热榜/股票/监控/宠物/壁纸等)。
   * 组件定时器在清爽模式只跳过执行(setInterval 仍在跑),切回网格时由
   * main.js applyHomeMode 统一触发注册的回调立即刷新,避免数据陈旧。 */
  window.__gridResumeCbs = window.__gridResumeCbs || [];
  window.onGridResume = function (fn) {
    if (typeof fn === "function") window.__gridResumeCbs.push(fn);
  };
  /* 各卡片支持的高度档位(设置窗口置灰不支持项;用户设置不在支持表内时回退默认)。
   * 必须放这里:设置窗口与 colpager 都要读,清爽模式也要能读到。 */
  var supported = {};
  CARD_META.forEach(function (c) { supported[c.key] = c.heights.slice(); });
  window.SUPPORTED_CARD_HEIGHTS = supported;

  /* 卡片是否真的"在用户眼前":隐藏标签页 / 清爽模式 / 卡片被眼睛按钮隐藏 / 不在当前组件页。
   * 供各组件定时器与动画循环做守卫(纯 classList 判断,不触发布局)。
   * 注意:colpager.js 未注入时(清爽模式)也安全——它只做 DOM class 判断。 */
  window.isCardVisible = function (el) {
    if (!el || document.hidden) return false;
    if (document.body.classList.contains("mode-clean")) return false;
    if (el.style && el.style.display === "none") return false;
    var page = el.closest ? el.closest(".col-page") : null;
    return !page || page.classList.contains("active");
  };

  window.__gridTasks = window.__gridTasks || [];
  window.__gridLocked = true; // 模式未确定前锁定:所有网格任务排队
  window.__whenGrid = function (fn) {
    if (typeof fn !== "function") return;
    if (!window.__gridLocked && !document.body.classList.contains("mode-clean")) { fn(); return; }
    window.__gridTasks.push(fn);
  };
  // 尽早恢复上次模式(首帧前),避免清爽模式刷新闪出网格内容(CSS 默认隐藏三栏配合)
  var applyMode = function (mode) {
    var clean = mode === "clean";
    document.body.classList.toggle("mode-clean", clean);
    window.__gridLocked = false; // 模式已确定:解锁门控
    if (!clean) {
      // 网格模式:执行已在队列的任务。
      // 时序约定:本回调(g1)在 DOMContentLoaded 之前 resolve,此刻组件脚本尚未注册任务,
      // 队列为空,真正的任务由 main.js applyHomeMode 切回网格时统一 flush——两者不重复。
      var tasks = window.__gridTasks || [];
      window.__gridTasks = [];
      tasks.forEach(function (t) { try { t(); } catch (e) { /* 忽略 */ } });
    }
  };
  try {
    chrome.storage.local.get("homeMode").then(function (r) {
      applyMode(r.homeMode);
    }).catch(function () { applyMode("grid"); });
  } catch (e) {
    applyMode("grid");
  }
})();
