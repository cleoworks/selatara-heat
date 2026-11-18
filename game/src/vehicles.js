// SELATARA HEAT — vehicles.js
// Vehicle factory (sedan/sport/truck/motorcycle/boat/police), arcade bicycle
// physics, enter/exit + carjacking, lights, damage with smoke and explosion.
// Public API: SH.Vehicles { buildPool(scene), list, nearestUsable(), updateInteractions(dt), updatePlayerVehicle(dt), damage(veh, amount) }.
(function (SH) {
  'use strict';

  function buildMesh(type, colorHex) {
    var spec = SH.Config.vehicleTypes[type];
    var g = new THREE.Group();
    var paint = new THREE.MeshLambertMaterial({ color: colorHex, flatShading: true });
    var dark = new THREE.MeshLambertMaterial({ color: 0x1c1e24, flatShading: true });
    var glass = new THREE.MeshLambertMaterial({ color: 0x9fd4e8, flatShading: true });
    var L = spec.length, W = spec.width, H = spec.height;
    var wheels = [];

    function box(w, h, d, mat, x, y, z) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z); m.castShadow = true;
      g.add(m); return m;
    }
    function wheel(x, z, r) {
      var w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.28, 10), dark);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, r, z);
      g.add(w); wheels.push(w);
      return w;
    }

    var headMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
    var tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
    var brakeMat = new THREE.MeshBasicMaterial({ color: 0xff6060 });

    if (type === 'motor') {
      box(0.34, 0.4, 1.7, paint, 0, 0.62, 0);
      box(0.3, 0.34, 0.5, dark, 0, 0.86, -0.3);
      wheel(0, 0.82, 0.34); wheel(0, -0.82, 0.34);
    } else if (type === 'truck') {
      box(W * 0.92, 1.1, 1.9, paint, 0, 1.05, L * 0.32);            // cab
      box(W * 0.8, 0.5, 0.9, glass, 0, 1.42, L * 0.28);
      box(W, H - 0.7, L * 0.58, new THREE.MeshLambertMaterial({ color: 0xd8d3c8, flatShading: true }), 0, (H - 0.7) / 2 + 0.55, -L * 0.18); // cargo
      wheel(-W / 2, L * 0.3, 0.5); wheel(W / 2, L * 0.3, 0.5);
      wheel(-W / 2, -L * 0.32, 0.5); wheel(W / 2, -L * 0.32, 0.5);
    } else if (type === 'boat') {
      box(W, 0.7, L, paint, 0, 0.45, 0);
      box(W * 0.7, 0.5, L * 0.4, glass, 0, 0.95, L * 0.08);
    } else {
      box(W, H * 0.52, L, paint, 0, H * 0.42, 0);                    // body
      box(W * 0.84, H * 0.42, L * 0.48, glass, 0, H * 0.82, -L * 0.04); // cabin
      if (type === 'sport') box(W * 0.9, 0.09, 0.5, dark, 0, H * 0.78, -L * 0.46); // spoiler
      if (type === 'police') {
        box(W * 0.7, 0.16, 0.4, new THREE.MeshBasicMaterial({ color: 0xff2a4a }), 0, H * 1.08, 0);
      }
      var r = type === 'sport' ? 0.36 : 0.4;
      wheel(-W / 2, L * 0.31, r); wheel(W / 2, L * 0.31, r);
      wheel(-W / 2, -L * 0.31, r); wheel(W / 2, -L * 0.31, r);
    }
    // Lights: front = +z face of the model.
    var hw = Math.max(0.3, W * 0.32);
    var h1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), headMat); h1.position.set(-hw, H * 0.5, L / 2 + 0.02); g.add(h1);
    var h2 = h1.clone(); h2.position.x = hw; g.add(h2);
    var t1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), tailMat); t1.position.set(-hw, H * 0.52, -L / 2 - 0.02); g.add(t1);
    var t2 = t1.clone(); t2.position.x = hw; g.add(t2);

    return { group: g, wheels: wheels, tailMat: tailMat, brakeMat: brakeMat, headMat: headMat };
  }

  var Vehicles = {
    list: [],
    parkedSpots: [
      // Hand-placed stealable cars near the spawn and around town (on road edges).
      { type: 'sedan', x: -352, z: 128, heading: Math.PI / 2 },
      { type: 'sport', x: -352, z: 30, heading: Math.PI / 2 },
      { type: 'motor', x: -368, z: 66, heading: -Math.PI / 2 },
      { type: 'sedan', x: 112, z: -188, heading: -Math.PI / 2 },
      { type: 'sport', x: 300, z: -68, heading: Math.PI },
      { type: 'truck', x: 330, z: 66, heading: 0 },
      { type: 'sedan', x: -128, z: 186, heading: 0 },
      { type: 'motor', x: 52, z: 234, heading: Math.PI / 2 },
      { type: 'sedan', x: -248, z: -308, heading: 0 },
      { type: 'sport', x: 420, z: -128, heading: Math.PI }
    ],

    spawnVehicle: function (scene, type, colorHex, x, z, heading) {
      var built = buildMesh(type, colorHex);
      built.group.position.set(x, 0, z);
      built.group.rotation.y = heading;
      scene.add(built.group);
      var veh = {
        type: type, spec: SH.Config.vehicleTypes[type], mesh: built.group, wheels: built.wheels,
        tailMat: built.tailMat, brakeMat: built.brakeMat, headMat: built.headMat,
        x: x, z: z, y: 0, heading: heading, speed: 0, steer: 0, hp: 100,
        driver: 'parked', active: true, smokeTimer: 0, dead: false, color: colorHex
      };
      this.list.push(veh);
      return veh;
    },

    buildPool: function (scene) {
      var rng = SH.World.makeRng(99);
      for (var i = 0; i < this.parkedSpots.length; i++) {
        var s = this.parkedSpots[i];
        var colors = SH.Config.vehicleTypes[s.type].colors;
        this.spawnVehicle(scene, s.type, colors[(rng() * colors.length) | 0], s.x, s.z, s.heading);
      }
      // Player headlight (one real spotlight, only lit at night).
      this.headlight = new THREE.SpotLight(0xffe9b8, 0, 60, 0.62, 0.5, 1.2);
      scene.add(this.headlight);
      scene.add(this.headlight.target);
    },

    nearestUsable: function () {
      var p = SH.State.player, best = null, bd = 4.2;
      for (var i = 0; i < this.list.length; i++) {
        var v = this.list[i];
        if (!v.active || v.dead || v.driver === 'traffic' || v.driver === 'police' || v.driver === 'roadblock') continue;
        var d = Math.hypot(v.x - p.x, v.z - p.z);
        if (d < bd) { bd = d; best = v; }
      }
      return best;
    },

    enter: function (veh) {
      var st = SH.State;
      veh.driver = 'player';
      st.driving = true;
      st.vehicle = veh;
      SH.Player.onFoot = false;
      st.stats.carsStolen++;
      if (SH.Audio && SH.Audio.radio) SH.Audio.radio(true);
      if (SH.HUD) SH.HUD.notify('Driving: ' + veh.spec.label);
      if (SH.Police && SH.Police.witnessCrime) SH.Police.witnessCrime('steal', veh.x, veh.z);
    },

    exit: function () {
      var st = SH.State, veh = st.vehicle;
      if (!veh) return;
      veh.driver = 'parked';
      veh.speed = 0;
      st.driving = false;
      st.vehicle = null;
      SH.Player.onFoot = true;
      var side = veh.heading + Math.PI / 2;
      st.player.x = veh.x + Math.sin(side) * 2.4;
      st.player.z = veh.z + Math.cos(side) * 2.4;
      st.player.y = 0; st.player.vy = 0;
      SH.Audio.engine(0, false);
      if (SH.Audio && SH.Audio.radio) SH.Audio.radio(false);
    },

    updateInteractions: function (dt) {
      var st = SH.State, input = SH.Input;
      if (st.mode !== 'playing') return;
      if (!st.driving) {
        var near = this.nearestUsable();
        if (SH.HUD) SH.HUD.setPrompt(near ? 'F — Enter ' + near.spec.label : null);
        if (near && input.wasPressed('KeyF')) this.enter(near);
      } else if (input.wasPressed('KeyF')) {
        this.exit();
      }
    },

    collideWorld: function (v, dt) {
      var cols = SH.World.colliders;
      var radius = v.spec.length * 0.32;
      for (var i = 0; i < cols.length; i++) {
        var c = cols[i];
        var dx = v.x - c.x, dz = v.z - c.z;
        var px = c.hx + radius - Math.abs(dx), pz = c.hz + radius - Math.abs(dz);
        if (px > 0 && pz > 0) {
          var impact = Math.abs(v.speed);
          if (px < pz) v.x = c.x + (dx > 0 ? c.hx + radius : -c.hx - radius);
          else v.z = c.z + (dz > 0 ? c.hz + radius : -c.hz - radius);
          // Police units are armoured against scenery (they die to gunfire and
          // player rams, not to kerbs); traffic takes half building damage.
          if (impact > 6 && v.driver !== 'police' && v.driver !== 'roadblock') {
            this.damage(v, impact * (v.driver === 'player' ? 1.1 : 0.5));
            if (v.driver === 'player') SH.Effects.shake(0.25);
          }
          v.speed *= -0.25;
        }
      }
      var cfg = SH.Config.world;
      v.x = Math.max(-cfg.halfX - 20, Math.min(cfg.halfX + 20, v.x));
      if (v.type !== 'boat') v.z = Math.min(cfg.waterZ + 2, v.z);
      v.z = Math.max(-cfg.halfZ - 20, v.z);
    },

    damage: function (v, amount) {
      if (v.dead) return;
      v.hp -= amount;
      if (v.hp <= 0) {
        v.hp = 0; v.dead = true;
        SH.Effects.explosion(v.x, 0.6, v.z);
        if (SH.Audio && SH.Audio.boom) SH.Audio.boom();
        if (SH.Police && SH.Police.witnessCrime && (v.driver === 'police' || v.driver === 'roadblock')) SH.Police.witnessCrime('killPolice', v.x, v.z);
        v.speed = 0;
        if (v.driver === 'player') {
          SH.State.player.health = Math.max(5, SH.State.player.health - 25);
          this.exit();
          SH.State.player.health = Math.max(5, SH.State.player.health);
        }
      }
    },

    updatePlayerVehicle: function (dt) {
      var st = SH.State, v = st.vehicle, input = SH.Input;
      if (!v) return;
      var spec = v.spec;
      var throttle = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
      var steerIn = (input.isDown('KeyA') ? 1 : 0) - (input.isDown('KeyD') ? 1 : 0);
      var handbrake = input.isDown('Space');

      if (throttle > 0) v.speed += spec.accel * dt * (1 - Math.max(0, v.speed) / spec.maxSpeed);
      else if (throttle < 0) v.speed -= (v.speed > 0.5 ? spec.brake : spec.accel * 0.6) * dt;
      else v.speed -= v.speed * 0.35 * dt; // engine braking / drag
      if (handbrake) v.speed -= v.speed * 2.2 * dt;
      v.speed = Math.max(-spec.maxSpeed * 0.32, Math.min(spec.maxSpeed, v.speed));

      v.steer += (steerIn * 0.55 - v.steer) * Math.min(1, dt * 8);
      var grip = handbrake ? spec.grip * 0.35 : spec.grip;
      var yawRate = v.steer * spec.turn * (v.speed / (Math.abs(v.speed) + 6)) * (grip / spec.grip);
      v.heading += yawRate * dt * (v.speed >= 0 ? 1 : -1) * (Math.abs(v.speed) > 0.2 ? 1 : 0);

      v.x += Math.sin(v.heading) * v.speed * dt;
      v.z += Math.cos(v.heading) * v.speed * dt;
      this.collideWorld(v, dt);

      // Sync mesh + visuals.
      v.mesh.position.set(v.x, 0, v.z);
      v.mesh.rotation.y = v.heading;
      v.mesh.rotation.z = -v.steer * Math.min(1, Math.abs(v.speed) / 20) * 0.06;
      v.mesh.rotation.x = (throttle > 0 ? -0.012 : throttle < 0 ? 0.014 : 0) * Math.min(1, Math.abs(v.speed) / 12);
      for (var i = 0; i < v.wheels.length; i++) v.wheels[i].rotation.x += v.speed * dt / 0.4;
      this.setBrakeLights(v, throttle < 0 || handbrake);

      st.vehiclePos.x = v.x; st.vehiclePos.z = v.z; st.vehiclePos.y = 0;
      st.speedKmh = Math.round(Math.abs(v.speed) * 3.6);
      st.camYaw = v.heading + Math.PI + (st.camYaw - (v.heading + Math.PI)) * Math.pow(0.4, dt); // camera eases behind the car
      if (input.locked) { /* mouse still free-looks via main step */ }
      var rpm = Math.min(1, Math.abs(v.speed) / spec.maxSpeed * 0.8 + (throttle > 0 ? 0.25 : 0.08));
      SH.Audio.engine(rpm, true);
      if (input.wasPressed('KeyH')) SH.Audio.horn();

      if (v.hp < 45 && !v.dead) {
        v.smokeTimer -= dt;
        if (v.smokeTimer <= 0) { SH.Effects.smoke(v.x, 1.1, v.z, v.hp < 22); v.smokeTimer = 0.09; }
      }
      // Headlight follows at night.
      if (this.headlight) {
        var night = (st.hour >= 18.6 || st.hour < 5.6);
        this.headlight.intensity = night ? 2.4 : 0;
        if (night) {
          this.headlight.position.set(v.x, 1.4, v.z);
          this.headlight.target.position.set(v.x + Math.sin(v.heading) * 18, 0, v.z + Math.cos(v.heading) * 18);
          this.headlight.target.updateMatrixWorld();
        }
      }
    },

    setBrakeLights: function (v, on) {
      v.braking = on;
      v.tailMat.color.setHex(on ? 0xff7070 : 0xff2a2a);
    },

    // Traffic cars reuse this: integrate a vehicle along an explicit velocity.
    syncMesh: function (v) {
      v.mesh.position.set(v.x, 0, v.z);
      v.mesh.rotation.y = v.heading;
      for (var i = 0; i < v.wheels.length; i++) v.wheels[i].rotation.x += v.speed * 0.016 / 0.4;
    }
  };

  SH.Vehicles = Vehicles;
})(window.SH = window.SH || {});
