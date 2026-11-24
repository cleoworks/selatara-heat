// SELATARA HEAT — property.js
// "Selatara Ventures" — six small businesses across the city are for
// sale: a coffee warung, a workshop, a boarding house, a grocery, a
// laundry and a harbour kiosk. Buy one on foot at its marker, and it
// earns a yield for every game hour you own it. Come back to collect
// the takings, and reinvest in upgrades — signage, staff, renovation —
// that raise the hourly yield across three levels.
// Public API: SH.Property { init(), update(dt) }.
// Persistence: private key 'selatara-heat-property-v1' (ownership,
// upgrade levels, uncollected yield, portfolio totals). The main save
// file is never touched; money itself moves only through SH.Economy.
(function (SH) {
  'use strict';

  var KEY = 'selatara-heat-property-v1';

  // ------------------------------------------------------------------
  // The portfolio. Prices are tuned against the game's cash scale (a
  // gun costs $1,400–$2,100, a good courier day pays a few hundred):
  // the warung is an early-game goal, the workshop is the flagship.
  // yieldPerHour is what the business banks for its owner each game
  // hour; one game hour passes every 37.5 real seconds of play.
  // ------------------------------------------------------------------
  var PROPERTIES = [
    {
      id: 'warung-kopi',
      name: 'Warung Kopi Senja',
      gloss: 'a coffee warung with four plastic stools and one legendary es kopi',
      district: 'RUKO SENJA', x: -356, z: 66,
      price: 4000, yieldPerHour: 90,
      seller: 'Bu Tini',
      pitch: [
        ['Bu Tini', 'You want the warung? The stools are plastic, the coffee is not. Tourists pay double and never know.', 5],
        ['Bu Tini', 'Keep my sambal recipe OFF the menu board. Some secrets are load-bearing.', 4],
        ['Raka', 'Deal. I will keep the stools warm and the recipe buried.', 3]
      ]
    },
    {
      id: 'toko-kelontong',
      name: 'Toko Kelontong Arus',
      gloss: 'a grocery on the park edge that sells everything except silence',
      district: 'TAMAN ARUS', x: 126, z: 186,
      price: 6500, yieldPerHour: 140,
      seller: 'Pak Dullah',
      pitch: [
        ['Pak Dullah', 'The kelontong? Every mother in Taman Arus owes it money and loyalty, in that order.', 5],
        ['Pak Dullah', 'The credit book stays in the drawer. Half the park is in it. Handle with mercy.', 4],
        ['Raka', 'Mercy and margins. Understood.', 3]
      ]
    },
    {
      id: 'laundry',
      name: 'Laundry Mawar Wangi',
      gloss: 'a laundry whose steam perfumes the whole Bukit Mawar corner',
      district: 'BUKIT MAWAR', x: 354, z: -186,
      price: 7500, yieldPerHour: 165,
      seller: 'Mbak Rara',
      pitch: [
        ['Mbak Rara', 'The laundry folds half the hill\'s shirts. The other half irons at home and lies about it.', 5],
        ['Mbak Rara', 'Machine two rattles. It has rattled since 2019. Customers find it honest.', 4],
        ['Raka', 'A rattling machine with a loyal following. Sold.', 3]
      ]
    },
    {
      id: 'kos-kosan',
      name: 'Kos-kosan Pelita 88',
      gloss: 'a boarding house of twelve rooms, eleven tenants and one ghost (alleged)',
      district: 'PELITA HEIGHTS', x: -114, z: -174,
      price: 9000, yieldPerHour: 190,
      seller: 'Pak Haji Umar',
      pitch: [
        ['Pak Haji Umar', 'The kos is full every month, alhamdulillah. Students, nurses, one poet who pays in poems.', 5],
        ['Pak Haji Umar', 'Accept the poems. They are surprisingly good collateral for the soul.', 4],
        ['Raka', 'Rooms, rent and poetry. I am in.', 3]
      ]
    },
    {
      id: 'kios-pelabuhan',
      name: 'Kios Pelabuhan Karat',
      gloss: 'a harbour kiosk selling coffee, cigarettes and extremely local news',
      district: 'PANTAI KENCANA', x: 246, z: 222,
      price: 5500, yieldPerHour: 120,
      seller: 'Bang Jali',
      pitch: [
        ['Bang Jali', 'The kiosk hears every ship\'s gossip before the captain does. That is the real inventory.', 5],
        ['Bang Jali', 'Dock crews pay on Friday. The whole harbour runs on my little book.', 4],
        ['Raka', 'Coffee and intelligence. A sound portfolio.', 3]
      ]
    },
    {
      id: 'bengkel',
      name: 'Bengkel Arus Kecil',
      gloss: 'a small workshop with a big reputation among people who drive badly',
      district: 'PELABUHAN KARAT', x: 366, z: 66,
      price: 12000, yieldPerHour: 260,
      seller: 'Ko Ahin',
      pitch: [
        ['Ko Ahin', 'The bengkel? Every taxi and truck in Karat limps to my door eventually.', 5],
        ['Ko Ahin', 'The lift sticks in rainy season. Kick it like this. It respects confidence.', 4],
        ['Raka', 'A workshop that respects confidence. I will fit right in.', 3]
      ]
    }
  ];

  // Upgrade ladder, shared by every property. Level 0 is the business
  // as bought; each level multiplies the hourly yield and costs a
  // fraction of the purchase price, so the flagship stays the flagship.
  var UPGRADES = [
    { name: 'as bought', yieldMult: 1.0, costMult: 0 },
    { name: 'new signage', yieldMult: 1.6, costMult: 0.35 },
    { name: 'trained staff', yieldMult: 2.3, costMult: 0.55 },
    { name: 'full renovation', yieldMult: 3.2, costMult: 0.85 }
  ];
  var MAX_LEVEL = UPGRADES.length - 1;

  // ------------------------------------------------------------------
  // Flavour per property: who runs the place day to day, and what you
  // see when you stop by with nothing to collect. Kept in a side table
  // so the portfolio data above stays a clean price list.
  // ------------------------------------------------------------------
  var FLAVOUR = {
    'warung-kopi': {
      crew: 'Sari runs the morning shift and knows every regular\'s order by heart.',
      inspect: 'The es kopi machine hisses like it is gossiping about the weather.'
    },
    'toko-kelontong': {
      crew: 'Two aunties share the counter and a single, enormous credit book.',
      inspect: 'Shelves of instant noodles stand in perfect, colourful ranks.'
    },
    'laundry': {
      crew: 'A team of three folders works to a dangdut beat from a small radio.',
      inspect: 'Steam curls from the vents; the whole corner smells of clean cotton.'
    },
    'kos-kosan': {
      crew: 'The poet in room 9 waters the plants and pays in verse, as agreed.',
      inspect: 'Laundry lines and motorbikes crowd the yard in friendly chaos.'
    },
    'kios-pelabuhan': {
      crew: 'An old sailor minds the kiosk at night and charges gossip at cost.',
      inspect: 'Fishing boats knock gently against the pier below the kiosk.'
    },
    'bengkel': {
      crew: 'Ko Ahin\'s nephew runs the lift now. It still respects confidence.',
      inspect: 'A wall of labelled wrenches, each older than most of the customers.'
    }
  };

  // Sellers' come-on lines, rotated into the prompt while you stand
  // at a for-sale marker deciding. Every seller in Selatara can smell
  // a browsing wallet from across the street.
  var COME_ONS = {
    'warung-kopi': 'Bu Tini waves: "The es kopi is cold and the opportunity is not, nak."',
    'toko-kelontong': 'Pak Dullah taps the credit book: "Own the shop, own half the park\'s gratitude."',
    'laundry': 'Mbak Rara points at the steam: "That smell? That is money, drying."',
    'kos-kosan': 'Pak Haji Umar: "Twelve rooms, nak. Twelve rents. One poet."',
    'kios-pelabuhan': 'Bang Jali: "Every ship\'s secret passes this counter. Imagine the rent."',
    'bengkel': 'Ko Ahin spins a wrench: "Bad drivers are forever. Be their landlord."'
  };

  // Insurance: a flat fee per business that eats exactly one repair
  // event. Selatara's only insurer is a man with a stamp, but the
  // stamp is very official.
  var INSURANCE_COST = 300;

  // The third-business milestone: the moment a driver becomes a
  // landlord in the eyes of the city's other landlords.
  var MILESTONE_3 = [
    ['Bu Tini', 'Three businesses now. You are not a customer anymore, you are a colleague.', 4],
    ['Ko Ahin', 'Word travels the harbour faster than your car does. Congratulations, boss.', 4],
    ['Raka', 'Colleague. I could get used to the paperwork side of the strait.', 3]
  ];

  // First-visit greetings: the first time you walk up to a business
  // you own, the crew says the thing crews say to a new owner. Once
  // per property, ever — after that you are furniture, like family.
  var GREETINGS = {
    'warung-kopi': [
      ['Sari', 'Boss! Your usual stool is free. It is always free. It is YOUR stool now.', 4],
      ['Raka', 'Then the es kopi is on the house. My house. Still getting used to that.', 3]
    ],
    'toko-kelontong': [
      ['Pak Dullah', 'The credit book has a new first page, boss. Your name. In pencil, for now.', 4],
      ['Raka', 'Pencil is fine. We earn the ink.', 3]
    ],
    'laundry': [
      ['Mbak Rara', 'The crew folded you a welcome shirt, boss. It is extremely folded.', 4],
      ['Raka', 'I have never owned anything this crisp. Including my driving record.', 3]
    ],
    'kos-kosan': [
      ['The Poet of Room 9', 'I wrote the new owner a welcome poem. It rhymes "rent" with "well spent".', 4],
      ['Raka', 'Collateral accepted. The garden looks loved.', 3]
    ],
    'kios-pelabuhan': [
      ['The Night Sailor', 'Harbour says the kiosk has a captain now. I just sell the coffee, boss.', 4],
      ['Raka', 'Keep the kettle on. Gossip is our real inventory.', 3]
    ],
    'bengkel': [
      ['Ko Ahin\'s Nephew', 'Lift still sticks in the rain, boss. I kick it with confidence, like you taught by buying.', 4],
      ['Raka', 'Confidence is the house technique. Carry on.', 3]
    ]
  };

  // ------------------------------------------------------------------
  // Business events. Once per game hour, each owned business rolls a
  // small chance of a day event: a rush doubles its accrual for the
  // next game hour, a busy spell banks bonus hours instantly, and
  // wear and tear quietly eats some uncollected takings. Events are
  // announced, never silent, and repairs never take you negative.
  // ------------------------------------------------------------------
  var EVENTS = [
    { id: 'rush', weight: 3, text: 'is slammed — a queue out the door. Double yield for the next game hour.' },
    { id: 'busy', weight: 3, text: 'had a banner spell — bonus takings banked on the spot.' },
    { id: 'repair', weight: 2, text: 'needed a repair. The bill came out of the uncollected takings.' },
    { id: 'praise', weight: 2, text: 'got written up in the harbour paper. The crew is unbearable now.' },
    { id: 'windfall', weight: 2, text: 'got a windfall — a wedding party / film crew / very lost tour group paid in advance.' },
    { id: 'quiet', weight: 2, text: 'had a quiet hour. The crew swept, restocked, and argued about football.' }
  ];
  var EVENT_CHANCE = 0.30;   // per owned property per game hour
  var EVENT_BONUS_HOURS = 2; // 'busy' banks this many hours of yield
  var EVENT_REPAIR_MULT = 3; // 'repair' eats this many hours of yield

  // Interaction tuning.
  var TUNE = {
    markerRadius: 5.5,     // metres: on foot inside this to use a marker
    collectMin: 10,        // Enter collects when at least this is waiting
    saveEvery: 5,          // seconds between throttled persistence writes
    promptRefresh: 0.25,   // seconds between HUD prompt refreshes
    managerCostMult: 0.25, // hiring a manager costs this share of the price
    managerShare: 0.7      // managers bank this share of takings straight to cash
  };

  // ------------------------------------------------------------------
  // Synergies: some businesses feed each other. Own both halves of a
  // pair and both earn more — the bengkel sends drivers to the kiosk
  // for coffee, the kiosk sends skippers to the bengkel for repairs.
  // ------------------------------------------------------------------
  var SYNERGIES = [
    { a: 'bengkel', b: 'kios-pelabuhan', mult: 1.15,
      line: 'Harbour pair: the bengkel and the kiosk now feed each other customers (+15% yield to both).' },
    { a: 'warung-kopi', b: 'toko-kelontong', mult: 1.15,
      line: 'Retail pair: the warung buys its beans from your kelontong now (+15% yield to both).' },
    { a: 'kos-kosan', b: 'laundry', mult: 1.10,
      line: 'Heights pair: kos tenants get a laundry discount and the laundry gets twelve steady rooms (+10% yield to both).' }
  ];

  function synergyMult(propId) {
    var m = 1;
    for (var i = 0; i < SYNERGIES.length; i++) {
      var s = SYNERGIES[i];
      if (s.a !== propId && s.b !== propId) continue;
      var other = s.a === propId ? s.b : s.a;
      if (recordFor(other).owned) m *= s.mult;
    }
    return m;
  }

  function synergyFor(propId) {
    for (var i = 0; i < SYNERGIES.length; i++) {
      var s = SYNERGIES[i];
      if (s.a === propId || s.b === propId) return s;
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Per-property upgrade flavour: what "new signage" actually means
  // at a harbour kiosk is not what it means at a boarding house.
  // Indexed [propertyId][level] for levels 1..3.
  // ------------------------------------------------------------------
  var UPGRADE_FLAVOUR = {
    'warung-kopi': ['a hand-painted sign the whole street can read', 'a second barista for the morning rush', 'a roof terrace with four more stools and a view of the strait'],
    'toko-kelontong': ['a brighter sign and a bell over the door', 'a delivery boy with a very fast bicycle', 'a cold room — ice cream joins the inventory'],
    'laundry': ['a neon sign that smells faintly of lavender', 'two more machines and a folding captain', 'a full renovation: tiles, steam, and a waiting sofa'],
    'kos-kosan': ['a painted gate and a working bell', 'a caretaker who actually answers the phone', 'a renovation: fans in every room and a rooftop garden'],
    'kios-pelabuhan': ['a tarpaulin awning in harbour orange', 'a night keeper with a kettle that never empties', 'a renovation: glass front, cold drinks, and a radio that picks up ships'],
    'bengkel': ['a sign visible from the bridge ramp', 'a second mechanic and a proper parts shelf', 'a full renovation: second lift, clean floor, zero sticking']
  };

  // ------------------------------------------------------------------
  // Persistent state. One record per property id, created lazily:
  //   { owned, level, uncollected, pitched }
  // plus portfolio totals that survive even if a record is reset.
  // ------------------------------------------------------------------
  var records = {};
  var portfolio = {
    invested: 0,   // lifetime dollars spent on purchases + upgrades
    collected: 0,  // lifetime dollars collected from yields
    crowned: false // the all-six, all-renovated endgame was celebrated
  };

  function recordFor(id) {
    if (!records[id]) {
      records[id] = { owned: false, level: 0, uncollected: 0, pitched: false, rushLeft: 0, managed: false, insured: false, greeted: false };
    }
    return records[id];
  }

  function loadState() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return;
      if (d.records && typeof d.records === 'object') {
        for (var id in d.records) {
          if (!Object.prototype.hasOwnProperty.call(d.records, id)) continue;
          var src = d.records[id];
          var rec = recordFor(id);
          rec.owned = !!src.owned;
          if (Number.isFinite(src.level)) rec.level = Math.max(0, Math.min(MAX_LEVEL, Math.floor(src.level)));
          if (Number.isFinite(src.uncollected)) rec.uncollected = Math.max(0, src.uncollected);
          if (Number.isFinite(src.rushLeft)) rec.rushLeft = Math.max(0, src.rushLeft);
          rec.pitched = !!src.pitched;
          rec.managed = !!src.managed;
          rec.insured = !!src.insured;
          rec.greeted = !!src.greeted;
        }
      }
      if (d.portfolio && typeof d.portfolio === 'object') {
        if (Number.isFinite(d.portfolio.invested)) portfolio.invested = d.portfolio.invested;
        if (Number.isFinite(d.portfolio.collected)) portfolio.collected = d.portfolio.collected;
        portfolio.crowned = !!d.portfolio.crowned;
      }
    } catch (e) { /* storage unavailable: run session-only */ }
  }

  var dirty = false;
  var saveT = 0;
  function saveState() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ records: records, portfolio: portfolio }));
      dirty = false;
    } catch (e) { /* ignore */ }
  }
  function markDirty() { dirty = true; }

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
  function yieldNow(prop, rec) {
    return prop.yieldPerHour * UPGRADES[rec.level].yieldMult * synergyMult(prop.id);
  }

  function upgradeFlavour(prop, level) {
    var list = UPGRADE_FLAVOUR[prop.id];
    if (list && list[level - 1]) return list[level - 1];
    return UPGRADES[level].name;
  }
  function upgradeCost(prop, rec) {
    if (rec.level >= MAX_LEVEL) return 0;
    return Math.round(prop.price * UPGRADES[rec.level + 1].costMult);
  }
  function ownedCount() {
    var n = 0;
    for (var i = 0; i < PROPERTIES.length; i++) {
      if (recordFor(PROPERTIES[i].id).owned) n++;
    }
    return n;
  }

  // ------------------------------------------------------------------
  // Markers. One pillar per property, alive for the whole session:
  // gold while it is for sale, green once it is yours. The beam's
  // colour is swapped on purchase rather than rebuilding the marker.
  // ------------------------------------------------------------------
  var COLOR_SALE = 0xffd23f;
  var COLOR_OWNED = 0x51d88a;

  function makeMarker(prop) {
    var scene = SH.Main && SH.Main.getScene ? SH.Main.getScene() : null;
    if (!scene || typeof THREE === 'undefined') return null;
    var y = groundY(prop.x, prop.z);
    var group = new THREE.Group();
    var geo = new THREE.CylinderGeometry(1.5, 1.5, 13, 18, 1, true);
    var mat = new THREE.MeshBasicMaterial({
      color: COLOR_SALE, transparent: true, opacity: 0.30,
      side: THREE.DoubleSide, depthWrite: false
    });
    var beam = new THREE.Mesh(geo, mat);
    beam.position.y = 6.5;
    group.add(beam);
    var ringGeo = new THREE.RingGeometry(1.7, 2.4, 26);
    var ringMat = new THREE.MeshBasicMaterial({
      color: COLOR_SALE, transparent: true, opacity: 0.7,
      side: THREE.DoubleSide, depthWrite: false
    });
    var ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    group.add(ring);
    group.position.set(prop.x, y, prop.z);
    scene.add(group);
    return { group: group, beam: beam, mat: mat, ringMat: ringMat, t: Math.random() * 6 };
  }

  // Colour says whose it is; height says how far it has come. Each
  // upgrade level stretches the beam a quarter taller, so a renovated
  // business literally stands taller on its street.
  function paintMarker(m, owned, level) {
    if (!m) return;
    var c = owned ? COLOR_OWNED : COLOR_SALE;
    m.mat.color.setHex(c);
    m.ringMat.color.setHex(c);
    if (m.beam) {
      var h = 1 + (owned ? (level || 0) * 0.25 : 0);
      m.beam.scale.y = h;
      m.beam.position.y = 6.5 * h;
    }
  }

  function pulseMarker(m, dt) {
    if (!m) return;
    m.t += dt;
    m.mat.opacity = 0.26 + 0.09 * (0.5 + 0.5 * Math.sin(m.t * 2.6));
    m.ringMat.opacity = 0.5 + 0.3 * (0.5 + 0.5 * Math.sin(m.t * 2.6 + 0.9));
  }

  var markers = {}; // property id -> marker

  // ------------------------------------------------------------------
  // Transactions.
  // ------------------------------------------------------------------
  function buyProperty(prop, rec) {
    if (!SH.Economy || !SH.Economy.spend(prop.price)) {
      notify(prop.name + ' costs ' + fmtMoney(prop.price) + ' — you are short. The sign stays gold.');
      return;
    }
    rec.owned = true;
    rec.level = 0;
    rec.uncollected = 0;
    portfolio.invested += prop.price;
    markDirty();
    saveState();
    paintMarker(markers[prop.id], true, rec.level);
    notify('Selatara Ventures — you now own ' + prop.name + ' (' + prop.district + '). It earns ' +
      fmtMoney(prop.yieldPerHour) + ' per game hour.');
    // The seller's ledger moment: once per property, ever.
    if (!rec.pitched) {
      rec.pitched = true;
      markDirty();
      if (typeof Dialog !== 'undefined' && Dialog && Dialog.play) Dialog.play(prop.pitch);
    }
    var n = ownedCount();
    if (n === PROPERTIES.length) {
      notify('Portfolio complete: all six Selatara businesses are yours. The strait works for you now.');
    } else if (n === 3) {
      if (typeof Dialog !== 'undefined' && Dialog && Dialog.play) Dialog.play(MILESTONE_3);
    } else if (n === 1) {
      notify('First business owned. Come back to its green pillar to collect the takings.');
    }
    // Completing a synergy pair is worth announcing the moment it lands.
    var syn = synergyFor(prop.id);
    if (syn) {
      var otherId = syn.a === prop.id ? syn.b : syn.a;
      if (recordFor(otherId).owned) notify(syn.line);
    }
    checkCrowned();
  }

  function collectYield(prop, rec) {
    var amount = Math.floor(rec.uncollected);
    if (amount <= 0) return;
    rec.uncollected -= amount;
    portfolio.collected += amount;
    markDirty();
    saveState();
    if (SH.Economy) SH.Economy.addCash(amount);
    notify(prop.name + ' — collected ' + fmtMoney(amount) + ' in takings. ' +
      'Lifetime collected: ' + fmtMoney(portfolio.collected) + '.');
  }

  function buyUpgrade(prop, rec) {
    var cost = upgradeCost(prop, rec);
    if (cost <= 0) return;
    if (!SH.Economy || !SH.Economy.spend(cost)) {
      notify('Upgrade to "' + UPGRADES[rec.level + 1].name + '" costs ' + fmtMoney(cost) + ' — not enough cash yet.');
      return;
    }
    rec.level++;
    portfolio.invested += cost;
    markDirty();
    saveState();
    paintMarker(markers[prop.id], true, rec.level);
    notify(prop.name + ' upgraded: ' + upgradeFlavour(prop, rec.level) + '. Yield is now ' +
      fmtMoney(yieldNow(prop, rec)) + ' per game hour.');
    checkCrowned();
  }

  // Hiring a manager: a one-off fee, after which the business banks
  // most of its takings straight into your cash every game hour. The
  // rest still waits at the pillar — managers skim nothing, but the
  // petty-cash tin is sacred and stays on site.
  function hireManager(prop, rec) {
    var cost = Math.round(prop.price * TUNE.managerCostMult);
    if (!SH.Economy || !SH.Economy.spend(cost)) {
      notify('A manager for ' + prop.name + ' costs ' + fmtMoney(cost) + ' — not enough cash yet.');
      return;
    }
    rec.managed = true;
    portfolio.invested += cost;
    markDirty();
    saveState();
    notify(prop.name + ' now has a manager. Most takings will reach your pocket on their own, every game hour.');
    var fl = FLAVOUR[prop.id];
    if (fl) notify(fl.crew);
  }

  function managerCost(prop) {
    return Math.round(prop.price * TUNE.managerCostMult);
  }

  function buyInsurance(prop, rec) {
    if (!SH.Economy || !SH.Economy.spend(INSURANCE_COST)) {
      notify('Insurance for ' + prop.name + ' costs ' + fmtMoney(INSURANCE_COST) + ' — the man with the stamp waits.');
      return;
    }
    rec.insured = true;
    portfolio.invested += INSURANCE_COST;
    markDirty();
    saveState();
    notify(prop.name + ' is insured against one repair. The stamp is very official. The man is less so.');
  }

  // The endgame check: all six owned, all fully renovated. Called
  // after purchases and upgrades; fires exactly once, ever.
  function checkCrowned() {
    if (portfolio.crowned) return;
    for (var i = 0; i < PROPERTIES.length; i++) {
      var rec = recordFor(PROPERTIES[i].id);
      if (!rec.owned || rec.level < MAX_LEVEL) return;
    }
    portfolio.crowned = true;
    markDirty();
    saveState();
    if (SH.Economy) SH.Economy.addCash(1000);
    notify('SELATARA VENTURES IS AN INSTITUTION — six businesses, all renovated. ' +
      'The harbour paper runs your photo. The city adds a ' + fmtMoney(1000) + ' civic bonus, mostly in respect, partly in cash.');
  }

  // What a single Enter press at this marker will do, and the prompt
  // line that promises exactly that. Priority: buy > collect > upgrade.
  function markerAction(prop, rec) {
    if (!rec.owned) {
      return {
        verb: 'buy',
        prompt: prop.name + ' — ' + fmtMoney(prop.price) + ' • yields ' + fmtMoney(prop.yieldPerHour) +
          '/hr • Enter: buy'
      };
    }
    if (rec.uncollected >= TUNE.collectMin) {
      return {
        verb: 'collect',
        prompt: prop.name + ' (Lv ' + rec.level + ') — ' + fmtMoney(rec.uncollected) +
          ' waiting • Enter: collect'
      };
    }
    if (rec.level < MAX_LEVEL) {
      return {
        verb: 'upgrade',
        prompt: prop.name + ' (Lv ' + rec.level + ') — Enter: upgrade (' +
          upgradeFlavour(prop, rec.level + 1) + ') for ' + fmtMoney(upgradeCost(prop, rec)) +
          ' (' + fmtMoney(yieldNow(prop, { level: rec.level + 1, owned: true })) + '/hr)'
      };
    }
    var fl = FLAVOUR[prop.id];
    var look = (Math.floor(SH.State.time / 8) % 2 === 0) ? (fl ? fl.inspect : '') : (SECOND_LOOK[prop.id] || '');
    return {
      verb: 'none',
      prompt: prop.name + ' (Lv ' + rec.level + ', fully upgraded) — ' +
        fmtMoney(rec.uncollected) + ' accrued so far. ' + look
    };
  }

  // Second looks: what you notice at your own business once the
  // greeting is done and it is simply yours, working. Rotated into
  // the idle prompt alongside the first inspect line.
  var SECOND_LOOK = {
    'warung-kopi': 'A delivery of beans leans by the door, already half claimed by regulars.',
    'toko-kelontong': 'Somebody\'s kid is doing homework on the counter, entirely at home.',
    'laundry': 'A line of shirts turns slowly in the window steam like flags.',
    'kos-kosan': 'Music from two rooms, one argument about music from a third.',
    'kios-pelabuhan': 'The gossip ledger by the till is thicker than the cash ledger.',
    'bengkel': 'A taxi sleeps on the lift, dreaming of better roads.'
  };

  // ------------------------------------------------------------------
  // Accrual. Yield is banked continuously in game time: Config.day
  // says minutesPerSecond game minutes pass per real second, so the
  // game-hours inside dt seconds of play are dt * mps / 60.
  // A property inside a 'rush' event banks double while it lasts.
  // ------------------------------------------------------------------
  var eventClock = 0;   // game hours accumulated toward the next event roll
  var dayGain = 0;      // yield banked since the last day rollover
  var lastHour = -1;    // SH.State.hour seen last frame (rollover watch)
  var noticeClock = 0;  // game hours toward the next collection-round nudge

  // Every few game hours, if the tills across the portfolio are
  // holding real money, say so once. Landlords who forget to collect
  // are just donors with paperwork.
  function collectionNudge(gameHours) {
    noticeClock += gameHours;
    if (noticeClock < 3) return;
    noticeClock = 0;
    var waiting = 0, richest = null, richestAmt = 0;
    for (var i = 0; i < PROPERTIES.length; i++) {
      var rec = recordFor(PROPERTIES[i].id);
      if (!rec.owned) continue;
      waiting += rec.uncollected;
      if (rec.uncollected > richestAmt) { richestAmt = rec.uncollected; richest = PROPERTIES[i]; }
    }
    if (waiting >= 500 && richest) {
      notify('Selatara Ventures — your businesses are holding ' + fmtMoney(waiting) +
        ' in uncollected takings. The fullest till: ' + richest.name + ' (' + fmtMoney(richestAmt) + ').');
    }
  }

  function accrue(dt) {
    var mps = (SH.Config && SH.Config.day && SH.Config.day.minutesPerSecond) || 1.6;
    var gameHours = dt * mps / 60;
    var changed = false;
    for (var i = 0; i < PROPERTIES.length; i++) {
      var rec = recordFor(PROPERTIES[i].id);
      if (!rec.owned) continue;
      var mult = rec.rushLeft > 0 ? 2 : 1;
      if (rec.rushLeft > 0) {
        rec.rushLeft = Math.max(0, rec.rushLeft - gameHours);
        changed = true;
      }
      var before = rec.uncollected;
      var gain = yieldNow(PROPERTIES[i], rec) * gameHours * mult;
      rec.uncollected += gain;
      dayGain += gain;
      if (Math.floor(rec.uncollected) !== Math.floor(before)) changed = true;
    }
    if (changed) markDirty();
    // Event rolls tick on whole game hours of portfolio time.
    eventClock += gameHours;
    while (eventClock >= 1) {
      eventClock -= 1;
      rollEvents();
    }
    collectionNudge(gameHours);
    watchDayRollover();
  }

  function rollEvents() {
    // Managers settle up first: their share of every managed till
    // moves to your cash before the hour's chaos gets a say.
    var managedTotal = 0;
    for (var m = 0; m < PROPERTIES.length; m++) {
      var mrec = recordFor(PROPERTIES[m].id);
      if (!mrec.owned || !mrec.managed) continue;
      var share = Math.floor(mrec.uncollected * TUNE.managerShare);
      if (share > 0) {
        mrec.uncollected -= share;
        portfolio.collected += share;
        managedTotal += share;
        markDirty();
      }
    }
    if (managedTotal > 0 && SH.Economy) {
      SH.Economy.addCash(managedTotal);
      notify('Your managers banked ' + fmtMoney(managedTotal) + ' across the portfolio.');
    }
    for (var i = 0; i < PROPERTIES.length; i++) {
      var prop = PROPERTIES[i];
      var rec = recordFor(prop.id);
      if (!rec.owned) continue;
      if (Math.random() > EVENT_CHANCE) continue;
      var total = 0, j;
      for (j = 0; j < EVENTS.length; j++) total += EVENTS[j].weight;
      var r = Math.random() * total;
      var ev = EVENTS[0];
      for (j = 0; j < EVENTS.length; j++) { r -= EVENTS[j].weight; if (r <= 0) { ev = EVENTS[j]; break; } }
      applyEvent(prop, rec, ev);
    }
  }

  function applyEvent(prop, rec, ev) {
    var y = yieldNow(prop, rec);
    if (ev.id === 'rush') {
      rec.rushLeft = 1;
      notify(prop.name + ' ' + ev.text);
    } else if (ev.id === 'busy') {
      var bonus = Math.round(y * EVENT_BONUS_HOURS);
      rec.uncollected += bonus;
      dayGain += bonus;
      notify(prop.name + ' ' + ev.text + ' (+' + fmtMoney(bonus) + ')');
    } else if (ev.id === 'windfall') {
      var gift = Math.round(y * 4);
      rec.uncollected += gift;
      dayGain += gift;
      notify(prop.name + ' ' + ev.text + ' (+' + fmtMoney(gift) + ')');
    } else if (ev.id === 'repair') {
      if (rec.insured) {
        rec.insured = false;
        notify(prop.name + ' needed a repair — the insurance stamp earned its drawer. (Policy used; renew with I at the marker.)');
      } else {
        var bill = Math.min(rec.uncollected, Math.round(y * EVENT_REPAIR_MULT));
        if (bill > 0) {
          rec.uncollected -= bill;
          notify(prop.name + ' ' + ev.text + ' (-' + fmtMoney(bill) + ')');
        } else {
          notify(prop.name + ' needed a repair, but the till was empty — the crew covered it in labour.');
        }
      }
    } else {
      notify(prop.name + ' ' + ev.text);
    }
    markDirty();
  }

  // When the city clock wraps past midnight, read the day's ledger
  // aloud: how much the portfolio banked while you were busy being
  // the protagonist.
  function watchDayRollover() {
    var st = SH.State;
    if (typeof st.hour !== 'number') return;
    if (lastHour >= 0 && st.hour < lastHour - 12) {
      if (ownedCount() > 0 && dayGain >= 1) {
        notify('Selatara Ventures — yesterday your businesses banked ' + fmtMoney(dayGain) +
          '. It is still sitting at their pillars, waiting to be collected.');
      }
      dayGain = 0;
    }
    lastHour = st.hour;
  }

  // ------------------------------------------------------------------
  // Interaction update: nearest marker on foot wins the prompt.
  // ------------------------------------------------------------------
  var nearId = null;
  var promptT = 0;
  var flipT = 0;      // seconds until the for-sale prompt flips to the come-on
  var flipShow = false;

  function updateInteraction(dt) {
    var st = SH.State;
    if (st.driving) {
      if (nearId !== null) { nearId = null; setPrompt(null); }
      return;
    }
    var p = st.player;
    var best = null, bestRec = null, bd = Infinity;
    for (var i = 0; i < PROPERTIES.length; i++) {
      var prop = PROPERTIES[i];
      var d = dist2d(p.x, p.z, prop.x, prop.z);
      if (d <= TUNE.markerRadius && d < bd) { bd = d; best = prop; bestRec = recordFor(prop.id); }
    }
    if (!best) {
      if (nearId !== null) { nearId = null; setPrompt(null); }
      return;
    }
    // The crew greets its owner exactly once.
    if (bestRec.owned && !bestRec.greeted) {
      bestRec.greeted = true;
      markDirty();
      var greet = GREETINGS[best.id];
      if (greet && typeof Dialog !== 'undefined' && Dialog && Dialog.play) Dialog.play(greet);
    }
    var action = markerAction(best, bestRec);
    promptT -= dt;
    flipT -= dt;
    if (flipT <= 0) { flipT = 4; flipShow = !flipShow; promptT = 0; }
    if (nearId !== best.id || promptT <= 0) {
      nearId = best.id;
      promptT = TUNE.promptRefresh;
      var line = action.prompt;
      if (!bestRec.owned && flipShow && COME_ONS[best.id]) {
        line = COME_ONS[best.id] + ' (' + fmtMoney(best.price) + ' • Enter: buy)';
      }
      if (bestRec.owned && !bestRec.managed) {
        line += ' • H: hire a manager (' + fmtMoney(managerCost(best)) + ')';
      } else if (bestRec.owned && bestRec.managed) {
        line += ' • managed';
      }
      if (bestRec.owned && !bestRec.insured) {
        line += ' • I: insure (' + fmtMoney(INSURANCE_COST) + ')';
      } else if (bestRec.owned && bestRec.insured) {
        line += ' • insured';
      }
      setPrompt(line);
    }
    if (SH.Input && SH.Input.wasPressed('Enter')) {
      if (action.verb === 'buy') buyProperty(best, bestRec);
      else if (action.verb === 'collect') collectYield(best, bestRec);
      else if (action.verb === 'upgrade') buyUpgrade(best, bestRec);
      promptT = 0; // re-render the prompt with the new state at once
    }
    if (bestRec.owned && !bestRec.managed && SH.Input && SH.Input.wasPressed('KeyH')) {
      hireManager(best, bestRec);
      promptT = 0;
    }
    if (bestRec.owned && !bestRec.insured && SH.Input && SH.Input.wasPressed('KeyI')) {
      buyInsurance(best, bestRec);
      promptT = 0;
    }
  }

  // ------------------------------------------------------------------
  // Module face.
  // ------------------------------------------------------------------
  var Property = {
    init: function () {
      loadState();
      for (var i = 0; i < PROPERTIES.length; i++) {
        var prop = PROPERTIES[i];
        markers[prop.id] = makeMarker(prop);
        var rec = recordFor(prop.id);
        paintMarker(markers[prop.id], rec.owned, rec.level);
      }
    },
    update: function (dt) {
      if (!dt || dt <= 0) return;
      var st = SH.State;
      if (!st || st.mode !== 'playing') return;
      for (var id in markers) {
        if (Object.prototype.hasOwnProperty.call(markers, id)) pulseMarker(markers[id], dt);
      }
      accrue(dt);
      updateInteraction(dt);
      if (dirty) {
        saveT -= dt;
        if (saveT <= 0) { saveT = TUNE.saveEvery; saveState(); }
      }
    },
    // One-line portfolio summary for the HUD/debug curious.
    summary: function () {
      var n = ownedCount();
      var waiting = 0;
      var value = 0;   // rough resale value: price grown by upgrades
      var hourly = 0;  // current total yield per game hour
      for (var i = 0; i < PROPERTIES.length; i++) {
        var rec = recordFor(PROPERTIES[i].id);
        if (!rec.owned) continue;
        waiting += rec.uncollected;
        value += Math.round(PROPERTIES[i].price * (0.7 + 0.45 * rec.level) * synergyMult(PROPERTIES[i].id));
        hourly += yieldNow(PROPERTIES[i], rec);
      }
      return 'Selatara Ventures — own ' + n + '/6, invested ' + fmtMoney(portfolio.invested) +
        ', collected ' + fmtMoney(portfolio.collected) + ', ' + fmtMoney(waiting) +
        ' waiting, ' + fmtMoney(dayGain) + ' banked today, portfolio worth about ' +
        fmtMoney(value) + ' earning ' + fmtMoney(hourly) + '/hr';
    }
  };

  SH.Property = Property;
})(window.SH = window.SH || {});
