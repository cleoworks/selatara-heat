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
    // Fine aggregate noise.
    for (var i = 0; i < 2400; i++) {
      g.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.055)';
      g.fillRect(rng() * 128, rng() * 128, 1.6, 1.6);
    }
    // Repair patches: darker rectangles with soft edges.
    for (var p = 0; p < 5; p++) {
      var px = rng() * 96, py = rng() * 96, pw = 18 + rng() * 26, ph = 12 + rng() * 22;
      g.fillStyle = 'rgba(12,10,12,0.16)';
      g.fillRect(px - 2, py - 2, pw + 4, ph + 4);
      g.fillStyle = 'rgba(10,9,11,0.22)';
      g.fillRect(px, py, pw, ph);
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
    var tones = ['rgba(38,74,26,0.20)', 'rgba(84,110,40,0.16)', 'rgba(140,124,62,0.13)', 'rgba(122,94,52,0.12)'];
    for (var b = 0; b < 90; b++) {
      var bx = rng() * 512, by = rng() * 512, br = 26 + rng() * 90;
      var gr = g.createRadialGradient(bx, by, 2, bx, by, br);
      gr.addColorStop(0, tones[(rng() * tones.length) | 0]);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    for (var i = 0; i < 9000; i++) {
      var v = rng();
      g.fillStyle = v > 0.6 ? 'rgba(30,60,20,0.16)' : (v > 0.3 ? 'rgba(120,100,50,0.10)' : 'rgba(255,255,220,0.05)');
      g.fillRect(rng() * 512, rng() * 512, 3 + rng() * 9, 3 + rng() * 9);
    }
    var t = new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(34, 30);
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
    // Four paving slabs per tile, each with its own tint, a bevel highlight
    // on the top-left and grout lines between.
    for (var sy = 0; sy < 2; sy++) {
      for (var sx = 0; sx < 2; sx++) {
        var tint = (rng() - 0.5) * 0.14;
        g.fillStyle = tint > 0 ? 'rgba(255,250,235,' + tint + ')' : 'rgba(40,30,20,' + (-tint) + ')';
        g.fillRect(sx * 64 + 2, sy * 64 + 2, 60, 60);
        g.fillStyle = 'rgba(255,255,255,0.20)';
        g.fillRect(sx * 64 + 2, sy * 64 + 2, 60, 3);
        g.fillRect(sx * 64 + 2, sy * 64 + 2, 3, 60);
        g.fillStyle = 'rgba(50,40,30,0.25)';
        g.fillRect(sx * 64 + 2, sy * 64 + 59, 60, 3);
      }
    }
    for (var i = 0; i < 900; i++) {
      g.fillStyle = rng() > 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
      g.fillRect(rng() * 128, rng() * 128, 1.6, 1.6);
    }
    g.strokeStyle = 'rgba(60,50,40,0.6)'; g.lineWidth = 2.4;
    g.strokeRect(1, 1, 126, 126);
    g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(0, 64); g.lineTo(128, 64); g.stroke();
    var t = new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }

  var Roads = {
    lampPositions: [],
    waveMeshes: [],

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
      var sand = coastRibbon(function (x) { return -(54 + 12 * Math.sin(x * 0.009 + 1.7) + 7 * Math.sin(x * 0.023 + 0.4)); }, 8, -0.025, new THREE.MeshLambertMaterial({ color: pal.sand }));
      this.sandMesh = sand;
      // Wet-sand band at the waterline: darker, with a specular sheen.
      var wetMat = new THREE.MeshPhongMaterial({ color: 0x8a6f4d, shininess: 70, specular: 0x776644 });
      coastRibbon(0.5, 9.5, -0.018, wetMat);

      // Sea: the big deep plane plus a shore ribbon whose vertex
      // colours grade from pale shallow (with alpha fade at the very
      // edge) to the palette's deep water (Rev 6), so the shallows
      // read as shallows instead of one flat blue.
      var waterMat = new THREE.MeshPhongMaterial({ color: pal.water, shininess: 90, specular: 0x99ddff, transparent: true, opacity: 0.94 });
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

        var road = new THREE.Mesh(new THREE.PlaneGeometry(wRoad, len + wRoad), mat);
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
          for (var s = -1; s <= 1; s += 2) {
            var walk = new THREE.Mesh(slabGeo(cfg.sidewalk, len + wRoad, 0.14, Math.max(1, Math.round((len + wRoad) / 3))), walkMat);
            var wOff = cfg.roadHalf + cfg.sidewalk / 2;
            if (axis) {
              walk.rotation.x = -Math.PI / 2;
              if (!edges[i].vertical) walk.rotation.z = Math.PI / 2;
              walk.position.set(
                mx + (edges[i].vertical ? s * wOff : 0), 0,
                mz + (edges[i].vertical ? 0 : s * wOff));
            } else {
              walk.rotation.order = 'YXZ';
              walk.rotation.y = Math.atan2(-dx, -dz);
              walk.rotation.x = -Math.PI / 2;
              walk.position.set(mx + px * s * wOff, 0, mz + pz * s * wOff);
            }
            walk.receiveShadow = true;
            walk.updateMatrix();
            walkGeos.push(walk.geometry.clone().applyMatrix4(walk.matrix));
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
      // Zebra crossings at the six corner-plaza intersections (Rev 6):
      // white bars as real geometry, merged into a single mesh. Bars
      // run parallel to the traffic flow they cross.
      var zebraGeos = [];
      var zebraAt = [[0, -60], [-120, -180], [120, -300], [-360, 60], [240, 60], [360, -180]];
      var zq = new THREE.Quaternion(), zm = new THREE.Matrix4(), zv = new THREE.Vector3(), zs2 = new THREE.Vector3(1, 1, 1);
      function zebra(x, z, alongZ) {
        var geo = new THREE.BoxGeometry(alongZ ? 0.9 : 2.6, 0.03, alongZ ? 2.6 : 0.9);
        zv.set(x, 0.02, z);
        zm.compose(zv, zq, zs2);
        geo.applyMatrix4(zm);
        zebraGeos.push(geo);
      }
      for (var zi = 0; zi < zebraAt.length; zi++) {
        var zx = zebraAt[zi][0], zz = zebraAt[zi][1];
        for (var zs3 = 0; zs3 < 5; zs3++) {
          var off = -3.6 + zs3 * 1.8;
          zebra(zx + off, zz - cfg.roadHalf - 2.4, true);
          zebra(zx + off, zz + cfg.roadHalf + 2.4, true);
          zebra(zx - cfg.roadHalf - 2.4, zz + off, false);
          zebra(zx + cfg.roadHalf + 2.4, zz + off, false);
        }
      }
      if (zebraGeos.length) {
        var zebraMesh = new THREE.Mesh(SH.World.mergeGeos(zebraGeos), new THREE.MeshLambertMaterial({ color: 0xe8e8e2 }));
        zebraMesh.receiveShadow = true;
        scene.add(zebraMesh);
      }
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
