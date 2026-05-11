// ======================== app.js — 主线程核心逻辑 v3.7.1 (完整版) ========================
(function() {
  "use strict";

  // ---------- 配置常量 ----------
  const MAX_NUMBERS = (window.APP_DATA && window.APP_DATA.MAX_NUMBERS) || 5000;
  const SHENGXIAO = (window.APP_DATA && window.APP_DATA.SHENGXIAO) || (() => {
    return { 鼠:[7,19,31,43],牛:[6,18,30,42],虎:[5,17,29,41],兔:[4,16,28,40],龙:[3,15,27,39],蛇:[2,14,26,38],马:[1,13,25,37,49],羊:[12,24,36,48],猴:[11,23,35,47],鸡:[10,22,34,46],狗:[9,21,33,45],猪:[8,20,32,44] };
  })();
  const numProps = (window.APP_DATA && window.APP_DATA.numProps) || new Array(50).fill({});
  const API_CONFIG = {
    live: 'https://macaumarksix.com/api/live2',
    historyBase: 'https://history.macaumarksix.com/history/macaujc2/y/'
  };
  const HISTORY_PAGE_SIZE = 15;
  const LS_KEY = 'shenma_v4_state';
  const LS_CACHE_KEY = 'shenma_v4_lottery_cache';

  // ---------- DOM 缓存 ----------
  const DOM = {};
  function cacheDOM() {
    const ids = ['numbers','result','charCount','numberWarn','exampleBtn','clearBtn','copyResultBtn',
                 'lotteryPeriod','lotteryTime','lastRefreshTime','lotteryBalls','refreshLotteryBtn',
                 'drawer-overlay','drawer-container','drawer-title','drawer-content','drawer-close','toast'];
    for (const id of ids) {
      DOM[id.replace(/-/g, '_')] = document.getElementById(id);
    }
  }

  // ---------- 状态管理 ----------
  let state = {
    killNums: [],
    selectedFilters: {
      shengxiao: [], haomatou: [], weishu: [], shuduan: [],
      bose: [], wuxing: [], bandanshuang: [], heshu: []
    }
  };
  let subscribers = [];
  let lastAnalysisResult = null;

  function subscribe(fn) { subscribers.push(fn); }
  function notify() { subscribers.forEach(fn => fn()); }
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
      if (Array.isArray(parsed.killNums)) {
        state.killNums = parsed.killNums.filter(n => Number.isInteger(n) && n >= 1 && n <= 49);
      }
      if (parsed.selectedFilters && typeof parsed.selectedFilters === 'object') {
        for (const key in state.selectedFilters) {
          if (Array.isArray(parsed.selectedFilters[key])) {
            state.selectedFilters[key] = parsed.selectedFilters[key].slice(0, 50);
          }
        }
      }
    } catch (e) {}
  }

  function setKillNums(newNums) {
    state.killNums = [...new Set(newNums.filter(n => n >= 1 && n <= 49))];
    notify();
    saveState();
  }
  function toggleFilter(category, value, checked) {
    if (!state.selectedFilters.hasOwnProperty(category)) return;
    const arr = state.selectedFilters[category];
    if (checked) {
      if (!arr.includes(value)) arr.push(value);
    } else {
      const idx = arr.indexOf(value);
      if (idx !== -1) arr.splice(idx, 1);
    }
    notify();
    saveState();
  }
  function clearAllFilters() {
    state.killNums = [];
    for (const key in state.selectedFilters) {
      state.selectedFilters[key] = [];
    }
    notify();
    saveState();
  }
  function getFilterSet() {
    return Object.values(state.selectedFilters).flat();
  }

  // ---------- 工具函数 ----------
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>]/g, function(m) {
      if (m === '&') return '&amp;';
      if (m === '<') return '&lt;';
      if (m === '>') return '&gt;';
      return m;
    });
  }
  function showToast(msg) {
    const t = DOM.toast;
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(() => t.classList.add('translate-y-20', 'opacity-0'), 2000);
  }

  function parseInputPreview(input) {
    if (!input || !input.trim()) return { rawCount: 0, truncated: false };
    let cleaned = input.replace(/《.*?》/g, ' ').replace(/[^0-9鼠牛虎兔龙蛇马羊猴鸡狗猪]/g, ' ').replace(/([鼠牛虎兔龙蛇马羊猴鸡狗猪])/g, ' $1 ');
    const tokens = cleaned.split(/\s+/).filter(t => t.length > 0);
    let rawResults = [];
    for (const token of tokens) {
      if (SHENGXIAO[token]) {
        rawResults.push(...SHENGXIAO[token]);
      } else if (/^\d+$/.test(token)) {
        let n = Number(token);
        if (n >= 1 && n <= 49) rawResults.push(n);
      }
    }
    const truncated = rawResults.length > MAX_NUMBERS;
    const finalCount = truncated ? MAX_NUMBERS : rawResults.length;
    return { rawCount: finalCount, truncated };
  }

  // 筛选匹配缓存
  let cachedMatchFuncs = null;
  let lastFilterSignature = '';
  function getMatchFuncs() {
    const sig = JSON.stringify(state.selectedFilters);
    if (cachedMatchFuncs && sig === lastFilterSignature) return cachedMatchFuncs;
    lastFilterSignature = sig;
    const conditions = getFilterSet();
    cachedMatchFuncs = conditions.map(cond => buildMatchFunc(cond));
    return cachedMatchFuncs;
  }
  function buildMatchFunc(cond) {
    if (cond.startsWith('生肖')) {
      const sx = cond.slice(2);
      return n => numProps[n] && numProps[n].shengXiao === sx;
    }
    if (cond.endsWith('头单') || cond.endsWith('头双')) {
      const parts = cond.split('头');
      const headVal = parseInt(parts[0], 10);
      const oe = parts[1];
      return n => numProps[n] && numProps[n].head === headVal && numProps[n].odd === oe;
    }
    if (cond.endsWith('尾')) {
      const tailVal = parseInt(cond[0], 10);
      return n => numProps[n] && numProps[n].tail === tailVal;
    }
    if (cond.endsWith('段')) {
      return n => numProps[n] && numProps[n].duan === cond;
    }
    if (cond.endsWith('波单') || cond.endsWith('波双')) {
      const parts = cond.split('波');
      const c = parts[0];
      const oe = parts[1];
      const colorMap = {红:'red',蓝:'blue',绿:'green'};
      return n => numProps[n] && numProps[n].color === colorMap[c] && numProps[n].odd === oe;
    }
    if (['金','木','水','火','土'].includes(cond)) {
      return n => numProps[n] && numProps[n].five === cond;
    }
    if (['合数单','合数双','大单','大双','小单','小双'].includes(cond)) {
      if (cond === '合数单') return n => numProps[n] && numProps[n].sumOdd === '合数单';
      if (cond === '合数双') return n => numProps[n] && numProps[n].sumOdd === '合数双';
      return n => numProps[n] && numProps[n].halfOddEven === cond;
    }
    if (cond.endsWith('合')) {
      const sumVal = parseInt(cond, 10);
      return n => numProps[n] && numProps[n].sum === sumVal;
    }
    return () => false;
  }

  // ---------- Worker 通信 ----------
  let analysisWorker = null;
  let debounceTimer = null;
  function initWorker() {
    if (analysisWorker) return;
    try {
      analysisWorker = new Worker('worker.js');
      analysisWorker.onmessage = onWorkerMessage;
      analysisWorker.onerror = (e) => { console.error('Worker error', e); showToast('分析引擎启动失败'); };
    } catch (e) { console.error(e); showToast('Worker 初始化失败'); }
  }
  function terminateWorker() { if (analysisWorker) { analysisWorker.terminate(); analysisWorker = null; } }
  function onWorkerMessage(e) {
    try {
      renderResult(e.data.adjustedCount, e.data.adjustedTotal, e.data.unique, e.data.hitCounts);
    } catch (err) { console.error(err); }
  }
  function runAnalysis() {
    initWorker();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const input = DOM.numbers ? DOM.numbers.value : '';
      const preview = parseInputPreview(input);
      if (DOM.charCount) DOM.charCount.textContent = preview.rawCount;
      if (DOM.numberWarn) {
        if (preview.truncated) {
          DOM.numberWarn.classList.remove('hidden');
          if (!window._truncToastShown) {
            showToast(`输入超过${MAX_NUMBERS}个，已截断`);
            window._truncToastShown = true;
            setTimeout(() => { window._truncToastShown = false; }, 2000);
          }
        } else {
          DOM.numberWarn.classList.add('hidden');
        }
      }
      if (analysisWorker) {
        analysisWorker.postMessage({ input: input, killNums: state.killNums, filters: getFilterSet() });
      }
    }, 200);
  }
  function onStateChange() { runAnalysis(); }

  // ---------- 渲染结果 ----------
  let currentUniqueElement = null;
  let lastUniqueNum = null;

  function renderResult(adjustedCount, adjustedTotal, unique, hitCounts) {
    const container = DOM.result;
    if (!container) return;
    if (currentUniqueElement) {
      currentUniqueElement.classList.remove('flash-unique');
      currentUniqueElement = null;
    }

    const freqMap = new Map();
    for (let n = 1; n <= 49; n++) {
      const f = adjustedCount[n];
      if (f > 0) {
        if (!freqMap.has(f)) freqMap.set(f, []);
        freqMap.get(f).push(n);
      }
    }
    const freqs = Array.from(freqMap.keys()).sort((a,b) => b - a);
    let killDrawn = false;
    const avg = unique ? (adjustedTotal / unique).toFixed(2) : '0.00';

    const unhitNumbers = [];
    for (let n = 1; n <= 49; n++) {
      if (adjustedCount[n] > 0 && hitCounts[n] === 0) unhitNumbers.push(n);
    }
    const isUniqueUnhit = unhitNumbers.length === 1;
    const uniqueUnhitNum = isUniqueUnhit ? unhitNumbers[0] : null;
    const killSet = new Set(state.killNums);

    const htmlParts = [];
    for (const f of freqs) {
      if (!killDrawn && f <= (adjustedTotal / unique)) {
        htmlParts.push('<div class="kill-line"></div>');
        killDrawn = true;
      }
      htmlParts.push(`<div class="flex items-start gap-2 mb-2 flex-wrap"><span class="text-xs text-green-500 font-mono min-w-[36px] pt-2">${f}次：</span><div class="flex flex-wrap gap-1.5 flex-1">`);
      const nums = freqMap.get(f).sort((a,b) => a - b);
      for (const n of nums) {
        const hit = hitCounts[n] || 0;
        const isGray = hit > 0;
        const p = numProps[n];
        let baseColorClass = isGray ? 'ball-gray' : (p && p.color === 'red' ? 'ball-red' : (p && p.color === 'green' ? 'ball-green' : 'ball-blue'));
        const isTarget = (n === uniqueUnhitNum);
        const flashClass = isTarget ? 'flash-unique' : '';
        let markHtml = '';
        if (killSet.has(n)) {
          markHtml = '<span class="hit-mark cross">✘</span>';
        } else if (hit > 0) {
          markHtml = `<span class="hit-mark">${hit}</span>`;
        }
        htmlParts.push(`<button class="ball-3d ${baseColorClass} ${flashClass}" data-num="${n}">${String(n).padStart(2,'0')}${markHtml}</button>`);
      }
      htmlParts.push('</div></div>');
    }

    if (unique < 49 && adjustedTotal > 0) {
      const zeroNums = [];
      for (let n = 1; n <= 49; n++) {
        if (adjustedCount[n] === 0) zeroNums.push(n);
      }
      if (zeroNums.length) {
        htmlParts.push('<div class="zero-count-section"><div class="zero-count-label">0次（未出现 ' + zeroNums.length + ' 个）：</div><div class="flex flex-wrap gap-1.5">');
        zeroNums.sort((a,b) => a - b);
        for (const n of zeroNums) {
          const p = numProps[n];
          let baseColorClass = p && p.color === 'red' ? 'ball-red' : (p && p.color === 'green' ? 'ball-green' : 'ball-blue');
          htmlParts.push(`<button class="ball-3d ${baseColorClass}" data-num="${n}">${String(n).padStart(2,'0')}</button>`);
        }
        htmlParts.push('</div></div>');
      }
    }

    if (unique === 0 && freqs.length === 0) {
      htmlParts.push('<div class="text-center py-8 text-amber-400">⚡ 所有号码频次归零，请调整筛选条件 ⚡</div>');
    }

    htmlParts.push(`<div class="mt-4 grid grid-cols-3 gap-2 p-3 bg-[#1a1a2a] rounded-lg border border-[#00ffea]/20"><div class="text-center"><div class="text-[#00ffea] font-bold text-lg">${unique}</div><div class="text-xs text-gray-500">有效数字个数</div></div><div class="text-center"><div class="text-[#00ffea] font-bold text-lg">${adjustedTotal}</div><div class="text-xs text-gray-500">调整后总次数</div></div><div class="text-center"><div class="text-[#00ffea] font-bold text-lg">${avg}</div><div class="text-xs text-gray-500">调整后平均次数</div></div></div>`);

    container.innerHTML = htmlParts.join('');

    if (uniqueUnhitNum) {
      currentUniqueElement = container.querySelector(`[data-num="${uniqueUnhitNum}"]`);
      if (lastUniqueNum !== uniqueUnhitNum) {
        lastUniqueNum = uniqueUnhitNum;
        const p = numProps[uniqueUnhitNum];
        const flyColor = p && p.color === 'red' ? 'ball-red' : (p && p.color === 'green' ? 'ball-green' : 'ball-blue');
        setTimeout(() => launchUniqueFlyEffect(uniqueUnhitNum, flyColor), 100);
      }
    } else {
      lastUniqueNum = null;
    }

    lastAnalysisResult = { sortedFreqMap: freqMap, adjustedTotal, unique, avg };
  }

  function launchUniqueFlyEffect(targetNum, colorClass) {
    const targetEl = DOM.result.querySelector(`[data-num="${targetNum}"]`);
    if (!targetEl) return;
    const targetRect = targetEl.getBoundingClientRect();
    const startX = window.innerWidth / 2 - 22;
    const startY = -60;
    const endX = targetRect.left + targetRect.width / 2 - 22;
    const endY = targetRect.top + targetRect.height / 2 - 22;
    const glowColor = colorClass === 'ball-red' ? '#ff3366' : colorClass === 'ball-green' ? '#33cc66' : '#3366ff';

    const ball = document.createElement('div');
    ball.className = `flying-unique-ball ${colorClass}`;
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
      trail.style.boxShadow = `0 0 6px ${glowColor}`;
      document.body.appendChild(trail);
      requestAnimationFrame(() => {
        trail.style.transition = 'all 0.5s ease';
        trail.style.opacity = '0';
        trail.style.transform = 'scale(0.2)';
      });
      setTimeout(() => trail.remove(), 500);
    }
    function animate(timestamp) {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      const currentX = startX + (endX - startX) * ease;
      const currentY = startY + (endY - startY) * ease;
      const scale = 0.6 + Math.sin(progress * Math.PI) * 0.6;
      const rotate = progress * 1080;
      ball.style.transform = `translate3d(${currentX - startX}px, ${currentY - startY}px, 0) scale(${scale}) rotate(${rotate}deg)`;
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
        setTimeout(() => targetEl.classList.remove('landing-shock'), 400);
        showToast(`🎯 独苗守护：${String(targetNum).padStart(2, '0')} 号`);
      }
    }
    requestAnimationFrame(animate);
  }

  function copyResult() {
    if (!lastAnalysisResult) { showToast('暂无分析结果'); return; }
    const sortedFreqMap = lastAnalysisResult.sortedFreqMap;
    let text = '';
    for (const [f, nums] of sortedFreqMap.entries()) {
      text += `${f}次：${nums.map(n => String(n).padStart(2,'0')).join(' ')}\n`;
    }
    if (text.trim()) {
      navigator.clipboard?.writeText(text.trim()).then(() => showToast('已复制结果')).catch(() => showToast('复制失败'));
    }
  }
  window.copyResult = copyResult;

  function initResultDelegation() {
    const resultEl = DOM.result;
    if (!resultEl) return;
    resultEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-num]');
      if (btn) {
        const num = Number(btn.dataset.num);
        if (!isNaN(num)) {
          navigator.clipboard?.writeText(String(num).padStart(2,'0')).then(() => showToast(`已复制 ${num}`)).catch(() => showToast('复制失败'));
        }
      }
    });
  }

  // ---------- 开奖模块 ----------
  let isCurrentDrawComplete = false;
  let lastLotteryPeriod = '';

  function checkDrawComplete(item) {
    if (!item || !item.openCode) return false;
    const codes = String(item.openCode).split(',').filter(c => c.trim());
    return codes.length >= 7;
  }

  async function safeFetch(url, options = {}, retries = 2) {
    for (let i = 0; i <= retries; i++) {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), options.timeout || 8000);
        const res = await fetch(url, { ...options, signal: ctrl.signal });
        clearTimeout(tid);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res;
      } catch (e) {
        if (i === retries) throw e;
        await new Promise(r => setTimeout(r, 800));
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
      const data = await res.json();
      if (!Array.isArray(data) || !data[0]) throw new Error('no data');
      const item = data[0];
      if (!item.openCode || !item.wave || !item.zodiac) throw new Error('invalid fields');
      localStorage.setItem(LS_CACHE_KEY, JSON.stringify({ data, time: Date.now() }));
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
      if (DOM.lastRefreshTime) DOM.lastRefreshTime.textContent = `上次刷新：${new Date().toLocaleTimeString()}`;
    } catch (e) {
      console.error(e);
      const cacheRaw = localStorage.getItem(LS_CACHE_KEY);
      if (cacheRaw) {
        try {
          const cache = JSON.parse(cacheRaw);
          if (cache.data && cache.data[0]) {
            renderLottery(cache.data[0]);
            showToast('离线模式：显示缓存数据');
            return;
          }
        } catch (_) {}
      }
      showToast('获取开奖失败');
    } finally {
      btn.innerHTML = origHtml;
      btn.disabled = false;
    }
  }

  function renderLottery(item) {
    const codes = String(item.openCode || '').split(',').map(c => escapeHtml(c.trim()));
    const waves = String(item.wave || '').split(',').map(w => escapeHtml(w.trim()));
    const zodiacs = String(item.zodiac || '').split(',').map(z => escapeHtml(z.trim()));
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
      div.innerHTML = `<div class="result-ball ${colorClass}" style="animation-delay: ${i * 150}ms">${codes[i].padStart(2,'0')}<div class="result-ball-meta">${zodiacs[i] || ''}/<span class="${wxCls}">${wx}</span></div></div>`;
      container.appendChild(div);
    }
    if (codes.length >= 7) {
      const plus = document.createElement('div');
      plus.className = 'result-plus-sign';
      plus.textContent = '+';
      container.appendChild(plus);
      const num = parseInt(codes[6], 10);
      const colorClass = waves[6] === 'red' ? 'result-ball-red' : (waves[6] === 'green' ? 'result-ball-green' : 'result-ball-blue');
      const wx = (num >= 1 && num <= 49) ? (numProps[num] && numProps[num].five || '?') : '?';
      const wxCls = wxClassMap[wx] || '';
      const div = document.createElement('div');
      div.className = 'result-ball-item';
      div.innerHTML = `<div class="result-ball ${colorClass}" style="animation-delay: ${6 * 150}ms">${codes[6].padStart(2,'0')}<div class="result-ball-meta">${zodiacs[6] || ''}/<span class="${wxCls}">${wx}</span></div></div>`;
      container.appendChild(div);
    }
    if (DOM.lotteryPeriod) DOM.lotteryPeriod.textContent = escapeHtml(item.expect || '--');
    if (DOM.lotteryTime) DOM.lotteryTime.textContent = escapeHtml((item.openTime || '--').replace(' ', '\n'));
  }

  function initAutoRefresh() {
    setInterval(() => {
      if (isCurrentDrawComplete) return;
      const now = new Date();
      const totalSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      const startSec = 21 * 3600 + 33 * 60 + 20;
      const endSec = 21 * 3600 + 35 * 60;
      if (document.visibilityState === 'visible' && totalSec >= startSec && totalSec <= endSec) fetchLottery();
    }, 5000);
  }

  // ---------- 抽屉系统 (修复版) ----------
  const DrawerSystem = {
    current: null,
    templates: {
      shama: () => `<textarea id="kill-input" rows="3" class="w-full bg-[#1a1a2a] border border-[#00ffea]/30 rounded-lg p-3 text-[#00ffea] font-mono text-sm">${state.killNums.join(' ')}</textarea>`,
      shengxiao: () => {
        const sxs = ['鼠','牛','虎','兔','龙','蛇','马','羊','猴','鸡','狗','猪'];
        const sel = state.selectedFilters.shengxiao;
        return `<div class="grid grid-cols-6 gap-2">${sxs.map(sx => `<label><input type="checkbox" class="filter-checkbox hidden" value="生肖${sx}" data-drawer="shengxiao" ${sel.includes('生肖'+sx) ? 'checked' : ''}><span class="filter-label block text-center py-2 bg-[#1a1a2a] rounded-lg text-sm text-gray-400 border border-[#00ffea]/20">${sx}</span></label>`).join('')}</div>`;
      },
      haomatou: () => {
        const heads = [['0头单','1头单','2头单','3头单','4头单'],['0头双','1头双','2头双','3头双','4头双']];
        const sel = state.selectedFilters.haomatou;
        return heads.map(row => `<div class="flex gap-2 mb-2">${row.map(h => `<label class="flex-1"><input type="checkbox" class="filter-checkbox hidden" value="${h}" data-drawer="haomatou" ${sel.includes(h) ? 'checked' : ''}><span class="filter-label block text-center py-2 bg-[#1a1a2a] rounded-lg text-xs">${h}</span></label>`).join('')}</div>`).join('');
      },
      weishu: () => {
        const tails = [['0尾','1尾','2尾','3尾','4尾'],['5尾','6尾','7尾','8尾','9尾']];
        const sel = state.selectedFilters.weishu;
        return tails.map(row => `<div class="flex gap-2 mb-2">${row.map(t => `<label class="flex-1"><input type="checkbox" class="filter-checkbox hidden" value="${t}" data-drawer="weishu" ${sel.includes(t) ? 'checked' : ''}><span class="filter-label block text-center py-2 bg-[#1a1a2a] rounded-lg text-xs">${t}</span></label>`).join('')}</div>`).join('');
      },
      shuduan: () => {
        const duans = ['1段','2段','3段','4段','5段','6段','7段'];
        const sel = state.selectedFilters.shuduan;
        return `<div class="flex flex-wrap gap-2">${duans.map(d => `<label><input type="checkbox" class="filter-checkbox hidden" value="${d}" data-drawer="shuduan" ${sel.includes(d) ? 'checked' : ''}><span class="filter-label block py-2 px-4 bg-[#1a1a2a] rounded-lg text-sm">${d}</span></label>`).join('')}</div>`;
      },
      bose: () => {
        const items = [['红波单','蓝波单','绿波单'],['红波双','蓝波双','绿波双']];
        const sel = state.selectedFilters.bose;
        return items.map(row => `<div class="flex gap-2 mb-2">${row.map(b => `<label class="flex-1"><input type="checkbox" class="filter-checkbox hidden" value="${b}" data-drawer="bose" ${sel.includes(b) ? 'checked' : ''}><span class="filter-label block text-center py-2 bg-[#1a1a2a] rounded-lg text-xs">${b.replace('波','')}</span></label>`).join('')}</div>`).join('');
      },
      wuxing: () => {
        const wxMap = {金:'04 05 12 13 26 27 34 35 42 43',木:'08 09 16 17 24 25 38 39 46 47',水:'01 14 15 22 23 30 31 44 45',火:'02 03 10 11 18 19 32 33 40 41 48 49',土:'06 07 20 21 28 29 36 37'};
        const sel = state.selectedFilters.wuxing;
        return `<div class="space-y-2">${Object.entries(wxMap).map(([k,v]) => `<div class="flex items-center gap-3"><label class="flex items-center gap-2"><input type="checkbox" class="filter-checkbox hidden" value="${k}" data-drawer="wuxing" ${sel.includes(k) ? 'checked' : ''}><span class="filter-label py-2 px-3 bg-[#1a1a2a] rounded-lg text-center wuxing-btn-fixed">${k}</span></label><span class="text-sm text-[#00ffea]/70 truncate flex-1">${v}</span></div>`).join('')}</div>`;
      },
      bandanshuang: () => {
        const items = [['合数单','小单','大单'],['合数双','小双','大双']];
        const sel = state.selectedFilters.bandanshuang;
        return items.map(row => `<div class="flex gap-2 mb-2">${row.map(b => `<label class="flex-1"><input type="checkbox" class="filter-checkbox hidden" value="${b}" data-drawer="bandanshuang" ${sel.includes(b) ? 'checked' : ''}><span class="filter-label block text-center py-2 bg-[#1a1a2a] rounded-lg text-xs">${b}</span></label>`).join('')}</div>`).join('');
      },
      heshu: () => {
        const hes = Array.from({ length:13 }, (_,i) => (i+1)+'合');
        const sel = state.selectedFilters.heshu;
        return `<div class="grid grid-cols-4 gap-2">${hes.map(h => `<label><input type="checkbox" class="filter-checkbox hidden" value="${h}" data-drawer="heshu" ${sel.includes(h) ? 'checked' : ''}><span class="filter-label block text-center py-2 bg-[#1a1a2a] rounded-lg text-xs">${h}</span></label>`).join('')}</div>`;
      },
      live: () => `<div class="flex flex-col" style="height: calc(90vh - 68px); min-height: 480px;"><div class="flex items-center justify-between mb-2 px-1 flex-wrap gap-2"><span class="text-xs text-gray-400">直连视频流播放 · 自动切换备选源</span><a href="https://macaujc.com/open_video2/" target="_blank" rel="noopener noreferrer" class="text-xs bg-[#00ffea]/20 text-[#00ffea] px-3 py-1.5 rounded-lg border border-[#00ffea]/40 hover:bg-[#00ffea]/30 transition-all flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>新窗口观看</a></div><div class="flex gap-2 mb-3 flex-wrap" id="live-source-btns"><button data-src-idx="0" class="live-src-btn px-3 py-1.5 rounded-lg text-xs font-medium bg-[#00ffea] text-black border border-[#00ffea]">源1·API获取</button><button data-src-idx="1" class="live-src-btn px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1a1a2a] text-gray-400 border border-[#00ffea]/20">源2·HLS</button><button data-src-idx="2" class="live-src-btn px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1a1a2a] text-gray-400 border border-[#00ffea]/20">源3·FLV</button></div><div class="relative flex-1 bg-black rounded-2xl overflow-hidden border border-[#00ffea]/40 shadow-2xl"><video id="live-video" class="w-full h-full" controls autoplay playsinline muted style="background:#000;"></video><div id="live-loading" class="absolute inset-0 flex flex-col items-center justify-center bg-black z-10"><svg class="animate-spin w-8 h-8 text-[#00ffea] mb-3" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg><span class="text-sm text-gray-400" id="live-status">正在获取直播源...</span></div><div id="live-error" class="hidden absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a12] z-20 p-6 text-center"><svg class="w-12 h-12 text-red-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg><p class="text-red-400 font-bold mb-1">直播源加载失败</p><p class="text-xs text-gray-500 mb-4">所有备选源均无法连接</p><a href="https://macaujc.com/open_video2/" target="_blank" rel="noopener noreferrer" class="bg-gradient-to-r from-[#00ffea] to-[#0088ff] text-black font-bold px-6 py-2.5 rounded-xl hover:shadow-[0_0_20px_rgba(0,255,234,0.4)] transition-all flex items-center gap-2 mb-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>macaujc.com 直播</a><a href="https://momarksix.org/video" target="_blank" rel="noopener noreferrer" class="bg-[#1a1a2a] text-[#00ffea] font-bold px-6 py-2.5 rounded-xl border border-[#00ffea]/30 hover:bg-[#00ffea]/10 transition-all flex items-center gap-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>备用直播站</a></div></div></div>`,
      history: () => {
        let opts = '';
        for (let y = new Date().getFullYear(); y >= 2020; y--) opts += `<option value="${y}">${y}年</option>`;
        return `<div><select id="historyYear" class="w-full bg-[#1a1a2a] border border-[#00ffea]/30 rounded-lg p-3 text-[#00ffea]"><option value="">选择年份</option>${opts}</select><div id="historyLoading" class="hidden text-center py-4"><svg class="animate-spin w-6 h-6 mx-auto text-[#00ffea]" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg></div><div id="historyContent" class="mt-3 hide-scrollbar"></div><div id="historyPagination" class="flex justify-between items-center mt-6 px-1 hidden"><button id="history-prev" class="px-6 py-3 bg-[#1a1a2a] hover:bg-[#00ffea]/10 text-[#00ffea] rounded-2xl flex items-center gap-2 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">← 上1页</button><div class="text-center text-sm">第 <span id="historyPageNum" class="font-bold text-[#00ffea]">1</span> 页 / <span id="historyTotalPages" class="text-gray-400">1</span> 页</div><button id="history-next" class="px-6 py-3 bg-[#1a1a2a] hover:bg-[#00ffea]/10 text-[#00ffea] rounded-2xl flex items-center gap-2 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">下1页 →</button></div></div>`
      }
    },
    open(type) {
      if (this.current === type) { this.close(); return; }
      this.current = type;
      const titles = { shama:'杀码', shengxiao:'生肖', haomatou:'头数', weishu:'尾数', shuduan:'数段', bose:'波色', wuxing:'五行', bandanshuang:'半单双', heshu:'合数', live:'开奖直播', history:'历史开奖' };
      if (DOM.drawer_title) DOM.drawer_title.textContent = titles[type] || '筛选器';
      try {
        if (DOM.drawer_content) {
          const templateFn = this.templates[type];
          if (templateFn) {
            DOM.drawer_content.innerHTML = templateFn();
          } else {
            DOM.drawer_content.innerHTML = '<p class="text-red-400">暂未实现</p>';
          }
        }
        if (DOM.drawer_overlay) {
          DOM.drawer_overlay.classList.remove('hidden');
          setTimeout(() => DOM.drawer_overlay.classList.remove('opacity-0'), 10);
        }
        if (DOM.drawer_container) DOM.drawer_container.classList.add('open');
        this.updateNavState(type);
        if (type === 'history') {
          setTimeout(() => {
            const sel = document.getElementById('historyYear');
            if (sel) {
              if (!sel.value && historyYearLoaded) sel.value = historyYearLoaded;
              sel.dispatchEvent(new Event('change'));
            }
          }, 80);
        }
        if (type === 'live') {
          setTimeout(() => initLivePlayer(), 20);
        }
      } catch (err) {
        console.error('DrawerSystem.open 错误:', err);
        showToast('抽屉打开失败，请刷新页面重试');
      }
    },
    close() {
      if (DOM.drawer_container) DOM.drawer_container.classList.remove('open');
      if (DOM.drawer_overlay) {
        DOM.drawer_overlay.classList.add('opacity-0');
        setTimeout(() => DOM.drawer_overlay.classList.add('hidden'), 300);
      }
      this.current = null;
      this.updateNavState(null);
    },
    setupGlobalListeners() {
      document.addEventListener('change', (e) => {
        const cb = e.target.closest('.filter-checkbox');
        if (cb && cb.type === 'checkbox') {
          const drawer = cb.dataset.drawer;
          const value = cb.value;
          if (drawer && state.selectedFilters.hasOwnProperty(drawer)) {
            toggleFilter(drawer, value, cb.checked);
          }
        }
      });
      document.addEventListener('input', (e) => {
        const killInput = e.target.closest('#kill-input');
        if (killInput && killInput.id === 'kill-input') {
          const nums = killInput.value.split(/\s+/).filter(t => /^\d+$/.test(t)).map(Number).filter(n => n>=1 && n<=49);
          setKillNums(nums);
        }
      });
      document.addEventListener('click', (e) => {
        const prev = e.target.closest('#history-prev');
        if (prev) { window.prevHistoryPage && window.prevHistoryPage(); e.stopPropagation(); }
        const next = e.target.closest('#history-next');
        if (next) { window.nextHistoryPage && window.nextHistoryPage(); e.stopPropagation(); }
      });
      document.addEventListener('change', async (e) => {
        const yearSel = e.target.closest('#historyYear');
        if (yearSel && yearSel.value) {
          historyYearLoaded = yearSel.value;
          await loadHistoryYear(yearSel.value);
        }
      });
    },
    updateNavState(activeType) {
      document.querySelectorAll('.nav-item').forEach(el => {
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

  // ---------- 历史记录模块 ----------
  let currentHistoryData = [], currentHistorySorted = [], currentHistoryPage = 1, historyCache = {}, historyYearLoaded = null;
  function ensureHistorySorted() {
    if (currentHistorySorted.length) return;
    const seen = new Set();
    const unique = [];
    for (const item of currentHistoryData) {
      if (item && item.expect && !seen.has(item.expect)) {
        seen.add(item.expect);
        unique.push(item);
      }
    }
    currentHistorySorted = unique.sort((a,b) => String(b.expect).localeCompare(String(a.expect), undefined, { numeric: true }));
  }
  function renderHistoryPage() {
    const cont = document.getElementById('historyContent');
    const pagi = document.getElementById('historyPagination');
    ensureHistorySorted();
    if (!currentHistorySorted.length) {
      if (cont) cont.innerHTML = '<div class="text-gray-500 py-8 text-center">暂无数据</div>';
      if (pagi) pagi?.classList.add('hidden');
      return;
    }
    const totalPages = Math.max(1, Math.ceil(currentHistorySorted.length / HISTORY_PAGE_SIZE));
    if (currentHistoryPage > totalPages) currentHistoryPage = totalPages;
    const start = (currentHistoryPage - 1) * HISTORY_PAGE_SIZE;
    const pageData = currentHistorySorted.slice(start, start + HISTORY_PAGE_SIZE);
    const frag = document.createDocumentFragment();
    for (const item of pageData) {
      const expect = escapeHtml(item.expect || '');
      let ballsHtml = '';
      if (item.openCode && item.openCode.trim()) {
        const codes = item.openCode.split(',').map(c => escapeHtml(c.trim()));
        const waves = (item.wave || '').split(',').map(w => escapeHtml(w.trim()));
        const zodiacs = (item.zodiac || '').split(',').map(z => escapeHtml(z.trim()));
        ballsHtml = renderBallsHTML(codes, waves, zodiacs);
      } else {
        ballsHtml = '<div class="flex justify-center items-center py-6 text-amber-400 text-sm font-medium">待开奖</div>';
      }
      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `<div class="history-item-header">第${expect.slice(4)}期 · ${escapeHtml(item.openTime && item.openTime.slice(5,16) || '')}</div><div class="history-balls-row">${ballsHtml}</div>`;
      frag.appendChild(div);
    }
    if (cont) { cont.innerHTML = ''; cont.appendChild(frag); }
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
  }
  function renderBallsHTML(codes, waves, zodiacs) {
    let html = '';
    for (let i = 0; i < codes.length; i++) {
      const wave = waves[i];
      const zod = zodiacs[i];
      const cc = wave === 'blue' || wave === '蓝' ? 'history-ball-blue' : (wave === 'green' || wave === '绿' ? 'history-ball-green' : 'history-ball-red');
      const num = parseInt(codes[i],10);
      const five = (num>=1 && num<=49) ? (numProps[num] && numProps[num].five || '') : '';
      html += `<div class="history-ball-card ${cc}"><div class="history-ball-number">${codes[i]}</div><div class="history-ball-tag">${zod}/${five}</div></div>`;
      if (i === 5) html += '<span class="history-plus-sign">+</span>';
    }
    return html;
  }
  window.prevHistoryPage = function() { if (currentHistoryPage > 1) { currentHistoryPage--; renderHistoryPage(); } };
  window.nextHistoryPage = function() { ensureHistorySorted(); const total = Math.ceil(currentHistorySorted.length / HISTORY_PAGE_SIZE); if (currentHistoryPage < total) { currentHistoryPage++; renderHistoryPage(); } };
  async function loadHistoryYear(year) {
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
    } catch (err) {
      console.error(err);
      if (cont) cont.innerHTML = '<div class="text-red-400">加载失败</div>';
    } finally {
      if (loadDiv) loadDiv.classList.add('hidden');
    }
  }

  // ---------- 直播播放器 ----------
  let currentHls = null, currentFlvPlayer = null, liveSourceIndex = 0;
  const LIVE_SOURCES = [
    { name: 'API获取', type: 'auto', url: '' },
    { name: 'HLS源1', type: 'hls', url: 'https://media.macaumarksix.com/live/marksix.m3u8' },
    { name: 'FLV源1', type: 'flv', url: 'https://media.macaumarksix.com/live/marksix.flv' }
  ];
  function initLivePlayer() {
    const video = document.getElementById('live-video');
    if (!video) { console.warn('live-video 元素未找到'); return; }
    const srcBtns = document.querySelectorAll('.live-src-btn');
    if (srcBtns.length) {
      srcBtns.forEach((btn, idx) => {
        btn.removeEventListener('click', () => {});
        btn.addEventListener('click', () => {
          srcBtns.forEach(b => { b.classList.remove('bg-[#00ffea]','text-black'); b.classList.add('bg-[#1a1a2a]','text-gray-400'); });
          btn.classList.remove('bg-[#1a1a2a]','text-gray-400');
          btn.classList.add('bg-[#00ffea]','text-black');
          liveSourceIndex = idx;
          connectLiveSource(idx);
        });
      });
    }
    connectLiveSource(0);
    function connectLiveSource(idx) {
      destroyLivePlayer();
      const loading = document.getElementById('live-loading');
      const errorDiv = document.getElementById('live-error');
      const statusSpan = document.getElementById('live-status');
      if (loading) loading.classList.remove('hidden');
      if (errorDiv) errorDiv.classList.add('hidden');
      if (statusSpan) statusSpan.textContent = `正在连接 ${LIVE_SOURCES[idx].name}...`;
      const src = LIVE_SOURCES[idx];
      if (src.type === 'auto') {
        fetch(API_CONFIG.live + '?_t=' + Date.now())
          .then(r => r.json())
          .then(data => {
            if (data && data[0] && data[0].videoUrl) {
              playStream(data[0].videoUrl, detectStreamType(data[0].videoUrl));
            } else {
              if (idx + 1 < LIVE_SOURCES.length) setTimeout(() => connectLiveSource(idx+1), 1000);
              else showLiveError();
            }
          })
          .catch(() => { if (idx+1 < LIVE_SOURCES.length) setTimeout(() => connectLiveSource(idx+1), 1000); else showLiveError(); });
      } else if (src.url) {
        playStream(src.url, src.type);
      } else {
        showLiveError();
      }
    }
    function detectStreamType(url) { return url.includes('.m3u8') ? 'hls' : (url.includes('.flv') ? 'flv' : 'hls'); }
    function playStream(url, type) {
      const video = document.getElementById('live-video');
      const loading = document.getElementById('live-loading');
      if (type === 'hls' && window.Hls && Hls.isSupported()) {
        currentHls = new Hls({ enableWorker: true, lowLatencyMode: true });
        currentHls.loadSource(url);
        currentHls.attachMedia(video);
        currentHls.on(Hls.Events.MANIFEST_PARSED, () => { if (loading) loading.classList.add('hidden'); video.play().catch(()=>{}); });
        currentHls.on(Hls.Events.ERROR, () => tryNextSource());
      } else if (type === 'flv' && window.flvjs && flvjs.isSupported()) {
        currentFlvPlayer = flvjs.createPlayer({ type: 'flv', url, isLive: true });
        currentFlvPlayer.attachMediaElement(video);
        currentFlvPlayer.load();
        currentFlvPlayer.play();
        currentFlvPlayer.on(flvjs.Events.LOADING_COMPLETE, () => { if (loading) loading.classList.add('hidden'); });
        currentFlvPlayer.on(flvjs.Events.ERROR, () => tryNextSource());
        setTimeout(() => { if (loading) loading.classList.add('hidden'); }, 3000);
      } else {
        video.src = url;
        video.addEventListener('loadedmetadata', () => { if (loading) loading.classList.add('hidden'); });
        video.addEventListener('error', () => tryNextSource());
        video.play().catch(()=>{});
      }
    }
    function tryNextSource() {
      destroyLivePlayer();
      if (liveSourceIndex + 1 < LIVE_SOURCES.length) {
        liveSourceIndex++;
        const btns = document.querySelectorAll('.live-src-btn');
        btns.forEach((b,i) => {
          if (i === liveSourceIndex) { b.classList.remove('bg-[#1a1a2a]','text-gray-400'); b.classList.add('bg-[#00ffea]','text-black'); }
          else { b.classList.remove('bg-[#00ffea]','text-black'); b.classList.add('bg-[#1a1a2a]','text-gray-400'); }
        });
        connectLiveSource(liveSourceIndex);
      } else {
        showLiveError();
      }
    }
    function showLiveError() {
      const loading = document.getElementById('live-loading');
      const errorDiv = document.getElementById('live-error');
      if (loading) loading.classList.add('hidden');
      if (errorDiv) errorDiv.classList.remove('hidden');
    }
    function destroyLivePlayer() {
      if (currentHls) { currentHls.destroy(); currentHls = null; }
      if (currentFlvPlayer) { currentFlvPlayer.destroy(); currentFlvPlayer = null; }
      const video = document.getElementById('live-video');
      if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    }
  }

  // ---------- 粒子效果 ----------
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
      // 根据实际分布位置重新计算飞到顶部的寿命
      p.life = Math.min((p.y + 80) / p.speed, 3000);
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

  // ---------- 初始化入口 ----------
  function init() {
    cacheDOM();
    loadState();
    initWorker();
    subscribe(onStateChange);
    initResultDelegation();
    initParticles();
    DrawerSystem.setupGlobalListeners();

    if (DOM.exampleBtn) DOM.exampleBtn.addEventListener('click', () => { if (DOM.numbers) DOM.numbers.value = '龙蛇马 12 25 36 8 17 29 41 5 19 33 47'; runAnalysis(); });
    if (DOM.clearBtn) DOM.clearBtn.addEventListener('click', () => { if (DOM.numbers) DOM.numbers.value = ''; runAnalysis(); showToast('已清空输入'); });
    if (DOM.copyResultBtn) DOM.copyResultBtn.addEventListener('click', copyResult);
    if (DOM.numbers) DOM.numbers.addEventListener('input', runAnalysis);
    if (DOM.refreshLotteryBtn) DOM.refreshLotteryBtn.addEventListener('click', fetchLottery);

    const navItems = document.querySelectorAll('.nav-item');
    if (navItems.length) {
      navItems.forEach(btn => {
        btn.removeEventListener('click', navClickHandler);
        btn.addEventListener('click', navClickHandler);
      });
    }
    function navClickHandler(e) {
      e.stopPropagation();
      const drawer = this.dataset.drawer;
      if (drawer === 'selectnone') {
        clearAllFilters();
        const killInput = document.getElementById('kill-input');
        if (killInput) killInput.value = '';
        DrawerSystem.close();
        showToast('已重置所有筛选');
      } else {
        DrawerSystem.open(drawer);
      }
    }

    if (DOM.drawer_close) DOM.drawer_close.addEventListener('click', () => DrawerSystem.close());
    if (DOM.drawer_overlay) DOM.drawer_overlay.addEventListener('click', () => DrawerSystem.close());

    fetchLottery();
    runAnalysis();
    initAutoRefresh();
    window.addEventListener('beforeunload', terminateWorker);
    console.log('✅ 神码再现 v3.7.1 已加载（完整版，抽屉已修复）');
  }

  document.addEventListener('DOMContentLoaded', init);
})();