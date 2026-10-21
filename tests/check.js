#!/usr/bin/env node
"use strict";

/* 香蕉起始页 · 开发期自检(无第三方依赖)
 * 用法:node tests/check.cjs
 *
 * 覆盖:
 *  1) 全部 JS 语法可解析(等价 node --check,但一次跑完)
 *  2) 清爽模式资源门控:index.html 只允许 3 个基础脚本,组件脚本不得静态引用
 *  3) MV3 CSP:index.html / map.html 不允许内联 <script>
 *  4) GRID_SCRIPTS 列表与磁盘文件一致
 *  5) CSS 花括号平衡
 *  6) gridgate.js 的共享常量/可见性助手行为(vm 沙箱)
 *
 * 说明:真正"清爽模式零组件脚本"的运行时验证仍需真实浏览器 CDP;
 * 这里是提交前的快速回归网,能拦住绝大多数门控误改。 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const BASE_SCRIPTS = ["js/gridgate.js", "js/activity.js", "js/main.js"];
let failures = 0;
let checks = 0;

function ok(msg) {
  checks++;
  console.log("  \u2713 " + msg);
}
function fail(msg) {
  failures++;
  checks++;
  console.error("  \u2717 " + msg);
}
function assert(cond, msg) {
  if (cond) ok(msg);
  else fail(msg);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function listJs() {
  const out = ["background.js"];
  for (const f of fs.readdirSync(path.join(ROOT, "js"))) {
    if (f.endsWith(".js")) out.push("js/" + f);
  }
  return out;
}

/* ---------- 1. 语法 ---------- */
console.log("\n[1] JS 语法");
for (const rel of listJs()) {
  try {
    new vm.Script(read(rel), { filename: rel });
    ok(rel);
  } catch (e) {
    fail(rel + " -> " + e.message);
  }
}

/* ---------- 2/3. 门控 + CSP ---------- */
console.log("\n[2] 清爽模式资源门控 / MV3 CSP");
const indexHtml = read("index.html");
const mapHtml = read("map.html");

const scriptSrcs = [];
const srcRe = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
let m;
while ((m = srcRe.exec(indexHtml))) scriptSrcs.push(m[1]);
assert(
  JSON.stringify(scriptSrcs) === JSON.stringify(BASE_SCRIPTS),
  "index.html 只加载基础脚本: " + scriptSrcs.join(", ")
);

const inlineRe = /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script>/gi;
assert(!inlineRe.test(indexHtml), "index.html 无内联 <script>(MV3 CSP)");
assert(!inlineRe.test(mapHtml), "map.html 无内联 <script>(MV3 CSP)");

const mapSrcs = [];
while ((m = srcRe.exec(mapHtml))) mapSrcs.push(m[1]);
assert(mapSrcs.length === 1 && mapSrcs[0] === "js/map.js", "map.html 只加载 js/map.js");

/* GRID_SCRIPTS 与文件存在性 */
const mainSrc = read("js/main.js");
const gridMatch = /const GRID_SCRIPTS\s*=\s*\[([^\]]+)\]/.exec(mainSrc);
assert(!!gridMatch, "main.js 中找到 GRID_SCRIPTS 数组");
let gridNames = [];
if (gridMatch) {
  gridNames = gridMatch[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  assert(gridNames.length >= 10, "GRID_SCRIPTS 组件数 = " + gridNames.length);
  for (const name of gridNames) {
    const rel = "js/" + name + ".js";
    const exists = fs.existsSync(path.join(ROOT, rel));
    assert(exists, "组件脚本存在: " + rel);
    assert(indexHtml.indexOf(rel) < 0, "组件脚本未静态引用: " + rel);
  }
}

/* ---------- 4. CSS ---------- */
console.log("\n[3] CSS 结构 / 动画");
const css = read("css/style.css");
const open = (css.match(/{/g) || []).length;
const close = (css.match(/}/g) || []).length;
assert(open === close, "style.css 花括号平衡 (" + open + "/" + close + ")");
assert(css.indexOf("windmillSpin") > 0, "风车动画已改为 CSS keyframes");
assert(css.indexOf("bgPan") > 0, "背景渐变动画已改为 transform 合成动画");
assert(css.indexOf("bgShift") < 0, "旧的 background-position 动画已移除");
assert(/\.bg\.has-color::before/.test(css), "纯色/壁纸会关闭渐变层");

/* ---------- 4.5 事件委托(书签 / 导航) ---------- */
console.log("\n[3.5] 事件委托");
assert(/function initBookmarkDelegates\(\)/.test(mainSrc), "书签卡事件委托已定义");
assert(/function initNavDelegates\(\)/.test(mainSrc), "导航事件委托已定义");
assert(mainSrc.indexOf("bindHover(card, item)") < 0, "书签卡不再逐个挂 hover 监听");
assert(/initBookmarkDelegates\(\);/.test(mainSrc), "init 中调用了书签委托");
assert(/initNavDelegates\(\);/.test(mainSrc), "init 中调用了导航委托");

/* ---------- 5. gridgate 共享常量(vm) ---------- */
console.log("\n[4] gridgate 共享常量 / 可见性助手");
function runGridgate() {
  const classes = new Set();
  const documentStub = {
    hidden: false,
    body: {
      classList: {
        contains: (c) => classes.has(c),
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        toggle: (c, on) => {
          if (on === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); return classes.has(c); }
          if (on) classes.add(c); else classes.delete(c);
          return !!on;
        },
      },
    },
  };
  const chromeStub = {
    storage: { local: { get: () => Promise.resolve({ homeMode: "grid" }) } },
  };
  const sandbox = {
    window: {},
    document: documentStub,
    chrome: chromeStub,
    console,
    Promise,
    setTimeout,
    clearTimeout,
    Object,
    Array,
    Math,
    JSON,
    String,
    Number,
    Date,
    Map,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("js/gridgate.js"), sandbox, { filename: "js/gridgate.js" });
  return { win: sandbox.window, doc: documentStub, classes };
}

try {
  const { win, doc, classes } = runGridgate();
  assert(Array.isArray(win.CARD_META) && win.CARD_META.length === 14, "CARD_META 有 14 张卡片");
  assert(win.DEFAULT_CARD_HEIGHTS["geo-map-card"] === 2, "地图默认档位 = 2/4(与设置面板一致)");
  assert(win.DEFAULT_CARD_HEIGHTS["dreamcar-card"] === 2, "梦想之车默认档位 = 2/4");
  assert(win.SUPPORTED_CARD_HEIGHTS["clock-card"].join(",") === "1", "时钟仅支持 1/4");
  assert(typeof win.isCardVisible === "function", "isCardVisible 已暴露");

  const activePage = { classList: { contains: (c) => c === "active" } };
  const el = { style: { display: "" }, closest: () => activePage };
  assert(win.isCardVisible(el) === true, "可见卡片 → true");
  doc.hidden = true;
  assert(win.isCardVisible(el) === false, "标签页后台 → false");
  doc.hidden = false;
  classes.add("mode-clean");
  assert(win.isCardVisible(el) === false, "清爽模式 → false");
  classes.delete("mode-clean");
  el.style.display = "none";
  assert(win.isCardVisible(el) === false, "眼睛按钮隐藏 → false");
  el.style.display = "";
  const inactive = { classList: { contains: () => false } };
  el.closest = () => inactive;
  assert(win.isCardVisible(el) === false, "非当前组件页 → false");
} catch (e) {
  fail("gridgate vm 测试异常: " + e.message);
}

/* ---------- 5. main.js 书签卡增量更新(vm) ---------- */
console.log("\n[5] 书签卡增量更新 applyCardContent / patchBookmarkCards");
function makeEl(tag) {
  const cls = new Set();
  const el = {
    tagName: tag,
    style: {},
    dataset: {},
    textContent: "",
    title: "",
    classList: {
      add: (...cs) => cs.forEach((c) => cls.add(c)),
      remove: (...cs) => cs.forEach((c) => cls.delete(c)),
      contains: (c) => cls.has(c),
      toggle: (c, on) => {
        if (on === undefined) { cls.has(c) ? cls.delete(c) : cls.add(c); return cls.has(c); }
        if (on) cls.add(c); else cls.delete(c);
        return !!on;
      },
    },
    hasClass: (c) => cls.has(c),
    appendChild() {},
    append() {},
    removeAttribute(k) { if (k === "title") this.title = ""; },
  };
  return el;
}

function runMain() {
  const bodyClasses = new Set();
  const documentStub = {
    hidden: false,
    readyState: "loading",
    body: {
      classList: {
        contains: (c) => bodyClasses.has(c),
        add: (c) => bodyClasses.add(c),
        remove: (c) => bodyClasses.delete(c),
        toggle: (c, on) => { if (on) bodyClasses.add(c); else bodyClasses.delete(c); },
      },
    },
    head: { appendChild() {} },
    documentElement: { style: { setProperty() {} } },
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) { return makeEl(tag); },
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, debug() {} },
    document: documentStub,
    chrome: { runtime: { id: "test" }, storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } } },
    navigator: {},
    location: { href: "" },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (fn) => setTimeout(() => fn(0), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    performance: { now: () => Date.now() },
    addEventListener() {},
    removeEventListener() {},
    URL,
    URLSearchParams,
    TextDecoder,
    AbortController: class { abort() {} },
    fetch: () => Promise.reject(new Error("no network")),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("js/main.js"), sandbox, { filename: "js/main.js" });
  return sandbox;
}

try {
  const ctx = runMain();
  const titleEl = makeEl("div");
  const descEl = makeEl("div");
  const card = makeEl("a");
  card.querySelector = (sel) => (sel === ".bm-title" ? titleEl : sel === ".bm-desc" ? descEl : null);

  vm.runInContext('state.titles["https://a"] = "AI 标题"; state.descriptions["https://a"] = "一句话简介";', ctx);
  ctx.applyCardContent(card, { url: "https://a", title: "原标题" });
  assert(titleEl.textContent === "AI 标题", "标题取 AI 标题");
  assert(titleEl.title.indexOf("原标题") >= 0, "标题 tooltip 保留原书签标题");
  assert(descEl.textContent === "一句话简介", "描述取缓存值");

  vm.runInContext('delete state.descriptions["https://a"]; state.failed["https://a"] = true;', ctx);
  ctx.applyCardContent(card, { url: "https://a", title: "原标题" });
  assert(descEl.hasClass("desc-failed"), "失败态加 desc-failed");
  assert(descEl.textContent.indexOf("无法生成") >= 0, "失败态文案");

  vm.runInContext('delete state.failed["https://a"];', ctx);
  ctx.applyCardContent(card, { url: "https://a", title: "原标题" });
  assert(descEl.hasClass("desc-empty") && !descEl.hasClass("desc-failed"), "未生成态回落到 desc-empty");
} catch (e) {
  fail("main.js 增量更新测试异常: " + e.message);
}

/* patchBookmarkCards 需要把卡片塞进索引:用同一 context 再跑一段脚本 */
try {
  const ctx2 = runMain();
  const titleEl = makeEl("div");
  const descEl = makeEl("div");
  const card = makeEl("a");
  card.querySelector = (sel) => (sel === ".bm-title" ? titleEl : sel === ".bm-desc" ? descEl : null);
  ctx2.__testCard = card;
  vm.runInContext("cardIndex.set('https://b', __testCard); bookmarkByUrl.set('https://b', { url: 'https://b', title: 'B' }); state.titles['https://b'] = 'B AI';", ctx2);
  const hit = ctx2.patchBookmarkCards(["https://b"]);
  assert(hit === true && titleEl.textContent === "B AI", "known URL → 原地 patch 并返回 true");
  const miss = ctx2.patchBookmarkCards(["https://nope"]);
  assert(miss === false, "未知 URL → 返回 false(调用方回退全量渲染)");
} catch (e) {
  fail("patchBookmarkCards 测试异常: " + e.message);
}

/* ---------- 6. colpager 档位回调节流(vm) ---------- */
console.log("\n[6] fillPage 只在档位变化时通知内容回调");
function runColpager() {
  let cbCalls = 0;
  const clock = makeEl("div");
  clock.id = "clock-card";
  clock.style.display = "";
  const cal = makeEl("div");
  cal.id = "calendar-card";
  cal.style.display = "";
  cal.dataset = {};
  const page = { children: [clock, cal] };
  const pagesEl = { clientHeight: 600, children: [page] };
  const documentStub = {
    readyState: "loading",
    body: { classList: { contains: () => false } },
    addEventListener() {},
    getElementById(id) { return id === "col-pages" ? pagesEl : null; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
  };
  const sandbox = {
    console,
    document: documentStub,
    chrome: { storage: { local: { get: () => Promise.resolve({}) } } },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    __cardHeightCbs: [() => { cbCalls++; }],
    DEFAULT_CARD_HEIGHTS: { "clock-card": 1, "calendar-card": 2 },
    SUPPORTED_CARD_HEIGHTS: { "clock-card": [1], "calendar-card": [1, 2] },
    cardHeights: {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("js/colpager.js"), sandbox, { filename: "js/colpager.js" });
  vm.runInContext("colPager.pages = [document.getElementById('col-pages').children[0]]; colPager.idx = 0;", sandbox);
  return { ctx: sandbox, clock, cal, page, calls: () => cbCalls };
}

try {
  const t = runColpager();
  t.ctx.fillPage();
  assert(t.calls() === 1, "首次填充触发一次内容回调");
  assert(t.clock.style.height === "136px", "时钟 1/4 高度 = floor(546/4)=136px,实际 " + t.clock.style.height);
  assert(t.cal.style.height === "273px", "日历 2/4 高度 = 273px,实际 " + t.cal.style.height);
  t.ctx.fillPage();
  assert(t.calls() === 1, "同尺寸再次填充不重复触发回调");
  t.ctx.cardHeights["calendar-card"] = 1;
  t.ctx.fillPage();
  assert(t.calls() === 2, "档位变化触发回调");
  assert(t.cal.style.height === "136px", "档位改为 1/4 后高度 136px,实际 " + t.cal.style.height);
} catch (e) {
  fail("colpager fillPage 测试异常: " + e.message);
}

/* ---------- 7. 事件委托路由(vm + 极简 DOM) ---------- */
console.log("\n[7] 事件委托路由(书签卡 / 导航)");
function makeDomEl(tag, cls) {
  const classes = new Set((cls || "").split(" ").filter(Boolean));
  const el = {
    tagName: tag.toUpperCase(),
    className: cls || "",
    dataset: {},
    style: { setProperty() {} },
    children: [],
    parent: null,
    _ls: [],
    innerHTML: "",
    classList: {
      contains: (c) => classes.has(c),
      add: (...cs) => cs.forEach((c) => classes.add(c)),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); },
    },
    addEventListener(type, fn, capture) { el._ls.push({ type, fn, capture: !!capture }); },
    appendChild(c) { c.parent = el; el.children.push(c); return c; },
    closest(sel) {
      const want = String(sel).replace(/^\./, "");
      let n = el;
      while (n) {
        if (n.className && n.className.split(" ").indexOf(want) >= 0) return n;
        n = n.parent;
      }
      return null;
    },
    contains(n) { while (n) { if (n === el) return true; n = n.parent; } return false; },
    querySelectorAll() { return []; },
  };
  return el;
}

function fire(el, type, ev) {
  const e = Object.assign({
    type,
    target: el,
    defaultPrevented: false,
    preventDefault() { e.defaultPrevented = true; },
    stopPropagation() { /* noop */ },
  }, ev);
  for (const l of el._ls) if (l.type === type) l.fn(e);
  return e;
}

function runMainDom() {
  const els = {};
  const timers = new Map();
  let tid = 0;
  const documentStub = {
    hidden: false,
    readyState: "loading",
    body: { classList: { contains: () => false, add() {}, remove() {}, toggle() {} } },
    head: { appendChild() {} },
    documentElement: { style: { setProperty() {} } },
    addEventListener() {},
    getElementById(id) { return els[id] || null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) { return makeDomEl(tag); },
  };
  const sandbox = {
    console,
    document: documentStub,
    chrome: { runtime: { id: "test" }, storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } } },
    navigator: {},
    location: { href: "" },
    setTimeout: (fn, ms) => { const id = ++tid; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    performance: { now: () => Date.now() },
    addEventListener() {},
    removeEventListener() {},
    URL,
    URLSearchParams,
    TextDecoder,
    AbortController: class { abort() {} },
    fetch: () => Promise.reject(new Error("no network")),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("js/main.js"), sandbox, { filename: "js/main.js" });
  return { sandbox, els, timers };
}

try {
  const { sandbox, els, timers } = runMainDom();
  const groups = makeDomEl("div", "bm-groups");
  els["bm-groups"] = groups;
  vm.runInContext(
    "bookmarkByUrl.set('https://a', { url: 'https://a', title: 'A' }); state.showThumbPreviewBM = true;",
    sandbox
  );
  const calls = [];
  sandbox.openMaintainDialog = (item) => calls.push(item.url);
  sandbox.showThumb = (card, item) => calls.push("thumb:" + item.url);
  sandbox.initBookmarkDelegates();

  const card = makeDomEl("a", "bm-card");
  card.dataset.url = "https://a";
  const iconWrap = makeDomEl("span", "bm-icon");
  const img = makeDomEl("img");
  iconWrap.appendChild(img);
  card.appendChild(iconWrap);
  const desc = makeDomEl("div", "bm-desc");
  const more = makeDomEl("button", "bm-more");
  card.appendChild(desc);
  card.appendChild(more);
  groups.appendChild(card);

  fire(groups, "mouseover", { target: img, clientX: 5, clientY: 5 });
  const hover = [...timers.values()][0];
  assert(!!hover && hover.ms === 300, "mouseover 只挂一个 300ms 预览定时器");
  if (hover) hover.fn();
  assert(calls.indexOf("thumb:https://a") >= 0, "定时器到点后展示悬浮预览");

  fire(groups, "mouseout", { target: img, relatedTarget: null });
  const hide = [...timers.values()].find((x) => x.ms === 200);
  assert(!!hide, "mouseout 挂 200ms 隐藏定时器");

  const cMore = fire(groups, "click", { target: more });
  assert(calls.indexOf("https://a") >= 0, "点击 ⋯ 打开维护弹窗");
  assert(cMore.defaultPrevented, "⋯ 点击阻止默认跳转");

  calls.length = 0;
  const cDesc = fire(groups, "click", { target: desc });
  assert(calls.length === 0 && !cDesc.defaultPrevented, "普通描述点击不拦截(正常打开链接)");

  vm.runInContext("state.failed['https://a'] = true;", sandbox);
  const cDesc2 = fire(groups, "click", { target: desc });
  assert(calls.indexOf("https://a") >= 0 && cDesc2.defaultPrevented, "失败态描述点击打开维护弹窗");

  // 图标错误回退(load/error 不冒泡,走容器捕获阶段)
  fire(groups, "error", { target: img });
  assert(
    img.dataset.fallback === "1" && String(img.src).indexOf("data:image/svg") === 0,
    "图标加载失败回退地球图标"
  );
  const firstSrc = img.src;
  fire(groups, "error", { target: img });
  assert(img.src === firstSrc, "二次 error 不重复回退(避免死循环)");

  // 导航:箭头只折叠、名称点击选中、悬浮/移出 tooltip
  const nav = makeDomEl("div", "bm-nav");
  els["bm-nav"] = nav;
  const routed = [];
  sandbox.activateNavNode = (row) => routed.push("activate:" + row.dataset.path);
  sandbox.toggleNavNode = (row) => routed.push("toggle:" + row.dataset.path);
  sandbox.showNavTooltip = (e, path) => routed.push("tip:" + path);
  sandbox.hideNavTooltip = () => routed.push("hide");
  sandbox.initNavDelegates();

  const row = makeDomEl("div", "bm-nav-node");
  row.dataset.path = "书签栏 / A";
  row.dataset.level = "1";
  const arrow = makeDomEl("span", "bm-nav-arrow");
  const name = makeDomEl("span", "bm-nav-name");
  row.appendChild(arrow);
  row.appendChild(name);
  nav.appendChild(row);

  fire(nav, "click", { target: arrow });
  assert(routed.pop() === "toggle:书签栏 / A", "箭头点击只折叠,不触发选中");
  fire(nav, "click", { target: name });
  assert(routed.pop() === "activate:书签栏 / A", "名称点击选中并定位分组");
  fire(nav, "mouseover", { target: name, clientX: 1, clientY: 1 });
  assert(routed.pop() === "tip:书签栏 / A", "悬浮名称显示完整路径");
  fire(nav, "mouseout", { target: name, relatedTarget: null });
  assert(routed.pop() === "hide", "移出名称隐藏路径提示");
} catch (e) {
  fail("事件委托路由测试异常: " + e.message);
}

/* ---------- 汇总 ---------- */
console.log("\n" + (failures === 0 ? "全部通过" : failures + " 项失败") + " (" + checks + " 项检查)");
process.exit(failures === 0 ? 0 : 1);
