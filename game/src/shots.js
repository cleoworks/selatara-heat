// SELATARA HEAT — shots.js
// Deterministic ?shot=<name> scenes for screenshots: each stages the real game
// (seed, hour, weather, player/vehicle placement, HUD state) and lets the same
// code render it, so a shot is always a true frame of the game itself.
// Public API: SH.Shots { active, apply() }.
(function (SH) {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var name = params.get('shot');

  var Shots = {
    active: !!name,
    name: name,

    apply: function () {
      if (!name) return;
      var st = SH.State;
      st.mode = 'playing';
      if (SH.Missions) SH.Missions.startIntroObjective();
      if (name === 'drive') {
        SH.Main.setHour(17.9);
        var veh = SH.Vehicles.list[0];
        veh.x = -120; veh.z = -240; veh.heading = Math.PI; veh.speed = 0;
        SH.Vehicles.syncMesh(veh);
        SH.Vehicles.enter(veh);
        st.camYaw = Math.PI * 2; st.camPitch = 0.18;
      } else if (name === 'cover') {
        // Golden-hour drive through Pelita Heights (set up fully in slice b/c).
        SH.Main.setHour(17.9);
        st.player.x = -120; st.player.z = -250; st.camYaw = Math.PI; st.camPitch = 0.2;
      } else if (name === 'chase') {
        SH.Main.setHour(21.2);
        st.wanted = 4;
        st.player.x = 130; st.player.z = -52; st.camYaw = Math.PI * 1.1;
      } else if (name === 'combat') {
        SH.Main.setHour(19.4);
        st.player.x = -330; st.player.z = 92;
        st.objective = { title: 'NIGHT MARKET RUN', text: 'Catch the courier', x: -300, z: 120 };
      } else if (name === 'map') {
        SH.Main.setHour(10.5);
        st.mode = 'map';
      }
      var hourOverride = parseFloat(params.get('hour'));
      if (!isNaN(hourOverride)) SH.Main.setHour(hourOverride);
    }
  };

  SH.Shots = Shots;
})(window.SH = window.SH || {});
