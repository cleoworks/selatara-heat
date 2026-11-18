// SELATARA HEAT — traffic.js
// Traffic AI on the shared road graph: lane driving, car-following gaps,
// junction choices, spawn out of sight / despawn far away, panic braking.
// Public API: SH.Traffic { init(scene), update(dt), cars[] }.
(function (SH) {
  'use strict';

  var Traffic = {
    cars: [],
    rng: SH.World.makeRng(7),

    init: function (scene) {
      var types = ['sedan', 'sedan', 'sedan', 'sport', 'truck', 'motor'];
      var n = SH.Config.loop.trafficCount;
      for (var i = 0; i < n; i++) {
        var type = types[(this.rng() * types.length) | 0];
        var colors = SH.Config.vehicleTypes[type].colors;
        var veh = SH.Vehicles.spawnVehicle(scene, type, colors[(this.rng() * colors.length) | 0], 0, -9999, 0);
        veh.driver = 'traffic';
        veh.traffic = { edge: -1, t: 0, from: 0, speed: 0, cruise: 8 + this.rng() * 5 };
        this.cars.push(veh);
        this.placeOnRandomEdge(veh, true);
      }
    },

    placeOnRandomEdge: function (veh, anywhere) {
      var g = SH.World.graph;
      var focus = SH.State.driving ? SH.State.vehiclePos : SH.State.player;
      for (var tries = 0; tries < 12; tries++) {
        var ei = (this.rng() * g.edges.length) | 0;
        var e = g.edges[ei];
        var a = g.nodes[e.a], b = g.nodes[e.b];
        var mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        var d = Math.hypot(mx - focus.x, mz - focus.z);
        if (!anywhere && (d < 130 || d > SH.Config.loop.despawnRadius)) continue;
        if (anywhere && d < 60) continue;
        veh.traffic.edge = ei;
        veh.traffic.from = e.a;
        veh.traffic.t = this.rng() * 0.8 + 0.1;
        veh.traffic.speed = veh.traffic.cruise * 0.7;
        this.positionOnEdge(veh);
        return;
      }
      veh.mesh.visible = false;
      veh.traffic.edge = -1;
    },

    positionOnEdge: function (veh) {
      var g = SH.World.graph;
      var e = g.edges[veh.traffic.edge];
      var from = veh.traffic.from === e.a ? e.a : e.b;
      var to = from === e.a ? e.b : e.a;
      var a = g.nodes[from], b = g.nodes[to];
      var dx = b.x - a.x, dz = b.z - a.z;
      var len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      var off = SH.Config.world.laneOffset;
      var rx = -dz * off, rz = dx * off; // right-hand lane
      veh.x = a.x + dx * len * veh.traffic.t + rx;
      veh.z = a.z + dz * len * veh.traffic.t + rz;
      veh.heading = Math.atan2(dx, dz);
      veh.mesh.visible = true;
      SH.Vehicles.syncMesh(veh);
    },

    chooseNextEdge: function (veh, atNode) {
      var g = SH.World.graph;
      var node = g.nodes[atNode];
      var came = veh.traffic.edge;
      var options = [];
      for (var i = 0; i < node.edges.length; i++) {
        if (node.edges[i] !== came) options.push(node.edges[i]);
      }
      if (!options.length) options = [came];
      // Prefer going straight: same axis as the edge we arrived on.
      var cur = g.edges[came];
      var straight = options.filter(function (ei) { return g.edges[ei].vertical === cur.vertical; });
      var pickFrom = straight.length && this.rng() > 0.3 ? straight : options;
      var next = pickFrom[(this.rng() * pickFrom.length) | 0];
      veh.traffic.edge = next;
      veh.traffic.from = atNode;
      veh.traffic.t = 0;
    },

    gapAhead: function (veh) {
      // Smallest gap to any vehicle/pedestrian ahead of this car (same direction cone).
      var best = 26;
      var fx = Math.sin(veh.heading), fz = Math.cos(veh.heading);
      var all = SH.Vehicles.list;
      for (var i = 0; i < all.length; i++) {
        var o = all[i];
        if (o === veh || !o.active) continue;
        var dx = o.x - veh.x, dz = o.z - veh.z;
        var ahead = dx * fx + dz * fz;
        if (ahead < 1 || ahead > best) continue;
        var side = Math.abs(dx * fz - dz * fx);
        if (side < 2.6) best = ahead;
      }
      var p = SH.State.player;
      if (!SH.State.driving) {
        var pdx = p.x - veh.x, pdz = p.z - veh.z;
        var pa = pdx * fx + pdz * fz;
        if (pa > 0 && pa < best && Math.abs(pdx * fz - pdz * fx) < 2.2) best = pa;
      }
      return best;
    },

    update: function (dt) {
      var st = SH.State;
      // Screenshot staging is deterministic: traffic holds exactly where
      // shots.js placed it instead of wandering into (or out of) the frame.
      if (SH.Shots && SH.Shots.active) return;
      var focus = st.driving ? st.vehiclePos : st.player;
      for (var i = 0; i < this.cars.length; i++) {
        var veh = this.cars[i];
        if (veh.dead) continue;
        var distToPlayer = Math.hypot(veh.x - focus.x, veh.z - focus.z);
        if (veh.traffic.edge < 0 || distToPlayer > SH.Config.loop.despawnRadius) {
          if (st.mode === 'playing') this.placeOnRandomEdge(veh, false);
          continue;
        }
        var gap = this.gapAhead(veh);
        var target = veh.traffic.cruise;
        if (gap < 9) target = 0;
        else if (gap < 18) target = veh.traffic.cruise * (gap - 9) / 12;
        if (gap < 6 && veh.traffic.speed > 4 && !veh.honked) { veh.honked = true; SH.Audio.horn(); }
        if (gap > 12) veh.honked = false;
        var accel = target > veh.traffic.speed ? 5.5 : 14;
        veh.traffic.speed += Math.max(-accel * dt, Math.min(accel * dt, target - veh.traffic.speed));
        veh.speed = veh.traffic.speed;

        var g = SH.World.graph;
        var e = g.edges[veh.traffic.edge];
        var a = g.nodes[e.a], b = g.nodes[e.b];
        var len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        veh.traffic.t += veh.traffic.speed * dt / len;
        if (veh.traffic.t >= 1) {
          var atNode = veh.traffic.from === e.a ? e.b : e.a;
          this.chooseNextEdge(veh, atNode);
        }
        this.positionOnEdge(veh);
      }
    }
  };

  SH.Traffic = Traffic;
})(window.SH = window.SH || {});
