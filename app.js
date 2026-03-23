'use strict';

/* ══════════════════════════════════════════════════════════
   app.js — Hearing Loss Simulator top-level controller
   ══════════════════════════════════════════════════════════ */

// ── Module state ──────────────────────────────────────────
let audioCtx = null;
let micStream = null;

// Engines
let liveEngine   = null;
let normalEngine = null;   // Record & Compare — Normal panel
let lossEngine   = null;   // Record & Compare — With Loss panel
let wizardEngine = null;   // Mobile wizard — single A/B panel (separate from normalEngine)

// Modules
let recorder      = null;
let filterChain   = null;
let liveNF        = null;
let normalNF      = null;
let lossNF        = null;

// State
let currentTab     = 'live';
let recordedBuffer = null;

// ── Difference panel renderer state ──────────────────────
let diffAnimId = null;

// ── DOM refs ──────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dom = {
  tabs:            document.querySelectorAll('.hls-tab'),
  tabPanels:       document.querySelectorAll('.hls-tab-panel'),
  presetSelect:    $('preset-select'),
  earSelector:     $('ear-selector'),
  thresholdGrid:   $('threshold-grid'),
  severityBadge:   $('severity-badge'),
  showBanana:      $('show-banana'),
  showPhonemes:    $('show-phonemes'),
  freqMin:         $('freq-min'),
  freqMax:         $('freq-max'),
  sensitivity:     $('sensitivity'),
  micSelect:       $('mic-select'),

  canvasLive:      $('canvas-live'),
  canvasNormal:    $('canvas-normal'),
  canvasLoss:      $('canvas-loss'),
  canvasDiff:      $('canvas-diff'),

  btnRecord:       $('btn-record'),
  btnPlayNormal:   $('btn-play-normal'),
  btnPlayLoss:     $('btn-play-loss'),
  btnStop:         $('btn-stop'),
  btnStopRec:      $('btn-stop-rec'),
  recTimer:        $('rec-timer'),
  recOverlay:      $('recording-overlay'),
  comparePanels:   $('compare-panels'),
  playbackControls:$('playback-controls'),

  uploadZone:      $('upload-zone'),
  uploadInput:     $('upload-input'),
  btnUploadPick:   $('btn-upload-pick'),
};

// ── Entry point ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  audiogram.load();
  buildThresholdGrid();
  buildWizardPresetCards();
  populateMicList();

  setupTabs();
  setupAudiogramControls();
  setupRecordControls();
  setupUploadControls();
  setupWizard();
  setupKeyboard();

  await switchTab('live');
});

// ── Tab management ────────────────────────────────────────
function setupTabs() {
  dom.tabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
}

async function switchTab(tabName) {
  // Task 9 fix: stop diff renderer when leaving record tab
  if (currentTab === 'record' && tabName !== 'record') {
    stopDiffRenderer();
  }
  currentTab = tabName;

  dom.tabs.forEach(t => {
    t.classList.toggle('hls-tab--active', t.dataset.tab === tabName);
    t.setAttribute('aria-selected', t.dataset.tab === tabName);
  });
  dom.tabPanels.forEach(p => {
    p.classList.toggle('hls-tab-panel--active', p.dataset.tab === tabName);
  });

  if (tabName === 'live') {
    await startLiveMic();
  } else {
    stopLiveMic();
  }
}

// ── Live Mic mode ─────────────────────────────────────────
async function startLiveMic() {
  if (liveEngine && liveEngine.isRunning) return;

  try {
    const ctx = getAudioContext();
    const micId = dom.micSelect.value;
    const constraints = { audio: micId ? { deviceId: { exact: micId } } : true, video: false };
    micStream = await navigator.mediaDevices.getUserMedia(constraints);

    const source = ctx.createMediaStreamSource(micStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 8192;
    source.connect(analyser);
    // No connect to destination → no speaker feedback

    resizeCanvas(dom.canvasLive);
    liveNF = new NoiseFloor({ bins: analyser.frequencyBinCount, windowMs: 3000 });

    liveEngine = createSpectrogramEngine(dom.canvasLive, analyser, {
      colormap:    'inferno',
      fMin:        parseFloat(dom.freqMin.value),
      fMax:        parseFloat(dom.freqMax.value),
      sensitivity: parseFloat(dom.sensitivity.value),
      audiogram:   audiogram,
      showBanana:  dom.showBanana.checked,
      showPhonemes:dom.showPhonemes.checked,
      useHLMode:   true,
      noiseFloor:  liveNF,
    });
    liveEngine.start();

  } catch (err) {
    console.error('Microphone error:', err);
    alert('Could not access microphone. Check browser permissions.');
  }
}

function stopLiveMic() {
  if (liveEngine) { liveEngine.stop(); liveEngine = null; }
  if (micStream)  { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
}

// ── AudioContext singleton ────────────────────────────────
function getAudioContext() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext({ sampleRate: 48000 });
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// ── Canvas resize ─────────────────────────────────────────
function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width  || canvas.clientWidth  || 800;
  canvas.height = rect.height || canvas.clientHeight || 200;
}

// ── Audiogram controls ────────────────────────────────────
function setupAudiogramControls() {
  dom.presetSelect.addEventListener('change', () => {
    if (dom.presetSelect.value !== 'custom') {
      audiogram.loadPreset(dom.presetSelect.value);
    }
    updateThresholdGrid();
    onAudiogramChanged();
  });
  dom.earSelector.addEventListener('change', onAudiogramChanged);
  dom.showBanana.addEventListener('change',  updateEngineOptions);
  dom.showPhonemes.addEventListener('change',updateEngineOptions);
  dom.freqMin.addEventListener('change',     updateEngineOptions);
  dom.freqMax.addEventListener('change',     updateEngineOptions);
  dom.sensitivity.addEventListener('input',  updateEngineOptions);
}

function onAudiogramChanged() {
  audiogram.save();
  updateSeverityBadge();
  updateEngineOptions();
  rebuildFilterChain();
}

function updateEngineOptions() {
  const opts = {
    colormap:    'inferno',
    fMin:        parseFloat(dom.freqMin.value),
    fMax:        parseFloat(dom.freqMax.value),
    sensitivity: parseFloat(dom.sensitivity.value),
    audiogram:   audiogram,
    showBanana:  dom.showBanana.checked,
    showPhonemes:dom.showPhonemes.checked,
    useHLMode:   true,
  };
  for (const [k, v] of Object.entries(opts)) {
    if (liveEngine)   liveEngine.setOption(k, v);
    if (normalEngine) normalEngine.setOption(k, v);
    if (lossEngine)   lossEngine.setOption(k, v);
  }
}

function updateSeverityBadge() {
  const thresholds = getActiveThresholds();
  const avg = thresholds.reduce((s, v) => s + v, 0) / thresholds.length;
  dom.severityBadge.textContent = audiogram.getSeverity(avg);
}

function getActiveThresholds() {
  const ear = document.querySelector('input[name="ear"]:checked')?.value ?? 'both';
  return AUDIO_FREQS.map((freq, i) => {
    if (ear === 'left')  return audiogram.thresholds.left[i]  ?? 0;
    if (ear === 'right') return audiogram.thresholds.right[i] ?? 0;
    return audiogram.getWorstThreshold(freq);
  });
}

// ── Threshold grid ────────────────────────────────────────
function buildThresholdGrid() {
  const grid = dom.thresholdGrid;
  const labels = ['250', '500', '1k', '2k', '4k', '8k'];
  grid.innerHTML = '<div class="hls-threshold-grid__header"><span></span><span>L</span><span>R</span></div>';

  AUDIO_FREQS.forEach((freq, i) => {
    const label = document.createElement('span');
    label.className = 'freq-label';
    label.textContent = labels[i];

    const lInput = document.createElement('input');
    lInput.type = 'number'; lInput.min = 0; lInput.max = 120;
    lInput.id = `thr-L-${freq}`;
    lInput.value = audiogram.thresholds.left[i] ?? 0;

    const rInput = document.createElement('input');
    rInput.type = 'number'; rInput.min = 0; rInput.max = 120;
    rInput.id = `thr-R-${freq}`;
    rInput.value = audiogram.thresholds.right[i] ?? 0;

    [lInput, rInput].forEach(inp => {
      inp.addEventListener('change', () => {
        audiogram.thresholds.left[i]  = parseInt($(`thr-L-${freq}`).value, 10);
        audiogram.thresholds.right[i] = parseInt($(`thr-R-${freq}`).value, 10);
        dom.presetSelect.value = 'custom';
        onAudiogramChanged();
      });
    });

    grid.appendChild(label);
    grid.appendChild(lInput);
    grid.appendChild(rInput);
  });
}

function updateThresholdGrid() {
  AUDIO_FREQS.forEach((freq, i) => {
    const lEl = $(`thr-L-${freq}`);
    const rEl = $(`thr-R-${freq}`);
    if (lEl) lEl.value = audiogram.thresholds.left[i]  ?? 0;
    if (rEl) rEl.value = audiogram.thresholds.right[i] ?? 0;
  });
}

// ── Mic list ──────────────────────────────────────────────
async function populateMicList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    dom.micSelect.innerHTML = devices
      .filter(d => d.kind === 'audioinput')
      .map(m => `<option value="${m.deviceId}">${m.label || 'Microphone ' + m.deviceId.slice(0,6)}</option>`)
      .join('');
  } catch (err) {
    console.warn('Could not enumerate audio devices:', err);
  }
}

// ── Filter chain ──────────────────────────────────────────
async function rebuildFilterChain() {
  if (!recordedBuffer) return;
  const ctx = getAudioContext();
  if (filterChain) filterChain.disconnect();
  filterChain = await buildFilterChain(getActiveThresholds(), ctx);
  if (recorder && recordedBuffer && normalEngine && lossEngine) {
    recorder.buildPlaybackGraph(
      recordedBuffer, filterChain,
      normalEngine.analyserNode,
      lossEngine.analyserNode
    );
  }
}

// ── Record controls (desktop) ─────────────────────────────
function setupRecordControls() {
  dom.btnRecord.addEventListener('click', startDesktopRecording);
  dom.btnStopRec.addEventListener('click', stopDesktopRecording);
  dom.btnPlayNormal.addEventListener('click', () => playback('normal'));
  dom.btnPlayLoss.addEventListener('click',   () => playback('loss'));
  dom.btnStop.addEventListener('click',       () => { if (recorder) recorder.stop(); });
}

let recTimerInterval = null;
let recStartTime = 0;
let waveformAnimId = null;

async function startDesktopRecording() {
  const ctx = getAudioContext();
  const micId = dom.micSelect.value;
  const constraints = { audio: micId ? { deviceId: { exact: micId } } : true, video: false };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    alert(`Microphone access denied: ${err.message}`);
    return;
  }

  if (!recorder) recorder = new Recorder(ctx);
  await recorder.startRecording(stream);

  // Waveform visualizer during recording
  const waveSource   = ctx.createMediaStreamSource(stream);
  const waveAnalyser = ctx.createAnalyser();
  waveAnalyser.fftSize = 2048;
  waveSource.connect(waveAnalyser);

  const waveCanvas = $('canvas-waveform');
  resizeCanvas(waveCanvas);
  const waveCtx = waveCanvas.getContext('2d');
  const waveData = new Float32Array(waveAnalyser.frequencyBinCount);

  function drawWaveform() {
    waveformAnimId = requestAnimationFrame(drawWaveform);
    waveAnalyser.getFloatTimeDomainData(waveData);
    const W = waveCanvas.width, H = waveCanvas.height;
    waveCtx.fillStyle = '#0a0a0f';
    waveCtx.fillRect(0, 0, W, H);
    waveCtx.strokeStyle = '#53a8b6';
    waveCtx.lineWidth = 2;
    waveCtx.beginPath();
    const step = W / waveData.length;
    for (let i = 0; i < waveData.length; i++) {
      const x = i * step;
      const y = (waveData[i] * 0.5 + 0.5) * H;
      i === 0 ? waveCtx.moveTo(x, y) : waveCtx.lineTo(x, y);
    }
    waveCtx.stroke();
  }
  drawWaveform();

  dom.comparePanels.classList.add('hls-hidden');
  dom.recOverlay.classList.remove('hls-hidden');
  dom.playbackControls.classList.add('hls-hidden');

  recStartTime = Date.now();
  recTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - recStartTime) / 1000);
    dom.recTimer.textContent = `${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}`;
    if (elapsed >= 30) stopDesktopRecording();
  }, 250);
}

function stopWaveformVisualizer() {
  if (waveformAnimId) { cancelAnimationFrame(waveformAnimId); waveformAnimId = null; }
}

async function stopDesktopRecording() {
  clearInterval(recTimerInterval);
  stopWaveformVisualizer();
  recordedBuffer = await recorder.stopRecording();

  dom.recOverlay.classList.add('hls-hidden');
  dom.comparePanels.classList.remove('hls-hidden');
  dom.playbackControls.classList.remove('hls-hidden');

  await initCompareEngines();
  dom.btnPlayNormal.disabled = false;
  dom.btnPlayLoss.disabled   = false;
}

async function initCompareEngines() {
  const ctx = getAudioContext();
  const normalAnalyser = ctx.createAnalyser(); normalAnalyser.fftSize = 8192;
  const lossAnalyser   = ctx.createAnalyser(); lossAnalyser.fftSize   = 8192;

  resizeCanvas(dom.canvasNormal);
  resizeCanvas(dom.canvasLoss);
  resizeCanvas(dom.canvasDiff);

  normalNF = new NoiseFloor({ bins: normalAnalyser.frequencyBinCount, windowMs: 3000 });
  lossNF   = new NoiseFloor({ bins: lossAnalyser.frequencyBinCount,   windowMs: 3000 });

  if (normalEngine) normalEngine.stop();
  if (lossEngine)   lossEngine.stop();

  const commonOpts = {
    colormap:    'inferno',
    fMin:        parseFloat(dom.freqMin.value),
    fMax:        parseFloat(dom.freqMax.value),
    sensitivity: parseFloat(dom.sensitivity.value),
    audiogram:   audiogram,
    showBanana:  dom.showBanana.checked,
    showPhonemes:dom.showPhonemes.checked,
    useHLMode:   true,
  };

  normalEngine = createSpectrogramEngine(dom.canvasNormal, normalAnalyser, { ...commonOpts, noiseFloor: normalNF });
  lossEngine   = createSpectrogramEngine(dom.canvasLoss,   lossAnalyser,   { ...commonOpts, noiseFloor: lossNF, isLossPanel: true });

  if (filterChain) filterChain.disconnect();
  filterChain = await buildFilterChain(getActiveThresholds(), ctx);

  recorder.buildPlaybackGraph(recordedBuffer, filterChain, normalAnalyser, lossAnalyser);
  recorder.onPlaybackEnd = () => {
    normalEngine.stop();
    lossEngine.stop();
    stopDiffRenderer();
    dom.btnStop.disabled = true;
  };

  // Start diff renderer
  stopDiffRenderer();
  startDiffRenderer(normalAnalyser, lossAnalyser, dom.canvasDiff);
}

async function playback(mode) {
  if (!recorder || !recordedBuffer) return;
  recorder.play(mode);
  normalEngine.start();
  lossEngine.start();
  dom.btnStop.disabled = false;
}

// ── Upload controls ───────────────────────────────────────
function setupUploadControls() {
  dom.btnUploadPick.addEventListener('click', () => dom.uploadInput.click());
  dom.uploadInput.addEventListener('change', e => {
    if (e.target.files[0]) loadAudioFile(e.target.files[0]);
  });
  dom.uploadZone.addEventListener('dragover', e => {
    e.preventDefault();
    dom.uploadZone.classList.add('hls-upload-zone--drag-over');
  });
  dom.uploadZone.addEventListener('dragleave', () => {
    dom.uploadZone.classList.remove('hls-upload-zone--drag-over');
  });
  dom.uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    dom.uploadZone.classList.remove('hls-upload-zone--drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) loadAudioFile(file);
  });
}

async function loadAudioFile(file) {
  const ctx = getAudioContext();
  const arrayBuf = await file.arrayBuffer();
  recordedBuffer = await ctx.decodeAudioData(arrayBuf);

  if (!recorder) recorder = new Recorder(ctx);
  await switchTab('record');
  await initCompareEngines();
  dom.btnPlayNormal.disabled = false;
  dom.btnPlayLoss.disabled   = false;
}

// ── Difference panel renderer ─────────────────────────────
function startDiffRenderer(normalAnalyser, lossAnalyser, diffCanvas) {
  stopDiffRenderer();

  const bufSize   = normalAnalyser.frequencyBinCount;
  const rawNormal = new Float32Array(bufSize);
  const rawLoss   = new Float32Array(bufSize);

  function loop() {
    diffAnimId = requestAnimationFrame(loop);
    normalAnalyser.getFloatFrequencyData(rawNormal);
    lossAnalyser.getFloatFrequencyData(rawLoss);
    renderDiffColumn(rawNormal, rawLoss, diffCanvas);
  }
  loop();
}

function stopDiffRenderer() {
  if (diffAnimId) { cancelAnimationFrame(diffAnimId); diffAnimId = null; }
}

function renderDiffColumn(normalBins, lossBins, canvas) {
  const ctx2d  = canvas.getContext('2d');
  const W      = canvas.width;
  const H      = canvas.height;

  // Scroll left
  ctx2d.drawImage(canvas, -1, 0);

  const colData = ctx2d.createImageData(1, H);
  const pixels  = colData.data;

  const fMin     = parseFloat(dom.freqMin.value);
  const fMax     = parseFloat(dom.freqMax.value);
  const sr       = audioCtx ? audioCtx.sampleRate : 48000;
  const binCount = normalBins.length;
  const hzPerBin = (sr / 2) / binCount;

  for (let y = 0; y < H; y++) {
    const freq = diffYToFreq(y, H, fMin, fMax);
    const bin  = Math.round(freq / hzPerBin);
    if (bin < 0 || bin >= binCount) { pixels[y*4+3] = 255; continue; }

    const diff = Math.max(0, normalBins[bin] - lossBins[bin]);
    const idx  = y * 4;
    if (diff > 3) {
      const brightness = Math.min(1, diff / 60);
      pixels[idx]     = Math.round(brightness * 180);
      pixels[idx + 1] = Math.round(brightness * 40);
      pixels[idx + 2] = Math.round(brightness * 230);
    } else {
      pixels[idx] = pixels[idx+1] = pixels[idx+2] = 8;
    }
    pixels[idx + 3] = 255;
  }

  ctx2d.putImageData(colData, W - 1, 0);
}

// Mel-scale Y → frequency (same formula as spectrogram.js)
function diffYToFreq(y, H, fMin, fMax) {
  const melMin = 2595 * Math.log10(1 + fMin / 700);
  const melMax = 2595 * Math.log10(1 + fMax / 700);
  const mel    = melMax - (y / H) * (melMax - melMin);
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

// ── Mobile wizard ─────────────────────────────────────────
function buildWizardPresetCards() {
  const container = $('wizard-preset-cards');
  if (!container) return;

  const presets = [
    { value: 'normal',           label: 'Normal Hearing' },
    { value: 'mild_high_freq',   label: 'Mild High-Frequency' },
    { value: 'moderate_sloping', label: 'Moderate Sloping' },
    { value: 'severe_high_freq', label: 'Severe High-Frequency' },
    { value: 'presbycusis',      label: 'Presbycusis (Age-Related)' },
    { value: 'cookie_bite',      label: 'Cookie-Bite' },
    { value: 'noise_induced',    label: 'Noise-Induced' },
    { value: 'flat_moderate',    label: 'Flat Moderate' },
    { value: 'custom',           label: 'Custom...' },
  ];

  container.innerHTML = presets.map(p =>
    `<button class="hls-preset-card" data-preset="${p.value}">${p.label}</button>`
  ).join('');

  container.addEventListener('click', e => {
    const card = e.target.closest('.hls-preset-card');
    if (!card) return;
    container.querySelectorAll('.hls-preset-card').forEach(c => c.classList.remove('hls-preset-card--selected'));
    card.classList.add('hls-preset-card--selected');
    const val = card.dataset.preset;
    if (val !== 'custom') audiogram.loadPreset(val);
    $('wizard-custom-grid').classList.toggle('hls-hidden', val !== 'custom');
    onAudiogramChanged();
  });
}

let wizardRecorder = null;
let wizardRecTimerInterval = null;
let wizardRecording = false;

function setupWizard() {
  $('wizard-next-1')?.addEventListener('click', () => showWizardStep(2));
  $('wizard-next-2')?.addEventListener('click', () => showWizardStep(3));
  $('wizard-next-3')?.addEventListener('click', () => showWizardStep(4));
  $('wizard-rerecord')?.addEventListener('click',      () => showWizardStep(3));
  $('wizard-rerecord-link')?.addEventListener('click', () => showWizardStep(3));
  $('wizard-rec-btn')?.addEventListener('click', toggleWizardRecording);
  $('wizard-play-normal')?.addEventListener('click', () => wizardPlayback('normal'));
  $('wizard-play-loss')?.addEventListener('click',   () => wizardPlayback('loss'));
  $('wizard-done')?.addEventListener('click', wizardDone);
}

function showWizardStep(step) {
  document.querySelectorAll('.hls-wizard__step').forEach(el => {
    el.classList.toggle('hls-hidden', parseInt(el.dataset.step) !== step);
  });
}

async function toggleWizardRecording() {
  const btn   = $('wizard-rec-btn');
  const timer = $('wizard-rec-timer');
  const ctx   = getAudioContext();

  if (!wizardRecording) {
    wizardRecording = true;
    btn.classList.add('recording');
    timer.classList.remove('hls-hidden');
    $('wizard-next-3').classList.add('hls-hidden');
    $('wizard-rerecord').classList.add('hls-hidden');

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      // Reset UI state if mic access fails
      wizardRecording = false;
      btn.classList.remove('recording');
      timer.classList.add('hls-hidden');
      alert(`Microphone access denied: ${err.message}`);
      return;
    }
    if (!wizardRecorder) wizardRecorder = new Recorder(ctx);
    await wizardRecorder.startRecording(stream);

    let elapsed = 0;
    wizardRecTimerInterval = setInterval(() => {
      elapsed++;
      timer.textContent = `${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}`;
      if (elapsed >= 30) toggleWizardRecording();
    }, 1000);

  } else {
    wizardRecording = false;
    clearInterval(wizardRecTimerInterval);
    btn.classList.remove('recording');
    recordedBuffer = await wizardRecorder.stopRecording();
    $('wizard-next-3').classList.remove('hls-hidden');
    $('wizard-rerecord').classList.remove('hls-hidden');
  }
}

// Task 9 fix: always rebuild filterChain and analysers each call
async function wizardPlayback(mode) {
  if (!recordedBuffer) return;
  const ctx = getAudioContext();

  const compareCanvas = $('canvas-wizard-compare');
  resizeCanvas(compareCanvas);

  // Fresh analysers and filter chain each call (avoids orphaned gain nodes)
  const normalAnalyser = ctx.createAnalyser(); normalAnalyser.fftSize = 8192;
  const lossAnalyser   = ctx.createAnalyser(); lossAnalyser.fftSize   = 8192;

  if (filterChain) filterChain.disconnect();
  filterChain = await buildFilterChain(getActiveThresholds(), ctx);

  const activeAnalyser = mode === 'normal' ? normalAnalyser : lossAnalyser;

  if (wizardEngine) wizardEngine.stop();
  wizardEngine = createSpectrogramEngine(compareCanvas, activeAnalyser, {
    colormap:    'inferno',
    audiogram,
    showBanana:  true,
    showPhonemes:true,
    useHLMode:   true,
    isLossPanel: mode === 'loss',
  });

  if (!wizardRecorder) wizardRecorder = new Recorder(ctx);
  wizardRecorder.buildPlaybackGraph(recordedBuffer, filterChain, normalAnalyser, lossAnalyser);
  wizardRecorder.play(mode);
  wizardEngine.start();

  $('wizard-ab-label').textContent = `Playing: ${mode === 'normal' ? 'Normal' : 'With Hearing Loss'}`;
}

function wizardDone() {
  switchTab('live');
}

// ── Keyboard shortcuts ────────────────────────────────────
function setupKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (liveEngine) {
          liveEngine.isRunning ? liveEngine.pause() : liveEngine.resume();
        }
        break;
      case 'KeyS':
        if (liveEngine) liveEngine.screenshot?.();
        break;
      case 'KeyF':
        if (!document.fullscreenElement) document.documentElement.requestFullscreen();
        else document.exitFullscreen();
        break;
    }
  });
}

// ── Resize handler ────────────────────────────────────────
window.addEventListener('resize', () => {
  if (liveEngine)   resizeCanvas(dom.canvasLive);
  if (normalEngine) resizeCanvas(dom.canvasNormal);
  if (lossEngine)   resizeCanvas(dom.canvasLoss);
  resizeCanvas(dom.canvasDiff);
});
