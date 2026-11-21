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
  // APPEAL PASS: hair is never flat pure black — blue-black and
  // warm dark browns lead the list (two-tone shading is baked per
  // vertex on top of these bases, see paintHair); greys stay at
  // the end for elderly seeds.
  var HAIR_COLORS = [0x1b1e28, 0x2b1d12, 0x3a2415, 0x54331b, 0x77572c, 0x9a7d52, 0xb8b0a4, 0xd8d3c8];

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
  // FX2 SHADING UPGRADE (user spec, supersedes the Appeal toon lock):
  // characters now shade with MeshStandardMaterial — flatShading
  // FALSE, roughness 0.8, metalness 0 — so light rolls smoothly
  // across the body instead of snapping through the old 4-step toon
  // ramp (the flat chalk "crayon" fill). Everything stylized is
  // KEPT: the Appeal face/expression textures, the baked vertex AO,
  // the two-tone hair paint, the warm rim shells and the outline.
  // All character materials are vertexColors:true — every geometry
  // that reaches them carries a colour attribute (body/cloth are
  // painted per ring with fake AO; hair is painted two-tone; plain
  // accessories get a white fill in attach()).
  // RETIRED by FX2: the 4-step toon gradient ramp. Kept defined so
  // any stale reference fails loud instead of silently; no material
  // samples it anymore (see the FX2 shading note above).
  var RAMP = (function () {
    var steps = [118, 168, 216, 255], data = new Uint8Array(steps.length * 4);
    for (var i = 0; i < steps.length; i++) {
      data[i * 4] = steps[i]; data[i * 4 + 1] = steps[i]; data[i * 4 + 2] = steps[i]; data[i * 4 + 3] = 255;
    }
    var t = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  })();
  var matCache = {};
  // FX PARITY (round 1, kept): character materials opt OUT of the
  // game's post grade — the game renderer runs ACES tone mapping
  // (the lab runs none) and scene fog exists only in the game.
  // toneMapped:false + fog:false keep the shared factory shading
  // consistent between lab and game. FX2 added envMapIntensity
  // 0.35 on standard materials: the game's PMREM sky may kiss the
  // characters with a whisper of environment light, never the old
  // full-strength wash (the lab has no environment; the flag is a
  // no-op there). PREMIUM PASS raised it to 0.6 on measured A/B:
  // at the pants close-up, 0.35->0.6 moves 47.9% of region pixels
  // with mean |delta| 4.5 and ZERO pixels beyond delta 30 (no
  // specular sparkle of the ronde-3 class), while 0.85 produced
  // 5,249 pixels beyond 30 (max 38) and was rejected.
  function charGrade(m) { m.toneMapped = false; m.fog = false; if ('envMapIntensity' in m) m.envMapIntensity = 0.6; return m; }
  function mat(color, rough, opts) {
    var key = color + '|' + (opts && opts.key || '');
    if (matCache[key]) return matCache[key];
    var m = new THREE.MeshStandardMaterial({ color: color, roughness: (rough != null ? rough : 0.8), metalness: 0, flatShading: false, vertexColors: true, side: THREE.DoubleSide });
    charGrade(m);
    matCache[key] = m; return m;
  }
  var bodyMat = charGrade(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, flatShading: false }));
  var darkMat = mat(0x14161c, 0.5);
  // COMBAT V7.1: the pistol's own material — bright steel, NOT the
  // near-black darkMat. At photo distance the dark gun merged with
  // the dark wristband and the hand holding it; a light metal tone
  // is what separates the silhouette (see attachPistolTo).
  var gunMat = mat(0xb9c1cc, 0.42);

  // ---- PREMIUM PASS: procedural fabric micro-textures ------------------
  // After FX2/FX3 the shading is clean, but garments still read as
  // plain plastic action-figure shells: a perfectly uniform
  // roughness lets light sheet across cloth like vinyl. Real fabric
  // breaks reflections at THREAD scale. These two shared
  // CanvasTextures are generated ONCE from a deterministic integer
  // hash (lab and game build identical maps; no assets, no network,
  // no geometry added):
  //   fabricRoughTex  — grayscale weave: thread crowns and valleys
  //     sit at different roughness, so highlights vary per thread
  //     instead of rolling flat across the chest.
  //   fabricNormalTex — the same weave height field converted to a
  //     tangent-space normal map (Sobel), low strength: the surface
  //     gains a woven hand under raking light.
  // They hang on every patternMat material (tops, bottoms, skirts,
  // hijab cloth) with their OWN repeat — the printed/detail map
  // keeps its 1x transform (per-texture transforms, three r159).
  // Weave pitch: 4 px period on a 256 canvas, repeated 9x6 over
  // the loft UV — ~1.3 mm per thread around the chest: invisible
  // as a pattern at gameplay distance, present as micro-variation
  // in close-up. Mipmaps average it out with distance.
  var fabricRoughTex = null, fabricNormalTex = null;
  function fabricMaps() {
    if (fabricRoughTex) return;
    var S = 256, PER = 4;
    function hash2(x, y) {
      var h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }
    // Plain-weave height field: alternating over/under threads; the
    // exposed thread bulges (sine profile) and carries a per-thread
    // fibre streak, so no two threads are identical.
    var H = new Float32Array(S * S), x, y, i;
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
      var cx = Math.floor(x / PER), cy = Math.floor(y / PER);
      var fx = (x - cx * PER) / PER, fy = (y - cy * PER) / PER;
      var over = ((cx + cy) & 1) === 0;
      var prof = over ? Math.sin(fx * Math.PI) : Math.sin(fy * Math.PI);
      var streak = over ? hash2(cx * 7 + 1, Math.floor(y / 2)) : hash2(Math.floor(x / 2), cy * 7 + 3);
      H[y * S + x] = prof * 0.80 + streak * 0.14 + (hash2(x, y) - 0.5) * 0.10;
    }
    // Roughness: valleys grip light (rougher), crowns a touch
    // smoother; centre ~0.77 — patternMat sets material roughness
    // to 1.0 so this map carries the value (was a flat 0.8).
    var rc = document.createElement('canvas'); rc.width = rc.height = S;
    var rctx = rc.getContext('2d'), rimg = rctx.createImageData(S, S);
    for (i = 0; i < S * S; i++) {
      var rv = 201 + (0.5 - H[i]) * 52 + (hash2(i % S, Math.floor(i / S)) - 0.5) * 14;
      rv = Math.max(158, Math.min(242, Math.round(rv)));
      rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = rv; rimg.data[i * 4 + 3] = 255;
    }
    rctx.putImageData(rimg, 0, 0);
    fabricRoughTex = new THREE.CanvasTexture(rc);
    // Normal map: Sobel gradient of the same height field,
    // wrap-sampled so the tile stays seamless.
    var nc = document.createElement('canvas'); nc.width = nc.height = S;
    var nctx = nc.getContext('2d'), nimg = nctx.createImageData(S, S);
    function hAt(x2, y2) { return H[((y2 + S) % S) * S + ((x2 + S) % S)]; }
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
      var tl = hAt(x - 1, y - 1), tm = hAt(x, y - 1), tr = hAt(x + 1, y - 1);
      var ml = hAt(x - 1, y), mr = hAt(x + 1, y);
      var bl = hAt(x - 1, y + 1), bm = hAt(x, y + 1), br = hAt(x + 1, y + 1);
      var gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
      var gy = (bl + 2 * bm + br) - (tl + 2 * tm + tr);
      var nx = gx * 1.35, ny = -gy * 1.35, nz = 1;
      var il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      var o = (y * S + x) * 4;
      nimg.data[o] = Math.round((nx * il * 0.5 + 0.5) * 255);
      nimg.data[o + 1] = Math.round((ny * il * 0.5 + 0.5) * 255);
      nimg.data[o + 2] = Math.round((nz * il * 0.5 + 0.5) * 255);
      nimg.data[o + 3] = 255;
    }
    nctx.putImageData(nimg, 0, 0);
    fabricNormalTex = new THREE.CanvasTexture(nc);
    [fabricRoughTex, fabricNormalTex].forEach(function (t) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(9, 6);
      t.anisotropy = 8;
    });
  }

  // FX6: fine fibre-noise normal map for hair, generated ONCE
  // with the same deterministic-hash canvas technique as
  // fabricMaps() — anisotropic streaks stretched along v, so
  // light breaks like strands instead of one plastic cap. The
  // shells carry real uvs since FX6 (rig.hairShell); panels and
  // prim pieces always did.
  var hairNoiseTex = null;
  function hairMaps() {
    if (hairNoiseTex) return;
    function hash2(x, y) {
      var h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }
    var S = 256, x, y, i;
    var H = new Float32Array(S * S);
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
      H[y * S + x] = 0.55 * hash2(x >> 1, y) + 0.45 * hash2(x, y >> 2);
    }
    var nc = document.createElement('canvas'); nc.width = nc.height = S;
    var nctx = nc.getContext('2d'), nimg = nctx.createImageData(S, S), nd = nimg.data;
    function hAt(x2, y2) { return H[((y2 + S) % S) * S + ((x2 + S) % S)]; }
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
      var gx = (hAt(x - 1, y) - hAt(x + 1, y)) * 1.1;
      var gy = (hAt(x, y - 1) - hAt(x, y + 1)) * 1.1;
      var inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      i = (y * S + x) * 4;
      nd[i] = (-gx * inv * 0.5 + 0.5) * 255; nd[i + 1] = (-gy * inv * 0.5 + 0.5) * 255;
      nd[i + 2] = inv * 255; nd[i + 3] = 255;
    }
    nctx.putImageData(nimg, 0, 0);
    hairNoiseTex = new THREE.CanvasTexture(nc);
    hairNoiseTex.wrapS = hairNoiseTex.wrapT = THREE.RepeatWrapping;
    hairNoiseTex.repeat.set(3, 2); hairNoiseTex.anisotropy = 4;
  }
  hairMaps();
  // APPEAL PASS hair: ONE shared toon material; the colour lives in
  // the vertices (base tone + a lighter curved band over the crown
  // baked by paintHair) — the band IS the soft highlight the style
  // lock asks for, never a metal/plastic specular streak.
  // FX6: roughness 0.9 (spec) + the fibre normal map above.
  var hairMatShared = charGrade(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: false, side: THREE.DoubleSide, normalMap: hairNoiseTex, normalScale: new THREE.Vector2(0.55, 0.55) }));
  // HEAD PASS round 2: buildFaceGear + the eye/iris materials are
  // REMOVED with rig.faceGear — the face is texture-drawn now
  // (simplify clause; see faceTexture below).

  var patternCache = {};
  function patternMat(kind, c1, c2) {
    var key = kind + '|' + c1 + '|' + c2;
    if (patternCache[key]) return patternCache[key];
    var cv = document.createElement('canvas'); cv.width = cv.height = (kind === 'cloth') ? 256 : 128;
    var c = cv.getContext('2d');
    c.fillStyle = css(c1); c.fillRect(0, 0, cv.width, cv.height);
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
    } else if (kind === 'cloth') {
      // AP2 polish (user order): the Appeal painter is redrawn at
      // 256px with anisotropy — details were blurry because a 128px
      // canvas wraps a ~1 m tube. The deterministic MOTTLE is
      // REMOVED entirely (it read as dark blotches/dirt on chests)
      // and the old stroke-only pocket (a floating weird box) is
      // replaced by a filled pocket with a flap and a stitched
      // border. Shapes are drawn NARROWER than target on purpose:
      // the tube circumference (~1.0 m) vs garment height (~0.55 m)
      // stretches u by ~1.5x, so pre-compensated shapes land at
      // consistent real-world sizes. c2 = detail flag: 1 adds the
      // button column + chest pocket (jackets/blazers). Loft UVs:
      // u wraps the tube (front centre at u 0.75 -> x 192), canvas
      // top = v 1 = collar end.
      var S = 256;
      var grd = c.createLinearGradient(0, S, 0, 0);
      grd.addColorStop(0, 'rgba(0,0,0,0.10)'); grd.addColorStop(0.10, 'rgba(0,0,0,0)');
      grd.addColorStop(0.55, 'rgba(255,255,255,0.05)'); grd.addColorStop(0.85, 'rgba(255,255,255,0)');
      grd.addColorStop(0.97, 'rgba(0,0,0,0.08)'); grd.addColorStop(1, 'rgba(0,0,0,0.10)');
      c.fillStyle = grd; c.fillRect(0, 0, S, S);
      // OVERHAUL color-blocking (panel rounds 9-12: clothes read
      // as one flat tone at photo distance). Two additions, both
      // derived from the garment's own colour so every archetype
      // keeps its identity:
      // (1) CYLINDRICAL shading along u — the loft is a tube, so a
      // fixed light wrap is painted in: bright at the front centre
      // (u 0.75 -> x 192), falling off at the sides (x 0/128) and
      // the back (x 64). Under the game's flat hemisphere wash
      // this is what keeps a torso reading ROUND instead of a
      // coloured board; on sleeves and pant legs the same wrap
      // reads as the limb's own shading.
      var ug = c.createLinearGradient(0, 0, S, 0);
      ug.addColorStop(0, 'rgba(0,0,0,0.13)');
      ug.addColorStop(0.25, 'rgba(0,0,0,0.05)');
      ug.addColorStop(0.5, 'rgba(0,0,0,0.11)');
      ug.addColorStop(0.75, 'rgba(255,255,255,0.085)');
      ug.addColorStop(1, 'rgba(0,0,0,0.13)');
      c.fillStyle = ug; c.fillRect(0, 0, S, S);
      // (2) A two-tone YOKE band across the upper chest (canvas
      // y 44-78, just under the collar trim) in a deepened shade
      // of the base, closed by a pale accent rule — the classic
      // colour-block a real shirt has and a flat texture lacks.
      // On sleeves/pant legs the same band lands as a cuff/stripe
      // detail, which reads as trim, not error.
      c.fillStyle = 'rgba(0,0,0,0.17)';
      c.fillRect(0, 44, S, 34);
      c.fillStyle = 'rgba(255,255,255,0.13)';
      c.fillRect(0, 79, S, 3.5);
      c.fillStyle = 'rgba(0,0,0,0.15)';
      for (j = 0; j < S; j += 16) { c.fillRect(5, j, 2.5, 8); c.fillRect(S - 8, j, 2.5, 8); } // seam stitch dashes
      if (c2 === 1) {
        // button column: 4 identical buttons, even spacing
        [86, 114, 142, 170].forEach(function (by) {
          c.fillStyle = 'rgba(22,14,9,0.55)';
          c.beginPath(); c.ellipse(192, by, 3.0, 4.6, 0, 0, 7); c.fill();
          c.fillStyle = 'rgba(255,255,255,0.28)';
          c.beginPath(); c.ellipse(192, by - 1.8, 1.4, 1.6, 0, 0, 7); c.fill();
        });
        // chest pocket (wearer's left): filled body + flap band +
        // dashed stitch border, one consistent size
        c.fillStyle = 'rgba(0,0,0,0.13)'; c.fillRect(209, 82, 17, 32);
        c.fillStyle = 'rgba(0,0,0,0.20)'; c.fillRect(209, 82, 17, 8);
        c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = 1.4; c.setLineDash([4, 3]);
        c.strokeRect(210.5, 83.5, 14, 29); c.setLineDash([]);
      }
    }
    // CHARPOLISH trim (cloth + hawaii — the two lofted torso
    // fabrics): a defined band + stitch line at BOTH v ends of
    // the loft UV. v=1 (canvas top) is the collar ring on the
    // torso AND the hem ring on sleeves and pants legs, so one
    // band reads as collar + cuff + ankle hem at once; v=0 is
    // the shirt hem / waistband line. The old gradient-only ends
    // read as shading; a band + stitch reads as TRIM.
    if (kind === 'cloth' || kind === 'hawaii') {
      var th = cv.height / 256;
      c.fillStyle = 'rgba(0,0,0,0.15)';
      c.fillRect(0, 0, cv.width, 11 * th); c.fillRect(0, cv.height - 11 * th, cv.width, 11 * th);
      c.fillStyle = 'rgba(255,255,255,0.10)';
      c.fillRect(0, 0, cv.width, 2 * th); c.fillRect(0, cv.height - 2 * th, cv.width, 2 * th);
      c.strokeStyle = 'rgba(255,255,255,0.20)'; c.lineWidth = 1.3 * th; c.setLineDash([5 * th, 4 * th]);
      c.beginPath();
      c.moveTo(0, 13.5 * th); c.lineTo(cv.width, 13.5 * th);
      c.moveTo(0, cv.height - 13.5 * th); c.lineTo(cv.width, cv.height - 13.5 * th);
      c.stroke(); c.setLineDash([]);
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 8;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
    var m = charGrade(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, metalness: 0, flatShading: false, vertexColors: true, side: THREE.DoubleSide }));
    // PREMIUM PASS: every cloth material carries the procedural
    // fabric micro-textures (see fabricMaps above) — roughnessMap
    // breaks the flat plastic reflection, the weave normalMap adds
    // the woven hand. Material roughness goes to 1.0 because the
    // map carries the ~0.77 centre (was a uniform 0.8).
    fabricMaps();
    m.roughnessMap = fabricRoughTex;
    m.normalMap = fabricNormalTex;
    m.normalScale = new THREE.Vector2(0.5, 0.5);
    m.roughness = 1.0;
    patternCache[key] = m; return m;
  }
  function clothMat(spec) {
    if (!spec) return mat(0x888888, 0.85);
    if (spec.pattern) return patternMat(spec.pattern, spec.color, spec.color2 || 0xffffff);
    // APPEAL PASS: solids go through the 'cloth' detail painter
    // (jackets/blazers get buttons + pocket; everything else gets
    // stitching + fold shading only).
    var detail = (spec.type === 'jacket' || spec.type === 'blazer' || spec.detail) ? 1 : 0;
    return patternMat('cloth', spec.color, detail);
  }

  // ---- procedural face -----------------------------------------------------
  // Canvas wrapped on the head sphere; face centre at u=0.25
  // (x=64 in 256-space; the canvas is 512 and drawn at 2x scale so
  // features stay crisp in cutscene close-ups).
  // HEAD PASS ROUND 2 — SIMPLIFY CLAUSE ACTIVE (user spec point 5 +
  // parent verdict on round 1): the face is FLAT and CLEAN, fully
  // drawn here — oval eyes with cream white + dark iris + 1-point
  // highlight, THICK drawn brows (hair-coloured, ~2x the old
  // strokes), nose as soft side shading BACKING the displacement
  // nose in rig.buildHead (CHARPOLISH; the 3D nose MESH and the
  // 3D eye/brow gear stay deleted), mouth line + lower-lip hint,
  // very soft blush. High contrast so features read at 3 m.
  // Expression variants (f.expr) swap the texture.
  // FX6 — generateFaceTexture(archetypeSpec, skinHex): the same
  // flat canvas, developed: brows are filled TAPERED blades with
  // a seed-varied thickness and a sharper dive toward the nose
  // (f.browThick / f.browDive); irises carry a seed colour (browns
  // and blacks common, blue rare — f.irisColor) with pupil + main
  // catchlight + a whisper second catchlight; the nose side
  // shading is firmer (still texture only); f.stubble adds a light
  // jaw shadow + deterministic speckle for the macho roles; soft
  // temple and under-cheekbone shading deepen the face planes.
  // Feature POSITIONS never move (eyes at canvas 64+-13.5, brow
  // anchor rows, mouth row) — the Stage C eyewear alignment and
  // the head displacement's eye band depend on them.
  // CACHE: one texture per full spec (archetype face + the seed
  // variation the factory bakes into it + expression) — the
  // cache key is the spec itself, and setExpression() re-enters
  // through the same key space, so a texture is generated once
  // per (archetype, seed, expression) and never per frame.
  var faceCache = {};
  function generateFaceTexture(f, skinHex) {
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
    // APPEAL PASS: ONE expression resolver for every face. Legacy
    // archetype data speaks in mouths (grin/flat/stern); the style
    // lock speaks in 5 expressions — f.expr wins when set, else
    // the mouth implies it. char.setExpression() swaps at runtime.
    var expr = f.expr || (f.mouth === 'grin' ? 'smile' : (f.mouth === 'flat' || f.mouth === 'stern') ? 'serious' : 'neutral');
    // Warm skin variation (style lock: never one flat tone) — a
    // soft warm tint on the nose tip for EVERY face, and a warm
    // patch at the ear/funnel sample point (u 0.62, v 0.45) so the
    // ears and neck funnel read warm instead of grey.
    function warm(x, y, r, a) {
      var g = c.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, 'rgba(233,116,74,' + a + ')'); g.addColorStop(1, 'rgba(233,116,74,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    }
    warm(64, 142, 7, 0.10);
    warm(159, 141, 30, 0.09);
    // FX6: face-plane shading — a soft shadow kiss at each temple
    // and under each cheekbone, so the flat face carries a hint of
    // bone structure at game distance (alphas stay low: this is
    // plane modelling, not makeup). Drawn before the features so
    // brows/eyes/blush sit cleanly on top.
    function planeShade(x, y, r, a) {
      var pg = c.createRadialGradient(x, y, 1, x, y, r);
      pg.addColorStop(0, 'rgba(74,40,18,' + a + ')');
      pg.addColorStop(1, 'rgba(74,40,18,0)');
      c.fillStyle = pg; c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    planeShade(31, 103, 13, 0.055); planeShade(97, 103, 13, 0.055);   // temples
    planeShade(36, 131, 10, 0.055); planeShade(92, 131, 10, 0.055);   // under cheekbones
    // under-jaw AO: a soft shadow where the jaw meets the neck
    var jg = c.createLinearGradient(0, 168, 0, 198);
    jg.addColorStop(0, 'rgba(60,30,12,0)'); jg.addColorStop(1, 'rgba(60,30,12,0.12)');
    c.fillStyle = jg; c.fillRect(42, 168, 44, 30);
    // ---- brows: thick arched strokes, hair colour ---------------
    // APPEAL PASS: features sit WIDER than realistic (eye centres
    // at +-13.5 in 256-space, was +-12) over a smaller, rounder
    // lower face — the friendly stylized read.
    // FX6: filled TAPERED BLADES instead of round-cap strokes —
    // thick through the outer two-thirds, narrowing toward the
    // nose, thickness varied per seed (f.browThick) and the inner
    // end pulled DOWN by f.browDive so the brow dives sharply
    // toward the nose. Anchor rows unchanged; only the mark got
    // stronger.
    // FX6 iteration 2 (lab verdict): brows drawn in the raw hair
    // colour went PALE on light/mid hair rolls — tan planks on
    // dark skin, contrast gone. Brows render DARKENED toward the
    // hair hue (x0.5, like real brows vs head hair), so the blade
    // reads on every skin/hair combination.
    var browCol = f.browColor != null ? css(new THREE.Color(f.browColor).multiplyScalar(0.5).getHex()) : '#2b1d12';
    c.fillStyle = browCol; c.globalAlpha = 0.94;
    var browThick = 3.1 * (f.browThick || 1);
    var browDive = (f.browDive || 0) * 2.4;
    function brow(cx, mirror, yOut, yMid, yIn) {
      var x0 = cx + mirror * 8.5, x1 = cx, x2 = cx - mirror * 8.5, y2 = yIn + browDive;
      var top = [], bot = [], N = 9, s, px, py, tt, half;
      for (s = 0; s <= N; s++) {
        tt = s / N;
        px = (1 - tt) * (1 - tt) * x0 + 2 * (1 - tt) * tt * x1 + tt * tt * x2;
        py = (1 - tt) * (1 - tt) * yOut + 2 * (1 - tt) * tt * yMid + tt * tt * y2;
        half = browThick * (1.12 - 0.78 * tt);
        top.push([px, py - half]); bot.push([px, py + half]);
      }
      c.beginPath();
      c.moveTo(top[0][0], top[0][1]);
      for (s = 1; s <= N; s++) c.lineTo(top[s][0], top[s][1]);
      for (s = N; s >= 0; s--) c.lineTo(bot[s][0], bot[s][1]);
      c.closePath(); c.fill();
    }
    if (expr === 'angry') { brow(50.5, 1, 105, 103.5, 111.5); brow(77.5, -1, 105, 103.5, 111.5); }
    else if (expr === 'surprised') { brow(50.5, 1, 106, 98.5, 105); brow(77.5, -1, 106, 98.5, 105); }
    else if (expr === 'serious') { brow(50.5, 1, 107.5, 105.5, 108); brow(77.5, -1, 107.5, 105.5, 108); }
    else if (expr === 'smile') { brow(50.5, 1, 110, 100.5, 108); brow(77.5, -1, 110, 100.5, 108); }
    else { brow(50.5, 1, 109.5, 101.5, 108.5); brow(77.5, -1, 109.5, 101.5, 108.5); }
    c.globalAlpha = 1;
    // ---- eyes: drawn ovals, white + iris + highlight ------------
    // soft shadow just above (under-brow) and below each eye
    c.fillStyle = 'rgba(70,38,20,0.08)';
    c.beginPath(); c.ellipse(50.5, 112.5, 11, 2.6, 0, 0, 7); c.ellipse(77.5, 112.5, 11, 2.6, 0, 0, 7); c.fill();
    c.fillStyle = 'rgba(70,38,20,0.10)';
    c.beginPath(); c.ellipse(50.5, 130, 10, 2.0, 0, 0, 7); c.ellipse(77.5, 130, 10, 2.0, 0, 0, 7); c.fill();
    function eye(cx) {
      // CHARPOLISH: whites + iris scaled ~1.3x around the SAME
      // centres (positions are load-bearing: eyewear alignment +
      // the head displacement's eye band). The old 10.8 px-tall
      // white subtended ~3 screen px at the combat photo's range
      // — a dot. The white now stands 14.4 px tall with a 10.6 px
      // iris and a real pupil inside it: white + iris + pupil
      // read as an EYE at game distance, still clean low-poly.
      var ry = f.eyes === 'narrow' ? 4.6 : f.eyes === 'sleepy' ? 5.6 : expr === 'surprised' ? 7.8 : 7.2;
      c.fillStyle = '#f2ede4';
      c.beginPath(); c.ellipse(cx, 121, 9.4, ry, 0, 0, 7); c.fill();
      var iy = f.eyes === 'sleepy' ? 121.8 : 121;
      // FX6: the iris carries the character's seed colour
      // (browns/blacks common, blue rare — rolled by the factory);
      // pupil + main catchlight + a whisper second catchlight.
      // CHARPOLISH: iris radius follows the enlarged white
      // (capped so narrow eyes keep the FX6 spill proportion).
      var irisR = Math.min(5.3, ry + 0.5);
      c.fillStyle = f.irisColor || '#2e1a0c';
      c.beginPath(); c.arc(cx, iy, irisR, 0, 7); c.fill();
      c.fillStyle = '#0d0603';
      c.beginPath(); c.arc(cx, iy, irisR * 0.53, 0, 7); c.fill();
      c.fillStyle = '#ffffff';
      c.beginPath(); c.arc(cx - irisR * 0.38, iy - irisR * 0.42, irisR * 0.32, 0, 7); c.fill();
      c.globalAlpha = 0.45;
      c.beginPath(); c.arc(cx + irisR * 0.44, iy + irisR * 0.37, irisR * 0.19, 0, 7); c.fill();
      c.globalAlpha = 1;
      if (f.eyes === 'sleepy') { // lid band over the top of the eye
        c.fillStyle = css(skinHex); c.fillRect(cx - 9.8, 113.0, 19.6, 5.6);
      }
      // lash line over the top edge — firm upper lid (style lock)
      c.strokeStyle = 'rgba(43,24,15,0.92)'; c.lineWidth = 2.2; c.lineCap = 'round';
      c.beginPath(); c.ellipse(cx, 121, 9.7, ry + 0.4, 0, Math.PI * 1.06, Math.PI * 1.94); c.stroke();
    }
    eye(50.5); eye(77.5);
    // nose: FX6 side shading, now BACKING a real displacement
    // nose in rig.buildHead (CHARPOLISH — bridge ridge + tip ball
    // + alar flare as radial relief on the sphere; the round-1
    // doll verdict was against the separate nose MESH, not
    // against relief). The shading stays aligned with the relief:
    // bridge shadow over the ridge, light kiss on its lit side,
    // under-tip shadow seating the tip ball, firm nostril dots.
    var ng = c.createLinearGradient(60, 0, 69, 0);
    ng.addColorStop(0, 'rgba(60,30,10,0)'); ng.addColorStop(0.5, 'rgba(60,30,10,0.17)'); ng.addColorStop(1, 'rgba(60,30,10,0)');
    c.fillStyle = ng; c.fillRect(58.5, 125, 11, 18);
    var nhl = c.createLinearGradient(61, 0, 64.5, 0);
    nhl.addColorStop(0, 'rgba(255,226,196,0)'); nhl.addColorStop(0.5, 'rgba(255,226,196,0.10)'); nhl.addColorStop(1, 'rgba(255,226,196,0)');
    c.fillStyle = nhl; c.fillRect(61, 126, 3.5, 15);
    c.fillStyle = 'rgba(60,30,10,0.22)';
    c.beginPath(); c.ellipse(64, 146.5, 4.6, 1.7, 0, 0, 7); c.fill();
    c.fillStyle = 'rgba(50,26,12,0.45)';
    c.beginPath(); c.arc(60.5, 144, 1.15, 0, 7); c.arc(67.5, 144, 1.15, 0, 7); c.fill();
    // mouth — one simple line with a slight curve, driven by the
    // resolved expression (strong enough to read at 2 m)
    if (expr === 'surprised') {
      c.fillStyle = 'rgba(70,22,16,0.92)';
      c.beginPath(); c.ellipse(64, 157, 3.6, 4.8, 0, 0, 7); c.fill();
    } else {
      c.strokeStyle = 'rgba(94,34,24,0.95)'; c.lineWidth = 2.6; c.lineCap = 'round';
      c.beginPath();
      if (expr === 'smile') { c.arc(64, 150, 10, 0.25, Math.PI - 0.25); }
      else if (expr === 'serious') { c.moveTo(56.5, 157); c.lineTo(71.5, 157); }
      else if (expr === 'angry') { c.arc(64, 164, 8, Math.PI + 0.5, -0.5); }
      else { c.arc(64, 152, 7.5, 0.4, Math.PI - 0.4); }
      c.stroke();
      if (expr === 'smile' || expr === 'neutral') { // lower-lip hint
        c.strokeStyle = 'rgba(255,220,190,0.20)'; c.lineWidth = 1.4;
        c.beginPath(); c.arc(64, 154.5, 6.0, 0.55, Math.PI - 0.55); c.stroke();
      }
    }
    // cheek warmth: EVERY face gets a whisper (0.05); f.blush
    // archetypes (tourists, kids) get the fuller 0.10. Radial
    // gradients only — flat ellipses read as pink stickers.
    var blushA = f.blush ? 0.10 : 0.05;
    var bl1 = c.createRadialGradient(38, 140, 1, 38, 140, 10);
    bl1.addColorStop(0, 'rgba(232,110,90,' + blushA + ')'); bl1.addColorStop(1, 'rgba(232,110,90,0)');
    c.fillStyle = bl1; c.beginPath(); c.arc(38, 140, 10, 0, 7); c.fill();
    var bl2 = c.createRadialGradient(90, 140, 1, 90, 140, 10);
    bl2.addColorStop(0, 'rgba(232,110,90,' + blushA + ')'); bl2.addColorStop(1, 'rgba(232,110,90,0)');
    c.fillStyle = bl2; c.beginPath(); c.arc(90, 140, 10, 0, 7); c.fill();
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
    if (f.stubble) {
      // FX6: THIN stubble + jaw line for the macho roles — a
      // much lighter jaw shadow than f.beard (max alpha 0.10 vs
      // 0.24) broken up by deterministic speckle, plus one soft
      // stroke along the jaw curve so the jaw edge reads. The
      // speckle hash is seeded (f.stubSeed) so the cached texture
      // is stable and every seed wears a different stubble.
      var sg2 = c.createLinearGradient(0, 154, 0, 202);
      sg2.addColorStop(0, 'rgba(26,16,10,0)'); sg2.addColorStop(0.45, 'rgba(26,16,10,0.055)'); sg2.addColorStop(1, 'rgba(26,16,10,0.10)');
      c.fillStyle = sg2; c.fillRect(43, 154, 42, 50);
      var stubState = (f.stubSeed || 1234567) >>> 0;
      function stubRnd() { stubState = (stubState * 1664525 + 1013904223) >>> 0; return stubState / 4294967296; }
      for (var si = 0; si < 300; si++) {
        var sx2 = 45 + stubRnd() * 38, sy2 = 152 + stubRnd() * 46;
        var jawHalf = 20 - (sy2 - 152) * 0.16;
        if (Math.abs(sx2 - 64) > jawHalf) continue;
        c.fillStyle = 'rgba(24,14,8,' + (0.05 + stubRnd() * 0.09).toFixed(3) + ')';
        c.beginPath(); c.arc(sx2, sy2, 0.55, 0, 7); c.fill();
      }
      c.strokeStyle = 'rgba(40,22,10,0.13)'; c.lineWidth = 1.6; c.lineCap = 'round';
      c.beginPath(); c.arc(64, 138, 27, Math.PI * 0.28, Math.PI * 0.72); c.stroke();
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

  // PREMIUM PASS fake AO, azimuthal: Rig.shadePart works per RING,
  // but the armpit crease lives at the SIDES of specific torso
  // rings — the band where the sleeve exits and the arm hangs
  // against the body. This pass darkens only the side vertices of
  // the armpit-band rings of an already-shaded part (side-ness read
  // back from the tube's own u coordinate: u 0 / 0.5 are the two
  // flanks). Vertex colour data only — no geometry is touched.
  // Local rings 5..9 of the top copy are torso stations 6..10
  // (upper chest -> slope -> neck taper); the weight peaks at
  // local 7 (station 8, mid-slope, level with the arm exit).
  function armpitAO(part, ringVerts) {
    if (!part.col || !part.uv) return part;
    var band = { 5: 0.30, 6: 0.65, 7: 1.0, 8: 0.80, 9: 0.40 };
    var DEPTH = 0.13;
    var n = part.pos.length / 3;
    for (var i = 0; i < n; i++) {
      var w = band[Math.floor(i / ringVerts)];
      if (!w) continue;
      var u = part.uv[i * 2];
      var side = Math.abs(Math.cos(u * Math.PI * 2));
      var f = 1 - DEPTH * w * side * side;
      part.col[i * 3] *= f; part.col[i * 3 + 1] *= f; part.col[i * 3 + 2] *= f;
    }
    return part;
  }

  var WHITE = [1, 1, 1];
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
      // APPEAL PASS fake AO on cloth: hem slightly shaded, the
      // under-collar rings (local 9-10) darkest — the collar zone
      // must read as a fold, not a flat tube top.
      // PREMIUM PASS: the whole AO set is deepened one notch (hem
      // 0.97->0.94, under-collar 0.94/0.90 -> 0.90/0.84) and the
      // armpit band gets its azimuthal pass (armpitAO) — the SSAO
      // substitute the pass brief allows: baked occlusion where
      // cloth folds against the body, zero runtime cost.
      var parts = [armpitAO(Rig.shadePart(Rig.tube(topSts, boneIndex, 10, false, false), WHITE,
        [0.94, 1, 1, 1, 1, 1, 1, 1, 1, 0.90, 0.84], 11), 11)];
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
        // APPEAL PASS fake AO: armpit root darkest, elbow dip.
        // PREMIUM PASS: deepened (root 0.85->0.78, first visible
        // ring 0.93->0.85, second 1->0.94, elbow 0.94->0.92) so the
        // sleeve head sits IN the armpit shadow with the torso
        // band from armpitAO instead of floating on top of it.
        var slv = sts.concat(sub), slvF = [];
        for (var fi = 0; fi < slv.length; fi++)
          slvF.push(fi === 0 ? 0.78 : fi === 1 ? 0.85 : fi === 2 ? 0.94 : fi === Math.min(4, slv.length - 2) ? 0.92 : 1);
        return Rig.shadePart(Rig.tube(slv, boneIndex, 10, true, false), WHITE, slvF, 11);
      }
      if (sleeveTo >= 0) {
        parts.push(sleeve(S.armL, 1, sleeveTo));
        parts.push(sleeve(S.armR, -1, sleeveTo));
      }
      if (top.type === 'jacket' || top.type === 'blazer') { // collar
        // Round 10: radii widened (0.033/0.030 -> 0.040/0.036H) —
        // the thicker neck frustum (0.036H at its base) would
        // swallow the old collar tube whole.
        // APPEAL PASS iteration 2: the collar rides HIGHER (+0.020H)
        // and a touch wider — iteration 1 close-ups showed a bare
        // skin ring between collar top and jaw; the taller collar
        // covers most of that funnel.
        var colSt = [Rig.st(0, j.neckY - 0.026 * H, 0, 0.040 * H, 0.040 * H, 'neck'),
                     Rig.st(0, j.neckY + 0.020 * H, 0, 0.038 * H, 0.038 * H, 'neck', 'head', 0.3)];
        parts.push(Rig.shadePart(tubePart(colSt, boneIndex), WHITE, [0.86, 0.93], 11));
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
      meshes.push(clothMesh([Rig.shadePart(tubePart(sk, boneIndex), WHITE, [0.93, 1, 1, 1, 1], 11)], boneIndex, clothMat(bottom)));
      meshes.push(clothMesh([Rig.paintPart(tubePart(subStations(S.legL, 4, 6, 0.004), boneIndex), WHITE),
                             Rig.paintPart(tubePart(subStations(S.legR, 4, 6, 0.004), boneIndex), WHITE)], boneIndex, mat(0x333333, 0.8)));
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
      // APPEAL PASS fake AO: waistband shaded under the shirt hem,
      // knee dip on the leg tubes (station 3).
      // PREMIUM PASS: deepened (waistband 0.95->0.90 / 0.97->0.94,
      // leg top ring 0.96->0.93, knee 0.93->0.90).
      var pantsF = [0.93, 1, 1, 0.90, 0.94, 1, 1, 1];
      meshes.push(clothMesh([
        Rig.shadePart(tubePart(subStations(S.torso, 0, 2, 0.009), boneIndex), WHITE, [0.90, 0.94, 1], 11),
        Rig.shadePart(tubePart(pantsL, boneIndex), WHITE, pantsF, 11),
        Rig.shadePart(tubePart(pantsR, boneIndex), WHITE, pantsF, 11)], boneIndex, clothMat(bottom)));
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
      meshes.push(clothMesh([Rig.paintPart(Rig.tube(belt, boneIndex, 10, false, false), WHITE)], boneIndex, mat(0x2a2019, 0.7)));
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
      for (var ui = 0; ui < sts.length; ui++) { sts[ui].p[1] -= 0.004 * H; sts[ui].rz *= 1.40; }
      sts[2].rz *= 1.10; sts[2].rx *= 0.92; sts[2].p[1] += 0.002 * H; // toe box: clear of the skin toe, inside the sole outline
      var toe = sts[2];
      sts.push(Rig.st(toe.p[0], toe.p[1] + 0.001 * H, toe.p[2] + 0.011 * H,
        toe.rx * 0.62, toe.rz * 0.66, 'toe' + side)); // rounded tip, flush with the sole front
      return Rig.paintPart(Rig.tube(sts, boneIndex, 9, false, true), WHITE);
    }
    function shoeSole(legStations, side) {
      // APPEAL PASS: shoes read slightly OVERSIZED (style lock) —
      // sole ~8% longer and ~10% wider than the Iterasi-2 sneaker.
      var fx = legStations[7].p[0];
      var sts = [
        Rig.st(fx, 0.0220, -0.014 * H, 0.0285 * H, 0.0165, 'foot' + side),
        Rig.st(fx, 0.0160, 0.030 * H, 0.0330 * H, 0.0145, 'foot' + side),
        Rig.st(fx, 0.0135, 0.088 * H, 0.0385 * H, 0.0140, 'foot' + side, 'toe' + side, 0.35),
        Rig.st(fx, 0.0135, 0.136 * H, 0.0360 * H, 0.0140, 'toe' + side),
        Rig.st(fx, 0.0150, 0.156 * H, 0.0230 * H, 0.0125, 'toe' + side)
      ];
      return Rig.paintPart(Rig.tube(sts, boneIndex, 9, true, true), WHITE);
    }
    meshes.push(clothMesh([shoeUpper(S.legL, 'L'), shoeUpper(S.legR, 'R')], boneIndex, shoeMat));
    meshes.push(clothMesh([shoeSole(S.legL, 'L'), shoeSole(S.legR, 'R')], boneIndex, soleMat));
    return meshes;
  }

  // ---- accessories (bone-attached) ------------------------------------------
  // Every character material is vertexColors:true (APPEAL PASS);
  // plain accessory geometry gets a white colour fill so it shades
  // with its material colour unchanged.
  function fillWhite(geo) {
    if (geo.attributes.color) return geo;
    var n = geo.attributes.position.count, col = new Float32Array(n * 3);
    for (var i = 0; i < n * 3; i++) col[i] = 1;
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  }
  function attach(bone, geo, material, x, y, z, rx, ry, rz) {
    var m = new THREE.Mesh(fillWhite(geo), material);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.frustumCulled = false;
    bone.add(m); return m;
  }

  // APPEAL PASS hair colour: bake TWO tones + the soft highlight
  // BAND into the hair vertices. geo is head-bone local (or pivot
  // local for swing parts — pivot converts back to head space).
  // The band is one curved lighter stripe over the crown; the rim
  // sits slightly darker than the base. Never a specular streak.
  function paintHair(geo, colorHex, p, pivot) {
    var hd = Rig.headDims(p), cy = hd.cy, r0 = hd.r0;
    var base = new THREE.Color(colorHex);
    var light = base.clone().lerp(new THREE.Color(0x9a7c52), 0.38);
    light.r = Math.min(1, light.r * 1.15); light.g = Math.min(1, light.g * 1.15); light.b = Math.min(1, light.b * 1.15);
    var pa = geo.attributes.position, n = pa.count, col = new Float32Array(n * 3);
    var ox = pivot ? pivot[0] : 0, oy = pivot ? pivot[1] : 0;
    for (var i = 0; i < n; i++) {
      var ny = (pa.getY(i) + oy - cy) / r0;
      var band = Math.exp(-Math.pow((ny - 0.42) / 0.30, 2)) * (0.35 + 0.65 * Math.max(0, Math.min(1, (ny + 0.3) / 1.0)));
      var shade = 0.88 + 0.14 * Math.max(0, Math.min(1, (ny + 0.4) / 1.2));
      var f = Math.min(0.6, band * 0.55);
      col[i * 3] = (base.r * shade) * (1 - f) + light.r * f;
      col[i * 3 + 1] = (base.g * shade) * (1 - f) + light.g * f;
      col[i * 3 + 2] = (base.b * shade) * (1 - f) + light.b * f;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  }
  function textPatch(text, fg, bg) {
    var cv = document.createElement('canvas'); cv.width = 128; cv.height = 32;
    var c = cv.getContext('2d');
    c.fillStyle = bg; c.fillRect(0, 0, 128, 32);
    c.fillStyle = fg; c.font = 'bold 21px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, 64, 17);
    var tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    var pm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
    pm.toneMapped = false; pm.fog = false; pm.envMapIntensity = 0; // FX parity (see charGrade)
    return new THREE.Mesh(new THREE.PlaneGeometry(0.105, 0.026), pm);
  }

  // COMBAT V7: the gripped-pistol build, factored out of
  // buildAccessories so the SAME mesh can be attached to a character
  // that already exists (SH.CharFactory.attachPistol) — one build
  // path, no copies. Stage D iteration 3: a gripped barrel follows
  // the hand's -Y (the finger line). Built along +Z it pointed at
  // the sky whenever the arm raised to aim (hand frame pitches with
  // the arm); rotated +90 deg X it tracks the aim line and hangs
  // naturally when the arm is down.
  function attachPistolTo(char) {
    if (!char || !char.bones || !char.bones.handR) return null;
    if (char._pistolMesh) return char._pistolMesh;
    var pg = Rig.mergePlain([
      Rig.prim(new THREE.BoxGeometry(0.026, 0.045, 0.030), 0, -0.028, 0.004, 1, 1, 1, 0),
      Rig.prim(new THREE.BoxGeometry(0.020, 0.024, 0.115), 0, 0.004, 0.045, 1, 1, 1, 0)]);
    var pm = attach(char.bones.handR, pg, gunMat, 0, -0.052, 0.012);
    pm.rotation.x = Math.PI / 2;
    // COMBAT V7.1: 1.3x — at the combat photo's range the true-size
    // gun subtended ~4 px at judge scale and vanished into the
    // wristband; a third larger in bright steel (gunMat) it reads
    // as a weapon shape in the hand at 384 px while staying
    // proportionate at native size.
    pm.scale.setScalar(1.3);
    pm.castShadow = true; // create()'s traverse does this for built-in gear; a post-creation attach must set it itself
    char._pistolMesh = pm;
    return pm;
  }

  function buildAccessories(char, wear, r) {
    var b = char.bones, p = char.params, u = p.u, H = p.H, acc = wear.accessories || [];
    // HEAD PASS: head size from the rig's head constants; hats sit
    // 1-2 cm LOWER onto the forehead than before (spec).
    var headCY = Rig.headDims(p).cy, headR = Rig.headDims(p).r0;
    function has(name) { return acc.indexOf(name) >= 0; }
    // AP2 polish (user order): hats get REAL crown height and a
    // curve that FOLLOWS the head, brim edges curl slightly UP at
    // the sides instead of being a flat board, and the blurry
    // cloth-texture stitch dashes are GONE from crowns (plain toon
    // material — the old fedora was two raw cylinders wearing the
    // shirt texture, which read as a blurry seam ring). One lathe
    // profile builds crown + dome + brim in a single surface.
    function latheHat(crownR, crownH, brimR, upturn) {
      var pts = [];
      pts.push(new THREE.Vector2(0.001, crownH));
      pts.push(new THREE.Vector2(crownR * 0.52, crownH * 0.99));
      pts.push(new THREE.Vector2(crownR * 0.85, crownH * 0.90));
      pts.push(new THREE.Vector2(crownR * 0.97, crownH * 0.55));
      pts.push(new THREE.Vector2(crownR, crownH * 0.16));
      pts.push(new THREE.Vector2(crownR * 1.02, crownH * 0.05));
      pts.push(new THREE.Vector2(brimR * 0.97, crownH * 0.02));
      pts.push(new THREE.Vector2(brimR, upturn));
      return new THREE.LatheGeometry(pts, 22);
    }
    if (wear.hat === 'fedora') {
      attach(b.head, latheHat(headR * 0.86, headR * 0.72, headR * 1.30, headR * 0.07), mat(wear.hatColor || 0xe8e0cc, 0.85), 0, headCY + headR * 0.40, 0);
    } else if (wear.hat === 'officer') {
      attach(b.head, new THREE.CylinderGeometry(headR * 0.99, headR * 1.01, headR * 0.50, 14), mat(0x1d2f52, 0.6), 0, headCY + headR * 0.70, 0);
      var capDome = new THREE.SphereGeometry(headR * 0.99, 14, 8);
      capDome.scale(1, 0.38, 1);
      attach(b.head, capDome, mat(0x1d2f52, 0.6), 0, headCY + headR * 0.95, 0);
      attach(b.head, new THREE.BoxGeometry(headR * 0.95, headR * 0.07, headR * 0.55), darkMat, 0, headCY + headR * 0.50, headR * 0.85);
    } else if (wear.hat === 'helmet') {
      attach(b.head, new THREE.SphereGeometry(headR * 1.10, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(wear.hatColor || 0x22262e, 0.35), 0, headCY + headR * 0.12, 0);
    } else if (wear.hat === 'sunhat') {
      attach(b.head, latheHat(headR * 0.88, headR * 0.52, headR * 1.82, headR * 0.06), mat(0xe8d9a8, 0.9), 0, headCY + headR * 0.42, 0);
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
      // FX6 FIX — the Stage C anchor constants above (x 0.231,
      // y +0.083) were derived for the pre-Appeal face (eyes at
      // canvas 64+-12); the Appeal face widened the eyes to
      // 64+-13.5 and the pair render (fx6-eyepair.png: same seed
      // with vs without sunglasses) proved the lenses sat ~19 mm
      // low and ~7 mm in. Anchors are now computed from the same
      // headDims the head was built with (FX6 jitter included):
      // eye x from the UV azimuth sin((13.5/256)*2pi) = 0.3253,
      // eye z from the measured surface point, y raised by the
      // render-measured delta.
      var hdA = Rig.headDims(p);
      var ex = hdA.r0 * hdA.sx * 0.3253;
      var ez = hdA.r0 * hdA.sz * 0.9457;
      var ey = headCY + headR * 0.133;
      [-1, 1].forEach(function (s) {
        attach(b.head, lensGeo, lensMaterial, s * ex, ey, ez - headR * 0.004);
        attach(b.head, rimGeo, rimMaterial, s * ex, ey, ez + headR * 0.006);
        // temple arm: one straight thin bar from the frame's
        // outer edge (x 0.40, z 0.86) back to the ear (x 0.80,
        // z 0.02); its middle rides inside the head's elliptical
        // bulge (rx ~0.80 headR at eye height) the way real arms
        // disappear into hair — the visible front stub and the
        // ear tip carry the read.
        attach(b.head, new THREE.BoxGeometry(headR * 0.026, headR * 0.030, headR * 0.93),
          rimMaterial, s * headR * 0.60, ey + headR * 0.017, headR * 0.44, 0, s * 2.697, 0);
      });
      attach(b.head, new THREE.BoxGeometry(headR * 0.15, headR * 0.032, headR * 0.028),
        rimMaterial, 0, ey + headR * 0.035, ez + headR * 0.006);
    }
    if (has('glasses')) {
      var lensMat = new THREE.MeshStandardMaterial({ color: 0xcfe0e8, roughness: 0.12, transparent: true, opacity: 0.45 });
      lensMat.toneMapped = false; lensMat.fog = false; lensMat.envMapIntensity = 0; // FX parity: the game's PMREM sky must not wash the lenses (the lab has no environment)
      eyewear(lensMat,
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
      attachPistolTo(char);
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

  // ---- APPEAL PASS shared fx: blob shadow + outline material ----
  var blobGeo = new THREE.PlaneGeometry(0.84, 0.84);
  var blobMat = (function () {
    var cv = document.createElement('canvas'); cv.width = cv.height = 128;
    var c = cv.getContext('2d');
    var g = c.createRadialGradient(64, 64, 6, 64, 64, 62);
    g.addColorStop(0, 'rgba(8,6,4,0.50)'); g.addColorStop(0.7, 'rgba(8,6,4,0.28)'); g.addColorStop(1, 'rgba(8,6,4,0)');
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    return charGrade(new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  })();
  var outlineMat = (function () {
    var m = charGrade(new THREE.MeshBasicMaterial({ color: 0x2e1c11, side: THREE.BackSide }));
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uOut = { value: 0.0038 };
      sh.vertexShader = 'uniform float uOut;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed += normal * uOut;');
    };
    return m;
  })();
  // AP2 polish (user order): WARM RIM shell for the leads only —
  // a BackSide hull slightly larger than the outline, additively
  // blended, whose alpha is a view-angle fresnel: it lights the
  // silhouette edge warm (0xffb36b) so a lead's shirt colour reads
  // separated from dark night ground even when the key light is
  // gone. Strength 1.25 (raised from the lab's ambient rim feel).
  // RONDE 3B: the shell strength lives in ONE shared uniform object
  // so the game can drive it per frame (see setRimLevel below). The
  // default 1.25 is the authored/lab value — the lab never calls
  // setRimLevel, so its look is unchanged.
  var rimStrUniform = { value: 1.25 };
  var rimShellMat = (function () {
    // FX PARITY: toneMapped:false is load-bearing here — under the
    // game's ACES + exposure this additive fresnel blew out into
    // the jagged orange/white edge lines reported on pants/legs;
    // unmapped it renders at the authored strength, exactly as in
    // the lab (A/B proven: hiding the shells removed the lines,
    // hiding the outlines did not).
    var m = charGrade(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uRimCol = { value: new THREE.Color(0xffb36b) };
      sh.uniforms.uRimStr = rimStrUniform;
      sh.vertexShader = 'varying vec3 vNv; varying vec3 vVp;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * 0.005;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvNv = normalize(transformedNormal);\nvVp = normalize(-mvPosition.xyz);');
      // RONDE 3B: fresnel exponent 2.0 -> 1.35 — a WIDER curve, so
      // the edge light spreads softly over the silhouette instead of
      // peaking in a thin line that climbs the loft's ring steps and
      // reads as disconnected bright dots at gameplay distance.
      sh.fragmentShader = ('uniform vec3 uRimCol; uniform float uRimStr; varying vec3 vNv; varying vec3 vVp;\n' + sh.fragmentShader)
        .replace('#include <opaque_fragment>', 'float fres = pow(1.0 - abs(dot(normalize(vNv), normalize(vVp))), 1.35);\ngl_FragColor = vec4(uRimCol * fres * uRimStr, 1.0);');
    };
    return m;
  })();

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
    farMesh.castShadow = true; // FX2: LOD2 silhouettes cast too
    farMesh.material.toneMapped = false; farMesh.material.fog = false; farMesh.material.envMapIntensity = 0; // FX parity
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
    // FX6: head + face variation rolls on its OWN rng stream,
    // seeded per (archetype, seed) — the main stream above keeps
    // its exact draw order, so height / skin / hair style / wear
    // picks stay bit-identical to the pre-FX6 characters; only
    // the head shape and face details are new.
    var idHash = 7;
    if (arch.id) for (var ih = 0; ih < arch.id.length; ih++) idHash = (idHash * 31 + arch.id.charCodeAt(ih)) >>> 0;
    var hr = rng(seed * 104729 + idHash);
    var jawClass = (arch.head && arch.head.jaw) || 'oval';
    var jawBase = jawClass === 'square' ? { f: 0.19, b: 0.020, w: 1.12 }
      : jawClass === 'taper' ? { f: 0.335, b: 0.006, w: 0.85 }
      : { f: 0.26, b: 0.012, w: 1.00 };
    var headJit = [0.94 + hr() * 0.12, 0.94 + hr() * 0.12, 0.94 + hr() * 0.12];
    var jawF = jawBase.f + (hr() - 0.5) * 0.03;
    var p = Rig.baseParams({
      H: bp.H || (arch.heightRange ? arch.heightRange[0] + r() * (arch.heightRange[1] - arch.heightRange[0]) : 1.75),
      legFrac: bp.legFrac, shoulder: bp.shoulder, waist: bp.waist, hips: bp.hips,
      belly: bp.belly, thigh: bp.thigh, headScale: bp.headScale, handScale: bp.handScale || 1.14,
      // FX6: square-jaw (masculine) archetypes get a sturdier
      // neck (x1.05). Skin stations, the head funnel and the cloth
      // collars ALL scale with neckR, so the collar clearances
      // keep their designed margins (verified by probe + close-up
      // renders; see charlab-progress FX6 section).
      neckR: (bp.neckR || 1) * (jawClass === 'square' ? 1.05 : 1),
      headJit: headJit, jawF: jawF, jawBump: jawBase.b, chinW: jawBase.w
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
    // FX6: per-seed face variation, drawn from the FX6 stream
    // (hr) so the main stream is untouched. Everything lands in
    // faceSpec, which IS the generateFaceTexture cache key — one
    // texture per (archetype, seed, expression), and
    // setExpression() inherits the same variation.
    faceSpec.browThick = 0.85 + hr() * 0.5;
    faceSpec.browDive = jawClass === 'square' ? 0.45 + hr() * 0.55 : hr() * 0.45;
    faceSpec.irisColor = pick(hr, ['#4a2c14', '#4a2c14', '#3a2410', '#1c1108', '#1c1108', '#31517a']);
    var stubP = arch.face && arch.face.stubble;
    faceSpec.stubble = stubP === true ? true : (typeof stubP === 'number' ? hr() < stubP : false);
    faceSpec.stubSeed = Math.floor(hr() * 1000003) + 11;
    // CHARPOLISH: vertexColors on — buildHead now bakes the
    // two-tone skin lift (face/ears 1.09, neck gradient) into the
    // head geometry's colour attribute.
    var headMat = charGrade(new THREE.MeshStandardMaterial({ map: generateFaceTexture(faceSpec, skinHex), roughness: 0.8, metalness: 0, flatShading: false, vertexColors: true }));
    var head0 = new THREE.SkinnedMesh(Rig.buildHead(p, sk.index), headMat);
    head0.frustumCulled = false; bind(head0);
    var wear = resolveWear(arch, r);
    var clothes0 = buildClothes(p, sk.index, wear, skinRGB);
    for (var i = 0; i < clothes0.length; i++) { clothes0[i].bind(sk.skeleton); group.add(clothes0[i]); }
    var char = { group: group, bones: sk.bones, skeleton: sk.skeleton, params: p, archetype: arch, seed: seed, wear: wear, inUse: true, lod: 0, key: key };
    var hairGeo = Rig.hairGeometry(hairStyle, p);
    if (hairGeo) {
      // APPEAL PASS: hair colour is baked into the vertices (two
      // tones + crown band); the hijab is CLOTH — it keeps its
      // material colour and just needs the white colour fill.
      var hairMesh = new THREE.Mesh(
        hairStyle === 'hijab' ? fillWhite(hairGeo) : paintHair(hairGeo, hairColor, p, null),
        hairStyle === 'hijab' ? clothMat({ color: (arch.hair && arch.hair.clothColors) ? pick(r, arch.hair.clothColors) : (arch.hair && arch.hair.clothColor) || 0x7a4a8a }) : hairMatShared);
      hairMesh.frustumCulled = false; sk.bones.head.add(hairMesh); char.hairMesh = hairMesh;
    }
    // HEAD PASS: swinging hair parts (ponytail / long back strips)
    // on the head bone. (Round 2: no more 3D face gear — the face
    // is drawn in the head texture.)
    var swing = Rig.hairSwing(hairStyle, p);
    if (swing) {
      var swGrp = new THREE.Group();
      swGrp.position.set(swing.pivot[0], swing.pivot[1], swing.pivot[2]);
      var swMesh = new THREE.Mesh(paintHair(swing.geo, hairColor, p, swing.pivot), hairMatShared);
      swMesh.frustumCulled = false;
      swGrp.add(swMesh);
      sk.bones.head.add(swGrp);
      char.hairSwingGroup = swGrp;
      char.swing = { t: 0, vel: 0, ang: 0, speed: 0, lastPos: null };
    }
    buildAccessories(char, wear, r);
    // APPEAL PASS: soft contact blob shadow — nobody floats.
    var blob = new THREE.Mesh(blobGeo, blobMat);
    blob.scale.setScalar(p.H / 1.75);
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.015;
    blob.renderOrder = 2; blob.name = 'blob';
    group.add(blob);
    // APPEAL PASS: thin warm-dark inverted-hull outline for the
    // leads (protagonist + story cast) — consistent thickness,
    // warm dark brown, never pure black.
    char.outlines = [];
    char.rims = [];
    if (arch.lead) {
      [body0, head0].concat(clothes0).forEach(function (src) {
        var om = new THREE.SkinnedMesh(src.geometry, outlineMat);
        om.frustumCulled = false; om.userData.isOutline = true;
        om.bind(sk.skeleton); group.add(om); char.outlines.push(om);
        var rm = new THREE.SkinnedMesh(src.geometry, rimShellMat);
        rm.frustumCulled = false; rm.userData.isRim = true; rm.renderOrder = 3;
        rm.bind(sk.skeleton); group.add(rm); char.rims.push(rm);
      });
    }
    // APPEAL PASS: 5-expression swap (neutral/smile/serious/
    // angry/surprised) — regenerates the face texture in place.
    char.faceSpec = faceSpec; char.skinHex = skinHex; char.expr = faceSpec.expr || null;
    char.setExpression = function (name) {
      var fs = Object.assign({}, char.faceSpec, { expr: name });
      headMat.map = generateFaceTexture(fs, char.skinHex);
      headMat.needsUpdate = true; char.expr = name;
    };
    // LOD1: no fingers, no small accessories (hair + clothes stay)
    var body1 = new THREE.SkinnedMesh(Rig.buildBody(p, sk.index, skinRGB, false, true), bodyMat);
    body1.frustumCulled = false; body1.bind(sk.skeleton); body1.visible = false; group.add(body1);
    // LOD1 head: plain skin material, NO face texture — the spec
    // drops face detail at 15-40 m (Stage D iteration 1).
    var head1 = new THREE.SkinnedMesh(Rig.buildHead(p, sk.index),
      charGrade(new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.8, metalness: 0, flatShading: false })));
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
      if (char.outlines) for (var o = 0; o < char.outlines.length; o++) char.outlines[o].visible = level === 0;
      if (char.rims) for (var ri = 0; ri < char.rims.length; ri++) char.rims[ri].visible = level === 0;
      char.group.visible = level < 2;
      // accessories hang on bones; visibility is level-aware:
      setDecoVisible(char, level);
    };
    // FX2 (user spec): REAL SHADOWS — every character mesh casts:
    // body, head, clothes, hair, accessories, weapons, LOD1
    // stand-ins and the outline/rim hulls (their shadows are the
    // body's own silhouette, +4-5 mm). The single exclusion is the
    // fake blob-shadow plane (name 'blob'): a horizontal decal must
    // never stamp its own square onto the ground. Ground/roads
    // already receiveShadow (roads.js), so figures now sit in the
    // world with a true sun shadow. Applied here in the factory so
    // lab and game stay in sync by construction.
    group.traverse(function (o) { if (o.isMesh && o.name !== 'blob') o.castShadow = true; });
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
    // COMBAT V7: attach the factory pistol to an existing character's
    // right hand (the buildAccessories 'pistol' gear, post-creation).
    // For callers whose armed state is decided after the build —
    // e.g. the screenshot staging arming the player — so they use
    // the factory's own gun instead of a look-alike.
    attachPistol: attachPistolTo,
    // RONDE 3B: context lever for the leads' rim shell (shared
    // material, one uniform drives every shell). The game rides it
    // on its night curve; callers that never call it (the lab) keep
    // the authored 1.25.
    setRimLevel: function (v) { rimStrUniform.value = v; },
    getRimLevel: function () { return rimStrUniform.value; },
    SKIN_TONES: SKIN_TONES, HAIR_COLORS: HAIR_COLORS, rng: rng, active: active
  };
})(window.SH = window.SH || {});
