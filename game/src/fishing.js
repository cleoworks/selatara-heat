// SELATARA HEAT — fishing.js
// "Kail Karat" — harbour fishing at four spots around the strait.
// Stand at a spot, cast with Enter, wait for the bite, strike inside
// the bite window, then land the fish through three quick tension
// strikes in shrinking windows. Every catch is sold on the spot at
// the harbour price; the logbook remembers your biggest of each kind.
// Public API: SH.Fishing { init(), update(dt) }.
// Persistence: private key 'selatara-heat-fishing-v1' (records and
// totals only). The main save file is never touched.
(function (SH) {
  'use strict';

  var KEY = 'selatara-heat-fishing-v1';

  // ------------------------------------------------------------------
  // The spots. Two working piers on the Kencana shore, the Karat
  // harbour wall, and the quiet north shore of Pulau Karang Kecil —
  // reached by its causeway, and the best water in the strait.
  // ------------------------------------------------------------------
  var SPOTS = [
    { id: 'kencana-pier', name: 'Kencana Main Pier', x: 60, z: 262, luck: 1.0,
      blurb: 'Families, gulls, and kakap that have seen every lure ever made.' },
    { id: 'karat-wall', name: 'Karat Harbour Wall', x: 360, z: 258, luck: 1.05,
      blurb: 'Dock water. Dark, oily, and full of crabs with harbour seniority.' },
    { id: 'west-rocks', name: 'West Shore Rocks', x: -430, z: 256, luck: 0.95,
      blurb: 'Quiet rocks past the last warung. Mostly kembung. Occasionally peace.' },
    { id: 'karang-shore', name: 'Karang Kecil North Shore', x: -330, z: 390, luck: 1.3,
      blurb: 'The islet shore where the current bends. The golden ones run here.' }
  ];

  // ------------------------------------------------------------------
  // The catch table. weight drives the roll; base/max size in cm
  // scales the sell price; the golden arus is the jackpot of the
  // strait, and the sandal is the strait's oldest joke.
  // ------------------------------------------------------------------
  var CATCHES = [
    { id: 'kembung', name: 'Ikan Kembung', weight: 30, minSize: 14, maxSize: 26, perCm: 0.9,
      line: 'A kembung. The strait\'s daily bread, still warm from the water.' },
    { id: 'udang', name: 'Udang Selat', weight: 18, minSize: 8, maxSize: 16, perCm: 1.6,
      line: 'A strait prawn, furious and delicious in equal measure.' },
    { id: 'kepiting', name: 'Kepiting Karat', weight: 14, minSize: 10, maxSize: 20, perCm: 1.4,
      line: 'A harbour crab. It was holding a bottle cap like a shield.' },
    { id: 'kakap', name: 'Ikan Kakap', weight: 16, minSize: 24, maxSize: 48, perCm: 1.5,
      line: 'A kakap! The pier crowd pretends not to be jealous.' },
    { id: 'tenggiri', name: 'Ikan Tenggiri', weight: 10, minSize: 40, maxSize: 78, perCm: 1.6,
      line: 'A tenggiri — silver, fast, and now briefly airborne.' },
    { id: 'pari', name: 'Ikan Pari Kecil', weight: 6, minSize: 30, maxSize: 55, perCm: 1.2,
      line: 'A small stingray, released after the photo. It posed. Honestly.' },
    { id: 'bandeng', name: 'Ikan Bandeng', weight: 15, minSize: 22, maxSize: 38, perCm: 1.1,
      line: 'A bandeng, all muscle and opinions. The bones are tomorrow\'s problem.' },
    { id: 'baronang', name: 'Ikan Baronang', weight: 12, minSize: 16, maxSize: 28, perCm: 1.3,
      line: 'A baronang from the rocks. The spines say keep the gloves on.' },
    { id: 'kerapu', name: 'Kerapu Kecil', weight: 8, minSize: 20, maxSize: 42, perCm: 2.1,
      line: 'A young kerapu! The warung buyers are already circling in spirit.' },
    { id: 'cumi', name: 'Cumi-cumi Selat', weight: 9, minSize: 18, maxSize: 34, perCm: 1.8,
      line: 'A squid, inked and indignant. Dinner is going to be dramatic.' },
    { id: 'arus-emas', name: 'Ikan Arus Emas', weight: 2, minSize: 34, maxSize: 52, perCm: 14,
      line: 'THE GOLDEN ARUS. The whole pier just stopped breathing.' },
    { id: 'sandal', name: 'Sandal Jepit', weight: 4, minSize: 26, maxSize: 29, perCm: 0.05,
      line: 'A flip-flop. Left foot. Somewhere out there, its owner is hopping.' },
    { id: 'ban', name: 'Ban Dalam Bekas', weight: 3, minSize: 30, maxSize: 40, perCm: 0.04,
      line: 'An old inner tube. It has seen the whole strait, from underneath.' },
    { id: 'kaleng', name: 'Kaleng Karat Misterius', weight: 3, minSize: 9, maxSize: 12, perCm: 0.3,
      line: 'A rusted can, label long gone. Whatever it was, the sea has voted no.' }
  ];

  // Fight commentary for the tension phase, one line per stage, so a
  // long fight narrates itself instead of repeating a single shout.
  var FIGHT_LINES = [
    'It dives for the pier pylons!',
    'The line sings — it is running sideways!',
    'It jumps! Silver in the air, then gone again!',
    'One last surge — the rod bends like a question mark!'
  ];

  // Angler ranks: the logbook promotes you as the lifetime catch
  // count grows. Each rank is a small permanent luck blessing from
  // the harbour aunties, and a line in the summary.
  var RANKS = [
    { at: 0, name: 'Shore Beginner', luck: 1.0 },
    { at: 10, name: 'Pier Regular', luck: 1.06 },
    { at: 30, name: 'Harbour Hand', luck: 1.12 },
    { at: 75, name: 'Strait Angler', luck: 1.2 },
    { at: 150, name: 'Kail Karat Legend', luck: 1.3 }
  ];

  function rankNow() {
    var r = RANKS[0];
    for (var i = 0; i < RANKS.length; i++) {
      if (book.caught >= RANKS[i].at) r = RANKS[i];
    }
    return r;
  }

  // Mini-game tuning.
  var TUNE = {
    spotRadius: 4.5,      // metres: stand inside this to fish a spot
    biteMinWait: 2.5,     // seconds before a bite can come
    biteMaxWait: 6.5,     // seconds after which a bite is guaranteed
    biteWindow: 0.9,      // seconds to strike once the fish bites
    tensionWindows: [1.1, 0.9, 0.7], // shrinking strike windows per stage
    tensionStages: 3,     // strikes needed to land the fish
    releaseIds: { pari: true },      // caught, admired, released (no sale)
    baitCost: 60,         // dollars for a tin of premium harbour bait
    baitCasts: 3,         // casts one tin covers
    baitLuck: 1.25,       // luck multiplier while baited
    baitWait: 0.7,        // bite-wait multiplier while baited
    boardPrize: 150       // dollars for topping the harbour board
  };

  // The harbour board: a chalk board at the pier office with today's
  // biggest catch chalked on it. Beat it with a bigger fish and the
  // board pays a prize and chalks YOUR name up. The board wipes at
  // day rollover, like all good chalk.
  var board = { name: '', size: 0, spot: '', day: 0 };
  var dayCount = 0;
  var lastHourSeen = -1;

  function loadBoard() {
    try {
      var raw = window.localStorage.getItem(KEY + '-board');
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return;
      if (typeof d.name === 'string') board.name = d.name;
      if (Number.isFinite(d.size)) board.size = d.size;
      if (typeof d.spot === 'string') board.spot = d.spot;
      if (Number.isFinite(d.day)) { board.day = d.day; dayCount = d.day; }
    } catch (e) { /* session-only board */ }
  }

  function saveBoard() {
    try {
      board.day = dayCount;
      window.localStorage.setItem(KEY + '-board', JSON.stringify(board));
    } catch (e) { /* ignore */ }
  }

  function watchBoardDay() {
    var h = SH.State && SH.State.hour;
    if (typeof h !== 'number') return;
    if (lastHourSeen >= 0 && h < lastHourSeen - 12) {
      dayCount++;
      if (board.size > 0) {
        notify('The harbour board wipes clean at dawn. Yesterday\'s best: ' +
          board.name + ', ' + board.size + ' cm. The chalk is ready.');
      }
      board = { name: '', size: 0, spot: '', day: dayCount };
      saveBoard();
    }
    lastHourSeen = h;
  }

  // The water has moods, and they rotate by the day: glass mornings
  // where every shadow is a fish, chop that hides the shy ones, murk
  // that only the bold bite through. The mood is read off the day
  // counter, so the whole city agrees on today's water.
  var WATER_MOODS = [
    { name: 'Glass Calm', wait: 0.8, luck: 1.15, line: 'The strait is glass today. Every shadow down there is a rumour with fins.' },
    { name: 'Light Chop', wait: 1.0, luck: 1.0, line: 'A light chop worries the surface. Ordinary water, ordinary chances.' },
    { name: 'Harbour Murk', wait: 1.2, luck: 1.2, line: 'Murk day. The bold fish bite blind and the golden ones get careless.' },
    { name: 'Running Current', wait: 0.9, luck: 1.1, line: 'The current is running — bait travels, and so do the hunters.' }
  ];

  function waterMood() {
    return WATER_MOODS[Math.abs(dayCount) % WATER_MOODS.length];
  }

  var moodAnnouncedDay = -1;
  function announceMoodOnce() {
    if (moodAnnouncedDay === dayCount) return;
    moodAnnouncedDay = dayCount;
    var m = waterMood();
    notify('Today\'s water: ' + m.name + '. ' + m.line);
  }

  // ------------------------------------------------------------------
  // Persistent logbook: biggest catch per species id, plus totals.
  // ------------------------------------------------------------------
  var book = {
    biggest: {},   // species id -> biggest size in cm
    counts: {},    // species id -> how many ever landed
    caught: 0,     // fish landed (junk and releases included)
    earned: 0,     // lifetime dollars from sold catches
    streak: 0,     // consecutive fish landed without a loss
    bestStreak: 0, // longest streak ever
    bestOverall: null, // { name, size, spot } — the logbook's front page
    spotBest: {},  // spot id -> { name, size } biggest landed at that spot
    rankSeen: 0,   // highest rank index already celebrated
    bait: 0        // premium-bait casts remaining
  };

  function loadBook() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return;
      if (d.biggest && typeof d.biggest === 'object') {
        for (var id in d.biggest) {
          if (Object.prototype.hasOwnProperty.call(d.biggest, id) &&
              Number.isFinite(d.biggest[id])) book.biggest[id] = d.biggest[id];
        }
      }
      if (d.counts && typeof d.counts === 'object') {
        for (var cid in d.counts) {
          if (Object.prototype.hasOwnProperty.call(d.counts, cid) &&
              Number.isFinite(d.counts[cid])) book.counts[cid] = d.counts[cid];
        }
      }
      if (Number.isFinite(d.caught)) book.caught = d.caught;
      if (Number.isFinite(d.earned)) book.earned = d.earned;
      if (Number.isFinite(d.streak)) book.streak = d.streak;
      if (Number.isFinite(d.bestStreak)) book.bestStreak = d.bestStreak;
      if (d.bestOverall && typeof d.bestOverall.name === 'string' &&
          Number.isFinite(d.bestOverall.size)) {
        book.bestOverall = { name: d.bestOverall.name, size: d.bestOverall.size, spot: String(d.bestOverall.spot || '') };
      }
      if (d.spotBest && typeof d.spotBest === 'object') {
        for (var sid in d.spotBest) {
          if (!Object.prototype.hasOwnProperty.call(d.spotBest, sid)) continue;
          var sb = d.spotBest[sid];
          if (sb && typeof sb.name === 'string' && Number.isFinite(sb.size)) {
            book.spotBest[sid] = { name: sb.name, size: sb.size };
          }
        }
      }
      if (Number.isFinite(d.rankSeen)) book.rankSeen = d.rankSeen;
      if (Number.isFinite(d.bait)) book.bait = Math.max(0, Math.floor(d.bait));
    } catch (e) { /* storage unavailable: run session-only */ }
  }

  var saveT = 0;
  function saveBook() {
    try { window.localStorage.setItem(KEY, JSON.stringify(book)); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------
  // Helpers.
  // ------------------------------------------------------------------
  function notify(text) { if (SH.HUD && SH.HUD.notify) SH.HUD.notify(text); }
  function setPrompt(text) { if (SH.HUD && SH.HUD.setPrompt) SH.HUD.setPrompt(text); }
  function fmtMoney(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function dist2d(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function groundY(x, z) {
    var y = 0;
    if (SH.World && SH.World.groundHeightAt) y = SH.World.groundHeightAt(x, z);
    return Number.isFinite(y) ? y : 0;
  }

  // Weighted roll over the catch table, nudged by the spot's luck for
  // the rare rows only (luck never makes junk rarer — the strait is fair).
  function rollCatch(luck) {
    var total = 0, i, c;
    for (i = 0; i < CATCHES.length; i++) {
      c = CATCHES[i];
      total += c.weight * (c.weight <= 6 ? luck : 1);
    }
    var r = Math.random() * total;
    for (i = 0; i < CATCHES.length; i++) {
      c = CATCHES[i];
      r -= c.weight * (c.weight <= 6 ? luck : 1);
      if (r <= 0) return c;
    }
    return CATCHES[0];
  }

  // ------------------------------------------------------------------
  // Spot markers: low teal pillars that live for the whole session.
  // Fishing spots are geography, not events, so nothing is disposed.
  // ------------------------------------------------------------------
  function makeSpotMarker(spot) {
    var scene = SH.Main && SH.Main.getScene ? SH.Main.getScene() : null;
    if (!scene || typeof THREE === 'undefined') return null;
    var y = groundY(spot.x, spot.z);
    var group = new THREE.Group();
    var geo = new THREE.CylinderGeometry(1.1, 1.1, 7, 14, 1, true);
    var mat = new THREE.MeshBasicMaterial({
      color: 0x37e0ff, transparent: true, opacity: 0.28,
      side: THREE.DoubleSide, depthWrite: false
    });
    var beam = new THREE.Mesh(geo, mat);
    beam.position.y = 3.5;
    group.add(beam);
    var ringGeo = new THREE.RingGeometry(1.3, 1.9, 22);
    var ringMat = new THREE.MeshBasicMaterial({
      color: 0x37e0ff, transparent: true, opacity: 0.65,
      side: THREE.DoubleSide, depthWrite: false
    });
    var ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    group.add(ring);
    group.position.set(spot.x, y, spot.z);
    scene.add(group);
    return { group: group, mat: mat, ringMat: ringMat, t: Math.random() * 6 };
  }

  var spotMarkers = [];

  // ------------------------------------------------------------------
  // Session state machine.
  //   idle     — not fishing; proximity offers a cast
  //   waiting  — line in the water; the bite timer runs down
  //   bite     — the window is open: strike NOW
  //   tension  — hooked; land it with timed strikes
  // ------------------------------------------------------------------
  var S = {
    phase: 'idle',
    spot: null,       // active spot while fishing
    nearSpot: null,   // spot offered while idle
    biteIn: 0,        // seconds until the bite arrives
    windowT: 0,       // seconds left in the current window
    stage: 0,         // tension strikes landed so far
    luck: 1,          // effective luck for this cast (spot × feeding window)
    promptT: 0
  };

  // Feeding windows: the strait bites hardest at dawn (05–07) and
  // dusk (17–19), when the water turns over and everything hunts.
  // Inside a window, bites come sooner and rare fish roll bolder;
  // deep night is slow water and patient fishing.
  function feedingFactor() {
    var h = SH.State && SH.State.hour;
    if (typeof h !== 'number') return { wait: 1, luck: 1, label: '' };
    if (h >= 5 && h < 7) return { wait: 0.55, luck: 1.35, label: 'Dawn feed — the water is waking up hungry.' };
    if (h >= 17 && h < 19) return { wait: 0.6, luck: 1.3, label: 'Dusk feed — everything hunts at golden hour.' };
    if (h >= 22 || h < 4) return { wait: 1.45, luck: 1.1, label: 'Night water. Slow, quiet, and honest.' };
    return { wait: 1, luck: 1, label: '' };
  }

  function endSession(reason) {
    if (S.phase !== 'idle' && reason) notify(reason);
    S.phase = 'idle';
    S.spot = null;
    S.biteIn = 0;
    S.windowT = 0;
    S.stage = 0;
    setPrompt(null);
  }

  function buyBait() {
    if (!SH.Economy || !SH.Economy.spend(TUNE.baitCost)) {
      notify('Premium bait costs ' + fmtMoney(TUNE.baitCost) + ' — the fish will have to love you for free.');
      return;
    }
    book.bait += TUNE.baitCasts;
    saveBook();
    notify('Premium harbour bait loaded: ' + book.bait + ' baited casts. The water can smell the difference.');
  }

  function startCast(spot) {
    announceMoodOnce();
    var feed = feedingFactor();
    var mood = waterMood();
    var baited = book.bait > 0;
    if (baited) { book.bait--; saveBook(); }
    S.phase = 'waiting';
    S.spot = spot;
    S.luck = spot.luck * feed.luck * rankNow().luck * mood.luck * (baited ? TUNE.baitLuck : 1);
    S.biteIn = (TUNE.biteMinWait + Math.random() * (TUNE.biteMaxWait - TUNE.biteMinWait)) *
      feed.wait * mood.wait * (baited ? TUNE.baitWait : 1);
    S.stage = 0;
    notify('Kail Karat — line out at ' + spot.name + '. ' + spot.blurb);
    if (baited) notify('Premium bait on the hook. Something down there just made a decision.');
    if (feed.label) notify(feed.label);
    if (book.streak >= 2) {
      notify('Landing streak ×' + book.streak + ' — the buyers pay a streak premium. Do not break it.');
    }
    if (board.size > 0) {
      notify('Harbour board today: ' + board.name + ', ' + board.size + ' cm at ' + board.spot +
        '. Beat it for ' + fmtMoney(TUNE.boardPrize) + '.');
    }
  }

  function landFish() {
    var spot = S.spot;
    var c = rollCatch(S.luck);
    var size = c.minSize + Math.random() * (c.maxSize - c.minSize);
    size = Math.round(size * 10) / 10;
    book.caught++;
    book.counts[c.id] = (book.counts[c.id] || 0) + 1;
    book.streak++;
    if (book.streak > book.bestStreak) book.bestStreak = book.streak;
    var isRecord = !book.biggest[c.id] || size > book.biggest[c.id];
    if (isRecord) book.biggest[c.id] = size;
    if (!book.bestOverall || size > book.bestOverall.size) {
      book.bestOverall = { name: c.name, size: size, spot: spot ? spot.name : '' };
    }
    if (spot) {
      var sb = book.spotBest[spot.id];
      if (!sb || size > sb.size) book.spotBest[spot.id] = { name: c.name, size: size };
    }
    // Rank promotions are celebrated once, on the catch that earns it.
    var rankIdx = RANKS.indexOf(rankNow());
    if (rankIdx > book.rankSeen) {
      book.rankSeen = rankIdx;
      notify('The harbour aunties have spoken: you are now a ' + rankNow().name +
        '. The fish have been informed and are furious.');
    }
    // The harbour board: any real fish can top it; junk cannot, the
    // chalk has standards. Released fish count double in glory and
    // not at all in chalk — size is size, board is board.
    if (c.id !== 'sandal' && c.id !== 'ban' && c.id !== 'kaleng' && size > board.size) {
      board = { name: c.name, size: size, spot: spot ? spot.name : '', day: dayCount };
      saveBoard();
      if (SH.Economy) SH.Economy.addCash(TUNE.boardPrize);
      notify('HARBOUR BOARD TOPPED — ' + c.name + ' ' + size + ' cm goes up in chalk, and the board pays ' +
        fmtMoney(TUNE.boardPrize) + '. Somewhere, yesterday\'s champion just felt a disturbance.');
    }
    var released = !!TUNE.releaseIds[c.id];
    var price = 0;
    if (!released) {
      // Streak premium: consecutive landings impress the harbour
      // buyers, +10% per step of the streak, capped at +50%.
      var mult = 1 + Math.min(book.streak - 1, 5) * 0.1;
      price = Math.max(1, Math.round(size * c.perCm * mult));
      book.earned += price;
      if (SH.Economy) SH.Economy.addCash(price);
    }
    saveBook();
    notify(c.line);
    var line = c.name + ' — ' + size + ' cm';
    if (released) line += ' • released with honours';
    else line += ' • sold for ' + fmtMoney(price);
    if (book.streak >= 2 && !released) line += ' • streak ×' + book.streak;
    if (isRecord && book.caught > 1) line += ' • NEW PERSONAL RECORD';
    line += '.';
    notify(line);
    if (c.id === 'arus-emas') {
      notify('The harbour will talk about this one for a year. So will the warung.');
    }
    endSession(null);
  }

  function loseFish(why) {
    notify(why);
    if (book.streak >= 3) {
      notify('Streak ×' + book.streak + ' is over. The buyers lower their clipboards, slowly.');
    }
    book.streak = 0;
    saveBook();
    // A lost fish is just a story: straight back to idle at the spot.
    S.phase = 'idle';
    S.spot = null;
    S.windowT = 0;
    S.stage = 0;
    setPrompt(null);
  }

  // ------------------------------------------------------------------
  // Phase updates.
  // ------------------------------------------------------------------
  function stillAtSpot() {
    var st = SH.State;
    if (!S.spot || st.driving) return false;
    return dist2d(st.player.x, st.player.z, S.spot.x, S.spot.z) <= TUNE.spotRadius + 1.5;
  }

  function updateIdle(dt) {
    var st = SH.State;
    if (st.driving) {
      if (S.nearSpot) { S.nearSpot = null; setPrompt(null); }
      return;
    }
    var best = null, bd = Infinity;
    for (var i = 0; i < SPOTS.length; i++) {
      var d = dist2d(st.player.x, st.player.z, SPOTS[i].x, SPOTS[i].z);
      if (d <= TUNE.spotRadius && d < bd) { bd = d; best = SPOTS[i]; }
    }
    if (!best) {
      if (S.nearSpot) { S.nearSpot = null; setPrompt(null); }
      return;
    }
    S.nearSpot = best;
    S.promptT -= dt;
    if (S.promptT <= 0) {
      S.promptT = 0.25;
      var line = best.name + ' — Enter: cast a line';
      if (book.bait > 0) line += ' • bait ×' + book.bait;
      else line += ' • B: premium bait ' + fmtMoney(TUNE.baitCost);
      setPrompt(line);
    }
    if (SH.Input && SH.Input.wasPressed('KeyB')) { buyBait(); S.promptT = 0; return; }
    if (SH.Input && SH.Input.wasPressed('Enter')) startCast(best);
  }

  function updateWaiting(dt) {
    if (!stillAtSpot()) { endSession('You wander off. The line comes with you, sadly.'); return; }
    S.biteIn -= dt;
    S.promptT -= dt;
    if (S.promptT <= 0) {
      S.promptT = 0.25;
      setPrompt('Fishing at ' + S.spot.name + '… waiting for a bite');
    }
    if (S.biteIn <= 0) {
      S.phase = 'bite';
      S.windowT = TUNE.biteWindow;
      notify('A BITE! Strike — press Enter!');
      setPrompt('BITE! Press Enter NOW!');
      return;
    }
    // Striking at water is a classic way to catch nothing at all.
    if (SH.Input && SH.Input.wasPressed('Enter')) {
      notify('You strike at ripples. The fish union thanks you for the warning.');
      S.biteIn = Math.max(S.biteIn, 1.2);
    }
  }

  function updateBite(dt) {
    if (!stillAtSpot()) { endSession('The fish takes your line for a walk. It wins.'); return; }
    if (SH.Input && SH.Input.wasPressed('Enter')) {
      S.phase = 'tension';
      S.stage = 0;
      S.windowT = TUNE.tensionWindows[0];
      notify('HOOKED! Land it — strike on the beat, ' + TUNE.tensionStages + ' times!');
      setPrompt('Strike! (1/' + TUNE.tensionStages + ')');
      return;
    }
    S.windowT -= dt;
    if (S.windowT <= 0) loseFish('Too slow — the bite is gone. The fish tells the others.');
  }

  function updateTension(dt) {
    if (!stillAtSpot()) { endSession('You step back and the line snaps. A clean escape, for the fish.'); return; }
    if (SH.Input && SH.Input.wasPressed('Enter')) {
      S.stage++;
      if (S.stage >= TUNE.tensionStages) { landFish(); return; }
      S.windowT = TUNE.tensionWindows[S.stage];
      setPrompt('Strike! (' + (S.stage + 1) + '/' + TUNE.tensionStages + ')');
      notify(FIGHT_LINES[(S.stage - 1) % FIGHT_LINES.length]);
      return;
    }
    S.windowT -= dt;
    if (S.windowT <= 0) {
      loseFish('The line snaps at strike ' + (S.stage + 1) + '. Somewhere, a fish is bragging.');
    }
  }

  // ------------------------------------------------------------------
  // Module face.
  // ------------------------------------------------------------------
  var Fishing = {
    init: function () {
      loadBook();
      loadBoard();
      spotMarkers = [];
      for (var i = 0; i < SPOTS.length; i++) spotMarkers.push(makeSpotMarker(SPOTS[i]));
    },
    update: function (dt) {
      if (!dt || dt <= 0) return;
      var st = SH.State;
      if (!st || st.mode !== 'playing') return;
      for (var i = 0; i < spotMarkers.length; i++) {
        var m = spotMarkers[i];
        if (!m) continue;
        m.t += dt;
        m.mat.opacity = 0.24 + 0.08 * (0.5 + 0.5 * Math.sin(m.t * 2.2 + i));
      }
      if (saveT > 0) { saveT -= dt; if (saveT <= 0) saveBook(); }
      watchBoardDay();
      if (S.phase === 'idle') updateIdle(dt);
      else if (S.phase === 'waiting') updateWaiting(dt);
      else if (S.phase === 'bite') updateBite(dt);
      else if (S.phase === 'tension') updateTension(dt);
    },
    // One-line logbook summary for the HUD/debug curious.
    summary: function () {
      var kinds = 0;
      for (var id in book.biggest) {
        if (Object.prototype.hasOwnProperty.call(book.biggest, id)) kinds++;
      }
      var s = 'Kail Karat — ' + rankNow().name + ' • ' + book.caught + ' caught, ' + kinds +
        ' species logged, ' + fmtMoney(book.earned) + ' earned, best streak ×' + book.bestStreak;
      if (book.bestOverall) {
        s += '. Biggest ever: ' + book.bestOverall.name + ' ' + book.bestOverall.size +
          ' cm at ' + book.bestOverall.spot + '.';
      }
      if (board.size > 0) {
        s += ' Today\'s harbour board: ' + board.name + ' ' + board.size + ' cm (' + board.spot + ').';
      }
      s += ' Today\'s water: ' + waterMood().name + '.';
      return s;
    }
  };

  SH.Fishing = Fishing;
})(window.SH = window.SH || {});
