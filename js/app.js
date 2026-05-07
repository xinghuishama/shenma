(function () {
  const input = document.getElementById('input');
  const result = document.getElementById('result');
  const btn = document.getElementById('analyze');

  const worker = new Worker('js/worker.js');

  btn.onclick = () => {
    const nums = parseInput(input.value);

    worker.postMessage(nums);
  };

  worker.onmessage = (e) => {
    renderNumbers(result, e.data.map((v, i) => v ? i : null).filter(Boolean));
  };

})();