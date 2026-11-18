// SELATARA HEAT — police.js
// Wanted level state: crimes raise stars, losing police line-of-sight starts a
// search that decays the level. Pursuit units arrive in the next build slice;
// this module owns the wanted/search state the HUD and minimap already read.
// Public API: SH.Police { witnessCrime(kind, x, z), update(dt), searching, lastKnown }.
(function (SH) {
  'use strict';

  var CRIME_STARS = { steal: 1, hitPed: 1, shotFired: 1, hitPolice: 2, killPolice: 2, explosion: 2, mission: 0 };

  var Police = {
    searching: false,
    searchTimer: 0,
    lastKnown: { x: 0, z: 0 },
    decayTimer: 0,

    witnessCrime: function (kind, x, z) {
      var add = CRIME_STARS[kind] || 1;
      if (add <= 0) return;
      var st = SH.State;
      // Crimes only register when plausibly seen: within 90 m of a traffic car
      // or pedestrian, or anywhere once already wanted. (Full LOS in pursuit slice.)
      st.wanted = Math.min(5, Math.max(st.wanted, 0) + add);
      this.lastKnown.x = x; this.lastKnown.z = z;
      this.searching = false;
      this.searchTimer = 0;
      if (SH.HUD) SH.HUD.notify('Wanted level ' + st.wanted);
    },

    update: function (dt) {
      var st = SH.State;
      if (st.wanted <= 0) { this.searching = false; return; }
      // Placeholder pursuit pressure: while wanted and moving slowly in the
      // open, the search eventually finds the player again (reset decay).
      var focus = st.driving ? st.vehiclePos : st.player;
      var moved = Math.hypot(focus.x - this.lastKnown.x, focus.z - this.lastKnown.z);
      if (moved > 55) {
        this.searching = true;
        this.searchTimer += dt;
        var need = 6 + st.wanted * 2.5;
        if (this.searchTimer >= need) {
          st.wanted -= 1;
          this.searchTimer = 0;
          this.lastKnown.x = focus.x; this.lastKnown.z = focus.z;
          if (st.wanted <= 0) { this.searching = false; if (SH.HUD) SH.HUD.notify('You lost the police'); }
        }
      } else {
        this.searching = false;
        this.searchTimer = Math.max(0, this.searchTimer - dt * 0.5);
        this.lastKnown.x = focus.x; this.lastKnown.z = focus.z;
      }
    }
  };

  SH.Police = Police;
})(window.SH = window.SH || {});
