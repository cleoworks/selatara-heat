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

  function byId(id) { return document.getElementById(id); }

  var HUD = {
    init: function () {
      el.hud = byId('hud'); el.cash = byId('hud-cash'); el.clock = byId('hud-clock');
      el.stars = byId('hud-stars'); el.health = byId('bar-health'); el.armor = byId('bar-armor');
      el.healthNum = byId('bar-health-num'); el.weaponBox = byId('hud-weapon');
      el.weaponName = byId('weapon-name'); el.weaponAmmo = byId('weapon-ammo');
      el.speedo = byId('hud-speedo'); el.speedNum = byId('speed-num');
      el.radioStation = byId('radio-station'); el.radioTrack = byId('radio-track');
      el.speedBar = byId('speed-bar'); el.objective = byId('hud-objective');
      el.objTitle = byId('obj-title-text'); el.objText = byId('obj-text'); el.objDist = byId('obj-dist');
      el.objTimer = byId('obj-timer'); el.objProgress = byId('obj-progress');
      el.police = byId('hud-police');
      el.subPortrait = byId('sub-portrait'); el.subRole = byId('sub-role');
      el.notes = byId('hud-notes'); el.subtitle = byId('hud-subtitle');
      el.subName = byId('sub-name'); el.subText = byId('sub-text');
      el.prompt = byId('hud-prompt'); el.district = byId('hud-district');
      el.marker = byId('hud-marker'); el.crosshair = byId('hud-crosshair');
      el.vehDamage = byId('veh-damage');
      el.banner = byId('hud-banner'); el.hitmark = byId('hud-hitmark');
      el.dmgFlash = byId('damage-flash');
      displayedCash = SH.State.cash;
      projV = new THREE.Vector3();
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
      if (text) { el.prompt.textContent = text; el.prompt.classList.remove('hidden'); }
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

    subtitle: function (name, text, seconds) {
      if (!el.subtitle) return;
      el.subName.textContent = name;
      el.subText.textContent = text;
      var roles = {
        'Mami Ratna': 'ARUS SYNDICATE', 'Raka': 'GETAWAY DRIVER', 'Courier': 'COURIER',
        'Boutique Owner': 'BUTIK KENCANA', 'Narrator': 'SELATARA', 'Commissioner Varga': 'POLICE COMMISSIONER',
        'Dario Latu': 'RIVAL BOSS', 'Bengkel Arus': 'WORKSHOP', 'Unknown': 'UNKNOWN CALLER'
      };
      if (el.subRole) el.subRole.textContent = roles[name] || '';
      this.drawPortrait(name);
      el.subtitle.classList.remove('hidden');
      subtitleTimer = seconds || 3.4;
    },

    // Procedural portrait (smoothness pass): a real little face drawn
    // with ellipses, arcs and soft gradients on a 216 px canvas (shown
    // at 54 px), colours and hair hashed from the speaker's name so
    // every character differs — no more flat blocks.
    drawPortrait: function (name) {
      if (!el.subPortrait) return;
      var cv = el.subPortrait;
      if (cv.width !== 216) { cv.width = 216; cv.height = 216; }
      var g = cv.getContext('2d');
      var h = 0;
      for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
      var skins = ['#c98a5e', '#a8763e', '#8a5a34', '#e0aa72'];
      var hairs = ['#14100c', '#3a2415', '#5e3a1e', '#c9c9c9', '#7a1f3d'];
      var bgs = ['#ff4fa3', '#37e0ff', '#ffd23f', '#9a6ac9', '#37b24d'];
      var shirts = ['#c94f4f', '#2a6ac9', '#37b24d', '#e8862a', '#7a4fa3', '#2a8a8a'];
      var skin = skins[h % skins.length], hair = hairs[(h >> 3) % hairs.length], bg = bgs[(h >> 5) % bgs.length];
      var shirt = shirts[(h >> 7) % shirts.length];
      function ell(x, y, rx, ry, fill) {
        g.fillStyle = fill; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
      }
      // Backdrop: flat colour with a soft pool of light and a sheen.
      g.fillStyle = bg; g.fillRect(0, 0, 216, 216);
      var bgGlow = g.createRadialGradient(86, 74, 12, 108, 108, 165);
      bgGlow.addColorStop(0, 'rgba(255,255,255,0.20)'); bgGlow.addColorStop(1, 'rgba(0,0,0,0.14)');
      g.fillStyle = bgGlow; g.fillRect(0, 0, 216, 216);
      // Shoulders + collar (rounded mass, not a slab).
      g.fillStyle = shirt;
      g.beginPath(); g.moveTo(38, 216); g.quadraticCurveTo(40, 168, 76, 158);
      g.lineTo(140, 158); g.quadraticCurveTo(176, 168, 178, 216); g.closePath(); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.16)';
      g.beginPath(); g.moveTo(88, 160); g.lineTo(128, 160); g.lineTo(108, 182); g.closePath(); g.fill();
      ell(108, 152, 15, 14, skin); // neck
      g.fillStyle = 'rgba(0,0,0,0.13)'; g.fillRect(94, 138, 28, 10); // neck shadow
      // Head: an ellipse lit from the upper left, edges feathered by
      // the radial falloff instead of a hard outline.
      var headGrad = g.createRadialGradient(88, 66, 18, 108, 96, 86);
      headGrad.addColorStop(0, skin); headGrad.addColorStop(0.78, skin); headGrad.addColorStop(1, 'rgba(40,16,4,0.28)');
      ell(72, 96, 7, 11, skin); ell(144, 96, 7, 11, skin); // ears
      g.fillStyle = headGrad;
      g.beginPath(); g.ellipse(108, 94, 37, 45, 0, 0, Math.PI * 2); g.fill();
      // Hair: a swept cap over the crown; styles vary by hash.
      g.fillStyle = hair;
      g.beginPath(); g.ellipse(108, 66, 38.5, 30, 0, Math.PI * 0.98, Math.PI * 2.02); g.fill();
      g.beginPath(); g.moveTo(70, 74); g.quadraticCurveTo(104, 44, 147, 70); g.quadraticCurveTo(120, 58, 96, 64); g.quadraticCurveTo(78, 68, 70, 74); g.closePath(); g.fill();
      if (h % 3 === 0 || name === 'Mami Ratna') { // long sides
        g.fillRect(66, 66, 11, 52); g.fillRect(139, 66, 11, 52);
      }
      if (h % 5 === 4) ell(108, 34, 10, 8, hair); // top bun
      // Face: brows, eyes with glints, a soft nose, a real mouth.
      g.strokeStyle = 'rgba(30,18,10,0.85)'; g.lineCap = 'round'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(84, 88); g.quadraticCurveTo(93, 84, 101, 87); g.stroke();
      g.beginPath(); g.moveTo(115, 87); g.quadraticCurveTo(123, 84, 132, 88); g.stroke();
      [93, 123].forEach(function (ex) {
        ell(ex, 100, 6.4, 7.6, '#f3ead9');
        ell(ex, 101, 3.6, 5.2, '#241208');
        ell(ex + 1.6, 97.5, 1.4, 1.4, 'rgba(255,255,255,0.95)');
      });
      g.strokeStyle = 'rgba(70,35,15,0.4)'; g.lineWidth = 3.4;
      g.beginPath(); g.moveTo(109, 104); g.lineTo(106, 116); g.stroke();
      var cheek = g.createRadialGradient(84, 116, 1, 84, 116, 13);
      cheek.addColorStop(0, 'rgba(255,110,80,0.16)'); cheek.addColorStop(1, 'rgba(255,110,80,0)');
      g.fillStyle = cheek; g.beginPath(); g.arc(84, 116, 13, 0, Math.PI * 2); g.fill();
      g.fillStyle = cheek; g.beginPath(); g.arc(132, 116, 13, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#6e3524'; g.lineWidth = 4.4;
      if (h % 3 === 1) { g.beginPath(); g.moveTo(99, 130); g.lineTo(117, 130); g.stroke(); }        // flat
      else if (h % 3 === 2) {                                                                        // grin
        g.fillStyle = '#5e2a1c'; g.beginPath(); g.ellipse(108, 129, 9.5, 6.8, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#f5ede2'; g.fillRect(100, 124.5, 16, 4.6);
      } else { g.beginPath(); g.arc(108, 124, 9, Math.PI * 0.2, Math.PI * 0.8); g.stroke(); }       // smile
      // Signature pieces for the named cast.
      if (name === 'Mami Ratna') { // her gold band across the hairline
        g.strokeStyle = '#ffd23f'; g.lineWidth = 7;
        g.beginPath(); g.ellipse(108, 62, 37, 27, 0, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
      }
      if (name === 'Raka') { // his shades
        g.fillStyle = 'rgba(16,14,18,0.92)';
        g.beginPath(); g.moveTo(80, 94); g.lineTo(104, 94); g.lineTo(102, 108); g.lineTo(83, 108); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(112, 94); g.lineTo(136, 94); g.lineTo(133, 108); g.lineTo(114, 108); g.closePath(); g.fill();
        g.fillRect(102, 96, 12, 3.4);
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(84, 96.5, 9, 3);
      }
      if (name === 'Commissioner Varga') { // peaked police cap
        g.fillStyle = '#2a3f8f';
        g.beginPath(); g.ellipse(108, 58, 39, 17, 0, Math.PI, Math.PI * 2); g.fill();
        g.fillStyle = '#1c2030'; g.beginPath(); g.ellipse(108, 60, 42, 7, 0, 0, Math.PI * 2); g.fill();
        ell(108, 47, 4.4, 4.4, '#ffd23f');
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

      // Clock + weather glyph.
      var hh = Math.floor(st.hour), mm = Math.floor((st.hour - hh) * 60);
      el.clock.textContent = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm + (st.weather === 'rain' ? ' 🌧' : (st.hour > 6 && st.hour < 18.5 ? ' ☀' : ' ☾'));

      // Wanted stars.
      var stars = '';
      for (var s = 0; s < 5; s++) {
        var active = s < st.wanted;
        var cls = active ? 'star on' : 'star';
        if (active && SH.Police && SH.Police.searching) cls += ' searching';
        stars += '<span class="' + cls + '">★</span>';
      }
      if (el.stars._last !== stars) { el.stars.innerHTML = stars; el.stars._last = stars; }

      // Health / armour.
      el.health.style.width = Math.max(0, st.player.health) + '%';
      el.armor.style.width = Math.max(0, st.player.armor) + '%';
      el.healthNum.textContent = Math.ceil(st.player.health);

      // Weapon box vs speedometer.
      if (st.driving) {
        el.weaponBox.classList.add('hidden');
        el.speedo.classList.remove('hidden');
        el.speedNum.textContent = st.speedKmh;
        if (el.speedBar) el.speedBar.style.width = Math.min(100, st.speedKmh / 180 * 100) + '%';
        if (el.vehDamage && st.vehicle) el.vehDamage.style.width = Math.max(0, st.vehicle.hp) + '%';
        if (el.radioStation) {
          var info = SH.Audio && SH.Audio.trackInfo ? SH.Audio.trackInfo() : { station: st.radioStation, title: '', artist: '' };
          el.radioStation.textContent = '♪ ' + info.station;
          if (el.radioTrack) el.radioTrack.textContent = info.title + ' — ' + info.artist;
        }
      } else {
        el.speedo.classList.add('hidden');
        el.weaponBox.classList.remove('hidden');
        var spec = SH.Combat ? SH.Combat.current() : SH.Config.weapons[st.weapon];
        el.weaponName.textContent = spec ? spec.label : '';
        el.weaponAmmo.textContent = spec && spec.mag !== Infinity ? (st.ammo + ' / ' + st.ammoReserve) : '—';
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
        var act = SH.Missions && SH.Missions.active;
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
            if (stepNow && stepNow.timeLimit) {
              var left = Math.max(0, stepNow.timeLimit - (act.stepData.t || 0));
              el.objTimer.textContent = '⏱ ' + Math.floor(left / 60) + ':' + ('0' + Math.floor(left % 60)).slice(-2);
            } else el.objTimer.textContent = 'STEP ' + (act.stepIndex + 1) + '/' + total;
          }
        } else if (el.objTimer) el.objTimer.textContent = '';
      } else {
        el.objective.classList.add('hidden');
        el.marker.classList.add('hidden');
      }

      // Police response panel while wanted.
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
          var html = '<div class="pol-head"><span>POLISI SELATARA</span><span>' + total2 + ' UNITS</span></div>';
          for (var ri = 0; ri < rows.length; ri++) {
            html += '<div class="pol-row"><span>' + rows[ri].label + '</span><span>' + Math.round(rows[ri].d) + ' m</span><span class="pol-tag ' + rows[ri].cls + '">' + rows[ri].tag + '</span></div>';
          }
          if (P.searching) html += '<div class="pol-row"><span>STATUS</span><span></span><span class="pol-tag cool">LOST VISUAL</span></div>';
          if (el.police._html !== html) { el.police.innerHTML = html; el.police._html = html; }
        } else el.police.classList.add('hidden');
      }

      // Crosshair only while aiming.
      el.crosshair.classList.toggle('hidden', !st.aiming);
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
      el.marker.textContent = '▼ ' + Math.round(dist) + 'm';
    }
  };

  SH.HUD = HUD;
})(window.SH = window.SH || {});
