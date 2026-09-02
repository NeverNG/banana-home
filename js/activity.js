"use strict";

/* =========================================================
 * 访问活跃度:GitHub 风格贡献日历(最近半年,26 周)
 * 每次打开/刷新主页,当天访问次数 +1(每天只要有访问即记为活跃一天);
 * 颜色深浅表示当天刷新次数。
 * 独立于 main.js,页面加载即记录并渲染。
 * ======================================================== */

const ACTIVITY_KEY = "visitActivity";

/** 本地日期 YYYY-MM-DD */
function actFmtDate(d) {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

/** 记录一次主页访问(当天计数 +1),返回最新数据 */
async function recordVisit() {
  const today = actFmtDate(new Date());
  let data = {};
  try {
    data = (await chrome.storage.local.get(ACTIVITY_KEY))[ACTIVITY_KEY] || {};
  } catch (e) { /* 忽略 */ }
  data[today] = (data[today] || 0) + 1;

  // 数据精简:仅保留最近 2 年,防止长期无限增长(unlimitedStorage 下通常无碍,稳妥起见)
  const keys = Object.keys(data).sort();
  if (keys.length > 760) {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 2);
    const cutoffStr = actFmtDate(cutoff);
    for (const k of keys) {
      if (k < cutoffStr) delete data[k];
    }
  }

  try {
    await chrome.storage.local.set({ [ACTIVITY_KEY]: data });
  } catch (e) { /* 忽略 */ }
  return data;
}

/** 次数分档(贡献图颜色 0-4 级):0 / 1 / 2-3 / 4-6 / 7+ */
function actLevel(n) {
  if (!n) return 0;
  if (n === 1) return 1;
  if (n <= 3) return 2;
  if (n <= 6) return 3;
  return 4;
}

/**
 * 生成"当前天往前 N 天"的格子数据(旧→新排列,今天在最右)。
 * 档位:1/4 = 182 天(半年), 2/4 = 365 天(一年)。不再按周列组织,直接平铺天数。
 */
function buildDays(now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const card = document.querySelector(".activity-card");
  const height = card ? parseInt(card.dataset.height, 10) : 1;
  const days = height >= 2 ? 360 : 180;

  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = actFmtDate(d);
    const future = d > today;
    out.push({ date: dateStr, future, count: future ? 0 : (actData[dateStr] || 0) });
  }
  return out;
}

/** 计算格子大小:在可用宽高内放 count 个正方形格子(间隙固定 2px)。
 * fullRows=true 时只保留完整行(最后一行不满的格子不显示),保证矩阵整行占满。 */
function computeCellSize(cw, ch, count, fullRows) {
  const gap = 2;
  let best = { size: 0, cols: 1, rows: 1 };
  for (let cols = 1; cols <= count; cols++) {
    const rows = fullRows ? Math.max(1, Math.floor(count / cols)) : Math.ceil(count / cols);
    if (!rows) continue;
    const s = Math.min((cw - (cols - 1) * gap) / cols, (ch - (rows - 1) * gap) / rows);
    // 尺寸更大优先;同尺寸取更多列(格子更多,信息更全)
    if (s > best.size || (s === best.size && cols > best.cols)) best = { size: s, cols, rows };
  }
  return { size: Math.max(2, Math.floor(best.size)), gap, cols: best.cols, rows: best.rows };
}

/* 当前数据(记录后由 init 载入) */
let actData = {};

function renderActivity() {
  const chart = document.getElementById("act-chart");
  if (!chart) return;
  const now = new Date();
  const days = buildDays(now);
  const todayStr = actFmtDate(now);

  chart.innerHTML = "";

  // 天数格子矩阵:平铺自动换行,整体居中
  const matrix = document.createElement("div");
  matrix.className = "act-matrix";
  days.forEach((cell) => {
    const el = document.createElement("i");
    el.className = "act-cell" + (cell.future ? " future" : " l" + actLevel(cell.count));
    if (!cell.future) {
      el.title = cell.date + " · 刷新 " + cell.count + " 次";
      if (cell.date === todayStr) el.classList.add("today");
    }
    matrix.appendChild(el);
  });
  chart.appendChild(matrix);

  // 按可用空间计算正方形格子大小(整行模式),grid 强制每行 cols 列,最后一行完整
  requestAnimationFrame(() => {
    const cw = chart.clientWidth;
    const ch = chart.clientHeight;
    if (!cw || !ch) return;
    const { size, gap, cols, rows } = computeCellSize(cw, ch, days.length, true);
    const showN = cols * rows; // 完整行 × 列 = 整行占满的格子数
    matrix.style.display = "grid";
    matrix.style.gridTemplateColumns = "repeat(" + cols + ", " + size + "px)";
    matrix.style.gap = gap + "px";
    matrix.style.justifyContent = "center";
    matrix.style.alignContent = "center";
    // 移除最早的多余格子,保留尾部(含当天)的 showN 个——当天始终是最后一个格子
    while (matrix.children.length > showN) matrix.removeChild(matrix.firstChild);
    matrix.querySelectorAll(".act-cell").forEach((el) => {
      el.style.width = size + "px";
      el.style.height = size + "px";
      el.style.borderRadius = Math.max(2, Math.round(size * 0.28)) + "px";
    });
  });

  // 底部统计
  const stats = document.getElementById("act-stats");
  if (stats) {
    const streak = calcStreak(actData, now);
    const total = Object.values(actData).filter((n) => n > 0).length;
    stats.textContent = "🔥 连续活跃 " + streak + " 天 · 累计活跃 " + total + " 天";
  }
}

/** 从今天起往前连续活跃的天数 */
function calcStreak(data, now) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let streak = 0;
  while ((data[actFmtDate(d)] || 0) > 0) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

async function initActivity() {
  // 先记录本次访问(页面打开/刷新即 +1),保证当天格子在渲染时已有数据
  actData = await recordVisit();

  const chart = document.getElementById("act-chart");
  if (!chart) return;

  // 渲染延迟到网格模式(清爽模式卡片隐藏,不渲染节省开销)
  const render = () => renderActivity();
  if (window.__whenGrid) window.__whenGrid(render);
  else render();

  // 窗口尺寸变化时重算(卡片被 fillPage 拉伸后,flex 布局已自适应;此处仅兜底)
  window.addEventListener("resize", () => {
    if (chart.offsetParent) renderActivity();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initActivity);
} else {
  initActivity();
}

// 档位变化(1/4 半年 / 2/4 年)时重渲染活跃度图
window.onCardHeight && window.onCardHeight(function () {
  const c = document.querySelector(".activity-card");
  if (c && c.dataset.height) renderActivity();
});
