// SELATARA HEAT — pedestrians.js
// Sidewalk pedestrians: pooled low-poly walkers who stroll between corners,
// idle and chat, panic-flee from danger, and fall when hit by a fast vehicle.
// Public API: SH.Pedestrians { init(scene), update(dt), list, scare(x, z, radius) }.
(function (SH) {
  'use strict';

  var shirtColors = [0xff8c5a, 0x37e0ff, 0xffd23f, 0x9fd8c0, 0xff4fa3, 0xf2e3c6, 0x7ac94f, 0xe8e3d8];

  function buildPedMesh(rng) {
    var g = new THREE.Group();
    var skin = new THREE.MeshLambertMaterial({ color: 0xb87a4e + ((rng() * 0x202020) | 0), flatShading: true });
    var shirt = new THREE.MeshLambertMaterial({ color: shirtColors[(rng() * shirtColors.length) | 0], flatShading: true });
    var pants = new THREE.MeshLambertMaterial({ color: 0x2a3040 + ((rng() * 0x101018) | 0), flatShading: true });
    function box(w, h, d, mat, x, y, z) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
    }
    var hair = new THREE.MeshLambertMaterial({ color: [0x14100c, 0x3a2415, 0x5e3a1e, 0x7a1f3d][(rng() * 4) | 0], flatShading: true });
    var legL = box(0.18, 0.86, 0.22, pants, -0.12, 0.88, 0); legL.geometry.translate(0, -0.38, 0);
    var legR = box(0.18, 0.86, 0.22, pants, 0.12, 0.88, 0); legR.geometry.translate(0, -0.38, 0);
    box(0.52, 0.62, 0.29, shirt, 0, 1.2, 0);
    var yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.25, 0.15, 4), shirt);
    yoke.rotation.y = Math.PI / 4; yoke.position.set(0, 1.53, 0); yoke.castShadow = true; g.add(yoke);
    var armL = box(0.13, 0.4, 0.16, shirt, -0.33, 1.47, 0); armL.geometry.translate(0, -0.16, 0);
    var armR = box(0.13, 0.4, 0.16, shirt, 0.33, 1.47, 0); armR.geometry.translate(0, -0.16, 0);
    armL.rotation.z = -0.07; armR.rotation.z = 0.07;
    var foreL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.32, 0.14), skin);
    foreL.position.set(0, -0.42, 0); foreL.castShadow = true; armL.add(foreL);
    var foreR = foreL.clone(); armR.add(foreR);
    box(0.13, 0.09, 0.13, skin, 0, 1.58, 0);
    box(0.24, 0.25, 0.24, skin, 0, 1.73, 0);
    box(0.26, 0.08, 0.26, hair, 0, 1.88, 0);
    return { group: g, legL: legL, legR: legR, armL: armL, armR: armR };
  }

  var Pedestrians = {
    list: [],
    rng: SH.World.makeRng(31),

    init: function (scene) {
      var n = SH.Config.loop.pedCount;
      for (var i = 0; i < n; i++) {
        var built = buildPedMesh(this.rng);
        scene.add(built.group);
        var ped = {
          mesh: built.group, parts: built,
          x: 0, z: 0, heading: 0, speed: 0, cycle: this.rng() * 6,
          tx: 0, tz: 0, state: 'walk', timer: this.rng() * 3, panic: 0, down: 0
        };
        this.list.push(ped);
        this.respawn(ped, true);
      }
    },

    respawn: function (ped, anywhere) {
      var g = SH.World.graph;
      var focus = SH.State.player;
      for (var tries = 0; tries < 10; tries++) {
        var node = g.nodes[(this.rng() * g.nodes.length) | 0];
        var x = node.x + (this.rng() - 0.5) * 16, z = node.z + (this.rng() - 0.5) * 16;
        var d = Math.hypot(x - focus.x, z - focus.z);
        if (!anywhere && (d < 50 || d > 300)) continue;
        if (anywhere && d < 25) continue;
        ped.x = x; ped.z = z; ped.down = 0; ped.state = 'walk';
        ped.mesh.rotation.x = 0;
        this.pickTarget(ped);
        ped.mesh.visible = true;
        return;
      }
      ped.mesh.visible = false;
    },

    pickTarget: function (ped) {
      // Walk to a point near another intersection, offset to a sidewalk.
      var g = SH.World.graph;
      var ni = SH.World.nearestNode(ped.x, ped.z);
      var node = g.nodes[ni];
      var ei = node.edges[(this.rng() * node.edges.length) | 0];
      var e = g.edges[ei];
      var other = g.nodes[e.a === ni ? e.b : e.a];
      var off = SH.Config.world.roadHalf + 1.6;
      ped.tx = other.x + (e.vertical ? off : (this.rng() - 0.5) * 4);
      ped.tz = other.z + (e.vertical ? (this.rng() - 0.5) * 4 : off);
    },

    scare: function (x, z, radius) {
      for (var i = 0; i < this.list.length; i++) {
        var ped = this.list[i];
        if (ped.down) continue;
        var d = Math.hypot(ped.x - x, ped.z - z);
        if (d < radius) {
          ped.state = 'panic'; ped.panic = 3 + this.rng() * 2;
          ped.tx = ped.x + (ped.x - x) / (d || 1) * 30;
          ped.tz = ped.z + (ped.z - z) / (d || 1) * 30;
        }
      }
    },

    update: function (dt) {
      var st = SH.State;
      var focus = st.driving ? st.vehiclePos : st.player;
      for (var i = 0; i < this.list.length; i++) {
        var ped = this.list[i];
        var distP = Math.hypot(ped.x - focus.x, ped.z - focus.z);
        if (distP > SH.Config.loop.despawnRadius) { if (st.mode === 'playing') this.respawn(ped, false); continue; }

        if (ped.down > 0) {
          ped.down -= dt;
          ped.mesh.rotation.x = Math.min(Math.PI / 2, ped.mesh.rotation.x + dt * 5);
          if (ped.down <= 0) this.respawn(ped, false);
          continue;
        }

        // Hit by the player's vehicle?
        if (st.driving && st.vehicle && Math.abs(st.vehicle.speed) > 3.5 && distP < 1.5) {
          ped.down = 6;
          if (SH.Police && SH.Police.witnessCrime) SH.Police.witnessCrime('hitPed', ped.x, ped.z);
          if (SH.HUD) SH.HUD.notify('You hit a pedestrian!');
          continue;
        }
        // Near a fast player car, jump aside in panic.
        if (st.driving && Math.abs(st.vehicle.speed) > 9 && distP < 6 && ped.state !== 'panic') {
          ped.state = 'panic'; ped.panic = 1.6;
          ped.tx = ped.x + (ped.x - focus.x) * 2; ped.tz = ped.z + (ped.z - focus.z) * 2;
        }

        var dx = ped.tx - ped.x, dz = ped.tz - ped.z;
        var dist = Math.hypot(dx, dz);
        var speed = ped.state === 'panic' ? 5.6 : 1.5;
        if (ped.state === 'idle') {
          ped.timer -= dt;
          speed = 0;
          if (ped.timer <= 0) { ped.state = 'walk'; this.pickTarget(ped); }
        } else if (dist < 1.6) {
          if (ped.state === 'panic') { ped.state = 'walk'; this.pickTarget(ped); }
          else if (this.rng() < 0.3) { ped.state = 'idle'; ped.timer = 2 + this.rng() * 4; }
          else this.pickTarget(ped);
        }
        if (ped.state === 'panic') { ped.panic -= dt; if (ped.panic <= 0) ped.state = 'walk'; }

        if (speed > 0 && dist > 0.1) {
          ped.heading = Math.atan2(dx / dist, dz / dist);
          ped.x += Math.sin(ped.heading) * speed * dt;
          ped.z += Math.cos(ped.heading) * speed * dt;
          ped.cycle += dt * speed * 2.6;
        }
        var s = Math.sin(ped.cycle * 2.2) * (speed > 0 ? 0.55 : 0.04);
        ped.parts.legL.rotation.x = s; ped.parts.legR.rotation.x = -s;
        ped.parts.armL.rotation.x = -s * 0.8; ped.parts.armR.rotation.x = s * 0.8;
        ped.mesh.position.set(ped.x, 0, ped.z);
        ped.mesh.rotation.y = ped.heading;
      }
    }
  };

  SH.Pedestrians = Pedestrians;
})(window.SH = window.SH || {});
