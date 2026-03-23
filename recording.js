'use strict';
// recording.js — voice recording + hearing-loss playback
//
// Globals consumed from spectrogram.js : audioCtx, analyserNode, currentStream
// Globals consumed from audiogram.js   : audiogram, AUDIO_FREQS
// Globals consumed from filter-bank.js : buildFilterChain

(function () {

  // ── State ────────────────────────────────────────────────
  let recBuffer      = null;   // AudioBuffer of captured audio
  let recChunks      = [];
  let recMediaRec    = null;
  let recInterval    = null;
  let recStartTime   = 0;

  let playSource     = null;   // active AudioBufferSourceNode
  let playGain       = null;   // GainNode for playback volume
  let playChain      = null;   // filter chain (with-loss path)

  // ── DOM ──────────────────────────────────────────────────
  const recBtn      = document.getElementById('rec-btn');
  const recStopBtn  = document.getElementById('rec-stop-btn');
  const recTimer    = document.getElementById('rec-timer');
  const playNormBtn = document.getElementById('play-normal-btn');
  const playLossBtn = document.getElementById('play-loss-btn');
  const playStopBtn = document.getElementById('play-stop-btn');
  const gainSlider  = document.getElementById('playback-gain');
  const gainOut     = document.getElementById('playback-gain-out');
  const recStatus   = document.getElementById('rec-status');

  // ── Gain display ─────────────────────────────────────────
  gainSlider.addEventListener('input', () => {
    gainOut.textContent = parseFloat(gainSlider.value).toFixed(2);
    if (playGain) playGain.gain.value = parseFloat(gainSlider.value);
  });

  // ── Record ───────────────────────────────────────────────
  recBtn.addEventListener('click', async () => {
    // Reuse the existing mic stream from spectrogram.js if available,
    // otherwise ask for a fresh one.
    let stream = (typeof currentStream !== 'undefined' && currentStream)
      ? currentStream
      : null;

    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (e) {
        alert('Microphone access denied: ' + e.message);
        return;
      }
    }

    recChunks = [];
    const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus',
                      'audio/webm', 'audio/mp4']
      .find(t => MediaRecorder.isTypeSupported(t)) || '';
    recMediaRec = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    recMediaRec.ondataavailable = e => { if (e.data.size > 0) recChunks.push(e.data); };
    recMediaRec.onstop = onRecordingComplete;
    recMediaRec.start(100);

    recStartTime = Date.now();
    recInterval  = setInterval(tickTimer, 500);

    recBtn.disabled = true;
    recBtn.classList.add('recording');
    recStopBtn.disabled = false;
    recStopBtn.classList.remove('hidden');
    recTimer.classList.remove('hidden');
    setStatus('Recording…', 'recording');
  });

  recStopBtn.addEventListener('click', stopRecording);

  function stopRecording() {
    clearInterval(recInterval);
    if (recMediaRec && recMediaRec.state !== 'inactive') recMediaRec.stop();
    recBtn.classList.remove('recording');
    recStopBtn.disabled = true;
  }

  function tickTimer() {
    const secs = Math.floor((Date.now() - recStartTime) / 1000);
    recTimer.textContent = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
    if (secs >= 30) stopRecording(); // 30-second limit
  }

  async function onRecordingComplete() {
    recTimer.classList.add('hidden');
    recTimer.textContent = '0:00';
    recStopBtn.classList.add('hidden');

    const blob = new Blob(recChunks, { type: recChunks[0]?.type || 'audio/webm' });
    const ctx  = getCtx();

    if (!ctx) {
      setStatus('Start the spectrogram mic first.', '');
      recBtn.disabled = false;
      return;
    }

    try {
      recBuffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    } catch (e) {
      setStatus('Decode error: ' + e.message, '');
      recBtn.disabled = false;
      return;
    }

    recBtn.disabled = false;
    playNormBtn.disabled = false;
    playLossBtn.disabled = false;
    setStatus('Ready — ' + recBuffer.duration.toFixed(1) + 's', 'ready');
  }

  // ── Playback ─────────────────────────────────────────────
  playNormBtn.addEventListener('click', () => play(false));
  playLossBtn.addEventListener('click', () => play(true));
  playStopBtn.addEventListener('click', stopPlay);

  async function play(withLoss) {
    if (!recBuffer) return;
    stopPlay();

    const ctx = getCtx();
    if (!ctx) { alert('AudioContext not ready — start the mic first.'); return; }

    playGain = ctx.createGain();
    playGain.gain.value = parseFloat(gainSlider.value);

    // Output: speakers + analyser (so spectrogram shows playback)
    playGain.connect(ctx.destination);
    if (typeof analyserNode !== 'undefined' && analyserNode) {
      playGain.connect(analyserNode);
    }

    playSource = ctx.createBufferSource();
    playSource.buffer = recBuffer;
    playSource.onended = onPlayEnd;

    if (withLoss) {
      const thresholds = getThresholds();
      if (playChain) { playChain.disconnect(); playChain = null; }
      playChain = await buildFilterChain(thresholds, ctx);
      playSource.connect(playChain.input);
      playChain.output.connect(playGain);
    } else {
      playSource.connect(playGain);
    }

    playSource.start();
    playStopBtn.disabled = false;
    playNormBtn.disabled = true;
    playLossBtn.disabled = true;
    setStatus(withLoss ? 'Playing with loss…' : 'Playing normal…', 'recording');
  }

  function stopPlay() {
    if (playSource) {
      try { playSource.stop(); } catch (_) {}
      playSource.disconnect();
      playSource = null;
    }
    if (playChain) { playChain.disconnect(); playChain = null; }
    if (playGain)  { playGain.disconnect();  playGain  = null; }
    playStopBtn.disabled = true;
  }

  function onPlayEnd() {
    playSource = null;
    playStopBtn.disabled = true;
    if (recBuffer) {
      playNormBtn.disabled = false;
      playLossBtn.disabled = false;
      setStatus('Ready — ' + recBuffer.duration.toFixed(1) + 's', 'ready');
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  function getCtx() {
    return (typeof audioCtx !== 'undefined' && audioCtx) ? audioCtx : null;
  }

  function getThresholds() {
    const earEl = document.getElementById('audiogram-ear');
    const ear   = earEl ? earEl.value : 'both';
    return AUDIO_FREQS.map((f, i) => {
      if (ear === 'left')  return audiogram.thresholds.left[i]  ?? 0;
      if (ear === 'right') return audiogram.thresholds.right[i] ?? 0;
      return audiogram.getWorstThreshold(f);
    });
  }

  function setStatus(text, cls) {
    recStatus.textContent = text;
    recStatus.className   = cls || '';
  }

})();
