// SELATARA HEAT — pedestrians.js
// Sidewalk pedestrians: pooled walkers who stroll between corners,
// idle and chat, panic-flee from danger, and fall when hit by a fast
// vehicle. STAGE E: every pedestrian is built by the ONE character
// factory (SH.CharFactory.create) and animated by the shared
// SH.CharAnim system — the old in-file figure builder is retired;
// there is no second human system left in the game.
// Public API: SH.Pedestrians { init(scene), update(dt), list, scare(x, z, radius) }.
(function (SH) {
  'use strict';

  // The 14 pedestrian archetypes (Stage C table) cycled across the
  // pool; the seed makes each instance a different person.
  var PED_ARCHS = ['turis', 'sekolah', 'kantoran', 'pedagang', 'warung', 'nelayan',
    'ojek', 'jogger', 'ibuBelanja', 'kakek', 'musisi', 'pekerjaDermaga', 'pasangan', 'ibuHijab'];
  // The first pool slots live in the night market (Rev 6) —
  // give them market-flavoured archetypes.
  // VISUAL POLISH step 3: the market crowd grows 8 -> 14 — with
  // the third stall row and the food-cart line the block carries
  // three walking bands, and eight regulars left the rows reading
  // empty between the staging crowds. Same pool of 48; six more
  // of them are simply market regulars now.
  var MARKET_ARCHS = ['pedagang', 'warung', 'ibuBelanja', 'pasangan', 'turis', 'musisi', 'nelayan', 'ibuHijab',
    'pedagang', 'ibuBelanja', 'turis', 'warung', 'pasangan', 'ojek'];
  var PANIC_REF = (SH.CharAnim && SH.CharAnim.clips.panic && SH.CharAnim.clips.panic.userData.refSpeed) || 2.8;

  // ROUND 3 crowd distribution (user spec): gathering anchors. The
  // pool is 48 strong, but round 2 scattered it uniformly over every
  // intersection in the city, so a park or plaza frame showed ~3
  // people. Recycled walkers now often re-enter at a hotspot near
  // the player and stroll locally inside it (see respawn/pickTarget),
  // which keeps plazas/parks/promenades populated at 15-25 visible.
  var HOTSPOTS = [
    { x: 20, z: 120, r: 48 },    // Taman Arus park paths
    { x: 0, z: 230, r: 64 },     // Pantai Kencana promenade
    { x: -420, z: -120, r: 38 }, // Ruko Senja plaza blocks
    { x: 300, z: 120, r: 36 },   // Pelabuhan Karat apron
    { x: -120, z: -180, r: 40 }  // Pelita Heights plaza sidewalks
  ];

  function makeCtl(char) {
    var arch = char.archetype;
    return SH.CharAnim.create(char, {
      start: arch.idle || 'idle', idle: arch.idle, gait: arch.gait, posture: arch.posture
    });
  }

  var Pedestrians = {
    list: [],
    rng: SH.World.makeRng(31),
    _scene: null,

    init: function (scene) {
      this._scene = scene;
      var n = SH.Config.loop.pedCount;
      for (var i = 0; i < n; i++) {
        var archId = i < MARKET_ARCHS.length ? MARKET_ARCHS[i] : PED_ARCHS[i % PED_ARCHS.length];
        var built = SH.CharFactory.create(archId, 500 + i * 13);
        scene.add(built.group);
        var ped = {
          mesh: built.group, char: built, ctl: makeCtl(built),
          x: 0, z: 0, heading: 0, speed: 0, cycle: this.rng() * 6,
          tx: 0, tz: 0, state: 'walk', timer: this.rng() * 3, panic: 0, down: 0,
          deadClip: false,
          // Per-ped walk-speed jitter (±15%): nobody strolls at the
          // same speed, so the crowd never walks in sync. (Gait phase
          // is seeded per character in toon.js createCharacter.)
          speedJ: 0.85 + this.rng() * 0.3,
          hot: null, // ROUND 3: gathering hotspot this ped belongs to
          market: i < MARKET_ARCHS.length // Rev 6 + VISUAL POLISH step 3: the first MARKET_ARCHS walkers belong to the night market
        };
        this.list.push(ped);
        this.respawn(ped, true);
      }
    },

    respawn: function (ped, anywhere) {
      ped.gy = undefined; // LEGFIX A: snap to the new spot's surface
      // Market regulars always (re)spawn inside the market block, so
      // the stalls keep their crowd at any hour (Rev 6).
      if (ped.market) {
        ped.x = -352 + this.rng() * 96;
        ped.z = 74 + this.rng() * 46;
        ped.down = 0; ped.state = 'walk';
        ped.mesh.rotation.x = 0;
        ped.deadClip = false;
        ped.ctl.setSpeed(0); // back to the idle clip after any death pose
        this.pickTarget(ped);
        ped.mesh.visible = true;
        return;
      }
      var g = SH.World.graph;
      var focus = SH.State.player;
      // ROUND 3: about half of recycled walkers re-enter at a
      // gathering hotspot within reach of the player instead of a
      // random intersection city-wide, so gathering areas stay full.
      ped.hot = null;
      if (!anywhere && this.rng() < 0.5) {
        var near = [];
        for (var hi = 0; hi < HOTSPOTS.length; hi++) {
          if (Math.hypot(HOTSPOTS[hi].x - focus.x, HOTSPOTS[hi].z - focus.z) < 170) near.push(HOTSPOTS[hi]);
        }
        for (var ht = 0; ht < 8 && near.length; ht++) {
          var hh = near[(this.rng() * near.length) | 0];
          var hx = hh.x + (this.rng() - 0.5) * 2 * hh.r * 0.8;
          var hz = hh.z + (this.rng() - 0.5) * 2 * hh.r * 0.8;
          if (!SH.World.isLand(hx, hz) || SH.World.inWater(hx, hz)) continue;
          var hdd = Math.hypot(hx - focus.x, hz - focus.z);
          if (hdd < 25 || hdd > 300) continue;
          ped.x = hx; ped.z = hz; ped.hot = hh; ped.down = 0; ped.state = 'walk';
          ped.mesh.rotation.x = 0;
          ped.deadClip = false;
          ped.ctl.setSpeed(0);
          this.pickTarget(ped);
          ped.mesh.visible = true;
          return;
        }
      }
      for (var tries = 0; tries < 10; tries++) {
        var node = g.nodes[(this.rng() * g.nodes.length) | 0];
        if (node.overWater) continue; // never spawn a walker mid-bridge
        var x = node.x + (this.rng() - 0.5) * 16, z = node.z + (this.rng() - 0.5) * 16;
        var d = Math.hypot(x - focus.x, z - focus.z);
        if (!anywhere && (d < 50 || d > 300)) continue;
        if (anywhere && d < 25) continue;
        ped.x = x; ped.z = z; ped.down = 0; ped.state = 'walk';
        ped.mesh.rotation.x = 0;
        ped.deadClip = false;
        ped.ctl.setSpeed(0);
        this.pickTarget(ped);
        ped.mesh.visible = true;
        return;
      }
      ped.mesh.visible = false;
    },

    pickTarget: function (ped) {
      // Market regulars stroll the stall bands (walkway + the gaps
      // between the two tent rows), never leaving the block.
      if (ped.market) {
        var bands = [77, 92, 110];
        // Step to the same or a neighbouring band, so strolls mostly
        // run along the rows instead of cutting through the tents.
        var bi = ped.z < 84 ? 0 : (ped.z < 101 ? 1 : 2);
        bi = Math.max(0, Math.min(2, bi + ((this.rng() * 3) | 0) - 1));
        ped.tx = -352 + this.rng() * 96;
        ped.tz = bands[bi] + (this.rng() - 0.5) * 5;
        return;
      }
      // ROUND 3: hotspot locals mostly stroll INSIDE their gathering
      // area (short local targets), so a cluster stays a cluster
      // instead of dispersing to far intersections within a minute.
      if (ped.hot) {
        if (Math.hypot(ped.x - ped.hot.x, ped.z - ped.hot.z) > 140) ped.hot = null;
        else if (this.rng() < 0.65) {
          var lx = ped.hot.x + (this.rng() - 0.5) * 2 * ped.hot.r * 0.85;
          var lz = ped.hot.z + (this.rng() - 0.5) * 2 * ped.hot.r * 0.85;
          if (SH.World.isLand(lx, lz) && !SH.World.inWater(lx, lz)) { ped.tx = lx; ped.tz = lz; return; }
        }
      }
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
          // VISUAL POLISH step 4: the closest bystanders DUCK
          // before they run — a shot landing within ~9 m drops
          // about half of them into the 'duck' cower for a beat
          // (they flee when it expires, see update). A ped already
          // ducking just stays down a little longer under
          // sustained fire; one already fleeing keeps fleeing.
          if (ped.state === 'duck') { ped.duckT = Math.max(ped.duckT, 0.7); continue; }
          if (ped.state === 'panic') continue;
          if (d < 9 && this.rng() < 0.55) {
            ped.state = 'duck'; ped.duckT = 0.9 + this.rng() * 0.9;
            ped.duckX = x; ped.duckZ = z;
            continue;
          }
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
          // Stage E: the fall is the shared 'death' clip, not the old
          // whole-group tip-over.
          if (!ped.deadClip) { ped.ctl.play('death', 0.05, true); ped.deadClip = true; }
          ped.ctl.update(dt);
          if (ped.down <= 0) this.respawn(ped, false);
          continue;
        }

        // ROUND 3 state-return guarantee: a LIVE ped never holds the
        // corpse clip. If a 'death' pose is showing while down<=0 (a
        // missed transition anywhere upstream), force back to idle.
        if (ped.ctl.current() === 'death') { ped.deadClip = false; ped.ctl.setSpeed(0); }

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
        // ROUND 3: cruise speed comes from the ARCHETYPE (jogger 2.6
        // crosses CharAnim's run threshold, kakek 0.7 ambles), still
        // jittered per ped. It used to be a flat 1.5 for everyone,
        // which is why the "jogger" strolled and everyone marched at
        // one pace.
        var cruise = (ped.char.archetype && ped.char.archetype.walkSpeed) || 1.3;
        var speed = ped.state === 'panic' ? 5.6 : Math.min(3.2, cruise * (ped.speedJ || 1));
        if (ped.state === 'idle') {
          ped.timer -= dt;
          speed = 0;
          if (ped.timer <= 0) { ped.state = 'walk'; this.pickTarget(ped); }
        } else if (dist < 1.6 && ped.state !== 'duck') {
          if (ped.state === 'panic') { ped.state = 'walk'; this.pickTarget(ped); }
          else if (this.rng() < 0.3) { ped.state = 'idle'; ped.timer = 2 + this.rng() * 4; }
          else this.pickTarget(ped);
        }
        if (ped.state === 'panic') { ped.panic -= dt; if (ped.panic <= 0) ped.state = 'walk'; }
        // VISUAL POLISH step 4: a ducking ped stays planted until
        // the cower expires, then bolts — converted here into the
        // ordinary panic flee away from the shot's origin.
        if (ped.state === 'duck') {
          speed = 0;
          ped.duckT -= dt;
          if (ped.duckT <= 0) {
            var ox = ped.duckX != null ? ped.duckX : ped.x - 1, oz = ped.duckZ != null ? ped.duckZ : ped.z;
            var odx = ped.x - ox, odz = ped.z - oz, odl = Math.hypot(odx, odz) || 1;
            ped.state = 'panic'; ped.panic = 2.5 + this.rng() * 1.5;
            ped.tx = ped.x + odx / odl * 30; ped.tz = ped.z + odz / odl * 30;
          }
        }

        if (speed > 0 && dist > 0.1) {
          ped.heading = Math.atan2(dx / dist, dz / dist);
          ped.x += Math.sin(ped.heading) * speed * dt;
          ped.z += Math.cos(ped.heading) * speed * dt;
          ped.cycle += dt * speed * 2.6;
        }
        ped.speed = speed;
        // LEGFIX A: the root rides the real surface (slab 0.14,
        // zebra 0.035, cap 0.012, road 0, grass -0.08), lerped at
        // step rates so a curb crossing reads as a step, never a
        // teleport or a sink.
        var gT = SH.World.groundHeightAt(ped.x, ped.z);
        if (ped.gy === undefined) ped.gy = gT;
        var gStep = (gT > ped.gy ? 1.5 : 2.6) * dt;
        ped.gy += Math.max(-gStep, Math.min(gStep, gT - ped.gy));
        ped.mesh.position.set(ped.x, ped.gy + 0.005, ped.z);
        ped.mesh.rotation.y = ped.heading;
        // Shared animation: gait is speed-synced by CharAnim; panic
        // has its own clip (played at its stride rate); idle walkers
        // glance around slowly through the look layer.
        if (ped.state === 'panic') {
          ped.ctl.play('panic', 0.15);
          var act = ped.ctl.action();
          if (act) act.setEffectiveTimeScale(speed / PANIC_REF);
        } else if (ped.state === 'duck') {
          ped.ctl.play('duck', 0.1);
        } else {
          ped.ctl.setSpeed(speed);
        }
        ped.ctl.look(ped.state === 'idle' ? Math.sin(st.time * 0.4 + i * 1.7) * 20 : 0, 0);
        ped.ctl.update(dt);
      }
      // ONE LOD / far-silhouette pass for every factory character in
      // the game (peds, player, officers, enemies, courier).
      if (SH.CharFactory && SH.Main && SH.Main.getCamera()) {
        SH.CharFactory.update(SH.Main.getCamera(), this._scene);
      }
    }
  };

  SH.Pedestrians = Pedestrians;
})(window.SH = window.SH || {});
