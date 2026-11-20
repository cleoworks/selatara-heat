// SELATARA HEAT — save.js
// localStorage save/load wrapped in try/catch with a schema version.
// Public API: SH.Save { saveGame(), loadGame(), hasSave(), clear() }.
(function (SH) {
  'use strict';

  // The schema version rides in the key itself: bump the suffix whenever
  // the saved shape changes and old saves are simply ignored, never migrated.
  var KEY = 'selatara-heat-save-v1';

  var Save = {
    saveGame: function () {
      try {
        var st = SH.State;
        var data = {
          v: 1, cash: st.cash,
          player: { x: st.player.x, z: st.player.z, health: st.player.health, armor: st.player.armor },
          hour: st.hour, outfit: st.outfit, settings: st.settings,
          stats: st.stats, missionsDone: st.stats.missionsDone,
          storyComplete: !!st.storyComplete,
          missionIndex: SH.Missions ? SH.Missions.currentIndex : 0,
          owned: SH.Combat ? SH.Combat.owned : null,
          weapon: st.weapon, ammo: st.ammo, ammoReserve: st.ammoReserve
        };
        window.localStorage.setItem(KEY, JSON.stringify(data));
        return true;
      } catch (e) { return false; }
    },

    loadGame: function () {
      try {
        var raw = window.localStorage.getItem(KEY);
        if (!raw) return false;
        var data = JSON.parse(raw);
        if (!data || data.v !== 1) return false;
        var st = SH.State;
        // Per-field finite guards: a truncated or hand-edited v1 save
        // must never poison live state with undefined/NaN — fields that
        // are missing or non-numeric keep their current/default values.
        st.cash = Number.isFinite(data.cash) ? data.cash : 0;
        if (data.player) {
          if (Number.isFinite(data.player.x)) st.player.x = data.player.x;
          if (Number.isFinite(data.player.z)) st.player.z = data.player.z;
          if (Number.isFinite(data.player.health)) st.player.health = data.player.health;
          if (Number.isFinite(data.player.armor)) st.player.armor = data.player.armor;
        }
        if (Number.isFinite(data.hour)) SH.Main.setHour(data.hour);
        if (data.outfit) st.outfit = data.outfit;
        if (data.settings) { st.settings = data.settings; SH.Input.sensitivity = data.settings.sensitivity || 1; SH.Audio.setVolumes(data.settings.volume, data.settings.music, data.settings.sfx); }
        if (data.stats && typeof data.stats === 'object') st.stats = data.stats;
        st.storyComplete = !!data.storyComplete;
        if (data.weapon) st.weapon = data.weapon;
        if (data.owned && SH.Combat) SH.Combat.owned = data.owned;
        if (Number.isFinite(data.missionIndex) && SH.Missions) SH.Missions.currentIndex = data.missionIndex;
        st.ammo = Number.isFinite(data.ammo) ? data.ammo : 0; st.ammoReserve = Number.isFinite(data.ammoReserve) ? data.ammoReserve : 0;
        return true;
      } catch (e) { return false; }
    },

    hasSave: function () {
      try { return !!window.localStorage.getItem(KEY); } catch (e) { return false; }
    },

    clear: function () {
      try { window.localStorage.removeItem(KEY); } catch (e) { /* storage unavailable */ }
    }
  };

  SH.Save = Save;
})(window.SH = window.SH || {});
