// ============================================================
// Audiogram Data Model — Hearing Threshold & Speech Mapping
// ============================================================
"use strict";

// Standard audiometric frequencies (Hz)
const AUDIO_FREQS = [250, 500, 1000, 2000, 4000, 8000];

// Hearing loss severity bands (dB HL)
const SEVERITY = Object.freeze({
  NORMAL:       { min: -10, max: 25,  label: "Normal",            color: "rgba(76,175,80,0.35)"  },
  MILD:         { min: 26,  max: 40,  label: "Mild",              color: "rgba(255,235,59,0.35)" },
  MODERATE:     { min: 41,  max: 55,  label: "Moderate",          color: "rgba(255,152,0,0.35)"  },
  MOD_SEVERE:   { min: 56,  max: 70,  label: "Moderately Severe", color: "rgba(255,87,34,0.35)"  },
  SEVERE:       { min: 71,  max: 90,  label: "Severe",            color: "rgba(244,67,54,0.35)"  },
  PROFOUND:     { min: 91,  max: 120, label: "Profound",          color: "rgba(136,14,79,0.35)"  },
});

// Preset audiogram patterns (dB HL at each standard frequency)
const AUDIOGRAM_PRESETS = {
  normal:           { label: "Normal Hearing",           left: [10,10,10,10,15,15],      right: [10,10,10,10,15,15]      },
  mild_high_freq:   { label: "Mild High-Freq Loss",     left: [10,15,20,35,40,45],      right: [10,15,20,35,40,45]      },
  moderate_sloping: { label: "Moderate Sloping",         left: [15,20,30,45,55,65],      right: [15,20,30,45,55,65]      },
  severe_high_freq: { label: "Severe High-Freq Loss",   left: [10,15,25,55,75,85],      right: [10,15,25,55,75,85]      },
  presbycusis:      { label: "Presbycusis (Age-related)",left: [15,20,25,40,60,75],      right: [15,20,25,40,60,75]      },
  cookie_bite:      { label: "Cookie Bite",              left: [15,40,55,50,35,20],      right: [15,40,55,50,35,20]      },
  noise_induced:    { label: "Noise-Induced",            left: [10,10,15,25,65,50],      right: [10,10,15,25,65,50]      },
  flat_moderate:    { label: "Flat Moderate",             left: [45,45,50,50,50,45],      right: [45,45,50,50,50,45]      },
};

// Speech phoneme positions for the "speech banana"
// freq: center frequency in Hz, dB: typical intensity in dB HL
const PHONEME_DATA = [
  // Vowels — low-to-mid frequency, higher intensity
  { phoneme: "oo", freq: 300,  dB: 40, type: "vowel" },
  { phoneme: "u",  freq: 350,  dB: 35, type: "vowel" },
  { phoneme: "o",  freq: 500,  dB: 40, type: "vowel" },
  { phoneme: "ah", freq: 700,  dB: 35, type: "vowel" },
  { phoneme: "a",  freq: 900,  dB: 30, type: "vowel" },
  { phoneme: "e",  freq: 1500, dB: 25, type: "vowel" },
  { phoneme: "i",  freq: 2000, dB: 25, type: "vowel" },
  { phoneme: "ee", freq: 2500, dB: 30, type: "vowel" },

  // Voiced consonants — mid frequency
  { phoneme: "m",  freq: 300,  dB: 25, type: "voiced" },
  { phoneme: "n",  freq: 1000, dB: 25, type: "voiced" },
  { phoneme: "ng", freq: 800,  dB: 30, type: "voiced" },
  { phoneme: "l",  freq: 1000, dB: 35, type: "voiced" },
  { phoneme: "r",  freq: 1200, dB: 30, type: "voiced" },
  { phoneme: "j",  freq: 2000, dB: 20, type: "voiced" },
  { phoneme: "z",  freq: 3000, dB: 25, type: "voiced" },
  { phoneme: "v",  freq: 1500, dB: 30, type: "voiced" },
  { phoneme: "b",  freq: 400,  dB: 20, type: "voiced" },
  { phoneme: "d",  freq: 1500, dB: 15, type: "voiced" },
  { phoneme: "g",  freq: 1500, dB: 20, type: "voiced" },

  // Unvoiced consonants — high frequency, lower intensity
  { phoneme: "p",  freq: 2000, dB: 10, type: "unvoiced" },
  { phoneme: "t",  freq: 3500, dB: 10, type: "unvoiced" },
  { phoneme: "k",  freq: 2500, dB: 15, type: "unvoiced" },
  { phoneme: "f",  freq: 4000, dB: 20, type: "unvoiced" },
  { phoneme: "th", freq: 5000, dB: 15, type: "unvoiced" },
  { phoneme: "s",  freq: 5000, dB: 20, type: "unvoiced" },
  { phoneme: "sh", freq: 3500, dB: 25, type: "unvoiced" },
  { phoneme: "h",  freq: 1500, dB: 15, type: "unvoiced" },
  { phoneme: "ch", freq: 4000, dB: 15, type: "unvoiced" },
];

// Frequency band descriptions for patient counseling
const FREQ_BAND_LABELS = {
  250:  "low vowels (m, n, oo)",
  500:  "vowels (o, ah)",
  1000: "vowels & voiced consonants",
  2000: "consonants (s, sh, p, t)",
  4000: "high consonants (f, th, s)",
  8000: "sibilants, detail",
};

// Reference Equivalent Threshold Sound Pressure Levels (ISO 389-7)
// Free-field, frontal incidence, binaural listening (MAF)
// Used to convert between dB SPL and dB HL: dB_HL = dB_SPL - RETSPL(freq)
const RETSPL_TABLE = Object.freeze([
  { freq: 20,    dB: 78.5 },
  { freq: 50,    dB: 44.0 },
  { freq: 100,   dB: 26.5 },
  { freq: 125,   dB: 22.1 },
  { freq: 250,   dB: 11.4 },
  { freq: 500,   dB: 4.4  },
  { freq: 1000,  dB: 2.4  },
  { freq: 1500,  dB: 1.7  },
  { freq: 2000,  dB: -1.3 },
  { freq: 3000,  dB: -6.0 },
  { freq: 4000,  dB: -5.4 },
  { freq: 6000,  dB: 4.3  },
  { freq: 8000,  dB: 12.4 },
  { freq: 10000, dB: 13.3 },
  { freq: 16000, dB: 46.0 },
  { freq: 20000, dB: 78.5 },
]);

// Interpolate RETSPL correction for any frequency (log-frequency interpolation)
function getRETSPL(freq) {
  const table = RETSPL_TABLE;
  if (freq <= table[0].freq) return table[0].dB;
  if (freq >= table[table.length - 1].freq) return table[table.length - 1].dB;

  for (let i = 0; i < table.length - 1; i++) {
    if (freq >= table[i].freq && freq <= table[i + 1].freq) {
      const logF  = Math.log(freq);
      const logF0 = Math.log(table[i].freq);
      const logF1 = Math.log(table[i + 1].freq);
      const t = (logF - logF0) / (logF1 - logF0);
      return table[i].dB + t * (table[i + 1].dB - table[i].dB);
    }
  }
  return 0;
}

// Audiogram state
const audiogram = {
  enabled: false,
  ear: "both",   // "left", "right", "both"
  presetName: "normal",
  thresholds: {
    left:  [10, 10, 10, 10, 15, 15],
    right: [10, 10, 10, 10, 15, 15],
  },

  // Get interpolated threshold at any frequency
  getThreshold(freq) {
    const ear = this.ear === "right" ? "right" : "left";
    const ths = this.thresholds[ear];

    if (freq <= AUDIO_FREQS[0]) return ths[0];
    if (freq >= AUDIO_FREQS[AUDIO_FREQS.length - 1]) return ths[ths.length - 1];

    for (let i = 0; i < AUDIO_FREQS.length - 1; i++) {
      if (freq >= AUDIO_FREQS[i] && freq <= AUDIO_FREQS[i + 1]) {
        const t = (freq - AUDIO_FREQS[i]) / (AUDIO_FREQS[i + 1] - AUDIO_FREQS[i]);
        return ths[i] + t * (ths[i + 1] - ths[i]);
      }
    }
    return ths[ths.length - 1];
  },

  // Get worst (higher) threshold when "both" ears selected
  getWorstThreshold(freq) {
    if (this.ear !== "both") return this.getThreshold(freq);
    const savedEar = this.ear;
    this.ear = "left";
    const l = this.getThreshold(freq);
    this.ear = "right";
    const r = this.getThreshold(freq);
    this.ear = savedEar;
    return Math.max(l, r);
  },

  // Returns true if the sound at the given level is above the patient's threshold
  // rawDB: raw FFT dB value, freq: Hz, isHLMode: whether display is in dB HL
  isAudible(rawDB, freq, isHLMode) {
    // Convert raw dB to approximate dB HL using RETSPL correction
    const dBHL = isHLMode ? rawDB : (rawDB - getRETSPL(freq));
    const threshold = this.ear === "both"
      ? this.getWorstThreshold(freq)
      : this.getThreshold(freq);
    return dBHL >= threshold;
  },

  // Check if a specific phoneme is audible
  isPhonemeAudible(phoneme) {
    const threshold = this.ear === "both"
      ? this.getWorstThreshold(phoneme.freq)
      : this.getThreshold(phoneme.freq);
    return phoneme.dB >= threshold;
  },

  // Get severity label for a threshold value
  getSeverity(dBHL) {
    for (const key of Object.keys(SEVERITY)) {
      const s = SEVERITY[key];
      if (dBHL >= s.min && dBHL <= s.max) return s;
    }
    return SEVERITY.PROFOUND;
  },

  // Load a preset
  loadPreset(name) {
    const preset = AUDIOGRAM_PRESETS[name];
    if (!preset) return;
    this.presetName = name;
    this.thresholds.left = preset.left.slice();
    this.thresholds.right = preset.right.slice();
  },

  // Save to localStorage
  save() {
    try {
      localStorage.setItem("audiogram_data", JSON.stringify({
        enabled: this.enabled,
        ear: this.ear,
        presetName: this.presetName,
        thresholds: this.thresholds,
      }));
    } catch (_) {}
  },

  // Load from localStorage
  load() {
    try {
      const raw = localStorage.getItem("audiogram_data");
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.enabled !== undefined) this.enabled = d.enabled;
      if (d.ear) this.ear = d.ear;
      if (d.presetName) this.presetName = d.presetName;
      if (d.thresholds) {
        if (d.thresholds.left) this.thresholds.left = d.thresholds.left;
        if (d.thresholds.right) this.thresholds.right = d.thresholds.right;
      }
    } catch (_) {}
  },
};
