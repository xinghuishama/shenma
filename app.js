// ======================== app.js — 主线程核心逻辑 v3.6 ========================
// 设计目标：GitHub Pages 100% 兼容 · Worker 全量卸载 · 离线缓存 · 工程级安全
(function () {
  "use strict";

  // ======================== 配置与数据引用（含 fallback）========================
  const SHENGXIAO_FB = {
    鼠:[7,19,31,43],   牛:[6,18,30,42],   虎:[5,17,29,41],
    兔:[4,16,28,40],   龙:[3,15,27,39],   蛇:[2,14,26,38],
    马:[1,13,25,37,49], 羊:[12,24,36,48],  猴:[11,23,35,47],
    鸡:[10,22,34,46],  狗:[9,21,33,45],   猪:[8,20,32,44]
  };
  const DATA = window.APP_DATA || {};
  const MAX_NUMBERS = DATA.MAX_NUMBERS || 5000;
  const SHENGXIAO = DATA.SHENGXIAO || SHENGXIAO_FB;
  const CATEGORIES = DATA.CATEGORIES || {};
  const DUAN = DATA.DUAN || {};
  const numProps = DATA.numProps || [];

  const API_CONFIG = {
    live: 'https://macaumarksix.com/api/live2',
    historyBase: 'https://history.macaumarksix.com/history/macaujc2/y/'
  };
  const HISTORY_PAGE_SIZE = 15;
  const LS_KEY = 'shenma_v4_state';
  const LS_CACHE_KEY = 'shenma_v4_lottery_cache';

  // ======================== DOM 元素缓存 ========================
  const DOM = {};
  function cacheDOM() {
    const ids = ['numbers','result','charCount','numberWarn','exampleBtn','clearBtn','copyResultBtn',
                 'lotteryPeriod','lotteryTime','lastRefreshTime','lotteryBalls','refreshLotteryBtn',
                 'drawer-overlay','drawer-container','drawer-title','drawer-content','drawer-close','toast'];
    ids.forEach(function (id) {
      DOM[id.replace(/-/g, '_')] = document.getElementById(id);
    });
  }

  // ======================== 状态管理 ========================
  let state = {
    killNums: [],
    selectedFilters: {
      shengxiao:[], haomatou:[], weishu:[], shuduan:[],
      bose:[], wuxing:[], bandanshuang:[], heshu:[]
    }
  };
  let subscribers = [];
  let lastAnalysisResult = null;

  function subscribe(fn) { subscribers.push(fn); }
  function notify() { subscribers.forEach(function (fn) { fn(); }); }

  function setKillNums(newNums) { state.killNums = [...newNums]; notify(); }
  function toggleFilter(category, value, checked) {
    if (!Object.prototype.hasOwnProperty.call(state.selectedFilters, category)) return;
    const arr = state.selectedFilters[category];
    const set = new Set(arr);
    if (checked) { set.add(value); } else { set.delete(value); }
    state.selectedFilters[category] = Array.from(set);
    notify();
  }
  function clearAllFilters() {
    state.killNums = [];
    Object.keys(state.selectedFilters).forEach(function (k) { state.selectedFilters[k] = []; });
    notify();
  }
  function getFilterSet() {
    return Object.values(state.selectedFilters).flat();
  }

  // ======================== localStorage 持久化 ========================
  function saveState() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        killNums: state.killNums,
        selectedFilters: state.selectedFilters
      }));
    } catch (e) {}
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      if (Array.isArray(parsed.killNums)) {
        state.killNums = parsed.killNums.filter(function (n) {
          return Number.isInteger(n) && n >= 1 && n <= 49;
        });
      }
      if (parsed.selectedFilters && typeof parsed.selectedFilters === 'object') {
        Object.keys(state.selectedFilters).forEach(function (k) {
          if (!Object.prototype.hasOwnProperty.call(parsed.selectedFilters, k)) return;
          const val = parsed.selectedFilters[k];
          if (Array.isArray(val)) {
            state.selectedFilters[k] = Array.from(val).slice(0, 50);
          }
        });
      }
    } catch (e) {
      console.warn('loadState failed', e);
    }
  }

  // ======================== 通用工具函数 ========================
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  function showToast(msg) {
    const t = DOM.toast;
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(function () { t.classList.add('translate-y-20', 'opacity-0'); }, 2000);
  }

  // ======================== 输入解析引擎（安全版）========================
  // 返回原始数组（不去重，用于计数）和去重数组（用于分析）
  function parseInputCount(input) {
    if (!input || !input.trim()) return { rawNums: [], nums: [], truncated: false };
    let cleaned = input.replace(/《.*?》/g, ' ').replace(/[^0-9鼠牛虎兔龙蛇马羊猴鸡狗猪]/g, ' ')
                       .replace(/([鼠牛虎兔龙蛇马羊猴鸡狗猪])/g, ' $1 ');
    const tokens = cleaned.split(/\s+/).filter(function (t) { return t.length > 0; });
    if (!tokens.length) return { rawNums: [], nums: [], truncated: false };

    let rawResults = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (SHENGXIAO[token]) {
        rawResults.push.apply(rawResults, SHENGXIAO[token]);
      } else {
        if (!/^\d+$/.test(token)) continue;
        let n = Number(token);
        if (Number.isInteger(n) && n >= 1 && n <= 49) rawResults.push(n);
      }
    }
    let truncated = false;
    if (rawResults.length > MAX_NUMBERS) { rawResults = rawResults.slice(0, MAX_NUMBERS); truncated = true; }
    // 去重后的分析数组
    const nums = Array.from(new Set(rawResults));
    return { rawNums: rawResults, nums: nums, truncated: truncated };
  }

  // ======================== 筛选缓存签名 ========================
  let cachedMatchFuncs = null;
  let lastFilterSignature = '';

  function getMatchFuncs() {
    const sig = JSON.stringify(state.selectedFilters);
    if (cachedMatchFuncs && sig === lastFilterSignature) return cachedMatchFuncs;
    lastFilterSignature = sig;
    const allConds = getFilterSet();
    cachedMatchFuncs = allConds.map(function (cond) { return buildMatchFunc(cond); });
    return cachedMatchFuncs;
  }
  function buildMatchFunc(cond) {
    if (cond.startsWith('生肖')) {
      const sx = cond.slice(2);
      return function (n) { return numProps[n] && numProps[n].shengXiao === sx; };
    }
    if (cond.endsWith('头单') || cond.endsWith('头双')) {
      const parts = cond.split('头');
      const headVal = parseInt(parts[0], 10);
      const oe = parts[1];
      return function (n) { return numProps[n] && numProps[n].head === headVal && numProps[n].odd === oe; };
    }
    if (cond.endsWith('尾')) {
      const tailVal = parseInt(cond[0], 10);
      return function (n) { return numProps[n] && numProps[n].tail === tailVal; };
    }
    if (cond.endsWith('段')) {
      return function (n) { return numProps[n] && numProps[n].duan === cond; };
    }
    if (cond.endsWith('波单') || cond.endsWith('波双')) {
      const parts = cond.split('波');
      const c = parts[0];
      const oe = parts[1];
      const colorMap = {红:'red',蓝:'blue',绿:'green'};
      return function (n) { return numProps[n] && numProps[n].color === colorMap[c] && numProps[n].odd === oe; };
    }
    if (['金','木','水','火','土'].includes(cond)) {
      return function (n) { return numProps[n] && numProps[n].five === cond; };
    }
    if (['合数单','合数双','大单','大双','小单','小双'].includes(cond)) {
      if (cond === '合数单') return function (n) { return numProps[n] && numProps[n].sumOdd === '合数单'; };
      if (cond === '合数双') return function (n) { return numProps[n] && numProps[n].sumOdd === '合数双'; };
      return function (n) { return numProps[n] && numProps[n].halfOddEven === cond; };
    }
    if (cond.endsWith('合')) {
      const sumVal = parseInt(cond, 10);
      return function (n) { return numProps[n] && numProps[n].sum === sumVal; };
    }
    return function () { return false; };
  }

  // ======================== Worker 管理 ========================
  let analysisWorker = null;
  function initWorker() {
    if (analysisWorker) return;
    try {
      analysisWorker = new Worker('worker.js');
      analysisWorker.onmessage = onWorkerMessage;
      analysisWorker.onerror = function (e) {
        console.error('Worker error:', e);
        showToast('分析引擎初始化失败');
      };
    } catch (e) {
      console.error('Worker init failed:', e);
      showToast('分析引擎初始化失败');
    }
  }
  function terminateWorker() {
    if (analysisWorker) {
      analysisWorker.terminate();
      analysisWorker = null;
    }
  }

  function onWorkerMessage(e) {
    try {
      const d = e.data;
      renderResult(d.adjustedCount, d.adjustedTotal, d.unique, d.hitCounts, d.inputNums);
    } catch (err) {
      console.error('onWorkerMessage error:', err);
    }
  }

  // ======================== 独苗飞行特效 ========================
  let currentUniqueElement = null;
  let lastUniqueNum = null;

  function launchUniqueFlyEffect(targetNum, colorClass) {
    const targetEl = DOM.result.querySelector('[data-num="' + targetNum + '"]');
    if (!targetEl) return;
    const targetRect = targetEl.getBoundingClientRect();
    const startX = window.innerWidth / 2 - 22;
    const startY = -60;
    const endX = targetRect.left + targetRect.width / 2 - 22;
    const endY = targetRect.top + targetRect.height / 2 - 22;
    const glowColor = colorClass === 'ball-red' ? '#ff3366' : colorClass === 'ball-green' ? '#33cc66' : '#3366ff';

    const ball = document.createElement('div');
    ball.className = 'flying-unique-ball ' + colorClass;
    ball.textContent = String(targetNum).padStart(2, '0');
    ball.style.left = startX + 'px';
    ball.style.top = startY + 'px';
    ball.style.color = glowColor;
    document.body.appendChild(ball);

    let startTime = null;
    const duration = 1400;
    function dropTrail(x, y) {
      const trail = document.createElement('div');
      trail.className = 'flying-trail';
      trail.style.left = (x + 20) + 'px';
      trail.style.top = (y + 20) + 'px';
      trail.style.background = glowColor;
      trail.style.boxShadow = '0 0 6px ' + glowColor;
      document.body.appendChild(trail);
      requestAnimationFrame(function () {
        trail.style.transition = 'all 0.5s ease';
        trail.style.opacity = '0';
        trail.style.transform = 'scale(0.2)';
      });
      setTimeout(function () { trail.remove(); }, 500);
    }
    function animate(timestamp) {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const ease = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      const currentX = startX + (endX - startX) * ease;
      const currentY = startY + (endY - startY) * ease;
      const scale = 0.6 + Math.sin(progress * Math.PI) * 0.6;
      const rotate = progress * 1080;
      ball.style.transform = 'translate3d(' + (currentX - startX) + 'px, ' + (currentY - startY) + 'px, 0) scale(' + scale + ') rotate(' + rotate + 'deg)';
      if (progress > 0.05 && progress < 0.95 && (timestamp - startTime) % 60 < 20) {
        dropTrail(currentX, currentY);
      }
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        ball.remove();
        targetEl.classList.remove('flash-unique');
        void targetEl.offsetWidth;
        targetEl.classList.add('landing-shock', 'flash-unique');
        setTimeout(function () { targetEl.classList.remove('landing-shock'); }, 400);
        showToast('🎯 独苗守护：' + String(targetNum).padStart(2, '0') + ' 号');
      }
    }
    requestAnimationFrame(animate);
  }

  // ======================== 分析结果渲染 ========================
  function renderResult(adjustedCount, adjustedTotal, unique, hitCounts, inputNums) {
    try {
      const container = DOM.result;
      if (!container) return;
      if (currentUniqueElement) {
        currentUniqueElement.classList.remove('flash-unique');
        currentUniqueElement = null;
      }

      // 按频次分组
      const freqMap = new Map();
      for (let n = 1; n <= 49; n++) {
        const f = adjustedCount[n];
        if (f > 0) {
          if (!freqMap.has(f)) freqMap.set(f, []);
          freqMap.get(f).push(n);
        }
      }
      const freqs = Array.from(freqMap.keys()).sort(function (a, b) { return b - a; });

      let killDrawn = false;
      const avg = unique ? (adjustedTotal / unique).toFixed(2) : '0.00';

      // 计算独苗（未命中且频次>0）
      const unhitNumbers = [];
      for (let n = 1; n <= 49; n++) {
        if (adjustedCount[n] > 0 && hitCounts[n] === 0) unhitNumbers.push(n);
      }
      const isUniqueUnhit = (unhitNumbers.length === 1);
      const uniqueUnhitNum = isUniqueUnhit ? unhitNumbers[0] : null;
      const killSet = new Set(state.killNums);

      const sortedFreqMap = new Map();
      const htmlParts = [];

      for (let fi = 0; fi < freqs.length; fi++) {
        const f = freqs[fi];
        if (!killDrawn && f <= (adjustedTotal / unique)) {
          htmlParts.push('<div class="kill-line"></div>');
          killDrawn = true;
        }
        htmlParts.push('<div class="flex items-start gap-2 mb-2 flex-wrap"><span class="text-xs text-green-500 font-mono min-w-[36px] pt-2">' + f + '次：</span><div class="flex flex-wrap gap-1.5 flex-1">');
        const nums = freqMap.get(f).sort(function (a, b) { return a - b; });
        sortedFreqMap.set(f, nums.slice());
        for (let ni = 0; ni < nums.length; ni++) {
          const n = nums[ni];
          const hit = hitCounts[n] || 0;
          const isGray = (hit > 0);
          const p = numProps[n];
          let baseColorClass = isGray ? 'ball-gray' : (p && p.color === 'red' ? 'ball-red' : (p && p.color === 'green' ? 'ball-green' : 'ball-blue'));
          const isTarget = (n === uniqueUnhitNum);
          const flashClass = isTarget ? 'flash-unique' : '';
          let markHtml = '';
          if (killSet.has(n)) {
            markHtml = '<span class="hit-mark cross">✘</span>';
          } else if (hit > 0) {
            markHtml = '<span class="hit-mark">' + hit + '</span>';
          }
          htmlParts.push('<button class="ball-3d ' + baseColorClass + ' ' + flashClass + '" data-num="' + n + '">' + String(n).padStart(2, '0') + markHtml + '</button>');
        }
        htmlParts.push('</div></div>');
      }

      // 0次统计：当不重复数字少于49个时
      if (unique < 49 && adjustedTotal > 0) {
        const zeroNums = [];
        for (let n = 1; n <= 49; n++) {
          if (adjustedCount[n] === 0) zeroNums.push(n);
        }
        if (zeroNums.length > 0) {
          htmlParts.push('<div class="zero-count-section"><div class="zero-count-label">0次（未出现 ' + zeroNums.length + ' 个）：</div><div class="flex flex-wrap gap-1.5">');
          zeroNums.sort(function (a, b) { return a - b; });
          for (let i = 0; i < zeroNums.length; i++) {
            const n = zeroNums[i];
            const p = numProps[n];
            let baseColorClass = p && p.color === 'red' ? 'ball-red' : (p && p.color === 'green' ? 'ball-green' : 'ball-blue');
            htmlParts.push('<button class="ball-3d ' + baseColorClass + '" data-num="' + n + '">' + String(n).padStart(2, '0') + '</button>');
          }
          htmlParts.push('</div></div>');
        }
      }

      if (unique === 0 && freqs.length === 0) {
        htmlParts.push('<div class="text-center py-8 text-amber-400">⚡ 所有号码频次归零，请调整筛选条件 ⚡</div>');
      }

      // 底部统计面板
      htmlParts.push('<div class="mt-4 grid grid-cols-3 gap-2 p-3 bg-[#1a1a2a] rounded-lg border border-[#00ffea]/20"><div class="text-center"><div class="text-[#00ffea] font-bold text-lg">' + unique + '</div><div class="text-xs text-gray-500">有效数字个数</div></div><div class="text-center"><div class="text-[#00ffea] font-bold text-lg">' + adjustedTotal + '</div><div class="text-xs text-gray-500">调整后总次数</div></div><div class="text-center"><div class="text-[#00ffea] font-bold text-lg">' + avg + '</div><div class="text-xs text-gray-500">调整后平均次数</div></div></div>');

      container.innerHTML = htmlParts.join('');

      // 触发独苗飞入
      if (uniqueUnhitNum) {
        currentUniqueElement = DOM.result.querySelector('[data-num="' + uniqueUnhitNum + '"]');
        if (lastUniqueNum !== uniqueUnhitNum) {
          lastUniqueNum = uniqueUnhitNum;
          const p = numProps[uniqueUnhitNum];
          const flyColor = p && p.color === 'red' ? 'ball-red' : (p && p.color === 'green' ? 'ball-green' : 'ball-blue');
          setTimeout(function () { launchUniqueFlyEffect(uniqueUnhitNum, flyColor); }, 100);
        }
      } else {
        lastUniqueNum = null;
      }

      lastAnalysisResult = { sortedFreqMap: sortedFreqMap, adjustedTotal: adjustedTotal, unique: unique, avg: avg };
    } catch (err) {
      console.error('renderResult error:', err);
      if (DOM.result) DOM.result.innerHTML = '<div class="text-center py-8 text-red-400">渲染出错，请检查控制台</div>';
    }
  }

  // ======================== 事件代理：结果区号码点击复制 ========================
  function initResultDelegation() {
    const resultEl = DOM.result;
    if (!resultEl) return;
    resultEl.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-num]');
      if (!btn) return;
      const num = Number(btn.dataset.num);
      if (!Number.isNaN(num)) copyNumber(num);
    });
  }

  // ======================== 防抖分析调度 ========================
  let debounceTimer = null;
  function runAnalysis() {
    initWorker();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      try {
        const input = DOM.numbers ? DOM.numbers.value : '';
        const parsed = parseInputCount(input);
        // 显示原始有效数字个数（不去重）
        if (DOM.charCount) DOM.charCount.textContent = parsed.rawNums.length;
        if (DOM.numberWarn) {
          if (parsed.truncated) {
            DOM.numberWarn.classList.remove('hidden');
            if (!window._truncToastShown) {
              showToast('⚠️ 输入号码超过' + MAX_NUMBERS + '个，已截断');
              window._truncToastShown = true;
              setTimeout(function () { window._truncToastShown = false; }, 2000);
            }
          } else {
            DOM.numberWarn.classList.add('hidden');
          }
        }
        if (analysisWorker) {
          analysisWorker.postMessage({
            input: input,
            killNums: state.killNums,
            filters: getFilterSet(),
            numProps: numProps
          });
        }
      } catch (err) {
        console.error('runAnalysis error:', err);
      }
    }, 200);
  }

  function onStateChange() {
    runAnalysis();
    saveState();
  }

  // ======================== 开奖自动刷新控制 ========================
  let isCurrentDrawComplete = false;
  let lastLotteryPeriod = '';

  function checkDrawComplete(item) {
    if (!item || !item.openCode) return false;
    const codes = String(item.openCode).split(',').filter(function (c) { return c.trim() !== ''; });
    return codes.length >= 7;
  }

  async function safeFetch(url, options, retries) {
    options = options || {};
    retries = retries !== undefined ? retries : 2;
    for (let i = 0; i <= retries; i++) {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(function () { ctrl.abort(); }, options.timeout || 8000);
        const res = await fetch(url, Object.assign({}, options, { signal: ctrl.signal }));
        clearTimeout(tid);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res;
      } catch (e) {
        if (i === retries) throw e;
        await new Promise(function (r) { setTimeout(r, 800); });
      }
    }
  }

  async function fetchLottery() {
    const btn = DOM.refreshLotteryBtn;
    if (!btn) return;
    const origHtml = btn.innerHTML;
    btn.innerHTML = '<svg class="animate-spin w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>加载中...';
    btn.disabled = true;
    try {
      const res = await safeFetch(API_CONFIG.live + '?_t=' + Date.now());
      let data;
      try { data = await res.json(); }
      catch (parseErr) { showToast('数据格式异常'); return; }
      if (!Array.isArray(data) || !data[0]) { showToast('暂无开奖数据'); return; }
      const item = data[0];
      if (!item.openCode || typeof item.openCode !== 'string' ||
          !item.wave || typeof item.wave !== 'string' ||
          !item.zodiac || typeof item.zodiac !== 'string') {
        showToast('数据字段不完整'); return;
      }
      try {
        localStorage.setItem(LS_CACHE_KEY, JSON.stringify({ data: data, time: Date.now() }));
      } catch (e) {}
      if (lastLotteryPeriod !== item.expect) {
        lastLotteryPeriod = item.expect;
        isCurrentDrawComplete = false;
      }
      renderLottery(item);
      if (!isCurrentDrawComplete && checkDrawComplete(item)) {
        isCurrentDrawComplete = true;
        showToast('当期开奖已完成，自动刷新停止');
      } else {
        showToast('刷新成功');
      }
      if (DOM.lastRefreshTime) DOM.lastRefreshTime.textContent = '上次刷新：' + new Date().toLocaleTimeString();
    } catch (e) {
      console.error('fetchLottery error:', e);
      try {
        const cacheRaw = localStorage.getItem(LS_CACHE_KEY);
        if (cacheRaw) {
          const cache = JSON.parse(cacheRaw);
          if (cache.data && cache.data[0]) {
            renderLottery(cache.data[0]);
            showToast('离线模式：显示缓存数据');
            return;
          }
        }
      } catch (cacheErr) {}
      showToast('获取开奖失败');
    } finally {
      btn.innerHTML = origHtml;
      btn.disabled = false;
    }
  }

  function renderLottery(item) {
    const codes = String(item.openCode || '').split(',').map(function (c) { return escapeHtml(c.trim()); });
    const waves = String(item.wave || '').split(',').map(function (w) { return escapeHtml(w.trim()); });
    const zodiacs = String(item.zodiac || '').split(',').map(function (z) { return escapeHtml(z.trim()); });
    const container = DOM.lotteryBalls;
    if (!container) return;
    container.className = 'result-balls-row';
    container.innerHTML = '';
    const wxClassMap = {金:'wx-gold',木:'wx-wood',水:'wx-water',火:'wx-fire',土:'wx-earth'};
    for (let i = 0; i < 6 && i < codes.length; i++) {
      const num = parseInt(codes[i], 10);
      const colorClass = waves[i] === 'red' ? 'result-ball-red' : (waves[i] === 'green' ? 'result-ball-green' : 'result-ball-blue');
      const wx = (num >= 1 && num <= 49) ? (numProps[num] && numProps[num].five || '?') : '?';
      const wxCls = wxClassMap[wx] || '';
      const div = document.createElement('div');
      div.className = 'result-ball-item';
      div.innerHTML = '<div class="result-ball ' + colorClass + '" style="animation-delay: ' + (i * 150) + 'ms">' + escapeHtml(codes[i].padStart(2, '0')) + '<div class="result-ball-meta">' + escapeHtml(zodiacs[i] || '') + '/<span class="' + wxCls + '">' + wx + '</span></div></div>';
      container.appendChild(div);
    }
    if (codes.length >= 7) {
      const plus = document.createElement('div');
      plus.className = 'result-plus-sign';
      plus.textContent = '+';
      container.appendChild(plus);
    }
    if (codes.length >= 7) {
      const num = parseInt(codes[6], 10);
      const colorClass = waves[6] === 'red' ? 'result-ball-red' : (waves[6] === 'green' ? 'result-ball-green' : 'result-ball-blue');
      const wx = (num >= 1 && num <= 49) ? (numProps[num] && numProps[num].five || '?') : '?';
      const wxCls = wxClassMap[wx] || '';
      const div = document.createElement('div');
      div.className = 'result-ball-item';
      div.innerHTML = '<div class="result-ball ' + colorClass + '" style="animation-delay: ' + (6 * 150) + 'ms">' + escapeHtml(codes[6].padStart(2, '0')) + '<div class="result-ball-meta">' + escapeHtml(zodiacs[6] || '') + '/<span class="' + wxCls + '">' + wx + '</span></div></div>';
      container.appendChild(div);
    }
    void container.offsetHeight;
    if (DOM.lotteryPeriod) DOM.lotteryPeriod.textContent = escapeHtml(item.expect || '--');
    if (DOM.lotteryTime) DOM.lotteryTime.textContent = escapeHtml((item.openTime || '--').replace(' ', '\n'));
  }

  // ======================== 历史开奖记录 ========================
  let currentHistoryData = [];
  let currentHistorySorted = [];
  let currentHistoryPage = 1;
  let historyCache = {};
  let historyYearLoaded = null;

  function renderBallsHTML(codes, waves, zodiacs) {
    let html = '';
    codes.forEach(function (code, i) {
      const wave = waves[i];
      const zodiac = zodiacs[i];
      const cc = wave === 'blue' || wave === '蓝' ? 'history-ball-blue' : wave === 'green' || wave === '绿' ? 'history-ball-green' : 'history-ball-red';
      const num = parseInt(code, 10);
      const five = (num >= 1 && num <= 49) ? (numProps[num] && numProps[num].five || '') : '';
      html += '<div class="history-ball-card ' + cc + '"><div class="history-ball-number">' + escapeHtml(code) + '</div><div class="history-ball-tag">' + escapeHtml(zodiac || '') + '/' + escapeHtml(five) + '</div></div>';
      if (i === 5) html += '<span class="history-plus-sign">+</span>';
    });
    return html;
  }

  function ensureHistorySorted() {
    if (currentHistorySorted.length > 0) return;
    const seen = new Set();
    const unique = [];
    for (let i = 0; i < currentHistoryData.length; i++) {
      const item = currentHistoryData[i];
      if (item && item.expect && !seen.has(item.expect)) {
        seen.add(item.expect);
        unique.push(item);
      }
    }
    currentHistorySorted = unique.sort(function (a, b) {
      return String(b.expect).localeCompare(String(a.expect), undefined, { numeric: true });
    });
  }

  function renderHistoryPage() {
    try {
      const cont = document.getElementById('historyContent');
      const pagi = document.getElementById('historyPagination');
      ensureHistorySorted();
      const sorted = currentHistorySorted;
      if (!sorted || sorted.length === 0) {
        if (cont) cont.innerHTML = '<div class="text-gray-500 py-8 text-center">暂无数据</div>';
        if (pagi) pagi.classList.add('hidden');
        return;
      }
      const totalPages = Math.max(1, Math.ceil(sorted.length / HISTORY_PAGE_SIZE));
      if (currentHistoryPage > totalPages) currentHistoryPage = totalPages;
      const start = (currentHistoryPage - 1) * HISTORY_PAGE_SIZE;
      const pageData = sorted.slice(start, start + HISTORY_PAGE_SIZE);
      const frag = document.createDocumentFragment();
      for (let i = 0; i < pageData.length; i++) {
        const item = pageData[i];
        const expect = escapeHtml(item.expect || '');
        let ballsHtml = '';
        if (item.openCode && item.openCode.trim()) {
          const codes = item.openCode.split(',').map(function (c) { return escapeHtml(c.trim()); });
          const waves = (item.wave || '').split(',').map(function (w) { return escapeHtml(w.trim()); });
          const zodiacs = (item.zodiac || '').split(',').map(function (z) { return escapeHtml(z.trim()); });
          ballsHtml = renderBallsHTML(codes, waves, zodiacs);
        } else {
          ballsHtml = '<div class="flex justify-center items-center py-6 text-amber-400 text-sm font-medium">待开奖</div>';
        }
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = '<div class="history-item-header">第' + expect.slice(4) + '期 · ' + escapeHtml(item.openTime && item.openTime.slice(5, 16) || '') + '</div><div class="history-balls-row">' + ballsHtml + '</div>';
        frag.appendChild(div);
      }
      if (cont) {
        cont.innerHTML = '';
        cont.appendChild(frag);
      }
      const pageNumEl = document.getElementById('historyPageNum');
      const totalPagesEl = document.getElementById('historyTotalPages');
      if (pageNumEl) pageNumEl.textContent = currentHistoryPage;
      if (totalPagesEl) totalPagesEl.textContent = totalPages;
      if (pagi) {
        pagi.classList.toggle('hidden', totalPages <= 1);
        const prevBtn = pagi.querySelector('button:first-child');
        const nextBtn = pagi.querySelector('button:last-child');
        if (prevBtn) prevBtn.disabled = currentHistoryPage <= 1;
        if (nextBtn) nextBtn.disabled = currentHistoryPage >= totalPages;
      }
    } catch (err) {
      console.error('renderHistoryPage error:', err);
    }
  }

  window.prevHistoryPage = function () {
    if (currentHistoryPage > 1) { currentHistoryPage--; renderHistoryPage(); }
  };
  window.nextHistoryPage = function () {
    ensureHistorySorted();
    const totalPages = Math.ceil(currentHistorySorted.length / HISTORY_PAGE_SIZE);
    if (currentHistoryPage < totalPages) { currentHistoryPage++; renderHistoryPage(); }
  };

  // ======================== 底部抽屉系统 ========================
  const DrawerSystem = {
    current: null,
    templates: {
      shama: function () {
        return '<textarea id="kill-input" rows="3" class="w-full bg-[#1a1a2a] border border-[#00ffea]/30 rounded-lg p-3 text-[#00ffea] font-mono text-sm">' + state.killNums.join(' ') + '</textarea>';
      },
      shengxiao: function () {
        const sxs = ['鼠','牛','虎','兔','龙','蛇','马','羊','猴','鸡','狗','猪'];
        const sel = state.selectedFilters.shengxiao;
        return '<div class="grid grid-cols-6 gap-2">' + sxs.map(function (sx) {
          return '<label><input type="checkbox" class="filter-checkbox hidden" value="生肖' + sx + '" data-drawer="shengxiao" ' + (sel.includes('生肖' + sx) ? 'checked' : '') + '><span class="filter-label block text-center py-2 bg-[#1a1a2a] rounded-lg text-sm text-gray-400 border border-[#00ffea]/20">' + sx + '</span></label>';
        }).join('') + '</div>';
      },
      haomatou: function () {
        const heads = [['0头单','1头单','2头单','3头单','4头单'],['0头双','1头双','2头双','3头双','4头双']];
        const sel = state.selectedFilters.haomatou;
        return heads.map(function (row) {
          return '<div class="flex gap-2 mb-2">' + row.map(function (h) {
            return '<label class="flex-1"><input type="checkbox" class="filter-checkbox hidden" value="' + h + '" data-drawer="haomatou" ' + (sel.includes(h) ? 'checked' : '') + '><span class="filter-label block text-center py-2 bg-[#1a1a2a] rounded-lg text-xs">' + h + '</span></label>';
          }).join('') + '</div>';
        }).join('');
      },
      weishu: function () {
        const tails = [['0尾','1尾','2尾','3尾','4尾'],['5尾','6尾','7尾','8尾','9尾']];
        const sel = state.selectedFilters.weishu;
        return tails.map(function (row) {
          return '<div class="flex gap-2 mb-2">' + row.map(function (t) {
            return '<label class="flex-1"><input type="checkbox" class="filter-checkbox hidden" value="' + t + '" data-drawer="weishu" ' + (sel.includes(t) ? 'checked' : '') + '><span class="filter-label block text-center py-2 bg-[#1a1a2a] rounded-lg text-xs">' + t + '</span></label>';
          }).join('') + '</div>';
        }).join('');
      },
      shuduan: function () {
        const duans = ['1段','2段','3段','4段','5段','6段','7段'];
        const sel = state.selectedFilters.shuduan;
        return '<div class="flex flex-wrap gap-2">' + duans.map(function (d) {
          return '<label><input type="checkbox" class="filter-checkbox hidden" value="' + d + '" data-drawer="shuduan" ' + (sel.includes(d) ? 'checked' : '') + '><span class="filter-label block py-2 px-4 bg-[#1a1a2a] rounded-lg text-sm">' + d + '</span></label>';
        }).join('') + '</div>';
      },
      bose: function () {
        const items = [['红波单','蓝波单','绿波单'],['红波双','蓝波双','绿波双']];
        const sel = state.selectedFilters.bose;
        return items.map(function (row) {
          return '<div class="flex gap-2 mb-2">' + row.map(function (item) {
            return '<label class="flex-1"><input type="checkbox" class="filter-checkbox hidden" value="' + item + '" data-drawer="bose" ' + (sel.includes(item) ? 'checked' : '') + '><span class="filter-label block text-center py-2 bg-[#1a1a2a] rounded-lg text-xs">' + item.replace('波', '') + '</span></label>';
          }).join('') + '</div>';
        }).join('');
      },
      wuxing: function () {
        const wx = {金:'04 05 12 13 26 27 34 35 42 43',木:'08 09 16 17 24 25 38 39 46 47',水:'01 14 15 22 23 30 31 44 45',火:'02 03 10 11 18 19 32 33 40 41 48 49',土:'06 07 20 21 28 29 36 37'};
        const sel = state.selectedFilters.wuxing;
        return '<div class="space-y-2">' + Object.entries(wx).map(function (entry) {
          const k = entry[0], v = entry[1];
          return '<div class="flex items-center gap-3"><label class="flex items-center gap-2 min-w-0"><input type="checkbox" class="filter-checkbox hidden" value="' + k + '" data-drawer="wuxing" ' + (sel.includes(k) ? 'checked' : '') + '><span class="filter-label py-2 px-3 bg-[#1a1a2a] rounded-lg text-center wuxing-btn-fixed">' + k + '</span></label><span class="text-sm text-[#00ffea]/70 truncate flex-1">' + v + '</span></div>';
        }).join('') + '</div>';
      },
      bandanshuang: function () {
        const items = [['合数单','小单','大单'],['合数双','小双','大双']];
        const sel = state.selectedFilters.bandanshuang;
        return items.map(function (row) {
          return '<div class="flex gap-2 mb-2">' + row.map(function (item) {
            return '<label class="flex-1"><input type="checkbox" class="filter-checkbox hidden" value="' + item + '" data-drawer="bandanshuang" ' + (sel.includes(item) ? 'checked' : '') + '><span class="filter-label block text-center py-2 bg-[#1a1a2a] rounded-lg text-xs">' + item + '</span></label>';
          }).join('') + '</div>';
        }).join('');
      },
      heshu: function () {
        const hes = Array.from({ length: 13 }, function (_, i) { return (i + 1) + '合'; });
        const sel = state.selectedFilters.heshu;
        return '<div class="grid grid-cols-4 gap-2">' + hes.map(function (h) {
          return '<label><input type="checkbox" class="filter-checkbox hidden" value="' + h + '" data-drawer="heshu" ' + (sel.includes(h) ? 'checked' : '') + '><span class="filter-label block text-center py-2 bg-[#1a1a2a] rounded-lg text-xs">' + h + '</span></label>';
        }).join('') + '</div>';
      },
      live: function () {
        return '<div class="flex flex-col" style="height: calc(90vh - 68px); min-height: 480px;">' +
          '<div class="flex items-center justify-between mb-2 px-1 flex-wrap gap-2">' +
          '<span class="text-xs text-gray-400">直连视频流播放 · 自动切换备选源</span>' +
          '<a href="https://macaujc.com/open_video2/" target="_blank" rel="noopener noreferrer" class="text-xs bg-[#00ffea]/20 text-[#00ffea] px-3 py-1.5 rounded-lg border border-[#00ffea]/40 hover:bg-[#00ffea]/30 transition-all flex items-center gap-1">' +
          '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>新窗口观看</a></div>' +
          '<div class="flex gap-2 mb-3 flex-wrap" id="live-source-btns">' +
          '<button data-src-idx="0" class="live-src-btn px-3 py-1.5 rounded-lg text-xs font-medium bg-[#00ffea] text-black border border-[#00ffea]">源1·API获取</button>' +
          '<button data-src-idx="1" class="live-src-btn px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1a1a2a] text-gray-400 border border-[#00ffea]/20">源2·HLS</button>' +
          '<button data-src-idx="2" class="live-src-btn px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1a1a2a] text-gray-400 border border-[#00ffea]/20">源3·FLV</button>' +
          '</div>' +
          '<div class="relative flex-1 bg-black rounded-2xl overflow-hidden border border-[#00ffea]/40 shadow-2xl">' +
          '<video id="live-video" class="w-full h-full" controls autoplay playsinline muted style="background:#000;"></video>' +
          '<div id="live-loading" class="absolute inset-0 flex flex-col items-center justify-center bg-black z-10">' +
          '<svg class="animate-spin w-8 h-8 text-[#00ffea] mb-3" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>' +
          '<span class="text-sm text-gray-400" id="live-status">正在获取直播源...</span></div>' +
          '<div id="live-error" class="hidden absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a12] z-20 p-6 text-center">' +
          '<svg class="w-12 h-12 text-red-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>' +
          '<p class="text-red-400 font-bold mb-1">直播源加载失败</p>' +
          '<p class="text-xs text-gray-500 mb-4">所有备选源均无法连接</p>' +
          '<a href="https://macaujc.com/open_video2/" target="_blank" rel="noopener noreferrer" class="bg-gradient-to-r from-[#00ffea] to-[#0088ff] text-black font-bold px-6 py-2.5 rounded-xl hover:shadow-[0_0_20px_rgba(0,255,234,0.4)] transition-all flex items-center gap-2 mb-2">' +
          '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>macaujc.com 直播</a>' +
          '<a href="https://kj.416121.com/Marksix/Index" target="_blank" rel="noopener noreferrer" class="bg-[#1a1a2a] text-[#00ffea] font-bold px-6 py-2.5 rounded-xl border border-[#00ffea]/30 hover:bg-[#00ffea]/10 transition-all flex items-center gap-2">' +
          '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>备用直播站</a></div></div></div>';
      },
      history: function () {
        let opts = '';
        for (let y = new Date().getFullYear(); y >= 2020; y--) {
          opts += '<option value="' + y + '">' + y + '年</option>';
        }
        return '<div><select id="historyYear" class="w-full bg-[#1a1a2a] border border-[#00ffea]/30 rounded-lg p-3 text-[#00ffea]"><option value="">选择年份</option>' + opts + '</select>' +
          '<div id="historyLoading" class="hidden text-center py-4"><svg class="animate-spin w-6 h-6 mx-auto text-[#00ffea]" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg></div>' +
          '<div id="historyContent" class="mt-3 hide-scrollbar"></div>' +
          '<div id="historyPagination" class="flex justify-between items-center mt-6 px-1 hidden"><button id="history-prev" class="px-6 py-3 bg-[#1a1a2a] hover:bg-[#00ffea]/10 text-[#00ffea] rounded-2xl flex items-center gap-2 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">← 上1页</button>' +
          '<div class="text-center text-sm">第 <span id="historyPageNum" class="font-bold text-[#00ffea]">1</span> 页 / <span id="historyTotalPages" class="text-gray-400">1</span> 页</div>' +
          '<button id="history-next" class="px-6 py-3 bg-[#1a1a2a] hover:bg-[#00ffea]/10 text-[#00ffea] rounded-2xl flex items-center gap-2 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">下1页 →</button></div></div>';
      }
    },
    open: function (type) {
      if (this.current === type) { this.close(); return; }
      this.current = type;
      const titles = { shama: '杀码', shengxiao: '生肖', haomatou: '头数', weishu: '尾数', shuduan: '数段', bose: '波色', wuxing: '五行', bandanshuang: '半单双', heshu: '合数', live: '开奖直播', history: '历史开奖' };
      if (DOM.drawer_title) DOM.drawer_title.textContent = titles[type] || '筛选器';
      const contentDiv = DOM.drawer_content;
      if (contentDiv) contentDiv.innerHTML = (this.templates[type] ? this.templates[type]() : '<p>暂无</p>');
      if (DOM.drawer_overlay) {
        DOM.drawer_overlay.classList.remove('hidden');
        setTimeout(function () { DOM.drawer_overlay.classList.remove('opacity-0'); }, 10);
      }
      if (DOM.drawer_container) DOM.drawer_container.classList.add('open');
      this.bindEvents(type);
      this.updateNavState(type);
      if (type === 'history') {
        setTimeout(function () {
          const sel = document.getElementById('historyYear');
          if (sel && !sel.value) sel.value = historyYearLoaded || '';
          if (sel) sel.dispatchEvent(new Event('change'));
        }, 50);
      }
    },
    close: function () {
      if (DOM.drawer_container) DOM.drawer_container.classList.remove('open');
      if (DOM.drawer_overlay) {
        DOM.drawer_overlay.classList.add('opacity-0');
        setTimeout(function () { DOM.drawer_overlay.classList.add('hidden'); }, 300);
      }
      this.current = null;
      this.updateNavState(null);
    },
    bindEvents: function (type) {
      const content = DOM.drawer_content;
      if (!content) return;
      content.querySelectorAll('.filter-checkbox').forEach(function (cb) {
        cb.addEventListener('change', function (e) {
          const dr = e.target.dataset.drawer;
          const val = e.target.value;
          if (dr && state.selectedFilters[dr] !== undefined) toggleFilter(dr, val, e.target.checked);
        });
      });
      const killInput = document.getElementById('kill-input');
      if (killInput) {
        killInput.addEventListener('input', function () {
          const parsed = parseInputCount(killInput.value);
          setKillNums(parsed.nums.filter(function (n) { return n >= 1 && n <= 49; }));
        });
      }
      if (type === 'live') { initLivePlayer(); }
      if (type === 'history') {
        const yearSel = document.getElementById('historyYear');
        if (yearSel && !yearSel._listener) {
          yearSel.addEventListener('change', async function (e) {
            const year = e.target.value;
            if (!year) return;
            historyYearLoaded = year;
            const loadDiv = document.getElementById('historyLoading');
            const cont = document.getElementById('historyContent');
            if (loadDiv) loadDiv.classList.remove('hidden');
            try {
              if (historyCache[year]) {
                currentHistoryData = historyCache[year];
              } else {
                const res = await safeFetch(API_CONFIG.historyBase + year);
                const json = await res.json();
                if (json.code === 200 && json.data) {
                  currentHistoryData = json.data;
                  historyCache[year] = json.data;
                } else {
                  currentHistoryData = [];
                }
              }
              currentHistorySorted = [];
              currentHistoryPage = 1;
              renderHistoryPage();
            } catch (e) {
              console.error('history fetch error:', e);
              currentHistoryData = [];
              if (cont) cont.innerHTML = '<div class="text-red-400">加载失败</div>';
            } finally {
              if (loadDiv) loadDiv.classList.add('hidden');
            }
          });
          yearSel._listener = true;
        }
        const prevBtn = document.getElementById('history-prev');
        const nextBtn = document.getElementById('history-next');
        if (prevBtn && !prevBtn._listener) {
          prevBtn.addEventListener('click', function () {
            if (currentHistoryPage > 1) { currentHistoryPage--; renderHistoryPage(); }
          });
          prevBtn._listener = true;
        }
        if (nextBtn && !nextBtn._listener) {
          nextBtn.addEventListener('click', function () {
            ensureHistorySorted();
            const totalPages = Math.ceil(currentHistorySorted.length / HISTORY_PAGE_SIZE);
            if (currentHistoryPage < totalPages) { currentHistoryPage++; renderHistoryPage(); }
          });
          nextBtn._listener = true;
        }
      }
    },
    updateNavState: function (activeType) {
      document.querySelectorAll('.nav-item').forEach(function (el) {
        const dr = el.dataset.drawer;
        if (dr === activeType) {
          el.classList.add('bg-[#00ffea]', 'text-black');
          el.classList.remove('bg-[#1a1a2a]', 'text-gray-400');
        } else {
          el.classList.remove('bg-[#00ffea]', 'text-black');
          if (dr === 'selectnone') el.classList.add('bg-[#ff0055]/20', 'text-[#ff0055]');
          else el.classList.add('bg-[#1a1a2a]', 'text-gray-400');
        }
      });
    }
  };

  // ======================== 复制功能 ========================
  function copyResult() {
    if (!lastAnalysisResult) { showToast('暂无分析结果'); return; }
    const sortedFreqMap = lastAnalysisResult.sortedFreqMap;
    let text = '';
    sortedFreqMap.forEach(function (nums, f) {
      text += f + '次：' + nums.map(function (n) { return String(n).padStart(2, '0'); }).join(' ') + '\n';
    });
    if (text.trim()) {
      navigator.clipboard && navigator.clipboard.writeText(text.trim()).then(function () { showToast('已复制结果'); }).catch(function () { showToast('复制失败'); });
    }
  }
  function copyNumber(n) {
    navigator.clipboard && navigator.clipboard.writeText(String(n).padStart(2, '0')).then(function () { showToast('已复制 ' + n); }).catch(function () { showToast('复制失败'); });
  }
  window.copyResult = copyResult;

  // ======================== 直播播放器 ========================
  let currentHls = null;
  let currentFlvPlayer = null;
  let liveSourceIndex = 0;
  const LIVE_SOURCES = [
    { name: 'API获取', type: 'auto', url: '' },
    { name: 'HLS源1', type: 'hls', url: 'https://media.macaumarksix.com/live/marksix.m3u8' },
    { name: 'FLV源1', type: 'flv', url: 'https://media.macaumarksix.com/live/marksix.flv' }
  ];
  function initLivePlayer() {
    const video = document.getElementById('live-video');
    const loading = document.getElementById('live-loading');
    const error = document.getElementById('live-error');
    const status = document.getElementById('live-status');
    if (!video) return;
    const srcBtns = document.querySelectorAll('.live-src-btn');
    srcBtns.forEach(function (btn, idx) {
      btn.addEventListener('click', function () {
        srcBtns.forEach(function (b) {
          b.classList.remove('bg-[#00ffea]', 'text-black');
          b.classList.add('bg-[#1a1a2a]', 'text-gray-400');
        });
        btn.classList.remove('bg-[#1a1a2a]', 'text-gray-400');
        btn.classList.add('bg-[#00ffea]', 'text-black');
        liveSourceIndex = idx;
        connectLiveSource(idx);
      });
    });
    connectLiveSource(0);
    function connectLiveSource(idx) {
      destroyLivePlayer();
      if (loading) loading.classList.remove('hidden');
      if (error) error.classList.add('hidden');
      if (status) status.textContent = '正在连接 ' + LIVE_SOURCES[idx].name + '...';
      const src = LIVE_SOURCES[idx];
      if (src.type === 'auto') {
        fetch('https://macaumarksix.com/api/live2?_t=' + Date.now())
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data && data[0] && data[0].videoUrl) {
              playStream(data[0].videoUrl, detectStreamType(data[0].videoUrl));
            } else {
              if (idx + 1 < LIVE_SOURCES.length) {
                if (status) status.textContent = 'API无视频流，尝试下一个源...';
                setTimeout(function () { connectLiveSource(idx + 1); }, 1000);
              } else {
                showLiveError();
              }
            }
          })
          .catch(function () {
            if (idx + 1 < LIVE_SOURCES.length) {
              if (status) status.textContent = 'API请求失败，尝试下一个源...';
              setTimeout(function () { connectLiveSource(idx + 1); }, 1000);
            } else {
              showLiveError();
            }
          });
      } else if (src.url) {
        playStream(src.url, src.type);
      } else {
        showLiveError();
      }
    }
    function detectStreamType(url) {
      if (url.indexOf('.m3u8') !== -1) return 'hls';
      if (url.indexOf('.flv') !== -1) return 'flv';
      return 'hls';
    }
    function playStream(url, type) {
      if (type === 'hls' && window.Hls && Hls.isSupported()) {
        currentHls = new Hls({ enableWorker: true, lowLatencyMode: true });
        currentHls.loadSource(url);
        currentHls.attachMedia(video);
        currentHls.on(Hls.Events.MANIFEST_PARSED, function () {
          if (loading) loading.classList.add('hidden');
          video.play().catch(function () {});
        });
        currentHls.on(Hls.Events.ERROR, function () { tryNextSource(); });
      } else if (type === 'flv' && window.flvjs && flvjs.isSupported()) {
        currentFlvPlayer = flvjs.createPlayer({ type: 'flv', url: url, isLive: true });
        currentFlvPlayer.attachMediaElement(video);
        currentFlvPlayer.load();
        currentFlvPlayer.play();
        currentFlvPlayer.on(flvjs.Events.LOADING_COMPLETE, function () {
          if (loading) loading.classList.add('hidden');
        });
        currentFlvPlayer.on(flvjs.Events.ERROR, function () { tryNextSource(); });
        setTimeout(function () { if (loading) loading.classList.add('hidden'); }, 3000);
      } else {
        video.src = url;
        video.addEventListener('loadedmetadata', function () { if (loading) loading.classList.add('hidden'); });
        video.addEventListener('error', function () { tryNextSource(); });
        video.play().catch(function () {});
      }
    }
    function tryNextSource() {
      destroyLivePlayer();
      if (liveSourceIndex + 1 < LIVE_SOURCES.length) {
        liveSourceIndex++;
        const btns = document.querySelectorAll('.live-src-btn');
        btns.forEach(function (b, i) {
          if (i === liveSourceIndex) {
            b.classList.remove('bg-[#1a1a2a]', 'text-gray-400');
            b.classList.add('bg-[#00ffea]', 'text-black');
          } else {
            b.classList.remove('bg-[#00ffea]', 'text-black');
            b.classList.add('bg-[#1a1a2a]', 'text-gray-400');
          }
        });
        connectLiveSource(liveSourceIndex);
      } else {
        showLiveError();
      }
    }
    function showLiveError() {
      if (loading) loading.classList.add('hidden');
      if (error) error.classList.remove('hidden');
    }
    function destroyLivePlayer() {
      if (currentHls) { currentHls.destroy(); currentHls = null; }
      if (currentFlvPlayer) { currentFlvPlayer.destroy(); currentFlvPlayer = null; }
      if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    }
  }

  // ======================== 自动刷新控制 ========================
  function initAutoRefresh() {
    setInterval(function () {
      if (isCurrentDrawComplete) return;
      const now = new Date();
      const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
      const totalSec = h * 3600 + m * 60 + s;
      const startSec = 21 * 3600 + 33 * 60 + 20;
      const endSec = 21 * 3600 + 35 * 60 + 0;
      if (document.visibilityState === 'visible' && totalSec >= startSec && totalSec <= endSec) fetchLottery();
    }, 5000);
  }

  // ======================== 水泡粒子系统 ========================
  function initParticles() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let width, height;
    const particles = [];
    const MAX_PARTICLES = 60;
    const COLORS = ['#00ffea', '#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3', '#54a0ff', '#5f27cd'];

    function resize() {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    }
    function createParticle() {
      return {
        x: Math.random() * width,
        y: height + Math.random() * 20,
        r: Math.random() * 2.5 + 0.5,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        speed: Math.random() * 0.8 + 0.3,
        sway: Math.random() * 0.4 - 0.2,
        swayOffset: Math.random() * Math.PI * 2,
        alpha: Math.random() * 0.4 + 0.1,
        life: Math.random() * 200 + 150
      };
    }
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = createParticle();
      p.y = Math.random() * height;
      particles.push(p);
    }
    function animate() {
      ctx.clearRect(0, 0, width, height);
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.y -= p.speed;
        p.x += Math.sin(p.swayOffset + p.y * 0.01) * p.sway;
        p.life--;
        if (p.life <= 0 || p.y < -10) {
          particles[i] = createParticle();
          continue;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha * (p.life < 50 ? p.life / 50 : 1);
        ctx.fill();
        // 水泡高光
        ctx.beginPath();
        ctx.arc(p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(animate);
    }
    resize();
    animate();
    window.addEventListener('resize', resize);
  }

  // ======================== 初始化入口 ========================
  function init() {
    cacheDOM();
    loadState();
    initWorker();
    subscribe(onStateChange);
    initResultDelegation();
    initParticles();

    if (DOM.exampleBtn) {
      DOM.exampleBtn.addEventListener('click', function () {
        if (DOM.numbers) DOM.numbers.value = '龙蛇马 12 25 36 8 17 29 41 5 19 33 47';
        runAnalysis();
      });
    }
    // 清除按钮：只清除输入框，不清空抽屉筛选（用户要求）
    if (DOM.clearBtn) {
      DOM.clearBtn.addEventListener('click', function () {
        if (DOM.numbers) DOM.numbers.value = '';
        runAnalysis();
        showToast('已清空输入');
      });
    }
    if (DOM.copyResultBtn) DOM.copyResultBtn.addEventListener('click', copyResult);
    if (DOM.numbers) DOM.numbers.addEventListener('input', function () { runAnalysis(); });
    if (DOM.refreshLotteryBtn) DOM.refreshLotteryBtn.addEventListener('click', function () { fetchLottery(); });

    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const drawer = btn.dataset.drawer;
        if (drawer === 'selectnone') {
          // 底部导航"清空"按钮：重置所有筛选条件（不清空输入框）
          clearAllFilters();
          const killInput = document.getElementById('kill-input');
          if (killInput) killInput.value = '';
          DrawerSystem.close();
          showToast('已重置所有筛选');
        } else {
          DrawerSystem.open(drawer);
        }
      });
    });
    if (DOM.drawer_close) DOM.drawer_close.addEventListener('click', function () { DrawerSystem.close(); });
    if (DOM.drawer_overlay) DOM.drawer_overlay.addEventListener('click', function () { DrawerSystem.close(); });

    fetchLottery();
    runAnalysis();
    initAutoRefresh();

    window.addEventListener('beforeunload', function () {
      terminateWorker();
    });

    console.log('%c✅ 神码再现 v3.6 已加载（GitHub Pages 兼容版 · 水泡粒子 · 0次统计）', 'color:#00ffea;font-weight:bold');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
