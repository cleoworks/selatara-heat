// SELATARA HEAT — combat.js
// Weapon state and inventory. Firing, hitscan and enemy AI land in the combat
// slice; this module owns weapon data access + ammo bookkeeping the HUD reads.
// Public API: SH.Combat { current(), giveWeapon(id, ammo), cycleWeapon() }.
(function (SH) {
  'use strict';

  var ORDER = ['fist', 'pistol', 'smg', 'shotgun'];

  var Combat = {
    owned: { fist: true, pistol: false, smg: false, shotgun: false },

    current: function () {
      return SH.Config.weapons[SH.State.weapon] || SH.Config.weapons.fist;
    },

    giveWeapon: function (id, ammo) {
      this.owned[id] = true;
      SH.State.weapon = id;
      var spec = SH.Config.weapons[id];
      SH.State.ammo = spec.mag === Infinity ? 0 : spec.mag;
      SH.State.ammoReserve = ammo || 0;
      if (SH.HUD) SH.HUD.notify('New weapon: ' + spec.label);
    },

    cycleWeapon: function () {
      var cur = ORDER.indexOf(SH.State.weapon);
      for (var i = 1; i <= ORDER.length; i++) {
        var id = ORDER[(cur + i) % ORDER.length];
        if (this.owned[id]) {
          SH.State.weapon = id;
          var spec = SH.Config.weapons[id];
          if (spec.mag !== Infinity && SH.State.ammo > spec.mag) SH.State.ammo = spec.mag;
          return;
        }
      }
    }
  };

  SH.Combat = Combat;
})(window.SH = window.SH || {});
