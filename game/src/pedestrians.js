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
  //   * hair / hats / glasses are authored into the cloth mesh on the
  //     Head bone (bind-pose world space), ears into the skin mesh.
  // Smoothness pass (ART-BIBLE v4): lathe + rounded-box parts with
  // weld-smoothed normals, per-family materials (cloth sheen / skin
  // wrap-lit / face clearcoat), a blob contact shadow under every
  // figure, and a 512 px feathered face canvas.
  // Proportions follow ART-BIBLE v3: ~5.9 heads at 1.78 m, head 0.30 m,
  // every limb tapered (thigh->knee 0.72x, shin->ankle 0.65x), trapezoid
  // torso with trapezius slope and deltoid caps, belt/collar/shoes as
  // silhouette breakers.
  var faceCache = {};
  function faceTexture(skinColor, variant) {
    var key = skinColor + '_' + variant;
    if (faceCache[key]) return faceCache[key];
    // Smoothness pass (ART-BIBLE v4): the face canvas is 512 px, every
    // feature drawn with feathered edges (radial gradients and round
    // caps, never hard rects), sRGB, linear filtering. The face sits at
    // u = 0.25 on a THREE sphere (the +z meridian), so features are
    // drawn around x = 128; the eye line sits at mid-head and the eyes
    // are ~25% of face height so they survive gameplay distance.
    var cv = document.createElement('canvas'); cv.width = 512; cv.height = 512;
    var c = cv.getContext('2d');
    var col = '#' + ('000000' + skinColor.toString(16)).slice(-6);
    c.fillStyle = col; c.fillRect(0, 0, 512, 512);
    // Soft spherical shading: light pooled at the face centre, gentle
    // darkening toward the wrap so the head reads round even unlit.
    var faceGlow = c.createRadialGradient(128, 245, 30, 128, 262, 190);
    faceGlow.addColorStop(0, 'rgba(255,235,210,0.13)');
    faceGlow.addColorStop(0.55, 'rgba(255,235,210,0)');
    faceGlow.addColorStop(1, 'rgba(30,10,0,0.16)');
    c.fillStyle = faceGlow; c.fillRect(0, 0, 512, 512);
    var grad = c.createLinearGradient(0, 0, 512, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.15)');
    grad.addColorStop(0.25, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.15)');
    grad.addColorStop(0.75, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.15)');
    c.fillStyle = grad; c.fillRect(0, 0, 512, 512);
    function ellipse(x, y, rx, ry, fill) {
      c.fillStyle = fill; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill();
    }
    function softDot(x, y, r, inner, outer) {
      var rg = c.createRadialGradient(x, y, r * 0.15, x, y, r);
      rg.addColorStop(0, inner); rg.addColorStop(1, outer);
      c.fillStyle = rg; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    softDot(74, 330, 34, 'rgba(255,110,80,0.13)', 'rgba(255,110,80,0)');   // cheeks
    softDot(182, 330, 34, 'rgba(255,110,80,0.13)', 'rgba(255,110,80,0)');
    c.strokeStyle = '#241a12'; c.lineCap = 'round'; c.lineWidth = 15;      // brows
    c.beginPath(); c.moveTo(68, 204); c.quadraticCurveTo(92, 194, 114, 202); c.stroke();
    c.beginPath(); c.moveTo(142, 202); c.quadraticCurveTo(164, 194, 188, 204); c.stroke();
    // Eyes: a thin sclera crescent around a LARGE dark iris — at
    // gameplay distance the dark mass is what reads, not the white.
    // Rows follow the composite skull's anatomy (spherical UV
    // reprojection around the head centre): eyes at mid-head
    // (canvas ~230), nostrils ~318, mouth at 2/3 (~360).
    [92, 164].forEach(function (ex) {
      ellipse(ex, 230, 16, 20.5, '#f3ead9');
      ellipse(ex, 231, 11, 16, '#2a180e');
      ellipse(ex, 232, 6, 9, '#120a06');
      ellipse(ex + 4.5, 222, 3.8, 3.8, 'rgba(255,255,255,0.92)');
      ellipse(ex - 4, 240, 2.2, 2.2, 'rgba(255,255,255,0.5)');
    });
    c.strokeStyle = 'rgba(255,255,255,0.10)'; c.lineWidth = 11;            // nose bridge light
    c.beginPath(); c.moveTo(128, 254); c.lineTo(127, 292); c.stroke();
    // (No painted nose shadow any more: the geometry nose shades
    // itself now, and the old dark stroke read as a carrot line.)
    ellipse(115, 318, 5.5, 3.6, 'rgba(40,20,10,0.35)');
    ellipse(141, 318, 5.5, 3.6, 'rgba(40,20,10,0.35)');
    c.strokeStyle = '#6e3524'; c.lineWidth = 9.5; c.lineCap = 'round';
    if (variant === 1) {                               // flat, serious
      c.beginPath(); c.moveTo(106, 362); c.lineTo(150, 362); c.stroke();
    } else if (variant === 2) {                        // grin
      c.fillStyle = '#5e2a1c'; c.beginPath(); c.ellipse(128, 358, 26, 18, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#f5ede2';
      c.beginPath(); c.moveTo(107, 346); c.lineTo(149, 346); c.lineTo(146, 359); c.lineTo(110, 359); c.closePath(); c.fill();
    } else {                                           // easy smile
      c.beginPath(); c.arc(128, 344, 24, Math.PI * 0.18, Math.PI * 0.82); c.stroke();
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
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

  // ---- smoothness pass helpers (ART-BIBLE v4) ---------------------------
  // Weld-by-position smooth normals: face normals are accumulated over
  // every vertex sharing a position (tolerance 1e-4) — the mesh-level
  // half of the v4 weld recipe (drop normals, mergeVertices, recompute),
  // applied to the custom lathe / rounded-box parts whose duplicated
  // seam and face verts would otherwise shade as hard facets.
  function smoothByPosition(geo) {
    var g = geo.index ? geo.toNonIndexed() : geo;
    var pos = g.attributes.position, n = pos.count, i, f;
    var keys = new Array(n), map = {};
    for (i = 0; i < n; i++) {
      keys[i] = Math.round(pos.getX(i) * 10000) + '_' + Math.round(pos.getY(i) * 10000) + '_' + Math.round(pos.getZ(i) * 10000);
    }
    var pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
    var cb = new THREE.Vector3(), ab = new THREE.Vector3();
    for (f = 0; f < n; f += 3) {
      pA.fromBufferAttribute(pos, f); pB.fromBufferAttribute(pos, f + 1); pC.fromBufferAttribute(pos, f + 2);
      cb.subVectors(pC, pB); ab.subVectors(pA, pB); cb.cross(ab);
      for (i = 0; i < 3; i++) {
        var a = map[keys[f + i]] || (map[keys[f + i]] = [0, 0, 0]);
        a[0] += cb.x; a[1] += cb.y; a[2] += cb.z;
      }
    }
    var nor = new Float32Array(n * 3);
    for (i = 0; i < n; i++) {
      var a2 = map[keys[i]], l = Math.hypot(a2[0], a2[1], a2[2]) || 1;
      nor[i * 3] = a2[0] / l; nor[i * 3 + 1] = a2[1] / l; nor[i * 3 + 2] = a2[2] / l;
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return g;
  }
  // Tapered limb/torso stock: a lathe profile [[radius, y], ...] from
  // bottom pole to top pole — rounded caps, real taper, no 90-degree
  // cylinder rims anywhere on the body.
  function lathe(profile, radial) {
    var pts = [];
    for (var i = 0; i < profile.length; i++) pts.push(new THREE.Vector2(profile[i][0], profile[i][1]));
    return smoothByPosition(new THREE.LatheGeometry(pts, radial || 18));
  }
  // Rounded box (the v4 "single biggest jump from programmer art"):
  // a subdivided box whose verts are pushed onto the rounded shell.
  function roundedBox(w, h, d, r, seg) {
    var geo = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
    var pos = geo.attributes.position;
    var ix = Math.max(0.001, w / 2 - r), iy = Math.max(0.001, h / 2 - r), iz = Math.max(0.001, d / 2 - r);
    var v = new THREE.Vector3();
    for (var i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      var qx = clampN(v.x, -ix, ix), qy = clampN(v.y, -iy, iy), qz = clampN(v.z, -iz, iz);
      var dx = v.x - qx, dy = v.y - qy, dz = v.z - qz, l = Math.hypot(dx, dy, dz);
      if (l > 1e-6) pos.setXYZ(i, qx + dx * r / l, qy + dy * r / l, qz + dz * r / l);
    }
    return smoothByPosition(geo);
  }
  // NVIDIA-style wrap lighting for skin (v4: wrap 0.25-0.5 kills the
  // hard terminator): one shared patcher, one wrap value, so every
  // patched material compiles the identical program.
  // The composite head (cranium + jaw + chin + cheeks + nose) is
  // several primitives, none of which carries the right face UVs on
  // its own. Reproject every vertex spherically around the head
  // centre using THREE.SphereGeometry's own convention (u from
  // atan2(z, -x), v from the polar angle), so the painted face lands
  // on the anatomy — eyes at mid-head, nose at 1/2, mouth at 2/3 —
  // no matter which part a vertex belongs to.
  var HEAD_CY = 1.715; // bind-pose head centre height
  function remapFaceUV(geo) {
    var pos = geo.attributes.position, uv = geo.attributes.uv;
    if (!uv) return geo;
    for (var i = 0; i < pos.count; i++) {
      var dx = pos.getX(i), dy = pos.getY(i) - HEAD_CY, dz = pos.getZ(i);
      var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      var theta = Math.acos(clampN(dy / len, -1, 1));
      var u = Math.atan2(dz, -dx) / (Math.PI * 2);
      if (u < 0) u += 1;
      uv.setXY(i, u, 1 - theta / Math.PI);
    }
    uv.needsUpdate = true;
    return geo;
  }
  function applyWrapShader(shader) {
    var needle = 'saturate( dot( geometryNormal, directLight.direction ) )';
    var soft = 'saturate( ( dot( geometryNormal, directLight.direction ) + 0.35 ) / 1.35 )';
    shader.fragmentShader = shader.fragmentShader.split(needle).join(soft);
  }
  // Contact shadow (v4: mandatory): one shared radial-gradient disc,
  // alpha 0.45 at the centre, ridden under every figure so feet meet
  // the ground instead of floating over the shadow map's soft edge.
  var blobGeoShared = null, blobMatShared = null;
  function blobMesh() {
    if (!blobGeoShared) {
      var cv = document.createElement('canvas'); cv.width = cv.height = 128;
      var c2 = cv.getContext('2d');
      var rg = c2.createRadialGradient(64, 64, 4, 64, 64, 64);
      rg.addColorStop(0, 'rgba(0,0,0,0.45)'); rg.addColorStop(0.7, 'rgba(0,0,0,0.28)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      c2.fillStyle = rg; c2.fillRect(0, 0, 128, 128);
      blobGeoShared = new THREE.CircleGeometry(0.46, 24);
      blobGeoShared.rotateX(-Math.PI / 2);
      blobMatShared = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false });
    }
    var m = new THREE.Mesh(blobGeoShared, blobMatShared);
    m.position.y = 0.03;
    m.renderOrder = 2;
    m.userData.noLOD = true; // the far-LOD bake must not swallow the disc
    return m;
  }

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
    // Mannequin-reference proportions: the figure is stretched to
    // ~6.2 heads by LENGTHENING THE LEGS (hips 1.03, thigh 0.47,
    // shin 0.46) — the head keeps its bible size; the extra leg is
    // what buys the slenderness.
    bone('Hips', null, 0, 1.03, 0);
    bone('Spine', bones.Hips, 0, 0.10, 0);
    bone('Chest', bones.Spine, 0, 0.16, 0);
    bone('Neck', bones.Chest, 0, 0.26, 0);
    bone('Head', bones.Neck, 0, 0.05, 0);
    bone('ShoulderL', bones.Chest, -0.09, 0.20, 0);
    bone('UpperArmL', bones.ShoulderL, -0.10, 0, 0, -AZ);
    bone('ForeArmL', bones.UpperArmL, 0, -0.28, 0);
    bone('HandL', bones.ForeArmL, 0, -0.27, 0);
    bone('ShoulderR', bones.Chest, 0.09, 0.20, 0);
    bone('UpperArmR', bones.ShoulderR, 0.10, 0, 0, AZ);
    bone('ForeArmR', bones.UpperArmR, 0, -0.28, 0);
    bone('HandR', bones.ForeArmR, 0, -0.27, 0);
    bone('UpLegL', bones.Hips, -0.10, -0.03, 0);
    bone('ShinL', bones.UpLegL, 0, -0.47, 0);
    bone('FootL', bones.ShinL, 0, -0.46, 0);
    bone('UpLegR', bones.Hips, 0.10, -0.03, 0);
    bone('ShinR', bones.UpLegR, 0, -0.47, 0);
    bone('FootR', bones.ShinR, 0, -0.46, 0);
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
    function part(geo, boneName, colorHex, matrix, ao) {
      if (matrix) geo.applyMatrix4(matrix);
      var n = geo.attributes.position.count;
      var col = new THREE.Color(colorHex);
      var cols = new Float32Array(n * 3);
      var si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      var idx = boneIndex[boneName];
      var posA = geo.attributes.position;
      var aoF = ao || 1;
      for (var i = 0; i < n; i++) {
        // v4 vertex colour: a vertical gradient settling to 0.86 at
        // the ground (grounds the figure, fakes soft AO under the
        // body mass) times the part's crease factor — joint balls are
        // authored darker so the seams read as folds, not gaps.
        var shade = (0.86 + 0.14 * clampN(posA.getY(i) / 1.1, 0, 1)) * aoF;
        cols[i * 3] = col.r * shade; cols[i * 3 + 1] = col.g * shade; cols[i * 3 + 2] = col.b * shade;
        si[i * 4] = idx; sw[i * 4] = 1;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      return geo;
    }
    // Smoothness pass: the body is authored as lathe stock and rounded
    // boxes (never raw cylinders/boxes), split into a SKIN list and a
    // CLOTH list so each material family carries its own v4 roughness.
    // Every part sinks 15-30% of its radius into its neighbour and a
    // ball rides every joint, so no seam ever opens mid-stride.
    var sleeveSkin = opts.sleeves === 'short';
    var thighSkin = bottom === 'skirt';
    var shinSkin = bottom !== 'pants';
    var shoeColor = opts.shoe != null ? opts.shoe : 0xe8e6da;
    var skinGeos = [], clothGeos = [];
    function push(list, geo, boneName, colorHex, matrix, ao) { list.push(part(geo, boneName, colorHex, matrix, ao)); }
    // Pelvis + belt (Hips), waist (Spine), chest + trapezius (Chest).
    // The pelvis is its OWN piece (mannequin reference): a hip-bulge
    // lathe in the pants colour, a dark belt ring proud of both
    // neighbours at the junction, then the waist lathe starting
    // visibly narrower (0.125 against the pelvis' 0.186) so the torso
    // never runs straight down into the legs.
    push(clothGeos, lathe([[0, -0.10], [0.115, -0.096], [0.155, -0.06], [0.172, 0], [0.184, 0.06], [0.186, 0.096], [0, 0.10]], 18), 'Hips', bottom === 'skirt' ? shirtColor : pantsColor, M(0, 1.05, 0, 0, 0, 0, 1, 1, 0.68));
    if (bottom === 'skirt') push(clothGeos, lathe([[0, -0.18], [0.19, -0.175], [0.25, -0.10], [0.265, 0.02], [0.20, 0.14], [0.165, 0.175], [0, 0.18]], 18), 'Hips', pantsColor, M(0, 0.91, 0));
    push(clothGeos, lathe([[0, -0.026], [0.158, -0.022], [0.166, 0], [0.158, 0.022], [0, 0.026]], 18), 'Hips', darkColor, M(0, 1.205, 0, 0, 0, 0, 1, 1, 0.68), 0.92);
    // Torso loft (body-shape addendum, measured off the mannequin
    // comparison): waist narrowest 0.140 = 0.61x the chest's 0.230,
    // pelvis 0.186 = 0.81x the chest — a continuous narrowing loft,
    // never three same-width blocks stacked.
    push(clothGeos, lathe([[0, -0.09], [0.140, -0.086], [0.146, -0.05], [0.148, 0], [0.154, 0.05], [0.162, 0.086], [0, 0.09]], 18), 'Spine', shirtColor, M(0, 1.22, 0, 0, 0, 0, 1, 1, 0.68));
    push(clothGeos, lathe([[0, -0.18], [0.148, -0.174], [0.168, -0.13], [0.186, -0.04], [0.205, 0.05], [0.226, 0.13], [0.230, 0.172], [0, 0.18]], 18), 'Chest', shirtColor, M(0, 1.37, 0, 0, 0, 0, 1, 1, 0.68));
    // Trapezius SLOPE, not a ring: radius falls steadily from 0.20
    // at the chest to 0.07 at the neck, so the shoulder line angles
    // down from the neck and the deltoid caps land IN the slope.
    push(clothGeos, lathe([[0, -0.062], [0.185, -0.058], [0.20, -0.03], [0.175, 0.005], [0.135, 0.035], [0.095, 0.055], [0.07, 0.064], [0, 0.068]], 18), 'Chest', shirtColor, M(0, 1.53, 0, 0, 0, 0, 1, 1, 0.68));
    if (opts.jacket) {
      push(clothGeos, roundedBox(0.05, 0.32, 0.03, 0.012, 1), 'Chest', darkColor, M(0, 1.36, 0.125));
      push(clothGeos, lathe([[0, -0.04], [0.10, -0.036], [0.135, -0.01], [0.14, 0.03], [0, 0.04]], 14), 'Chest', darkColor, M(0, 1.55, 0, 0, 0, 0, 1, 1, 0.7));
    }
    // Slimmer neck (v4 softening: -30-50%) as an explicit-segment
    // capsule, sunk into the trapezius below and the head above.
    push(skinGeos, new THREE.CapsuleGeometry(0.046, 0.05, 6, 14), 'Neck', skinColor, M(0, 1.57, 0));
    // Ears: small flattened spheres riding the Head bone inside the
    // skin mesh, at the narrower composite head's sides.
    push(skinGeos, new THREE.SphereGeometry(0.037, 12, 9), 'Head', skinColor, M(-0.117, 1.715, 0, 0, 0, 0, 0.6, 1, 0.85));
    push(skinGeos, new THREE.SphereGeometry(0.037, 12, 9), 'Head', skinColor, M(0.117, 1.715, 0, 0, 0, 0, 0.6, 1, 0.85));
    // Arms — authored along the A-pose direction from the shoulder:
    // deltoid cap sunk into the chest, tapered lathe upper arm, elbow
    // ball, tapered forearm (wrist ~0.79x elbow), rounded hand +20%.
    function armParts(side) { // side: -1 = left (-x), +1 = right (+x)
      var sx = 0.19 * side;
      var rz = AZ * side;
      // Direction the arm points in bind pose: (0,-1,0) rotated by rz
      // around Z. Left (rz=-0.73): (-0.667, -0.745) — down and outward.
      var dX = Math.sin(rz);
      var dY = -Math.cos(rz);
      var ex = sx + dX * 0.28, ey = 1.49 + dY * 0.28;
      var upB = side < 0 ? 'UpperArmL' : 'UpperArmR', foB = side < 0 ? 'ForeArmL' : 'ForeArmR';
      var delt = new THREE.SphereGeometry(0.070, 14, 10);
      delt.scale(1.06, 0.82, 1.06);
      push(clothGeos, delt, upB, shirtColor, M(sx, 1.50, 0));
      var upList = sleeveSkin ? skinGeos : clothGeos;
      // One continuous taper the whole way down (body-shape
      // addendum): upper arm 0.048 at the shoulder to 0.034 at the
      // elbow, forearm 0.039 to a 0.026 wrist = 0.54x the upper arm.
      // The elbow ball (0.046) stays PROUD of both segments so the
      // joint reads as a ball, not a pinch.
      push(upList, lathe([[0, -0.14], [0.034, -0.136], [0.038, -0.10], [0.041, -0.02], [0.044, 0.06], [0.047, 0.12], [0.048, 0.138], [0, 0.14]], 16).translate(0, -0.14, 0), upB, sleeveSkin ? skinColor : shirtColor, M(sx, 1.49, 0, 0, 0, rz));
      push(skinGeos, new THREE.SphereGeometry(0.046, 14, 10), foB, skinColor, M(ex, ey, 0), 0.88);
      push(skinGeos, lathe([[0, -0.135], [0.026, -0.13], [0.029, -0.09], [0.032, -0.01], [0.036, 0.07], [0.038, 0.12], [0.039, 0.133], [0, 0.135]], 16).translate(0, -0.135, 0), foB, skinColor, M(ex, ey, 0, 0, 0, rz));
      // A real HAND, not a paddle: palm plus four capsule fingers
      // with silhouette gaps between them and an angled thumb, all
      // merged into the forearm's skin list (zero extra draw calls).
      // Fingers rest at a natural 12-20-degree curl, longest in the
      // middle; the whole hand keeps the bible's +20% oversize.
      var wristM = M(ex + dX * 0.28, ey + dY * 0.28, 0, 0, 0, rz);
      push(skinGeos, roundedBox(0.072, 0.078, 0.036, 0.016, 2).translate(0, -0.046, 0), foB, skinColor, wristM);
      var fLen = [0.030, 0.035, 0.031, 0.024], fBend = [0.21, 0.28, 0.31, 0.35];
      for (var fi = 0; fi < 4; fi++) {
        var fg = new THREE.CapsuleGeometry(0.0078, fLen[fi], 3, 8);
        fg.translate(0, -fLen[fi] / 2 - 0.004, 0);
        fg.rotateX(fBend[fi]);
        fg.translate(-0.027 + fi * 0.018, -0.082, 0.001);
        push(skinGeos, fg, foB, skinColor, wristM);
      }
      var th = new THREE.CapsuleGeometry(0.0095, 0.024, 3, 8);
      th.translate(0, -0.016, 0);
      th.rotateX(0.35);
      th.rotateZ(side * 0.6);
      th.translate(-side * 0.034, -0.040, 0.006);
      push(skinGeos, th, foB, skinColor, wristM);
    }
    armParts(-1); armParts(1);
    // Legs: thigh tapers to 0.66x at the knee, shin to 0.58x at the
    // ankle with a real calf mass behind it; shoes are two-tone
    // rounded boxes (+25% over the old wedge) in a light warm tone
    // that survives dark ground — the old black wedge vanished on it.
    function legParts(side) {
      var sx = 0.10 * side;
      var bn = side < 0 ? 'L' : 'R';
      var thList = thighSkin ? skinGeos : clothGeos, shList = shinSkin ? skinGeos : clothGeos;
      var thCol = thighSkin ? skinColor : pantsColor, shCol = shinSkin ? skinColor : pantsColor;
      // Bold-end bible tapers on the lengthened leg: thigh 0.080 at
      // the hip to 0.049 at the knee (0.61x), shin 0.053 to a 0.029
      // ankle (0.55x). Joint balls stay PROUD of the tapers — hip
      // 0.072, knee 0.060, ankle 0.042 — so the articulation reads
      // like the mannequin reference instead of melting away.
      push(thList, new THREE.SphereGeometry(0.072, 14, 10), 'UpLeg' + bn, thCol, M(sx, 0.99, 0), 0.9);
      push(thList, lathe([[0, -0.235], [0.049, -0.228], [0.058, -0.18], [0.062, -0.06], [0.068, 0.06], [0.076, 0.16], [0.080, 0.21], [0.081, 0.23], [0, 0.235]], 16), 'UpLeg' + bn, thCol, M(sx, 0.765, 0));
      push(shList, new THREE.SphereGeometry(0.060, 14, 10), 'Shin' + bn, shCol, M(sx, 0.53, 0.004), 0.88);
      // The calf is its OWN segment (body-shape addendum): the shin
      // lathe stays slim (0.031-0.034 through the lower half) and the
      // calf ellipsoid carries the muscle, peaking in the upper
      // third and standing proud of the lathe behind and at the
      // sides; below it the leg falls hard to a 0.024 ankle — 0.52x
      // the calf's max width.
      push(shList, lathe([[0, -0.23], [0.024, -0.224], [0.026, -0.18], [0.029, -0.08], [0.032, 0.02], [0.038, 0.12], [0.047, 0.19], [0.052, 0.222], [0, 0.23]], 16), 'Shin' + bn, shCol, M(sx, 0.30, 0));
      var calf = new THREE.SphereGeometry(0.052, 14, 10);
      calf.scale(0.88, 1.5, 0.95);
      push(shList, calf, 'Shin' + bn, shCol, M(sx, 0.42, -0.016));
      push(shList, new THREE.SphereGeometry(0.042, 12, 9), 'Shin' + bn, shCol, M(sx, 0.10, 0.005), 0.88);
      // Shoes follow the mannequin foot: flat, elongated, narrowing
      // to the toe (a low scaled sphere caps the upper) — never a
      // block. Two-tone with the light upper kept for dark ground.
      push(clothGeos, roundedBox(0.128, 0.03, 0.335, 0.013, 2), 'Foot' + bn, 0x26262c, M(sx, 0.016, 0.052, 0.05, 0, 0), 0.9);
      push(clothGeos, roundedBox(0.118, 0.075, 0.29, 0.03, 3), 'Foot' + bn, shoeColor, M(sx, 0.056, 0.030, 0.05, 0, 0));
      var toe = new THREE.SphereGeometry(0.05, 12, 9);
      toe.scale(1.05, 0.52, 1.25);
      push(clothGeos, toe, 'Foot' + bn, shoeColor, M(sx, 0.042, 0.155, 0.05, 0, 0));
    }
    legParts(-1); legParts(1);
    // Hair, hats and glasses are authored straight into the cloth mesh
    // on the Head bone (bind-pose world space, the ears' old trick) —
    // one draw call per figure cheaper than the old rigid attachments.
    // HAIR WITH AN ACTUAL CUT (user: "rambut gada keren2 nya"). Each
    // style is a shaped shell fitted to the composite cranium (centre
    // 1.75, radii 0.12/0.147/0.129) plus its signature pieces — fringe
    // line and faded sides for the crop, a swept wedge, spikes, a
    // ponytail, a bun, shoulder-length panels. All authored into the
    // cloth mesh on the Head bone: zero extra draw calls. Hats stay
    // accessories — a hat wearer still shows a crop under the brim.
    var hairStyle = opts.hairStyle || 'crop';
    function hairShell(theta, shrink) {
      var s = shrink || 1;
      push(clothGeos, new THREE.SphereGeometry(0.15, 24, 16, 0, Math.PI * 2, 0, theta), 'Head', hairColor, M(0, 1.758, -0.008, 0, 0, 0, 0.87 * s, 1.03 * s, 0.94 * s));
    }
    function fadeSides(y) {
      // Kept THIN and tight to the skull: the first cut (0.024 x
      // 0.085 x 0.15) read as black slabs floating off the head.
      push(clothGeos, roundedBox(0.018, 0.06, 0.11, 0.008, 1), 'Head', hairColor, M(-0.118, y, -0.01));
      push(clothGeos, roundedBox(0.018, 0.06, 0.11, 0.008, 1), 'Head', hairColor, M(0.118, y, -0.01));
    }
    if (hairStyle === 'hat') {
      var hatColor = opts.hatColor != null ? opts.hatColor : 0x22242c;
      fadeSides(1.70);
      push(clothGeos, roundedBox(0.19, 0.075, 0.024, 0.010, 1), 'Head', hairColor, M(0, 1.70, -0.126));
      push(clothGeos, new THREE.CylinderGeometry(0.20, 0.20, 0.02, 20), 'Head', hatColor, M(0, 1.81, 0));
      push(clothGeos, new THREE.CylinderGeometry(0.135, 0.148, 0.10, 20), 'Head', hatColor, M(0, 1.855, 0));
    } else if (hairStyle === 'bald') {
      // no shell at all
    } else if (hairStyle === 'buzz') {
      hairShell(1.38, 0.965); // cepak: a thin shell hugging the skull
    } else if (hairStyle === 'spiky') {
      hairShell(1.02);
      var spikeAt = [[-0.058, 1.898, 0.0, 0, 0.25], [-0.018, 1.922, 0.028, -0.15, 0], [0.026, 1.918, -0.008, 0, 0], [0.062, 1.892, 0.018, 0, -0.3], [0.0, 1.912, -0.042, 0.2, 0]];
      for (var sp = 0; sp < spikeAt.length; sp++) push(clothGeos, new THREE.ConeGeometry(0.019, 0.055, 6), 'Head', hairColor, M(spikeAt[sp][0], spikeAt[sp][1], spikeAt[sp][2], spikeAt[sp][3], 0, spikeAt[sp][4]));
    } else if (hairStyle === 'sweep') {
      hairShell(1.28);
      push(clothGeos, roundedBox(0.21, 0.038, 0.05, 0.014, 1), 'Head', hairColor, M(0.012, 1.828, 0.086, -0.22, 0, 0.07));
    } else if (hairStyle === 'ponytail') {
      hairShell(1.26);
      push(clothGeos, new THREE.SphereGeometry(0.034, 12, 9), 'Head', darkColor, M(0, 1.775, -0.122));
      push(clothGeos, new THREE.CapsuleGeometry(0.027, 0.15, 4, 10), 'Head', hairColor, M(0, 1.655, -0.145, 0.22, 0, 0));
    } else if (hairStyle === 'bun') {
      hairShell(1.26);
      push(clothGeos, new THREE.SphereGeometry(0.066, 14, 10), 'Head', hairColor, M(0, 1.848, -0.072));
    } else if (hairStyle === 'long') {
      hairShell(1.32);
      push(clothGeos, roundedBox(0.225, 0.37, 0.05, 0.024, 2), 'Head', hairColor, M(0, 1.545, -0.115));
      push(clothGeos, roundedBox(0.026, 0.20, 0.045, 0.011, 1), 'Head', hairColor, M(-0.118, 1.63, 0.015));
      push(clothGeos, roundedBox(0.026, 0.20, 0.045, 0.011, 1), 'Head', hairColor, M(0.118, 1.63, 0.015));
    } else if (hairStyle === 'mohawk') {
      push(clothGeos, roundedBox(0.045, 0.115, 0.27, 0.018, 2), 'Head', hairColor, M(0, 1.878, -0.005));
    } else { // 'crop' (and the legacy 'cap'): Raka's cut
      hairShell(1.22);
      push(clothGeos, roundedBox(0.20, 0.034, 0.028, 0.012, 1), 'Head', hairColor, M(0, 1.818, 0.096, -0.18, 0, 0)); // fringe line
      fadeSides(1.695);
    }
    if (opts.glasses) push(clothGeos, roundedBox(0.24, 0.055, 0.02, 0.009, 1), 'Head', darkColor, M(0, 1.732, 0.128));

    // v4 materials — one roughness per family, never one for all
    // (that was the plastic look): cloth is a sheened physical
    // material at 0.9, skin a wrap-lit standard material at 0.62, the
    // face a clearcoat physical material at 0.55 whose coat makes the
    // painted eyes read wet. All three drink from the PMREM sky
    // environment at ~0.5 (v4 band 0.4-0.7), which also throws the
    // cool rim edge off hair and shoulders.
    var clothMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0, sheen: 0.6, sheenColor: new THREE.Color(0x777777), sheenRoughness: 0.5, envMapIntensity: 0.5 });
    var skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.0, envMapIntensity: 0.55 });
    skinMat.onBeforeCompile = applyWrapShader;
    var headMat = new THREE.MeshPhysicalMaterial({ map: faceTexture(skinColor, opts.face || 0), roughness: 0.55, metalness: 0.0, clearcoat: 0.5, clearcoatRoughness: 0.55, envMapIntensity: 0.5 });
    headMat.onBeforeCompile = applyWrapShader;
    var clothMesh = new THREE.SkinnedMesh(SH.World.mergeGeos(clothGeos), clothMat);
    var skinMesh = new THREE.SkinnedMesh(SH.World.mergeGeos(skinGeos), skinMat);
    // THE HEAD IS A SKULL, NOT A BALL (user: "bisa bentuk kepala
    // orang normal ga sih?"): an egg cranium (0.24 wide x 0.294 tall
    // x 0.258 deep), a narrower jaw sphere tapering to a chin block,
    // filled cheeks and a real nose — capsule bridge plus tip ball —
    // whose silhouette reads from the 3/4 view. Every part is
    // UV-reprojected spherically around the head centre (see
    // remapFaceUV) so the painted face stays on the anatomy.
    var headGeos = [];
    function hpush(geo, matrix) { var hp = part(geo, 'Head', skinColor, matrix); remapFaceUV(hp); headGeos.push(hp); }
    hpush(new THREE.SphereGeometry(0.15, 28, 20), M(0, 1.75, -0.005, 0, 0, 0, 0.80, 0.98, 0.86));
    hpush(new THREE.SphereGeometry(0.15, 24, 16), M(0, 1.633, 0.016, 0, 0, 0, 0.64, 0.60, 0.70));
    hpush(roundedBox(0.085, 0.07, 0.07, 0.028, 2), M(0, 1.563, 0.038));
    hpush(new THREE.SphereGeometry(0.040, 14, 10), M(-0.055, 1.652, 0.052, 0, 0, 0, 1.0, 0.72, 0.72));
    hpush(new THREE.SphereGeometry(0.040, 14, 10), M(0.055, 1.652, 0.052, 0, 0, 0, 1.0, 0.72, 0.72));
    hpush(new THREE.CapsuleGeometry(0.0135, 0.016, 4, 10), M(0, 1.662, 0.112, 0.38, 0, 0));
    hpush(new THREE.SphereGeometry(0.0145, 12, 9), M(0, 1.650, 0.120, 0, 0, 0, 1, 0.85, 0.8));
    var headGeo = SH.World.mergeGeos(headGeos);
    var headMesh = new THREE.SkinnedMesh(headGeo, headMat);
    g.updateMatrixWorld(true); // bind inverses need true bind-pose worlds
    var skeleton = new THREE.Skeleton(boneList);
    clothMesh.add(bones.Hips);
    clothMesh.bind(skeleton);
    skinMesh.bind(skeleton);
    headMesh.bind(skeleton);
    clothMesh.castShadow = true;
    skinMesh.castShadow = true;
    headMesh.castShadow = true;
    clothMesh.frustumCulled = false;
    skinMesh.frustumCulled = false;
    headMesh.frustumCulled = false;
    g.add(clothMesh);
    g.add(skinMesh);
    g.add(headMesh);
    g.add(blobMesh());

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
    [clothMesh, skinMesh, headMesh].forEach(function (mm) {
      var gi = mm.geometry;
      tris += (gi.index ? gi.index.count : gi.attributes.position.count) / 3;
    });

    var fig = {
      group: g,
      bones: bones,
      mixer: mixer,
      actions: actions,
      shirtMat: clothMat, // per-figure materials: combat hit-flash targets
      skinMat: skinMat,
      headMat: headMat,
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
  // Hair palette per the user's direction: black, dark browns, one
  // grey, one dark blonde. Styles: seven real cuts in rotation.
  var hairColors = [0x14100c, 0x241608, 0x3a2415, 0x8a8578, 0x77603c, 0x14100c];
  var hairStyles = ['crop', 'sweep', 'spiky', 'buzz', 'ponytail', 'bun', 'long', 'mohawk', 'bald', 'crop', 'sweep', 'long'];

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
    if (!lodMatShared) lodMatShared = new THREE.MeshLambertMaterial({ vertexColors: true });
    built.group.updateMatrixWorld(true);
    var geos = [];
    built.group.traverse(function (o) {
      if (!o.isMesh) return;
      if (o.userData && o.userData.noLOD) return; // contact-shadow disc stays behind
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
