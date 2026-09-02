(function () {
  /**
   * 位置地图卡片:用高德公开瓦片(无 Key)拼接地图,中心显示当前位置标记。
   * 通过 URL 参数传入: map.html?lat=..&lon=..&label=城市名&zoom=13
   *
   * 瓦片按 iframe 视口尺寸动态铺(视口 = 卡片内部大小):
   * 卡片高度档位变化 → iframe resize → 瓦片覆盖范围重建,地图完整自适应卡片。
   */
  var params = new URLSearchParams(location.search);
  var lat = parseFloat(params.get("lat"));
  var lon = parseFloat(params.get("lon"));
  var label = params.get("label") || "";
  var zoomRaw = parseInt(params.get("zoom") || "13", 10);
  var zoom = Math.min(14, Math.max(10, zoomRaw || 13));
  var loading = document.getElementById("loading");
  var grid = document.getElementById("map-grid");

  var labelEl = document.getElementById("pin-label");
  if (labelEl) labelEl.textContent = label;

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    if (loading) loading.textContent = "无法定位";
    return;
  }

  var SIZE = 256;      // 瓦片像素
  var n = Math.pow(2, zoom);
  var cx = ((lon + 180) / 360) * n;
  var latRad = (lat * Math.PI) / 180;
  var cy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  var tx = Math.floor(cx);
  var ty = Math.floor(cy);
  var offX = Math.round((cx - tx) * SIZE);
  var offY = Math.round((cy - ty) * SIZE);

  var loadedCount = 0;
  function onTile() {
    loadedCount++;
    if (loading && loadedCount >= 1) loading.remove();
  }

  /* 按视口铺瓦片:中心瓦片对齐视口中心,瓦片覆盖整个视口;
   * 视口(卡片大小)变化时重建——瓦片数量/位置随卡片自适应,而非裁切。 */
  function render() {
    if (!grid) return;
    grid.innerHTML = "";
    var W = window.innerWidth;
    var H = window.innerHeight;
    if (!W || !H) return;
    // 中心瓦片左/上边缘的视口坐标(中心点在瓦片内偏移 offX/offY)
    var cLeft = W / 2 - offX;
    var cTop = H / 2 - offY;
    // 覆盖 [0,W]×[0,H] 的瓦片索引范围(相对中心瓦片的 dx/dy)
    // dx0 向下取整:最左瓦片左边缘必须 ≤ 0(含视口外补边瓦片)
    var dx0 = Math.floor((0 - cLeft) / SIZE);
    var dx1 = Math.floor((W - 1 - cLeft) / SIZE);
    var dy0 = Math.floor((0 - cTop) / SIZE);
    var dy1 = Math.floor((H - 1 - cTop) / SIZE);
    var dy, dx;
    for (dy = dy0; dy <= dy1; dy++) {
      for (dx = dx0; dx <= dx1; dx++) {
        var x = tx + dx;
        var y = ty + dy;
        var sub = ((Math.abs(x) + Math.abs(y)) % 4) + 1;
        var url = "https://webrd0" + sub + ".is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x=" + x + "&y=" + y + "&z=" + zoom;
        var t = document.createElement("div");
        t.className = "tile";
        t.style.left = Math.round(cLeft + dx * SIZE) + "px";
        t.style.top = Math.round(cTop + dy * SIZE) + "px";
        t.style.backgroundImage = "url(" + url + ")";
        grid.appendChild(t);
        // 用 Image 预加载触发 load/error 计数(div 背景图不触发 load 事件)
        var probe = new Image();
        probe.onload = onTile;
        probe.onerror = onTile;
        probe.src = url;
      }
    }
    // 网格容器覆盖视口(瓦片 absolute 定位在其中)
    grid.style.width = W + "px";
    grid.style.height = H + "px";
    grid.style.left = "0px";
    grid.style.top = "0px";
  }

  render();

  // 视口尺寸校正:iframe 加载瞬间卡片高度可能未定(fillPage 与定位异步竞态),
  // 瓦片若按初始小高度铺会偏上留白。轮询检测尺寸变化 → 重建瓦片;
  // 尺寸稳定后 lastW/lastH 相同且已有瓦片,轮询空转无开销。
  var lastW = 0;
  var lastH = 0;
  function ensureRender() {
    var W = window.innerWidth;
    var H = window.innerHeight;
    if (!W || !H) return;
    if (W === lastW && H === lastH && grid.children.length) return;
    lastW = W;
    lastH = H;
    render();
  }
  window.addEventListener("load", function () { setTimeout(ensureRender, 50); });
  setInterval(ensureRender, 300);
  // 卡片档位切换 → iframe 尺寸变化 → resize 重建(防抖)
  var rt = null;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(ensureRender, 120);
  });

  // 兜底:无论瓦片是否加载成功,3 秒后移除"加载中"提示
  setTimeout(function () {
    if (loading) loading.remove();
  }, 3000);
})();
