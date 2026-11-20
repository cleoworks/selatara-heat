// SELATARA HEAT — menus.js
// Title screen (cinematic orbiting camera), pause menu, full city map with
// click-to-set waypoint, settings (volume / sensitivity / quality) and the
// controls screen. Owns game-mode transitions and pointer-lock pausing.
// Public API: SH.Menus { init(), syncMode(), updateTitleCamera(camera), openMap(), closeMap() }.
(function (SH) {
  'use strict';

  var el = {};
  var canvasEl = null;
  var titleAngle = 0;

  function byId(id) { return document.getElementById(id); }

  function lockPointer() {
    try {
      var r = canvasEl.requestPointerLock();
      if (r && r.catch) r.catch(function () { /* browser cooldown; user can click again */ });
    } catch (e) { /* pointer lock unavailable (headless) — game still runs */ }
  }

  var Menus = {
    init: function () {
      canvasEl = document.getElementById('game');
      el.loading = byId('loading');
      el.title = byId('title-screen'); el.pause = byId('pause-menu');
      el.map = byId('map-screen'); el.settings = byId('settings-panel');
      el.controls = byId('controls-panel');
      el.stats = byId('pause-stats');
      el.btnContinue = byId('btn-continue');

      byId('btn-new').addEventListener('click', function () { SH.Audio.init(); SH.Audio.resume(); SH.Audio.click(); Menus.newGame(); });
      el.btnContinue.addEventListener('click', function () { SH.Audio.init(); SH.Audio.resume(); SH.Audio.click(); Menus.continueGame(); });
      byId('btn-settings').addEventListener('click', function () { Menus.showPanel('settings'); });
      byId('btn-controls').addEventListener('click', function () { Menus.showPanel('controls'); });
      byId('btn-resume').addEventListener('click', function () { Menus.resume(); });
      byId('btn-openmap').addEventListener('click', function () { Menus.openMap(); });
      byId('btn-save').addEventListener('click', function () {
        if (SH.Save.saveGame()) { SH.HUD.notify('Game saved'); Menus.refreshStats(); }
        else SH.HUD.notify('Save unavailable in this browser');
      });
      byId('btn-quit-title').addEventListener('click', function () { SH.State.mode = 'title'; Menus.syncMode(); });
      byId('btn-map-close').addEventListener('click', function () { Menus.closeMap(); });
      var backButtons = document.querySelectorAll('[data-back]');
      for (var i = 0; i < backButtons.length; i++) {
        backButtons[i].addEventListener('click', function () { Menus.showPanel(null); });
      }

      // Settings wiring.
      var st = SH.State.settings;
      var vol = byId('set-volume'), mus = byId('set-music'), sfx = byId('set-sfx'), sen = byId('set-sens'), qual = byId('set-quality');
      vol.value = st.volume * 100; mus.value = st.music * 100; sfx.value = st.sfx * 100; sen.value = st.sensitivity * 100;
      function applySettings() {
        st.volume = vol.value / 100; st.music = mus.value / 100; st.sfx = sfx.value / 100;
        st.sensitivity = sen.value / 100; st.quality = qual.value;
        SH.Input.sensitivity = st.sensitivity;
        SH.Audio.setVolumes(st.volume, st.music, st.sfx);
        SH.Main.applyQuality(st.quality);
      }
      vol.addEventListener('input', applySettings);
      mus.addEventListener('input', applySettings);
      sfx.addEventListener('input', applySettings);
      sen.addEventListener('input', applySettings);
      qual.addEventListener('change', applySettings);

      // Full-map click → waypoint; right-click clears it again.
      var big = byId('bigmap');
      big.addEventListener('click', function (e) {
        var w = SH.Minimap.mapClickToWorld(big, e.clientX, e.clientY);
        if (w) {
          SH.State.waypoint = w;
          SH.Minimap.drawFullMap(big);
          SH.HUD.notify('Waypoint set');
        }
      });
      big.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        if (SH.State.waypoint) {
          SH.State.waypoint = null;
          SH.Minimap.drawFullMap(big);
          SH.HUD.notify('Waypoint cleared');
        }
      });

      // Alt-tabbing away mid-chase should not let the city run off without
      // the player: blur while playing pauses, same as losing pointer lock.
      window.addEventListener('blur', function () {
        if (SH.State.mode === 'playing') {
          SH.State.mode = 'paused';
          Menus.syncMode();
        }
      });
      // Losing pointer lock while playing = pause (Esc is the pause key).
      document.addEventListener('pointerlockchange', function () {
        if (SH.State.mode === 'playing' && !SH.Input.locked && !(SH.Shots && SH.Shots.active)) {
          SH.State.mode = 'paused';
          Menus.syncMode();
        }
      });
      window.addEventListener('keydown', function (e) {
        if (e.code === 'KeyM' && SH.State.mode === 'playing') Menus.openMap();
        else if ((e.code === 'Escape' || e.code === 'KeyM') && SH.State.mode === 'map') Menus.closeMap();
        else if (e.code === 'Escape' && SH.State.mode === 'paused') Menus.resume();
      });

      if (el.loading) el.loading.classList.add('hidden');
      el.btnContinue.classList.toggle('hidden', !SH.Save.hasSave());
    },

    showPanel: function (which) {
      el.settings.classList.toggle('hidden', which !== 'settings');
      el.controls.classList.toggle('hidden', which !== 'controls');
    },

    // Career panel inside the pause menu (v2: hero tiles + taxonomy).
    // Every value is a live field the game really tracks — cash,
    // stats.missionsDone / carsStolen, the mission list + currentIndex,
    // Combat.owned, Config.weapons labels, Config.shops prices,
    // State.time (real accumulated play seconds) and Save.hasSave().
    // The only derived number is STORY COMPLETION % = missionsDone /
    // Missions.list.length x 100 — a direct ratio of two tracked
    // values, labelled as such. Nothing else is derived from anything
    // the code does not record (distanceKm stays excluded: the field
    // exists but no system ever updates it; the game tracks no races,
    // stunts or collectibles, so no such categories are shown).
    refreshStats: function () {
      if (!el.stats) return;
      var st = SH.State;
      function fmtCash(n) { return '$' + Math.round(n || 0).toLocaleString('en-US'); }
      function fmtTime(sec) {
        sec = Math.max(0, Math.floor(sec || 0));
        var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
      }
      var list = (SH.Missions && SH.Missions.list) || [];
      var done = Math.min(st.stats.missionsDone || 0, list.length);
      var cur = SH.Missions ? SH.Missions.currentIndex : done;
      var owned = (SH.Combat && SH.Combat.owned) || {};
      var wTotal = 0, wOwned = 0;
      for (var wid in SH.Config.weapons) { wTotal++; if (owned[wid]) wOwned++; }
      var pct = list.length ? (done / list.length * 100) : 0;
      var pctTxt = (pct % 1 === 0) ? String(pct) : pct.toFixed(1);
      var hero = '<div class="stat-hero">' +
        '<div class="hero-tile"><span>STORY COMPLETION</span><b>' + pctTxt + '%</b>' +
          '<div class="pbar"><i style="width:' + pct + '%"></i></div>' +
          '<em>' + done + ' of ' + list.length + ' story missions done</em></div>' +
        '<div class="hero-tile"><span>CASH ON HAND</span><b class="cash">' + fmtCash(st.cash) + '</b>' +
          '<em>' + (SH.Save.hasSave() ? 'Save data — Slot 1 saved' : 'No save data yet') + '</em></div>' +
        '<div class="hero-tile"><span>CARS STOLEN</span><b>' + (st.stats.carsStolen || 0) + '</b>' +
          '<em>Play time ' + fmtTime(st.time) + '</em></div>' +
        '</div>';
      var msn = '';
      for (var i = 0; i < list.length; i++) {
        var cls = i < done ? 'done' : (i === cur ? 'cur' : 'todo');
        var mark = i < done ? '✓' : (i === cur ? '▸' : '·');
        msn += '<div class="msn ' + cls + '"><span class="t">' + mark + ' ' + list[i].title + '</span><i>' + list[i].giver + ' · <b>' + fmtCash(list[i].reward) + '</b></i></div>';
      }
      var ars = '';
      for (var wid2 in SH.Config.weapons) {
        var w = SH.Config.weapons[wid2];
        var status;
        if (owned[wid2]) status = '<b class="own">OWNED</b>';
        else if (SH.Config.shops[wid2]) status = '<b class="price">' + fmtCash(SH.Config.shops[wid2]) + '</b>';
        else status = '<b class="lock">LOCKED</b>';
        ars += '<div class="stat-row"><span>' + w.label + '</span>' + status + '</div>';
      }
      var rec = '';
      rec += '<div class="stat-row"><span>Story</span><b>' + (st.storyComplete ? 'Complete' : 'In progress') + '</b></div>';
      rec += '<div class="stat-row"><span>Current job</span><b>' + (cur < list.length ? list[cur].title : '—') + '</b></div>';
      rec += '<div class="stat-row"><span>Weapons owned</span><b>' + wOwned + ' / ' + wTotal + '</b></div>';
      el.stats.innerHTML = '<h2>CAREER — RAKA PRAMUDYA</h2>' + hero + '<div class="stat-cols">' +
        '<div class="stat-rows"><div class="stat-head">STORY MISSIONS — ' + done + ' / ' + list.length + ' DONE</div>' + msn + '</div>' +
        '<div class="stat-rows"><div class="stat-head">ARSENAL — ' + wOwned + ' / ' + wTotal + ' OWNED</div>' + ars +
        '<div class="stat-head rec">RECORD</div>' + rec + '</div></div>';
    },

    newGame: function () {
      var st = SH.State;
      SH.Save.clear();
      st.cash = 250; st.wanted = 0; st.storyComplete = false;
      if (st.driving) SH.Vehicles.exit();
      st.player.x = SH.Config.world.spawn.x; st.player.z = SH.Config.world.spawn.z;
      st.player.health = 100; st.player.armor = 0;
      st.stats = { missionsDone: 0, carsStolen: 0, distanceKm: 0 };
      if (SH.Combat) { SH.Combat.owned = { fist: true, pistol: true, smg: false, shotgun: false }; SH.Combat.clearEnemies(); }
      st.weapon = 'pistol'; st.ammo = 12; st.ammoReserve = 36;
      if (SH.Missions) SH.Missions.currentIndex = 0;
      this.showPanel(null);
      this.syncMode();
      if (SH.Missions && SH.Missions.startIntro) SH.Missions.startIntro();
      else this.startPlaying();
    },

    continueGame: function () {
      SH.Save.loadGame();
      if (!SH.State.objective) SH.Missions.startIntroObjective();
      this.startPlaying();
    },

    startPlaying: function () {
      SH.State.mode = 'playing';
      this.showPanel(null);
      this.syncMode();
      lockPointer();
    },

    resume: function () {
      SH.State.mode = 'playing';
      this.syncMode();
      lockPointer();
    },

    openMap: function () {
      SH.State.mode = 'map';
      if (document.exitPointerLock) document.exitPointerLock();
      this.syncMode();
      SH.Minimap.drawFullMap(byId('bigmap'));
    },

    closeMap: function () {
      SH.State.mode = 'playing';
      this.syncMode();
      lockPointer();
    },

    syncMode: function () {
      var m = SH.State.mode;
      el.title.classList.toggle('hidden', m !== 'title');
      el.pause.classList.toggle('hidden', m !== 'paused');
      el.map.classList.toggle('hidden', m !== 'map');
      if (m === 'map') SH.Minimap.drawFullMap(byId('bigmap'));
      if (m === 'paused') this.refreshStats();
      if (m === 'title') el.btnContinue.classList.toggle('hidden', !SH.Save.hasSave());
    },

    updateTitleCamera: function (camera) {
      // Slow orbit inside one downtown intersection — towers loom on all sides
      // but the camera circle (r=34) never reaches a tower face.
      titleAngle += 0.016 * 0.1;
      var cx = -120 + Math.cos(titleAngle) * 34;
      var cz = -180 + Math.sin(titleAngle) * 34;
      camera.position.set(cx, 15, cz);
      camera.lookAt(-120 + Math.cos(titleAngle + 2.2) * 60, 20, -180 + Math.sin(titleAngle + 2.2) * 60);
    }
  };

  SH.Menus = Menus;
})(window.SH = window.SH || {});
