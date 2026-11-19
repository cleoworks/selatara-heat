// SELATARA HEAT — shots.js
// Deterministic ?shot=<name> scenes for screenshots: each stages the real game
// (seed, hour, weather, player/vehicle placement, HUD state) and lets the same
// code render it, so a shot is always a true frame of the game itself.
// Staging rules (learned the hard way): the player vehicle sits ON a road,
// the camera rides low behind-side via the normal driving camera, traffic and
// pedestrians are teleported INTO the frame, and every shot validates its
// camera height before the frame is taken (see SH.Shots.report).
// Public API: SH.Shots { active, name, apply(), report }.
(function (SH) {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var name = params.get('shot');

  function enterClean(veh) {
    var st = SH.State;
    veh.driver = 'player';
    st.driving = true;
    st.vehicle = veh;
    SH.Player.onFoot = false;
    st.vehiclePos.x = veh.x; st.vehiclePos.z = veh.z; st.vehiclePos.y = 0;
    st.player.x = veh.x; st.player.z = veh.z;
    if (SH.Player.mesh) SH.Player.mesh.visible = false;
  }

  // Snap the follow camera straight to its settled position (no swing-in).
  function snapCamera() {
    var st = SH.State;
    var back = {
      x: Math.sin(st.camYaw) * Math.cos(st.camPitch),
      y: Math.sin(st.camPitch),
      z: Math.cos(st.camYaw) * Math.cos(st.camPitch)
    };
    var t = st.driving ? st.vehiclePos : st.player;
    var dist = st.driving ? 5.4 : 6.4, height = st.driving ? 1.55 : 1.9;
    var cx = t.x + back.x * dist, cz = t.z + back.z * dist;
    if (st.driving) { cx += back.z * 1.7; cz += -back.x * 1.7; }
    SH.Player._camPos = new THREE.Vector3(cx, Math.max(0.7, height + back.y * dist), cz);
  }

  // Traffic cars live on graph edges (positionOnEdge overrides any direct
  // teleport), so staging assigns the edge + direction + t along it.
  function stageTraffic(spots) {
    if (!SH.Traffic) return;
    var g = SH.World.graph;
    var cars = SH.Traffic.cars;
    for (var i = 0; i < spots.length && i < cars.length; i++) {
      var s = spots[i]; // { from: [x,z], to: [x,z], t }
      // Nearest-endpoint match (not exact coords): the graph gained curved
      // and diagonal edges in Art Pass 3, so staging spots name the area
      // and the closest real edge wins.
      var ei = -1, fromIdx = -1, bestScore = Infinity;
      for (var e = 0; e < g.edges.length; e++) {
        var a = g.nodes[g.edges[e].a], b = g.nodes[g.edges[e].b];
        var s1 = Math.hypot(a.x - s.from[0], a.z - s.from[1]) + Math.hypot(b.x - s.to[0], b.z - s.to[1]);
        var s2 = Math.hypot(b.x - s.from[0], b.z - s.from[1]) + Math.hypot(a.x - s.to[0], a.z - s.to[1]);
        if (Math.min(s1, s2) < bestScore) { bestScore = Math.min(s1, s2); ei = e; fromIdx = s1 <= s2 ? g.edges[e].a : g.edges[e].b; }
      }
      if (ei < 0) continue;
      var v = cars[i];
      v.traffic.edge = ei;
      v.traffic.from = fromIdx;
      v.traffic.t = s.t;
      v.traffic.speed = v.traffic.cruise * 0.8;
      SH.Traffic.positionOnEdge(v);
    }
  }

  function stagePeds(spots) {
    if (!SH.Pedestrians) return;
    var list = SH.Pedestrians.list;
    for (var i = 0; i < spots.length && i < list.length; i++) {
      list[i].x = spots[i][0]; list[i].z = spots[i][1];
      list[i].tx = spots[i][0]; list[i].tz = spots[i][1];
      if (list[i].mesh) list[i].mesh.position.set(spots[i][0], 0, spots[i][1]);
    }
  }

  var Shots = {
    active: !!name,
    name: name,
    report: {},

    apply: function () {
      if (!name) return;
      var st = SH.State;
      var scene = SH.Main.getScene();
      st.mode = 'playing';

      if (name === 'cover') {
        // Golden-hour westbound drive on the Pantai Kencana beachfront
        // street, which now bends with the coast (z from beachRoadZ):
        // hotels and palms on the right, open sea on the left, and the
        // sun sprite visible ahead over the water.
        SH.Main.setHour(17.85);
        var car = SH.Vehicles.spawnVehicle(scene, 'sport', 0xff4fa3, -30, SH.World.beachRoadZ(-30), -Math.PI / 2);
        enterClean(car);
        st._shotCruise = { speed: 15 };
        st.camYaw = Math.PI / 2; st.camPitch = 0.04;
        snapCamera();
        st.cash = 4650;
        st.objective = { title: 'FIRST RUN', text: 'Deliver the package to Butik Kencana', x: 60, z: 178 };
        stageTraffic([
          { from: [0, 228], to: [-120, 228], t: 0.42 },
          { from: [-120, 228], to: [0, 228], t: 0.3 },
          { from: [-240, 228], to: [-120, 228], t: 0.75 },
          { from: [120, 228], to: [0, 228], t: 0.55 }
        ]);
        stagePeds([[-52, 241], [-18, 224], [8, 246], [-84, 221]]);
        if (SH.HUD) SH.HUD.subtitle('Mami Ratna', 'Beach road, Raka. Sunset is pretty — the debt is not. Move.', 30);
      } else if (name === 'drive') {
        // Northbound through Pelita Heights at golden hour, towers both sides.
        SH.Main.setHour(17.9);
        var car2 = SH.Vehicles.spawnVehicle(scene, 'sport', 0x37e0ff, -120, -150, Math.PI);
        enterClean(car2);
        st._shotCruise = { speed: 17 };
        st.camYaw = 0; st.camPitch = 0.05;
        snapCamera();
        st.cash = 2310;
        st.objective = { title: 'ESCORT MAMI', text: 'Drive Mami to Bengkel Arus', x: 246, z: 42 };
        stageTraffic([
          { from: [-120, -60], to: [-120, -180], t: 0.55 },
          { from: [-120, -180], to: [-120, -60], t: 0.5 },
          { from: [-120, -180], to: [-120, -300], t: 0.4 },
          { from: [-240, -180], to: [-120, -180], t: 0.6 }
        ]);
        stagePeds([[-127.5, -178], [-112.5, -205], [-127.5, -120]]);
        if (SH.HUD) SH.HUD.subtitle('Mami Ratna', 'Eyes on the road. If teal cars follow us, you know what to do.', 30);
      } else if (name === 'chase') {
        // Four-star pursuit on the Pelita avenue at dusk: patrol cars behind,
        // roadblock ahead, helicopter above, police panel on the HUD.
        SH.Main.setHour(18.1);
        var car3 = SH.Vehicles.spawnVehicle(scene, 'sedan', 0xe83a3a, -120, -118, Math.PI);
        enterClean(car3);
        st._shotCruise = { speed: 16 };
        st._shotCamDist = 8.5; // wider chase framing: staged units + lightbars fit
        st.camYaw = 0; st.camPitch = 0.05;
        snapCamera();
        st.cash = 3120;
        st.objective = { title: 'PORT OF LIES', text: 'Lose the police completely', x: -120, z: -118 };
        if (SH.Police) SH.Police.stageChase();
        // Traffic stays OUT of the player's avenue: one car far ahead in the
        // same avenue, one crossing on the next avenue — nothing can stack
        // onto the staged pursuit formation.
        stageTraffic([
          { from: [-120, -300], to: [-120, -180], t: 0.45 },
          { from: [-240, -180], to: [-120, -180], t: 0.5 }
        ]);
        stagePeds([[-127.5, -150], [-112.5, -96]]);
        if (SH.HUD) SH.HUD.subtitle('Raka', 'Four stars. Great. Hold on—', 30);
      } else if (name === 'combat') {
        // On-foot shootout staging INSIDE the Ruko Senja night market
        // at dusk: Raka stands in the z=92 walkway aiming EAST along
        // it — the corridor between the tent rows — so the stalls flank
        // the fight and the enemies read in a row, unobstructed.
        SH.Main.setHour(18.35);
        st.player.x = -330; st.player.z = 92;
        st.player.heading = Math.PI / 2;
        st.camYaw = -Math.PI / 2; st.camPitch = 0.04;
        snapCamera();
        st.player.health = 72; st.player.armor = 40;
        st.weapon = 'pistol'; st.ammo = 9; st.ammoReserve = 24;
        if (SH.Combat) {
          SH.Combat.owned.pistol = true;
          // Enemies at close-mid range (7-12 m) ahead of the aim camera,
          // spread laterally so they read around Raka's silhouette, in
          // bright rival colours that survive the dusk light. (An earlier
          // 11-17 m staging rendered them as specks in the official shot;
          // the fight has to read at thumbnail size.)
          SH.Combat.spawnEnemy(-317, 90, { color: 0x2a8a8a, hp: 45 });
          SH.Combat.spawnEnemy(-311, 94, { color: 0xc96f2a, hp: 45 });
          SH.Combat.spawnEnemy(-321, 95, { color: 0x2a8a8a, hp: 45 });
          SH.Combat.spawnEnemy(-306, 91, { color: 0xc92a6a, hp: 45 });
          // Freeze the firing frame: persistent additive flash sprites at
          // the nearest enemy's muzzle and at Raka's gun (the live particle
          // flash lasts 0.12 s and would almost never land in a still).
          var fc = document.createElement('canvas'); fc.width = fc.height = 64;
          var fg = fc.getContext('2d');
          var fgrad = fg.createRadialGradient(32, 32, 2, 32, 32, 32);
          fgrad.addColorStop(0, 'rgba(255,255,240,1)'); fgrad.addColorStop(0.3, 'rgba(255,190,80,0.85)'); fgrad.addColorStop(1, 'rgba(255,120,30,0)');
          fg.fillStyle = fgrad; fg.fillRect(0, 0, 64, 64);
          var ftex = new THREE.CanvasTexture(fc);
          function flash(x, y, z, s) {
            var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ftex, color: 0xffd9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
            sp.scale.set(s, s, 1); sp.position.set(x, y, z);
            scene.add(sp);
          }
          flash(-317.6, 1.45, 90.4, 1.5);   // nearest enemy's muzzle, aimed at Raka
          SH.Effects.tracer(-317.6, 1.45, 90.4, -329, 1.3, 92, true);
        }
        st._shotAim = true;
        st._shotAimDist = 4.2; // pull the aim camera back so Raka doesn't fill the frame
        st.objective = { title: 'NIGHT MARKET RUN', text: 'Fight through the market — catch the courier', x: -308, z: 92 };
        stagePeds([[-300, 88], [-338, 96], [-314, 99], [-324, 86]]);
        if (SH.HUD) SH.HUD.subtitle('Courier', 'Stay away from me! I know what is in this bag!', 30);
      } else if (name === 'lake') {
        // W1 proof: on foot on Danau Cermin's south shore path, looking
        // north across the lake — island + gazebo mid-frame, Kali Arus
        // entering at the left, Pelita towers behind.
        SH.Main.setHour(10.5);
        st.player.x = -30; st.player.z = 105;
        st.player.heading = Math.PI;
        st.camYaw = 0.12; st.camPitch = 0.03;
        snapCamera();
        st.cash = 1250;
        st.objective = { title: 'FREE ROAM', text: 'Danau Cermin, Taman Arus', x: -18, z: 28 };
        stagePeds([[-30, 112], [14, 110], [-44, 96]]);
      } else if (name === 'canal') {
        // W1 proof: Kanal Senja at night — standing on the south bank
        // looking west along the water: lantern strings, moored
        // sampans, laundry lines, the night market glowing behind.
        SH.Main.setHour(19.35);
        st.player.x = -356; st.player.z = 117.5;
        st.player.heading = Math.PI / 2;
        st.camYaw = -Math.PI / 2; st.camPitch = 0.05;
        snapCamera();
        st.cash = 2210;
        st.objective = { title: 'FREE ROAM', text: 'Kanal Senja, Ruko Senja', x: -316, z: 122 };
        stagePeds([[-338, 132], [-298, 117], [-322, 133.5]]);
      } else if (name === 'lighthouse') {
        // W1 proof: Mercusuar Pantai Kencana at sunset, from the pier —
        // striped tower on its rock, beam starting to sweep.
        SH.Main.setHour(18.05);
        st.player.x = 60; st.player.z = 366;
        st.player.heading = 0.47;
        st.camYaw = -2.67; st.camPitch = 0.06;
        snapCamera();
        st.cash = 1980;
        st.objective = { title: 'FREE ROAM', text: 'Mercusuar Pantai Kencana', x: 74, z: 398 };
        stagePeds([[56, 350], [64, 382]]);
      } else if (name === 'map') {
        SH.Main.setHour(10.5);
        st.mode = 'map';
        if (SH.Missions) SH.Missions.startIntroObjective();
      } else {
        if (SH.Missions) SH.Missions.startIntroObjective();
      }

      var hourOverride = parseFloat(params.get('hour'));
      if (!isNaN(hourOverride)) SH.Main.setHour(hourOverride);

      // Validation: the camera must end up above the road, near the player.
      var cam = SH.Main.getCamera();
      this.report = {
        shot: name,
        camY: cam ? +cam.position.y.toFixed(2) : -1,
        playerPos: [Math.round(st.player.x), Math.round(st.player.z)],
        driving: st.driving, wanted: st.wanted
      };
    }
  };

  SH.Shots = Shots;
})(window.SH = window.SH || {});
