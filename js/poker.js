"use strict";

/* =========================================================
 * 每日扑克牌:按日期种子确定性随机三张牌(52 张中不重复抽取)。
 * - 种子 = 本地日期(YYYY-MM-DD),同一日期结果恒定 → 当日刷新不变;
 *   跨过午夜日期变化 → 次日刷新自动更换。
 * - 纯本地计算,无网络请求、无存储读写;组件脚本由网格门控注入,
 *   清爽模式不加载(符合网格/清爽模式资源加载门控规范)。
 * - 支持 1/4、2/4 两档高度(fillPage 会设置 data-height,CSS 按档放大牌面)。
 * ======================================================== */

const POKER_SUITS = [
  ["♠", "dark"],
  ["♥", "red"],
  ["♦", "red"],
  ["♣", "dark"],
];
const POKER_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

/** FNV-1a 32 位哈希:把日期字符串转成稳定种子 */
function pokerHashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 伪随机数生成器(确定性:同种子同序列) */
function pokerRand(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 从 52 张牌中按种子确定性抽取 3 张不重复(部分 Fisher-Yates) */
function pokerDraw(seedStr) {
  const rand = pokerRand(pokerHashSeed(seedStr));
  const deck = Array.from({ length: 52 }, (_, i) => i);
  const picks = [];
  for (let i = 0; i < 3; i++) {
    const j = i + Math.floor(rand() * (52 - i));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
    picks.push(deck[i]);
  }
  return picks;
}

function pokerRender() {
  const hand = document.getElementById("poker-hand");
  if (!hand) return;
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const seed = y + "-" + m + "-" + d;

  hand.innerHTML = "";
  pokerDraw(seed).forEach((idx) => {
    const suit = POKER_SUITS[Math.floor(idx / 13)];
    const rank = POKER_RANKS[idx % 13];
    const face = document.createElement("div");
    face.className = "poker-face " + suit[1];
    face.title = suit[0] + " " + rank + " · 按日期随机,次日自动更换";
    face.innerHTML =
      '<span class="pf-corner pf-top"><i class="pf-rank">' + rank +
      "</i><i class=\"pf-suit\">" + suit[0] + "</i></span>" +
      '<span class="pf-center">' + suit[0] + "</span>" +
      '<span class="pf-corner pf-bottom"><i class="pf-rank">' + rank +
      "</i><i class=\"pf-suit\">" + suit[0] + "</i></span>";
    hand.appendChild(face);
  });

  const dateEl = document.getElementById("poker-date");
  if (dateEl) dateEl.textContent = now.getMonth() + 1 + "月" + now.getDate() + "日";
}

function initPoker() {
  // 卡片高度档位变化(1/4 ↔ 2/4)只影响 CSS 字号,无需重算牌面;
  // fillPage 已设置 data-height,属性选择器自动生效。
  pokerRender();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPoker);
} else {
  initPoker();
}
