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
      // Proportions (Art Pass 2): long slim legs, a tapered shoulder yoke
      // so shoulders slope instead of ending in a T, two-segment arms, and
      // a head that is under 1/7.5 of the total height (~1.92 m).
      var legL = box(0.18, 0.86, 0.22, pants, -0.12, 0.88, 0);
      var legR = box(0.18, 0.86, 0.22, pants, 0.12, 0.88, 0);
      legL.geometry.translate(0, -0.38, 0);
      legR.geometry.translate(0, -0.38, 0);
      box(0.52, 0.62, 0.29, shirt, 0, 1.2, 0);
      var yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.25, 0.15, 4), shirt);
      yoke.rotation.y = Math.PI / 4; yoke.position.set(0, 1.53, 0); yoke.castShadow = true; g.add(yoke);
      var armL = box(0.13, 0.4, 0.16, shirt, -0.33, 1.47, 0);
      var armR = box(0.13, 0.4, 0.16, shirt, 0.33, 1.47, 0);
      armL.geometry.translate(0, -0.16, 0);
      armR.geometry.translate(0, -0.16, 0);
      armL.rotation.z = -0.07; armR.rotation.z = 0.07;
      var foreL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.32, 0.14), skin);
      foreL.position.set(0, -0.42, 0); foreL.castShadow = true; armL.add(foreL);
      var foreR = foreL.clone(); armR.add(foreR);
      box(0.13, 0.09, 0.13, skin, 0, 1.58, 0);     // neck
      box(0.24, 0.25, 0.24, skin, 0, 1.73, 0);     // head
      box(0.27, 0.08, 0.27, dark, 0, 1.88, 0);     // cap
      box(0.27, 0.04, 0.15, dark, 0, 1.84, 0.19);  // cap brim

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
      // Shoreline (Art Pass 3): the waterline curves with coastZ(x). The
      // pier, the bridge corridor and Pulau Seberang are walkable over the
      // water (SH.World.isLand decides); everywhere else the shallows stop
      // you a few metres past the waterline. Straying sideways off the
      // bridge lands you back on the deck (the rails hold you), and the
      // island has its own rim pull-back — stepping off it must never
      // teleport you back to the mainland shore.
      if (p.z > SH.World.coastZ(p.x) + 4 && !SH.World.isLand(p.x, p.z)) {
        var bc = SH.World.bridgeClosest(p.x, p.z);
        if (bc.dist < 30) {
          var pull = Math.min(1, 7.2 / Math.max(bc.dist, 0.001));
          p.x = bc.x + (p.x - bc.x) * pull;
          p.z = bc.z + (p.z - bc.z) * pull;
        } else if (p.z < 380) {
          p.z = SH.World.coastZ(p.x) + 4;
        } else {
          var isl = SH.Config.island;
          var ex = (p.x - isl.x) / (isl.rx + 6), ez = (p.z - isl.z) / (isl.rz + 6);
          var ee = ex * ex + ez * ez;
          if (ee > 1) { var sc = 1 / Math.sqrt(ee); p.x = isl.x + (p.x - isl.x) * sc; p.z = isl.z + (p.z - isl.z) * sc; }
        }
      }
      if (p.x > 53 && p.x < 67 && p.z > 392) p.z = 392; // pier end cap
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
    // Driving uses the screenshot-grade framing: low (about 1.6 m over the
    // road), close behind-side with a lateral offset, FOV 65, so the car
    // fills a good slice of the frame instead of floating in the distance.
    updateCamera: function (dt, camera) {
      var st = SH.State, p = st.player;
      var target = st.driving ? st.vehiclePos : p;
      var dist = st.aiming ? (st._shotAimDist || 3.1) : (st.driving ? (st._shotCamDist || 5.4) : 6.4);
      var height = st.driving ? 1.55 : 1.9;
      var back = new THREE.Vector3(Math.sin(st.camYaw) * Math.cos(st.camPitch), Math.sin(st.camPitch), Math.cos(st.camYaw) * Math.cos(st.camPitch));
      var cx = target.x + back.x * dist;
      var cy = (target.y || 0) + height + back.y * dist;
      var cz = target.z + back.z * dist;
      if (st.driving) {
        // Lateral offset: shift along the camera's right vector.
        var rx = back.z, rz = -back.x;
        cx += rx * 1.7; cz += rz * 1.7;
      }
      cy = Math.max(0.7, cy);
      if (!this._camPos) this._camPos = new THREE.Vector3(cx, cy, cz);
      var k = 1 - Math.pow(0.0001, dt);
      this._camPos.x += (cx - this._camPos.x) * k;
      this._camPos.y += (cy - this._camPos.y) * k;
      this._camPos.z += (cz - this._camPos.z) * k;
      camera.position.copy(this._camPos);
      var lookY = (target.y || 0) + (st.driving ? 1.15 : 1.55);
      camera.lookAt(target.x - back.x * 2, lookY, target.z - back.z * 2);
      var baseFov = st.driving ? (st.speedKmh > 80 ? 68 : 65) : 60;
      if (Math.abs(camera.fov - baseFov) > 0.1) { camera.fov += (baseFov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
    }
  };

  SH.Player = Player;
})(window.SH = window.SH || {});
