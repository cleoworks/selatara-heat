// SELATARA HEAT — hud.js
// The in-game HUD as DOM over the canvas: cash, clock, wanted stars, health /
// armour bars, weapon + ammo or driving speedometer, objective panel,
// notification queue, subtitles, interaction prompt, 3D objective marker.
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

    // Procedural low-poly portrait: a simple canvas face whose colours and
    // hair are hashed from the speaker's name, so every character differs.
    drawPortrait: function (name) {
      if (!el.subPortrait) return;
      var g = el.subPortrait.getContext('2d');
      var h = 0;
      for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
      var skins = ['#c98a5e', '#a8763e', '#8a5a34', '#e0aa72'];
      var hairs = ['#14100c', '#3a2415', '#5e3a1e', '#c9c9c9', '#7a1f3d'];
      var bgs = ['#ff4fa3', '#37e0ff', '#ffd23f', '#9a6ac9', '#37b24d'];
      var skin = skins[h % skins.length], hair = hairs[(h >> 3) % hairs.length], bg = bgs[(h >> 5) % bgs.length];
      g.fillStyle = bg; g.fillRect(0, 0, 108, 108);
      g.fillStyle = 'rgba(255,255,255,0.16)';
      g.beginPath(); g.moveTo(0, 108); g.lineTo(108, 30); g.lineTo(108, 108); g.closePath(); g.fill();
      g.fillStyle = '#22242c'; g.fillRect(30, 84, 48, 24); // shoulders
      g.fillStyle = skin; g.fillRect(34, 30, 40, 44);      // face block
      g.fillStyle = hair; g.fillRect(30, 18, 48, 18);      // hair block
      if (h % 3 === 0) { g.fillRect(24, 30, 8, 30); g.fillRect(76, 30, 8, 30); } // long hair sides
      g.fillStyle = '#14100c';
      g.fillRect(42, 50, 7, 5); g.fillRect(59, 50, 7, 5); // eyes
      g.fillRect(47, 66, 14, 3);                            // mouth
      if (name === 'Mami Ratna') { g.fillStyle = '#ffd23f'; g.fillRect(30, 14, 48, 7); } // her gold band
      if (name === 'Raka') { g.fillStyle = '#14100c'; g.fillRect(38, 44, 32, 7); }        // his shades
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
