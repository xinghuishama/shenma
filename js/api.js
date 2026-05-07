// ================= API 配置 =================
const API_CONFIG = {
  BASE: 'https://api.macaumarksix.com/history', // 示例接口（可替换）
  TIMEOUT: 8000,
  RETRY: 2,
  CACHE_KEY: 'shenma_api_cache_v35',
  CACHE_TTL: 1000 * 60 * 10 // 10分钟缓存
};

// ================= 工具：带超时 fetch =================
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    clearTimeout(id);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return res;

  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// ================= 工具：重试机制 =================
async function fetchWithRetry(url, retries = API_CONFIG.RETRY) {
  let lastError;

  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchWithTimeout(url);
      return await res.json();
    } catch (err) {
      lastError = err;
      console.warn(`API retry ${i + 1} failed`, err);
    }
  }

  throw lastError;
}

// ================= 缓存工具 =================
function loadCache() {
  try {
    const raw = localStorage.getItem(API_CONFIG.CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);

    if (!parsed.time || !parsed.data) return null;

    // 过期判断
    if (Date.now() - parsed.time > API_CONFIG.CACHE_TTL) {
      return null;
    }

    return parsed.data;

  } catch {
    return null;
  }
}

function saveCache(data) {
  try {
    localStorage.setItem(API_CONFIG.CACHE_KEY, JSON.stringify({
      time: Date.now(),
      data
    }));
  } catch {}
}

// ================= 数据校验 + 规范化 =================
function normalizeHistory(data) {
  if (!Array.isArray(data)) return [];

  return data.map(item => {
    return {
      issue: String(item.issue || ''),
      numbers: Array.isArray(item.numbers)
        ? item.numbers.filter(n => Number.isInteger(n) && n >= 1 && n <= 49)
        : [],
      date: item.date || ''
    };
  }).filter(item => item.numbers.length > 0);
}

// ================= 主接口：获取历史数据 =================
async function getHistory(forceRefresh = false) {
  // 1️⃣ 先读缓存
  if (!forceRefresh) {
    const cache = loadCache();
    if (cache) {
      console.log('📦 使用缓存数据');
      return cache;
    }
  }

  try {
    // 2️⃣ 请求 API
    const json = await fetchWithRetry(API_CONFIG.BASE);

    const normalized = normalizeHistory(json);

    // 3️⃣ 写缓存
    saveCache(normalized);

    return normalized;

  } catch (err) {
    console.error('❌ API失败，尝试降级', err);

    // 4️⃣ 降级：使用旧缓存
    const cache = loadCache();
    if (cache) {
      console.warn('⚠️ 使用过期缓存');
      return cache;
    }

    // 5️⃣ 最终兜底
    return [];
  }
}

// ================= 分页工具 =================
function paginate(data, page = 1, pageSize = 20) {
  const total = data.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const safePage = Math.min(Math.max(1, page), totalPages);

  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;

  return {
    list: data.slice(start, end),
    page: safePage,
    totalPages,
    total
  };
}