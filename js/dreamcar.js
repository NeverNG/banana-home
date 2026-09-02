"use strict";

/* =========================================================
 * 梦想之车卡片 v2:汽车之家 选车(品牌/车系联动下拉)+ VR 全景看车
 * - 品牌下拉(仿 antd Select:字母分组 + logo + 搜索过滤)
 * - 车系下拉(联动:厂商分组 + 价格)
 * - 车型选择 → VR 全景看车(360° 实拍序列图,自动旋转/拖拽旋转 + 颜色切换)
 * - 上次选择持久化;下拉加载失败在浮层内提示可重试
 * 数据全部经 background.js 代理:
 *   dreamCarBrands / dreamCarSeriesByBrand / dreamCarSpecs / dreamCarPano
 * ======================================================== */

(() => {
  if (!document.getElementById("dc-brand")) return; // 卡片不存在则跳过

  const $ = (id) => document.getElementById(id);
  const el = {
    card: document.querySelector(".dreamcar-card"),
    brand: $("dc-brand"),
    brandText: $("dc-brand-text"),
    series: $("dc-series"),
    seriesText: $("dc-series-text"),
    dropdown: $("dc-dropdown"),
    specRow: $("dc-spec-row"),
    spec: $("dc-spec"),
    specText: $("dc-spec-text"),
    colors: $("dc-colors"),
    stage: $("dc-stage"),
    canvas: $("dc-canvas"),
    loading: $("dc-loading"),
    hint: $("dc-hint"),
    title: null, // 卡片底部信息描述已移除(dc-title 删除),车辆名显示在 dc-hint
    empty: $("dc-empty"),
    autoBtn: $("dc-auto"),
  };

  const SAVE_KEY = "dreamCarLast";          // { brandId, seriesId, specId, colorId }
  const DC_AUTO_KEY = "dcAutoRotate";       // local: 自动旋转开关(默认开启)
  const FRAME_MS = 167;                     // VR 全景自动旋转每帧间隔(36帧≈6秒/圈,6fps 均衡档)
  const DRAG_PX_PER_FRAME = 5;
  const BRANDS_TTL = 7 * 24 * 3600 * 1000;  // 品牌列表 7 天
  const SERIES_TTL = 60 * 60 * 1000;        // 车系/车型 1h
  const PANO_TTL = 24 * 60 * 60 * 1000;     // 全景 24h

  const state = {
    brands: null,        // { letters: [{letter, brands:[{brandId,name,imgUrl}]}] }
    brandId: null,
    brandName: "",
    seriesGroups: [],    // [{name, series:[{seriesId,name,imgUrl,levelName,price}]}]
    seriesId: null,
    seriesName: "",
    specGroups: [],      // [{name, specs:[{specId,name,price,description,logo}]}]
    curSpec: null,
    pano: null,          // {info, colors:[{colorId,colorName,colorValue,frames}]}
    colorIdx: 0,
    frames: [],
    frame: 0,
    auto: true,
    dragging: false,
    dragStartX: 0,
    dragStartFrame: 0,
    loaded: new Map(),
    raf: 0,
    lastTick: 0,
    ctx: null,           // canvas 2d 上下文
    resizeObserver: null,
    saved: null,
    dd: null,            // 当前下拉 {kind:"brand"|"series", filter:""}
    errToken: 0,
    pruneTimer: null,
    loadToken: 0,        // 帧加载批次令牌(切色/切车时丢弃旧回调)
    seq: { brand: 0, series: 0, spec: 0 },
  };

  /* ---------- 基础工具 ---------- */

  // 同一 key 的在途请求去重(快速切换 A→B→A 不重复请求)
  const inFlight = new Map();
  function inflight(key, fn) {
    if (inFlight.has(key)) return inFlight.get(key);
    const p = fn().finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  }

  function msg(type, data, timeout) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (r) => { if (!done) { done = true; resolve(r); } };
      const ms = typeof timeout === "number" ? timeout : (type === "dreamCarPano" ? 30000 : 15000);
      const timer = setTimeout(() => finish({ status: "failed", message: "请求超时,请重试" }), ms);
      try {
        chrome.runtime.sendMessage({ type, ...data }, (resp) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) finish({ status: "failed", message: chrome.runtime.lastError.message });
          else finish(resp || { status: "failed" });
        });
      } catch (e) { clearTimeout(timer); finish({ status: "failed", message: String(e) }); }
    });
  }

  async function cachedMsg(type, data, key, ttl) {
    const store = await chrome.storage.local.get(key);
    const hit = store[key];
    if (hit && Date.now() - hit.t < ttl) return hit.data;
    const r = await msg(type, data);
    if (r.status === "ok" || r.status === "empty") {
      try {
        await chrome.storage.local.set({ [key]: { t: Date.now(), data: r } });
        schedulePrune();
      } catch (e) { /* 忽略 */ }
    }
    return r;
  }

  /** 缓存清理节流:多次写入合并为一次(避免频繁全量读 storage) */
  function schedulePrune() {
    clearTimeout(state.pruneTimer);
    state.pruneTimer = setTimeout(pruneCache, 1500);
  }

  async function pruneCache() {
    try {
      const all = await chrome.storage.local.get(null);
      const now = Date.now();
      const keys = Object.keys(all).filter(
        (k) => /^dc(Series|Specs|Pano|Brands)/.test(k) && all[k] && now - all[k].t > 7 * 24 * 3600 * 1000
      );
      if (keys.length) await chrome.storage.local.remove(keys);
    } catch (e) { /* 忽略 */ }
  }

  function visible() {
    // 清爽模式守卫:卡片隐藏时视为不可见(旋转循环自动停止,切回网格由 onGridResume 恢复)
    if (document.body.classList.contains("mode-clean")) return false;
    const page = el.card.closest(".col-page");
    return !!page && page.classList.contains("active");
  }

  function setLoading(text) {
    el.loading.textContent = text || "加载中…";
    el.loading.hidden = false;
    el.hint.hidden = true;
  }
  function clearLoading() { el.loading.hidden = true; }

  function showError(text) {
    const token = ++state.errToken;
    el.loading.textContent = text || "加载失败";
    el.loading.hidden = false;
    el.hint.hidden = true;
    setTimeout(() => {
      if (token !== state.errToken) return; // 期间有新提示则不误隐藏
      el.loading.hidden = true;
    }, 4000);
  }

  /* ---------- 下拉(仿 antd Select) ---------- */

  function closeDropdown() {
    state.dd = null;
    el.dropdown.hidden = true;
    el.dropdown.innerHTML = "";
    el.brand.classList.remove("dc-open");
    el.series.classList.remove("dc-open");
    el.spec.classList.remove("dc-open");
  }

  /** 点击后立即显示浮层骨架(加载中/错误),数据就绪再渲染列表 */
  async function openDropdown(kind) {
    if (state.dd && state.dd.kind === kind) { closeDropdown(); return; }
    state.dd = { kind, filter: "" };
    el.brand.classList.toggle("dc-open", kind === "brand");
    el.series.classList.toggle("dc-open", kind === "series");
    el.spec.classList.toggle("dc-open", kind === "spec");
    renderDropdownTip(kind === "brand" ? "加载品牌…" : kind === "series" ? "加载车系…" : "加载车型…");

    if (kind === "brand") {
      if (!state.brands) {
        const r = await cachedMsg("dreamCarBrands", {}, "dcBrands", BRANDS_TTL);
        if (!state.dd) return; // 已关闭
        if (r.status !== "ok") { renderDropdownTip(r.message || "品牌加载失败", true); return; }
        state.brands = r;
      }
    } else if (kind === "series") {
      if (!state.brandId) { closeDropdown(); return; }
      if (!state.seriesGroups.length) {
        const bid = state.brandId;
        const r = await cachedMsg("dreamCarSeriesByBrand", { brandId: state.brandId }, "dcSeriesByBrand_" + state.brandId, SERIES_TTL);
        if (bid !== state.brandId || !state.dd) return; // 品牌已切换或已关闭
        if (r.status !== "ok") { renderDropdownTip(r.message || "车系加载失败", true); return; }
        state.seriesGroups = r.groups || [];
      }
    } else if (kind === "spec") {
      // 车型数据由 selectSeries 预加载,直接渲染
      if (!state.specGroups.length) { closeDropdown(); return; }
    }
    renderDropdown();
  }

  /** 浮层骨架:加载中提示 或 错误 + 重试按钮 */
  function renderDropdownTip(text, isError) {
    el.dropdown.innerHTML = "";
    el.dropdown.hidden = false;
    const tip = document.createElement("div");
    tip.className = "dc-dd-empty";
    tip.textContent = text || "加载中…";
    el.dropdown.appendChild(tip);
    if (isError) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dc-dd-retry";
      btn.textContent = "重试";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const k = state.dd ? state.dd.kind : "brand"; // 先取 kind 再重置
        state.dd = null;
        openDropdown(k);
      });
      el.dropdown.appendChild(btn);
    }
  }

  function ddFilter(query) {
    if (!state.dd) return;
    state.dd.filter = (query || "").trim();
    renderDropdown();
  }

  function renderDropdown() {
    const dd = state.dd;
    if (!dd) return;
    const f = dd.filter.toLowerCase();
    el.dropdown.hidden = false;
    // 移除骨架提示(renderDropdownTip 的加载中/错误),避免残留
    el.dropdown.querySelectorAll(".dc-dd-empty").forEach((n) => n.parentNode && n.parentNode.removeChild(n));

    // 搜索框:同一 kind 复用(避免输入时重建打断 IME),kind 变化才重建
    let search = el.dropdown.querySelector(".dc-dropdown-search");
    if (!search || search.dataset.kind !== dd.kind) {
      if (search) search.parentNode.removeChild(search);
      search = document.createElement("div");
      search.className = "dc-dropdown-search";
      search.dataset.kind = dd.kind;
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = dd.kind === "brand" ? "搜索品牌" : dd.kind === "series" ? "搜索车系" : "搜索款型";
      input.addEventListener("input", (e) => ddFilter(e.target.value));
      input.addEventListener("click", (e) => e.stopPropagation());
      input.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDropdown(); });
      search.appendChild(input);
      el.dropdown.insertBefore(search, el.dropdown.firstChild);
    }
    const input = search.querySelector("input");
    input.value = dd.filter;
    if (document.activeElement !== input) input.focus();

    // 列表区:每次重建(品牌含字母导航,与其他分组并排)
    // 先清掉旧的列表/分组容器,避免非品牌分支的 list 直接挂载产生累积
    el.dropdown.querySelectorAll(".dc-dropdown-list").forEach((n) => n.parentNode && n.parentNode.removeChild(n));
    el.dropdown.querySelectorAll(".dc-dropdown-body").forEach((n) => n.parentNode && n.parentNode.removeChild(n));
    let body, list;
    if (dd.kind === "brand") {
      body = document.createElement("div");
      body.className = "dc-dropdown-body";
      // 字母导航条(仿汽车之家品牌列表,26 字母分两列:左 A~M / 右 N~Z)
      const nav = document.createElement("div");
      nav.className = "dc-dd-nav";
      const navItems = {};
      const letters = state.brands.letters.map((g) => g.letter);
      const half = Math.ceil(letters.length / 2);
      [letters.slice(0, half), letters.slice(half)].forEach((colLetters) => {
        const col = document.createElement("div");
        col.className = "dc-dd-nav-col";
        colLetters.forEach((letter) => {
          const n = document.createElement("span");
          n.className = "dc-dd-nav-item";
          n.textContent = letter;
          n.dataset.letter = letter;
          n.addEventListener("click", (e) => {
            e.stopPropagation();
            jumpToLetter(letter);
          });
          col.appendChild(n);
          navItems[letter] = n;
        });
        nav.appendChild(col);
      });
      body.appendChild(nav);
      list = document.createElement("div");
      list.className = "dc-dropdown-list";
      list.dataset.kind = "brand";
      // 滚动联动:高亮当前可见分组的字母
      let scrollT = 0;
      list.addEventListener("scroll", () => {
        if (Date.now() - scrollT < 60) return;
        scrollT = Date.now();
        updateNavActive(list, navItems);
      }, { passive: true });
      body.appendChild(list);
      el.dropdown.appendChild(body);
      // 渲染完成后初始化高亮(打开时第一个分组亮起)
      requestAnimationFrame(() => updateNavActive(list, navItems));
    } else {
      list = document.createElement("div");
      list.className = "dc-dropdown-list";
    }
    let count = 0;

    if (dd.kind === "brand" && state.brands) {
      state.brands.letters.forEach((g) => {
        const items = g.brands.filter((b) => !f || b.name.toLowerCase().includes(f));
        if (!items.length) return;
        const letter = document.createElement("div");
        letter.className = "dc-dd-letter";
        letter.textContent = g.letter;
        letter.dataset.letter = g.letter;
        list.appendChild(letter);
        items.forEach((b) => {
          const it = document.createElement("div");
          it.className = "dc-dd-item" + (b.brandId === state.brandId ? " active" : "");
          const img = document.createElement("img");
          img.src = b.imgUrl || "";
          img.alt = "";
          img.loading = "lazy";
          const name = document.createElement("span");
          name.textContent = b.name;
          it.appendChild(img);
          it.appendChild(name);
          it.addEventListener("click", (e) => {
            e.stopPropagation(); // 阻止冒泡到 document,避免被误判为"点击外部"而关闭
            selectBrand(b.brandId, b.name);
          });
          list.appendChild(it);
          count++;
        });
      });
    } else if (dd.kind === "series") {
      state.seriesGroups.forEach((g) => {
        const items = g.series.filter((s) => !f || s.name.toLowerCase().includes(f) || (g.name || "").toLowerCase().includes(f));
        if (!items.length) return;
        const gn = document.createElement("div");
        gn.className = "dc-dd-group-name";
        gn.textContent = g.name;
        list.appendChild(gn);
        items.forEach((s) => {
          const it = document.createElement("div");
          it.className = "dc-dd-item" + (s.seriesId === state.seriesId ? " active" : "");
          const img = document.createElement("img");
          img.src = s.imgUrl || "";
          img.alt = "";
          img.loading = "lazy";
          const name = document.createElement("span");
          name.textContent = s.name;
          it.appendChild(img);
          it.appendChild(name);
          if (s.price) {
            const price = document.createElement("span");
            price.className = "dc-dd-price";
            price.textContent = s.price;
            it.appendChild(price);
          }
          it.addEventListener("click", (e) => {
            e.stopPropagation(); // 阻止冒泡到 document,避免被误判为"点击外部"而关闭
            selectSeries(s.seriesId, s.name);
          });
          list.appendChild(it);
          count++;
        });
      });
    } else if (dd.kind === "spec") {
      // 车型列表:按动力分组(1.6L 自然吸气 / 1.5T 涡轮增压 …)
      state.specGroups.forEach((g) => {
        const items = g.specs.filter((s) => !f || s.name.toLowerCase().includes(f));
        if (!items.length) return;
        const gn = document.createElement("div");
        gn.className = "dc-dd-group-name";
        gn.textContent = g.name;
        list.appendChild(gn);
        items.forEach((s) => {
          const it = document.createElement("div");
          it.className = "dc-dd-item" + (state.curSpec && state.curSpec.specId === s.specId ? " active" : "");
          const name = document.createElement("span");
          name.textContent = s.name;
          it.appendChild(name);
          if (s.price) {
            const price = document.createElement("span");
            price.className = "dc-dd-price";
            price.textContent = s.price;
            it.appendChild(price);
          }
          it.addEventListener("click", (e) => {
            e.stopPropagation(); // 阻止冒泡到 document,避免被误判为"点击外部"而关闭
            selectSpec(s.specId, s.name);
          });
          list.appendChild(it);
          count++;
        });
      });
    }

    if (!count) {
      const empty = document.createElement("div");
      empty.className = "dc-dd-empty";
      empty.textContent = "无匹配结果";
      list.appendChild(empty);
    }
    // 非品牌分支直接挂 dropdown;品牌分支的 list 已在 body 内,避免二次挂载产生残留
    if (dd.kind !== "brand") el.dropdown.appendChild(list);
  }

  /** 字母导航:滚动列表到对应字母分组(用 getBoundingClientRect 求差,与 offsetParent 行为解耦) */
  function jumpToLetter(letter) {
    const list = el.dropdown.querySelector(".dc-dropdown-list[data-kind=\"brand\"]");
    if (!list) return;
    const grp = list.querySelector(".dc-dd-letter[data-letter=\"" + letter + "\"]");
    if (!grp) return;
    const lr = list.getBoundingClientRect();
    const gr = grp.getBoundingClientRect();
    // 目标滚动位置 = 当前 scrollTop + 分组头与列表顶的视口差(不受 sticky/offsetParent 影响)
    list.scrollTop = Math.max(0, list.scrollTop + (gr.top - lr.top));
    // 同步激活导航字母
    const nav = el.dropdown.querySelector(".dc-dd-nav");
    if (nav) nav.querySelectorAll(".dc-dd-nav-item").forEach((n) => n.classList.toggle("active", n.dataset.letter === letter));
  }

  /** 滚动联动:高亮当前位于列表顶部的分组字母 */
  function updateNavActive(list, navItems) {
    const lr = list.getBoundingClientRect();
    const pos = list.scrollTop;
    let cur = "";
    list.querySelectorAll(".dc-dd-letter").forEach((l) => {
      // 分组头到达/越过列表顶部(sticky 贴顶时视口位置 = 列表顶;容差覆盖 list padding)
      if (l.getBoundingClientRect().top <= lr.top + 10 || l.offsetTop <= pos + 10) cur = l.dataset.letter;
    });
    Object.keys(navItems).forEach((k) => navItems[k].classList.toggle("active", k === cur));
  }

  /* ---------- 联动选择 ---------- */

  async function selectBrand(brandId, name) {
    state.brandId = brandId;
    state.brandName = name;
    state.seriesGroups = [];
    state.seriesId = null;
    state.seriesName = "";
    state.specGroups = [];
    state.curSpec = null;
    el.brandText.textContent = name;
    el.brand.classList.add("dc-filled");
    el.seriesText.textContent = "选择车系";
    el.series.classList.remove("dc-filled");
    el.specRow.hidden = true;
    el.colors.hidden = true;
    hideStage();
    closeDropdown();
    // 自动打开车系下拉
    await openDropdown("series");
  }

  async function selectSeries(seriesId, name) {
    const seq = ++state.seq.series;
    // 名称为空时从已缓存的车系列表补全(恢复流程会传空名)
    if (!name && state.seriesGroups.length) {
      for (const g of state.seriesGroups) {
        const s = g.series.find((x) => x.seriesId == seriesId);
        if (s) { name = s.name; break; }
      }
    }
    state.seriesId = seriesId;
    state.seriesName = name;
    state.specGroups = [];
    state.curSpec = null;
    el.seriesText.textContent = name || "…";
    el.series.classList.add("dc-filled");
    el.specRow.hidden = false;
    el.colors.hidden = true;
    hideStage();
    closeDropdown();
    setLoading("加载车型…");
    const r = await cachedMsg("dreamCarSpecs", { seriesId }, "dcSpecs_" + seriesId, SERIES_TTL);
    if (seq !== state.seq.series) return;
    clearLoading();
    if (r.status !== "ok") { showError(r.message || "车型加载失败"); return; }
    state.specGroups = r.groups || [];
    // 恢复流程传入空名时,用接口返回的车系名补全
    if (!state.seriesName && r.seriesName) {
      state.seriesName = r.seriesName;
      el.seriesText.textContent = r.seriesName;
    }
    el.specText.textContent = "选择款型";
    el.spec.classList.remove("dc-filled");
    // 恢复流程:自动选中上次车型;手动选择:打开车型下拉让用户点选
    const flatSpecs = (r.groups || []).flatMap((g) => g.specs);
    if (state.saved && state.saved.seriesId == seriesId && state.saved.specId != null) {
      const sp = flatSpecs.find((s) => s.specId == state.saved.specId);
      if (sp) await selectSpec(sp.specId, sp.name);
      else await openDropdown("spec");
    } else {
      await openDropdown("spec");
    }
  }

  async function selectSpec(specId, specName) {
    specId = parseInt(specId, 10);
    specName = specName || "";
    const seq = ++state.seq.spec;
    state.curSpec = { specId, specName };
    el.specText.textContent = specName;
    el.spec.classList.add("dc-filled");
    closeDropdown(); // 选中车型后关闭下拉
    hideStage(); // 清掉上一款车的图片/旋转,避免残留
    setLoading("加载 VR 全景…");
    const pano = await inflight("dcPano_" + specId, () => cachedMsg("dreamCarPano", { specId }, "dcPano_" + specId, PANO_TTL));
    if (seq !== state.seq.spec) return;
    clearLoading();
    state.pano = pano.status === "ok" ? pano : null;
    // 车辆名称显示在预览窗口底部(hint 位置,替代原"拖动旋转"提示);去掉卡片最下方信息描述
    const carName = [state.brandName, state.seriesName, specName].filter(Boolean).join(" ");
    el.hint.textContent = carName;
    el.hint.hidden = false;
    if (!state.pano) {
      setLoading("暂无360°全景影像，建议选择其他车辆");
      return;
    }
    el.empty.hidden = true;
    renderColorRow();
    // 恢复颜色
    let ci = 0;
    if (state.saved && state.saved.specId == specId && state.saved.colorId != null) {
      const i = state.pano.colors.findIndex((c) => c.colorId == state.saved.colorId);
      if (i >= 0) ci = i;
    }
    await selectColor(ci);
    saveLast();
  }

  /* ---------- 颜色 ---------- */

  function renderColorRow() {
    el.colors.innerHTML = "";
    const colors = state.pano ? state.pano.colors : [];
    el.colors.hidden = !colors.length;
    colors.forEach((c, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dreamcar-color" + (i === 0 ? " active" : "");
      const v = String(c.colorValue || "").trim();
      b.style.background = v && /^[0-9a-fA-F]{6}$/.test(v) ? "#" + v : "linear-gradient(135deg,#888,#ccc)";
      b.title = c.colorName;
      b.addEventListener("click", () => selectColor(i));
      b.addEventListener("pointerdown", (e) => e.stopPropagation()); // 悬浮于舞台内,避免触发拖拽旋转
      el.colors.appendChild(b);
    });
  }

  function renderColorDots() {
    [...el.colors.children].forEach((b, i) => b.classList.toggle("active", i === state.colorIdx));
  }

  async function selectColor(ci) {
    if (!state.pano || !state.pano.colors.length) return;
    ci = Math.max(0, Math.min(state.pano.colors.length - 1, ci));
    state.colorIdx = ci;
    const c = state.pano.colors[ci];
    state.frames = c.frames;
    state.frame = 0;
    renderColorDots();
    stopRotate(); // 切色时停旧旋转;新帧全部就绪后再启动(避免加载期跳帧卡顿)
    loadAllFrames();
    saveLast();
  }

  /* ---------- VR 全景帧渲染(canvas 直切,无过渡避免残影) ---------- */

  function initCanvas() {
    if (!el.canvas) return;
    state.ctx = el.canvas.getContext("2d");
    resizeCanvas();
    if (typeof ResizeObserver !== "undefined") {
      state.resizeObserver = new ResizeObserver(resizeCanvas);
      state.resizeObserver.observe(el.stage);
    }
  }

  function resizeCanvas() {
    if (!el.canvas) return;
    const r = el.stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    el.canvas.width = Math.max(1, Math.round(r.width * dpr));
    el.canvas.height = Math.max(1, Math.round(r.height * dpr));
    // 重设尺寸会清空画布,重绘当前帧避免暂停状态空白
    if (state.frames.length) drawFrame(state.frames[state.frame]);
  }

  function clearCanvas() {
    if (state.ctx && el.canvas.width) {
      state.ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
    }
  }

  /** 绘制一帧(图片已预解码,drawImage 同步无延迟) */
  function drawFrame(url) {
    if (!state.ctx) return;
    const im = state.loaded.get(url);
    if (!im || !im.complete || !im.naturalWidth) return;
    const cw = el.canvas.width;
    const ch = el.canvas.height;
    if (!cw || !ch) return;
    const scale = Math.min(cw / im.naturalWidth, ch / im.naturalHeight);
    const w = im.naturalWidth * scale;
    const h = im.naturalHeight * scale;
    const x = (cw - w) / 2;
    const y = (ch - h) / 2;
    state.ctx.drawImage(im, x, y, w, h);
    el.canvas.dataset.frame = url; // 当前帧(测试/调试)
  }

  function hideStage() {
    clearCanvas();
    el.hint.hidden = true;
    stopRotate();
  }

  /** 直接绘制指定帧(拖拽跟手、切色、自动旋转) */
  function showFrame(i) {
    const n = state.frames.length;
    if (!n) return;
    state.frame = ((i % n) + n) % n;
    clearCanvas();
    drawFrame(state.frames[state.frame]);
  }

  function revealFirst() {
    const cur = state.loaded.get(state.frames[state.frame]);
    let url = null;
    if (cur && cur.complete && cur.naturalWidth) {
      url = state.frames[state.frame];
    } else {
      for (let i = 0; i < state.frames.length; i++) {
        const im = state.loaded.get(state.frames[i]);
        if (im && im.complete && im.naturalWidth) { state.frame = i; url = state.frames[i]; break; }
      }
    }
    if (url) {
      clearCanvas();
      drawFrame(url);
      el.loading.hidden = true;
      el.autoBtn.hidden = false; // 有帧数据后显示自动旋转按钮
      // 帧未全部就绪前提示加载中,避免误导"自动旋转中"
      const pending = state.frames.some((u) => {
        const im = state.loaded.get(u);
        return !im || !im.complete || !im.naturalWidth;
      });
      el.hint.hidden = false; // hint 已显示车辆名称(选车时设置),不再提示"拖动旋转"
      if (pending) el.loading.hidden = false;
    }
  }

  function loadAllFrames() {
    const token = ++state.loadToken;
    state.loaded.clear();
    el.loading.hidden = false;
    el.hint.hidden = true;
    clearCanvas();
    const n = state.frames.length;
    if (!n) { clearLoading(); setLoading("暂无360°全景影像，建议选择其他车辆"); return; }
    let done = 0;
    let okCount = 0;
    const onDone = () => {
      if (++done < n) return;
      if (okCount > 0) {
        // 全部帧就绪(含失败帧跳过)后才启动自动旋转,旋转期间平滑不跳帧
        // hint 保持车辆名称显示
        if (state.auto) {
          state.lastTick = performance.now();
          startRotate();
        }
      } else {
        showError("全景图片加载失败,请检查网络后重试");
      }
    };
    for (let i = 0; i < n; i++) {
      const url = state.frames[i];
      const im = new Image();
      im.onload = () => {
        if (token !== state.loadToken) return; // 已切色/切车,丢弃旧批次回调
        state.loaded.set(url, im);
        okCount++;
        revealFirst();
        onDone();
      };
      im.onerror = () => {
        if (token !== state.loadToken) return;
        state.loaded.set(url, null);
        revealFirst();
        onDone();
      };
      im.src = url;
      state.loaded.set(url, im);
    }
  }

  /* ---------- 旋转 ---------- */

  function tick(ts) {
    if (!visible() || !state.auto || state.dragging) { stopRotate(); return; }
    if (ts - state.lastTick < FRAME_MS) { state.raf = requestAnimationFrame(tick); return; }
    state.lastTick = ts;
    // 直切下一帧(36 帧序列图,任何帧间过渡都会产生错位残影)
    showFrame(state.frame + 1);
    state.raf = requestAnimationFrame(tick);
  }

  function startRotate() {
    if (state.raf) return;
    state.lastTick = performance.now();
    state.raf = requestAnimationFrame(tick);
  }

  function stopRotate() {
    if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
  }

  function toggleAuto() {
    state.auto = !state.auto;
    el.autoBtn.textContent = state.auto ? "⏸" : "▶";
    el.autoBtn.title = state.auto ? "暂停自动旋转" : "恢复自动旋转";
    el.autoBtn.classList.toggle("on", state.auto);
    if (state.auto) { state.lastTick = performance.now(); startRotate(); }
    else stopRotate();
    // 持久化开关状态,刷新后保持
    try { chrome.storage.local.set({ [DC_AUTO_KEY]: state.auto }); } catch (e) { /* 忽略 */ }
  }

  /* ---------- 持久化 ---------- */

  async function saveLast() {
    const c = state.pano ? state.pano.colors[state.colorIdx] : null;
    try {
      await chrome.storage.local.set({
        [SAVE_KEY]: {
          brandId: state.brandId,
          seriesId: state.seriesId,
          specId: state.curSpec ? state.curSpec.specId : null,
          colorId: c ? c.colorId : null,
        },
      });
    } catch (e) { /* 忽略 */ }
  }

  /* ---------- 初始化 ---------- */

  function bindEvents() {
    el.brand.addEventListener("click", () => openDropdown("brand"));
    el.series.addEventListener("click", () => openDropdown("series"));
    el.spec.addEventListener("click", () => openDropdown("spec"));
    el.autoBtn.addEventListener("click", toggleAuto);
    // 关闭下拉
    document.addEventListener("click", (e) => {
      if (!el.dropdown.contains(e.target) && !el.brand.contains(e.target) && !el.series.contains(e.target) && !el.spec.contains(e.target)) closeDropdown();
    });
    // VR 全景拖拽
    el.stage.addEventListener("pointerdown", (e) => {
      if (!state.frames.length) return;
      state.dragging = true;
      state.dragStartX = e.clientX;
      state.dragStartFrame = state.frame;
      el.stage.classList.add("dragging");
      el.stage.setPointerCapture(e.pointerId);
      stopRotate();
      e.preventDefault();
    });
    el.stage.addEventListener("pointermove", (e) => {
      if (!state.dragging) return;
      const dx = e.clientX - state.dragStartX;
      showFrame(state.dragStartFrame + Math.round(dx / DRAG_PX_PER_FRAME));
    });
    const endDrag = () => {
      if (!state.dragging) return;
      state.dragging = false;
      el.stage.classList.remove("dragging");
      state.lastTick = performance.now();
      if (state.auto) startRotate();
    };
    el.stage.addEventListener("pointerup", endDrag);
    el.stage.addEventListener("pointercancel", endDrag);
    // 页面切走暂停旋转
    const mo = new MutationObserver(() => {
      if (visible() && state.auto) startRotate();
      else stopRotate();
    });
    document.querySelectorAll(".col-page").forEach((p) =>
      mo.observe(p, { attributes: true, attributeFilter: ["class"] })
    );
    // 切回网格模式:恢复自动旋转(清爽模式下 visible() 返回 false 已停止循环)
    if (window.onGridResume) window.onGridResume(() => {
      if (visible() && state.auto) startRotate();
    });
  }

  async function init() {
    initCanvas();
    bindEvents();
    // 恢复自动旋转开关状态(默认开启),并同步按钮 UI
    try {
      const { [DC_AUTO_KEY]: auto } = await chrome.storage.local.get(DC_AUTO_KEY);
      state.auto = auto !== false;
    } catch (e) { /* 默认开启 */ }
    el.autoBtn.textContent = state.auto ? "⏸" : "▶";
    el.autoBtn.title = state.auto ? "暂停自动旋转" : "恢复自动旋转";
    el.autoBtn.classList.toggle("on", state.auto);
    el.autoBtn.hidden = true; // 无数据前不显示;有帧数据后显示
    try {
      const st = await chrome.storage.local.get(SAVE_KEY);
      state.saved = st[SAVE_KEY] || null;
    } catch (e) { state.saved = null; }
    // 恢复上次选择
    if (state.saved && state.saved.brandId) {
      el.empty.hidden = true;
      const seq = ++state.seq.brand;
      const r = await cachedMsg("dreamCarBrands", {}, "dcBrands", BRANDS_TTL);
      if (seq !== state.seq.brand) return;
      if (r.status === "ok") {
        state.brands = r;
        const b = r.letters.flatMap((g) => g.brands).find((x) => x.brandId == state.saved.brandId);
        if (b) {
          state.brandId = b.brandId;
          state.brandName = b.name;
          el.brandText.textContent = b.name;
          el.brand.classList.add("dc-filled");
          if (state.saved.seriesId) {
            await selectSeries(state.saved.seriesId, "");
          } else {
            el.empty.hidden = true; // 只恢复品牌,无上次车系
          }
        } else {
          el.empty.hidden = false;
        }
      } else {
        el.empty.hidden = false;
      }
    } else {
      el.empty.hidden = false;
    }
  }

  const startDreamCar = () => (window.__whenGrid ? window.__whenGrid(init) : init());
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startDreamCar);
  } else {
    startDreamCar();
  }
})();
