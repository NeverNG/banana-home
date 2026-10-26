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

/* ---------- 8. 快捷方式图标自动获取(logo + 缓存 + 自动更新) ---------- */
console.log("\n[8] 快捷方式图标:logo 解析 / 缓存 / 更新");

/** 载入 background.js(chrome 全部 stub,可注入 fetch 与 local storage) */
function runBackground(opts) {
  const o = opts || {};
  const localStore = o.storageLocal || {};
  const sandbox = {
    console,
    chrome: {
      bookmarks: {
        onCreated: { addListener() {} },
        onRemoved: { addListener() {} },
        onChanged: { addListener() {} },
        onMoved: { addListener() {} },
        onChildrenReordered: { addListener() {} },
      },
      runtime: { onMessage: { addListener() {} } },
      storage: {
        local: {
          get(keys) {
            if (keys == null) return Promise.resolve(Object.assign({}, localStore));
            const arr = typeof keys === "string" ? [keys] : keys;
            const out = {};
            arr.forEach((k) => { if (k in localStore) out[k] = localStore[k]; });
            return Promise.resolve(out);
          },
          set(obj) {
            Object.assign(localStore, obj);
            return Promise.resolve();
          },
          remove(keys) {
            (typeof keys === "string" ? [keys] : keys).forEach((k) => delete localStore[k]);
            return Promise.resolve();
          },
        },
        session: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
      },
    },
    fetch: o.fetchImpl || (() => Promise.reject(new Error("no network"))),
    AbortController: class { abort() {} },
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    TextDecoder,
    TextEncoder,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    Uint8Array,
    Blob: class { constructor(parts) { this.parts = parts; } },
    createImageBitmap: o.createImageBitmap,
    OffscreenCanvas: o.OffscreenCanvas,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("background.js"), sandbox, { filename: "background.js" });
  return { sandbox, store: localStore };
}

/** 构造一个最小 Response(stub) */
function makeResp(status, contentType, body, extra) {
  const e = extra || {};
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(key) {
        const k = String(key).toLowerCase();
        if (k === "content-type") return contentType || "";
        if (k === "etag") return e.etag || "";
        if (k === "last-modified") return e.lastModified || "";
        if (k === "content-length") {
          if (!body) return "0";
          return String(body.byteLength || Buffer.byteLength(String(body)));
        }
        return "";
      },
    },
    text: async () => String(body || ""),
    arrayBuffer: async () => body || new ArrayBuffer(0),
  };
}

try {
  const { sandbox } = runBackground({});
  const html =
    '<html><head>' +
    '<link rel="icon" href="/favicon-32.png" sizes="32x32">' +
    '<link rel="apple-touch-icon" href="/touch.png">' +
    '<link rel="icon" href="/big.png" sizes="192x192">' +
    '<link rel="icon" type="image/svg+xml" href="/icon.svg">' +
    '<link rel="mask-icon" href="/mask.svg">' +
    '<link rel="fluid-icon" href="/fluid.png">' +
    '<meta property="og:image" content="/og.jpg">' +
    '<script type="application/ld+json">{"logo":"/jsonlogo.png"}</script>' +
    "</head></html>";
  const cands = sandbox.pickIconCandidates(html, "https://site.test/");
  assert(cands[0] === "https://site.test/icon.svg", "SVG favicon 最优先(任意尺寸都清晰)");
  assert(cands[1] === "https://site.test/big.png", "其次是大尺寸 favicon(192x192)");
  assert(cands.indexOf("https://site.test/favicon-32.png") >= 0, "普通 32px favicon 也入选");
  assert(cands.indexOf("https://site.test/touch.png") < 0, "apple-touch-icon(应用图标)不当标签页图标");
  assert(cands.indexOf("https://site.test/mask.svg") < 0, "mask-icon(单色蒙版)不入选");
  assert(cands.indexOf("https://site.test/fluid.png") < 0, "fluid-icon(应用图标)不入选");
  assert(cands.indexOf("https://site.test/og.jpg") < 0, "og:image(分享图)不入选");
  assert(cands.indexOf("https://site.test/jsonlogo.png") < 0, "JSON-LD logo 不入选");
  assert(cands.length === 4, "候选最多 4 个,控制最坏耗时");
  assert(cands[cands.length - 1] === "https://site.test/favicon.ico", "/favicon.ico 永远是最后的兜底");

  const onlyOg = sandbox.pickIconCandidates('<meta property="og:image" content="/og.jpg">', "https://x.test/");
  assert(
    onlyOg.length === 1 && onlyOg[0] === "https://x.test/favicon.ico",
    "没有声明 favicon 时只用 /favicon.ico"
  );

  const empty = sandbox.pickIconCandidates("", "https://y.test/");
  assert(empty.length === 1 && empty[0] === "https://y.test/favicon.ico", "无页面信息时用 /favicon.ico");
} catch (e) {
  fail("background pickIconCandidates 测试异常: " + e.message);
}

/* 首次抓取 → 缓存 → 过期条件校验 → 图标变化自动更新 */
(async () => {
  try {
    const state = {
      html: '<html><head><link rel="icon" href="/favicon-64.png" sizes="64x64"></head></html>',
      logoVersion: 1,
    };
    const requests = [];
    const png = (n) => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, n]).buffer;
    const fetchImpl = async (url, init) => {
      requests.push({ url, headers: (init && init.headers) || {} });
      if (url === "https://site.test/page" || url === "https://site.test/other") {
        return makeResp(200, "text/html; charset=utf-8", state.html);
      }
      if (url === "https://site.test/favicon-64.png") {
        const etag = '"v' + state.logoVersion + '"';
        if (init && init.headers && init.headers["If-None-Match"] === etag) {
          return makeResp(304, "", null, { etag });
        }
        return makeResp(200, "image/png", png(state.logoVersion), { etag });
      }
      return makeResp(404, "text/plain", "not found");
    };

    const env = runBackground({ fetchImpl });
    const first = await env.sandbox.getSiteIcon("https://site.test/page");
    const expected1 = "data:image/png;base64," + Buffer.from(new Uint8Array(png(1))).toString("base64");
    assert(first === expected1, "首次进入:自动抓取标签页 favicon 并返回 data URL");
    assert(
      requests.some((r) => r.url === "https://site.test/favicon-64.png"),
      "按页面声明的 <link rel=icon> 抓取"
    );
    assert(
      requests.every((r) => r.url !== "https://site.test/favicon.ico"),
      "声明的 favicon 命中后不再请求根目录 /favicon.ico"
    );
    assert(!!env.store["siteIcon:https://site.test"], "图标写入 chrome.storage.local 缓存");

    const countAfterFirst = requests.length;
    const again = await env.sandbox.getSiteIcon("https://site.test/other");
    assert(again === first, "12h 内再次进入:同 origin 命中缓存");
    assert(requests.length === countAfterFirst, "缓存命中不发任何网络请求");

    // 过期 + 服务器 304:只刷新时间戳,不重新下载
    env.store["siteIcon:https://site.test"].t -= 13 * 3600 * 1000;
    const revalidated = await env.sandbox.getSiteIcon("https://site.test/page");
    const conditional = requests[requests.length - 1];
    assert(revalidated === first, "图标没变:继续使用缓存");
    assert(conditional.url === "https://site.test/favicon-64.png", "过期后对原图标地址做条件请求");
    assert(conditional.headers["If-None-Match"] === '"v1"', "条件请求带 If-None-Match");
    assert(
      Date.now() - env.store["siteIcon:https://site.test"].t < 5000,
      "304 后刷新缓存时间戳,下一次 12h 内不再请求"
    );

    // 图标变化:服务器 200 + 新内容 → 自动更新
    env.store["siteIcon:https://site.test"].t -= 13 * 3600 * 1000;
    state.logoVersion = 2;
    const updated = await env.sandbox.getSiteIcon("https://site.test/page");
    const expected2 = "data:image/png;base64," + Buffer.from(new Uint8Array(png(2))).toString("base64");
    assert(updated === expected2, "站点图标变化后返回新图标");
    assert(env.store["siteIcon:https://site.test"].dataUrl === expected2, "缓存同步更新为新图标");

    // 7 天后再进入:重新解析页面(图标可能换了路径,只靠旧地址的 ETag 发现不了)
    env.store["siteIcon:https://site.test"].t -= 13 * 3600 * 1000;
    env.store["siteIcon:https://site.test"].resolvedAt -= 8 * 24 * 3600 * 1000;
    const beforeRescan = requests.length;
    const rescanned = await env.sandbox.getSiteIcon("https://site.test/page");
    assert(rescanned === expected2, "7 天重扫后仍返回可用图标");
    assert(
      requests.slice(beforeRescan).some((r) => r.url === "https://site.test/page"),
      "7 天后重新抓页面解析(图标换路径也能跟上)"
    );

    // 页面抓不到时用根目录 /favicon.ico 兜底
    const env2 = runBackground({
      fetchImpl: async (url) => {
        if (url === "https://bare.test/favicon.ico") {
          return makeResp(200, "image/x-icon", new Uint8Array([1, 2, 3]).buffer);
        }
        return makeResp(500, "text/plain", "boom");
      },
    });
    const bare = await env2.sandbox.getSiteIcon("https://bare.test/page");
    assert(typeof bare === "string" && bare.indexOf("data:image/x-icon") === 0, "页面不可抓时回退 /favicon.ico");

    // 旧版缓存(logo 样式、无版本号)自动失效并重取 favicon
    const staleStore = {
      "siteIcon:https://old.test": {
        t: Date.now(),
        dataUrl: "data:image/png;base64,T0xETE9HTw==", // 旧 logo
        src: "https://old.test/logo.png",
      },
    };
    const envOld = runBackground({
      storageLocal: staleStore,
      fetchImpl: async (url) => {
        if (url === "https://old.test/page") {
          return makeResp(200, "text/html", '<link rel="icon" href="/favicon-32.png" sizes="32x32">');
        }
        if (url === "https://old.test/favicon-32.png") {
          return makeResp(200, "image/png", new Uint8Array([7, 7, 7]).buffer, { etag: '"o"' });
        }
        return makeResp(404, "text/plain", "");
      },
    });
    const fresh = await envOld.sandbox.getSiteIcon("https://old.test/page");
    assert(fresh !== "data:image/png;base64,T0xETE9HTw==", "旧版 logo 缓存自动失效,重新取 favicon");
    assert(envOld.store["siteIcon:https://old.test"].v === 3, "新缓存写入版本号");

    // 大尺寸 ICO(如 DeepSeek 的 205KB favicon.ico)→ 缩成 ≤64px PNG 再缓存/传输
    const bigBytes = new Uint8Array(205 * 1024);
    bigBytes.set([0, 0, 1, 0], 0);
    const tinyPng = new Uint8Array([137, 80, 78, 71, 9]);
    const envBig = runBackground({
      createImageBitmap: async () => ({ width: 225, height: 225, close() {} }),
      OffscreenCanvas: class {
        constructor(w, h) { this.width = w; this.height = h; }
        getContext() { return { drawImage() {} }; }
        async convertToBlob() { return { arrayBuffer: async () => tinyPng.buffer }; }
      },
      fetchImpl: async (url) => {
        if (url === "https://big.test/") {
          return makeResp(200, "text/html", '<link rel="icon" href="/favicon.ico" type="image/x-icon">');
        }
        if (url === "https://big.test/favicon.ico") {
          return makeResp(200, "image/vnd.microsoft.icon", bigBytes.buffer, { etag: '"big"' });
        }
        return makeResp(404, "text/plain", "");
      },
    });
    const bigIcon = await envBig.sandbox.getSiteIcon("https://big.test/");
    const expectedPng = "data:image/png;base64," + Buffer.from(tinyPng).toString("base64");
    assert(bigIcon === expectedPng, "205KB 的 ICO 被缩成 64px PNG(不再因超限直接失败)");
    assert(
      envBig.store["siteIcon:https://big.test"].dataUrl === expectedPng,
      "缓存的是缩略后的 PNG,而不是 205KB 原图"
    );
  } catch (e) {
    fail("background getSiteIcon 缓存/更新测试异常: " + e.message);
  }

  /* 页面侧:只负责请求后台 + emoji/首字母兜底 */
  function runMainIcons(opts) {
    const o = opts || {};
    const messages = [];
    const documentStub = {
      hidden: false,
      readyState: "loading",
      body: { classList: { contains: () => false, add() {}, remove() {}, toggle() {} } },
      head: { appendChild() {} },
      documentElement: { style: { setProperty() {} } },
      addEventListener() {},
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      createElement(tag) { return makeDomEl(tag); },
    };
    const sandbox = {
      console,
      document: documentStub,
      chrome: {
        runtime: {
          id: "test",
          lastError: null,
          getURL: (p) => "chrome-extension://test" + p,
          sendMessage(msg, cb) {
            messages.push(msg);
            if (o.throwOnMessage) throw new Error("no service worker");
            if (cb) cb(o.siteIcon || { status: "empty", dataUrl: "" });
          },
        },
        storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
      },
      navigator: {},
      location: { href: "" },
      setTimeout,
      clearTimeout,
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
    return { sandbox, messages };
  }

  try {
    const iconData = "data:image/png;base64,AAA";
    const r1 = runMainIcons({ siteIcon: { status: "ok", dataUrl: iconData } });
    const got = await r1.sandbox.resolveQuickIcon({ url: "https://b.test/", icon: "", name: "B" });
    assert(got.kind === "url" && got.value === iconData, "页面直接使用后台返回的 favicon");
    assert(r1.messages.length === 1 && r1.messages[0].type === "getSiteIcon", "向后台请求 getSiteIcon");

    const r2 = runMainIcons({ siteIcon: { status: "empty", dataUrl: "" } });
    const emoji = await r2.sandbox.resolveQuickIcon({ url: "https://c.test/", icon: "📺", name: "C" });
    assert(emoji.kind === "emoji" && emoji.value === "📺", "取不到 favicon 时回退用户设置的 emoji");

    const r3 = runMainIcons({ siteIcon: { status: "empty", dataUrl: "" } });
    const letter = await r3.sandbox.resolveQuickIcon({ url: "https://d.test/", icon: "", name: "Baidu" });
    assert(letter.kind === "letter" && letter.value === "B", "既无 favicon 也无 emoji 时回退首字母");

    const before = r3.messages.length;
    const cached = await r3.sandbox.resolveQuickIcon({ url: "https://d.test/", icon: "", name: "Baidu" });
    assert(cached === letter && r3.messages.length === before, "同一 URL 命中页面缓存,不重复请求");

    const r4 = runMainIcons({ throwOnMessage: true });
    const fallback = await r4.sandbox.resolveQuickIcon({ url: "https://e.test/", icon: "", name: "Example" });
    assert(fallback.kind === "letter" && fallback.value === "E", "后台异常时回退首字母");

    const r5 = runMainIcons({ siteIcon: { status: "ok", dataUrl: iconData } });
    const httpIcon = await r5.sandbox.resolveQuickIcon({ url: "http://plain.test/", icon: "", name: "P" });
    assert(httpIcon.kind === "url" && httpIcon.value === iconData, "http 站点也由后台代取图标");
  } catch (e) {
    fail("页面侧 resolveQuickIcon 测试异常: " + e.message);
  }

  /* ---------- 汇总 ---------- */
  console.log("\n" + (failures === 0 ? "全部通过" : failures + " 项失败") + " (" + checks + " 项检查)");
  process.exit(failures === 0 ? 0 : 1);
})();
