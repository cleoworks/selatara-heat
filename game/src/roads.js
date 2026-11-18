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
    for (var i = 0; i < 900; i++) {
      g.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
      g.fillRect(rng() * 128, rng() * 128, 2, 2);
    }
    g.fillStyle = '#e8c95a';
    for (var y = 8; y < 128; y += 32) g.fillRect(61, y, 6, 18); // centre dashes (vertical flow)
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

      // Base ground (grass/earth under everything).
      var ground = new THREE.Mesh(
        new THREE.PlaneGeometry(cfg.halfX * 2 + 400, cfg.halfZ * 2 + 400),
        new THREE.MeshLambertMaterial({ color: pal.grass })
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
      var roadMat = new THREE.MeshLambertMaterial({ map: tex, color: 0xffffff });
      this.roadMaterial = roadMat;
      var walkMat = new THREE.MeshLambertMaterial({ color: pal.sidewalk });
      this.walkMaterial = walkMat;
      var lampEvery = 42;

      for (var i = 0; i < edges.length; i++) {
        var a = nodes[edges[i].a], b = nodes[edges[i].b];
        var len = Math.hypot(b.x - a.x, b.z - a.z);
        var mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        var wRoad = cfg.roadHalf * 2;
        var t2 = tex.clone(); t2.needsUpdate = true;
        t2.repeat.set(1, Math.max(1, Math.round(len / 16)));
        if (!edges[i].vertical) t2.rotation = Math.PI / 2, t2.center.set(0.5, 0.5);
        var mat = new THREE.MeshLambertMaterial({ map: t2 });
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
          // Lamp spots along the edge.
          var steps = Math.floor(len / lampEvery);
          for (var k = 1; k <= steps; k++) {
            var t = k / (steps + 1);
            this.lampPositions.push({
              x: mx + (b.x - a.x) * (t - 0.5) + (edges[i].vertical ? cfg.roadHalf + 1 : 0),
              z: mz + (b.z - a.z) * (t - 0.5) + (edges[i].vertical ? 0 : cfg.roadHalf + 1)
            });
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
