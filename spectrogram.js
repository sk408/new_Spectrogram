// ============================================================
// Live Spectrogram — Clinical Hearing Counseling Tool
// Real-time Audio Visualization with Audiogram Overlay
// ============================================================
"use strict";

// --- Constants ---
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

// --- Canvas ---
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const overlay = document.getElementById("canvas-overlay");
const octx = overlay.getContext("2d");

// --- Cached DOM Elements ---
const dom = {
  scale:             document.getElementById("scale"),
  colormap:          document.getElementById("colormap"),
  speed:             document.getElementById("speed"),
  sizeFFT:           document.getElementById("sizeFFT"),
  fMin:              document.getElementById("f_min"),
  fMax:              document.getElementById("f_max"),
  sensibility:       document.getElementById("sensibility"),
  outputSensibility: document.getElementById("output_sensibility"),
  autoRanging:       document.getElementById("auto-ranging"),
  scrolling:         document.getElementById("scrolling"),
  stop:              document.getElementById("stop"),
  windowFunc:        document.getElementById("window"),
  fft:               document.getElementById("FFT"),
  microphone:        document.getElementById("microphone"),
  settingsPanel:     document.getElementById("settings-panel"),
  settingsToggle:    document.getElementById("settings-toggle"),
  settingsClose:     document.getElementById("settings-close"),
  fullscreenBtn:     document.getElementById("fullscreen-btn"),
  presentationBtn:   document.getElementById("presentation-btn"),
  screenshotBtn:     document.getElementById("screenshot-btn"),
  infoBtn:           document.getElementById("info-btn"),
  infoModal:         document.getElementById("info-modal"),
  infoText:          document.getElementById("info-text"),
  status:            document.getElementById("status"),
  // Level display mode
  dbMode:            document.getElementById("db-mode"),
  // Audiogram controls
  audiogramEnable:   document.getElementById("audiogram-enable"),
  audiogramPreset:   document.getElementById("audiogram-preset"),
  audiogramEar:      document.getElementById("audiogram-ear"),
  audiogramGrid:     document.getElementById("audiogram-grid"),
  showPhonemes:      document.getElementById("show-phonemes"),
};

// --- Layout ---
let borderLeft, borderRight, borderBottom, borderTop;

// --- Audio ---
let audioCtx = null;
let currentStream = null;
let animationId = null;
let analyserNode = null;

// --- Rendering State ---
let bufferLength = 0;
let fftSize = 8192;
let colormap = "inferno";
let fNyquist = 22050;
let fMin = 0;
let fMax = 9000;
let iMin = 0;
let iMax = 0;
let binWidth = 4;
let myX = [];
let myXAbs = null;
let maxIntensity = -100;
let sensibility = 60;
let sensibilityTemp = 60;
let autoRanging = true;          // expand + decay vs manual slider
const AUTO_RANGE_CAP   = 80;     // dB — anything above clips to max brightness
const AUTO_RANGE_FLOOR = 40;     // dB — minimum sensibility before decay stops
const AUTO_RANGE_DECAY = 0.998;  // per-frame multiplier (~6s to decay from cap to floor)
let frecMax = 0;
let frecMaxDisplay = "0";
let lastFreqUpdateTime = 0;
const FREQ_UPDATE_INTERVAL = 1250;
let counter = 0;
let message0 = "";
let startTime = 0;
let presentationMode = false;
let overlayDirty = true; // Flag to redraw overlay

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

function setStatus(msg) {
  if (dom.status) dom.status.textContent = msg || "";
}

// Convert frequency to Y position on the spectrogram
function freqToY(freq, Y0, deltaY0) {
  const isLinear = dom.scale.value === "Linear";
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
  const isLinear = dom.scale.value === "Linear";
  const frac = 1 - (y - Y0) / deltaY0;
  if (isLinear) {
    return fMin + frac * (fMax - fMin);
  }
  const melMin = melScale(fMin);
  const melRange = melScale(fMax) - melMin;
  return inverseMelScale(melMin + frac * melRange);
}

// ============================================================
// Colormap Dropdown Population
// ============================================================

function populateColormaps() {
  const select = dom.colormap;
  const preferred = [
    "hot", "jet", "viridis", "plasma", "inferno", "magma", "turbo",
    "bone", "cool", "copper", "gray", "afmhot", "gist_heat", "YlOrRd",
    "Spectral", "RdYlBu", "cubehelix", "ocean", "terrain",
  ];
  const allNames = Object.keys(data).filter(n => !n.endsWith("_r"));
  const rest = allNames.filter(n => !preferred.includes(n)).sort();

  select.innerHTML = "";

  const prefGroup = document.createElement("optgroup");
  prefGroup.label = "Recommended";
  for (const name of preferred) {
    if (name in data) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      prefGroup.appendChild(opt);
    }
  }
  select.appendChild(prefGroup);

  const otherGroup = document.createElement("optgroup");
  otherGroup.label = "All Colormaps";
  for (const name of rest) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    otherGroup.appendChild(opt);
  }
  select.appendChild(otherGroup);

  select.value = "inferno";
}

// ============================================================
// LocalStorage Persistence
// ============================================================

const STORAGE_KEY = "spectrogram_settings";

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      scale: dom.scale.value,
      colormap: dom.colormap.value,
      speed: dom.speed.value,
      sizeFFT: dom.sizeFFT.value,
      fMin: dom.fMin.value,
      fMax: dom.fMax.value,
      sensibility: dom.sensibility.value,
      scrolling: dom.scrolling.checked,
      windowFunc: dom.windowFunc.value,
      fft: dom.fft.value,
      dbMode: dom.dbMode.value,
    }));
  } catch (_) { /* storage unavailable */ }
  audiogram.save();
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.scale) dom.scale.value = s.scale;
    if (s.colormap) dom.colormap.value = s.colormap;
    if (s.speed) dom.speed.value = s.speed;
    if (s.sizeFFT) dom.sizeFFT.value = s.sizeFFT;
    if (s.fMin != null) dom.fMin.value = s.fMin;
    if (s.fMax != null) dom.fMax.value = s.fMax;
    if (s.sensibility != null) dom.sensibility.value = s.sensibility;
    if (s.scrolling !== undefined) dom.scrolling.checked = s.scrolling;
    if (s.windowFunc) dom.windowFunc.value = s.windowFunc;
    if (s.fft) dom.fft.value = s.fft;
    if (s.dbMode) dom.dbMode.value = s.dbMode;
    dom.outputSensibility.textContent = dom.sensibility.value;
  } catch (_) { /* ignore */ }
}

// ============================================================
// Canvas Layout
// ============================================================

function applyOrientation() {
  if (window.innerHeight > window.innerWidth) {
    canvas.width = window.innerWidth;
    canvas.height = (canvas.width * 400) / 700;
  } else {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  // Sync overlay canvas dimensions
  overlay.width = canvas.width;
  overlay.height = canvas.height;

  borderLeft = canvas.width / 20;
  borderRight = canvas.width / 10;
  const scaleV = canvas.height / 760;
  borderBottom = 80 * scaleV;
  borderTop = 10 * scaleV;
  plotColormap();
  overlayDirty = true;
}

// ============================================================
// Pause Toggle (debounced)
// ============================================================

let debounceTimer = null;

function togglePause() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    dom.stop.checked = !dom.stop.checked;
  }, 100);
}

// ============================================================
// Microphone Management
// ============================================================

async function initMicrophones() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    setStatus("enumerateDevices() not supported in this browser.");
    return;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d => d.kind === "audioinput");

    dom.microphone.innerHTML = "";
    mics.forEach((mic, i) => {
      const opt = document.createElement("option");
      opt.value = mic.deviceId;
      opt.textContent = mic.label || `Microphone ${i + 1}`;
      dom.microphone.appendChild(opt);
    });

    if (mics.length > 0) {
      selectAndStartMic(mics[0].deviceId);
    } else {
      setStatus("No microphones found.");
    }
  } catch (err) {
    setStatus("Error accessing microphones: " + err.message);
  }
}

async function selectAndStartMic(deviceId) {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("getUserMedia not supported in this browser.");
    return;
  }

  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
  }
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  try {
    currentStream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined },
    });
    setStatus("");
    startVisualization(currentStream);
  } catch (err) {
    setStatus("Microphone access denied. Click canvas or grant permission to start.");
  }
}

// ============================================================
// Audio Pipeline
// ============================================================

function startVisualization(stream) {
  if (!audioCtx) {
    audioCtx = new AudioContext({
      latencyHint: "interactive",
      sampleRate: 44100,
    });
  }

  const source = audioCtx.createMediaStreamSource(stream);
  analyserNode = audioCtx.createAnalyser();
  analyserNode.minDecibels = -40;
  source.connect(analyserNode);

  message0 = "Sampling rate: " + audioCtx.sampleRate + " Hz";
  startTime = Date.now();

  renderFrame();
}

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
// Main Render Loop
// ============================================================

function renderFrame() {
  // Read settings from cached DOM refs
  fftSize = parseInt(dom.sizeFFT.value);
  analyserNode.fftSize = fftSize;
  bufferLength = analyserNode.frequencyBinCount;
  ensureBuffers(bufferLength);

  colormap = dom.colormap.value;
  fMin = parseFloat(dom.fMin.value);
  fMax = parseFloat(dom.fMax.value);
  binWidth = parseInt(dom.speed.value);
  if (!autoRanging) sensibility = parseFloat(dom.sensibility.value);
  fNyquist = audioCtx.sampleRate / 2;

  // Acquire audio data
  analyserNode.getByteTimeDomainData(timeBuffer);
  analyserNode.getFloatFrequencyData(freqBuffer);
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

  if (dom.fft.value === "myFFT") {
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
  frecMax = calculateFundamentalFrequencyHPS(myXAbs, audioCtx.sampleRate);

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
  if (overlayDirty) {
    drawOverlay();
    overlayDirty = false;
  }

  animationId = requestAnimationFrame(renderFrame);
}

// ============================================================
// Window Functions
// ============================================================

function applyWindow(samples) {
  const n = samples.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples[i];
  mean /= n;

  const winType = dom.windowFunc.value;

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
// FFT — Cooley-Tukey Radix-2
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
// Harmonic Product Spectrum — Fundamental Frequency Detection
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

  const isLinear = dom.scale.value === "Linear";
  const isHLMode = dom.dbMode.value === "HL";
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
    const value = db / sensibility;
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

  if (autoRanging) {
    if (maxIntensity > sensibility) {
      // Signal exceeds current range: expand instantly, capped at 80 dB
      sensibility = Math.min(maxIntensity, AUTO_RANGE_CAP);
    } else {
      // Signal within range: decay slowly toward floor so display tightens over time
      sensibility = Math.max(sensibility * AUTO_RANGE_DECAY, AUTO_RANGE_FLOOR);
    }
    dom.sensibility.value = Math.round(sensibility);
    dom.outputSensibility.textContent = Math.round(sensibility);
  }
  sensibilityTemp = Math.max(maxIntensity, sensibility);
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

  const isScrolling = dom.scrolling.checked;
  const isPaused = dom.stop.checked;
  const isLinear = dom.scale.value === "Linear";
  const isHLMode = dom.dbMode.value === "HL";
  const audiogramEnabled = audiogram.enabled && dom.audiogramEnable.checked;

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

    let value = correctedDB / sensibility;
    if (value > 1) value = 1;
    if (value < 0) value = 0;

    const rgb = evaluate_cmap(value, colormap, false);
    let r = rgb[0], g = rgb[1], b = rgb[2];

    // Audiogram masking: dim pixels below patient's hearing threshold
    if (audiogramEnabled && value > 0.01) {
      if (!audiogram.isAudible(correctedDB, freq, isHLMode)) {
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

  const isLinear = dom.scale.value === "Linear";
  const ticks = isLinear
    ? [100, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500,
       6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500, 10000, 11000, 12000,
       13000, 14000, 15000, 16000, 17000, 18000, 19000, 20000]
    : [100, 200, 400, 600, 800, 1000, 2000, 3000, 4000, 5000, 6000, 7000,
       8000, 9000, 10000, 11000, 13000, 15000, 17000, 20000];

  const freqRange = fMax - fMin;
  const melMin = isLinear ? 0 : melScale(fMin);
  const melRange = isLinear ? 0 : melScale(fMax) - melMin;

  for (const freq of ticks) {
    if (freq > fMax) continue;

    let y;
    if (isLinear) {
      y = Y0 + deltaY0 - (deltaY0 * (freq - fMin)) / freqRange;
    } else {
      const mel = melScale(freq);
      y = Y0 + deltaY0 - (deltaY0 * (mel - melMin)) / melRange;
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
  const cmapName = dom.colormap.value;
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
  const unit = dom.dbMode.value === "HL" ? " dB HL" : " dB SPL";
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

  const loudnessLabel = dom.dbMode.value === "HL" ? "Loudness (dB HL)" : "Loudness (dB SPL)";
  ctx.fillText(loudnessLabel, 10, canvas.height - 0.5 * borderBottom);
  ctx.fillText("Color", canvas.width - borderRight, canvas.height - 0.5 * borderBottom);
}

// ============================================================
// Overlay Canvas — Audiogram Annotations
// ============================================================

function drawOverlay() {
  octx.clearRect(0, 0, overlay.width, overlay.height);

  if (!audiogram.enabled || !dom.audiogramEnable.checked) return;

  const Y0 = canvas.height / 10 + borderTop;
  const deltaY0 = 0.9 * canvas.height - borderBottom - borderTop;
  const X0 = Math.floor(canvas.width / 10 + borderLeft);
  const deltaX0 = Math.floor(0.9 * canvas.width - borderLeft - borderRight);

  // Draw hearing threshold line across the spectrogram
  drawThresholdLine(X0, Y0, deltaX0, deltaY0);

  // Draw severity band indicator on the right
  drawSeverityBar(Y0, deltaY0);

  // Draw phoneme markers (speech banana)
  if (dom.showPhonemes.checked) {
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
    const threshold = audiogram.ear === "both"
      ? audiogram.getWorstThreshold(freq)
      : audiogram.getThreshold(freq);
    const severity = audiogram.getSeverity(threshold);

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
    const threshold = audiogram.ear === "both"
      ? audiogram.getWorstThreshold(freq)
      : audiogram.getThreshold(freq);

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
    const threshold = audiogram.ear === "both"
      ? audiogram.getWorstThreshold(freq)
      : audiogram.getThreshold(freq);

    octx.fillStyle = "rgba(255, 255, 0, 0.9)";
    octx.fillText(threshold + " dB", X0 + deltaX0 + 4, y);
  }
  octx.restore();
}

function drawSeverityBar(Y0, deltaY0) {
  const barX = overlay.width - 8;
  const barW = 6;

  // Draw severity color bands mapped to the frequency range
  for (let fi = 0; fi < AUDIO_FREQS.length; fi++) {
    const freq = AUDIO_FREQS[fi];
    if (freq < fMin || freq > fMax) continue;

    const y = freqToY(freq, Y0, deltaY0);
    const threshold = audiogram.ear === "both"
      ? audiogram.getWorstThreshold(freq)
      : audiogram.getThreshold(freq);
    const severity = audiogram.getSeverity(threshold);

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
  drawSpeechBanana(X0, Y0, deltaX0, deltaY0);

  // Draw individual phoneme labels
  for (const p of PHONEME_DATA) {
    if (p.freq < fMin || p.freq > fMax) continue;

    const y = freqToY(p.freq, Y0, deltaY0);
    // Place phonemes at varying x positions within the spectrogram
    const xOffset = (hashStr(p.phoneme) % 60) / 100;
    const x = X0 + deltaX0 * (0.2 + xOffset * 0.6);

    const audible = audiogram.isPhonemeAudible(p);

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

  const presetLabel = AUDIOGRAM_PRESETS[audiogram.presetName]?.label || "Custom";
  const earLabel = audiogram.ear === "both" ? "Both ears" : audiogram.ear === "left" ? "Left ear" : "Right ear";

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

// Simple string hash for deterministic phoneme placement
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ============================================================
// Audiogram UI Sync
// ============================================================

function syncAudiogramFromUI() {
  const leftInputs = dom.audiogramGrid.querySelectorAll('.grid-row[data-ear="left"] input');
  const rightInputs = dom.audiogramGrid.querySelectorAll('.grid-row[data-ear="right"] input');

  leftInputs.forEach((input, i) => {
    audiogram.thresholds.left[i] = parseInt(input.value) || 0;
  });
  rightInputs.forEach((input, i) => {
    audiogram.thresholds.right[i] = parseInt(input.value) || 0;
  });

  audiogram.ear = dom.audiogramEar.value;
  audiogram.enabled = dom.audiogramEnable.checked;
  overlayDirty = true;
  audiogram.save();
}

function syncUIFromAudiogram() {
  dom.audiogramEnable.checked = audiogram.enabled;
  dom.audiogramPreset.value = audiogram.presetName;
  dom.audiogramEar.value = audiogram.ear;

  const leftInputs = dom.audiogramGrid.querySelectorAll('.grid-row[data-ear="left"] input');
  const rightInputs = dom.audiogramGrid.querySelectorAll('.grid-row[data-ear="right"] input');

  leftInputs.forEach((input, i) => {
    input.value = audiogram.thresholds.left[i];
  });
  rightInputs.forEach((input, i) => {
    input.value = audiogram.thresholds.right[i];
  });
}

// ============================================================
// Presentation Mode
// ============================================================

function togglePresentation() {
  presentationMode = !presentationMode;
  document.body.classList.toggle("presentation-mode", presentationMode);
  dom.presentationBtn.classList.toggle("active", presentationMode);

  if (presentationMode) {
    // Close settings panel if open
    if (!dom.settingsPanel.classList.contains("hidden")) {
      dom.settingsPanel.classList.add("hidden");
    }
  }
}

// ============================================================
// UI: Settings Panel, Info Modal, Screenshot, Fullscreen
// ============================================================

function toggleSettings() {
  dom.settingsPanel.classList.toggle("hidden");
}

function showInfo() {
  const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
  dom.infoText.textContent = [
    message0,
    "Screen: " + screen.width + "x" + screen.height,
    "Window: " + window.innerWidth + "x" + window.innerHeight,
    "Canvas: " + canvas.width + "x" + canvas.height,
    "FFT size: " + fftSize,
    "Bins: " + bufferLength,
    "Level display: " + (dom.dbMode.value === "HL" ? "dB HL (Hearing Level)" : "dB SPL (Sound Pressure)"),
    "Elapsed: " + Math.floor(elapsed / 60) + "m " + (elapsed % 60) + "s",
    "Audiogram: " + (audiogram.enabled ? "ON" : "OFF"),
    audiogram.enabled
      ? "  Preset: " + (AUDIOGRAM_PRESETS[audiogram.presetName]?.label || "Custom")
      : "",
  ].filter(Boolean).join("\n");
  dom.infoModal.classList.remove("hidden");
}

function hideInfo() {
  dom.infoModal.classList.add("hidden");
}

function takeScreenshot() {
  // Composite both canvases for screenshot
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  const tctx = tempCanvas.getContext("2d");
  tctx.drawImage(canvas, 0, 0);
  tctx.drawImage(overlay, 0, 0);

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

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(function () {});
  } else {
    document.exitFullscreen();
  }
}

function setDefaultWindow() {
  dom.windowFunc.value = dom.fft.value === "WebAudio" ? "None" : "BH7";
}

// ============================================================
// Event Listeners
// ============================================================

// Settings panel
dom.settingsToggle.addEventListener("click", toggleSettings);
dom.settingsClose.addEventListener("click", toggleSettings);

// Action buttons
dom.fullscreenBtn.addEventListener("click", toggleFullscreen);
dom.presentationBtn.addEventListener("click", togglePresentation);
dom.screenshotBtn.addEventListener("click", takeScreenshot);
dom.infoBtn.addEventListener("click", showInfo);
dom.infoModal.querySelector(".modal-close").addEventListener("click", hideInfo);
dom.infoModal.addEventListener("click", function (e) {
  if (e.target === dom.infoModal) hideInfo();
});

// FFT engine change -> set default window function
dom.fft.addEventListener("change", setDefaultWindow);

// Microphone selection
dom.microphone.addEventListener("change", function () {
  selectAndStartMic(this.value);
});

// Colormap change -> redraw colormap bar
dom.colormap.addEventListener("change", function () {
  plotColormap();
  overlayDirty = true;
});

// Scale change -> redraw overlay
dom.scale.addEventListener("change", function () {
  overlayDirty = true;
});

// Auto-ranging toggle
dom.autoRanging.addEventListener("change", function () {
  autoRanging = this.checked;
  if (!autoRanging) {
    // Switching to manual: seed slider with current auto value
    dom.sensibility.value = Math.round(sensibility);
    dom.outputSensibility.textContent = Math.round(sensibility);
  }
});

// Sensibility slider -> update display (manual mode only; auto mode updates it internally)
dom.sensibility.addEventListener("input", function () {
  dom.outputSensibility.textContent = this.value;
});

// dB mode change -> redraw overlay (audiogram annotations reference dB units)
dom.dbMode.addEventListener("change", function () {
  overlayDirty = true;
});

// Persist settings on any control change
dom.settingsPanel.addEventListener("change", saveSettings);
dom.settingsPanel.addEventListener("input", saveSettings);

// --- Audiogram Controls ---
dom.audiogramEnable.addEventListener("change", function () {
  audiogram.enabled = this.checked;
  overlayDirty = true;
  audiogram.save();
});

dom.audiogramPreset.addEventListener("change", function () {
  audiogram.loadPreset(this.value);
  syncUIFromAudiogram();
  overlayDirty = true;
  audiogram.save();
});

dom.audiogramEar.addEventListener("change", function () {
  audiogram.ear = this.value;
  overlayDirty = true;
  audiogram.save();
});

dom.audiogramGrid.addEventListener("input", syncAudiogramFromUI);

dom.showPhonemes.addEventListener("change", function () {
  overlayDirty = true;
});

// Freq range changes -> redraw overlay
dom.fMin.addEventListener("change", function () { overlayDirty = true; });
dom.fMax.addEventListener("change", function () { overlayDirty = true; });

// Canvas interactions — pause toggle
canvas.addEventListener("mousedown", function (e) {
  if (e.target.type !== "checkbox" && e.target.type !== "range") {
    togglePause();
  }
});

// Touch events
let touchStartTime = 0;
canvas.addEventListener("touchstart", function (e) {
  touchStartTime = Date.now();
});
canvas.addEventListener("touchend", function () {
  if (Date.now() - touchStartTime > 250) {
    togglePause();
  }
});

// Resume AudioContext on user gesture (Chrome autoplay policy)
document.addEventListener("click", function () {
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
  }
});

// Keyboard shortcuts
document.addEventListener("keydown", function (e) {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  switch (e.key) {
    case " ":
      e.preventDefault();
      togglePause();
      break;
    case "s":
      takeScreenshot();
      break;
    case "f":
      toggleFullscreen();
      break;
    case "p":
      togglePresentation();
      break;
    case "Escape":
      if (presentationMode) {
        togglePresentation();
      } else if (!dom.settingsPanel.classList.contains("hidden")) {
        toggleSettings();
      }
      if (!dom.infoModal.classList.contains("hidden")) hideInfo();
      break;
  }
});

// Resize
window.addEventListener("resize", function () {
  applyOrientation();
  overlayDirty = true;
});

// ============================================================
// Initialize
// ============================================================

populateColormaps();
loadSettings();
audiogram.load();
syncUIFromAudiogram();
applyOrientation();
initMicrophones();
