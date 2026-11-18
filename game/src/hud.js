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
      el.radio = byId('hud-radio'); el.speedBar = byId('speed-bar'); el.objective = byId('hud-objective');
      el.objTitle = byId('obj-title'); el.objText = byId('obj-text'); el.objDist = byId('obj-dist');
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
      el.subtitle.classList.remove('hidden');
      subtitleTimer = seconds || 3.4;
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
        if (el.radio) el.radio.textContent = st.radioStation || 'RADIO SELATARA FM';
      } else {
        el.speedo.classList.add('hidden');
        el.weaponBox.classList.remove('hidden');
        var spec = SH.Combat ? SH.Combat.current() : SH.Config.weapons[st.weapon];
        el.weaponName.textContent = spec ? spec.label : '';
        el.weaponAmmo.textContent = spec && spec.mag !== Infinity ? (st.ammo + ' / ' + st.ammoReserve) : '—';
      }

      // Objective panel + 3D marker.
      if (st.objective) {
        el.objective.classList.remove('hidden');
        el.objTitle.textContent = st.objective.title;
        el.objText.textContent = st.objective.text;
        var focus = st.driving ? st.vehiclePos : st.player;
        var dist = Math.hypot(st.objective.x - focus.x, st.objective.z - focus.z);
        el.objDist.textContent = Math.round(dist) + ' m';
        this.updateMarker(st.objective, dist);
      } else {
        el.objective.classList.add('hidden');
        el.marker.classList.add('hidden');
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
