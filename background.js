"use strict";

/**
 * Service Worker(Manifest V3)
 * 1) 读取 Chrome 收藏夹树 → 展平为书签列表 → 写入 chrome.storage.session,
 *    监听书签增/删/改/移事件实时刷新;
 * 2) 为书签 AI 生成【简短标题 + 一句话描述】:抓取网页文本 → 一次 DeepSeek
 *    调用同时产出两者 → 分别缓存到 chrome.storage.local。结果三态:
 *    ok / failed(标记后页面提示手动维护)/ no-key(未配置 API Key)。
 *    手动维护过的书签(manualDesc 标记)不会被自动生成覆盖。
 */

const BOOKMARK_CACHE_KEY = "bookmarks"; // session: 书签列表
const DESC_KEY = "descriptions";        // local: { [url]: 一句话描述 }
const TITLE_KEY = "titles";             // local: { [url]: 简短标题 }
const DESC_FAIL_KEY = "descFailed";     // local: { [url]: true } 访问失败标记
const MANUAL_KEY = "manualDesc";        // local: { [url]: true } 用户手动维护过
const API_KEY_STORAGE = "deepseekApiKey";
const API_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-chat";
const FETCH_TIMEOUT_MS = 8000;
const MAX_TEXT_LEN = 2500;

/* ================= 收藏夹 ================= */

async function collectBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const items = [];

  function walk(nodes, path) {
    for (const node of nodes) {
      if (node.url) {
        items.push({ id: node.id, title: node.title || node.url, url: node.url, path });
      }
      if (node.children) {
        // 根节点(无标题)不加入路径,避免产生空路径段
        const nextPath = node.url ? path : node.title ? [...path, node.title] : path;
        walk(node.children, nextPath);
      }
    }
  }

  walk(tree, []);
  return items;
}

async function refreshCache() {
  const items = await collectBookmarks();
  await chrome.storage.session.set({ [BOOKMARK_CACHE_KEY]: items });
  return items;
}

refreshCache();

for (const eventName of ["onCreated", "onRemoved", "onChanged", "onMoved", "onChildrenReordered"]) {
  chrome.bookmarks[eventName].addListener(() => refreshCache());
}

/* ================= 网页文本提取 ================= */

async function fetchPageText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      redirect: "follow",
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    return extractText(html);
  } finally {
    clearTimeout(timer);
  }
}

/** 简易 HTML → 纯文本:剔除脚本/样式/标签,解码实体,压缩空白 */
function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_LEN);
}

/* ================= DeepSeek 标题+描述 ================= */

async function getApiKey() {
  const { [API_KEY_STORAGE]: key } = await chrome.storage.local.get(API_KEY_STORAGE);
  return key && key.trim() ? key.trim() : null;
}

/** 获取 DeepSeek 可用模型列表,失败时返回原因 */
async function getDeepSeekModels(key, baseUrl) {
  if (!key) key = await getApiKey();
  if (!key) return { models: [], error: "未配置 API Key" };
  // 模型地址基于用户设置的 base_url(消息传入优先,否则读 storage)
  if (!baseUrl) {
    baseUrl = "https://api.deepseek.com";
    try {
      const r = await chrome.storage.local.get("baseUrl");
      if (r && r.baseUrl) baseUrl = r.baseUrl;
    } catch (e) { /* 忽略 */ }
  }
  const modelsUrl = baseUrl.replace(/\/+$/, "") + "/models";
  registerApi("DeepSeek 模型", "获取可用模型版本", modelsUrl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const resp = await apiFetch(modelsUrl, {
      signal: ctrl.signal,
      headers: { Authorization: "Bearer " + key },
    }, { name: "DeepSeek 模型", desc: "获取可用模型版本" });
    if (!resp.ok) {
      const reason = resp.status === 401 ? "API Key 无效或已过期" : "服务返回 " + resp.status;
      return { models: [], error: reason };
    }
    const data = await resp.json();
    const list = (Array.isArray(data?.data) ? data.data : [])
      .map((m) => m && m.id)
      .filter((id) => id && /^deepseek/i.test(id));
    const all = Array.isArray(data?.data) ? data.data.map((m) => m && m.id).filter(Boolean) : [];
    return { models: list.length ? list : all, error: "" };
  } catch (err) {
    return { models: [], error: "网络错误,请检查网络后重试" };
  } finally {
    clearTimeout(timer);
  }
}

/** AI 生成名言解释(用配置的 DeepSeek) */
async function explainQuote(text, from) {
  const key = await getApiKey();
  if (!key) return { status: "no-key", explain: "" };
  let baseUrl = "https://api.deepseek.com";
  let model = "deepseek-chat";
  try {
    const r = await chrome.storage.local.get(["baseUrl", "model"]);
    if (r && r.baseUrl) baseUrl = r.baseUrl;
    if (r && r.model) model = r.model;
  } catch (e) { /* 忽略 */ }
  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "你是名言解释助手。用简洁中文(60字以内)解释这句名言的含义与启发,直接输出解释内容,不要前缀、不要引号。" },
          { role: "user", content: text + (from ? "\n出处:" + from : "") },
        ],
        max_tokens: 150,
      }),
    });
    clearTimeout(timer);
    if (!resp.ok) return { status: "failed", explain: "" };
    const data = await resp.json();
    const explain = (
      (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || ""
    ).trim();
    return { status: explain ? "ok" : "failed", explain };
  } catch (e) {
    clearTimeout(timer);
    return { status: "failed", explain: "" };
  }
}

/** AI 生成卦象解卦(用配置的 DeepSeek):按卦象信息生成简短今日解读 */
async function generateGuaci(gua, model, baseUrl) {
  const key = await getApiKey();
  if (!key) return { status: "no-key", text: "" };
  let bUrl = "https://api.deepseek.com", mdl = "deepseek-chat";
  try {
    const r = await chrome.storage.local.get(["baseUrl", "model"]);
    if (r && r.baseUrl) bUrl = r.baseUrl;
    if (r && r.model) mdl = r.model;
  } catch (e) { /* 忽略 */ }
  if (model) mdl = model;
  if (baseUrl) bUrl = baseUrl;
  const url = buildChatUrl(bUrl); /* 复用:已含 /chat/completions 不重复拼接 */
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model: mdl,
        messages: [
          { role: "system", content: "你是周易解卦助手。根据给出的卦象信息,用简洁中文(50字以内)给出一条贴合卦象的解读与建议,直接输出解读内容,不要前缀、不要重复卦名、不要引号。" },
          { role: "user", content: "卦象信息:" + gua },
        ],
        max_tokens: 150,
        temperature: 0.8,
      }),
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    const text = (data?.choices?.[0]?.message?.content || "").trim();
    return text ? { status: "ok", text } : { status: "empty" };
  } catch (e) {
    return { status: "failed" };
  } finally {
    clearTimeout(timer);
  }
}

/** 根据用户配置的 base_url 拼出 chat/completions 地址 */
function buildChatUrl(baseUrl) {
  if (!baseUrl) return API_URL;
  const b = String(baseUrl).trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(b)) return b;
  return b + "/chat/completions";
}

async function askDeepSeek(pageText, title, model, baseUrl) {
  registerApi("DeepSeek API", "AI 生成书签标题与简介", buildChatUrl(baseUrl) || "https://api.deepseek.com/chat/completions");
  const key = await getApiKey();
  if (!key) throw new Error("NO_API_KEY");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await apiFetch(buildChatUrl(baseUrl), {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: model || MODEL,
        messages: [
          {
            role: "system",
            content:
              "你是网页信息整理助手。根据给出的网页标题与正文,输出两行:\n" +
              "第一行以「标题:」开头,给出不超过14个字的简洁中文标题,提炼核心用途,去掉无意义的修饰词;\n" +
              "第二行以「描述:」开头,给出不超过30个字的一句话中文描述。\n" +
              "不要输出任何其他内容。",
          },
          { role: "user", content: `网页原标题:${title}\n网页正文:${pageText}` },
        ],
        max_tokens: 200,
        temperature: 0.3,
      }),
    });
    if (!resp.ok) throw new Error(`API HTTP ${resp.status}`);
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("EMPTY_RESPONSE");

    // 解析两行:容错处理前缀缺失的情况
    let aiTitle = "";
    let aiDesc = "";
    const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (/^标题[:：]/.test(line)) aiTitle = line.replace(/^标题[:：]\s*/, "");
      else if (/^描述[:：]/.test(line)) aiDesc = line.replace(/^描述[:：]\s*/, "");
      else if (!aiTitle) aiTitle = line; // 第一行兜底当标题
      else if (!aiDesc) aiDesc = line;   // 后续行兜底当描述
    }
    return { title: aiTitle, text: aiDesc };
  } finally {
    clearTimeout(timer);
  }
}

/** 统一写缓存:标题/描述/失败标记/手动标记 */
async function updateStore(url, { title, text, failed, manual }) {
  const cur = await chrome.storage.local.get([DESC_KEY, TITLE_KEY, DESC_FAIL_KEY, MANUAL_KEY]);
  const descStore = { ...(cur[DESC_KEY] || {}) };
  const titleStore = { ...(cur[TITLE_KEY] || {}) };
  const failStore = { ...(cur[DESC_FAIL_KEY] || {}) };
  const manualStore = { ...(cur[MANUAL_KEY] || {}) };

  if (failed) {
    failStore[url] = true;
  } else {
    if (text) descStore[url] = text;
    if (title) titleStore[url] = title;
    delete failStore[url];
  }
  if (manual) manualStore[url] = true;
  else delete manualStore[url];

  await chrome.storage.local.set({
    [DESC_KEY]: descStore,
    [TITLE_KEY]: titleStore,
    [DESC_FAIL_KEY]: failStore,
    [MANUAL_KEY]: manualStore,
  });
}

/**
 * 为一个 URL 生成标题+描述(带并发锁)。
 * 返回: { status: "ok", title, text } | { status: "failed" } | { status: "no-key" }
 * force=true 时绕过失败标记与手动标记,用于"AI 重新生成"。
 */
/* ===== 统一 API 注册表:任何新 API 调用走 apiFetch(url, opts, {name, desc}) 即自动登记 ===== */
const apiRegistry = [];

function registerApi(name, desc, url) {
  if (!name || !url) return;
  // 同名覆盖:最新注册的 URL 取代旧条目(避免改配置后旧地址残留)
  const idx = apiRegistry.findIndex((a) => a.name === name);
  if (idx >= 0) {
    apiRegistry[idx] = { name, desc: desc || "", url };
    return;
  }
  apiRegistry.push({ name, desc: desc || "", url });
}

/** 统一网络请求入口:记录 API 后透传 fetch */
async function apiFetch(url, opts, meta) {
  if (meta && meta.name) registerApi(meta.name, meta.desc || "", typeof url === "string" ? url : "");
  return fetch(url, opts);
}

const inFlight = new Map();
let activeGens = 0; // 当前并发生成数
const MAX_CONCURRENT = 2; // 最多同时处理 2 个书签(避免打爆 DeepSeek / 消息堆积)
const genWaiters = [];

async function describeBookmark(url, title, force = false, model, baseUrl) {
  if (inFlight.has(url)) return inFlight.get(url);

  const task = (async () => {
    // 并发闸门:最多同时 2 个,其余排队
    while (activeGens >= MAX_CONCURRENT) await new Promise((r) => genWaiters.push(r));
    activeGens++;
    try {
    const { [DESC_KEY]: cache, [TITLE_KEY]: titleCache, [DESC_FAIL_KEY]: failedCache, [MANUAL_KEY]: manualCache } =
      await chrome.storage.local.get([DESC_KEY, TITLE_KEY, DESC_FAIL_KEY, MANUAL_KEY]);

    // 已有完整结果(标题+描述都有)且非强制:直接返回,不重复调用
    if (!force && cache?.[url] && titleCache?.[url]) {
      return { status: "ok", title: titleCache[url], text: cache[url] };
    }
    // 手动维护过的书签,非强制时不再自动覆盖
    if (!force && manualCache?.[url]) {
      return { status: "ok", title: titleCache?.[url] || "", text: cache?.[url] || "" };
    }
    // 已标记失败且非强制:直接返回 failed,避免反复访问局域网超时
    if (!force && failedCache?.[url]) return { status: "failed" };

    const key = await getApiKey();
    if (!key) return { status: "no-key" };

    try {
      const text = await fetchPageText(url);
      if (!text) throw new Error("EMPTY_PAGE");
      const res = await askDeepSeek(text, title, model, baseUrl);
      if (!res || (!res.title && !res.text)) throw new Error("EMPTY_RESPONSE");

      await updateStore(url, { title: res.title, text: res.text, failed: false });
      return { status: "ok", title: res.title, text: res.text };
    } catch {
      await updateStore(url, { failed: true });
      return { status: "failed" };
    }
    } finally {
      activeGens--;
      if (genWaiters.length) genWaiters.shift()();
    }
  })();

  inFlight.set(url, task);
  task.finally(() => inFlight.delete(url));
  return task;
}

/* ================= IP 地理位置 + 天气 ================= */
/**
 * 获取当前出口 IP 及地理位置:依次尝试多个免费 IP 服务(逐个降级),
 * 拿到经纬度后再用 Open-Meteo(免费无 Key)查询当地天气。
 * 结果缓存到 chrome.storage.session:位置 6 小时,天气 30 分钟;force 强制全量刷新。
 */
const GEO_CACHE_KEY = "geoInfo_v2"; // session: { t, wt, data } (v2:天气 daily 6 天,旧缓存自动失效)
const GEO_TTL_MS = 6 * 60 * 60 * 1000;   // 位置缓存 6h
const WEATHER_TTL_MS = 30 * 60 * 1000;   // 天气缓存 30min

/** WMO 天气代码 → 中文描述 */
function weatherDesc(code) {
  if (code === 0) return "晴";
  if (code === 1) return "基本晴朗";
  if (code === 2) return "多云";
  if (code === 3) return "阴";
  if (code >= 45 && code <= 48) return "有雾";
  if (code >= 51 && code <= 57) return "毛毛雨";
  if (code >= 61 && code <= 65) return "降雨";
  if (code === 66 || code === 67) return "冻雨";
  if (code >= 71 && code <= 77) return "降雪";
  if (code >= 80 && code <= 82) return "阵雨";
  if (code >= 85 && code <= 86) return "阵雪";
  if (code >= 95) return "雷阵雨";
  return "未知";
}

/**
 * 并行请求所有 IP 服务(互不等待),Promise.any 取最快成功的一个。
 * 每个源 4s 超时,整体通常 1~2s 返回。
 */
async function fetchGeo() {
  registerApi("IP 定位", "出口 IP 与地理定位(ip-api)", "http://ip-api.com/json/?lang=zh-CN&fields=status,query,country,regionName,city,lat,lon");
  registerApi("IP 定位备用", "出口 IP 与地理定位(ipinfo)", "https://ipinfo.io/json");
  const sources = [
    {
      url: "http://ip-api.com/json/?lang=zh-CN&fields=status,query,country,regionName,city,lat,lon", // 免费版仅 HTTP 可用(HTTPS 403)
      parse: (d) =>
        d && d.status === "success"
          ? { ip: d.query, country: d.country, region: d.regionName, city: d.city, lat: d.lat, lon: d.lon }
          : null,
    },
    {
      url: "https://ipinfo.io/json",
      parse: (d) => {
        if (!d || !d.ip) return null;
        const [lat, lon] = (d.loc || ",").split(",").map(Number);
        return {
          ip: d.ip,
          country: d.country,
          region: d.region,
          city: d.city,
          lat,
          lon,
        };
      },
    },
    {
      url: "https://api.ip.sb/geoip",
      parse: (d) =>
        d && d.ip
          ? {
              ip: d.ip,
              country: d.country,
              region: d.region,
              city: d.city,
              lat: d.latitude,
              lon: d.longitude,
            }
          : null,
    },
  ];

  const attempts = sources.map((src) =>
    (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      try {
        const resp = await fetch(src.url, { signal: ctrl.signal });
        if (!resp.ok) throw new Error("http " + resp.status);
        const data = src.parse(await resp.json());
        if (!data || !data.ip) throw new Error("bad data");
        return data;
      } finally {
        clearTimeout(timer);
      }
    })()
  );

  try {
    return await Promise.any(attempts); // 第一个成功的源胜出
  } catch {
    return null;
  }
}

/** 常用中国城市:中文名 → 天气网拼音(与 tianqi.com 的 py 参数一致) */
const CITY_PY = {
  "北京市": "beijing", "上海市": "shanghai", "天津市": "tianjin", "重庆市": "chongqing",
  "太原市": "taiyuan", "大同市": "datong", "阳泉市": "yangquan", "长治市": "changzhi", "晋城市": "jincheng", "朔州市": "shuozhou", "晋中市": "jinzhong", "运城市": "yuncheng", "忻州市": "xinzhou", "临汾市": "linfen", "吕梁市": "lvliang",
  "呼和浩特市": "huhehaote", "包头市": "baotou", "乌海市": "wuhai", "赤峰市": "chifeng", "通辽市": "tongliao", "鄂尔多斯市": "eerduosi", "呼伦贝尔市": "hulunbeier", "巴彦淖尔市": "bayannaoer", "乌兰察布市": "wulanchabu",
  "石家庄市": "shijiazhuang", "唐山市": "tangshan", "秦皇岛市": "qinhuangdao", "邯郸市": "handan", "邢台市": "xingtai", "保定市": "baoding", "张家口市": "zhangjiakou", "承德市": "chengde", "沧州市": "cangzhou", "廊坊市": "langfang", "衡水市": "hengshui",
  "沈阳市": "shenyang", "大连市": "dalian", "鞍山市": "anshan", "抚顺市": "fushun", "本溪市": "benxi", "丹东市": "dandong", "锦州市": "jinzhou", "营口市": "yingkou", "阜新市": "fuxin", "辽阳市": "liaoyang", "盘锦市": "panjin", "铁岭市": "tieling", "朝阳市": "chaoyang", "葫芦岛市": "huludao",
  "长春市": "changchun", "吉林市": "jilin", "四平市": "siping", "辽源市": "liaoyuan", "通化市": "tonghua", "白山市": "baishan", "松原市": "songyuan", "白城市": "baicheng",
  "哈尔滨市": "haerbin", "齐齐哈尔市": "qiqihaer", "鸡西市": "jixi", "鹤岗市": "hegang", "双鸭山市": "shuangyashan", "大庆市": "daqing", "伊春市": "yichun", "佳木斯市": "jiamusi", "七台河市": "qitaihe", "牡丹江市": "mudanjiang", "黑河市": "heihe", "绥化市": "suihua",
  "南京市": "nanjing", "无锡市": "wuxi", "徐州市": "xuzhou", "常州市": "changzhou", "苏州市": "suzhou", "南通市": "nantong", "连云港市": "lianyungang", "淮安市": "huaian", "盐城市": "yancheng", "扬州市": "yangzhou", "镇江市": "zhenjiang", "泰州市": "taizhou", "宿迁市": "suqian",
  "杭州市": "hangzhou", "宁波市": "ningbo", "温州市": "wenzhou", "嘉兴市": "jiaxing", "湖州市": "huzhou", "绍兴市": "shaoxing", "金华市": "jinhua", "衢州市": "quzhou", "舟山市": "zhoushan", "台州市": "taizhou", "丽水市": "lishui",
  "合肥市": "hefei", "芜湖市": "wuhu", "蚌埠市": "bengbu", "淮南市": "huainan", "马鞍山市": "maanshan", "淮北市": "huaibei", "铜陵市": "tongling", "安庆市": "anqing", "黄山市": "huangshan", "滁州市": "chuzhou", "阜阳市": "fuyang", "宿州市": "suzhou", "六安市": "liuan", "亳州市": "bozhou", "池州市": "chizhou", "宣城市": "xuancheng",
  "福州市": "fuzhou", "厦门市": "xiamen", "莆田市": "putian", "三明市": "sanming", "泉州市": "quanzhou", "漳州市": "zhangzhou", "南平市": "nanping", "龙岩市": "longyan", "宁德市": "ningde",
  "南昌市": "nanchang", "景德镇市": "jingdezhen", "萍乡市": "pingxiang", "九江市": "jiujiang", "新余市": "xinyu", "鹰潭市": "yingtan", "赣州市": "ganzhou", "吉安市": "jian", "宜春市": "yichun", "抚州市": "fuzhou", "上饶市": "shangrao",
  "济南市": "jinan", "青岛市": "qingdao", "淄博市": "zibo", "枣庄市": "zaozhuang", "东营市": "dongying", "烟台市": "yantai", "潍坊市": "weifang", "济宁市": "jining", "泰安市": "taian", "威海市": "weihai", "日照市": "rizhao", "临沂市": "linyi", "德州市": "dezhou", "聊城市": "liaocheng", "滨州市": "binzhou", "菏泽市": "heze",
  "郑州市": "zhengzhou", "开封市": "kaifeng", "洛阳市": "luoyang", "平顶山市": "pingdingshan", "安阳市": "anyang", "鹤壁市": "hebi", "新乡市": "xinxiang", "焦作市": "jiaozuo", "濮阳市": "puyang", "许昌市": "xuchang", "漯河市": "luohe", "三门峡市": "sanmenxia", "南阳市": "nanyang", "商丘市": "shangqiu", "信阳市": "xinyang", "周口市": "zhoukou", "驻马店市": "zhumadian",
  "武汉市": "wuhan", "黄石市": "huangshi", "十堰市": "shiyan", "宜昌市": "yichang", "襄阳市": "xiangyang", "鄂州市": "ezhou", "荆门市": "jingmen", "孝感市": "xiaogan", "荆州市": "jingzhou", "黄冈市": "huanggang", "咸宁市": "xianning", "随州市": "suizhou",
  "长沙市": "changsha", "株洲市": "zhuzhou", "湘潭市": "xiangtan", "衡阳市": "hengyang", "邵阳市": "shaoyang", "岳阳市": "yueyang", "常德市": "changde", "张家界市": "zhangjiajie", "益阳市": "yiyang", "郴州市": "chenzhou", "永州市": "yongzhou", "怀化市": "huaihua", "娄底市": "loudi",
  "广州市": "guangzhou", "韶关市": "shaoguan", "深圳市": "shenzhen", "珠海市": "zhuhai", "汕头市": "shantou", "佛山市": "foshan", "江门市": "jiangmen", "湛江市": "zhanjiang", "茂名市": "maoming", "肇庆市": "zhaoqing", "惠州市": "huizhou", "梅州市": "meizhou", "汕尾市": "shanwei", "河源市": "heyuan", "阳江市": "yangjiang", "清远市": "qingyuan", "东莞市": "dongguan", "中山市": "zhongshan", "潮州市": "chaozhou", "揭阳市": "jieyang", "云浮市": "yunfu",
  "南宁市": "nanning", "柳州市": "liuzhou", "桂林市": "guilin", "梧州市": "wuzhou", "北海市": "beihai", "防城港市": "fangchenggang", "钦州市": "qinzhou", "贵港市": "guigang", "玉林市": "yulin", "百色市": "baise", "贺州市": "hezhou", "河池市": "hechi", "来宾市": "laibin", "崇左市": "chongzuo",
  "海口市": "haikou", "三亚市": "sanya",
  "成都市": "chengdu", "自贡市": "zigong", "攀枝花市": "panzhihua", "泸州市": "luzhou", "德阳市": "deyang", "绵阳市": "mianyang", "广元市": "guangyuan", "遂宁市": "suining", "内江市": "neijiang", "乐山市": "leshan", "南充市": "nanchong", "眉山市": "meishan", "宜宾市": "yibin", "广安市": "guangan", "达州市": "dazhou", "雅安市": "yaan", "巴中市": "bazhong", "资阳市": "ziyang",
  "贵阳市": "guiyang", "六盘水市": "liupanshui", "遵义市": "zunyi", "安顺市": "anshun",
  "昆明市": "kunming", "曲靖市": "qujing", "玉溪市": "yuxi", "保山市": "baoshan", "昭通市": "zhaotong", "丽江市": "lijiang", "普洱市": "puer", "临沧市": "lincang",
  "拉萨市": "lasa",
  "西安市": "xian", "铜川市": "tongchuan", "宝鸡市": "baoji", "咸阳市": "xianyang", "渭南市": "weinan", "延安市": "yanan", "汉中市": "hanzhong", "榆林市": "yulin", "安康市": "ankang", "商洛市": "shangluo",
  "兰州市": "lanzhou", "嘉峪关市": "jiayuguan", "金昌市": "jinchang", "白银市": "baiyin", "天水市": "tianshui", "武威市": "wuwei", "张掖市": "zhangye", "平凉市": "pingliang", "酒泉市": "jiuquan", "庆阳市": "qingyang", "定西市": "dingxi", "陇南市": "longnan",
  "西宁市": "xining",
  "银川市": "yinchuan", "石嘴山市": "shizuishan", "吴忠市": "wuzhong", "固原市": "guyuan",
  "乌鲁木齐市": "wulumuqi", "克拉玛依市": "kelamayi", "吐鲁番市": "tulufan", "哈密市": "hami",
};

/** 经纬度反查最近城市(BigDataCloud,免费无 Key):返回 { city, region, py } 或 null */
async function reverseCity(lat, lon) {
  if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) return null;
  try {
    const url =
      "https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=" +
      lat +
      "&longitude=" +
      lon +
      "&localityLanguage=zh";
    registerApi("BigDataCloud", "经纬度反查城市名", url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const d = await resp.json();
    if (!d || !d.city) return null;
    return {
      city: d.city,
      region: d.principalSubdivision || "",
      py: CITY_PY[d.city] || null,
    };
  } catch {
    return null;
  }
}

/** 用 ip-api 英文接口补充城市拼音(中文源拿不到时) */

/** 验证天气网拼音是否有效:组件 HTML 会包含 www.tianqi.com/<py>/;无效时默认显示北京 */

/** Open-Meteo 免费天气(无需 Key):{ temp, code, desc, wind } 或 null */
async function fetchWeather(lat, lon) {
  if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) return null;
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      "&current=temperature_2m,weather_code,wind_speed_10m" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=6" +
      "&timezone=auto";
    registerApi("Open-Meteo", "天气查询(当前经纬度)", url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const d = await resp.json();
    const c = d?.current;
    if (!c) return null;
    const daily = (d.daily && d.daily.time ? d.daily.time : []).map((date, i) => ({
      date,
      tempMax: Math.round(d.daily.temperature_2m_max[i]),
      tempMin: Math.round(d.daily.temperature_2m_min[i]),
      code: d.daily.weather_code[i],
    }));
    return {
      temp: Math.round(c.temperature_2m),
      code: c.weather_code,
      desc: weatherDesc(c.weather_code),
      wind: c.wind_speed_10m,
      daily,
    };
  } catch {
    return null;
  }
}

async function getGeoInfo(force = false) {
  const { [GEO_CACHE_KEY]: cache } = await chrome.storage.session.get(GEO_CACHE_KEY);
  const now = Date.now();

  // 位置缓存仍有效
  if (!force && cache && now - cache.t < GEO_TTL_MS) {
    // 天气过期则只刷新天气
    if (now - cache.wt > WEATHER_TTL_MS) {
      const weather = await fetchWeather(cache.data.lat, cache.data.lon);
      if (weather) {
        const data = { ...cache.data, weather };
        await chrome.storage.session.set({ [GEO_CACHE_KEY]: { t: cache.t, wt: now, data } });
        return data;
      }
    }
    return cache.data;
  }

  // 全量获取(或强制刷新):IP 定位并行取最快源,通常 1~2s
  let geo = await fetchGeo();
  let weather = null;
  if (geo) {
    // 天气与城市反查并行,互不阻塞
    const [w, rev] = await Promise.all([
      fetchWeather(geo.lat, geo.lon),
      reverseCity(geo.lat, geo.lon).catch(() => null),
    ]);
    weather = w;
    if (rev) {
      if (rev.city) geo.city = rev.city;
      if (rev.region) geo.region = rev.region;
    }
  }
  const data = {
    ...(geo || { ip: null, country: null, region: null, city: null, lat: null, lon: null }),
    weather,
  };
  await chrome.storage.session.set({ [GEO_CACHE_KEY]: { t: now, wt: now, data } });
  return data;
}

/* ================= 梦想之车:汽车之家 选车 + VR 全景看车 ================= */
/* 数据链路(全部经后台代理,绕开页面 CORS):
 * ① 品牌列表  car.app.autohome.com.cn/carMiddle/getBrandInfoAll?appId=pc&needhmzx=1(字母分组)
 * ② 品牌→车系 car.app.autohome.com.cn/carMiddle/getSeriesListByBrandId?brandId={id}&appId=pc(厂商分组)
 * ③ 车系→车型 car-web-api.autohome.com.cn/car/spec/listSpec?type=0x001f&seriesid={id}(动力分组,含价格)
 * ④ 搜索车系  sou.api.autohome.com.cn/sug/_suggest?plat=pc&q={kw}(关键词直达)
 * ⑤ 全景信息  pano.autohome.com.cn/car/ext/{specid} 页面 globalConfig → id(pano ext id)
 *              pano.autohome.com.cn/api/ext/baseinfo/{id}?src=m&category=car
 *              → color_info[].Hori.Normal[].Url (30 帧 360° 序列图,即 VR 全景看车)
 */
const DREAM_CAR_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DREAM_CAR_REF = "https://www.autohome.com.cn/";

async function dreamFetch(url, referer, timeout = 10000) {
  // 失败自动重试 1 次(部分接口偶发超时/5xx)
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const resp = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          "User-Agent": DREAM_CAR_UA,
          "Accept-Language": "zh-CN,zh;q=0.9",
          ...(referer ? { Referer: referer } : {}),
        },
        redirect: "follow",
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      return await resp.text();
    } catch (e) {
      clearTimeout(timer);
      if (attempt === 0) await new Promise((r) => setTimeout(r, 400)); // 短暂等待后重试
      else throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** ① 关键词搜索车系 */
async function dreamCarSearch(kw) {
  const q = encodeURIComponent((kw || "").trim());
  if (!q) return { status: "failed", list: [], message: "请输入车型关键词" };
  const text = await dreamFetch(
    "https://sou.api.autohome.com.cn/sug/_suggest?plat=pc&q=" + q,
    DREAM_CAR_REF,
    8000
  );
  const data = JSON.parse(text);
  const list = (data?.result?.data || [])
    .filter((it) => it && it.wordtype === 3 && it.wordid)
    .map((it) => ({
      seriesId: it.wordid,
      name: it.key,
      minPrice: it.minprice,
      maxPrice: it.maxprice,
    }));
  return { status: list.length ? "ok" : "empty", list, message: list.length ? "" : "没有找到相关车系,换个关键词试试" };
}

/** ② 车系页 → 车型列表(vrData) */
async function dreamCarSeries(seriesId) {
  const id = parseInt(seriesId, 10);
  if (!id) return { status: "failed", specs: [], message: "车系 ID 无效" };
  const html = await dreamFetch("https://www.autohome.com.cn/" + id + "/", DREAM_CAR_REF, 12000);
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return { status: "failed", specs: [], message: "车系页数据解析失败" };
  const data = JSON.parse(m[1]);
  const pp = data?.props?.pageProps || {};
  const base = pp.seriesBaseInfo || {};
  const vr = Array.isArray(pp.vrData) ? pp.vrData : [];
  const specs = vr
    .filter((s) => s && s.is_show !== false && s.specid)
    .map((s) => ({
      specId: s.specid,
      specName: s.specname,
      colors: (s.colorlist || []).map((c) => ({
        colorId: c.id,
        colorName: c.colorname,
        colorValue: c.colorvalue,
      })),
    }));
  return {
    status: specs.length ? "ok" : "empty",
    specs,
    message: specs.length ? "" : "该车系暂无 360° 全景看车数据",
    series: { id, name: base.name || "", brandName: base.brandName || "", logo: base.logo || "" },
  };
}

/** ③+④ 车型 → pano ext id → 360° 序列图 URL */
async function dreamCarPano(specId) {
  const sid = parseInt(specId, 10);
  if (!sid) return { status: "failed", message: "车型 ID 无效" };
  // 先取 pano 页面里的 globalConfig.id(pano ext id)
  const html = await dreamFetch("https://pano.autohome.com.cn/car/ext/" + sid + "/", DREAM_CAR_REF, 12000);
  const gc = html.match(/(?:var\s+)?globalConfig\s*=\s*\{[\s\S]*?\bid\s*:\s*"(\d+)"/);
  if (!gc) return { status: "failed", message: "该车型暂无全景看车页面" };
  const extId = gc[1];
  // baseinfo:颜色 + 30 帧序列图
  const json = await dreamFetch(
    "https://pano.autohome.com.cn/api/ext/baseinfo/" + extId + "?src=m&category=car&deviceId=",
    "https://pano.autohome.com.cn/car/ext/" + sid + "/",
    12000
  );
  const data = JSON.parse(json);
  const ext = data?.ext || {};
  const colors = (data?.color_info || [])
    .map((c) => {
      const frames = (c?.Hori?.Normal || [])
        .sort((a, b) => (a.Seq || 0) - (b.Seq || 0))
        .map((f) => {
          const raw = f.Url || "";
          // 1200x0 → 400x0(小尺寸,31KB/帧,卡片够用);前缀可能在路径中间
          const small = raw.replace(/1200x0_/, "400x0_");
          // 防御:已是完整 URL 时不加前缀;协议相对地址补 https:
          if (/^https?:\/\//i.test(small)) return small;
          if (/^\/\//.test(small)) return "https:" + small;
          return "https://img3.autoimg.cn/pano/" + small;
        });
      return { colorId: c.Id, colorName: c.ColorName, colorValue: c.ColorValue, frames };
    })
    .filter((c) => c.frames.length > 0);
  return {
    status: colors.length ? "ok" : "empty",
    message: colors.length ? "" : "该车型暂无 360° 图片数据",
    colors,
    info: {
      brandName: ext.BrandName || "",
      seriesName: ext.SeriesName || "",
      specName: ext.SpecName || "",
      frameCount: ext.FrameCount || (colors[0] ? colors[0].frames.length : 0),
    },
  };
}

/** 品牌列表(字母分组) */
async function dreamCarBrands() {
  const text = await dreamFetch(
    "https://car.app.autohome.com.cn/carMiddle/getBrandInfoAll?appId=pc&needhmzx=1",
    DREAM_CAR_REF,
    12000
  );
  const data = JSON.parse(text);
  const letters = (data?.result?.list || [])
    .map((g) => ({
      letter: g.letter || "",
      brands: (g.list || []).map((b) => ({
        brandId: b.brandId,
        name: b.name,
        imgUrl: b.imgUrl || "",
        isNewEnergy: b.isNewEnergy,
        isOnSell: b.isOnSell,
      })),
    }))
    .filter((g) => g.brands.length);
  return {
    status: letters.length ? "ok" : "empty",
    letters,
    message: letters.length ? "" : "品牌列表获取失败",
  };
}

/** 品牌 → 车系(厂商分组) */
async function dreamCarSeriesByBrand(brandId) {
  const id = parseInt(brandId, 10);
  if (!id) return { status: "failed", groups: [], message: "品牌 ID 无效" };
  const text = await dreamFetch(
    "https://car.app.autohome.com.cn/carMiddle/getSeriesListByBrandId?brandId=" + id + "&appId=pc",
    DREAM_CAR_REF,
    12000
  );
  const data = JSON.parse(text);
  const groups = (data?.result?.list || [])
    .map((g) => ({
      name: g.name || "",
      series: (g.list || []).map((s) => ({
        seriesId: s.seriesId,
        name: s.name,
        imgUrl: s.imgUrl || "",
        levelName: s.levelName || "",
        price: s.price || "",
      })),
    }))
    .filter((g) => g.series.length);
  return {
    status: groups.length ? "ok" : "empty",
    groups,
    brand: data?.result?.brandInfo
      ? { brandId: data.result.brandInfo.brandId, name: data.result.brandInfo.name }
      : null,
    message: groups.length ? "" : "该品牌暂无车系",
  };
}

/** 车系 → 车型列表(动力分组,含价格) */
async function dreamCarSpecs(seriesId) {
  const id = parseInt(seriesId, 10);
  if (!id) return { status: "failed", groups: [], message: "车系 ID 无效" };
  const text = await dreamFetch(
    "https://car-web-api.autohome.com.cn/car/spec/listSpec?type=0x001f&seriesid=" + id +
      "&from=1&pm=1&pluginversion=11.64.8",
    DREAM_CAR_REF,
    12000
  );
  const data = JSON.parse(text);
  const groups = (data?.result?.list || [])
    .map((g) => ({
      name: g.name || "",
      specs: (g.speclist || []).map((s) => ({
        specId: s.id,
        name: s.name,
        price: s.price || "",
        description: s.description || "",
        logo: s.logo || "",
      })),
    }))
    .filter((g) => g.specs.length);
  return {
    status: groups.length ? "ok" : "empty",
    groups,
    seriesName: data?.result?.seriesname || "",
    seriesId: id,
    message: groups.length ? "" : "该车系暂无车型",
  };
}

/* ================= 消息路由 ================= */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return false;

  if (msg.type === "getBookmarks") {
    refreshCache()
      .then(sendResponse)
      .catch(() => sendResponse([]));
    return true;
  }

  if (msg.type === "describeBookmark") {
    describeBookmark(msg.url, msg.title || msg.url, !!msg.force, msg.model, msg.baseUrl)
      .then(sendResponse)
      .catch(() => sendResponse({ status: "failed" }));
    return true;
  }

  if (msg.type === "askGuaci") {
    generateGuaci(msg.gua, msg.model, msg.baseUrl)
      .then(sendResponse)
      .catch(() => sendResponse({ status: "failed" }));
    return true;
  }

  if (msg.type === "setGeoCoords") {
    updateGeoWithCoords(msg.lat, msg.lon)
      .then(sendResponse)
      .catch(() => sendResponse(null));
    return true;
  }

  if (msg.type === "getGeoInfo") {
    getGeoInfo(!!msg.force)
      .then(sendResponse)
      .catch(() => sendResponse(null));
    return true;
  }

  if (msg.type === "explainQuote") {
    explainQuote(msg.text || "", msg.from || "")
      .then((r) => sendResponse(r))
      .catch(() => sendResponse({ status: "failed", explain: "" }));
    return true;
  }

  if (msg.type === "getApiRegistry") {
    sendResponse({ status: "ok", registry: apiRegistry.slice() });
    return true;
  }

  if (msg.type === "checkApis") {
    const auth = msg.apiKey ? { Authorization: "Bearer " + msg.apiKey } : null;
    const urls = Array.isArray(msg.urls) ? msg.urls : [];
    // 受限并发检测(最多 4 个同时),避免高频触发 Open-Meteo 等免费接口限流(403)
    const results = {};
    const CONC = 4;
    let idx = 0;
    const workers = [];
    const worker = async () => {
      while (idx < urls.length) {
        const i = idx++;
        const u = urls[i];
        const h = /deepseek/i.test(u) && auth ? auth : undefined;
        if (/\/chat\/completions/i.test(u)) {
          // chat 检测无条件 POST(避免 GET 到 /chat/completions 误报 405)
          results[u] = await checkChatApi(u, h);
        } else if (/\/models/i.test(u) && /deepseek/i.test(u) && !auth) {
          // 未配置 Key:直接跳过,避免无意义的 401/405
          results[u] = { ok: false, status: 0, skipped: true };
        } else {
          results[u] = await checkApiUrl(u, h);
        }
      }
    };
    for (let k = 0; k < Math.min(CONC, urls.length); k++) workers.push(worker());
    Promise.all(workers)
      .then(() => sendResponse({ status: "ok", results }))
      .catch(() => sendResponse({ status: "failed", results: {} }));
    return true;
  }

  if (msg.type === "checkFrameable") {
    checkFrameable(msg.url)
      .then((ok) => sendResponse({ status: ok ? "ok" : "blocked" }))
      .catch(() => sendResponse({ status: "ok" }));
    return true;
  }

  if (msg.type === "getDouyinHot") {
    fetchDouyinHot()
      .then((items) => sendResponse({ status: items.length ? "ok" : "failed", items }))
      .catch(() => sendResponse({ status: "failed", items: [] }));
    return true;
  }

  if (msg.type === "getDeepSeekModels") {
    getDeepSeekModels(msg.key || "", msg.baseUrl || "")
      .then((r) => sendResponse({ status: r.models.length ? "ok" : "failed", models: r.models, error: r.error || "" }))
      .catch(() => sendResponse({ status: "failed", models: [], error: "未知错误" }));
    return true;
  }

  if (msg.type === "getEngineIconData") {
    fetchIconData(msg.url)
      .then((dataUrl) => sendResponse({ status: dataUrl ? "ok" : "failed", dataUrl: dataUrl || "" }))
      .catch(() => sendResponse({ status: "failed", dataUrl: "" }));
    return true;
  }

  if (msg.type === "getWallpapers") {
    getWallpapers()
      .then(sendResponse)
      .catch(() => sendResponse({ urls: [] }));
    return true;
  }

  if (msg.type === "dreamCarSearch") {
    dreamCarSearch(msg.kw || "")
      .then(sendResponse)
      .catch((e) => sendResponse({ status: "failed", list: [], message: "网络错误:" + (e && e.message ? e.message : "未知") }));
    return true;
  }

  if (msg.type === "dreamCarSeries") {
    dreamCarSeries(msg.seriesId)
      .then(sendResponse)
      .catch((e) => sendResponse({ status: "failed", specs: [], message: "网络错误:" + (e && e.message ? e.message : "未知") }));
    return true;
  }

  if (msg.type === "dreamCarPano") {
    dreamCarPano(msg.specId)
      .then(sendResponse)
      .catch((e) => sendResponse({ status: "failed", colors: [], message: "网络错误:" + (e && e.message ? e.message : "未知") }));
    return true;
  }

  if (msg.type === "dreamCarBrands") {
    dreamCarBrands()
      .then(sendResponse)
      .catch((e) => sendResponse({ status: "failed", letters: [], message: "网络错误:" + (e && e.message ? e.message : "未知") }));
    return true;
  }

  if (msg.type === "dreamCarSeriesByBrand") {
    dreamCarSeriesByBrand(msg.brandId)
      .then(sendResponse)
      .catch((e) => sendResponse({ status: "failed", groups: [], message: "网络错误:" + (e && e.message ? e.message : "未知") }));
    return true;
  }

  if (msg.type === "dreamCarSpecs") {
    dreamCarSpecs(msg.seriesId)
      .then(sendResponse)
      .catch((e) => sendResponse({ status: "failed", groups: [], message: "网络错误:" + (e && e.message ? e.message : "未知") }));
    return true;
  }

  if (msg.type === "hasApiKey") {
    getApiKey().then((k) => sendResponse({ hasKey: !!k }));
    return true;
  }

  return false;
});
/* ================= 背景壁纸(Bing 每日壁纸,风格接近 Infinity) ================= */
const WALLPAPER_CACHE = "wallpapersCache"; // session: string[]

async function getWallpapers() {
  let bing = [];
  try {
    const cache = (await chrome.storage.session.get(WALLPAPER_CACHE))[WALLPAPER_CACHE];
    if (cache && Array.isArray(cache) && cache.length) bing = cache;
  } catch (e) { /* 忽略 */ }
  if (!bing.length) {
    try {
      const url = "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN";
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const resp = await fetch(url, {
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      });
      clearTimeout(timer);
      if (resp.ok) {
        const d = await resp.json();
        const urls = (d.images || []).map((im) => "https://www.bing.com" + im.url);
        if (urls.length) {
          bing = urls;
          try { await chrome.storage.session.set({ [WALLPAPER_CACHE]: urls }); } catch (e) { /* 忽略 */ }
        }
      }
    } catch (e) { /* 忽略 */ }
  }
  // 追加 picsum 随机图(每次调用 seed 不同,保证每次加载都是新图,无限不重复)
  const rnd = Math.floor(Math.random() * 1e9);
  const pics = [];
  for (let k = 0; k < 8; k++) pics.push("https://picsum.photos/seed/banana" + (rnd + k) + "/1920/1080");
  return { urls: [...new Set([...bing, ...pics])] };
}

async function updateGeoWithCoords(lat, lon) {
  if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) return null;
  // 天气/城市反查失败不阻塞精确定位(坐标始终返回)
  let weather = null;
  let rev = null;
  try {
    const res = await Promise.all([
      fetchWeather(lat, lon),
      reverseCity(lat, lon).catch(() => null),
    ]);
    weather = res[0];
    rev = res[1];
  } catch (e) {
    /* 天气/反查失败不阻塞精确定位(坐标始终返回) */
  }  const data = {
    ip: null,
    country: null,
    region: rev ? rev.region : "",
    city: rev ? rev.city : "",
    lat,
    lon,
    weather,
  };
  const now = Date.now();
  await chrome.storage.session.set({ [GEO_CACHE_KEY]: { t: now, wt: now, data } });
  return data;
}

/* ================= DeepSeek chat/completions 检测:POST 最小请求(max_tokens=1),200 = 可用 ================= */
async function checkChatApi(url, extraHeaders) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: Object.assign(
        { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        extraHeaders || {}
      ),
      body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
    });
    clearTimeout(timer);
    return { ok: resp.ok, status: resp.status };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, status: 0 };
  }
}

/** 检测 API 可达性:HEAD 优先,非 2xx 或失败时回退 GET(不带 Range,避免 416) */
async function checkApiUrl(url, extraHeaders) {
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
  const mkHeaders = () => Object.assign({ "User-Agent": UA }, extraHeaders || {});
  // 1) HEAD
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const resp = await fetch(url, { method: "HEAD", signal: ctrl.signal, redirect: "follow", headers: mkHeaders() });
    clearTimeout(timer);
    if (resp.ok) { try { resp.body && resp.body.cancel(); } catch (e) { /* 忽略 */ } return { ok: true, status: resp.status }; }
  } catch (e) { /* 继续 GET */ }
  // 2) GET(仅看状态,随后释放连接)
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const resp = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: mkHeaders() });
    clearTimeout(timer);
    const ok = resp.ok;
    try { resp.body && resp.body.cancel(); } catch (e) { /* 忽略 */ }
    return { ok, status: resp.status };
  } catch (e) {
    return { ok: false, status: 0 };
  }
}

/** 预检站点是否允许被 iframe 嵌入(检查 X-Frame-Options / CSP frame-ancestors) */
async function checkFrameable(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const resp = await fetch(url, {
      method: "HEAD",
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    clearTimeout(timer);
    const xfo = (resp.headers.get("x-frame-options") || "").toUpperCase();
    if (xfo.includes("DENY") || xfo.includes("SAMEORIGIN")) return false;
    const csp = resp.headers.get("content-security-policy") || "";
    const m = csp.match(/frame-ancestors\s+([^;]+)/i);
    if (m) {
      const v = m[1].trim().toLowerCase();
      if (v === "'none'") return false;
      if (/^'self'$/i.test(v)) return false; // frame-ancestors 'self':仅同源可嵌
    }
    return true;
  } catch (e) {
    return true; // 无法检测时按可预览处理,避免误伤
  }
}

/** 抖音热榜:app 端公开接口(免签名),众多开源项目使用 */
async function fetchDouyinHot() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const resp = await apiFetch(
      "https://aweme.snssdk.com/aweme/v1/hot/search/list/?aid=1128&device_platform=android&version_code=300&os_version=10&channel=online&app_name=aweme",
      {
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      },
      { name: "抖音热榜", desc: "今日热榜 · 抖音" }
    );
    clearTimeout(timer);
    if (!resp.ok) return [];
    const data = await resp.json();
    const list = data && data.data && data.data.word_list;
    if (!Array.isArray(list)) return [];
    return list
      .map((k) => ({
        title: (k && k.word) || "",
        url: k && k.sentence_id ? "https://www.douyin.com/hot/" + k.sentence_id : "",
      }))
      .filter((x) => x.title);
  } catch (e) {
    return [];
  }
}

async function fetchIconData(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    if (!buf || buf.byteLength === 0 || buf.byteLength > 512 * 1024) return null;
    const bytes = new Uint8Array(buf);
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const ct = resp.headers.get("content-type") || "";
    const type = ct.startsWith("image/") ? ct : "image/png";
    return "data:" + type + ";base64," + btoa(bin);
  } catch (err) {
    return null;
  }
}

