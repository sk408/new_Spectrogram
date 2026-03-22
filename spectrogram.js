// ============================================================
// Live Spectrogram — Real-time Audio Visualization
// ============================================================
"use strict";

// --- Constants ---
const MEL_CONST = 1127.01048;
const BH7_COEFFS = Object.freeze([
  0.27105140069342, -0.43329793923448, 0.21812299954311,
  -0.06592544638803, 0.01081174209837, -0.00077658482522,
  0.00001388721735,
]);

// --- Canvas ---
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

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
  scrolling:         document.getElementById("scrolling"),
  stop:              document.getElementById("stop"),
  windowFunc:        document.getElementById("window"),
  fft:               document.getElementById("FFT"),
  microphone:        document.getElementById("microphone"),
  settingsPanel:     document.getElementById("settings-panel"),
  settingsToggle:    document.getElementById("settings-toggle"),
  settingsClose:     document.getElementById("settings-close"),
  fullscreenBtn:     document.getElementById("fullscreen-btn"),
  screenshotBtn:     document.getElementById("screenshot-btn"),
  infoBtn:           document.getElementById("info-btn"),
  infoModal:         document.getElementById("info-modal"),
  infoText:          document.getElementById("info-text"),
  status:            document.getElementById("status"),
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
let colormap = "hot";
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
let frecMax = 0;
let counter = 0;
let message0 = "";

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

function getFont(size) {
  return ((canvas.width * size / 1000) | 0) + "px sans-serif";
}

function setStatus(msg) {
  if (dom.status) dom.status.textContent = msg || "";
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

  select.value = "hot";
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
    }));
  } catch (_) { /* storage unavailable */ }
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
  borderLeft = canvas.width / 20;
  borderRight = canvas.width / 10;
  const scaleV = canvas.height / 760;
  borderBottom = 80 * scaleV;
  borderTop = 10 * scaleV;
  plotColormap();
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
  sensibility = parseFloat(dom.sensibility.value);
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
    // WebAudio FFT — windowing is handled internally by AnalyserNode
    for (let i = 1; i < half; i++) {
      absBuffer[i] = freqBuffer[i] + 125;
      if (absBuffer[i] > maxIntensity) maxIntensity = absBuffer[i];
    }
  }
  myXAbs = absBuffer;

  // Frequency range bin indices
  iMin = Math.floor((myXAbs.length * fMin) / fNyquist);
  iMax = Math.floor((myXAbs.length * fMax) / fNyquist);

  // Peak frequency detection
  let peakVal = -Infinity;
  let peakIdx = 0;
  for (let i = 1; i < myXAbs.length; i++) {
    if (myXAbs[i] > peakVal) {
      peakVal = myXAbs[i];
      peakIdx = i;
    }
  }
  frecMax = (peakIdx / myXAbs.length) * fNyquist;

  // Render all visualization layers
  drawPeakFrequency();
  yAxisMarks();
  plotFFT();
  plotSpectro();

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
  ctx.fillText(Math.round(frecMax) + " Hz", canvas.width / 8, centerY);
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

  // Cache scale values for the loop
  const isLinear = dom.scale.value === "Linear";
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

  // Clear FFT area
  ctx.fillStyle = "#003B5C";
  ctx.fillRect(0, Y0, fftWidth, deltaY0);

  ctx.lineWidth = 1;

  // Colored magnitude bars
  for (let i = iMin; i < iMax; i++) {
    const y = getY(i);
    const value = myXAbs[i] / sensibility;
    ctx.strokeStyle = "hsl(" + (360 * (1 - value)) + ",100%,50%)";
    ctx.beginPath();
    ctx.moveTo(fftWidth, y);
    if (myXAbs[i] > 0) {
      ctx.lineTo(-myXAbs[i] * scaleH + fftWidth, y);
    }
    ctx.stroke();
  }

  // White envelope
  ctx.beginPath();
  ctx.strokeStyle = "white";
  for (let i = iMin; i < iMax; i++) {
    const y = getY(i);
    const x = -myXAbs[i] * scaleH + fftWidth;
    if (i === iMin) {
      ctx.moveTo(fftWidth, y);
    } else if (myXAbs[i] > 0) {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  // Auto-adjust sensibility threshold
  sensibilityTemp = maxIntensity > sensibility ? maxIntensity : sensibility;
  colormapMarks();
  dom.outputSensibility.textContent = Math.floor(sensibilityTemp);
  dom.sensibility.value = Math.floor(sensibilityTemp);

  // Threshold vertical line
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

  // Draw new frequency column
  ctx.lineWidth = 1;

  for (let i = iMin; i < iMax; i++) {
    let y;
    if (isLinear) {
      y = Y0 + deltaY0 - (deltaY0 * (i - iMin)) / deltaI;
    } else {
      const freq = fMin + (deltaF * (i - iMin)) / deltaI;
      const mel = melScale(freq);
      y = Y0 + deltaY0 - (deltaY0 * (mel - melMin)) / melRange;
    }

    let value = myXAbs[i] / sensibility;
    if (value > 1) value = 1;

    const rgb = evaluate_cmap(value, colormap, false);
    ctx.strokeStyle = "rgb(" + rgb + ")";

    ctx.beginPath();
    if (isScrolling) {
      ctx.moveTo(X0 + deltaX0, y);
      ctx.lineTo(X0 + deltaX0 - binWidth, y);
    } else {
      ctx.moveTo(X0, y);
      ctx.lineTo(X0 + binWidth, y);
    }
    ctx.stroke();
  }
}

function yAxisMarks() {
  const X0 = canvas.width / 10 + borderLeft;
  const Y0 = canvas.height / 10 + borderTop;
  const deltaY0 = 0.9 * canvas.height - borderBottom - borderTop;

  // Clear axis label area
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

  // Clear label areas
  ctx.fillStyle = "white";
  ctx.fillRect(x0, 0, canvas.width - x0, Y0 + deltaY0 + 10);
  ctx.fillRect(0, canvas.height - 0.8 * borderBottom, canvas.width, 0.8 * borderBottom + 10);

  ctx.fillStyle = "black";
  ctx.font = getFont(20);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  const dB = Math.max(sensibilityTemp, maxIntensity);
  ctx.fillText(Math.floor(dB) + " dB", x0, Y0);
  ctx.fillText(Math.floor(0.75 * dB) + " dB", x0, Y0 + 0.25 * deltaY0);
  ctx.fillText(Math.floor(0.5 * dB) + " dB", x0, Y0 + 0.5 * deltaY0);
  ctx.fillText(Math.floor(0.25 * dB) + " dB", x0, Y0 + 0.75 * deltaY0);
  ctx.fillText("0 dB", x0, Y0 + deltaY0);

  ctx.fillText("Time", canvas.width / 2, canvas.height - 0.5 * borderBottom);
  ctx.fillText("Loudness (dB)", 10, canvas.height - 0.5 * borderBottom);
  ctx.fillText("Color", canvas.width - borderRight, canvas.height - 0.5 * borderBottom);
}

// ============================================================
// UI: Settings Panel, Info Modal, Screenshot, Fullscreen
// ============================================================

function toggleSettings() {
  dom.settingsPanel.classList.toggle("hidden");
}

function showInfo() {
  dom.infoText.textContent = [
    message0,
    "Screen: " + screen.width + "x" + screen.height,
    "Window: " + window.innerWidth + "x" + window.innerHeight,
    "Canvas: " + canvas.width + "x" + canvas.height,
    "FFT size: " + fftSize,
    "Bins: " + bufferLength,
  ].join("\n");
  dom.infoModal.classList.remove("hidden");
}

function hideInfo() {
  dom.infoModal.classList.add("hidden");
}

function takeScreenshot() {
  canvas.toBlob(function (blob) {
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
dom.colormap.addEventListener("change", plotColormap);

// Sensibility slider -> update display
dom.sensibility.addEventListener("input", function () {
  dom.outputSensibility.textContent = this.value;
});

// Persist settings on any control change
dom.settingsPanel.addEventListener("change", saveSettings);
dom.settingsPanel.addEventListener("input", saveSettings);

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
    case "Escape":
      if (!dom.settingsPanel.classList.contains("hidden")) toggleSettings();
      if (!dom.infoModal.classList.contains("hidden")) hideInfo();
      break;
  }
});

// Resize
window.addEventListener("resize", applyOrientation);

// ============================================================
// Initialize
// ============================================================

applyOrientation();
populateColormaps();
loadSettings();
applyOrientation(); // Re-render colormap with loaded setting
initMicrophones();
