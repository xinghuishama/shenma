importScripts('data.js');

self.onmessage = function (e) {
  const nums = e.data;

  const freq = new Uint16Array(50);

  nums.forEach(n => {
    freq[n]++;
  });

  self.postMessage(Array.from(freq));
};