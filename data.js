// ======================== data.js — 数据源定义 v3.8.0 ========================
(function () {
    "use strict";

    const APP_VERSION = 'v3.8.0-stable';
    const LS_VERSION_KEY = "shenma_core_version";

    // 版本变更清理旧缓存
    try {
        if (localStorage.getItem(LS_VERSION_KEY) !== APP_VERSION) {
            localStorage.clear();
            localStorage.setItem(LS_VERSION_KEY, APP_VERSION);
            console.log(`[Data] 版本升级至 ${APP_VERSION}，已重置本地缓存`);
        }
    } catch (e) {
        console.warn('[Data] 存储检测失败', e);
    }

    const MAX_NUMBERS = 5000;
    
    // 生肖配置 (固定数据)
    const SHENGXIAO = {
        鼠: [7, 19, 31, 43], 牛: [6, 18, 30, 42], 虎: [5, 17, 29, 41], 兔: [4, 16, 28, 40],
        龙: [3, 15, 27, 39], 蛇: [2, 14, 26, 38], 马: [1, 13, 25, 37, 49], 羊: [12, 24, 36, 48],
        猴: [11, 23, 35, 47], 鸡: [10, 22, 34, 46], 狗: [9, 21, 33, 45], 猪: [8, 20, 32, 44]
    };

    // 波色配置
    const CATEGORIES = {
        红波: [1, 2, 7, 8, 12, 13, 18, 19, 23, 24, 29, 30, 34, 35, 40, 45, 46],
        蓝波: [3, 4, 9, 10, 14, 15, 20, 25, 26, 31, 36, 37, 41, 42, 47, 48],
        绿波: [5, 6, 11, 16, 17, 21, 22, 27, 28, 32, 33, 38, 39, 43, 44, 49]
    };

    // 数段配置
    const DUAN = {
        "1段": [1, 2, 3, 4, 5, 6, 7], "2段": [8, 9, 10, 11, 12, 13, 14], "3段": [15, 16, 17, 18, 19, 20, 21],
        "4段": [22, 23, 24, 25, 26, 27, 28], "5段": [29, 30, 31, 32, 33, 34, 35], "6段": [36, 37, 38, 39, 40, 41, 42],
        "7段": [43, 44, 45, 46, 47, 48, 49]
    };

    // 五行计算逻辑 (跨年自动调整)
    const WUXING_BASE_SEQ = ['金', '金', '土', '土', '木', '木', '火', '火', '金', '金', '水', '水', '木', '木', '火', '火', '土', '土', '水', '水', '木', '木', '金', '金', '土', '土', '水', '水', '火', '火'];
    
    // 构建全局属性
    const numProps = new Array(50);
    const currentYear = new Date().getFullYear();
    const wuxingOffset = currentYear - 2023;

    for (let n = 1; n <= 49; n++) {
        // 基础属性
        const head = Math.floor(n / 10);
        const tail = n % 10;
        const odd = n % 2 === 1 ? "单" : "双";
        
        // 颜色
        const color = CATEGORIES.红波.includes(n) ? "red" : (CATEGORIES.蓝波.includes(n) ? "blue" : "green");
        
        // 五行 (动态计算)
        const fiveIndex = ((n - 1) % 30 - wuxingOffset + 30) % 30;
        const five = WUXING_BASE_SEQ[fiveIndex];
        
        // 数段
        let duan = "";
        for (const dk in DUAN) {
            if (DUAN[dk].includes(n)) { duan = dk; break; }
        }

        // 半单双
        const halfOddEven = n > 24 ? (n % 2 === 1 ? "大单" : "大双") : (n % 2 === 1 ? "小单" : "小双");
        
        // 生肖 (查找键值)
        let shengXiao = "";
        for (const sx in SHENGXIAO) {
            if (SHENGXIAO[sx].includes(n)) { shengXiao = sx; break; }
        }

        numProps[n] = { head, tail, color, odd, five, duan, halfOddEven, shengXiao, sum: head + tail };
    }

    const APP_DATA = { VERSION: APP_VERSION, MAX_NUMBERS, SHENGXIAO, CATEGORIES, DUAN, numProps };

    // 暴露到全局
    if (typeof window !== "undefined") window.APP_DATA = APP_DATA;
    if (typeof self !== "undefined") self.APP_DATA = APP_DATA; // 供 Worker 初始使用，但会被 Worker 内部逻辑覆盖或由主线程注入

    console.log(`✅ 数据核心初始化完成 [${APP_VERSION}]`);
})();
