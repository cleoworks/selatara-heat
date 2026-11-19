// SELATARA HEAT — characters/animation.js  (Character System, Stage B)
// ONE animation system for every character from the factory. All clips
// are procedural: authored as per-bone Euler deltas (degrees, relative
// to the bind pose) over a shared 22-bone skeleton, converted to
// quaternion tracks. Gaits are sampled from analytic pose functions
// shaped on the Animator's Survival Kit keys (contact / down / passing
// / up), and playback rate is locked to world speed so feet never slide.
// Public API: SH.CharAnim { clips, create(char, opts) -> controller }
// Controller: play(name, fade), setSpeed(mps), look(yawDeg, pitchDeg),
//   setPosture({hunch, slouch, stiff}), update(dt).
(function (SH) {
  'use strict';

  var D = Math.PI / 180;
  var TRACK_BONES = ['pelvis', 'spine1', 'spine2', 'neck', 'head',
    'uArmL', 'fArmL', 'handL', 'uArmR', 'fArmR', 'handR',
    'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];

  function qFromEuler(x, y, z) {
    var q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x * D, y * D, z * D, 'XYZ'));
    return q;
  }

  // keys: [{ t, p: { bone: [x,y,z] deg }, dy, dz }] — a bone not named in
  // a key holds its previous value (carry-forward), starting from zero.
  function buildClip(name, dur, keys, loop) {
    keys = keys.slice().sort(function (a, b) { return a.t - b.t; });
    if (keys[0].t > 0) keys.unshift({ t: 0, p: {} });
    if (keys[keys.length - 1].t < dur) keys.push({ t: dur, p: {} });
    var tracks = [];
    var per = {};
    var i, k, bone;
    for (i = 0; i < TRACK_BONES.length; i++) per[TRACK_BONES[i]] = { times: [], quats: [], cur: [0, 0, 0] };
    var pelv = { times: [], vals: [], curY: 0, curZ: 0, used: false };
    var bindPelvisY = null, bindPelvisZ = 0;
    for (k = 0; k < keys.length; k++) {
      var key = keys[k];
      for (i = 0; i < TRACK_BONES.length; i++) {
        bone = TRACK_BONES[i];
        if (key.p && key.p[bone]) per[bone].cur = key.p[bone];
        per[bone].times.push(key.t);
        var q = qFromEuler(per[bone].cur[0], per[bone].cur[1], per[bone].cur[2]);
        per[bone].quats.push(q.x, q.y, q.z, q.w);
      }
      if (key.dy != null) pelv.curY = key.dy;
      if (key.dz != null) pelv.curZ = key.dz;
      if (key.dy != null || key.dz != null) pelv.used = true;
      pelv.times.push(key.t); pelv.vals.push(0, pelv.curY, pelv.curZ); // x patched at bind time
    }
    for (i = 0; i < TRACK_BONES.length; i++) {
      bone = TRACK_BONES[i];
      if (per[bone].times.length)
        tracks.push(new THREE.QuaternionKeyframeTrack(bone + '.quaternion', per[bone].times, per[bone].quats));
    }
    var clip = new THREE.AnimationClip(name, dur, tracks);
    if (!clip.userData) clip.userData = {};
    clip.userData.pelv = pelv.used ? pelv : null;
    clip.userData.loop = !!loop;
    return clip;
  }

  // Pelvis.position tracks need the character's own bind height, so the
  // position track is materialised per controller from clip.userData.
  function pelvisTrack(clip, bindPos) {
    var pv = clip.userData.pelv; if (!pv) return null;
    var vals = [];
    for (var i = 0; i < pv.times.length; i++) {
      vals.push(bindPos.x, bindPos.y + pv.vals[i * 3 + 1], bindPos.z + pv.vals[i * 3 + 2]);
    }
    return new THREE.VectorKeyframeTrack('pelvis.position', pv.times, vals);
  }

  // ---- gait sampler ---------------------------------------------------------
  function gaitKeys(o) {
    var keys = [], N = 16, i;
    function bump(x) { var s = Math.sin(x); return s > 0 ? s * s : 0; }
    for (i = 0; i <= N; i++) {
      var ph = i / N, a = ph * Math.PI * 2;
      var p = {};
      function leg(off) {
        var s = Math.sin(a + off), c = Math.cos(a + off);
        return {
          thigh: -o.swing * s,
          shin: o.knee * bump(a + off + 0.9) + 4,
          // foot: level-ish carry, toe-UP roll into heel strike, only a
          // gentle plantarflexion at toe-off (no ballet point), toe
          // lifted through the swing for clearance
          foot: o.swing * s * 0.40 - o.knee * bump(a + off + 0.9) * 0.30
            - 10 * bump(a + off - 0.2) + 10 * bump(a + off - 3.2) + 2
        };
      }
      var L = leg(0), R = leg(Math.PI);
      p.thighL = [L.thigh, 0, 1.5]; p.shinL = [L.shin, 0, 0]; p.footL = [L.foot, 0, 0];
      p.thighR = [R.thigh, 0, -1.5]; p.shinR = [R.shin, 0, 0]; p.footR = [R.foot, 0, 0];
      p.uArmL = [-o.arm * Math.sin(a + Math.PI), 0, 7];
      p.uArmR = [-o.arm * Math.sin(a), 0, -7];
      p.fArmL = [-o.elbow - 5 * Math.sin(a + Math.PI), 0, 3];
      p.fArmR = [-o.elbow - 5 * Math.sin(a), 0, -3];
      p.spine1 = [o.lean * 0.5, 6.5 * Math.sin(a), 0];
      p.spine2 = [o.lean, -7.5 * Math.sin(a), 0];
      p.neck = [0, 3.2 * Math.sin(a), 0];
      p.head = [-o.lean * 0.6, 0, 0];
      p.pelvis = [0, 6.0 * Math.sin(a), 4.6 * Math.sin(a)];
      keys.push({ t: ph * o.dur, p: p, dy: -o.drop + o.bob * Math.cos(2 * a) });
    }
    return keys;
  }

  var CLIPS = {};
  function def(name, dur, keys, loop) { CLIPS[name] = buildClip(name, dur, keys, loop); }
  function gait(name, o) {
    o.dur = o.dur || 0.84;
    var clip = buildClip(name, o.dur, gaitKeys(o), true);
    var stepLen = 2 * 0.91 * Math.sin(o.swing * D);
    clip.userData.refSpeed = (2 * stepLen) / o.dur;
    CLIPS[name] = clip;
  }

  // idles
  // Iterasi 2: the base idle is a RELAXED stance, not a stiff
  // A-pose — elbows bent ~14 deg, shoulders dropped/relaxed,
  // weight carried on the LEFT leg (constant pelvis roll + the
  // right knee nearly straight, left knee softly bent), head
  // tilted a few degrees with a slow look-around drift.
  def('idle', 3.6, [
    { t: 0, p: { spine2: [1.5, 0, 0], pelvis: [0, 0, 2.4], spine1: [0, 0, -1.2], thighL: [-4, 0, 1.5], shinL: [6, 0, 0], thighR: [1, 0, -1.5], shinR: [1, 0, 0], uArmL: [0, 0, 7], uArmR: [0, 0, -7], fArmL: [-14, 0, 2], fArmR: [-14, 0, -2], neck: [0, 0, -1.5], head: [1, -7, 3] } },
    { t: 1.2, p: { spine2: [2.8, 0, 0], head: [1, 5, 3.4], pelvis: [0, 0, 2.6] }, dy: -0.004 },
    { t: 2.2, p: { spine2: [1.7, 0, 0], head: [2, 9, 2.6], pelvis: [0, 0, 2.2] }, dy: -0.002 },
    { t: 3.6, p: { spine2: [1.5, 0, 0], pelvis: [0, 0, 2.4], spine1: [0, 0, -1.2], thighL: [-4, 0, 1.5], shinL: [6, 0, 0], thighR: [1, 0, -1.5], shinR: [1, 0, 0], uArmL: [0, 0, 7], uArmR: [0, 0, -7], fArmL: [-14, 0, 2], fArmR: [-14, 0, -2], neck: [0, 0, -1.5], head: [1, -7, 3] }, dy: 0 }
  ], true);
  def('idle_phone', 3.4, [
    { t: 0, p: { uArmR: [-24, 0, -4], fArmR: [-98, 0, 0], head: [13, 0, 0], spine2: [6, 0, 0], uArmL: [0, 0, 7], fArmL: [-10, 0, 2] } },
    { t: 1.7, p: { fArmR: [-94, 0, 0], head: [14, 3, 0], spine2: [7, 0, 0] } },
    { t: 3.4, p: { uArmR: [-24, 0, -4], fArmR: [-98, 0, 0], head: [13, 0, 0], spine2: [6, 0, 0], uArmL: [0, 0, 7], fArmL: [-10, 0, 2] } }
  ], true);
  def('idle_smoke', 3.8, [
    { t: 0, p: { uArmR: [-16, 0, -5], fArmR: [-62, 0, 0], head: [2, -4, 0] } },
    { t: 1.2, p: { fArmR: [-118, 0, 0], uArmR: [-30, 0, -6], head: [-3, -4, 0] } },
    { t: 2.2, p: { fArmR: [-118, 0, 0], head: [-6, -3, 0] } },
    { t: 3.8, p: { uArmR: [-16, 0, -5], fArmR: [-62, 0, 0], head: [2, -4, 0] } }
  ], true);
  def('idle_lean', 3.0, [
    { t: 0, p: { pelvis: [0, 0, 4], spine1: [0, 0, -5], uArmL: [-6, 0, 20], fArmL: [-74, 0, 6], head: [0, 6, 4], uArmR: [0, 0, -6], fArmR: [-8, 0, -2] } },
    { t: 1.5, p: { pelvis: [0, 0, 4.8], head: [1, -5, 4.5] } },
    { t: 3.0, p: { pelvis: [0, 0, 4], spine1: [0, 0, -5], uArmL: [-6, 0, 20], fArmL: [-74, 0, 6], head: [0, 6, 4], uArmR: [0, 0, -6], fArmR: [-8, 0, -2] } }
  ], true);
  def('idle_sit', 3.0, [
    { t: 0, p: { thighL: [-88, 0, 2], thighR: [-88, 0, -2], shinL: [86, 0, 0], shinR: [86, 0, 0], footL: [-2, 0, 0], footR: [-2, 0, 0], spine2: [7, 0, 0], uArmL: [-20, 0, 6], uArmR: [-20, 0, -6], fArmL: [-24, 0, 2], fArmR: [-24, 0, -2], head: [2, -6, 0] }, dy: -0.42 },
    { t: 1.5, p: { spine2: [8.5, 0, 0], head: [3, 7, 0] }, dy: -0.42 },
    { t: 3.0, p: { thighL: [-88, 0, 2], thighR: [-88, 0, -2], shinL: [86, 0, 0], shinR: [86, 0, 0], spine2: [7, 0, 0], uArmL: [-20, 0, 6], uArmR: [-20, 0, -6], fArmL: [-24, 0, 2], fArmR: [-24, 0, -2], head: [2, -6, 0] }, dy: -0.42 }
  ], true);

  // gaits (refSpeed computed from stride geometry)
  gait('walk', { swing: 23, knee: 44, arm: 27, elbow: 15, lean: 5, bob: 0.013, drop: 0.020, dur: 0.90 });
  gait('run', { swing: 37, knee: 62, arm: 38, elbow: 52, lean: 9, bob: 0.028, drop: 0.026, dur: 0.66 });
  gait('sprint', { swing: 46, knee: 76, arm: 46, elbow: 62, lean: 13, bob: 0.034, drop: 0.030, dur: 0.58 });
  gait('panic', { swing: 40, knee: 64, arm: 12, elbow: 68, lean: 10, bob: 0.030, drop: 0.028, dur: 0.62 });
  gait('walk_old', { swing: 15, knee: 24, arm: 10, elbow: 16, lean: 9, bob: 0.008, drop: 0.016, dur: 1.05 });

  // actions
  def('jump', 0.55, [
    { t: 0, p: { thighL: [-46, 0, 2], thighR: [-46, 0, -2], shinL: [64, 0, 0], shinR: [64, 0, 0], spine2: [14, 0, 0], uArmL: [18, 0, 10], uArmR: [18, 0, -10] }, dy: -0.16 },
    { t: 0.22, p: { thighL: [6, 0, 2], thighR: [10, 0, -2], shinL: [10, 0, 0], shinR: [16, 0, 0], spine2: [-3, 0, 0], uArmL: [-58, 0, 14], uArmR: [-58, 0, -14] }, dy: 0.05 },
    { t: 0.55, p: { thighL: [-14, 0, 2], thighR: [-8, 0, -2], shinL: [22, 0, 0], shinR: [14, 0, 0], spine2: [5, 0, 0], uArmL: [-20, 0, 10], uArmR: [-20, 0, -10] }, dy: -0.02 }
  ], false);
  def('fall', 0.8, [
    { t: 0, p: { thighL: [-20, 0, 3], thighR: [12, 0, -3], shinL: [14, 0, 0], shinR: [8, 0, 0], spine2: [-7, 0, 0], uArmL: [-120, 0, 30], uArmR: [-60, 0, -34], head: [-8, 0, 0] } },
    { t: 0.4, p: { uArmL: [-70, 0, 38], uArmR: [-130, 0, -26] } },
    { t: 0.8, p: { thighL: [-20, 0, 3], thighR: [12, 0, -3], shinL: [14, 0, 0], shinR: [8, 0, 0], spine2: [-7, 0, 0], uArmL: [-120, 0, 30], uArmR: [-60, 0, -34], head: [-8, 0, 0] } }
  ], true);
  def('land', 0.38, [
    { t: 0, p: { thighL: [-52, 0, 3], thighR: [-52, 0, -3], shinL: [72, 0, 0], shinR: [72, 0, 0], spine2: [16, 0, 0], uArmL: [-30, 0, 16], uArmR: [-30, 0, -16] }, dy: -0.20 },
    { t: 0.38, p: { thighL: [0, 0, 1], thighR: [0, 0, -1], shinL: [2, 0, 0], shinR: [2, 0, 0], spine2: [2, 0, 0], uArmL: [0, 0, 6], uArmR: [0, 0, -6] }, dy: 0 }
  ], false);
  def('aim_pistol', 1.6, [
    { t: 0, p: { uArmR: [-84, 0, -3], fArmR: [-7, 0, 0], uArmL: [-52, 0, 10], fArmL: [-58, 0, 8], spine2: [2, -9, 0], head: [0, 4, 0] } },
    { t: 1.6, p: { uArmR: [-84, 0, -3], fArmR: [-7, 0, 0], uArmL: [-52, 0, 10], fArmL: [-58, 0, 8], spine2: [2, -9, 0], head: [0, 4, 0] } }
  ], true);
  def('aim_rifle', 1.6, [
    { t: 0, p: { uArmR: [-78, 0, -6], fArmR: [-20, 0, 0], uArmL: [-70, -12, 6], fArmL: [-40, 0, 10], spine2: [3, -11, 0], head: [4, 5, 0] } },
    { t: 1.6, p: { uArmR: [-78, 0, -6], fArmR: [-20, 0, 0], uArmL: [-70, -12, 6], fArmL: [-40, 0, 10], spine2: [3, -11, 0], head: [4, 5, 0] } }
  ], true);
  def('shoot_pistol', 0.24, [
    { t: 0, p: { uArmR: [-84, 0, -3], fArmR: [-7, 0, 0], spine2: [2, -9, 0] } },
    { t: 0.05, p: { uArmR: [-97, 0, -3], fArmR: [-3, 0, 0], spine2: [-1, -10, 0], head: [-3, 4, 0] } },
    { t: 0.24, p: { uArmR: [-84, 0, -3], fArmR: [-7, 0, 0], spine2: [2, -9, 0], head: [0, 4, 0] } }
  ], false);
  def('reload', 1.15, [
    { t: 0, p: { uArmR: [-60, 0, -4], fArmR: [-38, 0, 0], head: [13, 0, 0], spine2: [6, -4, 0] } },
    { t: 0.4, p: { uArmR: [-46, 0, -4], fArmR: [-52, 0, 0], uArmL: [-48, 0, 12], fArmL: [-82, 0, 10], head: [15, -3, 0] } },
    { t: 0.75, p: { uArmL: [-40, 0, 12], fArmL: [-70, 0, 10], head: [12, 0, 0] } },
    { t: 1.15, p: { uArmR: [-84, 0, -3], fArmR: [-7, 0, 0], uArmL: [-52, 0, 10], fArmL: [-58, 0, 8], head: [0, 4, 0], spine2: [2, -9, 0] } }
  ], false);
  def('melee_l', 0.46, [
    { t: 0, p: { spine2: [0, 16, 0], uArmL: [24, 0, 12], fArmL: [-30, 0, 0] } },
    { t: 0.16, p: { spine2: [4, -24, 0], uArmL: [-96, 0, 4], fArmL: [-12, 0, 0], spine1: [7, -8, 0] } },
    { t: 0.46, p: { spine2: [1, 0, 0], uArmL: [0, 0, 6], fArmL: [-8, 0, 2], spine1: [1, 0, 0] } }
  ], false);
  def('melee_r', 0.46, [
    { t: 0, p: { spine2: [0, -16, 0], uArmR: [24, 0, -12], fArmR: [-30, 0, 0] } },
    { t: 0.16, p: { spine2: [4, 24, 0], uArmR: [-96, 0, -4], fArmR: [-12, 0, 0], spine1: [7, 8, 0] } },
    { t: 0.46, p: { spine2: [1, 0, 0], uArmR: [0, 0, -6], fArmR: [-8, 0, -2], spine1: [1, 0, 0] } }
  ], false);
  def('melee_bat', 0.62, [
    { t: 0, p: { uArmR: [38, 0, -14], fArmR: [-34, 0, 0], uArmL: [30, 0, 12], fArmL: [-40, 0, 6], spine2: [-6, -14, 0], head: [-4, 0, 0] } },
    { t: 0.30, p: { uArmR: [-112, 0, -6], fArmR: [-8, 0, 0], uArmL: [-88, 0, 4], fArmL: [-16, 0, 4], spine2: [17, 16, 0], spine1: [9, 6, 0] }, dy: -0.05 },
    { t: 0.62, p: { uArmR: [0, 0, -6], fArmR: [-8, 0, 0], uArmL: [0, 0, 6], fArmL: [-8, 0, 2], spine2: [2, 0, 0], spine1: [1, 0, 0] }, dy: 0 }
  ], false);
  function hitClip(name, s1, hd) {
    def(name, 0.42, [
      { t: 0, p: { spine1: s1, head: hd, uArmL: [-24, 0, 18], uArmR: [-24, 0, -18] }, dy: -0.025 },
      { t: 0.42, p: { spine1: [1, 0, 0], head: [0, 0, 0], uArmL: [0, 0, 6], uArmR: [0, 0, -6] }, dy: 0 }
    ], false);
  }
  hitClip('hit_front', [-15, 0, 0], [-12, 0, 0]);
  hitClip('hit_back', [16, 0, 0], [13, 0, 0]);
  hitClip('hit_left', [0, 0, 13], [0, 0, 10]);
  hitClip('hit_right', [0, 0, -13], [0, 0, -10]);
  def('stagger', 0.85, [
    { t: 0, p: { pelvis: [0, 0, 7], thighL: [-8, 0, 7], thighR: [6, 0, -7], uArmL: [-14, 0, 32], uArmR: [-10, 0, -30], head: [4, 0, 6], spine1: [4, 0, 4] }, dy: -0.03 },
    { t: 0.42, p: { pelvis: [0, 0, -6], thighL: [5, 0, 6], thighR: [-9, 0, -6], uArmL: [-8, 0, 26], uArmR: [-16, 0, -24], head: [3, 0, -5] }, dy: -0.045 },
    { t: 0.85, p: { pelvis: [0, 0, 0], thighL: [0, 0, 2], thighR: [0, 0, -2], uArmL: [0, 0, 6], uArmR: [0, 0, -6], head: [0, 0, 0], spine1: [1, 0, 0] }, dy: 0 }
  ], false);
  def('death', 0.95, [
    { t: 0, p: { spine1: [-6, 0, 0], uArmL: [-30, 0, 20], uArmR: [-24, 0, -22] }, dy: -0.05 },
    { t: 0.45, p: { pelvis: [52, 0, 0], spine1: [-24, 0, 0], spine2: [-14, 0, 0], thighL: [-24, 0, 4], thighR: [-12, 0, -4], shinL: [20, 0, 0], shinR: [10, 0, 0], uArmL: [-40, 0, 44], uArmR: [14, 0, -40], head: [-16, 0, 0] }, dy: -0.52, dz: -0.22 },
    { t: 0.95, p: { pelvis: [74, 0, 0], spine1: [-20, 0, 0], spine2: [-10, 0, 0], thighL: [-18, 0, 4], thighR: [-8, 0, -4], shinL: [14, 0, 0], shinR: [8, 0, 0], uArmL: [-30, 0, 52], uArmR: [20, 0, -48], head: [-12, 0, 0] }, dy: -0.78, dz: -0.34 }
  ], false);
  def('enter_car', 0.8, [
    { t: 0, p: { thighR: [-38, 0, -3], shinR: [30, 0, 0], spine2: [4, -14, 0], uArmR: [-30, 0, -8], fArmR: [-30, 0, 0] } },
    { t: 0.45, p: { thighL: [-80, 0, 3], thighR: [-82, 0, -3], shinL: [76, 0, 0], shinR: [78, 0, 0], spine2: [7, -6, 0], uArmL: [-34, 0, 6], uArmR: [-34, 0, -6], fArmL: [-26, 0, 2], fArmR: [-26, 0, -2] }, dy: -0.40 },
    { t: 0.8, p: { thighL: [-84, 0, 3], thighR: [-84, 0, -3], shinL: [80, 0, 0], shinR: [80, 0, 0], spine2: [6, 0, 0], uArmL: [-38, 0, 6], uArmR: [-38, 0, -6], fArmL: [-28, 0, 2], fArmR: [-28, 0, -2], head: [0, 0, 0] }, dy: -0.42 }
  ], false);
  def('exit_car', 0.75, [
    { t: 0, p: { thighL: [-84, 0, 3], thighR: [-84, 0, -3], shinL: [80, 0, 0], shinR: [80, 0, 0], spine2: [6, 0, 0], uArmL: [-38, 0, 6], uArmR: [-38, 0, -6], fArmL: [-28, 0, 2], fArmR: [-28, 0, -2] }, dy: -0.42 },
    { t: 0.4, p: { thighL: [-60, 0, 4], thighR: [-20, 0, -4], shinL: [52, 0, 0], shinR: [8, 0, 0], spine2: [8, 12, 0], uArmL: [-24, 0, 8], uArmR: [-44, 0, -10], fArmR: [-36, 0, 0] }, dy: -0.20 },
    { t: 0.75, p: { thighL: [0, 0, 1], thighR: [0, 0, -1], shinL: [2, 0, 0], shinR: [2, 0, 0], spine2: [2, 0, 0], uArmL: [0, 0, 6], uArmR: [0, 0, -6], fArmL: [-8, 0, 2], fArmR: [-8, 0, -2] }, dy: 0 }
  ], false);
  def('drive', 4.0, [
    { t: 0, p: { thighL: [-84, 0, 3], thighR: [-84, 0, -3], shinL: [80, 0, 0], shinR: [80, 0, 0], spine2: [6, 0, 0], uArmL: [-38, 0, 6], uArmR: [-38, 0, -6], fArmL: [-28, 0, 2], fArmR: [-28, 0, -2], head: [0, -12, 0] }, dy: -0.42 },
    { t: 1.4, p: { head: [0, 10, 0], spine2: [6.8, 0, 0] }, dy: -0.42 },
    { t: 2.6, p: { head: [1, 2, 0] }, dy: -0.42 },
    { t: 4.0, p: { thighL: [-84, 0, 3], thighR: [-84, 0, -3], shinL: [80, 0, 0], shinR: [80, 0, 0], spine2: [6, 0, 0], uArmL: [-38, 0, 6], uArmR: [-38, 0, -6], fArmL: [-28, 0, 2], fArmR: [-28, 0, -2], head: [0, -12, 0] }, dy: -0.42 }
  ], true);
  def('hands_up', 1.8, [
    { t: 0, p: { uArmL: [-6, 0, 152], uArmR: [-6, 0, -152], fArmL: [-12, 0, 6], fArmR: [-12, 0, -6], head: [-4, 0, 0], spine2: [1, 0, 0] } },
    { t: 0.9, p: { uArmL: [-4, 0, 150], uArmR: [-4, 0, -150], head: [-3, 4, 0] } },
    { t: 1.8, p: { uArmL: [-6, 0, 152], uArmR: [-6, 0, -152], fArmL: [-12, 0, 6], fArmR: [-12, 0, -6], head: [-4, 0, 0], spine2: [1, 0, 0] } }
  ], true);
  def('talk', 2.6, [
    { t: 0, p: { uArmR: [-18, 0, -6], fArmR: [-38, 0, 0], head: [2, 0, 0], spine2: [2, 3, 0] } },
    { t: 0.65, p: { uArmR: [-30, 0, -8], fArmR: [-66, 0, 0], head: [4, -3, 0] } },
    { t: 1.3, p: { uArmR: [-14, 0, -5], fArmR: [-30, 0, 0], uArmL: [-16, 0, 7], fArmL: [-44, 0, 3], head: [2, 3, 0], spine2: [2, -3, 0] } },
    { t: 1.95, p: { uArmL: [-24, 0, 8], fArmL: [-58, 0, 3], head: [4, 0, 0] } },
    { t: 2.6, p: { uArmR: [-18, 0, -6], fArmR: [-38, 0, 0], uArmL: [0, 0, 6], fArmL: [-8, 0, 2], head: [2, 0, 0], spine2: [2, 3, 0] } }
  ], true);
  def('wave', 1.3, [
    { t: 0, p: { uArmR: [-8, 0, -158], fArmR: [0, 0, -14], head: [0, 0, -4] } },
    { t: 0.32, p: { fArmR: [0, 0, 16] } },
    { t: 0.65, p: { fArmR: [0, 0, -14] } },
    { t: 0.97, p: { fArmR: [0, 0, 16] } },
    { t: 1.3, p: { uArmR: [-8, 0, -158], fArmR: [0, 0, -14], head: [0, 0, -4] } }
  ], true);
  def('point', 1.4, [
    { t: 0, p: { uArmR: [-86, 0, -2], fArmR: [-2, 0, 0], head: [0, 0, 0], spine2: [1, -5, 0] } },
    { t: 1.4, p: { uArmR: [-86, 0, -2], fArmR: [-2, 0, 0], head: [0, 0, 0], spine2: [1, -5, 0] } }
  ], true);

  // ---- controller -------------------------------------------------------------
  function create(char, opts) {
    opts = opts || {};
    var mixer = new THREE.AnimationMixer(char.group);
    var actions = {}, current = null, currentName = '';
    var pelvisBone = char.bones.pelvis;
    var bindPos = pelvisBone.position.clone();
    function action(name) {
      if (actions[name]) return actions[name];
      var src = CLIPS[name]; if (!src) return null;
      var clip = src;
      if (src.userData.pelv) {
        clip = src.clone();
        clip.tracks = clip.tracks.concat([pelvisTrack(src, bindPos)]);
      }
      var a = mixer.clipAction(clip);
      a.setLoop(src.userData.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      if (!src.userData.loop) a.clampWhenFinished = true;
      actions[name] = a; return a;
    }
    var ctl = {
      char: char, mixer: mixer, current: function () { return currentName; },
      action: function () { return current; },
      posture: opts.posture || {},
      lookYaw: 0, lookPitch: 0,
      play: function (name, fade, force) {
        var a = action(name); if (!a) return false;
        fade = fade == null ? 0.18 : Math.max(0.02, fade); // fade 0 breaks the mixer's fading math
        if (current === a && !force) { // already playing: never reset phase
          if (!a.isRunning()) a.play();
          return true;
        }
        var switching = !!(current && current !== a);
        if (switching) current.fadeOut(fade);
        a.reset(); // also stops any fading on this action
        a.setEffectiveWeight(1);
        // fadeIn only for a true crossfade: scheduled from weight 0, it
        // would otherwise pin the weight at 0 until mixer time advances
        if (switching) a.fadeIn(fade);
        a.play();
        current = a; currentName = name;
        return true;
      },
      // speed-driven locomotion with gait sync (no foot sliding)
      setSpeed: function (mps) {
        var name, ref;
        if (mps < 0.08) { ctl.play(char.idleName || 'idle', 0.22); return; }
        if (mps < 2.2) name = char.gaitName || 'walk';
        else if (mps < 3.9) name = 'run';
        else name = 'sprint';
        ref = CLIPS[name].userData.refSpeed || 1.6;
        ctl.play(name, 0.16);
        if (current) current.setEffectiveTimeScale(mps / ref);
      },
      look: function (yawDeg, pitchDeg) {
        ctl.lookYaw = THREE.MathUtils.clamp(yawDeg, -55, 55);
        ctl.lookPitch = THREE.MathUtils.clamp(pitchDeg, -28, 32);
      },
      setPosture: function (p) { ctl.posture = p || {}; },
      update: function (dt) {
        mixer.update(dt);
        // procedural layer: posture + head look, applied after the mixer
        var P = ctl.posture, b = char.bones;
        var q = new THREE.Quaternion(), e = new THREE.Euler();
        function add(bone, x, y, z) {
          if (!bone || (!x && !y && !z)) return;
          q.setFromEuler(e.set(x * D, y * D, z * D));
          bone.quaternion.multiply(q);
        }
        if (P.hunch) { add(b.spine1, P.hunch * 10, 0, 0); add(b.head, P.hunch * 7, 0, 0); }
        if (P.slouch) { add(b.uArmL, 0, 0, 3); add(b.uArmR, 0, 0, -3); add(b.spine2, P.slouch * 5, 0, 0); }
        if (P.stiff) { add(b.spine2, -2, 0, 0); add(b.head, -1, 0, 0); }
        if (ctl.lookYaw || ctl.lookPitch) {
          add(b.neck, ctl.lookPitch * 0.45, ctl.lookYaw * 0.45, 0);
          add(b.head, ctl.lookPitch * 0.55, ctl.lookYaw * 0.55, 0);
        }
      }
    };
    if (opts.idle) char.idleName = opts.idle;
    if (opts.gait) char.gaitName = opts.gait;
    ctl.play(opts.start || char.idleName || 'idle');
    return ctl;
  }

  SH.CharAnim = { clips: CLIPS, create: create };
})(window.SH = window.SH || {});
