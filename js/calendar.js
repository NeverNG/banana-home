"use strict";

/* =========================================================
 * 日历组件:当月所有天数 + 农历日期(1900-2100)
 * 独立于 main.js,页面加载即初始化
 * ======================================================== */

/* 农历数据表:1900-2100 每年一条
 * bit16      :闰月是大月(30天)
 * bit15-bit4 :第 1-12 位对应 1-12 月大小(1=30天,0=29天)
 * 低 4 位    :闰月月份(0 表示无闰月) */
const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b5a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0,
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
  0x0d520,
];
const MIN_YEAR = 1900;

const CN_NUMS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const CN_MONTHS = ["", "正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "冬月", "腊月"];
const GAN = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const ZHI = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];

function lunarInfo(y) { return LUNAR_INFO[y - MIN_YEAR]; }
function leapMonth(y) { return lunarInfo(y) & 0xf; }
function leapDays(y) { return leapMonth(y) ? (lunarInfo(y) & 0x10000 ? 30 : 29) : 0; }
function monthDays(y, m) { return lunarInfo(y) & (0x10000 >> m) ? 30 : 29; }
function yearDays(y) {
  let sum = 0;
  for (let m = 1; m <= 12; m++) sum += monthDays(y, m);
  return sum + leapDays(y);
}

/** 公历(y 年 m 月 d 日)转农历 */
function solarToLunar(y, m, d) {
  const base = new Date(MIN_YEAR, 0, 31); // 1900-01-31 = 农历 1900 正月初一
  const target = new Date(y, m - 1, d);
  let offset = Math.round((target - base) / 86400000);
  let lY = MIN_YEAR;
  while (lY < 2100 && offset >= yearDays(lY)) { offset -= yearDays(lY); lY++; }
  let lM = 1, isLeap = false;
  const leap = leapMonth(lY);
  while (true) {
    const days = isLeap ? leapDays(lY) : monthDays(lY, lM);
    if (offset < days) break;
    offset -= days;
    if (isLeap) { isLeap = false; lM++; }
    else if (leap === lM) { isLeap = true; }
    else { lM++; }
  }
  return { year: lY, month: lM, day: offset + 1, isLeap };
}

function lunarDayText(d) {
  if (d === 1) return "初一";
  if (d === 10) return "初十";
  if (d === 20) return "二十";
  if (d === 30) return "三十";
  if (d < 10) return "初" + CN_NUMS[d];
  if (d < 20) return "十" + CN_NUMS[d - 10];
  return "廿" + CN_NUMS[d - 20];
}

function lunarMonthText(m, isLeap) {
  return (isLeap ? "闰" : "") + CN_MONTHS[m];
}

function lunarYearGz(y) {
  return GAN[(y - 4) % 10] + ZHI[(y - 4) % 12];
}

/* ============ 农历节日 ============ */
const LUNAR_FEST = {
  "1-1": "春节",
  "1-15": "元宵节",
  "2-2": "龙抬头",
  "5-5": "端午节",
  "7-7": "七夕节",
  "7-15": "中元节",
  "8-15": "中秋节",
  "9-9": "重阳节",
  "12-8": "腊八节",
};

/** 农历节日(含动态除夕:腊月最后一天) */
function lunarFest(lun) {
  if (lun.month === 12 && lun.day === monthDays(lun.year, 12)) return "除夕";
  return LUNAR_FEST[lun.month + "-" + lun.day] || null;
}

/* ============ 二十四节气(1900-2100 近似算法) ============ */
/* 24 节气偏移量(分钟):小寒~冬至,1900 年为基准 */
const TERM_INFO = [0, 21208, 42467, 63836, 85337, 107014, 128867, 150921, 173149, 195551, 218072, 240693, 263343, 285989, 308563, 331033, 353350, 375494, 397447, 419210, 440795, 462224, 483532, 504758];
const TERM_NAMES = ["小寒", "大寒", "立春", "雨水", "惊蛰", "春分", "清明", "谷雨", "立夏", "小满", "芒种", "夏至", "小暑", "大暑", "立秋", "处暑", "白露", "秋分", "寒露", "霜降", "立冬", "小雪", "大雪", "冬至"];

/** 第 n 个节气(0-23)落在 y 年的公历日 */
function solarTermDate(y, n) {
  const century = Math.floor(y / 100) + 1;
  const off = Date.UTC(1900, 0, 6, 2, 5) + ((y - 1900) * 365.2422 * 86400000 + TERM_INFO[n] * 60000) + ((century - 20) * 0.5 * 3600000);
  const d = new Date(off);
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** y 年 m 月 d 日是否为节气,返回名称或 null */
function solarTerm(y, m, d) {
  for (let n = 0; n < 24; n++) {
    if (Math.floor(n / 2) + 1 !== m) continue;
    const t = solarTermDate(y, n);
    if (t.month === m && t.day === d) return TERM_NAMES[n];
  }
  return null;
}

/* ============ 法定节假日(开源 Nager.Date API,年度缓存) ============ */
const HOLIDAY_CACHE_KEY = "holidaycn_";

// 注册节假日 API(动态年份)
try {
  window.__apiRegistry = window.__apiRegistry || [];
  const y = new Date().getFullYear();
  window.__apiRegistry.push({
    name: "节假日数据",
    desc: "日历法定节假日(holiday-cn)",
    url: "https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/" + y + ".json",
  });
} catch (e) { /* 忽略 */ }
let holidayMap = null; // { "YYYY-MM-DD": 名称 }
let holidayYear = 0;

async function fetchHolidays(year) {
  const key = HOLIDAY_CACHE_KEY + year;
  try {
    const cached = await chrome.storage.local.get(key);
    if (cached[key] && cached[key].year === year) {
      holidayMap = cached[key].map;
      holidayYear = year;
      return;
    }
  } catch (e) { /* 忽略 */ }

  // 开源数据 holiday-cn(国务院安排,含节假日与调休);多源并行,快者胜
  const sources = [
    "https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/" + year + ".json",
    "https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/" + year + ".json",
    "https://ghproxy.net/https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/" + year + ".json",
  ];
  const mkFetch = (url) =>
    new Promise((resolve, reject) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 7000);
      fetch(url, {
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      })
        .then((resp) => {
          clearTimeout(timer);
          if (!resp.ok) reject(new Error("bad status"));
          else resolve(resp.json());
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });

  let data = null;
  try {
    data = await Promise.any(sources.map(mkFetch));
  } catch (e) {
    return; // 全部失败:静默降级(仅农历节日+节气)
  }
  if (!data || !Array.isArray(data.days)) return;
  const map = {};
  for (const day of data.days) {
    if (day && day.date && day.name) {
      map[day.date] = { name: day.name, isOffDay: day.isOffDay !== false };
    }
  }
  holidayMap = map;
  holidayYear = year;
  try {
    await chrome.storage.local.set({ [key]: { year, map } });
  } catch (e) { /* 忽略 */ }
}

/** 查询法定节假日(含调休上班日),返回 { name, isOffDay } 或 null */
function holidayFor(y, m, d) {
  if (!holidayMap || holidayYear !== y) return null;
  const ds = y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  return holidayMap[ds] || null;
}

/* ============ 渲染 ============ */
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-based

function renderCalendar() {
  const title = document.getElementById("cal-title");
  const grid = document.getElementById("cal-grid");
  if (!title || !grid) return;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // 档位:1/4 = 本周视图, 2/4 = 整月视图
  const card = document.querySelector(".calendar-card");
  const height = card ? parseInt(card.dataset.height, 10) : 2;

  const first = new Date(calYear, calMonth, 1);
  const startWeek = first.getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const prevDays = new Date(calYear, calMonth, 0).getDate();

  grid.innerHTML = "";
  if (height === 1) {
    // 本周视图:周一~周日 7 格,突出今天
    title.textContent = calYear + "年 " + (calMonth + 1) + "月 · 本周";
    const dow = (today.getDay() + 6) % 7; // 周一=0
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - dow + i);
      const cell = buildCell(d.getFullYear(), d.getMonth(), d.getDate(), false, today);
      grid.appendChild(cell);
    }
    return;
  }

  // 整月视图:6 行固定(含前后月补位)
  title.textContent = calYear + "年 " + (calMonth + 1) + "月 · 农历" + lunarYearGz(calYear) + "年";
  const total = 42;
  for (let i = 0; i < total; i++) {
    let y = calYear, m = calMonth, day;
    let other = false;
    if (i < startWeek) { day = prevDays - startWeek + 1 + i; m--; other = true; }
    else if (i >= startWeek + daysInMonth) { day = i - startWeek - daysInMonth + 1; m++; other = true; }
    else { day = i - startWeek + 1; }

    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }

    const cell = buildCell(y, m, day, other, today);
    grid.appendChild(cell);
  }
}

/* 生成单个日历格(日期 + 农历/节日标签) */
function buildCell(y, m, day, other, today) {
  const cell = document.createElement("div");
  cell.className = "cal-cell" + (other ? " other" : "");

  const d = document.createElement("span");
  d.className = "cal-day";
  d.textContent = day;

  const lun = solarToLunar(y, m + 1, day);

  // 显示文本优先级:法定节假日 > 节气 > 农历节日 > 农历日期
  let label = null, labelClass = "";
  const hd = holidayFor(y, m + 1, day);
  const term = solarTerm(y, m + 1, day);
  const fest = lunarFest(lun);
  if (hd) {
    if (hd.isOffDay) {
      label = hd.name;
      labelClass = " festival";
      cell.title = "法定节假日:" + hd.name;
    } else {
      label = "班"; // 调休上班日
      labelClass = " workday";
      cell.title = hd.name + " 调休上班";
    }
  }
  else if (term) { label = term; labelClass = " term"; }
  else if (fest) { label = fest; labelClass = " festival"; }
  else {
    label = lun.day === 1 ? lunarMonthText(lun.month, lun.isLeap) : lunarDayText(lun.day);
  }

  const l = document.createElement("span");
  l.className = "cal-lunar" + labelClass;
  l.textContent = label;

  // 今天高亮
  if (!other && y === today.getFullYear() && m === today.getMonth() && day === today.getDate()) {
    cell.classList.add("today");
  }

  cell.append(d, l);
  return cell;
}

/* 档位变化(1/4 周 / 2/4 月)时重渲染 */
window.onCardHeight && window.onCardHeight(function () {
  const c = document.querySelector(".calendar-card");
  if (c && c.dataset.height) renderCalendar();
});

function initCalendar() {
  const prev = document.getElementById("cal-prev");
  const next = document.getElementById("cal-next");
  const goToday = document.getElementById("cal-today");

  // 加载当前年份节假日(异步,完成后重绘)
  const yr = new Date().getFullYear();
  fetchHolidays(yr).then(() => {
    if (calYear === yr) renderCalendar();
  });
  // 预取下一年
  fetchHolidays(yr + 1).catch(() => {});

  if (prev) prev.addEventListener("click", () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });
  if (next) next.addEventListener("click", () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    if (calYear !== holidayYear) {
      const ty = calYear;
      fetchHolidays(calYear).then(() => { if (calYear === ty) renderCalendar(); });
    }
    renderCalendar();
  });
  if (goToday) goToday.addEventListener("click", () => {
    const n = new Date();
    calYear = n.getFullYear();
    calMonth = n.getMonth();
    renderCalendar();
  });
  renderCalendar();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCalendar);
} else {
  initCalendar();
}
