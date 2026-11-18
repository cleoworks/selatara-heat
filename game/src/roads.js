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
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }

  function groundTexture() {
    var c = document.createElement('canvas'); c.width = c.height = 256;
    var g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
    var rng = SH.World.makeRng(31);
    for (var i = 0; i < 2600; i++) {
      var v = rng();
      g.fillStyle = v > 0.6 ? 'rgba(30,60,20,0.16)' : (v > 0.3 ? 'rgba(120,100,50,0.10)' : 'rgba(255,255,220,0.05)');
      g.fillRect(rng() * 256, rng() * 256, 3 + rng() * 9, 3 + rng() * 9);
    }
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(46, 40);
    t.anisotropy = 4;
    return t;
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
      function coastRibbon(offNear, offFar, y, mat) {
        var xs2 = [], step = 24;
        for (var rx = -860; rx <= 860; rx += step) xs2.push(rx);
        var posArr = new Float32Array(xs2.length * 2 * 3);
        var uvArr = new Float32Array(xs2.length * 2 * 2);
        var idx = [];
        for (var vi = 0; vi < xs2.length; vi++) {
          var vx = xs2[vi], cz = SH.World.coastZ(vx);
          posArr.set([vx, y, cz + offNear, vx, y, offFar === null ? 820 : cz + offFar], vi * 6);
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
      var sand = coastRibbon(-64, 8, -0.025, new THREE.MeshLambertMaterial({ color: pal.sand }));
      this.sandMesh = sand;

      // Sea: one shared water material — the big deep plane plus a shore
      // ribbon that starts at the curved waterline and runs south, so the
      // bays actually fill with water instead of showing bare ground.
      var waterMat = new THREE.MeshPhongMaterial({ color: pal.water, shininess: 90, specular: 0x99ddff, transparent: true, opacity: 0.94 });
      var water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), waterMat);
      water.rotation.x = -Math.PI / 2;
      water.position.set(0, -0.55, cfg.waterZ + 1750);
      scene.add(water);
      this.waterMesh = water;
      coastRibbon(-6, null, -0.045, waterMat);

      // Foam lines creeping on the curved shore.
      var foamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
      for (var w = 0; w < 3; w++) {
        var foam = coastRibbon(1.5 + w * 7, 3.7 + w * 7, 0.02, foamMat);
        foam.receiveShadow = false;
        this.waveMeshes.push(foam);
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
      var walkMat = new THREE.MeshLambertMaterial({ color: pal.sidewalk, map: walkTexture() });
      this.walkMaterial = walkMat;
      var deckMat = new THREE.MeshLambertMaterial({ color: 0x6a5f52 });
      var railMat = new THREE.MeshLambertMaterial({ color: 0x8a4a3a });
      var lampEvery = 26;

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
          scene.add(top);
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
        scene.add(road);

        // Sidewalks + lamps on city streets (not ring, alley or bridge).
        if (kind === 'grid' || kind === 'diag' || kind === 'coast') {
          for (var s = -1; s <= 1; s += 2) {
            var walk = new THREE.Mesh(new THREE.PlaneGeometry(cfg.sidewalk, len + wRoad), walkMat);
            var wOff = cfg.roadHalf + cfg.sidewalk / 2;
            if (axis) {
              walk.rotation.x = -Math.PI / 2;
              if (!edges[i].vertical) walk.rotation.z = Math.PI / 2;
              walk.position.set(
                mx + (edges[i].vertical ? s * wOff : 0), 0.04,
                mz + (edges[i].vertical ? 0 : s * wOff));
            } else {
              walk.rotation.order = 'YXZ';
              walk.rotation.y = Math.atan2(-dx, -dz);
              walk.rotation.x = -Math.PI / 2;
              walk.position.set(mx + px * s * wOff, 0.04, mz + pz * s * wOff);
            }
            walk.receiveShadow = true;
            scene.add(walk);
          }
          // Lamp spots along BOTH edges of the street.
          var steps = Math.floor(len / lampEvery);
          for (var k = 1; k <= steps; k++) {
            var t = k / (steps + 1);
            for (var side = -1; side <= 1; side += 2) {
              this.lampPositions.push({
                x: a.x + dx * t + px * side * (cfg.roadHalf + 1),
                z: a.z + dz * t + pz * side * (cfg.roadHalf + 1)
              });
            }
          }
        }
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

    applyPalette: function (pal) {
      if (this.groundMesh) this.groundMesh.material.color.setHex(pal.grass);
      if (this.sandMesh) this.sandMesh.material.color.setHex(pal.sand);
      if (this.waterMesh) this.waterMesh.material.color.setHex(pal.water);
      if (this.walkMaterial) this.walkMaterial.color.setHex(pal.sidewalk);
    }
  };

  SH.Roads = Roads;
})(window.SH = window.SH || {});
