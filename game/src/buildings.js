// SELATARA HEAT — buildings.js
// Instanced buildings with procedural canvas facades per district, plus the
// props that make districts read differently: palms, streetlights, port
// containers + cranes, night-market tents, boardwalk + pier, billboards, park.
// Public API: SH.Buildings { build(scene), setNightGlow(amount), windowMaterial }.
(function (SH) {
  'use strict';

  function facadeTexture(seed, litRatio, sign, pattern) {
    var c = document.createElement('canvas'); c.width = 128; c.height = 256;
    var g = c.getContext('2d');
    g.fillStyle = '#f4ead6'; g.fillRect(0, 0, 128, 256);
    var rng = SH.World.makeRng(seed);
    // Three window grammars so neighbouring buildings never share one grid:
    // 0 = square grid, 1 = tall vertical strips, 2 = wide windows + balcony
    // bands every third row.
    var rowH = pattern === 1 ? 24 : 12;
    for (var y = 6; y < 246; y += rowH) {
      if (pattern === 2 && ((y / rowH) | 0) % 3 === 2) {
        g.fillStyle = 'rgba(90,60,40,0.55)';
        g.fillRect(0, y + 8, 128, 3); // balcony shadow line
      }
      for (var x = 6; x < 122; x += (pattern === 2 ? 18 : 12)) {
        var lit = rng() < litRatio;
        if (rng() < 0.08) continue; // a few windows simply absent
        // Deep blue-teal glass against the warm wall: strong readable contrast.
        g.fillStyle = lit ? '#274b5c' : '#3d6a7d';
        if (pattern === 1) g.fillRect(x, y, 7, 19);
        else if (pattern === 2) g.fillRect(x, y, 13, 8);
        else g.fillRect(x, y, 8, 8);
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(x, y, pattern === 2 ? 13 : 8, 2);
      }
    }
    if (sign) {
      // Ground-floor shopfront band: bright sign strip + glass storefront.
      g.fillStyle = '#20242e'; g.fillRect(0, 216, 128, 40);
      g.fillStyle = '#7ec8e3'; g.fillRect(6, 224, 52, 26); g.fillRect(70, 224, 52, 26);
      g.fillStyle = sign;
      g.fillRect(0, 196, 128, 20);
      g.fillStyle = '#ffffff';
      g.font = 'bold 13px sans-serif';
      g.textAlign = 'center';
      g.fillText('SELATARA', 64, 211);
    }
    var t = new THREE.CanvasTexture(c);
    if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }

  function makeInstanced(geo, mat, placements, scene, shadows) {
    var mesh = new THREE.InstancedMesh(geo, mat, placements.length);
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    var v = new THREE.Vector3(), s = new THREE.Vector3();
    for (var i = 0; i < placements.length; i++) {
      var p = placements[i];
      e.set(0, p.rotY || 0, 0); q.setFromEuler(e);
      v.set(p.x, p.y, p.z); s.set(p.sx, p.sy, p.sz);
      m4.compose(v, q, s);
      mesh.setMatrixAt(i, m4);
      if (p.color !== undefined) mesh.setColorAt(i, new THREE.Color(p.color));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = !!shadows; mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  var Buildings = {
    glowPoints: null,

    build: function (scene) {
      var cfg = SH.Config.world;
      var rng = SH.World.makeRng(4242);
      var palettes = SH.Config.buildingPalettes;

      // ---- Collect building placements per archetype ----
      var towers = [], shops = [], warehouses = [], villas = [], podiums = [], awnings = [];
      var xs = cfg.avenuesX, zs = cfg.streetsZ;
      for (var i = 0; i + 1 < xs.length; i++) {
        for (var j = 0; j + 1 < zs.length; j++) {
          var cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
          var d = SH.World.districtAt(cx, cz);
          if (!d || d.id === 'taman') continue;
          var bw = xs[i + 1] - xs[i] - cfg.roadHalf * 2 - cfg.sidewalk * 2 - 6;
          var bd = zs[j + 1] - zs[j] - cfg.roadHalf * 2 - cfg.sidewalk * 2 - 6;
          if (d.id === 'pelita') {
            // Two towers per block on a shared retail podium: no empty lots.
            podiums.push({ x: cx, y: 2.1, z: cz, sx: bw * 0.86, sy: 4.2, sz: bd * 0.86, color: palettes.ruko[(rng() * palettes.ruko.length) | 0] });
            SH.World.colliders.push({ x: cx, z: cz, hx: bw * 0.43, hz: bd * 0.43 });
            for (var tw = 0; tw < 2; tw++) {
              var h = d.minH + rng() * (d.maxH - d.minH);
              var ox = (tw === 0 ? -1 : 1) * bw * 0.21 + (rng() - 0.5) * 6;
              var oz = (tw === 0 ? -1 : 1) * bd * 0.18 + (rng() - 0.5) * 6;
              towers.push({ x: cx + ox, y: 4.2 + h / 2, z: cz + oz, sx: bw * 0.34, sy: h, sz: bd * 0.34, base: 4.2, h: h, color: palettes.pelita[(rng() * palettes.pelita.length) | 0] });
            }
          } else if (d.id === 'ruko') {
            // Two shophouse rows per block (street front + back lane), each
            // with a coloured awning over the pavement.
            for (var k = 0; k < 4; k++) {
              var sx = xs[i] + 16 + k * ((xs[i + 1] - xs[i] - 32) / 3);
              var sh = d.minH + rng() * (d.maxH - d.minH);
              shops.push({ x: sx, y: sh / 2, z: cz - bd * 0.24, sx: 17, sy: sh, sz: bd * 0.32, base: 0, h: sh, color: palettes.ruko[(rng() * palettes.ruko.length) | 0] });
              SH.World.colliders.push({ x: sx, z: cz - bd * 0.24, hx: 8.5, hz: bd * 0.16 });
              awnings.push({ x: sx, y: 3.1, z: cz - bd * 0.24 - bd * 0.16 - 1.6, sx: 16.4, sy: 0.28, sz: 3.4, color: palettes.ruko[(rng() * palettes.ruko.length) | 0] });
              var sh2 = d.minH + rng() * (d.maxH - d.minH) * 0.8;
              shops.push({ x: sx, y: sh2 / 2, z: cz + bd * 0.30, sx: 17, sy: sh2, sz: bd * 0.26, base: 0, h: sh2, color: palettes.ruko[(rng() * palettes.ruko.length) | 0] });
              SH.World.colliders.push({ x: sx, z: cz + bd * 0.30, hx: 8.5, hz: bd * 0.13 });
              awnings.push({ x: sx, y: 3.1, z: cz + bd * 0.30 + bd * 0.13 + 1.6, sx: 16.4, sy: 0.28, sz: 3.4, color: palettes.ruko[(rng() * palettes.ruko.length) | 0] });
            }
          } else if (d.id === 'karat') {
            var wh = d.minH + rng() * (d.maxH - d.minH);
            warehouses.push({ x: cx, y: wh / 2, z: cz, sx: bw * 0.68, sy: wh, sz: bd * 0.62, base: 0, h: wh, color: palettes.karat[(rng() * palettes.karat.length) | 0] });
            SH.World.colliders.push({ x: cx, z: cz, hx: bw * 0.34, hz: bd * 0.31 });
            warehouses.push({ x: cx + bw * 0.3, y: 3, z: cz + bd * 0.38, sx: bw * 0.3, sy: 6, sz: bd * 0.2, color: palettes.karat[(rng() * palettes.karat.length) | 0] });
            SH.World.colliders.push({ x: cx + bw * 0.3, z: cz + bd * 0.38, hx: bw * 0.15, hz: bd * 0.1 });
          } else if (d.id === 'mawar') {
            for (var v2 = 0; v2 < 3; v2++) {
              var vx = cx + (v2 - 1) * bw * 0.3;
              var vh = d.minH + rng() * (d.maxH - d.minH);
              villas.push({ x: vx, y: vh / 2, z: cz + (v2 % 2 ? bd * 0.14 : -bd * 0.14), sx: 20, sy: vh, sz: 18, base: 0, h: vh, color: palettes.mawar[(rng() * palettes.mawar.length) | 0] });
              SH.World.colliders.push({ x: vx, z: cz + (v2 % 2 ? bd * 0.14 : -bd * 0.14), hx: 10, hz: 9 });
            }
          } else if (d.id === 'kencana') {
            // Two narrower hotels per block with a gap, not one slab.
            for (var kh2 = 0; kh2 < 2; kh2++) {
              var kh = d.minH + rng() * (d.maxH - d.minH);
              var kx = cx + (kh2 === 0 ? -1 : 1) * bw * 0.22;
              towers.push({ x: kx, y: kh / 2, z: cz - 8, sx: bw * 0.36, sy: kh, sz: 20, base: 0, h: kh, color: palettes.kencana[(rng() * palettes.kencana.length) | 0] });
              SH.World.colliders.push({ x: kx, z: cz - 8, hx: bw * 0.18, hz: 10 });
            }
          }
        }
      }

      var box = new THREE.BoxGeometry(1, 1, 1);
      // Facade variants per archetype: three window grammars, bucketed at
      // random so a street never repeats one identical window slab.
      var towerMats = [facadeTexture(11, 0.35, null, 0), facadeTexture(12, 0.3, null, 1), facadeTexture(13, 0.4, null, 2)]
        .map(function (t) { return new THREE.MeshLambertMaterial({ map: t }); });
      var shopMats = [facadeTexture(23, 0.2, '#c94f7a', 2), facadeTexture(24, 0.25, null, 0), facadeTexture(25, 0.18, '#3f9db5', 1)]
        .map(function (t) { return new THREE.MeshLambertMaterial({ map: t }); });
      var wareMats = [facadeTexture(37, 0.08, null, 0), facadeTexture(38, 0.12, null, 2)]
        .map(function (t) { return new THREE.MeshLambertMaterial({ map: t, color: 0xbfb4a4 }); });
      var villaMats = [facadeTexture(51, 0.25, null, 2), facadeTexture(52, 0.3, null, 0)]
        .map(function (t) { return new THREE.MeshLambertMaterial({ map: t }); });

      // Massing pass: stepped setbacks on towers, pitched roofs on villas /
      // shops / some warehouses, rooftop clutter (AC units, water tanks) and
      // balcony slabs — no more single uniform slabs.
      var roofProps = [], tanks = [], hipRoofs = [];
      var roofColors = [0xb5563c, 0x9a4a34, 0x7a5a48, 0xc96f4a];
      function bucketize(list, mats, opts) {
        var buckets = mats.map(function () { return []; });
        for (var bi = 0; bi < list.length; bi++) {
          var b = list[bi];
          var bucket = buckets[(rng() * mats.length) | 0];
          bucket.push(b);
          var topY = (b.base || 0) + b.h;
          if (opts.tiers && rng() < 0.85) {
            var h2 = b.h * (0.22 + rng() * 0.25);
            var t2x = b.x + (rng() - 0.5) * 2.4, t2z = b.z + (rng() - 0.5) * 2.4;
            bucket.push({ x: t2x, y: topY + h2 / 2, z: t2z, sx: b.sx * 0.62, sy: h2, sz: b.sz * 0.62, color: b.color });
            topY += h2;
            if (rng() < 0.45) {
              var h3 = b.h * (0.14 + rng() * 0.12);
              bucket.push({ x: t2x, y: topY + h3 / 2, z: t2z, sx: b.sx * 0.4, sy: h3, sz: b.sz * 0.4, color: b.color });
              topY += h3;
            }
          }
          if (opts.hipRoof && rng() < opts.hipRoof) {
            var rh = 1.8 + rng() * 1.4;
            hipRoofs.push({ x: b.x, y: topY + rh / 2 - 0.15, z: b.z, sx: b.sx * 1.02, sy: rh, sz: b.sz * 1.02, rotY: Math.PI / 4, color: roofColors[(rng() * roofColors.length) | 0] });
          } else if (opts.roofProps) {
            var nProps = 1 + ((rng() * 3) | 0);
            for (var rp = 0; rp < nProps; rp++) {
              var px2 = b.x + (rng() - 0.5) * b.sx * 0.55, pz2 = b.z + (rng() - 0.5) * b.sz * 0.55;
              if (rng() < 0.3) tanks.push({ x: px2, y: topY + 0.85, z: pz2, sx: 1.5, sy: 1.7, sz: 1.5, color: rng() < 0.5 ? 0xb9c0c9 : 0xa8763e });
              else roofProps.push({ x: px2, y: topY + 0.4, z: pz2, sx: 1.9, sy: 0.8, sz: 1.3, color: 0x9aa0a8 });
            }
          }
          if (opts.balconies && rng() < 0.55) {
            var nBal = 2 + ((rng() * 2) | 0);
            for (var bb = 0; bb < nBal; bb++) {
              roofProps.push({
                x: b.x + (rng() - 0.5) * b.sx * 0.45, y: (b.base || 0) + b.h * (0.35 + bb * 0.22),
                z: b.z + b.sz / 2 + 0.5, sx: 3.4, sy: 0.22, sz: 1.0, color: 0xe8e0d0
              });
            }
          }
        }
        for (var mi = 0; mi < mats.length; mi++) makeInstanced(box, mats[mi], buckets[mi], scene, true);
      }
      bucketize(towers, towerMats, { tiers: true, roofProps: true, balconies: true });
      bucketize(shops, shopMats, { hipRoof: 0.3, roofProps: true });
      bucketize(warehouses, wareMats, { hipRoof: 0.4, roofProps: true });
      bucketize(villas, villaMats, { hipRoof: 0.75, balconies: true });
      makeInstanced(box, towerMats[1], podiums, scene, true);
      makeInstanced(box, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), awnings, scene, false);
      makeInstanced(box, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), roofProps, scene, false);
      makeInstanced(new THREE.CylinderGeometry(0.5, 0.5, 1, 6), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), tanks, scene, false);
      makeInstanced(new THREE.ConeGeometry(0.72, 1, 4), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), hipRoofs, scene, false);
      this.windowMaterials = towerMats.concat(shopMats, villaMats);

      // ---- Palms + park trees ----
      // A palm is a BENT trunk (curve baked into the geometry) carrying 7-9
      // drooping fronds: each frond is a tapered ribbon bent downward along
      // its length, instanced once per frond around the crown. Park trees get
      // 2-3 stacked flattened canopy blobs instead of one flat disc.
      var palms = [], parkTrees = [];
      var pi;
      for (pi = 0; pi < 130; pi++) {
        palms.push({ x: -560 + rng() * 1120, z: 196 + rng() * 84, s: 0.9 + rng() * 0.4, lean: rng() * Math.PI * 2 });
      }
      for (pi = 0; pi < 90; pi++) {
        var tx = -560 + rng() * 1120, tz = -440 + rng() * 620;
        if (SH.World.districtAt(tx, tz) && SH.World.districtAt(tx, tz).id === 'taman' || (tx > -130 && tx < 130 && tz > -70 && tz < 190)) {
          parkTrees.push({ x: tx, z: tz, s: 0.85 + rng() * 0.5 });
        } else if ((pi % 3) === 0) {
          palms.push({ x: tx, z: tz, s: 0.85 + rng() * 0.35, lean: rng() * Math.PI * 2 });
        }
      }
      // Street palms: a palm every ~24 m along both sides of the avenues and
      // streets in the built districts, so no street reads empty.
      var gEdges = SH.World.graph.edges, gNodes = SH.World.graph.nodes;
      for (pi = 0; pi < gEdges.length; pi++) {
        var ga = gNodes[gEdges[pi].a], gb = gNodes[gEdges[pi].b];
        var glen = Math.hypot(gb.x - ga.x, gb.z - ga.z);
        if (glen > 700) continue; // ring highway stays bare
        var gSteps = Math.floor(glen / 24);
        for (var gs = 1; gs <= gSteps; gs++) {
          var gt = gs / (gSteps + 1);
          for (var gSide = -1; gSide <= 1; gSide += 2) {
            if ((gs + (gSide > 0 ? 1 : 0)) % 2 !== 0) continue; // alternate sides
            var gpx = ga.x + (gb.x - ga.x) * gt + (gEdges[pi].vertical ? gSide * (cfg.roadHalf + 2.6) : 0);
            var gpz = ga.z + (gb.z - ga.z) * gt + (gEdges[pi].vertical ? 0 : gSide * (cfg.roadHalf + 2.6));
            var gd = SH.World.districtAt(gpx, gpz);
            if (!gd) continue;
            palms.push({ x: gpx, z: gpz, s: 0.85 + rng() * 0.3, lean: rng() * Math.PI * 2 });
          }
        }
      }
      // Bent palm trunk: vertices lean further the higher they sit.
      var trunkGeo = new THREE.CylinderGeometry(0.13, 0.34, 6, 5, 5);
      trunkGeo.translate(0, 3, 0);
      var tp = trunkGeo.attributes.position;
      for (pi = 0; pi < tp.count; pi++) {
        var tt = tp.getY(pi) / 6;
        tp.setX(pi, tp.getX(pi) + tt * tt * 0.95);
      }
      trunkGeo.computeVertexNormals();
      // Frond ribbon: extends +x from the crown, tapers and droops.
      var frondGeo = new THREE.PlaneGeometry(2.9, 0.62, 6, 1);
      frondGeo.translate(1.45, 0, 0);
      frondGeo.rotateX(-Math.PI / 2);
      var fp = frondGeo.attributes.position;
      for (pi = 0; pi < fp.count; pi++) {
        var fu = fp.getX(pi) / 2.9;
        fp.setY(pi, -fu * fu * 1.35 - Math.abs(fp.getZ(pi)) * 0.4);
        fp.setZ(pi, fp.getZ(pi) * (1 - fu * 0.82));
      }
      frondGeo.computeVertexNormals();
      var palmTrunks = [], fronds = [], coconuts = [], treeTrunks = [], canopies = [];
      for (pi = 0; pi < palms.length; pi++) {
        var pm = palms[pi];
        palmTrunks.push({ x: pm.x, y: 0, z: pm.z, sx: pm.s, sy: pm.s, sz: pm.s, rotY: pm.lean });
        // Crown sits at the top of the bent trunk (local +0.95x, 6y).
        var ccx = pm.x + 0.95 * pm.s * Math.cos(pm.lean);
        var ccz = pm.z - 0.95 * pm.s * Math.sin(pm.lean);
        var nFr = 7 + ((rng() * 3) | 0);
        for (var fi = 0; fi < nFr; fi++) {
          fronds.push({
            x: ccx, y: 6 * pm.s - 0.1, z: ccz,
            sx: pm.s * (0.9 + rng() * 0.35), sy: pm.s, sz: pm.s * (0.9 + rng() * 0.3),
            rotY: (fi / nFr) * Math.PI * 2 + rng() * 0.5
          });
        }
        for (var ci = 0; ci < 3; ci++) {
          coconuts.push({ x: ccx + (rng() - 0.5) * 0.5, y: 6 * pm.s - 0.35, z: ccz + (rng() - 0.5) * 0.5, sx: 0.34, sy: 0.34, sz: 0.34 });
        }
      }
      for (pi = 0; pi < parkTrees.length; pi++) {
        var tr = parkTrees[pi];
        treeTrunks.push({ x: tr.x, y: 2.4 * tr.s, z: tr.z, sx: 0.6 * tr.s, sy: 4.8 * tr.s, sz: 0.6 * tr.s });
        canopies.push({ x: tr.x, y: 5.4 * tr.s, z: tr.z, sx: 6.4 * tr.s, sy: 3.2 * tr.s, sz: 6.4 * tr.s, color: 0x4da653 });
        canopies.push({ x: tr.x + 0.9 * tr.s, y: 6.8 * tr.s, z: tr.z + 0.5 * tr.s, sx: 4.6 * tr.s, sy: 2.7 * tr.s, sz: 4.6 * tr.s, color: 0x57b85e });
        canopies.push({ x: tr.x - 0.6 * tr.s, y: 8 * tr.s, z: tr.z - 0.7 * tr.s, sx: 3.2 * tr.s, sy: 2.3 * tr.s, sz: 3.2 * tr.s, color: 0x439148 });
      }
      var trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6a4a });
      var frondMat = new THREE.MeshLambertMaterial({ color: 0x3f9e4d, flatShading: true, side: THREE.DoubleSide });
      var treeMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
      makeInstanced(trunkGeo, trunkMat, palmTrunks, scene, false);
      makeInstanced(frondGeo, frondMat, fronds, scene, false);
      makeInstanced(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshLambertMaterial({ color: 0x6a7a2e, flatShading: true }), coconuts, scene, false);
      makeInstanced(new THREE.CylinderGeometry(0.32, 0.5, 1, 5), trunkMat, treeTrunks, scene, false);
      makeInstanced(new THREE.IcosahedronGeometry(0.62, 0), treeMat, canopies, scene, false);

      // Park pond.
      var pond = new THREE.Mesh(new THREE.CircleGeometry(26, 24), new THREE.MeshPhongMaterial({ color: 0x2e8fb5, shininess: 80 }));
      pond.rotation.x = -Math.PI / 2; pond.position.set(0, 0.03, 60);
      scene.add(pond);

      // ---- Streetlights: instanced poles + night glow points ----
      var lamps = SH.Roads.lampPositions;
      var poles = [];
      for (pi = 0; pi < lamps.length; pi++) poles.push({ x: lamps[pi].x, y: 3.4, z: lamps[pi].z, sx: 0.22, sy: 6.8, sz: 0.22 });
      makeInstanced(new THREE.CylinderGeometry(0.5, 0.5, 1, 5), new THREE.MeshLambertMaterial({ color: 0x3a3f4a }), poles, scene, false);
      var glowGeo = new THREE.BufferGeometry();
      var pos = new Float32Array(lamps.length * 3);
      for (pi = 0; pi < lamps.length; pi++) { pos[pi * 3] = lamps[pi].x; pos[pi * 3 + 1] = 6.9; pos[pi * 3 + 2] = lamps[pi].z; }
      glowGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      // Lamp glows need a radial sprite map — bare Points render as squares.
      var gc = document.createElement('canvas'); gc.width = gc.height = 64;
      var gg = gc.getContext('2d');
      var ggrad = gg.createRadialGradient(32, 32, 2, 32, 32, 32);
      ggrad.addColorStop(0, 'rgba(255,255,255,1)'); ggrad.addColorStop(0.35, 'rgba(255,255,255,0.45)'); ggrad.addColorStop(1, 'rgba(255,255,255,0)');
      gg.fillStyle = ggrad; gg.fillRect(0, 0, 64, 64);
      this.glowMaterial = new THREE.PointsMaterial({ color: 0xffca7a, size: 2.6, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, map: new THREE.CanvasTexture(gc) });
      this.glowPoints = new THREE.Points(glowGeo, this.glowMaterial);
      scene.add(this.glowPoints);

      // ---- Port: container stacks + cranes ----
      var containers = [];
      var contColors = [0xc94f4f, 0x4f7ac9, 0x37b24d, 0xe8b04b, 0x9a6ac9, 0x37e0ff];
      for (pi = 0; pi < 110; pi++) {
        var cx2 = 300 + rng() * 250, cz2 = 90 + rng() * 130;
        var lvl = (rng() * 3) | 0;
        containers.push({ x: cx2, y: 1.3 + lvl * 2.6, z: cz2, sx: 12, sy: 2.6, sz: 2.6, rotY: (rng() > 0.5 ? 0 : Math.PI / 2), color: contColors[(rng() * contColors.length) | 0] });
      }
      makeInstanced(box, new THREE.MeshLambertMaterial({ color: 0xffffff }), containers, scene, true);
      var craneMat = new THREE.MeshLambertMaterial({ color: 0xe8b04b, flatShading: true });
      for (pi = 0; pi < 3; pi++) {
        var crane = new THREE.Group();
        var legG = new THREE.BoxGeometry(1.6, 30, 1.6);
        var positions = [[-9, -5], [9, -5], [-9, 5], [9, 5]];
        for (var li = 0; li < 4; li++) {
          var leg = new THREE.Mesh(legG, craneMat);
          leg.position.set(positions[li][0], 15, positions[li][1]);
          crane.add(leg);
        }
        var beam = new THREE.Mesh(new THREE.BoxGeometry(46, 2.2, 2.2), craneMat);
        beam.position.set(6, 30, 0);
        crane.add(beam);
        crane.position.set(340 + pi * 95, 0, 205);
        scene.add(crane);
        SH.World.colliders.push({ x: crane.position.x, z: 205, hx: 11, hz: 7 });
      }

      // ---- Night-market tents in Ruko Senja ----
      var tents = [];
      var tentColors = [0xff4fa3, 0xffd23f, 0x37e0ff, 0xff8c5a, 0x9fd8c0];
      for (pi = 0; pi < 26; pi++) {
        var mx = -352 + (pi % 13) * 7.6, mz = 84 + ((pi / 13) | 0) * 16;
        tents.push({ x: mx, y: 2.6, z: mz, sx: 6.4, sy: 2.8, sz: 6.4, color: tentColors[(rng() * tentColors.length) | 0] });
      }
      makeInstanced(new THREE.ConeGeometry(0.72, 1, 4), new THREE.MeshLambertMaterial({ flatShading: true }), tents, scene, false);

      // ---- Boardwalk + pier at Pantai Kencana ----
      var woodMat = new THREE.MeshLambertMaterial({ color: 0xa87c50 });
      var board = new THREE.Mesh(new THREE.BoxGeometry(980, 0.5, 10), woodMat);
      board.position.set(0, 0.25, 246); board.receiveShadow = true;
      scene.add(board);
      var pier = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 110), woodMat);
      pier.position.set(60, 0.25, 340);
      scene.add(pier);
      this.pierEnd = { x: 60, z: 392 };
      var umbrellas = [];
      for (pi = 0; pi < 30; pi++) umbrellas.push({ x: -520 + rng() * 1040, y: 2.2, z: 262 + rng() * 22, sx: 4.6, sy: 1.4, sz: 4.6, color: tentColors[(rng() * tentColors.length) | 0] });
      makeInstanced(new THREE.ConeGeometry(0.6, 1, 8), new THREE.MeshLambertMaterial({ flatShading: true }), umbrellas, scene, false);

      // ---- Billboards in Pelita Heights (canvas sign textures, invented brands) ----
      var signs = [
        { text: 'SELATARA', sub: 'KOTA SELAT • PORT CITY', color: '#ff4fa3', x: -120, z: -308 },
        { text: 'KOPI SENJA', sub: 'KOPI PAGI • KOPI MALAM', color: '#ffd23f', x: 118, z: -188 },
        { text: 'HOTEL KENCANA', sub: 'PANTAI • BEACH', color: '#37e0ff', x: -238, z: 172 },
        { text: 'BENGKEL ARUS', sub: 'SERVIS • REPAIR 24 JAM', color: '#9fd8c0', x: 238, z: -68 },
        { text: 'PASAR MALAM', sub: 'NIGHT MARKET • RUKO SENJA', color: '#ff8c5a', x: -362, z: 58 },
        { text: 'FERI SELATARA', sub: 'FERRY • PELABUHAN', color: '#7dff8a', x: 62, z: 236 }
      ];
      for (pi = 0; pi < signs.length; pi++) {
        var s = signs[pi];
        var sc = document.createElement('canvas'); sc.width = 256; sc.height = 128;
        var sg = sc.getContext('2d');
        sg.fillStyle = '#14101e'; sg.fillRect(0, 0, 256, 128);
        sg.fillStyle = s.color; sg.font = 'bold 30px sans-serif'; sg.textAlign = 'center';
        sg.fillText(s.text, 128, 56);
        sg.fillStyle = '#e8e3d8'; sg.font = '15px sans-serif';
        sg.fillText(s.sub, 128, 88);
        var stex = new THREE.CanvasTexture(sc);
        if (THREE.sRGBEncoding) stex.encoding = THREE.sRGBEncoding;
        var sm = new THREE.Mesh(new THREE.PlaneGeometry(27, 13.5),
          new THREE.MeshBasicMaterial({ map: stex, side: THREE.DoubleSide }));
        sm.position.set(s.x, 18, s.z);
        sm.rotation.y = (pi % 2) ? Math.PI / 2 : 0;
        scene.add(sm);
        var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 12, 5), new THREE.MeshLambertMaterial({ color: 0x3a3f4a }));
        pole.position.set(s.x, 6, s.z);
        scene.add(pole);
      }

      // ---- Power poles + sagging wires along the old-town / downtown avenues ----
      var ppoles = [], parms = [], wirePts = [];
      for (var ei = 0; ei < gEdges.length; ei++) {
        if (!gEdges[ei].vertical) continue;
        var ea = gNodes[gEdges[ei].a], eb = gNodes[gEdges[ei].b];
        var emx = (ea.x + eb.x) / 2, emz = (ea.z + eb.z) / 2;
        var ed = SH.World.districtAt(emx, emz);
        if (!ed || (ed.id !== 'ruko' && ed.id !== 'pelita')) continue;
        var elen = Math.abs(eb.z - ea.z);
        var esteps = Math.max(2, Math.floor(elen / 38));
        var prevTop = null;
        for (var es = 0; es <= esteps; es++) {
          var et = es / esteps;
          var epx = ea.x + (cfg.roadHalf + 1.4), epz = ea.z + (eb.z - ea.z) * et;
          ppoles.push({ x: epx, y: 4.5, z: epz, sx: 0.34, sy: 9, sz: 0.34 });
          parms.push({ x: epx, y: 8.6, z: epz, sx: 2.6, sy: 0.22, sz: 0.22 });
          var top = { x: epx, y: 8.9, z: epz };
          if (prevTop) {
            var midx = (prevTop.x + top.x) / 2, midz = (prevTop.z + top.z) / 2;
            wirePts.push(prevTop.x, prevTop.y, prevTop.z, midx, 7.9, midz, midx, 7.9, midz, top.x, top.y, top.z);
          }
          prevTop = top;
        }
      }
      makeInstanced(new THREE.CylinderGeometry(0.5, 0.5, 1, 5), new THREE.MeshLambertMaterial({ color: 0x4a3a2e }), ppoles, scene, false);
      makeInstanced(box, new THREE.MeshLambertMaterial({ color: 0x4a3a2e }), parms, scene, false);
      var wireGeo = new THREE.BufferGeometry();
      wireGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wirePts), 3));
      var wires = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x14161c, transparent: true, opacity: 0.8 }));
      scene.add(wires);
    },

    setNightGlow: function (amount) {
      if (this.glowMaterial) this.glowMaterial.opacity = amount * 0.85;
    }
  };

  SH.Buildings = Buildings;
})(window.SH = window.SH || {});
