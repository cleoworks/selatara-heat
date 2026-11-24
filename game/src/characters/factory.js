// SELATARA HEAT — characters/factory.js  (TOON ADAPTER)
// The character factory, rebuilt on the toon system (toon.js).
// Every character is now SH.ToonChar.createCharacter: a stylized
// semi-realistic low-poly figure (~7.25 heads tall, MeshToonMaterial,
// inverted-hull outline, blob shadow, geometric face with
// expressions). This module keeps the legacy factory contract the
// game was built against — archetype resolution, wear colour
// picking, pooling, distance LOD with instanced far silhouettes,
// attachPistol, setExpression — and maps every archetype onto a
// toon config (unique silhouette + one key colour per character).
(function (SH) {
  'use strict';

  var SKIN_TONES = [0xf7d7b5, 0xf2c89b, 0xe8b184, 0xdb9a68, 0xc9824e, 0xa96638, 0x86502a, 0x6b3f22];
  var HAIR_COLORS = [0x1b1e28, 0x2b1d12, 0x3a2415, 0x54331b, 0x77572c, 0x9a7d52, 0xb8b0a4, 0xd8d3c8];

  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // archetype -> toon config, reading the archetype format as it
  // actually is: body { H, skin INDEX, shoulder/hips/belly build
  // hints }, hair { style|styles, color|colors, clothColors },
  // face { mustache }, wear specs with colors/colors2 arrays,
  // shoes as a hex or hex array, hat names from the game
  // ('officer' -> the spec's 'police' cap, 'ojekhelmet' -> helmet).
  function toConfig(arch, seed) {
    var r = rng(seed * 7919 + 17);
    var wear = arch.wear || {}, body = arch.body || {};
    var hairA = arch.hair || {}, faceA = arch.face || {};
    function spec(s) {
      if (!s) return {};
      var out = {};
      for (var k in s) out[k] = s[k];
      if (out.colors) out.color = out.colors[Math.floor(r() * out.colors.length) % out.colors.length];
      if (out.colors2) out.color2 = out.colors2[Math.floor(r() * out.colors2.length) % out.colors2.length];
      return out;
    }
    var top = spec(wear.top), bottom = spec(wear.bottom);
    var shoes = wear.shoes != null ? (Array.isArray(wear.shoes) ? wear.shoes[Math.floor(r() * wear.shoes.length) % wear.shoes.length] : wear.shoes) : 0x23242c;
    var hat = wear.hat || 'none';
    if (hat === 'officer') hat = 'police';
    else if (hat === 'ojekhelmet') hat = 'ojek';
    var hairStyle = hairA.style || 'short';
    if (hairA.styles) hairStyle = hairA.styles[Math.floor(r() * hairA.styles.length) % hairA.styles.length];
    var hairColor = hairA.color != null ? hairA.color
      : (hairA.colors ? hairA.colors[Math.floor(r() * hairA.colors.length) % hairA.colors.length]
        : HAIR_COLORS[Math.floor(r() * HAIR_COLORS.length) % HAIR_COLORS.length]);
    if (hairStyle === 'cap') {
      // the retired rig had a 'cap' hair style; in the toon system
      // it is a real cap hat in the hair colour, over short hair
      if (hat === 'none') { hat = 'cap'; wear = Object.assign({}, wear, { hatColor: hairColor }); }
      hairStyle = 'short';
    }
    if (hairStyle === 'hijab') {
      hairColor = hairA.clothColor != null ? hairA.clothColor
        : (hairA.clothColors ? hairA.clothColors[Math.floor(r() * hairA.clothColors.length) % hairA.clothColors.length] : 0x7a4a8a);
    }
    var H = body.H != null ? body.H
      : (arch.heightRange ? arch.heightRange[0] + r() * (arch.heightRange[1] - arch.heightRange[0]) : 1.72);
    // PROPFIX (Bos point 9): per-seed body variation for the
    // crowd archetypes — height +-5%, width +-4% — so the avg
    // build stops reading as clones in a crowd. Story cast
    // (fixed H, no heightRange) is untouched: their heights and
    // widths stay exactly as authored. Drawn from the same rng
    // stream every other archetype roll consumes.
    var widthK = 1;
    if (arch.heightRange) {
      widthK = 0.96 + r() * 0.08;
      H = H * (0.95 + r() * 0.10);
    }
    // Semi-realistic build map (2026-11-22): belly / shoulder / hips
    // hints plus the archetype's own posture (kakek's hunch) and
    // headScale (sekolah's bigger head) pick the new builds.
    var build = 'avg';
    if (H < 1.40) build = 'kid';
    else if (H < 1.52 && (body.headScale || 1) >= 1.08) build = 'teen';
    else if ((arch.posture && arch.posture.hunch || 0) >= 0.3) build = 'elderly';
    else if ((body.belly || 0) >= 0.45) build = 'heavy';
    else if ((body.belly || 0) >= 0.3 || (body.shoulder || 1) >= 1.12 || (body.hips || 1) >= 1.10) build = 'stocky';
    else if ((body.shoulder || 1) <= 0.95) build = 'slim';
    var acc = (wear.accessories || []).slice();
    var cfg = {
      height: H,
      build: build,
      // PROPFIX (Bos point 6): the female profile is decided by
      // the ARCHETYPE's explicit flag when it declares one —
      // inference from skirt/bun/hijab (isMaleCfg) is only the
      // fallback for undeclared/mixed crowd archetypes.
      female: arch.female != null ? !!arch.female : null,
      // PROPFIX (Bos point 9): forward the body proportion
      // overrides (dead inputs until now) + the variation factor.
      waistK: body.waist != null ? body.waist : null,
      thighK: body.thigh != null ? body.thigh : null,
      legFrac: body.legFrac != null ? body.legFrac : null,
      widthK: widthK,
      skin: body.skin != null ? SKIN_TONES[body.skin % 8] : SKIN_TONES[Math.floor(r() * 8) % 8],
      top: top.color != null ? top.color : 0xd8542e,
      accent: top.color2 != null ? top.color2 : null,
      bottom: bottom.color != null ? bottom.color : 0x2c3038,
      shoe: shoes,
      hairColor: hairColor,
      hair: hairStyle,
      hat: hat,
      hatColor: wear.hatColor != null ? wear.hatColor : null,
      sleeve: top.sleeve === 'long' ? 'long' : 'short',
      // POLISH2: garment construction — the archetype's top type
      // and print pattern reach the rig (they were dropped here
      // before: every archetype wore the same plain trunk).
      topType: top.type || 'tee',
      pattern: top.pattern || null,
      bottomType: bottom.type === 'shorts' ? 'shorts' : (bottom.type === 'skirt' ? 'skirt' : 'long'),
      backpack: acc.indexOf('backpack') >= 0 ? 0x6e4a26 : null,
      handColor: body.handColor != null ? body.handColor : null,
      // BODYFIX2: the archetype's default expression (Raka's
      // 'warm' smile) reaches the toon character.
      expression: faceA.expr || null,
      accessories: acc,
      face: faceA.mustache ? { mustache: true } : null,
      seed: seed
    };
    if (cfg.backpack != null) acc.splice(acc.indexOf('backpack'), 1);
    // LEGFIX D: shoe family per archetype — duty boots for the
    // uniformed and the dockyard trades, sandals for the shore
    // and market crowd, heels for some women, sneakers for the
    // rest. Rolled LAST from the rng stream so no earlier pick
    // in this function moves.
    var shoeType = 'sneaker';
    if (arch.id === 'patrol' || arch.id === 'swat' ||
        arch.id === 'pekerjaDermaga' || arch.id === 'penjagaGudang' || acc.indexOf('policePatch') >= 0) shoeType = 'boot';
    else if (arch.id === 'nelayan' || arch.id === 'pedagang' || arch.id === 'warung' ||
             arch.id === 'turis' || arch.id === 'pasangan') shoeType = 'sandal';
    else if (cfg.female && r() < 0.35) shoeType = 'heel';
    else if (cfg.bottomType === 'shorts' && r() < 0.4) shoeType = 'sandal';
    cfg.shoeType = shoeType;
    return cfg;
  }

  // ---- far silhouettes (LOD 2): one InstancedMesh of slim
  // lathe silhouettes, per-instance colour = the character's top.
  // Profile re-derived for the semi-realistic proportions: slim
  // legs, narrow waist, small head at the top (0.86-1.0).
  var FAR_MAX = 160;
  var farMesh = null, farDummy = null, farColor = null;
  function ensureFar() {
    if (farMesh) return;
    var pts = [];
    // PROPFIX: silhouette landmarks follow the new skeleton —
    // legs 47% (waist line at 0.47, hip mass wider at ~0.53,
    // shoulder mass at 0.70).
    var prof = [[0.001, 0], [0.092, 0], [0.077, 0.08], [0.062, 0.28], [0.112, 0.47], [0.136, 0.53], [0.146, 0.70], [0.122, 0.81], [0.035, 0.85], [0.058, 0.92], [0.055, 1.0], [0.001, 1.0]];
    for (var i = 0; i < prof.length; i++) pts.push(new THREE.Vector2(prof[i][0], prof[i][1]));
    var g = new THREE.LatheGeometry(pts, 7);
    farMesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff }), FAR_MAX);
    farMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    farMesh.count = 0; farMesh.frustumCulled = false;
    farDummy = new THREE.Object3D();
    farColor = new THREE.Color();
  }

  var pool = new Map(); // key -> char[] (detached, reusable)
  var active = [];      // chars currently handed out
  var rimLevel = 1;     // legacy store (rim shells retired)

  function keyOf(archId, seed) { return archId + '|' + seed; }

  function makeSetLOD(char) {
    return function (level) {
      char.lod = level;
      if (level === 2) { char.group.visible = false; return; }
      char.group.visible = true;
      var simple = level === 1;
      // PROPFIX (Bos point 10): outlines stay VISIBLE at LOD 1 —
      // the silhouette line must read at medium distance too.
      // (LOD 2 hides the whole group anyway.)
      for (var i = 0; i < char.outlines.length; i++) char.outlines[i].visible = true;
      for (var j = 0; j < char.lod1Hide.length; j++) char.lod1Hide[j].visible = !simple;
      if (char.blob) char.blob.visible = true;
    };
  }
  function countTris(char) {
    var tris = 0;
    char.group.traverse(function (o) {
      if (o.isMesh && o.geometry) {
        var g = o.geometry;
        tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      }
    });
    return Math.round(tris);
  }

  var Factory = {
    SKIN_TONES: SKIN_TONES,
    HAIR_COLORS: HAIR_COLORS,
    rng: rng,
    active: active,
    getRimLevel: function () { return rimLevel; },
    setRimLevel: function (v) { rimLevel = v; },

    create: function (archOrId, seed) {
      var arch = typeof archOrId === 'string' ? SH.Archetypes[archOrId] : archOrId;
      if (!arch) throw new Error('CharFactory: unknown archetype ' + archOrId);
      seed = seed == null ? 1 : seed;
      var key = keyOf(arch.id || 'custom', seed);
      var char;
      var bucket = pool.get(key);
      if (bucket && bucket.length) {
        char = bucket.pop();
      } else {
        var cfg = toConfig(arch, seed);
        char = SH.ToonChar.createCharacter(cfg); // the toon char IS the char
        char.group = char.root;
        char.bones = char.pivots;
        char.params = { H: cfg.height };
        char.wear = arch.wear || {};
        char.farColor = cfg.top;
        char.setLOD = makeSetLOD(char);
        char._farIdx = -1;
        char._lod = -1;
        char.triCount = countTris(char);
      }
      char.archetype = arch; // consumers read char.archetype.id
      char.seed = seed;
      char.inUse = true;
      char._dead = false;
      char.group.visible = true;
      if (char._pistolMesh) char._pistolMesh.visible = false;
      if (char._weaponMeshes) for (var wk in char._weaponMeshes) char._weaponMeshes[wk].visible = false;
      if (active.indexOf(char) < 0) active.push(char);
      return char;
    },

    release: function (char) {
      if (!char || !char.inUse) return;
      char.inUse = false;
      var i = active.indexOf(char);
      if (i >= 0) active.splice(i, 1);
      if (char._pistolMesh) char._pistolMesh.visible = false;
      if (char._weaponMeshes) for (var wk2 in char._weaponMeshes) char._weaponMeshes[wk2].visible = false;
      if (char.group.parent) char.group.parent.remove(char.group);
      char.group.visible = false;
      var key = keyOf(char.archetype.id || 'custom', char.seed);
      if (!pool.has(key)) pool.set(key, []);
      pool.get(key).push(char);
    },

    // Per-frame LOD: full detail < 15 m, simplified 15-40 m
    // (outlines + micro parts off), instanced silhouette beyond.
    // Called by pedestrians.js with the camera every frame.
    update: function (camera, scene) {
      ensureFar();
      if (scene && !farMesh.parent) scene.add(farMesh);
      var cp = camera.position, farCount = 0;
      for (var i = 0; i < active.length; i++) {
        var ch = active[i];
        if (!ch.group.parent) continue;
        var d = cp.distanceTo(ch.group.position);
        var lod = d < 15 ? 0 : d < 40 ? 1 : 2;
        if (lod !== ch._lod) { ch._lod = lod; ch.setLOD(lod); }
        if (lod === 2 && farCount < FAR_MAX) {
          farDummy.position.copy(ch.group.position);
          farDummy.position.y -= 0.02; // group origin sits at ground-0.02
          farDummy.quaternion.copy(ch.group.quaternion);
          farDummy.scale.setScalar(ch.params.H);
          farDummy.updateMatrix();
          farMesh.setMatrixAt(farCount, farDummy.matrix);
          farMesh.setColorAt(farCount, farColor.setHex(ch.farColor));
          farCount++;
        }
      }
      farMesh.count = farCount;
      if (farCount) {
        farMesh.instanceMatrix.needsUpdate = true;
        if (farMesh.instanceColor) farMesh.instanceColor.needsUpdate = true;
      }
    },

    // The sidearm (POLISH2, spec A6): a real little gun — slide,
    // muzzle block, frame, sights, trigger guard and a raked
    // grip — in dark gunmetal toon shades. The old build was two
    // near-white boxes with toneMapped/fog off: from behind it
    // read as a white bar, the panel's recurring "white streak"
    // complaint. combat.js syncs the equipped prop through
    // syncWeapon below; shots.js attaches it on photo sets.
    //
    // POLISH2D (2026-11-23, Bos: "PISTOL KEGEDEAN, TIDAK
    // REALISTIS"): the honest measurement that forced this
    // rebuild — the POLISH2B build authored its pieces in an
    // arbitrary unit space (span 0.064) and scaled the group
    // x3.44 AS IF handR space were metres. It is not: the rig is
    // height-normalised (root.scale = cfg.height, 1.75 for Raka),
    // so the world received 3.44 x 1.75 = 6.02x and the probe
    // measured the "0.22 m" pistol at 0.4125 m long x 0.303 m
    // high x 0.0722 m wide in the combat scene (0.444 m long on
    // a taller patrol build, H 1.884) — longer than the head is
    // tall (head AABB 0.32-0.35 m), ~2.3x the 0.172-0.178 m hand.
    // Double scaling, parent scale x weapon scale, exactly the
    // failure mode Bos named. THE FIX AT THE SOURCE: pieces are
    // now authored in TRUE METRES (pistol 0.20 x 0.14 x 0.03,
    // world scale 1.0 — no readability enlargement) and the
    // group carries scale 1/H, which cancels the rig's root
    // height scale for ANY character, so the prop is the same
    // real-world size in every hand. The grip seat is preserved
    // analytically: the old build's grip centre sat at
    // (0, -0.0329, -0.009) in handR units; gun.position below is
    // solved so the new grip centre lands on that same point
    // (pos = target - Rx(PI/2) * (gripCentre * s), s = 1/H).
    attachPistol: function (char) {
      return this.syncWeapon(char, 'pistol');
    },

    // POLISH2D: the equipped-weapon prop sync — the single
    // source every consumer goes through (combat.js on equip,
    // shots.js on photo sets). kind: 'pistol' | 'smg' |
    // 'shotgun' | null (fist / holstered). Before this round the
    // SMG and the shotgun had NO prop at all: giveWeapon changed
    // nothing in handR (probe-verified — identical children,
    // no _smgMesh/_shotgunMesh), and in live play no gun prop
    // was ever attached. All three props are authored in true
    // metres at world scale 1.0: pistol L 0.20, SMG L 0.45,
    // shotgun L 0.95. (The SWAT/heist 'rifle' accessory in
    // toon.js was measured too: authored in rig units, it lands
    // at 0.773 m on the H 1.84 SWAT build — already true to
    // real-world rifle logic, left untouched.)
    syncWeapon: function (char, kind) {
      if (!char._weaponMeshes) char._weaponMeshes = {};
      var built = char._weaponMeshes;
      for (var k in built) built[k].visible = false;
      if (!kind) { char._weaponKind = null; return null; }
      if (!built[kind]) built[kind] = Factory._buildGun(char, kind);
      built[kind].visible = true;
      char._weaponKind = kind;
      if (kind === 'pistol') char._pistolMesh = built[kind];
      return built[kind];
    },

    // Gun builder shared by all three props. Local axes (before
    // the group's rotation.x = PI/2): +z = barrel direction,
    // +y = up, origin solved from the grip centre (see above).
    _buildGun: function (char, kind) {
      var mSlide = new THREE.MeshToonMaterial({ color: 0x2b2d33, gradientMap: SH.ToonChar.gradientMap });
      var mDark = new THREE.MeshToonMaterial({ color: 0x17181c, gradientMap: SH.ToonChar.gradientMap });
      // The thin rim-light edge along the slide: readability
      // comes from this bright line, never from size (Bos spec).
      var mEdge = new THREE.MeshToonMaterial({ color: 0x9aa4ae, gradientMap: SH.ToonChar.gradientMap });
      var gun = new THREE.Group();
      var pieces = [];
      function piece(w, h, d, mat, x, y, z, rx) {
        var p = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        p.position.set(x, y, z);
        if (rx) p.rotation.x = rx;
        gun.add(p); pieces.push(p); return p;
      }
      var gripC; // grip centre, metres, gun-local — the seat anchor
      if (kind === 'pistol') {
        // 9mm pistol: L 0.20 (z -0.060..0.140), H 0.14
        // (y -0.105..0.035), W 0.03. Length = 1.1x the measured
        // 0.178 m hand, well under the 0.32-0.35 m head.
        piece(0.030, 0.092, 0.042, mDark, 0, -0.055, -0.030, 0.22);  // grip, raked
        piece(0.028, 0.030, 0.168, mSlide, 0, 0.012, 0.024, 0);      // slide
        piece(0.024, 0.026, 0.036, mDark, 0, 0.010, 0.122, 0);       // muzzle block
        piece(0.024, 0.020, 0.088, mDark, 0, -0.012, 0.008, 0);      // frame / dust cover
        piece(0.006, 0.008, 0.008, mSlide, 0, 0.031, 0.098, 0);      // front sight
        piece(0.024, 0.008, 0.010, mSlide, 0, 0.029, -0.046, 0);     // rear sight
        piece(0.006, 0.024, 0.044, mDark, 0, -0.030, 0.016, 0);      // trigger guard
        piece(0.029, 0.003, 0.164, mEdge, 0, 0.0285, 0.024, 0);      // slide top rim edge
        gripC = { y: -0.055, z: -0.030 };
      } else if (kind === 'smg') {
        // SMG: L 0.45 (z -0.100..0.350).
        piece(0.030, 0.052, 0.095, mDark, 0, -0.002, -0.052, 0);      // stock
        piece(0.036, 0.058, 0.235, mSlide, 0, 0.008, 0.062, 0);      // receiver
        piece(0.024, 0.028, 0.115, mDark, 0, 0.016, 0.232, 0);       // barrel shroud
        piece(0.019, 0.019, 0.065, mDark, 0, 0.016, 0.317, 0);       // muzzle
        piece(0.026, 0.105, 0.040, mDark, 0, -0.072, 0.028, 0.15);   // magazine
        piece(0.028, 0.082, 0.038, mDark, 0, -0.052, -0.038, 0.22);  // grip, raked
        piece(0.005, 0.010, 0.007, mSlide, 0, 0.042, 0.255, 0);      // front sight
        piece(0.022, 0.008, 0.009, mSlide, 0, 0.040, -0.030, 0);     // rear sight
        piece(0.037, 0.003, 0.230, mEdge, 0, 0.0385, 0.062, 0);      // receiver top rim edge
        gripC = { y: -0.052, z: -0.038 };
      } else { // shotgun
        // Shotgun: L 0.95 (z -0.170..0.780).
        piece(0.034, 0.078, 0.155, mDark, 0, -0.008, -0.092, 0.10);   // stock + grip
        piece(0.038, 0.062, 0.290, mSlide, 0, 0.006, 0.128, 0);      // receiver
        piece(0.026, 0.026, 0.470, mSlide, 0, 0.026, 0.505, 0);      // barrel
        piece(0.029, 0.029, 0.045, mDark, 0, 0.026, 0.757, 0);       // muzzle
        piece(0.020, 0.020, 0.430, mDark, 0, -0.004, 0.480, 0);      // tube magazine
        piece(0.034, 0.036, 0.115, mDark, 0, -0.004, 0.330, 0);      // pump
        piece(0.005, 0.007, 0.005, mSlide, 0, 0.042, 0.735, 0);      // bead sight
        piece(0.039, 0.003, 0.285, mEdge, 0, 0.0385, 0.128, 0);      // receiver top rim edge
        gripC = { y: -0.048, z: -0.022 };
      }
      // Legacy contract: _pistolMesh.material reads/writes as if
      // the gun were one mesh — forward the swap to every part.
      var matRef = { current: mSlide };
      Object.defineProperty(gun, 'material', {
        get: function () { return matRef.current; },
        set: function (m) { matRef.current = m; for (var i = 0; i < pieces.length; i++) pieces[i].material = m; }
      });
      gun.traverse(function (o) { o.castShadow = true; });
      // World scale 1.0: cancel the rig's root height scale.
      var s = 1 / ((char.params && char.params.H) || 1);
      gun.scale.setScalar(s);
      gun.rotation.x = Math.PI / 2;
      // Seat: grip centre lands on the handR point the old build
      // held, (0, -0.0329, -0.009) rig units — solved, not eyed.
      gun.position.set(0, -0.0329 + gripC.z * s, -0.009 - gripC.y * s);
      char.bones.handR.add(gun);
      gun.visible = false;
      return gun;
    }
  };

  SH.CharFactory = Factory;
})(window.SH = window.SH || {});
