// Run with: node tests/test-noise-floor.js
const assert = require('assert');

// Load the NoiseFloor class
const { NoiseFloor } = require(__dirname + '/../noise-floor.js');

// Test 1: rolling minimum tracks the min of recent values
{
  const nf = new NoiseFloor({ bins: 4, windowMs: 500, frameMs: 100 });
  nf.update([-60, -50, -40, -30]);
  nf.update([-70, -55, -35, -25]); // lower values → floor should drop
  const floor = nf.getFloor();
  assert.strictEqual(floor.length, 4, 'floor has 4 bins');
  assert(floor[0] <= -70, `floor[0] should be ≤ -70, got ${floor[0]}`);
  assert(floor[1] <= -55, `floor[1] should be ≤ -55, got ${floor[1]}`);
  console.log('✅ Test 1: rolling min tracks minimum');
}

// Test 2: getSNR returns difference between current and floor
{
  const nf = new NoiseFloor({ bins: 2, windowMs: 300, frameMs: 100 });
  nf.update([-60, -40]);
  nf.update([-60, -40]);
  nf.update([-60, -40]);
  const snr = nf.getSNR([-50, -30]);
  assert(snr[0] > 0, `SNR[0] should be positive (signal above floor), got ${snr[0]}`);
  assert(snr[1] > 0, `SNR[1] should be positive, got ${snr[1]}`);
  console.log('✅ Test 2: getSNR returns positive values when signal is above floor');
}

// Test 3: old frames expire after window duration
{
  const nf = new NoiseFloor({ bins: 1, windowMs: 200, frameMs: 100 });
  nf.update([-80]); // very low
  nf.update([-60]);
  nf.update([-60]); // now the -80 frame is >200ms old (window=200ms, 2 frames max)
  const floor = nf.getFloor();
  // floor should have risen (old -80 expired)
  assert(floor[0] >= -60, `floor[0] should have risen to -60, got ${floor[0]}`);
  console.log('✅ Test 3: old frames expire correctly');
}

// Test 4: getSNR allocates a new Float32Array each call (does not mutate)
{
  const nf = new NoiseFloor({ bins: 2, windowMs: 1000, frameMs: 100 });
  nf.update([-70, -70]);
  const snr1 = nf.getSNR([-60, -60]);
  const snr2 = nf.getSNR([-60, -60]);
  assert(snr1 !== snr2, 'getSNR must return a new array each call');
  console.log('✅ Test 4: getSNR returns a new array each call');
}

// Test 5: reset() clears history
{
  const nf = new NoiseFloor({ bins: 2, windowMs: 1000, frameMs: 100 });
  nf.update([-50, -40]);
  nf.reset();
  const floor = nf.getFloor();
  assert(floor[0] <= -100, `floor[0] after reset should be ≤ -100, got ${floor[0]}`);
  console.log('✅ Test 5: reset() clears history');
}

console.log('\n✅ All noise-floor tests passed');
