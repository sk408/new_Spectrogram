'use strict';

const AUDIO_FREQS = [250, 500, 1000, 2000, 4000, 8000];

/**
 * Build a calibrated BiquadFilter chain for the given threshold array.
 * @param {number[]} thresholds  dB HL values at [250,500,1k,2k,4k,8k] Hz
 * @param {AudioContext} audioCtx  Live AudioContext (filters are created here)
 * @returns {Promise<{input: AudioNode, output: AudioNode, disconnect: Function}>}
 */
async function buildFilterChain(thresholds, audioCtx) {
  const filters = AUDIO_FREQS.map((freq, i) => {
    const f = audioCtx.createBiquadFilter();
    if (i === 0) {
      f.type = 'lowshelf';
      f.frequency.value = 250;
    } else if (i === 5) {
      f.type = 'highshelf';
      f.frequency.value = 8000;
    } else {
      f.type = 'peaking';
      f.frequency.value = freq;
      f.Q.value = 1.4;
    }
    f.gain.value = -(thresholds[i] ?? 0);
    return f;
  });

  for (let i = 0; i < filters.length - 1; i++) {
    filters[i].connect(filters[i + 1]);
  }

  const targetAttenuation = thresholds.map(t => -(t ?? 0));
  const gains = filters.map(f => f.gain.value);

  const MAX_ITER = 8;
  const DAMPING = 0.5;
  const TOLERANCE = 1.0;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const measured = await measureAttenuation(filters, audioCtx);
    let maxError = 0;
    for (let i = 0; i < 6; i++) {
      const error = targetAttenuation[i] - measured[i];
      gains[i] += DAMPING * error;
      filters[i].gain.value = gains[i];
      maxError = Math.max(maxError, Math.abs(error));
    }
    if (maxError < TOLERANCE) break;
    if (iter === MAX_ITER - 1) {
      console.warn(`filter-bank: calibration did not converge (max error ${maxError.toFixed(1)} dB) — using best-achieved gains`);
    }
  }

  return {
    input: filters[0],
    output: filters[filters.length - 1],
    disconnect() {
      for (const f of filters) f.disconnect();
    },
  };
}

/**
 * Route white noise through the filter chain in an OfflineAudioContext.
 * Returns actual attenuation (dB) at each audiometric frequency.
 * @param {BiquadFilterNode[]} filters  Live filter nodes (gains are mirrored)
 * @param {AudioContext} audioCtx  Used only for sampleRate
 * @returns {Promise<number[]>}  attenuation in dB (negative = cut)
 */
async function measureAttenuation(filters, audioCtx) {
  const sampleRate = audioCtx.sampleRate;
  const frameCount = Math.ceil(sampleRate * 0.1); // 100ms

  // Generate deterministic pseudo-white noise
  const noiseData = new Float32Array(frameCount);
  let seed = 1;
  for (let i = 0; i < frameCount; i++) {
    seed = (seed * 16807) & 0x7fffffff;
    noiseData[i] = (seed / 0x40000000) - 1.0;
  }

  // Render filtered
  const offlineWet = new OfflineAudioContext(1, frameCount, sampleRate);
  const wetBuf = offlineWet.createBuffer(1, frameCount, sampleRate);
  wetBuf.getChannelData(0).set(noiseData);
  const wetSrc = offlineWet.createBufferSource();
  wetSrc.buffer = wetBuf;

  const offlineFilters = filters.map(f => {
    const of = offlineWet.createBiquadFilter();
    of.type = f.type;
    of.frequency.value = f.frequency.value;
    of.Q.value = f.Q.value;
    of.gain.value = f.gain.value;
    return of;
  });
  for (let i = 0; i < offlineFilters.length - 1; i++) {
    offlineFilters[i].connect(offlineFilters[i + 1]);
  }
  wetSrc.connect(offlineFilters[0]);
  offlineFilters[offlineFilters.length - 1].connect(offlineWet.destination);
  wetSrc.start(0);

  // Render dry
  const offlineDry = new OfflineAudioContext(1, frameCount, sampleRate);
  const dryBuf = offlineDry.createBuffer(1, frameCount, sampleRate);
  dryBuf.getChannelData(0).set(noiseData);
  const drySrc = offlineDry.createBufferSource();
  drySrc.buffer = dryBuf;
  drySrc.connect(offlineDry.destination);
  drySrc.start(0);

  const [wetRendered, dryRendered] = await Promise.all([
    offlineWet.startRendering(),
    offlineDry.startRendering(),
  ]);

  const wetSamples = wetRendered.getChannelData(0);
  const drySamples = dryRendered.getChannelData(0);

  return AUDIO_FREQS.map(freq => {
    const rmsWet = singleFreqRMS(wetSamples, sampleRate, freq);
    const rmsDry = singleFreqRMS(drySamples, sampleRate, freq);
    return rmsDry > 0 ? 20 * Math.log10(rmsWet / rmsDry) : 0;
  });
}

/**
 * Compute RMS amplitude at a specific frequency using single-bin DFT.
 */
function singleFreqRMS(samples, sampleRate, freq) {
  const N = samples.length;
  const omega = 2 * Math.PI * freq / sampleRate;
  let re = 0, im = 0;
  for (let i = 0; i < N; i++) {
    re += samples[i] * Math.cos(omega * i);
    im += samples[i] * Math.sin(omega * i);
  }
  return Math.sqrt(re * re + im * im) / N;
}

if (typeof module !== 'undefined') module.exports = { buildFilterChain, measureAttenuation };
