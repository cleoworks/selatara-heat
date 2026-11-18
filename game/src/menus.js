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
      el.btnContinue = byId('btn-continue');

      byId('btn-new').addEventListener('click', function () { SH.Audio.init(); SH.Audio.resume(); SH.Audio.click(); Menus.newGame(); });
      el.btnContinue.addEventListener('click', function () { SH.Audio.init(); SH.Audio.resume(); SH.Audio.click(); Menus.continueGame(); });
      byId('btn-settings').addEventListener('click', function () { Menus.showPanel('settings'); });
      byId('btn-controls').addEventListener('click', function () { Menus.showPanel('controls'); });
      byId('btn-resume').addEventListener('click', function () { Menus.resume(); });
      byId('btn-openmap').addEventListener('click', function () { Menus.openMap(); });
      byId('btn-save').addEventListener('click', function () {
        if (SH.Save.saveGame()) SH.HUD.notify('Game saved');
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

      // Full-map click → waypoint.
      var big = byId('bigmap');
      big.addEventListener('click', function (e) {
        var w = SH.Minimap.mapClickToWorld(big, e.clientX, e.clientY);
        if (w) {
          SH.State.waypoint = w;
          SH.Minimap.drawFullMap(big);
          SH.HUD.notify('Waypoint set');
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

    newGame: function () {
      var st = SH.State;
      SH.Save.clear();
      st.cash = 250; st.wanted = 0;
      st.player.x = SH.Config.world.spawn.x; st.player.z = SH.Config.world.spawn.z;
      st.player.health = 100; st.player.armor = 0;
      st.stats = { missionsDone: 0, carsStolen: 0, distanceKm: 0 };
      SH.Missions.startIntroObjective();
      this.startPlaying();
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
