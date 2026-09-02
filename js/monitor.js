"use strict";

/* =========================================================
 * 系统监控:CPU(两次采样差值)+ 内存(Chrome system API)
 * ======================================================== */

const monitor = { prevCpu: null, prevTime: 0 };

function monitorRender(cpuPct, memInfo) {
  const cpuBar = document.getElementById("cpu-bar");
  const cpuVal = document.getElementById("cpu-val");
  const memBar = document.getElementById("mem-bar");
  const memVal = document.getElementById("mem-val");
  const memText = document.getElementById("monitor-mem");
  if (cpuBar && cpuVal) {
    cpuBar.style.width = Math.min(100, Math.max(0, cpuPct)) + "%";
    cpuBar.classList.toggle("high", cpuPct > 85);
    cpuVal.textContent = cpuPct.toFixed(0) + "%";
  }
  if (memInfo && memBar && memVal) {
    const total = memInfo.capacity;
    const used = total - memInfo.availableCapacity;
    const pct = total ? (used / total) * 100 : 0;
    memBar.style.width = Math.min(100, Math.max(0, pct)) + "%";
    memBar.classList.toggle("high", pct > 85);
    memVal.textContent = pct.toFixed(0) + "%";
    const gb = (v) => (v / 1024 / 1024 / 1024).toFixed(1);
    if (memText) memText.textContent = "可用 " + gb(memInfo.availableCapacity) + " GB / " + gb(total) + " GB";
  }
}

async function monitorTick() {
  // 清爽模式守卫:会话内切到清爽模式后停止采样(卡片隐藏,无谓的 system API 轮询)
  if (document.body.classList.contains("mode-clean")) return;
  if (!chrome.system || !chrome.system.cpu) { monitorRender(0, null); return; }
  try {
    const info = await chrome.system.cpu.getInfo();
    const now = performance.now();
    let pct = 0;
    if (monitor.prevCpu && info.processors.length) {
      const totalDelta = info.processors.reduce((s, p) => s + p.usage.total, 0) - monitor.prevCpu.total;
      const idleDelta = info.processors.reduce((s, p) => s + p.usage.idle, 0) - monitor.prevCpu.idle;
      if (totalDelta > 0) pct = (1 - idleDelta / totalDelta) * 100;
    }
    monitor.prevCpu = {
      total: info.processors.reduce((s, p) => s + p.usage.total, 0),
      idle: info.processors.reduce((s, p) => s + p.usage.idle, 0),
    };
    monitor.prevTime = now;
    const mem = await chrome.system.memory.getInfo();
    monitorRender(pct, mem);
  } catch (e) {
    monitorRender(0, null);
  }
}

function initMonitor() {
  monitorTick();
  setInterval(monitorTick, 2000); // 2s 刷新
  // 切回网格模式:立即采样一次(清爽模式期间被守卫跳过)
  if (window.onGridResume) window.onGridResume(monitorTick);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMonitor);
} else {
  initMonitor();
}
