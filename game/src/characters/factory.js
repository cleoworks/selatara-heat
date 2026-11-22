// SELATARA HEAT — characters/factory.js  (TOON ADAPTER)
// The character factory, rebuilt on the toon system (toon.js).
// Every character is now SH.ToonChar.createCharacter: a chunky
// flat low-poly figure (head ~1/3 of height, MeshToonMaterial,
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
    var build = 'avg';
    if ((body.belly || 0) >= 0.3 || (body.shoulder || 1) >= 1.12 || (body.hips || 1) >= 1.10) build = 'stocky';
    else if ((body.shoulder || 1) <= 0.95) build = 'slim';
    if (H < 1.45) build = 'kid';
    var acc = (wear.accessories || []).slice();
    var cfg = {
      height: H,
      build: build,
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
      bottomType: bottom.type === 'shorts' ? 'shorts' : (bottom.type === 'skirt' ? 'skirt' : 'long'),
      backpack: acc.indexOf('backpack') >= 0 ? 0x6e4a26 : null,
      handColor: body.handColor != null ? body.handColor : null,
      accessories: acc,
      face: faceA.mustache ? { mustache: true } : null,
      seed: seed
    };
    if (cfg.backpack != null) acc.splice(acc.indexOf('backpack'), 1);
    return cfg;
  }

  // ---- far silhouettes (LOD 2): one InstancedMesh of chunky
  // lathe silhouettes, per-instance colour = the character's top.
  var FAR_MAX = 160;
  var farMesh = null, farDummy = null, farColor = null;
  function ensureFar() {
    if (farMesh) return;
    var pts = [];
    var prof = [[0.001, 0], [0.115, 0], [0.10, 0.10], [0.075, 0.30], [0.125, 0.36], [0.135, 0.60], [0.10, 0.66], [0.035, 0.68], [0.115, 0.75], [0.125, 0.90], [0.001, 1.0]];
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
      for (var i = 0; i < char.outlines.length; i++) char.outlines[i].visible = !simple;
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
      if (active.indexOf(char) < 0) active.push(char);
      return char;
    },

    release: function (char) {
      if (!char || !char.inUse) return;
      char.inUse = false;
      var i = active.indexOf(char);
      if (i >= 0) active.splice(i, 1);
      if (char._pistolMesh) char._pistolMesh.visible = false;
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

    // The sidearm: two merged boxes in the right hand, in unit
    // space (legacy proportions of the retired rig). combat.js
    // shows/hides char._pistolMesh; shots.js restages its scale
    // and material on the combat photo set.
    attachPistol: function (char) {
      if (char._pistolMesh) { char._pistolMesh.visible = true; return char._pistolMesh; }
      var gunMat = new THREE.MeshToonMaterial({ color: 0xb9c1cc, gradientMap: SH.ToonChar.gradientMap });
      gunMat.toneMapped = false; gunMat.fog = false;
      var gun = new THREE.Group();
      var g1 = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.026, 0.017), gunMat);
      g1.position.set(0, -0.016, 0.002);
      var g2 = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.014, 0.066), gunMat);
      g2.position.set(0, 0.002, 0.026);
      gun.add(g1); gun.add(g2);
      // Legacy contract: _pistolMesh.material reads/writes as if
      // the gun were one mesh (shots.js staging swaps the staged
      // gun's material mesh-locally) — forward it to both boxes.
      var matRef = { current: gunMat };
      Object.defineProperty(gun, 'material', {
        get: function () { return matRef.current; },
        set: function (m) { matRef.current = m; g1.material = m; g2.material = m; }
      });
      gun.traverse(function (o) { o.castShadow = true; });
      gun.position.set(0, -0.030, 0.016);
      gun.rotation.x = Math.PI / 2;
      gun.scale.setScalar(1.55);
      char.bones.handR.add(gun);
      char._pistolMesh = gun;
      return gun;
    }
  };

  SH.CharFactory = Factory;
})(window.SH = window.SH || {});
