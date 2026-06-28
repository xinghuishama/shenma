// ======================== worker.js — 计算引擎 v3.8.1 (修复版) ========================
(function () {
    "use strict";
    
    // 1. 內置默认数据 (作为兜底，防止主线程未初始化)
    // 这部分代码与 data.js 逻辑一致，确保 Worker 即使离线也能工作
    const DEFAULT_SHENGXIAO = {
        鼠: [7, 19, 31, 43], 牛: [6, 18, 30, 42], 虎: [5, 17, 29, 41], 兔: [4, 16, 28, 40],
        龙: [3, 15, 27, 39], 蛇: [2, 14, 26, 38], 马: [1, 13, 25, 37, 49], 羊: [12, 24, 36, 48],
        猴: [11, 23, 35, 47], 鸡: [10, 22, 34, 46], 狗: [9, 21, 33, 45], 猪: [8, 20, 32, 44]
    };
    const DEFAULT_CATEGORIES = {
        红波: [1, 2, 7, 8, 12, 13, 18, 19, 23, 24, 29, 30, 34, 35, 40, 45, 46],
        蓝波: [3, 4, 9, 10, 14, 15, 20, 25, 26, 31, 36, 37, 41, 42, 47, 48],
        绿波: [5, 6, 11, 16, 17, 21, 22, 27, 28, 32, 33, 38, 39, 43, 44, 49]
    };
    const DEFAULT_DUAN = {
        "1段": [1, 2, 3, 4, 5, 6, 7], "2段": [8, 9, 10, 11, 12, 13, 14], "3段": [15, 16, 17, 18, 19, 20, 21],
        "4段": [22, 23, 24, 25, 26, 27, 28], "5段": [29, 30, 31, 32, 33, 34, 35], "6段": [36, 37, 38, 39, 40, 41, 42],
        "7段": [43, 44, 45, 46, 47, 48, 49]
    };
    // 五行基础序列
    const WUXING_BASE_SEQ = ['金', '金', '土', '土', '木', '木', '火', '火', '金', '金', '水', '水', '木', '木', '火', '火', '土', '土', '水', '水', '木', '木', '金', '金', '土', '土', '水', '水', '火', '火'];

    // 2. 运行时状态
    let numProps = null;     // 存储号码属性对象
    let SHENGXIAO = null;    // 存储生肖映射表

    // 初始化构建属性表 (使用当前年份或默认数据)
    function buildNumProps(year) {
        const currentYear = year || new Date().getFullYear();
        const wuxingOffset = currentYear - 2023;
        
        // 使用默认数据或空对象兜底
        const sx = SHENGXIAO || DEFAULT_SHENGXIAO;
        const cat = DEFAULT_CATEGORIES;
        const duan = DEFAULT_DUAN;
        
        const props = new Array(50);
        
        for (let n = 1; n <= 49; n++) {
            // 基础属性
            const head = Math.floor(n / 10);
            const tail = n % 10;
            const odd = n % 2 === 1 ? "单" : "双";
            
            // 颜色
            let color = "green";
            if (cat.红波.includes(n)) color = "red";
            else if (cat.蓝波.includes(n)) color = "blue";

            // 五行 (动态计算)
            const fiveIndex = ((n - 1) % 30 - wuxingOffset + 30) % 30;
            const five = WUXING_BASE_SEQ[fiveIndex];

            // 数段
            let duanName = "";
            for (const k in duan) { if (duan[k].includes(n)) { duanName = k; break; } }

            // 半单双
            const halfOddEven = n > 24 ? (n % 2 === 1 ? "大单" : "大双") : (n % 2 === 1 ? "小单" : "小双");

            // 生肖 (查找键值)
            let sxName = "";
            for (const k in sx) { if (sx[k].includes(n)) { sxName = k; break; } }

            props[n] = { head, tail, color, odd, five, duan: duanName, halfOddEven, shengXiao: sxName, sum: head + tail };
        }
        return props;
    }

    // 3. 初始化：优先使用内置数据，确保 Worker 一启动就能工作
    numProps = buildNumProps();
    SHENGXIAO = DEFAULT_SHENGXIAO;

    // 4. 消息监听
   // ======================== worker.js 内部修改片段 ========================

self.onmessage = function(e) {
    const { type, payload } = e.data;

    // 初始化逻辑保持不变
    if (type === 'init') {
        if (payload.numProps) numProps = payload.numProps;
        if (payload.shengxiao) SHENGXIAO = payload.shengxiao;
        return;
    }

    if (type === 'analyze') {
        try {
            const result = processAnalysis(payload);
            
            // 【关键修改】直接发送包含 buffer 的对象，不再包装 type/payload
            // 这样发送出的数据结构是: { buffer, adjustedTotal, unique }
            // 正好匹配您 app.js 中的 if(data.buffer) 判断
            self.postMessage(result, [result.buffer]);
            
        } catch (err) {
            // 【关键修改】错误也直接发送 error 字段
            // 匹配您 app.js 中的 if(data.error) 判断
            self.postMessage({ error: err.message });
        }
    }
};

// processAnalysis 函数保持不变，返回 { buffer, adjustedTotal, unique }

    // 5. 核心分析逻辑
    function processAnalysis(payload) {
        const { input, killNums, filters } = payload;
        
        // 解析输入
        const nums = parseInput(input);
        const rawCount = new Uint16Array(50);
        for (let i = 0; i < nums.length; i++) {
            const n = nums[i];
            if (n >= 1 && n <= 49) rawCount[n]++;
        }

        // 构建过滤器函数
        // 修复：此处必须使用正确的函数名 buildMatchFunc
        const filterFuncs = buildMatchFuncs(filters);
        const killSet = new Set(killNums);

        // 计算命中与调整值
        const adjustedCount = new Uint16Array(50);
        const hitCounts = new Uint8Array(50);
        let adjustedTotal = 0;
        let unique = 0;

        for (let n = 1; n <= 49; n++) {
            // 计算命中次数
            let hit = killSet.has(n) ? 1 : 0;
            for (let i = 0; i < filterFuncs.length; i++) {
                if (filterFuncs[i](n)) hit++;
            }
            hitCounts[n] = hit;

            // 调整计数
            const adj = Math.max(0, rawCount[n] - hit);
            adjustedCount[n] = adj;
            if (adj > 0) {
                adjustedTotal += adj;
                unique++;
            }
        }

        // 打包数据为 ArrayBuffer
        const buffer = new ArrayBuffer(50 * 2 + 50); // Uint16(50) + Uint8(50)
        const view16 = new Uint16Array(buffer, 0, 50);
        const view8 = new Uint8Array(buffer, 50 * 2, 50);
        
        view16.set(adjustedCount);
        view8.set(hitCounts);

        return {
            buffer: buffer,
            adjustedTotal: adjustedTotal,
            unique: unique
        };
    }

    // 6. 输入解析
    function parseInput(input) {
        if (!input || !input.trim()) return [];
        let cleaned = input.replace(/《.*?》/g, " ")
                           .replace(/[^0-9鼠牛虎兔龙蛇马羊猴鸡狗猪]/g, " ")
                           .replace(/([鼠牛虎兔龙蛇马羊猴鸡狗猪])/g, " $1 ");
        const tokens = cleaned.split(/\s+/).filter(t => t.length > 0);
        const results = [];
        
        for (const token of tokens) {
            if (SHENGXIAO && SHENGXIAO[token]) {
                results.push(...SHENGXIAO[token]);
            } else if (/^\d+$/.test(token)) {
                const n = Number(token);
                if (n >= 1 && n <= 49) results.push(n);
            }
        }
        return results.slice(0, 5000);
    }

    // 7. 构建匹配函数 (补全所有逻辑)
    function buildMatchFuncs(filters) {
        return filters.map(cond => {
            //生肖
            if (cond.startsWith("生肖")) {
                const sx = cond.slice(2);
                return n => numProps[n] && numProps[n].shengXiao === sx;
            }
            //头数
            if (cond.endsWith("头单") || cond.endsWith("头双")) {
                const parts = cond.split("头");
                const headVal = parseInt(parts[0], 10);
                const oe = parts[1];
                return n => numProps[n] && numProps[n].head === headVal && numProps[n].odd === oe;
            }
            //尾数
            if (cond.endsWith("尾")) {
                const tailVal = parseInt(cond[0], 10);
                return n => numProps[n] && numProps[n].tail === tailVal;
            }
            //数段
            if (cond.endsWith("段")) {
                return n => numProps[n] && numProps[n].duan === cond;
            }
            //波色 (红波单等)
            if (cond.endsWith("波单") || cond.endsWith("波双")) {
                const parts = cond.split("波");
                const c = parts[0]; // 红/蓝/绿
                const oe = parts[1]; // 单/双
                const colorMap = { 红: "red", 蓝: "blue", 绿: "green" };
                return n => numProps[n] && numProps[n].color === colorMap[c] && numProps[n].odd === oe;
            }
            //五行
            if (["金","木","水","火","土"].includes(cond)) {
                return n => numProps[n] && numProps[n].five === cond;
            }
            //半单双/合数
            if (["合数单","合数双","大单","大双","小单","小双"].includes(cond)) {
                if (cond === "合数单") return n => numProps[n] && numProps[n].sum % 2 === 1;
                if (cond === "合数双") return n => numProps[n] && numProps[n].sum % 2 === 0;
                return n => numProps[n] && numProps[n].halfOddEven === cond;
            }
            //合数 (如 5合)
            if (cond.endsWith("合")) {
                const sumVal = parseInt(cond, 10);
                return n => numProps[n] && numProps[n].sum === sumVal;
            }
            // 默认不匹配
            return () => false;
        });
    }

})();
