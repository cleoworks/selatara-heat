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

      // Sand strip along the beach.
      var sand = new THREE.Mesh(
        new THREE.PlaneGeometry(cfg.halfX * 2 + 400, 90),
        new THREE.MeshLambertMaterial({ color: pal.sand })
      );
      sand.rotation.x = -Math.PI / 2;
      sand.position.set(0, -0.03, cfg.beachZ + 55);
      sand.receiveShadow = true;
      scene.add(sand);
      this.sandMesh = sand;

      // Sea: big animated-tinted plane south of the beach + around the land.
      var water = new THREE.Mesh(
        new THREE.PlaneGeometry(4000, 4000),
        new THREE.MeshPhongMaterial({ color: pal.water, shininess: 90, specular: 0x99ddff, transparent: true, opacity: 0.94 })
      );
      water.rotation.x = -Math.PI / 2;
      water.position.set(0, -0.55, cfg.waterZ + 1750);
      scene.add(water);
      this.waterMesh = water;

      // Foam/wave lines creeping on the shore.
      var foamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
      for (var w = 0; w < 3; w++) {
        var foam = new THREE.Mesh(new THREE.PlaneGeometry(cfg.halfX * 2 + 300, 2.2), foamMat);
        foam.rotation.x = -Math.PI / 2;
        foam.position.set(0, 0.02, cfg.waterZ + w * 7);
        scene.add(foam);
        this.waveMeshes.push(foam);
      }

      // Roads: one plane per graph edge, textured asphalt with dashes.
      var tex = asphaltTexture();
      var edges = SH.World.graph.edges, nodes = SH.World.graph.nodes;
      var roadMat = new THREE.MeshPhongMaterial({ map: tex, color: 0xffffff, shininess: 26, specular: 0x8a6a4a });
      this.roadMaterial = roadMat;
      this.roadMaterials = [];
      var walkMat = new THREE.MeshLambertMaterial({ color: pal.sidewalk, map: walkTexture() });
      this.walkMaterial = walkMat;
      var lampEvery = 26;

      for (var i = 0; i < edges.length; i++) {
        var a = nodes[edges[i].a], b = nodes[edges[i].b];
        var len = Math.hypot(b.x - a.x, b.z - a.z);
        var mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        var wRoad = cfg.roadHalf * 2;
        var t2 = tex.clone(); t2.needsUpdate = true;
        t2.repeat.set(1, Math.max(1, Math.round(len / 9)));
        if (!edges[i].vertical) t2.rotation = Math.PI / 2, t2.center.set(0.5, 0.5);
        var mat = new THREE.MeshPhongMaterial({ map: t2, shininess: 26, specular: 0x8a6a4a });
        this.roadMaterials.push(mat);
        var road = new THREE.Mesh(new THREE.PlaneGeometry(wRoad, len + wRoad), mat);
        road.rotation.x = -Math.PI / 2;
        if (!edges[i].vertical) road.rotation.z = Math.PI / 2;
        road.position.set(mx, 0, mz);
        road.receiveShadow = true;
        scene.add(road);

        // Sidewalks on both sides of grid streets (not the ring highway).
        var isRing = len > 700;
        if (!isRing) {
          for (var s = -1; s <= 1; s += 2) {
            var walk = new THREE.Mesh(new THREE.PlaneGeometry(cfg.sidewalk, len + wRoad), walkMat);
            walk.rotation.x = -Math.PI / 2;
            if (!edges[i].vertical) walk.rotation.z = Math.PI / 2;
            var off = cfg.roadHalf + cfg.sidewalk / 2;
            walk.position.set(
              mx + (edges[i].vertical ? s * off : 0), 0.04,
              mz + (edges[i].vertical ? 0 : s * off));
            walk.receiveShadow = true;
            scene.add(walk);
          }
          // Lamp spots along BOTH edges of the street.
          var steps = Math.floor(len / lampEvery);
          for (var k = 1; k <= steps; k++) {
            var t = k / (steps + 1);
            for (var side = -1; side <= 1; side += 2) {
              this.lampPositions.push({
                x: mx + (b.x - a.x) * (t - 0.5) + (edges[i].vertical ? side * (cfg.roadHalf + 1) : 0),
                z: mz + (b.z - a.z) * (t - 0.5) + (edges[i].vertical ? 0 : side * (cfg.roadHalf + 1))
              });
            }
          }
        }
      }
    },

    update: function (dt, elapsed) {
      for (var i = 0; i < this.waveMeshes.length; i++) {
        var m = this.waveMeshes[i];
        m.position.z = SH.Config.world.waterZ + i * 7 + Math.sin(elapsed * 0.7 + i * 1.7) * 2.4;
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
