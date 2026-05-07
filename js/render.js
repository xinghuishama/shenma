function renderNumbers(container, nums) {
  const frag = document.createDocumentFragment();

  nums.forEach(n => {
    const el = document.createElement('div');
    el.className = 'ball';
    el.textContent = String(n).padStart(2, '0');
    frag.appendChild(el);
  });

  container.replaceChildren(frag);
}