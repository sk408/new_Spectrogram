const perf = require('perf_hooks').performance;

function runOld() {
  let dataTime;
  let dataFrec;
  const start = perf.now();
  for(let i = 0; i < 10000; i++) {
    const bufferLength = 1024;
    dataTime = new Uint8Array(bufferLength * 2);
    dataFrec = new Float32Array(bufferLength);
  }
  const end = perf.now();
  return end - start;
}

function runNew() {
  let dataTime;
  let dataFrec;
  let currentBufferLength = 0;
  const start = perf.now();
  for(let i = 0; i < 10000; i++) {
    const bufferLength = 1024;
    if (bufferLength !== currentBufferLength) {
      dataTime = new Uint8Array(bufferLength * 2);
      dataFrec = new Float32Array(bufferLength);
      currentBufferLength = bufferLength;
    }
  }
  const end = perf.now();
  return end - start;
}

let oldTime = 0;
let newTime = 0;
for (let j=0; j < 10; j++) {
    oldTime += runOld();
    newTime += runNew();
}
console.log(`Old: ${oldTime / 10} ms`);
console.log(`New: ${newTime / 10} ms`);
