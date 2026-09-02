"use strict";

/* ===== 网格资源门控:最先加载(早于各组件脚本),模式初始化完成前任务一律排队。=====
 * 清爽模式刷新时不加载三栏数据接口;main.js 的 applyHomeMode 决定执行时机并解锁。
 * 注意:必须是外部脚本文件——MV3 扩展默认 CSP 禁止内联 <script>,内联版不会执行。 */
(function () {
  /* 各卡片默认档位(1/4-4/4)。必须挂全局:清爽模式不注入 colpager.js,
   * 但设置窗口(所有模式可用)需读取默认值标 active / 恢复默认——放这里全模式共享。 */
  window.DEFAULT_CARD_HEIGHTS = {
    "clock-card": 1, "calendar-card": 2, "quote-card": 1,
    "geo-map-card": 2, "geo-weather-card": 1, "pet-card": 1,
    "music-card": 1, "stock-card": 2, "monitor-card": 1,
    "hot-card": 2, "dreamcar-card": 2, "activity-card": 1,
    "poker-card": 1, "bagua-card": 2,
  };
  /* 卡片档位变化通知注册器(多订阅)。必须定义在这里(最先加载的基础脚本):
   * calendar.js/main.js 等先于 colpager.js 注入执行,若在 colpager 里定义,
   * 它们的 onCardHeight 注册会因函数未定义而失败(日历切 1/4 不重渲染事故)。
   * fillPage(网格模式)末尾遍历 __cardHeightCbs 统一触发;清爽模式无 fillPage,回调不执行。 */
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
  window.SUPPORTED_CARD_HEIGHTS = {
    "clock-card": [1],
    "calendar-card": [1, 2],
    "quote-card": [1, 2],
    "geo-map-card": [1, 2, 3],
    "geo-weather-card": [1, 2],
    "pet-card": [1, 2],
    "music-card": [1, 2],
    "stock-card": [1, 2, 3, 4],
    "monitor-card": [1],
    "hot-card": [1, 2, 3, 4],
    "dreamcar-card": [2, 3],
    "activity-card": [1, 2],
    "poker-card": [1, 2],
    "bagua-card": [1, 2, 3],
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
