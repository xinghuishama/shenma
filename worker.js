// ======================== worker.js v3.8.0 (完整自包含 + 零拷贝) ========================
(function () {
  "use strict";

  // ---------- 配置常量 ----------
  const MAX_NUMBERS = 5000;
  const ZODIAC_SEQUENCE = ["龙","蛇","马","羊","猴","鸡","狗","猪","鼠","牛","虎","兔"];
  const BASE_YEAR = 2024;

  // ---------- 生肖映射（自动跨年） ----------
  function generateShengxiaoMap(year) {
    const taiSuiIdx = ((year - BASE_YEAR) % 12 + 12) % 12;
    const map = {};
    for (let i = 0; i < 12; i++) {
      const offset = (taiSuiIdx - i + 12) % 12;
      const start = offset + 1;
      const nums = [];
      for (let k = 0; k < 5; k++) {
        const num = start + k * 12;
        if (num <= 49) nums.push(num);
      }
      map[ZODIAC_SEQUENCE[i]] = nums;
    }
    return map;
  }

  // ---------- 五行（自动跨年 + 缓存） ----------
  const WUXING_BASE_SEQ = [
    '金','金','土','土','木','木','火','火','金','金',
    '水','水','木','木','火','火','土','土','水','水',
    '木','木','金','金','土','土','水','水','火','火'
  ];

  let wuxingMapCache = {};

  function getWuxingMap(year) {
    const offset = year - 2023;
    const map = new Map();
    for (let n = 1; n <= 49; n++) {
      const wx = WUXING_BASE_SEQ[((n - 1) % 30 - offset + 30) % 30];
      map.set(n, wx);
    }
    return map;
  }

  function getCachedWuxing(year) {
    if (!wuxingMapCache[year]) {
      wuxingMapCache[year] = getWuxingMap(year);
    }
    return wuxingMapCache[year];
  }

  const FALLBACK_YEAR = new Date().getFullYear();
  let SHENGXIAO = generateShengxiaoMap(FALLBACK_YEAR);
  let currentWuxingYear = FALLBACK_YEAR;

  // ---------- 静态分类 ----------
  const CATEGORIES = {
    红波:[1,2,7,8,12,13,18,19,23,24,29,30,34,35,40,45,46],
    蓝波:[3,4,9,10,14,15,20,25,26,31,36,37,41,42,47,48],
    绿波:[5,6,11,16,17,21,22,27,28,32,33,38,39,43,44,49]
  };
  const DUAN = {
    "1段":[1,2,3,4,5,6,7],
    "2段":[8,9,10,11,12,13,14],
    "3段":[15,16,17,18,19,20,21],
    "4段":[22,23,24,25,26,27,28],
    "5段":[29,30,31,32,33,34,35],
    "6段":[36,37,38,39,40,41,42],
    "7段":[43,44,45,46,47,48,49]
  };

  // ---------- 构建 numProps（包含所有属性） ----------
  let numProps = new Array(50);

  function buildNumProps(year) {
    currentWuxingYear = year || FALLBACK_YEAR;
    SHENGXIAO = generateShengxiaoMap(currentWuxingYear);
    const wuxingMap = getCachedWuxing(currentWuxingYear);
    const sxEntries = Object.entries(SHENGXIAO);
    const duanEntries = Object.entries(DUAN);

    for (let n = 1; n <= 49; n++) {
      const head = Math.floor(n / 10);
      const tail = n % 10;
      const odd = n % 2 === 1 ? "单" : "双";
      const color = CATEGORIES.红波.includes(n) ? "red" : (CATEGORIES.蓝波.includes(n) ? "blue" : "green");
      const five = wuxingMap.get(n);
      const sum = head + tail;
      const sumOdd = sum % 2 === 1 ? "合数单" : "合数双";
      let duan = "";
      for (let i = 0; i < duanEntries.length; i++) {
        if (duanEntries[i][1].includes(n)) { duan = duanEntries[i][0]; break; }
      }
      const halfOddEven = n > 24 ? (n % 2 === 1 ? "大单" : "大双") : (n % 2 === 1 ? "小单" : "小双");
      let shengXiao = "";
      for (let i = 0; i < sxEntries.length; i++) {
        if (sxEntries[i][1].includes(n)) { shengXiao = sxEntries[i][0]; break; }
      }
      numProps[n] = { head, tail, color, odd, five, sumOdd, duan, halfOddEven, shengXiao, sum };
    }
  }
  buildNumProps(); // 默认年份

  // ---------- 解析输入 ----------
  function parseInputWorker(input) {
    if (!input || !input.trim()) return [];
    let cleaned = input.replace(/《.*?》/g, " ")
                       .replace(/[^0-9鼠牛虎兔龙蛇马羊猴鸡狗猪]/g, " ")
                       .replace(/([鼠牛虎兔龙蛇马羊猴鸡狗猪])/g, " $1 ");
    const tokens = cleaned.split(/\s+/).filter(t => t.length > 0);
    const results = [];
    for (const token of tokens) {
      if (SHENGXIAO[token]) {
        results.push(...SHENGXIAO[token]);
      } else if (/^\d+$/.test(token)) {
        const n = Number(token);
        if (n >= 1 && n <= 49) results.push(n);
      }
    }
    return results.slice(0, MAX_NUMBERS);
  }

  // ---------- 构建过滤器函数 ----------
  function buildMatchFunc(cond) {
    if (cond.startsWith("生肖")) {
      const sx = cond.slice(2);
      return n => numProps[n] && numProps[n].shengXiao === sx;
    }
    if (cond.endsWith("头单") || cond.endsWith("头双")) {
      const parts = cond.split("头");
      const headVal = parseInt(parts[0], 10);
      const oe = parts[1];
      return n => numProps[n] && numProps[n].head === headVal && numProps[n].odd === oe;
    }
    if (cond.endsWith("尾")) {
      const tailVal = parseInt(cond[0], 10);
      return n => numProps[n] && numProps[n].tail === tailVal;
    }
    if (cond.endsWith("段")) {
      return n => numProps[n] && numProps[n].duan === cond;
    }
    if (cond.endsWith("波单") || cond.endsWith("波双")) {
      const parts = cond.split("波");
      const c = parts[0];
      const oe = parts[1];
      const colorMap = { 红: "red", 蓝: "blue", 绿: "green" };
      return n => numProps[n] && numProps[n].color === colorMap[c] && numProps[n].odd === oe;
    }
    if (["金","木","水","火","土"].includes(cond)) {
      return n => getCachedWuxing(currentWuxingYear).get(n) === cond;
    }
    if (["合数单","合数双","大单","大双","小单","小双"].includes(cond)) {
      if (cond === "合数单") return n => numProps[n] && numProps[n].sumOdd === "合数单";
      if (cond === "合数双") return n => numProps[n] && numProps[n].sumOdd === "合数双";
      return n => numProps[n] && numProps[n].halfOddEven === cond;
    }
    if (cond.endsWith("合")) {
      const sumVal = parseInt(cond, 10);
      return n => numProps[n] && numProps[n].sum === sumVal;
    }
    return () => false;
  }

  // ---------- 缓存过滤器（优化重复构建） ----------
  let cachedFuncs = null;
  let lastFiltersSignature = "";

  function getFilterFuncs(filters) {
    const sig = filters.join("\x00");
    if (cachedFuncs && sig === lastFiltersSignature) {
      return cachedFuncs;
    }
    cachedFuncs = filters.map(buildMatchFunc);
    lastFiltersSignature = sig;
    return cachedFuncs;
  }

  // ---------- 主处理函数 ----------
  function processAnalysis(payload) {
    const { input, killNums, filters } = payload;

    // 1. 解析输入
    const nums = parseInputWorker(input);
    const rawCount = new Uint16Array(50);
    for (let i = 0; i < nums.length; i++) {
      const n = nums[i];
      if (n >= 1 && n <= 49) rawCount[n]++;
    }

    // 2. 构建过滤器并计算命中
    const filterFuncs = getFilterFuncs(filters || []);
    const killSet = new Set(killNums || []);

    const adjustedCount = new Uint16Array(50);
    const hitCounts = new Uint8Array(50);
    let adjustedTotal = 0;
    let unique = 0;

    for (let n = 1; n <= 49; n++) {
      let hit = killSet.has(n) ? 1 : 0;
      for (let i = 0; i < filterFuncs.length; i++) {
        if (filterFuncs[i](n)) hit++;
      }
      hitCounts[n] = hit;

      const adj = Math.max(0, rawCount[n] - hit);
      adjustedCount[n] = adj;
      if (adj > 0) {
        adjustedTotal += adj;
        unique++;
      }
    }

    // 3. 打包到单个 ArrayBuffer 实现零拷贝
    const buffer = new ArrayBuffer(50 * 2 + 50); // Uint16(100字节) + Uint8(50字节)
    const view16 = new Uint16Array(buffer, 0, 50);
    const view8  = new Uint8Array(buffer, 50 * 2, 50);
    view16.set(adjustedCount);
    view8.set(hitCounts);

    return {
      buffer: buffer,
      adjustedTotal: adjustedTotal,
      unique: unique
    };
  }

  // ---------- Worker 消息入口 ----------
  self.onmessage = function (e) {
    const data = e.data;
    // 兼容两种格式：直接对象 { input, killNums, filters } 或带 type 的包装
    let payload = data;
    if (data.type === 'analyze') {
      payload = data.payload;
    }

    try {
      // 如果收到了年份，可重新构建属性（主线程可发送 year 字段）
      if (payload.year && typeof payload.year === 'number') {
        buildNumProps(payload.year);
      }

      const result = processAnalysis(payload);

      // 使用 Transferable 传递 buffer，零拷贝
      self.postMessage({
        adjustedCount: null,      // 主线程会从 buffer 中重建
        hitCounts: null,
        adjustedTotal: result.adjustedTotal,
        unique: result.unique,
        buffer: result.buffer
      }, [result.buffer]);

    } catch (err) {
      self.postMessage({
        error: err.message || "Worker 处理失败"
      });
    }
  };
})();