// ============================================================
// Live Spectrogram — Clinical Hearing Counseling Tool
// Real-time Audio Visualization with Audiogram Overlay
// ============================================================
"use strict";

// --- Constants (module-level, shared across all engine instances) ---
const MEL_CONST = 1127.01048;
const BH7_COEFFS = Object.freeze([
  0.27105140069342, -0.43329793923448, 0.21812299954311,
  -0.06592544638803, 0.01081174209837, -0.00077658482522,
  0.00001388721735,
]);

// Approximate dBFS → dB SPL offset. Web Audio getFloatFrequencyData() returns
// dBFS (0 = digital max, typically -100 to -10). Adding this offset maps to
// approximate dB SPL. Not calibrated — true SPL requires a reference microphone.
// Combined with RETSPL correction (audiogram.js), gives approximate dB HL:
//   dB HL ≈ dBFS + DBFS_SPL_OFFSET - RETSPL(freq)
const DBFS_SPL_OFFSET = 125;

// ============================================================
// FFT — Cooley-Tukey Radix-2 (shared, stateless)
// ============================================================

function Complex(re, im) {
  this.re = re;
  this.im = im || 0;
}

function myFFT(signal) {
  const len = signal.length;
  if (len === 1) return signal;

  const half = len / 2;
  const even = new Array(half);
  const odd = new Array(half);

  for (let i = 0; i < half; i++) {
    even[i] = signal[i * 2];
    odd[i] = signal[i * 2 + 1];
  }

  const evenFFT = myFFT(even);
  const oddFFT = myFFT(odd);

  for (let k = 0; k < half; k++) {
    if (!(evenFFT[k] instanceof Complex)) evenFFT[k] = new Complex(evenFFT[k], 0);
    if (!(oddFFT[k] instanceof Complex)) oddFFT[k] = new Complex(oddFFT[k], 0);

    const angle = -2 * Math.PI * k / len;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const tRe = oddFFT[k].re * cos - oddFFT[k].im * sin;
    const tIm = oddFFT[k].re * sin + oddFFT[k].im * cos;

    signal[k] = new Complex(evenFFT[k].re + tRe, evenFFT[k].im + tIm);
    signal[k + half] = new Complex(evenFFT[k].re - tRe, evenFFT[k].im - tIm);
  }

  return signal;
}

// ============================================================
// Harmonic Product Spectrum — Fundamental Frequency Detection (shared, stateless)
// ============================================================

function downsample(array, factor) {
  const len = Math.floor(array.length / factor);
  const result = new Array(len);
  for (let i = 0; i < len; i++) {
    result[i] = array[i * factor];
  }
  return result;
}

function calculateFundamentalFrequencyHPS(spectrum, sampleRate) {
  const mag = new Array(spectrum.length);
  for (let i = 0; i < spectrum.length; i++) {
    mag[i] = Math.abs(spectrum[i]);
  }

  const harmonics = 5;
  const result = mag.slice();

  for (let h = 2; h <= harmonics; h++) {
    const ds = downsample(mag, h);
    for (let i = 0; i < ds.length; i++) {
      result[i] *= ds[i];
    }
  }

  let maxVal = -Infinity;
  let maxIdx = 0;
  for (let i = 1; i < result.length; i++) {
    if (result[i] > maxVal) {
      maxVal = result[i];
      maxIdx = i;
    }
  }

  return maxIdx * sampleRate / spectrum.length;
}

// Simple string hash for deterministic phoneme placement (shared, stateless)
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ============================================================
// Engine Factory
// ============================================================

function createSpectrogramEngine(canvasEl, analyserNodeIn, options) {
  options = options || {};

  // --- Canvas ---
  const canvas = canvasEl;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const overlayEl = options.overlayEl || null;
  const octx = overlayEl ? overlayEl.getContext("2d") : null;

  // --- Layout ---
  let borderLeft, borderRight, borderBottom, borderTop;

  // --- Audio ---
  let analyserNode = analyserNodeIn;

  // --- Rendering State ---
  let bufferLength = 0;
  let fftSize = options.fftSize || 8192;
  let colormap = options.colormap || "inferno";
  let fNyquist = 22050;
  let fMin = options.fMin != null ? parseFloat(options.fMin) : 0;
  let fMax = options.fMax != null ? parseFloat(options.fMax) : 9000;
  let iMin = 0;
  let iMax = 0;
  let binWidth = options.speed || 4;
  let myX = [];
  let myXAbs = null;
  let maxIntensity = -100;
  // sensibility: fixed full-scale range (0–120 dB HL = full colormap range)
  // sensitivityOffset: slider-driven dB offset added to correctedDB before normalising.
  // Positive offset = brighter (more sensitive); negative = dimmer.
  let sensibility = 120;
  let sensitivityOffset = options.sensitivity != null ? parseFloat(options.sensitivity) : 0;
  let sensibilityTemp = sensibility;
  let frecMax = 0;
  let frecMaxDisplay = "0";
  let lastFreqUpdateTime = 0;
  const FREQ_UPDATE_INTERVAL = 1250;
  let counter = 0;
  let startTime = 0;
  let overlayDirty = true;

  // --- Engine state ---
  let isRunning = false;
  let isPaused = false;
  let animationId = null;

  // --- Options-driven state ---
  let scale = options.scale || "Mel";
  let windowFunc = options.windowFunc || "BH7";
  let fftEngine = options.fftEngine || "WebAudio";
  let scrolling = options.scrolling != null ? options.scrolling : true;
  let useHLMode = options.useHLMode || false;
  let isLossPanel = options.isLossPanel || false;
  let audiogramRef = options.audiogram || null;
  let showBanana = options.showBanana || false;
  let showPhonemes = options.showPhonemes || false;
  let noiseFloor = options.noiseFloor ?? null;

  // --- Pre-allocated Buffers ---
  let timeBuffer = null;
  let freqBuffer = null;
  let absBuffer = null;

  // ============================================================
  // Helpers
  // ============================================================

  function melScale(f) {
    return MEL_CONST * Math.log(f / 700 + 1);
  }

  function inverseMelScale(mel) {
    return 700 * (Math.exp(mel / MEL_CONST) - 1);
  }

  function getFont(size) {
    return ((canvas.width * size / 1000) | 0) + "px sans-serif";
  }

  // Convert frequency to Y position on the spectrogram
  function freqToY(freq, Y0, deltaY0) {
    const isLinear = scale === "Linear";
    if (isLinear) {
      return Y0 + deltaY0 - (deltaY0 * (freq - fMin)) / (fMax - fMin);
    }
    const melMin = melScale(fMin);
    const melRange = melScale(fMax) - melMin;
    const mel = melScale(freq);
    return Y0 + deltaY0 - (deltaY0 * (mel - melMin)) / melRange;
  }

  // Convert Y position to frequency
  function yToFreq(y, Y0, deltaY0) {
    const isLinear = scale === "Linear";
    const frac = 1 - (y - Y0) / deltaY0;
    if (isLinear) {
      return fMin + frac * (fMax - fMin);
    }
    const melMin = melScale(fMin);
    const melRange = melScale(fMax) - melMin;
    return inverseMelScale(melMin + frac * melRange);
  }

  // ============================================================
  // Canvas Layout
  // ============================================================

  function applyOrientation() {
    borderLeft = canvas.width / 20;
    borderRight = canvas.width / 10;
    const scaleV = canvas.height / 760;
    borderBottom = 80 * scaleV;
    borderTop = 10 * scaleV;
    plotColormap();
    overlayDirty = true;
  }

  // ============================================================
  // Audio Buffer Management
  // ============================================================

  function ensureBuffers(size) {
    if (!timeBuffer || timeBuffer.length !== size * 2) {
      timeBuffer = new Uint8Array(size * 2);
    }
    if (!freqBuffer || freqBuffer.length !== size) {
      freqBuffer = new Float32Array(size);
    }
    if (!absBuffer || absBuffer.length !== size) {
      absBuffer = new Float64Array(size);
    }
  }

  // ============================================================
  // Window Functions
  // ============================================================

  function applyWindow(samples) {
    const n = samples.length;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += samples[i];
    mean /= n;

    const winType = windowFunc;

    for (let i = 0; i < n; i++) {
      const centered = samples[i] - mean;
      switch (winType) {
        case "Cosine":
          samples[i] = centered * Math.sin(Math.PI * i / n);
          break;
        case "Hanning":
          samples[i] = centered * 0.5 * (1 - Math.cos(2 * Math.PI * i / n));
          break;
        case "BH7": {
          let w = 0;
          for (let j = 0; j < 7; j++) {
            w += BH7_COEFFS[j] * Math.cos(2 * Math.PI * j * i / n);
          }
          samples[i] = centered * w;
          break;
        }
        default:
          samples[i] = centered;
      }
    }
  }

  // ============================================================
  // Main Render Loop
  // ============================================================

  function renderFrame() {
    if (!isRunning) return;

    // Apply fftSize to analyser
    analyserNode.fftSize = fftSize;
    bufferLength = analyserNode.frequencyBinCount;
    ensureBuffers(bufferLength);

    fNyquist = (analyserNode.context && analyserNode.context.sampleRate)
      ? analyserNode.context.sampleRate / 2
      : 22050;

    // Acquire audio data
    analyserNode.getByteTimeDomainData(timeBuffer);
    analyserNode.getFloatFrequencyData(freqBuffer);

    // NoiseFloor update (if provided)
    if (noiseFloor) noiseFloor.update(freqBuffer);

    counter++;

    // Copy time-domain samples and apply window function
    const sampleCount = bufferLength * 2;
    myX = new Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) myX[i] = timeBuffer[i];
    applyWindow(myX);

    // Draw waveform
    plotMic();

    // Compute FFT magnitudes
    absBuffer.fill(0);
    maxIntensity = -100;
    const half = myX.length / 2;

    if (fftEngine === "myFFT") {
      const fft = myFFT(myX);
      for (let i = 1; i < half; i++) {
        absBuffer[i] = 10 * Math.log10(fft[i].re * fft[i].re + fft[i].im * fft[i].im) - 20;
        if (absBuffer[i] > maxIntensity) maxIntensity = absBuffer[i];
      }
    } else {
      for (let i = 1; i < half; i++) {
        absBuffer[i] = freqBuffer[i] + DBFS_SPL_OFFSET;
        if (absBuffer[i] > maxIntensity) maxIntensity = absBuffer[i];
      }
    }
    myXAbs = absBuffer;

    // Frequency range bin indices
    iMin = Math.floor((myXAbs.length * fMin) / fNyquist);
    iMax = Math.floor((myXAbs.length * fMax) / fNyquist);

    // Fundamental frequency via Harmonic Product Spectrum
    frecMax = calculateFundamentalFrequencyHPS(myXAbs, fNyquist * 2);

    // Throttle the frequency display update (every 1.25s)
    const now = Date.now();
    if (now - lastFreqUpdateTime > FREQ_UPDATE_INTERVAL) {
      frecMaxDisplay = Math.round(frecMax).toString();
      lastFreqUpdateTime = now;
    }

    // Render all visualization layers
    drawPeakFrequency();
    yAxisMarks();
    plotFFT();
    plotSpectro();

    // Draw overlay (audiogram annotations) when needed
    if (overlayDirty && octx) {
      drawOverlay();
      overlayDirty = false;
    }

    animationId = requestAnimationFrame(renderFrame);
  }

  // ============================================================
  // Drawing Functions
  // ============================================================

  function drawPeakFrequency() {
    ctx.fillStyle = "lightblue";
    ctx.fillRect(
      borderTop, borderTop,
      canvas.width / 10 + borderLeft - 2 * borderTop,
      canvas.height / 10 - borderTop,
    );
    ctx.fillStyle = "black";
    ctx.font = getFont(25);
    ctx.textAlign = "right";
    const centerY = (borderTop + canvas.height / 10) / 2;
    ctx.fillText(frecMaxDisplay + " Hz", canvas.width / 8, centerY);
  }

  function plotMic() {
    const scaleV = canvas.height / 760;
    const attenuation = 0.4;

    const x0 = canvas.width / 10 + borderLeft;
    const areaW = 0.9 * canvas.width - borderRight - borderLeft;
    const areaH = canvas.height / 10 + borderTop;

    ctx.fillStyle = "#003B5C";
    ctx.fillRect(x0, 0, areaW, areaH);

    ctx.beginPath();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 1;

    const center = areaH / 2;
    const dx = areaW / myX.length;
    let x = x0;

    for (let i = 0; i < myX.length; i++) {
      if (i === 0) {
        ctx.moveTo(x, center);
      } else {
        let y = myX[i] * attenuation + center;
        y = center + (y - center) * scaleV;
        y = Math.min(y, areaH - 1);
        ctx.lineTo(x, y);
      }
      x += dx;
    }
    ctx.stroke();
  }

  function plotFFT() {
    const scaleH = canvas.width / 1440;
    const fftWidth = (0.9 * canvas.width) / 10;
    const Y0 = canvas.height / 10 + borderTop;
    const deltaY0 = 0.9 * canvas.height - borderBottom - borderTop;

    const isLinear = scale === "Linear";
    const isHLMode = useHLMode;
    const freqRange = fMax - fMin;
    const melMin = isLinear ? 0 : melScale(fMin);
    const melRange = isLinear ? 0 : melScale(fMax) - melMin;
    const deltaI = iMax - iMin;

    function getY(i) {
      if (isLinear) {
        return Y0 + deltaY0 - (deltaY0 * (i - iMin)) / deltaI;
      }
      const freq = fMin + (freqRange * (i - iMin)) / deltaI;
      const mel = melScale(freq);
      return Y0 + deltaY0 - (deltaY0 * (mel - melMin)) / melRange;
    }

    // Get corrected dB value for a bin
    function getCorrectedDB(i) {
      if (!isHLMode) return myXAbs[i];
      const freq = fMin + (freqRange * (i - iMin)) / deltaI;
      return myXAbs[i] - getRETSPL(freq);
    }

    ctx.fillStyle = "#003B5C";
    ctx.fillRect(0, Y0, fftWidth, deltaY0);

    ctx.lineWidth = 1;

    for (let i = iMin; i < iMax; i++) {
      const y = getY(i);
      const db = getCorrectedDB(i);
      const value = (db + sensitivityOffset) / sensibility;
      ctx.strokeStyle = "hsl(" + (360 * (1 - value)) + ",100%,50%)";
      ctx.beginPath();
      ctx.moveTo(fftWidth, y);
      if (db > 0) {
        ctx.lineTo(-db * scaleH + fftWidth, y);
      }
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.strokeStyle = "white";
    for (let i = iMin; i < iMax; i++) {
      const y = getY(i);
      const db = getCorrectedDB(i);
      const x = -db * scaleH + fftWidth;
      if (i === iMin) {
        ctx.moveTo(fftWidth, y);
      } else if (db > 0) {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    sensibilityTemp = maxIntensity > sensibility ? maxIntensity : sensibility;
    colormapMarks();

    ctx.beginPath();
    ctx.strokeStyle = "white";
    const threshX = -sensibilityTemp * scaleH + fftWidth;
    ctx.moveTo(threshX, Y0);
    ctx.lineTo(threshX, Y0 + deltaY0);
    ctx.stroke();
  }

  function plotSpectro() {
    const X0 = Math.floor(canvas.width / 10 + borderLeft);
    const deltaX0 = Math.floor(0.9 * canvas.width - borderLeft - borderRight - binWidth);
    const Y0 = canvas.height / 10 + borderTop;
    const deltaY0 = 0.9 * canvas.height - borderBottom - borderTop;

    const isScrolling = scrolling;
    const isLinear = scale === "Linear";
    const isHLMode = useHLMode;
    // Audiogram masking: only when isLossPanel is true and audiogramRef is set
    const audiogramEnabled = isLossPanel && audiogramRef && audiogramRef.enabled;

    const deltaI = iMax - iMin;
    const deltaF = fMax - fMin;
    const melMin = isLinear ? 0 : melScale(fMin);
    const melRange = isLinear ? 0 : melScale(fMax) - melMin;

    // Scroll existing pixels (GPU-accelerated via drawImage)
    if (!isPaused) {
      if (isScrolling) {
        ctx.drawImage(canvas,
          X0 + binWidth, Y0, deltaX0 - binWidth, deltaY0,
          X0, Y0, deltaX0 - binWidth, deltaY0,
        );
      } else {
        ctx.drawImage(canvas,
          X0 + 1, Y0, deltaX0 - binWidth - 1, deltaY0,
          X0 + binWidth, Y0, deltaX0 - binWidth - 1, deltaY0,
        );
      }
    }

    // Draw new frequency column using ImageData — iterate pixel rows to avoid gaps
    const colX = isScrolling ? X0 + deltaX0 - binWidth : X0;
    const height = Math.ceil(deltaY0);
    const imgData = ctx.createImageData(binWidth, height);
    const pixels = imgData.data;

    // Compute SNR array once per column, before the row loop
    const snrArray = noiseFloor ? noiseFloor.getSNR(freqBuffer) : null;

    for (let row = 0; row < height; row++) {
      // Map pixel row → frequency
      const frac = 1 - row / deltaY0;
      let freq;
      if (isLinear) {
        freq = fMin + frac * deltaF;
      } else {
        freq = inverseMelScale(melMin + frac * melRange);
      }

      // Map frequency → FFT bin index
      const binIdx = Math.round((freq / fNyquist) * myXAbs.length);
      if (binIdx < 1 || binIdx >= myXAbs.length) continue;

      // Apply RETSPL correction for dB HL mode
      const rawDB = myXAbs[binIdx];
      const correctedDB = isHLMode ? rawDB - getRETSPL(freq) : rawDB;

      let value = (correctedDB + sensitivityOffset) / sensibility;
      if (value > 1) value = 1;
      if (value < 0) value = 0;

      const rgb = evaluate_cmap(value, colormap, false);
      let r = rgb[0], g = rgb[1], b = rgb[2];

      // SNR brightness rendering (noise floor dimming)
      if (snrArray) {
        const snr = isFinite(snrArray[binIdx]) ? snrArray[binIdx] : 6;
        if (snr < 6) {
          // Background noise: render at 40% brightness
          r = Math.round(r * 0.4);
          g = Math.round(g * 0.4);
          b = Math.round(b * 0.4);
        }
      }

      // Audiogram masking: dim pixels below patient's hearing threshold
      if (audiogramEnabled && value > 0.01) {
        if (!audiogramRef.isAudible(correctedDB, freq, isHLMode)) {
          r = Math.floor(r * 0.2 + 80);
          g = Math.floor(g * 0.1);
          b = Math.floor(b * 0.1);
        }
      }

      for (let bx = 0; bx < binWidth; bx++) {
        const idx = (row * binWidth + bx) * 4;
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, colX, Y0);
  }

  function yAxisMarks() {
    const X0 = canvas.width / 10 + borderLeft;
    const Y0 = canvas.height / 10 + borderTop;
    const deltaY0 = 0.9 * canvas.height - borderBottom - borderTop;

    ctx.fillStyle = "white";
    ctx.fillRect(
      (0.9 * canvas.width) / 10,
      Y0 - borderTop,
      (0.1 * canvas.width) / 10 + borderLeft,
      Y0 + deltaY0,
    );

    ctx.fillStyle = "black";
    ctx.font = getFont(10);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    const isLinear = scale === "Linear";
    const ticks = isLinear
      ? [100, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500,
         6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500, 10000, 11000, 12000,
         13000, 14000, 15000, 16000, 17000, 18000, 19000, 20000]
      : [100, 200, 400, 600, 800, 1000, 2000, 3000, 4000, 5000, 6000, 7000,
         8000, 9000, 10000, 11000, 13000, 15000, 17000, 20000];

    const freqRange = fMax - fMin;
    const melMinVal = isLinear ? 0 : melScale(fMin);
    const melRange = isLinear ? 0 : melScale(fMax) - melMinVal;

    for (const freq of ticks) {
      if (freq > fMax) continue;

      let y;
      if (isLinear) {
        y = Y0 + deltaY0 - (deltaY0 * (freq - fMin)) / freqRange;
      } else {
        const mel = melScale(freq);
        y = Y0 + deltaY0 - (deltaY0 * (mel - melMinVal)) / melRange;
      }

      ctx.fillText(freq + " Hz", X0 - borderTop, y);

      ctx.strokeStyle = "black";
      ctx.beginPath();
      ctx.moveTo(X0, y);
      ctx.lineTo(X0 - 4, y);
      ctx.moveTo((0.9 * canvas.width) / 10, y);
      ctx.lineTo((0.9 * canvas.width) / 10 + 4, y);
      ctx.stroke();
    }
  }

  function plotColormap() {
    const cmapName = colormap;
    const Y0 = Math.floor(canvas.height / 10 + borderTop);
    const deltaY0 = Math.floor(0.9 * canvas.height - borderBottom - borderTop);
    const x0 = Math.floor(0.9 * canvas.width + borderTop);
    const barW = canvas.width / 30;

    for (let y = Y0; y <= Y0 + deltaY0; y++) {
      const rgb = evaluate_cmap(1 - (y - Y0) / deltaY0, cmapName, false);
      ctx.fillStyle = "rgb(" + rgb + ")";
      ctx.fillRect(x0, y, barW, 1);
    }
  }

  function colormapMarks() {
    const x0 = 0.95 * canvas.width;
    const Y0 = canvas.height / 10 + borderTop;
    const deltaY0 = 0.9 * canvas.height - borderBottom - borderTop;

    ctx.fillStyle = "white";
    ctx.fillRect(x0, 0, canvas.width - x0, Y0 + deltaY0 + 10);
    ctx.fillRect(0, canvas.height - 0.8 * borderBottom, canvas.width, 0.8 * borderBottom + 10);

    ctx.fillStyle = "black";
    ctx.font = getFont(20);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    const dB = Math.max(sensibilityTemp, maxIntensity);
    const unit = useHLMode ? " dB HL" : " dB SPL";
    ctx.fillText(Math.floor(dB) + unit, x0, Y0);
    ctx.fillText(Math.floor(0.75 * dB) + unit, x0, Y0 + 0.25 * deltaY0);
    ctx.fillText(Math.floor(0.5 * dB) + unit, x0, Y0 + 0.5 * deltaY0);
    ctx.fillText(Math.floor(0.25 * dB) + unit, x0, Y0 + 0.75 * deltaY0);
    ctx.fillText("0" + unit, x0, Y0 + deltaY0);

    // Elapsed time instead of static "Time"
    const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const timeStr = mins + ":" + (secs < 10 ? "0" : "") + secs;
    ctx.fillText(timeStr, canvas.width / 2, canvas.height - 0.5 * borderBottom);

    const loudnessLabel = useHLMode ? "Loudness (dB HL)" : "Loudness (dB SPL)";
    ctx.fillText(loudnessLabel, 10, canvas.height - 0.5 * borderBottom);
    ctx.fillText("Color", canvas.width - borderRight, canvas.height - 0.5 * borderBottom);
  }

  // ============================================================
  // Overlay Canvas — Audiogram Annotations
  // ============================================================

  function drawOverlay() {
    if (!octx) return;
    octx.clearRect(0, 0, overlayEl.width, overlayEl.height);

    if (!audiogramRef || !audiogramRef.enabled) return;

    const Y0 = canvas.height / 10 + borderTop;
    const deltaY0 = 0.9 * canvas.height - borderBottom - borderTop;
    const X0 = Math.floor(canvas.width / 10 + borderLeft);
    const deltaX0 = Math.floor(0.9 * canvas.width - borderLeft - borderRight);

    // Draw hearing threshold line across the spectrogram
    drawThresholdLine(X0, Y0, deltaX0, deltaY0);

    // Draw severity band indicator on the right
    drawSeverityBar(Y0, deltaY0);

    // Draw phoneme markers (speech banana)
    if (showPhonemes) {
      drawPhonemeMarkers(X0, Y0, deltaX0, deltaY0);
    }

    // Legend
    drawOverlayLegend(Y0, deltaY0);
  }

  function drawThresholdLine(X0, Y0, deltaX0, deltaY0) {
    // Draw severity-colored horizontal lines at each audiometric frequency
    octx.save();
    octx.beginPath();
    octx.rect(X0, Y0, deltaX0, deltaY0);
    octx.clip();

    for (let fi = 0; fi < AUDIO_FREQS.length; fi++) {
      const freq = AUDIO_FREQS[fi];
      if (freq < fMin || freq > fMax) continue;

      const y = freqToY(freq, Y0, deltaY0);
      const threshold = audiogramRef.ear === "both"
        ? audiogramRef.getWorstThreshold(freq)
        : audiogramRef.getThreshold(freq);
      const severity = audiogramRef.getSeverity(threshold);

      // Horizontal dashed line across spectrogram at this frequency
      octx.strokeStyle = severity.color.replace("0.35", "0.6");
      octx.lineWidth = 1;
      octx.setLineDash([4, 8]);
      octx.beginPath();
      octx.moveTo(X0, y);
      octx.lineTo(X0 + deltaX0, y);
      octx.stroke();
    }

    // Draw connected audiogram curve along left edge
    // X offset represents threshold magnitude (more loss = further right)
    octx.beginPath();
    octx.strokeStyle = "rgba(255, 255, 0, 0.8)";
    octx.lineWidth = 2.5;
    octx.setLineDash([]);

    let first = true;
    for (let fi = 0; fi < AUDIO_FREQS.length; fi++) {
      const freq = AUDIO_FREQS[fi];
      if (freq < fMin || freq > fMax) continue;

      const y = freqToY(freq, Y0, deltaY0);
      const threshold = audiogramRef.ear === "both"
        ? audiogramRef.getWorstThreshold(freq)
        : audiogramRef.getThreshold(freq);

      // Map threshold (0-120 dB HL) to x offset from left edge
      const x = X0 + (threshold / 120) * deltaX0 * 0.25;

      if (first) {
        octx.moveTo(x, y);
        first = false;
      } else {
        octx.lineTo(x, y);
      }

      // Draw marker dot at each audiometric frequency
      octx.fillStyle = "rgba(255, 255, 0, 0.9)";
      octx.beginPath();
      octx.arc(x, y, 3, 0, Math.PI * 2);
      octx.fill();
    }
    octx.stroke();
    octx.setLineDash([]);
    octx.restore();

    // Draw threshold dB labels outside clip region
    octx.save();
    const fontSize = ((canvas.width * 9 / 1000) | 0);
    octx.font = fontSize + "px sans-serif";
    octx.textAlign = "left";
    octx.textBaseline = "middle";

    for (let fi = 0; fi < AUDIO_FREQS.length; fi++) {
      const freq = AUDIO_FREQS[fi];
      if (freq < fMin || freq > fMax) continue;

      const y = freqToY(freq, Y0, deltaY0);
      const threshold = audiogramRef.ear === "both"
        ? audiogramRef.getWorstThreshold(freq)
        : audiogramRef.getThreshold(freq);

      octx.fillStyle = "rgba(255, 255, 0, 0.9)";
      octx.fillText(threshold + " dB", X0 + deltaX0 + 4, y);
    }
    octx.restore();
  }

  function drawSeverityBar(Y0, deltaY0) {
    const barX = overlayEl.width - 8;
    const barW = 6;

    // Draw severity color bands mapped to the frequency range
    for (let fi = 0; fi < AUDIO_FREQS.length; fi++) {
      const freq = AUDIO_FREQS[fi];
      if (freq < fMin || freq > fMax) continue;

      const y = freqToY(freq, Y0, deltaY0);
      const threshold = audiogramRef.ear === "both"
        ? audiogramRef.getWorstThreshold(freq)
        : audiogramRef.getThreshold(freq);
      const severity = audiogramRef.getSeverity(threshold);

      // Draw a small colored indicator
      octx.fillStyle = severity.color.replace("0.35", "0.8");
      octx.fillRect(barX, y - 4, barW, 8);
      octx.strokeStyle = "rgba(255,255,255,0.3)";
      octx.strokeRect(barX, y - 4, barW, 8);
    }
  }

  function drawPhonemeMarkers(X0, Y0, deltaX0, deltaY0) {
    octx.save();
    octx.beginPath();
    octx.rect(X0, Y0, deltaX0, deltaY0);
    octx.clip();

    const fontSize = Math.max(9, (canvas.width * 10 / 1000) | 0);
    octx.font = "bold " + fontSize + "px sans-serif";
    octx.textAlign = "center";
    octx.textBaseline = "middle";

    // Draw speech banana boundary first
    if (showBanana) {
      drawSpeechBanana(X0, Y0, deltaX0, deltaY0);
    }

    // Draw individual phoneme labels
    for (const p of PHONEME_DATA) {
      if (p.freq < fMin || p.freq > fMax) continue;

      const y = freqToY(p.freq, Y0, deltaY0);
      // Place phonemes at varying x positions within the spectrogram
      const xOffset = (hashStr(p.phoneme) % 60) / 100;
      const x = X0 + deltaX0 * (0.2 + xOffset * 0.6);

      const audible = audiogramRef.isPhonemeAudible(p);

      if (audible) {
        // Audible: bright white with green halo
        octx.fillStyle = "rgba(76, 175, 80, 0.25)";
        octx.beginPath();
        octx.arc(x, y, fontSize + 2, 0, Math.PI * 2);
        octx.fill();
        octx.fillStyle = "rgba(255, 255, 255, 0.9)";
      } else {
        // Inaudible: red with strikethrough appearance
        octx.fillStyle = "rgba(244, 67, 54, 0.3)";
        octx.beginPath();
        octx.arc(x, y, fontSize + 2, 0, Math.PI * 2);
        octx.fill();
        octx.fillStyle = "rgba(244, 67, 54, 0.9)";
      }

      octx.fillText(p.phoneme, x, y);

      if (!audible) {
        // Strikethrough for inaudible
        octx.strokeStyle = "rgba(244, 67, 54, 0.7)";
        octx.lineWidth = 1.5;
        octx.beginPath();
        const tw = octx.measureText(p.phoneme).width;
        octx.moveTo(x - tw / 2 - 2, y);
        octx.lineTo(x + tw / 2 + 2, y);
        octx.stroke();
      }
    }

    octx.restore();
  }

  function drawSpeechBanana(X0, Y0, deltaX0, deltaY0) {
    // Draw the outline of the speech banana region
    // The speech banana spans roughly 250-6000 Hz, 10-55 dB HL
    const bananaFreqs = [250, 500, 1000, 2000, 4000, 6000];
    const bananaTop = [10, 10, 10, 10, 15, 20];    // upper dB boundary
    const bananaBottom = [45, 45, 40, 35, 35, 30];  // lower dB boundary

    octx.beginPath();
    octx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    octx.fillStyle = "rgba(255, 255, 255, 0.03)";
    octx.lineWidth = 1;
    octx.setLineDash([4, 4]);

    // Build path around the banana shape
    const points = [];
    for (let i = 0; i < bananaFreqs.length; i++) {
      if (bananaFreqs[i] < fMin || bananaFreqs[i] > fMax) continue;
      points.push({ x: X0 + deltaX0 * 0.15, y: freqToY(bananaFreqs[i], Y0, deltaY0) });
    }
    for (let i = bananaFreqs.length - 1; i >= 0; i--) {
      if (bananaFreqs[i] < fMin || bananaFreqs[i] > fMax) continue;
      points.push({ x: X0 + deltaX0 * 0.85, y: freqToY(bananaFreqs[i], Y0, deltaY0) });
    }

    if (points.length > 2) {
      octx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        octx.lineTo(points[i].x, points[i].y);
      }
      octx.closePath();
      octx.fill();
      octx.stroke();
    }

    octx.setLineDash([]);
  }

  function drawOverlayLegend(Y0, deltaY0) {
    const lx = 10;
    const ly = Y0 + deltaY0 + 4;
    const fontSize = Math.max(9, (canvas.width * 8 / 1000) | 0);
    octx.font = fontSize + "px sans-serif";
    octx.textAlign = "left";
    octx.textBaseline = "top";

    const presetLabel = AUDIOGRAM_PRESETS[audiogramRef.presetName]?.label || "Custom";
    const earLabel = audiogramRef.ear === "both" ? "Both ears" : audiogramRef.ear === "left" ? "Left ear" : "Right ear";

    octx.fillStyle = "rgba(255, 255, 0, 0.8)";
    octx.fillText("Audiogram: " + presetLabel + " (" + earLabel + ")", lx, ly);

    // Severity legend
    let sx = lx + 300;
    for (const key of Object.keys(SEVERITY)) {
      const s = SEVERITY[key];
      octx.fillStyle = s.color.replace("0.35", "0.8");
      octx.fillRect(sx, ly + 1, 8, 8);
      octx.fillStyle = "rgba(200, 200, 200, 0.7)";
      octx.fillText(s.label, sx + 11, ly);
      sx += octx.measureText(s.label).width + 20;
      if (sx > canvas.width - 100) break;
    }
  }

  // ============================================================
  // Screenshot
  // ============================================================

  function takeScreenshot() {
    // Composite both canvases for screenshot
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tctx = tempCanvas.getContext("2d");
    tctx.drawImage(canvas, 0, 0);
    if (overlayEl) tctx.drawImage(overlayEl, 0, 0);

    tempCanvas.toBlob(function (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "spectrogram_" + new Date().toISOString().slice(0, 19).replace(/:/g, "-") + ".png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  // ============================================================
  // Initialize layout on construction
  // ============================================================

  applyOrientation();

  // ============================================================
  // Public API
  // ============================================================

  return {
    start: function () {
      isRunning = true;
      startTime = Date.now();
      renderFrame();
    },
    stop: function () {
      isRunning = false;
      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
    },
    pause: function () { isPaused = true; },
    resume: function () { isPaused = false; },
    setAnalyserNode: function (node) { analyserNode = node; },
    setOption: function (key, val) {
      if (key === 'colormap')     { colormap = val; plotColormap(); }
      if (key === 'fMin')         { fMin = parseFloat(val); overlayDirty = true; }
      if (key === 'fMax')         { fMax = parseFloat(val); overlayDirty = true; }
      if (key === 'sensitivity')  sensitivityOffset = parseFloat(val);
      if (key === 'showBanana')   { showBanana = val; overlayDirty = true; }
      if (key === 'showPhonemes') { showPhonemes = val; overlayDirty = true; }
      if (key === 'audiogram')    { audiogramRef = val; overlayDirty = true; }
      if (key === 'useHLMode')    { useHLMode = val; overlayDirty = true; }
      if (key === 'isLossPanel')  { isLossPanel = val; }
      if (key === 'scale')        { scale = val; overlayDirty = true; }
      if (key === 'speed')        binWidth = parseInt(val);
      if (key === 'fftSize')      fftSize = parseInt(val);
      if (key === 'windowFunc')   windowFunc = val;
      if (key === 'fftEngine')    fftEngine = val;
      if (key === 'scrolling')    scrolling = val;
      if (key === 'noiseFloor')  noiseFloor = val;
    },
    screenshot: takeScreenshot,
    resize: function () {
      applyOrientation();
    },
    markOverlayDirty: function () {
      overlayDirty = true;
    },
    get isRunning() { return isRunning; },
    get analyserNode() { return analyserNode; },
  };
}

// ============================================================
// Node.js testability
// ============================================================
if (typeof module !== 'undefined') module.exports = { createSpectrogramEngine };
