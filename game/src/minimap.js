// SELATARA HEAT — minimap.js
// The round minimap: the static city (roads, blocks, water, park) is rendered
// ONCE to a large offscreen canvas from the road graph; each frame the visible
// minimap only clips a circle, rotates the pre-render with camera yaw, and
// draws dynamic blips. Also renders the full pause map into a given canvas.
// Public API: SH.Minimap { init(), render(), drawFullMap(canvas, waypointCb) }.
(function (SH) {
  'use strict';

  var MAP = 1100;               // offscreen px
  var WORLD_W = 1360, WORLD_H = 1160; // world span the offscreen map covers
  var off = null;
  var viewRadius = 70;          // world metres visible from centre to edge

  function w2mx(x) { return (x + WORLD_W / 2) / WORLD_W * MAP; }
  function w2my(z) { return (z + WORLD_H / 2) / WORLD_H * MAP; }
  function m2wx(px) { return px / MAP * WORLD_W - WORLD_W / 2; }
  function m2wz(py) { return py / MAP * WORLD_H - WORLD_H / 2; }

  function prerender() {
    off = document.createElement('canvas');
    off.width = MAP; off.height = MAP;
    var g = off.getContext('2d');
    var cfg = SH.Config.world;
    g.fillStyle = '#3d6b35'; g.fillRect(0, 0, MAP, MAP);                       // land
    g.fillStyle = '#16486b';                                                    // sea
    g.fillRect(0, w2my(cfg.waterZ), MAP, MAP - w2my(cfg.waterZ));
    g.fillRect(w2mx(cfg.halfX + 40), 0, MAP, MAP);
    g.fillStyle = '#c9a87a';                                                    // sand
    g.fillRect(0, w2my(cfg.beachZ), MAP, w2my(cfg.waterZ) - w2my(cfg.beachZ));
    g.fillStyle = '#2e5d33';                                                    // park
    g.fillRect(w2mx(-132), w2my(-72), w2mx(132) - w2mx(-132), w2my(192) - w2my(-72));
    g.fillStyle = '#2e8fb5';
    g.beginPath(); g.arc(w2mx(0), w2my(60), 26 / WORLD_W * MAP, 0, Math.PI * 2); g.fill(); // pond
    // Building blocks from colliders.
    g.fillStyle = '#565064';
    var cols = SH.World.colliders;
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      g.fillRect(w2mx(c.x - c.hx), w2my(c.z - c.hz), (c.hx * 2) / WORLD_W * MAP, (c.hz * 2) / WORLD_H * MAP);
    }
    // Roads from the shared graph.
    var graph = SH.World.graph;
    for (var pass = 0; pass < 2; pass++) {
      for (var e = 0; e < graph.edges.length; e++) {
        var ed = graph.edges[e], a = graph.nodes[ed.a], b = graph.nodes[ed.b];
        var isRing = Math.hypot(b.x - a.x, b.z - a.z) > 700;
        if (pass === 0 && !isRing) continue;
        if (pass === 1 && isRing) continue;
        g.strokeStyle = isRing ? '#c97a3a' : '#8f8a96';
        g.lineWidth = (isRing ? 15 : 11) / WORLD_W * MAP;
        g.beginPath(); g.moveTo(w2mx(a.x), w2my(a.z)); g.lineTo(w2mx(b.x), w2my(b.z)); g.stroke();
      }
    }
  }

  var Minimap = {
    canvas: null, ctx: null,

    init: function () {
      this.canvas = document.getElementById('minimap');
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      prerender();
    },

    blip: function (ctx, cx, cy, dx, dz, rot, scale, radius, color, blink) {
      var rx = (dx * Math.cos(rot) - dz * Math.sin(rot)) * scale;
      var ry = (dx * Math.sin(rot) + dz * Math.cos(rot)) * scale;
      var len = Math.hypot(rx, ry);
      if (len > radius - 9) { rx *= (radius - 9) / len; ry *= (radius - 9) / len; }
      if (blink && (SH.State.time * 2.4 % 1) > 0.55) return;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cx + rx, cy + ry, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1; ctx.stroke();
    },

    render: function () {
      if (!this.ctx || !off) return;
      var st = SH.State;
      var focus = st.driving ? st.vehiclePos : st.player;
      var size = this.canvas.width;
      var c = size / 2, radius = c - 3;
      var ctx = this.ctx;
      var targetRadius = st.driving ? 95 + st.speedKmh * 0.85 : 72;
      viewRadius += (targetRadius - viewRadius) * 0.04;

      // View-forward in world space; rotate the map so forward points up.
      var fx = -Math.sin(st.camYaw), fz = -Math.cos(st.camYaw);
      var rot = -Math.PI / 2 - Math.atan2(fz, fx);
      var scale = radius / viewRadius; // screen px per world metre

      ctx.save();
      ctx.clearRect(0, 0, size, size);
      ctx.beginPath(); ctx.arc(c, c, radius, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = '#22301f'; ctx.fillRect(0, 0, size, size);
      ctx.translate(c, c);
      ctx.rotate(rot);
      var k = scale * (MAP / WORLD_W); // screen px per offscreen px
      ctx.scale(k, k);
      ctx.drawImage(off, -w2mx(focus.x), -w2my(focus.z));
      ctx.restore();

      // Dynamic layer (unrotated space, manual transform).
      ctx.save();
      ctx.beginPath(); ctx.arc(c, c, radius, 0, Math.PI * 2); ctx.clip();
      var i, dx, dz;
      // Police search circle.
      if (SH.Police && SH.Police.searching && st.wanted > 0) {
        var lk = SH.Police.lastKnown;
        var sx = (lk.x - focus.x), sz = (lk.z - focus.z);
        var rx = (sx * Math.cos(rot) - sz * Math.sin(rot)) * scale;
        var ry = (sx * Math.sin(rot) + sz * Math.cos(rot)) * scale;
        ctx.fillStyle = (SH.State.time * 2 % 1) > 0.5 ? 'rgba(60,110,255,.20)' : 'rgba(255,60,80,.20)';
        ctx.beginPath(); ctx.arc(c + rx, c + ry, 55 * scale, 0, Math.PI * 2); ctx.fill();
      }
      // Shops / safehouses (green).
      var places = SH.Economy ? SH.Economy.places : [];
      for (i = 0; i < places.length; i++) this.blip(ctx, c, c, places[i].x - focus.x, places[i].z - focus.z, rot, scale, radius, '#51e07a', false);
      // Traffic (faint white) — only near cars to keep the map readable.
      if (SH.Traffic) {
        for (i = 0; i < SH.Traffic.cars.length; i++) {
          var car = SH.Traffic.cars[i];
          dx = car.x - focus.x; dz = car.z - focus.z;
          if (dx * dx + dz * dz < viewRadius * viewRadius) this.blip(ctx, c, c, dx, dz, rot, scale, radius, 'rgba(240,240,240,.75)', false);
        }
      }
      // Police (red, flashing blue/red while wanted).
      if (SH.Police && st.wanted > 0) {
        var blips = SH.Police.blipPositions(Minimap._blipScratch || (Minimap._blipScratch = []));
        for (i = 0; i < blips.length; i++) {
          this.blip(ctx, c, c, blips[i].x - focus.x, blips[i].z - focus.z, rot, scale, radius, (SH.State.time * 2.4 % 1) > 0.5 ? '#4a7dff' : '#ff3b4e', false);
        }
      }
      // Objective / waypoint (yellow / white).
      if (st.objective) this.blip(ctx, c, c, st.objective.x - focus.x, st.objective.z - focus.z, rot, scale, radius, '#ffd23f', false);
      if (st.waypoint) this.blip(ctx, c, c, st.waypoint.x - focus.x, st.waypoint.z - focus.z, rot, scale, radius, '#ffffff', false);
      ctx.restore();

      // Player arrow (always centre, pointing up) + view cone + N marker.
      ctx.fillStyle = 'rgba(255,255,255,.13)';
      ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, radius * 0.55, -Math.PI / 2 - 0.32, -Math.PI / 2 + 0.32); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(c, c - 8); ctx.lineTo(c + 5.4, c + 6); ctx.lineTo(c, c + 2.6); ctx.lineTo(c - 5.4, c + 6);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      var nx = Math.sin(rot + Math.PI / 2), ny = -Math.cos(rot + Math.PI / 2);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('N', c + nx * (radius - 11), c + ny * (radius - 11));
    },

    drawFullMap: function (canvas) {
      if (!off) prerender();
      var g = canvas.getContext('2d');
      var W = canvas.width, H = canvas.height;
      g.fillStyle = '#10131f'; g.fillRect(0, 0, W, H);
      var s = Math.min(W / MAP, H / MAP);
      var ox = (W - MAP * s) / 2, oy = (H - MAP * s) / 2;
      g.drawImage(off, ox, oy, MAP * s, MAP * s);
      function px(x) { return ox + w2mx(x) * s; }
      function pz(z) { return oy + w2my(z) * s; }
      var st = SH.State;
      var places = SH.Economy ? SH.Economy.places : [];
      for (var i = 0; i < places.length; i++) {
        g.fillStyle = '#51e07a';
        g.beginPath(); g.arc(px(places[i].x), pz(places[i].z), 5, 0, Math.PI * 2); g.fill();
      }
      if (st.objective) {
        g.fillStyle = '#ffd23f';
        g.beginPath(); g.arc(px(st.objective.x), pz(st.objective.z), 7, 0, Math.PI * 2); g.fill();
      }
      if (st.waypoint) {
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(px(st.waypoint.x), pz(st.waypoint.z), 6, 0, Math.PI * 2); g.fill();
      }
      var focus = st.driving ? st.vehiclePos : st.player;
      g.fillStyle = '#fff';
      g.strokeStyle = '#000'; g.lineWidth = 2;
      g.beginPath(); g.arc(px(focus.x), pz(focus.z), 6, 0, Math.PI * 2); g.fill(); g.stroke();
      // Expose the transform so menus can map clicks back to world coords.
      canvas._mapTransform = { s: s, ox: ox, oy: oy };
    },

    mapClickToWorld: function (canvas, clientX, clientY) {
      var t = canvas._mapTransform;
      if (!t) return null;
      var rect = canvas.getBoundingClientRect();
      var pxv = (clientX - rect.left) * (canvas.width / rect.width);
      var pyv = (clientY - rect.top) * (canvas.height / rect.height);
      return { x: m2wx((pxv - t.ox) / t.s), z: m2wz((pyv - t.oy) / t.s) };
    }
  };

  SH.Minimap = Minimap;
})(window.SH = window.SH || {});
