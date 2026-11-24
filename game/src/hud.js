// SELATARA HEAT — hud.js
// The in-game HUD as DOM over the canvas: cash, clock, wanted stars, health /
// armour bars, weapon + ammo or driving speedometer, objective panel,
// notification queue, subtitles, interaction prompt, 3D objective marker.
// Everything here is DOM, never canvas-drawn: text stays crisp at any
// resolution and the WebGL canvas remains purely the 3D view.
// Public API: SH.HUD { init(), refresh(), notify(text), setPrompt(text), showDistrict(name), subtitle(name, text, seconds), flashCash(n) }.
(function (SH) {
  'use strict';

  var el = {};
  var displayedCash = 0, cashFlash = 0, cashFlashSign = 0;
  var notifications = [];
  var subtitleTimer = 0, bannerTimer = 0, hitmarkTimer = 0;
  var projV = null;
  // HUD REDESIGN (2026-11-23) display-side fade state: the arsenal
  // strip shows for 2 s after a switch, the weapon cluster dims to
  // 35% after 4 s without a change, the HP/armour arcs dim while
  // health sits full, the radio line fades 4 s after a track change.
  // All timers run on the same 1/60 refresh step as the others and
  // touch nothing but classes/opacity — no game state is read or
  // written beyond what refresh already read.
  var slotsTimer = 0, weapSig = null, weapIdle = 0, hpIdle = 0, radioSig = null, radioTimer = 0;

  function byId(id) { return document.getElementById(id); }

  // Weapon silhouettes for the weapon card + arsenal strip (flat
  // side profiles in the game's own blocky style; decorative shapes
  // only — every number on the card is live Combat state).
  var WEAPON_ICONS = {
    fist: '<svg viewBox="0 0 48 16"><circle cx="15" cy="5.5" r="3.2"/><circle cx="21.5" cy="4.6" r="3.4"/><circle cx="28" cy="4.6" r="3.4"/><circle cx="34" cy="5.5" r="3.2"/><rect x="11" y="6" width="27" height="7" rx="3"/><circle cx="39.5" cy="10" r="2.8"/></svg>',
    pistol: '<svg viewBox="0 0 48 16"><rect x="3" y="4.6" width="27" height="3.6" rx="1"/><rect x="29" y="5.4" width="5" height="2"/><rect x="3" y="2.8" width="4" height="2"/><path d="M13 8.2h6.4L17.6 15h-3.8z"/><rect x="20" y="8.2" width="5" height="1.8"/></svg>',
    smg: '<svg viewBox="0 0 48 16"><rect x="7" y="4.8" width="29" height="3.8" rx="1"/><rect x="36" y="5.8" width="9" height="1.8"/><rect x="0" y="5.4" width="7" height="2.8"/><rect x="17" y="3" width="7" height="1.8"/><path d="M21 8.6h5l-.8 6.4h-3.6z"/><path d="M10.5 8.6h4.6l-1 4.8H10z"/></svg>',
    shotgun: '<svg viewBox="0 0 48 16"><rect x="11" y="5" width="34" height="2.1"/><rect x="12" y="8" width="19" height="1.5"/><rect x="25" y="7.3" width="8.5" height="2.4" rx="1"/><rect x="5" y="4.6" width="8" height="4.6" rx="1"/><path d="M0 5.2h5v4.2L1.2 10.6 0 8.6z"/></svg>'
  };
  var WEAPON_SHORT = { fist: 'FISTS', pistol: 'PISTOL', smg: 'SMG', shotgun: 'SHOTGUN' };

  // ROUND 3 (user spec): every HUD symbol is an inline SVG shape.
  // The old font-glyph icons (weather emoji, star glyph, music note,
  // infinity, stopwatch, triangle) rendered as TOFU BOXES on systems
  // without those fonts — the boxes in the user's report. SVG paths
  // with fill/stroke="currentColor" keep the existing CSS colour
  // rules (star on/off/searching blink) fully in charge.
  var STAR_SVG = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 1.8 L15 8.7 L22.4 9.4 L16.9 14.3 L18.5 21.5 L12 17.9 L5.5 21.5 L7.1 14.3 L1.6 9.4 L9 8.7 Z"/></svg>';
  var ICON_SUN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.6v2.4M12 19v2.4M2.6 12H5M19 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7"/></g></svg>';
  var ICON_MOON = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M20.6 14.5A8.8 8.8 0 1 1 9.5 3.4a7.2 7.2 0 0 0 11.1 11.1z"/></svg>';
  var ICON_RAIN = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 15a5 5 0 1 1 .9-9.92A6 6 0 0 1 19.5 7 4.25 4.25 0 0 1 18.5 15z"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 18l-1 2.6M12.5 18l-1 2.6M17 18l-1 2.6"/></g></svg>';
  var ICON_NOTE = '<svg viewBox="0 0 24 24" style="width:1em;height:1em;vertical-align:-0.12em;margin-right:5px"><path fill="currentColor" d="M10 4.2l9-1.8V15h-2.2V4.7L12 5.7V17h-2z"/><circle cx="7.5" cy="17" r="2.6" fill="currentColor"/><circle cx="16.8" cy="15" r="2.6" fill="currentColor"/></svg>';
  var ICON_INF = '<svg viewBox="0 0 24 24" style="width:1.1em;height:1.1em;vertical-align:-0.18em"><path fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" d="M6.5 15.5c-2 0-3.5-1.6-3.5-3.5s1.5-3.5 3.5-3.5c3.5 0 7 7 10.5 7 2 0 3.5-1.6 3.5-3.5s-1.5-3.5-3.5-3.5c-3.5 0-7 7-10.5 7z"/></svg>';
  var ICON_CLOCK = '<svg viewBox="0 0 24 24" style="width:1em;height:1em;vertical-align:-0.14em;margin-right:4px"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8.6"/><path d="M12 7.5V12l3 2"/></g></svg>';
  var ICON_TRI = '<svg viewBox="0 0 24 24" style="width:1em;height:1em;vertical-align:-0.1em;margin-right:3px"><path fill="currentColor" d="M12 20L2.5 5.5h19z"/></svg>';
  var lastWanted = -1, starsFlash = 0;
  // VISUAL POLISH step 1: the in-world objective marker — a floating
  // gold diamond + additive halo that hovers over the objective
  // point (over the courier's head during the chase step), so the
  // target reads IN the scene, not only as the DOM projection
  // (which hides under 6 m, exactly where the chase ends). Built
  // lazily into the main scene; display only.
  // FIX03 (user item 1): the first build read as a rendering
  // artifact in the market frame — a 0.34 m gem stretched 1.5x
  // riding 3.05 m over the objective under a 2.4 m halo, ~1.5 m
  // above the courier's head (probe-measured: marker centre
  // y 3.00 vs head 1.42). The gem is now palm-sized (0.15 m,
  // 1.4x), the halo a tight 0.85 m at 0.6 opacity, and
  // updateMarker3d anchors it just over head height with a
  // subtle bob — a marker, not a monument.
  // POLISH03 (user item 2): overshot — at the FIX03 camera the
  // 0.15 m gem printed 29 px tall and washed out against the
  // stalls (probe-polish03). The middle the user asked for:
  // gem 0.15 -> 0.27 m (about 52 px at the courier's depth),
  // a hotter high-contrast gold (0xffd23e), halo 0.85 -> 1.5 m
  // at 0.75 opacity, bob kept subtle (+-0.07 m). Still anchored
  // over the head — its lower tip clears the courier's crown.
  var marker3d = null;
  function buildMarker3d(scene) {
    var grp = new THREE.Group();
    var gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.27),
      new THREE.MeshBasicMaterial({ color: 0xffd23e })
    );
    gem.scale.y = 1.4;
    grp.add(gem);
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(245,197,66,0.9)'); grad.addColorStop(0.4, 'rgba(245,197,66,0.28)'); grad.addColorStop(1, 'rgba(245,197,66,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    var halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.set(1.5, 1.5, 1);
    grp.add(halo);
    grp.visible = false;
    scene.add(grp);
    return grp;
  }

  var HUD = {
    init: function () {
      el.hud = byId('hud'); el.cash = byId('hud-cash'); el.clock = byId('hud-clock');
      el.clockIcon = byId('hud-clock-icon'); el.clockText = byId('hud-clock-text');
      el.stars = byId('hud-stars'); el.health = byId('arc-health'); el.armor = byId('arc-armor');
      el.arcs = byId('minimap-arcs'); el.ring = byId('minimap-ring');
      el.weaponBox = byId('hud-weapon');
      el.weaponAmmo = byId('weapon-ammo');
      el.weaponIcon = byId('weapon-icon');
      el.weaponSlots = byId('weapon-slots');
      el.speedo = byId('hud-speedo'); el.speedNum = byId('speed-num');
      el.radioStation = byId('radio-station'); el.radioTrack = byId('radio-track');
      el.radioCard = byId('radio-card');
      el.speedBar = byId('speed-bar'); el.objective = byId('hud-objective');
      el.objTitle = byId('obj-title-text'); el.objText = byId('obj-text'); el.objDist = byId('obj-dist');
      el.objTimer = byId('obj-timer'); el.objProgress = byId('obj-progress');
      el.objEyebrow = byId('obj-eyebrow');
      el.wantedStatus = byId('hud-wanted-status'); el.vehHp = byId('veh-hp');
      el.police = byId('hud-police');
      el.subPortrait = byId('sub-portrait'); el.subRole = byId('sub-role');
      el.notes = byId('hud-notes'); el.subtitle = byId('hud-subtitle');
      el.speedLines = byId('speed-lines');
      el.subName = byId('sub-name'); el.subText = byId('sub-text');
      el.prompt = byId('hud-prompt'); el.district = byId('hud-district');
      el.marker = byId('hud-marker'); el.crosshair = byId('hud-crosshair');
      el.vehDamage = byId('veh-damage');
      el.banner = byId('hud-banner'); el.hitmark = byId('hud-hitmark');
      el.dmgFlash = byId('damage-flash');
      displayedCash = SH.State.cash;
      projV = new THREE.Vector3();
      // SCREENSHOT MODE (redesign): P toggles the body's hud-clean
      // class; CSS hides everything but the minimap, cash and stars.
      // Display only — no game state is touched.
      window.addEventListener('keydown', function (e) {
        if (e.code === 'KeyP' && !e.repeat) document.body.classList.toggle('hud-clean');
      });
    },

    notify: function (text) {
      notifications.push({ text: text, t: 4.2 });
      if (notifications.length > 4) notifications.shift();
      this.renderNotes();
    },

    renderNotes: function () {
      if (!el.notes) return;
      var html = '';
      for (var i = 0; i < notifications.length; i++) html += '<div class="note">' + notifications[i].text + '</div>';
      el.notes.innerHTML = html;
    },

    setPrompt: function (text) {
      if (!el.prompt) return;
      if (text) {
        // Redesign: "F — Enter Sedan" style prompts render as a pill
        // with a round key cap; longer hint sentences stay plain text
        // in the same pill. Same string in, same meaning out.
        var m = /^([A-Za-z])\s*—\s*(.+)$/.exec(text);
        if (m) {
          el.prompt.innerHTML = '';
          var cap = document.createElement('span');
          cap.className = 'keycap'; cap.textContent = m[1].toUpperCase();
          el.prompt.appendChild(cap);
          el.prompt.appendChild(document.createTextNode(m[2]));
        } else el.prompt.textContent = text;
        el.prompt.classList.remove('hidden');
      }
      else el.prompt.classList.add('hidden');
    },

    showDistrict: function (name) {
      if (!el.district) return;
      el.district.textContent = name;
      el.district.classList.remove('hidden');
      el.district.classList.remove('fade');
      void el.district.offsetWidth;
      el.district.classList.add('fade');
    },

    subtitle: function (name, text, seconds, expr) {
      if (!el.subtitle) return;
      el.subName.textContent = name;
      el.subText.textContent = text;
      var roles = {
        'Mami Ratna': 'ARUS SYNDICATE', 'Raka': 'GETAWAY DRIVER', 'Courier': 'COURIER',
        'Boutique Owner': 'BUTIK KENCANA', 'Narrator': 'SELATARA', 'Commissioner Varga': 'POLICE COMMISSIONER',
        'Dario Latu': 'RIVAL BOSS', 'Bengkel Arus': 'WORKSHOP', 'Unknown': 'UNKNOWN CALLER'
      };
      if (el.subRole) el.subRole.textContent = roles[name] || '';
      this.drawPortrait(name, expr);
      el.subtitle.classList.remove('hidden');
      subtitleTimer = seconds || 3.4;
    },

    // TOON portrait (semi-realistic rebuild, 2026-11-22): a flat 2D
    // face in the same language as the 3D toon characters — small
    // head, visible neck, flat colours, thin dark outline, small
    // calm eyes at the head middle, THICK separate brows, a nose
    // with a bridge, a readable mouth line. The named cast uses a
    // fixed table matching their 3D look (Raka's beanie + orange
    // jacket, Mami's grey bun + glasses, Varga's police cap +
    // yellow badge, Dario's cream fedora); other speakers fall back
    // to a name hash in the same style. drawPortrait takes an
    // expression (neutral/happy/angry/scared/hurt) that moves brow
    // angle, eye scale and mouth, like the 3D faces.
    drawPortrait: function (name, expr, target) {
      // POLISH 01/02/04: an optional target canvas lets the pause
      // menu reuse the same portrait for its character card; the
      // subtitle call passes nothing and keeps the old behaviour.
      var cv = target || el.subPortrait;
      if (!cv) return;
      if (cv.width !== 216) { cv.width = 216; cv.height = 216; }
      var g = cv.getContext('2d');
      var CAST = {
        'Raka': { skin: '#c9824e', hair: '#17130f', hat: 'beanie', hatColor: '#1c1e24', shirt: '#d8622a', accent: '#f2b13c', def: 'neutral' },
        'Mami Ratna': { skin: '#e8b184', hair: '#b8b0a4', hat: 'bun', shirt: '#51606e', glasses: true, def: 'happy' },
        'Commissioner Varga': { skin: '#c9824e', hair: '#2b2b2e', hat: 'police', hatColor: '#24303e', shirt: '#24303e', mustache: true, def: 'angry' },
        'Dario Latu': { skin: '#f2c89b', hair: '#1b1e28', hat: 'fedora', hatColor: '#e9e2d0', shirt: '#e9e2d0', def: 'happy' },
        'Courier': { skin: '#db9a68', hair: '#3a2415', hat: 'cap', hatColor: '#3868b8', shirt: '#3868b8', def: 'scared' }
      };
      var P = CAST[name];
      if (!P) {
        var h = 0;
        for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
        var skins = ['#f7d7b5', '#e8b184', '#c9824e', '#a96638'];
        var hairs = ['#1b1e28', '#3a2415', '#77572c', '#b8b0a4'];
        var shirts = ['#d8542e', '#2e7d6b', '#f2b13c', '#3a6ea5', '#7a4a5e'];
        P = { skin: skins[h % 4], hair: hairs[(h >> 3) % 4], shirt: shirts[(h >> 5) % 5], hat: 'none', def: 'neutral' };
      }
      var EX = {
        neutral: { brow: 0, eye: 1.0, mouth: 'flat' },
        happy: { brow: -5, eye: 0.62, mouth: 'smile' },
        angry: { brow: 24, eye: 0.78, mouth: 'frown' },
        scared: { brow: -20, eye: 1.28, mouth: 'open' },
        hurt: { brow: -13, eye: 0.30, mouth: 'frown' }
      };
      var E = EX[expr] || EX[P.def] || EX.neutral;
      var OUT = '#2a1a12';
      function ell(x, y, rx, ry, fill) {
        g.fillStyle = fill; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
      }
      function ring(x, y, r, fill, lw) {
        ell(x, y, r + lw, r + lw, OUT); ell(x, y, r, r, fill);
      }
      // flat backdrop in the shirt's family + shoulders
      g.fillStyle = '#22303e'; g.fillRect(0, 0, 216, 216);
      g.fillStyle = P.shirt;
      g.beginPath(); g.moveTo(30, 216); g.quadraticCurveTo(36, 168, 74, 158);
      g.lineTo(142, 158); g.quadraticCurveTo(180, 168, 186, 216); g.closePath(); g.fill();
      g.strokeStyle = OUT; g.lineWidth = 5; g.stroke();
      if (P.accent) { g.fillStyle = P.accent; g.fillRect(66, 178, 84, 9); }
      ell(108, 150, 15, 13, P.skin); // neck
      // head: small, taller than wide, flat fill, thin outline
      ell(77, 102, 5, 8, P.skin); ell(139, 102, 5, 8, P.skin);
      g.fillStyle = P.skin;
      g.beginPath(); g.ellipse(108, 100, 31, 37, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = OUT; g.lineWidth = 4.5; g.stroke();
      // hair / hats, matching the 3D silhouettes
      g.fillStyle = P.hair;
      if (P.hat === 'beanie') {
        g.beginPath(); g.ellipse(108, 72, 32, 20, 0, Math.PI, Math.PI * 2); g.fill();
        g.fillStyle = P.hatColor; g.fillRect(76, 78, 64, 10);
        g.fillStyle = P.hair; g.beginPath(); g.ellipse(108, 66, 32, 17, 0, Math.PI, Math.PI * 2); g.fill();
        g.fillStyle = P.hatColor; g.fillRect(76, 80, 64, 9);
      } else if (P.hat === 'bun') {
        g.beginPath(); g.ellipse(108, 70, 31, 21, 0, Math.PI, Math.PI * 2); g.fill();
        ell(108, 58, 9, 7.5, P.hair);
      } else if (P.hat === 'police') {
        g.fillStyle = P.hatColor;
        g.fillRect(77, 48, 62, 18);
        g.beginPath(); g.ellipse(108, 52, 31, 10, 0, Math.PI, Math.PI * 2); g.fill();
        g.fillStyle = '#14161c'; g.beginPath(); g.ellipse(108, 72, 34, 5, 0, 0, Math.PI * 2); g.fill();
        ell(108, 58, 4, 5, '#f2b13c'); // the yellow badge
      } else if (P.hat === 'fedora') {
        g.fillStyle = P.hatColor;
        g.beginPath(); g.ellipse(108, 74, 44, 7, 0, 0, Math.PI * 2); g.fill();
        g.fillRect(88, 42, 40, 24);
        g.fillStyle = 'rgba(42,26,18,0.85)'; g.fillRect(88, 60, 40, 6);
      } else if (P.hat === 'cap') {
        g.fillStyle = P.hatColor;
        g.beginPath(); g.ellipse(108, 72, 31, 19, 0, Math.PI, Math.PI * 2); g.fill();
        g.beginPath(); g.ellipse(120, 74, 24, 5, 0, 0, Math.PI * 2); g.fill();
      } else {
        g.beginPath(); g.ellipse(108, 70, 31, 21, 0, Math.PI * 0.95, Math.PI * 2.05); g.fill();
      }
      // brows: THICK, separated; the inner ends drop when angry and
      // rise when scared/happy, mirroring the 3D brow pivots
      g.strokeStyle = OUT; g.lineCap = 'round'; g.lineWidth = 6.5;
      var bSin = Math.sin(E.brow * Math.PI / 180) * 11;
      var bLift = E.brow < 0 ? 3 : 0;
      [[96, 1], [120, -1]].forEach(function (b) {
        var cx = b[0], inDir = b[1];
        g.beginPath();
        g.moveTo(cx - inDir * 11, 88 - bSin - bLift);
        g.lineTo(cx + inDir * 11, 88 + bSin - bLift);
        g.stroke();
      });
      // eyes: small, calm, at the MIDDLE of the head
      [96, 120].forEach(function (ex) {
        var ry = 5.5 * E.eye;
        ell(ex, 102, 5.5, ry, '#f7f3ea');
        if (E.eye > 0.4) { ell(ex, 103, 3.2, 3.8 * E.eye, '#241a12'); ell(ex + 1.4, 100, 1.3, 1.3, '#ffffff'); }
      });
      if (P.glasses) {
        g.strokeStyle = 'rgba(20,18,22,0.9)'; g.lineWidth = 3.5;
        [96, 120].forEach(function (ex) { g.beginPath(); g.arc(ex, 102, 10, 0, Math.PI * 2); g.stroke(); });
        g.beginPath(); g.moveTo(106, 100); g.lineTo(110, 100); g.stroke();
      }
      // nose WITH a bridge: a line down + a small tip
      g.strokeStyle = 'rgba(90,50,25,0.55)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(108, 104); g.lineTo(108, 116); g.stroke();
      g.fillStyle = 'rgba(176,122,74,0.9)';
      g.beginPath(); g.ellipse(108, 118, 3.5, 2.2, 0, 0, Math.PI * 2); g.fill();
      // mouth — a readable line
      g.strokeStyle = '#5e2a1c'; g.lineWidth = 4.6;
      if (E.mouth === 'smile') { g.beginPath(); g.arc(108, 124, 8, Math.PI * 0.15, Math.PI * 0.85); g.stroke(); }
      else if (E.mouth === 'frown') { g.beginPath(); g.arc(108, 138, 7.5, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); }
      else if (E.mouth === 'open') { ell(108, 129, 5, 6.5, '#5e2a1c'); }
      else { g.beginPath(); g.moveTo(101, 128); g.lineTo(115, 128); g.stroke(); }
      if (P.mustache) { // small, and only for Varga
        g.fillStyle = P.hair;
        g.beginPath(); g.ellipse(101, 124, 7, 3, 0.25, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.ellipse(115, 124, 7, 3, -0.25, 0, Math.PI * 2); g.fill();
      }
    },

    flashCash: function (n) {
      cashFlash = 1.2; cashFlashSign = n >= 0 ? 1 : -1;
    },

    // Big centre banner: BUSTED / WASTED / MISSION COMPLETE / mission titles.
    banner: function (big, sub, seconds, red) {
      if (!el.banner) return;
      el.banner.querySelector('.big').textContent = big;
      el.banner.querySelector('.sub').textContent = sub || '';
      el.banner.classList.toggle('red', !!red);
      el.banner.classList.remove('hidden');
      bannerTimer = seconds || 2.8;
    },

    hitmark: function () { hitmarkTimer = 0.12; if (el.hitmark) el.hitmark.classList.remove('hidden'); },

    refresh: function () {
      if (!el.hud) return;
      var st = SH.State;
      var inGame = st.mode === 'playing' || st.mode === 'cutscene';
      el.hud.classList.toggle('hidden', !inGame);

      // Notifications decay.
      var changed = false;
      for (var i = notifications.length - 1; i >= 0; i--) {
        notifications[i].t -= 1 / 60;
        if (notifications[i].t <= 0) { notifications.splice(i, 1); changed = true; }
      }
      if (changed) this.renderNotes();
      if (subtitleTimer > 0) { subtitleTimer -= 1 / 60; if (subtitleTimer <= 0) el.subtitle.classList.add('hidden'); }
      if (bannerTimer > 0) { bannerTimer -= 1 / 60; if (bannerTimer <= 0 && el.banner) el.banner.classList.add('hidden'); }
      if (hitmarkTimer > 0) { hitmarkTimer -= 1 / 60; if (hitmarkTimer <= 0 && el.hitmark) el.hitmark.classList.add('hidden'); }
      if (el.dmgFlash) el.dmgFlash.style.opacity = Math.max(0, Math.min(0.85, st._dmgFlash || 0));
      // Speed lines: fade in only at chase speed, only while driving.
      if (el.speedLines) {
        var sl = (inGame && st.driving) ? Math.max(0, Math.min(0.6, (st.speedKmh - 62) / 120)) : 0;
        el.speedLines.style.opacity = sl.toFixed(3);
      }

      // Cash counts toward the real value; flashes green/red on change.
      if (displayedCash !== st.cash) {
        var diff = st.cash - displayedCash;
        displayedCash += Math.abs(diff) < 3 ? diff : Math.round(diff * 0.18);
      }
      el.cash.textContent = '$' + displayedCash.toLocaleString('en-US');
      if (cashFlash > 0) {
        cashFlash -= 1 / 60;
        el.cash.style.color = cashFlashSign > 0 ? '#7dff8a' : '#ff7070';
      } else el.cash.style.color = '';

      // Clock + weather icon: SVG sun / moon / rain cloud, swapped
      // only when the phase changes (never a font glyph — ROUND 3).
      var hh = Math.floor(st.hour), mm = Math.floor((st.hour - hh) * 60);
      var clockTxt = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
      if (el.clockText) {
        if (el.clockText._last !== clockTxt) { el.clockText._last = clockTxt; el.clockText.textContent = clockTxt; }
      } else el.clock.textContent = clockTxt;
      if (el.clockIcon) {
        var phase = st.weather === 'rain' ? 'rain' : (st.hour > 6 && st.hour < 18.5 ? 'sun' : 'moon');
        if (el.clockIcon._phase !== phase) {
          el.clockIcon._phase = phase;
          el.clockIcon.innerHTML = phase === 'rain' ? ICON_RAIN : (phase === 'sun' ? ICON_SUN : ICON_MOON);
        }
      }

      // Wanted stars: five SVG stars, dim when off, bright when on,
      // with a short flash whenever the level changes (ROUND 3).
      if (st.wanted !== lastWanted) {
        if (st.wanted > 0) starsFlash = 36;
        lastWanted = st.wanted;
      }
      if (starsFlash > 0) starsFlash--;
      if (el.stars) el.stars.classList.toggle('flash', starsFlash > 0);
      var stars = '';
      for (var s = 0; s < 5; s++) {
        var active = s < st.wanted;
        var cls = active ? 'star on' : 'star';
        if (active && SH.Police && SH.Police.searching) cls += ' searching';
        stars += '<span class="' + cls + '">' + STAR_SVG + '</span>';
      }
      if (el.stars._last !== stars) { el.stars.innerHTML = stars; el.stars._last = stars; }

      // Unit line under the stars (redesign): the live responder
      // count from the same Police data the deleted table showed —
      // "8 UNITS · AIR" — plus the radar ring on the minimap edge
      // while wanted. The old AIR UNIT DEPLOYED / SEARCHING /
      // UNITS RESPONDING status text is gone; searching still
      // reads from the blinking stars and the minimap blips.
      if (el.wantedStatus) {
        var wtxt = '';
        if (st.wanted > 0 && SH.Police) {
          var pw = SH.Police;
          var tot = pw.units.length + pw.blocks.length + (pw.heli ? 1 : 0);
          wtxt = tot + ' UNITS' + (pw.heli ? ' · AIR' : '');
        }
        if (el.wantedStatus._last !== wtxt) {
          el.wantedStatus._last = wtxt;
          el.wantedStatus.textContent = wtxt;
          el.wantedStatus.classList.toggle('hidden', !wtxt);
        }
      }
      if (el.ring) el.ring.classList.toggle('active', st.wanted > 0);

      // Health / armour arcs on the minimap (redesign): each arc
      // spans up to 30% of the circle (pathLength = 100), HP
      // centred on the right edge, armour on the bottom edge.
      var hpF = Math.max(0, Math.min(100, st.player.health)) / 100;
      var arF = Math.max(0, Math.min(100, st.player.armor)) / 100;
      var arcKey = hpF.toFixed(3) + '|' + arF.toFixed(3);
      if (el.health && el.health._k !== arcKey) {
        el.health._k = arcKey;
        var hl = 30 * hpF, al = 30 * arF;
        // The HP arc straddles the circle's path seam (3 o'clock),
        // and this Chromium's dash renderer truncates any single
        // dash that crosses the seam (measured on the render box,
        // probe-hudred.cjs). So the arc is drawn as TWO dashes
        // inside one pattern — [0, hl/2] and [100−hl/2, 100] —
        // with offset 0; neither dash touches the seam.
        el.health.setAttribute('stroke-dasharray', (hl / 2).toFixed(2) + ' ' + (100 - hl).toFixed(2) + ' ' + (hl / 2).toFixed(2));
        el.health.setAttribute('stroke-dashoffset', '0');
        el.armor.setAttribute('stroke-dasharray', al.toFixed(2) + ' 100');
        el.armor.setAttribute('stroke-dashoffset', (al / 2 - 25).toFixed(2));
      }
      // The arcs dim while health sits full (contextual fade);
      // any damage brings them straight back.
      if (st.player.health >= 100) hpIdle += 1 / 60; else hpIdle = 0;
      if (el.arcs) el.arcs.classList.toggle('dim', hpIdle > 4);

      // Weapon cluster vs speedometer (redesign: the weapon lives
      // under the stars now, the speedo stays bottom-right).
      if (st.driving) {
        el.weaponBox.classList.add('hidden');
        el.speedo.classList.remove('hidden');
        el.speedNum.textContent = st.speedKmh;
        if (el.speedBar) el.speedBar.style.width = Math.min(100, st.speedKmh / 180 * 100) + '%';
        if (el.vehDamage && st.vehicle) el.vehDamage.style.width = Math.max(0, st.vehicle.hp) + '%';
        if (el.vehHp && st.vehicle) el.vehHp.textContent = Math.round(st.vehicle.hp) + '%';
        if (el.radioStation) {
          var info = SH.Audio && SH.Audio.trackInfo ? SH.Audio.trackInfo() : { station: st.radioStation, title: '', artist: '' };
          if (el.radioStation._st !== info.station) {
            el.radioStation._st = info.station;
            el.radioStation.innerHTML = ICON_NOTE + '<span>' + info.station + '</span>';
          }
          if (el.radioTrack) el.radioTrack.textContent = info.title + ' — ' + info.artist;
        }
        // Radio line fades out 4 s after the last station/track
        // change (redesign); any change brings it straight back.
        if (el.radioCard) {
          var rsig = (el.radioStation ? (el.radioStation._st || '') : '') + '|' + (el.radioTrack ? el.radioTrack.textContent : '');
          if (rsig !== radioSig) { radioSig = rsig; radioTimer = 4; el.radioCard.style.opacity = ''; }
          if (radioTimer > 0) { radioTimer -= 1 / 60; if (radioTimer <= 0) el.radioCard.style.opacity = '0'; }
        }
      } else {
        el.speedo.classList.add('hidden');
        el.weaponBox.classList.remove('hidden');
        var wid = st.weapon;
        var spec = SH.Combat ? SH.Combat.current() : SH.Config.weapons[wid];
        var finite = !!spec && spec.mag !== Infinity;
        // Silhouette of the active weapon (rebuilt on switch only);
        // a switch also pops the arsenal strip for 2 s.
        if (el.weaponIcon._id !== wid) {
          el.weaponIcon._id = wid;
          el.weaponIcon.innerHTML = WEAPON_ICONS[wid] || '';
          slotsTimer = 2;
        }
        // One count beside the icon: mag / reserve ("10 / 48").
        // Fists have no magazine and keep the infinity glyph.
        if (finite) {
          var ammoTxt = st.ammo + ' / ' + st.ammoReserve;
          if (el.weaponAmmo._t !== ammoTxt) { el.weaponAmmo._t = ammoTxt; el.weaponAmmo._inf = false; el.weaponAmmo.textContent = ammoTxt; }
        }
        else if (!el.weaponAmmo._inf) { el.weaponAmmo._inf = true; el.weaponAmmo._t = ''; el.weaponAmmo.innerHTML = ICON_INF; }
        // Arsenal strip content (same live Combat data as before):
        // every weapon in Config order — active slot gold, owned
        // dim, unowned faded. It is only VISIBLE for 2 s after a
        // switch (the .show class below).
        var owned = SH.Combat ? SH.Combat.owned : { fist: true };
        var slotKey = wid + '|' + (owned.pistol ? 1 : 0) + (owned.smg ? 1 : 0) + (owned.shotgun ? 1 : 0);
        if (el.weaponSlots._key !== slotKey) {
          el.weaponSlots._key = slotKey;
          var ids = Object.keys(SH.Config.weapons), sh = '';
          for (var si = 0; si < ids.length; si++) {
            var sid = ids[si];
            var scls = 'wslot' + (sid === wid ? ' active' : (owned[sid] ? '' : ' locked'));
            sh += '<div class="' + scls + '">' + (WEAPON_ICONS[sid] || '') + '<span>' + (WEAPON_SHORT[sid] || sid.toUpperCase()) + '</span></div>';
          }
          el.weaponSlots.innerHTML = sh;
        }
        if (slotsTimer > 0) slotsTimer -= 1 / 60;
        el.weaponSlots.classList.toggle('show', slotsTimer > 0);
        // Contextual fade: the cluster dims to 35% after 4 s with
        // no change to weapon / ammo / reserve; aiming holds it up.
        var wsig = wid + '|' + st.ammo + '|' + st.ammoReserve;
        if (wsig !== weapSig || st.aiming) { weapSig = wsig; weapIdle = 0; } else weapIdle += 1 / 60;
        el.weaponBox.classList.toggle('dim', weapIdle > 4);
      }

      // Objective panel + 3D marker (+ stage progress and step timer).
      if (st.objective) {
        el.objective.classList.remove('hidden');
        el.objTitle.textContent = st.objective.title;
        el.objText.textContent = st.objective.text;
        var focus = st.driving ? st.vehiclePos : st.player;
        var dist = Math.hypot(st.objective.x - focus.x, st.objective.z - focus.z);
        el.objDist.textContent = Math.round(dist) + ' m';
        this.updateMarker(st.objective, dist);
        this.updateMarker3d(st.objective, st);
        var act = SH.Missions && SH.Missions.active;
        // Eyebrow over the headline: "MISSION n · GIVER" from the
        // live mission def (the #1 entry's card hierarchy).
        if (el.objEyebrow) {
          var eb = act ? ('MISSION ' + (SH.Missions.currentIndex + 1) + (act.def.giver ? ' · ' + String(act.def.giver).toUpperCase() : '')) : '';
          if (el.objEyebrow._last !== eb) {
            el.objEyebrow._last = eb;
            el.objEyebrow.textContent = eb;
            el.objEyebrow.style.display = eb ? 'block' : 'none';
          }
        }
        if (el.objProgress) el.objProgress.style.display = act ? 'flex' : 'none';
        if (act && el.objProgress) {
          var total = act.def.steps.length, key = total + ':' + act.stepIndex;
          if (el.objProgress._key !== key) {
            el.objProgress._key = key;
            var ph = '';
            for (var pi = 0; pi < total; pi++) ph += '<i class="' + (pi < act.stepIndex ? 'done' : '') + '"></i>';
            el.objProgress.innerHTML = ph;
          }
          var stepNow = act.def.steps[act.stepIndex];
          if (el.objTimer) {
            // Redesign: the timer line is a timer only — big bare
            // text under the objective when the step is timed. The
            // old STEP n/N chip text is gone (the step count still
            // lives in the mission data and the pause career list).
            if (stepNow && stepNow.timeLimit) {
              var left = Math.max(0, stepNow.timeLimit - (act.stepData.t || 0));
              var tstr = ICON_CLOCK + Math.floor(left / 60) + ':' + ('0' + Math.floor(left % 60)).slice(-2);
              if (el.objTimer._h !== tstr) { el.objTimer._h = tstr; el.objTimer.innerHTML = tstr; }
            } else if (el.objTimer._h !== '') { el.objTimer._h = ''; el.objTimer.textContent = ''; }
          }
        } else if (el.objTimer) { el.objTimer.textContent = ''; el.objTimer._h = ''; }
      } else {
        el.objective.classList.add('hidden');
        el.marker.classList.add('hidden');
        if (marker3d) marker3d.visible = false;
      }

      // Police response list (RESTORED 2026-11-24, Bos order —
      // the redesign was a restyle, not a removal): the same live
      // SH.Police units/blocks/heli rows, caps and format the
      // pre-redesign panel showed (up to 4 PATROL-n units, then
      // BLOCKADE rows and the HELI-1 row to 5, header count over
      // all three pools, LOST VISUAL status row while searching),
      // rendered bare under the wanted line. Display only — the
      // data and the police logic are exactly as they were.
      if (el.police) {
        if (st.wanted > 0 && SH.Police && st.mode === 'playing') {
          el.police.classList.remove('hidden');
          var P = SH.Police, f2 = st.driving ? st.vehiclePos : st.player;
          var rows = [];
          for (var ui = 0; ui < P.units.length && rows.length < 4; ui++) {
            var uv = P.units[ui].veh;
            var ud = Math.hypot(uv.x - f2.x, uv.z - f2.z);
            var tag = P.searching ? 'SEARCHING' : (ud < 26 ? 'RAMMING' : 'PURSUIT');
            rows.push({ label: 'PATROL-' + (ui + 1), d: ud, tag: tag, cls: P.searching ? 'cool' : (ud < 26 ? 'hot' : '') });
          }
          for (var bi = 0; bi < P.blocks.length && rows.length < 5; bi++) {
            var bv = P.blocks[bi].veh;
            rows.push({ label: 'BLOCKADE', d: Math.hypot(bv.x - f2.x, bv.z - f2.z), tag: 'ROADBLOCK', cls: '' });
          }
          if (P.heli && rows.length < 5) rows.push({ label: 'HELI-1', d: Math.hypot(P.heli.mesh.position.x - f2.x, P.heli.mesh.position.z - f2.z), tag: 'AIR SUPPORT', cls: 'cool' });
          var total2 = P.units.length + P.blocks.length + (P.heli ? 1 : 0);
          var phtml = '<div class="pol-head"><span>POLISI SELATARA</span><span>' + total2 + ' UNITS</span></div>';
          for (var ri = 0; ri < rows.length; ri++) {
            phtml += '<div class="pol-row"><span class="pol-name">' + rows[ri].label + '</span><span class="pol-tag ' + rows[ri].cls + '">' + rows[ri].tag + '</span><span class="pol-dist">' + Math.round(rows[ri].d) + ' m</span></div>';
          }
          if (P.searching) phtml += '<div class="pol-row"><span class="pol-name">STATUS</span><span class="pol-tag cool">LOST VISUAL</span><span class="pol-dist"></span></div>';
          if (el.police._html !== phtml) { el.police.innerHTML = phtml; el.police._html = phtml; }
        } else el.police.classList.add('hidden');
      }

      // Crosshair only while aiming.
      el.crosshair.classList.toggle('hidden', !st.aiming);
    },

    // VISUAL POLISH step 1: place the in-world marker over the
    // objective point, bobbing and turning so it catches the eye
    // without a HUD element. During the chase step the objective
    // IS the courier (missions.js keeps it glued to him), so the
    // diamond rides over his head.
    // FIX03 (user item 1): anchored just over head height —
    // ground + 2.12 m puts the small gem ~0.3 m over a standing
    // figure's crown — with a subtle ±0.05 m bob, not the old
    // 3.05 m tower with its ±0.16 m swing.
    updateMarker3d: function (obj, st) {
      var scene = SH.Main && SH.Main.getScene ? SH.Main.getScene() : null;
      if (!scene) return;
      if (!marker3d) marker3d = buildMarker3d(scene);
      var gy = SH.World.groundHeightAt(obj.x, obj.z);
      marker3d.position.set(obj.x, gy + 2.12 + Math.sin(st.time * 1.8) * 0.07, obj.z);
      marker3d.rotation.y = st.time * 1.2;
      marker3d.visible = st.mode === 'playing';
    },

    updateMarker: function (obj, dist) {
      var camera = SH.Main.getCamera();
      if (!camera || dist < 6) { el.marker.classList.add('hidden'); return; }
      projV.set(obj.x, 4.5, obj.z).project(camera);
      if (projV.z > 1 || projV.z < -1) { el.marker.classList.add('hidden'); return; }
      var x = (projV.x * 0.5 + 0.5) * window.innerWidth;
      var y = (-projV.y * 0.5 + 0.5) * window.innerHeight;
      el.marker.classList.remove('hidden');
      el.marker.style.transform = 'translate(' + Math.round(x - 14) + 'px,' + Math.round(y - 34) + 'px)';
      var mkD = Math.round(dist);
      if (el.marker._d !== mkD) { el.marker._d = mkD; el.marker.innerHTML = ICON_TRI + '<span>' + mkD + 'm</span>'; }
    }
  };

  SH.HUD = HUD;
})(window.SH = window.SH || {});
