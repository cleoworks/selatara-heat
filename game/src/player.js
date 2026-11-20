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
      // STAGE E: Raka is a factory character now — the ONE character
      // system (archetype 'raka': maroon bomber, dark pants) animated
      // by the shared SH.CharAnim controller. No second figure path.
      var built = SH.CharFactory.create('raka', 1);
      this.fig = built;
      this.char = built;
      this.parts = built; // legacy alias
      // Same controller options every NPC gets (pedestrians/police/
      // combat/missions all pass the archetype's idle/gait/posture) —
      // the player must not run a special, posture-less path.
      var arch = SH.Archetypes.raka;
      this.ctl = SH.CharAnim.create(built, { start: 'idle', idle: arch.idle, gait: arch.gait, posture: arch.posture });
      this.mesh = built.group;
      scene.add(built.group);
      var p = SH.State.player;
      built.group.position.set(p.x, 0, p.z);
    },

    // Vehicles poses the player on the motorbike once per frame while
    // it drives the bike (Player.update does not run then): hold the
    // shared 'drive' clip and advance it a fixed step.
    applySeated: function () {
      if (!this.ctl) return;
      this.ctl.play('drive', 0.1);
      this.ctl.update(1 / 60);
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

      // Character animation (Stage E): the shared CharAnim
      // controller runs Raka — speed-synced gaits, aim clip while
      // aiming, melee/land one-shots, and the head-look layer aimed
      // by the camera. (The old rig's lean layer has no equivalent;
      // the gait clips carry their own forward lean.)
      var spd = Math.hypot(p.vx, p.vz);
      this.mesh.position.set(p.x, p.y, p.z);
      this.mesh.rotation.y = p.heading;
      var ctl = this.ctl;
      if (this._lockT > 0) {
        this._lockT -= dt; // a one-shot (melee / land) owns the body
      } else if ((st.meleePulse || 0) > 0) {
        st.meleePulse = 0;
        ctl.play('melee_r', 0.05, true);
        this._lockT = 0.30;
      } else if (p.y > 0.02) {
        ctl.play(p.vy > -0.5 ? 'jump' : 'fall', 0.12);
        this._wasAir = true;
      } else if (this._wasAir) {
        this._wasAir = false;
        ctl.play('land', 0.05, true);
        this._lockT = 0.22;
      } else if (st.aiming && spd < 0.5) {
        ctl.play('aim_pistol', 0.15);
      } else {
        ctl.setSpeed(spd);
      }
      if ((st.meleePulse || 0) > 0) st.meleePulse -= dt;
      // Head look is relative to where the CAMERA looks (camYaw + PI
      // is the view direction), so running straight reads as ~0.
      var lookYaw = st.camYaw + Math.PI - p.heading;
      while (lookYaw > Math.PI) lookYaw -= Math.PI * 2;
      while (lookYaw < -Math.PI) lookYaw += Math.PI * 2;
      var R2D = 180 / Math.PI;
      ctl.look(
        Math.max(-46, Math.min(46, lookYaw * R2D)),
        Math.max(-23, Math.min(23, (st.camPitch || 0) * 0.7 * R2D))
      );
      ctl.update(dt);
      st.speedKmh = Math.round(spd * 3.6);
    },

    // Third-person camera: orbit behind the player, smoothed, ground-clamped.
    // Driving uses the screenshot-grade framing: low (about 1.6 m over the
    // road), close behind-side with a lateral offset, FOV 65, so the car
    // fills a good slice of the frame instead of floating in the distance.
    // ON-FOOT DEFAULT (FX reset, user spec): back distance 6.1 m
    // (horizontal ~6.0 m at the default pitch), base height 1.40 m
    // (shoulder line) and look height 1.40 m — with the default
    // camPitch of 0.19 rad the lens sits at ~2.55 m and the view
    // axis pitches ~11 deg down through the chest, so the whole
    // body, head to shoes, is in frame with margin (measured on
    // the FX staging: head NDC ~0.0, feet NDC ~-0.4 at FOV 60).
    // No shot / close-up / cutscene value feeds this branch:
    // _shotCamDist is driving-only and _shotAimDist aiming-only
    // by construction.
    // Polish c2: the driving camera scales with the vehicle. One
    // fixed 5.4 m / 1.55 m frame fits a sedan, but the container
    // truck (7.6 m long, 3.1 m tall, cargo rear face 3.8 m behind
    // centre) filled the whole frame with its cargo box the moment
    // you climbed in (milestone-b observation). For large vehicles
    // the distance, camera height and look height derive from the
    // vehicle's own spec; cars and bikes keep the exact old frame.
    driveCamSpec: function () {
      var st = SH.State;
      var spec = (st.vehicle && st.vehicle.spec) || null;
      if (!spec) return { dist: 5.4, height: 1.55, lookY: 1.15 };
      return {
        dist: spec.length > 5.5 ? Math.max(5.4, spec.length * 1.05 + 1.6) : 5.4,
        height: spec.height > 2 ? Math.max(1.55, spec.height * 0.72) : 1.55,
        lookY: spec.height > 2 ? Math.max(1.15, spec.height * 0.5) : 1.15
      };
    },
    updateCamera: function (dt, camera) {
      var st = SH.State, p = st.player;
      var target = st.driving ? st.vehiclePos : p;
      var dcs = st.driving ? this.driveCamSpec() : null;
      var dist = st.aiming ? (st._shotAimDist || 3.1) : (st.driving ? (st._shotCamDist || dcs.dist) : 6.1);
      var height = st.driving ? dcs.height : 1.40;
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
      var lookY = (target.y || 0) + (st.driving ? dcs.lookY : 1.40);
      // FX camera reset: on foot the view axis goes through the
      // chest point itself (no forward lead) — with the 2 m lead
      // the axis flattened to ~8 deg; through the chest it is the
      // spec ~11 deg. Driving keeps its 2 m lead.
      var lookAhead = st.driving ? 2 : 0;
      camera.lookAt(target.x - back.x * lookAhead, lookY, target.z - back.z * lookAhead);
      var baseFov = st.driving ? (st.speedKmh > 80 ? 68 : 65) : 60;
      if (Math.abs(camera.fov - baseFov) > 0.1) { camera.fov += (baseFov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
    }
  };

  SH.Player = Player;
})(window.SH = window.SH || {});
