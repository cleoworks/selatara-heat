// SELATARA HEAT — audio.js
// All sound is WebAudio synthesis: engine, horn, siren, UI clicks, ambience,
// and the three-station car radio (procedural synth loops, no audio files).
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

    // Filtered noise burst: gunshots and explosions share the voice.
    noise: function (dur, freq, gain, type) {
      if (!this.ctx) return;
      var t = this.ctx.currentTime;
      var len = Math.max(1, (dur * this.ctx.sampleRate) | 0);
      var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = this.ctx.createBufferSource(); src.buffer = buf;
      var f = this.ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq;
      var g = this.ctx.createGain(); g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(this.sfxGain);
      src.start(t);
    },

    shot: function (kind) {
      if (kind === 'shotgun') { this.noise(0.28, 900, 0.5); this.blip(120, 0.16, 'triangle', 0.2, 55); }
      else if (kind === 'smg') this.noise(0.09, 2400, 0.22, 'bandpass');
      else if (kind === 'enemy') this.noise(0.11, 1500, 0.13, 'bandpass');
      else { this.noise(0.14, 1900, 0.3, 'bandpass'); this.blip(180, 0.07, 'square', 0.08, 70); }
    },
    dryFire: function () { this.blip(1400, 0.04, 'square', 0.05); },
    reload: function () { this.blip(500, 0.05, 'square', 0.06); var s = this; setTimeout(function () { s.blip(760, 0.05, 'square', 0.06); }, 160); },
    boom: function () { this.noise(0.8, 300, 0.6); this.blip(70, 0.5, 'sine', 0.3, 34); },
    hurt: function () { this.blip(220, 0.09, 'sawtooth', 0.07, 140); },

    // Police siren: two detuned oscillators with an LFO swapping pitch.
    siren: function (on) {
      if (!this.ctx) return;
      if (on && !this.sirenOsc) {
        var t = this.ctx.currentTime;
        this.sirenOsc = this.ctx.createOscillator();
        this.sirenOsc.type = 'triangle';
        this.sirenOsc.frequency.value = 820;
        this.sirenLfo = this.ctx.createOscillator();
        this.sirenLfo.type = 'square'; this.sirenLfo.frequency.value = 0.7;
        this.sirenLfoGain = this.ctx.createGain(); this.sirenLfoGain.gain.value = 160;
        this.sirenLfo.connect(this.sirenLfoGain); this.sirenLfoGain.connect(this.sirenOsc.frequency);
        this.sirenGain = this.ctx.createGain(); this.sirenGain.gain.value = 0;
        this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.sfxGain);
        this.sirenOsc.start(t); this.sirenLfo.start(t);
      }
      if (this.sirenGain) this.sirenGain.gain.setTargetAtTime(on ? 0.028 : 0, this.ctx.currentTime, 0.2);
      if (!on && this.sirenOsc) {
        var o = this.sirenOsc, l = this.sirenLfo;
        setTimeout(function () { try { o.stop(); l.stop(); } catch (e) { /* already stopped */ } }, 700);
        this.sirenOsc = null; this.sirenLfo = null;
      }
    },

    // ---- Radio: two fictional stations, tiny synth loops ----
    stations: [
      { name: 'RADIO SELATARA FM', root: 110, mode: [0, 3, 5, 7, 10], tracks: [
        { title: 'Senja di Selat', artist: 'Arus Band' },
        { title: 'Neon Pelabuhan', artist: 'Sinta Laras' },
        { title: 'Jalan Lingkar', artist: 'The Selats' },
        { title: 'Kopi Pahit Manis', artist: 'Duo Kencana' }
      ] },
      { name: 'GELOMBANG MALAM 98.2', root: 98, mode: [0, 2, 3, 7, 9], tracks: [
        { title: 'Ombak Tengah Malam', artist: 'Laras Malam' },
        { title: 'Lampu Dermaga', artist: 'Kapten Sunyi' },
        { title: 'Dansa di Atap Ruko', artist: 'Melati Sintetis' }
      ] },
      { name: 'PASAR FM 104.7', root: 87, mode: [0, 4, 5, 9, 11], tracks: [
        { title: 'Tenda Sebelah', artist: 'Bu Tini & The Stalls' },
        { title: 'Diskon Tengah Malam', artist: 'Ruko Ramai' },
        { title: 'Sate dan Sintetis', artist: 'DJ Gerobak' },
        { title: 'Antrean Panjang', artist: 'Pasar Pagi' },
        { title: 'Lampu Tenda Kuning', artist: 'Senja Elektrik' }
      ] }
    ],
    trackInfo: function () {
      var st = this.stations[this.stationIndex];
      var idx = Math.floor((SH.State ? SH.State.time : 0) / 26) % st.tracks.length;
      return { station: st.name, title: st.tracks[idx].title, artist: st.tracks[idx].artist };
    },
    stationIndex: 0, radioTimer: null, radioStep: 0,
    radio: function (on) {
      var self = this;
      if (on && !this.radioTimer && this.ctx) {
        this.radioTimer = setInterval(function () { self.radioStepPlay(); }, 240);
      } else if (!on && this.radioTimer) {
        clearInterval(this.radioTimer); this.radioTimer = null;
      }
    },
    radioStepPlay: function () {
      if (!this.ctx || !this.musicGain) return;
      var st = this.stations[this.stationIndex];
      var step = this.radioStep++;
      var t = this.ctx.currentTime;
      function tone(freq, dur, type, gain, dest) {
        var o = self0.ctx.createOscillator(), g = self0.ctx.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
      }
      var self0 = this;
      if (step % 2 === 0) tone(st.root / 2, 0.22, 'triangle', 0.16, this.musicGain);          // bass
      if (step % 4 === 2) tone(st.root, 0.18, 'square', 0.05, this.musicGain);                 // kick-ish
      var note = st.mode[(step * 2 + ((step / 8) | 0)) % st.mode.length];
      tone(st.root * Math.pow(2, note / 12) * 2, 0.2, 'sawtooth', 0.028, this.musicGain);     // arp
      if (step % 16 === 15) tone(st.root * 4, 0.3, 'sine', 0.05, this.musicGain);              // jingle ping
    },
    cycleStation: function () {
      this.stationIndex = (this.stationIndex + 1) % this.stations.length;
      return this.stations[this.stationIndex].name;
    },

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
