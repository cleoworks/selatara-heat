// SELATARA HEAT — police.js
// The wanted system in full: crimes raise stars, patrol cars spawn off-screen
// and pursue on the road graph (ramming + intercept), roadblocks from 3 stars,
// foot officers who get out and shoot at high stars, a spotlight helicopter at
// 4-5 stars, SEARCHING decay when line-of-sight is lost, BUSTED when boxed at
// low speed and WASTED hand-off when the player dies.
// Public API: SH.Police { witnessCrime(kind,x,z), forceWanted(n), update(dt),
//   searching, lastKnown, units[], stageChase(), onWasted() }.
(function (SH) {
  'use strict';

  var CRIME_STARS = { steal: 1, hitPed: 1, shotFired: 1, hitPolice: 1, shotPed: 1, killPolice: 2, explosion: 2 };
  var cfgP = SH.Config.police;

  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // Segment (2D) vs the building AABBs: true when a building blocks the view.
  function losBlocked(x1, z1, x2, z2) {
    var cols = SH.World.colliders;
    var dx = x2 - x1, dz = z2 - z1;
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      var tmin = 0.04, tmax = 0.96, ok = true;
      if (Math.abs(dx) < 1e-6) { if (x1 < c.x - c.hx || x1 > c.x + c.hx) ok = false; }
      else {
        var t1 = (c.x - c.hx - x1) / dx, t2 = (c.x + c.hx - x1) / dx;
        if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) ok = false;
      }
      if (ok) {
        if (Math.abs(dz) < 1e-6) { if (z1 < c.z - c.hz || z1 > c.z + c.hz) ok = false; }
        else {
          var u1 = (c.z - c.hz - z1) / dz, u2 = (c.z + c.hz - z1) / dz;
          if (u1 > u2) { var uu = u1; u1 = u2; u2 = uu; }
          tmin = Math.max(tmin, u1); tmax = Math.min(tmax, u2);
          if (tmin > tmax) ok = false;
        }
      }
      if (ok) return true;
    }
    return false;
  }

  // Shortest path over the road graph, weighted by edge length. (Plain
  // hop-count BFS started picking scenic routes once the coast artery
  // and the ring were subdivided into short segments in Rev 5 — a hop
  // no longer correlates with distance.) Returns node indices.
  function graphPath(fromNode, toNode) {
    if (fromNode === toNode) return [toNode];
    var g = SH.World.graph;
    var dist = {}, prev = {}, done = {};
    dist[fromNode] = 0;
    while (true) {
      var cur = -1, best = Infinity;
      for (var k in dist) {
        if (!done[k] && dist[k] < best) { best = dist[k]; cur = +k; }
      }
      if (cur < 0 || cur === toNode) break;
      done[cur] = true;
      var node = g.nodes[cur];
      for (var i = 0; i < node.edges.length; i++) {
        var e = g.edges[node.edges[i]];
        var nxt = e.a === cur ? e.b : e.a;
        if (done[nxt]) continue;
        var w = Math.hypot(g.nodes[nxt].x - node.x, g.nodes[nxt].z - node.z);
        var nd = best + w;
        if (dist[nxt] === undefined || nd < dist[nxt]) { dist[nxt] = nd; prev[nxt] = cur; }
      }
    }
    if (dist[toNode] === undefined) return [toNode];
    var path = [toNode], p = toNode;
    while (p !== fromNode) { p = prev[p]; path.unshift(p); }
    return path;
  }

  // Officers use the shared figure builder (Art Pass 3): navy uniform,
  // dark trousers, peaked cap in uniform colour, stern face.
  function buildOfficerMesh() {
    return SH.Pedestrians.buildFigure({
      skin: 0xb87a4e,
      shirt: 0x2a3f8f,
      pants: 0x1c2030,
      hairStyle: 'hat',
      hatColor: 0x2a3f8f,
      face: 1
    });
  }

  var Police = {
    searching: false,
    searchTimer: 0,
    lastKnown: { x: 0, z: 0 },
    state: 'IDLE', // IDLE | PURSUIT | SEARCHING | BUSTED | ESCAPED (transient labels)
    units: [],        // patrol cars: { veh, path[], pathTimer, wpIndex, mode }
    officers: [],     // foot officers pool
    blocks: [],       // active roadblock vehicles
    heli: null,
    losTimer: 0, seenTimer: 0, bustedTimer: 0, blockTimer: 8, spawnTimer: 0,
    _scene: null,

    focus: function () {
      var st = SH.State;
      return st.driving ? st.vehiclePos : st.player;
    },

    // ---- crime reporting -------------------------------------------------
    witnessed: function (x, z, radius) {
      var i, d;
      var f = this.focus();
      if (Math.hypot(f.x - x, f.z - z) < radius) return true;
      if (SH.Pedestrians) for (i = 0; i < SH.Pedestrians.list.length; i++) {
        var p = SH.Pedestrians.list[i];
        if (!p.down && Math.hypot(p.x - x, p.z - z) < radius) return true;
      }
      if (SH.Traffic) for (i = 0; i < SH.Traffic.cars.length; i++) {
        var c = SH.Traffic.cars[i];
        if (Math.hypot(c.x - x, c.z - z) < radius) return true;
      }
      for (i = 0; i < this.units.length; i++) {
        d = Math.hypot(this.units[i].veh.x - x, this.units[i].veh.z - z);
        if (d < radius + 40) return true;
      }
      return false;
    },

    witnessCrime: function (kind, x, z) {
      var st = SH.State;
      var add = CRIME_STARS[kind];
      if (add === undefined) add = 1;
      if (st.wanted > 0) {
        // Already wanted: any new crime is on the record.
        st.wanted = Math.min(5, st.wanted + (kind === 'killPolice' ? 2 : (add > 1 ? 1 : 0)));
        this.lastKnown.x = x; this.lastKnown.z = z;
        this.searching = false; this.searchTimer = 0;
        return;
      }
      if (!this.witnessed(x, z, 60)) return;
      st.wanted = Math.min(5, add);
      this.lastKnown.x = x; this.lastKnown.z = z;
      this.searching = false; this.searchTimer = 0;
      if (SH.HUD) SH.HUD.notify('Wanted level ' + st.wanted);
      if (SH.Audio) SH.Audio.siren(true);
    },

    forceWanted: function (n) {
      var st = SH.State;
      st.wanted = Math.max(st.wanted, n);
      var f = this.focus();
      this.lastKnown.x = f.x; this.lastKnown.z = f.z;
      this.searching = false; this.searchTimer = 0;
      if (SH.Audio) SH.Audio.siren(true);
    },

    clearWanted: function () {
      SH.State.wanted = 0;
      this.searching = false; this.searchTimer = 0;
      if (SH.Audio) SH.Audio.siren(false);
    },

    // ---- spawning ----------------------------------------------------------
    ensureScene: function () {
      if (!this._scene) this._scene = SH.Main.getScene();
      return this._scene;
    },

    spawnCar: function (nearFocus) {
      var scene = this.ensureScene();
      if (!scene) return null;
      var f = this.focus();
      var g = SH.World.graph;
      var rng = SH.World.rng;
      var best = null, bd = Infinity;
      for (var tries = 0; tries < 24; tries++) {
        var e = g.edges[(rng() * g.edges.length) | 0];
        var a = g.nodes[e.a], b = g.nodes[e.b];
        var t = rng();
        var x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        var d = Math.hypot(x - f.x, z - f.z);
        var want = nearFocus ? 55 : cfgP.spawnDist;
        // Never stack two units on the same spot: coincident spawns
        // pin each other in the vehicle collision solver forever.
        var tooClose = false;
        for (var ui = 0; ui < this.units.length; ui++) {
          if (Math.hypot(this.units[ui].veh.x - x, this.units[ui].veh.z - z) < 14) { tooClose = true; break; }
        }
        if (tooClose) continue;
        if (Math.abs(d - want) < bd) { bd = Math.abs(d - want); best = { x: x, z: z, h: Math.atan2(b.x - a.x, b.z - a.z) }; }
        if (d > want - 25 && d < want + 45) break;
      }
      if (!best) return null;
      var veh = SH.Vehicles.spawnVehicle(scene, 'police', 0xf2f2f2, best.x, best.z, best.h);
      veh.driver = 'police';
      var unit = { veh: veh, path: null, pathTimer: 0, wp: 0, mode: 'chase', officersOut: false, dead: false };
      this.units.push(unit);
      return unit;
    },

    retireCar: function (unit) {
      var v = unit.veh;
      v.active = false; v.mesh.visible = false;
      var li = SH.Vehicles.list.indexOf(v);
      if (li >= 0) SH.Vehicles.list.splice(li, 1);
      if (v.mesh.parent) v.mesh.parent.remove(v.mesh);
      var ui = this.units.indexOf(unit);
      if (ui >= 0) this.units.splice(ui, 1);
    },

    spawnOfficer: function (x, z, fromCar) {
      if (this.officers.length >= 6) return;
      var scene = this.ensureScene();
      var built = buildOfficerMesh();
      built.group.position.set(x, 0, z);
      scene.add(built.group);
      this.officers.push({
        mesh: built.group, parts: built, x: x, z: z, heading: 0, hp: 40,
        state: 'approach', fireTimer: 1 + Math.random(), cycle: Math.random() * 6,
        coverX: x, coverZ: z, fromCar: fromCar || null, dead: false, deadTimer: 0
      });
    },

    removeOfficer: function (off) {
      if (off.mesh.parent) off.mesh.parent.remove(off.mesh);
      var i = this.officers.indexOf(off);
      if (i >= 0) this.officers.splice(i, 1);
    },

    ensureHeli: function () {
      if (this.heli) return;
      var scene = this.ensureScene();
      var g = new THREE.Group();
      var bodyMat = new THREE.MeshLambertMaterial({ color: 0x2a3550, flatShading: true });
      var body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.7, 5.6), bodyMat); body.position.y = 0; g.add(body);
      var tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 4.4), bodyMat); tail.position.set(0, 0.3, -4.6); g.add(tail);
      var rotor = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.08, 0.7), new THREE.MeshBasicMaterial({ color: 0x14161c }));
      rotor.position.y = 1.15; g.add(rotor);
      var coneMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      var cone = new THREE.Mesh(new THREE.ConeGeometry(9, 40, 18, 1, true), coneMat);
      cone.position.y = -20.8; g.add(cone);
      var spot = new THREE.SpotLight(0xfff2b0, 2.2, 90, 0.3, 0.5, 0.6);
      spot.position.set(0, 0, 0); g.add(spot); g.add(spot.target);
      spot.target.position.set(0, -40, 0);
      scene.add(g);
      this.heli = { mesh: g, rotor: rotor, angle: 0, spot: spot };
    },

    removeHeli: function () {
      if (!this.heli) return;
      if (this.heli.mesh.parent) this.heli.mesh.parent.remove(this.heli.mesh);
      this.heli = null;
    },

    // ---- roadblocks ---------------------------------------------------------
    maybeRoadblock: function (dt) {
      var st = SH.State;
      this.blockTimer -= dt;
      if (st.wanted < 3 || !st.driving || this.blockTimer > 0) return;
      if (this.blocks.length >= 2) return;
      var v = st.vehicle;
      if (!v || Math.abs(v.speed) < 8) return;
      this.blockTimer = 26;
      // Two patrol cars parked across the road ~85 m ahead of the player.
      var fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      var bx = v.x + fx * 85, bz = v.z + fz * 85;
      var scene = this.ensureScene();
      for (var i = 0; i < 2; i++) {
        var side = i === 0 ? -1 : 1;
        var px = bx + fz * side * 2.9, pz = bz - fx * side * 2.9;
        var veh = SH.Vehicles.spawnVehicle(scene, 'police', 0xf2f2f2, px, pz, v.heading + Math.PI / 2);
        veh.driver = 'roadblock';
        this.blocks.push({ veh: veh, life: 34 });
      }
      if (SH.HUD) SH.HUD.notify('Police roadblock ahead!');
    },

    // ---- outcomes -------------------------------------------------------------
    busted: function () {
      var st = SH.State;
      var fine = Math.min(st.cash, cfgP.fineBase + st.wanted * cfgP.finePerStar);
      if (st.driving) SH.Vehicles.exit();
      SH.Economy.addCash(-fine);
      this.clearWanted();
      this.despawnAll(true);
      st.player.x = cfgP.station.x; st.player.z = cfgP.station.z;
      st.player.y = 0; st.player.vy = 0; st.player.vx = 0; st.player.vz = 0;
      st.camYaw = Math.PI;
      st.stun = 2.6;
      if (SH.HUD) SH.HUD.banner('BUSTED', 'The Selatara police got you. Fine: $' + fine, 3, true);
      if (SH.Save) SH.Save.saveGame();
    },

    onWasted: function () {
      var st = SH.State;
      var fine = Math.min(st.cash, cfgP.wastedFine + st.wanted * 60);
      if (st.driving) SH.Vehicles.exit();
      SH.Economy.addCash(-fine);
      this.clearWanted();
      this.despawnAll(true);
      st.player.health = 55; st.player.armor = 0;
      st.player.x = cfgP.hospital.x; st.player.z = cfgP.hospital.z;
      st.player.y = 0; st.player.vy = 0; st.player.vx = 0; st.player.vz = 0;
      st.stun = 2.6;
      if (SH.HUD) SH.HUD.banner('WASTED', 'You woke up at Kencana clinic. Bill: $' + fine, 3, true);
      if (SH.Save) SH.Save.saveGame();
    },

    despawnAll: function (instant) {
      for (var i = this.units.length - 1; i >= 0; i--) this.retireCar(this.units[i]);
      for (var j = this.officers.length - 1; j >= 0; j--) this.removeOfficer(this.officers[j]);
      for (var k = this.blocks.length - 1; k >= 0; k--) {
        var v = this.blocks[k].veh;
        v.active = false;
        var li = SH.Vehicles.list.indexOf(v);
        if (li >= 0) SH.Vehicles.list.splice(li, 1);
        if (v.mesh.parent) v.mesh.parent.remove(v.mesh);
      }
      this.blocks = [];
      this.removeHeli();
      if (SH.Audio) SH.Audio.siren(false);
    },

    // ---- car driving (same arcade integration the player vehicle uses) --------
    driveCar: function (unit, dt, tx, tz, cruise) {
      var v = unit.veh, spec = v.spec;
      var dx = tx - v.x, dz = tz - v.z;
      var dist = Math.hypot(dx, dz);
      var targetHeading = Math.atan2(dx, dz);
      var diff = wrapAngle(targetHeading - v.heading);
      var steer = clamp(diff * 1.7, -0.62, 0.62);
      var spd = cruise * clamp(1.25 - Math.abs(diff) * 0.6, 0.38, 1);
      if (dist < 3.2) spd = 0;
      var accel = spd > v.speed ? spec.accel * 0.92 : spec.brake;
      v.speed += clamp(spd - v.speed, -accel * dt, accel * dt);
      v.speed = clamp(v.speed, -8, spec.maxSpeed);
      v.steer = steer;
      var yawRate = steer * spec.turn * (v.speed / (Math.abs(v.speed) + 6));
      if (Math.abs(v.speed) > 0.2) v.heading += yawRate * dt * (v.speed >= 0 ? 1 : -1);
      v.x += Math.sin(v.heading) * v.speed * dt;
      v.z += Math.cos(v.heading) * v.speed * dt;
      SH.Vehicles.collideWorld(v, dt);
      SH.Vehicles.syncMesh(v);
      SH.Vehicles.setBrakeLights(v, spd < v.speed - 1);
      return dist;
    },

    // ---- main update -----------------------------------------------------------
    update: function (dt) {
      var st = SH.State;
      if (st.mode !== 'playing') return;
      var f = this.focus();

      if (st.wanted <= 0) {
        if (this.units.length || this.officers.length || this.blocks.length || this.heli) this.despawnAll(false);
        this.state = 'IDLE';
        return;
      }
      this.state = this.searching ? 'SEARCHING' : 'PURSUIT';

      // --- line of sight (checked 4x a second) ---
      this.losTimer -= dt;
      if (this.losTimer <= 0) {
        this.losTimer = 0.25;
        var seen = false;
        var i, d;
        for (i = 0; i < this.units.length; i++) {
          d = Math.hypot(this.units[i].veh.x - f.x, this.units[i].veh.z - f.z);
          if (d < 120 && !losBlocked(this.units[i].veh.x, this.units[i].veh.z, f.x, f.z)) { seen = true; break; }
        }
        if (!seen) for (i = 0; i < this.officers.length; i++) {
          if (this.officers[i].dead) continue;
          d = Math.hypot(this.officers[i].x - f.x, this.officers[i].z - f.z);
          if (d < 90 && !losBlocked(this.officers[i].x, this.officers[i].z, f.x, f.z)) { seen = true; break; }
        }
        if (!seen && this.heli && st.wanted >= 4) {
          // The helicopter only holds the player while it is physically close
          // and its view is not blocked by buildings.
          var hd = Math.hypot(this.heli.mesh.position.x - f.x, this.heli.mesh.position.z - f.z);
          if (hd < 115 && !losBlocked(this.heli.mesh.position.x, this.heli.mesh.position.z, f.x, f.z)) seen = true;
        }
        // With no unit on scene there is no line-of-sight: the search clock
        // runs while the fleet is still driving in from its spawn ring.
        if (seen) {
          this.searching = false; this.searchTimer = 0;
          this.lastKnown.x = f.x; this.lastKnown.z = f.z;
          this.seenTimer = 0;
        } else {
          this.seenTimer += 0.25;
          if (this.seenTimer > 1.6) this.searching = true;
        }
      }

      // --- search decay ---
      if (this.searching) {
        this.searchTimer += dt;
        var need = cfgP.searchSeconds[st.wanted] || 12;
        if (this.searchTimer >= need) {
          st.wanted -= 1;
          this.searchTimer = 0;
          this.seenTimer = 0;
          if (st.wanted <= 0) {
            this.searching = false;
            if (SH.HUD) { SH.HUD.notify('You lost the police'); SH.HUD.banner('ESCAPED', 'The heat dies down. Stay out of trouble.', 2.2, false); }
            this.despawnAll(false);
            return;
          } else if (SH.HUD) SH.HUD.notify('Wanted level ' + st.wanted + ' — keep hiding');
        }
      }

      // --- keep the fleet at the size the stars demand ---
      this.spawnTimer -= dt;
      var wantCars = cfgP.carsByStars[st.wanted];
      if (wantCars === undefined) wantCars = 2;
      if (this.units.length < wantCars && this.spawnTimer <= 0) {
        this.spawnTimer = 0.8;
        this.spawnCar(false);
        if (this.units.length < wantCars - 1) this.spawnCar(false);
      }
      // Recycle units that fell too far behind.
      for (var u = this.units.length - 1; u >= 0; u--) {
        var uv = this.units[u].veh;
        if (uv.dead) { this.retireCar(this.units[u]); continue; }
        if (Math.hypot(uv.x - f.x, uv.z - f.z) > cfgP.despawnDist) this.retireCar(this.units[u]);
      }
      this.maybeRoadblock(dt);
      for (var b = this.blocks.length - 1; b >= 0; b--) {
        this.blocks[b].life -= dt;
        var bv = this.blocks[b].veh;
        if (this.blocks[b].life <= 0 || bv.dead || Math.hypot(bv.x - f.x, bv.z - f.z) > 260) {
          bv.active = false;
          var li2 = SH.Vehicles.list.indexOf(bv);
          if (li2 >= 0) SH.Vehicles.list.splice(li2, 1);
          if (bv.mesh.parent) bv.mesh.parent.remove(bv.mesh);
          this.blocks.splice(b, 1);
        }
      }

      // --- drive the pursuit ---
      var playerSpeed = st.driving && st.vehicle ? Math.abs(st.vehicle.speed) : Math.hypot(st.player.vx, st.player.vz);
      for (var i2 = 0; i2 < this.units.length; i2++) {
        var unit = this.units[i2], veh = unit.veh;
        var distP = Math.hypot(veh.x - f.x, veh.z - f.z);
        if (unit.staged) {
          // Screenshot formation: match the player car's velocity exactly so
          // the staged gap never closes or opens.
          var pvx = st.vehicle ? Math.sin(st.vehicle.heading) * st.vehicle.speed : 0;
          var pvz = st.vehicle ? Math.cos(st.vehicle.heading) * st.vehicle.speed : 0;
          veh.x += pvx * dt; veh.z += pvz * dt;
          veh.speed = st.vehicle ? st.vehicle.speed : 0;
          SH.Vehicles.syncMesh(veh);
          continue;
        }
        unit.pathTimer -= dt;
        var direct = distP < 62 && !losBlocked(veh.x, veh.z, f.x, f.z);
        var tx, tz;
        if (direct || this.searching === false && distP < 30) {
          // Intercept: aim where the player will be in half a second.
          var pvx = st.driving && st.vehicle ? Math.sin(st.vehicle.heading) * st.vehicle.speed : st.player.vx;
          var pvz = st.driving && st.vehicle ? Math.cos(st.vehicle.heading) * st.vehicle.speed : st.player.vz;
          tx = f.x + pvx * 0.55; tz = f.z + pvz * 0.55;
          unit.path = null;
        } else {
          if (!unit.path || unit.pathTimer <= 0) {
            unit.pathTimer = 1.6;
            var fromN = SH.World.nearestNode(veh.x, veh.z);
            var toN = SH.World.nearestNode(this.searching ? this.lastKnown.x : f.x, this.searching ? this.lastKnown.z : f.z);
            unit.path = graphPath(fromN, toN);
            unit.wp = 0;
            // If the car already sits past its first node (it spawns mid-edge),
            // start at the next one instead of U-turning back to it.
            if (unit.path && unit.path.length > 1) {
              var n0 = SH.World.graph.nodes[unit.path[0]], n1 = SH.World.graph.nodes[unit.path[1]];
              if (Math.hypot(n1.x - veh.x, n1.z - veh.z) < Math.hypot(n0.x - veh.x, n0.z - veh.z)) unit.wp = 1;
            }
          }
          var nodes = SH.World.graph.nodes;
          while (unit.path && unit.wp < unit.path.length - 1) {
            var wpn = nodes[unit.path[unit.wp]];
            if (Math.hypot(wpn.x - veh.x, wpn.z - veh.z) < 9) unit.wp++;
            else break;
          }
          var targetNode = unit.path && unit.path.length ? nodes[unit.path[Math.min(unit.wp, unit.path.length - 1)]] : null;
          tx = targetNode ? targetNode.x : this.lastKnown.x;
          tz = targetNode ? targetNode.z : this.lastKnown.z;
          if (this.searching && distP > 40 && unit.path && unit.wp >= unit.path.length - 1) { tx = this.lastKnown.x; tz = this.lastKnown.z; }
        }
        var cruise = veh.spec.maxSpeed * (st.wanted >= 4 ? 0.99 : 0.9);
        if (this.searching) cruise *= 0.55;
        // Unstick: a unit that barely moves while its target is far
        // away is pinned (nose-in against a collider after a corner
        // cut, or overlapped with another car). Steer it back to the
        // nearest road node — always on a centreline — until it rolls.
        if (unit.recover > 0) {
          unit.recover -= dt;
          var rni = SH.World.nearestNode(veh.x, veh.z);
          var rn = SH.World.graph.nodes[rni];
          // A node within a few metres is useless as a recover target
          // (driveCar stops inside 3.2 m): aim past it, at its most
          // distant neighbour, so the car actually rolls out.
          if (Math.hypot(rn.x - veh.x, rn.z - veh.z) < 12) {
            var rBest = rn, rBd = -1;
            for (var rei = 0; rei < rn.edges.length; rei++) {
              var re = SH.World.graph.edges[rn.edges[rei]];
              var ro = SH.World.graph.nodes[re.a === rni ? re.b : re.a];
              var rd = Math.hypot(ro.x - veh.x, ro.z - veh.z);
              if (rd > rBd) { rBd = rd; rBest = ro; }
            }
            rn = rBest;
          }
          tx = rn.x; tz = rn.z;
        }
        this.driveCar(unit, dt, tx, tz, cruise);
        if (Math.abs(veh.speed) < 0.6 && distP > 15) {
          unit.stuckT = (unit.stuckT || 0) + dt;
          if (unit.stuckT > 1.4) { unit.recover = 1.6; unit.stuckT = 0; unit.path = null; unit.pathTimer = 0; }
        } else unit.stuckT = 0;

        // Officers bail out when close and the player is slow / on foot.
        if (!unit.officersOut && st.wanted >= 2 && distP < 15 && playerSpeed < 3.2) {
          unit.officersOut = true;
          this.spawnOfficer(veh.x + 2, veh.z, unit);
          if (st.wanted >= 3) this.spawnOfficer(veh.x - 2, veh.z + 1, unit);
        }
        if (unit.officersOut && distP > 55) unit.officersOut = false;
      }

      // --- foot officers ---
      var boxed = false;
      for (var o = this.officers.length - 1; o >= 0; o--) {
        var off = this.officers[o];
        if (off.dead) {
          off.deadTimer -= dt;
          off.mesh.rotation.x = Math.min(Math.PI / 2, off.mesh.rotation.x + dt * 5);
          if (off.deadTimer <= 0) this.removeOfficer(off);
          continue;
        }
        var od = Math.hypot(off.x - f.x, off.z - f.z);
        if (od > 240) { this.removeOfficer(off); continue; }
        // At low stars officers close in to make the arrest (inside busted
        // range); at high stars they keep a shooting distance instead.
        var wantDist = st.wanted >= 3 ? 13 : (this.bustedTimer > 0.25 ? 3 : 5.5);
        var mvx = 0, mvz = 0, spd2 = 0;
        if (od > wantDist + 0.5) { mvx = (f.x - off.x) / od; mvz = (f.z - off.z) / od; spd2 = 4.6; }
        else if (od < wantDist - 1.5) { mvx = (off.x - f.x) / od; mvz = (off.z - f.z) / od; spd2 = 2.6; }
        else { // strafe slowly around the player
          mvx = -(f.z - off.z) / od * 0.5; mvz = (f.x - off.x) / od * 0.5; spd2 = 1.1;
        }
        if (spd2 > 0) {
          off.x += mvx * spd2 * dt; off.z += mvz * spd2 * dt;
          off.heading = Math.atan2(mvx, mvz);
          off.cycle += dt * spd2 * 2.6;
        }
        var los = od < cfgP.copFireRange + 14 && !losBlocked(off.x, off.z, f.x, f.z);
        off.mesh.position.set(off.x, 0, off.z);
        off.mesh.rotation.y = Math.atan2(f.x - off.x, f.z - off.z);
        var sw = Math.sin(off.cycle * 2.2) * (spd2 > 0 ? 0.5 : 0.03);
        off.parts.legL.rotation.x = sw; off.parts.legR.rotation.x = -sw;
        off.parts.armL.rotation.x = -sw * 0.7;
        off.parts.armR.rotation.x = st.wanted >= 3 && los ? -1.35 : sw * 0.7; // gun arm up
        if (off.parts.shinL) { // knees fold on the forward swing
          off.parts.shinL.rotation.x = Math.max(0, -sw) * 0.85;
          off.parts.shinR.rotation.x = Math.max(0, sw) * 0.85;
        }
        // Shooting at high stars.
        if (st.wanted >= 3 && los && od < cfgP.copFireRange) {
          off.fireTimer -= dt;
          if (off.fireTimer <= 0) {
            off.fireTimer = 1.1 + Math.random() * 0.9;
            if (SH.Combat) SH.Combat.hostileFire(off.x, 1.45, off.z, f.x, f.z, cfgP.copDamage, 0.5 - od / 130);
          }
        }
        if (od < cfgP.bustedRadius + 1.5) boxed = true;
      }
      // Cars boxing the player in count too.
      if (!boxed && playerSpeed < 2.2) {
        for (var c2 = 0; c2 < this.units.length; c2++) {
          if (Math.hypot(this.units[c2].veh.x - f.x, this.units[c2].veh.z - f.z) < cfgP.bustedRadius + 2.4) { boxed = true; break; }
        }
      }
      if (boxed && playerSpeed < 2.6 && st.stun <= 0) {
        this.bustedTimer += dt;
        if (SH.HUD && this.bustedTimer > 0.4) SH.HUD.setPrompt('The police are boxing you in — MOVE!');
        if (this.bustedTimer >= cfgP.bustedSeconds) { this.bustedTimer = 0; this.busted(); return; }
      } else this.bustedTimer = Math.max(0, this.bustedTimer - dt * 1.5);

      // --- helicopter at 4-5 stars ---
      if (st.wanted >= 4) {
        this.ensureHeli();
        var h = this.heli;
        if (h.cx === undefined) { h.cx = this.lastKnown.x; h.cz = this.lastKnown.z; }
        // In a staged screenshot the orbit angle stays where stageChase put
        // it, so the helicopter is guaranteed inside the frame.
        if (!(SH.Shots && SH.Shots.active)) h.angle += dt * 0.45;
        // The orbit centre flies toward the last known position at speed; it
        // does NOT track the player magically — losing the heli is possible.
        var hdx = this.lastKnown.x - h.cx, hdz = this.lastKnown.z - h.cz;
        var hdd = Math.hypot(hdx, hdz);
        if (hdd > 1) { var hstep = Math.min(hdd, 26 * dt); h.cx += hdx / hdd * hstep; h.cz += hdz / hdd * hstep; }
        var hx = h.cx + Math.cos(h.angle) * 34, hz = h.cz + Math.sin(h.angle) * 34;
        h.mesh.position.set(hx, 40, hz);
        h.mesh.lookAt(h.cx, 0, h.cz);
        h.rotor.rotation.y += dt * 28;
        h.spot.target.position.set(h.cx - hx, -40, h.cz - hz);
        h.spot.target.updateMatrixWorld();
      } else this.removeHeli();

      if (SH.Audio) SH.Audio.siren(this.units.length > 0 || this.officers.length > 0);
    },

    // Instant staging for the ?shot=chase screenshot: units already on scene.
    // Composition rules: the chase camera sits ~5 m behind the player car, so
    // a unit 12+ m behind is BEHIND the camera and invisible. Staged units
    // ride in the adjacent lanes a few metres back (front half + lightbar in
    // frame, never intersecting the player car) and hold formation at the
    // player's speed (see the `staged` branch in update()).
    stageChase: function () {
      var st = SH.State;
      var f = this.focus();
      this.forceWanted(4);
      var h = st.vehicle ? st.vehicle.heading : Math.PI;
      var fx = Math.sin(h), fz = Math.cos(h);       // player forward
      var rx = fz, rz = -fx;                        // player right
      var spots = [[2.9, 4.5], [-2.9, 6.8]];
      for (var i = 0; i < spots.length; i++) {
        var unit = this.spawnCar(true);
        if (unit) {
          unit.staged = true;
          unit.veh.x = f.x + rx * spots[i][0] - fx * spots[i][1];
          unit.veh.z = f.z + rz * spots[i][0] - fz * spots[i][1];
          unit.veh.heading = h;
          unit.veh.speed = 0;
          SH.Vehicles.syncMesh(unit.veh);
        }
      }
      // A roadblock across the road ~60 m ahead of the player car.
      var scene = this.ensureScene();
      var bx = f.x + fx * 60, bz = f.z + fz * 60;
      for (var j = 0; j < 2; j++) {
        var side = j === 0 ? -2.9 : 2.9;
        var veh = SH.Vehicles.spawnVehicle(scene, 'police', 0xf2f2f2, bx + rx * side, bz + rz * side, h + Math.PI / 2);
        veh.driver = 'roadblock';
        this.blocks.push({ veh: veh, life: 999 });
      }
      this.ensureHeli();
      if (this.heli) { this.heli.cx = f.x; this.heli.cz = f.z; this.heli.angle = -0.7; }
      this.searching = false;
      this.lastKnown.x = f.x; this.lastKnown.z = f.z;
    },

    // Shared with minimap: red blips for every active police element.
    blipPositions: function (out) {
      out.length = 0;
      for (var i = 0; i < this.units.length; i++) out.push(this.units[i].veh);
      for (var j = 0; j < this.blocks.length; j++) out.push(this.blocks[j].veh);
      for (var k = 0; k < this.officers.length; k++) if (!this.officers[k].dead) out.push(this.officers[k]);
      return out;
    }
  };

  SH.Police = Police;
})(window.SH = window.SH || {});
