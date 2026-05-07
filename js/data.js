// ======================== data.js ========================
(function () {
  "use strict";

  const MAX_NUMBERS = 5000;

  // ================= 生肖 =================
  const SHENGXIAO = {
    鼠:[7,19,31,43],
    牛:[6,18,30,42],
    虎:[5,17,29,41],
    兔:[4,16,28,40],
    龙:[3,15,27,39],
    蛇:[2,14,26,38],
    马:[1,13,25,37,49],
    羊:[12,24,36,48],
    猴:[11,23,35,47],
    鸡:[10,22,34,46],
    狗:[9,21,33,45],
    猪:[8,20,32,44]
  };

  // ================= 分类 =================
  const CATEGORIES = {
    金:[4,5,12,13,26,27,34,35,42,43],
    木:[8,9,16,17,24,25,38,39,46,47],
    水:[1,14,15,22,23,30,31,44,45],
    火:[2,3,10,11,18,19,32,33,40,41,48,49],
    土:[6,7,20,21,28,29,36,37],

    红波:[1,2,7,8,12,13,18,19,23,24,29,30,34,35,40,45,46],
    蓝波:[3,4,9,10,14,15,20,25,26,31,36,37,41,42,47,48],
    绿波:[5,6,11,16,17,21,22,27,28,32,33,38,39,43,44,49]
  };

  // ================= 数段 =================
  const DUAN = {
    "1段":[1,2,3,4,5,6,7],
    "2段":[8,9,10,11,12,13,14],
    "3段":[15,16,17,18,19,20,21],
    "4段":[22,23,24,25,26,27,28],
    "5段":[29,30,31,32,33,34,35],
    "6段":[36,37,38,39,40,41,42],
    "7段":[43,44,45,46,47,48,49]
  };

  // ================= Set缓存 =================
  const categorySets = {};

  for (const [k, arr] of Object.entries(CATEGORIES)) {
    categorySets[k] = new Set(arr);
  }

  // ================= 生肖反向索引 =================
  const SHENGXIAO_INDEX = {};

  for (const [sx, nums] of Object.entries(SHENGXIAO)) {
    nums.forEach(n => {
      SHENGXIAO_INDEX[n] = sx;
    });
  }

  // ================= 号码属性 =================
  const numProps = new Array(50);

  for (let n = 1; n <= 49; n++) {

    const head = Math.floor(n / 10);
    const tail = n % 10;
    const sum = head + tail;

    const color =
      categorySets.红波.has(n) ? 'red' :
      categorySets.蓝波.has(n) ? 'blue' :
      'green';

    const five =
      categorySets.金.has(n) ? '金' :
      categorySets.木.has(n) ? '木' :
      categorySets.水.has(n) ? '水' :
      categorySets.火.has(n) ? '火' :
      '土';

    let duan = '';

    for (const [dk, dv] of Object.entries(DUAN)) {
      if (dv.includes(n)) {
        duan = dk;
        break;
      }
    }

    numProps[n] = {
      head,
      tail,
      sum,

      odd: n % 2 ? '单' : '双',

      sumOdd: sum % 2 ? '合数单' : '合数双',

      halfOddEven:
        n > 24
          ? (n % 2 ? '大单' : '大双')
          : (n % 2 ? '小单' : '小双'),

      color,
      five,
      duan,

      shengXiao: SHENGXIAO_INDEX[n]
    };
  }

  // ================= 全局导出 =================
  const root =
    typeof self !== 'undefined'
      ? self
      : window;

  root.APP_DATA = {
    MAX_NUMBERS,
    SHENGXIAO,
    CATEGORIES,
    DUAN,
    numProps
  };

})();