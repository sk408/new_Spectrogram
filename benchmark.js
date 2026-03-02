const { performance } = require('perf_hooks');

const bufferLength = 4096;
const iterations = 100000;

// Baseline: creating arrays every time
let start = performance.now();
let dummy1, dummy2;
for (let i = 0; i < iterations; i++) {
    dummy1 = new Uint8Array(bufferLength * 2);
    dummy2 = new Float32Array(bufferLength);
}
let end = performance.now();
console.log(`Baseline (allocating arrays ${iterations} times): ${(end - start).toFixed(2)} ms`);

// Optimized: reuse arrays
start = performance.now();
dummy1 = new Uint8Array(bufferLength * 2);
dummy2 = new Float32Array(bufferLength);
for (let i = 0; i < iterations; i++) {
    // Just reusing, no allocation
    // we do what is needed, e.g. checking length
    if (dummy1.length !== bufferLength * 2) {
        dummy1 = new Uint8Array(bufferLength * 2);
    }
    if (dummy2.length !== bufferLength) {
        dummy2 = new Float32Array(bufferLength);
    }
}
end = performance.now();
console.log(`Optimized (reusing arrays ${iterations} times): ${(end - start).toFixed(2)} ms`);
