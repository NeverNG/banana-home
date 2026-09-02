# AGENTS.md — banana-home 项目开发规范

Chrome MV3 新标签页扩展「香蕉起始页」v1.4.0（`D:\test1\banana-home`）。
入口 `index.html`，覆盖 `chrome_url_overrides.newtab`；service worker 为 `background.js`。

## 硬性规范：网格/清爽模式的资源加载门控

**清爽模式刷新页面时，除三个基础脚本外不得加载任何网格资源。** 所有功能改动必须符合：

| 资源 | 清爽模式 | 网格模式 |
|---|---|---|
| 基础脚本 `gridgate.js` / `activity.js` / `main.js` | 加载 | 加载 |
| 组件脚本 calendar/colpager/pet/music/monitor/hot/stock/dreamcar | **不注入** | 动态注入 |
| 书签/快捷方式数据、AI 描述队列 | 不加载 | 加载 |
| 网络接口（热榜/股票/天气/名言/定位/壁纸） | 不请求 | 请求 |
| 图片/音频等媒体文件 | 不请求 | 用户交互时才加载 |

### 落地机制（改动时必须遵守）

1. **组件脚本不进 `index.html`**：`<script>` 只能出现在 main.js 的 `GRID_SCRIPTS` 门控数组（约 3589 行），由 `loadGridScripts()` 在网格模式动态注入。
2. **媒体文件不静态引用**：图片/音频不得以 `<img>`/`<audio>` 等标签写死在 `index.html`；必须在组件 JS 运行时创建/引用（如 `new Audio()`、`new Image()`），否则清爽模式也会被浏览器加载。
3. **网络请求走门控**：接口获取必须用 `window.__whenGrid(fn)` 包裹（gridgate.js 定义；`__gridLocked` 锁定期间或 `mode-clean` 时排队，切回网格统一 flush）。
4. **持久化恢复只在组件脚本内**：storage 读取/恢复逻辑放在组件 JS（如 `initMusic` 恢复白噪音），清爽模式不注入即不执行。
5. **`window.__gridLocked` 解锁只能由 gridgate 的 `applyMode` 和 main.js 的 `applyHomeMode` 置 false**（双 flush 时序约定，勿新增解锁点）。
6. **跨模式共享的常量/默认值表必须放 `gridgate.js`**（所有模式都加载的基础脚本），不能放门控注入的组件脚本里——否则清爽模式（colpager 等未注入）下设置窗口读不到默认值（事故：`DEFAULT_CARD_HEIGHTS` 曾定义在 colpager.js，清爽模式点「默认」把卡片错误钉成 1/4）。组件脚本用 `const X = window.X || {}` 引用兜底。
   **跨脚本机制/注册器同理**：`onCardHeight` 注册器必须定义在 gridgate.js——calendar.js/main.js 等先于 colpager.js 注入，若注册器定义在 colpager，它们的 `window.onCardHeight && ...` 注册会静默失败（事故：日历切 1/4 不切换周视图）。
7. **模式切换用 `body.mode-clean`**；搜索栏居中位移用 `margin-top`（勿用 `transform`，会破坏内部 fixed 浮层包含块）；`body.no-anim` 控制刷新不播动画。
8. **扩展页面禁内联脚本（含 iframe 加载的本地 html）**：MV3 默认 CSP `script-src 'self'` 禁止内联 `<script>`，且同样约束 iframe 内文档——新增/复制的页面（如 `综合罗盘.html`）内联脚本不会执行（事故：综合罗盘内联渲染脚本在 ☯ 弹窗 iframe 中白屏，须拆为外部 `综合罗盘.js` 后 `<script src>` 引用）。内联 `<style>` 不受限。

## 其他开发约定

- **UI 风格一致化（硬性）**：新增/修改任何 UI 元素，视觉风格必须与现有组件一致——
  - 卡片头部标题用 `.widget-head` + `.widget-title`（左对齐）；头部右侧操作区用 `.widget-actions`（须含 `align-items: center`，时间/按钮与标题垂直居中）
  - 按钮风格统一为玻璃半透明系（`.alpha-default` / `.btn-ghost` / `.mini-btn` / `.engine-row-ops button`），**不要引入新的实色按钮**（`.btn-primary` 仅保留给弹窗主操作）除非用户明确指定
  - 弹窗列表/管理界面参照现有范式（引擎管理：`.engine-row` 拖拽排序 + 行内操作按钮）
  - **滚动条风格统一**：任何可滚动容器（弹窗列表/搜索下拉等）必须配 `scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.3) transparent;` + `::-webkit-scrollbar { width: 6px }` + `::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.3); border-radius: 3px }`，与 `.bm-groups` 一致
  - **下拉/浮层风格统一**：弹出下拉（搜索建议、联想列表等）必须用磨砂玻璃风格——`background: rgba(255,255,255,var(--widget-glass,0.14))` + `backdrop-filter: blur(20px)` + `border: 1px solid var(--glass-border)` + `border-radius: 14px` + `box-shadow: 0 12px 36px rgba(0,0,0,0.4)`，列表项 `padding: 8px 12px` + `border-radius: 8px` + hover 半透明，与 `.engine-picker` / `.search-dropdown` 一致
  - **`[hidden]` 规则**：任何设置了 `display: flex`/`grid` 的元素，必须同时写 `X[hidden] { display: none; }`（`display` 会覆盖 `hidden` 属性的默认样式，曾导致自选股下拉未输入就显示）
  - **flex 父容器下子元素高度**：不要用 `height: 100%`（在 flex 布局父容器中不生效，iframe 等 replaced 元素会回落默认 150px，曾导致地图卡下方大片空白）——子元素用 `flex: 1` 拉伸，父容器设 `display: flex; flex-direction: column`
  - **动态高度卡片必须 `box-sizing: border-box`**：`min-height` 默认作用于 content-box，padding/border 会加在高度之外（名言卡 2/4 曾超组件栏 30px）；凡由 fillPage 设高度的卡片（`.col-page > *`）必须 border-box，并同步把卡片间距（`margin-bottom 14px`）从可用高度扣除
  - **fillPage 设高度用 `height` 而非 `min-height`**：只有确定 `height` 时卡片内部 `flex: 1` 子元素（宠物舞台/音乐封面等）才会拉伸填充；`min-height` 不参与 flex 分配（宠物图片曾因舞台高 0 不可见）。改 flex 布局后必须用 CDP 确认 `getComputedStyle(card).display === 'flex'`（multi_edit 原子失败时改动可能根本没应用）
  - **改组合选择器前先确认**：`.hot-card, .stock-card, .monitor-card { ... }` 是共享块——曾误把 `display:flex + justify-content:center` 加进组合块，导致热榜内容超高时居中溢出、标题被推到卡片上方。flex 布局改动要逐卡验证（`getBoundingClientRect` 确认头部在卡片范围内），不要依赖"好像改对了"
  - 新增 CSS 前先查现有类是否可复用，避免风格漂移
- **存储 key 命名**：`chrome.storage.local` 持久化用户配置；`chrome.storage.session` 放缓存（书签列表/定位/壁纸）。新 key 若要随"导出配置"走，必须加入 `EXPORT_KEYS`（main.js）。
- **TDZ 陷阱**：顶层数组/对象初始化时引用的 `const` 必须**已在其之前定义**，或用字符串字面量（历史事故：`SAVED_WP_KEY` 定义在 `EXPORT_KEYS` 之后导致 main.js 加载崩溃）。`node --check` 查不出这类运行时错误。
- **门控验证**：改动资源加载相关代码后，用真实浏览器 CDP（`Extensions.loadUnpacked` + 检查 `document.scripts`）或 vm mock 测试验证清爽模式零组件脚本；纯逻辑改动至少 `node --check` + 针对性 vm 测试。
- **用户习惯**：Chrome `chrome://extensions` 开发者模式加载已解压扩展自测，不自动打包 exe/zip。
- **SVG 内文字样式必须内联属性**：HTML 文档中 CSS **类型选择器**（如 `svg text { fill: ... }`）不匹配 SVG 命名空间的元素——`<text>` 属于 SVG 命名空间，`text` 类型选择器只匹配 HTML 命名空间，导致文字保持默认黑色不可见（事故：综合罗盘 23 环 702 个文字全部丢失，`#evo-chart text{fill}` 未生效）。**How to apply:** 给 SVG 内 text 直接设 `fill` 内联属性（如 compass.js `mkText` 的 `fill:"#e8dcc0"`），不依赖 CSS 类型选择器；CSS 规则可用 `.evo-frame svg * { }` 或仅作兜底。
- **测试临时文件**：`*.cjs`/`*.mjs`/`*.py` 测试脚本**禁止放在扩展根目录且禁止 `_` 开头**——Chrome `chrome://extensions` 加载扩展时拒绝 `_` 开头（或系统保留名）的文件，整个扩展无法加载（事故：`_tmp_check3.py` 留在根目录导致「无法加载清单」）。临时脚本一律放系统临时目录（如 `%TEMP%`），用后删除，根目录零残留。
