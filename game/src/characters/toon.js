// SELATARA HEAT — characters/toon.js  (Character System, TOON REBUILD)
// The ONE human system. Every character is a chunky flat low-poly
// figure built from THREE.Group pivots (no bones, no skinning, no
// external models), shaded with MeshToonMaterial over a shared
// 3-step gradient map, flat colours only (max 5 per character),
// a thin dark inverted-hull outline, a blob shadow under the feet
// and a geometric face whose eyes / brows / mouth carry the
// expressions. Animation is procedural: keyframed pose tables +
// analytic gaits, crossfaded and smoothed every frame.
//
// Public API (Bos spec 2026-11-22):
//   SH.ToonChar.createCharacter(config) -> { root, update(dt, state),
//     setExpression(name) }
//   config: { height, build ('slim'|'avg'|'stocky'|'kid'), skin,
//     top, bottom, shoe, hat ('none'|'beanie'|'cap'|'helmet'|'police'
//     + game variants), hair, backpack, accessory }
//   SH.ToonChar.spawnPedestrian(seed) -> a crowd character built
//     from curated palettes (6-8 body types, seeded).
// The legacy factory (factory.js) and animation controller
// (animation.js) are thin adapters over this module, so missions /
// police / combat / pedestrians keep their existing contracts.
(function (SH) {
  'use strict';

  var DEG = Math.PI / 180;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }

  // ---- shared toon shading ------------------------------------------------
  // 3-step gradient map shared by every toon material in the game.
  var gradientMap = (function () {
    var steps = [96, 168, 255], data = new Uint8Array(steps.length * 4);
    for (var i = 0; i < steps.length; i++) {
      data[i * 4] = steps[i]; data[i * 4 + 1] = steps[i]; data[i * 4 + 2] = steps[i]; data[i * 4 + 3] = 255;
    }
    var t = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
    t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  })();
  var matCache = {};
  function matFor(hex) {
    if (matCache[hex]) return matCache[hex];
    var m = new THREE.MeshToonMaterial({ color: hex, gradientMap: gradientMap });
    m.toneMapped = false; m.fog = false; // lab/game parity, as the old factory
    matCache[hex] = m; return m;
  }
  var outlineMat = (function () {
    var m = new THREE.MeshBasicMaterial({ color: 0x2a1a12, side: THREE.BackSide });
    m.toneMapped = false; m.fog = false; return m;
  })();
  var blobMat = (function () {
    var cv = document.createElement('canvas'); cv.width = cv.height = 128;
    var c = cv.getContext('2d');
    var g = c.createRadialGradient(64, 64, 6, 64, 64, 62);
    g.addColorStop(0, 'rgba(8,6,4,0.50)'); g.addColorStop(0.7, 'rgba(8,6,4,0.28)'); g.addColorStop(1, 'rgba(8,6,4,0)');
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    var m = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false });
    m.toneMapped = false; m.fog = false; return m;
  })();

  // ---- unit-space metrics (character local height = 1) ---------------------
  // Chunky stylized proportions (Bos spec): the head is about 1/3 of
  // the body height, limbs are short, the neck is short but visible.
  var M = {
    pelvisY: 0.34, ankleY: 0.05, kneeY: 0.18,
    spine1Y: 0.42, spine2Y: 0.52, neckY: 0.62, headY: 0.67,
    headCY: 0.155, headR: 0.19, // head centre / radius, head-pivot local
    shoulderX: 0.135, shoulderDY: 0.045,
    elbowDY: -0.125, handDY: -0.115, hipX: 0.075
  };
  var BUILDS = {
    slim: { w: 0.88, d: 0.90, head: 1.02 },
    avg: { w: 1.00, d: 1.00, head: 1.00 },
    stocky: { w: 1.18, d: 1.22, head: 0.98 },
    kid: { w: 0.92, d: 0.92, head: 1.14 }
  };

  // ---- shared geometries (unit space, one set for every build) -------------
  var geoCache = {};
  function geo(key, make) {
    if (!geoCache[key]) geoCache[key] = make();
    return geoCache[key];
  }
  function box(key, w, h, d) {
    return geo(key, function () { return new THREE.BoxGeometry(w, h, d); });
  }
  var GEO = {
    hips: function () { return box('hips', 0.215, 0.115, 0.13); },
    torso: function () { return box('torso', 0.225, 0.26, 0.13); },
    chest: function () { return box('chest', 0.235, 0.13, 0.14); },
    neck: function () { return geo('neck', function () { return new THREE.CylinderGeometry(0.032, 0.036, 0.06, 8); }); },
    head: function () {
      return geo('head', function () {
        var g = new THREE.SphereGeometry(M.headR, 18, 14);
        g.scale(1, 0.94, 0.96); return g;
      });
    },
    ear: function () { return geo('ear', function () { return new THREE.SphereGeometry(0.035, 8, 6); }); },
    uArm: function () { return box('uarm', 0.062, 0.13, 0.062); },
    fArm: function () { return box('farm', 0.052, 0.115, 0.052); },
    hand: function () { return geo('hand', function () { return new THREE.SphereGeometry(0.034, 10, 8); }); },
    thigh: function () { return box('thigh', 0.088, 0.16, 0.095); },
    shin: function () { return box('shin', 0.072, 0.13, 0.078); },
    shoe: function () { return box('shoe', 0.075, 0.05, 0.19); },
    skirt: function () {
      return geo('skirt', function () {
        return new THREE.CylinderGeometry(0.115, 0.165, 0.17, 10, 1, true);
      });
    },
    eyeWhite: function () { return geo('eyew', function () { var g = new THREE.SphereGeometry(0.026, 10, 8); g.scale(1, 1.15, 0.55); return g; }); },
    pupil: function () { return geo('pupil', function () { return new THREE.SphereGeometry(0.0135, 8, 6); }); },
    glint: function () { return geo('glint', function () { return new THREE.SphereGeometry(0.005, 6, 4); }); },
    brow: function () { return box('brow', 0.052, 0.009, 0.008); },
    nose: function () { return box('nose', 0.018, 0.03, 0.016); },
    mouth: function () { return geo('mouth', function () { return new THREE.TorusGeometry(0.021, 0.0045, 5, 10, 2.0); }); },
    mouthFlat: function () { return box('mouthflat', 0.036, 0.006, 0.006); },
    mouthOpen: function () { return geo('mopen', function () { var g = new THREE.SphereGeometry(0.011, 8, 6); g.scale(1, 1.3, 0.5); return g; }); },
    blush: function () { return geo('blush', function () { var g = new THREE.SphereGeometry(0.02, 8, 6); g.scale(1, 0.7, 0.4); return g; }); }
  };

  // One part mesh + its inverted-hull outline child (BackSide,
  // scale ~1.06, spec). The outline inherits the part's transform.
  function part(parent, geometry, material, x, y, z, outline) {
    var m = new THREE.Mesh(geometry, material);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true;
    if (outline) {
      var o = new THREE.Mesh(geometry, outlineMat);
      o.scale.setScalar(1.06); o.userData.isOutline = true;
      m.add(o);
    }
    parent.add(m);
    return m;
  }

  // ---- face -----------------------------------------------------------------
  // Geometric face on the head pivot: round eyes with a white
  // highlight, thin separated brows, a small nose, a simple mouth.
  // Expressions move brow angle / brow height / eye scale / mouth
  // shape only (Bos spec). Blinking is a per-character timer.
  var EXPRESSIONS = {
    neutral: { browA: 0, browY: 0, eyeY: 1.0, mouth: 'flat' },
    happy: { browA: -4, browY: 0.006, eyeY: 0.62, mouth: 'smile' },
    angry: { browA: 26, browY: -0.004, eyeY: 0.78, mouth: 'frown' },
    scared: { browA: -22, browY: 0.010, eyeY: 1.28, mouth: 'open' },
    hurt: { browA: -14, browY: 0.002, eyeY: 0.30, mouth: 'frown' }
  };
  function buildFace(headPivot, cfg) {
    var cy = M.headCY, face = {};
    var darkMat = matFor(0x241a12), whiteMat = matFor(0xf7f3ea);
    var hairMat = matFor(cfg.hairColor);
    var noseMat = matFor(cfg.skinDark);
    function eye(side) {
      var g = new THREE.Group();
      g.position.set(side * 0.068, cy + 0.02, 0.177);
      var w = new THREE.Mesh(GEO.eyeWhite(), whiteMat); g.add(w);
      var p = new THREE.Mesh(GEO.pupil(), darkMat); p.position.set(0, 0.002, 0.012); g.add(p);
      var gl = new THREE.Mesh(GEO.glint(), whiteMat); gl.position.set(0.006, 0.008, 0.02); g.add(gl);
      headPivot.add(g); return g;
    }
    face.eyeL = eye(1); face.eyeR = eye(-1);
    function brow(side) {
      var g = new THREE.Group();
      g.position.set(side * 0.068, cy + 0.062, 0.173);
      var b = new THREE.Mesh(GEO.brow(), hairMat);
      b.position.x = side * 0.004; g.add(b);
      headPivot.add(g); return g;
    }
    face.browL = brow(1); face.browR = brow(-1);
    face.nose = part(headPivot, GEO.nose(), noseMat, 0, cy - 0.017, 0.179, false);
    face.mouth = part(headPivot, GEO.mouth(), darkMat, 0, cy - 0.052, 0.174, false);
    face.mouthFlat = part(headPivot, GEO.mouthFlat(), darkMat, 0, cy - 0.052, 0.176, false);
    face.mouthOpen = part(headPivot, GEO.mouthOpen(), darkMat, 0, cy - 0.058, 0.172, false);
    face.mouthOpen.visible = false;
    if (cfg.face && cfg.face.mustache) {
      // Small only, and only for the one character who needs it.
      var mm = matFor(cfg.hairColor);
      var m1 = part(headPivot, GEO.brow(), mm, 0.020, cy - 0.036, 0.180, false);
      m1.scale.set(0.62, 1.15, 1); m1.rotation.z = 0.16;
      var m2 = part(headPivot, GEO.brow(), mm, -0.020, cy - 0.036, 0.180, false);
      m2.scale.set(0.62, 1.15, 1); m2.rotation.z = -0.16;
    }
    if (cfg.face && cfg.face.blush) {
      var bm = matFor(0xe88a7a);
      part(headPivot, GEO.blush(), bm, 0.108, cy - 0.038, 0.148, false);
      part(headPivot, GEO.blush(), bm, -0.108, cy - 0.038, 0.148, false);
    }
    return face;
  }
  function applyExpression(face, cur, blink) {
    var eyeY = Math.max(0.06, cur.eyeY * blink);
    face.eyeL.scale.set(1, eyeY, 1); face.eyeR.scale.set(1, eyeY, 1);
    face.browL.rotation.z = -cur.browA * DEG;
    face.browR.rotation.z = cur.browA * DEG;
    face.browL.position.y = face.browR.position.y = M.headCY + 0.062 + cur.browY;
    var mode = cur.mouth;
    face.mouth.visible = mode === 'smile' || mode === 'frown';
    face.mouthFlat.visible = mode === 'flat';
    face.mouthOpen.visible = mode === 'open';
    if (mode === 'smile') { face.mouth.rotation.z = -Math.PI / 2 - 1.0; face.mouth.scale.setScalar(1.15); }
    else if (mode === 'frown') { face.mouth.rotation.z = Math.PI / 2 - 1.0; face.mouth.scale.setScalar(0.9); }
    else { face.mouth.rotation.z = -Math.PI / 2 - 1.0; face.mouth.scale.set(1.6, 0.45, 1); }
  }

  // ---- hair & hats ------------------------------------------------------------
  // One shaped cap shell per style; the rim sits high at the front
  // (brows stay clear), lower at the back, so front / side / back
  // all read as the same haircut. Variants change rim depth, volume
  // and add-ons (bun, ponytail, long back panel, afro volume).
  function hairCap(rad, thetaLen, squash) {
    var key = 'haircap|' + rad.toFixed(3) + '|' + thetaLen.toFixed(2) + '|' + (squash || 0.96);
    return geo(key, function () {
      var g = new THREE.SphereGeometry(rad, 18, 12, 0, Math.PI * 2, 0, thetaLen);
      g.scale(1.02, squash || 0.96, 1.04); return g;
    });
  }
  function buildHair(headPivot, cfg) {
    var style = cfg.hair || 'short';
    if (style === 'bald' || style === 'none') return null;
    var hm = matFor(cfg.hairColor), cy = M.headCY, R = M.headR;
    var grp = new THREE.Group(); headPivot.add(grp);
    function cap(rad, tl, sq, y, z) {
      var m = part(grp, hairCap(rad, tl, sq), hm, 0, cy + (y || 0), z || 0, true);
      // tilt the shell back: the front rim rises above the brows
      // while the back rim drops — one haircut from every angle
      m.rotation.x = -0.42;
      return m;
    }
    if (style === 'hijab') {
      // Cloth shell: bigger sphere swept further down the back and
      // sides, face left open by shifting the shell back, plus a
      // drape panel to the shoulders.
      var shell = part(grp, hairCap(R * 1.13, Math.PI * 0.78, 1.0), hm, 0, cy + 0.012, -0.028, true);
      shell.scale.set(1.05, 1.12, 1.05);
      shell.rotation.x = -0.25;
      part(grp, box('drape', 0.30, 0.24, 0.05), hm, 0, cy - 0.16, -0.155, true);
      return grp;
    }
    switch (style) {
      case 'buzz': cap(R * 1.03, Math.PI * 0.46, 0.94, 0.012); break;
      case 'slick': cap(R * 1.05, Math.PI * 0.52, 0.90, 0.014, -0.008); break;
      case 'quiff': cap(R * 1.06, Math.PI * 0.54, 0.98, 0.018); break;
      case 'undercut': cap(R * 1.05, Math.PI * 0.44, 0.96, 0.016); break;
      case 'messy': cap(R * 1.09, Math.PI * 0.58, 1.0, 0.014); break;
      case 'afro': cap(R * 1.30, Math.PI * 0.62, 1.02, 0.03); break;
      case 'bun':
        cap(R * 1.05, Math.PI * 0.55, 0.95, 0.012);
        part(grp, geo('bun', function () { return new THREE.SphereGeometry(0.062, 10, 8); }), hm, 0, cy + 0.155, -0.105, true);
        break;
      case 'ponytail':
        cap(R * 1.05, Math.PI * 0.55, 0.95, 0.012);
        var tail = part(grp, geo('ptail', function () { return new THREE.CylinderGeometry(0.030, 0.020, 0.20, 7); }), hm, 0, cy + 0.055, -0.185, true);
        tail.rotation.x = 0.22; grp.userData.swing = tail;
        break;
      case 'long':
        cap(R * 1.06, Math.PI * 0.58, 0.97, 0.012);
        part(grp, box('longback', 0.27, 0.30, 0.045), hm, 0, cy - 0.10, -0.165, true);
        break;
      case 'bob':
        cap(R * 1.07, Math.PI * 0.66, 0.97, 0.008);
        part(grp, box('bobside', 0.315, 0.16, 0.24), hm, 0, cy - 0.055, -0.028, true);
        break;
      default: cap(R * 1.05, Math.PI * 0.55, 0.95, 0.012); // short
    }
    return grp;
  }
  function buildHat(headPivot, cfg) {
    var hat = cfg.hat || 'none';
    if (hat === 'none') return null;
    var cy = M.headCY, R = M.headR;
    var grp = new THREE.Group(); headPivot.add(grp);
    var hm = matFor(cfg.hatColor != null ? cfg.hatColor : 0x23242c);
    if (hat === 'beanie') {
      var bc = part(grp, hairCap(R * 1.07, Math.PI * 0.50, 0.92), hm, 0, cy + 0.026, 0, true);
      bc.rotation.x = -0.50;
      // the band sits ABOVE the brow line (bottom edge at +0.067)
      part(grp, geo('beanband', function () { return new THREE.CylinderGeometry(R * 1.06, R * 1.08, 0.045, 14, 1, true); }), hm, 0, cy + 0.090, 0, false);
      return grp;
    }
    if (hat === 'cap' || hat === 'peci') {
      if (hat === 'peci') {
        part(grp, geo('peci', function () { return new THREE.CylinderGeometry(R * 0.86, R * 0.92, 0.085, 12); }), matFor(0x14161a), 0, cy + 0.105, 0, true);
      } else {
        part(grp, hairCap(R * 1.06, Math.PI * 0.42, 0.92), hm, 0, cy + 0.018, 0, true);
        var brim = part(grp, box('capbrim', 0.15, 0.014, 0.11), hm, 0, cy + 0.075, 0.20, false);
        brim.rotation.x = 0.10;
      }
      return grp;
    }
    if (hat === 'police') {
      part(grp, geo('polcap', function () { return new THREE.CylinderGeometry(R * 0.99, R * 1.02, 0.085, 14); }), hm, 0, cy + 0.115, 0, true);
      part(grp, geo('poldome', function () { var g = new THREE.SphereGeometry(R * 0.99, 14, 8); g.scale(1, 0.36, 1); return g; }), hm, 0, cy + 0.155, 0, false);
      var peak = part(grp, box('polpeak', 0.17, 0.012, 0.10), matFor(0x14161c), 0, cy + 0.075, 0.185, false);
      peak.rotation.x = 0.08;
      // the yellow badge on the cap front (spec: police = yellow badge)
      part(grp, box('polbadge', 0.030, 0.036, 0.008), matFor(0xf2b13c), 0, cy + 0.115, R * 1.0, false);
      return grp;
    }
    if (hat === 'helmet' || hat === 'ojek') {
      part(grp, geo('helmet', function () { return new THREE.SphereGeometry(R * 1.12, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55); }), hm, 0, cy + 0.02, 0, true);
      return grp;
    }
    if (hat === 'fedora') {
      part(grp, geo('fedcrown', function () { return new THREE.CylinderGeometry(R * 0.80, R * 0.88, 0.11, 14); }), hm, 0, cy + 0.13, 0, true);
      part(grp, geo('fedbrim', function () { return new THREE.CylinderGeometry(R * 1.32, R * 1.32, 0.012, 18); }), hm, 0, cy + 0.075, 0, false);
      return grp;
    }
    if (hat === 'sunhat') {
      part(grp, geo('suncrown', function () { return new THREE.CylinderGeometry(R * 0.82, R * 0.92, 0.08, 14); }), hm, 0, cy + 0.115, 0, true);
      part(grp, geo('sunbrim', function () { return new THREE.CylinderGeometry(R * 1.75, R * 1.75, 0.010, 20); }), hm, 0, cy + 0.07, 0, false);
      return grp;
    }
    return grp;
  }

  // ---- accessories (spec set + the game's story gear) -----------------------
  function buildAccessories(api, cfg) {
    var P = api.pivots, acc = cfg.accessories || [];
    function has(n) { return acc.indexOf(n) >= 0; }
    var dark = matFor(0x23242c);
    if (cfg.backpack) {
      part(P.spine2, box('backpack', 0.20, 0.24, 0.10), matFor(cfg.backpack), 0, 0.01, -0.115, true);
    }
    if (has('bag')) {
      part(P.pelvis, box('bag', 0.13, 0.16, 0.06), matFor(0xb8563a), 0.155, -0.03, -0.02, true);
    }
    if (has('umbrella')) {
      var um = new THREE.Group(); um.position.set(0, -0.03, 0.02); P.handR.add(um);
      part(um, geo('umstick', function () { return new THREE.CylinderGeometry(0.006, 0.006, 0.34, 6); }), dark, 0, 0.10, 0, false);
      part(um, geo('umtop', function () { return new THREE.ConeGeometry(0.21, 0.09, 10); }), matFor(0xc23b2e), 0, 0.28, 0, true);
    }
    if (has('glasses') || has('sunglasses')) {
      var lensM = has('sunglasses') ? matFor(0x14161c) : matFor(0x9fb6c4);
      [-1, 1].forEach(function (s) {
        part(P.head, geo('lens', function () { var g = new THREE.SphereGeometry(0.034, 10, 8); g.scale(1, 0.82, 0.30); return g; }), lensM, s * 0.068, M.headCY + 0.02, 0.186, false);
        part(P.head, geo('rim', function () { return new THREE.TorusGeometry(0.036, 0.004, 5, 14); }), dark, s * 0.068, M.headCY + 0.02, 0.188, false);
      });
      part(P.head, box('bridge', 0.03, 0.007, 0.007), dark, 0, M.headCY + 0.028, 0.189, false);
    }
    if (has('badge')) {
      part(P.spine2, box('badge', 0.034, 0.042, 0.010), matFor(0xf2b13c), -0.062, 0.045, 0.078, false);
    }
    if (has('policePatch')) {
      var cv = document.createElement('canvas'); cv.width = 128; cv.height = 32;
      var cx2 = cv.getContext('2d');
      cx2.fillStyle = '#1d2f52'; cx2.fillRect(0, 0, 128, 32);
      cx2.fillStyle = '#f2f4f8'; cx2.font = 'bold 21px sans-serif'; cx2.textAlign = 'center'; cx2.textBaseline = 'middle';
      cx2.fillText('POLISI', 64, 17);
      var tx = new THREE.CanvasTexture(cv);
      var pm = new THREE.Mesh(new THREE.PlaneGeometry(0.105, 0.026),
        new THREE.MeshBasicMaterial({ map: tx, toneMapped: false, fog: false }));
      pm.position.set(0.01, 0.062, 0.079); P.spine2.add(pm);
      var pm2 = pm.clone(); pm2.position.z = -0.079; pm2.rotation.y = Math.PI; P.spine2.add(pm2);
      api.lod1Hide.push(pm, pm2);
    }
    if (has('radio')) {
      part(P.spine2, box('radio', 0.035, 0.08, 0.025), dark, -0.10, 0.075, 0.055, false);
      part(P.spine2, geo('antenna', function () { return new THREE.CylinderGeometry(0.0035, 0.0035, 0.11, 5); }), dark, -0.10, 0.16, 0.055, false);
    }
    if (has('camera')) {
      part(P.spine2, box('camera', 0.085, 0.06, 0.045), dark, 0, -0.01, 0.085, false);
    }
    if (has('phone')) {
      part(P.handL, box('phone', 0.055, 0.10, 0.010), dark, 0, -0.075, 0.03, false).rotation.x = -0.5;
    }
    if (has('cane')) {
      part(P.handR, geo('cane', function () { return new THREE.CylinderGeometry(0.009, 0.009, 0.62, 6); }), matFor(0x6e4a26), 0.015, -0.30, 0.02, false);
    }
    if (has('cigar')) {
      part(P.handR, geo('cigar', function () { return new THREE.CylinderGeometry(0.009, 0.010, 0.09, 6); }), matFor(0x7a4a22), 0, -0.06, 0.03, false).rotation.x = 1.2;
    }
    if (has('rifle')) {
      var rg = new THREE.Group(); rg.position.set(0, -0.045, 0.02); rg.rotation.x = Math.PI / 2; P.handR.add(rg);
      part(rg, box('riflebody', 0.045, 0.075, 0.5), dark, 0, 0, 0.12, true);
      part(rg, box('riflemag', 0.035, 0.11, 0.05), dark, 0, -0.07, 0.12, false);
    }
    if (has('mask')) {
      part(P.head, geo('mask', function () { return new THREE.SphereGeometry(M.headR * 1.05, 12, 10); }), matFor(0x181818), 0, M.headCY, -0.006, false);
    }
    if (has('tie')) {
      part(P.spine2, box('tie', 0.045, 0.24, 0.012), matFor(0x6e1f2a), 0, -0.045, 0.072, false);
    }
    if (has('beltBadge')) {
      part(P.pelvis, box('beltbadge', 0.04, 0.05, 0.012), matFor(0xf2b13c), 0.085, -0.01, 0.062, false);
    }
    if (has('visor')) {
      part(P.head, geo('visor', function () { return new THREE.CylinderGeometry(M.headR * 1.08, M.headR * 1.08, 0.07, 12, 1, true, -0.62, 1.24); }), matFor(0x14161c), 0, M.headCY + 0.02, 0, false);
    }
    if (has('neckTattoo')) {
      part(P.neck, geo('inkneck', function () { return new THREE.CylinderGeometry(0.040, 0.042, 0.035, 10, 1, true, 0.45, 2.2); }), matFor(0x18303e), 0, 0.005, 0, false);
    }
    if (has('armTattoo')) {
      part(P.fArmR, geo('inkarm', function () { return new THREE.CylinderGeometry(0.032, 0.032, 0.07, 10, 1, true); }), matFor(0x1d2b33), 0, -0.045, 0, false);
    }
    if (has('guitar')) {
      var gt = new THREE.Group(); gt.position.set(0.07, -0.03, 0.10); gt.rotation.set(0.15, 0.1, -0.55); P.spine2.add(gt);
      part(gt, geo('gbody', function () { var g = new THREE.CylinderGeometry(0.105, 0.105, 0.05, 14); g.rotateX(Math.PI / 2); return g; }), matFor(0x8a5a2c), 0, 0, 0, true);
      part(gt, box('gneck', 0.028, 0.30, 0.018), matFor(0x5a3a1e), 0.10, 0.16, 0, false);
    }
    if (has('jewelry')) {
      part(P.neck, geo('necklace', function () { return new THREE.TorusGeometry(0.052, 0.006, 6, 16); }), matFor(0xe8c85a), 0, 0.012, 0.014, false).rotation.x = 1.25;
    }
  }

  // ---- pose tables --------------------------------------------------------------
  // Keyframed poses ported from the retired AnimationClip set (same
  // tuned key values, Euler degrees relative to bind). dy/dz are the
  // pelvis offset in UNIT space, converted for the chunky rig's
  // lower pelvis (sitting / lying targets re-based, see the death
  // and drive entries). Gaits are analytic (below), not keyframed.
  var POSE_BONES = ['pelvis', 'spine1', 'spine2', 'neck', 'head',
    'uArmL', 'fArmL', 'handL', 'uArmR', 'fArmR', 'handR',
    'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
  var POSES = {};
  function def(name, dur, keys, loop) {
    keys = keys.slice().sort(function (a, b) { return a.t - b.t; });
    if (keys[0].t > 0) keys.unshift({ t: 0, p: {} });
    if (keys[keys.length - 1].t < dur) keys.push({ t: dur, p: {} });
    // resolve carry-forward: every key becomes a full snapshot
    var cur = {}, cdy = 0, cdz = 0, snap = [];
    for (var i = 0; i < POSE_BONES.length; i++) cur[POSE_BONES[i]] = [0, 0, 0];
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (key.p) for (var b in key.p) cur[b] = key.p[b];
      if (key.dy != null) cdy = key.dy;
      if (key.dz != null) cdz = key.dz;
      var s = { t: key.t, dy: cdy, dz: cdz, p: {} };
      for (var j = 0; j < POSE_BONES.length; j++) s.p[POSE_BONES[j]] = cur[POSE_BONES[j]];
      snap.push(s);
    }
    POSES[name] = { dur: dur, loop: !!loop, keys: snap };
  }
  def('idle', 3.6, [
    { t: 0, p: { spine2: [1.5, 0, 0], pelvis: [0, 0, 2.4], spine1: [0, 0, -1.2], thighL: [-4, 0, 1.5], shinL: [6, 0, 0], thighR: [1, 0, -1.5], shinR: [1, 0, 0], uArmL: [0, 0, 7], uArmR: [0, 0, -7], fArmL: [-14, 0, 2], fArmR: [-14, 0, -2], neck: [0, 0, -1.5], head: [1, -7, 3] } },
    { t: 0.9, p: { spine2: [2.6, 0, 0], spine1: [0.8, 0, -1.2], pelvis: [0, 0, 2.5], uArmL: [0, 0, 8.4], uArmR: [0, 0, -8.4], fArmL: [-15, 0, 2], fArmR: [-15, 0, -2], head: [0.5, -4, 3.2] }, dy: 0.002 },
    { t: 1.8, p: { spine2: [3.6, 0, 0], spine1: [1.6, 0, -1.2], pelvis: [0, 0, 2.6], uArmL: [0, 0, 9.6], uArmR: [0, 0, -9.6], fArmL: [-16, 0, 2], fArmR: [-16, 0, -2], neck: [0, 0, -1.5], head: [0, 3, 3.4] }, dy: 0.004 },
    { t: 2.7, p: { spine2: [2.4, 0, 0], spine1: [0.6, 0, -1.2], pelvis: [0, 0, 2.4], uArmL: [0, 0, 8], uArmR: [0, 0, -8], fArmL: [-14.6, 2 - 2, 2], fArmR: [-14.6, 0, -2], head: [1.5, 8, 2.8] }, dy: 0.002 },
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
    { t: 0, p: { thighL: [-88, 0, 2], thighR: [-88, 0, -2], shinL: [86, 0, 0], shinR: [86, 0, 0], footL: [-2, 0, 0], footR: [-2, 0, 0], spine2: [7, 0, 0], uArmL: [-20, 0, 6], uArmR: [-20, 0, -6], fArmL: [-24, 0, 2], fArmR: [-24, 0, -2], head: [2, -6, 0] }, dy: -0.134 },
    { t: 1.5, p: { spine2: [8.5, 0, 0], head: [3, 7, 0] }, dy: -0.134 },
    { t: 3.0, p: { thighL: [-88, 0, 2], thighR: [-88, 0, -2], shinL: [86, 0, 0], shinR: [86, 0, 0], spine2: [7, 0, 0], uArmL: [-20, 0, 6], uArmR: [-20, 0, -6], fArmL: [-24, 0, 2], fArmR: [-24, 0, -2], head: [2, -6, 0] }, dy: -0.134 }
  ], true);
  def('jump', 0.55, [
    { t: 0, p: { thighL: [-46, 0, 2], thighR: [-46, 0, -2], shinL: [64, 0, 0], shinR: [64, 0, 0], spine2: [14, 0, 0], uArmL: [18, 0, 10], uArmR: [18, 0, -10] }, dy: -0.055 },
    { t: 0.22, p: { thighL: [6, 0, 2], thighR: [10, 0, -2], shinL: [10, 0, 0], shinR: [16, 0, 0], spine2: [-3, 0, 0], uArmL: [-58, 0, 14], uArmR: [-58, 0, -14] }, dy: 0.017 },
    { t: 0.55, p: { thighL: [-14, 0, 2], thighR: [-8, 0, -2], shinL: [22, 0, 0], shinR: [14, 0, 0], spine2: [5, 0, 0], uArmL: [-20, 0, 10], uArmR: [-20, 0, -10] }, dy: -0.007 }
  ], false);
  def('fall', 0.8, [
    { t: 0, p: { thighL: [-20, 0, 3], thighR: [12, 0, -3], shinL: [14, 0, 0], shinR: [8, 0, 0], spine2: [-7, 0, 0], uArmL: [-120, 0, 30], uArmR: [-60, 0, -34], head: [-8, 0, 0] } },
    { t: 0.4, p: { uArmL: [-70, 0, 38], uArmR: [-130, 0, -26] } },
    { t: 0.8, p: { thighL: [-20, 0, 3], thighR: [12, 0, -3], shinL: [14, 0, 0], shinR: [8, 0, 0], spine2: [-7, 0, 0], uArmL: [-120, 0, 30], uArmR: [-60, 0, -34], head: [-8, 0, 0] } }
  ], true);
  def('land', 0.38, [
    { t: 0, p: { thighL: [-52, 0, 3], thighR: [-52, 0, -3], shinL: [72, 0, 0], shinR: [72, 0, 0], spine2: [16, 0, 0], uArmL: [-30, 0, 16], uArmR: [-30, 0, -16] }, dy: -0.07 },
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
  def('shoot_pistol', 0.30, [
    { t: 0, p: { uArmR: [-76, 0, -3], fArmR: [-11, 0, 0], spine2: [3.5, -8, 0], head: [1, 4, 0] } },
    { t: 0.06, p: { uArmR: [-97, 0, -3], fArmR: [-3, 0, 0], spine2: [-1, -10, 0], head: [-3, 4, 0] } },
    { t: 0.30, p: { uArmR: [-84, 0, -3], fArmR: [-7, 0, 0], uArmL: [-52, 0, 10], fArmL: [-58, 0, 8], spine2: [2, -9, 0], head: [0, 4, 0] } }
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
    { t: 0.30, p: { uArmR: [-112, 0, -6], fArmR: [-8, 0, 0], uArmL: [-88, 0, 4], fArmL: [-16, 0, 4], spine2: [17, 16, 0], spine1: [9, 6, 0] }, dy: -0.017 },
    { t: 0.62, p: { uArmR: [0, 0, -6], fArmR: [-8, 0, 0], uArmL: [0, 0, 6], fArmL: [-8, 0, 2], spine2: [2, 0, 0], spine1: [1, 0, 0] }, dy: 0 }
  ], false);
  function hitClip(name, s1, hd) {
    def(name, 0.42, [
      { t: 0, p: { spine1: s1, head: hd, uArmL: [-24, 0, 18], uArmR: [-24, 0, -18] }, dy: -0.009 },
      { t: 0.42, p: { spine1: [1, 0, 0], head: [0, 0, 0], uArmL: [0, 0, 6], uArmR: [0, 0, -6] }, dy: 0 }
    ], false);
  }
  hitClip('hit_front', [-21, 0, 0], [-17, 0, 0]);
  hitClip('hit_back', [22, 0, 0], [18, 0, 0]);
  hitClip('hit_left', [0, 0, 18], [0, 0, 14]);
  hitClip('hit_right', [0, 0, -18], [0, 0, -14]);
  def('stagger', 0.85, [
    { t: 0, p: { pelvis: [0, 0, 7], thighL: [-8, 0, 7], thighR: [6, 0, -7], uArmL: [-14, 0, 32], uArmR: [-10, 0, -30], head: [4, 0, 6], spine1: [4, 0, 4] }, dy: -0.010 },
    { t: 0.42, p: { pelvis: [0, 0, -6], thighL: [5, 0, 6], thighR: [-9, 0, -6], uArmL: [-8, 0, 26], uArmR: [-16, 0, -24], head: [3, 0, -5] }, dy: -0.015 },
    { t: 0.85, p: { pelvis: [0, 0, 0], thighL: [0, 0, 2], thighR: [0, 0, -2], uArmL: [0, 0, 6], uArmR: [0, 0, -6], head: [0, 0, 0], spine1: [1, 0, 0] }, dy: 0 }
  ], false);
  // Knocked-down fall: one consistent fall ending FLAT — pelvis
  // pitched 86 deg, legs extended along the ground (the retired
  // rig's combat5 root fix, re-based to the chunky pelvis height:
  // final pelvis centre = 0.34 - 0.272 = 0.068 units, the torso's
  // half-depth, so no limb spears through the floor).
  def('death', 0.95, [
    { t: 0, p: { spine1: [-6, 0, 0], uArmL: [-30, 0, 20], uArmR: [-24, 0, -22] }, dy: -0.017 },
    { t: 0.45, p: { pelvis: [46, 0, 0], spine1: [-16, 0, 0], spine2: [-8, 0, 0], thighL: [-6, 0, 4], thighR: [-2, 0, -4], shinL: [16, 0, 0], shinR: [10, 0, 0], uArmL: [-40, 0, 44], uArmR: [14, 0, -40], head: [-16, 0, 0] }, dy: -0.13, dz: -0.11 },
    { t: 0.95, p: { pelvis: [86, 0, 0], spine1: [-2, 0, 0], spine2: [3, 0, 0], thighL: [4, 0, 4], thighR: [12, 0, -4], shinL: [6, 0, 0], shinR: [2, 0, 0], uArmL: [-24, 0, 48], uArmR: [20, 0, -48], head: [-8, 0, 0] }, dy: -0.272, dz: -0.19 }
  ], false);
  def('enter_car', 0.8, [
    { t: 0, p: { thighR: [-38, 0, -3], shinR: [30, 0, 0], spine2: [4, -14, 0], uArmR: [-30, 0, -8], fArmR: [-30, 0, 0] } },
    { t: 0.45, p: { thighL: [-80, 0, 3], thighR: [-82, 0, -3], shinL: [76, 0, 0], shinR: [78, 0, 0], spine2: [7, -6, 0], uArmL: [-34, 0, 6], uArmR: [-34, 0, -6], fArmL: [-26, 0, 2], fArmR: [-26, 0, -2] }, dy: -0.128 },
    { t: 0.8, p: { thighL: [-84, 0, 3], thighR: [-84, 0, -3], shinL: [80, 0, 0], shinR: [80, 0, 0], spine2: [6, 0, 0], uArmL: [-38, 0, 6], uArmR: [-38, 0, -6], fArmL: [-28, 0, 2], fArmR: [-28, 0, -2], head: [0, 0, 0] }, dy: -0.134 }
  ], false);
  def('exit_car', 0.75, [
    { t: 0, p: { thighL: [-84, 0, 3], thighR: [-84, 0, -3], shinL: [80, 0, 0], shinR: [80, 0, 0], spine2: [6, 0, 0], uArmL: [-38, 0, 6], uArmR: [-38, 0, -6], fArmL: [-28, 0, 2], fArmR: [-28, 0, -2] }, dy: -0.134 },
    { t: 0.4, p: { thighL: [-60, 0, 4], thighR: [-20, 0, -4], shinL: [52, 0, 0], shinR: [8, 0, 0], spine2: [8, 12, 0], uArmL: [-24, 0, 8], uArmR: [-44, 0, -10], fArmR: [-36, 0, 0] }, dy: -0.07 },
    { t: 0.75, p: { thighL: [0, 0, 1], thighR: [0, 0, -1], shinL: [2, 0, 0], shinR: [2, 0, 0], spine2: [2, 0, 0], uArmL: [0, 0, 6], uArmR: [0, 0, -6], fArmL: [-8, 0, 2], fArmR: [-8, 0, -2] }, dy: 0 }
  ], false);
  def('drive', 4.0, [
    { t: 0, p: { thighL: [-84, 0, 3], thighR: [-84, 0, -3], shinL: [80, 0, 0], shinR: [80, 0, 0], spine2: [6, 0, 0], uArmL: [-38, 0, 6], uArmR: [-38, 0, -6], fArmL: [-28, 0, 2], fArmR: [-28, 0, -2], head: [0, -12, 0] }, dy: -0.134 },
    { t: 1.4, p: { head: [0, 10, 0], spine2: [6.8, 0, 0] }, dy: -0.134 },
    { t: 2.6, p: { head: [1, 2, 0] }, dy: -0.134 },
    { t: 4.0, p: { thighL: [-84, 0, 3], thighR: [-84, 0, -3], shinL: [80, 0, 0], shinR: [80, 0, 0], spine2: [6, 0, 0], uArmL: [-38, 0, 6], uArmR: [-38, 0, -6], fArmL: [-28, 0, 2], fArmR: [-28, 0, -2], head: [0, -12, 0] }, dy: -0.134 }
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

  // ---- gaits (analytic, phase-driven) ------------------------------------------
  // bob/drop converted to unit space for the chunky pelvis.
  // refSpeed: the world speed at which the gait's feet match the
  // ground (0.78 stride calibration of the retired system, leg
  // length 0.29 units), computed at the reference height 1.75.
  var GAITS = {};
  function gait(name, o) {
    o.bob = o.bob || 0; o.drop = o.drop || 0;
    var stepLen = 2 * (0.29 * 1.75) * Math.sin(o.swing * DEG);
    o.refSpeed = 0.78 * (2 * stepLen) / o.dur;
    GAITS[name] = o;
  }
  gait('walk', { swing: 23, knee: 44, arm: 27, elbow: 15, lean: 5, bob: 0.0060, drop: 0.0075, dur: 0.90 });
  gait('run', { swing: 37, knee: 62, arm: 38, elbow: 52, lean: 9, bob: 0.0119, drop: 0.0104, dur: 0.66 });
  gait('sprint', { swing: 46, knee: 76, arm: 46, elbow: 62, lean: 13, bob: 0.0127, drop: 0.0112, dur: 0.58 });
  gait('panic', { swing: 40, knee: 64, arm: 12, elbow: 68, lean: 10, bob: 0.0112, drop: 0.0104, dur: 0.62 });
  gait('walk_old', { swing: 15, knee: 24, arm: 10, elbow: 16, lean: 9, bob: 0.0030, drop: 0.0060, dur: 1.05 });
  function bump(x) { var s = Math.sin(x); return s > 0 ? s * s : 0; }
  function gaitPose(o, a, out) {
    function leg(off) {
      var s = Math.sin(a + off);
      return {
        thigh: -o.swing * s,
        shin: o.knee * bump(a + off + 0.9) + 4,
        foot: o.swing * s * 0.40 - o.knee * bump(a + off + 0.9) * 0.30
          - 10 * bump(a + off - 0.2) + 10 * bump(a + off - 3.2) + 2
      };
    }
    var L = leg(0), R = leg(Math.PI), p = out.p;
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
    p.handL = [0, 0, 0]; p.handR = [0, 0, 0];
    out.dy = -o.drop + o.bob * Math.cos(2 * a); out.dz = 0;
    return out;
  }
  function sampleKeyframed(pose, t, out) {
    var keys = pose.keys, n = keys.length;
    if (pose.loop) { t = t % pose.dur; if (t < 0) t += pose.dur; }
    else t = Math.min(t, pose.dur);
    var i = 0;
    while (i < n - 2 && keys[i + 1].t <= t) i++;
    var k0 = keys[i], k1 = keys[i + 1] || k0;
    var f = k1.t > k0.t ? clamp((t - k0.t) / (k1.t - k0.t), 0, 1) : 0;
    for (var j = 0; j < POSE_BONES.length; j++) {
      var bn = POSE_BONES[j], a = k0.p[bn], b = k1.p[bn], o = out.p[bn];
      o[0] = lerp(a[0], b[0], f); o[1] = lerp(a[1], b[1], f); o[2] = lerp(a[2], b[2], f);
    }
    out.dy = lerp(k0.dy, k1.dy, f); out.dz = lerp(k0.dz, k1.dz, f);
    return out;
  }
  function newPoseBuffer() {
    var p = {};
    for (var i = 0; i < POSE_BONES.length; i++) p[POSE_BONES[i]] = [0, 0, 0];
    return { p: p, dy: 0, dz: 0 };
  }

  // ---- rig builder --------------------------------------------------------------
  // Pivots are THREE.Groups (Bos spec): root -> pelvis -> spine1 ->
  // spine2 -> neck -> head, shoulders, elbows, hips, knees. Geometry
  // is shared; per-build width/depth is a mesh scale, so one
  // geometry set serves every build. Everything is built in unit
  // space; root.scale = config.height.
  function darken(hex, f) {
    var r = clamp(Math.round(((hex >> 16) & 255) * f), 0, 255),
      g = clamp(Math.round(((hex >> 8) & 255) * f), 0, 255),
      b = clamp(Math.round((hex & 255) * f), 0, 255);
    return (r << 16) | (g << 8) | b;
  }
  function buildRig(cfg) {
    var B = BUILDS[cfg.build] || BUILDS.avg;
    var skinM = matFor(cfg.skin), topM = matFor(cfg.topColor),
      botM = matFor(cfg.bottomColor), shoeM = matFor(cfg.shoeColor),
      handM = matFor(cfg.handColor != null ? cfg.handColor : cfg.skin);
    var root = new THREE.Group();
    var P = {};
    var blob = new THREE.Mesh(geo('blob', function () { return new THREE.PlaneGeometry(0.84, 0.84); }), blobMat);
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.012; blob.renderOrder = 2;
    blob.name = 'blob'; root.add(blob);
    var pelvis = P.pelvis = new THREE.Group(); pelvis.position.y = M.pelvisY; root.add(pelvis);
    var hips = part(pelvis, GEO.hips(), botM, 0, 0.01, 0, true);
    hips.scale.set(B.w, 1, B.d);
    var spine1 = P.spine1 = new THREE.Group(); spine1.position.y = M.spine1Y - M.pelvisY; pelvis.add(spine1);
    var torso = part(spine1, GEO.torso(), topM, 0, 0.10, 0, true);
    torso.scale.set(B.w, 1, B.d);
    if (cfg.accentColor != null) {
      // one flat accent band on the chest (Raka's yellow accent)
      part(spine1, box('accent', 0.20, 0.035, 0.012), matFor(cfg.accentColor), 0, 0.145, 0.070 * B.d + 0.002, false);
    }
    var spine2 = P.spine2 = new THREE.Group(); spine2.position.y = M.spine2Y - M.spine1Y; spine1.add(spine2);
    var chest = part(spine2, GEO.chest(), topM, 0, 0.035, 0, true);
    chest.scale.set(B.w, 1, B.d);
    var neck = P.neck = new THREE.Group(); neck.position.y = M.neckY - M.spine2Y; spine2.add(neck);
    part(neck, GEO.neck(), skinM, 0, 0.012, 0, false);
    var head = P.head = new THREE.Group(); head.position.y = M.headY - M.neckY; neck.add(head);
    var headMesh = part(head, GEO.head(), skinM, 0, M.headCY, 0, true);
    headMesh.scale.setScalar(B.head);
    part(head, GEO.ear(), skinM, 0.185, M.headCY - 0.01, 0, false);
    part(head, GEO.ear(), skinM, -0.185, M.headCY - 0.01, 0, false);
    var armLong = cfg.sleeve === 'long';
    function arm(side, s) {
      var u = P['uArm' + s] = new THREE.Group();
      u.position.set(side * M.shoulderX * B.w, M.shoulderDY, 0); spine2.add(u);
      var um = part(u, GEO.uArm(), topM, 0, -0.055, 0, true);
      um.scale.set(B.w, 1, B.d);
      var f = P['fArm' + s] = new THREE.Group();
      f.position.y = M.elbowDY; u.add(f);
      var fm = part(f, GEO.fArm(), armLong ? topM : skinM, 0, -0.05, 0, true);
      fm.scale.set(B.w, 1, B.d);
      var h = P['hand' + s] = new THREE.Group();
      h.position.y = M.handDY; f.add(h);
      part(h, GEO.hand(), handM, 0, -0.028, 0.004, true);
    }
    arm(1, 'L'); arm(-1, 'R');
    var bottomLong = cfg.bottomType !== 'shorts';
    function leg(side, s) {
      var t = P['thigh' + s] = new THREE.Group();
      t.position.set(side * M.hipX * B.w, -0.02, 0); pelvis.add(t);
      var tm = part(t, GEO.thigh(), botM, 0, -0.07, 0, true);
      tm.scale.set(B.w, 1, B.d);
      var sh = P['shin' + s] = new THREE.Group();
      sh.position.y = M.kneeY - M.pelvisY + 0.02; t.add(sh);
      var sm = part(sh, GEO.shin(), bottomLong ? botM : skinM, 0, -0.055, 0, true);
      sm.scale.set(B.w, 1, B.d);
      var ft = P['foot' + s] = new THREE.Group();
      ft.position.y = M.ankleY - M.kneeY; sh.add(ft);
      part(ft, GEO.shoe(), shoeM, 0, -0.022, 0.045, true);
    }
    leg(1, 'L'); leg(-1, 'R');
    if (cfg.bottomType === 'skirt') {
      part(pelvis, GEO.skirt(), botM, 0, -0.045, 0, true);
    }
    var face = buildFace(head, cfg);
    var hair = buildHair(head, cfg);
    var hat = buildHat(head, cfg);
    var api = { pivots: P, face: face, lod1Hide: [] };
    buildAccessories(api, cfg);
    var outlines = [];
    root.traverse(function (o) { if (o.userData && o.userData.isOutline) outlines.push(o); });
    return { root: root, pivots: P, face: face, outlines: outlines, lod1Hide: api.lod1Hide, hairMesh: hair, hatMesh: hat, blob: blob };
  }

  // ---- createCharacter ------------------------------------------------------------
  // Spec API. update(dt, state) blends locomotion gaits, keyframed
  // actions and look / posture layers procedurally, with lerp
  // smoothing between states; setExpression(name) drives the face.
  var EXPR_LEGACY = { smile: 'happy', grin: 'happy', serious: 'neutral', surprised: 'scared' };
  var ACTION_MAP = {
    aim: 'aim_pistol', aimRifle: 'aim_rifle', shoot: 'shoot_pistol', reload: 'reload',
    punch: 'melee_r', punchL: 'melee_l', bat: 'melee_bat',
    hit: 'hit_front', hitBack: 'hit_back', hitLeft: 'hit_left', hitRight: 'hit_right',
    stagger: 'stagger', down: 'death', jump: 'jump', fall: 'fall', land: 'land',
    drive: 'drive', enterCar: 'enter_car', exitCar: 'exit_car',
    talk: 'talk', wave: 'wave', point: 'point', handsUp: 'hands_up',
    phone: 'idle_phone', sit: 'idle_sit', smoke: 'idle_smoke', lean: 'idle_lean', idle: 'idle'
  };
  function createCharacter(cfgIn) {
    var cfg = cfgIn || {};
    var c = {
      height: cfg.height != null ? cfg.height : 1.72,
      build: cfg.build || 'avg',
      skin: cfg.skin != null ? cfg.skin : 0xe8b184,
      skinDark: 0,
      topColor: cfg.top != null ? cfg.top : 0x3a6ea5,
      bottomColor: cfg.bottom != null ? cfg.bottom : 0x2c3038,
      shoeColor: cfg.shoe != null ? cfg.shoe : 0x23242c,
      hairColor: cfg.hairColor != null ? cfg.hairColor : 0x2b1d12,
      hair: cfg.hair || 'short',
      hat: cfg.hat || 'none',
      hatColor: cfg.hatColor,
      sleeve: cfg.sleeve || 'short',
      bottomType: cfg.bottomType || 'long',
      backpack: cfg.backpack != null ? cfg.backpack : null,
      accentColor: cfg.accent != null ? cfg.accent : null,
      handColor: cfg.handColor,
      accessories: cfg.accessories || [],
      face: cfg.face || null,
      seed: cfg.seed != null ? cfg.seed : 1
    };
    c.skinDark = darken(c.skin, 0.86);
    var rig = buildRig(c);
    rig.root.scale.setScalar(c.height);
    var face = rig.face;
    var exprCur = { browA: 0, browY: 0, eyeY: 1, mouth: 'flat' };
    var exprTarget = EXPRESSIONS.neutral;
    var blinkT = 1.5 + (c.seed % 7) * 0.37, blink = 1;
    var cur = { name: 'idle', time: 0, phase: 0, timeScale: 1 };
    var prev = null, fadeT = 1, fadeDur = 0.12;
    var outCur = newPoseBuffer(), outPrev = newPoseBuffer(), outBlend = newPoseBuffer();
    var lookYaw = 0, lookPitch = 0, lookYawT = 0, lookPitchT = 0, hunch = 0, hunchT = 0;
    var timeOverride = null; // adapter hook: absolute rate (panic speed)
    var P = rig.pivots;

    function poseDef(name) { return GAITS[name] || POSES[name]; }
    function play(name, fade, force) {
      if (!poseDef(name)) return false;
      if (cur.name === name && !force) {
        // a finished one-shot replays when asked again (the retired
        // mixer's play() on a stopped action did the same)
        var d0 = poseDef(name);
        if (GAITS[name] || d0.loop || cur.time < d0.dur) return true;
      }
      prev = { name: cur.name, time: cur.time, phase: cur.phase, timeScale: cur.timeScale };
      cur = { name: name, time: (GAITS[name] || POSES[name].loop) ? cur.time : 0, phase: cur.phase, timeScale: cur.timeScale };
      timeOverride = null;
      fadeT = 0; fadeDur = Math.max(0.02, fade != null ? fade : 0.12);
      return true;
    }
    function sample(st, dt, out) {
      var def = poseDef(st.name);
      var rate = (st === cur && timeOverride != null) ? timeOverride : st.timeScale;
      if (!def) return sampleKeyframed(POSES.idle, st.time, out);
      if (GAITS[st.name]) { st.phase += dt * rate / def.dur; return gaitPose(def, st.phase * Math.PI * 2, out); }
      st.time += dt * rate;
      return sampleKeyframed(def, st.time, out);
    }
    function applyPose(out) {
      for (var i = 0; i < POSE_BONES.length; i++) {
        var bn = POSE_BONES[i], pv = P[bn], e = out.p[bn];
        pv.rotation.set(e[0] * DEG, e[1] * DEG, e[2] * DEG);
      }
      P.pelvis.position.y = M.pelvisY + out.dy;
      P.pelvis.position.z = out.dz;
    }
    function setExpression(name) {
      var key = EXPRESSIONS[name] ? name : (EXPR_LEGACY[name] || 'neutral');
      exprTarget = EXPRESSIONS[key];
      c.expression = key;
    }
    function update(dt, state) {
      state = state || {};
      // resolve the wanted clip: explicit action > locomotion speed
      var want = null;
      if (state.action && ACTION_MAP[state.action]) want = ACTION_MAP[state.action];
      else if (state.action && poseDef(state.action)) want = state.action;
      else if (state.action === 'flee') want = 'panic';
      else if (state.action === 'chase') want = 'run';
      else if (state.action === 'arrest') want = 'point';
      if (!want && state.move != null) {
        // locomotion is only auto-resolved when the caller drives
        // by speed; play()-driven callers (the legacy controllers)
        // pass no move and keep their chosen clip.
        var mv = state.move || 0;
        if (mv < 0.08) want = 'idle';
        else if (mv < 2.2) want = 'walk';
        else if (mv < 3.9) want = 'run';
        else want = 'sprint';
      }
      if (want !== cur.name) play(want, state.fade);
      sample(cur, dt, outCur);
      if (prev) {
        sample(prev, dt, outPrev);
        fadeT += dt;
        var k = clamp(fadeT / fadeDur, 0, 1);
        for (var i = 0; i < POSE_BONES.length; i++) {
          var bn = POSE_BONES[i], a = outPrev.p[bn], b = outCur.p[bn], o = outBlend.p[bn];
          o[0] = lerp(a[0], b[0], k); o[1] = lerp(a[1], b[1], k); o[2] = lerp(a[2], b[2], k);
        }
        outBlend.dy = lerp(outPrev.dy, outCur.dy, k);
        outBlend.dz = lerp(outPrev.dz, outCur.dz, k);
        applyPose(outBlend);
        if (k >= 1) prev = null;
      } else applyPose(outCur);
      // look + posture layers (additive, smoothed)
      if (state.look) { lookYawT = state.look[0] || 0; lookPitchT = state.look[1] || 0; }
      hunchT = state.posture || 0;
      var lk = 1 - Math.exp(-dt * 10);
      lookYaw = lerp(lookYaw, lookYawT, lk); lookPitch = lerp(lookPitch, lookPitchT, lk);
      hunch = lerp(hunch, hunchT, lk);
      P.neck.rotation.y += lookYaw * 0.45; P.neck.rotation.x += lookPitch * 0.45;
      P.head.rotation.y += lookYaw * 0.55; P.head.rotation.x += lookPitch * 0.55;
      P.spine1.rotation.x += hunch * 10 * DEG; P.head.rotation.x -= hunch * 4 * DEG;
      // expression + blink
      if (state.expression) setExpression(state.expression);
      var ek = 1 - Math.exp(-dt * 12);
      exprCur.browA = lerp(exprCur.browA, exprTarget.browA, ek);
      exprCur.browY = lerp(exprCur.browY, exprTarget.browY, ek);
      exprCur.eyeY = lerp(exprCur.eyeY, exprTarget.eyeY, ek);
      exprCur.mouth = exprTarget.mouth;
      blinkT -= dt;
      if (blinkT < -0.22) blinkT = 2.2 + Math.random() * 2.8;
      blink = blinkT < 0 ? clamp(1 - (0.11 - Math.abs(blinkT + 0.11)) / 0.11, 0.06, 1) : 1;
      applyExpression(face, exprCur, blink);
      return api;
    }
    var api = {
      root: rig.root,
      group: rig.root,
      pivots: P,
      bones: P, // legacy name: the same pivot groups
      face: face,
      outlines: rig.outlines,
      lod1Hide: rig.lod1Hide,
      hairMesh: rig.hairMesh,
      hatMesh: rig.hatMesh,
      blob: rig.blob,
      config: c,
      expression: 'neutral',
      update: update,
      play: play,
      setExpression: setExpression,
      setSpeed: function (mps) { // adapter: gait timeScale from speed
        var def = GAITS[cur.name];
        cur.timeScale = def ? clamp(mps / (def.refSpeed * (c.height / 1.75)), 0.4, 2.2) : 1;
      },
      setTimeScale: function (v) { timeOverride = v; },
      setLook: function (yaw, pitch) { lookYawT = yaw || 0; lookPitchT = pitch || 0; },
      setPosture: function (p) { hunchT = p || 0; },
      current: function () { return cur.name; },
      poseTime: function () { return cur.time; },
      finished: function () {
        var def = poseDef(cur.name);
        return !!(def && !def.loop && !GAITS[cur.name] && cur.time >= def.dur - 0.001);
      }
    };
    return api;
  }

  // ---- crowd: spawnPedestrian(seed) ----------------------------------------------
  // 6-8 body types from curated palettes (Bos spec): each palette is
  // a matched top/bottom/shoe set, never pure random colours.
  var PED_PALETTES = [
    { top: 0xd8542e, bottom: 0x2c3038, shoe: 0xe8e4da },
    { top: 0x2e7d6b, bottom: 0x3a3f4a, shoe: 0x23242c },
    { top: 0xf2b13c, bottom: 0x54432a, shoe: 0x6e4a26 },
    { top: 0x3a6ea5, bottom: 0xd8d3c8, shoe: 0xc23b2e },
    { top: 0xe8e4da, bottom: 0x7a4a5e, shoe: 0x23242c },
    { top: 0x7a4a5e, bottom: 0x2c3038, shoe: 0xe8e4da },
    { top: 0x51606e, bottom: 0x23242c, shoe: 0x14161a },
    { top: 0xc23b2e, bottom: 0x3a6ea5, shoe: 0xf2f4f8 }
  ];
  var PED_SKINS = [0xf7d7b5, 0xf2c89b, 0xe8b184, 0xdb9a68, 0xc9824e, 0xa96638, 0x86502a, 0x6b3f22];
  var PED_HAIRC = [0x1b1e28, 0x2b1d12, 0x3a2415, 0x54331b, 0x77572c, 0x9a7d52, 0xb8b0a4, 0xd8d3c8];
  var PED_HAIRS = ['short', 'buzz', 'slick', 'quiff', 'undercut', 'messy', 'afro', 'bun', 'ponytail', 'long', 'bob', 'hijab', 'bald'];
  var PED_HATS = ['none', 'none', 'none', 'cap', 'beanie', 'sunhat', 'peci'];
  var PED_ACCS = [[], [], ['glasses'], ['bag'], ['backpack'], ['phone'], ['sunglasses'], ['umbrella']];
  function spawnPedestrian(seed) {
    var r = rng((seed >>> 0) * 7919 + 17);
    var pal = pick(r, PED_PALETTES);
    var buildRoll = r();
    var build = buildRoll < 0.30 ? 'avg' : buildRoll < 0.52 ? 'slim' : buildRoll < 0.74 ? 'stocky' : buildRoll < 0.86 ? 'avg' : 'kid';
    var female = r() < 0.45;
    return createCharacter({
      height: build === 'kid' ? 1.25 + r() * 0.15 : 1.58 + r() * 0.28,
      build: build,
      skin: pick(r, PED_SKINS),
      top: pal.top, bottom: pal.bottom, shoe: pal.shoe,
      hairColor: pick(r, PED_HAIRC),
      hair: female ? pick(r, ['bun', 'ponytail', 'long', 'bob', 'hijab', 'short']) : pick(r, PED_HAIRS),
      hat: pick(r, PED_HATS),
      sleeve: r() < 0.5 ? 'long' : 'short',
      bottomType: female && r() < 0.3 ? 'skirt' : (r() < 0.25 ? 'shorts' : 'long'),
      accessories: pick(r, PED_ACCS),
      seed: seed
    });
  }

  SH.ToonChar = {
    createCharacter: createCharacter,
    spawnPedestrian: spawnPedestrian,
    matFor: matFor,
    POSES: POSES,
    GAITS: GAITS,
    EXPRESSIONS: EXPRESSIONS,
    gradientMap: gradientMap,
    POSE_BONES: POSE_BONES
  };
})(window.SH = window.SH || {});
