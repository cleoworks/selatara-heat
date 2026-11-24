// SELATARA HEAT — jobs.js
// "Selatara Courier": a side-job system run off a battered notice board at
// the Ruko Senja depot. Walk up on foot and the board offers honest work:
// haul a named client's cargo from their door to somebody else's, against a
// generous clock, for real money through SH.Economy.addCash. Three tiers of
// work (Bike Errand, Van Run, Harbour Freight) unlock as your completion
// count grows; fragile loads pay a bonus if the vehicle never takes a hard
// knock on the loaded leg. Jobs never touch missions, races or the save
// file — every number lives in this module's own localStorage schema.
// Public API: SH.Jobs { init(), update(dt), active(), statsSnapshot() }.
(function (SH) {
  'use strict';

  // ------------------------------------------------------------------ tuning
  var SAVE_KEY = 'selatara-heat-jobs-v1';
  var DEPOT = { x: -348, z: 60, name: 'Ruko Senja Depot' };
  var OFFER_RADIUS = 7.5;        // on foot, this close to the board = offer
  var MARK_RADIUS = 9;           // this close to a job pillar = arrived
  var LOAD_SECONDS = 2.5;        // stopped this long at pickup = loaded
  var UNLOAD_SECONDS = 1.6;      // stopped this long at drop-off = delivered
  var ABANDON_SECONDS = 8;       // on foot this long with cargo aboard = fail
  var JOLT_DROP = 8.5;           // losing more speed than this in one step…
  var JOLT_MIN_SPEED = 7;        // …from at least this speed = a cargo knock
  var TIME_BONUS_PER_SEC = 1.2;  // dollars per second left on the clock
  var FRAGILE_FRACTION = 0.18;   // fragile bonus as a share of the base fare

  // ------------------------------------------------------------------- tiers
  // expSpeed is the honest average a decent driver holds on that tier's
  // routes; the clock is distance / expSpeed, padded by slack, plus a flat
  // grace so nobody fails a job to a single red-light pile-up.
  var TIERS = [
    {
      id: 'bike', name: 'Bike Errand', unlock: 0,
      base: 90, perMetre: 0.55, expSpeed: 16, slack: 1.9, grace: 30,
      blurb: 'Small parcels, short hops, scooter work.'
    },
    {
      id: 'van', name: 'Van Run', unlock: 3,
      base: 170, perMetre: 0.8, expSpeed: 13.5, slack: 1.65, grace: 30,
      blurb: 'Crates and cartons across the strait districts.'
    },
    {
      id: 'freight', name: 'Harbour Freight', unlock: 7,
      base: 290, perMetre: 1.1, expSpeed: 10.5, slack: 1.4, grace: 35,
      blurb: 'Heavy harbour loads. One end is always the docks.'
    }
  ];

  // ----------------------------------------------------------------- clients
  // Every client is a real door on a real street corner (avenue x street
  // intersections from SH.Config.world, or a named place from the economy).
  // accept/done lines are the client's own voice, played through Dialog.
  var CLIENTS = [
    {
      id: 'tini', name: 'Bu Tini', place: 'Warung Bu Tini', x: -330, z: 96,
      cargo: ['crates of sambal and dried fish', 'a catering order for forty dockhands'],
      accept: 'Careful with that crate, nak. The sambal is older than you and twice as angry.',
      done: 'Bu Tini counts the jars twice, then pays without a word. High praise.'
    },
    {
      id: 'berkah', name: 'Pak Haji Berkah', place: 'Toko Berkah Jaya', x: 0, z: -180,
      cargo: ['boxed phone chargers', 'a consignment of LED lamps'],
      accept: 'Everything is itemised. Everything. If a lamp is missing, I will know.',
      done: 'Berkah checks one box, nods once, and pays the full fare.'
    },
    {
      id: 'apotek', name: 'Ibu Sinta', place: 'Apotek Sehat Selalu', x: 120, z: 60,
      cargo: ['sealed medicine cartons', 'a cold-box of vaccines on ice'],
      accept: 'This one rides smooth, please. No shortcuts over the kerbs.',
      done: 'Sinta signs the slip with a pharmacist\'s precision. Paid in full.'
    },
    {
      id: 'bengkel', name: 'Bang Ucok', place: 'Bengkel Arus', x: 240, z: 60,
      cargo: ['a rebuilt gearbox, still warm', 'four rims and a sack of lug nuts'],
      accept: 'Mind the gearbox, it bites. Grease on your hands is not my problem.',
      done: 'Ucok wipes his hands on his shirt and pays. The gearbox survived.'
    },
    {
      id: 'bunga', name: 'Mbak Laras', place: 'Kios Bunga Mawar', x: 360, z: -180,
      cargo: ['buckets of cut roses', 'a wedding arch, disassembled'],
      accept: 'Roses bruise if you even look at the brakes wrong. Gentle, ya?',
      done: 'Laras opens one bucket, breathes in, and smiles. Bonus weather.'
    },
    {
      id: 'gudang', name: 'Foreman Dedi', place: 'Gudang Karat Tiga', x: 420, z: 120,
      cargo: ['manifested machine parts', 'crated outboard motors'],
      accept: 'Harbour rules: paper first, questions never. Just get it there.',
      done: 'The foreman stamps the manifest so hard the table jumps. Paid.'
    },
    {
      id: 'butik', name: 'Cici Vina', place: 'Butik Kencana', x: 60, z: 180,
      cargo: ['rails of evening dresses', 'a mannequin named Gerald'],
      accept: 'Gerald has travelled further than most people. Do not scratch Gerald.',
      done: 'Gerald arrives flawless. Cici pays like the dresses depend on it.'
    },
    {
      id: 'kopi', name: 'Mas Bimo', place: 'Kedai Kopi Senja', x: -240, z: -300,
      cargo: ['sacks of strait-grown coffee beans', 'a secondhand espresso machine'],
      accept: 'If the machine leaks, you smell amazing for a week. Drive steady.',
      done: 'Bimo pulls one shot from the delivered beans and approves the fare.'
    },
    {
      id: 'ikan', name: 'Pak Karso', place: 'Pasar Ikan Karat', x: 480, z: 60,
      cargo: ['iced crates of red snapper', 'a barrel of harbour prawns'],
      accept: 'Fish waits for nobody. The ice is already melting, so are we clear?',
      done: 'Karso slaps the crate, grins through the fish smell, and pays.'
    },
    {
      id: 'salon', name: 'Mbak Rara', place: 'Salon Pantai', x: -120, z: 228,
      cargo: ['boxes of salon chairs', 'a neon sign that reads OPEN'],
      accept: 'The sign is fragile and so is my patience. Smooth roads only.',
      done: 'The neon sign flickers on first try. Rara pays with a flourish.'
    }
  ];
  var HARBOUR_IDS = { gudang: true, ikan: true };

  // ------------------------------------------------------------- persistence
  function blankStats() {
    return {
      done: 0, failed: 0, earned: 0, rep: 0, rotation: 0,
      fragileRuns: 0, bestTimeBonus: 0,
      streak: 0, bestStreak: 0, history: [],
      perTier: {
        bike: { done: 0, earned: 0 },
        van: { done: 0, earned: 0 },
        freight: { done: 0, earned: 0 }
      }
    };
  }

  function loadStats() {
    try {
      var raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return blankStats();
      var s = JSON.parse(raw);
      var b = blankStats();
      if (!s || typeof s !== 'object') return b;
      b.done = s.done | 0; b.failed = s.failed | 0;
      b.earned = s.earned | 0; b.rep = s.rep | 0;
      b.rotation = s.rotation | 0;
      b.fragileRuns = s.fragileRuns | 0;
      b.bestTimeBonus = s.bestTimeBonus | 0;
      b.streak = s.streak | 0;
      b.bestStreak = s.bestStreak | 0;
      if (s.history && s.history.length) {
        for (var h = 0; h < s.history.length && b.history.length < 5; h++) {
          if (typeof s.history[h] === 'string') b.history.push(s.history[h]);
        }
      }
      if (s.perTier) {
        for (var i = 0; i < TIERS.length; i++) {
          var t = TIERS[i].id, pt = s.perTier[t];
          if (pt) { b.perTier[t].done = pt.done | 0; b.perTier[t].earned = pt.earned | 0; }
        }
      }
      return b;
    } catch (e) { return blankStats(); }
  }

  function saveStats() {
    try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(stats)); }
    catch (e) { /* private mode / quota: the job still pays, stats just lapse */ }
  }

  // ------------------------------------------------------------ tiny helpers
  function notify(text) { if (SH.HUD && SH.HUD.notify) SH.HUD.notify(text); }
  function setPrompt(text) { if (SH.HUD && SH.HUD.setPrompt) SH.HUD.setPrompt(text); }
  function playDialog(lines) { if (window.Dialog && window.Dialog.play) window.Dialog.play(lines); }
  function pay(n) {
    if (SH.Economy && SH.Economy.addCash) SH.Economy.addCash(n);
    else if (SH.State) SH.State.cash += n;
  }
  function groundY(x, z) {
    if (SH.World && SH.World.groundHeightAt) return SH.World.groundHeightAt(x, z);
    return 0;
  }
  function dist2d(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function fmtClock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  // Compass word for the bearing from a to b: north is -z, east is +x.
  function compass(ax, az, bx, bz) {
    var ang = Math.atan2(bx - ax, -(bz - az));
    var dirs = ['north', 'north-east', 'east', 'south-east',
      'south', 'south-west', 'west', 'north-west'];
    var idx = Math.round(ang / (Math.PI / 4)) % 8;
    if (idx < 0) idx += 8;
    return dirs[idx];
  }
  function pushHistory(statsObj, line) {
    statsObj.history.unshift(line);
    if (statsObj.history.length > 5) statsObj.history.length = 5;
  }
  // Deterministic little LCG so the job rotation is "seeded": the same
  // career always sees the same sequence of offers, no Math.random drift.
  function lcg(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // The thing you drive / stand in, as one {x, z} point.
  function focusPoint() {
    var st = SH.State;
    if (!st) return { x: 0, z: 0 };
    if (st.driving && st.vehicle) return st.vehicle;
    if (st.driving && st.vehiclePos) return st.vehiclePos;
    return st.player;
  }
  function mySpeed() {
    var st = SH.State;
    if (st && st.driving && st.vehicle && typeof st.vehicle.speed === 'number') {
      return Math.abs(st.vehicle.speed);
    }
    return 0;
  }

  // ------------------------------------------------------------ THREE markers
  // A light pillar you can see across rooftops, a ground ring that breathes,
  // and a floating canvas label — the same visual language the race and
  // vista systems speak, rebuilt here so this module stands on its own.
  function makeLabelSprite(text, cssColor) {
    var canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    var g = canvas.getContext('2d');
    g.font = 'bold 52px Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = 'rgba(10,10,16,0.85)';
    g.strokeText(text, 256, 64);
    g.fillStyle = cssColor || '#ffd23f';
    g.fillText(text, 256, 64);
    var tex = new THREE.CanvasTexture(canvas);
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    var spr = new THREE.Sprite(mat);
    spr.scale.set(13, 3.25, 1);
    return spr;
  }

  function makePillar(colorHex, labelText, cssColor) {
    var grp = new THREE.Group();
    var beamMat = new THREE.MeshBasicMaterial({
      color: colorHex, transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    var beam = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 26, 18, 1, true), beamMat);
    beam.position.y = 13;
    grp.add(beam);
    var ringMat = new THREE.MeshBasicMaterial({
      color: colorHex, transparent: true, opacity: 0.75,
      depthWrite: false, side: THREE.DoubleSide
    });
    var ring = new THREE.Mesh(new THREE.RingGeometry(2.5, 3.1, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    grp.add(ring);
    var label = makeLabelSprite(labelText, cssColor);
    label.position.y = 10.5;
    grp.add(label);
    grp.userData.beamMat = beamMat;
    grp.userData.ring = ring;
    grp.userData.label = label;
    return grp;
  }

  function placePillar(grp, x, z) {
    if (!grp) return;
    grp.position.set(x, groundY(x, z), z);
  }

  function dropPillar(grp) {
    if (!grp || !grp.parent) return;
    grp.parent.remove(grp);
  }

  function pulsePillar(grp, t) {
    if (!grp) return;
    var s = 1 + Math.sin(t * 2.4) * 0.13;
    grp.userData.ring.scale.set(s, s, 1);
    grp.userData.beamMat.opacity = 0.26 + (Math.sin(t * 2.4) + 1) * 0.05;
    grp.userData.label.position.y = 10.5 + Math.sin(t * 1.7) * 0.35;
  }

  // ------------------------------------------------------------------- state
  var stats = loadStats();
  var job = null;              // the live job object, or null between jobs
  var depotPillar = null;
  var phasePillar = null;      // one pillar, re-skinned per phase
  var offerShown = false;      // standing next to the board, offer on screen
  var enterArmed = false;      // Enter accepts while this is true
  var promptTick = 0;          // throttles the standing prompt refresh
  var guidTick = 0;            // throttles mid-job guidance notifies

  function unlockedTierIndex() {
    var idx = 0;
    for (var i = 0; i < TIERS.length; i++) {
      if (stats.done >= TIERS[i].unlock) idx = i;
    }
    return idx;
  }

  // ------------------------------------------------------------- job factory
  // Seeded rotation: a per-career counter walks the client list in an LCG
  // shuffle, so offers feel varied but never repeat the same door twice in
  // a row and never ask you to deliver a crate to the person who sent it.
  function generateJob(tierIndex) {
    var tier = TIERS[tierIndex];
    var rnd = lcg(0x5eed + stats.rotation * 7919 + tierIndex * 131);
    var pool = CLIENTS.slice();
    // Harbour Freight always touches the docks at one end.
    var from, to, guard = 0;
    do {
      from = pool[Math.floor(rnd() * pool.length)];
      to = pool[Math.floor(rnd() * pool.length)];
      guard++;
    } while (
      guard < 40 &&
      (from === to ||
        dist2d(from.x, from.z, to.x, to.z) < 260 ||
        (tier.id === 'freight' && !HARBOUR_IDS[from.id] && !HARBOUR_IDS[to.id]))
    );
    var dist = dist2d(from.x, from.z, to.x, to.z);
    var cargo = from.cargo[Math.floor(rnd() * from.cargo.length)];
    var seconds = dist / tier.expSpeed * tier.slack + tier.grace;
    var baseFare = Math.round(tier.base + dist * tier.perMetre);
    // Night rate: work offered after dark pays a surge on the fare, because
    // the strait roads empty out and every client knows it.
    var hour = SH.State && typeof SH.State.hour === 'number' ? SH.State.hour : 12;
    var surge = (hour >= 19 || hour < 5) ? Math.round(baseFare * 0.15) : 0;
    return {
      tier: tier,
      from: from,
      to: to,
      cargo: cargo,
      dist: Math.round(dist),
      baseFare: baseFare,
      surge: surge,
      fragileFare: Math.round(baseFare * FRAGILE_FRACTION),
      seconds: Math.round(seconds),
      phase: 'pickup',          // 'pickup' -> 'deliver'
      tLeft: Math.round(seconds),
      loadT: 0,
      footT: 0,
      prevSpeed: 0,
      cargoIntact: true,
      knockWarned: false,
      warn60: false,
      warn30: false,
      startedAt: SH.State ? SH.State.time : 0
    };
  }

  function describeJob(j) {
    return j.tier.name + ': ' + j.cargo + ' — ' + j.from.place +
      ' to ' + j.to.place + ' (' + j.dist + ' m, about $' + j.baseFare + ')' +
      (j.surge ? ' Night rate adds $' + j.surge + '.' : '');
  }

  // -------------------------------------------------------------- life cycle
  function acceptJob() {
    if (job) return;
    var tierIndex = unlockedTierIndex();
    job = generateJob(tierIndex);
    stats.rotation++;
    saveStats();
    var scene = SH.Main && SH.Main.getScene ? SH.Main.getScene() : null;
    if (scene) {
      if (!phasePillar) phasePillar = makePillar(0x37e0ff, 'PICKUP', '#37e0ff');
      scene.add(phasePillar);
      placePillar(phasePillar, job.from.x, job.from.z);
      phasePillar.visible = true;
    }
    playDialog([
      ['Dispatcher', 'New sheet on the board. ' + describeJob(job) + '.', 3.4],
      [job.from.name, job.from.accept, 3.6],
      ['Raka', 'On it. Wheels first, then the pickup pillar.', 2.4]
    ]);
    notify('Courier job accepted — pickup at ' + job.from.place + ' (' + job.dist + ' m run).');
    setPrompt(null);
    offerShown = false;
    enterArmed = false;
  }

  function finishPickup() {
    job.phase = 'deliver';
    job.loadT = 0;
    job.footT = 0;
    job.prevSpeed = mySpeed();
    if (phasePillar) {
      // Re-skin the same pillar: new colour reads as a new instruction.
      phasePillar.userData.beamMat.color.setHex(0x7ac94f);
      phasePillar.userData.ring.material.color.setHex(0x7ac94f);
      placePillar(phasePillar, job.to.x, job.to.z);
    }
    notify('Loaded: ' + job.cargo + '. Deliver to ' + job.to.place + ' — ' + fmtClock(job.tLeft) + ' on the clock.');
  }

  function computeDeliveryPay(j) {
    var timeBonus = Math.round(Math.max(0, j.tLeft) * TIME_BONUS_PER_SEC);
    if (timeBonus > j.baseFare) timeBonus = j.baseFare; // never doubles the fare
    // A hot streak (three or more clean sheets coming in) pays the clock
    // bonus at time-and-a-quarter: the board looks after regulars.
    if (stats.streak >= 3) timeBonus = Math.round(timeBonus * 1.25);
    var fragile = j.cargoIntact ? j.fragileFare : 0;
    var surge = j.surge || 0;
    return {
      timeBonus: timeBonus, fragile: fragile, surge: surge,
      total: j.baseFare + surge + timeBonus + fragile
    };
  }

  function completeJob() {
    var j = job;
    var p = computeDeliveryPay(j);
    pay(p.total);
    stats.done++;
    stats.earned += p.total;
    stats.rep += j.cargoIntact ? 3 : 2;
    stats.streak++;
    if (stats.streak > stats.bestStreak) stats.bestStreak = stats.streak;
    if (j.cargoIntact) stats.fragileRuns++;
    if (p.timeBonus > stats.bestTimeBonus) stats.bestTimeBonus = p.timeBonus;
    var pt = stats.perTier[j.tier.id];
    if (pt) { pt.done++; pt.earned += p.total; }
    pushHistory(stats, j.tier.name + ' — ' + j.from.place + ' to ' + j.to.place + ' — $' + p.total);
    saveStats();
    playDialog([
      [j.to.name, j.to.done, 3.6],
      ['Dispatcher', 'Sheet stamped. $' + p.total + ' — fare $' + j.baseFare +
        (p.surge ? ', night $' + p.surge : '') +
        ', time $' + p.timeBonus + (p.fragile ? ', fragile $' + p.fragile : '') + '.', 3.8]
    ]);
    if (stats.streak === 3) {
      notify('Hot streak — three clean sheets running. Time bonuses pay +25% while it lasts.');
    } else if (stats.streak > 3 && stats.streak % 5 === 0) {
      notify('Streak at ' + stats.streak + ' clean sheets. The depot board loves a regular.');
    }
    var nextTier = unlockedTierIndex();
    if (TIERS[nextTier].unlock === stats.done && stats.done > 0) {
      notify('New work unlocked at the depot: ' + TIERS[nextTier].name + '.');
    }
    endJob();
  }

  function failJob(reason) {
    var j = job;
    stats.failed++;
    stats.rep = Math.max(0, stats.rep - 3);
    stats.streak = 0;
    pushHistory(stats, 'Failed ' + j.tier.name + ' — ' + j.from.place + ' to ' + j.to.place);
    saveStats();
    notify('Courier job failed — ' + reason + ' Reputation slips to ' + stats.rep + '.');
    playDialog([
      ['Dispatcher', 'That sheet comes back unsigned. ' + reason + ' The board forgets nothing.', 3.6]
    ]);
    endJob();
  }

  function endJob() {
    job = null;
    if (phasePillar) phasePillar.visible = false;
    setPrompt(null);
    guidTick = 0;
  }

  // ------------------------------------------------------------------ update
  function updateBoard(dt) {
    // No live job: the depot board itself is the interaction.
    var st = SH.State;
    var f = focusPoint();
    var near = !st.driving && dist2d(f.x, f.z, DEPOT.x, DEPOT.z) <= OFFER_RADIUS;
    enterArmed = near;
    promptTick -= dt;
    if (near && promptTick <= 0) {
      promptTick = 0.5;
      var tier = TIERS[unlockedTierIndex()];
      setPrompt('Enter — Selatara Courier board (' + tier.name + ' work, rep ' + stats.rep + ')');
      if (!offerShown) {
        offerShown = true;
        notify('The depot board is full of delivery sheets. Press Enter to take ' +
          tier.name + ' work. ' + tier.blurb);
      }
    }
    if (!near && offerShown) {
      offerShown = false;
      setPrompt(null);
    }
    if (depotPillar) pulsePillar(depotPillar, st.time);
  }

  function updateJob(dt) {
    var st = SH.State;
    var j = job;
    var f = focusPoint();

    // The clock always runs; warnings land once each.
    j.tLeft -= dt;
    if (!j.warn60 && j.tLeft <= 60 && j.tLeft > 30) {
      j.warn60 = true;
      notify('One minute left on the courier clock.');
    }
    if (!j.warn30 && j.tLeft <= 30) {
      j.warn30 = true;
      notify('Thirty seconds — the client is watching the door.');
    }
    if (j.tLeft <= 0) {
      failJob('the clock ran out over ' + j.to.place + '.');
      return;
    }

    // A wrecked vehicle ends the run wherever the cargo is.
    if (st.driving && st.vehicle && st.vehicle.dead) {
      failJob('the vehicle died with the run unfinished.');
      return;
    }

    if (phasePillar) pulsePillar(phasePillar, st.time);
    guidTick -= dt;

    if (j.phase === 'pickup') {
      var dp = dist2d(f.x, f.z, j.from.x, j.from.z);
      if (dp <= MARK_RADIUS) {
        if (!st.driving) {
          if (guidTick <= 0) {
            guidTick = 6;
            notify('You need wheels to load this cargo — bring a vehicle into the pillar.');
          }
          j.loadT = 0;
        } else if (mySpeed() < 1.5) {
          j.loadT += dt;
          if (guidTick <= 0) {
            guidTick = 1;
            setPrompt('Loading ' + j.cargo + '… ' + Math.ceil(LOAD_SECONDS - j.loadT) + 's');
          }
          if (j.loadT >= LOAD_SECONDS) { setPrompt(null); finishPickup(); return; }
        } else {
          j.loadT = 0;
          if (guidTick <= 0) { guidTick = 4; notify('Stop inside the pillar to load the cargo.'); }
        }
      } else {
        j.loadT = 0;
        if (guidTick <= 0) {
          guidTick = 12;
          notify('Pickup: ' + j.from.place + ' — ' + Math.round(dp) + ' m ' +
            compass(f.x, f.z, j.from.x, j.from.z) + ', ' + fmtClock(j.tLeft) + ' left.');
        }
      }
      return;
    }

    // ---- phase: deliver ----
    // Fragile watch: a hard speed shed in a single step is a knock, and a
    // knock is the difference between a fare and a fare with a bonus.
    var spd = mySpeed();
    if (st.driving && j.prevSpeed - spd > JOLT_DROP && j.prevSpeed > JOLT_MIN_SPEED) {
      if (j.cargoIntact) {
        j.cargoIntact = false;
        if (!j.knockWarned) {
          j.knockWarned = true;
          notify('The cargo took a knock — fragile bonus gone. The fare still stands.');
        }
      }
    }
    j.prevSpeed = spd;

    // Walking away from a loaded vehicle is abandoning the load.
    if (!st.driving) {
      j.footT += dt;
      if (j.footT >= ABANDON_SECONDS) {
        failJob('you walked away from the cargo for too long.');
        return;
      }
      if (j.footT > 2 && guidTick <= 0) {
        guidTick = 3;
        notify('Back to the vehicle — the cargo goes nowhere on foot.');
      }
    } else {
      j.footT = 0;
    }

    var dd = dist2d(f.x, f.z, j.to.x, j.to.z);
    if (dd <= MARK_RADIUS) {
      if (!st.driving) {
        if (guidTick <= 0) { guidTick = 5; notify('Park in the pillar to hand over the cargo.'); }
        j.loadT = 0;
      } else if (spd < 1.5) {
        j.loadT += dt;
        if (guidTick <= 0) {
          guidTick = 1;
          setPrompt('Handing over ' + j.cargo + '… ' + Math.ceil(UNLOAD_SECONDS - j.loadT) + 's');
        }
        if (j.loadT >= UNLOAD_SECONDS) { setPrompt(null); completeJob(); return; }
      } else {
        j.loadT = 0;
        if (guidTick <= 0) { guidTick = 4; notify('Stop inside the pillar to deliver.'); }
      }
    } else {
      j.loadT = 0;
      if (guidTick <= 0) {
        guidTick = 12;
        notify('Deliver: ' + j.to.place + ' — ' + Math.round(dd) + ' m ' +
          compass(f.x, f.z, j.to.x, j.to.z) + ', ' + fmtClock(j.tLeft) + ' left' +
          (j.cargoIntact ? ', cargo pristine.' : '.'));
      }
    }
  }

  function update(dt) {
    var st = SH.State;
    if (!st || st.mode !== 'playing') {
      enterArmed = false;
      return;
    }
    if (job) updateJob(dt);
    else updateBoard(dt);
  }

  // --------------------------------------------------------------------- key
  function onKeyDown(e) {
    if (!e || e.repeat) return;
    if (e.code !== 'Enter') return;
    var st = SH.State;
    if (!st || st.mode !== 'playing') return;
    if (enterArmed && !job) acceptJob();
  }

  // -------------------------------------------------------------------- init
  function init() {
    var scene = SH.Main && SH.Main.getScene ? SH.Main.getScene() : null;
    if (scene && !depotPillar) {
      depotPillar = makePillar(0xffd23f, 'COURIER', '#ffd23f');
      placePillar(depotPillar, DEPOT.x, DEPOT.z);
      scene.add(depotPillar);
    }
    window.addEventListener('keydown', onKeyDown);
  }

  SH.Jobs = {
    init: init,
    update: update,
    active: function () { return job; },
    statsSnapshot: function () { return stats; }
  };
})(window.SH = window.SH || {});
