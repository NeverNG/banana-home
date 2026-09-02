"use strict";

/* =========================================================
 * 八卦罗盘:后天八卦罗盘卡片(支持 2/4、3/4 两档高度)。
 * 依《胡楠罗盘详解·第一层 先天八卦与后天八卦》优化:
 * - 罗盘方位上南下北(皇帝坐北朝南视角,图纸上方为南)。
 * - 盘面三层:外圈卦名环(坎艮震巽离坤兑乾,上南下北顺时针)
 *   → 中环八卦爻线(初爻朝圆心,白色系)
 *   → 中心太极(黑白阴阳鱼,参照 ☯ 按钮/九环演化图,缓转)。
 * - 每卦附带:洛书数(坎一坤二震三巽四乾六兑七艮八离九)、九星
 *   (贪狼/巨门/禄存/文曲/武曲/破军/左辅/右弼)、先天位(先天为体,
 *   如「坎的先天在兑」)、先天数(乾一兑二离三震四巽五坎六艮七坤八)。
 * - 今日卦:日期种子确定性选取(当日不变,次日更换)。
 * - 交互:点击卦位查看详情,🎲 随机起一卦,点击太极恢复今日卦。
 * - 时辰徽章:当前十二时辰 + 五行,30s 检查跨时/跨天。
 * - 纯本地计算:无网络请求、无存储读写;由网格门控注入,清爽模式不加载。
 * ======================================================== */

/* 后天八卦(罗盘方位:上南下北,顺时针从顶部南开始)。
 * 离南0° → 坤西南45° → 兑西90° → 乾西北135° → 坎北180° → 艮东北225° → 震东270° → 巽东南315°
 * 数据供详情面板/今日卦使用 */
const BAGUA = [
  { sym: "☵", name: "坎", dir: "北",   elem: "水", elemClass: "e-water", fam: "中男", num: "一", season: "冬",   nature: "水", trait: "险陷", xiandian: "六", xianti: "兑", jiuxing: "贪狼",
    lines: [0, 1, 0],
    shan3: "壬 · 子 · 癸", ganzhi: "壬·阳水　癸·阴水", zangfu: "肾 · 膀胱 · 骨髓 · 血", wangsheng: "水旺得土,方成池沼;强水得木,方泄其势",
    comb: "讼 困 未济 解 涣 坎 蒙 师", combFull: "天水讼 泽水困 火水未济 雷水解 风水涣 坎为水 山水蒙 地水师", guaci: "水洊至习坎,君子以常德行习教事" },
  { sym: "☶", name: "艮", dir: "东北", elem: "土", elemClass: "e-earth", fam: "少男", num: "八", season: "冬春", nature: "山", trait: "静止", xiandian: "七", xianti: "乾", jiuxing: "左辅",
    lines: [0, 0, 1],
    shan3: "丑 · 艮 · 寅", ganzhi: "—(四维,无天干)", zangfu: "脾 · 胃 · 肌肉 · 口", wangsheng: "土旺得水,方能疏通;强土得金,方制其壅",
    comb: "遯 咸 旅 小过 渐 蹇 艮 谦", combFull: "天山遯 泽山咸 火山旅 雷山小过 风山渐 水山蹇 艮为山 地山谦", guaci: "兼山艮,君子以思不出其位" },
  { sym: "☳", name: "震", dir: "东",   elem: "木", elemClass: "e-wood",  fam: "长男", num: "三", season: "春",   nature: "雷", trait: "震动", xiandian: "四", xianti: "艮", jiuxing: "禄存",
    lines: [1, 0, 0],
    shan3: "甲 · 卯 · 乙", ganzhi: "甲·阳木　乙·阴木", zangfu: "肝 · 胆 · 筋 · 目", wangsheng: "木旺得金,方成栋梁;强木得火,方化其顽",
    comb: "无妄 随 噬嗑 震 益 屯 颐 复", combFull: "天雷无妄 泽雷随 火雷噬嗑 震为雷 风雷益 水雷屯 山雷颐 地雷复", guaci: "洊雷震,君子以恐惧修省" },
  { sym: "☴", name: "巽", dir: "东南", elem: "木", elemClass: "e-wood",  fam: "长女", num: "四", season: "春夏", nature: "风", trait: "入顺", xiandian: "五", xianti: "坤", jiuxing: "文曲",
    lines: [0, 1, 1],
    shan3: "辰 · 巽 · 巳", ganzhi: "—(四维,无天干)", zangfu: "肝 · 胆 · 筋 · 目", wangsheng: "木旺得金,方成栋梁;强木得火,方化其顽",
    comb: "姤 大过 鼎 恒 巽 井 蛊 升", combFull: "天风姤 泽风大过 火风鼎 雷风恒 巽为风 水风井 山风蛊 地风升", guaci: "随风巽,君子以申命行事" },
  { sym: "☲", name: "离", dir: "南",   elem: "火", elemClass: "e-fire",  fam: "中女", num: "九", season: "夏",   nature: "火", trait: "附丽", xiandian: "三", xianti: "震", jiuxing: "右弼",
    lines: [1, 0, 1],
    shan3: "丙 · 午 · 丁", ganzhi: "丙·阳火　丁·阴火", zangfu: "心 · 小肠 · 舌", wangsheng: "火旺得水,方成相济;强火得土,方止其焰",
    comb: "同人 革 离 丰 家人 既济 贲 明夷", combFull: "天火同人 泽火革 离为火 雷火丰 风火家人 水火既济 山火贲 地火明夷", guaci: "明两作离,大人以继明照于四方" },
  { sym: "☷", name: "坤", dir: "西南", elem: "土", elemClass: "e-earth", fam: "母",   num: "二", season: "夏秋", nature: "地", trait: "柔顺", xiandian: "八", xianti: "坎", jiuxing: "巨门",
    lines: [0, 0, 0],
    shan3: "未 · 坤 · 申", ganzhi: "—(四维,无天干)", zangfu: "脾 · 胃 · 肌肉 · 口", wangsheng: "土旺得水,方能疏通;强土得金,方制其壅",
    comb: "否 萃 晋 豫 观 比 剥 坤", combFull: "天地否 泽地萃 火地晋 雷地豫 风地观 水地比 山地剥 坤为地", guaci: "地势坤,君子以厚德载物" },
  { sym: "☱", name: "兑", dir: "西",   elem: "金", elemClass: "e-metal", fam: "少女", num: "七", season: "秋",   nature: "泽", trait: "喜悦", xiandian: "二", xianti: "巽", jiuxing: "破军",
    lines: [1, 1, 0],
    shan3: "庚 · 酉 · 辛", ganzhi: "庚·阳金　辛·阴金", zangfu: "肺 · 大肠 · 皮肤 · 毛 · 鼻", wangsheng: "金旺得火,方成器皿;强金得水,方挫其锋",
    comb: "履 兑 睽 归妹 中孚 节 损 临", combFull: "天泽履 兑为泽 火泽睽 雷泽归妹 风泽中孚 水泽节 山泽损 地泽临", guaci: "丽泽兑,君子以朋友讲习" },
  { sym: "☰", name: "乾", dir: "西北", elem: "金", elemClass: "e-metal", fam: "父",   num: "六", season: "秋冬", nature: "天", trait: "刚健", xiandian: "一", xianti: "离", jiuxing: "武曲",
    lines: [1, 1, 1],
    shan3: "戌 · 乾 · 亥", ganzhi: "—(四维,无天干)", zangfu: "肺 · 大肠 · 皮肤 · 毛 · 鼻", wangsheng: "金旺得火,方成器皿;强金得水,方挫其锋",
    comb: "乾 夬 大有 大壮 小畜 需 大畜 泰", combFull: "乾为天 泽天夬 火天大有 雷天大壮 风天小畜 水天需 山天大畜 地天泰", guaci: "天行健,君子以自强不息" },
];

/* 十二时辰:名称 / 起止 / 五行 */
const SHICHEN = [
  { n: "子", s: "23:00", e: "00:59", w: "水" },
  { n: "丑", s: "01:00", e: "02:59", w: "土" },
  { n: "寅", s: "03:00", e: "04:59", w: "木" },
  { n: "卯", s: "05:00", e: "06:59", w: "木" },
  { n: "辰", s: "07:00", e: "08:59", w: "土" },
  { n: "巳", s: "09:00", e: "10:59", w: "火" },
  { n: "午", s: "11:00", e: "12:59", w: "火" },
  { n: "未", s: "13:00", e: "14:59", w: "土" },
  { n: "申", s: "15:00", e: "16:59", w: "金" },
  { n: "酉", s: "17:00", e: "18:59", w: "金" },
  { n: "戌", s: "19:00", e: "20:59", w: "土" },
  { n: "亥", s: "21:00", e: "22:59", w: "水" },
];

/** 当前时辰(23:00-00:59 归子时) */
function currentShichen() {
  const h = new Date().getHours();
  const idx = h >= 23 || h < 1 ? 0 : Math.floor((h + 1) / 2);
  return SHICHEN[idx];
}

/** 今日卦:日期种子确定性(年尾×12 + 月×3 + 日,对 8 取模),当日恒定、次日更换 */
function todayGua() {
  const n = new Date();
  const sum = (n.getFullYear() % 100) * 12 + (n.getMonth() + 1) * 3 + n.getDate();
  return BAGUA[sum % BAGUA.length];
}

/* ---- 渲染 ---- */
const baguaState = { selected: null, isToday: true };

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(SVG_NS, tag);
  Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k]));
  if (parent) parent.appendChild(e);
  return e;
}

/** 中心太极(黑白阴阳鱼,参照 ☯ 按钮 / 九环演化图):
 * 左白右黑、白鱼头朝上(黑眼)、黑鱼头朝下(白眼),外圈细描边;点击恢复今日卦 */
const TAIJI_SIMPLE =
  '<path d="M50 20 A30 30 0 0 0 50 80 A15 15 0 0 1 50 50 A15 15 0 0 0 50 20 Z" fill="#ffffff"/>' +
  '<path d="M50 20 A30 30 0 0 1 50 80 A15 15 0 0 1 50 50 A15 15 0 0 0 50 20 Z" fill="rgba(13,19,43,0.94)"/>' +
  '<circle cx="50" cy="35" r="4.6" fill="rgba(13,19,43,0.94)"/>' +
  '<circle cx="50" cy="65" r="4.6" fill="#ffffff"/>' +
  '<circle cx="50" cy="50" r="30" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1.4"/>';

/* 卦位角度(上南下北,顺时针;离=顶部=南) */
const BAGUA_ANGLES = [180, 225, 270, 315, 0, 45, 90, 135];

/** 爻线组(卦象,初爻朝圆心):lines = [初爻, 二爻, 上爻] */
function svgGuaLines(parent, angle, lines) {
  const g = svgEl("g", { transform: "rotate(" + angle + " 50 50)" }, parent);
  lines.forEach((v, i) => {
    const r = 33 + i * 3, y = 50 - r - 1.25;
    if (v) {
      svgEl("rect", { x: 44, y: y, width: 12, height: 2.5, rx: 0.7, class: "bg-guax" }, g);
    } else {
      svgEl("rect", { x: 44, y: y, width: 5, height: 2.5, rx: 0.7, class: "bg-guax" }, g);
      svgEl("rect", { x: 51, y: y, width: 5, height: 2.5, rx: 0.7, class: "bg-guax" }, g);
    }
  });
  return g;
}

/** 构建卡片主图(外圈卦名环 + 爻线环绕 + 中心太极),仅执行一次;点击太极恢复今日卦 */
function renderCompass() {
  const compass = document.getElementById("bagua-compass");
  if (!compass || compass.dataset.rendered) return;
  compass.dataset.rendered = "1";

  const svg = svgEl("svg", { class: "bg-svg", viewBox: "0 0 100 100" });

  // 外圈八边形罗盘环 + 卦名(坎艮震巽离坤兑乾,按方位排布,保持正立可读)
  // 顶点从 22.5° 起:上下两条边水平(平边朝上/下);外接圆 r52 将卦名文字包入边形内
  const octPts = [];
  for (let a = 0; a < 360; a += 45) {
    const rad = ((a + 22.5) * Math.PI) / 180;
    octPts.push(
      (50 + 52 * Math.sin(rad)).toFixed(2) + "," + (50 - 52 * Math.cos(rad)).toFixed(2)
    );
  }
  svg.appendChild(svgEl("polygon", {
    points: octPts.join(" "), fill: "none", class: "bg-ring",
    stroke: "rgba(255,255,255,0.35)", "stroke-width": "0.8"
  }));
  BAGUA.forEach((g, i) => {
    const a = BAGUA_ANGLES[i];
    const rad = (a * Math.PI) / 180;
    const name = svgEl("text", {
      x: 50 + 45 * Math.sin(rad),
      y: 50 - 45 * Math.cos(rad),
      class: "bg-name",
      "text-anchor": "middle",
      "dominant-baseline": "central"
    });
    name.textContent = g.name;
    svg.appendChild(name);
  });

  // 中环八卦:爻线卦象(初爻朝圆心,白色系与太极协调)
  BAGUA.forEach((g, i) => {
    const a = BAGUA_ANGLES[i];
    const grp = svgEl("g", { class: "bg-tile" });
    svg.appendChild(grp);
    svgGuaLines(grp, a, g.lines);
  });

  // 中心太极:点击恢复今日卦
  const taiji = svgEl("g", { class: "bg-taiji" });
  taiji.innerHTML = TAIJI_SIMPLE;
  taiji.addEventListener("click", () => selectGua(todayGua(), true));
  svg.appendChild(taiji);
  compass.appendChild(svg);
}

/** 详情键值单元 */
function bdCell(k, v) {
  return '<div class="bd-cell"><i>' + k + "</i><b>" + v + "</b></div>";
}

/** 选中某卦:刷新详情面板(3/4)+ 底部摘要 */
function selectGua(gua, isToday) {
  baguaState.selected = gua;
  baguaState.isToday = !!isToday;

  // 详情面板(3/4 档显示):第一行 = 标签+卦名+方位·五行(不含卦符);卦辞另起一行
  // (3/4 档不显示 footer,头部信息并入此处);下方为九宫格与行式信息
  const detail = document.getElementById("bagua-detail");
  if (detail) {
    detail.innerHTML =
      '<div class="bd-head">' +
      '<span class="bd-tag">' + (isToday ? "今日卦" : "所查卦") + "</span>" +
      '<span class="bd-name">' + gua.name + "卦</span>" +
      '<span class="bd-meta">' + gua.dir + " · " + gua.elem + "</span>" +
      "</div>" +
      '<div class="bd-row bd-guaci-row"><i>卜辞</i><b>' + gua.guaci + "</b></div>" +
      '<div class="bd-grid">' +
      bdCell("方位", gua.dir) + bdCell("五行", gua.elem) + bdCell("洛书数", gua.num) +
      bdCell("九星", gua.jiuxing) + bdCell("先天位", gua.xianti) + bdCell("先天数", gua.xiandian) +
      "</div>" +
      '<div class="bd-rows">' +
      '<div class="bd-row"><i>三山</i><b>' + gua.shan3 + '</b><i class="bd-sep"></i><i>天干</i><b>' + gua.ganzhi + "</b></div>" +
      '<div class="bd-row"><i>脏腑</i><b>' + gua.zangfu + "</b></div>" +
      '<div class="bd-row"><i>六十四卦</i><b title="' + gua.combFull + '">' + gua.comb + "</b></div>" +
      '<div class="bd-row"><i>旺衰</i><b>' + gua.wangsheng + "</b></div>" +
      "</div>";
  }

  // 底部摘要(两档都显示)
  const footer = document.getElementById("bagua-footer");
  if (footer) {
    footer.innerHTML =
      '<span class="bf-tag">' + (isToday ? "今日卦" : "所查卦") + "</span>" +
      '<span class="bf-sym">' + gua.sym + "</span>" +
      '<span class="bf-name">' + gua.name + "卦</span>" +
      '<span class="bf-meta">' + gua.dir + " · " + gua.elem + "</span>" +
      '<span class="bf-guaci">' + gua.guaci + "</span>";
  }

  // AI 解卦(2/4 档显示;按卦象生成简短解读,带缓存)
  loadGuaci(gua);
}

/** HTML 转义(解卦文案来自远程 AI,防注入) */
function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** AI 解卦:按卦象调用 DeepSeek 生成简短解读(会话级缓存,8 卦各一条) */
let guaciSeq = 0; // 请求序号:防快速切换时旧响应覆盖新卦
function loadGuaci(gua) {
  const el = document.getElementById("bagua-ai-interp");
  if (!el) return;
  const cacheKey = "guaci-" + gua.name;
  const mySeq = ++guaciSeq;
  try {
    chrome.storage.session.get(cacheKey).then((r) => {
      if (mySeq !== guaciSeq) return; // 已有更新的选择
      if (r && r[cacheKey]) {
        el.innerHTML = '<b>解卦：</b>' + escHtml(r[cacheKey]);
        return;
      }
      el.innerHTML = "<b>解卦：</b>生成中…";
      try {
        chrome.runtime.sendMessage({ type: "askGuaci", gua: guaInfoText(gua) }, (res) => {
          if (mySeq !== guaciSeq) return; // 旧请求结果丢弃
          if (res && res.status === "ok" && res.text) {
            el.innerHTML = "<b>解卦：</b>" + escHtml(res.text);
            try { chrome.storage.session.set({ [cacheKey]: res.text }); } catch (e) { /* 忽略 */ }
          } else if (res && res.status === "no-key") {
            el.innerHTML = "<b>解卦：</b>未配置 AI Key（设置 → AI → DeepSeek API Key）";
          } else if (res && res.status === "failed") {
            el.innerHTML = "<b>解卦：</b>AI 生成失败，请检查 DeepSeek API Key 与网络后重试";
          } else {
            // 回调无有效响应:大概率扩展未重载(background 旧代码未注册 askGuaci)
            el.innerHTML = "<b>解卦：</b>AI 服务未就绪，请重新加载扩展后重试";
          }
        });
      } catch (e) {
        el.innerHTML = "<b>解卦：</b>未配置 AI Key（设置 → AI → DeepSeek API Key）";
      }
    }).catch(() => { /* 忽略 */ });
  } catch (e) { /* 忽略 */ }
}

/** 卦象信息文本(供 AI 解卦 prompt) */
function guaInfoText(gua) {
  return (
    gua.name + "卦 " + gua.sym + "，方位" + gua.dir + "，五行属" + gua.elem +
    "，卦德" + gua.trait + "，象征" + gua.nature +
    "，洛书数" + gua.num + "，九星" + gua.jiuxing +
    "。卦辞：" + gua.guaci
  );
}

/** 更新时辰徽章 */
function updateShichen() {
  const el = document.getElementById("bagua-shichen");
  if (!el) return;
  const sc = currentShichen();
  el.textContent = sc.n + "时 · " + sc.w;
  el.title = "当前时辰:" + sc.n + "时(" + sc.s + "-" + sc.e + ") · 五行属" + sc.w;
}

function initBagua() {
  if (!document.getElementById("bagua-card")) return;
  renderCompass();
  selectGua(todayGua(), true);
  updateShichen();

  const rand = document.getElementById("bagua-rand");
  if (rand) {
    rand.addEventListener("click", () => {
      const r = BAGUA[Math.floor(Math.random() * BAGUA.length)];
      selectGua(r, false);
    });
  }

  // 综合罗盘(23 环旋转):点击 ☯ 打开,svg 由 compass.js 渲染(清爽模式不注入即无渲染函数)
  const evoBtn = document.getElementById("bagua-chart");
  const evoDlg = document.getElementById("evo-zoom");
  const evoChart = document.getElementById("evo-chart");
  const evoClose = document.getElementById("evo-zoom-close");
  if (evoBtn && evoDlg && evoChart) {
    evoBtn.addEventListener("click", () => {
      if (!evoChart.dataset.rendered && typeof window.__renderEvoChart === "function") {
        window.__renderEvoChart(evoChart);
        evoChart.dataset.rendered = "1";
      }
      if (typeof evoDlg.showModal === "function") evoDlg.showModal();
      else evoDlg.setAttribute("open", "");
    });
  }
  // 关闭按钮(与股票弹窗一致;Esc 由 dialog 原生处理)
  if (evoClose && evoDlg) {
    evoClose.addEventListener("click", () => {
      if (typeof evoDlg.close === "function") evoDlg.close();
      else evoDlg.removeAttribute("open");
    });
  }

  // 跨时 / 跨天检查(30s 一次,开销可忽略)
  setInterval(() => {
    const el = document.getElementById("bagua-shichen");
    if (el) {
      const sc = currentShichen();
      if (el.textContent !== sc.n + "时 · " + sc.w) updateShichen();
    }
    if (!baguaState.isToday) return; // 用户在看别的卦,不打扰
    const t = todayGua();
    if (baguaState.selected !== t) selectGua(t, true); // 跨天后自动换今日卦
  }, 30000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initBagua);
} else {
  initBagua();
}
