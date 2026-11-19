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
      // Raka is built by the shared figure builder (Art Pass 3): sphere
      // head with a real face, trapezoid torso, cylinder limbs — in his
      // signature outfit colours and dark cap from State.outfit.
      var outfit = SH.State.outfit;
      var built = SH.Pedestrians.buildFigure({
        skin: 0xc98a5e,
        shirt: outfit.shirt,
        pants: outfit.pants,
        hairStyle: 'hat',
        hatColor: 0x22242c,
        face: 0
      });
      this.fig = built;
      this.parts = built; // legacy alias (fig carries shirtMat + bones)
      this.mesh = built.group;
      scene.add(built.group);
      var p = SH.State.player;
      built.group.position.set(p.x, 0, p.z);
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
      // Inland water (W1): Danau Cermin, Kali Arus and the canals stop
      // wading — SH.World.waterPush returns the nearest bank point and
      // exempts the bridge corridors.
      var wp = SH.World.waterPush(p.x, p.z, radius);
      if (wp) { p.x = wp.x; p.z = wp.z; }
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
      if (!this.onFoot) {
        // While driving, Vehicles.updatePlayerVehicle owns the mesh (it
        // hides Raka inside cars and poses him on the motorbike).
        this.mesh.visible = false;
        return;
      }
      this.mesh.visible = true;
      this.mesh.rotation.x = 0;

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

      // Character animation (Rev 7): the bone rig runs the clips; the
      // procedural layer aims the gun arm, turns the head toward the
      // camera's look direction, and leans the body into movement.
      var spd = Math.hypot(p.vx, p.vz);
      this.mesh.position.set(p.x, p.y, p.z);
      this.mesh.rotation.y = p.heading;
      this.fig.setSpeed(spd / 5.6);
      this.fig.aimTarget = (st.aiming || (st.aimPulse || 0) > 0) ? 1 : 0;
      if ((st.aimPulse || 0) > 0) st.aimPulse -= dt;
      // Head look is relative to where the CAMERA looks (camYaw + PI
      // is the view direction), so running straight reads as ~0.
      var lookYaw = st.camYaw + Math.PI - p.heading;
      while (lookYaw > Math.PI) lookYaw -= Math.PI * 2;
      while (lookYaw < -Math.PI) lookYaw += Math.PI * 2;
      this.fig.lookYaw = Math.max(-0.8, Math.min(0.8, lookYaw));
      this.fig.lookPitch = Math.max(-0.4, Math.min(0.4, (st.camPitch || 0) * 0.7));
      this.fig.leanX = Math.min(0.14, spd / 5.6 * 0.14) * (moving ? 1 : 0);
      this.fig.update(dt);
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
