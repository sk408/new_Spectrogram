'use strict';

/**
 * Recorder — wraps MediaRecorder and manages the dual-path playback graph.
 *
 * Usage:
 *   const rec = new Recorder(audioCtx);
 *   await rec.startRecording(micStream);
 *   // ...user speaks...
 *   const buffer = await rec.stopRecording();
 *
 *   rec.buildPlaybackGraph(buffer, filterChain, normalAnalyser, lossAnalyser);
 *   rec.play('normal');   // plays dry path to speakers
 *   rec.play('loss');     // plays filtered path to speakers
 *   rec.stop();
 */
class Recorder {
  constructor(audioCtx) {
    this._ctx = audioCtx;
    this._mediaRecorder = null;
    this._chunks = [];
    this._buffer = null;
    this._filterChain = null;
    this._normalAnalyser = null;
    this._lossAnalyser = null;
    this._graph = null;        // { dryGain, filterGain }
    this._sources = null;      // [srcDry, srcFilter], recreated each play()
    this._playing = false;
    this.onPlaybackEnd = null;
  }

  async startRecording(stream) {
    this._chunks = [];
    this._mediaRecorder = new MediaRecorder(stream, {
      mimeType: this._preferredMimeType(),
    });
    this._mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) this._chunks.push(e.data);
    };
    this._mediaRecorder.start(100);
  }

  stopRecording() {
    return new Promise((resolve, reject) => {
      this._mediaRecorder.onstop = async () => {
        try {
          const blob = new Blob(this._chunks, { type: this._mediaRecorder.mimeType });
          const arrayBuf = await blob.arrayBuffer();
          const audioBuf = await this._ctx.decodeAudioData(arrayBuf);
          this._buffer = audioBuf;
          resolve(audioBuf);
        } catch (err) {
          reject(err);
        }
      };
      this._mediaRecorder.stop();
    });
  }

  /**
   * Build the dual-path playback graph.
   *
   * Graph topology:
   *   srcDry    → dryGain    → normalAnalyser → destination
   *   srcFilter → filterChain.input → filterChain.output → filterGain → lossAnalyser → destination
   *
   * Both gain nodes are muted (0) until play() is called.
   * srcDry and srcFilter are recreated before each play() call.
   */
  buildPlaybackGraph(buffer, filterChain, normalAnalyser, lossAnalyser) {
    this._buffer = buffer;
    this._filterChain = filterChain;
    this._normalAnalyser = normalAnalyser;
    this._lossAnalyser = lossAnalyser;

    const dryGain = this._ctx.createGain();
    dryGain.gain.value = 0;

    const filterGain = this._ctx.createGain();
    filterGain.gain.value = 0;

    // Dry path: gain → normalAnalyser → speakers
    dryGain.connect(normalAnalyser);
    dryGain.connect(this._ctx.destination);

    // Filter path: filterChain.output → gain → lossAnalyser → speakers
    filterChain.output.connect(filterGain);
    filterGain.connect(lossAnalyser);
    filterGain.connect(this._ctx.destination);

    this._graph = { dryGain, filterGain };
  }

  /**
   * Start playback. Recreates AudioBufferSourceNodes (one-shot constraint).
   * @param {'normal'|'loss'} mode
   */
  play(mode) {
    if (!this._buffer || !this._graph) throw new Error('Call buildPlaybackGraph() first');
    this.stop();

    const ctx = this._ctx;
    const srcDry    = ctx.createBufferSource();
    const srcFilter = ctx.createBufferSource();
    srcDry.buffer    = this._buffer;
    srcFilter.buffer = this._buffer;

    srcDry.connect(this._graph.dryGain);
    srcFilter.connect(this._filterChain.input);

    this._graph.dryGain.gain.value    = mode === 'normal' ? 1 : 0;
    this._graph.filterGain.gain.value = mode === 'loss'   ? 1 : 0;

    const startTime = ctx.currentTime + 0.05;
    srcDry.start(startTime);
    srcFilter.start(startTime);

    this._sources = [srcDry, srcFilter];
    this._playing = true;

    srcDry.onended = () => {
      this._playing = false;
      if (this.onPlaybackEnd) this.onPlaybackEnd();
    };
  }

  stop() {
    if (this._sources) {
      for (const src of this._sources) {
        try { src.stop(); } catch (_) {}
        src.disconnect();
      }
      this._sources = null;
    }
    this._playing = false;
    if (this._graph) {
      this._graph.dryGain.gain.value    = 0;
      this._graph.filterGain.gain.value = 0;
    }
  }

  get isPlaying() { return this._playing; }
  get buffer()    { return this._buffer; }

  _preferredMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/webm',
      'audio/mp4',
    ];
    return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  }
}

if (typeof module !== 'undefined') module.exports = { Recorder };
