// SELATARA HEAT — collect.js
// "Titik Vista": twelve glowing vantage points scattered over the city
// and both islands — rooftops' edges, pier ends, hill brows, the far
// shores. Walk or drive within four metres of one and it is yours: a
// ring of light bursts, the tally climbs, and the set persists in a
// private localStorage key. Find all twelve and Selatara pays a bonus
// through SH.Economy.addCash, with a word from Mami Ratna.
// The per-frame cost is twelve squared-distance checks and a pulse
// update — nothing in here may ever touch the frame budget.
// Public API: SH.Collect { init(), update(dt), foundCount(), total(),
//   isFound(i), remaining() }.
(function (SH) {
  'use strict';

  // ---------------------------------------------------------------------
  // The twelve vistas. Coordinates are world metres on the same map
  // the Config describes: districts on the mainland grid, the beach
  // along z ~ 240, Pulau Seberang across the bay at (430, 452) and
  // Pulau Karang Kecil in the west at (-330, 420).
  // ---------------------------------------------------------------------

  var VISTAS = [
    { name: 'Pelita Skyline Deck', x: 0, z: -300, blurb: 'The whole tower grid, laid out like a circuit board.' },
    { name: 'Taman Arus Fountain', x: 40, z: 120, blurb: 'The park breathes in the middle of the noise.' },
    { name: 'Kencana Beach Steps', x: -120, z: 238, blurb: 'Golden hour does all the work here.' },
    { name: 'Karat Crane Lookout', x: 420, z: 120, blurb: 'Containers stacked like a second skyline.' },
    { name: 'Bukit Mawar Rose Hill', x: 360, z: -240, blurb: 'Quiet streets, expensive silence.' },
    { name: 'Ruko Senja Market Roof', x: -360, z: -60, blurb: 'A hundred stalls, one smell: chilli and rain.' },
    { name: 'Pulau Seberang Far Shore', x: 430, z: 452, blurb: 'The city looks small enough to forgive from here.' },
    { name: 'Pulau Karang Kecil Rock', x: -330, z: 420, blurb: 'A rock, a causeway, and the whole strait.' },
    { name: 'Downtown Neon Crossing', x: 120, z: -180, blurb: 'Neon on wet asphalt — Selatara showing off.' },
    { name: 'Harbour South Pier', x: 300, z: 232, blurb: 'Where the ferries argue with the tide.' },
    { name: 'West Shore Palms', x: -470, z: 150, blurb: 'The last palms before the road gives up.' },
    { name: 'Ring Road East Rise', x: 505, z: -20, blurb: 'The ring road bends and the bay opens up.' }
  ];

  var TOTAL = VISTAS.length;
  var COLLECT_R2 = 16;          // 4 m collection radius, squared
  var COMPLETION_BONUS = 1500;  // paid once, when the set completes
  var SPARKLE_TIME = 0.85;      // seconds a collection burst lives

  // ---------------------------------------------------------------------
  // Persistence: one private key holding the found flags and whether
  // the completion bonus has already been paid (it must never pay
  // twice, even across save-file resets of the main game).
  // ---------------------------------------------------------------------

  var SAVE_KEY = 'selatara-heat-vistas-v1';
  var found = [];
  var bonusPaid = false;
  for (var fi = 0; fi < TOTAL; fi++) found.push(false);

  function loadStore() {
    try {
      var raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return;
      if (Array.isArray(data.found)) {
        for (var i = 0; i < TOTAL; i++) found[i] = data.found[i] === true;
      }
      bonusPaid = data.bonusPaid === true;
    } catch (e) { /* storage unavailable: the hunt restarts each visit */ }
  }

  function saveStore() {
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify({
        found: found, bonusPaid: bonusPaid
      }));
    } catch (e) { /* storage unavailable: best effort only */ }
  }

  function foundCount() {
    var n = 0;
    for (var i = 0; i < TOTAL; i++) if (found[i]) n++;
    return n;
  }

  // 8-wind compass label for a world delta (+z is south, +x is east —
  // the same bearing convention the rest of the game steers by).
  var WINDS = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'];
  function compass(dx, dz) {
    var deg = Math.atan2(dx, dz) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    return WINDS[Math.round(deg / 45) % 8];
  }

  // The nearest still-unfound vista to a world point, or null when
  // the set is complete. Squared distances until the single sqrt at
  // the end — this runs once per frame at most.
  function nearestUnfound(x, z) {
    var best = -1, bestD2 = Infinity;
    for (var i = 0; i < TOTAL; i++) {
      if (found[i]) continue;
      var dx = x - VISTAS[i].x, dz = z - VISTAS[i].z;
      var d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = i; }
    }
    if (best < 0) return null;
    return { index: best, vista: VISTAS[best], dist: Math.sqrt(bestD2) };
  }

  // ---------------------------------------------------------------------
  // Scene dressing. Each vista is a small group: a bobbing sphere of
  // light, a slim beam so it can be spotted across a district, and a
  // flat ring marking the exact ground you have to touch. Found
  // vistas are hidden outright — the city keeps no trophies on show.
  // ---------------------------------------------------------------------

  var C = {
    built: false,
    groups: [],   // [{ group, sphere, beam, ring, phase }]
    sparks: [],   // live sparkle effects [{ ring, sphere, t }]
    nearTold: []  // vista indices whose proximity whisper already fired
  };
  for (var ni = 0; ni < TOTAL; ni++) C.nearTold.push(false);

  var NEAR_RADIUS = 60;   // metres: the proximity whisper distance
  var NEAR_RESET = 85;    // metres: leaving this far re-arms the whisper

  var SPHERE_COLOR = 0xffd23f;
  var RING_COLOR = 0x37e0ff;

  function buildOne(vista, idx) {
    var gy = SH.World.groundHeightAt(vista.x, vista.z);
    var group = new THREE.Group();
    var sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.85, 18, 14),
      new THREE.MeshBasicMaterial({
        color: SPHERE_COLOR, transparent: true, opacity: 0.92,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    sphere.position.y = 1.7;
    var beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 15, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: SPHERE_COLOR, transparent: true, opacity: 0.16,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    beam.position.y = 7.5;
    var ring = new THREE.Mesh(
      new THREE.RingGeometry(2.3, 3.1, 36),
      new THREE.MeshBasicMaterial({
        color: RING_COLOR, transparent: true, opacity: 0.7,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.16;
    group.add(sphere); group.add(beam); group.add(ring);
    group.position.set(vista.x, gy, vista.z);
    var entry = { group: group, sphere: sphere, beam: beam, ring: ring, phase: idx * 0.83, claimed: false };
    // A vista found in an earlier session starts in its claimed look:
    // no beam, no ring, just the ember left behind (see applyClaimed).
    if (found[idx]) applyClaimed(entry);
    return entry;
  }

  // The claimed look: the light show is over, but the spot keeps a
  // small dim ember so coming back here later still reads as "yours"
  // instead of empty ground. Pure cosmetics — collection state lives
  // in the found[] flags, never in these materials.
  function applyClaimed(entry) {
    entry.claimed = true;
    entry.beam.visible = false;
    entry.ring.visible = false;
    entry.sphere.scale.set(0.35, 0.35, 0.35);
    entry.sphere.position.y = 0.6;
    entry.sphere.material.opacity = 0.18;
  }

  function buildAll() {
    var scene = SH.Main && SH.Main.getScene ? SH.Main.getScene() : null;
    if (!scene || !window.THREE) return false;
    for (var i = 0; i < TOTAL; i++) {
      var entry = buildOne(VISTAS[i], i);
      scene.add(entry.group);
      C.groups.push(entry);
    }
    C.built = true;
    return true;
  }

  // ---------------------------------------------------------------------
  // The collection sparkle: the vista's own sphere balloons and fades
  // while a shockwave ring runs out across the ground. Two meshes, one
  // timer, no allocations after the burst is spawned.
  // ---------------------------------------------------------------------

  function spawnSparkle(vista) {
    var scene = SH.Main.getScene();
    if (!scene) return;
    var gy = SH.World.groundHeightAt(vista.x, vista.z);
    var sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 14, 10),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    sphere.position.set(vista.x, gy + 1.7, vista.z);
    var ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.25, 36),
      new THREE.MeshBasicMaterial({
        color: SPHERE_COLOR, transparent: true, opacity: 0.9,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(vista.x, gy + 0.22, vista.z);
    scene.add(sphere); scene.add(ring);
    C.sparks.push({ sphere: sphere, ring: ring, t: 0 });
  }

  function updateSparks(dt) {
    for (var i = C.sparks.length - 1; i >= 0; i--) {
      var s = C.sparks[i];
      s.t += dt;
      var k = s.t / SPARKLE_TIME;
      if (k >= 1) {
        var scene = SH.Main.getScene();
        if (scene) { scene.remove(s.sphere); scene.remove(s.ring); }
        s.sphere.geometry.dispose();
        s.ring.geometry.dispose();
        s.sphere.material.dispose();
        s.ring.material.dispose();
        C.sparks.splice(i, 1);
        continue;
      }
      var ease = 1 - (1 - k) * (1 - k);
      var rs = 1 + ease * 7.5;
      s.ring.scale.set(rs, rs, rs);
      s.ring.material.opacity = 0.9 * (1 - k);
      var ss = 1 + ease * 2.6;
      s.sphere.scale.set(ss, ss, ss);
      s.sphere.material.opacity = 0.95 * (1 - k);
    }
  }

  // ---------------------------------------------------------------------
  // Collection itself.
  // ---------------------------------------------------------------------

  function collect(idx) {
    found[idx] = true;
    saveStore();
    var vista = VISTAS[idx];
    if (C.groups[idx]) applyClaimed(C.groups[idx]);
    spawnSparkle(vista);
    var n = foundCount();
    if (SH.HUD) SH.HUD.notify('Vista ' + n + '/' + TOTAL + ' — ' + vista.name);
    // Milestones keep the long hunt feeling paced: a third, two
    // thirds, and the clean sweep each get their own line.
    if (SH.HUD && n === 4) SH.HUD.notify('A third of Selatara seen. The rest is out there.');
    if (SH.HUD && n === 8) SH.HUD.notify('Two thirds of Selatara seen — four vistas left.');
    if (window.Dialog && Dialog.play && (n === 1 || n === 6)) {
      Dialog.play([['Raka', vista.blurb, 2.8]]);
    }
    if (n >= TOTAL && !bonusPaid) {
      bonusPaid = true;
      saveStore();
      if (SH.Economy) SH.Economy.addCash(COMPLETION_BONUS);
      if (SH.HUD) SH.HUD.notify('All ' + TOTAL + ' vistas found — bonus $' + COMPLETION_BONUS + '!');
      if (window.Dialog && Dialog.play) {
        Dialog.play([
          ['Mami Ratna', 'Every vista in Selatara. You have officially seen more of this city than the mayor.', 3.6],
          ['Raka', 'Worth every detour, Mami.', 2.4]
        ]);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Frame entry: pulse the living vistas, run the sparkles, and test
  // the player's focus point against the unfound set. Squared
  // distances only; found vistas cost one boolean each.
  // ---------------------------------------------------------------------

  function update(dt) {
    if (!C.built) { if (!buildAll()) return; }
    var st = SH.State;
    updateSparks(dt);
    if (st.mode !== 'playing') return;
    var t = st.time || 0;
    var i, entry;
    for (i = 0; i < TOTAL; i++) {
      if (found[i]) continue;
      entry = C.groups[i];
      if (!entry) continue;
      var pulse = 0.5 + 0.5 * Math.sin(t * 2.3 + entry.phase);
      entry.sphere.position.y = 1.7 + 0.28 * Math.sin(t * 1.6 + entry.phase);
      var s = 1 + 0.16 * pulse;
      entry.sphere.scale.set(s, s, s);
      entry.beam.material.opacity = 0.10 + 0.10 * pulse;
      entry.ring.material.opacity = 0.45 + 0.35 * pulse;
    }
    if (foundCount() >= TOTAL) return;
    var f = st.driving ? st.vehiclePos : st.player;
    for (i = 0; i < TOTAL; i++) {
      if (found[i]) continue;
      var v = VISTAS[i];
      var dx = f.x - v.x, dz = f.z - v.z;
      if (dx * dx + dz * dz < COLLECT_R2) {
        collect(i);
        break; // one vista per frame is plenty
      }
    }
    // Proximity whisper: the first time the player strays within
    // NEAR_RADIUS of an unfound vista, say so once — name, distance,
    // bearing. Drifting beyond NEAR_RESET re-arms it, so a vista you
    // drove past an hour ago can call out again on the way back.
    var near = nearestUnfound(f.x, f.z);
    if (near) {
      if (near.dist < NEAR_RADIUS && !C.nearTold[near.index]) {
        C.nearTold[near.index] = true;
        if (SH.HUD) {
          SH.HUD.notify('Vista nearby — ' + near.vista.name + ', ' +
            Math.round(near.dist) + ' m ' + compass(near.vista.x - f.x, near.vista.z - f.z));
        }
      }
      if (near.dist > NEAR_RESET) C.nearTold[near.index] = false;
    }
  }

  function init() {
    loadStore();
    buildAll();
  }

  SH.Collect = {
    init: init,
    update: update,
    vistas: VISTAS,
    foundCount: foundCount,
    total: function () { return TOTAL; },
    isFound: function (i) { return !!found[i]; },
    remaining: function () { return TOTAL - foundCount(); },
    nearest: function () {
      var st = SH.State;
      var f = st.driving ? st.vehiclePos : st.player;
      return nearestUnfound(f.x, f.z);
    },
    bonusPaid: function () { return bonusPaid; }
  };
})(window.SH = window.SH || {});
