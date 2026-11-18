// SELATARA HEAT — pedestrians.js
// Sidewalk pedestrians: pooled low-poly walkers who stroll between corners,
// idle and chat, panic-flee from danger, and fall when hit by a fast vehicle.
// Public API: SH.Pedestrians { init(scene), update(dt), list, scare(x, z, radius) }.
(function (SH) {
  'use strict';

  var shirtColors = [0xff8c5a, 0x37e0ff, 0xffd23f, 0x9fd8c0, 0xff4fa3, 0xf2e3c6, 0x7ac94f, 0xe8e3d8];

  // ---- shared character builder (Revision 7: bone rig + clips) ---------
  // One figure system for EVERY human in the game — pedestrians, Raka,
  // combat fighters, police officers, the mission courier, motor riders.
  // Architecture (Codrops pattern, rebuilt from scratch in code):
  //   * a real THREE.Skeleton of named bones (Hips > Spine > Chest >
  //     Neck > Head; Shoulder > UpperArm > ForeArm > Hand; UpLeg >
  //     Shin > Foot), bound in a 42-degree A-pose;
  //   * the body is ONE SkinnedMesh whose geometry is authored in code
  //     in bind-pose world space, every part hard-weighted to its bone
  //     and vertex-coloured (60-30-10 outfit colours), plus a second
  //     SkinnedMesh for the face-textured head;
  //   * idle / walk / run are THREE.AnimationClips (quaternion tracks
  //     per bone + a Hips position track for the bob) played through an
  //     AnimationMixer with weight-blend crossfades;
  //   * a procedural layer runs AFTER mixer.update: head look (neck
  //     <= 50 deg), gun-arm aim, turn lean, and the seated motor pose
  //     are applied on top of the clips, never written into them;
  //   * hair / hats / glasses are rigid attachments parented to the
  //     Head bone (max a handful per figure).
  // Proportions follow ART-BIBLE v3: ~5.9 heads at 1.78 m, head 0.30 m,
  // every limb tapered (thigh->knee 0.72x, shin->ankle 0.65x), trapezoid
  // torso with trapezius slope and deltoid caps, belt/collar/shoes as
  // silhouette breakers.
  var faceCache = {};
  function faceTexture(skinColor, variant) {
    var key = skinColor + '_' + variant;
    if (faceCache[key]) return faceCache[key];
    var cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
    var c = cv.getContext('2d');
    var col = '#' + ('000000' + skinColor.toString(16)).slice(-6);
    c.fillStyle = col; c.fillRect(0, 0, 256, 256);
    // Soft side shading so the sphere reads round even unlit.
    var grad = c.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.18)');
    grad.addColorStop(0.25, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.18)');
    grad.addColorStop(0.75, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.18)');
    c.fillStyle = grad; c.fillRect(0, 0, 256, 256);
    // The face sits at u = 0.25 on a THREE sphere (the +z meridian), so
    // features are drawn around x = 64. The canvas is 256px (v3 asks
    // for a face that survives a 1.5-2 m close-up): the eye line sits
    // at mid-head, eyes ~25% of face height.
    function ellipse(x, y, rx, ry, fill) {
      c.fillStyle = fill; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill();
    }
    ellipse(36, 148, 14, 10, 'rgba(255,110,80,0.10)');   // cheeks
    ellipse(92, 148, 14, 10, 'rgba(255,110,80,0.10)');
    c.fillStyle = '#241a12';                           // brows
    c.save(); c.translate(46, 84); c.rotate(-0.14); c.fillRect(-12, -3.2, 24, 6.4); c.restore();
    c.save(); c.translate(82, 84); c.rotate(0.14); c.fillRect(-12, -3.2, 24, 6.4); c.restore();
    ellipse(46, 104, 6.8, 9.6, '#1d1410');              // eyes
    ellipse(82, 104, 6.8, 9.6, '#1d1410');
    ellipse(48.4, 100.4, 2.2, 2.8, 'rgba(255,255,255,0.85)'); // glints
    ellipse(84.4, 100.4, 2.2, 2.8, 'rgba(255,255,255,0.85)');
    c.strokeStyle = 'rgba(60,30,15,0.45)'; c.lineWidth = 4;  // nose
    c.beginPath(); c.moveTo(65, 116); c.lineTo(62, 136); c.stroke();
    ellipse(57.2, 147, 2.8, 2, 'rgba(40,20,10,0.4)');
    ellipse(70.8, 147, 2.8, 2, 'rgba(40,20,10,0.4)');
    c.strokeStyle = '#6e3524'; c.lineWidth = 4.8; c.lineCap = 'round';
    if (variant === 1) {                               // flat, serious
      c.beginPath(); c.moveTo(52, 166); c.lineTo(76, 166); c.stroke();
    } else if (variant === 2) {                        // grin
      c.fillStyle = '#5e2a1c'; c.beginPath(); c.ellipse(64, 164, 13, 9.2, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#f5ede2'; c.fillRect(53, 158, 22, 6.8);
    } else {                                           // easy smile
      c.beginPath(); c.arc(64, 158, 12, Math.PI * 0.2, Math.PI * 0.8); c.stroke();
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    faceCache[key] = tex;
    return tex;
  }

  // ---- animation clips (shared by every figure) -------------------------
  function eulerTrack(name, times, keys) {
    var vals = [];
    for (var i = 0; i < keys.length; i++) {
      var q = new THREE.Quaternion().setFromEuler(new THREE.Euler(keys[i][0], keys[i][1], keys[i][2]));
      vals.push(q.x, q.y, q.z, q.w);
    }
    return new THREE.QuaternionKeyframeTrack(name, times, vals);
  }
  function hipsTrack(times, ys) {
    var vals = [];
    for (var i = 0; i < ys.length; i++) vals.push(0, ys[i], 0);
    return new THREE.VectorKeyframeTrack('Hips.position', times, vals);
  }
  function mirror(keys) { // phase-shift a cyclic key table by half a cycle
    var n = keys.length - 1, half = n / 2, out = [];
    for (var i = 0; i <= n; i++) out.push(keys[(i + half) % n]);
    return out;
  }
  var clipCache = null;
  function buildClips() {
    if (clipCache) return clipCache;
    // WALK — 1.0 s cycle (24 frames at 24 fps). Key poses follow the
    // clinical cycle: Contact 0/50%, Down 12.5%, Passing 25%, Up 37.5%;
    // knee peaks ~60 deg in mid-swing, toe-off at ~50-60% plants the
    // foot 20 deg; arm swing totals ~38 deg; elbows never straighten
    // past ~35 deg flexion walking. Forward leg swing = -x rotation.
    var T = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
    var legL = [[-0.45, 0, 0], [-0.30, 0, 0], [0.02, 0, 0], [0.34, 0, 0], [0.42, 0, 0], [0.30, 0, 0], [-0.02, 0, 0], [-0.30, 0, 0], [-0.45, 0, 0]];
    var shinL = [[0.10, 0, 0], [0.16, 0, 0], [0.08, 0, 0], [0.10, 0, 0], [0.30, 0, 0], [0.85, 0, 0], [1.00, 0, 0], [0.55, 0, 0], [0.10, 0, 0]];
    var footL = [[0, 0, 0], [0.05, 0, 0], [0, 0, 0], [0, 0, 0], [0.35, 0, 0], [0.10, 0, 0], [-0.08, 0, 0], [0, 0, 0], [0, 0, 0]];
    var hipsYaw = [0.09, 0.05, 0, -0.05, -0.09, -0.05, 0, 0.05, 0.09];
    var hipsRoll = [0.03, 0.045, 0.02, -0.02, -0.03, -0.045, -0.02, 0.02, 0.03];
    function hipsKeys(f) {
      return T.map(function (t, i) { return [0, hipsYaw[i] * f, hipsRoll[i] * f]; });
    }
    function armKeys(legKeys, sideSign) {
      return legKeys.map(function (k) {
        return [-k[0] * 0.72, 0, 0.15 * sideSign + k[0] * 0.05];
      });
    }
    function foreKeys(legKeys, sideSign) {
      return legKeys.map(function (k) {
        return [-0.61 + k[0] * 0.22, 0, 0.06 * sideSign];
      });
    }
    var walk = new THREE.AnimationClip('walk', 1.0, [
      eulerTrack('UpLegL.quaternion', T, legL),
      eulerTrack('UpLegR.quaternion', T, mirror(legL)),
      eulerTrack('ShinL.quaternion', T, shinL),
      eulerTrack('ShinR.quaternion', T, mirror(shinL)),
      eulerTrack('FootL.quaternion', T, footL),
      eulerTrack('FootR.quaternion', T, mirror(footL)),
      eulerTrack('UpperArmL.quaternion', T, armKeys(legL, -1)),
      eulerTrack('UpperArmR.quaternion', T, armKeys(mirror(legL), 1)),
      eulerTrack('ForeArmL.quaternion', T, foreKeys(legL, -1)),
      eulerTrack('ForeArmR.quaternion', T, foreKeys(mirror(legL), 1)),
      eulerTrack('Hips.quaternion', T, hipsKeys(1)),
      eulerTrack('Spine.quaternion', T, hipsKeys(-0.3)),
      eulerTrack('Chest.quaternion', T, hipsKeys(-0.7)),
      hipsTrack(T, [0.975, 0.955, 0.97, 0.985, 0.975, 0.955, 0.97, 0.985, 0.975])
    ]);
    // RUN — 0.62 s cycle with a flight phase: hips rise mid-stride,
    // knees fold hard, elbows hold ~90 deg, chest leans in.
    var RT = [0, 0.155, 0.31, 0.465, 0.62];
    var rLegL = [[-0.95, 0, 0], [0.15, 0, 0], [0.85, 0, 0], [-0.20, 0, 0], [-0.95, 0, 0]];
    var rShinL = [[0.45, 0, 0], [1.35, 0, 0], [0.75, 0, 0], [1.65, 0, 0], [0.45, 0, 0]];
    var rArmL = [[0.75, 0, -0.18], [-0.10, 0, -0.16], [-0.75, 0, -0.18], [0.10, 0, -0.16], [0.75, 0, -0.18]];
    var rArmR = mirror(rArmL).map(function (k) { return [k[0], 0, -k[2]]; });
    var run = new THREE.AnimationClip('run', 0.62, [
      eulerTrack('UpLegL.quaternion', RT, rLegL),
      eulerTrack('UpLegR.quaternion', RT, mirror(rLegL)),
      eulerTrack('ShinL.quaternion', RT, rShinL),
      eulerTrack('ShinR.quaternion', RT, mirror(rShinL)),
      eulerTrack('UpperArmL.quaternion', RT, rArmL),
      eulerTrack('UpperArmR.quaternion', RT, rArmR),
      eulerTrack('ForeArmL.quaternion', RT, rArmL.map(function (k) { return [-1.5 + k[0] * 0.15, 0, -0.06]; })),
      eulerTrack('ForeArmR.quaternion', RT, rArmR.map(function (k) { return [-1.5 + k[0] * 0.15, 0, 0.06]; })),
      eulerTrack('Chest.quaternion', RT, [[0.16, 0, 0], [0.13, 0, 0], [0.16, 0, 0], [0.13, 0, 0], [0.16, 0, 0]]),
      eulerTrack('Hips.quaternion', RT, [[0, 0.06, 0.02], [0, 0, 0], [0, -0.06, -0.02], [0, 0, 0], [0, 0.06, 0.02]]),
      hipsTrack(RT, [0.955, 1.025, 0.945, 1.025, 0.955])
    ]);
    // IDLE — 4 s breathing loop (15 breaths/min): chest rises <= 1 cm,
    // weight shifts side to side (contrapposto roll), arms hang 8 deg
    // out with elbows pre-bent 15-20 deg, head drifts in small glances.
    var IT = [0, 1, 2, 3, 4];
    var idle = new THREE.AnimationClip('idle', 4.0, [
      eulerTrack('Spine.quaternion', IT, [[0.01, 0, 0], [0.035, 0, 0], [0.01, 0, 0], [0.03, 0, 0], [0.01, 0, 0]]),
      eulerTrack('Chest.quaternion', IT, [[0.01, 0, 0], [0.03, 0, 0], [0.01, 0, 0], [0.028, 0, 0], [0.01, 0, 0]]),
      eulerTrack('Hips.quaternion', IT, [[0, 0, 0.055], [0, 0.01, 0.05], [0, 0, -0.045], [0, -0.01, -0.05], [0, 0, 0.055]]),
      hipsTrack(IT, [0.978, 0.976, 0.978, 0.976, 0.978]),
      eulerTrack('UpperArmL.quaternion', IT, [[0.02, 0, -0.15], [-0.02, 0, -0.17], [0.03, 0, -0.15], [0, 0, -0.16], [0.02, 0, -0.15]]),
      eulerTrack('UpperArmR.quaternion', IT, [[-0.01, 0, 0.16], [0.02, 0, 0.15], [-0.02, 0, 0.17], [0.01, 0, 0.15], [-0.01, 0, 0.16]]),
      eulerTrack('ForeArmL.quaternion', IT, [[-0.30, 0, -0.05], [-0.26, 0, -0.05], [-0.33, 0, -0.05], [-0.28, 0, -0.05], [-0.30, 0, -0.05]]),
      eulerTrack('ForeArmR.quaternion', IT, [[-0.28, 0, 0.05], [-0.32, 0, 0.05], [-0.27, 0, 0.05], [-0.31, 0, 0.05], [-0.28, 0, 0.05]]),
      // NOTE: Neck/Head carry NO clip tracks anywhere — they belong
      // entirely to the procedural look layer (set, never accumulated).
      eulerTrack('UpLegL.quaternion', IT, [[0.02, 0, 0.01], [0.02, 0, 0.01], [0.02, 0, 0.01], [0.02, 0, 0.01], [0.02, 0, 0.01]]),
      eulerTrack('UpLegR.quaternion', IT, [[-0.03, 0, -0.01], [-0.03, 0, -0.01], [-0.03, 0, -0.01], [-0.03, 0, -0.01], [-0.03, 0, -0.01]]),
      eulerTrack('ShinL.quaternion', IT, [[0.06, 0, 0], [0.06, 0, 0], [0.06, 0, 0], [0.06, 0, 0], [0.06, 0, 0]]),
      eulerTrack('ShinR.quaternion', IT, [[0.05, 0, 0], [0.05, 0, 0], [0.05, 0, 0], [0.05, 0, 0], [0.05, 0, 0]])
    ]);
    clipCache = { idle: idle, walk: walk, run: run };
    return clipCache;
  }

  var _e = new THREE.Euler(), _q = new THREE.Quaternion(), _aimQ = new THREE.Quaternion();
  function clampN(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function buildFigure(opts) {
    opts = opts || {};
    var skinColor = opts.skin != null ? opts.skin : 0xb87a4e;
    var shirtColor = opts.shirt != null ? opts.shirt : 0xff8c5a;
    var pantsColor = opts.pants != null ? opts.pants : 0x2a3040;
    var hairColor = opts.hairColor != null ? opts.hairColor : 0x14100c;
    var darkColor = 0x22242c;
    var bottom = opts.bottom || 'pants';
    var g = new THREE.Group();

    // ---- skeleton -------------------------------------------------------
    var bones = {}, boneList = [];
    function bone(name, parent, x, y, z, rz) {
      var b = new THREE.Bone();
      b.name = name;
      b.position.set(x, y, z);
      if (rz) b.rotation.z = rz;
      if (parent) parent.add(b);
      bones[name] = b; boneList.push(b);
      return b;
    }
    var AZ = 0.73; // 42-degree A-pose bind for the arms
    bone('Hips', null, 0, 0.98, 0);
    bone('Spine', bones.Hips, 0, 0.10, 0);
    bone('Chest', bones.Spine, 0, 0.16, 0);
    bone('Neck', bones.Chest, 0, 0.26, 0);
    bone('Head', bones.Neck, 0, 0.05, 0);
    bone('ShoulderL', bones.Chest, -0.10, 0.20, 0);
    bone('UpperArmL', bones.ShoulderL, -0.11, 0, 0, -AZ);
    bone('ForeArmL', bones.UpperArmL, 0, -0.28, 0);
    bone('HandL', bones.ForeArmL, 0, -0.27, 0);
    bone('ShoulderR', bones.Chest, 0.10, 0.20, 0);
    bone('UpperArmR', bones.ShoulderR, 0.11, 0, 0, AZ);
    bone('ForeArmR', bones.UpperArmR, 0, -0.28, 0);
    bone('HandR', bones.ForeArmR, 0, -0.27, 0);
    bone('UpLegL', bones.Hips, -0.10, -0.03, 0);
    bone('ShinL', bones.UpLegL, 0, -0.44, 0);
    bone('FootL', bones.ShinL, 0, -0.44, 0);
    bone('UpLegR', bones.Hips, 0.10, -0.03, 0);
    bone('ShinR', bones.UpLegR, 0, -0.44, 0);
    bone('FootR', bones.ShinR, 0, -0.44, 0);
    var boneIndex = {};
    for (var bi2 = 0; bi2 < boneList.length; bi2++) boneIndex[boneList[bi2].name] = bi2;
    g.add(bones.Hips);

    // ---- geometry authoring (bind-pose world space) ---------------------
    function M(x, y, z, rx, ry, rz, sx, sy, sz) {
      return new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)),
        new THREE.Vector3(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz));
    }
    function part(geo, boneName, colorHex, matrix) {
      if (matrix) geo.applyMatrix4(matrix);
      var n = geo.attributes.position.count;
      var col = new THREE.Color(colorHex);
      var cols = new Float32Array(n * 3);
      var si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      var idx = boneIndex[boneName];
      for (var i = 0; i < n; i++) {
        cols[i * 3] = col.r; cols[i * 3 + 1] = col.g; cols[i * 3 + 2] = col.b;
        si[i * 4] = idx; sw[i * 4] = 1;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      return geo;
    }
    function cyl(rt, rb, h, seg) { return new THREE.CylinderGeometry(rt, rb, h, seg); }
    var sleeveColor = opts.sleeves === 'short' ? skinColor : shirtColor;
    var thighColor = bottom === 'skirt' ? skinColor : pantsColor;
    var shinColor = bottom === 'pants' ? pantsColor : skinColor;
    var bodyGeos = [];
    // Pelvis + belt (Hips), lower torso (Spine), chest + trapezius (Chest).
    bodyGeos.push(part(cyl(0.175, 0.20, 0.20, 8), 'Hips', bottom === 'skirt' ? shirtColor : pantsColor, M(0, 1.00, 0, 0, 0, 0, 1, 1, 0.66)));
    if (bottom === 'skirt') bodyGeos.push(part(cyl(0.16, 0.27, 0.36, 9), 'Hips', pantsColor, M(0, 0.86, 0)));
    bodyGeos.push(part(new THREE.BoxGeometry(0.31, 0.05, 0.185), 'Hips', darkColor, M(0, 1.12, 0)));
    bodyGeos.push(part(cyl(0.195, 0.175, 0.18, 8), 'Spine', shirtColor, M(0, 1.17, 0, 0, 0, 0, 1, 1, 0.66)));
    bodyGeos.push(part(cyl(0.24, 0.195, 0.36, 8), 'Chest', shirtColor, M(0, 1.32, 0, 0, 0, 0, 1, 1, 0.66)));
    bodyGeos.push(part(cyl(0.09, 0.155, 0.10, 8), 'Chest', shirtColor, M(0, 1.50, 0, 0, 0, 0, 1, 1, 0.66)));
    if (opts.jacket) {
      bodyGeos.push(part(new THREE.BoxGeometry(0.05, 0.32, 0.015), 'Chest', darkColor, M(0, 1.31, 0.115)));
      bodyGeos.push(part(cyl(0.12, 0.145, 0.08, 8), 'Chest', darkColor, M(0, 1.50, 0)));
    }
    bodyGeos.push(part(cyl(0.055, 0.06, 0.10, 6), 'Neck', skinColor, M(0, 1.50, 0)));
    // Ears ride the Head bone but live in the vertex-coloured body mesh
    // (the head mesh's UV space belongs to the face).
    bodyGeos.push(part(new THREE.SphereGeometry(0.038, 6, 5), 'Head', skinColor, M(-0.135, 1.63, 0)));
    bodyGeos.push(part(new THREE.SphereGeometry(0.038, 6, 5), 'Head', skinColor, M(0.135, 1.63, 0)));
    // Arms: deltoid cap, tapered upper arm, elbow ball, tapered forearm,
    // flat hand — authored along the A-pose direction from the shoulder.
    function armGeos(side) { // side: -1 = left (-x), +1 = right (+x)
      var sx = 0.21 * side;
      var rz = AZ * side;
      // Direction the arm points in bind pose: (0,-1,0) rotated by rz
      // around Z. Left (rz=-0.73): (-0.667, -0.745) — down and outward.
      var dX = Math.sin(rz);
      var dY = -Math.cos(rz);
      var ex = sx + dX * 0.28, ey = 1.44 + dY * 0.28;
      var out = [];
      var delt = new THREE.SphereGeometry(0.078, 8, 6);
      delt.scale(1.05, 0.8, 1.05);
      out.push(part(delt, side < 0 ? 'UpperArmL' : 'UpperArmR', shirtColor, M(sx, 1.45, 0)));
      out.push(part(cyl(0.052, 0.042, 0.28, 7).translate(0, -0.14, 0), side < 0 ? 'UpperArmL' : 'UpperArmR', sleeveColor, M(sx, 1.44, 0, 0, 0, rz)));
      out.push(part(new THREE.SphereGeometry(0.042, 7, 6), side < 0 ? 'ForeArmL' : 'ForeArmR', skinColor, M(ex, ey, 0)));
      out.push(part(cyl(0.042, 0.032, 0.27, 7).translate(0, -0.135, 0), side < 0 ? 'ForeArmL' : 'ForeArmR', skinColor, M(ex, ey, 0, 0, 0, rz)));
      out.push(part(new THREE.BoxGeometry(0.05, 0.10, 0.025).translate(0, -0.05, 0), side < 0 ? 'ForeArmL' : 'ForeArmR', skinColor, M(ex + dX * 0.28, ey + dY * 0.28, 0, 0, 0, rz)));
      return out;
    }
    bodyGeos = bodyGeos.concat(armGeos(-1), armGeos(1));
    // Legs: tapered thigh, knee ball, tapered shin with calf bulge, shoe.
    function legGeos(side) {
      var sx = 0.10 * side;
      var bn = side < 0 ? 'L' : 'R';
      var out = [];
      out.push(part(cyl(0.078, 0.056, 0.44, 7), 'UpLeg' + bn, thighColor, M(sx, 0.73, 0)));
      out.push(part(new THREE.SphereGeometry(0.052, 7, 6), 'Shin' + bn, shinColor, M(sx, 0.51, 0)));
      out.push(part(cyl(0.052, 0.034, 0.44, 7), 'Shin' + bn, shinColor, M(sx, 0.29, 0)));
      var calf = new THREE.SphereGeometry(0.048, 7, 6);
      calf.scale(0.75, 1.35, 0.75);
      out.push(part(calf, 'Shin' + bn, shinColor, M(sx, 0.40, -0.02)));
      out.push(part(new THREE.BoxGeometry(0.105, 0.07, 0.27), 'Foot' + bn, darkColor, M(sx, 0.035, 0.055, 0.08, 0, 0)));
      return out;
    }
    bodyGeos = bodyGeos.concat(legGeos(-1), legGeos(1));

    var bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    var bodyMesh = new THREE.SkinnedMesh(SH.World.mergeGeos(bodyGeos), bodyMat);
    var headGeo = part(new THREE.SphereGeometry(0.15, 12, 10), 'Head', skinColor, M(0, 1.63, 0, 0, 0, 0, 0.94, 1, 0.97));
    var headMat = new THREE.MeshLambertMaterial({ map: faceTexture(skinColor, opts.face || 0), flatShading: true });
    var headMesh = new THREE.SkinnedMesh(headGeo, headMat);
    g.updateMatrixWorld(true); // bind inverses need true bind-pose worlds
    var skeleton = new THREE.Skeleton(boneList);
    bodyMesh.add(bones.Hips);
    bodyMesh.bind(skeleton);
    headMesh.bind(skeleton);
    bodyMesh.castShadow = true;
    headMesh.castShadow = true;
    bodyMesh.frustumCulled = false;
    headMesh.frustumCulled = false;
    g.add(bodyMesh);
    g.add(headMesh);

    // ---- rigid attachments on the Head bone ------------------------------
    var hairMat = new THREE.MeshLambertMaterial({ color: hairColor, flatShading: true });
    function attach(geo, mat, x, y, z) {
      var m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      bones.Head.add(m);
      return m;
    }
    var hairStyle = opts.hairStyle || 'cap';
    if (hairStyle === 'hat') {
      var hatMat = new THREE.MeshLambertMaterial({ color: opts.hatColor != null ? opts.hatColor : 0x22242c, flatShading: true });
      attach(SH.World.mergeGeos([
        new THREE.CylinderGeometry(0.20, 0.20, 0.02, 10).translate(0, 0.175, 0),
        new THREE.CylinderGeometry(0.135, 0.145, 0.10, 10).translate(0, 0.215, 0)
      ]), hatMat, 0, 0, 0);
    } else if (hairStyle !== 'bald') {
      var hairParts = [new THREE.SphereGeometry(0.158, 10, 6, 0, Math.PI * 2, 0, 1.75).translate(0, 0.10, -0.01)];
      if (hairStyle === 'long') hairParts.push(new THREE.BoxGeometry(0.24, 0.32, 0.05).translate(0, -0.06, -0.125));
      else if (hairStyle === 'bun') hairParts.push(new THREE.SphereGeometry(0.065, 7, 6).translate(0, 0.20, -0.09));
      else if (hairStyle === 'mohawk') hairParts.push(new THREE.BoxGeometry(0.05, 0.13, 0.30).translate(0, 0.21, 0));
      attach(SH.World.mergeGeos(hairParts), hairMat, 0, 0, 0);
    }
    if (opts.glasses) {
      attach(new THREE.BoxGeometry(0.24, 0.055, 0.015), new THREE.MeshLambertMaterial({ color: darkColor, flatShading: true }), 0, 0.10, 0.138);
    }

    // ---- animation state --------------------------------------------------
    var clips = buildClips();
    var mixer = new THREE.AnimationMixer(g);
    var actions = {};
    var weights = { idle: 1, walk: 0, run: 0 };
    for (var stateName in clips) {
      var act = mixer.clipAction(clips[stateName]);
      act.enabled = true;
      act.setEffectiveWeight(stateName === 'idle' ? 1 : 0);
      act.play();
      actions[stateName] = act;
    }
    var tris = 0;
    [bodyMesh, headMesh].forEach(function (mm) {
      var gi = mm.geometry;
      tris += (gi.index ? gi.index.count : gi.attributes.position.count) / 3;
    });

    var fig = {
      group: g,
      bones: bones,
      mixer: mixer,
      actions: actions,
      shirtMat: bodyMat, // per-figure material: combat hit-flash target
      skinMat: bodyMat,
      headMesh: headMesh,
      tris: Math.round(tris),
      state: 'idle',
      speedNorm: 0,
      aimTarget: 0, aim: 0,
      lookYaw: 0, lookPitch: 0,
      leanX: 0, leanZ: 0,
      setSpeed: function (n) { this.speedNorm = clampN(n, 0, 1.3); },
      // Direct seated pose (motor riders): writes the bones once, no
      // mixer involvement — used for NPC riders and, per frame, for the
      // player while Vehicles drives the bike.
      applySeated: function () {
        bones.UpLegL.quaternion.setFromEuler(_e.set(-1.45, 0, 0));
        bones.UpLegR.quaternion.setFromEuler(_e.set(-1.45, 0, 0));
        bones.ShinL.quaternion.setFromEuler(_e.set(1.55, 0, 0));
        bones.ShinR.quaternion.setFromEuler(_e.set(1.55, 0, 0));
        bones.FootL.quaternion.setFromEuler(_e.set(0.5, 0, 0));
        bones.FootR.quaternion.setFromEuler(_e.set(0.5, 0, 0));
        bones.UpperArmL.quaternion.setFromEuler(_e.set(-0.95, 0, -0.25));
        bones.UpperArmR.quaternion.setFromEuler(_e.set(-0.95, 0, 0.25));
        bones.ForeArmL.quaternion.setFromEuler(_e.set(-0.35, 0, 0));
        bones.ForeArmR.quaternion.setFromEuler(_e.set(-0.35, 0, 0));
        bones.Chest.quaternion.setFromEuler(_e.set(0.12, 0, 0));
      },
      update: function (dt) {
        // State by speed, with a little hysteresis at the run line.
        var want = this.state;
        if (this.speedNorm > 0.62) want = 'run';
        else if (this.speedNorm > 0.06) want = 'walk';
        else if (this.speedNorm < 0.04) want = 'idle';
        if (want !== this.state) this.state = want;
        for (var k in actions) {
          var target = k === this.state ? 1 : 0;
          weights[k] += clampN(target - weights[k], -dt / 0.25, dt / 0.25);
          actions[k].setEffectiveWeight(weights[k]);
        }
        actions.walk.timeScale = 0.7 + this.speedNorm * 0.9;
        actions.run.timeScale = 0.9 + this.speedNorm * 0.35;
        mixer.update(dt);
        // ---- procedural layer (post-mixer, Codrops-style) ----
        this.aim += clampN(this.aimTarget - this.aim, -dt * 5, dt * 5);
        if (this.aim > 0.001) {
          _aimQ.setFromEuler(_e.set(-1.5, 0, 0.12));
          bones.UpperArmR.quaternion.slerp(_aimQ, this.aim);
          _aimQ.setFromEuler(_e.set(-0.3, 0, 0));
          bones.ForeArmR.quaternion.slerp(_aimQ, this.aim * 0.85);
        }
        // Look: Neck/Head are purely procedural bones (no clip ever
        // writes them), so the layer SETS their quaternions outright.
        // (Multiplying into an untracked bone accumulates frame over
        // frame — the head spun -137 degrees before this was caught.)
        var ly = clampN(this.lookYaw, -0.85, 0.85), lp = clampN(this.lookPitch, -0.5, 0.5);
        bones.Neck.quaternion.setFromEuler(_e.set(lp * 0.6, ly * 0.6, 0));
        bones.Head.quaternion.setFromEuler(_e.set(lp * 0.4, ly * 0.4, 0));
        if (this.leanX) bones.Chest.quaternion.multiply(_q.setFromEuler(_e.set(this.leanX, 0, 0)));
        if (this.leanZ) bones.Hips.quaternion.multiply(_q.setFromEuler(_e.set(0, 0, this.leanZ)));
      }
    };
    fig._skinTone = skinColor;
    return fig;
  }

  var skinTones = [0x8a5a34, 0xa8763e, 0xb87a4e, 0xc98a5e, 0x7a4a28, 0xd9a06a];
  var hairColors = [0x14100c, 0x3a2415, 0x5e3a1e, 0x7a1f3d, 0xb8b0a4];
  var hairStyles = ['cap', 'cap', 'long', 'bun', 'mohawk', 'bald'];

  function buildPedMesh(rng) {
    var bottom = ['pants', 'pants', 'shorts', 'skirt'][(rng() * 4) | 0];
    var skinTone = skinTones[(rng() * skinTones.length) | 0];
    return buildFigure({
      skin: skinTone,
      shirt: shirtColors[(rng() * shirtColors.length) | 0],
      pants: 0x2a3040 + ((rng() * 0x101018) | 0),
      hairColor: hairColors[(rng() * hairColors.length) | 0],
      hairStyle: hairStyles[(rng() * hairStyles.length) | 0],
      bottom: bottom,
      sleeves: (bottom === 'shorts' || bottom === 'skirt') ? 'short' : 'long',
      jacket: rng() < 0.25,
      glasses: rng() < 0.2,
      face: (rng() * 3) | 0
    });
  }

  // Far LOD (perf mandate): bake the whole rigged figure in bind pose
  // into ONE vertex-coloured mesh. Beyond ~46 m the limb swing is a few
  // pixels; the baked walker still moves, turns and bobs via the ped
  // update, and the full rig returns inside 42 m (hysteresis).
  var lodMatShared = null;
  function bakeLOD(built) {
    if (!lodMatShared) lodMatShared = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    built.group.updateMatrixWorld(true);
    var geos = [];
    built.group.traverse(function (o) {
      if (!o.isMesh) return;
      var geo = o.geometry.clone();
      geo.deleteAttribute('skinIndex');
      geo.deleteAttribute('skinWeight');
      geo.applyMatrix4(o.matrixWorld);
      var col = (o.material && o.material.map)
        ? new THREE.Color(built._skinTone != null ? built._skinTone : 0xb87a4e)
        : (o.material && o.material.color ? o.material.color : new THREE.Color(0x888888));
      // Skinned body parts carry their outfit colour per-vertex; the
      // material colour (white) would erase it — prefer vertex colours.
      if (!geo.attributes.color) {
        var n = geo.attributes.position.count;
        var arr = new Float32Array(n * 3);
        for (var i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
        geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      }
      geos.push(geo);
    });
    var mesh = new THREE.Mesh(SH.World.mergeGeos(geos), lodMatShared);
    mesh.castShadow = true;
    mesh.visible = false;
    return mesh;
  }

  var Pedestrians = {
    list: [],
    rng: SH.World.makeRng(31),
    buildFigure: buildFigure,

    init: function (scene) {
      var n = SH.Config.loop.pedCount;
      for (var i = 0; i < n; i++) {
        var built = buildPedMesh(this.rng);
        scene.add(built.group);
        var lod = bakeLOD(built);
        scene.add(lod);
        var ped = {
          mesh: built.group, fig: built, lod: lod, far: false,
          x: 0, z: 0, heading: 0, speed: 0, cycle: this.rng() * 6,
          tx: 0, tz: 0, state: 'walk', timer: this.rng() * 3, panic: 0, down: 0,
          market: i < 8 // Rev 6: the first eight walkers belong to the night market
        };
        this.list.push(ped);
        this.respawn(ped, true);
      }
    },

    respawn: function (ped, anywhere) {
      // Market regulars always (re)spawn inside the market block, so
      // the stalls keep their crowd at any hour (Rev 6).
      if (ped.market) {
        ped.x = -352 + this.rng() * 96;
        ped.z = 74 + this.rng() * 46;
        ped.down = 0; ped.state = 'walk';
        ped.mesh.rotation.x = 0;
        this.pickTarget(ped);
        ped.far = false;
        if (ped.lod) ped.lod.visible = false;
        ped.mesh.visible = true;
        return;
      }
      var g = SH.World.graph;
      var focus = SH.State.player;
      for (var tries = 0; tries < 10; tries++) {
        var node = g.nodes[(this.rng() * g.nodes.length) | 0];
        if (node.overWater) continue; // never spawn a walker mid-bridge
        var x = node.x + (this.rng() - 0.5) * 16, z = node.z + (this.rng() - 0.5) * 16;
        var d = Math.hypot(x - focus.x, z - focus.z);
        if (!anywhere && (d < 50 || d > 300)) continue;
        if (anywhere && d < 25) continue;
        ped.x = x; ped.z = z; ped.down = 0; ped.state = 'walk';
        ped.mesh.rotation.x = 0;
        this.pickTarget(ped);
        ped.far = false;
        if (ped.lod) ped.lod.visible = false;
        ped.mesh.visible = true;
        return;
      }
      ped.mesh.visible = false;
      if (ped.lod) ped.lod.visible = false;
    },

    pickTarget: function (ped) {
      // Market regulars stroll the stall bands (walkway + the gaps
      // between the two tent rows), never leaving the block.
      if (ped.market) {
        var bands = [77, 92, 110];
        // Step to the same or a neighbouring band, so strolls mostly
        // run along the rows instead of cutting through the tents.
        var bi = ped.z < 84 ? 0 : (ped.z < 101 ? 1 : 2);
        bi = Math.max(0, Math.min(2, bi + ((this.rng() * 3) | 0) - 1));
        ped.tx = -352 + this.rng() * 96;
        ped.tz = bands[bi] + (this.rng() - 0.5) * 5;
        return;
      }
      // Walk to a point near another intersection, offset to a sidewalk.
      var g = SH.World.graph;
      var ni = SH.World.nearestNode(ped.x, ped.z);
      var node = g.nodes[ni];
      var ei = node.edges[(this.rng() * node.edges.length) | 0];
      var e = g.edges[ei];
      var other = g.nodes[e.a === ni ? e.b : e.a];
      var off = SH.Config.world.roadHalf + 1.6;
      ped.tx = other.x + (e.vertical ? off : (this.rng() - 0.5) * 4);
      ped.tz = other.z + (e.vertical ? (this.rng() - 0.5) * 4 : off);
    },

    scare: function (x, z, radius) {
      for (var i = 0; i < this.list.length; i++) {
        var ped = this.list[i];
        if (ped.down) continue;
        var d = Math.hypot(ped.x - x, ped.z - z);
        if (d < radius) {
          ped.state = 'panic'; ped.panic = 3 + this.rng() * 2;
          ped.tx = ped.x + (ped.x - x) / (d || 1) * 30;
          ped.tz = ped.z + (ped.z - z) / (d || 1) * 30;
        }
      }
    },

    update: function (dt) {
      var st = SH.State;
      var focus = st.driving ? st.vehiclePos : st.player;
      for (var i = 0; i < this.list.length; i++) {
        var ped = this.list[i];
        var distP = Math.hypot(ped.x - focus.x, ped.z - focus.z);
        if (distP > SH.Config.loop.despawnRadius) { if (st.mode === 'playing') this.respawn(ped, false); continue; }

        if (ped.down > 0) {
          ped.down -= dt;
          ped.mesh.rotation.x = Math.min(Math.PI / 2, ped.mesh.rotation.x + dt * 5);
          if (ped.down <= 0) this.respawn(ped, false);
          continue;
        }

        // Hit by the player's vehicle?
        if (st.driving && st.vehicle && Math.abs(st.vehicle.speed) > 3.5 && distP < 1.5) {
          ped.down = 6;
          if (SH.Police && SH.Police.witnessCrime) SH.Police.witnessCrime('hitPed', ped.x, ped.z);
          if (SH.HUD) SH.HUD.notify('You hit a pedestrian!');
          continue;
        }
        // Near a fast player car, jump aside in panic.
        if (st.driving && Math.abs(st.vehicle.speed) > 9 && distP < 6 && ped.state !== 'panic') {
          ped.state = 'panic'; ped.panic = 1.6;
          ped.tx = ped.x + (ped.x - focus.x) * 2; ped.tz = ped.z + (ped.z - focus.z) * 2;
        }

        var dx = ped.tx - ped.x, dz = ped.tz - ped.z;
        var dist = Math.hypot(dx, dz);
        var speed = ped.state === 'panic' ? 5.6 : 1.5;
        if (ped.state === 'idle') {
          ped.timer -= dt;
          speed = 0;
          if (ped.timer <= 0) { ped.state = 'walk'; this.pickTarget(ped); }
        } else if (dist < 1.6) {
          if (ped.state === 'panic') { ped.state = 'walk'; this.pickTarget(ped); }
          else if (this.rng() < 0.3) { ped.state = 'idle'; ped.timer = 2 + this.rng() * 4; }
          else this.pickTarget(ped);
        }
        if (ped.state === 'panic') { ped.panic -= dt; if (ped.panic <= 0) ped.state = 'walk'; }

        if (speed > 0 && dist > 0.1) {
          ped.heading = Math.atan2(dx / dist, dz / dist);
          ped.x += Math.sin(ped.heading) * speed * dt;
          ped.z += Math.cos(ped.heading) * speed * dt;
          ped.cycle += dt * speed * 2.6;
        }
        // Distance LOD swap (hysteresis 46 m out / 42 m back).
        var wantFar = ped.far ? distP > 42 : distP > 46;
        if (wantFar !== ped.far) {
          ped.far = wantFar;
          ped.mesh.visible = !wantFar;
          if (ped.lod) ped.lod.visible = wantFar;
        }
        var gait = speed > 0 ? 1 : 0;
        if (ped.far) {
          // The baked walker just rides a bob and sway.
          var bobY = Math.abs(Math.sin(ped.cycle * 2.2)) * 0.028 * gait;
          var swayY = ped.heading + Math.sin(ped.cycle * 2.2) * 0.08 * gait;
          if (ped.lod) {
            ped.lod.position.set(ped.x, bobY, ped.z);
            ped.lod.rotation.y = swayY;
          }
          continue;
        }
        // Near figure: the rig does the work — clips carry the gait,
        // the mixer crossfades idle/walk/run by speed (Rev 7). Idle
        // walkers glance around slowly (procedural look layer).
        ped.mesh.position.set(ped.x, 0, ped.z);
        ped.mesh.rotation.y = ped.heading;
        ped.fig.setSpeed(speed / 4.3);
        ped.fig.lookYaw = ped.state === 'idle' ? Math.sin(st.time * 0.4 + i * 1.7) * 0.35 : 0;
        ped.fig.update(dt);
      }
    }
  };

  SH.Pedestrians = Pedestrians;
})(window.SH = window.SH || {});
