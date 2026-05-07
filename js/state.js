const state = {
  nums: [],
  filters: {
    color: [],
    zodiac: []
  }
};

function loadState() {
  try {
    const raw = localStorage.getItem('shenma_v35');
    if (!raw) return;

    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed.nums)) {
      state.nums = parsed.nums.filter(n => n >= 1 && n <= 49);
    }

  } catch {}
}

function saveState() {
  localStorage.setItem('shenma_v35', JSON.stringify(state));
}