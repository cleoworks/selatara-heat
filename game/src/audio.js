// SELATARA HEAT — audio.js
// All sound is WebAudio synthesis: engine, horn, siren, UI clicks, ambience.
// The context starts only after the first user gesture (browser policy).
// Public API: SH.Audio { init(), engine(rpm01, load), horn(), click(), setVolumes(master, music, sfx) }.
(function (SH) {
  'use strict';

  var AudioSys = {
    ctx: null, master: null, sfxGain: null, musicGain: null,
    engineOsc: null, engineFilter: null, engineGain: null,
    volumes: { master: 0.8, music: 0.6, sfx: 0.9 },

    init: function () {
      if (this.ctx) return;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volumes.master;
        this.master.connect(this.ctx.destination);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = this.volumes.sfx;
        this.sfxGain.connect(this.master);
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = this.volumes.music * 0.5;
        this.musicGain.connect(this.master);
        // Engine voice: sawtooth through a low-pass, pitch follows RPM.
        this.engineOsc = this.ctx.createOscillator();
        this.engineOsc.type = 'sawtooth';
        this.engineOsc.frequency.value = 55;
        this.engineFilter = this.ctx.createBiquadFilter();
        this.engineFilter.type = 'lowpass';
        this.engineFilter.frequency.value = 320;
        this.engineGain = this.ctx.createGain();
        this.engineGain.gain.value = 0;
        this.engineOsc.connect(this.engineFilter);
        this.engineFilter.connect(this.engineGain);
        this.engineGain.connect(this.sfxGain);
        this.engineOsc.start();
      } catch (e) { this.ctx = null; }
    },

    resume: function () { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },

    engine: function (rpm01, running) {
      if (!this.ctx) return;
      var t = this.ctx.currentTime;
      var freq = 52 + rpm01 * 165;
      this.engineOsc.frequency.setTargetAtTime(freq, t, 0.06);
      this.engineFilter.frequency.setTargetAtTime(280 + rpm01 * 900, t, 0.08);
      this.engineGain.gain.setTargetAtTime(running ? 0.05 + rpm01 * 0.06 : 0, t, 0.09);
    },

    blip: function (freq, dur, type, gain, slideTo) {
      if (!this.ctx) return;
      var t = this.ctx.currentTime;
      var o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(gain || 0.08, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.sfxGain);
      o.start(t); o.stop(t + dur + 0.02);
    },

    horn: function () { this.blip(340, 0.35, 'square', 0.05); this.blip(428, 0.35, 'square', 0.04); },
    click: function () { this.blip(880, 0.06, 'sine', 0.06, 660); },
    pickup: function () { this.blip(660, 0.09, 'sine', 0.07, 990); },
    cash: function () { this.blip(990, 0.08, 'triangle', 0.08, 1320); },

    setVolumes: function (master, music, sfx) {
      this.volumes = { master: master, music: music, sfx: sfx };
      if (!this.ctx) return;
      this.master.gain.value = master;
      this.musicGain.gain.value = music * 0.5;
      this.sfxGain.gain.value = sfx;
    }
  };

  SH.Audio = AudioSys;
})(window.SH = window.SH || {});
