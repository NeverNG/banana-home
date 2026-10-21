"use strict";

/* =========================================================
 * 桌面宠物(集成 vscode-pets 精灵资源,MIT)
 * 5 只宠物:小助手 / 橡皮鸭 / 小螃蟹 / 龙猫 / 熊猫
 * 随机行为(发呆/行走/奔跑/玩球/睡觉) + 切换 / 喂食 / 拖拽 / 点击挥手
 * ======================================================== */

const PETS = [
  { id: "clippy", name: "小助手" },
  { id: "duck", name: "橡皮鸭" },
  { id: "crab", name: "小螃蟹" },
  { id: "totoro", name: "龙猫" },
  { id: "panda", name: "熊猫" },
];

const PET_FRAME = (id, action) => "img/pets/" + id + "_" + action + ".gif";
const PET_FOODS = ["🍪", "🍬", "🍩", "🧁", "🍎"];
const PET_IDX_KEY = "petIndex"; // local: 上次选择的宠物索引(刷新后恢复)

const pet = {
  idx: 0,
  mode: "idle",
  x: 40,
  dir: 1,
  stageW: 0,
  nextAt: 0,
  swipeUntil: 0,
  sleepUntil: 0,
  raf: null,
  dragging: false,
  dragged: false,
  dragOffset: 0,
  // 渲染节流:位置/朝向没变就不写 DOM;静止状态不排下一帧
  lastLeft: null,
  lastFlip: null,
  lastNow: 0,
  wakeTimer: 0,
  cardEl: null,
};

function petSetFrame(action) {
  const img = document.getElementById("pet-img");
  if (!img) return;
  // vscode-pets 宠物没有独立的 sleep 帧:睡眠时复用 idle 帧(静止)+ 💤 动画
  const frame = action === "sleep" ? "idle" : action;
  img.src = PET_FRAME(PETS[pet.idx].id, frame);
}

function petSwitchMode(mode) {
  pet.mode = mode;
  petSetFrame(mode);
}

function showZzz(on) {
  const stage = document.getElementById("pet-stage");
  if (!stage) return;
  const z = document.getElementById("pet-zzz");
  if (!on) { if (z) z.remove(); return; }
  if (z) return;
  const el = document.createElement("span");
  el.id = "pet-zzz";
  el.className = "pet-zzz";
  el.textContent = "💤";
  stage.appendChild(el);
}

/** 随机进入下一状态 */
function petRandomMode() {
  const r = Math.random();
  if (r < 0.3) petSwitchMode("idle");
  else if (r < 0.6) petSwitchMode("walk");
  else if (r < 0.75) petSwitchMode("run");
  else petSwitchMode("ball");

  // 发呆时有概率睡着
  if (pet.mode === "idle" && Math.random() < 0.35) {
    petSwitchMode("sleep");
    pet.sleepUntil = performance.now() + 5000 + Math.random() * 5000;
    showZzz(true);
  } else {
    showZzz(false);
  }
  pet.nextAt = performance.now() + 2500 + Math.random() * 3500;
}

/** 点击互动:挥手回应 */
function petInteract() {
  showZzz(false);
  petSwitchMode("swipe");
  pet.swipeUntil = performance.now() + 1300;
  petWake();
}

/** 喂食:食物掉落 + 开心 */
function petFeed() {
  const stage = document.getElementById("pet-stage");
  const img = document.getElementById("pet-img");
  if (!stage || !img) return;
  const food = document.createElement("span");
  food.className = "pet-food";
  food.textContent = PET_FOODS[Math.floor(Math.random() * PET_FOODS.length)];
  food.style.left = Math.max(6, Math.min(pet.stageW - 34, pet.x + 26)) + "px";
  stage.appendChild(food);
  setTimeout(() => food.remove(), 1200);

  showZzz(false);
  petSwitchMode("swipe");
  pet.swipeUntil = performance.now() + 1300;

  const heart = document.createElement("span");
  heart.className = "pet-heart";
  heart.textContent = "💗";
  heart.style.left = (pet.x + 30) + "px";
  stage.appendChild(heart);
  setTimeout(() => heart.remove(), 1600);
  petWake();
}

/** 切换宠物 */
function petCycle() {
  pet.idx = (pet.idx + 1) % PETS.length;
  pet.mode = "idle";
  pet.x = 40;
  pet.dir = 1;
  showZzz(false);
  petSetFrame("idle");
  const info = document.getElementById("pet-info");
  if (info) info.textContent = PETS[pet.idx].name + " · 点击互动 · 可拖拽";
  // 持久化选择,刷新后恢复
  try { chrome.storage.local.set({ [PET_IDX_KEY]: pet.idx }); } catch (e) { /* 忽略 */ }
  petWake();
}

/** 宠物卡片是否真的在用户眼前(清爽模式 / 非当前组件页 / 眼睛隐藏 / 标签页后台 → 停帧) */
function petVisible() {
  if (!pet.stageEl) return false;
  if (!pet.cardEl) pet.cardEl = pet.stageEl.closest(".pet-card") || pet.stageEl;
  return window.isCardVisible ? window.isCardVisible(pet.cardEl) : true;
}

/** 唤醒动画循环(可见性恢复 / 状态切换 / 切回网格时调用) */
function petWake() {
  clearTimeout(pet.wakeTimer);
  if (pet.raf) return;
  if (!petVisible()) return; // 仍不可见:等下一次可见性变化再唤醒
  pet.lastNow = 0; // 重置 dt,避免长时间休眠后一次跳很远
  pet.raf = requestAnimationFrame(petTick);
}

function petTick(now) {
  pet.raf = null;
  // 不可见(清爽模式/其他组件页/后台):不再排帧,省掉整段 CPU
  if (!petVisible()) return;
  const stage = pet.stageEl;
  const img = pet.imgEl;
  if (!stage || !img) return;

  const w = stage.clientWidth || 200;
  const imgW = img.clientWidth || 80;
  pet.stageW = w;
  // 帧间隔归一化:掉帧/后台恢复后速度仍然一致(原实现固定每帧 1.6px)
  const dt = pet.lastNow ? Math.min(3, Math.max(0.2, (now - pet.lastNow) / 16.67)) : 1;
  pet.lastNow = now;

  const speed = pet.mode === "run" ? 1.6 : pet.mode === "walk" ? 0.7 : 0;

  // 移动(拖拽中不自动移动)
  if (!pet.dragging) {
    pet.x += speed * pet.dir * dt;
    if (pet.dir > 0 && pet.x + imgW > w - 4) { pet.x = w - imgW - 4; pet.dir = -1; }
    if (pet.dir < 0 && pet.x < 4) { pet.x = 4; pet.dir = 1; }
  }
  // 值没变就不写样式(原实现每帧无条件写 left + transform,持续触发样式失效)
  const left = Math.round(pet.x);
  if (left !== pet.lastLeft) { img.style.left = left + "px"; pet.lastLeft = left; }
  const flip = pet.dir < 0 ? -1 : 1;
  if (flip !== pet.lastFlip) { img.style.transform = "scaleX(" + flip + ")"; pet.lastFlip = flip; }

  // 状态机
  if (pet.mode === "swipe") {
    if (now >= pet.swipeUntil) petRandomMode();
  } else if (pet.mode === "sleep") {
    showZzz(true);
    if (now >= pet.sleepUntil) { showZzz(false); petRandomMode(); }
  } else if (now >= pet.nextAt) {
    petRandomMode();
  }

  // 只有"在动"才继续逐帧;发呆/睡觉/玩球用一次性定时器唤醒,静态页面零帧开销
  if (speed > 0 || pet.mode === "swipe" || pet.dragging) {
    pet.raf = requestAnimationFrame(petTick);
    return;
  }
  const next = pet.mode === "sleep" ? pet.sleepUntil : pet.nextAt;
  clearTimeout(pet.wakeTimer);
  pet.wakeTimer = setTimeout(petWake, Math.max(16, next - now));
}

async function initPet() {
  const stage = document.getElementById("pet-stage");
  const img = document.getElementById("pet-img");
  if (!stage || !img) return;
  // 缓存 DOM 引用供每帧 tick 使用
  pet.stageEl = stage;
  pet.imgEl = img;

  // 恢复上次选择的宠物(刷新后直接显示)
  try {
    const { [PET_IDX_KEY]: saved } = await chrome.storage.local.get(PET_IDX_KEY);
    if (typeof saved === "number" && saved >= 0 && saved < PETS.length) pet.idx = saved;
  } catch (e) { /* 忽略 */ }
  petSetFrame("idle");
  const infoEl = document.getElementById("pet-info");
  if (infoEl) infoEl.textContent = PETS[pet.idx].name + " · 点击互动 · 可拖拽";

  // 点击互动(拖拽后不触发)
  img.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (pet.dragged) return;
    petInteract();
  });

  // 拖拽(按住宠物可拖动)
  img.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    pet.dragging = true;
    pet.dragged = false;
    const rect = stage.getBoundingClientRect();
    pet.dragOffset = ev.clientX - rect.left - pet.x;
    img.setPointerCapture && img.setPointerCapture(ev.pointerId);
    petWake(); // 拖拽期间需要逐帧跟随
  });
  img.addEventListener("pointermove", (ev) => {
    if (!pet.dragging) return;
    const rect = stage.getBoundingClientRect();
    const imgW = img.clientWidth || 80;
    pet.x = Math.max(4, Math.min(pet.stageW - imgW - 4, ev.clientX - rect.left - pet.dragOffset));
    if (Math.abs(ev.movementX) > 1) pet.dragged = true;
  });
  const endDrag = () => {
    if (pet.dragging) {
      pet.dragging = false;
      setTimeout(() => { pet.dragged = false; }, 120);
    }
  };
  img.addEventListener("pointerup", endDrag);
  img.addEventListener("pointercancel", endDrag);

  // 切换 / 喂食按钮
  const sw = document.getElementById("pet-switch");
  if (sw) sw.addEventListener("click", petCycle);
  const fd = document.getElementById("pet-feed");
  if (fd) fd.addEventListener("click", petFeed);

  petRandomMode();
  petWake();
  // 切回网格模式 / 标签页回前台 / 当前组件页变化 / 眼睛按钮显示后重启动画循环
  if (window.onGridResume) window.onGridResume(petWake);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) petWake(); });
  if (typeof MutationObserver !== "undefined") {
    const pageMo = new MutationObserver(petWake);
    document.querySelectorAll(".col-page").forEach((p) =>
      pageMo.observe(p, { attributes: true, attributeFilter: ["class"] }));
    pageMo.observe(pet.cardEl || stage.closest(".pet-card") || stage, { attributes: true, attributeFilter: ["style"] });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPet);
} else {
  initPet();
}
