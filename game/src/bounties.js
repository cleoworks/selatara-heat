// SELATARA HEAT — bounties.js
// "Mami Ratna's List": a bounty board pinned beside the safehouse door.
// Five names, five debts, one collector. Walk up on foot, press Enter, and
// Mami Ratna talks you through the current name; the target is standing in
// their district with whatever friends their reputation buys, and the clock
// is running — a target who smells trouble slips away and the name stays on
// the list for another night. Rewards route through SH.Economy.addCash,
// toughness and pay scale through SH.Combat.spawnEnemy hit points, and
// clearing the whole list turns it over into a Most Wanted rotation that
// pays harder money for harder people. All bookkeeping lives in this
// module's own localStorage schema; the main save file is never touched.
// Public API: SH.Bounties { init(), update(dt), active(), statsSnapshot() }.
(function (SH) {
  'use strict';

  // ------------------------------------------------------------------ tuning
  var SAVE_KEY = 'selatara-heat-bounties-v1';
  var BOARD = { x: -338, z: 74, name: 'Safehouse Board' };
  var OFFER_RADIUS = 7.5;        // on foot, this close to the board = offer
  var WARN_SECONDS = 30;         // escape warning lands this many seconds out
  var GUIDE_EVERY = 15;          // seconds between distance guidance pings
  var ROUND_HP_GROWTH = 0.45;    // Most Wanted: +45% hit points per round
  var ROUND_PAY_GROWTH = 0.6;    // Most Wanted: +60% reward per round
  var ROUND_ESCORT_CAP = 4;      // Most Wanted: escorts stop growing here
  var ROUND_TIME_SHAVE = 10;     // Most Wanted: seconds cut per round…
  var MIN_ESCAPE_SECONDS = 70;   // …but the clock never drops below this

  // ----------------------------------------------------------------- targets
  // The list, in the order Mami Ratna wrote it. Coordinates sit on open
  // street corners (avenue x street from SH.Config.world) in each target's
  // home district, so the fight always has room to happen.
  var TARGETS = [
    {
      id: 'dedi', name: 'Dedi "Katro" Saputra', turf: 'Taman Arus',
      x: 60, z: 120, escorts: 0, hp: 60, reward: 450, escape: 150,
      intro: [
        ['Mami Ratna', 'First name is small, but small names teach big lessons. Dedi "Katro" Saputra owes me for a wedding he catered and never served.', 4.2],
        ['Mami Ratna', 'He walks the park like he owns the grass. Taman Arus. Bring me proof, not excuses.', 3.6]
      ],
      taunt: 'Katro spits: "Ratna sends a courier to do a collector\'s work?"'
    },
    {
      id: 'sari', name: 'Sari "Liar" Wulandari', turf: 'Pantai Kencana',
      x: -120, z: 228, escorts: 1, hp: 85, reward: 700, escape: 140,
      intro: [
        ['Mami Ratna', 'Sari "Liar" Wulandari. She ran my beach money through three salons and kept the change from all of them.', 4.0],
        ['Mami Ratna', 'She keeps one friend close these days. Pantai Kencana, near the sand. Do not let the sea air slow you.', 3.8]
      ],
      taunt: 'Liar laughs from the boardwalk: "Tell the old woman the beach sends its regards."'
    },
    {
      id: 'bambang', name: 'Bambang "Baja" Hartono', turf: 'Pelabuhan Karat',
      x: 420, z: 120, escorts: 1, hp: 110, reward: 950, escape: 130,
      intro: [
        ['Mami Ratna', 'Bambang "Baja" Hartono. Steel by name, steel by spine. He signed for two container loads that never reached my warehouse.', 4.2],
        ['Mami Ratna', 'The docks are his church, Pelabuhan Karat. Even steel bends, nak. Bend it.', 3.4]
      ],
      taunt: 'Baja rolls his shoulders: "Ratna\'s list? I have buried better paper than that."'
    },
    {
      id: 'rudi', name: 'Rudi "Palak" Firmansyah', turf: 'Pelita Heights',
      x: -120, z: -300, escorts: 2, hp: 135, reward: 1250, escape: 120,
      intro: [
        ['Mami Ratna', 'Rudi "Palak" Firmansyah shakes down my shopkeepers in the Heights and calls it a protection tax.', 3.8],
        ['Mami Ratna', 'Two friends walk with him now. Pelita Heights, high streets. Take the friends first or do not take him at all.', 4.0]
      ],
      taunt: 'Palak grins between his guards: "Protection, old woman. Look it up."'
    },
    {
      id: 'vina', name: 'Vina "Neng" Rahmawati', turf: 'Bukit Mawar',
      x: 360, z: -300, escorts: 2, hp: 165, reward: 1600, escape: 110,
      intro: [
        ['Mami Ratna', 'Last name, and the one that keeps me awake. Vina "Neng" Rahmawati moved my money through Bukit Mawar and smiled at my own table while she did it.', 4.6],
        ['Mami Ratna', 'End the list, nak, and this city owes you a favour. So do I.', 3.2]
      ],
      taunt: 'Neng does not even stand up: "You are the best she could send? Sit down, then."'
    }
  ];

  // ------------------------------------------------------------- persistence
  function blankStats() {
    return { done: {}, totalDone: 0, totalEarned: 0, escapes: 0, rounds: 0, history: [] };
  }

  function loadStats() {
    try {
      var raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return blankStats();
      var s = JSON.parse(raw);
      var b = blankStats();
      if (!s || typeof s !== 'object') return b;
      if (s.done && typeof s.done === 'object') {
        for (var i = 0; i < TARGETS.length; i++) {
          if (s.done[TARGETS[i].id]) b.done[TARGETS[i].id] = true;
        }
      }
      b.totalDone = s.totalDone | 0;
      b.totalEarned = s.totalEarned | 0;
      b.escapes = s.escapes | 0;
      b.rounds = s.rounds | 0;
      if (s.history && s.history.length) {
        for (var k = 0; k < s.history.length && b.history.length < 5; k++) {
          if (typeof s.history[k] === 'string') b.history.push(s.history[k]);
        }
      }
      return b;
    } catch (e) { return blankStats(); }
  }

  function saveStats() {
    try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(stats)); }
    catch (e) { /* private mode / quota: the hunt still pays out */ }
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
  function focusPoint() {
    var st = SH.State;
    if (!st) return { x: 0, z: 0 };
    if (st.driving && st.vehicle) return st.vehicle;
    if (st.driving && st.vehiclePos) return st.vehiclePos;
    return st.player;
  }

  // ------------------------------------------------------------ THREE markers
  // Board pillar (gold, permanent) and target pillar (red, while a hunt is
  // live) — same pillar-and-label language as the courier board, rebuilt
  // here so the module carries no cross-dependencies.
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

  function pulsePillar(grp, t) {
    if (!grp) return;
    var s = 1 + Math.sin(t * 2.4) * 0.13;
    grp.userData.ring.scale.set(s, s, 1);
    grp.userData.beamMat.opacity = 0.26 + (Math.sin(t * 2.4) + 1) * 0.05;
    grp.userData.label.position.y = 10.5 + Math.sin(t * 1.7) * 0.35;
  }

  // ------------------------------------------------------------------- state
  var stats = loadStats();
  var hunt = null;             // the live hunt object, or null between hunts
  var boardPillar = null;
  var targetPillar = null;
  var offerShown = false;
  var enterArmed = false;
  var promptTick = 0;
  var guideTick = 0;

  // The name Mami Ratna wants next: the first unfinished target in list
  // order. Once every name is crossed off, the list turns over into the
  // Most Wanted rotation — same faces, longer memories, deeper pockets.
  function currentSpec() {
    var i, def = null;
    for (i = 0; i < TARGETS.length; i++) {
      if (!stats.done[TARGETS[i].id]) { def = TARGETS[i]; break; }
    }
    var round = 1;
    if (!def) {
      round = stats.rounds + 2; // rounds counts finished Most Wanted cycles
      def = TARGETS[stats.totalDone % TARGETS.length];
    }
    var escorts = def.escorts;
    var hp = def.hp;
    var reward = def.reward;
    var escape = def.escape;
    if (round > 1) {
      var steps = round - 1;
      escorts = Math.min(ROUND_ESCORT_CAP, escorts + steps);
      hp = Math.round(hp * (1 + ROUND_HP_GROWTH * steps));
      reward = Math.round(reward * (1 + ROUND_PAY_GROWTH * steps));
      escape = Math.max(MIN_ESCAPE_SECONDS, escape - ROUND_TIME_SHAVE * steps);
    }
    return {
      def: def, round: round, mostWanted: round > 1,
      escorts: escorts, hp: hp, reward: reward, escape: escape
    };
  }

  // -------------------------------------------------------------- life cycle
  function spawnEnemyAt(x, z, hp) {
    if (!SH.Combat || !SH.Combat.spawnEnemy) return null;
    var e = SH.Combat.spawnEnemy(x, z, { hp: hp });
    if (e) return e;
    // Fallback: some builds hand the enemy back only through the roster.
    // Take the closest living enemy to the spawn point and call it ours.
    var list = SH.Combat.enemies;
    if (list && list.length) {
      var best = null, bd = Infinity;
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (!c || c.dead || typeof c.x !== 'number') continue;
        var d = dist2d(c.x, c.z, x, z);
        if (d < bd) { bd = d; best = c; }
      }
      if (bd <= 12) return best;
    }
    return null;
  }

  function scatter(fighter) {
    // Cleanup for a hunt that ends without a body: the fighter slips out of
    // the simulation entirely — flagged dead for the combat system's own
    // corpse handling and moved far off the map so nothing lingers.
    if (!fighter) return;
    try {
      if (typeof fighter.x === 'number') fighter.x = 4000;
      if (typeof fighter.z === 'number') fighter.z = 4000;
      fighter.dead = true;
    } catch (e) { /* a fighter we cannot move is a fighter we leave */ }
  }

  function acceptBounty() {
    if (hunt) return;
    var spec = currentSpec();
    var def = spec.def;
    var target = spawnEnemyAt(def.x, def.z, spec.hp);
    var escorts = [];
    var ring = [[5, 0], [-5, 3], [3, -5], [-3, -4]];
    for (var i = 0; i < spec.escorts; i++) {
      var off = ring[i % ring.length];
      var esc = spawnEnemyAt(def.x + off[0], def.z + off[1], Math.round(spec.hp * 0.6));
      if (esc) escorts.push(esc);
    }
    hunt = {
      spec: spec,
      target: target,
      escorts: escorts,
      tLeft: spec.escape,
      warned: false,
      taunted: false,
      escortsDown: false,
      reeling: false
    };
    var scene = SH.Main && SH.Main.getScene ? SH.Main.getScene() : null;
    if (scene) {
      if (!targetPillar) targetPillar = makePillar(0xff4f4f, 'TARGET', '#ff6b6b');
      scene.add(targetPillar);
      placePillar(targetPillar, def.x, def.z);
      targetPillar.visible = true;
    }
    var lines = def.intro.slice();
    if (spec.mostWanted) {
      lines.push(['Mami Ratna', 'The list turned over, nak. Most Wanted, round ' + spec.round +
        '. Same face, longer memory, deeper pockets: $' + spec.reward + '.', 4.0]);
    }
    playDialog(lines);
    notify('Bounty accepted: ' + def.name + ' — ' + def.turf + ', $' + spec.reward +
      ', gone in ' + fmtClock(spec.escape) + '.');
    setPrompt(null);
    offerShown = false;
    enterArmed = false;
    guideTick = 0;
  }

  function completeBounty() {
    var h = hunt;
    var def = h.spec.def;
    pay(h.spec.reward);
    stats.totalDone++;
    stats.totalEarned += h.spec.reward;
    if (!h.spec.mostWanted) stats.done[def.id] = true;
    if (h.spec.mostWanted && stats.totalDone % TARGETS.length === 0) stats.rounds++;
    pushHistory(stats, def.name + ' — collected $' + h.spec.reward +
      (h.spec.mostWanted ? ' (Most Wanted ' + h.spec.round + ')' : ''));
    saveStats();
    // Witness flavour: some collections are too public to stay quiet.
    var heat = (def.id === 'bambang' || def.id === 'vina' || h.spec.mostWanted);
    if (heat && SH.Police && SH.Police.forceWanted) {
      SH.Police.forceWanted(1);
      notify('Witnesses scatter — the law noticed that collection. Wanted level up.');
    }
    playDialog([
      ['Mami Ratna', 'Crossed off. $' + h.spec.reward + ' is yours, and the list is shorter by one name: ' + def.name + '.', 4.0],
      ['Raka', 'Who is next on the paper, Mami?', 2.2]
    ]);
    if (!h.spec.mostWanted && stats.totalDone === TARGETS.length) {
      notify('The list is fully crossed off. It turns over now — Most Wanted pays harder.');
    }
    endHunt();
  }

  function escapeBounty() {
    var h = hunt;
    stats.escapes++;
    pushHistory(stats, h.spec.def.name + ' — escaped');
    saveStats();
    scatter(h.target);
    for (var i = 0; i < h.escorts.length; i++) scatter(h.escorts[i]);
    playDialog([
      ['Mami Ratna', h.spec.def.name + ' smelled you coming and slipped away. The name stays on my list. Come back sharper.', 4.0]
    ]);
    notify('The target escaped — ' + h.spec.def.name + ' stays on the list.');
    endHunt();
  }

  function endHunt() {
    hunt = null;
    if (targetPillar) targetPillar.visible = false;
    setPrompt(null);
    guideTick = 0;
  }

  // ------------------------------------------------------------------ update
  function updateBoard(dt) {
    var st = SH.State;
    var f = focusPoint();
    var near = !st.driving && dist2d(f.x, f.z, BOARD.x, BOARD.z) <= OFFER_RADIUS;
    enterArmed = near;
    promptTick -= dt;
    if (near && promptTick <= 0) {
      promptTick = 0.5;
      var spec = currentSpec();
      setPrompt('Enter — Mami Ratna\'s List: ' + spec.def.name + ' ($' + spec.reward + ')');
      if (!offerShown) {
        offerShown = true;
        notify('A handwritten list is pinned by the safehouse door. Next name: ' +
          spec.def.name + ' of ' + spec.def.turf + ' — $' + spec.reward +
          (spec.mostWanted ? ', Most Wanted round ' + spec.round + '.' : '.') +
          ' Press Enter to take the bounty.' +
          (stats.totalDone ? ' Your tally: ' + stats.totalDone + ' collected, $' +
            stats.totalEarned + ' earned from the list.' : ''));
      }
    }
    if (!near && offerShown) {
      offerShown = false;
      setPrompt(null);
    }
    if (boardPillar) pulsePillar(boardPillar, st.time);
  }

  function updateHunt(dt) {
    var st = SH.State;
    var h = hunt;
    var def = h.spec.def;

    // The whole hunt turns on one question: is the target down yet?
    if (h.target && h.target.dead) { completeBounty(); return; }
    if (!h.target) {
      // The spawn never materialised (combat unavailable): close the hunt
      // quietly rather than leaving a clock running against nobody.
      notify('The trail went cold before it started — the name stays on the list.');
      endHunt();
      return;
    }

    h.tLeft -= dt;
    if (!h.warned && h.tLeft <= WARN_SECONDS) {
      h.warned = true;
      notify(def.name + ' is getting ready to run — ' + WARN_SECONDS + ' seconds.');
    }
    if (h.tLeft <= 0) { escapeBounty(); return; }

    if (targetPillar) pulsePillar(targetPillar, st.time);

    // First sight of the target earns their one line of bravado.
    var f = focusPoint();
    var d = dist2d(f.x, f.z, def.x, def.z);
    if (!h.taunted && d < 26) {
      h.taunted = true;
      notify(def.taunt);
    }

    // Fight readouts: the moment the escort screen collapses, and the
    // moment the target starts to fold, are both worth one clear call.
    var alive = 0;
    for (var i = 0; i < h.escorts.length; i++) if (!h.escorts[i].dead) alive++;
    if (!h.escortsDown && h.escorts.length > 0 && alive === 0) {
      h.escortsDown = true;
      notify('The escorts are down — ' + def.name + ' stands alone.');
    }
    if (!h.reeling && typeof h.target.hp === 'number' && h.target.hp <= h.spec.hp * 0.3) {
      h.reeling = true;
      notify(def.name + ' is reeling — finish it before the trail cools.');
    }

    guideTick -= dt;
    if (guideTick <= 0) {
      guideTick = GUIDE_EVERY;
      notify('Bounty: ' + def.name + ' — ' + Math.round(d) + ' m ' +
        compass(f.x, f.z, def.x, def.z) + ', ' + fmtClock(h.tLeft) + ' left' +
        (alive ? ', ' + alive + ' escort' + (alive > 1 ? 's' : '') + ' standing.' : '.'));
    }
  }

  function update(dt) {
    var st = SH.State;
    if (!st || st.mode !== 'playing') {
      enterArmed = false;
      return;
    }
    if (hunt) updateHunt(dt);
    else updateBoard(dt);
  }

  // --------------------------------------------------------------------- key
  function onKeyDown(e) {
    if (!e || e.repeat) return;
    if (e.code !== 'Enter') return;
    var st = SH.State;
    if (!st || st.mode !== 'playing') return;
    if (enterArmed && !hunt) acceptBounty();
  }

  // -------------------------------------------------------------------- init
  function init() {
    var scene = SH.Main && SH.Main.getScene ? SH.Main.getScene() : null;
    if (scene && !boardPillar) {
      boardPillar = makePillar(0xffd23f, "MAMI'S LIST", '#ffd23f');
      placePillar(boardPillar, BOARD.x, BOARD.z);
      scene.add(boardPillar);
    }
    window.addEventListener('keydown', onKeyDown);
  }

  SH.Bounties = {
    init: init,
    update: update,
    active: function () { return hunt; },
    statsSnapshot: function () { return stats; }
  };
})(window.SH = window.SH || {});
