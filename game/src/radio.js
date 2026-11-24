// SELATARA HEAT — radio.js
// A fully procedural car radio. No audio files, no samples on disk:
// three original Selatara stations are synthesised live with WebAudio —
// a lookahead scheduler walks 16th-note steps and voices a bass line,
// chord arpeggios, a soft pad and noise hats from each station's own
// key, tempo and patterns. The set only makes sound while Raka is
// driving; on foot it fades to silence like a car left behind.
// Press R to change station. The AudioContext is created lazily on the
// first user gesture, as browser autoplay rules demand.
// Public API: SH.Radio { init(), update(dt), next(), stop(),
//   station(), isPlaying() }.
(function (SH) {
  'use strict';

  // ---------------------------------------------------------------------
  // Music theory helpers. Everything is addressed in MIDI note numbers
  // and converted at voice time, so station data stays readable.
  // ---------------------------------------------------------------------

  function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // Chord-tone tables per quality: semitone offsets from the chord root
  // for the root, third, fifth and the octave colour tone.
  var CHORD_TONES = {
    min: [0, 3, 7, 12],
    maj: [0, 4, 7, 12],
    min7: [0, 3, 7, 10],
    maj7: [0, 4, 7, 11]
  };

  // ---------------------------------------------------------------------
  // Station data. prog = one chord root (semitone offset from the
  // station key root) per bar, four bars per loop. bassPat / arpPat /
  // hatPat / kickPat are one bar of 16 steps each: -1 (or 0 for the
  // drums) is a rest, anything else is a chord-tone index or a hit.
  // ---------------------------------------------------------------------

  var STATIONS = [
    {
      id: 'senja',
      name: 'Senja FM',
      freq: '91.7',
      slogan: 'Slow jams for the strait',
      bpm: 92,
      root: 45,               // A2 — the key of the whole station
      quality: 'min7',
      prog: [0, 8, 3, 10],    // Am7 — Fmaj7 — Cmaj7 — G (borrowed lift)
      progQuality: ['min7', 'maj7', 'maj7', 'maj'],
      bassPat: [0, -1, -1, -1, -1, -1, 0, -1, -1, -1, 0, -1, -1, 2, -1, -1],
      arpPat: [0, -1, 1, -1, 2, -1, 1, -1, 0, -1, 1, -1, 2, -1, 3, -1],
      hatPat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1],
      kickPat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bassWave: 'triangle',
      arpWave: 'sine',
      pad: true,
      hatLevel: 0.20,
      arpLevel: 0.16,
      bassLevel: 0.50,
      ident: [[0, 12], [4, 15], [8, 19], [12, 24]]
    },
    {
      id: 'arus',
      name: 'Arus Wave',
      freq: '98.3',
      slogan: 'Night drive, full throttle',
      bpm: 116,
      root: 43,               // G2
      quality: 'min',
      prog: [0, 0, 10, 8],    // Gm — Gm — F — Eb: the night-drive churn
      progQuality: ['min', 'min', 'maj', 'maj'],
      bassPat: [0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 2, -1],
      arpPat: [3, -1, 2, -1, 1, -1, 2, -1, 3, -1, 2, -1, 1, -1, 0, -1],
      hatPat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      kickPat: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      bassWave: 'sawtooth',
      arpWave: 'square',
      pad: false,
      hatLevel: 0.16,
      arpLevel: 0.10,
      bassLevel: 0.42,
      ident: [[0, 19], [4, 19], [8, 22], [12, 26]]
    },
    {
      id: 'kencana',
      name: 'Kencana Tropika',
      freq: '104.9',
      slogan: 'Beach road sunshine',
      bpm: 100,
      root: 48,               // C3
      quality: 'maj7',
      prog: [0, 7, 9, 5],     // Cmaj7 — G — Am7 — Fmaj7
      progQuality: ['maj7', 'maj', 'min7', 'maj7'],
      bassPat: [0, -1, -1, 0, -1, -1, 2, -1, 0, -1, -1, 0, -1, 2, -1, -1],
      arpPat: [0, 1, -1, 2, -1, 1, -1, 3, -1, 2, -1, 1, -1, 2, -1, 0],
      hatPat: [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1],
      kickPat: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      bassWave: 'sine',
      arpWave: 'triangle',
      pad: true,
      hatLevel: 0.22,
      arpLevel: 0.18,
      bassLevel: 0.46,
      ident: [[0, 24], [4, 19], [8, 16], [12, 12]]
    }
  ];

  // ---------------------------------------------------------------------
  // Audio graph + scheduler state. The context, once built, is:
  //   voices -> musicBus -> compressor -> destination
  // musicBus.gain is the one fader update() drives for the driving
  // fade; the compressor just glues the mix so peaks never clip.
  // ---------------------------------------------------------------------

  var A = {
    ctx: null,          // AudioContext, lazy
    bus: null,          // master music gain
    noiseBuf: null,     // shared white-noise buffer for hats
    timer: null,        // scheduler setInterval handle
    stationIdx: 0,
    step: 0,            // 16th-note step inside the bar (0..15)
    bar: 0,             // bar inside the 4-bar loop (0..3)
    barsPlayed: 0,      // bars since the scheduler started (ident clock)
    nextTime: 0,        // ctx time the next step is due
    started: false,     // scheduler running
    wantPlay: false,    // a station has been selected at least once
    fadedIn: false      // for the isPlaying() report
  };

  var SCHEDULE_AHEAD = 0.14;  // seconds of audio kept queued
  var TICK_MS = 42;           // scheduler wake-up interval

  function buildContext() {
    if (A.ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    A.ctx = new AC();
    A.bus = A.ctx.createGain();
    A.bus.gain.value = 0;
    var comp = A.ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 22;
    comp.ratio.value = 8;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    A.bus.connect(comp);
    comp.connect(A.ctx.destination);
    // One second of white noise, shared by every hat hit.
    var len = A.ctx.sampleRate;
    A.noiseBuf = A.ctx.createBuffer(1, len, A.ctx.sampleRate);
    var data = A.noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return true;
  }

  // ---------------------------------------------------------------------
  // Voices. Each builds its own tiny node chain, starts, stops, and is
  // garbage-collected by the browser when done — at three stations'
  // note rates that is a handful of nodes per step, well within budget.
  // ---------------------------------------------------------------------

  function voiceBass(freq, t, dur, wave, level) {
    var ctx = A.ctx;
    var osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = freq;
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 620;
    filter.Q.value = 0.6;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(filter); filter.connect(gain); gain.connect(A.bus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function voiceArp(freq, t, wave, level) {
    var ctx = A.ctx;
    var osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = freq;
    var gain = ctx.createGain();
    var dur = 0.16;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain); gain.connect(A.bus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function voicePad(freqs, t, dur, level) {
    var ctx = A.ctx;
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 880;
    filter.Q.value = 0.4;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + dur * 0.3);
    gain.gain.setValueAtTime(level, t + dur * 0.7);
    gain.gain.linearRampToValueAtTime(0, t + dur);
    filter.connect(gain); gain.connect(A.bus);
    for (var i = 0; i < freqs.length; i++) {
      var osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freqs[i];
      osc.detune.value = (i - 1) * 7; // cents: a slow chorus smear
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
  }

  function voiceHat(t, accent, level) {
    var ctx = A.ctx;
    var src = ctx.createBufferSource();
    src.buffer = A.noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    var filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7200;
    var gain = ctx.createGain();
    var peak = level * (accent ? 1.0 : 0.55);
    var dur = accent ? 0.055 : 0.03;
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter); filter.connect(gain); gain.connect(A.bus);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.02);
  }

  function voiceKick(t) {
    var ctx = A.ctx;
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(128, t);
    osc.frequency.exponentialRampToValueAtTime(41, t + 0.11);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    osc.connect(gain); gain.connect(A.bus);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  // The tuning burst between stations: a quarter-second of band-swept
  // static, the universal sound of a dial moving across the spectrum.
  function voiceStatic(t) {
    var ctx = A.ctx;
    var src = ctx.createBufferSource();
    src.buffer = A.noiseBuf;
    var filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(500, t);
    filter.frequency.exponentialRampToValueAtTime(3800, t + 0.16);
    filter.frequency.exponentialRampToValueAtTime(700, t + 0.26);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.20, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.27);
    src.connect(filter); filter.connect(gain); gain.connect(A.bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.3);
  }

  // A station ident blip: one sine note with a soft pitch settle, the
  // building block of the little jingles below.
  function voiceIdent(freq, t) {
    var ctx = A.ctx;
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.03, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.07);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.14, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    osc.connect(gain); gain.connect(A.bus);
    osc.start(t);
    osc.stop(t + 0.4);
  }


  // ---------------------------------------------------------------------
  // The scheduler. A classic lookahead loop: every TICK_MS, queue all
  // steps that fall inside the SCHEDULE_AHEAD window, stamping each
  // with its exact context time so tempo never drifts with frame rate.
  // ---------------------------------------------------------------------

  function station() { return STATIONS[A.stationIdx]; }

  function stepDuration() { return 60 / station().bpm / 4; }

  function scheduleStep(step, bar, t) {
    if (!A.wantPlay) return; // the OFF position: scheduler walks, silent
    var st = station();
    var chordRoot = st.root + st.prog[bar];
    var quality = (st.progQuality && st.progQuality[bar]) || st.quality;
    var tones = CHORD_TONES[quality] || CHORD_TONES.min;
    // Bass lives an octave under the chord root.
    var bassDeg = st.bassPat[step];
    if (bassDeg >= 0) {
      var bassMidi = chordRoot - 12 + tones[bassDeg % tones.length];
      voiceBass(midiHz(bassMidi), t, stepDuration() * 1.8, st.bassWave, st.bassLevel);
    }
    var arpDeg = st.arpPat[step];
    if (arpDeg >= 0) {
      var arpMidi = chordRoot + 12 + tones[arpDeg % tones.length];
      voiceArp(midiHz(arpMidi), t, st.arpWave, st.arpLevel);
    }
    if (st.pad && step === 0) {
      // One pad wash per bar, voiced from the chord tones themselves.
      var freqs = [];
      for (var i = 0; i < 3; i++) freqs.push(midiHz(chordRoot + tones[i]));
      voicePad(freqs, t, stepDuration() * 16, 0.05);
    }
    if (st.hatPat[step] > 0) voiceHat(t, st.hatPat[step] > 1, st.hatLevel);
    if (st.kickPat[step] > 0) voiceKick(t);
    // Station ident: on every eighth bar the station sings its little
    // four-note signature over the top of the loop, DJ-sting style.
    if (st.ident && A.barsPlayed % 8 === 7) {
      for (var n = 0; n < st.ident.length; n++) {
        if (st.ident[n][0] === step) {
          voiceIdent(midiHz(chordRoot + 24 + st.ident[n][1]), t);
        }
      }
    }
  }

  function schedulerTick() {
    if (!A.ctx) return;
    while (A.nextTime < A.ctx.currentTime + SCHEDULE_AHEAD) {
      scheduleStep(A.step, A.bar, A.nextTime);
      A.nextTime += stepDuration();
      A.step += 1;
      if (A.step >= 16) {
        A.step = 0;
        A.bar = (A.bar + 1) % station().prog.length;
        A.barsPlayed += 1;
      }
    }
  }

  function startScheduler() {
    if (A.started || !A.ctx) return;
    A.step = 0;
    A.bar = 0;
    A.nextTime = A.ctx.currentTime + 0.06;
    A.timer = window.setInterval(schedulerTick, TICK_MS);
    A.started = true;
  }

  function stopScheduler() {
    if (A.timer) window.clearInterval(A.timer);
    A.timer = null;
    A.started = false;
  }

  // ---------------------------------------------------------------------
  // Station control. The first R press (or any first gesture) builds
  // the context; after that, R simply retunes — patterns, tempo and
  // key all read from the station table at schedule time, so a switch
  // lands cleanly on the next step with no restart.
  // ---------------------------------------------------------------------

  function announce() {
    var st = station();
    if (SH.HUD) SH.HUD.notify('Radio — ' + st.name + ' ' + st.freq + ' · ' + st.slogan);
  }

  function ensureAudio() {
    if (!buildContext()) return false;
    if (A.ctx.state === 'suspended') A.ctx.resume();
    if (!A.started) startScheduler();
    return true;
  }

  // The R dial turns through OFF -> Senja -> Arus -> Kencana -> OFF.
  // Turning on starts at whichever station the dial last rested on;
  // turning off keeps the scheduler warm so the next start is instant.
  function next() {
    if (!ensureAudio()) return;
    if (A.ctx.state === 'running') voiceStatic(A.ctx.currentTime);
    if (!A.wantPlay) {
      A.wantPlay = true;
      announce();
      saveDial();
      return;
    }
    if (A.stationIdx >= STATIONS.length - 1) {
      A.wantPlay = false;
      if (SH.HUD) SH.HUD.notify('Radio — off');
      saveDial();
      return;
    }
    A.stationIdx += 1;
    announce();
    saveDial();
  }

  function stop() {
    A.wantPlay = false;
    saveDial();
    if (A.ctx && A.bus) A.bus.gain.setTargetAtTime(0, A.ctx.currentTime, 0.1);
    stopScheduler();
    if (A.ctx && A.ctx.state === 'running') A.ctx.suspend();
  }

  // ---------------------------------------------------------------------
  // Frame entry: the driving fade. The target level is binary — a car
  // radio is either in a car you are driving, or it is not — but the
  // ramp is slow, so pulling away feels like distance, not a switch.
  // ---------------------------------------------------------------------

  function update(dt) {
    if (!A.ctx || !A.bus) return;
    var st = SH.State;
    var inCar = A.wantPlay && st.mode === 'playing' && st.driving;
    var target = inCar ? 0.9 : 0.0;
    A.bus.gain.setTargetAtTime(target, A.ctx.currentTime, inCar ? 0.25 : 0.45);
    A.fadedIn = inCar;
  }

  // The dial remembers itself: station + on/off persist across
  // sessions in a private key. Sound still cannot start before a
  // gesture (browser rule) — only the dial position is restored.
  var DIAL_KEY = 'selatara-heat-radio-v1';

  function saveDial() {
    try {
      window.localStorage.setItem(DIAL_KEY, JSON.stringify({
        station: A.stationIdx, on: A.wantPlay
      }));
    } catch (e) { /* storage unavailable: the dial forgets, harmlessly */ }
  }

  function loadDial() {
    try {
      var raw = window.localStorage.getItem(DIAL_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return;
      if (Number.isFinite(data.station) && data.station >= 0 && data.station < STATIONS.length) {
        A.stationIdx = Math.floor(data.station);
      }
      A.wantPlay = data.on === true;
    } catch (e) { /* storage unavailable: default dial */ }
  }

  function init() {
    loadDial();
    // Browsers refuse audio before a gesture: the first key or click
    // anywhere builds the context (still silent until R is pressed).
    var gesture = function () {
      if (buildContext() && A.ctx.state === 'suspended') A.ctx.resume();
      window.removeEventListener('keydown', gesture);
      window.removeEventListener('pointerdown', gesture);
    };
    window.addEventListener('keydown', gesture);
    window.addEventListener('pointerdown', gesture);
    window.addEventListener('keydown', function (e) {
      if (e.code === 'KeyR') next();
    });
  }

  SH.Radio = {
    init: init,
    update: update,
    next: next,
    stop: stop,
    station: function () { return station(); },
    stations: STATIONS,
    isPlaying: function () { return !!(A.ctx && A.started && A.fadedIn); }
  };
})(window.SH = window.SH || {});
