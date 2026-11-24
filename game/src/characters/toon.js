// SELATARA HEAT — characters/toon.js  (Character System, SEMI-REALISTIC REBUILD)
// Replaces the chibi rebuild (2026-11-22 morning): the proportions are now
// stylized SEMI-REALISTIC low-poly, ~7-7.5 heads tall, per Bos's spec
// (2026-11-22 ~12:10 WIB). Same public API, same adapters, same cast:
//   SH.ToonChar.createCharacter(config) -> { root, update(dt, state),
//     setExpression(name) }
//   config: { height, build ('slim'|'avg'|'stocky'|'heavy'|'elderly'|'teen'|'kid'),
//     skin, top, bottom, shoe, hat, hair, backpack, accessory }
//   SH.ToonChar.spawnPedestrian(seed) -> a crowd character from curated palettes.
// Everything else is rebuilt for the new proportions: shaped (tapered)
// clothing instead of stacked boxes, a small head with a visible neck,
// jaw + chin + ears, a realistic-ish face (eyes at head middle, thick
// separate brows, nose with a bridge, readable mouth line), low-poly
// hands with four stubby fingers + a thumb (one merged geometry per
// hand, BODYFIX3), proper shoes with soles, retuned gaits (hip
// rotation, counter-swing, knee bend, heel strike, head stabilization),
// and a sitting pose re-derived from the new thigh/shin lengths.
// The face-shadow fix: head skin uses a finer 4-step gradient (no single
// hard band can cross the face) and hair/hats never cast shadows.
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
  // BODYFIX2 (final polish): the character BODY map — same 3-step
  // structure the buildings use, but with a deeper shade step and a
  // WARM tint baked into the steps (evening sun): clear light side /
  // shade side on clothes and gear. This map belongs to matFor ONLY;
  // the exported neutral gradientMap above stays untouched (the
  // factory's gun material and any other consumer keep the old read).
  function makeGradient(stepsRGB) {
    var data = new Uint8Array(stepsRGB.length * 4);
    for (var i = 0; i < stepsRGB.length; i++) {
      data[i * 4] = stepsRGB[i][0]; data[i * 4 + 1] = stepsRGB[i][1]; data[i * 4 + 2] = stepsRGB[i][2]; data[i * 4 + 3] = 255;
    }
    var t = new THREE.DataTexture(data, stepsRGB.length, 1, THREE.RGBAFormat);
    t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  }
  // PROPFIX (2026-11-22): shade step deepened hard (86 -> 64) and
  // the mid step pulled down — the 3 toon bands must read as 2-3
  // CLEAR bands at street distance, the same shading language as
  // the buildings, not a soft wash (Bos point 10).
  var gradientMapBody = makeGradient([[64, 50, 44], [168, 150, 134], [255, 244, 230]]);
  // Finer 4-step gradient, HEAD SKIN ONLY: the 3-step map quantized the
  // sphere's lighting into one hard diagonal band across the face (the
  // chibi proof's worst defect). Four steps move the band boundaries
  // apart so no single hard edge can cut the face; the body keeps the
  // 3-step map the buildings use, so the shading language stays shared.
  // BODYFIX2: steps deepened a touch and warm-tinted like the body
  // map — still four soft steps, so the face ramp can never band.
  // POLISH (Bos point 4): the two shade steps deepened so the
  // face bands read as clear steps (not a soft wash), still four
  // steps so no single hard edge can slash the face.
  var gradientMapSoft = makeGradient([[92, 76, 66], [160, 144, 130], [216, 202, 186], [255, 246, 236]]);
  var matCache = {}, skinCache = {};
  // ROUND 3 (user spec 2026-11-22): character materials share the world's
  // rendering grade — ACES tone mapping and fog ON. Round 2 forced
  // toneMapped:false, so the cast rendered brighter and flatter than
  // every world mesh around them (the "paper cutout" read). With the
  // same grade and the shared hemisphere + sun lights, the toon ramp
  // now lands inside the scene's own palette at every hour.
  function matFor(hex) {
    if (matCache[hex]) return matCache[hex];
    var m = new THREE.MeshToonMaterial({ color: hex, gradientMap: gradientMapBody });
    matCache[hex] = m; return m;
  }
  function matSkin(hex) {
    if (skinCache[hex]) return skinCache[hex];
    var m = new THREE.MeshToonMaterial({ color: hex, gradientMap: gradientMapSoft });
    skinCache[hex] = m; return m;
  }
  var outlineMat = (function () {
    return new THREE.MeshBasicMaterial({ color: 0x2a1a12, side: THREE.BackSide });
  })();
  // POLISH (Bos point 5): the outline is a darker shade of the
  // part's OWN colour, never near-black — one shared dark-brown
  // hull (0x2a1a12) read as a black sticker line on pale skin,
  // grey hair and cream cloth alike. Cached per base colour.
  var outlineCache = {};
  function outlineMatFor(material) {
    // POLISH2: cloth materials carry a baked full-colour texture
    // (colour white), so their base hex rides on userData.baseHex.
    var hex = (material && material.userData && material.userData.baseHex != null) ? material.userData.baseHex
      : (material && material.color) ? material.color.getHex() : 0x2a1a12;
    if (outlineCache[hex]) return outlineCache[hex];
    var c = new THREE.Color(hex);
    c.multiplyScalar(0.40);
    var m = new THREE.MeshBasicMaterial({ color: c, side: THREE.BackSide });
    outlineCache[hex] = m; return m;
  }
  // POLISH (Bos point 2): lighten a hex toward white by f (0..1) —
  // the hair highlight tone is derived from the base hair colour.
  function lighten(hex, f) {
    var r = clamp(Math.round(((hex >> 16) & 255) + (255 - ((hex >> 16) & 255)) * f), 0, 255),
      g = clamp(Math.round(((hex >> 8) & 255) + (255 - ((hex >> 8) & 255)) * f), 0, 255),
      b = clamp(Math.round((hex & 255) + (255 - (hex & 255)) * f), 0, 255);
    return (r << 16) | (g << 8) | b;
  }
  var blobMat = (function () {
    var cv = document.createElement('canvas'); cv.width = cv.height = 128;
    var c = cv.getContext('2d');
    var g = c.createRadialGradient(64, 64, 6, 64, 64, 62);
    // ROUND 3: deeper core — the disc doubles as the feet AO, so every
    // character reads planted even where the real shadow map is soft.
    // BODYFIX2: core deepened again (0.62 -> 0.70) so the contact
    // patch stays visible even in close-up framing and on the pale
    // evening pavement.
    // BODYFIX4: core deepened again (0.70 -> 0.80, mid 0.44 ->
    // 0.56) — at lineup distance the dark shoes needed a darker
    // contact pool under them to separate from the ground.
    // PROPFIX: core 0.88 / mid 0.68 and the disc itself grows
    // (blob4 plane 0.80 -> 0.96 in buildRig) — Bos point 10: the
    // contact shadow must stay planted at the wider new stance.
    // POLISH03 (user item 1): REVERSED — at 0.92 core / 0.74 mid
    // the disc read as a hard black plate under every character
    // in the market frame. Peak alpha drops to 0.55 (~40%
    // transparent overall) and the falloff spreads across the
    // whole radius (0.45 / 0.75 stops) so the edge is a soft
    // gradient, not a rim; the disc itself shrinks in buildRig.
    g.addColorStop(0, 'rgba(8,6,4,0.55)'); g.addColorStop(0.45, 'rgba(8,6,4,0.40)'); g.addColorStop(0.75, 'rgba(8,6,4,0.16)'); g.addColorStop(1, 'rgba(8,6,4,0)');
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    var m = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    m.toneMapped = false; m.fog = false; return m;
  })();

  // ---- cloth materials (POLISH2, Bos spec A) -------------------------------
  // Clothing stops being flat-shaded colour blocks: every garment
  // material carries a baked canvas texture — a fine weave grain,
  // soft vertical fold streaks (the fold read the geometry-only
  // passes kept skipping for ring risk), and the archetype patterns
  // (hawaii / stripes / batik) or a denim twill for trousers. The
  // texture is baked in FULL colour and the material colour stays
  // white; the base hex rides on userData.baseHex so the
  // per-colour outline hull keeps its tint (see outlineMatFor).
  function cssHex(hex) {
    return '#' + ('000000' + (hex >>> 0).toString(16)).slice(-6);
  }
  function clothTexture(hex, pattern, hex2, soft) {
    // VISUAL POLISH step 5: the SOFT variant (trousers/legs) —
    // the standard fold streaks are vertical gradients, and on
    // the long leg lathes they stretch the full limb length and
    // read as sewn-in PINSTRIPES (the user's "striped trousers"
    // call on the market frame). Soft halves the fold + rib
    // contrast so legs read as cloth with a weave, not stripes;
    // torso garments keep the full-strength folds.
    var foldA = soft ? 0.045 : 0.11, foldL = soft ? 0.03 : 0.07, ribA = soft ? 0.045 : 0.10;
    var cv = document.createElement('canvas'); cv.width = cv.height = 128;
    var g = cv.getContext('2d');
    g.fillStyle = cssHex(hex); g.fillRect(0, 0, 128, 128);
    // deterministic scatter, seeded by the colours themselves
    var s = ((hex ^ ((hex2 || 0) * 7)) >>> 0) || 1;
    function rnd() { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }
    var i, x, y;
    if (pattern === 'hawaii' && hex2 != null) {
      // scattered hibiscus: five petals + a light heart, plus
      // small leaf pairs — flat print, original motif.
      g.fillStyle = cssHex(hex2);
      for (i = 0; i < 15; i++) {
        var fx = rnd() * 128, fy = rnd() * 128, fr = 4.5 + rnd() * 4;
        for (var p = 0; p < 5; p++) {
          var pa = p / 5 * Math.PI * 2 + rnd() * 0.3;
          g.beginPath();
          g.ellipse(fx + Math.cos(pa) * fr * 0.62, fy + Math.sin(pa) * fr * 0.62, fr * 0.52, fr * 0.30, pa, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = 'rgba(255,246,220,0.85)';
        g.beginPath(); g.arc(fx, fy, fr * 0.22, 0, Math.PI * 2); g.fill();
        g.fillStyle = cssHex(hex2);
        g.beginPath(); g.ellipse(fx + fr * 1.7, fy + fr * 0.9, fr * 0.55, fr * 0.20, 0.7, 0, Math.PI * 2); g.fill();
      }
    } else if (pattern === 'stripes' && hex2 != null) {
      g.fillStyle = cssHex(hex2);
      for (y = 6; y < 128; y += 30) g.fillRect(0, y, 128, 13);
    } else if (pattern === 'batik' && hex2 != null) {
      g.fillStyle = cssHex(hex2);
      for (var ry = 0; ry < 4; ry++) for (var rx = 0; rx < 4; rx++) {
        var bx = rx * 32 + (ry % 2 ? 16 : 0), by = ry * 32 + 8;
        g.beginPath(); g.arc(bx, by, 3.2, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(bx + 9, by + 12, 1.8, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(bx - 8, by + 13, 1.8, 0, Math.PI * 2); g.fill();
        g.strokeStyle = cssHex(hex2); g.lineWidth = 1.6;
        g.beginPath(); g.arc(bx, by + 4, 7.5, 0.25, Math.PI - 0.25); g.stroke();
      }
    }
    if (pattern === 'twill') {
      // denim: fine diagonal ribs + pale fade streaks
      g.strokeStyle = 'rgba(10,10,24,' + ribA + ')'; g.lineWidth = 1;
      for (i = -128; i < 256; i += 3) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke();
      }
      g.fillStyle = 'rgba(255,255,255,' + (soft ? 0.03 : 0.05) + ')';
      for (i = 0; i < 6; i++) { x = rnd() * 128; g.fillRect(x, 0, 5 + rnd() * 7, 128); }
    }
    // fold streaks: soft vertical shade/light pairs — cloth that
    // hangs and bends, not a painted tube.
    for (i = 0; i < 6; i++) {
      x = rnd() * 128;
      var fg = g.createLinearGradient(x, 0, x + 9, 0);
      fg.addColorStop(0, 'rgba(0,0,0,0)');
      fg.addColorStop(0.5, 'rgba(0,0,0,' + foldA + ')');
      fg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = fg; g.fillRect(x, 0, 9, 128);
      var lg = g.createLinearGradient(x + 9, 0, x + 14, 0);
      lg.addColorStop(0, 'rgba(255,255,255,' + foldL + ')');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg; g.fillRect(x + 9, 0, 5, 128);
    }
    // weave grain over everything
    g.fillStyle = 'rgba(0,0,0,0.05)';
    for (y = 0; y < 128; y += 2) g.fillRect(0, y, 128, 1);
    g.fillStyle = 'rgba(255,255,255,0.035)';
    for (x = 0; x < 128; x += 2) g.fillRect(x, 0, 1, 128);
    var t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 2);
    // The canvas is painted in sRGB hex — tag it, or the renderer
    // treats the texels as linear and every garment washes out a
    // full stop brighter (round-1 proof: Raka's orange printed
    // beige, the office suit printed white).
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  var clothCache = {};
  function matCloth(hex, pattern, hex2, soft) {
    var key = hex + '|' + (pattern || '') + '|' + (hex2 || 0) + (soft ? '|s' : '');
    if (clothCache[key]) return clothCache[key];
    var m = new THREE.MeshToonMaterial({ color: 0xffffff, map: clothTexture(hex, pattern, hex2, soft), gradientMap: gradientMapBody });
    m.userData.baseHex = hex;
    clothCache[key] = m; return m;
  }

  // ---- unit-space metrics (character local height = 1) ---------------------
  // Semi-realistic proportions (Bos spec): ~7.25 heads tall. Head height
  // 0.138 (1/7.25); legs (thigh pivot to ground) 0.490 — BODYFIX3 moved
  // the pelvis 0.49 -> 0.505 so the legs land at 49.0% of height and
  // the pelvis->neck torso span trims back to ~+5% over the original
  // 0.52-pelvis rig (BODYFIX2's +9% made the legs read short/missing);
  // arms end at mid-thigh (fingertips ~0.39). Joint heights:
  //   ankle 0.055, knee 0.27, hip/pelvis 0.505, waist 0.60, chest 0.72,
  //   shoulder line 0.815, neck base 0.845, chin 0.862, eye line 0.929,
  //   head top 1.00. Head centre (head-pivot local) 0.069.
  // Seated hip height (re-derived, see idle_sit): the seated pelvis
  // pivot stays at 0.36 m at H 1.75 — the old rig's height, so sitters
  // stay grounded on the same benches/car seats: unit 0.2057, dy -0.299
  // (pelvis rose +0.015 in BODYFIX3; world height unchanged).
  // PROPFIX (2026-11-22, Bos's 11-point spec from the bodymeasure
  // report): leg length 49.0% -> 47.0% — pelvis 0.505 -> 0.485, so
  // the thigh pivot lands at 0.470 and the torso (hip pivot -> neck)
  // lengthens 0.355 -> 0.375. Knee re-derived proportionally inside
  // the shorter leg (thigh 0.211 / shin 0.204): kneeY 0.27 -> 0.259.
  // Shoulder pivots in (0.115 -> 0.107: shoulder line incl. arms
  // ~0.287H -> ~0.271H) and hip pivots out (0.088 -> 0.104) so the
  // feet land at shoulder width under the widened pelvis. Seated /
  // death heights re-derived proportionally (factor 0.470/0.490):
  // sit world 0.2057 -> 0.1973 (0.345 m at H 1.75), dy -0.288;
  // death rest 0.140 -> 0.134 (see the death pose keys).
  var M = {
    pelvisY: 0.485, ankleY: 0.055, kneeY: 0.259,
    spine1Y: 0.60, spine2Y: 0.72, neckY: 0.845, headY: 0.862,
    headCY: 0.069, headR: 0.069, // head centre / radius, head-pivot local
    headHW: 0.0552, headHD: 0.0607, // head half width / half depth
    shoulderX: 0.107, shoulderDY: 0.095,
    elbowDY: -0.175, handDY: -0.17, hipX: 0.104,
    sitDY: -0.288, sitPelvisWorld: 0.1973 // seated pelvis, unit space
  };
  // Builds vary shoulder width, belly, hip width AND height feel, not
  // only scale: w = overall width, d = depth, shoulder = shoulder-line
  // width, hip = hip width, belly = extra torso depth (0-1), head =
  // head scale, stoop = constant forward pitch (elderly, in the same
  // units as the hunch posture layer — 0.6 ≈ 5.4° spine + 1.8° chest).
  var BUILDS = {
    slim: { w: 0.88, d: 0.92, shoulder: 0.90, hip: 0.92, belly: 0, head: 1.00, stoop: 0 },
    avg: { w: 1.00, d: 1.00, shoulder: 1.00, hip: 1.00, belly: 0, head: 1.00, stoop: 0 },
    stocky: { w: 1.13, d: 1.16, shoulder: 1.08, hip: 1.12, belly: 0.5, head: 0.98, stoop: 0 },
    heavy: { w: 1.24, d: 1.34, shoulder: 1.12, hip: 1.22, belly: 1.0, head: 0.97, stoop: 0 },
    elderly: { w: 0.96, d: 1.00, shoulder: 0.94, hip: 1.00, belly: 0.2, head: 1.00, stoop: 0.6 },
    teen: { w: 0.90, d: 0.90, shoulder: 0.88, hip: 0.90, belly: 0, head: 1.06, stoop: 0 },
    kid: { w: 0.92, d: 0.92, shoulder: 0.90, hip: 0.92, belly: 0, head: 1.16, stoop: 0 }
  };

  // ---- shared geometries (unit space, one set for every build) -------------
  // Shaped, tapered forms (cylinders with differing top/bottom radii,
  // scaled ellipses) — NO stacked boxes for clothing.
  var geoCache = {};
  function geo(key, make) {
    if (!geoCache[key]) geoCache[key] = make();
    return geoCache[key];
  }
  function box(key, w, h, d) {
    return geo(key, function () { return new THREE.BoxGeometry(w, h, d); });
  }
  function cyl(key, rT, rB, h, seg, open) {
    return geo(key, function () { return new THREE.CylinderGeometry(rT, rB, h, seg || 10, 1, !!open); });
  }
  // ROUND 3 volume pass (user spec): the trunk is built from smooth
  // ELLIPSOIDS and the limbs from CAPSULES. Round 2's 8–10-segment
  // cylinders put one flat facet + one toon band across the whole
  // visible side — the cardboard read. Smooth curvature lets the
  // 3-step ramp sweep across the body, and the baked depth lands at
  // 55–60% of the shoulder span (0.33 unit): torso 0.192, chest 0.196,
  // hips 0.188. Widths stay at the round-2 reads.
  function ell(key, sx, sy, sz) {
    return geo(key, function () { var g = new THREE.SphereGeometry(0.5, 18, 13); g.scale(sx * 2, sy * 2, sz * 2); return g; });
  }
  function cap(key, r, len) {
    return geo(key, function () { return new THREE.CapsuleGeometry(r, len, 4, 12); });
  }
  // BODYFIX (round 4): cloth volume is ONE lathe-turned tapered
  // profile per garment piece — a single smooth surface of
  // revolution whose radius flows continuously (hem -> waist ->
  // chest -> shoulder), so the 3-step toon ramp sweeps across the
  // piece and NO horizontal ring can form. Round 3 stacked five
  // ellipsoids (hips / hem / torso / chest / belt), each one
  // quantising the ramp separately — that stack WAS the ring /
  // Michelin read in the round-3 cast photos. pts are
  // [radius, y] bottom -> top in the pivot's local space; the
  // depth (~52% of width) comes from the mesh z-scale at build.
  function lathe(key, pts, seg) {
    return geo(key, function () {
      // LatheGeometry's normals follow the profile's direction:
      // points MUST run bottom -> top (increasing y) or every
      // normal points inward and the piece renders in its dark
      // outline shade (the pass-1 black-arms bug). Normalise here
      // so profile authors can write either direction safely.
      var src = pts;
      if (src[0][1] > src[src.length - 1][1]) src = src.slice().reverse();
      var v = [];
      for (var i = 0; i < src.length; i++) v.push(new THREE.Vector2(src[i][0], src[i][1]));
      return new THREE.LatheGeometry(v, seg || 14);
    });
  }
  // BODYFIX3: merge transformed primitives into ONE BufferGeometry
  // (the fingered hand — one mesh per hand, not one per finger).
  // Sources are created fresh inside the builder and cloned by
  // toNonIndexed, so no cached geometry is ever mutated.
  function mergeGeos(list) {
    var pos = [], nor = [], uv = [];
    list.forEach(function (it) {
      var g = it.g.index ? it.g.toNonIndexed() : it.g;
      g.applyMatrix4(it.m);
      var p = g.attributes.position.array, n = g.attributes.normal.array,
        u = g.attributes.uv ? g.attributes.uv.array : null, i;
      for (i = 0; i < p.length; i++) pos.push(p[i]);
      for (i = 0; i < n.length; i++) nor.push(n[i]);
      if (u) for (i = 0; i < u.length; i++) uv.push(u[i]);
    });
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    if (uv.length) out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return out;
  }
  function xform(px, py, pz, sx, sy, sz) {
    var m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(px || 0, py || 0, pz || 0),
      new THREE.Quaternion(),
      new THREE.Vector3(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz));
    return m;
  }
  // One low-poly hand in WRIST-pivot space (palm faces +z, fingers
  // hang -y, thumb on the inner side = -side x): a rounded palm, a
  // wrist heel bridging to the forearm, FOUR stubby capsule fingers
  // with real gaps between them and a slight relaxed curl, and a
  // clear angled thumb — all merged into a single geometry. Total
  // length ~0.080, the BODYFIX2 hand envelope (~0.143 m at H 1.75).
  function buildHandGeo(side) {
    var parts = [];
    var palm = new THREE.SphereGeometry(0.05, 12, 9);
    parts.push({ g: palm, m: xform(0, -0.028, 0.001, 0.48, 0.56, 0.24) });
    var heel = new THREE.CapsuleGeometry(0.0125, 0.010, 2, 8);
    parts.push({ g: heel, m: xform(0, -0.006, 0.001, 1, 1, 1) });
    // fingers, thumb-side first; lengths vary (index/middle/ring/
    // pinky) so the silhouette is a hand, not a comb. Knuckle line
    // at y -0.058; each finger embeds 0.020 into the palm so it can
    // never float free of it, and fans a few degrees outward.
    var lens = [0.036, 0.040, 0.037, 0.028];
    var offs = [-0.0219, -0.0073, 0.0073, 0.0219];
    for (var i = 0; i < 4; i++) {
      var fi = side > 0 ? i : 3 - i; // mirror: thumb side flips
      var T = lens[fi], r = 0.0056;
      var fg = new THREE.CapsuleGeometry(r, T - 2 * r, 2, 8);
      var m = new THREE.Matrix4().makeTranslation(offs[i], -0.058, 0.002);
      m.multiply(new THREE.Matrix4().makeRotationX(-0.20));
      m.multiply(new THREE.Matrix4().makeRotationZ(offs[i] * 2.4));
      m.multiply(new THREE.Matrix4().makeTranslation(0, -T / 2 + 0.020, 0));
      parts.push({ g: fg, m: m });
    }
    // thumb: a clear capsule angled down-out-forward from the
    // palm's inner-front (the old scaled-sphere nub was invisible).
    var TT = 0.030, tr = 0.0068;
    var tg = new THREE.CapsuleGeometry(tr, TT - 2 * tr, 2, 8);
    var tm = new THREE.Matrix4().makeTranslation(-side * 0.019, -0.018, 0.004);
    tm.multiply(new THREE.Matrix4().makeRotationX(-0.35));
    tm.multiply(new THREE.Matrix4().makeRotationZ(-side * 0.80));
    tm.multiply(new THREE.Matrix4().makeTranslation(0, -TT / 2 + 0.004, 0));
    parts.push({ g: tg, m: tm });
    return mergeGeos(parts);
  }
  var GEO = {
    hips: function () {
      // BODYFIX3: the dome is SHALLOWER and its bottom rim is RAISED
      // (-0.070 -> -0.040, rim r 0.052) so the pelvis mesh tucks
      // INSIDE the two trouser-leg tubes (thigh6 reaches up past the
      // hip joint and is widest there). The old deep dome flowed
      // straight into the legs — pale trousers (Dario) merged into
      // one mass with a notch, and the thigh caps plugged into the
      // dome read as bolted action-figure joints. The raised rim is
      // the crotch point: below it the two leg tubes separate into
      // a clean inseam V, front and back.
      // PROPFIX: all radii x1.158 — the female pelvis lands at
      // male hip +5.5% against the PROPFIX male pelvis below
      // (Bos point 6: +5-6%, not the old +12.7%).
      return lathe('hips7', [[0.0715, -0.040], [0.0995, -0.036], [0.1135, -0.020], [0.1204, -0.002], [0.1233, 0.015], [0.1192, 0.045], [0.1135, 0.080]]);
    },
    hipsM: function () {
      // BODYFIX5: MALE pelvis — the shared hips6 dome reads as a
      // woman's pelvis on men (Bos: "paha pantat, kaki kek cewek
      // semua"): high, round, lifted seat + curved flare out of
      // the waist. The male profile peaks LOWER (0.1005 at +0.012,
      // was 0.1065 at +0.015) and NARROWER at the top (0.091 at
      // +0.080, was 0.098) so the waist->hip transition is a
      // straighter drop, and buildRig pairs it with a much
      // flatter z-scale (0.48 vs 0.60) so the seat reads as flat
      // trouser cloth sloping down, not a lifted curve. The rim /
      // crotch point is IDENTICAL to hips6 (-0.040, r 0.052) so
      // the inseam V and the thigh6/thighM tuck are unchanged.
      // PROPFIX: all radii x1.163 and hipK 0.94 -> 1.00 in
      // buildRig — male hip ratio 64-66 -> ~84 (shoulder = 100,
      // Bos point 1). The peak stays low and the top stays
      // narrower than the peak, so the straighter male drop and
      // the flat seat survive the widening.
      return lathe('hipsM6', [[0.0720, -0.040], [0.0980, -0.036], [0.1081, -0.020], [0.1151, -0.004], [0.1169, 0.012], [0.1116, 0.040], [0.1058, 0.080]]);
    },
    torso: function () {
      // PROPFIX: all radii x1.134 — the waist was the frame's
      // worst deviation (ratio 64-67 vs Bos's 82); with the
      // shoulder line pulled in to ~0.271H this lands the waist
      // at ~78 (Bos point 1). The top rings grow by the same
      // factor so the trunk reads as ONE straighter column into
      // the chest, not a waist bulge.
      return lathe('torso5', [[0.0340, -0.085], [0.0930, -0.080], [0.1134, -0.068], [0.1145, -0.052], [0.1100, -0.030], [0.1083, 0.000], [0.1111, 0.040], [0.1134, 0.080], [0.1134, 0.105]]);
    },
    chest: function () {
      return lathe('chest4', [[0.020, -0.045], [0.070, -0.040], [0.095, -0.028], [0.104, -0.005], [0.116, 0.030], [0.124, 0.062], [0.123, 0.090], [0.114, 0.112], [0.092, 0.132], [0.058, 0.146], [0.046, 0.152]]);
    },
    belt: function () { return cyl('belt5', 0.1120, 0.1120, 0.024, 14); },
    // POLISH2 (spec A1): the waistband as its own layer — a wider
    // belt seated at the trouser waist (spine1 -0.038, over the
    // hips' top ring) so hem -> belt + buckle -> trousers stack as
    // three readable layers instead of one tube with a ring on it.
    beltP2: function () { return cyl('beltP2', 0.1175, 0.1175, 0.024, 14); },
    // POLISH2B (item 6): the police duty belt — a full 0.05 m band.
    beltDuty: function () { return cyl('beltDuty2', 0.1185, 0.1185, 0.050, 14); },
    // POLISH2 (spec A1): the garment HEM — a short flared lathe
    // that starts on the torso, swells gently and ends BELOW the
    // torso's waist, overlapping the belt's top edge: the jacket /
    // shirt silhouette the flat torso lathe never had. Radii ride
    // ~0.006 proud of the torso profile so no surface z-fights.
    hem: function () {
      return lathe('hemP2', [[0.1155, 0.014], [0.1175, -0.008], [0.1200, -0.022], [0.1215, -0.030]], 14);
    },
    hemSlim: function () {
      return lathe('hemP2s', [[0.1135, 0.010], [0.1145, -0.010], [0.1160, -0.024]], 14);
    },
    // POLISH2: safety-vest reflective bands that FOLLOW the trunk
    // profiles (+~0.005 proud) instead of floating as cylinders.
    reflChest: function () {
      return lathe('reflP2c', [[0.1120, 0.004], [0.1170, 0.018], [0.1225, 0.034], [0.1255, 0.046]], 14);
    },
    reflWaist: function () {
      return lathe('reflP2w', [[0.1195, -0.068], [0.1205, -0.056], [0.1170, -0.044]], 14);
    },
    // POLISH2 (spec A4): the hijab's shoulder drape — an open
    // lathe cone from the neck over the shoulders, so the cloth
    // falls as cloth instead of ending at a head shell.
    hijabDrape: function () {
      return lathe('drapeP2', [[0.050, 0.010], [0.082, -0.045], [0.118, -0.105], [0.130, -0.150]], 14);
    },
    btn: function () { return geo('btnP2', function () { var g = new THREE.SphereGeometry(0.0034, 8, 6); g.scale(1, 1, 0.55); return g; }); },
    collar: function () {
      return lathe('collar4', [[0.125, 0.098], [0.108, 0.120], [0.084, 0.138], [0.055, 0.150]]);
    },
    shoulderCap: function () { return geo('shcap4', function () { var g = new THREE.SphereGeometry(0.033, 12, 9); g.scale(1.08, 0.82, 1.08); return g; }); },
    neck: function () { return cyl('neck', 0.020, 0.023, 0.045, 8); },
    head: function () {
      return geo('head', function () {
        var g = new THREE.SphereGeometry(M.headR, 18, 14);
        g.scale(0.80, 1.0, 0.88); return g;
      });
    },
    jaw: function () {
      return geo('jaw', function () {
        var g = new THREE.SphereGeometry(0.046, 14, 10);
        g.scale(0.88, 0.78, 0.92); return g;
      });
    },
    ear: function () { return geo('ear', function () { var g = new THREE.SphereGeometry(0.0135, 8, 6); g.scale(0.45, 1, 0.72); return g; }); },
    uArm: function () {
      // BODYFIX2: bottom extended to -0.180 so the profile still
      // covers the elbow joint after elbowDY moved to -0.175.
      // PROPFIX (Bos point 8): the top rings taper in gradually
      // (0.010/0.026/0.0285 ball -> 0.008/0.022/0.0275 slope) and
      // the shoulder pivot moved in to 0.107, so the arm emerges
      // from the chest slope as ONE smooth shoulder line — no
      // round deltoid bump sitting on the jacket.
      return lathe('uarm6', [[0.008, 0.028], [0.022, 0.014], [0.0275, -0.008], [0.0270, -0.060], [0.0255, -0.110], [0.0235, -0.150], [0.014, -0.180]], 12);
    },
    fArm: function () {
      // BODYFIX2: bottom extended to -0.174 for the new handDY -0.17.
      return lathe('farm5', [[0.009, 0.018], [0.020, 0.006], [0.0235, -0.020], [0.0225, -0.060], [0.0195, -0.105], [0.0160, -0.140], [0.0135, -0.160], [0.010, -0.174]], 12);
    },
    cuff: function () { return cyl('cuff4', 0.0175, 0.0175, 0.030, 12); },
    sleeveBand: function () { return cyl('slband4', 0.0265, 0.0265, 0.024, 12); },
    hand: function (side) {
      // BODYFIX3: the fingerless paddle is gone (Bos: "Tangan gada
      // jarinya?"). Palm + four stubby fingers + a clear thumb,
      // merged into ONE geometry per hand (buildHandGeo) — same
      // ~0.082 envelope and the exact face-skin material instance
      // as BODYFIX2's mitt. Cached per side (the thumb mirrors).
      // PROPFIX (Bos point 7): the whole hand scales 0.85 — the
      // BODYFIX2 envelope read oversized against the slimmed
      // arms. The material is untouched: hands already use the
      // exact face-skin material instance (handM = skinM in
      // buildRig), so hand tone can never run paler than the arm.
      return geo('hand7' + (side > 0 ? 'L' : 'R'), function () { var g = buildHandGeo(side); g.scale(0.85, 0.85, 0.85); return g; });
    },
    thigh: function () {
      // BODYFIX3: ONE trouser surface from above the hip joint to
      // below the knee — no cap, no plug. The profile starts buried
      // inside the trunk (top +0.050, a fast cone close so it can
      // never stab through the torso at full sprint swing), is
      // WIDEST at the joint (0.0575) and tapers monotonically:
      // fuller thigh (was max r 0.046), a readable knee pinch
      // (0.0330 at the knee pivot), and the bottom tucks into the
      // shin top. The thigh segment is now 0.220 (pelvis 0.505,
      // knee 0.27). Because the tube surrounds the joint and the
      // hips dome (hips6) tucks inside it, no circular seam can
      // show at the hip, standing or at full stride.
      // PROPFIX: knee ring = the MALE knee ring (0.0355) — Bos
      // point 6: women's knee and ankle widths equal men's. The
      // knee line moved with the 47% leg (knee pivot now -0.211
      // below the thigh pivot, was -0.220).
      // PROPFIX round 3: the upper rings (-0.002..-0.125) taper
      // x0.92 — the hip widening (hipK 1.00) had pushed the
      // thigh-top ratio to ~43 vs the 36 reference; the knee
      // ring and below are untouched, so knee/ankle stay on spec
      // and the column tapers straighter (Bos point 4).
      // LEGFIX B: upper rings x0.95 — the probe still read the
      // thigh top at 38.3 (shoulder = 100) against the 36-37
      // target; the knee ring and below stay, so the column
      // keeps its straight taper.
      return lathe('thigh7', [[0.010, 0.050], [0.026, 0.038], [0.044, 0.018], [0.0472, -0.002], [0.0503, -0.030], [0.0476, -0.075], [0.0446, -0.125], [0.0435, -0.170], [0.0395, -0.191], [0.0355, -0.211], [0.023, -0.229]], 12);
    },
    thighM: function () {
      // BODYFIX5: MALE thigh — same construction contract as
      // thigh6 (one surface from above the joint to below the
      // knee, widest at the joint, capped cone top) but the
      // OUTER LINE is nearly straight: thigh6 swells out of the
      // joint then falls fast into a deep knee pinch (knee =
      // 57% of max) — one smooth convex curve, the feminine
      // read. thighM keeps the volume (max 0.0560 at the joint)
      // and tapers almost linearly to a shallow knee (0.0385 =
      // 69% of max): a straight trouser column, not a curve.
      // PROPFIX (Bos point 4): straight, slightly loose trousers
      // — the knee ring drops to 0.0355 at the new knee line
      // (-0.211) so knee ratio lands 26-27 (shoulder = 100) and
      // the column thigh -> knee -> ankle stops tapering hard.
      // PROPFIX round 3: upper rings x0.92 (see thigh7) — the
      // joint stays the widest point of the leg, but the
      // thigh-top ratio returns to ~37 from ~43.
      // LEGFIX B: upper rings x0.95, same correction as thigh7
      // (probe thigh top 38.3 -> target 36-37, shoulder = 100).
      return lathe('thighM6', [[0.010, 0.050], [0.026, 0.038], [0.044, 0.018], [0.0467, -0.002], [0.0489, -0.030], [0.0459, -0.075], [0.0442, -0.125], [0.0435, -0.170], [0.0390, -0.191], [0.0355, -0.211], [0.023, -0.229]], 12);
    },
    shin: function () {
      // BODYFIX2: shin segment 0.215; calf 0.0325 easing to a
      // relaxed ankle 0.0225 (trouser leg, not a stocking).
      // PROPFIX: ankle ring = the MALE ankle ring (0.0260, Bos
      // point 6) and the bottom rings re-seated for the shorter
      // shin segment (knee -> ankle 0.204, was 0.215).
      // LEGFIX B: fuller knee head (0.027 -> 0.0295) so the knee
      // reads as a joint, not a tube pinch, and the two bottom
      // rings widen (0.018/0.011 -> 0.0235/0.0205) so the
      // trouser leg stacks over the shoe instead of vanishing
      // into a stocking point at the ankle.
      return lathe('shin6', [[0.011, 0.017], [0.0295, 0.004], [0.0315, -0.028], [0.0325, -0.065], [0.0285, -0.121], [0.0260, -0.182], [0.0235, -0.204], [0.0205, -0.217]], 12);
    },
    shinM: function () {
      // BODYFIX5: MALE shin — straighter column: calf peak kept
      // (0.0335) but the ankle is fuller (0.0260 at -0.182, was
      // 0.0225) so the leg stops curving in to a narrow ankle.
      // PROPFIX: bottom rings re-seated for the 0.204 shin
      // segment (ankle ring 0.0260 already gives ratio 19-20
      // once hipK = 1.00 — Bos point 4).
      // LEGFIX B: same knee/stack correction as shin6.
      return lathe('shinM6', [[0.011, 0.017], [0.0295, 0.004], [0.0320, -0.028], [0.0335, -0.065], [0.0300, -0.121], [0.0260, -0.182], [0.0235, -0.204], [0.0205, -0.217]], 12);
    },
    pantCuffM: function () { return cyl('pcuffM7', 0.0300, 0.0300, 0.044, 12); },
    shortsBandM: function () {
      // BODYFIX5: seated on the thighM profile at -0.185
      // (r ~0.0423 there) with the same ~proud margin as shband6.
      return geo('shbandM5', function () { return new THREE.CylinderGeometry(0.0450, 0.0425, 0.024, 12); });
    },
    pantCuff: function () { return cyl('pcuff7', 0.0300, 0.0300, 0.044, 12); },
    shortsBand: function () {
      // BODYFIX3: tapered to the thigh6 profile at its seat
      // (-0.185) so the hem sits ON the leg (the old straight
      // r 0.0315 cylinder drowned inside the fuller thigh).
      // PROPFIX: radii follow the wider thigh7 knee column at
      // the seat (same proud margin as the male band now).
      return geo('shband7', function () { return new THREE.CylinderGeometry(0.0450, 0.0425, 0.024, 12); });
    },
    // BODYFIX4: the shoe is a real shoe profile, not a box.
    // Pass 1 tried an extruded side silhouette — from the front
    // it still read as a white slab (constant width, flat vamp
    // in one toon band). The upper is now a flattened CAPSULE
    // body (rounded toe that narrows and dips, smooth instep
    // arc) merged with a sphere riser at the heel for the ankle
    // collar — rounded from every angle. The sole is the
    // FOOTPRINT (width x forward) extruded to 0.018 total
    // thickness, ~0.006 proud of the upper on every side so it
    // wraps the bottom edge, in a much darker shade (0.32) than
    // the old 0.55 beige line. Both are authored in FOOT-PIVOT
    // space: sole bottom lands exactly on -0.055 (the ankle
    // pivot height), so ground contact and every gait/death
    // offset are unchanged. Footprint length stays the old
    // sole's ~0.18 (~1.5x head width).
    // PROPFIX (Bos point 5): CHUNKY shoe — sole thickness
    // 0.018 -> 0.026 (extrude depth 0.013 -> 0.021), footprint
    // widened x1.25 (width 0.080 -> ~0.099, target ~0.10H) and
    // trimmed x0.96 fore-aft (length ~0.178 = ~1.6x head width);
    // the upper widens and rises with it (capsule x-scale
    // 0.98 -> 1.24, height scale 0.60 -> 0.66, centre lifted
    // -0.0245 -> -0.021 so the vamp sits ON the thick sole).
    // buildRig additionally scales shoe+sole per build so the
    // length tracks 1.6x that build's head width (kid fix).
    shoe: function () {
      return geo('shoe6', function () {
        var body = new THREE.CapsuleGeometry(0.0315, 0.095, 4, 10);
        var bm = new THREE.Matrix4().makeTranslation(0, -0.021, 0.024);
        bm.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 + 0.06));
        bm.multiply(new THREE.Matrix4().makeScale(1.24, 0.97, 0.66));
        var riser = new THREE.SphereGeometry(0.030, 10, 8);
        var rm = new THREE.Matrix4().makeTranslation(0, -0.014, -0.024);
        rm.multiply(new THREE.Matrix4().makeScale(1.16, 0.85, 1.25));
        return mergeGeos([{ g: body, m: bm }, { g: riser, m: rm }]);
      });
    },
    sole: function () {
      return geo('sole5', function () {
        var s = new THREE.Shape();
        s.moveTo(-0.035, -0.0557);
        s.quadraticCurveTo(-0.045, -0.0538, -0.0456, -0.0192);
        s.quadraticCurveTo(-0.0463, 0.0288, -0.0469, 0.0691);
        s.quadraticCurveTo(-0.0469, 0.1018, -0.025, 0.1104);
        s.quadraticCurveTo(0, 0.1142, 0.025, 0.1104);
        s.quadraticCurveTo(0.0469, 0.1018, 0.0469, 0.0691);
        s.quadraticCurveTo(0.0463, 0.0288, 0.0456, -0.0192);
        s.quadraticCurveTo(0.045, -0.0538, 0.035, -0.0557);
        s.quadraticCurveTo(0, -0.0586, -0.035, -0.0557);
        var g = new THREE.ExtrudeGeometry(s, { depth: 0.021, bevelEnabled: true, bevelThickness: 0.0025, bevelSize: 0.0025, bevelSegments: 1, curveSegments: 6, steps: 1 });
        g.rotateX(Math.PI / 2);
        // After rotateX the extrusion runs DOWNWARD from y +0.0025
        // to y -0.0235 (depth 0.021 + bevel), so the translate that
        // lands the sole bottom exactly on -0.055 is -0.0315.
        g.translate(0, -0.0315, 0);
        return g;
      });
    },
    // LEGFIX B: the calf — a unit ellipsoid the rig scales to
    // (0.027, 0.047, 0.020) and seats on the back of the upper
    // shin, proud of the lathe behind, hidden inside it in
    // front: the muscle bulge the smooth tube never had.
    calf: function () {
      return geo('calf7', function () {
        var g = new THREE.SphereGeometry(1, 10, 8);
        g.scale(0.027, 0.047, 0.020);
        return g;
      });
    },
    // LEGFIX D: duty BOOT — the sneaker's capsule body + heel
    // riser + a shaft cylinder that swallows the shin bottom
    // and the trouser cuff (boot over pants, the uniform read).
    // Same foot-pivot contract: sole bottom at -0.055.
    shoeBoot: function () {
      return geo('shoeboot7', function () {
        var body = new THREE.CapsuleGeometry(0.0315, 0.095, 4, 10);
        var bm = new THREE.Matrix4().makeTranslation(0, -0.021, 0.024);
        bm.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 + 0.06));
        bm.multiply(new THREE.Matrix4().makeScale(1.24, 0.97, 0.66));
        var riser = new THREE.SphereGeometry(0.030, 10, 8);
        var rm = new THREE.Matrix4().makeTranslation(0, -0.014, -0.024);
        rm.multiply(new THREE.Matrix4().makeScale(1.16, 0.85, 1.25));
        var shaft = new THREE.CylinderGeometry(0.0375, 0.0395, 0.105, 12);
        var sm2 = new THREE.Matrix4().makeTranslation(0, 0.030, -0.006);
        sm2.multiply(new THREE.Matrix4().makeScale(1.0, 1.0, 0.92));
        return mergeGeos([{ g: body, m: bm }, { g: riser, m: rm }, { g: shaft, m: sm2 }]);
      });
    },
    // LEGFIX D: HEEL — a slimmer capsule on a real heel block
    // (block bottom on the -0.055 ground line; buildRig shortens
    // the footprint sole to the front two-thirds to match).
    shoeHeel: function () {
      return geo('shoeheel8', function () {
        // R2: shorter toe box + slimmer, taller heel block —
        // the first cut read as a flat pink slipper in the run
        // still; a pump needs the gap under the arch to show.
        var body = new THREE.CapsuleGeometry(0.030, 0.078, 4, 10);
        var bm = new THREE.Matrix4().makeTranslation(0, -0.018, 0.032);
        bm.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 + 0.10));
        bm.multiply(new THREE.Matrix4().makeScale(1.06, 0.95, 0.60));
        var heel = new THREE.BoxGeometry(0.027, 0.052, 0.025);
        var hm = new THREE.Matrix4().makeTranslation(0, -0.029, -0.044);
        return mergeGeos([{ g: body, m: bm }, { g: heel, m: hm }]);
      });
    },
    // LEGFIX D: SANDAL toe cap — a flat skin dome over the front
    // of the sole; buildRig adds the two strap bands, so the
    // foot reads as a foot in a sandal, not a brown shoe.
    sandalToe: function () {
      return geo('sandaltoe7', function () {
        var g = new THREE.CapsuleGeometry(0.029, 0.062, 4, 10);
        var m = new THREE.Matrix4().makeTranslation(0, -0.034, 0.048);
        m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 + 0.10));
        m.multiply(new THREE.Matrix4().makeScale(1.18, 0.92, 0.34));
        g.applyMatrix4(m);
        return g;
      });
    },
    skirt: function () { return cyl('skirt5', 0.124, 0.158, 0.16, 14, true); },
    // POLISH (Bos point 1): smaller, wider almond — the old
    // tall oval (r 0.0088 x 1.3) read as bulging doll eyes.
    eye: function () { return geo('eye', function () { var g = new THREE.SphereGeometry(0.0082, 10, 8); g.scale(1.12, 1.02, 0.42); return g; }); },
    glint: function () { return geo('glint', function () { return new THREE.SphereGeometry(0.0028, 6, 4); }); },
    // BODYFIX2: brows a touch longer + thicker — they read faint
    // at street distance in the bodyfix renders.
    // POLISH (Bos point 1): thinner brow bar — the old 0.0075
    // slab read as a heavy stern slash on calm faces.
    brow: function () { return box('brow6', 0.027, 0.0052, 0.005); },
    noseBridge: function () { return box('nosebr', 0.0075, 0.030, 0.007); },
    noseTip: function () { return box('nosetip', 0.011, 0.007, 0.009); },
    mouth: function () { return geo('mouth', function () { return new THREE.TorusGeometry(0.0105, 0.0028, 5, 10, 2.0); }); },
    mouthFlat: function () { return box('mouthflat', 0.020, 0.0035, 0.004); },
    mouthOpen: function () { return geo('mopen', function () { var g = new THREE.SphereGeometry(0.006, 8, 6); g.scale(1, 1.3, 0.5); return g; }); },
    blush: function () { return geo('blush', function () { var g = new THREE.SphereGeometry(0.011, 8, 6); g.scale(1, 0.7, 0.4); return g; }); }
  };

  // One part mesh + its inverted-hull outline child (BackSide,
  // scale ~1.06, spec). The outline inherits the part's transform.
  function part(parent, geometry, material, x, y, z, outline) {
    var m = new THREE.Mesh(geometry, material);
    m.position.set(x || 0, y || 0, z || 0);
    // ROUND 3: characters cast AND receive the world's shadows (round 2
    // set castShadow only — a figure standing in a tree/building shadow
    // stayed fully lit, another cutout tell). Face meshes opt back out
    // at creation so a hat brim can never stripe the face.
    m.castShadow = true; m.receiveShadow = true;
    if (outline) {
      var o = new THREE.Mesh(geometry, outlineMatFor(material));
      // PROPFIX: 1.05 -> 1.06 — the hull must stay readable at
      // MEDIUM distance too, not only in close-up (Bos point 10);
      // factory LOD1 no longer hides outlines either.
      // POLISH: back to 1.05 with the per-colour tint above —
      // thinner and tinted reads cleaner than thick and black.
      o.scale.setScalar(1.05); o.userData.isOutline = true;
      m.add(o);
    }
    parent.add(m);
    return m;
  }
  // Face-zone / hair / hat parts: NEVER cast a shadow (the chibi
  // proofs showed hat shadows striping the face, and the toon band
  // came from the head's own shadow map). Outline kept where it reads.
  function softPart(parent, geometry, material, x, y, z, outline) {
    var m = part(parent, geometry, material, x, y, z, outline);
    m.castShadow = false;
    return m;
  }

  // ---- face -----------------------------------------------------------------
  // Realistic-ish layout at small size: eyes at the MIDDLE of the head,
  // small and calm (flat dark almonds, no bulging eyeballs), THICK
  // separate brows, a nose WITH a bridge + tip, a readable mouth line.
  // Expressions move brow angle / brow height / eye scale / mouth
  // shape only. Blinking is a per-character timer.
  var EXPRESSIONS = {
    // BODYFIX2: neutral brows carry a slight lift (browA -3,
    // browY +0.001) — the flat bodyfix brows read lifeless — and
    // 'warm' is the player's default: a SUBTLE friendly smile
    // (small mouth arc via ms 0.75, eyes barely softened).
    neutral: { browA: -3, browY: 0.001, eyeY: 1.0, mouth: 'flat', ms: 1.15 },
    warm: { browA: -4, browY: 0.002, eyeY: 0.94, mouth: 'smile', ms: 0.75 },
    happy: { browA: -5, browY: 0.003, eyeY: 0.66, mouth: 'smile', ms: 1.15 },
    angry: { browA: 26, browY: -0.002, eyeY: 0.80, mouth: 'frown', ms: 0.9 },
    scared: { browA: -22, browY: 0.005, eyeY: 1.22, mouth: 'open', ms: 0.9 },
    hurt: { browA: -14, browY: 0.001, eyeY: 0.35, mouth: 'frown', ms: 0.9 }
  };
  function buildFace(headPivot, cfg) {
    var cy = M.headCY, face = {};
    var darkMat = matFor(0x241a12), whiteMat = matFor(0xf7f3ea);
    var hairMat = matFor(cfg.hairColor);
    var noseMat = matSkin(cfg.skinDark);
    function eye(side) {
      var g = new THREE.Group();
      g.position.set(side * 0.021, cy - 0.002, 0.0555);
      var w = new THREE.Mesh(GEO.eye(), darkMat); g.add(w);
      var gl = new THREE.Mesh(GEO.glint(), whiteMat); gl.position.set(0.003, 0.004, 0.0032); g.add(gl);
      headPivot.add(g); return g;
    }
    face.eyeL = eye(1); face.eyeR = eye(-1);
    // POLISH (Bos point 1): brows differ per character — length
    // and weight vary deterministically with the seed, so the
    // cast stops sharing one identical brow bar. (Expressions
    // drive rotation/height only; this scale is untouched.)
    var browR = rng((cfg.seed || 1) * 131 + 7);
    var browLenK = 0.88 + browR() * 0.30, browThickK = 0.85 + browR() * 0.45;
    function brow(side) {
      var g = new THREE.Group();
      g.position.set(side * 0.0215, cy + 0.017, 0.0540);
      var b = new THREE.Mesh(GEO.brow(), hairMat);
      b.scale.set(browLenK, browThickK, 1);
      b.position.x = side * 0.002; g.add(b);
      headPivot.add(g); return g;
    }
    face.browL = brow(1); face.browR = brow(-1);
    var bridge = softPart(headPivot, GEO.noseBridge(), noseMat, 0, cy - 0.017, 0.0585, false);
    bridge.rotation.x = -0.10;
    softPart(headPivot, GEO.noseTip(), noseMat, 0, cy - 0.0315, 0.0595, false);
    face.mouth = softPart(headPivot, GEO.mouth(), darkMat, 0, cy - 0.043, 0.0560, false);
    face.mouthFlat = softPart(headPivot, GEO.mouthFlat(), darkMat, 0, cy - 0.045, 0.0565, false);
    face.mouthOpen = softPart(headPivot, GEO.mouthOpen(), darkMat, 0, cy - 0.049, 0.0560, false);
    face.mouthOpen.visible = false;
    if (cfg.face && cfg.face.mustache) {
      // Small only, and only for the one character who needs it.
      var mm = matFor(cfg.hairColor);
      var m1 = softPart(headPivot, GEO.brow(), mm, 0.011, cy - 0.036, 0.0565, false);
      m1.scale.set(0.62, 1.15, 1); m1.rotation.z = 0.16;
      var m2 = softPart(headPivot, GEO.brow(), mm, -0.011, cy - 0.036, 0.0565, false);
      m2.scale.set(0.62, 1.15, 1); m2.rotation.z = -0.16;
    }
    if (cfg.face && cfg.face.blush) {
      var bm = matFor(0xe88a7a);
      softPart(headPivot, GEO.blush(), bm, 0.042, cy - 0.032, 0.048, false);
      softPart(headPivot, GEO.blush(), bm, -0.042, cy - 0.032, 0.048, false);
    }
    return face;
  }
  function applyExpression(face, cur, blink) {
    var eyeY = Math.max(0.06, cur.eyeY * blink);
    face.eyeL.scale.set(1, eyeY, 1); face.eyeR.scale.set(1, eyeY, 1);
    face.browL.rotation.z = -cur.browA * DEG;
    face.browR.rotation.z = cur.browA * DEG;
    face.browL.position.y = face.browR.position.y = M.headCY + 0.017 + cur.browY;
    var mode = cur.mouth;
    face.mouth.visible = mode === 'smile' || mode === 'frown';
    face.mouthFlat.visible = mode === 'flat';
    face.mouthOpen.visible = mode === 'open';
    if (mode === 'smile') { face.mouth.rotation.z = -Math.PI / 2 - 1.0; face.mouth.scale.setScalar(cur.ms != null ? cur.ms : 1.15); }
    else if (mode === 'frown') { face.mouth.rotation.z = Math.PI / 2 - 1.0; face.mouth.scale.setScalar(0.9); }
    else { face.mouth.rotation.z = -Math.PI / 2 - 1.0; face.mouth.scale.set(1.6, 0.45, 1); }
  }

  // ---- hair & hats ------------------------------------------------------------
  // One shaped cap shell per style on the small head (r 0.069, ellipsoid
  // 0.80 x 1.0 x 0.88). The rim sits high at the front (brows stay clear),
  // lower at the back, so front / side / back all read as the same
  // haircut. Hair and hats NEVER cast shadows (softPart) — the chibi
  // proofs showed hat shadows striping the face.
  function hairCap(rad, thetaLen, squash) {
    var key = 'haircap2|' + rad.toFixed(3) + '|' + thetaLen.toFixed(2) + '|' + (squash || 0.99);
    return geo(key, function () {
      var g = new THREE.SphereGeometry(rad, 18, 12, 0, Math.PI * 2, 0, thetaLen);
      g.scale(0.80, squash || 0.99, 0.89); return g;
    });
  }
  function buildHair(headPivot, cfg) {
    var style = cfg.hair || 'short';
    if (style === 'bald' || style === 'none') return null;
    var hm = matFor(cfg.hairColor), cy = M.headCY, R = M.headR;
    // POLISH (Bos point 2): the second hair tone — a lightened
    // derivative of the base colour for the crown highlight.
    var hiM = matFor(lighten(cfg.hairColor, 0.30));
    var grp = new THREE.Group(); headPivot.add(grp);
    function cap(rad, tl, sq, y, z) {
      var m = softPart(grp, hairCap(rad, tl, sq), hm, 0, cy + (y || 0), z || 0, true);
      // tilt the shell back: the front rim rises above the brows
      // while the back rim drops — one haircut from every angle
      m.rotation.x = -0.42;
      // POLISH: highlight shell over the crown — same sweep
      // shortened to the top, radius +1.5% so it rides ON the
      // base cap; no outline of its own (the base cap's hull
      // still draws the silhouette).
      var hi = softPart(grp, hairCap(rad * 1.015, tl * 0.52, sq), hiM, 0, cy + (y || 0) + 0.0035, z || 0, false);
      hi.rotation.x = -0.42;
      return m;
    }
    if (style === 'hijab') {
      // Cloth shell: bigger sphere swept down the back and sides,
      // face left open, plus a drape panel to the shoulders.
      // POLISH2B (item 6 fix, measured on the lineup crop): the old
      // sweep (0.80pi) + tip (-0.25) left the shell's front surface
      // PROUD of the face plane — the whole face rendered in cloth
      // green with the features on top of it, the "green-skinned
      // NPC" the user flagged. The coverage math: the face-forward
      // direction sits 90 deg + tip from the cap axis, so the face
      // only opens when sweep < 90 deg + tip. Sweep 0.60pi (108
      // deg) + tip -0.40 (23 deg) opens the face (113 > 108) while
      // back (67 deg) and sides (90 deg) stay covered.
      var shell = softPart(grp, hairCap(R * 1.14, Math.PI * 0.60, 1.06), hm, 0, cy + 0.004, -0.012, true);
      shell.scale.set(1.04, 1.10, 1.04);
      shell.rotation.x = -0.40;
      // POLISH: cloth highlight over the crown, same treatment
      // as the hair caps (Bos point 2: two tones, clean edge).
      var shellHi = softPart(grp, hairCap(R * 1.155, Math.PI * 0.36, 1.06), hiM, 0, cy + 0.0075, -0.012, false);
      shellHi.scale.set(1.04, 1.10, 1.04);
      shellHi.rotation.x = -0.40;
      softPart(grp, box('drape2', 0.125, 0.13, 0.022), hm, 0, cy - 0.085, -0.062, true);
      return grp;
    }
    switch (style) {
      case 'buzz': cap(R * 1.04, Math.PI * 0.42, 0.97, 0.004); break;
      case 'slick': cap(R * 1.06, Math.PI * 0.50, 0.94, 0.005, -0.004); break;
      case 'quiff':
        cap(R * 1.07, Math.PI * 0.52, 0.99, 0.006);
        softPart(grp, box('quifftuft', 0.05, 0.02, 0.045), hm, 0, cy + 0.052, 0.030, false);
        break;
      case 'undercut': cap(R * 1.06, Math.PI * 0.40, 0.97, 0.005); break;
      case 'messy': cap(R * 1.10, Math.PI * 0.56, 1.03, 0.005); break;
      case 'curly': cap(R * 1.17, Math.PI * 0.58, 1.0, 0.010); break;
      case 'afro': cap(R * 1.25, Math.PI * 0.62, 1.02, 0.012); break;
      case 'bun':
        cap(R * 1.06, Math.PI * 0.55, 0.97, 0.004);
        softPart(grp, geo('bun2', function () { return new THREE.SphereGeometry(0.026, 10, 8); }), hm, 0, cy + 0.062, -0.048, true);
        break;
      case 'ponytail':
        cap(R * 1.06, Math.PI * 0.55, 0.97, 0.004);
        var tail = softPart(grp, geo('ptail2', function () { return new THREE.CylinderGeometry(0.013, 0.009, 0.11, 7); }), hm, 0, cy + 0.028, -0.062, true);
        tail.rotation.x = 0.25; grp.userData.swing = tail;
        break;
      case 'long':
        cap(R * 1.07, Math.PI * 0.58, 0.98, 0.004);
        softPart(grp, box('longback2', 0.095, 0.17, 0.02), hm, 0, cy - 0.055, -0.058, true);
        break;
      case 'bob':
        cap(R * 1.08, Math.PI * 0.64, 0.98, 0.003);
        softPart(grp, box('bobside3', 0.116, 0.066, 0.10), hm, 0, cy - 0.018, -0.018, true);
        break;
      default: cap(R * 1.06, Math.PI * 0.52, 0.99, 0.004); // short
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
      // POLISH2B (item 2): more loft — the dome sits higher and
      // fuller and the band thickens, so the beanie reads as knit
      // volume on the head, not a grey skullcap film. (Raka's is
      // near-black 0x1c1e24 by archetype, not grey.)
      var bc = softPart(grp, hairCap(R * 1.13, Math.PI * 0.52, 1.04), hm, 0, cy + 0.014, 0, true);
      bc.rotation.x = -0.50;
      // the band sits ABOVE the brow line (brow top at cy+0.020)
      var band = softPart(grp, geo('beanband2', function () { return new THREE.CylinderGeometry(R * 0.88, R * 0.91, 0.034, 14, 1, true); }), hm, 0, cy + 0.036, 0, false);
      band.scale.set(1.0, 1, 1.08);
      return grp;
    }
    if (hat === 'cap' || hat === 'peci') {
      if (hat === 'peci') {
        var pc = softPart(grp, geo('peci2', function () { return new THREE.CylinderGeometry(R * 0.68, R * 0.74, 0.05, 12); }), matFor(0x14161a), 0, cy + 0.052, 0, true);
        pc.scale.set(1.0, 1, 1.08);
      } else {
        softPart(grp, hairCap(R * 1.07, Math.PI * 0.40, 0.96), hm, 0, cy + 0.006, 0, true);
        var brim = softPart(grp, box('capbrim2', 0.062, 0.006, 0.05), hm, 0, cy + 0.034, 0.072, false);
        brim.rotation.x = 0.10;
      }
      return grp;
    }
    if (hat === 'police') {
      var band2 = softPart(grp, geo('polcap2', function () { return new THREE.CylinderGeometry(R * 0.82, R * 0.86, 0.045, 14); }), hm, 0, cy + 0.048, 0, true);
      band2.scale.set(1.0, 1, 1.08);
      softPart(grp, geo('poldome2', function () { var g = new THREE.SphereGeometry(R * 0.82, 14, 8); g.scale(1, 0.38, 1.08); return g; }), hm, 0, cy + 0.068, 0, false);
      var peak = softPart(grp, box('polpeak2', 0.07, 0.005, 0.042), matFor(0x14161c), 0, cy + 0.028, 0.066, false);
      peak.rotation.x = 0.08;
      // the yellow badge on the cap front (spec: police = yellow badge)
      softPart(grp, box('polbadge2', 0.013, 0.016, 0.004), matFor(0xf2b13c), 0, cy + 0.048, 0.0585, false);
      return grp;
    }
    if (hat === 'helmet' || hat === 'ojek') {
      softPart(grp, geo('helmet2', function () { var g = new THREE.SphereGeometry(R * 1.13, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55); g.scale(0.82, 1.0, 0.90); return g; }), hm, 0, cy + 0.008, 0, true);
      return grp;
    }
    if (hat === 'fedora') {
      var fc = softPart(grp, geo('fedcrown2', function () { return new THREE.CylinderGeometry(R * 0.66, R * 0.72, 0.055, 14); }), hm, 0, cy + 0.062, 0, true);
      fc.scale.set(1.0, 1, 1.08);
      var fb = softPart(grp, geo('fedbrim2', function () { return new THREE.CylinderGeometry(R * 1.18, R * 1.18, 0.005, 18); }), hm, 0, cy + 0.036, 0, false);
      fb.scale.set(1.0, 1, 1.08);
      return grp;
    }
    if (hat === 'sunhat') {
      var sc = softPart(grp, geo('suncrown2', function () { return new THREE.CylinderGeometry(R * 0.67, R * 0.74, 0.04, 14); }), hm, 0, cy + 0.055, 0, true);
      sc.scale.set(1.0, 1, 1.08);
      var sb = softPart(grp, geo('sunbrim2', function () { return new THREE.CylinderGeometry(R * 1.52, R * 1.52, 0.004, 20); }), hm, 0, cy + 0.034, 0, false);
      sb.scale.set(1.0, 1, 1.08);
      return grp;
    }
    return grp;
  }

  // ---- accessories (spec set + the game's story gear) -----------------------
  // All positions re-derived for the semi-realistic metrics: chest front
  // z ≈ 0.099, hips front z ≈ 0.095, hand pivots at wrist height 0.505.
  function buildAccessories(api, cfg) {
    var P = api.pivots, acc = cfg.accessories || [];
    function has(n) { return acc.indexOf(n) >= 0; }
    var dark = matFor(0x23242c);
    // BODYFIX (round 4): chest/hip surface depths after the lathe
    // rebuild, so patches/badges/straps sit ON the slimmer trunk
    // (round-3 z values were tuned to the old ellipsoid stack and
    // would float or sink on the new profiles).
    var B2 = BUILDS[cfg.build] || BUILDS.avg;
    var cz = 0.52 * B2.d * (1 + B2.belly * 0.3);       // chest z-scale
    var hz = (isMaleCfg(cfg) ? 0.48 : 0.60) * B2.d * (1 + B2.belly * 0.10);      // hips z-scale (BODYFIX5: men sit flatter)
    if (cfg.backpack) {
      // TWEAK18 (2026-11-22): the old pack was one flat box
      // (0.175 x 0.215 x 0.078) + a same-colour flap plate — from
      // behind, the only angle the combat photo shows, it read as
      // a cardboard board strapped to Raka's back (panel 17, all
      // three judges). The pack is now built like a bag: a puffy
      // ellipsoid body (rounded on every axis, narrower than the
      // torso, tapering top and bottom), a bulging front pocket
      // on its back face with a dark zipper band, a darker lid
      // cap over the top with a centre strap + buckle running
      // down the back face, a grab handle, side bottle pockets,
      // and strap segments over the shoulders so the pack visibly
      // HANGS from the shoulders instead of floating on the back.
      // Depth stays ~30% of torso width (the round-4 measure);
      // the chest straps below are unchanged.
      var packM = matFor(cfg.backpack), strapM = matFor(darken(cfg.backpack, 0.72));
      var backZ = -(0.116 * cz);                    // lathe back surface
      var packCZ = backZ - 0.036;                   // body centre (front sunk 0.010 into the back)
      var packBody = part(P.spine2, ell('packbody5', 0.082, 0.105, 0.046), packM, 0, 0.025, packCZ, true);
      packBody.rotation.x = 0.04;
      // front pocket on the back face + its zipper band
      var pockCZ = packCZ - 0.052;
      part(P.spine2, ell('packpocket5', 0.058, 0.068, 0.026), packM, 0, -0.012, pockCZ, false);
      var zip = part(P.spine2, box('packzip5', 0.100, 0.009, 0.008), strapM, 0, 0.040, pockCZ - 0.016, false);
      zip.rotation.x = -0.35;
      // lid cap + centre strap + buckle down the back face
      part(P.spine2, ell('packlid5', 0.070, 0.045, 0.042), strapM, 0, 0.108, packCZ - 0.004, false);
      var cstrap = part(P.spine2, box('packstrap5', 0.030, 0.105, 0.006), strapM, 0, 0.052, packCZ - 0.049, false);
      cstrap.rotation.x = -0.10;
      part(P.spine2, box('packbuckle5', 0.036, 0.020, 0.009), strapM, 0, 0.004, pockCZ - 0.027, false);
      // grab handle on top
      var handle = part(P.spine2, geo('packhandle5', function () { return new THREE.TorusGeometry(0.026, 0.0055, 6, 12, Math.PI); }), strapM, 0, 0.132, packCZ + 0.008, false);
      handle.rotation.x = 0.15;
      // side bottle pockets
      [-1, 1].forEach(function (s) {
        part(P.spine2, ell('packside5', 0.018, 0.045, 0.032), packM, s * 0.080, -0.030, packCZ + 0.004, false);
      });
      // shoulder-strap segments: from the pack's top corners up
      // and over the shoulders (the chest straps below complete
      // the loop on the front). TWEAK18 pass 2: in the combat
      // frame the first cut stood too tall and vertical — two
      // brown planks beside the neck. Shorter, lower, tilted
      // further forward so they lie along the shoulder slope.
      [-1, 1].forEach(function (s) {
        var ss = part(P.spine2, box('packshstrap5', 0.030, 0.095, 0.012), strapM, s * 0.055, 0.140, backZ + 0.016, false);
        ss.rotation.x = -0.66; ss.rotation.z = -s * 0.10;
      });
      [-1, 1].forEach(function (s) {
        var st = part(P.spine2, box('strap4', 0.034, 0.155, 0.013), strapM, s * 0.056, 0.062, 0.124 * cz + 0.002, false);
        st.rotation.x = -0.10;
      });
    }
    if (has('blazerSet')) {
      // BODYFIX2 (final polish): the cream/white outfit read as a
      // mannequin — one flat colour head to toe. Give it the full
      // tailored read with FLAT colour details only (the police
      // crease rule: shading, never modelled rings): lapels, a
      // chest pocket + flap, hip pockets, vertical fold shades on
      // torso and thighs, and a cuff band above the wrist cuff.
      var foldM = matFor(darken(cfg.topColor, 0.86));
      [-1, 1].forEach(function (s) {
        var lap = part(P.spine2, box('lapel5', 0.016, 0.115, 0.004), foldM, s * 0.036, 0.052, 0.1205 * cz + 0.002, false);
        lap.rotation.z = -s * 0.38; lap.rotation.x = -0.08;
        part(P.pelvis, box('hpocket5', 0.040, 0.024, 0.005), foldM, s * 0.058, -0.008, (isMaleCfg(cfg) ? 0.1155 : 0.1210) * hz + 0.002, false).rotation.y = -s * 0.22;
        var tf = part(P['thigh' + (s < 0 ? 'R' : 'L')], box('tfold5', 0.008, 0.11, 0.003), foldM, 0, -0.10, (isMaleCfg(cfg) ? 0.0478 : 0.0505) * B2.d + 0.001, false);
        tf.rotation.x = 0.05;
        var cb = part(P['fArm' + (s < 0 ? 'R' : 'L')], cyl('blzcuff5', 0.0195, 0.0195, 0.014, 12), foldM, 0, -0.118, 0, false);
        cb.scale.set(B2.w, 1, 0.90 * B2.d);
      });
      part(P.spine2, box('cpocket5', 0.042, 0.026, 0.005), foldM, -0.052, -0.012, 0.1085 * cz + 0.002, false);
      part(P.spine2, box('cflap5', 0.046, 0.008, 0.006), foldM, -0.052, 0.004, 0.1125 * cz + 0.002, false);
      [-1, 1].forEach(function (s) {
        var fd = part(P.spine1, box('fold5', 0.009, 0.12, 0.003), foldM, s * 0.042, -0.012, 0.1090 * cz + 0.0015, false);
        fd.rotation.x = 0.03;
      });
    }
    if (has('bag')) {
      part(P.pelvis, box('bag2', 0.11, 0.14, 0.05), matFor(0xb8563a), 0.145, -0.06, -0.01, true);
    }
    if (has('umbrella')) {
      var um = new THREE.Group(); um.position.set(0, -0.03, 0.02); P.handR.add(um);
      part(um, geo('umstick2', function () { return new THREE.CylinderGeometry(0.005, 0.005, 0.30, 6); }), dark, 0, 0.08, 0, false);
      part(um, geo('umtop2', function () { return new THREE.ConeGeometry(0.18, 0.075, 10); }), matFor(0xc23b2e), 0, 0.245, 0, true);
    }
    if (has('glasses') || has('sunglasses')) {
      // POLISH (Bos point 1): the old lens (r 0.020, OPAQUE pale
      // 0x9fb6c4) swallowed the whole eye zone behind an owl
      // mask. Smaller lens + thinner rim, and real glasses are
      // translucent — the eyes stay readable through them.
      // Sunglasses keep their opaque dark lens, just smaller.
      var lensM = has('sunglasses') ? matFor(0x14161c)
        : new THREE.MeshToonMaterial({ color: 0xd7e5ee, gradientMap: gradientMapBody, transparent: true, opacity: 0.30, depthWrite: false });
      [-1, 1].forEach(function (s) {
        softPart(P.head, geo('lens3', function () { var g = new THREE.SphereGeometry(0.0165, 10, 8); g.scale(1, 0.82, 0.30); return g; }), lensM, s * 0.021, M.headCY - 0.002, 0.0575, false);
        softPart(P.head, geo('rim3', function () { return new THREE.TorusGeometry(0.0178, 0.0018, 5, 14); }), dark, s * 0.021, M.headCY - 0.002, 0.0585, false);
      });
      softPart(P.head, box('bridge3', 0.016, 0.003, 0.003), dark, 0, M.headCY + 0.001, 0.0585, false);
    }
    if (has('badge')) {
      part(P.spine2, box('badge2', 0.03, 0.037, 0.008), matFor(0xf2b13c), -0.055, 0.075, 0.1106 * cz + 0.002, false);
    }
    if (has('policePatch')) {
      var cv = document.createElement('canvas'); cv.width = 128; cv.height = 32;
      var cx2 = cv.getContext('2d');
      cx2.fillStyle = '#1d2f52'; cx2.fillRect(0, 0, 128, 32);
      cx2.fillStyle = '#f2f4f8'; cx2.font = 'bold 21px sans-serif'; cx2.textAlign = 'center'; cx2.textBaseline = 'middle';
      cx2.fillText('POLISI', 64, 17);
      var tx = new THREE.CanvasTexture(cv);
      var pm = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.022),
        new THREE.MeshBasicMaterial({ map: tx, toneMapped: false, fog: false }));
      pm.position.set(0.008, 0.082, 0.1237 * cz + 0.0015); P.spine2.add(pm);
      var pm2 = pm.clone(); pm2.position.z = -(0.1237 * cz + 0.0015); pm2.rotation.y = Math.PI; P.spine2.add(pm2);
      api.lod1Hide.push(pm, pm2);
    }
    if (has('radio')) {
      part(P.spine2, box('radio2', 0.03, 0.07, 0.022), dark, -0.10, 0.095, 0.040, false);
      part(P.spine2, geo('antenna2', function () { return new THREE.CylinderGeometry(0.003, 0.003, 0.10, 5); }), dark, -0.10, 0.175, 0.040, false);
    }
    if (has('camera')) {
      part(P.spine2, box('camera2', 0.07, 0.05, 0.04), dark, 0, 0.01, 0.108 * cz + 0.008, false);
    }
    if (has('phone')) {
      // BODYFIX4: the phone moved from handL to handR — the
      // idle_phone pose bends the RIGHT forearm up (fArmR -98)
      // while the prop hung in the lowered left hand, so the
      // character stared at an empty palm. In handR the slab
      // sits in the raised hand's curl. (Also ends a latent
      // overlap: 'office' carries phone + coffee, both were
      // anchored to handL at nearly the same offset.)
      part(P.handR, box('phone2', 0.045, 0.085, 0.008), dark, 0, -0.055, 0.025, false).rotation.x = -0.5;
    }
    if (has('cane')) {
      part(P.handR, geo('cane2', function () { return new THREE.CylinderGeometry(0.008, 0.008, 0.47, 6); }), matFor(0x6e4a26), 0.012, -0.235, 0.015, false);
    }
    if (has('cigar')) {
      part(P.handR, geo('cigar2', function () { return new THREE.CylinderGeometry(0.007, 0.008, 0.07, 6); }), matFor(0x7a4a22), 0, -0.045, 0.025, false).rotation.x = 1.2;
    }
    if (has('rifle')) {
      var rg = new THREE.Group(); rg.position.set(0, -0.04, 0.02); rg.rotation.x = Math.PI / 2; P.handR.add(rg);
      part(rg, box('riflebody2', 0.038, 0.06, 0.42), dark, 0, 0, 0.10, true);
      part(rg, box('riflemag2', 0.03, 0.09, 0.04), dark, 0, -0.055, 0.10, false);
    }
    if (has('mask')) {
      softPart(P.head, geo('mask2', function () { var g = new THREE.SphereGeometry(M.headR * 1.04, 12, 10); g.scale(0.82, 1.02, 0.90); return g; }), matFor(0x181818), 0, M.headCY, -0.004, false);
    }
    if (has('tie')) {
      part(P.spine2, box('tie2', 0.035, 0.19, 0.01), matFor(0x6e1f2a), 0, -0.01, 0.108 * cz + 0.001, false);
    }
    if (has('beltBadge')) {
      part(P.pelvis, box('beltbadge2', 0.036, 0.045, 0.01), matFor(0xf2b13c), 0.075, -0.005, 0.1155 * hz + 0.002, false);
    }
    if (has('visor')) {
      softPart(P.head, geo('visor2', function () { return new THREE.CylinderGeometry(M.headR * 1.06, M.headR * 1.06, 0.055, 12, 1, true, -0.62, 1.24); }), matFor(0x14161c), 0, M.headCY + 0.005, 0, false);
    }
    if (has('neckTattoo')) {
      part(P.neck, geo('inkneck2', function () { return new THREE.CylinderGeometry(0.0245, 0.0265, 0.028, 10, 1, true, 0.45, 2.2); }), matFor(0x18303e), 0, 0.006, 0, false);
    }
    if (has('armTattoo')) {
      var ink = part(P.fArmR, geo('inkarm4', function () { return new THREE.CylinderGeometry(0.024, 0.024, 0.06, 10, 1, true); }), matFor(0x1d2b33), 0, -0.05, 0, false);
      ink.scale.set(B2.w, 1, 0.90 * B2.d);
    }
    if (has('guitar')) {
      var gt = new THREE.Group(); gt.position.set(0.06, -0.02, 0.075); gt.rotation.set(0.15, 0.1, -0.55); P.spine2.add(gt);
      part(gt, geo('gbody2', function () { var g = new THREE.CylinderGeometry(0.09, 0.09, 0.042, 14); g.rotateX(Math.PI / 2); return g; }), matFor(0x8a5a2c), 0, 0, 0, true);
      part(gt, box('gneck2', 0.024, 0.26, 0.015), matFor(0x5a3a1e), 0.085, 0.14, 0, false);
    }
    if (has('jewelry')) {
      part(P.neck, geo('necklace2', function () { return new THREE.TorusGeometry(0.034, 0.004, 6, 16); }), matFor(0xe8c85a), 0, 0.002, 0.008, false).rotation.x = 1.25;
    }
    if (has('cargoPockets')) {
      // LEGFIX C: cargo thigh pockets — flat-shaded boxes on
      // the outer thigh with a darker flap line: the
      // work-trouser read for guards, couriers and dockers.
      var cpM = matFor(darken(cfg.bottomColor, 0.85)), cpF = matFor(darken(cfg.bottomColor, 0.68));
      [-1, 1].forEach(function (s) {
        var tgh = P['thigh' + (s < 0 ? 'R' : 'L')];
        part(tgh, box('cargo7', 0.016, 0.052, 0.058), cpM, s * 0.050, -0.098, 0.002, false);
        part(tgh, box('cargoflap7', 0.018, 0.014, 0.060), cpF, s * 0.050, -0.070, 0.002, false);
      });
    }
  }

  // ---- pose tables --------------------------------------------------------------
  // Keyframed poses ported from the retired AnimationClip set (same
  // tuned key values, Euler degrees relative to bind). dy/dz are the
  // pelvis offset in UNIT space. Only the pelvis offsets and the
  // sitting / lying leg angles were re-derived for the new proportions:
  //   sit/drive/enter/exit — seated pelvis pivot 0.345 m at H 1.75
  //     (unit dy -0.288 from the 0.485 pelvis; PROPFIX re-derived
  //     it proportionally from the 47% leg — the BODYFIX3 world
  //     seat height 0.2057 scaled by 0.470/0.490 to 0.1973);
  //     thigh -86 deg, shin +47
  //     (feet planted forward on the floor, car-seat geometry: shin
  //     0.23 long cannot hang vertical from a 0.36 m seat), foot +35.
  //   death — pelvis pitched 86 deg, final pelvis centre 0.134
  //     (PROPFIX proportional re-derive: 0.140 x 0.470/0.490),
  //     dy -0.351, dz -0.275, so
  //     no limb spears the floor.
  //   jump/land/hit/stagger — small offsets scaled to the longer legs.
  // Gaits are analytic (below), not keyframed.
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
    { t: 0, p: { spine2: [1.5, 0, 0], pelvis: [0, 0, 2.4], spine1: [0, 0, -1.2], thighL: [-4, 0, 1.5], shinL: [6, 0, 0], thighR: [-2, 0, -1.5], shinR: [3, 0, 0], uArmL: [0, 0, 8.5], uArmR: [0, 0, -8.5], fArmL: [-14, 0, 2], fArmR: [-14, 0, -2], neck: [0, 0, -1.5], head: [1, -7, 3] } },
    { t: 0.9, p: { spine2: [2.6, 0, 0], spine1: [0.8, 0, -1.2], pelvis: [0, 0, 2.5], uArmL: [0, 0, 8.4], uArmR: [0, 0, -8.4], fArmL: [-15, 0, 2], fArmR: [-15, 0, -2], head: [0.5, -4, 3.2] }, dy: 0.002 },
    { t: 1.8, p: { spine2: [3.6, 0, 0], spine1: [1.6, 0, -1.2], pelvis: [0, 0, 2.6], uArmL: [0, 0, 9.6], uArmR: [0, 0, -9.6], fArmL: [-16, 0, 2], fArmR: [-16, 0, -2], neck: [0, 0, -1.5], head: [0, 3, 3.4] }, dy: 0.004 },
    { t: 2.7, p: { spine2: [2.4, 0, 0], spine1: [0.6, 0, -1.2], pelvis: [0, 0, 2.4], uArmL: [0, 0, 8], uArmR: [0, 0, -8], fArmL: [-14.6, 2 - 2, 2], fArmR: [-14.6, 0, -2], head: [1.5, 8, 2.8] }, dy: 0.002 },
    { t: 3.6, p: { spine2: [1.5, 0, 0], pelvis: [0, 0, 2.4], spine1: [0, 0, -1.2], thighL: [-4, 0, 1.5], shinL: [6, 0, 0], thighR: [-2, 0, -1.5], shinR: [3, 0, 0], uArmL: [0, 0, 8.5], uArmR: [0, 0, -8.5], fArmL: [-14, 0, 2], fArmR: [-14, 0, -2], neck: [0, 0, -1.5], head: [1, -7, 3] }, dy: 0 }
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
    { t: 0, p: { thighL: [-86, 0, 2], thighR: [-86, 0, -2], shinL: [47, 0, 0], shinR: [47, 0, 0], footL: [35, 0, 0], footR: [35, 0, 0], spine2: [7, 0, 0], uArmL: [-20, 0, 6], uArmR: [-20, 0, -6], fArmL: [-24, 0, 2], fArmR: [-24, 0, -2], head: [2, -6, 0] }, dy: -0.288 },
    { t: 1.5, p: { spine2: [8.5, 0, 0], head: [3, 7, 0] }, dy: -0.288 },
    { t: 3.0, p: { thighL: [-86, 0, 2], thighR: [-86, 0, -2], shinL: [47, 0, 0], shinR: [47, 0, 0], spine2: [7, 0, 0], uArmL: [-20, 0, 6], uArmR: [-20, 0, -6], fArmL: [-24, 0, 2], fArmR: [-24, 0, -2], head: [2, -6, 0] }, dy: -0.317 }
  ], true);
  def('jump', 0.55, [
    { t: 0, p: { thighL: [-46, 0, 2], thighR: [-46, 0, -2], shinL: [64, 0, 0], shinR: [64, 0, 0], spine2: [14, 0, 0], uArmL: [18, 0, 10], uArmR: [18, 0, -10] }, dy: -0.075 },
    { t: 0.22, p: { thighL: [6, 0, 2], thighR: [10, 0, -2], shinL: [10, 0, 0], shinR: [16, 0, 0], spine2: [-3, 0, 0], uArmL: [-58, 0, 14], uArmR: [-58, 0, -14] }, dy: 0.02 },
    { t: 0.55, p: { thighL: [-14, 0, 2], thighR: [-8, 0, -2], shinL: [22, 0, 0], shinR: [14, 0, 0], spine2: [5, 0, 0], uArmL: [-20, 0, 10], uArmR: [-20, 0, -10] }, dy: -0.01 }
  ], false);
  def('fall', 0.8, [
    { t: 0, p: { thighL: [-20, 0, 3], thighR: [12, 0, -3], shinL: [14, 0, 0], shinR: [8, 0, 0], spine2: [-7, 0, 0], uArmL: [-120, 0, 30], uArmR: [-60, 0, -34], head: [-8, 0, 0] } },
    { t: 0.4, p: { uArmL: [-70, 0, 38], uArmR: [-130, 0, -26] } },
    { t: 0.8, p: { thighL: [-20, 0, 3], thighR: [12, 0, -3], shinL: [14, 0, 0], shinR: [8, 0, 0], spine2: [-7, 0, 0], uArmL: [-120, 0, 30], uArmR: [-60, 0, -34], head: [-8, 0, 0] } }
  ], true);
  def('land', 0.38, [
    { t: 0, p: { thighL: [-52, 0, 3], thighR: [-52, 0, -3], shinL: [72, 0, 0], shinR: [72, 0, 0], spine2: [16, 0, 0], uArmL: [-30, 0, 16], uArmR: [-30, 0, -16] }, dy: -0.095 },
    { t: 0.38, p: { thighL: [0, 0, 1], thighR: [0, 0, -1], shinL: [2, 0, 0], shinR: [2, 0, 0], spine2: [2, 0, 0], uArmL: [0, 0, 6], uArmR: [0, 0, -6] }, dy: 0 }
  ], false);
  // VISUAL POLISH step 4: 'duck' — the cower a bystander drops
  // into when gunfire lands close (pedestrians.js scare()). A
  // deep crouch on the 'land' geometry (thigh -52 / shin 72
  // plants the feet; here -58 / 80 with dy -0.105 for the deeper
  // squat), spine folded forward, head tucked, both arms raised
  // beside the head with forearms folded over it. Looped with a
  // small tremble key so a held duck doesn't freeze-frame.
  def('duck', 1.5, [
    { t: 0, p: { thighL: [-58, 0, 3], thighR: [-58, 0, -3], shinL: [80, 0, 0], shinR: [80, 0, 0], spine1: [15, 0, 0], spine2: [21, 0, 0], head: [15, 0, 0], uArmL: [-24, 0, 126], uArmR: [-24, 0, -126], fArmL: [-62, 0, 16], fArmR: [-62, 0, -16] }, dy: -0.105 },
    { t: 0.75, p: { thighL: [-56, 0, 3], thighR: [-59, 0, -3], shinL: [78, 0, 0], shinR: [81, 0, 0], spine1: [16, 0, 0], spine2: [22, 0, 0], head: [16, 0, 2], uArmL: [-22, 0, 129], uArmR: [-26, 0, -124], fArmL: [-60, 0, 16], fArmR: [-64, 0, -16] }, dy: -0.108 },
    { t: 1.5, p: { thighL: [-58, 0, 3], thighR: [-58, 0, -3], shinL: [80, 0, 0], shinR: [80, 0, 0], spine1: [15, 0, 0], spine2: [21, 0, 0], head: [15, 0, 0], uArmL: [-24, 0, 126], uArmR: [-24, 0, -126], fArmL: [-62, 0, 16], fArmR: [-62, 0, -16] }, dy: -0.105 }
  ], true);
  // POLISH2B (item 2): the aim elbow bends 17 degrees (spec 15-20),
  // not the old near-straight 7 — a locked arm read as a mannequin
  // from behind. This held pose is ALSO where shoot_pistol settles
  // and reload returns to, so the bend shows in firing frames too
  // (reported as-is: the aim pose and the shot's settle share it).
  def('aim_pistol', 1.6, [
    { t: 0, p: { uArmR: [-84, 0, -3], fArmR: [-17, 0, 0], uArmL: [-52, 0, 10], fArmL: [-58, 0, 8], spine2: [2, -9, 0], head: [0, 4, 0] } },
    { t: 1.6, p: { uArmR: [-84, 0, -3], fArmR: [-17, 0, 0], uArmL: [-52, 0, 10], fArmL: [-58, 0, 8], spine2: [2, -9, 0], head: [0, 4, 0] } }
  ], true);
  def('aim_rifle', 1.6, [
    { t: 0, p: { uArmR: [-78, 0, -6], fArmR: [-20, 0, 0], uArmL: [-70, -12, 6], fArmL: [-40, 0, 10], spine2: [3, -11, 0], head: [4, 5, 0] } },
    { t: 1.6, p: { uArmR: [-78, 0, -6], fArmR: [-20, 0, 0], uArmL: [-70, -12, 6], fArmL: [-40, 0, 10], spine2: [3, -11, 0], head: [4, 5, 0] } }
  ], true);
  def('shoot_pistol', 0.30, [
    { t: 0, p: { uArmR: [-76, 0, -3], fArmR: [-11, 0, 0], spine2: [3.5, -8, 0], head: [1, 4, 0] } },
    { t: 0.06, p: { uArmR: [-97, 0, -3], fArmR: [-3, 0, 0], spine2: [-1, -10, 0], head: [-3, 4, 0] } },
    { t: 0.30, p: { uArmR: [-84, 0, -3], fArmR: [-17, 0, 0], uArmL: [-52, 0, 10], fArmL: [-58, 0, 8], spine2: [2, -9, 0], head: [0, 4, 0] } }
  ], false);
  def('reload', 1.15, [
    { t: 0, p: { uArmR: [-60, 0, -4], fArmR: [-38, 0, 0], head: [13, 0, 0], spine2: [6, -4, 0] } },
    { t: 0.4, p: { uArmR: [-46, 0, -4], fArmR: [-52, 0, 0], uArmL: [-48, 0, 12], fArmL: [-82, 0, 10], head: [15, -3, 0] } },
    { t: 0.75, p: { uArmL: [-40, 0, 12], fArmL: [-70, 0, 10], head: [12, 0, 0] } },
    { t: 1.15, p: { uArmR: [-84, 0, -3], fArmR: [-17, 0, 0], uArmL: [-52, 0, 10], fArmL: [-58, 0, 8], head: [0, 4, 0], spine2: [2, -9, 0] } }
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
    { t: 0.30, p: { uArmR: [-112, 0, -6], fArmR: [-8, 0, 0], uArmL: [-88, 0, 4], fArmL: [-16, 0, 4], spine2: [17, 16, 0], spine1: [9, 6, 0] }, dy: -0.024 },
    { t: 0.62, p: { uArmR: [0, 0, -6], fArmR: [-8, 0, 0], uArmL: [0, 0, 6], fArmL: [-8, 0, 2], spine2: [2, 0, 0], spine1: [1, 0, 0] }, dy: 0 }
  ], false);
  function hitClip(name, s1, hd) {
    def(name, 0.42, [
      { t: 0, p: { spine1: s1, head: hd, uArmL: [-24, 0, 18], uArmR: [-24, 0, -18] }, dy: -0.013 },
      { t: 0.42, p: { spine1: [1, 0, 0], head: [0, 0, 0], uArmL: [0, 0, 6], uArmR: [0, 0, -6] }, dy: 0 }
    ], false);
  }
  hitClip('hit_front', [-21, 0, 0], [-17, 0, 0]);
  hitClip('hit_back', [22, 0, 0], [18, 0, 0]);
  hitClip('hit_left', [0, 0, 18], [0, 0, 14]);
  hitClip('hit_right', [0, 0, -18], [0, 0, -14]);
  def('stagger', 0.85, [
    { t: 0, p: { pelvis: [0, 0, 7], thighL: [-8, 0, 7], thighR: [6, 0, -7], uArmL: [-14, 0, 32], uArmR: [-10, 0, -30], head: [4, 0, 6], spine1: [4, 0, 4] }, dy: -0.014 },
    { t: 0.42, p: { pelvis: [0, 0, -6], thighL: [5, 0, 6], thighR: [-9, 0, -6], uArmL: [-8, 0, 26], uArmR: [-16, 0, -24], head: [3, 0, -5] }, dy: -0.02 },
    { t: 0.85, p: { pelvis: [0, 0, 0], thighL: [0, 0, 2], thighR: [0, 0, -2], uArmL: [0, 0, 6], uArmR: [0, 0, -6], head: [0, 0, 0], spine1: [1, 0, 0] }, dy: 0 }
  ], false);
  // Knocked-down fall: one consistent fall ending FLAT — pelvis
  // pitched 86 deg, legs extended along the ground. Re-based to the
  // semi-realistic pelvis (0.505 after BODYFIX3): the final pelvis centre must sit
  // at the torso's half-depth (chest radius 0.134) + a hair, i.e.
  // 0.14 units, dy -0.365 — any lower and the torso sinks into the
  // floor (the first draft's -0.435 put it 0.049 under). dz -0.26
  // is the longer spine chain rotating down to the ground. The mid
  // key is a transient fall frame (same character as the chibi's).
  // PROPFIX: dy/dz re-derived for the 0.485 pelvis — final centre
  // 0.134 (0.140 x 0.470/0.490), dy -0.351; dz scaled by the longer
  // torso (0.375/0.355): -0.26 -> -0.275, -0.15 -> -0.158.
  def('death', 0.95, [
    { t: 0, p: { spine1: [-6, 0, 0], uArmL: [-30, 0, 20], uArmR: [-24, 0, -22] }, dy: -0.023 },
    { t: 0.45, p: { pelvis: [46, 0, 0], spine1: [-16, 0, 0], spine2: [-8, 0, 0], thighL: [-6, 0, 4], thighR: [-2, 0, -4], shinL: [16, 0, 0], shinR: [10, 0, 0], uArmL: [-40, 0, 44], uArmR: [14, 0, -40], head: [-16, 0, 0] }, dy: -0.197, dz: -0.158 },
    { t: 0.95, p: { pelvis: [86, 0, 0], spine1: [-2, 0, 0], spine2: [3, 0, 0], thighL: [4, 0, 4], thighR: [12, 0, -4], shinL: [6, 0, 0], shinR: [2, 0, 0], uArmL: [-24, 0, 48], uArmR: [20, 0, -48], head: [-8, 0, 0] }, dy: -0.351, dz: -0.275 }
  ], false);
  def('enter_car', 0.8, [
    { t: 0, p: { thighR: [-38, 0, -3], shinR: [30, 0, 0], spine2: [4, -14, 0], uArmR: [-30, 0, -8], fArmR: [-30, 0, 0] } },
    { t: 0.45, p: { thighL: [-78, 0, 3], thighR: [-78, 0, -3], shinL: [42, 0, 0], shinR: [42, 0, 0], spine2: [7, -6, 0], uArmL: [-34, 0, 6], uArmR: [-34, 0, -6], fArmL: [-26, 0, 2], fArmR: [-26, 0, -2] }, dy: -0.265 },
    { t: 0.8, p: { thighL: [-86, 0, 3], thighR: [-86, 0, -3], shinL: [47, 0, 0], shinR: [47, 0, 0], spine2: [6, 0, 0], uArmL: [-38, 0, 6], uArmR: [-38, 0, -6], fArmL: [-28, 0, 2], fArmR: [-28, 0, -2], head: [0, 0, 0] }, dy: -0.288 }
  ], false);
  def('exit_car', 0.75, [
    { t: 0, p: { thighL: [-86, 0, 3], thighR: [-86, 0, -3], shinL: [47, 0, 0], shinR: [47, 0, 0], spine2: [6, 0, 0], uArmL: [-38, 0, 6], uArmR: [-38, 0, -6], fArmL: [-28, 0, 2], fArmR: [-28, 0, -2] }, dy: -0.288 },
    { t: 0.4, p: { thighL: [-55, 0, 4], thighR: [-18, 0, -4], shinL: [30, 0, 0], shinR: [6, 0, 0], spine2: [8, 12, 0], uArmL: [-24, 0, 8], uArmR: [-44, 0, -10], fArmR: [-36, 0, 0] }, dy: -0.140 },
    { t: 0.75, p: { thighL: [0, 0, 1], thighR: [0, 0, -1], shinL: [2, 0, 0], shinR: [2, 0, 0], spine2: [2, 0, 0], uArmL: [0, 0, 6], uArmR: [0, 0, -6], fArmL: [-8, 0, 2], fArmR: [-8, 0, -2] }, dy: 0 }
  ], false);
  def('drive', 4.0, [
    { t: 0, p: { thighL: [-86, 0, 3], thighR: [-86, 0, -3], shinL: [47, 0, 0], shinR: [47, 0, 0], spine2: [6, 0, 0], uArmL: [-38, 0, 6], uArmR: [-38, 0, -6], fArmL: [-28, 0, 2], fArmR: [-28, 0, -2], head: [0, -12, 0] }, dy: -0.288 },
    { t: 1.4, p: { head: [0, 10, 0], spine2: [6.8, 0, 0] }, dy: -0.288 },
    { t: 2.6, p: { head: [1, 2, 0] }, dy: -0.288 },
    { t: 4.0, p: { thighL: [-86, 0, 3], thighR: [-86, 0, -3], shinL: [47, 0, 0], shinR: [47, 0, 0], spine2: [6, 0, 0], uArmL: [-38, 0, 6], uArmR: [-38, 0, -6], fArmL: [-28, 0, 2], fArmR: [-28, 0, -2], head: [0, -12, 0] }, dy: -0.288 }
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
  // Retuned for the semi-realistic legs (hip joint 0.505, leg length
  // 0.449 after BODYFIX3): same stride calibration as the retired
  // system — only the leg-length constant in the step formula moved
  // with the proportions (0.465 -> 0.435 -> 0.449).
  // PROPFIX: hip pivot 0.470 with the 47% leg — the step constant
  // scales with it (0.449 x 0.470/0.490 = 0.431).
  // LEGFIX F: that constant was STALE — it still divided by the
  // pre-PROPFIX leg. The step length now uses the real 0.470 leg
  // (the ~8% mismatch was a measurable foot-slide source), and
  // the swings come DOWN while knees come UP: walk 21 -> 19 deg
  // puts the stride at ~0.44H (was scissoring at ~0.49H on the
  // old constant), run/sprint lean and knee lift rise, and the
  // pelvis roll grows 4.2 -> 4.8 for a visible hip sway.
  // Gait now carries hip rotation (pelvis yaw 6.5), counter-swinging
  // arms, knee bend, a heel-strike foot term (toes up just before
  // contact), forward lean when running, and head stabilization —
  // the head counter-rotates against the pelvis/spine yaw and roll so
  // the gaze stays level (see gaitPose: head yaw -5.0 sin, roll -2.8).
  var GAITS = {};
  function gait(name, o) {
    o.bob = o.bob || 0; o.drop = o.drop || 0; o.zin = o.zin || 0;
    var stepLen = 2 * (0.470 * 1.75) * Math.sin(o.swing * DEG);
    o.refSpeed = 0.78 * (2 * stepLen) / o.dur;
    GAITS[name] = o;
  }
  // STANCEFIX: zin = inward thigh angle (deg) — the feet track
  // INSIDE the pivot line toward the centre line (walk lateral
  // target 0.08-0.12H, run 0.05-0.10H) instead of the old
  // constant +1.5 deg OUTWARD splay. Walk swing 19 -> 17.5:
  // the measured full-cycle stride was 0.486H, above Bos's
  // 0.38-0.45H band; 17.5 deg lands it at ~0.45H.
  gait('walk', { swing: 17.5, knee: 50, arm: 26, elbow: 16, lean: 4, bob: 0.012, drop: 0.013, dur: 0.92, zin: 1.0 });
  gait('run', { swing: 31, knee: 68, arm: 36, elbow: 52, lean: 10, bob: 0.020, drop: 0.014, dur: 0.68, zin: 3.5 });
  gait('sprint', { swing: 38, knee: 80, arm: 44, elbow: 62, lean: 14, bob: 0.021, drop: 0.015, dur: 0.60, zin: 3.8 });
  gait('panic', { swing: 34, knee: 68, arm: 12, elbow: 66, lean: 10, bob: 0.019, drop: 0.014, dur: 0.64, zin: 3.3 });
  gait('walk_old', { swing: 12, knee: 26, arm: 9, elbow: 15, lean: 9, bob: 0.006, drop: 0.010, dur: 1.05, zin: 1.0 });
  function bump(x) { var s = Math.sin(x); return s > 0 ? s * s : 0; }
  function gaitPose(o, a, out) {
    function leg(off) {
      var s = Math.sin(a + off);
      return {
        thigh: -o.swing * s,
        // LEGFIX F: base shin 4 -> 6 (the leg never locks
        // straight mid-cycle) and the foot terms strengthen —
        // toe-off 10 -> 15, heel-strike -13 -> -15 — so the
        // heel-strike -> flat -> toe-off sequence reads.
        shin: o.knee * bump(a + off + 0.9) + 6,
        foot: o.swing * s * 0.40 - o.knee * bump(a + off + 0.9) * 0.30
          - 10 * bump(a + off - 0.2) + 15 * bump(a + off - 3.2) + 2
          - 15 * bump(a + off - 1.15) // heel strike: toes up before contact
      };
    }
    var L = leg(0), R = leg(Math.PI), p = out.p;
    // STANCEFIX: thigh z is the gait's inward angle (zin) — the
    // swinging leg travels in the sagittal plane and the feet
    // land near the centre line; the old constant +-1.5 deg was
    // an outward splay that, stacked on the old wide pivots,
    // put the walk/run foot track at 0.26-0.35H.
    p.thighL = [L.thigh, 0, -o.zin]; p.shinL = [L.shin, 0, 0]; p.footL = [L.foot, 0, 0];
    p.thighR = [R.thigh, 0, o.zin]; p.shinR = [R.shin, 0, 0]; p.footR = [R.foot, 0, 0];
    p.uArmL = [-o.arm * Math.sin(a + Math.PI), 0, 7];
    p.uArmR = [-o.arm * Math.sin(a), 0, -7];
    p.fArmL = [-o.elbow - 5 * Math.sin(a + Math.PI), 0, 3];
    p.fArmR = [-o.elbow - 5 * Math.sin(a), 0, -3];
    p.spine1 = [o.lean * 0.5, 6.5 * Math.sin(a), 0];
    p.spine2 = [o.lean, -7.5 * Math.sin(a), 0];
    p.neck = [0, 3.2 * Math.sin(a), 0];
    // head stabilization: counter-rotate against the pelvis/spine
    // yaw (6.5 + 6.5 - 7.5 + 3.2 deg) and the pelvis roll (4.2 deg)
    p.head = [-o.lean * 0.55, -5.0 * Math.sin(a), -2.8 * Math.sin(a)];
    p.pelvis = [0, 6.5 * Math.sin(a), 4.8 * Math.sin(a)];
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
  // is shared; per-build width/depth/belly is a mesh scale, so one
  // geometry set serves every build. Everything is built in unit
  // space; root.scale = config.height.
  function darken(hex, f) {
    var r = clamp(Math.round(((hex >> 16) & 255) * f), 0, 255),
      g = clamp(Math.round(((hex >> 8) & 255) * f), 0, 255),
      b = clamp(Math.round((hex & 255) * f), 0, 255);
    return (r << 16) | (g << 8) | b;
  }
  // BODYFIX5: which rigs get the MALE pelvis/leg profile.
  // Explicit cfg.female wins (spawnPedestrian passes its own
  // roll). Otherwise derive from the signals the factory already
  // sends: every female archetype wears a skirt (warung,
  // ibuBelanja, ibuHijab) or a bun (Mami Ratna) or a hijab, and
  // NO male archetype uses any of the three — so the named cast
  // classifies exactly, Mami included (she must NOT change).
  function isMaleCfg(cfg) {
    if (cfg.female != null) return !cfg.female;
    return !(cfg.bottomType === 'skirt' || cfg.hair === 'bun' || cfg.hair === 'hijab');
  }
  function buildRig(cfg) {
    var B = BUILDS[cfg.build] || BUILDS.avg;
    var skinM = matSkin(cfg.skin),
      // POLISH2: garments wear the baked cloth materials (weave +
      // folds + pattern / denim twill) instead of flat colour.
      topM = matCloth(cfg.topColor, cfg.pattern, cfg.accentColor),
      // VISUAL POLISH step 5: legs wear the SOFT cloth variant —
      // full-strength fold streaks stretched into pinstripes on
      // the leg lathes (see clothTexture).
      botM = matCloth(cfg.bottomColor, 'twill', null, true),
      skirtM = matCloth(cfg.bottomColor, null, null),
      shoeM = matFor(cfg.shoeColor),
      // BODYFIX2: hands use the FACE/NECK skin material itself —
      // the exact same cached instance, so hand tone can never
      // drift from face tone. (This retires Mami's oily-hand tint:
      // the polish spec's exact-match rule wins over the tint.)
      handM = skinM;
    var root = new THREE.Group();
    var P = {};
    // PROPFIX: blob disc 0.80 -> 0.96 and gradient stops deepen
    // (see blobTex) — the wider shoulder-width stance needs a
    // bigger, darker contact pool (Bos point 10).
    // LEGFIX G: disc 0.96 -> 1.04 and seated at 0.005 (was
    // 0.016 — it visibly hovered in the leg close-ups); the
    // material now carries polygonOffset, so it stays glued
    // on top of the paving at any root height.
    // POLISH (Bos point 9): disc 1.04 -> 1.12 and the gradient
    // stops deepened again (see blobMat) — a bigger, darker
    // contact pool under the narrower stancefix stance.
    // POLISH03 (user item 1): disc 1.12 -> 0.88 — the pool now
    // hugs the feet instead of spreading past the stance, and
    // with the lighter blobMat gradient it reads as a shadow,
    // not a black disc.
    var blob = new THREE.Mesh(geo('blob9', function () { return new THREE.PlaneGeometry(0.88, 0.88); }), blobMat);
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.005; blob.renderOrder = 2;
    blob.name = 'blob'; root.add(blob);
    // PROPFIX: per-character proportion plumbing (Bos point 9) —
    // the factory forwards body.waist / body.thigh / body.legFrac
    // (dead inputs until now) plus a per-seed width variation
    // (widthK, +-4%, crowd archetypes only). legFrac scales the
    // whole leg chain around the 47% skeleton; pelvisBaseY is
    // where applyPose parks the pelvis for THIS character.
    var waistK = cfg.waistK != null ? cfg.waistK : 1;
    var thighK = cfg.thighK != null ? cfg.thighK : 1;
    var widthK = cfg.widthK != null ? cfg.widthK : 1;
    var legK = cfg.legFrac != null ? cfg.legFrac : 1;
    var pelvisBaseY = M.pelvisY + (legK - 1) * 0.470;
    var pelvis = P.pelvis = new THREE.Group(); pelvis.position.y = pelvisBaseY; root.add(pelvis);
    // BODYFIX (round 4): trunk depth factor — the lathe profiles
    // are turned round; this z-scale sets the depth (~52% of the
    // width at avg build; per-build depth + belly ride on top).
    var trunkZ = 0.52 * B.d * (1 + B.belly * 0.3);
    // BODYFIX5: male pelvis — narrower (hipK 0.94: hip width
    // lands at ~0.80 of the shoulder line, was ~0.85) and much
    // flatter in z (0.48 vs 0.60) on the male hipsM profile.
    // PROPFIX: hipK 0.94 -> 1.00 with the widened hipsM6 profile
    // (Bos point 1: male hip ~84 at shoulder = 100) — the flat
    // 0.48 z-scale stays, so the seat does not round back out.
    var male = isMaleCfg(cfg);
    var hipK = male ? 1.00 : 1;
    var hips = part(pelvis, male ? GEO.hipsM() : GEO.hips(), botM, 0, 0, 0, true);
    hips.scale.set(B.hip * hipK * widthK, 1, (male ? 0.48 : 0.60) * B.d * (1 + B.belly * 0.10));
    var spine1 = P.spine1 = new THREE.Group(); spine1.position.y = M.spine1Y - M.pelvisY; pelvis.add(spine1);
    var torso = part(spine1, GEO.torso(), topM, 0, 0, 0, true);
    torso.scale.set(B.w * widthK * waistK, 1, trunkZ);
    // POLISH2 (spec A1): the belt drops to the trouser waist
    // (spine1 -0.038, the hips' top ring) on the wider beltP2
    // profile and gains a real buckle, so the stack reads as
    // hem -> belt + buckle -> trousers: three layers, three
    // silhouettes. (The round-3 belt sat mid-torso as a ring.)
    var belt = part(spine1, GEO.beltP2(), matFor(darken(cfg.bottomColor, 0.7)), 0, -0.038, 0, false);
    belt.scale.set(B.w * widthK * waistK, 1, trunkZ);
    if (cfg.bottomType !== 'skirt') {
      part(spine1, box('buckleP2', 0.036, 0.020, 0.007), matFor(0xb9bdc4), 0, -0.038, 0.1175 * trunkZ + 0.003, false);
    }
    // POLISH2B (item 6): police wear the 0.05 m duty belt over the
    // standard band (the chest badge already ships via the 'badge'
    // accessory in buildAccessories).
    if ((cfg.accessories || []).indexOf('policePatch') >= 0) {
      var duty = part(spine1, GEO.beltDuty(), matFor(0x14161c), 0, -0.038, 0, false);
      duty.scale.set(B.w * widthK * waistK, 1, trunkZ);
    }
    var spine2 = P.spine2 = new THREE.Group(); spine2.position.y = M.spine2Y - M.spine1Y; spine1.add(spine2);
    var chest = part(spine2, GEO.chest(), topM, 0, 0, 0, true);
    chest.scale.set(B.shoulder * widthK, 1, trunkZ);
    var collar = part(spine2, GEO.collar(), matFor(darken(cfg.topColor, 0.85)), 0, 0, 0, false);
    collar.scale.set(B.shoulder * widthK, 1, trunkZ);
    if (cfg.accentColor != null) {
      // one thin FLAT accent strip on the chest (Raka's yellow
      // band, the syndicate's red band) — a shading detail, never
      // a volume. Sits on the lathe surface at chest height.
      part(spine2, box('accent4', 0.15, 0.028, 0.008), matFor(cfg.accentColor), 0, 0.045, 0.1205 * trunkZ + 0.002, false);
    }
    var isPolice = (cfg.accessories || []).indexOf('policePatch') >= 0;
    if (isPolice) {
      // fitted-uniform detail: shoulder epaulettes following the
      // shoulder slope (thin flat boxes, no volume rings).
      var epM = matFor(darken(cfg.topColor, 0.8));
      [-1, 1].forEach(function (s) {
        var ep = part(spine2, box('epau4', 0.078, 0.013, 0.058), epM, s * 0.108 * B.shoulder, 0.128, 0, false);
        ep.rotation.z = -s * 0.16;
      });
    }
    // ---- POLISH2 garment detail (spec A1/A2/A4) ------------------
    // Every top type gains its own small GEOMETRY: a flared hem
    // overlapping the waist, then per-type collars / plackets /
    // lapels / pockets / straps / pouches. All pieces are thin
    // boxes or profile-following lathes seated a few mm proud of
    // the trunk surface (the accessory z convention), flat-shaded
    // in derived shades of the garment's own colours — detail as
    // construction, never as paint. Nothing here moves a pivot,
    // a proportion or a pose: it is sewn onto the same rig.
    var topType = cfg.topType || 'tee';
    var accList = cfg.accessories || [];
    var topDark = matFor(darken(cfg.topColor, 0.78));
    var topDarker = matFor(darken(cfg.topColor, 0.58));
    var hemMesh = part(spine1, (topType === 'jacket' || topType === 'blazer' || topType === 'vest') ? GEO.hem() : GEO.hemSlim(), topM, 0, 0, 0, false);
    hemMesh.scale.set(B.w * widthK * waistK, 1, trunkZ);
    function gBox(geoKey, w, h, d, mat, parent, x, y, zK, rz, ry) {
      var m = part(parent, box(geoKey, w, h, d), mat, x, y, zK * trunkZ + (zK < 0 ? -0.002 : 0.002), false);
      if (rz) m.rotation.z = rz;
      if (ry) m.rotation.y = ry;
      return m;
    }
    if (topType === 'jacket') {
      // zipper placket down the chest + lapels + chest pocket +
      // hip pocket flaps + a back yoke band (the rear read, A6).
      gBox('gzipp2', 0.014, 0.150, 0.004, topDarker, spine2, 0, 0.030, 0.1195);
      [-1, 1].forEach(function (s) {
        var lap = gBox('glapp2', 0.018, 0.105, 0.004, topDark, spine2, s * 0.034, 0.078, 0.1200, -s * 0.35);
        lap.rotation.x = -0.08;
        gBox('ghipp2', 0.046, 0.010, 0.005, topDark, spine1, s * 0.062, -0.052, 0.0965, 0, -s * 0.20);
      });
      gBox('gchpock2', 0.042, 0.026, 0.004, topDark, spine2, -0.055, 0.018, 0.0985);
      gBox('gchflap2', 0.046, 0.009, 0.005, topDarker, spine2, -0.055, 0.034, 0.1005);
      gBox('gyoke2', 0.150, 0.016, 0.004, topDark, spine2, 0, 0.095, -0.1205);
      // POLISH2B (item 2): the jacket BACK gets its construction —
      // a centre back seam running yoke-to-hem (two segments, one
      // per spine pivot) and a standing collar band raised 0.04 m
      // at the back of the neck. The hem lathe already spans
      // 0.044 m (spec: 0.03 m thick) — verified, unchanged.
      gBox('gseam2a', 0.006, 0.150, 0.003, topDarker, spine2, 0, 0.012, -0.1205);
      gBox('gseam2b', 0.006, 0.130, 0.003, topDarker, spine1, 0, -0.010, -0.1185);
      var collarB = gBox('gcollar2', 0.120, 0.040, 0.010, topDark, spine2, 0, 0.152, -0.0720);
      collarB.rotation.x = -0.18;
      [-1, 1].forEach(function (s) {
        var wing = gBox('gcollarw2', 0.055, 0.036, 0.009, topDark, spine2, s * 0.058, 0.148, -0.0480, 0, s * 0.55);
        wing.rotation.x = -0.12;
      });
    } else if (topType === 'blazer') {
      // The blazerSet accessory already tailors Dario — do not
      // double-sew him. Other blazers get lapels, pockets, a
      // button pair and a tie (spec A4: office = shirt + tie).
      if (accList.indexOf('blazerSet') < 0) {
        [-1, 1].forEach(function (s) {
          var lap2 = gBox('glapp2', 0.018, 0.115, 0.004, topDark, spine2, s * 0.036, 0.072, 0.1200, -s * 0.38);
          lap2.rotation.x = -0.08;
          gBox('ghipp2', 0.046, 0.010, 0.005, topDark, spine1, s * 0.062, -0.052, 0.0965, 0, -s * 0.20);
        });
        gBox('gchpock2', 0.042, 0.026, 0.004, topDark, spine2, -0.052, -0.012, 0.0885);
        gBox('gchflap2', 0.046, 0.008, 0.006, topDark, spine2, -0.052, 0.004, 0.0905);
        [0.030, -0.018].forEach(function (by) {
          part(spine2, GEO.btn(), topDarker, 0, by, 0.1205 * trunkZ + 0.002, false);
        });
        if (accList.indexOf('tie') < 0) {
          gBox('gtie2', 0.034, 0.170, 0.008, matFor(0x5a2432), spine2, 0, -0.008, 0.1100);
          gBox('gtieknot2', 0.020, 0.024, 0.009, matFor(0x5a2432), spine2, 0, 0.086, 0.1160);
        }
      }
    } else if (topType === 'vest') {
      // Work / duty vest: chest strap, shoulder straps running
      // into it, two bellows pouches on the lower trunk.
      gBox('gveststrap2', 0.190, 0.020, 0.006, topDarker, spine2, 0, 0.052, 0.1215);
      [-1, 1].forEach(function (s) {
        gBox('gvestsh2', 0.030, 0.115, 0.005, topDarker, spine2, s * 0.052, 0.028, 0.1175);
        gBox('gpouch2', 0.052, 0.062, 0.020, topDark, spine1, s * 0.048, 0.052, 0.1045);
        gBox('gpouchflap2', 0.054, 0.016, 0.022, topDarker, spine1, s * 0.048, 0.086, 0.1045);
      });
      // The dock worker's orange vest carries silver reflective
      // bands (colour test on the garment itself: a saturated
      // orange top IS the safety vest of this cast).
      var oc = cfg.topColor;
      if (((oc >> 16) & 255) > 200 && ((oc >> 8) & 255) > 70 && ((oc >> 8) & 255) < 150 && (oc & 255) < 70) {
        var reflM = matFor(0xd9dee6);
        var rc = part(spine2, GEO.reflChest(), reflM, 0, 0, 0, false);
        rc.scale.set(B.shoulder * widthK, 1, trunkZ);
        var rw = part(spine1, GEO.reflWaist(), reflM, 0, 0, 0, false);
        rw.scale.set(B.w * widthK * waistK, 1, trunkZ);
      }
    } else if (topType === 'blouse') {
      gBox('gplack2', 0.015, 0.140, 0.003, topDark, spine2, 0, 0.032, 0.1185);
      [0.070, 0.032, -0.006].forEach(function (by2) {
        part(spine2, GEO.btn(), topDarker, 0, by2, 0.1205 * trunkZ + 0.002, false);
      });
    } else if (!cfg.pattern) {
      // plain tee / shirt: button placket. Patterned tops wear
      // an open camp collar instead — no placket over a print.
      gBox('gplack2', 0.015, 0.150, 0.003, topDark, spine2, 0, 0.030, 0.1185);
      [0.072, 0.034, -0.004].forEach(function (by3) {
        part(spine2, GEO.btn(), topDarker, 0, by3, 0.1205 * trunkZ + 0.002, false);
      });
    }
    if (cfg.hair === 'hijab') {
      // The drape: cloth over the shoulders and upper chest,
      // in the same cloth colour as the head shell.
      var drp = part(spine2, GEO.hijabDrape(), matFor(cfg.hairColor), 0, 0.148, 0, true);
      drp.scale.set(B.shoulder * widthK, 1, 0.66);
      part(spine2, box('drapefront2', 0.085, 0.125, 0.006), matFor(cfg.hairColor), 0, -0.008, 0.0625, false).rotation.x = 0.05;
    }
    var neck = P.neck = new THREE.Group(); neck.position.y = M.neckY - M.spine2Y; spine2.add(neck);
    softPart(neck, GEO.neck(), skinM, 0, 0.008, 0, false);
    var head = P.head = new THREE.Group(); head.position.y = M.headY - M.neckY; neck.add(head);
    var headMesh = softPart(head, GEO.head(), skinM, 0, M.headCY, 0, true);
    headMesh.scale.setScalar(B.head);
    var jawMesh = softPart(head, GEO.jaw(), skinM, 0, M.headCY - 0.039, 0.006, false);
    jawMesh.scale.setScalar(B.head);
    softPart(head, GEO.ear(), skinM, 0.0545 * B.head, M.headCY - 0.005, 0, false);
    softPart(head, GEO.ear(), skinM, -0.0545 * B.head, M.headCY - 0.005, 0, false);
    var armLong = cfg.sleeve === 'long';
    function arm(side, s) {
      var u = P['uArm' + s] = new THREE.Group();
      u.position.set(side * M.shoulderX * B.shoulder * widthK, M.shoulderDY, 0); spine2.add(u);
      // BODYFIX2: the deltoid cap sphere is GONE — it read as a
      // round bump ball at the shoulder in the close-up. The
      // shoulder pivot sits INSIDE the chest lathe's shoulder
      // slope, so the tapered upper arm emerges straight from the
      // trunk: one smooth shoulder line, clean sleeve start.
      var um = part(u, GEO.uArm(), topM, 0, 0, 0, true);
      um.scale.set(B.w * widthK, 1, 0.90 * B.d);
      var f = P['fArm' + s] = new THREE.Group();
      f.position.y = M.elbowDY; u.add(f);
      var fm = part(f, GEO.fArm(), armLong ? topM : skinM, 0, 0, 0, true);
      fm.scale.set(B.w * widthK, 1, 0.90 * B.d);
      if (armLong) {
        // long sleeve ends in a cuff ring at the wrist — POLISH2B
        // (item 6): the cuff band is now a full 0.03 m tall
        // (re-seated: spans -0.136..-0.166, same bottom edge).
        var cf = part(f, GEO.cuff(), matFor(darken(cfg.topColor, 0.85)), 0, -0.151, 0, false);
        cf.scale.set(B.w * widthK, 1, 0.90 * B.d);
      } else {
        // short sleeve: thin hem band at the END of the upper arm
        // (rolled-sleeve read, bare forearm below). Round 3 put a
        // WIDE ring on the forearm top — a bulge, not a cuff.
        var sb = part(u, GEO.sleeveBand(), matFor(darken(cfg.topColor, 0.88)), 0, -0.143, 0, false);
        sb.scale.set(B.w * widthK, 1, 0.90 * B.d);
      }
      var h = P['hand' + s] = new THREE.Group();
      h.position.y = M.handDY; f.add(h);
      // BODYFIX3: one merged fingered hand (buildHandGeo), authored
      // in wrist-pivot space — palm, four fingers and thumb included.
      part(h, GEO.hand(side), handM, 0, 0, 0, true);
    }
    arm(1, 'L'); arm(-1, 'R');
    var bottomLong = cfg.bottomType !== 'shorts';
    // STANCEFIX (Bos spec — REPLACES the PROPFIX stance system):
    // the thigh pivots no longer ride at shoulder width. The old
    // stack (hipX 0.104 x B.hip x stanceK 1.00-1.08 x gender
    // factor 1.10/1.067) put the pivot pair at 0.21-0.29H — wider
    // than the pelvis itself (margin -0.08..-0.13H by probe), so
    // the thighs sprouted OUTSIDE the hip line and the crotch
    // gap measured 0.11-0.17H. Now the pivot distance derives
    // from THIS figure's real thigh-top diameter (same profile
    // max diameter + the same scale factors the thigh mesh
    // itself uses): the thighs hang nearly touching (gap target
    // ~0.014H) and the pair is clamped into Bos's 0.115-0.130H
    // band, inside the pelvis line for every build (pelvis >=
    // pivot + thigh — probe-verified). No gender factor and no
    // random factor on the pivot any more; seeded stance
    // variation lives in the pose layer only (idle feet land in
    // the 0.15-0.19H band, +-10%).
    var thighDiaU = (male ? 0.0978 : 0.1006) * B.hip * hipK * widthK * thighK;
    var pivotDistU = Math.min(0.130, Math.max(0.115, thighDiaU + 0.014));
    function leg(side, s) {
      var t = P['thigh' + s] = new THREE.Group();
      t.position.set(side * pivotDistU * 0.5, -0.015 * legK, 0); pelvis.add(t);
      var tm = part(t, male ? GEO.thighM() : GEO.thigh(), botM, 0, 0, 0, true);
      tm.scale.set(B.hip * hipK * widthK * thighK, 1, (male ? 0.92 : 0.95) * B.d * thighK);
      if (bottomLong) {
        // trouser crease: a FLAT colour line down the thigh front
        // (spec: creases are shading, never modelled volume).
        // LEGFIX C: no longer police-only — every long trouser
        // gets the line; the uniform crease stays darker.
        part(tm, box('crease5', 0.007, 0.12, 0.002), matFor(darken(cfg.bottomColor, isPolice ? 0.55 : 0.78)), 0, -0.105, male ? 0.0515 : 0.0492, false);
      }
      var sh = P['shin' + s] = new THREE.Group();
      sh.position.y = (M.kneeY - M.pelvisY + 0.015) * legK; t.add(sh);
      var sm = part(sh, male ? GEO.shinM() : GEO.shin(), bottomLong ? botM : skinM, 0, 0, 0, true);
      sm.scale.set(B.hip * hipK * widthK, 1, 0.92 * B.d);
      // LEGFIX B: the calf bulge on the back of the upper shin
      // (trouser material under long pants, skin under shorts
      // and skirts — same mesh the shin wears).
      var cf7 = part(sh, GEO.calf(), bottomLong ? botM : skinM, 0, -0.060, -0.020, false);
      cf7.scale.set(B.hip * hipK * widthK, 1, 0.92 * B.d);
      if (bottomLong) {
        // LEGFIX C: shin crease, continuing the thigh line.
        part(sm, box('creaseS7', 0.006, 0.10, 0.002), matFor(darken(cfg.bottomColor, isPolice ? 0.55 : 0.78)), 0, -0.10, 0.0335, false);
        // LEGFIX C: the hem is a real STACK band now (taller and
        // wider than the old detail ring) — the trouser falls
        // over the shoe top instead of stopping at the ankle.
        var pc = part(sh, male ? GEO.pantCuffM() : GEO.pantCuff(), matFor(darken(cfg.bottomColor, 0.8)), 0, -0.185, 0, false);
        pc.scale.set(B.hip * hipK * widthK, 1, 0.92 * B.d);
      } else {
        // shorts: thin hem band at the thigh's lower edge
        var hb = part(t, male ? GEO.shortsBandM() : GEO.shortsBand(), matFor(darken(cfg.bottomColor, 0.85)), 0, -0.185, 0, false);
        hb.scale.set(B.hip * hipK * widthK * thighK, 1, (male ? 0.92 : 0.95) * B.d * thighK);
      }
      var ft = P['foot' + s] = new THREE.Group();
      ft.position.y = (M.ankleY - M.kneeY) * legK; sh.add(ft);
      // BODYFIX4: shoe + sole are authored in foot-pivot space
      // (sole bottom at -0.055 = ground), so no offset here; the
      // sole shade drops to 0.32 — a dark wrap under every upper,
      // white sneakers included.
      // PROPFIX: shoe + sole scale per build so the footprint
      // length tracks 1.6x THIS build's head width (the kid's
      // unscaled shoe measured only 1.42x — Bos point 5). The
      // pair rides up by 0.055 x (shoeK - 1) so the sole bottom
      // stays exactly on the ground line at any shoeK.
      var shoeK = (1.6 * 2 * M.headHW * B.head) / 0.1745;
      var soleOff = 0.055 * (shoeK - 1);
      // LEGFIX D: shoe families (factory picks cfg.shoeType).
      // Every variant keeps the foot-pivot contract — sole
      // bottom exactly on -0.055 — and the sole shade lifts
      // from 0.32 to ~0.5: the old near-black wrap swallowed
      // the shoe against dark trousers; the sole now reads as
      // its own lighter band under the upper.
      var st7 = cfg.shoeType || 'sneaker';
      // POLISH (Bos point 7): the sole must READ as a different
      // colour from the upper on every shoe — a 0.52 shade of a
      // near-black upper is black on black, so dark uppers get
      // a gum sole instead. (Size untouched: still 1.60x.)
      var shoeLum = (((cfg.shoeColor >> 16) & 255) * 299 + ((cfg.shoeColor >> 8) & 255) * 587 + (cfg.shoeColor & 255) * 114) / 1000;
      var soleHex = shoeLum < 70 ? 0x6a5a48 : darken(cfg.shoeColor, st7 === 'boot' ? 0.42 : 0.52);
      var soleMsh = part(ft, GEO.sole(), matFor(soleHex), 0, soleOff, 0, false);
      soleMsh.scale.setScalar(shoeK);
      if (st7 === 'sandal') {
        var toeM = part(ft, GEO.sandalToe(), skinM, 0, soleOff, 0, false);
        toeM.scale.setScalar(shoeK);
        var strapM = matFor(darken(cfg.shoeColor, 0.55));
        var st1 = part(ft, box('strap7a', 0.058, 0.009, 0.015), strapM, 0, soleOff - 0.016 * shoeK, 0.036 * shoeK, false);
        st1.scale.setScalar(shoeK);
        var st2 = part(ft, box('strap7b', 0.056, 0.009, 0.013), strapM, 0, soleOff - 0.011 * shoeK, 0.002 * shoeK, false);
        st2.scale.setScalar(shoeK);
      } else {
        var upGeo = st7 === 'boot' ? GEO.shoeBoot() : (st7 === 'heel' ? GEO.shoeHeel() : GEO.shoe());
        var shoeMsh = part(ft, upGeo, shoeM, 0, soleOff, 0, true);
        shoeMsh.scale.setScalar(shoeK);
        if (st7 === 'sneaker') {
          // lace/vamp band across the instep — the flat detail
          // that stops the capsule reading as a blob.
          var lc = part(shoeMsh, box('lace7', 0.056, 0.010, 0.036), matFor(darken(cfg.shoeColor, 0.72)), 0, 0.004, 0.016, false);
          lc.rotation.x = -0.45;
        }
        if (st7 === 'heel') {
          // the footprint sole serves the front two-thirds;
          // the heel block carries the back.
          soleMsh.scale.set(shoeK, shoeK, shoeK * 0.62);
          soleMsh.position.z = 0.030 * shoeK;
        }
      }
    }
    leg(1, 'L'); leg(-1, 'R');
    if (cfg.bottomType === 'skirt') {
      // LEGFIX C: the handle is kept (P.skirt) so update() can
      // sway the hem against the stride.
      P.skirt = part(pelvis, GEO.skirt(), skirtM, 0, -0.075, 0, true);
    }
    var face = buildFace(head, cfg);
    var hair = buildHair(head, cfg);
    var hat = buildHat(head, cfg);
    var api = { pivots: P, face: face, lod1Hide: [] };
    buildAccessories(api, cfg);
    var outlines = [];
    root.traverse(function (o) { if (o.userData && o.userData.isOutline) outlines.push(o); });
    return { root: root, pivots: P, face: face, outlines: outlines, lod1Hide: api.lod1Hide, hairMesh: hair, hatMesh: hat, blob: blob, pelvisBaseY: pelvisBaseY, pivotDist: pivotDistU };
  }

  // ---- createCharacter ------------------------------------------------------------
  // Spec API. update(dt, state) blends locomotion gaits, keyframed
  // actions and look / posture layers procedurally, with lerp
  // smoothing between states; setExpression(name) drives the face.
  // Gait phase is seeded per character (golden-ratio hash of the seed)
  // so no two pedestrians ever walk in sync.
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
      // POLISH2: garment construction inputs from the factory —
      // the top's type (jacket / vest / tee / blazer / blouse)
      // and its print pattern (hawaii / stripes / batik / null).
      topType: cfg.topType || 'tee',
      pattern: cfg.pattern || null,
      bottomType: cfg.bottomType || 'long',
      backpack: cfg.backpack != null ? cfg.backpack : null,
      accentColor: cfg.accent != null ? cfg.accent : null,
      handColor: cfg.handColor,
      accessories: cfg.accessories || [],
      // BODYFIX5: explicit gender signal for the male/female
      // pelvis-leg profiles (null = derive in isMaleCfg).
      female: cfg.female != null ? !!cfg.female : null,
      // PROPFIX: proportion overrides forwarded by the factory
      // from the archetype body block (dead inputs until now):
      // waistK / thighK scale the trunk / thigh width, legFrac
      // scales the leg chain, widthK is the per-seed +-4% width
      // variation (crowd archetypes only).
      waistK: cfg.waistK != null ? cfg.waistK : null,
      thighK: cfg.thighK != null ? cfg.thighK : null,
      legFrac: cfg.legFrac != null ? cfg.legFrac : null,
      widthK: cfg.widthK != null ? cfg.widthK : null,
      face: cfg.face || null,
      expression: cfg.expression || null,
      // LEGFIX D: shoe family from the factory (sneaker / boot /
      // sandal / heel); null = sneaker.
      shoeType: cfg.shoeType || null,
      seed: cfg.seed != null ? cfg.seed : 1
    };
    // POLISH (Bos point 1): 0.86 -> 0.90 — the nose bridge/tip
    // sit closer to the skin tone, so the nose reads as a soft
    // shade step instead of a pasted-on tan slab.
    c.skinDark = darken(c.skin, 0.90);
    var rig = buildRig(c);
    // STANCEFIX: this figure's thigh-pivot distance (unit space)
    // — applyPose uses it to widen the gaits' inward angle on
    // wide-pelvis builds, so the foot track stays in band.
    var pivotDistC = rig.pivotDist || 0.115;
    rig.root.scale.setScalar(c.height);
    var face = rig.face;
    var exprCur = { browA: -3, browY: 0.001, eyeY: 1, mouth: 'flat', ms: 1.15 };
    var exprTarget = EXPRESSIONS.neutral;
    var blinkT = 1.5 + (c.seed % 7) * 0.37, blink = 1;
    var seedPhase = ((c.seed * 0.6180339887) % 1 + 1) % 1;
    var cur = { name: 'idle', time: 0, phase: seedPhase, timeScale: 1 };
    var prev = null, fadeT = 1, fadeDur = 0.12;
    var outCur = newPoseBuffer(), outPrev = newPoseBuffer(), outBlend = newPoseBuffer();
    var lookYaw = 0, lookPitch = 0, lookYawT = 0, lookPitchT = 0, hunch = 0, hunchT = 0;
    // PROPFIX: the rest of the posture record (Bos point 9) —
    // slouch (a soft extra spine curve, head counter-pitched) and
    // stiff (a military-straight spine that also damps the rest
    // bias). Both were declared in archetypes and dropped by the
    // animation adapter until now; they ride the same smoothing.
    var slouch = 0, slouchT = 0, stiff = 0, stiffT = 0;
    var pelvisBaseY = rig.pelvisBaseY != null ? rig.pelvisBaseY : M.pelvisY;
    var timeOverride = null; // adapter hook: absolute rate (panic speed)
    var stuckT = 0; // ROUND 3: finished-one-shot watchdog timer
    // LEGFIX: foot-ground layer state (smoothed sole errors per
    // foot + the pelvis drop) and a private clock for skirt sway.
    // The error is measured on the SOLE's real world bounding
    // box (the only ExtrudeGeometry on each foot), not on the
    // foot pivot: the settled idle pose pitches and settles the
    // feet 1.5-4 cm below the bind plane (probe-measured), and
    // only the true lowest sole point tells contact honestly.
    var fgVT = new THREE.Vector3(), fgBox = new THREE.Box3();
    var fgErrL = 0, fgErrR = 0, fgPelv = 0, charT = 0;
    function findSole(fp) {
      for (var i = 0; i < fp.children.length; i++) {
        var m = fp.children[i];
        if (m.isMesh && m.geometry && m.geometry.type === 'ExtrudeGeometry') {
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          return m;
        }
      }
      return null;
    }
    var fgSoleL = null, fgSoleR = null; // resolved after P exists (below)
    function fgSoleError(soleMesh, footPivot) {
      if (soleMesh) {
        soleMesh.getWorldPosition(fgVT); // forces matrixWorld up the chain
        fgBox.copy(soleMesh.geometry.boundingBox).applyMatrix4(soleMesh.matrixWorld);
        var cx = (fgBox.min.x + fgBox.max.x) / 2, cz = (fgBox.min.z + fgBox.max.z) / 2;
        return SH.World.groundHeightAt(cx, cz) - fgBox.min.y;
      }
      footPivot.getWorldPosition(fgVT);
      return SH.World.groundHeightAt(fgVT.x, fgVT.z) - (fgVT.y - 0.055 * c.height);
    }
    var P = rig.pivots;
    fgSoleL = findSole(P.footL); fgSoleR = findSole(P.footR);
    var stoop = (BUILDS[c.build] || BUILDS.avg).stoop || 0;
    // BODYFIX (round 4): per-character REST bias, hashed from the
    // seed (deterministic — the same cast on every load): a slight
    // head turn, uneven shoulder hang, one elbow a touch more
    // bent. Kills the identical-clone rest pose in staged rows and
    // crowds. Applied additively in update(), idle-family only.
    var restH1 = ((c.seed * 0.7548776662) % 1 + 1) % 1;
    var restH2 = ((c.seed * 0.5698402909) % 1 + 1) % 1;
    var restH3 = ((c.seed * 0.3819660113) % 1 + 1) % 1;
    // BODYFIX2: wider rest variety — head yaw ±5.7°, a head pitch
    // bias, a pelvis roll bias (weight visibly on one hip), and a
    // FREE-KNEE bend: one shin stays a few degrees bent while the
    // weight leg stands straight. Nobody rests in parade stance.
    var restYaw = (restH1 - 0.5) * 0.20;
    var restRoll = (restH1 - 0.5) * 0.05;
    var restPitch = (restH3 - 0.5) * 0.06;
    var restPelvisRoll = (restH3 - 0.5) * 0.045;
    var restKneeSide = restH3 < 0.5 ? 'L' : 'R';
    var restKnee = 0.045 + (restH3 % 0.5) * 0.09;
    var restElbowSide = restH2 < 0.5 ? 'L' : 'R';
    var restElbow = 0.07 + (restH2 % 0.5) * 0.20;
    // PROPFIX (Bos point 9): seeded IDLE VARIANT — not every
    // standing figure rests the same way. 0 = free rest (the
    // BODYFIX bias above), 1 = weight shift (pelvis rolled and
    // pushed toward the straight leg, free knee softer),
    // 2 = hands clasped low in front, 3 = one hand on the hip.
    // Applied additively in update(), 'idle' clip only.
    var idleVar = Math.floor(restH2 * 4) % 4;
    // BODYFIX2: config-level DEFAULT expression (the player's
    // 'warm' smile, wired from the archetype's face.expr through
    // the factory). Resolved through setExpression itself, then
    // snapped into exprCur so frame one already wears it — callers
    // can still override with setExpression / state.expression.
    if (c.expression) {
      setExpression(c.expression);
      exprCur.browA = exprTarget.browA; exprCur.browY = exprTarget.browY;
      exprCur.eyeY = exprTarget.eyeY; exprCur.mouth = exprTarget.mouth;
      exprCur.ms = exprTarget.ms != null ? exprTarget.ms : 1.15;
    }

    function poseDef(name) { return GAITS[name] || POSES[name]; }
    function clipFinished() {
      var def = poseDef(cur.name);
      return !!(def && !def.loop && !GAITS[cur.name] && cur.time >= def.dur - 0.001);
    }
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
      timeOverride = null; stuckT = 0;
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
    // Standing baseline (PROPFIX, stance re-based by STANCEFIX):
    // every standing clip (idle family, talk, phone, aim,
    // point...) gets the same small thigh splay + toe-out on top
    // of the sampled pose, so the feet land in Bos's 0.15-0.19H
    // idle band over the NEW narrow pivots (0.115-0.130H) for
    // every clip and every crossfade. GAITS are exempt from the
    // thigh term — they carry their own inward angle (zin) and
    // must not have an outward degree stacked back on top.
    // Seated / driving / falling clips own their legs — exempt.
    var BASE_SKIP = { idle_sit: 1, drive: 1, enter_car: 1, exit_car: 1, death: 1 };
    function applyPose(out) {
      for (var i = 0; i < POSE_BONES.length; i++) {
        var bn = POSE_BONES[i], pv = P[bn], e = out.p[bn];
        pv.rotation.set(e[0] * DEG, e[1] * DEG, e[2] * DEG);
      }
      if (!BASE_SKIP[cur.name]) {
        // 1 deg a side: with the idle clip's own 1.5 deg keys
        // this puts the settled feet ~0.046H outside the pivot
        // pair — over the 0.115-0.130H pivots that is exactly
        // the 0.16-0.18H idle stance Bos specced (probe-checked
        // per build). Gaits skip it (see above).
        if (!GAITS[cur.name]) {
          P.thighL.rotation.z += 1 * DEG; P.thighR.rotation.z -= 1 * DEG;
        } else {
          // STANCEFIX: wide-pelvis builds (stocky / heavy /
          // wide-hip archetypes) carry wider pivots, so the same
          // base zin would land their feet at pivot width —
          // outside the walk/run lateral band. Add inward angle
          // in proportion to the excess pivot width (~61 deg per
          // unit H: the leg is 0.47H long, so 0.01H of excess
          // pivot needs ~1.2 deg more inward tilt per side to
          // land the foot on the same track).
          var zc = (pivotDistC - 0.115) * 61;
          if (zc > 0) { P.thighL.rotation.z -= zc * DEG; P.thighR.rotation.z += zc * DEG; }
        }
        P.footL.rotation.y += 7 * DEG; P.footR.rotation.y -= 7 * DEG;
        // LEGFIX E: standing knees never lock straight — a soft
        // shin bend (thigh countered) on every standing clip;
        // gaits carry their own base bend, one-shots that leave
        // the ground are exempt.
        if (!GAITS[cur.name] && cur.name !== 'jump' && cur.name !== 'fall' && cur.name !== 'land') {
          P.shinL.rotation.x += 2.2 * DEG; P.shinR.rotation.x += 2.2 * DEG;
          P.thighL.rotation.x -= 0.8 * DEG; P.thighR.rotation.x -= 0.8 * DEG;
        }
      }
      P.pelvis.position.y = pelvisBaseY + out.dy;
      P.pelvis.position.z = out.dz;
    }
    function setExpression(name) {
      var key = EXPRESSIONS[name] ? name : (EXPR_LEGACY[name] || 'neutral');
      exprTarget = EXPRESSIONS[key];
      c.expression = key;
    }
    // PROPFIX: posture target setter shared by update() and the
    // api's setPosture — accepts {hunch, slouch, stiff} or a
    // legacy scalar (hunch only).
    function applyPosture(p) {
      if (p == null) { hunchT = 0; slouchT = 0; stiffT = 0; }
      else if (typeof p === 'number') { hunchT = p; }
      else { hunchT = p.hunch || 0; slouchT = p.slouch || 0; stiffT = p.stiff || 0; }
    }
    function update(dt, state) {
      state = state || {};
      charT += dt;
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
      // ROUND 3 state-return guarantee: a finished NON-LOOP one-shot
      // (hit reactions, stagger, melee, shoot, reload, jump, land,
      // exit_car) must never be the pose a character gets STUCK in —
      // if no caller has moved on within 0.6 s of the clip ending,
      // fall back to idle; the next update re-resolves locomotion
      // from state.move as usual. 'death' (corpse ownership sits with
      // the caller: respawn / revive) and 'enter_car' (the vehicle
      // system owns that chain into 'drive') are exempt.
      var cd = poseDef(cur.name);
      if (cd && !cd.loop && !GAITS[cur.name] && cur.name !== 'death' && cur.name !== 'enter_car' && clipFinished()) {
        stuckT += dt;
        if (stuckT > 0.6) { stuckT = 0; play('idle', 0.2); }
      } else stuckT = 0;
      // look + posture layers (additive, smoothed)
      if (state.look) { lookYawT = state.look[0] || 0; lookPitchT = state.look[1] || 0; }
      // ROUND 3 BUGFIX: this used to read `hunchT = state.posture || 0`,
      // which CLOBBERED the posture layer to 0 on every frame where the
      // caller drove via setPosture() (the CharAnim adapter path) — the
      // posture layer was dead code. Only an explicit state.posture
      // overrides it now, mirroring the look layer above.
      // PROPFIX: state.posture accepts the full posture record
      // ({hunch, slouch, stiff}) as well as the legacy scalar
      // (hunch only) — see setPosture below.
      if (state.posture != null) applyPosture(state.posture);
      var lk = 1 - Math.exp(-dt * 10);
      lookYaw = lerp(lookYaw, lookYawT, lk); lookPitch = lerp(lookPitch, lookPitchT, lk);
      hunch = lerp(hunch, hunchT, lk);
      slouch = lerp(slouch, slouchT, lk); stiff = lerp(stiff, stiffT, lk);
      P.neck.rotation.y += lookYaw * 0.45; P.neck.rotation.x += lookPitch * 0.45;
      P.head.rotation.y += lookYaw * 0.55; P.head.rotation.x += lookPitch * 0.55;
      // slouch: a soft extra curve through both spine joints with
      // a partial head counter-pitch (a tired slump, distinct from
      // hunch's forward fold). stiff: straightens the spine chain
      // a touch and damps the rest bias below (restK).
      P.spine1.rotation.x += (hunch * 10 + slouch * 7 + stoop * 9) * DEG;
      P.spine2.rotation.x += (slouch * 5 + stoop * 3 - stiff * 2) * DEG;
      P.head.rotation.x -= (hunch * 4 + slouch * 3 + stoop * 5) * DEG;
      var restK = 1 - 0.6 * stiff;
      // BODYFIX rest bias: idle-family poses only — never fights a
      // gait or a keyframed action (aim/shoot/melee stay exact).
      // BODYFIX2 extends it: head pitch + pelvis roll + free knee.
      if (cur.name === 'idle' || cur.name === 'idle_sit' || cur.name === 'idle_lean' || cur.name === 'idle_smoke' || cur.name === 'idle_phone') {
        P.head.rotation.y += restYaw * restK; P.neck.rotation.y += restYaw * 0.5 * restK;
        P.head.rotation.x += restPitch * restK;
        P.pelvis.rotation.z += restPelvisRoll * restK;
        P.uArmL.rotation.z += restRoll * restK; P.uArmR.rotation.z -= restRoll * 0.7 * restK;
        if (cur.name === 'idle') {
          P['fArm' + restElbowSide].rotation.x -= restElbow * restK;
          P['shin' + restKneeSide].rotation.x += restKnee * restK;
          P['thigh' + restKneeSide].rotation.x -= restKnee * 0.35 * restK;
          // PROPFIX idle variants (seeded, see idleVar): a real
          // crowd never rests in one symmetric parade stance.
          if (idleVar === 1) {
            // weight shift: pelvis rolls and pushes toward the
            // straight (weight) leg; the free knee softens more.
            P.pelvis.rotation.z += (restKneeSide === 'L' ? 1 : -1) * 0.055 * restK;
            P.pelvis.position.x += (restKneeSide === 'L' ? -1 : 1) * 0.012 * restK;
            P['shin' + restKneeSide].rotation.x += 0.05 * restK;
          } else if (idleVar === 2) {
            // hands clasped low in front
            P.fArmL.rotation.x -= 0.55 * restK; P.fArmR.rotation.x -= 0.55 * restK;
            P.uArmL.rotation.z += 0.06 * restK; P.uArmR.rotation.z -= 0.06 * restK;
          } else if (idleVar === 3) {
            // one hand on the hip: elbow out, forearm folded in
            var hs = restElbowSide;
            P['uArm' + hs].rotation.z += (hs === 'L' ? 1 : -1) * 0.30 * restK;
            P['fArm' + hs].rotation.x -= 1.15 * restK;
          }
        }
      }
      // LEGFIX E: talk and phone poses carry the same weight
      // shift + free knee as idle — a conversation is not a
      // parade stance either. (Their arms stay with the clip.)
      if (cur.name === 'talk' || cur.name === 'idle_phone') {
        P['shin' + restKneeSide].rotation.x += restKnee * restK;
        P['thigh' + restKneeSide].rotation.x -= restKnee * 0.35 * restK;
        if (idleVar === 1) {
          P.pelvis.rotation.z += (restKneeSide === 'L' ? 1 : -1) * 0.055 * restK;
          P.pelvis.position.x += (restKneeSide === 'L' ? -1 : 1) * 0.012 * restK;
          P['shin' + restKneeSide].rotation.x += 0.05 * restK;
        }
      }
      // LEGFIX C: skirt sway — the hem swings gently against
      // the stride and breathes at rest, instead of riding the
      // pelvis like a lampshade.
      if (P.skirt) {
        var swPh = GAITS[cur.name] ? cur.phase * Math.PI * 2 : charT * 2.1 + seedPhase * 6.28;
        var swAmt = GAITS[cur.name] ? 0.05 : 0.014;
        P.skirt.rotation.x = Math.sin(swPh) * swAmt;
        P.skirt.rotation.z = Math.cos(swPh) * swAmt * 0.6;
      }
      // LEGFIX A: FOOT-GROUND layer (IK-lite). The consumers
      // lerp the ROOT toward groundHeightAt(root); this layer
      // resolves the residual PER FOOT, read from the feet's
      // real world positions after the pose is applied: a foot
      // whose ground sits ABOVE its sole bends its leg (knee
      // flexes, thigh counters, foot stays level) so the sole
      // lands on the higher surface instead of sinking into
      // it; standing, the pelvis also drops toward the LOWER
      // foot so a curb straddle settles mid-way like a real
      // stance. Smoothed, capped, and skipped for seated /
      // driving / corpse / airborne clips and whenever the
      // root itself is off the ground (player jump arc).
      var FOOT_SKIP = { idle_sit: 1, drive: 1, enter_car: 1, exit_car: 1, death: 1, jump: 1, fall: 1, land: 1 };
      if (!FOOT_SKIP[cur.name] && SH.World && SH.World.groundHeightAt) {
        var rp = rig.root.position;
        if (rp.y - SH.World.groundHeightAt(rp.x, rp.z) <= 0.07) {
          var eL = fgSoleError(fgSoleL, P.footL);
          var eR = fgSoleError(fgSoleR, P.footR);
          var fk7 = 1 - Math.exp(-dt * 22);
          fgErrL = lerp(fgErrL, clamp(eL, -0.17, 0.17), fk7);
          fgErrR = lerp(fgErrR, clamp(eR, -0.17, 0.17), fk7);
          var inGait = !!GAITS[cur.name];
          var capBend = inGait ? 0.26 : 0.55;
          // The foot term NEGATES the chain's pitch change
          // (thigh -0.42 + shin +0.72 = +0.30), so the sole
          // stays LEVEL while the leg folds — the first cut
          // added +0.30 and pitched the toe down as fast as
          // the bend lifted it (probe: right feet stuck ~2 cm
          // under every surface).
          // Lever, measured: one radian of this bend lifts the
          // sole ~0.147 x H (the shin term dominates), so the
          // divisor is 0.15-0.17 — the first cuts (0.30, then
          // 0.26) under-lifted ~2x and left residuals.
          // DROP VISIBILITY: applyPose resets pelvis.position.y
          // every frame, so the readings above are taken at
          // POSE height — last frame's pelvis drop is invisible
          // to them. The DROP is therefore driven by the raw
          // errors (how far the low foot dangles at pose
          // height), while the BENDS use drop-corrected errors
          // (raw - fgPelv x H): the high foot's true burial
          // once the pelvis has settled toward the low foot.
          var bendErrL = fgErrL - fgPelv * c.height;
          var bendErrR = fgErrR - fgPelv * c.height;
          if (bendErrL > 0.004) {
            var bL = Math.min(capBend, (bendErrL / c.height) / 0.09);
            P.shinL.rotation.x += bL * 0.72; P.thighL.rotation.x -= bL * 0.42; P.footL.rotation.x -= bL * 0.30;
          }
          if (bendErrR > 0.004) {
            var bR = Math.min(capBend, (bendErrR / c.height) / 0.09);
            P.shinR.rotation.x += bR * 0.72; P.thighR.rotation.x -= bR * 0.42; P.footR.rotation.x -= bR * 0.30;
          }
          if (!inGait) {
            // PELVIS does the heavy lifting — measured fact:
            // joint bends alone lift a sole only ~2 cm (the
            // rise is second-order arc geometry), while a
            // pelvis shift is exact and first-order. Both feet
            // buried (pose settle, root lag) -> raise by the
            // smaller burial; a foot dangling -> drop toward
            // it, capped so the high foot's post-drop burial
            // stays bendable (<= ~0.10 m). A standing split
            // also gets a pelvis ROLL toward the low side —
            // the weight-shift every real curb stance shows.
            var eMin = Math.min(fgErrL, fgErrR);
            var eMax = Math.max(fgErrL, fgErrR);
            var pelvT = 0;
            if (eMin < -0.004) pelvT = Math.max(eMin * 0.92, Math.min(0, eMax - 0.10), -0.11 * c.height) / c.height;
            else if (eMin > 0.004) pelvT = Math.min(eMin * 0.92, 0.06 * c.height) / c.height;
            fgPelv = lerp(fgPelv, pelvT, fk7);
            if (fgPelv) P.pelvis.position.y += fgPelv;
            var split = bendErrL - bendErrR;
            if (Math.abs(split) > 0.05) {
              P.pelvis.rotation.z += clamp(split * 1.1, -0.15, 0.15);
            }
          } else {
            // GAIT pelvis: the gait's own dy drop sinks the
            // STANCE foot under the plane together with the
            // pelvis (measured on the run cycle: trough sole
            // -0.068 m at bind height — far beyond the ~2 cm a
            // knee bend can lift). When one foot is buried
            // while the other is clearly airborne (swing),
            // raise the pelvis by the burial: the stance sole
            // rides back to the surface, the swing foot stays
            // tucked, and the bob reads as spring, not sink.
            // RAW errors, not the smoothed fgErr pair: with
            // the smoothed pair in the loop the raise chased
            // its own lag and floated the runner +0.03..0.07
            // for most of the cycle (measured). No swing-foot
            // condition either: at the drop trough BOTH feet
            // sit near the plane (the cycle's crouch bottom)
            // — in genuine flight both raw errors are
            // negative, so the raise stays off there.
            // Gain > 1 on purpose: the error is read WITH the
            // raise already applied, so the fixed point of a
            // 0.85 gain is only 46% correction (measured: the
            // trough barely moved). 1.8 with a faster channel
            // (32/s) lands ~64% inside the ~5-frame trough.
            var eSt = Math.max(clamp(eL, -0.17, 0.17), clamp(eR, -0.17, 0.17));
            // 1.2, not 1.8: at 1.8 the stance foot floated
            // +0.03..0.05 (measured) — worse in a still than a
            // slight trough sink, which reads as weight.
            var pelvG = eSt > 0.008 ? Math.min(eSt * 1.2, 0.075 * c.height) / c.height : 0;
            fgPelv = lerp(fgPelv, pelvG, 1 - Math.exp(-dt * 26));
            if (fgPelv) P.pelvis.position.y += fgPelv;
          }
        }
      }
      // expression + blink
      if (state.expression) setExpression(state.expression);
      var ek = 1 - Math.exp(-dt * 12);
      exprCur.browA = lerp(exprCur.browA, exprTarget.browA, ek);
      exprCur.browY = lerp(exprCur.browY, exprTarget.browY, ek);
      exprCur.eyeY = lerp(exprCur.eyeY, exprTarget.eyeY, ek);
      exprCur.ms = lerp(exprCur.ms, exprTarget.ms != null ? exprTarget.ms : 1.15, ek);
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
      expression: c.expression || 'neutral',
      update: update,
      play: play,
      setExpression: setExpression,
      setSpeed: function (mps) { // adapter: gait timeScale from speed
        var def = GAITS[cur.name];
        cur.timeScale = def ? clamp(mps / (def.refSpeed * (c.height / 1.75)), 0.4, 2.2) : 1;
      },
      setTimeScale: function (v) { timeOverride = v; },
      setLook: function (yaw, pitch) { lookYawT = yaw || 0; lookPitchT = pitch || 0; },
      setPosture: function (p) { applyPosture(p); },
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
  // 7 body types from curated palettes (Bos spec): each palette is
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
  var PED_HAIRS = ['short', 'buzz', 'slick', 'quiff', 'undercut', 'messy', 'curly', 'afro', 'bun', 'ponytail', 'long', 'bob', 'hijab', 'bald'];
  var PED_HATS = ['none', 'none', 'none', 'cap', 'beanie', 'sunhat', 'peci'];
  var PED_ACCS = [[], [], ['glasses'], ['bag'], ['backpack'], ['phone'], ['sunglasses'], ['umbrella']];
  function spawnPedestrian(seed) {
    var r = rng((seed >>> 0) * 7919 + 17);
    var pal = pick(r, PED_PALETTES);
    var buildRoll = r();
    var build = buildRoll < 0.26 ? 'avg' : buildRoll < 0.46 ? 'slim' : buildRoll < 0.64 ? 'stocky'
      : buildRoll < 0.76 ? 'heavy' : buildRoll < 0.86 ? 'teen' : buildRoll < 0.93 ? 'elderly' : 'kid';
    var female = r() < 0.45;
    var height = build === 'kid' ? 1.25 + r() * 0.15 : build === 'teen' ? 1.45 + r() * 0.17
      : build === 'elderly' ? 1.58 + r() * 0.16 : 1.58 + r() * 0.28;
    return createCharacter({
      height: height,
      build: build,
      // BODYFIX5: pass the roll explicitly — generic men get the
      // male pelvis/leg profile, generic women keep the shared one.
      female: female,
      skin: pick(r, PED_SKINS),
      top: pal.top, bottom: pal.bottom, shoe: pal.shoe,
      hairColor: build === 'elderly' ? pick(r, [0xb8b0a4, 0xd8d3c8, 0x9a938a]) : pick(r, PED_HAIRC),
      hair: female ? pick(r, ['bun', 'ponytail', 'long', 'bob', 'hijab', 'short']) : pick(r, PED_HAIRS),
      hat: pick(r, PED_HATS),
      sleeve: r() < 0.5 ? 'long' : 'short',
      bottomType: female && r() < 0.3 ? 'skirt' : (r() < 0.25 ? 'shorts' : 'long'),
      accessories: pick(r, PED_ACCS),
      // LEGFIX D: crowd shoe variety — heels for some women,
      // sandals at the shore end of the palette, else sneakers.
      shoeType: female ? (r() < 0.28 ? 'heel' : (r() < 0.30 ? 'sandal' : 'sneaker')) : (r() < 0.16 ? 'sandal' : 'sneaker'),
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
    // POLISH2: vehicles share the characters' body gradient so
    // car paint bands like the cast (spec B10).
    gradientMapBody: gradientMapBody,
    POSE_BONES: POSE_BONES
  };
})(window.SH = window.SH || {});
