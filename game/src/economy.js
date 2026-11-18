// SELATARA HEAT — economy.js
// Money flow and the city's services (gun shop, clothes, workshop, safehouse).
// Full shop menus land with the mission slice; places + cash API live here.
// Public API: SH.Economy { places[], addCash(n), spend(n) }.
(function (SH) {
  'use strict';

  var Economy = {
    places: [
      { kind: 'safehouse', name: 'Safehouse Ruko Senja', x: -368, z: 84 },
      { kind: 'guns', name: 'Senjata Senja (Gun Shop)', x: -128, z: -68 },
      { kind: 'workshop', name: 'Bengkel Arus (Workshop)', x: 246, z: 54 },
      { kind: 'clothes', name: 'Butik Kencana (Clothes)', x: 60, z: 200 },
      { kind: 'safehouse2', name: 'Kencana Rest House', x: -240, z: 200 }
    ],

    addCash: function (n) {
      SH.State.cash += n;
      if (SH.HUD) SH.HUD.flashCash(n);
    },

    spend: function (n) {
      if (SH.State.cash < n) return false;
      SH.State.cash -= n;
      if (SH.HUD) SH.HUD.flashCash(-n);
      return true;
    }
  };

  SH.Economy = Economy;
})(window.SH = window.SH || {});
