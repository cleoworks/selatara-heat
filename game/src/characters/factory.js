// SELATARA HEAT — characters/factory.js  (Character System, Stage A)
// The ONE factory every human in the game comes from:
//   SH.CharFactory.create(archetypeOrId, seed) -> character
// A character = one shared skeleton (CharRig) + smooth-skinned body +
// procedural canvas face + loft clothing layers + bone-attached
// accessories, in three LODs (full / plain / instanced silhouette).
// Seeded RNG: the same seed always builds the same person, and a crowd
// of 35 seeded pedestrians never repeats a face/outfit combination.
(function (SH) {
  'use strict';

  var Rig = SH.CharRig;

  // ---- seeded rng ---------------------------------------------------------
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

  var SKIN_TONES = [0xf7d7b5, 0xf2c89b, 0xe8b184, 0xdb9a68, 0xc9824e, 0xa96638, 0x86502a, 0x6b3f22];
  var HAIR_COLORS = [0x17130f, 0x2b1d12, 0x4a2f1a, 0x6e4a26, 0x8a6a3c, 0xb8b0a4, 0xd8d3c8, 0x101010];

  function rgb(hex) {
    // Vertex colours live in LINEAR working space. The face texture
    // (CanvasTexture, SRGBColorSpace) is decoded sRGB->linear by the
    // renderer, so the body must be decoded the same way — raw /255
    // values rendered noticeably LIGHTER than the face (head one tone,
    // neck/arms another). THREE.Color(hex) performs the conversion.
    var col = new THREE.Color(hex);
    return [col.r, col.g, col.b];
  }
  function css(hex) { return '#' + ('000000' + hex.toString(16)).slice(-6); }

  // ---- materials (shared / cached) ---------------------------------------
  var matCache = {};
  function mat(color, rough, opts) {
    var key = color + '|' + rough + '|' + (opts && opts.key || '');
    if (matCache[key]) return matCache[key];
    var m = new THREE.MeshStandardMaterial({ color: color, roughness: rough, metalness: 0.0, side: THREE.DoubleSide });
    if (opts && opts.flat) m.flatShading = true;
    matCache[key] = m; return m;
  }
  var bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
  var darkMat = mat(0x14161c, 0.5);

  // HEAD PASS hair material: roughness 0.5 + a light envMap sheen
  // (spec) so the layered shells read as volume, not matte plastic.
  var hairMatCache = {};
  function hairMat(color) {
    if (hairMatCache[color]) return hairMatCache[color];
    var m = new THREE.MeshStandardMaterial({ color: color, roughness: 0.5, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.7 });
    hairMatCache[color] = m; return m;
  }
  // HEAD PASS round 2: buildFaceGear + the eye/iris materials are
  // REMOVED with rig.faceGear — the face is texture-drawn now
  // (simplify clause; see faceTexture below).

  var patternCache = {};
  function patternMat(kind, c1, c2) {
    var key = kind + '|' + c1 + '|' + c2;
    if (patternCache[key]) return patternCache[key];
    var cv = document.createElement('canvas'); cv.width = cv.height = 128;
    var c = cv.getContext('2d');
    c.fillStyle = css(c1); c.fillRect(0, 0, 128, 128);
    c.fillStyle = css(c2);
    var i, j;
    if (kind === 'stripes') { for (i = 0; i < 128; i += 16) c.fillRect(i, 0, 6, 128); }
    else if (kind === 'checks') { for (i = 0; i < 128; i += 32) for (j = 0; j < 128; j += 32) if ((i + j) / 32 % 2) c.fillRect(i, j, 32, 32); }
    else if (kind === 'hawaii') {
      // Stage C fix: the old painter dropped 26 random red discs +
      // stems on cream — at game distance they read as BLOOD STAINS
      // (parent finding, Iterasi 2). A fabric print is REGULAR:
      // hibiscus flowers (5 petals + stamen) and leaf pairs laid on
      // a fixed lattice, petal colour = c2 (coral/pink/orange from
      // the archetype), leaves in two controlled greens, centres
      // yellow. Shapes first, colour second — never splatter.
      var leaf = function (x, y, ang, s, col) {
        c.save(); c.translate(x, y); c.rotate(ang); c.fillStyle = col;
        c.beginPath(); c.ellipse(0, 0, 7 * s, 2.8 * s, 0, 0, 7); c.fill(); c.restore();
      };
      var flower = function (x, y, s, col) {
        c.fillStyle = col;
        for (var pk = 0; pk < 5; pk++) {
          var a = pk / 5 * Math.PI * 2 + 0.5;
          c.save(); c.translate(x + Math.cos(a) * 4.6 * s, y + Math.sin(a) * 4.6 * s); c.rotate(a);
          c.beginPath(); c.ellipse(0, 0, 5.2 * s, 2.9 * s, 0, 0, 7); c.fill(); c.restore();
        }
        c.fillStyle = '#f7c948';
        c.beginPath(); c.arc(x, y, 2.0 * s, 0, 7); c.fill();
        c.strokeStyle = '#f7c948'; c.lineWidth = 1.1;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + 3.4 * s, y - 3.0 * s); c.stroke();
        c.fillStyle = '#e86a4a'; c.beginPath(); c.arc(x + 3.8 * s, y - 3.4 * s, 1.1 * s, 0, 7); c.fill();
      };
      var lx, ly, fx, fy, dx2, dy2;
      for (ly = 0; ly < 2; ly++) for (lx = 0; lx < 2; lx++) {
        leaf(lx * 64 + 32, ly * 64 + 14, 0.7, 1, 'rgba(62,125,58,0.85)');
        leaf(lx * 64 + 14, ly * 64 + 46, -0.6, 0.85, 'rgba(87,160,71,0.8)');
        leaf(lx * 64 + 52, ly * 64 + 58, 2.6, 0.9, 'rgba(62,125,58,0.7)');
      }
      for (fy = 0; fy < 2; fy++) for (fx = 0; fx < 2; fx++) {
        flower(fx * 64 + 18, fy * 64 + 26, 1.0, css(c2));
        flower(fx * 64 + 48, fy * 64 + 56, 0.72, css(c2));
      }
      // tiny white plumeria dots in the lattice gaps
      c.fillStyle = 'rgba(255,252,244,0.9)';
      for (dy2 = 0; dy2 < 2; dy2++) for (dx2 = 0; dx2 < 2; dx2++) {
        c.beginPath(); c.arc(dx2 * 64 + 34, dy2 * 64 + 38, 1.7, 0, 7); c.fill();
        c.beginPath(); c.arc(dx2 * 64 + 6, dy2 * 64 + 62, 1.4, 0, 7); c.fill();
      }
    } else if (kind === 'batik') {
      for (i = 0; i < 128; i += 32) for (j = 0; j < 128; j += 32) {
        c.beginPath(); c.arc(i + 16, j + 16, 9, 0, 7); c.stroke();
        c.beginPath(); c.arc(i + 16, j + 16, 3.5, 0, 7); c.fill();
      }
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
    var m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide });
    patternCache[key] = m; return m;
  }
  function clothMat(spec) {
    if (!spec) return mat(0x888888, 0.85);
    if (spec.pattern) return patternMat(spec.pattern, spec.color, spec.color2 || 0xffffff);
    return mat(spec.color, spec.rough != null ? spec.rough : 0.85);
  }

  // ---- procedural face -----------------------------------------------------
  // Canvas wrapped on the head sphere; face centre at u=0.25
  // (x=64 in 256-space; the canvas is 512 and drawn at 2x scale so
  // features stay crisp in cutscene close-ups).
  // HEAD PASS ROUND 2 — SIMPLIFY CLAUSE ACTIVE (user spec point 5 +
  // parent verdict on round 1): the face is FLAT and CLEAN, fully
  // drawn here — oval eyes with cream white + dark iris + 1-point
  // highlight, THICK drawn brows (hair-coloured, ~2x the old
  // strokes), nose as SOFT SIDE SHADING ONLY (the 3D nose mesh and
  // the 3D eye/brow gear are deleted), mouth line + lower-lip hint,
  // very soft blush. High contrast so features read at 3 m.
  // Expression variants (f.expr) swap the texture.
  var faceCache = {};
  function faceTexture(f, skinHex) {
    var key = JSON.stringify(f) + '|' + skinHex;
    if (faceCache[key]) return faceCache[key];
    var cv = document.createElement('canvas'); cv.width = cv.height = 512;
    var c = cv.getContext('2d');
    c.scale(2, 2); // draw in 256-space
    c.fillStyle = css(skinHex); c.fillRect(0, 0, 256, 256);
    // faint centre glow only — the old radial gradient's dark
    // outer stop pooled under the jaw and read as a chin shadow
    var glow = c.createRadialGradient(64, 118, 12, 64, 118, 110);
    glow.addColorStop(0, 'rgba(255,240,220,0.10)'); glow.addColorStop(1, 'rgba(40,16,0,0.015)');
    c.fillStyle = glow; c.fillRect(0, 0, 256, 256);
    // ---- brows: thick arched strokes, hair colour ---------------
    var browCol = f.browColor != null ? css(f.browColor) : '#2b1d12';
    c.strokeStyle = browCol; c.globalAlpha = 0.92; c.lineWidth = 5.5; c.lineCap = 'round';
    function brow(cx, mirror, yOut, yMid, yIn) {
      c.beginPath();
      c.moveTo(cx + mirror * 8.5, yOut);
      c.quadraticCurveTo(cx, yMid, cx - mirror * 8.5, yIn);
      c.stroke();
    }
    if (f.expr === 'angry') { brow(52, 1, 105, 103.5, 111.5); brow(76, -1, 105, 103.5, 111.5); }
    else if (f.expr === 'surprised') { brow(52, 1, 106, 98.5, 105); brow(76, -1, 106, 98.5, 105); }
    else { brow(52, 1, 109.5, 101.5, 108.5); brow(76, -1, 109.5, 101.5, 108.5); }
    c.globalAlpha = 1;
    // ---- eyes: drawn ovals, white + iris + highlight ------------
    // soft shadow just above (under-brow) and below each eye
    c.fillStyle = 'rgba(70,38,20,0.08)';
    c.beginPath(); c.ellipse(52, 112.5, 9, 2.4, 0, 0, 7); c.ellipse(76, 112.5, 9, 2.4, 0, 0, 7); c.fill();
    c.fillStyle = 'rgba(70,38,20,0.10)';
    c.beginPath(); c.ellipse(52, 128.5, 8, 2.0, 0, 0, 7); c.ellipse(76, 128.5, 8, 2.0, 0, 0, 7); c.fill();
    function eye(cx) {
      var ry = f.eyes === 'narrow' ? 3.7 : f.eyes === 'sleepy' ? 4.2 : f.expr === 'surprised' ? 5.9 : 5.0;
      c.fillStyle = '#f2ede4';
      c.beginPath(); c.ellipse(cx, 121, 6.8, ry, 0, 0, 7); c.fill();
      var iy = f.eyes === 'sleepy' ? 121.8 : 121;
      c.fillStyle = '#2e1a0c';
      c.beginPath(); c.arc(cx, iy, 4.0, 0, 7); c.fill();
      c.fillStyle = '#0d0603';
      c.beginPath(); c.arc(cx, iy, 2.1, 0, 7); c.fill();
      c.fillStyle = '#ffffff';
      c.beginPath(); c.arc(cx - 1.5, iy - 1.7, 1.3, 0, 7); c.fill();
      if (f.eyes === 'sleepy') { // lid band over the top of the eye
        c.fillStyle = css(skinHex); c.fillRect(cx - 7.2, 114.4, 14.4, 5.2);
      }
      // lash line over the top edge
      c.strokeStyle = 'rgba(43,24,15,0.90)'; c.lineWidth = 1.7; c.lineCap = 'round';
      c.beginPath(); c.ellipse(cx, 121, 7.1, ry + 0.4, 0, Math.PI * 1.06, Math.PI * 1.94); c.stroke();
    }
    eye(52); eye(76);
    // nose: soft side shading ONLY (no 3D nose) — a slightly
    // stronger side shadow than round 1 (Iterasi 2 asks for it),
    // a soft shadow under the tip, and the two nostril dots
    var ng = c.createLinearGradient(60, 0, 69, 0);
    ng.addColorStop(0, 'rgba(60,30,10,0)'); ng.addColorStop(0.5, 'rgba(60,30,10,0.10)'); ng.addColorStop(1, 'rgba(60,30,10,0)');
    c.fillStyle = ng; c.fillRect(59, 126, 10, 17);
    c.fillStyle = 'rgba(60,30,10,0.13)';
    c.beginPath(); c.ellipse(64, 146.5, 4.6, 1.7, 0, 0, 7); c.fill();
    c.fillStyle = 'rgba(50,26,12,0.38)';
    c.beginPath(); c.arc(60.5, 144, 1.15, 0, 7); c.arc(67.5, 144, 1.15, 0, 7); c.fill();
    // mouth — strong enough to read as a mouth at 2 m; f.expr
    // 'surprised' swaps in an open mouth instead
    if (f.expr === 'surprised') {
      c.fillStyle = 'rgba(70,22,16,0.92)';
      c.beginPath(); c.ellipse(64, 157, 3.6, 4.8, 0, 0, 7); c.fill();
    } else {
      c.strokeStyle = 'rgba(94,34,24,0.95)'; c.lineWidth = 2.6; c.lineCap = 'round';
      c.beginPath();
      if (f.mouth === 'grin') { c.arc(64, 150, 10, 0.25, Math.PI - 0.25); }
      else if (f.mouth === 'flat') { c.moveTo(56.5, 157); c.lineTo(71.5, 157); }
      else if (f.mouth === 'stern' || f.expr === 'angry') { c.arc(64, 164, 8, Math.PI + 0.5, -0.5); }
      else { c.arc(64, 152, 8.5, 0.32, Math.PI - 0.32); }
      c.stroke();
      if (f.mouth !== 'stern' && f.mouth !== 'flat' && f.expr !== 'angry') { // lower-lip hint
        c.strokeStyle = 'rgba(255,220,190,0.20)'; c.lineWidth = 1.4;
        c.beginPath(); c.arc(64, 154.5, 6.0, 0.55, Math.PI - 0.55); c.stroke();
      }
    }
    if (f.blush) {
      // round 2: radial-gradient blush at HALF the old alpha —
      // round 1's flat 0.20 ellipses read as pink stickers
      var bl1 = c.createRadialGradient(40, 140, 1, 40, 140, 10);
      bl1.addColorStop(0, 'rgba(232,110,90,0.10)'); bl1.addColorStop(1, 'rgba(232,110,90,0)');
      c.fillStyle = bl1; c.beginPath(); c.arc(40, 140, 10, 0, 7); c.fill();
      var bl2 = c.createRadialGradient(88, 140, 1, 88, 140, 10);
      bl2.addColorStop(0, 'rgba(232,110,90,0.10)'); bl2.addColorStop(1, 'rgba(232,110,90,0)');
      c.fillStyle = bl2; c.beginPath(); c.arc(88, 140, 10, 0, 7); c.fill();
    }
    if (f.mustache) {
      c.fillStyle = 'rgba(30,20,14,0.82)';
      c.beginPath(); c.ellipse(64, 149, 10.5, 2.6, 0, 0, 7); c.fill();
    }
    if (f.beard) {
      // broken, skin-graded stubble — never a solid dark block.
      // HEAD PASS iter-2: softer + narrower + lower — iter-1's
      // gradient pooled into a dark mask over the whole jaw, and
      // its regular light-stroke grid read as a dashed line.
      var bg = c.createLinearGradient(0, 156, 0, 204);
      bg.addColorStop(0, 'rgba(28,18,12,0)'); bg.addColorStop(0.4, 'rgba(28,18,12,0.12)'); bg.addColorStop(1, 'rgba(28,18,12,0.24)');
      c.fillStyle = bg; c.fillRect(42, 154, 44, 52);
    }
    if (f.wrinkles) {
      c.strokeStyle = 'rgba(70,40,20,0.22)'; c.lineWidth = 1.3;
      c.beginPath(); c.moveTo(47, 99); c.quadraticCurveTo(64, 95.5, 81, 99); c.stroke();
      c.beginPath(); c.moveTo(50, 93); c.quadraticCurveTo(64, 90, 78, 93); c.stroke();
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    faceCache[key] = tex; return tex;
  }

  // ---- clothing lofts -------------------------------------------------------
  function subStations(stations, from, to, addR, scaleR) {
    var out = [];
    for (var i = from; i <= to && i < stations.length; i++) {
      var s = stations[i];
      var ns = Rig.st(s.p[0], s.p[1], s.p[2], s.rx * (scaleR || 1) + addR, s.rz * (scaleR || 1) + addR, s.a, s.b, s.w);
      if (s.tiltZ) ns.tiltZ = s.tiltZ; // round 6: cloth copies inherit the skin station tilt (deltoid slope)
      out.push(ns);
    }
    return out;
  }
  // Clothing pieces sharing a material are merged into ONE skinned mesh
  // (draw-call discipline); parts are raw loft tubes collected per piece.
  function clothMesh(parts, boneIndex, material, capEnd) {
    var g = Rig.mergeParts(parts);
    g.computeVertexNormals();
    var m = new THREE.SkinnedMesh(g, material);
    m.frustumCulled = false;
    return m;
  }
  function tubePart(stations, boneIndex, capEnd) {
    return Rig.tube(stations, boneIndex, 10, false, !!capEnd);
  }

  function buildClothes(p, boneIndex, wear, skinRGB) {
    var S = Rig.bodyStations(p), j = S.joints, H = p.H;
    var meshes = [];
    var top = wear.top, bottom = wear.bottom;
    if (top && top.type !== 'none') {
      // Iterasi 2 (user spec): the top is a loft OF THE BODY ITSELF
      // at a close offset — tee/blouse +0.008 m (spec: +0.8 cm),
      // jacket/blazer +0.020 (it layers over the tee line). It is
      // still the round-8 verbatim station copy, never a separately
      // authored wider mesh.
      var off = top.type === 'jacket' || top.type === 'blazer' ? 0.020 : top.type === 'vest' ? 0.010 : 0.008;
      // Round 8: the top is the skin torso loft copied VERBATIM —
      // stations 2..11 at +off, waist to the top of the neck taper,
      // INCLUDING the trapezius slope stations — so the cloth wall
      // is a uniform offset shell over the skin everywhere (the
      // round-4 construction, raycast-verified in its day). Rounds
      // 5-7 authored separate cloth shoulder geometry because the
      // SKIN's deltoid cap (a flat disc of r 0.040H at neck height)
      // pierced every slope the cloth could draw; round 7's wide
      // authored ellipses additionally flared from the chest copy
      // (rx 0.103H -> 0.134H over 0.006H of height), which rendered
      // as a flat fin across the upper chest. Round 8 fixed the
      // skin instead (pivot at armpit height, cap shrunk to 0.032H
      // and tilted onto the trapezius line), so the copied loft —
      // whose cross-sections match the torso's own depth at every
      // height — now clears the shoulder everywhere. The arm exits
      // through the sleeve; the skin/cloth wall crossing at the
      // exit sits inside the sleeve tube (see sleeve()).
      // Iterasi 2: the copy now starts at station 1 (pelvisY), one
      // station LOWER than round 8's station 2 — the hem reaches
      // the hips and overlaps the pants waistband by a full band
      // (0.045H), with a small extra flare on the two hem stations
      // so the shirt sits OVER the pants/belt line instead of
      // sinking into it. (Round 8's hem ended exactly at the pants'
      // top ring: in a bend the two shells parted and skin/dark
      // showed at the waist.)
      var topSts = subStations(S.torso, 1, 11, off);
      // Round 9: the uniform +off shell GRAZES the skin on the
      // trapezius slope — the two near-parallel shells interleave
      // per-triangle there and skin streaks tear through the cloth
      // from above (the round-4 disease, measured by probe9: 103
      // body-first rays + 90 no-cloth rays in the slope zone at the
      // old offset). Separate the shells DECISIVELY on the slope:
      // extra margin ramping up over the upper chest (torso st 5-6),
      // peaking on the three slope stations (7-9), tapering into
      // the neck taper (10-11). Acceptance is the probe, not the
      // eye: cloth first with >= 3 mm margin on every zone ray.
      // (Keyed by STATION number now that the range starts at 1.)
      var slopeExtra = { 5: 0.004, 6: 0.010, 7: 0.017, 8: 0.017, 9: 0.012, 10: 0.006, 11: 0.002 };
      var hemExtra = { 1: 0.006, 2: 0.004 };
      for (var xi = 0; xi < topSts.length; xi++) {
        var stNo = xi + 1;
        var exT = (slopeExtra[stNo] || 0) + (hemExtra[stNo] || 0);
        topSts[xi].rx += exT; topSts[xi].rz += exT;
      }
      // Round 9 collar: the top copied station (torso 11) sat at
      // neckY-0.004H hugging the neck taper — a turtleneck band.
      // Drop ONLY that last ring and loosen it, so the tee ends
      // as a crew neck below the jaw line. (Dropping station 10
      // too was tried and reverted within this round: at its
      // lowered height its radius 0.0758 fell INSIDE skin station
      // 9's radius 0.084 at the same height — the cloth ring
      // crossed into the skin and the probe's minimum margin in
      // the zone collapsed to ~0 mm right at that crossing.)
      // Iterasi 2: loosening halved (+0.008H -> +0.005H) — the spec
      // wants the round collar SNUG at the neck.
      topSts[10].p[1] -= 0.011 * H; topSts[10].rx += 0.005 * H; topSts[10].rz += 0.005 * H;
      topSts[9].rx += 0.002 * H; topSts[9].rz += 0.002 * H;
      var parts = [Rig.tube(topSts, boneIndex, 10, false, false)];
      // Iterasi 2 (user spec): a short sleeve follows the upper
      // arm at +1 cm and its hem hangs 2-3 cm ABOVE THE ELBOW —
      // arm station 3 sits at elbowY+0.012H (~2.1 cm), so the
      // default short sleeve now runs to station 3 (was 1: a cap
      // sleeve ending mid-deltoid). 'mid' -> 4, 'long' -> 5.
      var sleeveTo = top.sleeve === 'long' ? 5 : top.sleeve === 'mid' ? 4 : top.type === 'vest' ? -1 : 3;
      var sleeveOff = top.type === 'jacket' || top.type === 'blazer' ? off : 0.010;
      // Round 8 sleeve: a buried base ring pulled inboard and up
      // from the joint (mostly inside the torso loft volume), then
      // verbatim copies of the skin arm stations at +off — the
      // first copy inherits the skin cap's tilt, so the sleeve head
      // lies along the same trapezius line, one offset above the
      // skin cap everywhere. Where the skin arm crosses the cloth
      // torso wall on its way out (x ~ 0.118H, y ~ neckY-0.058H),
      // that point lies inside this sleeve tube, hidden.
      function sleeve(armStations, side, to) {
        var s = side > 0 ? 'L' : 'R', sx = j.shoulderX * side;
        var base = Rig.st(sx * 0.80, j.armY + 0.014 * H, 0, 0.036 * H + sleeveOff, 0.036 * H + sleeveOff, 'clav' + s, 'uArm' + s, 0.55);
        base.tiltZ = -side * 0.42;
        // Round 9: same decisive separation over the sleeve head —
        // probe9 found the skin deltoid cap grazing/poking past
        // the sleeve shell around the shoulder crease (the no-
        // cloth ray cluster at the arm station-0 disc). The base
        // ring and the first copied stations get extra margin,
        // tapering down the arm; the hem hug below still applies.
        base.rx += 0.008; base.rz += 0.008;
        var sts = [base];
        var sub = subStations(armStations, 0, to, sleeveOff);
        var sleeveExtra = [0.012, 0.010, 0.006, 0.003, 0.003, 0.003];
        for (var si = 0; si < sub.length; si++) {
          var se = sleeveExtra[Math.min(si, sleeveExtra.length - 1)];
          sub[si].rx += se; sub[si].rz += se;
        }
        var lastS = sub[sub.length - 1];
        lastS.rx *= 0.94; lastS.rz *= 0.94; // hem hugs the arm
        // Round 9: CAP the sleeve mouth (capStart). The base ring
        // is an open disc tilted across the shoulder crease: its
        // outboard half sits outside the torso wall, and probe9
        // measured whole ray families entering that open mouth and
        // hitting the skin deltoid cap inside (the no-cloth
        // cluster at the arm disc, bind x 0.17-0.21). The fan
        // closes the mouth with cloth: mostly buried inside the
        // torso tube, its exposed part patches the crease wedge
        // and crosses the torso wall transversally (a seam line,
        // not the near-parallel graze that streaks).
        return Rig.tube(sts.concat(sub), boneIndex, 10, true, false);
      }
      if (sleeveTo >= 0) {
        parts.push(sleeve(S.armL, 1, sleeveTo));
        parts.push(sleeve(S.armR, -1, sleeveTo));
      }
      if (top.type === 'jacket' || top.type === 'blazer') { // collar
        // Round 10: radii widened (0.033/0.030 -> 0.040/0.036H) —
        // the thicker neck frustum (0.036H at its base) would
        // swallow the old collar tube whole.
        var colSt = [Rig.st(0, j.neckY - 0.026 * H, 0, 0.040 * H, 0.040 * H, 'neck'),
                     Rig.st(0, j.neckY + 0.008 * H, 0, 0.036 * H, 0.036 * H, 'neck', 'head', 0.3)];
        parts.push(tubePart(colSt, boneIndex));
      }
      meshes.push(clothMesh(parts, boneIndex, clothMat(top)));
    }
    if (bottom && bottom.type === 'skirt') {
      // Iterasi 2: the skirt's top rings are DERIVED from the
      // body's own hip stations (+ margin). The old authored ring
      // (0.088H at pelvisY+0.055H) sat INSIDE the skin torso
      // (~0.094H at that height): skin poked through the skirt's
      // top band in alternating facets — the zigzag skin spikes
      // at the waist in the hTP/kTP evidence. Rings 0-1 now hug
      // the hips OUTSIDE the skin; the flare takes over below.
      var hipRxS = S.torso[1].rx, hipRzS = S.torso[1].rz;
      var sk = [
        Rig.st(0, j.pelvisY + 0.062 * H, 0, hipRxS + 0.012, hipRzS + 0.010, 'pelvis'),
        Rig.st(0, j.pelvisY + 0.020 * H, 0, hipRxS + 0.016, hipRzS + 0.013, 'pelvis'),
        Rig.st(0, j.pelvisY - 0.070 * H, 0, hipRxS + 0.045, hipRzS + 0.032, 'pelvis'),
        Rig.st(0, j.pelvisY - 0.160 * H, 0, hipRxS + 0.085, hipRzS + 0.058, 'thighL', 'thighR', 0.5),
        Rig.st(0, j.pelvisY - 0.260 * H, 0, hipRxS + 0.125, hipRzS + 0.082, 'thighL', 'thighR', 0.5)
      ];
      meshes.push(clothMesh([tubePart(sk, boneIndex)], boneIndex, clothMat(bottom)));
      meshes.push(clothMesh([tubePart(subStations(S.legL, 4, 6, 0.004), boneIndex),
                             tubePart(subStations(S.legR, 4, 6, 0.004), boneIndex)], boneIndex, mat(0x333333, 0.8)));
    } else if (bottom && bottom.type !== 'none') {
      var legTo = bottom.type === 'shorts' ? 4 : 7;
      var pantsL = subStations(S.legL, 0, legTo, 0.011);
      var pantsR = subStations(S.legR, 0, legTo, 0.011);
      // Iterasi 2: kill the hip "pockets" — the leg tubes' top
      // rings used to bulge PAST the torso shell at the hip sides
      // (centre 0.046H + radius ~0.065H ≈ 0.111H vs the torso's
      // ~0.105H), reading as two stuffed pockets. The first ring
      // tucks to 0.96x, the second to 0.98x: still inside the
      // torso silhouette, but (skinR+off)*scale stays ABOVE the
      // skin ring — the first attempt (0.82x) dropped the cloth
      // ring INSIDE the skin and the thigh poked through the
      // pants top in a brown zigzag at the hip. The pants'
      // waist copies also drop to +0.009 so the shirt hem
      // (+0.014 at the hem stations) stays PROUD of the
      // waistband — shirt over pants, never a coincident-shell
      // graze at the top ring.
      [pantsL, pantsR].forEach(function (pp) {
        pp[0].rx *= 0.96; pp[0].rz *= 0.96;
        if (pp[1]) { pp[1].rx *= 0.98; pp[1].rz *= 0.98; }
      });
      meshes.push(clothMesh([
        tubePart(subStations(S.torso, 0, 2, 0.009), boneIndex),
        tubePart(pantsL, boneIndex),
        tubePart(pantsR, boneIndex)], boneIndex, clothMat(bottom)));
      // Thin belt band sealing the shirt/pants junction (the
      // spec's optional seam cover): a closed ring a few mm proud
      // of BOTH shells at the waistband line. Iterasi 2 fix: the
      // first belt sat at a FIXED +0.019 with radial 12 against
      // the top's radial 10 — the top's chord facets sag ~5% of
      // radius between vertices, so the belt's vertices poked
      // through the jacket's chord midpoints as a ring of dark
      // triangle tips at the hem. Now the belt derives from the
      // TOP's own hem radius (+4.5 mm) at the SAME radial count.
      var topOff = top && top.type !== 'none' ?
        (top.type === 'jacket' || top.type === 'blazer' ? 0.020 : top.type === 'vest' ? 0.010 : 0.008) : 0;
      var beltRx = S.torso[1].rx + topOff + 0.0105, beltRz = S.torso[1].rz + topOff + 0.0105;
      var belt = [
        Rig.st(0, j.pelvisY + 0.004 * H, 0, beltRx, beltRz, 'pelvis'),
        Rig.st(0, j.pelvisY + 0.030 * H, 0, beltRx * 0.995, beltRz * 0.995, 'pelvis')
      ];
      meshes.push(clothMesh([Rig.tube(belt, boneIndex, 10, false, false)], boneIndex, mat(0x2a2019, 0.7)));
    }
    // Shoes — Iterasi 2 SNEAKER: a flat white SOLE (its own mesh)
    // that the coloured upper sits INTO. The old single loft
    // followed the skin foot's descending tube and read as a
    // boat: pointed toe sloping down, hull-curved bottom, no
    // ground contact line. Now the sole's bottom runs at y~0
    // along its whole length (heel marginally thicker inside,
    // bottom stays flat), total length ~0.158H (~27.7 cm at
    // H=1.75), and the upper is the skin-foot copy stretched
    // downward (rz x1.35, centre -0.004H) so its lower wall sinks
    // into the sole top and the seam closes. (Upper margins were
    // raised in the second pass — see shoeUpper.)
    var shoeMat = mat(wear.shoes != null ? wear.shoes : 0x2a2c33, 0.55);
    var soleMat = mat(0xf0ede6, 0.6);
    function shoeUpper(legStations, side) {
      // Iterasi 2, second pass: the first upper (+0.005, rz x1.18,
      // centre -0.007H) still let the skin instep streak through
      // the st7->st8 wall — the ruled surface between two tilted
      // rings crosses even when both endpoint rings clear. The
      // fix is decisive margin, not more analysis: +0.007 offset,
      // rz x1.35, centre only -0.004H (tops clear the skin by
      // ~10 mm everywhere; bottoms still sink into the sole top).
      var sts = subStations(legStations, 7, 9, 0.007);
      for (var ui = 0; ui < sts.length; ui++) { sts[ui].p[1] -= 0.004 * H; sts[ui].rz *= 1.35; }
      sts[2].rz *= 1.10; sts[2].rx *= 0.92; sts[2].p[1] += 0.002 * H; // toe box: clear of the skin toe, inside the sole outline
      var toe = sts[2];
      sts.push(Rig.st(toe.p[0], toe.p[1] + 0.001 * H, toe.p[2] + 0.008 * H,
        toe.rx * 0.62, toe.rz * 0.66, 'toe' + side)); // rounded tip, flush with the sole front
      return Rig.tube(sts, boneIndex, 9, false, true);
    }
    function shoeSole(legStations, side) {
      var fx = legStations[7].p[0];
      var sts = [
        Rig.st(fx, 0.0220, -0.012 * H, 0.026 * H, 0.0165, 'foot' + side),
        Rig.st(fx, 0.0160, 0.030 * H, 0.030 * H, 0.0145, 'foot' + side),
        Rig.st(fx, 0.0135, 0.085 * H, 0.035 * H, 0.0140, 'foot' + side, 'toe' + side, 0.35),
        Rig.st(fx, 0.0135, 0.128 * H, 0.033 * H, 0.0140, 'toe' + side),
        Rig.st(fx, 0.0150, 0.146 * H, 0.021 * H, 0.0125, 'toe' + side)
      ];
      return Rig.tube(sts, boneIndex, 9, true, true);
    }
    meshes.push(clothMesh([shoeUpper(S.legL, 'L'), shoeUpper(S.legR, 'R')], boneIndex, shoeMat));
    meshes.push(clothMesh([shoeSole(S.legL, 'L'), shoeSole(S.legR, 'R')], boneIndex, soleMat));
    return meshes;
  }

  // ---- accessories (bone-attached) ------------------------------------------
  function attach(bone, geo, material, x, y, z, rx, ry, rz) {
    var m = new THREE.Mesh(geo, material);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.frustumCulled = false;
    bone.add(m); return m;
  }
  function textPatch(text, fg, bg) {
    var cv = document.createElement('canvas'); cv.width = 128; cv.height = 32;
    var c = cv.getContext('2d');
    c.fillStyle = bg; c.fillRect(0, 0, 128, 32);
    c.fillStyle = fg; c.font = 'bold 21px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, 64, 17);
    var tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(0.105, 0.026),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
  }

  function buildAccessories(char, wear, r) {
    var b = char.bones, p = char.params, u = p.u, H = p.H, acc = wear.accessories || [];
    // HEAD PASS: head size from the rig's head constants; hats sit
    // 1-2 cm LOWER onto the forehead than before (spec).
    var headCY = Rig.headDims(p).cy, headR = Rig.headDims(p).r0;
    function has(name) { return acc.indexOf(name) >= 0; }
    if (wear.hat === 'fedora') {
      attach(b.head, new THREE.CylinderGeometry(headR * 1.28, headR * 1.30, headR * 0.10, 14), clothMat({ color: wear.hatColor || 0xe8e0cc }), 0, headCY + headR * 0.50, 0);
      attach(b.head, new THREE.CylinderGeometry(headR * 0.78, headR * 0.84, headR * 0.62, 14), clothMat({ color: wear.hatColor || 0xe8e0cc }), 0, headCY + headR * 0.80, 0);
    } else if (wear.hat === 'officer') {
      attach(b.head, new THREE.CylinderGeometry(headR * 0.98, headR * 1.0, headR * 0.42, 14), mat(0x1d2f52, 0.6), 0, headCY + headR * 0.68, 0);
      attach(b.head, new THREE.BoxGeometry(headR * 0.95, headR * 0.07, headR * 0.55), darkMat, 0, headCY + headR * 0.50, headR * 0.85);
    } else if (wear.hat === 'helmet') {
      attach(b.head, new THREE.SphereGeometry(headR * 1.10, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(wear.hatColor || 0x22262e, 0.35), 0, headCY + headR * 0.12, 0);
    } else if (wear.hat === 'sunhat') {
      attach(b.head, new THREE.CylinderGeometry(headR * 1.75, headR * 1.85, headR * 0.08, 16), mat(0xe8d9a8, 0.9), 0, headCY + headR * 0.44, 0);
      attach(b.head, new THREE.SphereGeometry(headR * 0.85, 12, 8), mat(0xe8d9a8, 0.9), 0, headCY + headR * 0.44, 0);
    } else if (wear.hat === 'ojekhelmet') {
      attach(b.head, new THREE.SphereGeometry(headR * 1.12, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), mat(0xcc3322, 0.3), 0, headCY + headR * 0.10, 0);
    }
    // Stage C fix (parent review of c-story2 / c-story3): the
    // Iterasi 2 lenses were still flat BOXES — on Mami they read
    // as two dark censor bars over the eyes, on Varga as two big
    // black rectangles. Eyewear is now built as eyewear: domed
    // OVAL lenses centred on the MEASURED eye position (eyes are
    // drawn at canvas x = 64+-12 in 256-space; the sphere's face
    // centre is u=0.25, so the eyes sit at phi = pi/2 +- 0.294
    // rad -> bone-local x = +-0.231 headR, surface z ~ 0.86
    // headR, centre y = headCY + 0.083 headR), a thin rim ring
    // around each lens, a bridge, and temple arms angled back
    // to the ears. Regular glasses get a PALE translucent lens
    // (opacity 0.45) so the drawn eyes stay clearly visible
    // through them; sunglasses keep a dark lens, but in the
    // same oval lens shape — never a bar or a box.
    function eyewear(lensMaterial, rimMaterial, lw, lh) {
      var lensGeo = new THREE.SphereGeometry(1, 14, 10);
      lensGeo.scale(headR * lw, headR * lh, headR * 0.05);
      var rimGeo = new THREE.TorusGeometry(1, 0.085, 6, 22);
      rimGeo.scale(headR * lw * 1.03, headR * lh * 1.03, headR * lw);
      var ey = headCY + headR * 0.083;
      [-1, 1].forEach(function (s) {
        attach(b.head, lensGeo, lensMaterial, s * headR * 0.231, ey, headR * 0.868);
        attach(b.head, rimGeo, rimMaterial, s * headR * 0.231, ey, headR * 0.878);
        // temple arm: one straight thin bar from the frame's
        // outer edge (x 0.40, z 0.86) back to the ear (x 0.80,
        // z 0.02); its middle rides inside the head's elliptical
        // bulge (rx ~0.80 headR at eye height) the way real arms
        // disappear into hair — the visible front stub and the
        // ear tip carry the read.
        attach(b.head, new THREE.BoxGeometry(headR * 0.026, headR * 0.030, headR * 0.93),
          rimMaterial, s * headR * 0.60, headCY + headR * 0.10, headR * 0.44, 0, s * 2.697, 0);
      });
      attach(b.head, new THREE.BoxGeometry(headR * 0.15, headR * 0.032, headR * 0.028),
        rimMaterial, 0, headCY + headR * 0.118, headR * 0.878);
    }
    if (has('glasses')) {
      eyewear(new THREE.MeshStandardMaterial({ color: 0xcfe0e8, roughness: 0.12, transparent: true, opacity: 0.45 }),
        mat(0x3a2a1a, 0.4), 0.165, 0.125);
    }
    if (has('sunglasses')) {
      eyewear(mat(0x0c0e11, 0.22), mat(0x14161a, 0.35), 0.185, 0.145);
    }
    // Stage C fix: chest-front accessories used z = 0.068-0.075 m
    // constants, but the torso loft's front surface at spine2
    // height sits at rz ~0.13 m — badge, POLISI patch, radio and
    // camera were built INSIDE the chest (proven invisible in the
    // c-patrol-chest / c-varga-chest close-ups). Their z is now
    // computed from the same station radii Rig.bodyStations uses,
    // plus the cloth offset of the worn top.
    var sH = H / 1.75;
    var chestRxC = 0.108 * H * (0.55 + 0.45 * p.shoulder) * (0.7 + 0.3 * p.waist);
    var fY = Math.min(1, 0.045 / (0.045 * H));
    var chestRzC = (0.073 * H * (0.8 + 0.2 * p.waist)) * (1 - fY) + (0.069 * H) * fY;
    var clothOffC = wear.top && (wear.top.type === 'jacket' || wear.top.type === 'blazer') ? 0.020 : 0.008;
    function chestZ(x) { // front surface z of the clothed chest at lateral offset x
      var k = Math.max(0.25, 1 - (x / chestRxC) * (x / chestRxC));
      return chestRzC * Math.sqrt(k) + clothOffC;
    }
    if (has('badge')) {
      // sits left of and below the POLISI patch — at x -0.055 the
      // flat patch plane (z from the chest CENTRE) overlapped the
      // badge on the curved chest (c-varga-chest, first fix round)
      // rotated to the chest surface normal at that offset — flat
      // against the world z axis it read as an edge-on gold sliver
      attach(b.spine2, new THREE.BoxGeometry(0.020, 0.026, 0.006), mat(0xd8b84a, 0.35), -0.075 * sH, 0.010, chestZ(-0.075 * sH) + 0.002, 0, 0.30, 0);
    }
    if (has('policePatch')) {
      var patch = textPatch('POLISI', '#f2f4f8', '#1d2f52');
      patch.position.set(0, 0.045, chestZ(0) + 0.004); b.spine2.add(patch);
      var patch2 = textPatch('POLISI', '#f2f4f8', '#1d2f52');
      patch2.position.set(0, 0.045, -(chestZ(0) + 0.004)); patch2.rotation.y = Math.PI; b.spine2.add(patch2);
    }
    if (has('radio')) {
      // chest-strap shoulder mic on the upper-left chest (the old
      // over-shoulder spot drowned in the trapezius slope; only its
      // antenna ever showed)
      var radioZ = chestZ(-0.098 * sH) * 0.97 + 0.006;
      attach(b.spine2, new THREE.BoxGeometry(0.022, 0.052, 0.016), darkMat, -0.098 * sH, 0.062, radioZ);
      attach(b.spine2, new THREE.CylinderGeometry(0.0022, 0.0022, 0.07, 5), darkMat, -0.098 * sH, 0.117, radioZ);
    }
    if (has('bag')) {
      attach(b.pelvis, new THREE.BoxGeometry(0.085, 0.105, 0.045), clothMat({ color: pick(r, [0xb8563a, 0x3a6ab8, 0x58a84a, 0xd8b13c]) }), 0.105 * H / 1.75, -0.01, -0.02, 0, 0, 0.12);
    }
    if (has('backpack')) {
      attach(b.spine2, new THREE.BoxGeometry(0.115, 0.15, 0.06), clothMat({ color: pick(r, [0xd84a3a, 0x3a7ad8, 0xf2b13c, 0x4ab86a]) }), 0, 0.01, -0.085 * H / 1.75);
    }
    if (has('camera')) {
      // same buried-z bug as the patch: hang the camera on the
      // chest surface (station-5 depth + cloth), not inside it
      attach(b.spine2, new THREE.BoxGeometry(0.052, 0.036, 0.026), darkMat, 0, -0.01, 0.073 * H * (0.8 + 0.2 * p.waist) + clothOffC + 0.010);
    }
    if (has('cane')) {
      attach(b.handR, new THREE.CylinderGeometry(0.006, 0.006, 0.78, 6), mat(0x6e4a26, 0.7), 0.01, -0.42, 0.02);
    }
    if (has('phone')) {
      attach(b.handL, new THREE.BoxGeometry(0.034, 0.062, 0.006), darkMat, 0, -0.055, 0.018, -0.5, 0, 0);
    }
    if (has('cigar')) {
      attach(b.handR, new THREE.CylinderGeometry(0.006, 0.007, 0.055, 6), mat(0x7a4a22, 0.8), 0, -0.045, 0.02, 1.2, 0, 0);
    }
    if (has('pistol')) {
      var pg = Rig.mergePlain([
        Rig.prim(new THREE.BoxGeometry(0.026, 0.045, 0.030), 0, -0.028, 0.004, 1, 1, 1, 0),
        Rig.prim(new THREE.BoxGeometry(0.020, 0.024, 0.115), 0, 0.004, 0.045, 1, 1, 1, 0)]);
      // Stage D iteration 3: a gripped barrel follows the hand's -Y
      // (the finger line). Built along +Z it pointed at the sky
      // whenever the arm raised to aim (hand frame pitches with the
      // arm); rotated +90 deg X it tracks the aim line and hangs
      // naturally when the arm is down.
      var pm = attach(b.handR, pg, darkMat, 0, -0.052, 0.012);
      pm.rotation.x = Math.PI / 2;
    }
    if (has('rifle')) {
      var barrelGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6);
      barrelGeo.rotateX(Math.PI / 2); // cylinder axis Y -> Z (barrel line)
      var rg = Rig.mergePlain([
        Rig.prim(new THREE.BoxGeometry(0.030, 0.055, 0.34), 0, -0.01, 0.10, 1, 1, 1, 0),
        Rig.prim(barrelGeo, 0, 0.012, 0.33, 1, 1, 1, 0),
        Rig.prim(new THREE.BoxGeometry(0.024, 0.075, 0.035), 0, -0.055, 0.10, 1, 1, 1, 0)]);
      var rm = attach(b.handR, rg, darkMat, 0, -0.05, 0.03);
      rm.rotation.x = Math.PI / 2; // barrel onto the hand's -Y aim line
    }
    if (has('mask')) {
      attach(b.head, new THREE.SphereGeometry(headR * 1.04, 12, 10), mat(0x181818, 0.85), 0, headCY, -headR * 0.03);
    }
    // ---- Stage C accessories --------------------------------------
    if (has('tie')) {
      // detective: knot + blade lying on the shirt front (z measured
      // to the chest surface at that height, cloth included)
      attach(b.spine2, new THREE.BoxGeometry(0.030, 0.034, 0.012), mat(0x6e1f2a, 0.7), 0, 0.028, 0.127 * H / 1.75);
      attach(b.spine2, new THREE.BoxGeometry(0.034, 0.17, 0.010), mat(0x6e1f2a, 0.7), 0, -0.055, 0.128 * H / 1.75, 0.06, 0, 0);
    }
    if (has('beltBadge')) {
      // detective's badge rides the BELT line, not the chest
      attach(b.pelvis, new THREE.BoxGeometry(0.026, 0.032, 0.008), mat(0xd8b84a, 0.35), 0.078 * H / 1.75, -0.005, 0.140 * H / 1.75);
    }
    if (has('visor')) {
      // SWAT: one dark curved band across the eyes (cylinder segment
      // centred on +Z, theta 0 = front in three.js cylinder space)
      var visorGeo = new THREE.CylinderGeometry(headR * 1.07, headR * 1.07, headR * 0.36, 12, 1, true, -0.62, 1.24);
      attach(b.head, visorGeo, mat(0x0b0d10, 0.22), 0, headCY + headR * 0.10, 0);
    }
    if (has('neckTattoo')) {
      // Dario — Stage C fix (parent review of c-story4): the old
      // ink was two thin vertical BOXES (0.020H wide) pinned to
      // the neck sides; they read as straps, not a tattoo. Now
      // ONE wide blue-black patch that HUGS the neck: an open
      // cylinder segment (r 0.030H — the neck surface runs
      // 0.027-0.032H across this band) wrapping the character's
      // left side from front to back (cylinder theta: x = r sin,
      // z = r cos, so theta 0.45..2.65 covers front-left through
      // the side to back-left), sitting just above the blazer
      // collar line.
      var inkGeo = new THREE.CylinderGeometry(0.030 * H, 0.030 * H, 0.025 * H, 12, 1, true, 0.45, 2.2);
      attach(b.neck, inkGeo, mat(0x18303e, 0.75), 0, 0.014 * H, 0);
    }
    if (has('armTattoo')) {
      // syndicate / preman: an ink band around the right FOREARM
      // (the upper arm hides under sleeves; the forearm never does)
      attach(b.fArmR, new THREE.CylinderGeometry(0.028 * H, 0.028 * H, 0.05 * H, 10, 1, true), mat(0x1d2b33, 0.7), 0, -0.045 * H, 0);
    }
    if (has('guitar')) {
      // street musician: round body + neck, slung across the torso
      var gBody = new THREE.CylinderGeometry(0.102, 0.102, 0.046, 14); gBody.rotateX(Math.PI / 2);
      var gNeck = new THREE.BoxGeometry(0.026, 0.30, 0.016); gNeck.translate(0.10, 0.16, 0);
      var gtr = attach(b.spine2, Rig.mergePlain([Rig.prim(gBody, 0, 0, 0, 1, 1, 1, 0), Rig.prim(gNeck, 0, 0, 0, 1, 1, 1, 0)]),
        mat(0x8a5a2c, 0.6), 0.09 * H / 1.75, -0.05, 0.135 * H / 1.75);
      gtr.rotation.set(0.15, 0.1, -0.55);
    }
    if (has('jewelry')) {
      attach(b.neck, new THREE.TorusGeometry(0.058 * H / 1.75, 0.0045, 6, 18), mat(0xe8c85a, 0.3), 0, 0.012, 0.012, 1.25, 0, 0); // round 10: ring widened for the thicker neck
    }
  }

  // ---- LOD2 silhouette --------------------------------------------------------
  var farGeo = null, farMesh = null, FAR_CAP = 64;
  function buildFar() {
    // Stage D iteration 1: the old r 0.16/0.20 cylinder read as a thin
    // bollard at 45 m. A capsule of r 0.235 spans a person's shoulder
    // width; total stays under the 200-tri LOD2 budget.
    var body = new THREE.CapsuleGeometry(0.225, 1.06, 3, 8);
    body.translate(0, 0.78, 0);
    var head = new THREE.SphereGeometry(0.135, 7, 5); head.translate(0, 1.70, 0);
    farGeo = Rig.mergePlain([body.index ? body.toNonIndexed() : body, head.index ? head.toNonIndexed() : head]);
    farMesh = new THREE.InstancedMesh(farGeo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), FAR_CAP);
    farMesh.frustumCulled = false; farMesh.count = 0;
    farMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  // ---- the factory -------------------------------------------------------------
  var active = [], pool = {};
  var dummy = null;

  function resolveWear(arch, r) {
    var w = arch.wear || {};
    function spec(s) {
      if (!s) return s;
      var out = {}; for (var k in s) out[k] = s[k];
      if (out.colors) out.color = pick(r, out.colors);
      if (out.colors2) out.color2 = pick(r, out.colors2);
      return out;
    }
    return {
      top: spec(w.top), bottom: spec(w.bottom),
      shoes: w.shoes != null ? (Array.isArray(w.shoes) ? pick(r, w.shoes) : w.shoes) : null,
      hat: w.hat || null, hatColor: w.hatColor,
      accessories: w.accessories || []
    };
  }

  function create(archOrId, seed) {
    var arch = typeof archOrId === 'string' ? (SH.Archetypes && SH.Archetypes[archOrId]) : archOrId;
    if (!arch) throw new Error('CharFactory: unknown archetype ' + archOrId);
    seed = seed == null ? 1 : seed;
    var key = (arch.id || 'custom') + '|' + seed;
    if (pool[key] && !pool[key].inUse) { pool[key].inUse = true; return pool[key]; }
    var r = rng(seed * 7919 + 17);
    var bp = arch.body || {};
    var p = Rig.baseParams({
      H: bp.H || (arch.heightRange ? arch.heightRange[0] + r() * (arch.heightRange[1] - arch.heightRange[0]) : 1.75),
      legFrac: bp.legFrac, shoulder: bp.shoulder, waist: bp.waist, hips: bp.hips,
      belly: bp.belly, thigh: bp.thigh, headScale: bp.headScale, handScale: bp.handScale || 1.02, neckR: bp.neckR
    });
    var skinHex = bp.skin != null ? SKIN_TONES[bp.skin % 8] : pick(r, SKIN_TONES);
    var skinRGB = rgb(skinHex);
    var sk = Rig.buildSkeleton(p);
    var group = new THREE.Group();
    group.add(sk.root);
    function bind(mesh) { mesh.bind(sk.skeleton); group.add(mesh); return mesh; }
    // LOD0
    var body0 = new THREE.SkinnedMesh(Rig.buildBody(p, sk.index, skinRGB, true), bodyMat);
    body0.frustumCulled = false; bind(body0);
    // hair resolves BEFORE the head material: the drawn brows in
    // the face texture take the hair colour (round 2)
    var hairStyle = (arch.hair && arch.hair.style) || 'short';
    if (arch.hair && arch.hair.styles) hairStyle = pick(r, arch.hair.styles);
    // Stage C fix: an archetype may pin a hair COLOUR SET
    // (hair.colors) — fixed-role types (police) use it to stay
    // black / dark brown and never roll the greys in HAIR_COLORS.
    var hairColor = (arch.hair && arch.hair.color) ||
      ((arch.hair && arch.hair.colors) ? pick(r, arch.hair.colors) : pick(r, HAIR_COLORS));
    var faceSpec = Object.assign({ eyes: 'round', mouth: 'smile' }, arch.face || {});
    if (faceSpec.randomEyes) faceSpec.eyes = pick(r, ['round', 'narrow', 'sleepy']);
    faceSpec.browColor = hairColor;
    var headMat = new THREE.MeshStandardMaterial({ map: faceTexture(faceSpec, skinHex), roughness: 0.55 });
    var head0 = new THREE.SkinnedMesh(Rig.buildHead(p, sk.index), headMat);
    head0.frustumCulled = false; bind(head0);
    var wear = resolveWear(arch, r);
    var clothes0 = buildClothes(p, sk.index, wear, skinRGB);
    for (var i = 0; i < clothes0.length; i++) { clothes0[i].bind(sk.skeleton); group.add(clothes0[i]); }
    var char = { group: group, bones: sk.bones, skeleton: sk.skeleton, params: p, archetype: arch, seed: seed, wear: wear, inUse: true, lod: 0, key: key };
    var hairGeo = Rig.hairGeometry(hairStyle, p);
    if (hairGeo) {
      var hairMesh = new THREE.Mesh(hairGeo, hairStyle === 'hijab' ? clothMat({ color: (arch.hair && arch.hair.clothColors) ? pick(r, arch.hair.clothColors) : (arch.hair && arch.hair.clothColor) || 0x7a4a8a }) : hairMat(hairColor));
      hairMesh.frustumCulled = false; sk.bones.head.add(hairMesh); char.hairMesh = hairMesh;
    }
    // HEAD PASS: swinging hair parts (ponytail / long back strips)
    // on the head bone. (Round 2: no more 3D face gear — the face
    // is drawn in the head texture.)
    var swing = Rig.hairSwing(hairStyle, p);
    if (swing) {
      var swGrp = new THREE.Group();
      swGrp.position.set(swing.pivot[0], swing.pivot[1], swing.pivot[2]);
      var swMesh = new THREE.Mesh(swing.geo, hairMat(hairColor));
      swMesh.frustumCulled = false;
      swGrp.add(swMesh);
      sk.bones.head.add(swGrp);
      char.hairSwingGroup = swGrp;
      char.swing = { t: 0, vel: 0, ang: 0, speed: 0, lastPos: null };
    }
    buildAccessories(char, wear, r);
    // LOD1: no fingers, no small accessories (hair + clothes stay)
    var body1 = new THREE.SkinnedMesh(Rig.buildBody(p, sk.index, skinRGB, false, true), bodyMat);
    body1.frustumCulled = false; body1.bind(sk.skeleton); body1.visible = false; group.add(body1);
    // LOD1 head: plain skin material, NO face texture — the spec
    // drops face detail at 15-40 m (Stage D iteration 1).
    var head1 = new THREE.SkinnedMesh(Rig.buildHead(p, sk.index),
      new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.55 }));
    head1.frustumCulled = false; head1.bind(sk.skeleton); head1.visible = false; group.add(head1);
    var clothes1 = buildClothes(p, sk.index, wear, skinRGB);
    for (var q = 0; q < clothes1.length; q++) { clothes1[q].bind(sk.skeleton); clothes1[q].visible = false; group.add(clothes1[q]); }
    char.parts = { body0: body0, head0: head0, clothes0: clothes0, body1: body1, head1: head1, clothes1: clothes1 };
    char.farColor = new THREE.Color(wear.top && wear.top.color || 0x888888);
    char.setLOD = function (level) {
      if (char.lod === level) return; char.lod = level;
      var P = char.parts;
      P.body0.visible = P.head0.visible = level === 0;
      for (var a = 0; a < P.clothes0.length; a++) P.clothes0[a].visible = level === 0;
      P.body1.visible = P.head1.visible = level === 1;
      for (var b = 0; b < P.clothes1.length; b++) P.clothes1[b].visible = level === 1;
      char.group.visible = level < 2;
      // accessories hang on bones; visibility is level-aware:
      setDecoVisible(char, level);
    };
    pool[key] = char; active.push(char);
    return char;
  }

  // Accessories/hair are bone children; toggling them per LOD walks the
  // bone subtrees once per switch (cheap, switches are rare).
  // Stage D iteration 1: LOD1 must keep the SILHOUETTE gear — hair,
  // swing parts and every head-bone deco (hats, helmets, glasses,
  // visors) — the spec only drops fingers + face detail at 15-40 m.
  // Small body deco (badges, radios, jewellery, ink, hand props)
  // is LOD0-only. LOD2 hides the whole group anyway.
  function setDecoVisible(char, level) {
    var headGear = level <= 1, bodyDeco = level === 0;
    var names = ['head', 'spine2', 'pelvis', 'neck', 'handL', 'handR'];
    for (var i = 0; i < names.length; i++) {
      var bone = char.bones[names[i]]; if (!bone) continue;
      var vis = names[i] === 'head' ? headGear : bodyDeco;
      for (var q = 0; q < bone.children.length; q++) {
        var ch = bone.children[q];
        if (ch.isMesh) ch.visible = vis;
      }
    }
    if (char.hairMesh) char.hairMesh.visible = headGear;
    if (char.hairSwingGroup) char.hairSwingGroup.visible = headGear;
  }

  var tmpM = null, tmpQ = null, tmpS = null, tmpP = null, lastUpdT = 0;
  function update(camera, scene) {
    if (!farMesh && scene) { buildFar(); scene.add(farMesh); }
    if (!tmpM) { tmpM = new THREE.Matrix4(); tmpQ = new THREE.Quaternion(); tmpS = new THREE.Vector3(); tmpP = new THREE.Vector3(); }
    var nowT = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    var dt = Math.min(0.05, Math.max(0.001, (nowT - lastUpdT) / 1000 || 0.016));
    lastUpdT = nowT;
    var farCount = 0;
    for (var i = 0; i < active.length; i++) {
      var ch = active[i];
      if (!ch.inUse || !ch.group.parent) continue;
      // HEAD PASS: hair swing — a damped sin spring driven by the
      // character's world speed (ponytail / long back panel sway
      // when running, settle when standing).
      if (ch.swing && ch.hairSwingGroup && ch.lod === 0) {
        var sw = ch.swing;
        ch.hairSwingGroup.getWorldPosition(tmpP);
        if (sw.lastPos) {
          var spd = tmpP.distanceTo(sw.lastPos) / dt;
          sw.speed += (Math.min(spd, 6) - sw.speed) * 0.2;
        } else sw.lastPos = new THREE.Vector3();
        sw.lastPos.copy(tmpP);
        sw.t += dt;
        var drive = Math.min(1, sw.speed / 2.2);
        var target = Math.sin(sw.t * (6 + sw.speed * 2.4)) * 0.15 * drive - drive * 0.10;
        sw.vel += ((target - sw.ang) * 90 - sw.vel * 11) * dt;
        sw.ang += sw.vel * dt;
        ch.hairSwingGroup.rotation.x = sw.ang;
      }
      var d = camera.position.distanceTo(ch.group.position);
      var level = d < 15 ? 0 : d < 40 ? 1 : 2;
      if (level === 2) {
        if (ch.lod !== 2) ch.setLOD(2);
        ch.group.updateMatrixWorld();
        tmpM.copy(ch.group.matrixWorld);
        var sc = ch.params.H / 1.75; tmpM.scale(tmpS.set(sc, sc, sc));
        farMesh.setMatrixAt(farCount, tmpM);
        farMesh.setColorAt(farCount, ch.farColor);
        farCount++;
      } else if (ch.lod !== level) ch.setLOD(level);
    }
    if (farMesh) {
      farMesh.count = farCount;
      farMesh.instanceMatrix.needsUpdate = true;
      if (farMesh.instanceColor) farMesh.instanceColor.needsUpdate = true;
    }
  }

  function release(char) {
    char.inUse = false;
    if (char.group.parent) char.group.parent.remove(char.group);
  }

  function triCount(char) {
    var total = 0;
    char.group.traverse(function (o) {
      if (o.isMesh && o.geometry) total += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    });
    return Math.round(total);
  }

  SH.CharFactory = {
    create: create, update: update, release: release, triCount: triCount,
    SKIN_TONES: SKIN_TONES, HAIR_COLORS: HAIR_COLORS, rng: rng, active: active
  };
})(window.SH = window.SH || {});
