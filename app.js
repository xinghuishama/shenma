// ======================== app.js — 主线程核心逻辑 v3.8.0 (完整健壮版) ========================
(function() {
    "use strict";

    // ---------- 配置常量 ----------
    const MAX_NUMBERS = (window.APP_DATA && window.APP_DATA.MAX_NUMBERS) || 5000;
    const SHENGXIAO = (window.APP_DATA && window.APP_DATA.SHENGXIAO) || {};
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
            'drawer-overlay','drawer-container','drawer-title','drawer-content','drawer-close','toast', 'offlineStatus'];
        for (const id of ids) {
            DOM[id.replace(/-/g, '_')] = document.getElementById(id);
        }
    }

    // ---------- 状态管理 ----------
    let state = {
        killNums: [],
        selectedFilters: { shengxiao: [], haomatou: [], weishu: [], shuduan: [], bose: [], wuxing: [], bandanshuang: [], heshu: [] }
    };
    let subscribers = [];
    let lastAnalysisResult = null;
    let isComposing = false; // 中文输入法标记

    function subscribe(fn) { subscribers.push(fn); }
    function notify() { subscribers.forEach(fn => fn()); }

    function saveState() {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(state));
        } catch (e) { console.warn('状态保存失败', e); }
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
        } catch (e) { console.warn('状态加载失败', e); }
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

    // ---------- Worker 通信（优化版：初始化同步 + 零拷贝接收） ----------
    let analysisWorker = null;
    let debounceTimer = null;
    let inputDebounceTimer = null;

    function initWorker() {
        if (analysisWorker) return;
        try {
            analysisWorker = new Worker('worker.js');
            
            // 核心修复：向 Worker 发送完整数据初始化，确保数据一致性
            if (window.APP_DATA) {
                analysisWorker.postMessage({
                    type: 'init',
                    payload: {
                        numProps: window.APP_DATA.numProps,
                        shengxiao: window.APP_DATA.SHENGXIAO
                    }
                });
            }

            analysisWorker.onmessage = onWorkerMessage;
            analysisWorker.onerror = (e) => {
                console.error('Worker error', e);
                showToast('分析引擎启动失败');
            };
        } catch (e) {
            console.error(e);
            showToast('Worker 初始化失败');
        }
    }

    function onWorkerMessage(e) {
        try {
            const { type, payload } = e.data;
            if (type === 'error') {
                showToast('计算失败：' + payload);
                return;
            }
            if (type === 'result' && payload) {
                // 零拷贝解析 ArrayBuffer
                const { buffer, adjustedTotal, unique } = payload;
                
                // buffer 包含两部分：Uint16Array(50) + Uint8Array(50)
                // 内存布局：前100字节是Uint16，后50字节是Uint8
                const adjustedCount = new Uint16Array(buffer, 0, 50);
                const hitCounts = new Uint8Array(buffer, 100, 50);

                // 转为数组供渲染使用
                renderResult(Array.from(adjustedCount), adjustedTotal, unique, Array.from(hitCounts));
            }
        } catch (err) {
            console.error('处理 Worker 结果失败', err);
        }
    }

    function runAnalysis() {
        initWorker();
        if (isComposing) return; // 输入法组合中

        clearTimeout(inputDebounceTimer);
        inputDebounceTimer = setTimeout(() => {
            const input = DOM.numbers ? DOM.numbers.value : '';
            const preview = parseInputPreview(input);
            
            if (DOM.charCount) DOM.charCount.textContent = preview.rawCount;
            if (DOM.numberWarn) {
                if (preview.truncated) {
                    DOM.numberWarn.classList.remove('hidden');
                    showToast(`输入超过${MAX_NUMBERS}个，已截断`);
                } else {
                    DOM.numberWarn.classList.add('hidden');
                }
            }

            if (analysisWorker) {
                analysisWorker.postMessage({
                    type: 'analyze',
                    payload: {
                        input: input,
                        killNums: state.killNums,
                        filters: getFilterSet()
                    }
                });
            }
        }, 150); // 降低防抖延迟提升流畅度
    }

    function onStateChange() {
        runAnalysis();
    }

    // ---------- 渲染结果 (完整逻辑) ----------
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
        const killSet = new Set(state.killNums);
        const htmlParts = [];

        // 寻找独苗（只有一个未命中的号码）
        const unhitNumbers = [];
        for (let n = 1; n <= 49; n++) {
            if (adjustedCount[n] > 0 && hitCounts[n] === 0) unhitNumbers.push(n);
        }
        const isUniqueUnhit = unhitNumbers.length === 1;
        const uniqueUnhitNum = isUniqueUnhit ? unhitNumbers[0] : null;

        for (const f of freqs) {
            if (!killDrawn && unique > 0 && f <= (adjustedTotal / unique)) {
                htmlParts.push('<div class="kill-line"></div>');
                killDrawn = true;
            }
            htmlParts.push(`<div class="flex items-start gap-1 mb-1 flex-wrap"><span class="text-xs text-green-500 font-mono min-w-[36px] pt-2">${f}次：</span><div class="flex flex-wrap gap-1 flex-1">`);
            
            const nums = freqMap.get(f).sort((a,b) => a - b);
            for (const n of nums) {
                const hit = hitCounts[n] || 0;
                const isGray = hit > 0;
                const p = numProps[n];
                
                // 颜色逻辑
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

        // 0次号码
        if (unique < 49 && adjustedTotal > 0) {
            const zeroNums = [];
            for (let n = 1; n <= 49; n++) {
                if (adjustedCount[n] === 0) zeroNums.push(n);
            }
            if (zeroNums.length) {
                htmlParts.push('<div class="flex items-start gap-1 mb-1 flex-wrap"><span class="text-xs text-red-400 font-mono min-w-[36px] pt-2">0次：</span><div class="flex flex-wrap gap-1 flex-1">');
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
            htmlParts.push('<div class="text-center py-8 text-amber-400">⚡ 所有号码频次归零，请输入号码 ⚡</div>');
        }

        // 底部统计
        htmlParts.push(`<div class="mt-4 grid grid-cols-3 gap-2 p-3 bg-transparent rounded-lg border border-[#00ffea]/20">
            <div class="text-center"><div class="text-[#00ffea] font-bold text-lg">${unique}</div><div class="text-xs text-gray-500">有效数字个数</div></div>
            <div class="text-center"><div class="text-[#00ffea] font-bold text-lg">${adjustedTotal}</div><div class="text-xs text-gray-500">调整后总次数</div></div>
            <div class="text-center"><div class="text-[#00ffea] font-bold text-lg">${avg}</div><div class="text-xs text-gray-500">调整后平均次数</div></div>
        </div>`);

        container.innerHTML = htmlParts.join('');

        // 独苗飞行动画
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
        
        lastAnalysisResult = { freqMap, adjustedTotal, unique, avg };
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
        ball.style.left = startX + 'px'; ball.style.top = startY + 'px';
        ball.style.color = glowColor;
        document.body.appendChild(ball);
        
        let startTime = null;
        const duration = 1400;
        function animate(timestamp) {
            if (!startTime) startTime = timestamp;
            const progress = Math.min((timestamp - startTime) / duration, 1);
            const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
            const currentX = startX + (endX - startX) * ease;
            const currentY = startY + (endY - startY) * ease;
            ball.style.transform = `translate3d(${currentX - startX}px, ${currentY - startY}px, 0) scale(${0.6 + Math.sin(progress * Math.PI) * 0.6}) rotate(${progress * 1080}deg)`;
            if (progress < 1) requestAnimationFrame(animate);
            else {
                ball.remove();
                targetEl.classList.remove('flash-unique');
                void targetEl.offsetWidth;
                targetEl.classList.add('landing-shock', 'flash-unique');
                setTimeout(() => targetEl.classList.remove('landing-shock'), 400);
                showToast(`🎯 独苗守护：${String(targetNum).padStart(2,'0')} 号`);
            }
        }
        requestAnimationFrame(animate);
    }

    function copyResult() {
        if (!lastAnalysisResult) { showToast('暂无分析结果'); return; }
        let text = '';
        const freqMap = lastAnalysisResult.freqMap;
        for (const [f, nums] of freqMap.entries()) {
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

    // ---------- 开奖模块 (含智能刷新) ----------
    let isCurrentDrawComplete = false;
    let lastLotteryPeriod = '';
    let isFetchingLottery = false;
    let countdownTimer = null;
    let autoRefreshTimer = null;
    let regularPollTimer = null;
    let lastDrawFetchTime = 0;
    let lastRegularFetchTime = 0;
    let inDrawWindowFlag = false;
    
    const DRAW_CONFIG = {
        startH: 21, startM: 33, endH: 21, endM: 35, 
        pollMs: 5000, regularMs: 60000, fetchTimeout: 8000
    };

    function checkDrawComplete(item) {
        if (!item || !item.openCode) return false;
        const codes = String(item.openCode).split(',').filter(c => c.trim());
        return codes.length >= 7;
    }

    function getNextDrawTime() {
        const now = new Date();
        const draw = new Date(now.getFullYear(), now.getMonth(), now.getDate(), DRAW_CONFIG.startH, DRAW_CONFIG.startM, 0);
        if (now >= draw) draw.setDate(draw.getDate() + 1);
        return draw;
    }

    function updateCountdown() {
        if (!DOM.lotteryTime) return;
        const nextDraw = getNextDrawTime();
        const diff = nextDraw - Date.now();
        if (diff <= 0) {
            DOM.lotteryTime.textContent = '开奖中...';
            return;
        }
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        DOM.lotteryTime.textContent = '距开奖 ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }

    async function safeFetch(url, options = {}) {
        const timeout = options.timeout || DRAW_CONFIG.fetchTimeout;
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), timeout);
        
        // 健壮性优化：网络错误重试，客户端错误(404等)直接抛出
        for (let i = 0; i < 2; i++) {
            try {
                const res = await fetch(url, { ...options, signal: ctrl.signal });
                clearTimeout(tid);
                if (res.status >= 400 && res.status < 500) throw new Error(`Client Error ${res.status}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res;
            } catch (e) {
                clearTimeout(tid);
                if (e.name === 'AbortError' || e.message.includes('Client Error')) throw e;
                if (i === 1) throw e; // 重试一次
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }

    async function fetchLottery() {
        if (isFetchingLottery) return;
        isFetchingLottery = true;
        const btn = DOM.refreshLotteryBtn;
        const origHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.innerHTML = '<svg class="animate-spin w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>加载中...';
            btn.disabled = true;
        }
        try {
            const res = await safeFetch(API_CONFIG.live + '?_t=' + Date.now());
            const data = await res.json();
            if (!Array.isArray(data) || !data[0]) throw new Error('no data');
            const item = data[0];
            
            localStorage.setItem(LS_CACHE_KEY, JSON.stringify({ data, time: Date.now() }));
            const isNewPeriod = lastLotteryPeriod !== item.expect;
            if (isNewPeriod) {
                lastLotteryPeriod = item.expect;
                isCurrentDrawComplete = false;
            }
            renderLottery(item);
            
            if (checkDrawComplete(item)) {
                if (!isCurrentDrawComplete) {
                    isCurrentDrawComplete = true;
                    showToast('当期开奖已完成');
                } else if (isNewPeriod) {
                    showToast('新期号已更新');
                }
            } else {
                showToast('刷新成功 - 等待开奖');
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
            isFetchingLottery = false;
            if (btn) {
                btn.innerHTML = origHtml;
                btn.disabled = false;
            }
        }
    }

    function renderLottery(item) {
        const codes = String(item.openCode || '').split(',').map(c => escapeHtml(c.trim()));
        const waves = String(item.wave || '').split(',').map(w => escapeHtml(w.trim()));
        const zodiacs = String(item.zodiac || '').split(',').map(z => escapeHtml(z.trim()));
        const container = DOM.lotteryBalls;
        if (!container) return;
        
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
        // 特码
        if (codes.length >= 7) {
            const plus = document.createElement('div');
            plus.className = 'result-plus-sign'; plus.textContent = '+';
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
    }

    function isInDrawWindow() {
        const now = new Date();
        const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
        const startSec = DRAW_CONFIG.startH * 3600 + DRAW_CONFIG.startM * 60;
        const endSec = DRAW_CONFIG.endH * 3600 + DRAW_CONFIG.endM * 60;
        const nowSec = h * 3600 + m * 60 + s;
        return nowSec >= startSec && nowSec <= endSec;
    }

    function checkDrawWindow() {
        const wasInWindow = inDrawWindowFlag;
        inDrawWindowFlag = isInDrawWindow();
        if (inDrawWindowFlag && !wasInWindow) {
            fetchLottery();
            lastDrawFetchTime = Date.now();
            return;
        }
        if (inDrawWindowFlag) {
            const elapsed = Date.now() - lastDrawFetchTime;
            if (elapsed >= DRAW_CONFIG.pollMs) {
                lastDrawFetchTime = Date.now();
                fetchLottery();
            }
        }
    }

    function regularPoll() {
        if (inDrawWindowFlag) return;
        const elapsed = Date.now() - lastRegularFetchTime;
        if (elapsed >= DRAW_CONFIG.regularMs) {
            lastRegularFetchTime = Date.now();
            fetchLottery();
        }
    }

    function initAutoRefresh() {
        updateCountdown();
        countdownTimer = setInterval(updateCountdown, 1000);
        checkDrawWindow();
        autoRefreshTimer = setInterval(checkDrawWindow, 4000);
        regularPollTimer = setInterval(regularPoll, 10000);
        
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'visible') {
                setTimeout(fetchLottery, 300);
            }
        });
    }

    // ---------- 抽屉系统 (UI) ----------
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
            history: () => {
                let opts = '';
                for (let y = new Date().getFullYear(); y >= 2020; y--) opts += `<option value="${y}">${y}年</option>`;
                return `<div><select id="historyYear" class="w-full bg-[#1a1a2a] border border-[#00ffea]/30 rounded-lg p-3 text-[#00ffea]"><option value="">选择年份</option>${opts}</select><div id="historyLoading" class="hidden text-center py-4"><svg class="animate-spin w-6 h-6 mx-auto text-[#00ffea]" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg></div><div id="historyContent" class="mt-3 hide-scrollbar"></div><div id="historyPagination" class="flex justify-between items-center mt-6 px-1 hidden"><button id="history-prev" class="px-6 py-3 bg-[#1a1a2a] hover:bg-[#00ffea]/10 text-[#00ffea] rounded-2xl flex items-center gap-2 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">← 上1页</button><div class="text-center text-sm">第 <span id="historyPageNum" class="font-bold text-[#00ffea]">1</span> 页 / <span id="historyTotalPages" class="text-gray-400">1</span> 页</div><button id="history-next" class="px-6 py-3 bg-[#1a1a2a] hover:bg-[#00ffea]/10 text-[#00ffea] rounded-2xl flex items-center gap-2 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">下1页 →</button></div></div>`;
            }
        },
        open(type) {
            if (this.current === type) { this.close(); return; }
            this.current = type;
            const titles = { shama:'杀码', shengxiao:'生肖', haomatou:'头数', weishu:'尾数', shuduan:'数段', bose:'波色', wuxing:'五行', bandanshuang:'半单双', heshu:'合数', history:'历史开奖' };
            if (DOM.drawer_title) DOM.drawer_title.textContent = titles[type] || '筛选器';
            try {
                if (DOM.drawer_content) {
                    const templateFn = this.templates[type];
                    DOM.drawer_content.innerHTML = templateFn ? templateFn() : '<p class="text-red-400">暂未实现</p>';
                }
                if (DOM.drawer_overlay) { DOM.drawer_overlay.classList.remove('hidden'); setTimeout(() => DOM.drawer_overlay.classList.remove('opacity-0'), 10); }
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
            } catch (err) { console.error(err); showToast('抽屉打开失败'); }
        },
        close() {
            if (DOM.drawer_container) DOM.drawer_container.classList.remove('open');
            if (DOM.drawer_overlay) { DOM.drawer_overlay.classList.add('opacity-0'); setTimeout(() => DOM.drawer_overlay.classList.add('hidden'), 300); }
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
                    state.killNums = [...new Set(nums)];
                    notify();
                    saveState();
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
            if (item && item.expect && !seen.has(item.expect)) { seen.add(item.expect); unique.push(item); }
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
                } else { currentHistoryData = []; }
            }
            currentHistorySorted = [];
            currentHistoryPage = 1;
            renderHistoryPage();
        } catch (err) {
            console.error(err);
            if (cont) cont.innerHTML = '<div class="text-red-400">加载失败</div>';
        } finally { if (loadDiv) loadDiv.classList.add('hidden'); }
    }

    // ---------- 粒子系统 (性能优化：帧率控制) ----------
    function ParticleSystem() {
        const canvas = document.getElementById('particle-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        let particles = [];
        let lastTime = 0;
        let isRunning = true;
        
        const resizeCanvas = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        // 页面可见性优化
        document.addEventListener('visibilitychange', () => {
            isRunning = !document.hidden;
            if (isRunning) animate(0);
        });

        this.createBackgroundParticles = function() {
            for (let i = 0; i < 30; i++) {
                particles.push({
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height,
                    size: Math.random() * 2 + 0.5,
                    speedX: (Math.random() - 0.5) * 0.5,
                    speedY: (Math.random() - 0.5) * 0.5,
                    color: `rgba(${(Math.random() * 100 + 155) | 0},${(Math.random() * 100 + 155) | 0},255,${(Math.random() * 0.3 + 0.1).toFixed(2)})`,
                    type: 'background'
                });
            }
        };

        this.animate = function(timestamp) {
            if (!isRunning) return;
            // 帧率限制：60fps
            if (timestamp - lastTime < 16) {
                requestAnimationFrame(this.animate.bind(this));
                return;
            }
            lastTime = timestamp;

            ctx.fillStyle = 'rgba(5, 5, 16, 0.1)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                p.x += p.speedX;
                p.y += p.speedY;
                if (p.type === 'background') {
                    if (p.x < 0) p.x = canvas.width;
                    if (p.x > canvas.width) p.x = 0;
                    if (p.y < 0) p.y = canvas.height;
                    if (p.y > canvas.height) p.y = 0;
                    ctx.globalAlpha = 0.5;
                } else if (p.life !== undefined) {
                    p.life -= p.decay;
                    if (p.life <= 0) { particles.splice(i, 1); continue; }
                    ctx.globalAlpha = p.life;
                }

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.fill();
            }
            ctx.globalAlpha = 1.0;
            requestAnimationFrame(this.animate.bind(this));
        };
        
        this.createBackgroundParticles();
        this.animate(0);
    }

    // ---------- 在线状态显示 ----------
    function updateOnlineStatus() {
        const el = DOM.offlineStatus;
        if (!el) return;
        if (navigator.onLine) {
            el.textContent = "● 在线";
            el.className = "text-xs font-mono mb-1 text-green-400 opacity-80";
        } else {
            el.textContent = "● 离线模式";
            el.className = "text-xs font-mono mb-1 text-amber-400 opacity-80";
        }
    }

    // ---------- 初始化入口 ----------
    function init() {
        cacheDOM();
        loadState();
        initWorker();
        subscribe(onStateChange);
        initResultDelegation();
        new ParticleSystem();
        DrawerSystem.setupGlobalListeners();

        if (DOM.exampleBtn) DOM.exampleBtn.addEventListener('click', () => {
            if (DOM.numbers) DOM.numbers.value = '龙蛇马 12 25 36 8 17 29 41 5 19 33 47';
            runAnalysis();
        });
        if (DOM.clearBtn) DOM.clearBtn.addEventListener('click', () => {
            if (DOM.numbers) DOM.numbers.value = '';
            runAnalysis();
            showToast('已清空输入');
        });
        if (DOM.copyResultBtn) DOM.copyResultBtn.addEventListener('click', copyResult);

        if (DOM.numbers) {
            DOM.numbers.addEventListener('input', runAnalysis);
            DOM.numbers.addEventListener('compositionstart', () => { isComposing = true; });
            DOM.numbers.addEventListener('compositionend', () => { isComposing = false; runAnalysis(); });
        }
        if (DOM.refreshLotteryBtn) DOM.refreshLotteryBtn.addEventListener('click', fetchLottery);
        
        const navItems = document.querySelectorAll('.nav-item');
        if (navItems.length) {
            navItems.forEach(btn => {
                btn.addEventListener('click', function(e) {
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
                });
            });
        }

        if (DOM.drawer_close) DOM.drawer_close.addEventListener('click', () => DrawerSystem.close());
        if (DOM.drawer_overlay) DOM.drawer_overlay.addEventListener('click', () => DrawerSystem.close());

        fetchLottery();
        runAnalysis();
        initAutoRefresh();
        updateOnlineStatus();
        window.addEventListener('online', updateOnlineStatus);
        window.addEventListener('offline', updateOnlineStatus);

        window.addEventListener('beforeunload', () => {
            if (analysisWorker) analysisWorker.terminate();
            if (countdownTimer) clearInterval(countdownTimer);
            if (autoRefreshTimer) clearInterval(autoRefreshTimer);
            if (regularPollTimer) clearInterval(regularPollTimer);
        });
        console.log('✅ 神码再现 v3.8.0 (完整健壮版) 已加载');
    }

    document.addEventListener('DOMContentLoaded', init);
})();
