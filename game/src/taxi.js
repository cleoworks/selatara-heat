// SELATARA HEAT — taxi.js
// "Selatara Cab" — informal taxi work in whatever car you happen to be
// driving. A fare request pings while you drive: a pedestrian is waiting
// at a street corner somewhere in the city. Pick them up, drive them to
// their destination district, and get paid a metered fare plus a tip
// that rewards smooth, swift driving and punishes wall-scraping panic.
// Public API: SH.Taxi { init(), update(dt) }.
// Persistence: private key 'selatara-heat-taxi-v1' (stats only — an
// active fare is never saved; quitting mid-fare simply drops it).
(function (SH) {
  'use strict';

  var KEY = 'selatara-heat-taxi-v1';

  // ------------------------------------------------------------------
  // Data: pickup corners. Every point sits on the avenue/street grid
  // from SH.Config.world so a waiting passenger is always reachable by
  // road, and each carries the district it belongs to for flavour.
  // ------------------------------------------------------------------
  var CORNERS = [
    { x: -360, z: 60,   district: 'RUKO SENJA' },
    { x: -240, z: -60,  district: 'PELITA HEIGHTS' },
    { x: -120, z: 180,  district: 'TAMAN ARUS' },
    { x: 0,    z: -180, district: 'PELITA HEIGHTS' },
    { x: 120,  z: 60,   district: 'TAMAN ARUS' },
    { x: 240,  z: 180,  district: 'PELABUHAN KARAT' },
    { x: 360,  z: -60,  district: 'BUKIT MAWAR' },
    { x: -480, z: -180, district: 'RUKO SENJA' },
    { x: 480,  z: 60,   district: 'PELABUHAN KARAT' },
    { x: -120, z: -300, district: 'PELITA HEIGHTS' },
    { x: 240,  z: -300, district: 'BUKIT MAWAR' },
    { x: 0,    z: 228,  district: 'PANTAI KENCANA' },
    { x: -240, z: 60,   district: 'RUKO SENJA' },
    { x: 120,  z: -420, district: 'PELITA HEIGHTS' }
  ];

  // Destinations are district anchors (a corner inside the district the
  // passenger asks for). The pillar is planted at the anchor itself.
  var DESTINATIONS = [
    { x: -360, z: -180, district: 'RUKO SENJA' },
    { x: -120, z: -60,  district: 'PELITA HEIGHTS' },
    { x: 360,  z: -180, district: 'BUKIT MAWAR' },
    { x: 360,  z: 120,  district: 'PELABUHAN KARAT' },
    { x: 60,   z: 120,  district: 'TAMAN ARUS' },
    { x: -240, z: 228,  district: 'PANTAI KENCANA' },
    { x: 120,  z: -300, district: 'PELITA HEIGHTS' },
    { x: -480, z: 120,  district: 'RUKO SENJA' },
    { x: 480,  z: 180,  district: 'PELABUHAN KARAT' },
    { x: 240,  z: -120, district: 'BUKIT MAWAR' },
    { x: -360, z: -300, district: 'RUKO SENJA' },
    { x: 360,  z: 228,  district: 'PANTAI KENCANA' }
  ];

  // ------------------------------------------------------------------
  // Data: the passenger roster. Ten regulars of the strait city, each
  // with a home district, a destination preference, and their own
  // small-talk: a greeting on pickup, a halfway remark, an arrival
  // line, and a complaint saved for when the driving gets violent.
  // ------------------------------------------------------------------
  var PASSENGERS = [
    {
      name: 'Bu Tini', from: 'RUKO SENJA', wants: 'PANTAI KENCANA',
      greet: 'Bu Tini: Mind the sambal crate, nak. It has survived worse drivers than you.',
      half: 'Bu Tini: My warung opens at five tomorrow. The fish do not wait, and neither do I.',
      arrive: 'Bu Tini: Smooth enough. The sambal lives. So do we.',
      panic: 'Bu Tini: ASTAGA. The crate! Drive like the road is borrowed!'
    },
    {
      name: 'Pak Haji Umar', from: 'PELITA HEIGHTS', wants: 'RUKO SENJA',
      greet: 'Pak Haji Umar: To the mosque supplies shop, please. Slowly is also a kind of fast.',
      half: 'Pak Haji Umar: I have crossed this strait by boat more times than you have had birthdays.',
      arrive: 'Pak Haji Umar: Barakallah. A calm ride is a blessing with wheels.',
      panic: 'Pak Haji Umar: Young man. The angels are taking notes.'
    },
    {
      name: 'Dewi', from: 'TAMAN ARUS', wants: 'BUKIT MAWAR',
      greet: 'Dewi: Flower market run! If we are late the roses go to the hotel people.',
      half: 'Dewi: I sell roses to couples who met at my stall. Very efficient romance.',
      arrive: 'Dewi: The roses survived! You drive like you water plants. Carefully.',
      panic: 'Dewi: THE ROSES. That bump just cost somebody an anniversary!'
    },
    {
      name: 'Bang Jali', from: 'PELABUHAN KARAT', wants: 'PELITA HEIGHTS',
      greet: 'Bang Jali: Dock shift ended, feet are dead. Wake me if we crash. Kidding. Mostly.',
      half: 'Bang Jali: Twenty years loading ships. My back has its own weather forecast now.',
      arrive: 'Bang Jali: Home. My hammock has been gossiping about me all day.',
      panic: 'Bang Jali: OI. I load containers, I am not trying to become cargo!'
    },
    {
      name: 'Sari', from: 'PANTAI KENCANA', wants: 'TAMAN ARUS',
      greet: 'Sari: Surf club meeting at the park. Yes, the board is strapped. No, it is not a wing.',
      half: 'Sari: The strait was glass this morning. Should have seen it.',
      arrive: 'Sari: Perfect timing. First agenda item: who lost the good wax. It was me.',
      panic: 'Sari: If my board flies off I am rating this ride one star in three languages!'
    },
    {
      name: 'Ko Ahin', from: 'RUKO SENJA', wants: 'PELABUHAN KARAT',
      greet: 'Ko Ahin: Spare parts for a fishing boat. The harbour, and please, no scenic route.',
      half: 'Ko Ahin: My shop has sold the same wrench since 1998. It keeps coming back. Like family.',
      arrive: 'Ko Ahin: On time. The boat owner owes me money and now also gratitude.',
      panic: 'Ko Ahin: That sound was expensive. I sell parts, I would know!'
    },
    {
      name: 'Mbak Rara', from: 'BUKIT MAWAR', wants: 'PANTAI KENCANA',
      greet: 'Mbak Rara: Beach photoshoot at golden hour. The light waits for nobody, driver.',
      half: 'Mbak Rara: Hold still later, I will take your portrait. Brooding cab driver series.',
      arrive: 'Mbak Rara: Golden hour caught. You are officially part of the shoot now.',
      panic: 'Mbak Rara: My camera bag just filed a complaint with my ribs!'
    },
    {
      name: 'Pak Dullah', from: 'PELABUHAN KARAT', wants: 'BUKIT MAWAR',
      greet: 'Pak Dullah: Visiting my sister uphill. She cooks like the warung fears her.',
      half: 'Pak Dullah: Bring a man flowers once and he is family forever. City rules.',
      arrive: 'Pak Dullah: Smell that? Dinner. You should have been a chef, not a driver. Kidding.',
      panic: 'Pak Dullah: My sister will hear about this dent before I arrive!'
    },
    {
      name: 'Nia', from: 'PELITA HEIGHTS', wants: 'TAMAN ARUS',
      greet: 'Nia: Night class at the park hall. If I am late the lecturer starts without mercy.',
      half: 'Nia: Studying accounting. Somebody in this family must understand money.',
      arrive: 'Nia: Made it. If I pass this exam, this ride is in the acknowledgements.',
      panic: 'Nia: My GPA just felt that. My GPA, driver!'
    },
    {
      name: 'Om Ferry', from: 'PANTAI KENCANA', wants: 'RUKO SENJA',
      greet: 'Om Ferry: Off to argue with a landlord in Senja. A professional visit.',
      half: 'Om Ferry: I have rented the same kiosk for fifteen years. The landlord fears my folder.',
      arrive: 'Om Ferry: Good. Save your strength, driver. I may need a getaway after the meeting.',
      panic: 'Om Ferry: Careful! My folder of documents is not insured for THIS!'
    },
    {
      name: 'Cici', from: 'TAMAN ARUS', wants: 'PELITA HEIGHTS',
      greet: 'Cici: Violin lesson. The case is worth more than this car, no offence to the car.',
      half: 'Cici: I practise scales while we drive. Mentally. You are welcome.',
      arrive: 'Cici: The violin lives! My teacher will never believe the transport budget.',
      panic: 'Cici: THE VIOLIN. That screech was not music, driver!'
    },
    {
      name: 'Pak RT Salim', from: 'BUKIT MAWAR', wants: 'RUKO SENJA',
      greet: 'Pak RT Salim: Neighbourhood meeting in Senja. I chair it. The chairing is the hard part.',
      half: 'Pak RT Salim: On my street I know every pothole by name. This one is Budi. That one is also Budi.',
      arrive: 'Pak RT Salim: Arrived with dignity intact. The meeting can begin gossiping.',
      panic: 'Pak RT Salim: I will raise this driving at the meeting. With minutes. OFFICIAL minutes!'
    },
    {
      name: 'Yoga', from: 'PELITA HEIGHTS', wants: 'PANTAI KENCANA',
      greet: 'Yoga: Sunrise shift at the beach cafe. Ironic name, I know. My parents planned it.',
      half: 'Yoga: I make forty coffees an hour at dawn. The sunrise is just my first customer.',
      arrive: 'Yoga: Before sunrise. The beans will think I live here. I basically do.',
      panic: 'Yoga: My chakras are usually aligned. Usually. That kerb disagreed!'
    },
    {
      name: 'Tante Lilis', from: 'PANTAI KENCANA', wants: 'BUKIT MAWAR',
      greet: 'Tante Lilis: To my niece uphill. I bring cake and unsolicited advice, both heavy.',
      half: 'Tante Lilis: You drive well, nak. My nephew drives like the road owes him money.',
      arrive: 'Tante Lilis: The cake survived! My niece gets cake AND advice. Lucky girl.',
      panic: 'Tante Lilis: THE CAKE. If it is flat I will say YOU sat on it!'
    }
  ];

  // Generic driver-blame lines, rotated in with the passenger's own
  // panic line so a rough ride does not repeat the same shout forever.
  var BLAME_LINES = [
    'The passenger grabs the door handle like it owes them money.',
    'From the back seat: a noise that is half prayer, half review.',
    'Your passenger is now holding the headrest with both hands.',
    'A small voice from behind: "I have a family. And a fence. Both are worried."',
    'The passenger quietly puts on a second seatbelt. There is no second seatbelt.'
  ];

  // Dispatch chatter: the cab radio mutters through long rides so the
  // city feels staffed. Pure ambience — one line every so often, never
  // during the first or last seconds of a fare.
  var CHATTER = [
    'Dispatch: Unit 7, the Karat bridge is clear. The gulls send regards.',
    'Dispatch: Whoever parked on Senja corner — the whole street says thanks. Sarcastically.',
    'Dispatch: Ferry dock reports a queue. Somebody take the long way and look heroic.',
    'Dispatch: Reminder — the night meter is not a myth. Charge it with pride.',
    'Dispatch: A driver just got a five-star tip in a written poem. Standards are rising.',
    'Dispatch: Rain over the strait in an hour, maybe. The sky is doing its thinking face.',
    'Dispatch: Unit 3 found a wallet, returned it, got soup. Honesty pays in soup.',
    'Dispatch: Keep the change stories coming. The office wall of fame has space.'
  ];

  // The six destination districts of the city tour. Serve all six and
  // the set pays a bonus and resets — a quiet long-term route goal
  // hiding inside the everyday fares.
  var TOUR_DISTRICTS = ['RUKO SENJA', 'PELITA HEIGHTS', 'BUKIT MAWAR', 'PELABUHAN KARAT', 'TAMAN ARUS', 'PANTAI KENCANA'];
  var TOUR_BONUS = 400;

  // Things passengers leave behind. All returnable, all returned.
  var LOST_ITEMS = [
    'a wallet with exactly one photo in it',
    'a violin rosin tin',
    'a folder of very serious documents',
    'a cake box, mercifully unopened',
    'a phone charger and half a love letter',
    'a house key tied to a tiny brass fish'
  ];

  // Driver levels: the roster of regulars grows, dispatch trusts you
  // with the pink pillars, and tips quietly fatten. Levels are read
  // off the lifetime fare count, so they can never be lost.
  var LEVELS = [
    { at: 0, title: 'Corner Rookie', tipBonus: 0 },
    { at: 8, title: 'Strait Regular', tipBonus: 0.02 },
    { at: 20, title: 'Dispatch Favourite', tipBonus: 0.04 },
    { at: 40, title: 'Selatara Cab Captain', tipBonus: 0.06 },
    { at: 75, title: 'The Driver They Ask For By Name', tipBonus: 0.09 }
  ];

  function levelNow() {
    var lv = LEVELS[0];
    for (var i = 0; i < LEVELS.length; i++) {
      if (stats.fares >= LEVELS[i].at) lv = LEVELS[i];
    }
    return lv;
  }

  // Stopover flavour: who is being collected, and what they carry.
  var STOPOVER_PEOPLE = [
    { who: 'my cousin', cargo: 'two durians and a folding chair' },
    { who: 'my grandmother', cargo: 'a handbag that weighs like luggage' },
    { who: 'the neighbour kid', cargo: 'a school project shaped like the ferry' },
    { who: 'my business partner', cargo: 'a ledger and strong opinions' },
    { who: 'my sister', cargo: 'a potted plant named Kevin' },
    { who: 'my old teacher', cargo: 'a stack of marked essays and one red pen' },
    { who: 'the drummer', cargo: 'a cymbal in a pillowcase, for safety' }
  ];
  var STOPOVER_FEE = 15;

  // Fare tuning: flagfall plus a per-metre rate on the odometer, tips
  // as a percentage of the meter, and a swift bonus for beating par.
  var FARE = {
    base: 25,            // flagfall, dollars
    perMeter: 0.085,     // dollars per metre actually driven
    offerEveryMin: 14,   // min seconds between fare offers while driving
    offerEveryMax: 30,   // max seconds between fare offers while driving
    offerExpire: 50,     // seconds to reach the pickup before it expires
    pickupRadius: 6,     // metres: stop inside this to collect the fare
    dropRadius: 7,       // metres: stop inside this to finish the ride
    stopSpeed: 1.2,      // m/s: below this counts as "stopped"
    boardWait: 0.8,      // seconds stopped at pickup before they climb in
    footCancel: 8,       // seconds on foot before the fare gives up
    panicWanted: 3,      // wanted level at which passengers bail out
    parSpeed: 10.5,      // m/s: par pace for the swift bonus
    parSlack: 30,        // seconds of slack added to par
    swiftBonus: 0.20,    // +20% of meter when under par
    tipPerfect: 0.30,    // tip % with zero hard hits
    tipOneHit: 0.15,     // tip % with exactly one hard hit
    tipTwoHits: 0.05,    // tip % with two hard hits; three or more: no tip
    hitSpeedDrop: 6.5,   // m/s lost in one step that counts as a hard hit
    hitMinSpeed: 9       // only count drops that start above this speed
  };

  // ------------------------------------------------------------------
  // Persistent stats (private key; the main save file is untouched).
  // ------------------------------------------------------------------
  var stats = {
    fares: 0,          // completed rides
    earned: 0,         // lifetime dollars from fares + tips
    bestTip: 0,        // largest single tip in dollars
    perfect: 0,        // rides with zero hard hits
    cancelled: 0,      // fares lost to expiry, panic or abandonment
    rushDone: 0,       // rush fares beaten against their tighter par
    tours: 0,          // completed city-tour sets (all six districts)
    served: [],        // districts served in the current tour set
    log: []            // last few completed fares, newest first
  };

  function loadStats() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return;
      if (Number.isFinite(d.fares)) stats.fares = d.fares;
      if (Number.isFinite(d.earned)) stats.earned = d.earned;
      if (Number.isFinite(d.bestTip)) stats.bestTip = d.bestTip;
      if (Number.isFinite(d.perfect)) stats.perfect = d.perfect;
      if (Number.isFinite(d.cancelled)) stats.cancelled = d.cancelled;
      if (Number.isFinite(d.rushDone)) stats.rushDone = d.rushDone;
      if (Number.isFinite(d.tours)) stats.tours = d.tours;
      if (Array.isArray(d.served)) {
        for (var s = 0; s < d.served.length; s++) {
          if (TOUR_DISTRICTS.indexOf(d.served[s]) >= 0 && stats.served.indexOf(d.served[s]) < 0) {
            stats.served.push(d.served[s]);
          }
        }
      }
      if (Array.isArray(d.log)) {
        for (var i = 0; i < d.log.length && i < 6; i++) {
          var e = d.log[i];
          if (e && typeof e.who === 'string' && Number.isFinite(e.total)) {
            stats.log.push({ who: e.who, to: String(e.to || ''), total: e.total, tip: Number.isFinite(e.tip) ? e.tip : 0 });
          }
        }
      }
    } catch (e) { /* storage unavailable: run session-only */ }
  }

  var saveTimer = 0;
  function saveStats() {
    try { window.localStorage.setItem(KEY, JSON.stringify(stats)); } catch (e) { /* ignore */ }
  }
  function saveStatsSoon() { saveTimer = Math.min(saveTimer, 0.01); if (saveTimer <= 0) saveTimer = 4; }

  // ------------------------------------------------------------------
  // Small helpers shared by the whole module.
  // ------------------------------------------------------------------
  function notify(text) { if (SH.HUD && SH.HUD.notify) SH.HUD.notify(text); }
  function setPrompt(text) { if (SH.HUD && SH.HUD.setPrompt) SH.HUD.setPrompt(text); }
  function focusPos() {
    var st = SH.State;
    return st.driving && st.vehiclePos ? st.vehiclePos : st.player;
  }
  function dist2d(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function groundY(x, z) {
    var y = 0;
    if (SH.World && SH.World.groundHeightAt) y = SH.World.groundHeightAt(x, z);
    return Number.isFinite(y) ? y : 0;
  }
  function fmtMoney(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // A light pillar marker in the house style of the other systems: a
  // translucent cylinder with a ground ring, gently pulsing. Built per
  // fare and disposed when the fare ends — nothing leaks into the scene.
  function makePillar(x, z, color) {
    var scene = SH.Main && SH.Main.getScene ? SH.Main.getScene() : null;
    if (!scene || typeof THREE === 'undefined') return null;
    var y = groundY(x, z);
    var group = new THREE.Group();
    var geo = new THREE.CylinderGeometry(1.7, 1.7, 16, 20, 1, true);
    var mat = new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: 0.32,
      side: THREE.DoubleSide, depthWrite: false
    });
    var beam = new THREE.Mesh(geo, mat);
    beam.position.y = 8;
    group.add(beam);
    var ringGeo = new THREE.RingGeometry(1.9, 2.6, 28);
    var ringMat = new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: 0.75,
      side: THREE.DoubleSide, depthWrite: false
    });
    var ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    group.add(ring);
    group.position.set(x, y, z);
    scene.add(group);
    return { group: group, mat: mat, ringMat: ringMat, x: x, z: z, t: Math.random() * 6 };
  }

  function disposePillar(p) {
    if (!p) return;
    var scene = SH.Main && SH.Main.getScene ? SH.Main.getScene() : null;
    if (scene) scene.remove(p.group);
    p.group.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  function pulsePillar(p, dt) {
    if (!p) return;
    p.t += dt;
    var s = 0.30 + 0.10 * (0.5 + 0.5 * Math.sin(p.t * 3.2));
    p.mat.opacity = s;
    p.ringMat.opacity = 0.55 + 0.30 * (0.5 + 0.5 * Math.sin(p.t * 3.2 + 1.1));
  }

  // ------------------------------------------------------------------
  // Fare state machine.
  //   idle    — no fare; a timer counts down to the next offer
  //   pickup  — passenger waiting at the corner pillar
  //   riding  — passenger aboard; destination pillar is live
  // ------------------------------------------------------------------
  var S = {
    phase: 'idle',
    offerIn: 6,          // first offer comes quickly so players find it
    passenger: null,
    pickup: null,        // {x,z,district}
    dest: null,          // {x,z,district}
    marker: null,        // live pillar (pickup or destination)
    expireT: 0,          // countdown while heading to the pickup
    boardT: 0,           // stopped-at-pickup boarding timer
    footT: 0,            // seconds spent on foot mid-fare
    rideT: 0,            // seconds since pickup
    odo: 0,              // odometer metres since pickup
    routeDist: 0,        // straight-line pickup→destination distance
    parT: 0,             // par time for the swift bonus
    hardHits: 0,         // collision spikes this ride
    lastSpeed: 0,        // previous step speed for spike detection
    lastX: 0, lastZ: 0,  // previous focus position for the odometer
    halfSaid: false,     // halfway small-talk already delivered
    promptT: 0,          // throttle for the riding HUD line refresh
    meterShown: 0,       // last meter value pushed to the HUD line
    rush: false,         // this fare is a rush fare (tighter par, richer swift bonus)
    blameIdx: 0,         // rotation cursor into BLAME_LINES
    chatterT: 0,         // seconds to the next dispatch chatter line
    chatterIdx: 0,       // rotation cursor into CHATTER
    kindness: false,     // a returned lost item sweetens the next tip
    stopover: null,      // {x,z,district,who,cargo} mid-ride waypoint, or null
    stopDwell: 0,        // seconds stopped at the stopover pillar
    stopDone: false      // the stopover was served on this ride
  };

  function clearFare(countCancelled) {
    if (S.marker) { disposePillar(S.marker); S.marker = null; }
    if (countCancelled && (S.phase === 'pickup' || S.phase === 'riding')) {
      stats.cancelled++;
      saveStatsSoon();
    }
    S.phase = 'idle';
    S.passenger = null;
    S.pickup = null;
    S.dest = null;
    S.rush = false;
    S.expireT = 0;
    S.boardT = 0;
    S.footT = 0;
    S.stopover = null;
    S.stopDwell = 0;
    S.stopDone = false;
    S.offerIn = FARE.offerEveryMin + Math.random() * (FARE.offerEveryMax - FARE.offerEveryMin);
    setPrompt(null);
  }

  function startOffer() {
    var st = SH.State;
    var f = focusPos();
    // Choose a corner that is a real drive away but not across the map.
    var options = [];
    for (var i = 0; i < CORNERS.length; i++) {
      var d = dist2d(f.x, f.z, CORNERS[i].x, CORNERS[i].z);
      if (d > 55 && d < 300) options.push(CORNERS[i]);
    }
    if (!options.length) options = CORNERS;
    var corner = pick(options);
    // Passenger: prefer someone whose home district matches the corner,
    // but any regular will do — the city is small and everyone walks.
    var pool = [];
    for (var j = 0; j < PASSENGERS.length; j++) {
      if (PASSENGERS[j].from === corner.district) pool.push(PASSENGERS[j]);
    }
    var passenger = pool.length ? pick(pool) : pick(PASSENGERS);
    // Destination: the district they asked for, never the pickup corner.
    var dest = null;
    for (var k = 0; k < DESTINATIONS.length; k++) {
      if (DESTINATIONS[k].district === passenger.wants) dest = DESTINATIONS[k];
    }
    if (!dest) dest = pick(DESTINATIONS);
    S.passenger = passenger;
    S.pickup = corner;
    S.dest = dest;
    S.phase = 'pickup';
    S.expireT = FARE.offerExpire;
    S.boardT = 0;
    S.footT = 0;
    // Every fourth completed fare turns the next request into a rush
    // fare: the passenger is late for something that matters, par gets
    // tighter, and the swift bonus doubles. Announced up front, always.
    S.rush = (stats.fares % 4 === 3);
    S.marker = makePillar(corner.x, corner.z, S.rush ? 0xff5fa2 : 0xffd23f);
    // A rough quote up front: flagfall plus the straight-line meter,
    // padded the way roads actually wander. Passengers respect a
    // driver who quotes before the wheels turn.
    var quote = Math.round(FARE.base + dist2d(corner.x, corner.z, dest.x, dest.z) * 1.35 * FARE.perMeter);
    if (S.rush) {
      notify('Selatara Cab — RUSH FARE. ' + passenger.name + ' is late and paying for speed. ' +
        corner.district + ' → ' + dest.district + ' (about ' + fmtMoney(quote) + '). Follow the pink pillar, and do not dawdle.');
    } else {
      notify('Selatara Cab — ' + passenger.name + ' is waiting in ' + corner.district +
        ' and wants ' + dest.district + ' (about ' + fmtMoney(quote) + '). Follow the gold pillar.');
    }
  }

  function beginRide() {
    var st = SH.State;
    S.phase = 'riding';
    S.rideT = 0;
    S.odo = 0;
    S.hardHits = 0;
    S.halfSaid = false;
    S.routeDist = dist2d(S.pickup.x, S.pickup.z, S.dest.x, S.dest.z);
    S.parT = S.routeDist / FARE.parSpeed + FARE.parSlack;
    if (S.rush) S.parT *= 0.72; // rush fares run against a crueller clock
    S.chatterT = 18 + Math.random() * 14; // first dispatch mutter, mid-ride
    var f = focusPos();
    S.lastX = f.x; S.lastZ = f.z;
    S.lastSpeed = 0;
    // One fare in four, the passenger remembers a small errand of the
    // heart: collect somebody on the way. The stopover pillar goes up
    // first; the destination pillar waits its turn.
    S.stopover = null;
    S.stopDwell = 0;
    S.stopDone = false;
    if (Math.random() < 0.25) {
      var mid = null, bestD = Infinity;
      for (var i = 0; i < CORNERS.length; i++) {
        var c = CORNERS[i];
        var via = dist2d(S.pickup.x, S.pickup.z, c.x, c.z) + dist2d(c.x, c.z, S.dest.x, S.dest.z);
        var direct = dist2d(S.pickup.x, S.pickup.z, S.dest.x, S.dest.z);
        if (via < direct * 1.45 && via < bestD) { bestD = via; mid = c; }
      }
      if (mid) {
        var person = pick(STOPOVER_PEOPLE);
        S.stopover = { x: mid.x, z: mid.z, district: mid.district, who: person.who, cargo: person.cargo };
      }
    }
    if (S.marker) { disposePillar(S.marker); S.marker = null; }
    if (S.stopover) {
      S.marker = makePillar(S.stopover.x, S.stopover.z, 0xff9f43);
      notify(S.passenger.greet);
      notify('One stop on the way: pick up ' + S.stopover.who + ' in ' + S.stopover.district +
        ' — they travel with ' + S.stopover.cargo + '. (+' + fmtMoney(STOPOVER_FEE) + ' stopover fee)');
    } else {
      S.marker = makePillar(S.dest.x, S.dest.z, 0x37e0ff);
      notify(S.passenger.greet);
    }
    setPrompt(null);
  }

  function finishRide() {
    var st = SH.State;
    // Night surcharge: between 22:00 and 05:00 the meter runs 15%
    // rich. The city is asleep; the cab is not; the price says so.
    var night = (typeof st.hour === 'number') && (st.hour >= 22 || st.hour < 5);
    // Long haul: a route past half a kilometre earns a distance
    // premium on the meter — strait crossings should feel like work.
    var longHaul = S.routeDist >= 500;
    var meter = (FARE.base + S.odo * FARE.perMeter) * (night ? 1.15 : 1) * (longHaul ? 1.10 : 1);
    var tipPct = 0;
    if (S.hardHits === 0) tipPct = FARE.tipPerfect;
    else if (S.hardHits === 1) tipPct = FARE.tipOneHit;
    else if (S.hardHits === 2) tipPct = FARE.tipTwoHits;
    // Kindness credit: returning a lost item earlier makes the whole
    // city tip like it remembers you. Consumed by this fare.
    if (S.kindness) { tipPct += 0.10; S.kindness = false; }
    tipPct += levelNow().tipBonus; // regulars tip regulars
    var tip = meter * tipPct;
    var swift = 0;
    if (S.rideT <= S.parT) {
      swift = meter * FARE.swiftBonus * (S.rush ? 2 : 1);
      if (S.rush) stats.rushDone++;
    }
    var stopFee = S.stopDone ? STOPOVER_FEE : 0;
    var total = Math.round(meter + tip + swift) + stopFee;
    tip = Math.round(tip);
    swift = Math.round(swift);
    if (SH.Economy) SH.Economy.addCash(total);
    stats.fares++;
    stats.earned += total;
    if (tip > stats.bestTip) stats.bestTip = tip;
    if (S.hardHits === 0) stats.perfect++;
    stats.log.unshift({ who: S.passenger.name, to: S.dest.district, total: total, tip: tip });
    if (stats.log.length > 6) stats.log.length = 6;
    // City tour: mark the district served; a full set of six pays
    // the tour bonus and starts a fresh set.
    if (stats.served.indexOf(S.dest.district) < 0) {
      stats.served.push(S.dest.district);
      if (stats.served.length >= TOUR_DISTRICTS.length) {
        stats.served = [];
        stats.tours++;
        if (SH.Economy) SH.Economy.addCash(TOUR_BONUS);
        notify('CITY TOUR COMPLETE — all six districts served. Dispatch adds a ' +
          fmtMoney(TOUR_BONUS) + ' tour bonus. The set resets; the city is big again.');
      } else {
        notify('City tour: ' + stats.served.length + '/6 districts served.');
      }
    }
    // Lost & found: some passengers leave the ride lighter than they
    // boarded. Returning it is automatic, honest, and remembered.
    if (Math.random() < 0.18) {
      var lost = pick(LOST_ITEMS);
      S.kindness = true;
      notify(S.passenger.name + ' left ' + lost + ' in the car. You run it back — ' +
        'the next fare tips like the city remembers kindness.');
    }
    saveStatsSoon();
    notify(S.passenger.arrive);
    var line = 'Fare ' + fmtMoney(meter) + ' • tip ' + fmtMoney(tip);
    if (swift > 0) line += ' • swift bonus ' + fmtMoney(swift);
    if (stopFee > 0) line += ' • stopover ' + fmtMoney(stopFee);
    if (night) line += ' • night meter applied';
    if (longHaul) line += ' • long-haul premium';
    line += ' — total ' + fmtMoney(total) + '.';
    if (S.hardHits === 0) line += ' Flawless driving.';
    else if (S.hardHits >= 3) line += ' The dents came out of the tip.';
    if (S.rush && swift > 0) line += ' Rush fare beaten — the city owes you a nod.';
    notify(line);
    clearFare(false);
  }

  function cancelFare(reason) {
    if (S.passenger) notify(S.passenger.name + ' gives up on this ride — ' + reason);
    else notify('Fare cancelled — ' + reason);
    clearFare(true);
  }

  // ------------------------------------------------------------------
  // Per-phase updates.
  // ------------------------------------------------------------------
  function updateIdle(dt) {
    var st = SH.State;
    if (!st.driving) return; // fares only ping drivers
    S.offerIn -= dt;
    if (S.offerIn <= 0) startOffer();
  }

  function updatePickup(dt) {
    var st = SH.State;
    pulsePillar(S.marker, dt);
    S.expireT -= dt;
    if (S.expireT <= 0) { cancelFare('you took too long.'); return; }
    if (!st.driving) {
      S.footT += dt;
      if (S.footT >= FARE.footCancel) { cancelFare('you wandered off on foot.'); return; }
      setPrompt(S.passenger.name + ' is waiting in ' + S.pickup.district + ' — get a car.');
      return;
    }
    S.footT = 0;
    if (st.vehicle && st.vehicle.dead) { cancelFare('your car is wrecked.'); return; }
    var f = focusPos();
    var d = dist2d(f.x, f.z, S.pickup.x, S.pickup.z);
    var speed = currentSpeed(dt);
    if (d <= FARE.pickupRadius) {
      if (speed <= FARE.stopSpeed) {
        S.boardT += dt;
        setPrompt(S.passenger.name + ' is climbing in…');
        if (S.boardT >= FARE.boardWait) { beginRide(); return; }
      } else {
        S.boardT = 0;
        setPrompt('Stop to pick up ' + S.passenger.name + '.');
      }
    } else {
      S.boardT = 0;
      setPrompt(S.passenger.name + ' — ' + Math.round(d) + ' m • bound for ' + S.dest.district);
    }
  }

  // Speed derived from focus movement: works for every vehicle type
  // without depending on the vehicle object's own fields.
  var _spdX = null, _spdZ = null;
  function currentSpeed(dt) {
    var f = focusPos();
    if (_spdX === null || dt <= 0) { _spdX = f.x; _spdZ = f.z; return 0; }
    var v = dist2d(f.x, f.z, _spdX, _spdZ) / dt;
    _spdX = f.x; _spdZ = f.z;
    return v;
  }

  function updateRiding(dt) {
    var st = SH.State;
    pulsePillar(S.marker, dt);
    S.rideT += dt;
    if (!st.driving) {
      S.footT += dt;
      if (S.footT >= FARE.footCancel) { cancelFare('you left them sitting in the car.'); return; }
      setPrompt(S.passenger.name + ' waits in the car — ' + S.dest.district + ' bound.');
      return;
    }
    S.footT = 0;
    if (st.vehicle && st.vehicle.dead) { cancelFare('the car is wrecked.'); return; }
    if (st.wanted >= FARE.panicWanted) {
      notify(S.passenger.panic);
      cancelFare('too much police attention. Out. NOW.');
      return;
    }
    var f = focusPos();
    // Odometer + collision-spike detection from focus movement.
    var stepDist = dist2d(f.x, f.z, S.lastX, S.lastZ);
    S.odo += stepDist;
    var speed = dt > 0 ? stepDist / dt : 0;
    if (S.lastSpeed > FARE.hitMinSpeed && (S.lastSpeed - speed) > FARE.hitSpeedDrop) {
      S.hardHits++;
      // Alternate the passenger's own shout with the rotating blame
      // lines so a long demolition derby does not loop one sentence.
      if (S.hardHits % 2 === 1) notify(S.passenger.panic);
      else notify(BLAME_LINES[S.blameIdx++ % BLAME_LINES.length]);
    }
    S.lastSpeed = speed;
    S.lastX = f.x; S.lastZ = f.z;
    // Dispatch chatter on long rides, kept out of the opening and
    // closing seconds so it never talks over the passenger.
    if (S.rideT > 12 && dist2d(f.x, f.z, S.dest.x, S.dest.z) > FARE.dropRadius * 3) {
      S.chatterT -= dt;
      if (S.chatterT <= 0) {
        S.chatterT = 26 + Math.random() * 18;
        notify(CHATTER[S.chatterIdx++ % CHATTER.length]);
      }
    }
    // Stopover service: while it is pending, it owns the ride. Stop
    // at the orange pillar, let them load their cargo and opinions,
    // and only then does the destination pillar take over.
    if (S.stopover) {
      var dStop = dist2d(f.x, f.z, S.stopover.x, S.stopover.z);
      if (dStop <= FARE.dropRadius) {
        if (speed <= FARE.stopSpeed) {
          S.stopDwell += dt;
          setPrompt('Loading ' + S.stopover.cargo + '…');
          if (S.stopDwell >= FARE.boardWait) {
            notify('Collected ' + S.stopover.who + ' and ' + S.stopover.cargo +
              '. Onward to ' + S.dest.district + '.');
            S.stopover = null;
            S.stopDone = true;
            if (S.marker) { disposePillar(S.marker); S.marker = null; }
            S.marker = makePillar(S.dest.x, S.dest.z, 0x37e0ff);
            setPrompt(null);
          }
        } else {
          S.stopDwell = 0;
          setPrompt('Stop — ' + S.stopover.who + ' is waiting with ' + S.stopover.cargo + '.');
        }
      } else {
        S.stopDwell = 0;
        setPrompt('Stopover: ' + S.stopover.who + ' — ' + Math.round(dStop) + ' m • then ' + S.dest.district);
      }
      return;
    }
    // Halfway small-talk, fired once when half the straight-line
    // distance has been covered.
    var remain = dist2d(f.x, f.z, S.dest.x, S.dest.z);
    if (!S.halfSaid && S.routeDist > 0 && remain < S.routeDist * 0.5) {
      S.halfSaid = true;
      notify(S.passenger.half);
    }
    // Arrival: stopped inside the destination ring.
    if (remain <= FARE.dropRadius) {
      if (speed <= FARE.stopSpeed) { finishRide(); return; }
      setPrompt('Stop here — ' + S.passenger.name + ' gets out.');
    } else {
      // The running passenger line: name, destination, live meter.
      S.promptT -= dt;
      if (S.promptT <= 0) {
        S.promptT = 0.25;
        var meter = Math.round(FARE.base + S.odo * FARE.perMeter);
        if (meter !== S.meterShown) {
          S.meterShown = meter;
          setPrompt('Cab: ' + S.passenger.name + ' → ' + S.dest.district +
            ' • ' + Math.round(remain) + ' m • meter ' + fmtMoney(meter));
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Module face.
  // ------------------------------------------------------------------
  var Taxi = {
    init: function () {
      loadStats();
      S.offerIn = 6;
      S.phase = 'idle';
    },
    update: function (dt) {
      if (!dt || dt <= 0) return;
      var st = SH.State;
      if (!st || st.mode !== 'playing') return;
      if (saveTimer > 0) { saveTimer -= dt; if (saveTimer <= 0) saveStats(); }
      if (S.phase === 'idle') updateIdle(dt);
      else if (S.phase === 'pickup') updatePickup(dt);
      else if (S.phase === 'riding') updateRiding(dt);
    },
    // Exposed for the HUD/debug curious: a one-line career summary.
    summary: function () {
      var s = 'Selatara Cab — ' + levelNow().title + ' • fares ' + stats.fares +
        ', earned ' + fmtMoney(stats.earned) +
        ', best tip ' + fmtMoney(stats.bestTip) + ', flawless ' + stats.perfect +
        ', rush beaten ' + stats.rushDone + ', tours ' + stats.tours;
      if (stats.log.length) {
        s += '. Last fare: ' + stats.log[0].who + ' → ' + stats.log[0].to +
          ' for ' + fmtMoney(stats.log[0].total) + '.';
      }
      if (stats.served.length) {
        s += ' Tour so far: ' + stats.served.join(', ') + ' (' + stats.served.length + '/6).';
      }
      return s;
    }
  };

  SH.Taxi = Taxi;
})(window.SH = window.SH || {});
