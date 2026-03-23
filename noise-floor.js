'use strict';

/**
 * Per-bin rolling minimum noise floor estimator.
 * Tracks the minimum dB value seen in each frequency bin over a sliding window.
 */
class NoiseFloor {
  /**
   * @param {object} opts
   * @param {number} opts.bins       Number of frequency bins
   * @param {number} opts.windowMs   Rolling window duration in milliseconds (default 3000)
   * @param {number} opts.frameMs    Expected ms between update() calls (default 16.7 = 60fps)
   */
  constructor({ bins, windowMs = 3000, frameMs = 16.7 } = {}) {
    this._bins = bins;
    this._windowMs = windowMs;
    this._frameMs = frameMs;
    this._maxFrames = Math.ceil(windowMs / frameMs);
    // Ring buffer: array of Float32Arrays
    this._ring = [];
    this._head = 0;
    this._count = 0;
    this._floor = new Float32Array(bins).fill(Infinity);
  }

  /**
   * Add a new frame of bin values and recompute the rolling floor.
   * @param {number[]|Float32Array} bins  dB values, one per bin
   */
  update(binValues) {
    const frame = new Float32Array(binValues);

    if (this._ring.length < this._maxFrames) {
      this._ring.push(frame);
    } else {
      this._ring[this._head] = frame;
    }
    this._head = (this._head + 1) % this._maxFrames;
    this._count = Math.min(this._count + 1, this._maxFrames);

    // Recompute floor: minimum across all stored frames per bin
    const bins = this._bins;
    const floor = this._floor;
    floor.fill(Infinity);
    for (let f = 0; f < this._ring.length; f++) {
      const fr = this._ring[f];
      for (let b = 0; b < bins; b++) {
        if (fr[b] < floor[b]) floor[b] = fr[b];
      }
    }
  }

  /**
   * Get the current noise floor (minimum dB per bin over the rolling window).
   * @returns {Float32Array}  Same array reference each call — do not mutate
   */
  getFloor() {
    return this._floor;
  }

  /**
   * Compute per-bin SNR: currentBins[i] - floor[i].
   * Returns a new Float32Array each call.
   * @param {number[]|Float32Array} currentBins
   * @returns {Float32Array}
   */
  getSNR(currentBins) {
    const snr = new Float32Array(this._bins);
    const floor = this._floor;
    for (let i = 0; i < this._bins; i++) {
      snr[i] = currentBins[i] - floor[i];
    }
    return snr;
  }

  /** Reset all history. */
  reset() {
    this._ring = [];
    this._head = 0;
    this._count = 0;
    this._floor.fill(Infinity);
  }
}

if (typeof module !== 'undefined') module.exports = { NoiseFloor };
