// SELATARA HEAT — roads.js
// Ground, water, beach, road/sidewalk meshes with canvas asphalt markings, and
// streetlight positions (instanced by buildings.js props pass in main scene).
// Public API: SH.Roads { build(scene), lampPositions[], update(dt) for waves }.
(function (SH) {
  'use strict';

  function asphaltTexture() {
    var c = document.createElement('canvas'); c.width = 128; c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#3d3835'; g.fillRect(0, 0, 128, 128);
    var rng = SH.World.makeRng(77);
    // OVERHAUL: the aggregate grain doubles in contrast (alphas
    // 0.035/0.055 -> 0.08/0.11). At the old values the texture was
    // technically present but photographically absent — the road
    // read as one flat grey sheet in every judged frame.
    for (var i = 0; i < 3400; i++) {
      g.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.11)';
      g.fillRect(rng() * 128, rng() * 128, 1.6, 1.6);
    }
    // OVERHAUL: polished wheel tracks. Traffic runs two lanes at
    // fixed offsets, so real asphalt darkens in four longitudinal
    // bands where tyres polish it (and lightens slightly between
    // each pair, where grit accumulates). The bands run the full
    // tile height; the UV bake rotates them with the street, so
    // they stay longitudinal in both orientations. Soft edges via
    // layered strokes of falling alpha.
    function trackBand(cx) {
      for (var tw = 11; tw > 0; tw -= 2.5) {
        g.fillStyle = 'rgba(10,9,10,' + (0.028 + (11 - tw) * 0.006) + ')';
        g.fillRect(cx - tw, 0, tw * 2, 128);
      }
      g.fillStyle = 'rgba(235,230,220,0.045)';
      g.fillRect(cx - 1.5, 0, 3, 128);
    }
    trackBand(31); trackBand(97);
    g.fillStyle = 'rgba(255,255,255,0.03)';
    g.fillRect(44, 0, 40, 128); // gritty crown between the lanes
    // Repair patches: darker rectangles with soft edges.
    for (var p = 0; p < 8; p++) {
      var px = rng() * 96, py = rng() * 96, pw = 18 + rng() * 26, ph = 12 + rng() * 22;
      g.fillStyle = 'rgba(12,10,12,0.16)';
      g.fillRect(px - 2, py - 2, pw + 4, ph + 4);
      g.fillStyle = 'rgba(10,9,11,0.22)';
      g.fillRect(px, py, pw, ph);
    }
    // OVERHAUL: oil stains — soft dark radial blooms, the kind a
    // port city's junctions collect. Two per tile, kept off the
    // edge lines so the markings stay clean.
    for (var os = 0; os < 2; os++) {
      var ox = 24 + rng() * 80, oy = rng() * 128, orad = 7 + rng() * 9;
      var og = g.createRadialGradient(ox, oy, 1, ox, oy, orad);
      og.addColorStop(0, 'rgba(8,8,12,0.34)');
      og.addColorStop(0.7, 'rgba(8,8,12,0.16)');
      og.addColorStop(1, 'rgba(8,8,12,0)');
      g.fillStyle = og;
      g.fillRect(ox - orad, oy - orad, orad * 2, orad * 2);
    }
    // Hairline cracks.
    g.strokeStyle = 'rgba(8,8,10,0.35)'; g.lineWidth = 1;
    for (var cr = 0; cr < 3; cr++) {
      g.beginPath();
      var cx0 = rng() * 128, cy0 = rng() * 128;
      g.moveTo(cx0, cy0);
      for (var cs = 0; cs < 4; cs++) { cx0 += (rng() - 0.5) * 22; cy0 += rng() * 14; g.lineTo(cx0, cy0); }
      g.stroke();
    }
    // Edge lines (the texture spans the full road width).
    g.fillStyle = 'rgba(240,240,235,0.55)';
    g.fillRect(3, 0, 2.4, 128); g.fillRect(122.6, 0, 2.4, 128);
    // Centre dashes, brighter and chunkier.
    g.fillStyle = '#f7d95e';
    for (var y = 6; y < 128; y += 32) g.fillRect(60.5, y, 7, 19);
    var t = new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }

  function groundTexture() {
    var c = document.createElement('canvas'); c.width = c.height = 512;
    var g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 512, 512);
    var rng = SH.World.makeRng(31);
    // Large soft blotches (Rev 6): three grass tones + dry dirt, so
    // open ground reads as patchy terrain, not one flat colour.
    // OVERHAUL: blotch + speckle contrast raised ~30% — same
    // reasoning as the asphalt: present-but-invisible texture is
    // the same as no texture at judge scale.
    // ROUND 3: contrast raised again for the evening scenes — at dusk
    // the grass base darkens toward the characters' shadow tones and
    // the cast merged into it; stronger light/dry patches keep the
    // ground visually separate from the figures standing on it.
    var tones = ['rgba(38,74,26,0.34)', 'rgba(96,128,44,0.28)', 'rgba(150,132,66,0.23)', 'rgba(122,94,52,0.21)'];
    for (var b = 0; b < 90; b++) {
      var bx = rng() * 512, by = rng() * 512, br = 26 + rng() * 90;
      var gr = g.createRadialGradient(bx, by, 2, bx, by, br);
      gr.addColorStop(0, tones[(rng() * tones.length) | 0]);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    for (var i = 0; i < 12000; i++) {
      var v = rng();
      g.fillStyle = v > 0.6 ? 'rgba(30,60,20,0.26)' : (v > 0.3 ? 'rgba(120,100,50,0.17)' : 'rgba(255,255,220,0.09)');
      g.fillRect(rng() * 512, rng() * 512, 3 + rng() * 9, 3 + rng() * 9);
    }
    // POLISH2B (item 4): fine TWO-TONE blade grain on top of the
    // blotches — thousands of short strokes in a deep green and a
    // sunlit green. The old texture stopped at soft blotches +
    // chunky speckles, which at gameplay distance averaged into
    // the "green blur" the panel kept naming; the blade strokes
    // keep a directional grain at every zoom. (The tuft geometry
    // in landmarks.js carries the same read into 3D.)
    for (var bi2 = 0; bi2 < 9000; bi2++) {
      var bv = rng();
      g.strokeStyle = bv > 0.5 ? 'rgba(24,52,16,0.5)' : 'rgba(126,168,74,0.42)';
      g.lineWidth = 1.4;
      var bxx = rng() * 512, byy = rng() * 512, lean = (rng() - 0.5) * 2.4;
      g.beginPath(); g.moveTo(bxx, byy); g.lineTo(bxx + lean, byy - 3.5 - rng() * 3); g.stroke();
    }
    var t = new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(34, 30);
    t.anisotropy = 4;
    return t;
  }

  // OVERHAUL: the beach was the last big untextured surface — a
  // plain Lambert ribbon in palette sand. It now carries a fine
  // grain + wind-ripple streak canvas. The ribbon UVs run u along
  // the shore (x/46) and v across the width, so the texture
  // repeat below lands the grain at ~5 m tiles.
  function sandTexture() {
    var c = document.createElement('canvas'); c.width = c.height = 256;
    var g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
    var rng = SH.World.makeRng(53);
    for (var i = 0; i < 5200; i++) {
      var v = rng();
      g.fillStyle = v > 0.55 ? 'rgba(146,116,66,0.13)' : (v > 0.25 ? 'rgba(255,250,230,0.10)' : 'rgba(105,80,44,0.08)');
      g.fillRect(rng() * 256, rng() * 256, 1.8, 1.8);
    }
    // Wind ripples: soft horizontal arcs, low alpha, offset rows.
    g.strokeStyle = 'rgba(120,94,52,0.10)'; g.lineWidth = 2.4;
    for (var ry = 6; ry < 256; ry += 13) {
      g.beginPath();
      for (var rx = 0; rx <= 256; rx += 16) {
        var yy = ry + Math.sin((rx + ry * 3) * 0.05) * 2.4;
        if (rx === 0) g.moveTo(rx, yy); else g.lineTo(rx, yy);
      }
      g.stroke();
    }
    // Scattered shell/pebble flecks.
    for (var s2 = 0; s2 < 130; s2++) {
      g.fillStyle = rng() > 0.5 ? 'rgba(255,252,244,0.35)' : 'rgba(90,70,44,0.28)';
      g.fillRect(rng() * 256, rng() * 256, 2.2, 1.4);
    }
    var t = new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(10, 6);
    t.anisotropy = 4;
    return t;
  }

  // Sidewalk slab (Rev 6): a raised kerb block in the same local frame
  // as the old walk planes (XY, +Z up) — textured top at z=h with the
  // paving repeat baked in, plain shaded sides dropping to the ground,
  // so streets get a real kerb step instead of a painted strip.
  function slabGeo(w, len, h, rep) {
    var hw = w / 2, hl = len / 2, zb = -0.06;
    var pos = [], uv = [], col = [], idx = [];
    function quad(a, b, c, d, uvs, shade) {
      var base = pos.length / 3;
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
      for (var q = 0; q < 4; q++) { uv.push(uvs[q * 2], uvs[q * 2 + 1]); col.push(shade, shade, shade); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    quad([-hw, -hl, h], [hw, -hl, h], [hw, hl, h], [-hw, hl, h], [0, 0, 1, 0, 1, rep, 0, rep], 1);
    var S = 0.62;
    quad([-hw, -hl, zb], [-hw, -hl, h], [-hw, hl, h], [-hw, hl, zb], [0, 0, 0, 0, 0, 0, 0, 0], S);
    quad([hw, hl, zb], [hw, hl, h], [hw, -hl, h], [hw, -hl, zb], [0, 0, 0, 0, 0, 0, 0, 0], S);
    quad([-hw, hl, zb], [-hw, hl, h], [hw, hl, h], [hw, hl, zb], [0, 0, 0, 0, 0, 0, 0, 0], S * 0.9);
    quad([hw, -hl, zb], [hw, -hl, h], [-hw, -hl, h], [-hw, -hl, zb], [0, 0, 0, 0, 0, 0, 0, 0], S * 0.9);
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  function walkTexture() {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#cfc4b4'; g.fillRect(0, 0, 128, 128);
    var rng = SH.World.makeRng(97);
    // Sixteen paving modules per tile (junction-cleanup pass: the
    // old 2x2 read as giant ceramic tiles) — each module carries
    // its own tint, a soft bevel and grout at every quarter, so
    // the pavement reads as small sett paving, not floor tiles.
    for (var sy = 0; sy < 4; sy++) {
      for (var sx = 0; sx < 4; sx++) {
        var tint = (rng() - 0.5) * 0.16;
        g.fillStyle = tint > 0 ? 'rgba(255,250,235,' + tint + ')' : 'rgba(40,30,20,' + (-tint) + ')';
        g.fillRect(sx * 32 + 1, sy * 32 + 1, 30, 30);
        g.fillStyle = 'rgba(255,255,255,0.10)';
        g.fillRect(sx * 32 + 1, sy * 32 + 1, 30, 2);
        g.fillRect(sx * 32 + 1, sy * 32 + 1, 2, 30);
        g.fillStyle = 'rgba(50,40,30,0.18)';
        g.fillRect(sx * 32 + 1, sy * 32 + 29, 30, 2);
      }
    }
    for (var i = 0; i < 900; i++) {
      g.fillStyle = rng() > 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
      g.fillRect(rng() * 128, rng() * 128, 1.6, 1.6);
    }
    g.strokeStyle = 'rgba(60,50,40,0.55)'; g.lineWidth = 2;
    g.strokeRect(1, 1, 126, 126);
    g.beginPath();
    for (var gl = 32; gl < 128; gl += 32) { g.moveTo(gl, 0); g.lineTo(gl, 128); g.moveTo(0, gl); g.lineTo(128, gl); }
    g.stroke();
    var t = new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }

  var Roads = {
    lampPositions: [],
    waveMeshes: [],
    // LEGFIX A: walkable-surface registry, filled during build —
    // rects {cx, cz, ux, uz, hl, hw, top} (road ribbons, sidewalk
    // slabs, zebra/stop bars, bridge decks) and caps {cx, cz, r,
    // top} (junction fans), indexed by a 6 m grid. Bare ground
    // (the base plane) sits at -0.08 and is the no-match default.
    surfaces: [],
    _surfAll: [],
    _grid: null,

    groundHeightAt: function (x, z) {
      var g = this._grid;
      if (!g) return 0;
      var list = g[(Math.floor(x / 6) + 512) + (Math.floor(z / 6) + 512) * 2048];
      var best = -0.08;
      if (!list) return best;
      var all = this._surfAll;
      for (var i = 0; i < list.length; i++) {
        var s = all[list[i]];
        var dx = x - s.cx, dz = z - s.cz;
        if (s.r) {
          if (dx * dx + dz * dz <= s.r * s.r && s.top > best) best = s.top;
        } else {
          var al = dx * s.ux + dz * s.uz, sd = dx * s.uz - dz * s.ux;
          if (Math.abs(al) <= s.hl && Math.abs(sd) <= s.hw && s.top > best) best = s.top;
        }
      }
      return best;
    },

    _buildGroundGrid: function () {
      var all = this.surfaces, grid = {}, CELL = 6;
      function put(idx, x0, z0, x1, z1) {
        var ix0 = Math.floor(x0 / CELL), ix1 = Math.floor(x1 / CELL);
        var iz0 = Math.floor(z0 / CELL), iz1 = Math.floor(z1 / CELL);
        for (var ix = ix0; ix <= ix1; ix++) for (var iz = iz0; iz <= iz1; iz++) {
          var k = (ix + 512) + (iz + 512) * 2048;
          (grid[k] || (grid[k] = [])).push(idx);
        }
      }
      for (var i = 0; i < all.length; i++) {
        var s = all[i];
        if (s.r) { put(i, s.cx - s.r, s.cz - s.r, s.cx + s.r, s.cz + s.r); continue; }
        var ex = Math.abs(s.ux) * s.hl + Math.abs(s.uz) * s.hw;
        var ez = Math.abs(s.uz) * s.hl + Math.abs(s.ux) * s.hw;
        put(i, s.cx - ex, s.cz - ez, s.cx + ex, s.cz + ez);
      }
      this._surfAll = all;
      this._grid = grid;
    },

    // FIX03 (user item 2): late surface registration. Roads.build
    // indexes the grid BEFORE Buildings.build runs (main.js order),
    // so floors built by Buildings (the night-market pad and its
    // mats) could never enter groundHeightAt — every character in
    // the market stood rooted to the buried grass level (-0.08)
    // while the visible pad top sits at +0.070, sinking every sole
    // ~0.15 m and burying every blob shadow with them. A builder
    // that raises a real floor now registers it here; the surface
    // joins the same grid groundHeightAt reads.
    registerSurface: function (s) {
      this.surfaces.push(s);
      if (!this._grid) return; // pre-build: _buildGroundGrid indexes it later
      var idx = this._surfAll.length;
      this._surfAll.push(s);
      var CELL = 6, grid = this._grid;
      var x0, z0, x1, z1;
      if (s.r) { x0 = s.cx - s.r; x1 = s.cx + s.r; z0 = s.cz - s.r; z1 = s.cz + s.r; }
      else {
        var ex = Math.abs(s.ux) * s.hl + Math.abs(s.uz) * s.hw;
        var ez = Math.abs(s.uz) * s.hl + Math.abs(s.ux) * s.hw;
        x0 = s.cx - ex; x1 = s.cx + ex; z0 = s.cz - ez; z1 = s.cz + ez;
      }
      var ix0 = Math.floor(x0 / CELL), ix1 = Math.floor(x1 / CELL);
      var iz0 = Math.floor(z0 / CELL), iz1 = Math.floor(z1 / CELL);
      for (var ix = ix0; ix <= ix1; ix++) for (var iz = iz0; iz <= iz1; iz++) {
        var k = (ix + 512) + (iz + 512) * 2048;
        (grid[k] || (grid[k] = [])).push(idx);
      }
    },

    build: function (scene) {
      var cfg = SH.Config.world;
      var pal = SH.Config.palette.day;

      // Base ground (grass/earth under everything) with a mottled texture so
      // open ground never reads as one flat colour.
      var ground = new THREE.Mesh(
        new THREE.PlaneGeometry(cfg.halfX * 2 + 400, cfg.halfZ * 2 + 400),
        new THREE.MeshLambertMaterial({ color: pal.grass, map: groundTexture() })
      );
      ground.rotation.x = -Math.PI / 2; ground.position.y = -0.08;
      ground.receiveShadow = true;
      ground.name = 'ground';
      scene.add(ground);
      this.groundMesh = ground;

      // Shore ribbons (Art Pass 3): sand, shallow water and foam all follow
      // the organic coastZ(x) curve — bays and headlands instead of the old
      // straight ruler line at z=waterZ.
      // Offsets may be functions of x (Rev 6): the sand width breathes
      // along the shore, and the foam edges are scalloped by sine sums
      // instead of running as ruler-straight strips.
      function coastRibbon(offNear, offFar, y, mat, step) {
        var xs2 = [];
        step = step || 24;
        for (var rx = -860; rx <= 860; rx += step) xs2.push(rx);
        var posArr = new Float32Array(xs2.length * 2 * 3);
        var uvArr = new Float32Array(xs2.length * 2 * 2);
        var idx = [];
        for (var vi = 0; vi < xs2.length; vi++) {
          var vx = xs2[vi], cz = SH.World.coastZ(vx);
          var on2 = typeof offNear === 'function' ? offNear(vx) : offNear;
          var of2 = offFar === null ? 820 : cz + (typeof offFar === 'function' ? offFar(vx) : offFar);
          posArr.set([vx, y, cz + on2, vx, y, of2], vi * 6);
          uvArr.set([vx / 46, 0, vx / 46, 1], vi * 4);
          if (vi > 0) {
            var b0 = (vi - 1) * 2;
            idx.push(b0, b0 + 1, b0 + 2, b0 + 1, b0 + 3, b0 + 2);
          }
        }
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        var mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        scene.add(mesh);
        return mesh;
      }
      // Sand ribbon with a breathing width (Rev 6): 47-73 m of beach
      // depending on the bay, not one uniform strip.
      var sand = coastRibbon(function (x) { return -(54 + 12 * Math.sin(x * 0.009 + 1.7) + 7 * Math.sin(x * 0.023 + 0.4)); }, 8, -0.025, new THREE.MeshLambertMaterial({ color: pal.sand, map: sandTexture() }));
      this.sandMesh = sand;
      // Wet-sand band at the waterline: darker, with a specular sheen.
      var wetMat = new THREE.MeshPhongMaterial({ color: 0x8a6f4d, shininess: 70, specular: 0x776644 });
      coastRibbon(0.5, 9.5, -0.018, wetMat);

      // Sea: the big deep plane plus a shore ribbon whose vertex
      // colours grade from pale shallow (with alpha fade at the very
      // edge) to the palette's deep water (Rev 6), so the shallows
      // read as shallows instead of one flat blue.
      // OVERHAUL: specular tightened (90 -> 150) and brightened —
      // the sea at golden hour should carry a hard sun glitter
      // path, not a broad matte sheen.
      var waterMat = new THREE.MeshPhongMaterial({ color: pal.water, shininess: 150, specular: 0xd6f2ff, transparent: true, opacity: 0.94 });
      var water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), waterMat);
      water.rotation.x = -Math.PI / 2;
      water.position.set(0, -0.55, cfg.waterZ + 1750);
      scene.add(water);
      this.waterMesh = water;
      var shoreMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 90, specular: 0x99ddff, transparent: true, vertexColors: true });
      var shoreMesh = coastRibbon(-6, 380, -0.045, shoreMat);
      this._paintShore = function (pal2) {
        var geo = shoreMesh.geometry;
        var uv = geo.attributes.uv, n = uv.count;
        var arr = new Float32Array(n * 4);
        var deep = new THREE.Color(pal2.water);
        var shal = deep.clone().lerp(new THREE.Color(0xbfeef5), 0.55);
        var cTmp = new THREE.Color();
        for (var vi2 = 0; vi2 < n; vi2++) {
          var v = uv.getY(vi2);
          cTmp.copy(shal).lerp(deep, Math.min(1, v * 1.6));
          arr[vi2 * 4] = cTmp.r; arr[vi2 * 4 + 1] = cTmp.g; arr[vi2 * 4 + 2] = cTmp.b;
          arr[vi2 * 4 + 3] = 0.55 + 0.45 * Math.min(1, v * 3);
        }
        geo.setAttribute('color', new THREE.BufferAttribute(arr, 4));
      };
      this._paintShore(pal);

      // Foam lines creeping on the curved shore — scalloped geometry
      // now (Rev 6): each ribbon's edges wobble with two sine waves at
      // an 8 m sampling step, so the waterline looks eaten by waves.
      var foamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
      for (var w = 0; w < 3; w++) {
        (function (w2) {
          function foamOff(base) {
            return function (x) { return base + w2 * 6.5 + 1.3 * Math.sin(x * 0.13 + w2 * 2.1) + 0.7 * Math.sin(x * 0.031 + w2); };
          }
          var foam = coastRibbon(foamOff(1.2), foamOff(3.6), 0.02, foamMat, 8);
          foam.receiveShadow = false;
          this.waveMeshes.push(foam);
        }).call(this, w);
      }

      // Taman Arus canal: a straight water cut from the park pond to the
      // sea, slipping under the streets (their y=0 decks read as bridges).
      var canalBank = new THREE.Mesh(new THREE.PlaneGeometry(13.5, 252), new THREE.MeshLambertMaterial({ color: 0x4a3d2c }));
      canalBank.rotation.x = -Math.PI / 2; canalBank.position.set(0, -0.03, 208);
      scene.add(canalBank);
      var canal = new THREE.Mesh(new THREE.PlaneGeometry(10, 252), waterMat);
      canal.rotation.x = -Math.PI / 2; canal.position.set(0, -0.015, 208);
      scene.add(canal);

      // Roads: one plane per graph edge, textured asphalt with dashes.
      // Axis-aligned edges keep the original fast path; diagonal / coast /
      // island edges go through a general heading path (Art Pass 3), alleys
      // render narrow, and bridge edges get a real deck with rails.
      var tex = asphaltTexture();
      var edges = SH.World.graph.edges, nodes = SH.World.graph.nodes;
      var roadMat = new THREE.MeshPhongMaterial({ map: tex, color: 0xffffff, shininess: 26, specular: 0x8a6a4a });
      this.roadMaterial = roadMat;
      this.roadMaterials = [];
      var walkMat = new THREE.MeshLambertMaterial({ color: pal.sidewalk, map: walkTexture(), vertexColors: true });
      this.walkMaterial = walkMat;
      var deckMat = new THREE.MeshLambertMaterial({ color: 0x6a5f52 });
      var railMat = new THREE.MeshLambertMaterial({ color: 0x8a4a3a });
      var lampEvery = 26;

      // Draw-call diet (Art Bible v2 perf mandate): every road plane and
      // sidewalk is baked into ONE merged mesh per material. The per-edge
      // texture repeat (and the 90-degree texture rotation on horizontal
      // streets) is baked into the UVs — the asphalt texture wraps, and
      // its dash period divides the tile, so the baked result is pixel-
      // identical to the old per-edge materials. Alleys keep their tint
      // as a vertex colour.
      var roadGeos = [], walkGeos = [];
      var medianGeos = [], medianTopGeos = [];
      var medTopMat = new THREE.MeshLambertMaterial({ color: 0x4d8a48 });
      var alleyTint = new THREE.Color(0x9a9186), whiteTint = new THREE.Color(0xffffff);
      function bakeRoadUV(geo, rep, horizontal) {
        var uv = geo.attributes.uv;
        for (var ui = 0; ui < uv.count; ui++) {
          var u = uv.getX(ui), v = uv.getY(ui);
          if (horizontal) uv.setXY(ui, v, rep * (1 - u));
          else uv.setXY(ui, u, rep * v);
        }
        return geo;
      }
      function tintGeo(geo, col) {
        var n = geo.attributes.position.count;
        var arr = new Float32Array(n * 3);
        for (var ti = 0; ti < n; ti++) { arr[ti * 3] = col.r; arr[ti * 3 + 1] = col.g; arr[ti * 3 + 2] = col.b; }
        geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        return geo;
      }
      function collectRoad(mesh, rep, horizontal, tint) {
        mesh.updateMatrix();
        var geo = mesh.geometry.clone().applyMatrix4(mesh.matrix);
        bakeRoadUV(geo, rep, horizontal);
        tintGeo(geo, tint);
        roadGeos.push(geo);
      }

      // ---- Junction cleanup (city-wide audit pass) ------------------
      // The audit found the same defects at every junction type:
      // ribbon ends overlapping with mismatched texture phase (the
      // bright wedges and tone patches), centre dashes running
      // through the junction field, and sidewalk slabs crossing
      // carriageway mouths at T / diagonal / coast junctions. The
      // fix is structural: ribbons stop at the node, ONE cap fan per
      // node (same asphalt, dash-free UV window, +12 mm only as an
      // anti-z-fight epsilon) paves the whole field, and slabs stop
      // at the field edge wherever they would cross another leg.
      var nodeInc = nodes.map(function () { return []; });
      for (var ei0 = 0; ei0 < edges.length; ei0++) {
        var e0 = edges[ei0], na0 = nodes[e0.a], nb0 = nodes[e0.b];
        var ddx = nb0.x - na0.x, ddz = nb0.z - na0.z, ll0 = Math.hypot(ddx, ddz) || 1;
        nodeInc[e0.a].push({ e: ei0, dx: ddx / ll0, dz: ddz / ll0, kind: e0.kind || 'grid' });
        nodeInc[e0.b].push({ e: ei0, dx: -ddx / ll0, dz: -ddz / ll0, kind: e0.kind || 'grid' });
      }
      function halfW(kind) { return kind === 'alley' ? 1.8 : kind === 'bridge' ? 4.8 : kind === 'ring' ? cfg.roadHalf + 1.2 : cfg.roadHalf; }
      var nodeR = nodes.map(function (n, ni) {
        var r = 0;
        for (var q = 0; q < nodeInc[ni].length; q++) r = Math.max(r, halfW(nodeInc[ni][q].kind));
        return r + 0.35;
      });
      function slabInset(ni, ei) {
        var inc = nodeInc[ni], mine = null, hasCont = false, crossLeg = false;
        for (var q = 0; q < inc.length; q++) if (inc[q].e === ei) mine = inc[q];
        if (!mine) return false;
        for (var q2 = 0; q2 < inc.length; q2++) {
          if (inc[q2].e === ei) continue;
          var dot = inc[q2].dx * mine.dx + inc[q2].dz * mine.dz;
          if (dot < -0.82) hasCont = true;                              // continuation (bend <= ~35 deg)
          else if ((dot > 0.30 && dot < 0.90) || (dot > -0.82 && dot < -0.30)) crossLeg = true;
        }
        return !hasCont || crossLeg;
      }
      // Per-side clear test: at an acute junction (avenue meeting the
      // ring at ~36 deg, diagonal crossing a grid leg) a slab that
      // stops nodeR before the node can still land ON the other leg's
      // carriageway, because the slab runs offset toward that leg.
      // Walk the slab-end point back along its own edge until it
      // clears every other leg's carriageway strip (half width +
      // slab half + margin). Returns the required inset.
      function clearInset(ni, ei, ox, oz, offx, offz, baseT, len) {
        var inc = nodeInc[ni], t = baseT;
        for (var q = 0; q < inc.length; q++) {
          if (inc[q].e === ei) continue;
          var d = inc[q], lim = halfW(d.kind) + cfg.sidewalk / 2 + 0.25;
          var B = d.dx * oz - d.dz * ox;                    // cross(d, o)
          var c0 = d.dx * offz - d.dz * offx;               // cross(d, off)
          var p0 = d.dx * offx + d.dz * offz;               // dot(d, off)
          var pd = d.dx * ox + d.dz * oz;                   // dot(d, o)
          var c = c0 + B * t, pr = p0 + pd * t;
          if (Math.abs(c) < lim && pr > -1) {
            if (Math.abs(B) < 0.05) continue;               // parallel: shortening cannot clear it
            var dt = (c * B > 0) ? (lim - Math.abs(c)) / Math.abs(B) : (Math.abs(c) + lim) / Math.abs(B);
            t = Math.max(t, t + dt);
          }
        }
        return Math.min(t, len * 0.45);
      }
      function capGeo(x, z, R, tintHex, cu, cv) {
        // UV window sits in a marking-free lane band of the asphalt
        // texture (dash column at u 0.47-0.53, edge lines at u<0.05
        // and u>0.95) at radius 0.15 — wide enough that the speckle
        // and repair-patch detail survives, so the field reads as
        // the same asphalt as the ribbons, not a smooth disc.
        var seg = 14, pos = [], uv = [], col = [], nor = [], idx = [];
        var cc = new THREE.Color(tintHex);
        pos.push(x, 0.012, z); uv.push(cu, cv); nor.push(0, 1, 0); col.push(cc.r, cc.g, cc.b);
        for (var s2 = 0; s2 <= seg; s2++) {
          var an = s2 / seg * Math.PI * 2, ca = Math.cos(an), sa = Math.sin(an);
          pos.push(x + ca * R, 0.012, z + sa * R);
          uv.push(cu + ca * 0.15, cv + sa * 0.15);
          nor.push(0, 1, 0); col.push(cc.r, cc.g, cc.b);
        }
        for (var s3 = 1; s3 <= seg; s3++) idx.push(0, s3 + 1, s3);
        var g2 = new THREE.BufferGeometry();
        g2.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g2.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g2.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        g2.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g2.setIndex(idx);
        return g2;
      }
      for (var ni2 = 0; ni2 < nodes.length; ni2++) {
        var inc2 = nodeInc[ni2];
        if (inc2.length < 2) continue;
        if (inc2.every(function (q) { return q.kind === 'bridge'; })) continue;
        if (inc2.length === 2 && inc2[0].kind === inc2[1].kind &&
            inc2[0].dx * inc2[1].dx + inc2[0].dz * inc2[1].dz < -0.98) continue; // straight pass-through point
        var allAlley = inc2.every(function (q) { return q.kind === 'alley'; });
        var crng = SH.World.makeRng(5000 + ni2 * 13);
        var cu = 0.26 + (crng() > 0.5 ? 0.48 : 0), cv = 0.20 + crng() * 0.48;
        roadGeos.push(capGeo(nodes[ni2].x, nodes[ni2].z, nodeR[ni2], allAlley ? 0x9a9186 : 0xffffff, cu, cv));
        // LEGFIX A: the junction fan is a 0.012 surface.
        Roads.surfaces.push({ cx: nodes[ni2].x, cz: nodes[ni2].z, r: nodeR[ni2], top: 0.012 });
      }

      for (var i = 0; i < edges.length; i++) {
        var a = nodes[edges[i].a], b = nodes[edges[i].b];
        var dx = b.x - a.x, dz = b.z - a.z;
        var len = Math.hypot(dx, dz);
        var mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        var kind = edges[i].kind || 'grid';
        var axis = Math.abs(dx) < 0.05 || Math.abs(dz) < 0.05;
        var ux = dx / len, uz = dz / len;         // unit direction
        var px = uz, pz = -ux;                    // unit perpendicular
        var wRoad = kind === 'alley' ? 3.6 : (kind === 'ring' ? cfg.roadHalf * 2 + 2.4 : cfg.roadHalf * 2);
        var t2 = tex.clone(); t2.needsUpdate = true;
        t2.repeat.set(1, Math.max(1, Math.round(len / 9)));
        if (axis && !edges[i].vertical) { t2.rotation = Math.PI / 2; t2.center.set(0.5, 0.5); }
        var mat = new THREE.MeshPhongMaterial({ map: t2, shininess: 26, specular: 0x8a6a4a });
        if (kind === 'alley') mat.color.setHex(0x9a9186);
        this.roadMaterials.push(mat);

        if (kind === 'bridge') {
          // Deck box + a marked driving plane on top + rails + pillars.
          var deck = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.55, len + 3), deckMat);
          deck.rotation.y = Math.atan2(dx, dz);
          deck.position.set(mx, -0.26, mz);
          deck.castShadow = true; deck.receiveShadow = true;
          scene.add(deck);
          var top = new THREE.Mesh(new THREE.PlaneGeometry(9.2, len + 9.2), mat);
          top.rotation.order = 'YXZ';
          top.rotation.y = Math.atan2(-dx, -dz);
          top.rotation.x = -Math.PI / 2;
          top.position.set(mx, 0.03, mz);
          top.receiveShadow = true;
          collectRoad(top, t2.repeat.y, false, whiteTint);
          // LEGFIX A: bridge driving plane, top at 0.03.
          Roads.surfaces.push({ cx: mx, cz: mz, ux: ux, uz: uz, hl: (len + 9.2) / 2, hw: 4.6, top: 0.03 });
          for (var rs = -1; rs <= 1; rs += 2) {
            var rail = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.85, len + 3), railMat);
            rail.rotation.y = Math.atan2(dx, dz);
            rail.position.set(mx + px * rs * 4.6, 0.42, mz + pz * rs * 4.6);
            rail.castShadow = true;
            scene.add(rail);
          }
          var nPil = Math.max(1, Math.floor(len / 26));
          for (var np = 1; np <= nPil; np++) {
            var pt = np / (nPil + 1);
            var pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.95, 2.6, 7), deckMat);
            pillar.position.set(a.x + dx * pt, -1.5, a.z + dz * pt);
            scene.add(pillar);
          }
          continue;
        }

        var road = new THREE.Mesh(new THREE.PlaneGeometry(wRoad, len + 1.2), mat);
        if (axis) {
          road.rotation.x = -Math.PI / 2;
          if (!edges[i].vertical) road.rotation.z = Math.PI / 2;
        } else {
          road.rotation.order = 'YXZ';
          road.rotation.y = Math.atan2(-dx, -dz);
          road.rotation.x = -Math.PI / 2;
        }
        road.position.set(mx, 0, mz);
        road.receiveShadow = true;
        collectRoad(road, t2.repeat.y, axis && !edges[i].vertical, kind === 'alley' ? alleyTint : whiteTint);
        // LEGFIX A: the asphalt ribbon itself, top at 0.
        Roads.surfaces.push({ cx: mx, cz: mz, ux: ux, uz: uz, hl: (len + 1.2) / 2, hw: wRoad / 2, top: 0 });

        // Planted median on the diagonal boulevards (Rev 6): a low
        // concrete kerb + grass top riding the centreline. Traffic
        // lanes run at +/-2.9 m, so the 1.8 m strip never touches a
        // car's swept path.
        if (kind === 'diag') {
          var med = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.22, len * 0.92), deckMat);
          var medTop = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, len * 0.92), medTopMat);
          var meds = [med, medTop];
          for (var mdi = 0; mdi < 2; mdi++) {
            var mm = meds[mdi];
            if (axis) {
              mm.rotation.x = 0;
              if (!edges[i].vertical) mm.rotation.y = Math.PI / 2;
            } else {
              mm.rotation.y = Math.atan2(dx, dz);
            }
            mm.position.set(mx, mdi === 0 ? 0.11 : 0.24, mz);
            mm.updateMatrix();
            (mdi === 0 ? medianGeos : medianTopGeos).push(mm.geometry.clone().applyMatrix4(mm.matrix));
          }
        }

        // Sidewalks + lamps on city streets (not ring, alley or bridge).
        // Rev 6: sidewalks are raised kerb slabs (top at 0.14 m), not
        // flat planes — the step reads from street level and the air.
        if (kind === 'grid' || kind === 'diag' || kind === 'coast') {
          // Slab ends stop at the junction field edge wherever the
          // audit rule says they would cross another leg (T stems,
          // diagonal/coast/island mouths); elsewhere they keep the
          // old full extension that frames grid corners. Insets are
          // PER SIDE: at acute mouths the clear test walks the
          // offset side's end back until it leaves the other leg's
          // carriageway (a shared inset cannot express that).
          var wOff = cfg.roadHalf + cfg.sidewalk / 2;
          var inAok = slabInset(edges[i].a, i), inBok = slabInset(edges[i].b, i);
          for (var s = -1; s <= 1; s += 2) {
            // Offset vector exactly as the placement below applies
            // it (the axis branch ignores the edge's direction sign,
            // the general branch works through the perpendicular).
            var offx = axis ? (edges[i].vertical ? s * wOff : 0) : px * s * wOff;
            var offz = axis ? (edges[i].vertical ? 0 : s * wOff) : pz * s * wOff;
            var inA = inAok ? clearInset(edges[i].a, i, -ux, -uz, offx, offz, nodeR[edges[i].a] - 0.2, len) : -wRoad / 2;
            var inB = inBok ? clearInset(edges[i].b, i, ux, uz, offx, offz, nodeR[edges[i].b] - 0.2, len) : -wRoad / 2;
            var slabLen = len - inA - inB, slabShift = (inA - inB) / 2;
            var walk = new THREE.Mesh(slabGeo(cfg.sidewalk, slabLen, 0.14, Math.max(1, Math.round(slabLen / 2.6))), walkMat);
            if (axis) {
              walk.rotation.x = -Math.PI / 2;
              if (!edges[i].vertical) walk.rotation.z = Math.PI / 2;
              walk.position.set(
                mx + (edges[i].vertical ? s * wOff : 0) + ux * slabShift, 0,
                mz + (edges[i].vertical ? 0 : s * wOff) + uz * slabShift);
            } else {
              walk.rotation.order = 'YXZ';
              walk.rotation.y = Math.atan2(-dx, -dz);
              walk.rotation.x = -Math.PI / 2;
              walk.position.set(mx + px * s * wOff + ux * slabShift, 0, mz + pz * s * wOff + uz * slabShift);
            }
            walk.receiveShadow = true;
            walk.updateMatrix();
            walkGeos.push(walk.geometry.clone().applyMatrix4(walk.matrix));
            // LEGFIX A: the kerb slab, top at 0.14 — the surface
            // whose absence sank every shoe in the PROPFIX photos.
            Roads.surfaces.push({ cx: walk.position.x, cz: walk.position.z, ux: ux, uz: uz, hl: slabLen / 2, hw: cfg.sidewalk / 2, top: 0.14 });
          }
          // Lamp spots along BOTH edges of the street, each carrying
          // the direction toward the carriageway so buildings.js can
          // hang a lamp arm + head over the road (Rev 6).
          var steps = Math.floor(len / lampEvery);
          for (var k = 1; k <= steps; k++) {
            var t = k / (steps + 1);
            for (var side = -1; side <= 1; side += 2) {
              this.lampPositions.push({
                x: a.x + dx * t + px * side * (cfg.roadHalf + 1),
                z: a.z + dz * t + pz * side * (cfg.roadHalf + 1),
                dirx: -px * side, dirz: -pz * side
              });
            }
          }
        }
      }

      // Emit the merged road + sidewalk meshes (one draw call each).
      if (roadGeos.length) {
        var mergedRoadMat = new THREE.MeshPhongMaterial({ map: tex, vertexColors: true, shininess: 26, specular: 0x8a6a4a });
        var roadMesh = new THREE.Mesh(SH.World.mergeGeos(roadGeos), mergedRoadMat);
        roadMesh.receiveShadow = true;
        scene.add(roadMesh);
        this.roadMaterials = [mergedRoadMat];
        this.roadMaterial = mergedRoadMat;
      }
      if (walkGeos.length) {
        var walkMesh = new THREE.Mesh(SH.World.mergeGeos(walkGeos), walkMat);
        walkMesh.receiveShadow = true;
        scene.add(walkMesh);
      }
      if (medianGeos.length) {
        var medMesh = new THREE.Mesh(SH.World.mergeGeos(medianGeos), deckMat);
        medMesh.receiveShadow = true;
        scene.add(medMesh);
        var medTopMesh = new THREE.Mesh(SH.World.mergeGeos(medianTopGeos), medTopMat);
        scene.add(medTopMesh);
      }
      // Stop lines + zebra crossings at every big junction
      // (junction-cleanup pass, generalising the Rev 6 corner-plaza
      // standard): each approach leg gets a stop bar at the field
      // edge and five zebra bars just past it, rotated to the leg's
      // real heading — diagonal and island legs included. The six
      // original plaza sites are kept via the legacy list.
      var zebraGeos = [];
      var zq2 = new THREE.Quaternion(), ze2 = new THREE.Euler(), zm2 = new THREE.Matrix4(), zscl = new THREE.Vector3(1, 1, 1);
      function barAt(x, z, heading, wdt, lng) {
        var geo = new THREE.BoxGeometry(wdt, 0.03, lng);
        ze2.set(0, heading, 0); zq2.setFromEuler(ze2);
        zm2.compose(new THREE.Vector3(x, 0.02, z), zq2, zscl);
        geo.applyMatrix4(zm2);
        zebraGeos.push(geo);
        // LEGFIX A: bars are real 0.035-high surfaces underfoot.
        Roads.surfaces.push({ cx: x, cz: z, ux: Math.sin(heading), uz: Math.cos(heading), hl: lng / 2, hw: wdt / 2, top: 0.035 });
      }
      var legacyZ = [[0, -60], [-120, -180], [120, -300], [-360, 60], [240, 60], [360, -180]];
      for (var ni3 = 0; ni3 < nodes.length; ni3++) {
        var inc3 = nodeInc[ni3];
        if (inc3.length < 3) continue;
        if (inc3.some(function (q) { return q.kind === 'ring' || q.kind === 'bridge'; })) continue;
        var roadLegs = inc3.filter(function (q) { return q.kind === 'grid' || q.kind === 'diag' || q.kind === 'coast'; });
        var legacy = legacyZ.some(function (lz) { return Math.hypot(nodes[ni3].x - lz[0], nodes[ni3].z - lz[1]) < 16; });
        if ((inc3.length < 4 || roadLegs.length < 3) && !legacy) continue;
        for (var li = 0; li < roadLegs.length; li++) {
          var q3 = roadLegs[li], hd3 = Math.atan2(q3.dx, q3.dz);
          var px3 = q3.dz, pz3 = -q3.dx, RR = nodeR[ni3];
          barAt(nodes[ni3].x + q3.dx * (RR + 1.05), nodes[ni3].z + q3.dz * (RR + 1.05), hd3, halfW(q3.kind) * 2 - 1.6, 0.5);
          for (var zb = 0; zb < 5; zb++) {
            var off3 = -3.6 + zb * 1.8;
            barAt(nodes[ni3].x + q3.dx * (RR + 2.45) + px3 * off3, nodes[ni3].z + q3.dz * (RR + 2.45) + pz3 * off3, hd3, 0.9, 2.6);
          }
        }
      }
      if (zebraGeos.length) {
        var zebraMesh = new THREE.Mesh(SH.World.mergeGeos(zebraGeos), new THREE.MeshLambertMaterial({ color: 0xe8e8e2 }));
        zebraMesh.receiveShadow = true;
        scene.add(zebraMesh);
      }
      // SPECTACLE (2026-11-21): the beach boulevard's asphalt was
      // featureless in the cover frame — the road now carries its
      // history: two braking arcs baked into the surface where
      // drivers dive for the junction gaps, and crash debris
      // scattered on the beach verge at the end of the eastern arc.
      // Permanent road dressing, merged the same way as the zebra
      // bars above, following the real beachRoadZ curve.
      var skidGeos = [], debrisGeos = [];
      var sq2 = new THREE.Quaternion(), se2 = new THREE.Euler(), sm2 = new THREE.Matrix4(), sscl2 = new THREE.Vector3(1, 1, 1);
      function flatBox(list, x, y, z, heading, wdt, hgt, lng) {
        var geo = new THREE.BoxGeometry(wdt, hgt, lng);
        se2.set(0, heading, 0); sq2.setFromEuler(se2);
        sm2.compose(new THREE.Vector3(x, y, z), sq2, sscl2);
        geo.applyMatrix4(sm2);
        list.push(geo);
      }
      function skidArc(xFrom, xTo, latOff) {
        for (var sx = xFrom; sx >= xTo; sx -= 1.7) {
          var dzdt = (SH.World.beachRoadZ(sx + 1) - SH.World.beachRoadZ(sx - 1)) / 2;
          flatBox(skidGeos, sx, 0.045, SH.World.beachRoadZ(sx) + latOff, Math.atan2(1, dzdt), 0.26, 0.012, 1.85);
        }
      }
      skidArc(47, 27, -0.85); skidArc(47, 27, 0.85);
      skidArc(-18, -34, -0.85); skidArc(-18, -34, 0.85);
      if (skidGeos.length) {
        var skidMesh = new THREE.Mesh(SH.World.mergeGeos(skidGeos), new THREE.MeshLambertMaterial({ color: 0x201d1a, transparent: true, opacity: 0.5 }));
        skidMesh.renderOrder = 2;
        scene.add(skidMesh);
      }
      var debRng = SH.World.makeRng(778);
      for (var dbi = 0; dbi < 16; dbi++) {
        var dbx = 17 + debRng() * 15, dbz = SH.World.beachRoadZ(dbx) + 3.4 + debRng() * 2.4;
        flatBox(debrisGeos, dbx, 0.06 + debRng() * 0.05, dbz, debRng() * 3, 0.12 + debRng() * 0.26, 0.08 + debRng() * 0.1, 0.12 + debRng() * 0.26);
      }
      for (var dbj = 0; dbj < 6; dbj++) {
        var dxj = 20 + debRng() * 9, dzj = SH.World.beachRoadZ(dxj) + 1.9 + debRng() * 1.1;
        flatBox(debrisGeos, dxj, 0.05, dzj, debRng() * 3, 0.1 + debRng() * 0.2, 0.06, 0.1 + debRng() * 0.2);
      }
      if (debrisGeos.length) {
        var debMesh = new THREE.Mesh(SH.World.mergeGeos(debrisGeos), new THREE.MeshLambertMaterial({ color: 0x3a3733, flatShading: true }));
        debMesh.receiveShadow = true;
        scene.add(debMesh);
      }
      // LEGFIX A: every walkable surface is registered by now —
      // index them for groundHeightAt.
      this._buildGroundGrid();
    },

    update: function (dt, elapsed) {
      // Foam ribbons are baked to the curved shore, so the creep is faked
      // with a slow sideways drift + opacity pulse instead of a z shift.
      for (var i = 0; i < this.waveMeshes.length; i++) {
        var m = this.waveMeshes[i];
        m.position.x = Math.sin(elapsed * 0.5 + i * 1.7) * 3.2;
        m.material.opacity = 0.32 + 0.18 * Math.sin(elapsed * 0.9 + i * 2.1);
      }
      if (this.waterMesh) this.waterMesh.position.y = -0.55 + Math.sin(elapsed * 0.5) * 0.06;
    },

    applyPalette: function (pal, nightAmt) {
      if (this.groundMesh) this.groundMesh.material.color.setHex(pal.grass);
      if (this.sandMesh) this.sandMesh.material.color.setHex(pal.sand);
      if (this.waterMesh) this.waterMesh.material.color.setHex(pal.water);
      if (this.walkMaterial) this.walkMaterial.color.setHex(pal.sidewalk);
      if (this._paintShore) this._paintShore(pal);
      // Night floor (Step 4 fix): a faint emissive lift on roads,
      // ground and pavements after dark, so the world never falls to
      // pure black silhouettes. Zero by day — daylight is untouched.
      var na = nightAmt || 0;
      if (this.roadMaterial) {
        this.roadMaterial.emissive.setHex(0x2a3048);
        this.roadMaterial.emissiveIntensity = 0.55 * na;
      }
      if (this.groundMesh) {
        this.groundMesh.material.emissive.setHex(0x1a2b1a);
        this.groundMesh.material.emissiveIntensity = 0.5 * na;
      }
      if (this.walkMaterial) {
        this.walkMaterial.emissive.setHex(0x232838);
        this.walkMaterial.emissiveIntensity = 0.35 * na;
      }
    }
  };

  SH.Roads = Roads;
})(window.SH = window.SH || {});
