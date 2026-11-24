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

  // POLISH 01/02/04 — small inline-SVG row icons for the career
  // panel (missions, arsenal, city services). Stroke icons ride
  // currentColor; the weapon silhouettes are filled and grow
  // longer fist -> pistol -> SMG -> shotgun, like the real rack.
  function ric(svg) { return '<span class="ric">' + svg + '</span>'; }
  function lineIcon(inner) {
    return ric('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>');
  }
  function fillIcon(d) {
    return ric('<svg viewBox="0 0 24 24" fill="currentColor"><path d="' + d + '"/></svg>');
  }
  var ICONS = {
    flag: fillIcon('M5 3v18h2.2v-6.8h9.9L14.6 10 17.1 5.8H7.2V3z'),
    fist: fillIcon('M8.6 12.9V7.6c0-.9 1.3-1.2 1.8-.4l.5.8V6.4c0-1 1.5-1.2 1.9-.3l.3.7V6.3c0-1 1.5-1.2 1.9-.2l.3.7c.9-.6 2.1 0 2.1 1.1v4.9c0 4.5-3 7.7-7.1 7.7-3.2 0-5.4-1.7-6.5-4.5-.3-.9-.5-2-.5-3.2v-1.9c0-1 1.4-1.4 2.1-.6l1 1.2V8.7c0-.9 1.4-1.1 1.9-.3l.3.5z'),
    pistol: fillIcon('M3.2 6.8h13.6c.5 0 .9.3 1 .8l.5 2.3c.1.6-.3 1.1-.9 1.2l-4.9.6-1 5c-.1.6-.7 1-1.3.9l-2.7-.4c-.6-.1-1-.7-.9-1.3l.8-4.6H5.6l-.6 3.6c-.1.6-.6 1-1.2.9l-1.5-.2c-.6-.1-.9-.6-.8-1.2l1.7-7.6z'),
    smg: fillIcon('M1.8 6.5h15.9l.9 2.9c.1.5-.2 1-.7 1.1l-3.9.7-.7 4.9c-.1.6-.6 1-1.2 1h-2.4c-.6 0-1-.5-.9-1.1l.7-4.8H7.6l-.6 4.3c-.1.6-.6 1-1.2 1H3.6c-.6 0-1-.5-.9-1.1l.6-4.4-1.5-.2V6.5z'),
    shotgun: fillIcon('M1.2 8.2h19.6c.6 0 1 .4 1 1v1.2c0 .6-.4 1-1 1h-8.4l-.5 3c-.1.5-.5.9-1 .9H8.2c-.6 0-1-.5-.9-1.1l.4-2.8H5.9l-.5 3c-.1.5-.5.9-1 .9H2.1c-.6 0-1-.5-.9-1.1l.9-5.9c.1-.6.5-1 1.1-1z'),
    guns: lineIcon('<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>'),
    workshop: lineIcon('<circle cx="12" cy="12" r="3.4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>'),
    food: lineIcon('<path d="M3.5 12.5h17a8.5 8.5 0 0 1-17 0z"/><path d="M8.2 8.6c0-1.9 1.7-1.9 1.7-3.6M13.2 8.6c0-1.9 1.7-1.9 1.7-3.6"/>'),
    clothes: lineIcon('<path d="M8.6 4.2L4 7.3l1.8 3.7 2.1-1v9.8h8.2V10l2.1 1L20 7.3 15.4 4.2a3.4 3.4 0 0 1-6.8 0z"/>'),
    safehouse: lineIcon('<path d="M4 11.3L12 4.2l8 7.1"/><path d="M6.3 9.9v9.9h11.4V9.9"/><path d="M10.1 19.8v-4.9h3.8v4.9"/>')
  };

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

    // Career panel inside the pause menu (v3: hero tiles + taxonomy +
    // syndicate + city services).
    // Every value is a live field the game really tracks — cash,
    // stats.missionsDone / carsStolen, the mission list + currentIndex,
    // Combat.owned, Config.weapons labels, Config.shops prices,
    // State.time (real accumulated play seconds) and Save.hasSave().
    // The only derived numbers are direct ratios/sums of tracked
    // values, labelled as such: STORY COMPLETION % = missionsDone /
    // Missions.list.length x 100, and the SYNDICATE rows (jobs and
    // contract totals summed over Missions.list per giver). CITY
    // SERVICES lists Economy.places verbatim with the service each
    // kind really sells (Economy.catalog is the source of truth;
    // prices are read from Config.shops, never typed twice). Nothing
    // else is derived from anything the code does not record
    // (distanceKm stays excluded: the field exists but no system ever
    // updates it; the game tracks no races, stunts or collectibles,
    // so no such categories are shown). The v2 RECORD block is gone:
    // the hero tiles, the mission markers and the ARSENAL head
    // already carry every line it repeated.
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
        msn += '<div class="msn ' + cls + '"><span class="t">' + ICONS.flag + mark + ' ' + list[i].title + '</span><i>' + list[i].giver + ' · <b>' + fmtCash(list[i].reward) + '</b></i></div>';
      }
      var ars = '';
      for (var wid2 in SH.Config.weapons) {
        var w = SH.Config.weapons[wid2];
        var status;
        if (owned[wid2]) status = '<b class="own">OWNED</b>';
        else if (SH.Config.shops[wid2]) status = '<b class="price">' + fmtCash(SH.Config.shops[wid2]) + '</b>';
        else status = '<b class="lock">LOCKED</b>';
        ars += '<div class="stat-row"><span>' + (ICONS[wid2] || '') + w.label + '</span>' + status + '</div>';
      }
      // SYNDICATE — the job givers behind the story list: jobs and
      // contract totals summed straight over Missions.list.
      var crewOrder = [], crewBy = {};
      for (var ci = 0; ci < list.length; ci++) {
        var gv = list[ci].giver;
        if (!crewBy[gv]) { crewBy[gv] = { jobs: 0, total: 0 }; crewOrder.push(gv); }
        crewBy[gv].jobs++;
        crewBy[gv].total += list[ci].reward || 0;
      }
      var crew = '';
      for (var cj = 0; cj < crewOrder.length; cj++) {
        var cg = crewOrder[cj];
        crew += '<div class="stat-row"><span>' + cg + '</span><b>' + crewBy[cg].jobs +
          (crewBy[cg].jobs === 1 ? ' job' : ' jobs') + ' · ' + fmtCash(crewBy[cg].total) + '</b></div>';
      }
      // CITY SERVICES — Economy.places verbatim; the tag names the
      // service Economy.catalog really sells at that kind of place,
      // priced from Config.shops (workshop respray clears wanted,
      // warung meal heals 45, safehouse rest + save are free).
      var P = SH.Config.shops;
      var svcTag = {
        guns: 'WEAPONS + ARMOUR',
        workshop: 'RESPRAY ' + fmtCash(P.spray) + ' CLEARS HEAT',
        food: 'MEAL ' + fmtCash(P.meal) + ' · HEAL 45',
        clothes: 'OUTFIT ' + fmtCash(P.outfit),
        safehouse: 'REST + SAVE · FREE'
      };
      var places = (SH.Economy && SH.Economy.places) || [];
      var svc = '';
      for (var si = 0; si < places.length; si++) {
        svc += '<div class="stat-row"><span>' + (ICONS[places[si].kind] || '') + places[si].name + '</span><b>' + (svcTag[places[si].kind] || '') + '</b></div>';
      }
      el.stats.innerHTML = '<h2>CAREER — RAKA PRAMUDYA</h2>' + hero + '<div class="stat-cols">' +
        '<div class="stat-rows"><div class="stat-head">STORY MISSIONS — ' + done + ' / ' + list.length + ' DONE</div>' + msn +
        '<div class="stat-head rec">THE SYNDICATE — JOB GIVERS</div>' + crew + '</div>' +
        '<div class="stat-rows"><div class="stat-head">ARSENAL — ' + wOwned + ' / ' + wTotal + ' OWNED</div>' + ars +
        '<div class="stat-head rec">CITY SERVICES — ' + places.length + ' PLACES</div>' + svc + '</div></div>';
      // POLISH 01/02/04: the character card beside the buttons —
      // Raka's portrait drawn by the HUD's own portrait painter
      // into the pause screen's canvas (fills the dead space
      // under the menu buttons; name + role are the game's own
      // strings for him).
      var pcv = byId('pause-portrait');
      if (pcv && SH.HUD && SH.HUD.drawPortrait) SH.HUD.drawPortrait('Raka', null, pcv);
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
      if (m === 'title') { el.btnContinue.classList.toggle('hidden', !SH.Save.hasSave()); this.stageTitleVignette(); }
    },

    // POLISH2 (spec C13): the title screen lives — Raka stands
    // beside his pink sport car at the downtown intersection the
    // title camera orbits, in the dusk city. Everything is real:
    // the car is a genuine parked vehicle from the vehicle pool
    // (it stays in the world as a stealable car), and the figure
    // is the player's own character mesh, which Player.update
    // reclaims the moment a game starts. Built once.
    stageTitleVignette: function () {
      if (this._vignette) return;
      if (!SH.Vehicles || !SH.Player || !SH.Player.mesh || !SH.Main || !SH.Main.getScene) return;
      var scene = SH.Main.getScene();
      if (!scene) return;
      // 15 m from the orbit centre toward the composed still's
      // camera bearing: at 8 m the pair printed as a speck hidden
      // behind the CONTROLS button (round-1 proof); at 15 m the
      // car reads ~165 px wide in the frame's lower third, below
      // the menu, and the live orbit still passes it by.
      // POLISH2B (item 7): the pair moves in to 12 m — closer to
      // the orbit's average viewpoint, so Raka + the car carry
      // more of the title frame (the still's own pin in shots.js
      // frames them centre-bottom at ~2.5x the old print size).
      var vx = -120 + Math.sin(3.8) * 12, vz = -180 + Math.cos(3.8) * 12;
      SH.Vehicles.spawnVehicle(scene, 'sport', 0xff4fa3, vx, vz, 2.2);
      var gy = SH.World && SH.World.groundHeightAt ? SH.World.groundHeightAt(vx - 1.0, vz - 1.3) : 0;
      SH.Player.mesh.position.set(vx - 1.0, gy + 0.005, vz - 1.3);
      SH.Player.mesh.rotation.set(0, 3.8, 0);
      SH.Player.mesh.visible = true;
      this._vignette = true;
    },

    updateTitleCamera: function (camera) {
      // Slow orbit inside one downtown intersection — towers loom on all sides
      // but the camera circle (r=34) never reaches a tower face.
      titleAngle += 0.016 * 0.1;
      var cx = -120 + Math.cos(titleAngle) * 34;
      var cz = -180 + Math.sin(titleAngle) * 34;
      camera.position.set(cx, 15, cz);
      camera.lookAt(-120 + Math.cos(titleAngle + 2.2) * 60, 20, -180 + Math.sin(titleAngle + 2.2) * 60);
      // POLISH2: the vignette figure breathes on the title screen
      // (his own idle controller, stepped here because the
      // gameplay loop does not run in title mode).
      if (!this._vignette) this.stageTitleVignette();
      if (SH.Player && SH.Player.ctl) SH.Player.ctl.update(0.016);
    }
  };

  SH.Menus = Menus;
})(window.SH = window.SH || {});
