// SELATARA HEAT — economy.js
// Money flow and the city's services. Walking up to a place (or driving into
// the workshop bay) opens a small shop panel; every price comes from
// SH.Config.shops. Services: gun shop (weapons / ammo / armour), workshop
// (repair + paid heat removal), warung food stall (heal), safehouses (rest
// to morning + manual save) and the boutique (outfit colours).
// Public API: SH.Economy { places[], addCash(n), spend(n), buy(id), openShop(kind),
//   closeShop(), update(dt) }.
// All money movement routes through addCash/spend so the HUD cash flash,
// the mission ledger and the save file never disagree about the balance.
(function (SH) {
  'use strict';

  var OUTFITS = [
    { name: 'Senja Red', shirt: 0xc94f4f, pants: 0x2a3550 },
    { name: 'Arus Teal', shirt: 0x1f6f6f, pants: 0x22242c },
    { name: 'Kencana Gold', shirt: 0xe8b04b, pants: 0x3a2a1a },
    { name: 'Malam Navy', shirt: 0x2a3f8f, pants: 0x14161c },
    { name: 'Pasar Pink', shirt: 0xff4fa3, pants: 0x2a1b2e }
  ];

  function price(id) { return SH.Config.shops[id] || 0; }

  var Economy = {
    places: [
      { kind: 'safehouse', name: 'Safehouse Ruko Senja', x: -368, z: 84 },
      { kind: 'guns', name: 'Senjata Senja (Gun Shop)', x: -128, z: -68 },
      { kind: 'workshop', name: 'Bengkel Arus (Workshop)', x: 246, z: 54 },
      { kind: 'food', name: 'Warung Bu Tini (Food)', x: -330, z: 96 },
      { kind: 'clothes', name: 'Butik Kencana (Clothes)', x: 60, z: 200 },
      { kind: 'safehouse', name: 'Kencana Rest House', x: -240, z: 200 }
    ],
    outfitIndex: 0,
    _nearKind: null,

    addCash: function (n) {
      SH.State.cash += n;
      if (SH.HUD) SH.HUD.flashCash(n);
    },

    spend: function (n) {
      if (SH.State.cash < n) return false;
      SH.State.cash -= n;
      if (SH.HUD) SH.HUD.flashCash(-n);
      return true;
    },

    // The catalogue for a shop kind: [{ id, label, detail }] — labels are
    // computed live so prices / owned state / repair quotes are always true.
    catalog: function (kind) {
      var st = SH.State, C = SH.Combat, P = SH.Config.shops;
      var items = [];
      function ammoItem(id, weaponId) {
        var spec = SH.Config.weapons[weaponId];
        return { id: id, label: spec.label + ' ammo', detail: '$' + P[id] + ' — +' + spec.mag * 2 + ' rounds', can: C && C.owned[weaponId] };
      }
      if (kind === 'guns') {
        items.push({ id: 'smg', label: SH.Config.weapons.smg.label, detail: '$' + P.smg + (C && C.owned.smg ? ' — OWNED' : ''), can: !(C && C.owned.smg) });
        items.push({ id: 'shotgun', label: SH.Config.weapons.shotgun.label, detail: '$' + P.shotgun + (C && C.owned.shotgun ? ' — OWNED' : ''), can: !(C && C.owned.shotgun) });
        items.push(ammoItem('pistolAmmo', 'pistol'));
        items.push(ammoItem('smgAmmo', 'smg'));
        items.push(ammoItem('shotgunAmmo', 'shotgun'));
        items.push({ id: 'armor', label: 'Body armour', detail: '$' + P.armor + ' — full 100', can: st.player.armor < 100 });
      } else if (kind === 'workshop') {
        var v = st.vehicle;
        var missing = v ? Math.max(0, 100 - v.hp) : 0;
        var cost = Math.ceil(missing * P.repairPerHp);
        items.push({ id: 'repair', label: 'Repair vehicle', detail: v ? ('$' + cost + ' — restore ' + Math.round(missing) + ' HP') : 'Bring a vehicle', can: !!v && missing > 0 });
        items.push({ id: 'spray', label: 'Full service: repair + respray', detail: v ? ('$' + (P.spray + cost) + ' — full repair, new plates, clears wanted') : ('$' + P.spray + ' — bring a vehicle'), can: !!v && (missing > 0 || st.wanted > 0) });
      } else if (kind === 'food') {
        items.push({ id: 'meal', label: 'Nasi campur + es teh', detail: '$' + P.meal + ' — heal 45 HP', can: st.player.health < 100 });
      } else if (kind === 'safehouse') {
        items.push({ id: 'rest', label: 'Rest until morning', detail: 'Free — full HP, time set to 08:00', can: true });
        items.push({ id: 'save', label: 'Save game', detail: 'Free — manual save point', can: true });
      } else if (kind === 'clothes') {
        var nxt = OUTFITS[(this.outfitIndex + 1) % OUTFITS.length];
        items.push({ id: 'outfit', label: 'Outfit: ' + nxt.name, detail: '$' + P.outfit + ' — new shirt + pants colours', can: true });
      }
      return items;
    },

    buy: function (id) {
      var st = SH.State, C = SH.Combat, P = SH.Config.shops;
      function done(msg) {
        if (SH.Audio) SH.Audio.cash();
        if (SH.HUD) SH.HUD.notify(msg);
        Economy.renderPanel();
        return true;
      }
      function fail(msg) {
        if (SH.HUD) SH.HUD.notify(msg);
        return false;
      }
      switch (id) {
        case 'smg': case 'shotgun': {
          if (C.owned[id]) return fail('Already owned');
          if (!this.spend(P[id])) return fail('Not enough cash');
          C.giveWeapon(id, SH.Config.weapons[id].mag * 2);
          return done('Bought ' + SH.Config.weapons[id].label);
        }
        case 'pistolAmmo': case 'smgAmmo': case 'shotgunAmmo': {
          var wid = id.replace('Ammo', '');
          if (!C.owned[wid]) return fail('Buy the weapon first');
          if (!this.spend(P[id])) return fail('Not enough cash');
          // Top up the reserve of the matching weapon family: if it is not
          // the equipped gun, the rounds wait in the shared reserve pool.
          st.ammoReserve += SH.Config.weapons[wid].mag * 2;
          return done('Ammo +' + SH.Config.weapons[wid].mag * 2);
        }
        case 'armor': {
          if (!this.spend(P.armor)) return fail('Not enough cash');
          st.player.armor = SH.Config.player.maxArmor;
          return done('Armour restored');
        }
        case 'repair': {
          var v = st.vehicle;
          if (!v) return fail('No vehicle');
          var cost = Math.ceil(Math.max(0, 100 - v.hp) * P.repairPerHp);
          if (cost <= 0) return fail('Vehicle is already whole');
          if (!this.spend(cost)) return fail('Not enough cash');
          v.hp = 100; v.dead = false;
          return done('Repaired for $' + cost);
        }
        case 'spray': {
          var sv = st.vehicle;
          if (!sv) return fail('No vehicle');
          var sCost = P.spray + Math.ceil(Math.max(0, 100 - sv.hp) * P.repairPerHp);
          if (!this.spend(sCost)) return fail('Not enough cash');
          sv.hp = 100; sv.dead = false;
          if (SH.Police) SH.Police.clearWanted();
          return done('Full service — repaired, resprayed, heat gone');
        }
        case 'meal': {
          if (!this.spend(P.meal)) return fail('Not enough cash');
          st.player.health = Math.min(SH.Config.player.maxHealth, st.player.health + 45);
          return done('Warung Bu Tini never misses. +45 HP');
        }
        case 'rest': {
          SH.Main.setHour(8);
          st.player.health = SH.Config.player.maxHealth;
          return done('You sleep. Selatara resets. (08:00)');
        }
        case 'save': {
          if (SH.Save && SH.Save.saveGame()) return done('Game saved');
          return fail('Save unavailable in this browser');
        }
        case 'outfit': {
          if (!this.spend(P.outfit)) return fail('Not enough cash');
          this.outfitIndex = (this.outfitIndex + 1) % OUTFITS.length;
          var o = OUTFITS[this.outfitIndex];
          st.outfit = { shirt: o.shirt, pants: o.pants };
          if (SH.Save) SH.Save.saveGame();
          return done('New outfit: ' + o.name + ' (applies next spawn)');
        }
      }
      return false;
    },

    // ---- shop panel (DOM built once, re-rendered on open + on buy) ----
    openShop: function (kind, placeName) {
      var st = SH.State;
      st.shopOpen = true;
      st.shopKind = kind;
      this._panelName = placeName || kind;
      this.renderPanel();
      var panel = document.getElementById('shop-panel');
      if (panel) panel.classList.remove('hidden');
      if (document.exitPointerLock) document.exitPointerLock();
    },

    closeShop: function () {
      var st = SH.State;
      st.shopOpen = false;
      st.shopKind = null;
      var panel = document.getElementById('shop-panel');
      if (panel) panel.classList.add('hidden');
      if (SH.HUD) SH.HUD.setPrompt(null);
    },

    renderPanel: function () {
      var st = SH.State;
      var panel = document.getElementById('shop-panel');
      if (!panel || !st.shopKind) return;
      var items = this.catalog(st.shopKind);
      var html = '<div class="shop-head"><span>' + (this._panelName || '') + '</span><span class="shop-cash">$' + st.cash.toLocaleString('en-US') + '</span></div>';
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        html += '<button class="shop-item" data-buy="' + it.id + '"' + (it.can ? '' : ' disabled') + '>' +
          '<span>' + it.label + '</span><span class="shop-detail">' + it.detail + '</span></button>';
      }
      html += '<div class="shop-hint">Click an item to buy — walk away or press E to close</div>';
      panel.innerHTML = html;
      var buttons = panel.querySelectorAll('[data-buy]');
      for (var b = 0; b < buttons.length; b++) {
        buttons[b].addEventListener('click', function () { Economy.buy(this.getAttribute('data-buy')); });
      }
    },

    // Proximity: the nearest place inside its radius wins. On foot you must
    // walk in; the workshop serves the car you are driving.
    update: function (dt) {
      var st = SH.State;
      if (st.mode !== 'playing') { if (st.shopOpen) this.closeShop(); return; }
      var f = st.driving ? st.vehiclePos : st.player;
      var best = null, bd = Infinity;
      for (var i = 0; i < this.places.length; i++) {
        var p = this.places[i];
        var d = Math.hypot(p.x - f.x, p.z - f.z);
        var radius = p.kind === 'workshop' ? 13 : 6.5;
        if (d < radius && d < bd) { bd = d; best = p; }
      }
      if (st.shopOpen) {
        // Walking/driving away (or swapping to a different place) closes it.
        if (!best || best.kind !== st.shopKind) this.closeShop();
        return;
      }
      if (!best) { if (this._nearKind) { this._nearKind = null; if (SH.HUD) SH.HUD.setPrompt(null); } return; }
      if (best.kind === 'workshop' && !st.driving) {
        if (SH.HUD) SH.HUD.setPrompt('Bengkel Arus — bring a vehicle to use the workshop');
        this._nearKind = 'workshop-blocked';
        return;
      }
      this._nearKind = best.kind;
      if (SH.HUD) SH.HUD.setPrompt('E — ' + best.name);
      if (SH.Input && SH.Input.wasPressed('KeyE')) this.openShop(best.kind, best.name);
    }
  };

  SH.Economy = Economy;
})(window.SH = window.SH || {});
