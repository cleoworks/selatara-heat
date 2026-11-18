// SELATARA HEAT — combat.js
// Combat in full: data-driven weapons (fist / pistol / SMG / shotgun from
// config.js), right-mouse over-shoulder aiming, hitscan with spread, muzzle
// flash / tracer / impact sparks / hit marker / small screen shake, reloads
// with magazine + reserve ammo, a gang-enemy AI (patrol / alert / cover /
// attack / flee), hostile fire used by police and gangs, player damage with
// armour absorption, and floating world pickups (health / armour / ammo / cash).
// Public API: SH.Combat { current(), giveWeapon(id, ammo), cycleWeapon(),
//   update(dt), hostileFire(x,y,z, tx,tz, dmg, hitChance), damagePlayer(n),
//   spawnEnemy(x, z, opts), clearEnemies(), spawnPickup(kind, x, z), enemies[] }.
(function (SH) {
  'use strict';

  var ORDER = ['fist', 'pistol', 'smg', 'shotgun'];

  // ---- shared geometry helpers ---------------------------------------------
  function rayVsAabb(ox, oz, dx, dz, c) {
    var tmin = 0, tmax = Infinity;
    if (Math.abs(dx) < 1e-8) { if (ox < c.x - c.hx || ox > c.x + c.hx) return -1; }
    else {
      var t1 = (c.x - c.hx - ox) / dx, t2 = (c.x + c.hx - ox) / dx;
      if (t1 > t2) { var t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
    if (Math.abs(dz) < 1e-8) { if (oz < c.z - c.hz || oz > c.z + c.hz) return -1; }
    else {
      var u1 = (c.z - c.hz - oz) / dz, u2 = (c.z + c.hz - oz) / dz;
      if (u1 > u2) { var u = u1; u1 = u2; u2 = u; }
      tmin = Math.max(tmin, u1); tmax = Math.min(tmax, u2);
      if (tmin > tmax) return -1;
    }
    return tmin;
  }

  function wallDistance(ox, oz, dx, dz, maxT) {
    var cols = SH.World.colliders, best = maxT;
    for (var i = 0; i < cols.length; i++) {
      var t = rayVsAabb(ox, oz, dx, dz, cols[i]);
      if (t > 0.2 && t < best) best = t;
    }
    return best;
  }

  function buildFighterMesh(shirtColor, pantsColor) {
    var g = new THREE.Group();
    var skin = new THREE.MeshLambertMaterial({ color: 0xa8763e, flatShading: true });
    var shirt = new THREE.MeshLambertMaterial({ color: shirtColor, flatShading: true });
    var pants = new THREE.MeshLambertMaterial({ color: pantsColor, flatShading: true });
    function box(w, h, d, mat, x, y, z) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
    }
    var legL = box(0.2, 0.78, 0.24, pants, -0.15, 0.78, 0); legL.geometry.translate(0, -0.3, 0);
    var legR = box(0.2, 0.78, 0.24, pants, 0.15, 0.78, 0); legR.geometry.translate(0, -0.3, 0);
    var torso = box(0.56, 0.64, 0.3, shirt, 0, 1.1, 0);
    var armL = box(0.16, 0.6, 0.2, shirt, -0.38, 1.38, 0); armL.geometry.translate(0, -0.24, 0);
    var armR = box(0.16, 0.6, 0.2, shirt, 0.38, 1.38, 0); armR.geometry.translate(0, -0.24, 0);
    box(0.32, 0.36, 0.32, skin, 0, 1.62, 0);
    return { group: g, legL: legL, legR: legR, armL: armL, armR: armR, torso: torso, shirtMat: shirt };
  }

  var Combat = {
    owned: { fist: true, pistol: false, smg: false, shotgun: false },
    enemies: [],
    pickups: [],
    fireTimer: 0, reloadTimer: 0, prevMouse: false, _scene: null,

    current: function () {
      return SH.Config.weapons[SH.State.weapon] || SH.Config.weapons.fist;
    },

    giveWeapon: function (id, ammo) {
      this.owned[id] = true;
      SH.State.weapon = id;
      var spec = SH.Config.weapons[id];
      SH.State.ammo = spec.mag === Infinity ? 0 : spec.mag;
      SH.State.ammoReserve = (ammo || 0) + (spec.mag === Infinity ? 0 : spec.mag);
      if (SH.HUD) SH.HUD.notify('New weapon: ' + spec.label);
    },

    cycleWeapon: function () {
      var cur = ORDER.indexOf(SH.State.weapon);
      for (var i = 1; i <= ORDER.length; i++) {
        var id = ORDER[(cur + i) % ORDER.length];
        if (this.owned[id]) {
          SH.State.weapon = id;
          this.reloadTimer = 0;
          var spec = SH.Config.weapons[id];
          if (spec.mag !== Infinity && SH.State.ammo > spec.mag) SH.State.ammo = spec.mag;
          return;
        }
      }
    },

    scene: function () {
      if (!this._scene) this._scene = SH.Main.getScene();
      return this._scene;
    },

    // ---- player damage / death ----------------------------------------------
    damagePlayer: function (amount) {
      var st = SH.State, p = st.player;
      if (st.mode !== 'playing' || st.stun > 1.2 || amount <= 0) return;
      var absorbed = Math.min(p.armor, amount * 0.65);
      p.armor -= absorbed;
      p.health -= (amount - absorbed);
      st._dmgFlash = Math.min(0.85, (st._dmgFlash || 0) + 0.45);
      if (SH.Audio) SH.Audio.hurt();
      if (p.health <= 0) {
        p.health = 0;
        if (SH.Police) SH.Police.onWasted();
      }
    },

    // ---- hostile fire (police officers + gang enemies share this) -------------
    hostileFire: function (x, y, z, tx, tz, dmg, hitChance) {
      var st = SH.State;
      var ty = st.driving ? 1.0 : 1.25;
      var dx = tx - x, dz = tz - z;
      var dist = Math.hypot(dx, dz) || 1;
      var miss = Math.random() > hitChance;
      var ex = tx + (miss ? (Math.random() - 0.5) * 3.4 : 0);
      var ez = tz + (miss ? (Math.random() - 0.5) * 3.4 : 0);
      SH.Effects.muzzle(x, y, z);
      SH.Effects.tracer(x, y, z, ex, ty, ez, true);
      if (SH.Audio) SH.Audio.shot('enemy');
      if (!miss) {
        if (st.driving && st.vehicle) {
          SH.Vehicles.damage(st.vehicle, dmg * 0.7);
          if (Math.random() < 0.45) this.damagePlayer(dmg * 0.55);
        } else this.damagePlayer(dmg);
        SH.Effects.sparks(ex, ty, ez);
      } else SH.Effects.sparks(ex, 0.4, ez);
    },

    // ---- enemies ---------------------------------------------------------------
    spawnEnemy: function (x, z, opts) {
      opts = opts || {};
      var built = buildFighterMesh(opts.color || 0x274b4f, 0x22242c);
      built.group.position.set(x, 0, z);
      this.scene().add(built.group);
      var e = {
        mesh: built.group, parts: built, x: x, z: z, heading: Math.random() * 6.28,
        hp: opts.hp || 45, maxHp: opts.hp || 45, state: 'patrol',
        anchorX: x, anchorZ: z, tx: x, tz: z, fireTimer: 1.4 + Math.random() * 1.4,
        burst: 0, cycle: Math.random() * 6, alertTimer: 0, dead: false, deadTimer: 0,
        damage: opts.damage || 6, name: opts.name || 'Rival crew'
      };
      this.enemies.push(e);
      return e;
    },

    hurtEnemy: function (e, dmg) {
      if (e.dead) return;
      e.hp -= dmg;
      e.state = 'attack'; e.alertTimer = 6;
      e.parts.shirtMat.color.offsetHSL(0, 0, -0.06);
      setTimeout(function () { e.parts.shirtMat.color.offsetHSL(0, 0, 0.06); }, 60);
      SH.Effects.blood(e.x, 1.2, e.z);
      if (SH.HUD) SH.HUD.hitmark();
      if (e.hp <= 0) {
        e.dead = true; e.deadTimer = 7;
        this.spawnPickup(Math.random() < 0.5 ? 'cash' : 'ammo', e.x, e.z);
      }
    },

    clearEnemies: function () {
      for (var i = 0; i < this.enemies.length; i++) {
        if (this.enemies[i].mesh.parent) this.enemies[i].mesh.parent.remove(this.enemies[i].mesh);
      }
      this.enemies = [];
    },

    // ---- pickups ------------------------------------------------------------------
    spawnPickup: function (kind, x, z) {
      var colors = { health: 0x51e07a, armor: 0x37e0ff, ammo: 0xffd23f, cash: 0xffe97a };
      var mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.55, 0.55),
        new THREE.MeshLambertMaterial({ color: colors[kind] || 0xffffff, emissive: (colors[kind] || 0xffffff), emissiveIntensity: 0.45, flatShading: true })
      );
      mesh.position.set(x, 1.1, z);
      this.scene().add(mesh);
      this.pickups.push({ kind: kind, x: x, z: z, mesh: mesh, spin: Math.random() * 6, life: 90 });
    },

    seedWorldPickups: function () {
      if (this._seeded) return;
      this._seeded = true;
      var spots = [
        ['health', -352, 128], ['ammo', -128, -56], ['armor', 246, 66], ['cash', 60, 188],
        ['health', 118, -172], ['ammo', -364, 66], ['cash', -120, 186], ['armor', 330, 78],
        ['health', -60, -308], ['cash', 420, -116]
      ];
      for (var i = 0; i < spots.length; i++) this.spawnPickup(spots[i][0], spots[i][1], spots[i][2]);
    },

    applyPickup: function (kind) {
      var st = SH.State, cfg = SH.Config.pickups;
      if (kind === 'health') { st.player.health = Math.min(SH.Config.player.maxHealth, st.player.health + cfg.health); if (SH.HUD) SH.HUD.notify('Health +' + cfg.health); }
      else if (kind === 'armor') { st.player.armor = Math.min(SH.Config.player.maxArmor, st.player.armor + cfg.armor); if (SH.HUD) SH.HUD.notify('Armour +' + cfg.armor); }
      else if (kind === 'ammo') {
        var spec = this.current();
        if (spec.mag === Infinity) { if (SH.HUD) SH.HUD.notify('Ammo (no gun equipped)'); }
        else { st.ammoReserve += spec.mag * 2; if (SH.HUD) SH.HUD.notify('Ammo +' + spec.mag * 2); }
      } else if (kind === 'cash') {
        var n = cfg.cashMin + ((Math.random() * (cfg.cashMax - cfg.cashMin)) | 0);
        SH.Economy.addCash(n); if (SH.HUD) SH.HUD.notify('Picked up $' + n);
      }
      if (SH.Audio) SH.Audio.pickup();
    },

    // ---- firing ----------------------------------------------------------------------
    startReload: function () {
      var st = SH.State, spec = this.current();
      if (spec.mag === Infinity || this.reloadTimer > 0) return;
      if (st.ammo >= spec.mag || st.ammoReserve <= 0) return;
      this.reloadTimer = spec.reload;
      if (SH.Audio) SH.Audio.reload();
      if (SH.HUD) SH.HUD.notify('Reloading…');
    },

    finishReload: function () {
      var st = SH.State, spec = this.current();
      var take = Math.min(spec.mag - st.ammo, st.ammoReserve);
      st.ammo += take; st.ammoReserve -= take;
    },

    fireDirection: function () {
      var st = SH.State;
      var cp = Math.cos(st.camPitch);
      return {
        x: -Math.sin(st.camYaw) * cp,
        y: -Math.sin(st.camPitch),
        z: -Math.cos(st.camYaw) * cp
      };
    },

    fireOnce: function () {
      var st = SH.State, spec = this.current(), input = SH.Input;
      var origin, dir = this.fireDirection();
      if (st.driving && st.vehicle) {
        origin = { x: st.vehicle.x, y: 1.2, z: st.vehicle.z };
        dir = { x: Math.sin(st.vehicle.heading), y: 0, z: Math.cos(st.vehicle.heading) };
        // Drive-by fire goes where the camera looks when it is roughly forward.
        var camDir = this.fireDirection();
        if (camDir.x * dir.x + camDir.z * dir.z > 0.1) { dir.x = camDir.x; dir.z = camDir.z; dir.y = 0; }
      } else {
        origin = { x: st.player.x, y: 1.5, z: st.player.z };
        st.player.heading = Math.atan2(dir.x, dir.z);
      }
      var pellets = spec.pellets || 1;
      for (var pi = 0; pi < pellets; pi++) {
        var dx = dir.x + (Math.random() - 0.5) * 2 * spec.spread;
        var dy = dir.y + (Math.random() - 0.5) * 2 * spec.spread;
        var dz = dir.z + (Math.random() - 0.5) * 2 * spec.spread;
        var dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
        this.traceShot(origin, dx, dy, dz, spec);
      }
      // Muzzle flash at the gun position + a small kick of shake.
      var mx = origin.x + dir.x * 0.8, mz = origin.z + dir.z * 0.8;
      SH.Effects.muzzle(mx, origin.y + 0.1, mz);
      SH.Effects.shake(spec === SH.Config.weapons.shotgun ? 0.22 : 0.07);
      if (SH.Audio) SH.Audio.shot(st.weapon === 'shotgun' ? 'shotgun' : st.weapon === 'smg' ? 'smg' : 'pistol');
      if (SH.Pedestrians) SH.Pedestrians.scare(origin.x, origin.z, 26);
      if (SH.Police) SH.Police.witnessCrime('shotFired', origin.x, origin.z);
    },

    traceShot: function (origin, dx, dy, dz, spec) {
      var maxT = spec.range;
      var wallT = wallDistance(origin.x, origin.z, dx, dz, maxT);
      // Ground plane.
      var groundT = dy < -0.01 ? (0.05 - origin.y) / dy : Infinity;
      var bestT = Math.min(wallT, groundT, maxT);
      var hitKind = null, hitRef = null;

      function sphereT(cx, cy, cz, r) {
        var lx = cx - origin.x, ly = cy - origin.y, lz = cz - origin.z;
        var tca = lx * dx + ly * dy + lz * dz;
        if (tca < 0) return -1;
        var d2 = lx * lx + ly * ly + lz * lz - tca * tca;
        if (d2 > r * r) return -1;
        return tca - Math.sqrt(r * r - d2);
      }

      var i, t;
      // Enemies.
      for (i = 0; i < this.enemies.length; i++) {
        var e = this.enemies[i];
        if (e.dead) continue;
        t = sphereT(e.x, 1.15, e.z, 0.62);
        if (t > 0 && t < bestT) { bestT = t; hitKind = 'enemy'; hitRef = e; }
      }
      // Police officers.
      if (SH.Police) for (i = 0; i < SH.Police.officers.length; i++) {
        var off = SH.Police.officers[i];
        if (off.dead) continue;
        t = sphereT(off.x, 1.15, off.z, 0.62);
        if (t > 0 && t < bestT) { bestT = t; hitKind = 'officer'; hitRef = off; }
      }
      // Pedestrians.
      if (SH.Pedestrians) for (i = 0; i < SH.Pedestrians.list.length; i++) {
        var ped = SH.Pedestrians.list[i];
        if (ped.down) continue;
        t = sphereT(ped.x, 1.1, ped.z, 0.55);
        if (t > 0 && t < bestT) { bestT = t; hitKind = 'ped'; hitRef = ped; }
      }
      // Vehicles (2D circle around each car, loose height check).
      var vehs = SH.Vehicles.list;
      for (i = 0; i < vehs.length; i++) {
        var v = vehs[i];
        if (!v.active || v.dead) continue;
        if (SH.State.vehicle === v) continue;
        t = sphereT(v.x, 0.8, v.z, v.spec.length * 0.42);
        if (t > 0 && t < bestT) { bestT = t; hitKind = 'vehicle'; hitRef = v; }
      }

      var hx = origin.x + dx * bestT, hy = Math.max(0.06, origin.y + dy * bestT), hz = origin.z + dz * bestT;
      SH.Effects.tracer(origin.x + dx * 0.7, origin.y, origin.z + dz * 0.7, hx, hy, hz, false);

      if (hitKind === 'enemy') { this.hurtEnemy(hitRef, spec.damage); }
      else if (hitKind === 'officer') {
        hitRef.hp -= spec.damage;
        SH.Effects.blood(hitRef.x, 1.2, hitRef.z);
        if (SH.HUD) SH.HUD.hitmark();
        if (hitRef.hp <= 0 && !hitRef.dead) {
          hitRef.dead = true; hitRef.deadTimer = 7;
          if (SH.Police) SH.Police.witnessCrime('killPolice', hitRef.x, hitRef.z);
        }
      }
      else if (hitKind === 'ped') {
        hitRef.down = 7;
        SH.Effects.blood(hitRef.x, 1.1, hitRef.z);
        if (SH.Pedestrians) SH.Pedestrians.scare(hitRef.x, hitRef.z, 20);
        if (SH.Police) SH.Police.witnessCrime('shotPed', hitRef.x, hitRef.z);
        if (SH.HUD) SH.HUD.hitmark();
      }
      else if (hitKind === 'vehicle') {
        SH.Vehicles.damage(hitRef, spec.damage * 0.8);
        SH.Effects.sparks(hx, hy, hz);
        if (SH.HUD) SH.HUD.hitmark();
      }
      else SH.Effects.sparks(hx, hy, hz);
    },

    meleeSwing: function () {
      var st = SH.State, p = st.player;
      var fx = Math.sin(p.heading), fz = Math.cos(p.heading);
      var i, hit = false;
      function inFront(x, z) {
        var dx = x - p.x, dz = z - p.z;
        var d = Math.hypot(dx, dz);
        return d < 2.3 && (dx * fx + dz * fz) / (d || 1) > 0.35;
      }
      for (i = 0; i < this.enemies.length; i++) {
        var e = this.enemies[i];
        if (!e.dead && inFront(e.x, e.z)) { this.hurtEnemy(e, SH.Config.weapons.fist.damage); hit = true; }
      }
      if (SH.Police) for (i = 0; i < SH.Police.officers.length; i++) {
        var off = SH.Police.officers[i];
        if (!off.dead && inFront(off.x, off.z)) {
          off.hp -= SH.Config.weapons.fist.damage; hit = true;
          if (off.hp <= 0) { off.dead = true; off.deadTimer = 7; SH.Police.witnessCrime('killPolice', off.x, off.z); }
        }
      }
      if (SH.Pedestrians) for (i = 0; i < SH.Pedestrians.list.length; i++) {
        var ped = SH.Pedestrians.list[i];
        if (!ped.down && inFront(ped.x, ped.z)) {
          ped.down = 5; hit = true;
          SH.Police.witnessCrime('hitPed', ped.x, ped.z);
        }
      }
      if (hit && SH.Audio) SH.Audio.blip(160, 0.08, 'triangle', 0.12, 90);
      if (SH.Player.parts) { SH.Player.parts.armR.rotation.x = -2.1; }
    },

    // ---- per-frame update --------------------------------------------------------------
    update: function (dt) {
      var st = SH.State;
      if (st.mode !== 'playing') return;
      this.seedWorldPickups();
      var input = SH.Input, spec = this.current();

      // Reload bookkeeping.
      if (this.reloadTimer > 0) {
        this.reloadTimer -= dt;
        if (this.reloadTimer <= 0) this.finishReload();
      }
      if (input.wasPressed('KeyR')) this.startReload();

      // Firing input.
      this.fireTimer -= dt;
      var wantFire = input.mouseDown && st.stun <= 0;
      var clicked = input.mouseDown && !this.prevMouse;
      this.prevMouse = input.mouseDown;
      if (wantFire && this.reloadTimer <= 0 && st.mode === 'playing') {
        if (st.weapon === 'fist') {
          if (clicked && !st.driving) { this.meleeSwing(); this.fireTimer = 1 / spec.rate; }
        } else if (this.fireTimer <= 0) {
          var auto = st.weapon === 'smg';
          if (auto || clicked) {
            if (st.ammo <= 0) {
              if (clicked) { if (SH.Audio) SH.Audio.dryFire(); this.startReload(); }
            } else {
              st.ammo -= 1;
              this.fireTimer = 1 / spec.rate;
              this.fireOnce();
              if (st.ammo <= 0) this.startReload();
            }
          }
        }
      }

      this.updateEnemies(dt);
      this.updatePickups(dt);
    },

    updateEnemies: function (dt) {
      var st = SH.State;
      var f = st.driving ? st.vehiclePos : st.player;
      for (var i = this.enemies.length - 1; i >= 0; i--) {
        var e = this.enemies[i];
        if (e.dead) {
          e.deadTimer -= dt;
          e.mesh.rotation.x = Math.min(Math.PI / 2, e.mesh.rotation.x + dt * 5);
          if (e.deadTimer <= 0) {
            if (e.mesh.parent) e.mesh.parent.remove(e.mesh);
            this.enemies.splice(i, 1);
          }
          continue;
        }
        var distP = Math.hypot(e.x - f.x, e.z - f.z);
        if (distP > 300) continue;
        var blocked = wallDistance(e.x, e.z, (f.x - e.x) / (distP || 1), (f.z - e.z) / (distP || 1), distP) < distP - 1.5;

        // State transitions.
        if (e.hp < e.maxHp * 0.25 && e.state !== 'flee') e.state = 'flee';
        else if (!blocked && distP < 34) { e.state = 'attack'; e.alertTimer = 5; }
        else if (e.alertTimer > 0) { e.alertTimer -= dt; if (e.state !== 'attack') e.state = 'alert'; }
        else if (e.state === 'attack' || e.state === 'alert') e.state = 'patrol';

        var mvx = 0, mvz = 0, spd = 0;
        if (e.state === 'flee') {
          mvx = (e.x - f.x) / (distP || 1); mvz = (e.z - f.z) / (distP || 1); spd = 5.4;
          if (distP > 70) { // escaped: despawn quietly
            if (e.mesh.parent) e.mesh.parent.remove(e.mesh);
            this.enemies.splice(i, 1);
            continue;
          }
        } else if (e.state === 'attack') {
          var want = 14;
          if (distP > want + 4) { mvx = (f.x - e.x) / distP; mvz = (f.z - e.z) / distP; spd = 4.4; }
          else if (distP < want - 4) { mvx = (e.x - f.x) / distP; mvz = (e.z - f.z) / distP; spd = 2.8; }
          else { mvx = -(f.z - e.z) / distP * 0.6; mvz = (f.x - e.x) / distP * 0.6; spd = 1.3; }
          // Fire in bursts when the shot is clear.
          if (!blocked && distP < 42) {
            e.fireTimer -= dt;
            if (e.fireTimer <= 0) {
              e.burst = 3 + (Math.random() * 3 | 0);
              e.fireTimer = 1.3 + Math.random() * 1.1;
            }
            if (e.burst > 0) {
              e.burstTimer = (e.burstTimer || 0) - dt;
              if (e.burstTimer <= 0) {
                e.burstTimer = 0.13;
                e.burst--;
                this.hostileFire(e.x, 1.45, e.z, f.x, f.z, e.damage, 0.52 - distP / 160);
                e.parts.armR.rotation.x = -1.35;
              }
            }
          }
        } else if (e.state === 'alert') {
          mvx = (f.x - e.x) / (distP || 1); mvz = (f.z - e.z) / (distP || 1); spd = 3.4;
        } else { // patrol: drift around the anchor
          if (Math.hypot(e.tx - e.x, e.tz - e.z) < 1.6 || e._patrolT === undefined) {
            e._patrolT = 2 + Math.random() * 3;
            e.tx = e.anchorX + (Math.random() - 0.5) * 16;
            e.tz = e.anchorZ + (Math.random() - 0.5) * 16;
          }
          e._patrolT -= dt;
          if (e._patrolT > 0.6) {
            var pd = Math.hypot(e.tx - e.x, e.tz - e.z) || 1;
            mvx = (e.tx - e.x) / pd; mvz = (e.tz - e.z) / pd; spd = 1.4;
          }
        }

        if (spd > 0) {
          e.x += mvx * spd * dt; e.z += mvz * spd * dt;
          e.heading = Math.atan2(mvx, mvz);
          e.cycle += dt * spd * 2.6;
        }
        var sw = Math.sin(e.cycle * 2.2) * (spd > 0 ? 0.5 : 0.03);
        e.parts.legL.rotation.x = sw; e.parts.legR.rotation.x = -sw;
        e.parts.armL.rotation.x = -sw * 0.7;
        if (e.state !== 'attack') e.parts.armR.rotation.x = sw * 0.7;
        e.mesh.position.set(e.x, 0, e.z);
        e.mesh.rotation.y = e.state === 'attack' || e.state === 'alert' ? Math.atan2(f.x - e.x, f.z - e.z) : e.heading;
      }
    },

    updatePickups: function (dt) {
      var st = SH.State;
      var f = st.driving ? st.vehiclePos : st.player;
      for (var i = this.pickups.length - 1; i >= 0; i--) {
        var pk = this.pickups[i];
        pk.life -= dt;
        pk.spin += dt * 2.2;
        pk.mesh.rotation.y = pk.spin;
        pk.mesh.position.y = 1.1 + Math.sin(st.time * 2.4 + pk.spin) * 0.16;
        var d = Math.hypot(pk.x - f.x, pk.z - f.z);
        if (d < 1.9 && !st.driving) {
          this.applyPickup(pk.kind);
          if (pk.mesh.parent) pk.mesh.parent.remove(pk.mesh);
          this.pickups.splice(i, 1);
          continue;
        }
        if (pk.life <= 0) {
          if (pk.mesh.parent) pk.mesh.parent.remove(pk.mesh);
          this.pickups.splice(i, 1);
        }
      }
    }
  };

  SH.Combat = Combat;
})(window.SH = window.SH || {});
