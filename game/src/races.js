// SELATARA HEAT — races.js
// Street racing: four point-to-point checkpoint routes laid over the
// city's real road grid, offered at pulsing light pillars on the street.
// Roll into a start pillar in any car, press Enter, beat the countdown,
// then chase the checkpoint pillars against one rival Arus GT who drives
// the same route with plain waypoint steering. Wins pay through
// SH.Economy.addCash; best times and career race stats persist in a
// private localStorage key (the main save schema is not touched).
// Public API: SH.Races { init(), update(dt), routes, active(),
//   stats(), bestTime(routeId), inputLocked() }.
(function (SH) {
  'use strict';

  // ---------------------------------------------------------------------
  // Small own helpers (kept local so this module stands on its own).
  // ---------------------------------------------------------------------

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function dist2(ax, az, bx, bz) {
    var dx = ax - bx, dz = az - bz;
    return dx * dx + dz * dz;
  }

  // Wrap an angle difference to [-PI, PI] so steering never takes the
  // long way around the compass.
  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  // Race clock text: m:ss.t — the only format the HUD ever shows.
  function formatTime(sec) {
    if (!isFinite(sec) || sec == null) return '--:--.-';
    var m = Math.floor(sec / 60);
    var s = sec - m * 60;
    var whole = Math.floor(s);
    var tenth = Math.floor((s - whole) * 10);
    return m + ':' + (whole < 10 ? '0' : '') + whole + '.' + tenth;
  }

  // 8-wind compass label for a world-space delta. The map's +z axis is
  // south and +x is east, and headings in this game are atan2(dx, dz),
  // so bearing 0 looks south, +90 degrees looks east.
  var WINDS = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'];
  function compass(dx, dz) {
    var deg = Math.atan2(dx, dz) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    return WINDS[Math.round(deg / 45) % 8];
  }

  function notify(text) { if (SH.HUD) SH.HUD.notify(text); }

  function say(lines) {
    if (window.Dialog && Dialog.play) Dialog.play(lines);
  }

  // ---------------------------------------------------------------------
  // Route data. Checkpoints sit on real avenues / streets (the Config
  // grid: avenues at x in {-480..480 step 120}, streets at z in
  // {-420,-300,-180,-60,60,180,228}) with mid-block points between the
  // intersections so consecutive gates stay roughly 55-90 m apart and
  // the racing line is always a road, never a building block.
  // ---------------------------------------------------------------------

  var ROUTES = [
    {
      id: 'senja-sprint',
      name: 'Senja Sprint',
      tagline: 'Ruko Senja straight into the downtown grid',
      color: 0xffd23f,
      prize: 600,
      parTime: 95,
      checkpoints: [
        [-360, 60], [-300, 60], [-240, 60], [-180, 60], [-120, 60],
        [-60, 60], [0, 60], [60, 60], [120, 60],
        [120, 0], [120, -60], [120, -120], [120, -180]
      ],
      invite: [
        ['Bang Jaka', 'Senja Sprint. One straight blast down the market road, then north into Pelita. You in?', 3.6],
        ['Raka', 'Point me at the first gate.', 2.0]
      ]
    },
    {
      id: 'pelita-run',
      name: 'Pelita Heights Run',
      tagline: 'West across the towers, down and back along the park',
      color: 0x37e0ff,
      prize: 850,
      parTime: 110,
      checkpoints: [
        [0, -180], [-60, -180], [-120, -180], [-180, -180], [-240, -180],
        [-240, -120], [-240, -60], [-240, 0], [-240, 60],
        [-180, 60], [-120, 60], [-60, 60], [0, 60]
      ],
      invite: [
        ['Bang Jaka', 'Pelita Heights Run. Tower shadows, one long drop to the park road. The GT does not lift.', 3.6],
        ['Raka', 'Then neither do I.', 2.0]
      ]
    },
    {
      id: 'karat-dash',
      name: 'Karat Harbour Dash',
      tagline: 'Dockside east, up the port wall and back through Karat',
      color: 0xff7a4d,
      prize: 1050,
      parTime: 105,
      checkpoints: [
        [240, 180], [300, 180], [360, 180], [420, 180], [480, 180],
        [480, 120], [480, 60], [480, 0], [480, -60],
        [420, -60], [360, -60], [300, -60], [240, -60]
      ],
      invite: [
        ['Bang Jaka', 'Karat Harbour Dash. Container yards on your left, the whole port watching. Mind the corners.', 3.6],
        ['Raka', 'Corners are where races are won.', 2.2]
      ]
    },
    {
      id: 'kencana-gp',
      name: 'Kencana Coastal GP',
      tagline: 'The full beach boulevard, then the climb to Taman Arus',
      color: 0xff4fa3,
      prize: 1300,
      parTime: 120,
      checkpoints: [
        [-480, 228], [-420, 228], [-360, 228], [-300, 228], [-240, 228],
        [-180, 228], [-120, 228], [-60, 228], [0, 228], [60, 228], [120, 228],
        [120, 180], [120, 120], [120, 60]
      ],
      invite: [
        ['Bang Jaka', 'Kencana Coastal GP. The whole shoreline at golden hour, flag to flag. Biggest purse in Selatara.', 3.8],
        ['Raka', 'Save my grid slot.', 2.0]
      ]
    }
  ];

  function routeById(id) {
    for (var i = 0; i < ROUTES.length; i++) if (ROUTES[i].id === id) return ROUTES[i];
    return null;
  }

  // ---------------------------------------------------------------------
  // Persistence: best times + career stats in one private key. Every
  // access is wrapped — a browser without storage simply runs amnesiac.
  // ---------------------------------------------------------------------

  var SAVE_KEY = 'selatara-heat-races-v1';
  var store = {
    best: {},
    bestSplits: {},
    routeWins: {},
    league: { points: 0, grandSlams: 0 },
    stats: { entered: 0, finished: 0, won: 0, earned: 0 }
  };

  function loadStore() {
    try {
      var raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return;
      if (data.best && typeof data.best === 'object') {
        for (var k in data.best) {
          if (Object.prototype.hasOwnProperty.call(data.best, k) &&
              Number.isFinite(data.best[k]) && data.best[k] > 0) {
            store.best[k] = data.best[k];
          }
        }
      }
      if (data.bestSplits && typeof data.bestSplits === 'object') {
        for (var sk in data.bestSplits) {
          if (!Object.prototype.hasOwnProperty.call(data.bestSplits, sk)) continue;
          var arr = data.bestSplits[sk];
          if (!Array.isArray(arr)) continue;
          var clean = [];
          for (var j = 0; j < arr.length; j++) {
            clean.push(Number.isFinite(arr[j]) && arr[j] > 0 ? arr[j] : null);
          }
          if (clean.length) store.bestSplits[sk] = clean;
        }
      }
      if (data.routeWins && typeof data.routeWins === 'object') {
        for (var wk in data.routeWins) {
          if (Object.prototype.hasOwnProperty.call(data.routeWins, wk) &&
              Number.isFinite(data.routeWins[wk]) && data.routeWins[wk] > 0) {
            store.routeWins[wk] = Math.floor(data.routeWins[wk]);
          }
        }
      }
      if (data.league && typeof data.league === 'object') {
        if (Number.isFinite(data.league.points) && data.league.points >= 0) store.league.points = Math.floor(data.league.points);
        if (Number.isFinite(data.league.grandSlams) && data.league.grandSlams >= 0) store.league.grandSlams = Math.floor(data.league.grandSlams);
      }
      if (data.stats && typeof data.stats === 'object') {
        var fields = ['entered', 'finished', 'won', 'earned'];
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          if (Number.isFinite(data.stats[f]) && data.stats[f] >= 0) store.stats[f] = Math.floor(data.stats[f]);
        }
      }
    } catch (e) { /* storage unavailable: run without records */ }
  }

  function saveStore() {
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(store));
    } catch (e) { /* storage unavailable: records are best-effort */ }
  }


  // ---------------------------------------------------------------------
  // Runtime state. One race at a time; the machine walks
  // idle -> offered -> countdown -> racing -> idle.
  // ---------------------------------------------------------------------

  var R = {
    phase: 'idle',        // 'idle' | 'offered' | 'countdown' | 'racing'
    route: null,          // route being offered / run
    offeredRoute: null,   // route whose start pillar the player sits in
    offerCooldown: 0,     // seconds before a fresh offer may be spoken
    countdownT: 0,        // seconds left in the countdown
    countdownStep: -1,    // last whole number announced (3, 2, 1, 0=GO)
    elapsed: 0,           // race clock, seconds since GO
    playerIdx: 0,         // next checkpoint the player must pass
    rival: null,          // the rival car object from SH.Vehicles
    rivalIdx: 0,          // next checkpoint the rival must pass
    rivalTime: null,      // rival finish time, null while still running
    rivalCruise: 0,       // cached rival cruise speed (spec * 0.8)
    footT: 0,             // seconds the player has spent on foot mid-race
    splits: [],           // this run's cumulative time at each passed gate
    launchChecked: false, // perfect-launch bonus already judged this run
    launchBonus: 0,       // dollars riding on the purse for a clean launch
    sinceGate: 0,         // seconds since the last gate (off-route watch)
    offRouteWarnT: 0,     // cooldown between off-route warnings
    hintT: 0,             // seconds until the next direction hint
    built: false,         // start pillars exist in the scene
    markers: [],          // [{ route, group, beam, ring }]
    lines: [],            // [{ route, line }] ground polylines per route
    gate: null,           // the single reusable active-checkpoint pillar
    gateRing: null,
    gateGroup: null,
    nextGroup: null,      // faint preview pillar for the gate after this one
    nextBeam: null,
    nextRing: null,
    arrow: null,          // THREE.ArrowHelper toward the active gate
    enterPressed: false   // latched by our own keydown listener
  };

  var OFFER_RADIUS = 11;      // metres from a start pillar to be offered
  var GATE_RADIUS = 8;        // metres from a checkpoint that counts as passing it
  var FOOT_LIMIT = 6;         // seconds on foot before a race is abandoned
  var RIVAL_COLOR = 0xe83a3a; // the rival always wears the same red GT

  // ---------------------------------------------------------------------
  // Scene dressing: one start pillar per route, plus a single bright
  // gate pillar that teleports to whichever checkpoint is active.
  // ---------------------------------------------------------------------

  function makeBeam(colorHex, radius, height, opacity) {
    var geo = new THREE.CylinderGeometry(radius, radius, height, 20, 1, true);
    var mat = new THREE.MeshBasicMaterial({
      color: colorHex, transparent: true, opacity: opacity,
      side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    return new THREE.Mesh(geo, mat);
  }

  function makeRing(colorHex, inner, outer, opacity) {
    var geo = new THREE.RingGeometry(inner, outer, 40);
    var mat = new THREE.MeshBasicMaterial({
      color: colorHex, transparent: true, opacity: opacity,
      side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  function buildMarkers() {
    var scene = SH.Main && SH.Main.getScene ? SH.Main.getScene() : null;
    if (!scene || !window.THREE) return false;
    for (var i = 0; i < ROUTES.length; i++) {
      var route = ROUTES[i];
      var start = route.checkpoints[0];
      var gy = SH.World.groundHeightAt(start[0], start[1]);
      var group = new THREE.Group();
      var beam = makeBeam(route.color, 3.1, 26, 0.20);
      beam.position.y = 13;
      var ring = makeRing(route.color, 3.1, 4.3, 0.75);
      ring.position.y = 0.18;
      var disc = makeRing(route.color, 0, 3.1, 0.13);
      disc.position.y = 0.16;
      group.add(beam); group.add(ring); group.add(disc);
      group.position.set(start[0], gy, start[1]);
      scene.add(group);
      R.markers.push({ route: route, group: group, beam: beam, ring: ring, phase: i * 1.37 });
      // The route drawn on the ground: a polyline through every gate,
      // floating just above the asphalt so it survives the road's own
      // height changes. Shown while this route is offered or running.
      var pts3 = [];
      for (var p = 0; p < route.checkpoints.length; p++) {
        var cp = route.checkpoints[p];
        pts3.push(new THREE.Vector3(cp[0], SH.World.groundHeightAt(cp[0], cp[1]) + 0.35, cp[1]));
      }
      var lineGeo = new THREE.BufferGeometry().setFromPoints(pts3);
      var lineMat = new THREE.LineBasicMaterial({
        color: route.color, transparent: true, opacity: 0.55
      });
      var line = new THREE.Line(lineGeo, lineMat);
      line.visible = false;
      scene.add(line);
      R.lines.push({ route: route, line: line });
    }
    // The active gate: brighter and taller than a start pillar so it
    // reads as "go HERE" from anywhere in the district.
    var gateGroup = new THREE.Group();
    R.gate = makeBeam(0xffffff, 3.4, 34, 0.30);
    R.gate.position.y = 17;
    R.gateRing = makeRing(0xffffff, 3.4, 4.8, 0.9);
    R.gateRing.position.y = 0.2;
    gateGroup.add(R.gate); gateGroup.add(R.gateRing);
    gateGroup.visible = false;
    scene.add(gateGroup);
    R.gateGroup = gateGroup;
    // The next-gate preview: same shape, a whisper of the brightness,
    // so a driver can plan the line two corners ahead instead of
    // discovering each turn at the pillar.
    var nextGroup = new THREE.Group();
    R.nextBeam = makeBeam(0xffffff, 2.6, 30, 0.08);
    R.nextBeam.position.y = 15;
    R.nextRing = makeRing(0xffffff, 2.6, 3.6, 0.3);
    R.nextRing.position.y = 0.18;
    nextGroup.add(R.nextBeam); nextGroup.add(R.nextRing);
    nextGroup.visible = false;
    scene.add(nextGroup);
    R.nextGroup = nextGroup;
    // Direction arrow: floats over the player's car while racing.
    R.arrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 7, 0xffffff, 2.4, 1.4
    );
    R.arrow.visible = false;
    scene.add(R.arrow);
    R.built = true;
    return true;
  }

  function moveGateTo(x, z, colorHex) {
    if (!R.gateGroup) return;
    var gy = SH.World.groundHeightAt(x, z);
    R.gateGroup.position.set(x, gy, z);
    R.gate.material.color.setHex(colorHex);
    R.gateRing.material.color.setHex(colorHex);
    R.gateGroup.visible = true;
  }

  // Position the active gate on checkpoint idx and the faint preview
  // on idx + 1 (hidden at the final gate, where only the finish counts).
  function showGatePair(idx) {
    var pts = R.route.checkpoints;
    var cur = pts[idx];
    if (cur) moveGateTo(cur[0], cur[1], R.route.color);
    if (!R.nextGroup) return;
    var nxt = pts[idx + 1];
    if (nxt) {
      var gy = SH.World.groundHeightAt(nxt[0], nxt[1]);
      R.nextGroup.position.set(nxt[0], gy, nxt[1]);
      R.nextBeam.material.color.setHex(R.route.color);
      R.nextRing.material.color.setHex(R.route.color);
      R.nextGroup.visible = true;
    } else {
      R.nextGroup.visible = false;
    }
  }

  function hideGate() {
    if (R.gateGroup) R.gateGroup.visible = false;
    if (R.nextGroup) R.nextGroup.visible = false;
    if (R.arrow) R.arrow.visible = false;
  }

  // Pulse every start pillar on a shared clock; the offered route's
  // pillar breathes faster so it stands out from the other three.
  function pulseMarkers(t) {
    for (var i = 0; i < R.markers.length; i++) {
      var m = R.markers[i];
      var hot = (R.phase === 'offered' && R.offeredRoute === m.route) ||
                (R.route === m.route && R.phase !== 'idle');
      var speed = hot ? 5.2 : 2.1;
      var pulse = 0.5 + 0.5 * Math.sin(t * speed + m.phase);
      m.beam.material.opacity = 0.13 + 0.16 * pulse + (hot ? 0.10 : 0);
      m.ring.material.opacity = 0.45 + 0.4 * pulse;
      var s = 1 + 0.07 * Math.sin(t * speed + m.phase);
      m.group.scale.set(s, 1, s);
    }
    if (R.gateGroup && R.gateGroup.visible) {
      var gp = 0.5 + 0.5 * Math.sin(t * 6.0);
      R.gate.material.opacity = 0.22 + 0.18 * gp;
      R.gateRing.material.opacity = 0.6 + 0.4 * gp;
    }
  }

  // ---------------------------------------------------------------------
  // Offers: standing in a start pillar with a car, engine on, no race
  // running. The invitation is spoken once per approach; leaving the
  // pillar (or the car) re-arms it.
  // ---------------------------------------------------------------------

  function focusPos() {
    var st = SH.State;
    return st.driving ? st.vehiclePos : st.player;
  }

  function checkOffers(dt) {
    if (R.offerCooldown > 0) R.offerCooldown -= dt;
    var st = SH.State;
    if (!st.driving) { R.offeredRoute = null; return; }
    var f = st.vehiclePos;
    var near = null;
    for (var i = 0; i < ROUTES.length; i++) {
      var s = ROUTES[i].checkpoints[0];
      if (dist2(f.x, f.z, s[0], s[1]) < OFFER_RADIUS * OFFER_RADIUS) { near = ROUTES[i]; break; }
    }
    if (!near) { R.offeredRoute = null; return; }
    if (R.offeredRoute !== near) {
      // Blasting through the pillar at speed earns no invitation —
      // brake to a near-stop inside the light and the marshal talks.
      var rollSpeed = st.vehicle ? Math.abs(st.vehicle.speed) : 0;
      if (rollSpeed > 6) return;
      R.offeredRoute = near;
      if (R.offerCooldown <= 0) {
        var best = store.best[near.id];
        notify('ENTER — ' + near.name + '  ·  prize $' + near.prize +
               '  ·  par ' + formatTime(near.parTime) +
               (best ? '  ·  your best ' + formatTime(best) : ''));
        say(near.invite);
        R.offerCooldown = 4;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Countdown and the start. The rival is placed on a parallel grid
  // slot beside the route's first gate when the countdown begins, so
  // both cars launch at the same line.
  // ---------------------------------------------------------------------

  function beginCountdown() {
    var route = R.offeredRoute;
    if (!route) return;
    var st = SH.State;
    var scene = SH.Main.getScene();
    R.route = route;
    R.phase = 'countdown';
    R.countdownT = 3.4;
    R.countdownStep = -1;
    R.elapsed = 0;
    R.playerIdx = 0;
    R.rivalIdx = 0;
    R.rivalTime = null;
    R.footT = 0;
    R.hintT = 0;
    // Grid slot: four metres to the right of the start gate, facing
    // along the first leg so the launch is a drag, not a demolition.
    var a = route.checkpoints[0], b = route.checkpoints[1];
    var hx = b[0] - a[0], hz = b[1] - a[1];
    var hl = Math.hypot(hx, hz) || 1;
    hx /= hl; hz /= hl;
    var px = -hz, pz = hx; // right-hand perpendicular of the first leg
    var rival = SH.Vehicles.spawnVehicle(
      scene, 'sport', RIVAL_COLOR,
      a[0] + px * 4.2, a[1] + pz * 4.2, Math.atan2(hx, hz)
    );
    rival.driver = 'parked';
    rival.speed = 0;
    R.rival = rival;
    R.rivalCruise = (rival.spec ? rival.spec.maxSpeed : 47) * 0.8;
    R.splits = [];
    R.launchChecked = false;
    R.launchBonus = 0;
    R.sinceGate = 0;
    R.offRouteWarnT = 0;
    showGatePair(0);
    notify(route.name + ' — ' + route.tagline + '. Get ready…');
  }

  function updateCountdown(dt) {
    var st = SH.State;
    // Bailing out mid-countdown (out of the car, car wrecked) cancels
    // the start cleanly: no entry recorded, no rival left behind.
    if (!st.driving || (st.vehicle && st.vehicle.dead)) {
      cancelRace('Start cancelled.');
      return;
    }
    R.countdownT -= dt;
    var stepNow = Math.ceil(R.countdownT);
    if (stepNow !== R.countdownStep && stepNow >= 0) {
      R.countdownStep = stepNow;
      if (stepNow > 0) notify(String(stepNow));
      else notify('GO!');
    }
    if (R.countdownT <= 0) {
      R.phase = 'racing';
      R.elapsed = 0;
      store.stats.entered += 1;
      saveStore();
      notify(R.route.name + ' — GO! Gate 1/' + R.route.checkpoints.length);
    }
  }


  // ---------------------------------------------------------------------
  // The rival driver: waypoint steering in the same heading convention
  // the rest of the game uses (heading = atan2(dx, dz), position
  // integrated with sin/cos, then the shared world collision + mesh
  // sync). Cruise is capped at 80% of the car's spec top speed; the
  // cap breathes a few percent with the checkpoint gap so a race stays
  // a race — a runaway leader gets reeled in, a runaway trailer too.
  // ---------------------------------------------------------------------

  function steerRival(dt) {
    var car = R.rival;
    if (!car) return;
    var pts = R.route.checkpoints;
    if (R.rivalTime != null) {
      // Already home: roll to a stop and stay out of the player's way.
      car.speed = Math.max(0, car.speed - 16 * dt);
      car.x += Math.sin(car.heading) * car.speed * dt;
      car.z += Math.cos(car.heading) * car.speed * dt;
      SH.Vehicles.collideWorld(car, dt);
      SH.Vehicles.syncMesh(car);
      return;
    }
    var tp = pts[R.rivalIdx];
    var dx = tp[0] - car.x, dz = tp[1] - car.z;
    var dist = Math.hypot(dx, dz);
    if (dist < 9) {
      R.rivalIdx += 1;
      if (R.rivalIdx >= pts.length) {
        R.rivalTime = R.elapsed;
        return;
      }
      tp = pts[R.rivalIdx];
      dx = tp[0] - car.x; dz = tp[1] - car.z;
      dist = Math.hypot(dx, dz);
    }
    var desired = Math.atan2(dx, dz);
    var diff = wrapAngle(desired - car.heading);
    var turnRate = car.spec && car.spec.turn ? car.spec.turn : 2.0;
    car.heading += clamp(diff, -turnRate * dt, turnRate * dt);
    // Rubber band on checkpoint progress, never on raw distance: a
    // driver a full gate ahead lends the chaser up to +8% cruise.
    var gap = R.playerIdx - R.rivalIdx;
    var band = 1 + clamp(gap * 0.025, -0.06, 0.08);
    var cruise = R.rivalCruise * band;
    var target = cruise * (1 - Math.min(0.55, Math.abs(diff) * 0.38));
    if (dist < 15) target = Math.min(target, cruise * 0.72);
    if (car.speed < target) car.speed = Math.min(target, car.speed + 8.5 * dt);
    else car.speed = Math.max(target, car.speed - 20 * dt);
    car.x += Math.sin(car.heading) * car.speed * dt;
    car.z += Math.cos(car.heading) * car.speed * dt;
    SH.Vehicles.collideWorld(car, dt);
    SH.Vehicles.syncMesh(car);
  }

  // ---------------------------------------------------------------------
  // Racing: gate captures for the player, periodic direction hints,
  // abandonment rules, and the finish.
  // ---------------------------------------------------------------------

  function playerProgressText() {
    return 'Gate ' + Math.min(R.playerIdx + 1, R.route.checkpoints.length) +
           '/' + R.route.checkpoints.length;
  }

  function updateRacing(dt) {
    var st = SH.State;
    var route = R.route;
    var pts = route.checkpoints;
    R.elapsed += dt;

    steerRival(dt);

    // Perfect launch, judged once in the first second after GO: a car
    // already pulling hard at the one-second mark earned its bonus.
    if (!R.launchChecked && R.elapsed > 0.9) {
      R.launchChecked = true;
      if (st.driving && st.vehicle && Math.abs(st.vehicle.speed) > 9) {
        R.launchBonus = 50;
        notify('Clean launch! +$50 style bonus rides on the purse.');
      }
    }

    // Abandonment: a wrecked car ends it at once; going on foot starts
    // a grace clock (a spin-out you run back to is forgiven, a hike is
    // not). Either way the rival is released back to the street.
    if (st.vehicle && st.vehicle.dead && st.driving) {
      endRace(false, 'Your car is wrecked — race over.');
      return;
    }
    if (!st.driving) {
      R.footT += dt;
      if (R.footT > FOOT_LIMIT) {
        endRace(false, 'Race abandoned — you left the car too long.');
        return;
      }
    } else {
      R.footT = 0;
    }

    // Hard time cap: past par * 2.4 + a minute the purse is gone.
    if (R.elapsed > route.parTime * 2.4 + 60) {
      endRace(false, 'Out of time — the grid has gone home.');
      return;
    }

    if (st.driving) {
      var f = st.vehiclePos;
      var tp = pts[R.playerIdx];
      R.sinceGate += dt;
      if (dist2(f.x, f.z, tp[0], tp[1]) < GATE_RADIUS * GATE_RADIUS) {
        var passedIdx = R.playerIdx;
        R.splits[passedIdx] = R.elapsed;
        R.sinceGate = 0;
        R.playerIdx += 1;
        if (R.playerIdx >= pts.length) {
          finishRace();
          return;
        }
        showGatePair(R.playerIdx);
        // Split delta against the best run's time at this same gate:
        // negative is faster, and chasing your own ghost is the whole
        // point of keeping splits at all.
        var deltaText = '';
        var bestSplits = store.bestSplits[route.id];
        if (bestSplits && Number.isFinite(bestSplits[passedIdx])) {
          var delta = R.elapsed - bestSplits[passedIdx];
          var sign = delta <= 0 ? '-' : '+';
          deltaText = ' · split ' + sign + Math.abs(delta).toFixed(1) + 's vs best';
        }
        notify(playerProgressText() + ' — ' + formatTime(R.elapsed) + deltaText +
               (R.rivalTime != null ? ' · rival home in ' + formatTime(R.rivalTime) : ''));
      } else if (R.sinceGate > 25) {
        // Off-route watch: no gate for 25 s means the line is lost.
        // Warn on a slow cadence, pointing back at the live pillar.
        R.offRouteWarnT -= dt;
        if (R.offRouteWarnT <= 0) {
          R.offRouteWarnT = 10;
          var og = pts[R.playerIdx];
          var od = Math.round(Math.hypot(og[0] - f.x, og[1] - f.z));
          notify('Off route — gate is ' + od + ' m ' + compass(og[0] - f.x, og[1] - f.z) +
                 '. Follow the bright pillar.');
        }
      }
      // Direction hint every few seconds: compass + distance + the
      // running story of the duel, in one short line.
      R.hintT -= dt;
      if (R.hintT <= 0) {
        R.hintT = 3;
        var ct = pts[R.playerIdx];
        var dx = ct[0] - f.x, dz = ct[1] - f.z;
        var d = Math.round(Math.hypot(dx, dz));
        var duel;
        if (R.rivalTime != null) duel = 'rival already home';
        else if (R.playerIdx > R.rivalIdx) duel = 'you lead by ' + (R.playerIdx - R.rivalIdx) + ' gate(s)';
        else if (R.rivalIdx > R.playerIdx) duel = 'rival leads by ' + (R.rivalIdx - R.playerIdx) + ' gate(s)';
        else duel = 'neck and neck';
        notify(playerProgressText() + ' — ' + d + ' m ' + compass(dx, dz) + ' · ' + duel);
      }
      // Aim the 3D arrow from above the player's car at the live gate.
      if (R.arrow) {
        var at = pts[R.playerIdx];
        var ax = at[0] - f.x, az = at[1] - f.z;
        var al = Math.hypot(ax, az) || 1;
        R.arrow.position.set(f.x, SH.World.groundHeightAt(f.x, f.z) + 4.2, f.z);
        R.arrow.setDirection(new THREE.Vector3(ax / al, 0, az / al));
        R.arrow.visible = true;
      }
    }
  }

  function finishRace() {
    var route = R.route;
    var myTime = R.elapsed;
    var won = R.rivalTime == null || myTime <= R.rivalTime;
    var purse = won ? route.prize : Math.round(route.prize * 0.25);
    store.stats.finished += 1;
    if (won) store.stats.won += 1;
    store.stats.earned += purse;
    var recordNote = '';
    var previousBest = store.best[route.id];
    if (!previousBest || myTime < previousBest) {
      store.best[route.id] = myTime;
      // The splits of a record run become the ghost every future run
      // on this route is measured against, gate by gate.
      store.bestSplits[route.id] = R.splits.slice();
      recordNote = ' New record!';
    } else {
      // No record: still show the gap to your own ghost at the line.
      recordNote = ' · your best ' + formatTime(previousBest) +
        ' (+' + (myTime - previousBest).toFixed(1) + 's)';
    }
    // Street League: points for every finish, more for a win — and a
    // Grand Slam bonus whenever the current win set covers all four
    // routes. The set then clears, so the Slam can be earned again.
    store.league.points += won ? 10 : 4;
    var slamNote = '';
    if (won) {
      store.routeWins[route.id] = (store.routeWins[route.id] || 0) + 1;
      var allWon = true;
      for (var ri = 0; ri < ROUTES.length; ri++) {
        if (!store.routeWins[ROUTES[ri].id]) { allWon = false; break; }
      }
      if (allWon) {
        store.league.grandSlams += 1;
        store.routeWins = {};
        slamNote = ' GRAND SLAM — all four routes won! +$2,500 league bonus.';
      }
    }
    purse += R.launchBonus || 0;
    saveStore();
    if (slamNote && SH.Economy) SH.Economy.addCash(2500);
    if (SH.Economy) SH.Economy.addCash(purse);
    if (won) {
      notify('FINISH — 1st! ' + formatTime(myTime) + ' · +$' + purse + recordNote + slamNote);
      say([
        ['Bang Jaka', 'Home first in ' + formatTime(myTime) + '. The purse is yours, Raka.', 3.2],
        ['Raka', 'Same time next week.', 2.0]
      ]);
    } else {
      notify('FINISH — 2nd. ' + formatTime(myTime) + ' · rival ' + formatTime(R.rivalTime) + ' · +$' + purse);
      say([
        ['Bang Jaka', 'The GT got there first. Quarter purse for the show — run it again.', 3.2]
      ]);
    }
    cleanupRace();
  }

  // Shared teardown for finishes, abandonments and cancellations: the
  // gate and arrow hide, the rival is left parked where it stands (it
  // is a normal street car once we stop steering it).
  function cleanupRace() {
    hideGate();
    if (R.rival) { R.rival.driver = 'parked'; R.rival.speed = 0; }
    R.rival = null;
    R.route = null;
    R.phase = 'idle';
    R.offeredRoute = null;
    R.offerCooldown = 2.5;
  }

  function endRace(counted, message) {
    if (message) notify(message);
    cleanupRace();
  }

  function cancelRace(message) {
    if (message) notify(message);
    // A cancelled start never spawned a result; the rival, if placed,
    // is simply parked at the grid slot it was given.
    cleanupRace();
  }

  // ---------------------------------------------------------------------
  // Frame entry + wiring.
  // ---------------------------------------------------------------------

  // Exactly one route line is ever lit: the offered route while the
  // player is deciding, or the live route from countdown to teardown.
  function refreshRouteLines() {
    var lit = null;
    if (R.phase === 'idle') lit = R.offeredRoute;
    else if (R.route) lit = R.route;
    for (var i = 0; i < R.lines.length; i++) {
      R.lines[i].line.visible = (R.lines[i].route === lit);
    }
  }

  function update(dt) {
    if (!R.built) { if (!buildMarkers()) return; }
    var st = SH.State;
    if (st.mode !== 'playing') { R.enterPressed = false; return; }
    pulseMarkers(st.time || 0);
    if (R.phase === 'idle') {
      checkOffers(dt);
      if (R.enterPressed && R.offeredRoute && st.driving) beginCountdown();
    } else if (R.phase === 'offered') {
      R.phase = 'idle'; // offers are evaluated inside 'idle'; never rest here
    } else if (R.phase === 'countdown') {
      updateCountdown(dt);
    } else if (R.phase === 'racing') {
      updateRacing(dt);
    }
    refreshRouteLines();
    R.enterPressed = false;
  }

  function init() {
    loadStore();
    window.addEventListener('keydown', function (e) {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') R.enterPressed = true;
    });
    buildMarkers();
  }

  SH.Races = {
    init: init,
    update: update,
    routes: ROUTES,
    active: function () { return R.phase === 'racing' || R.phase === 'countdown'; },
    offered: function () { return R.phase === 'idle' ? R.offeredRoute : null; },
    // Input lock is advisory only: it records that the countdown is
    // running so other systems may honour it; input.js is untouched.
    inputLocked: function () { return R.phase === 'countdown'; },
    stats: function () { return store.stats; },
    league: function () { return store.league; },
    bestTime: function (routeId) { return store.best[routeId] || null; }
  };
})(window.SH = window.SH || {});
