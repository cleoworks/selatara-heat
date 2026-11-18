// SELATARA HEAT — player.js
// On-foot third-person controller: WASD movement relative to camera, sprint,
// jump, procedural limb-swing character, over-shoulder camera with smoothing.
// Public API: SH.Player { build(scene), update(dt), mesh, enterVehicleMode(), exitVehicleMode() }.
(function (SH) {
  'use strict';

  var Player = {
    mesh: null,
    parts: null,
    walkCycle: 0,
    onFoot: true,

    build: function (scene) {
      var outfit = SH.State.outfit;
      var g = new THREE.Group();
      var skin = new THREE.MeshLambertMaterial({ color: 0xc98a5e, flatShading: true });
      var shirt = new THREE.MeshLambertMaterial({ color: outfit.shirt, flatShading: true });
      var pants = new THREE.MeshLambertMaterial({ color: outfit.pants, flatShading: true });
      var dark = new THREE.MeshLambertMaterial({ color: 0x22242c, flatShading: true });

      function box(w, h, d, mat, x, y, z) {
        var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.position.set(x, y, z); m.castShadow = true;
        g.add(m); return m;
      }
      var legL = box(0.22, 0.8, 0.26, pants, -0.16, 0.4, 0);
      var legR = box(0.22, 0.8, 0.26, pants, 0.16, 0.4, 0);
      legL.geometry.translate(0, -0.32, 0); legL.position.y = 0.8;
      legR.geometry.translate(0, -0.32, 0); legR.position.y = 0.8;
      box(0.62, 0.68, 0.34, shirt, 0, 1.14, 0);
      var armL = box(0.18, 0.66, 0.22, shirt, -0.42, 1.32, 0);
      var armR = box(0.18, 0.66, 0.22, shirt, 0.42, 1.32, 0);
      armL.geometry.translate(0, -0.26, 0); armL.position.y = 1.44;
      armR.geometry.translate(0, -0.26, 0); armR.position.y = 1.44;
      box(0.34, 0.38, 0.34, skin, 0, 1.68, 0);
      box(0.38, 0.1, 0.38, dark, 0, 1.9, 0); // cap

      this.parts = { legL: legL, legR: legR, armL: armL, armR: armR };
      this.mesh = g;
      scene.add(g);
      var p = SH.State.player;
      g.position.set(p.x, 0, p.z);
    },

    collide: function (p, radius) {
      var cols = SH.World.colliders;
      for (var i = 0; i < cols.length; i++) {
        var c = cols[i];
        var dx = p.x - c.x, dz = p.z - c.z;
        var px = c.hx + radius - Math.abs(dx), pz = c.hz + radius - Math.abs(dz);
        if (px > 0 && pz > 0) {
          if (px < pz) p.x = c.x + (dx > 0 ? c.hx + radius : -c.hx - radius);
          else p.z = c.z + (dz > 0 ? c.hz + radius : -c.hz - radius);
        }
      }
      var cfg = SH.Config.world;
      p.x = Math.max(-cfg.halfX - 30, Math.min(cfg.halfX + 30, p.x));
      p.z = Math.min(cfg.waterZ + 4, p.z);
      // Pier deck is walkable over the water.
      if (p.x > 53 && p.x < 67 && p.z > cfg.waterZ) p.z = Math.min(392, p.z);
      p.z = Math.max(-cfg.halfZ - 30, p.z);
    },

    update: function (dt) {
      var st = SH.State, p = st.player, input = SH.Input;
      if (!this.onFoot) { this.mesh.visible = false; return; }
      this.mesh.visible = true;

      var fwd = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
      var strafe = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
      var sprint = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
      var speed = sprint ? SH.Config.player.sprintSpeed : SH.Config.player.walkSpeed;
      var sin = Math.sin(st.camYaw), cos = Math.cos(st.camYaw);
      var mx = (strafe * cos - fwd * sin), mz = -(strafe * sin + fwd * cos);
      var len = Math.hypot(mx, mz);
      var moving = len > 0.01;
      if (moving) { mx /= len; mz /= len; p.heading = Math.atan2(mx, mz); }
      var accel = SH.Config.player.accel;
      p.vx += (mx * speed - p.vx) * Math.min(1, accel * dt / Math.max(1, speed));
      p.vz += (mz * speed - p.vz) * Math.min(1, accel * dt / Math.max(1, speed));
      p.x += p.vx * dt; p.z += p.vz * dt;

      if (input.wasPressed('Space') && p.y <= 0.01) p.vy = SH.Config.player.jumpSpeed;
      p.vy += SH.Config.player.gravity * dt;
      p.y += p.vy * dt;
      if (p.y < 0) { p.y = 0; p.vy = 0; }

      this.collide(p, SH.Config.player.radius);

      // Character pose + procedural walk swing.
      var spd = Math.hypot(p.vx, p.vz);
      this.walkCycle += dt * (4 + spd * 1.6);
      var swing = Math.min(1, spd / 4) * 0.62;
      var s = Math.sin(this.walkCycle * 2.4);
      this.parts.legL.rotation.x = s * swing;
      this.parts.legR.rotation.x = -s * swing;
      this.parts.armL.rotation.x = -s * swing * 0.8;
      this.parts.armR.rotation.x = s * swing * 0.8;
      this.mesh.position.set(p.x, p.y + Math.abs(Math.sin(this.walkCycle * 2.4)) * 0.05 * Math.min(1, spd / 4), p.z);
      this.mesh.rotation.y = p.heading;
      st.speedKmh = Math.round(spd * 3.6);
    },

    // Third-person camera: orbit behind the player, smoothed, ground-clamped.
    updateCamera: function (dt, camera) {
      var st = SH.State, p = st.player;
      var target = st.driving ? st.vehiclePos : p;
      var dist = st.aiming ? 3.1 : (st.driving ? 9.5 : 6.4);
      var height = st.driving ? 3.1 : 1.9;
      var back = new THREE.Vector3(Math.sin(st.camYaw) * Math.cos(st.camPitch), Math.sin(st.camPitch), Math.cos(st.camYaw) * Math.cos(st.camPitch));
      var cx = target.x + back.x * dist;
      var cy = (target.y || 0) + height + back.y * dist;
      var cz = target.z + back.z * dist;
      cy = Math.max(0.7, cy);
      if (!this._camPos) this._camPos = new THREE.Vector3(cx, cy, cz);
      var k = 1 - Math.pow(0.0001, dt);
      this._camPos.x += (cx - this._camPos.x) * k;
      this._camPos.y += (cy - this._camPos.y) * k;
      this._camPos.z += (cz - this._camPos.z) * k;
      camera.position.copy(this._camPos);
      var lookY = (target.y || 0) + (st.driving ? 1.6 : 1.55);
      camera.lookAt(target.x - back.x * 2, lookY, target.z - back.z * 2);
      var baseFov = st.driving && st.speedKmh > 80 ? 68 : 60;
      if (Math.abs(camera.fov - baseFov) > 0.1) { camera.fov += (baseFov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
    }
  };

  SH.Player = Player;
})(window.SH = window.SH || {});
