// SELATARA HEAT — characters/animation.js  (TOON ADAPTER)
// The animation controller, rebuilt on the toon pose engine
// (toon.js). The pose tables and gaits live in SH.ToonChar now;
// this module keeps the legacy controller contract the game was
// built against, exactly as the retired mixer controller had it:
//   SH.CharAnim.create(char, opts) -> controller
//   ctl.play(name, fade, force) / setSpeed(mps) — speed-driven
//     locomotion (idle below 0.08 m/s, gaitName/walk, run, sprint,
//     timeScale = mps / refSpeed) / look(yawDeg, pitchDeg) in
//     DEGREES, clamped / setPosture({hunch, slouch, stiff})
//   / update(dt) / current() / action() -> { setEffectiveTimeScale }
// and the clips registry with userData.refSpeed that
// pedestrians.js reads for its panic-speed math.
(function (SH) {
  'use strict';

  var clips = {};
  (function buildRegistry() {
    var T = SH.ToonChar;
    Object.keys(T.POSES).forEach(function (name) {
      clips[name] = { name: name, duration: T.POSES[name].dur, userData: { loop: T.POSES[name].loop } };
    });
    Object.keys(T.GAITS).forEach(function (name) {
      var g = T.GAITS[name];
      clips[name] = { name: name, duration: g.dur, userData: { loop: true, refSpeed: g.refSpeed } };
    });
  })();

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function create(char, opts) {
    opts = opts || {};
    if (opts.idle) char.idleName = opts.idle;
    if (opts.gait) char.gaitName = opts.gait;
    var posture = opts.posture || {};
    var ctl = {
      char: char,
      posture: posture,
      _action: null,
      play: function (name, fade, force) {
        return char.play(name, fade == null ? 0.18 : Math.max(0.02, fade), force);
      },
      // speed-driven locomotion with gait sync (no foot sliding)
      setSpeed: function (mps) {
        var name, ref;
        if (mps < 0.08) { ctl.play(char.idleName || 'idle', 0.22); return ctl; }
        if (mps < 2.2) name = char.gaitName || 'walk';
        else if (mps < 3.9) name = 'run';
        else name = 'sprint';
        ref = (clips[name] && clips[name].userData.refSpeed) || 1.6;
        ctl.play(name, 0.16);
        char.setTimeScale(mps / (ref * ((char.params && char.params.H || 1.75) / 1.75)));
        return ctl;
      },
      look: function (yawDeg, pitchDeg) {
        var y = clamp(yawDeg || 0, -55, 55) * Math.PI / 180;
        var p = clamp(pitchDeg || 0, -28, 32) * Math.PI / 180;
        char.setLook(y, p);
        return ctl;
      },
      setPosture: function (p) {
        // PROPFIX: forward the WHOLE posture record (hunch,
        // slouch, stiff) — the old call forwarded only .hunch,
        // so slouch and stiff were dropped at this adapter
        // (Bos point 9).
        ctl.posture = p || {};
        return ctl;
      },
      update: function (dt) {
        char.setPosture(ctl.posture);
        char.update(dt, {});
        return ctl;
      },
      current: function () { return char.current(); },
      action: function () {
        // pedestrians.js calls action().setEffectiveTimeScale(x)
        // to stretch the panic gait; forward it to the character.
        if (!ctl._action) {
          ctl._action = { setEffectiveTimeScale: function (v) { char.setTimeScale(v); } };
        }
        return ctl._action;
      },
      finished: function () { return char.finished(); },
      time: function () { return char.poseTime(); }
    };
    char.play(opts.start || char.idleName || 'idle', 0);
    return ctl;
  }

  SH.CharAnim = { clips: clips, create: create };
})(window.SH = window.SH || {});
