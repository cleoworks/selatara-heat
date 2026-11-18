// SELATARA HEAT — vehicles.js
// Vehicle factory (sedan/sport/truck/motorcycle/boat/police), arcade bicycle
// physics, enter/exit + carjacking, lights, damage with smoke and explosion.
// Public API: SH.Vehicles { buildPool(scene), list, nearestUsable(), updateInteractions(dt), updatePlayerVehicle(dt), damage(veh, amount) }.
(function (SH) {
  'use strict';

  // Shared glow texture + materials for headlight cones and lamp glows.
  var glowTex = null;
  function getGlowTex() {
    if (glowTex) return glowTex;
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g2 = c.getContext('2d');
    var grad = g2.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.4, 'rgba(255,255,255,0.4)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g2.fillStyle = grad; g2.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
    return glowTex;
  }
  var coneMatShared = null, headGlowMatShared = null;
  function getConeMat() {
    if (!coneMatShared) coneMatShared = new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    return coneMatShared;
  }
  function getHeadGlowMat() {
    if (!headGlowMatShared) headGlowMatShared = new THREE.SpriteMaterial({ map: getGlowTex(), color: 0xffe9b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    return headGlowMatShared;
  }

  function buildMesh(type, colorHex) {
    var spec = SH.Config.vehicleTypes[type];
    var g = new THREE.Group();
    var paint = new THREE.MeshPhongMaterial({ color: colorHex, shininess: 68, specular: 0x888888, flatShading: true });
    var dark = new THREE.MeshLambertMaterial({ color: 0x14151a, flatShading: true });
    var glass = new THREE.MeshPhongMaterial({ color: 0x2a4a5e, shininess: 90, specular: 0xaaddff, flatShading: true });
    var L = spec.length, W = spec.width, H = spec.height;
    var wheels = [];

    function box(w, h, d, mat, x, y, z) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z); m.castShadow = true;
      g.add(m); return m;
    }
    function wheel(x, z, r) {
      var w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.3, 12), dark);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, r, z);
      w.castShadow = true;
      g.add(w); wheels.push(w);
      // Pale hubcap disc so the wheel reads as a wheel, not a blob.
      var hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, 0.32, 8), new THREE.MeshLambertMaterial({ color: 0xb9c0c9, flatShading: true }));
      hub.rotation.z = Math.PI / 2;
      hub.position.set(x, r, z);
      g.add(hub); wheels.push(hub);
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
        // Two-tone lightbar: red left, blue right, each with its own glow
        // sprite; materials are per-car so the flash phase can alternate.
        var barBase = box(W * 0.72, 0.1, 0.42, dark, 0, H * 1.04, 0);
        var redMat = new THREE.MeshBasicMaterial({ color: 0xff2a4a });
        var blueMat = new THREE.MeshBasicMaterial({ color: 0x2a6aff });
        var rb = new THREE.Mesh(new THREE.BoxGeometry(W * 0.34, 0.15, 0.4), redMat); rb.position.set(-W * 0.18, H * 1.13, 0); g.add(rb);
        var bb = new THREE.Mesh(new THREE.BoxGeometry(W * 0.34, 0.15, 0.4), blueMat); bb.position.set(W * 0.18, H * 1.13, 0); g.add(bb);
        var rg = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTex(), color: 0xff3a5a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
        rg.scale.set(3.4, 2.2, 1); rg.position.set(-W * 0.18, H * 1.16, 0); g.add(rg);
        var bg = new THREE.Sprite(rg.material.clone()); bg.material.color = new THREE.Color(0x3a7aff);
        bg.scale.set(3.4, 2.2, 1); bg.position.set(W * 0.18, H * 1.16, 0); g.add(bg);
        g.userData.lightbar = { redMat: redMat, blueMat: blueMat, redGlow: rg, blueGlow: bg };
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
    // Headlight glow sprites + a fake light cone (opacity driven globally by
    // the time of day via Vehicles.setLightLevel).
    if (type !== 'boat') {
      var hg1 = new THREE.Sprite(getHeadGlowMat()); hg1.scale.set(1.05, 0.75, 1); hg1.position.set(-hw, H * 0.5, L / 2 + 0.25); g.add(hg1);
      var hg2 = new THREE.Sprite(getHeadGlowMat()); hg2.scale.set(1.05, 0.75, 1); hg2.position.set(hw, H * 0.5, L / 2 + 0.25); g.add(hg2);
      var cone = new THREE.Mesh(new THREE.ConeGeometry(1.35, 6.5, 12, 1, true), getConeMat());
      cone.rotation.x = Math.PI / 2 + 0.06;
      cone.position.set(0, H * 0.42, L / 2 + 3.2);
      g.add(cone);
      g.userData.cone = cone;
    }

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
      { type: 'sport', x: 420, z: -128, heading: Math.PI },
      // Kerbside parking along the main avenues (visual density + stealable).
      { type: 'sedan', x: -114.5, z: -160, heading: 0 },
      { type: 'sedan', x: -125.5, z: -96, heading: Math.PI },
      { type: 'sport', x: -114.5, z: -20, heading: 0 },
      { type: 'sedan', x: 5.5, z: -140, heading: Math.PI },
      { type: 'motor', x: -5.5, z: -80, heading: 0 },
      { type: 'sedan', x: 114.5, z: 20, heading: 0 },
      { type: 'sedan', x: -234.5, z: -240, heading: 0 },
      { type: 'sport', x: 245.5, z: -200, heading: Math.PI },
      { type: 'sedan', x: -365.5, z: -20, heading: Math.PI },
      { type: 'sedan', x: 354.5, z: 120, heading: 0 },
      { type: 'motor', x: -475.5, z: 120, heading: 0 },
      { type: 'sedan', x: -60, z: -54.5, heading: Math.PI / 2 },
      { type: 'sedan', x: 40, z: 65.5, heading: -Math.PI / 2 },
      { type: 'sport', x: -200, z: 174.5, heading: Math.PI / 2 },
      { type: 'sedan', x: 180, z: -174.5, heading: -Math.PI / 2 }
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
      // Screenshot staging (?shot=): hold a cruise speed with no input.
      if (st._shotCruise && throttle === 0 && !handbrake) {
        v.speed += Math.max(-10 * dt, Math.min(10 * dt, st._shotCruise.speed - v.speed));
      }
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
      // Camera eases behind the car (angle difference wrapped, or it swings
      // the long way around through a full turn).
      var targetYaw = v.heading + Math.PI;
      var dyaw = ((st.camYaw - targetYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      st.camYaw = targetYaw + dyaw * Math.pow(0.4, dt);
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

    // Global dusk/night light level (0 day .. 1 night): drives headlight
    // cones + glows on every car at once through the shared materials.
    setLightLevel: function (level) {
      this._lightLevel = level;
      if (coneMatShared) coneMatShared.opacity = level * level * 0.09;
      if (this.playerConeMat) this.playerConeMat.opacity = level * level * 0.05;
      if (headGlowMatShared) headGlowMatShared.opacity = level * 0.5;
      if (this.headlight) this.headlight.intensity = level * 1.6;
    },

    // Police lightbar flash: alternate red/blue twice a second.
    updateVisuals: function () {
      var level = this._lightLevel || 0;
      var phase = (SH.State.time * 2.2) % 1;
      var redOn = phase < 0.5;
      if (!this.playerConeMat) {
        this.playerConeMat = getConeMat().clone();
        this.playerConeMat.opacity = 0;
      }
      for (var i = 0; i < this.list.length; i++) {
        var v = this.list[i];
        // The player's own headlight cone gets a much fainter material: from
        // the chase camera a full-strength cone reads as a solid wedge.
        var cone = v.mesh.userData.cone;
        if (cone) {
          var wantMat = v.driver === 'player' ? this.playerConeMat : coneMatShared;
          if (cone.material !== wantMat) cone.material = wantMat;
        }
        var lb = v.mesh.userData.lightbar;
        if (!lb) continue;
        var active = v.driver === 'police' || v.driver === 'roadblock' || v.driver === 'player';
        lb.redMat.color.setHex(redOn ? 0xff2a4a : 0x57101e);
        lb.blueMat.color.setHex(redOn ? 0x12275e : 0x2a6aff);
        lb.redGlow.material.opacity = active && redOn ? 0.55 + level * 0.3 : 0;
        lb.blueGlow.material.opacity = active && !redOn ? 0.55 + level * 0.3 : 0;
      }
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
