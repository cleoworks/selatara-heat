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
    var isl = SH.Config.island;
    var x, z, i;

    // Sea: deep-blue vertical gradient over the whole sheet.
    var seaGrad = g.createLinearGradient(0, 0, 0, MAP);
    seaGrad.addColorStop(0, '#0d2f52');
    seaGrad.addColorStop(0.55, '#12456e');
    seaGrad.addColorStop(1, '#1d5f8a');
    g.fillStyle = seaGrad;
    g.fillRect(0, 0, MAP, MAP);
    // Shallow band: a wide pale stroke just seaward of the shore, drawn
    // under the landmass so the coast reads as shelving water.
    g.strokeStyle = 'rgba(70,160,205,0.55)';
    g.lineWidth = 30 / WORLD_W * MAP;
    g.lineJoin = 'round';
    g.beginPath();
    for (x = -680; x <= 680; x += 20) {
      var shy = w2my(SH.World.coastZ(x) + 16);
      if (x === -680) g.moveTo(w2mx(x), shy); else g.lineTo(w2mx(x), shy);
    }
    g.stroke();

    // Landmass: a dark-cream island whose south shore follows coastZ(x).
    // Kept as a Path2D so terrain variation, the sand band and the
    // district tints can all clip to the land (Rev 8 map fix).
    var landPath = new Path2D();
    landPath.moveTo(w2mx(-680), w2my(-580));
    landPath.lineTo(w2mx(680), w2my(-580));
    landPath.lineTo(w2mx(680), w2my(SH.World.coastZ(680)));
    for (x = 680; x >= -680; x -= 20) landPath.lineTo(w2mx(x), w2my(SH.World.coastZ(x)));
    landPath.closePath();
    g.fillStyle = '#b89a6a';
    g.fill(landPath);
    // Terrain variation (Rev 8): seeded soft blotches in grass / dry /
    // dirt tones so the landmass stops reading as one flat tan plate,
    // plus a greener wash toward the northern hills.
    g.save();
    g.clip(landPath);
    var trng = SH.World.makeRng(777);
    var tones = ['#a8b06a', '#8a9a58', '#c2ab72', '#9a7d55', '#7d8f57'];
    for (i = 0; i < 460; i++) {
      g.fillStyle = tones[(trng() * tones.length) | 0];
      g.globalAlpha = 0.06 + trng() * 0.07;
      g.beginPath();
      g.ellipse(trng() * MAP, trng() * MAP, 14 + trng() * 58, 10 + trng() * 40, trng() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    var hillGrad = g.createLinearGradient(0, 0, 0, MAP * 0.45);
    hillGrad.addColorStop(0, 'rgba(70,110,60,0.20)');
    hillGrad.addColorStop(1, 'rgba(70,110,60,0)');
    g.fillStyle = hillGrad;
    g.fillRect(0, 0, MAP, MAP * 0.45);
    // District tints UNDER the road net (Rev 8: alpha 0.42 with boosted
    // identity colours — all six districts must read at a glance; the
    // roads drawn later stay fully crisp on top).
    var tintOf = { pelita: '#2e6bc2', kencana: '#d9a84e', karat: '#c2611f', ruko: '#cf5f36', mawar: '#3fae62', taman: '#1e5631' };
    var districtsPre = SH.Config.districts;
    for (i = 0; i < districtsPre.length; i++) {
      var dp = districtsPre[i];
      g.fillStyle = tintOf[dp.id] || dp.map;
      g.globalAlpha = 0.42;
      g.fillRect(w2mx(dp.x0), w2my(dp.z0), w2mx(dp.x1) - w2mx(dp.x0), w2my(dp.z1) - w2my(dp.z0));
    }
    g.globalAlpha = 1;
    g.restore();
    // Pulau Seberang: sand ellipse + green heart.
    g.fillStyle = '#d9ba7f';
    g.beginPath(); g.ellipse(w2mx(isl.x), w2my(isl.z), (isl.rx + 12) / WORLD_W * MAP, (isl.rz + 12) / WORLD_H * MAP, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4d8a48';
    g.beginPath(); g.ellipse(w2mx(isl.x), w2my(isl.z), (isl.rx - 12) / WORLD_W * MAP, (isl.rz - 12) / WORLD_H * MAP, 0, 0, Math.PI * 2); g.fill();

    // Taman Arus parkland: a rounded rectangle that follows the park's
    // own blocks (Rev 5 — no more green blob), drawn under the road net.
    g.fillStyle = 'rgba(93,145,83,0.6)';
    var pkX = w2mx(-124), pkY = w2my(-64), pkW = w2mx(124) - pkX, pkH = w2my(184) - pkY;
    g.beginPath();
    if (g.roundRect) g.roundRect(pkX, pkY, pkW, pkH, 14); else g.rect(pkX, pkY, pkW, pkH);
    g.fill();
    // Sand stroke tracing the curved shoreline.
    g.strokeStyle = '#e8cf9a';
    g.lineWidth = 15 / WORLD_W * MAP;
    g.lineJoin = 'round';
    g.beginPath();
    for (x = -680; x <= 680; x += 20) {
      var sy = w2my(SH.World.coastZ(x) - 16);
      if (x === -680) g.moveTo(w2mx(x), sy); else g.lineTo(w2mx(x), sy);
    }
    g.stroke();
    // Park pond + the canal running from it to the sea.
    g.strokeStyle = '#2e8fb5';
    g.lineWidth = 9 / WORLD_W * MAP;
    g.beginPath(); g.moveTo(w2mx(0), w2my(84)); g.lineTo(w2mx(0), w2my(SH.World.coastZ(0))); g.stroke();
    g.fillStyle = '#2e8fb5';
    g.beginPath(); g.arc(w2mx(0), w2my(60), 26 / WORLD_W * MAP, 0, Math.PI * 2); g.fill();
    // Buildings from the Rev 8 city data model: the same footprint
    // polygons the 3D generator placed (rects, L annexes, drums as
    // 10-gons, polygon lots with cut corners / courtyards), drawn as
    // paths — no longer a grid of collider rectangles. Block faces sit
    // darker and more saturated than the road ribbons, so the
    // hierarchy reads blocks = fill, roads = the cuts between them.
    g.fillStyle = 'rgba(30,26,40,0.64)';
    var cityB = (SH.CityData && SH.CityData.buildings) || [];
    for (i = 0; i < cityB.length; i++) {
      var pts = cityB[i].pts;
      g.beginPath();
      for (var pi = 0; pi < pts.length; pi++) {
        if (pi === 0) g.moveTo(w2mx(pts[pi][0]), w2my(pts[pi][1])); else g.lineTo(w2mx(pts[pi][0]), w2my(pts[pi][1]));
      }
      g.closePath();
      g.fill();
    }
    // Rev 5E open parking blocks: dark pad + painted bay stripes.
    var pkCells = SH.World.parkingCells || [];
    for (i = 0; i < pkCells.length; i++) {
      var pk = pkCells[i];
      g.fillStyle = 'rgba(52,52,60,0.85)';
      g.fillRect(w2mx(pk.x - pk.w / 2), w2my(pk.z - pk.d / 2), pk.w / WORLD_W * MAP, pk.d / WORLD_H * MAP);
      g.fillStyle = 'rgba(230,235,240,0.8)';
      for (var pb = 0; pb < 5; pb++) {
        g.fillRect(w2mx(pk.x - pk.w * 0.36 + pb * pk.w * 0.18) - 1, w2my(pk.z - pk.d * 0.31), 2, pk.d * 0.62 / WORLD_H * MAP);
      }
    }
    // Roads from the shared graph, drawn as FILLED ASPHALT RIBBONS
    // (map fix on the user's order): a thin dark casing, then a
    // grey-tan fill — roads read as cuts between the blocks, never as
    // a white line grid. Contrast is tiered: the ring stays orange
    // (the only road allowed a pale centre mark), arterials are a
    // medium light grey, collectors dimmer, local streets and alleys
    // thin and faint. No white centre lines anywhere else.
    var graph = SH.World.graph;
    function roadPath(pass) {
      for (var e = 0; e < graph.edges.length; e++) {
        var ed = graph.edges[e], a = graph.nodes[ed.a], b = graph.nodes[ed.b];
        var kind = ed.kind || 'grid';
        var wPx, style;
        if (pass === 'casing') {
          if (kind === 'alley') continue;
          wPx = kind === 'ring' ? 10 : kind === 'diag' ? 8.4 : 7; style = '#3a362f';
        } else if (pass === 'fill') {
          if (kind === 'ring') { wPx = 7.6; style = '#e07b2a'; }
          else if (kind === 'diag') { wPx = 6; style = '#8f8a7c'; }
          else if (kind === 'alley') { wPx = 1.6; style = 'rgba(106,101,88,0.75)'; }
          else { wPx = 4.8; style = '#7e7a6e'; }
        } else { // ringmark: the ring road's pale centre dashes only
          if (kind !== 'ring') continue;
          wPx = 1.3; style = 'rgba(255,217,168,0.85)';
        }
        g.strokeStyle = style;
        g.lineWidth = wPx;
        g.beginPath(); g.moveTo(w2mx(a.x), w2my(a.z)); g.lineTo(w2mx(b.x), w2my(b.z)); g.stroke();
      }
    }
    g.lineCap = 'round';
    roadPath('casing');
    roadPath('fill');
    roadPath('ringmark');
    // Foam lines: a bright waterline right on the shore, a fainter
    // second line seaward, and a foam ring around Pulau Seberang.
    function foamPath(offM, alpha, wPx) {
      g.strokeStyle = 'rgba(255,255,255,' + alpha + ')';
      g.lineWidth = wPx;
      g.beginPath();
      for (x = -680; x <= 680; x += 16) {
        var fy = w2my(SH.World.coastZ(x) + offM);
        if (x === -680) g.moveTo(w2mx(x), fy); else g.lineTo(w2mx(x), fy);
      }
      g.stroke();
    }
    foamPath(3, 0.85, 2.2);
    foamPath(12, 0.30, 1.6);
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 2;
    g.beginPath(); g.ellipse(w2mx(isl.x), w2my(isl.z), (isl.rx + 7) / WORLD_W * MAP, (isl.rz + 7) / WORLD_H * MAP, 0, 0, Math.PI * 2); g.stroke();
    drawLandmarks(g);
  }

  // Landmark icons: tiny dark glyphs, each drawn twice — a pale offset
  // pass as halo, then the dark glyph on top (crane, ferry pier, market
  // tent, drum hotel, island lighthouse).
  function drawLandmarks(g) {
    var spots = [
      { kind: 'crane', x: 505, z: 168 },
      { kind: 'ferry', x: 60, z: 400 },
      { kind: 'tent', x: -306, z: 92 },
      { kind: 'hotel', x: -60, z: 176 },
      { kind: 'faro', x: 334, z: 452 }
    ];
    for (var i = 0; i < spots.length; i++) {
      var cx = w2mx(spots[i].x), cy = w2my(spots[i].z);
      // Pale pin disc so the glyph reads at pause-map scale.
      g.fillStyle = 'rgba(255,246,220,0.6)';
      g.beginPath(); g.arc(cx, cy, 12.5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(38,34,48,0.55)';
      g.lineWidth = 1.2;
      g.beginPath(); g.arc(cx, cy, 12.5, 0, Math.PI * 2); g.stroke();
      g.save();
      g.translate(cx, cy);
      g.scale(1.55, 1.55);
      for (var pass = 0; pass < 2; pass++) {
        g.strokeStyle = pass === 0 ? 'rgba(255,246,220,0.85)' : '#262230';
        g.fillStyle = g.strokeStyle;
        g.lineWidth = pass === 0 ? 2.4 : 1.6;
        glyph(g, spots[i].kind, pass === 0 ? 0.7 : 0, pass === 0 ? 0.7 : 0);
      }
      g.restore();
    }
  }

  function glyph(g, kind, cx, cy) {
    g.beginPath();
    if (kind === 'crane') {
      g.moveTo(cx - 5, cy + 7); g.lineTo(cx - 5, cy - 7);
      g.lineTo(cx + 7, cy - 7);
      g.moveTo(cx - 5, cy - 1); g.lineTo(cx + 3, cy - 7);
      g.moveTo(cx + 5, cy - 7); g.lineTo(cx + 5, cy - 2);
      g.stroke();
      g.fillRect(cx + 3.8, cy - 2, 2.4, 2.4);
    } else if (kind === 'ferry') {
      g.moveTo(cx - 7, cy + 2); g.lineTo(cx + 7, cy + 2); g.lineTo(cx + 4, cy + 6); g.lineTo(cx - 4, cy + 6); g.closePath(); g.fill();
      g.beginPath();
      g.moveTo(cx, cy + 2); g.lineTo(cx, cy - 7); g.stroke();
      g.beginPath();
      g.moveTo(cx, cy - 7); g.lineTo(cx + 4.5, cy - 4.5); g.lineTo(cx, cy - 2); g.closePath(); g.fill();
    } else if (kind === 'tent') {
      g.moveTo(cx - 7, cy + 6); g.lineTo(cx, cy - 5); g.lineTo(cx + 7, cy + 6); g.closePath(); g.fill();
      g.beginPath();
      g.moveTo(cx, cy - 5); g.lineTo(cx, cy - 8); g.stroke();
      g.beginPath();
      g.moveTo(cx, cy - 8); g.lineTo(cx + 3.6, cy - 6.4); g.lineTo(cx, cy - 4.8); g.closePath(); g.fill();
    } else if (kind === 'hotel') {
      g.fillRect(cx - 4.5, cy - 7, 9, 14);
      g.fillStyle = 'rgba(255,246,220,0.9)';
      g.fillRect(cx - 2.6, cy - 4.4, 1.8, 1.8); g.fillRect(cx + 0.9, cy - 4.4, 1.8, 1.8);
      g.fillRect(cx - 2.6, cy - 0.9, 1.8, 1.8); g.fillRect(cx + 0.9, cy - 0.9, 1.8, 1.8);
      g.fillRect(cx - 2.6, cy + 2.6, 1.8, 1.8); g.fillRect(cx + 0.9, cy + 2.6, 1.8, 1.8);
    } else if (kind === 'faro') {
      g.moveTo(cx - 3, cy + 7); g.lineTo(cx - 1.6, cy - 4); g.lineTo(cx + 1.6, cy - 4); g.lineTo(cx + 3, cy + 7); g.closePath(); g.fill();
      g.fillStyle = '#ffd23f';
      g.beginPath(); g.arc(cx, cy - 6, 2.1, 0, Math.PI * 2); g.fill();
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
      ctx.fillStyle = '#0d2f52'; ctx.fillRect(0, 0, size, size);
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
      // District labels: bold, letterspaced, dark-outlined so they read on
      // every district colour. Taman Arus is labelled beside its pond
      // because its rect centre sits under the Pelita label row.
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineJoin = 'round'; // rounded joins: bold strokes spike at W/A miters otherwise
      g.font = 'bold 15px sans-serif';
      var labelAt = {
        pelita: [0, -240], ruko: [-372, -120], mawar: [372, -216],
        karat: [412, 120], taman: [0, 130], kencana: [-160, 238]
      };
      var districts = SH.Config.districts;
      for (i = 0; i < districts.length; i++) {
        var lp = labelAt[districts[i].id];
        if (!lp) continue;
        var lx = px(lp[0]), ly = pz(lp[1]);
        g.lineWidth = 4; g.strokeStyle = 'rgba(10,12,24,0.85)';
        g.strokeText(districts[i].name, lx, ly);
        g.fillStyle = '#ffffff';
        g.fillText(districts[i].name, lx, ly);
      }
      g.font = 'bold 12px sans-serif';
      g.lineWidth = 3.5; g.strokeStyle = 'rgba(10,12,24,0.85)';
      g.strokeText(SH.Config.island.name, px(SH.Config.island.x), pz(SH.Config.island.z));
      g.fillStyle = '#ffffff';
      g.fillText(SH.Config.island.name, px(SH.Config.island.x), pz(SH.Config.island.z));
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
