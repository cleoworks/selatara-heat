// SELATARA HEAT — buildings.js
// Instanced buildings with procedural canvas facades per district, plus the
// props that make districts read differently: palms, streetlights, port
// containers + cranes, night-market tents, boardwalk + pier, billboards, park.
// Public API: SH.Buildings { build(scene), setNightGlow(amount), windowMaterial }.
(function (SH) {
  'use strict';

  // Per-building facade generator (Art Pass 2): every texture in the pools
  // below is a different building skin — its own pastel base, its own window
  // grammar, and per-cell window states (warm lit / cool lit / dim / dark)
  // with frames and floor lines, so no street ever repeats one window slab.
  var PASTELS = ['#f2e3c8', '#e8c9a8', '#d9e4ea', '#f0d5d8', '#cfe0d2', '#e6d9f0', '#f5eeda', '#d8e6ee', '#eed9bd', '#e2d2c4', '#d5e8e2', '#f3cfb4'];
  var SIGN_COLORS = ['#c94f7a', '#3f9db5', '#e8a13a', '#5aa469', '#7a5fc0', '#d95f43'];
  function facadeTexture(seed, kind) {
    var wide = kind === 'hotel';
    var c = document.createElement('canvas'); c.width = wide ? 256 : 128; c.height = 256;
    var W = c.width;
    var g = c.getContext('2d');
    var rng = SH.World.makeRng(seed);
    var base = PASTELS[(rng() * PASTELS.length) | 0];
    g.fillStyle = base; g.fillRect(0, 0, W, 256);
    // Gentle vertical shading: sun-washed top, grounded bottom.
    var vg = g.createLinearGradient(0, 0, 0, 256);
    vg.addColorStop(0, 'rgba(255,255,255,0.13)');
    vg.addColorStop(0.75, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(30,20,15,0.16)');
    g.fillStyle = vg; g.fillRect(0, 0, W, 256);
    var style = (rng() * 3) | 0; // 0 grid, 1 vertical strips, 2 balcony bands
    if (kind === 'warehouse') style = 0;
    var cols = kind === 'warehouse' ? 4 : 5 + ((rng() * 4) | 0);
    var rows = kind === 'tower' || kind === 'hotel' ? 13 : (kind === 'villa' ? 7 : 9);
    var cw = W / cols, rh = 236 / rows;
    var top = 8;
    for (var r = 0; r < rows; r++) {
      var y = top + r * rh;
      // Floor line across the whole facade.
      g.fillStyle = 'rgba(60,45,35,0.20)';
      g.fillRect(0, y + rh - 2, W, 2);
      if (style === 2 && r % 3 === 2) {
        // Balcony band: slab shadow + railing ticks.
        g.fillStyle = 'rgba(70,45,30,0.4)';
        g.fillRect(0, y + rh - 6, W, 4);
        g.fillStyle = 'rgba(255,255,255,0.25)';
        for (var bx = 4; bx < W - 4; bx += 7) g.fillRect(bx, y + rh - 11, 2, 5);
      }
      if (kind === 'warehouse' && r < rows - 3) continue; // warehouses: windows only near the top
      for (var col = 0; col < cols; col++) {
        if (rng() < 0.06) continue; // the odd missing window
        var x = col * cw + cw * 0.2;
        var ww = style === 1 ? cw * 0.34 : cw * 0.58;
        var hh = style === 1 ? rh * 0.8 : rh * 0.52;
        var wy = y + (style === 1 ? rh * 0.1 : rh * 0.2);
        // Frame first, then the glass state for this cell.
        g.fillStyle = 'rgba(45,35,30,0.55)';
        g.fillRect(x - 1.5, wy - 1.5, ww + 3, hh + 3);
        var roll = rng();
        var glass = roll < 0.2 ? '#ffca7a' : roll < 0.34 ? '#a8d4e8' : roll < 0.62 ? '#4a6a7d' : '#223140';
        g.fillStyle = glass;
        g.fillRect(x, wy, ww, hh);
        g.fillStyle = 'rgba(255,255,255,0.28)';
        g.fillRect(x, wy, ww, 2); // top glint
        if (style === 0 && rng() < 0.3) { // cross mullion on some grid windows
          g.fillStyle = 'rgba(45,35,30,0.4)';
          g.fillRect(x + ww / 2 - 0.75, wy, 1.5, hh);
        }
      }
    }
    if (kind === 'shop' || kind === 'tower') {
      // Ground floor: sign band + glass storefront.
      var sign = SIGN_COLORS[(rng() * SIGN_COLORS.length) | 0];
      g.fillStyle = '#20242e'; g.fillRect(0, 222, W, 34);
      g.fillStyle = '#8fc8dd'; g.fillRect(6, 229, W * 0.4, 22); g.fillRect(W * 0.55, 229, W * 0.4, 22);
      g.fillStyle = sign; g.fillRect(0, 204, W, 17);
      g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(0, 204, W, 3);
    }
    if (kind === 'warehouse') {
      // Panel seams + a big roller door.
      g.strokeStyle = 'rgba(40,35,30,0.35)'; g.lineWidth = 2;
      for (var px = 0; px <= W; px += 32) { g.beginPath(); g.moveTo(px, 0); g.lineTo(px, 256); g.stroke(); }
      g.fillStyle = '#5a5148'; g.fillRect(W * 0.28, 176, W * 0.44, 80);
      g.fillStyle = 'rgba(255,255,255,0.14)';
      for (var dy = 186; dy < 250; dy += 10) g.fillRect(W * 0.28, dy, W * 0.44, 2);
    }
    var t = new THREE.CanvasTexture(c);
    if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    if (wide) { t.wrapS = THREE.RepeatWrapping; t.repeat.x = 2; }
    return t;
  }

  function makeInstanced(geo, mat, placements, scene, shadows) {
    var mesh = new THREE.InstancedMesh(geo, mat, placements.length);
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    var v = new THREE.Vector3(), s = new THREE.Vector3();
    for (var i = 0; i < placements.length; i++) {
      var p = placements[i];
      e.set(0, p.rotY || 0, 0); q.setFromEuler(e);
      v.set(p.x, p.y, p.z); s.set(p.sx, p.sy, p.sz);
      m4.compose(v, q, s);
      mesh.setMatrixAt(i, m4);
      if (p.color !== undefined) mesh.setColorAt(i, new THREE.Color(p.color));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = !!shadows; mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  var Buildings = {
    glowPoints: null,

    build: function (scene) {
      var cfg = SH.Config.world;
      var rng = SH.World.makeRng(4242);
      var palettes = SH.Config.buildingPalettes;

      // ---- Collect building placements per archetype ----
      // Facade buckets are assigned sequentially per archetype, so two
      // buildings placed one after another (i.e. neighbours on a street)
      // never share a facade texture.
      var towers = [], shops = [], warehouses = [], villas = [], podiums = [], awnings = [], hotels = [];
      var plazaSpots = [];
      var parkingPads = [], parkingLines = [];
      var bucketSeq = { tower: 0, shop: 0, warehouse: 0, villa: 0, hotel: 0 };
      var xs = cfg.avenuesX, zs = cfg.streetsZ;
      for (var i = 0; i + 1 < xs.length; i++) {
        for (var j = 0; j + 1 < zs.length; j++) {
          var cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
          var d = SH.World.districtAt(cx, cz);
          if (!d || d.id === 'taman') continue;
          // Cells the diagonal boulevard cuts through stay open: a paved
          // plaza with palms instead of a building the road would pierce.
          if (SH.World.diagCells[i + ',' + j]) { plazaSpots.push({ x: cx, z: cz }); continue; }
          // The night-market block (1,4) stays open: its tents, bulb
          // strings and the z=124 alley furnish it — shop rows would
          // swallow the stalls (they already clipped them pre-Rev 5E).
          if (i === 1 && j === 4) continue;
          var bw = xs[i + 1] - xs[i] - cfg.roadHalf * 2 - cfg.sidewalk * 2 - 6;
          var bd = zs[j + 1] - zs[j] - cfg.roadHalf * 2 - cfg.sidewalk * 2 - 6;
          // Rev 5E: no two blocks alike. A seeded per-cell roll decides
          // the block's fate BEFORE the district recipe runs: ~16% of
          // blocks are not buildings at all (surface parking or a green
          // plaza), ~18% merge into one super-lot, and every block gets
          // its own height character so neighbours stop rhyming.
          // The safehouse block (0,4) always uses the standard recipe.
          var cellRoll = (i === 0 && j === 4) ? 0.5 : rng();
          if (cellRoll < 0.16) {
            if (rng() < 0.5) {
              parkingPads.push({ x: cx, y: 0.07, z: cz, sx: bw * 0.94, sy: 0.14, sz: bd * 0.94, color: 0x3f3f46 });
              for (var pl = 0; pl < 5; pl++) {
                parkingLines.push({ x: cx - bw * 0.36 + pl * bw * 0.18, y: 0.16, z: cz, sx: 0.35, sy: 0.03, sz: bd * 0.62, color: 0xcfd4d8 });
              }
              SH.World.parkingCells.push({ x: cx, z: cz, w: bw * 0.94, d: bd * 0.94 });
            } else {
              plazaSpots.push({ x: cx, z: cz });
            }
            continue;
          }
          var superLot = cellRoll < 0.34;
          var hScale = 0.78 + rng() * 0.55;
          if (d.id === 'pelita') {
            // Towers on a shared retail podium; the count and massing
            // vary per block (1-2 towers, an L-annex, sometimes a drum).
            podiums.push({ x: cx, y: 2.1, z: cz, sx: bw * 0.86, sy: 4.2, sz: bd * 0.86, bucket: (bucketSeq.shop++) % 8 });
            SH.World.colliders.push({ x: cx, z: cz, hx: bw * 0.43, hz: bd * 0.43 });
            if (superLot && rng() < 0.3) {
              var dh = (d.minH + rng() * (d.maxH - d.minH)) * hScale;
              hotels.push({ x: cx, y: dh / 2 + 4.2, z: cz, sx: bw * 0.4, sy: dh, sz: bw * 0.4, base: 4.2, h: dh, bucket: (bucketSeq.hotel++) % 3 });
            } else {
              var nTw = superLot ? 1 : (rng() < 0.3 ? 1 : 2);
              for (var tw = 0; tw < nTw; tw++) {
                var h = (d.minH + rng() * (d.maxH - d.minH)) * hScale * (superLot ? 1.12 : 1);
                var ox = (nTw === 1 ? 0 : (tw === 0 ? -1 : 1) * bw * 0.21) + (rng() - 0.5) * 6;
                var oz = (nTw === 1 ? 0 : (tw === 0 ? -1 : 1) * bd * 0.18) + (rng() - 0.5) * 6;
                var tww = bw * (superLot ? 0.46 : 0.34), twd = bd * (superLot ? 0.44 : 0.34);
                towers.push({ x: cx + ox, y: 4.2 + h / 2, z: cz + oz, sx: tww, sy: h, sz: twd, base: 4.2, h: h, bucket: (bucketSeq.tower++) % 10, rotY: (rng() - 0.5) * 0.07 });
                if (rng() < 0.35) {
                  // L-annex: a lower wing fused to the tower's flank,
                  // growing toward the block centre (never the street).
                  var ah = h * (0.3 + rng() * 0.25);
                  var inDir = ox > 1 ? -1 : 1;
                  towers.push({ x: cx + ox + inDir * (tww * 0.5 + bw * 0.08), y: 4.2 + ah / 2, z: cz + oz + twd * 0.18, sx: bw * 0.16, sy: ah, sz: twd * 0.62, base: 4.2, h: ah, bucket: (bucketSeq.tower++) % 10, rotY: 0 });
                }
              }
            }
          } else if (d.id === 'ruko') {
            // Two shophouse rows per block (street front + back lane),
            // each with a coloured awning. Rev 5E: shop widths are
            // seeded per unit (13-21 m) and laid end to end, so the
            // row rhythm stumbles like a real old town; a super-lot
            // becomes one wide market block per row instead.
            var rowZ = [cz - bd * 0.24, cz + bd * 0.30];
            var rowD = [bd * 0.32, bd * 0.26];
            for (var rrow = 0; rrow < 2; rrow++) {
              var rz = rowZ[rrow], rd = rowD[rrow];
              if (superLot) {
                var shS = (d.minH + rng() * (d.maxH - d.minH)) * hScale * 1.15;
                shops.push({ x: cx, y: shS / 2, z: rz, sx: bw * 0.72, sy: shS, sz: rd, base: 0, h: shS, bucket: (bucketSeq.shop++) % 8 });
                SH.World.colliders.push({ x: cx, z: rz, hx: bw * 0.36, hz: rd / 2 });
                awnings.push({ x: cx, y: 3.1, z: rz + (rrow === 0 ? -1 : 1) * (rd / 2 + 1.6), sx: bw * 0.7, sy: 0.28, sz: 3.4, color: palettes.ruko[(rng() * palettes.ruko.length) | 0] });
                continue;
              }
              var rx = xs[i] + 13;
              // The safehouse yard (0,4 front row) stays open at the
              // east end so Mami's car and the rest point keep their plot.
              var rowLimit = (i === 0 && j === 4 && rrow === 0) ? -384 : xs[i + 1] - 12;
              while (rx < rowLimit - 11) {
                var sw = 13 + rng() * 8;
                if (rx + sw > rowLimit) sw = rowLimit - rx;
                var shx = rx + sw / 2;
                var sh = (d.minH + rng() * (d.maxH - d.minH)) * hScale * (rrow === 1 ? 0.85 : 1);
                shops.push({ x: shx, y: sh / 2, z: rz, sx: sw, sy: sh, sz: rd, base: 0, h: sh, bucket: (bucketSeq.shop++) % 8 });
                SH.World.colliders.push({ x: shx, z: rz, hx: sw / 2, hz: rd / 2 });
                awnings.push({ x: shx, y: 3.1, z: rz + (rrow === 0 ? -1 : 1) * (rd / 2 + 1.6), sx: sw - 0.6, sy: 0.28, sz: 3.4, color: palettes.ruko[(rng() * palettes.ruko.length) | 0] });
                rx += sw + 1.5;
              }
            }
          } else if (d.id === 'karat') {
            // Warehouses: a super-lot is one long shed; otherwise a main
            // shed + a smaller annex (sometimes skipped, sometimes
            // turned so the yard reads differently block to block).
            var wh = (d.minH + rng() * (d.maxH - d.minH)) * hScale;
            if (superLot) {
              warehouses.push({ x: cx, y: wh / 2, z: cz, sx: bw * 0.85, sy: wh, sz: bd * 0.66, base: 0, h: wh, bucket: (bucketSeq.warehouse++) % 4 });
              SH.World.colliders.push({ x: cx, z: cz, hx: bw * 0.425, hz: bd * 0.33 });
            } else {
              warehouses.push({ x: cx, y: wh / 2, z: cz, sx: bw * 0.68, sy: wh, sz: bd * 0.62, base: 0, h: wh, bucket: (bucketSeq.warehouse++) % 4 });
              SH.World.colliders.push({ x: cx, z: cz, hx: bw * 0.34, hz: bd * 0.31 });
              if (rng() > 0.25) {
                var aTurn = rng() < 0.3;
                var aW = aTurn ? bd * 0.2 : bw * 0.3, aD = aTurn ? bw * 0.3 : bd * 0.2;
                warehouses.push({ x: cx + bw * 0.3, y: 3, z: cz + bd * 0.38, sx: aW, sy: 6, sz: aD, bucket: (bucketSeq.warehouse++) % 4 });
                SH.World.colliders.push({ x: cx + bw * 0.3, z: cz + bd * 0.38, hx: aW / 2, hz: aD / 2 });
              }
            }
          } else if (d.id === 'mawar') {
            // Detached villas with garden gaps: 2-4 per block, jittered;
            // a super-lot is one larger villa on a greener plot.
            var nV = superLot ? 1 : 2 + ((rng() * 3) | 0);
            for (var v2 = 0; v2 < nV; v2++) {
              var vx = cx + (nV === 1 ? 0 : (v2 - (nV - 1) / 2) * bw * 0.3) + (rng() - 0.5) * 5;
              var vz = cz + (v2 % 2 ? bd * 0.14 : -bd * 0.14) + (rng() - 0.5) * 6;
              var vh = (d.minH + rng() * (d.maxH - d.minH)) * hScale;
              var vW = superLot ? 27 : 20, vD = superLot ? 24 : 18;
              villas.push({ x: vx, y: vh / 2, z: vz, sx: vW, sy: vh, sz: vD, base: 0, h: vh, bucket: (bucketSeq.villa++) % 6, rotY: (rng() - 0.5) * 0.09 });
              SH.World.colliders.push({ x: vx, z: vz, hx: vW / 2, hz: vD / 2 });
            }
          } else if (d.id === 'kencana') {
            // CYLINDRICAL hotel drums along the beachfront — one or two
            // per block, pullback jittered; round towers break the box
            // grid where the coast road bends past them.
            var nKh = superLot ? 1 : 2;
            for (var kh2 = 0; kh2 < nKh; kh2++) {
              var kh = (d.minH + rng() * (d.maxH - d.minH)) * hScale * (superLot ? 1.1 : 1);
              var kx = cx + (nKh === 1 ? 0 : (kh2 === 0 ? -1 : 1) * bw * 0.22);
              var kPull = 14 + rng() * 6;
              var kW = bw * (superLot ? 0.5 : 0.36);
              hotels.push({ x: kx, y: kh / 2, z: cz - kPull, sx: kW, sy: kh, sz: kW, base: 0, h: kh, bucket: (bucketSeq.hotel++) % 3 });
              SH.World.colliders.push({ x: kx, z: cz - kPull, hx: kW / 2, hz: kW / 2 });
            }
          }
        }
      }

      var box = new THREE.BoxGeometry(1, 1, 1);
      // Facade pools (Art Pass 2): every entry is a distinct generated skin.
      // Placements carry a sequential bucket, so neighbours never repeat.
      function facadePool(baseSeed, count, kind) {
        var mats = [];
        for (var fi = 0; fi < count; fi++) {
          mats.push(new THREE.MeshLambertMaterial({ map: facadeTexture(baseSeed + fi * 7, kind) }));
        }
        return mats;
      }
      var towerMats = facadePool(100, 10, 'tower');
      var shopMats = facadePool(200, 8, 'shop');
      var wareMats = facadePool(400, 4, 'warehouse');
      var villaMats = facadePool(300, 6, 'villa');
      var hotelMats = facadePool(500, 3, 'hotel');

      // Massing pass: stepped setbacks on towers, parapet caps, pitched
      // roofs on villas / shops / some warehouses, rooftop clutter (AC
      // units, water tanks) and balcony slabs — no more single slabs.
      var roofProps = [], tanks = [], hipRoofs = [];
      var roofColors = [0xb5563c, 0x9a4a34, 0x7a5a48, 0xc96f4a];
      function bucketize(list, mats, opts) {
        var buckets = mats.map(function () { return []; });
        for (var bi = 0; bi < list.length; bi++) {
          var b = list[bi];
          var bucket = buckets[(b.bucket || 0) % mats.length];
          bucket.push(b);
          if (!opts || (!opts.tiers && !opts.hipRoof && !opts.roofProps && !opts.balconies)) continue;
          var topY = (b.base || 0) + b.h;
          if (opts.tiers && rng() < 0.85) {
            var h2 = b.h * (0.22 + rng() * 0.25);
            var t2x = b.x + (rng() - 0.5) * 2.4, t2z = b.z + (rng() - 0.5) * 2.4;
            bucket.push({ x: t2x, y: topY + h2 / 2, z: t2z, sx: b.sx * 0.62, sy: h2, sz: b.sz * 0.62, rotY: b.rotY || 0 });
            topY += h2;
            if (rng() < 0.45) {
              var h3 = b.h * (0.14 + rng() * 0.12);
              bucket.push({ x: t2x, y: topY + h3 / 2, z: t2z, sx: b.sx * 0.4, sy: h3, sz: b.sz * 0.4, rotY: b.rotY || 0 });
              topY += h3;
            }
          }
          if (opts.hipRoof && rng() < opts.hipRoof) {
            var rh = 1.8 + rng() * 1.4;
            hipRoofs.push({ x: b.x, y: topY + rh / 2 - 0.15, z: b.z, sx: b.sx * 1.02, sy: rh, sz: b.sz * 1.02, rotY: Math.PI / 4, color: roofColors[(rng() * roofColors.length) | 0] });
          } else if (opts.roofProps) {
            // Parapet cap: a slightly oversized thin slab crowns flat roofs.
            if (rng() < 0.5) {
              roofProps.push({ x: b.x, y: topY + 0.22, z: b.z, sx: b.sx * 1.05, sy: 0.45, sz: b.sz * 1.05, rotY: b.rotY || 0, color: 0xd8cdb8 });
            }
            var nProps = 1 + ((rng() * 3) | 0);
            for (var rp = 0; rp < nProps; rp++) {
              var px2 = b.x + (rng() - 0.5) * b.sx * 0.55, pz2 = b.z + (rng() - 0.5) * b.sz * 0.55;
              if (rng() < 0.3) tanks.push({ x: px2, y: topY + 0.85, z: pz2, sx: 1.5, sy: 1.7, sz: 1.5, color: rng() < 0.5 ? 0xb9c0c9 : 0xa8763e });
              else roofProps.push({ x: px2, y: topY + 0.4, z: pz2, sx: 1.9, sy: 0.8, sz: 1.3, color: 0x9aa0a8 });
            }
          }
          if (opts.balconies && rng() < 0.55) {
            var nBal = 2 + ((rng() * 2) | 0);
            for (var bb = 0; bb < nBal; bb++) {
              roofProps.push({
                x: b.x + (rng() - 0.5) * b.sx * 0.45, y: (b.base || 0) + b.h * (0.35 + bb * 0.22),
                z: b.z + b.sz / 2 + 0.5, sx: 3.4, sy: 0.22, sz: 1.0, color: 0xe8e0d0
              });
            }
          }
        }
        for (var mi = 0; mi < mats.length; mi++) makeInstanced(box, mats[mi], buckets[mi], scene, true);
      }
      bucketize(towers, towerMats, { tiers: true, roofProps: true, balconies: true });
      bucketize(shops, shopMats, { hipRoof: 0.55, roofProps: true });
      bucketize(warehouses, wareMats, { hipRoof: 0.4, roofProps: true });
      bucketize(villas, villaMats, { hipRoof: 0.9, balconies: true });
      bucketize(podiums, shopMats, {});
      // Cylindrical hotel drums, some with a narrower crown drum.
      var hotelBuckets = hotelMats.map(function () { return []; });
      for (var hi = 0; hi < hotels.length; hi++) {
        var hb = hotels[hi];
        hotelBuckets[hb.bucket % hotelMats.length].push(hb);
        if (rng() < 0.55) {
          hotelBuckets[hb.bucket % hotelMats.length].push({ x: hb.x, y: (hb.base || 0) + hb.h + hb.h * 0.14, z: hb.z, sx: hb.sx * 0.66, sy: hb.h * 0.28, sz: hb.sx * 0.66 });
        }
      }
      var drumGeo = new THREE.CylinderGeometry(0.5, 0.54, 1, 16);
      for (var hm = 0; hm < hotelMats.length; hm++) makeInstanced(drumGeo, hotelMats[hm], hotelBuckets[hm], scene, true);
      makeInstanced(box, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), awnings, scene, false);
      // Rev 5E open lots: asphalt parking pads + painted bay lines.
      makeInstanced(box, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), parkingPads, scene, false);
      makeInstanced(box, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), parkingLines, scene, false);
      makeInstanced(box, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), roofProps, scene, false);
      makeInstanced(new THREE.CylinderGeometry(0.5, 0.5, 1, 6), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), tanks, scene, false);
      makeInstanced(new THREE.ConeGeometry(0.72, 1, 4), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), hipRoofs, scene, false);
      this.windowMaterials = towerMats.concat(shopMats, villaMats, hotelMats);

      // ---- Palms + park trees ----
      // A palm is a BENT trunk (curve baked into the geometry) carrying 7-9
      // drooping fronds: each frond is a tapered ribbon bent downward along
      // its length, instanced once per frond around the crown. Park trees get
      // 2-3 stacked flattened canopy blobs instead of one flat disc.
      var palms = [], parkTrees = [];
      var pi;
      for (pi = 0; pi < 130; pi++) {
        var bx = -560 + rng() * 1120;
        // Beach palms hug the curved shore: on the sand, north of the water.
        palms.push({ x: bx, z: SH.World.coastZ(bx) - 66 + rng() * 40, s: 0.9 + rng() * 0.4, lean: rng() * Math.PI * 2 });
      }
      // Plaza greenery on the boulevard-cut blocks + the island shore.
      for (pi = 0; pi < plazaSpots.length; pi++) {
        var pz2 = plazaSpots[pi];
        palms.push({ x: pz2.x - 26, z: pz2.z + 24, s: 0.9 + rng() * 0.3, lean: rng() * Math.PI * 2 });
        palms.push({ x: pz2.x + 28, z: pz2.z - 22, s: 0.85 + rng() * 0.3, lean: rng() * Math.PI * 2 });
        parkTrees.push({ x: pz2.x + 6, z: pz2.z + 30, s: 0.9 + rng() * 0.3 });
      }
      var isl = SH.Config.island;
      for (pi = 0; pi < 16; pi++) {
        var ia = rng() * Math.PI * 2, ir = 0.55 + rng() * 0.4;
        palms.push({ x: isl.x + Math.cos(ia) * isl.rx * ir, z: isl.z + Math.sin(ia) * isl.rz * ir, s: 0.85 + rng() * 0.35, lean: rng() * Math.PI * 2 });
      }
      for (pi = 0; pi < 90; pi++) {
        var tx = -560 + rng() * 1120, tz = -440 + rng() * 620;
        if (SH.World.districtAt(tx, tz) && SH.World.districtAt(tx, tz).id === 'taman' || (tx > -130 && tx < 130 && tz > -70 && tz < 190)) {
          parkTrees.push({ x: tx, z: tz, s: 0.85 + rng() * 0.5 });
        } else if ((pi % 3) === 0) {
          palms.push({ x: tx, z: tz, s: 0.85 + rng() * 0.35, lean: rng() * Math.PI * 2 });
        }
      }
      // Street palms: a palm every ~24 m along both sides of the avenues and
      // streets in the built districts, so no street reads empty. Offsets
      // use the edge's perpendicular, so diagonal and coast edges plant
      // correctly too; ring / bridge / alley edges stay bare.
      var gEdges = SH.World.graph.edges, gNodes = SH.World.graph.nodes;
      for (pi = 0; pi < gEdges.length; pi++) {
        var gk = gEdges[pi].kind || 'grid';
        if (gk === 'ring' || gk === 'bridge' || gk === 'alley') continue;
        var ga = gNodes[gEdges[pi].a], gb = gNodes[gEdges[pi].b];
        var gdx = gb.x - ga.x, gdz = gb.z - ga.z;
        var glen = Math.hypot(gdx, gdz);
        var gpx2 = gdz / glen, gpz2 = -gdx / glen;
        var gSteps = Math.floor(glen / 24);
        for (var gs = 1; gs <= gSteps; gs++) {
          var gt = gs / (gSteps + 1);
          for (var gSide = -1; gSide <= 1; gSide += 2) {
            if ((gs + (gSide > 0 ? 1 : 0)) % 2 !== 0) continue; // alternate sides
            var gpx = ga.x + gdx * gt + gpx2 * gSide * (cfg.roadHalf + 2.6);
            var gpz = ga.z + gdz * gt + gpz2 * gSide * (cfg.roadHalf + 2.6);
            var gd = SH.World.districtAt(gpx, gpz);
            if (!gd) continue;
            palms.push({ x: gpx, z: gpz, s: 0.85 + rng() * 0.3, lean: rng() * Math.PI * 2 });
          }
        }
      }
      // Rev 5D: corner plazas at six major intersections — a stone pad
      // + planter + tree on each corner cuts the 90-degree block corner
      // visually, from the street and from the air. The 10.2 m offset
      // keeps pads clear of every district recipe (the nearest building
      // faces sit >= 18 m from the centrelines).
      (function cornerPlazas() {
        var spots = [[0, -60], [-120, -180], [120, -300], [-360, 60], [240, 60], [360, -180]];
        var pads = [], planters = [];
        for (var ci = 0; ci < spots.length; ci++) {
          for (var cq = 0; cq < 4; cq++) {
            var qx = spots[ci][0] + (cq % 2 ? 10.2 : -10.2);
            var qz = spots[ci][1] + (cq < 2 ? 10.2 : -10.2);
            pads.push({ x: qx, y: 0.07, z: qz, sx: 7.5, sy: 0.14, sz: 7.5, color: 0x9a8f7c });
            if ((ci + cq) % 2 === 0) {
              planters.push({ x: qx, y: 0.45, z: qz, sx: 2.6, sy: 0.9, sz: 2.6, color: 0x7a4a38 });
              parkTrees.push({ x: qx, z: qz, s: 0.8 + ((ci * 4 + cq) % 3) * 0.15 });
            } else {
              planters.push({ x: qx, y: 0.3, z: qz, sx: 3.4, sy: 0.6, sz: 1.1, color: 0x6b5a48 });
            }
          }
        }
        makeInstanced(box, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), pads, scene, false);
        makeInstanced(box, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), planters, scene, false);
      })();

      // Palm trunk (Art Bible v2): a tapered stack look — the bend is
      // quadratic (offset = bend * t^2, total lean ~0.95 m over a 6 m
      // trunk with a flared base), and a canvas ring texture bands the
      // bark every ~0.45 m so the trunk reads as stacked segments, not
      // one smooth pipe.
      var trunkGeo = new THREE.CylinderGeometry(0.13, 0.34, 6, 5, 10);
      trunkGeo.translate(0, 3, 0);
      var tp = trunkGeo.attributes.position;
      for (pi = 0; pi < tp.count; pi++) {
        var tt = tp.getY(pi) / 6;
        tp.setX(pi, tp.getX(pi) + tt * tt * 0.95);
      }
      trunkGeo.computeVertexNormals();
      var barkCv = document.createElement('canvas'); barkCv.width = 32; barkCv.height = 128;
      var barkCx = barkCv.getContext('2d');
      barkCx.fillStyle = '#9a7a56'; barkCx.fillRect(0, 0, 32, 128);
      for (var bri = 0; bri < 13; bri++) {
        barkCx.fillStyle = 'rgba(62,42,24,0.6)';
        barkCx.fillRect(0, bri * 10 + 7, 32, 3);
        barkCx.fillStyle = 'rgba(214,182,138,0.35)';
        barkCx.fillRect(0, bri * 10 + 5, 32, 2);
      }
      var barkTex = new THREE.CanvasTexture(barkCv);
      barkTex.colorSpace = THREE.SRGBColorSpace;
      // Fronds (Art Bible v2): SOLID shaped blades, no alpha. One blade
      // is a 6x2 plane reshaped by hand: width peaks ~0.5 m at t=0.45
      // and closes to a point, edges zig-zag notched on alternating
      // rows, a V-fold lifts the centre rib, and the length curve rises
      // ~30 degrees before falling past horizontal at the tip. Vertex
      // colours run yellow-green at the base to deep green at the tip.
      function makeFrondGeo(len, fall) {
        var fg = new THREE.PlaneGeometry(len, 1, 6, 2);
        fg.translate(len / 2, 0, 0);
        fg.rotateX(-Math.PI / 2);
        var fp2 = fg.attributes.position;
        var cols = [];
        var cBase = new THREE.Color(0x86cc52), cTip = new THREE.Color(0x2e7d3a), cTmp = new THREE.Color();
        for (var qi = 0; qi < fp2.count; qi++) {
          var fu = fp2.getX(qi) / len;
          var row = Math.round(fu * 6);
          var wHalf = (0.03 + 0.55 * Math.sin(Math.PI * Math.pow(fu, 0.85)) * (1 - 0.25 * fu)) / 2;
          var zn = fp2.getZ(qi) * 2; // -1 / 0 / +1 across the 3 columns
          var edge = Math.abs(zn) > 0.5;
          var zNew = zn * wHalf * (edge && row % 2 === 1 ? 0.78 : 1); // zig-zag notches
          fp2.setZ(qi, zNew);
          var yNew = len * (0.55 * fu - fall * fu * fu) + (edge ? -0.06 : 0.05);
          fp2.setY(qi, yNew);
          cTmp.copy(cBase).lerp(cTip, fu);
          if (!edge) cTmp.multiplyScalar(1.12);
          cols.push(cTmp.r, cTmp.g, cTmp.b);
        }
        fg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
        fg.computeVertexNormals();
        return fg;
      }
      var frondGeoA = makeFrondGeo(2.3, 1.02); // lower tier: longer, falls past horizontal
      var frondGeoB = makeFrondGeo(2.0, 0.78); // upper tier: shorter, held higher
      var palmTrunks = [], frondsA = [], frondsB = [], coconuts = [], treeTrunks = [], canopies = [];
      for (pi = 0; pi < palms.length; pi++) {
        var pm = palms[pi];
        palmTrunks.push({ x: pm.x, y: 0, z: pm.z, sx: pm.s, sy: pm.s, sz: pm.s, rotY: pm.lean });
        // Crown sits at the top of the bent trunk (local +0.95x, 6y).
        // 8-9 fronds in two tiers: even slots take the long drooping
        // tier, odd slots the shorter upright tier (bible v2).
        var ccx = pm.x + 0.95 * pm.s * Math.cos(pm.lean);
        var ccz = pm.z - 0.95 * pm.s * Math.sin(pm.lean);
        var nFr = 8 + ((rng() * 2) | 0);
        for (var fi = 0; fi < nFr; fi++) {
          var lowerTier = fi % 2 === 0;
          var frondP = {
            x: ccx, y: 6 * pm.s - 0.08 + (lowerTier ? 0 : 0.14), z: ccz,
            sx: pm.s * (0.9 + rng() * 0.4), sy: pm.s, sz: pm.s * (0.9 + rng() * 0.3),
            rotY: (fi / nFr) * Math.PI * 2 + rng() * 0.55
          };
          if (lowerTier) frondsA.push(frondP); else frondsB.push(frondP);
        }
        for (var ci = 0; ci < 3; ci++) {
          coconuts.push({ x: ccx + (rng() - 0.5) * 0.5, y: 6 * pm.s - 0.35, z: ccz + (rng() - 0.5) * 0.5, sx: 0.26, sy: 0.26, sz: 0.26 });
        }
      }
      for (pi = 0; pi < parkTrees.length; pi++) {
        var tr = parkTrees[pi];
        treeTrunks.push({ x: tr.x, y: 2.4 * tr.s, z: tr.z, sx: 0.6 * tr.s, sy: 4.8 * tr.s, sz: 0.6 * tr.s });
        canopies.push({ x: tr.x, y: 5.4 * tr.s, z: tr.z, sx: 6.4 * tr.s, sy: 3.2 * tr.s, sz: 6.4 * tr.s, color: 0x4da653 });
        canopies.push({ x: tr.x + 0.9 * tr.s, y: 6.8 * tr.s, z: tr.z + 0.5 * tr.s, sx: 4.6 * tr.s, sy: 2.7 * tr.s, sz: 4.6 * tr.s, color: 0x57b85e });
        canopies.push({ x: tr.x - 0.6 * tr.s, y: 8 * tr.s, z: tr.z - 0.7 * tr.s, sx: 3.2 * tr.s, sy: 2.3 * tr.s, sz: 3.2 * tr.s, color: 0x439148 });
      }
      var trunkMat = new THREE.MeshLambertMaterial({ map: barkTex });
      var frondMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
      var treeMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
      makeInstanced(trunkGeo, trunkMat, palmTrunks, scene, false);
      makeInstanced(frondGeoA, frondMat, frondsA, scene, false);
      makeInstanced(frondGeoB, frondMat, frondsB, scene, false);
      makeInstanced(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshLambertMaterial({ color: 0x6a7a2e, flatShading: true }), coconuts, scene, false);
      makeInstanced(new THREE.CylinderGeometry(0.32, 0.5, 1, 5), trunkMat, treeTrunks, scene, false);
      makeInstanced(new THREE.IcosahedronGeometry(0.62, 0), treeMat, canopies, scene, false);

      // Park pond.
      var pond = new THREE.Mesh(new THREE.CircleGeometry(26, 24), new THREE.MeshPhongMaterial({ color: 0x2e8fb5, shininess: 80 }));
      pond.rotation.x = -Math.PI / 2; pond.position.set(0, 0.03, 60);
      scene.add(pond);

      // ---- Streetlights: instanced poles + night glow points ----
      var lamps = SH.Roads.lampPositions;
      var poles = [];
      for (pi = 0; pi < lamps.length; pi++) poles.push({ x: lamps[pi].x, y: 3.4, z: lamps[pi].z, sx: 0.22, sy: 6.8, sz: 0.22 });
      makeInstanced(new THREE.CylinderGeometry(0.5, 0.5, 1, 5), new THREE.MeshLambertMaterial({ color: 0x3a3f4a }), poles, scene, false);
      var glowGeo = new THREE.BufferGeometry();
      var pos = new Float32Array(lamps.length * 3);
      for (pi = 0; pi < lamps.length; pi++) { pos[pi * 3] = lamps[pi].x; pos[pi * 3 + 1] = 6.9; pos[pi * 3 + 2] = lamps[pi].z; }
      glowGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      // Lamp glows need a radial sprite map — bare Points render as squares.
      var gc = document.createElement('canvas'); gc.width = gc.height = 64;
      var gg = gc.getContext('2d');
      var ggrad = gg.createRadialGradient(32, 32, 2, 32, 32, 32);
      ggrad.addColorStop(0, 'rgba(255,255,255,1)'); ggrad.addColorStop(0.35, 'rgba(255,255,255,0.45)'); ggrad.addColorStop(1, 'rgba(255,255,255,0)');
      gg.fillStyle = ggrad; gg.fillRect(0, 0, 64, 64);
      this.glowMaterial = new THREE.PointsMaterial({ color: 0xffca7a, size: 2.6, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, map: new THREE.CanvasTexture(gc) });
      this.glowPoints = new THREE.Points(glowGeo, this.glowMaterial);
      scene.add(this.glowPoints);

      // ---- Port: container stacks + cranes ----
      var containers = [];
      var contColors = [0xc94f4f, 0x4f7ac9, 0x37b24d, 0xe8b04b, 0x9a6ac9, 0x37e0ff];
      for (pi = 0; pi < 110; pi++) {
        var cx2 = 300 + rng() * 250, cz2 = 90 + rng() * 130;
        var lvl = (rng() * 3) | 0;
        containers.push({ x: cx2, y: 1.3 + lvl * 2.6, z: cz2, sx: 12, sy: 2.6, sz: 2.6, rotY: (rng() > 0.5 ? 0 : Math.PI / 2), color: contColors[(rng() * contColors.length) | 0] });
      }
      makeInstanced(box, new THREE.MeshLambertMaterial({ color: 0xffffff }), containers, scene, true);
      var craneMat = new THREE.MeshLambertMaterial({ color: 0xe8b04b, flatShading: true });
      for (pi = 0; pi < 3; pi++) {
        var crane = new THREE.Group();
        var legG = new THREE.BoxGeometry(1.6, 30, 1.6);
        var positions = [[-9, -5], [9, -5], [-9, 5], [9, 5]];
        for (var li = 0; li < 4; li++) {
          var leg = new THREE.Mesh(legG, craneMat);
          leg.position.set(positions[li][0], 15, positions[li][1]);
          crane.add(leg);
        }
        var beam = new THREE.Mesh(new THREE.BoxGeometry(46, 2.2, 2.2), craneMat);
        beam.position.set(6, 30, 0);
        crane.add(beam);
        crane.position.set(340 + pi * 95, 0, 205);
        scene.add(crane);
        SH.World.colliders.push({ x: crane.position.x, z: 205, hx: 11, hz: 7 });
      }

      // ---- Night-market tents in Ruko Senja ----
      var tents = [];
      var tentColors = [0xff4fa3, 0xffd23f, 0x37e0ff, 0xff8c5a, 0x9fd8c0];
      for (pi = 0; pi < 26; pi++) {
        var mx = -352 + (pi % 13) * 7.6, mz = 84 + ((pi / 13) | 0) * 16;
        tents.push({ x: mx, y: 2.6, z: mz, sx: 6.4, sy: 2.8, sz: 6.4, color: tentColors[(rng() * tentColors.length) | 0] });
      }
      // The tent canvas carries a warm emissive that setNightGlow raises
      // after dark, so the stalls read as lit from inside.
      var tentMat = new THREE.MeshLambertMaterial({ flatShading: true, emissive: 0xff8a3a, emissiveIntensity: 0 });
      this.tentMaterial = tentMat;
      makeInstanced(new THREE.ConeGeometry(0.72, 1, 4), tentMat, tents, scene, false);

      // String bulbs over the market (Art Pass 3): instanced warm bulbs
      // on sagging spans between the tent tops of both rows, plus three
      // cross spans. setNightGlow switches them on; every eighth bulb
      // also carries a soft additive glow sprite.
      var bulbPts = [];
      function bulbSpan(x1, z1, x2, z2) {
        var n = Math.max(3, Math.round(Math.hypot(x2 - x1, z2 - z1) / 1.9));
        for (var bi = 0; bi <= n; bi++) {
          var bt = bi / n;
          bulbPts.push({ x: x1 + (x2 - x1) * bt, y: 3.9 - Math.sin(bt * Math.PI) * 0.5, z: z1 + (z2 - z1) * bt });
        }
      }
      for (var brow = 0; brow < 2; brow++) {
        var brz = 84 + brow * 16;
        for (var bti = 0; bti < 12; bti++) bulbSpan(-352 + bti * 7.6, brz, -352 + (bti + 1) * 7.6, brz);
      }
      bulbSpan(-336.8, 84, -336.8, 100);
      bulbSpan(-306.4, 84, -306.4, 100);
      bulbSpan(-276.0, 84, -276.0, 100);
      var bulbMat = new THREE.MeshBasicMaterial({ color: 0x665533 });
      this.bulbMaterial = bulbMat;
      this.bulbOffColor = new THREE.Color(0x665533);
      this.bulbOnColor = new THREE.Color(0xffd9a0);
      var bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 6, 5), bulbMat, bulbPts.length);
      var bDummy = new THREE.Object3D();
      for (pi = 0; pi < bulbPts.length; pi++) {
        bDummy.position.set(bulbPts[pi].x, bulbPts[pi].y, bulbPts[pi].z);
        bDummy.updateMatrix();
        bulbMesh.setMatrixAt(pi, bDummy.matrix);
      }
      scene.add(bulbMesh);
      var bgc = document.createElement('canvas'); bgc.width = bgc.height = 64;
      var bg2 = bgc.getContext('2d');
      var bgrad = bg2.createRadialGradient(32, 32, 2, 32, 32, 32);
      bgrad.addColorStop(0, 'rgba(255,215,150,1)'); bgrad.addColorStop(0.4, 'rgba(255,180,90,0.35)'); bgrad.addColorStop(1, 'rgba(255,160,60,0)');
      bg2.fillStyle = bgrad; bg2.fillRect(0, 0, 64, 64);
      var bulbGlowMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(bgc), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      this.bulbGlowMaterial = bulbGlowMat;
      for (pi = 0; pi < bulbPts.length; pi += 8) {
        var bsp = new THREE.Sprite(bulbGlowMat);
        bsp.scale.set(1.5, 1.5, 1);
        bsp.position.set(bulbPts[pi].x, bulbPts[pi].y, bulbPts[pi].z);
        scene.add(bsp);
      }

      // ---- Boardwalk + pier at Pantai Kencana ----
      // The boardwalk is laid in 30 m segments that follow the bending
      // beach road (roadZ + 17), so it hugs the curved shore.
      var woodMat = new THREE.MeshLambertMaterial({ color: 0xa87c50 });
      for (var bwx = -480; bwx < 480; bwx += 30) {
        var bwz1 = SH.World.beachRoadZ(bwx) + 17, bwz2 = SH.World.beachRoadZ(bwx + 30) + 17;
        var seg = new THREE.Mesh(new THREE.BoxGeometry(31, 0.5, 10), woodMat);
        seg.position.set(bwx + 15, 0.25, (bwz1 + bwz2) / 2);
        seg.rotation.y = -Math.atan2(bwz2 - bwz1, 30);
        seg.receiveShadow = true;
        scene.add(seg);
      }
      var pier = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 110), woodMat);
      pier.position.set(60, 0.25, 340);
      scene.add(pier);
      this.pierEnd = { x: 60, z: 392 };
      var umbrellas = [];
      for (pi = 0; pi < 30; pi++) {
        var umx = -520 + rng() * 1040;
        umbrellas.push({ x: umx, y: 2.2, z: SH.World.coastZ(umx) - 15 - rng() * 11, sx: 4.6, sy: 1.4, sz: 4.6, color: tentColors[(rng() * tentColors.length) | 0] });
      }
      makeInstanced(new THREE.ConeGeometry(0.6, 1, 8), new THREE.MeshLambertMaterial({ flatShading: true }), umbrellas, scene, false);

      // ---- Pulau Seberang: sand + grass discs, a hideout warehouse and a
      // villa on the island the bridge reaches ----
      var isl2 = SH.Config.island;
      var islSand = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshLambertMaterial({ color: 0xe3c491 }));
      islSand.rotation.x = -Math.PI / 2;
      islSand.scale.set(isl2.rx + 12, isl2.rz + 12, 1);
      islSand.position.set(isl2.x, -0.018, isl2.z);
      islSand.receiveShadow = true;
      scene.add(islSand);
      var islGrass = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshLambertMaterial({ color: 0x55a34f }));
      islGrass.rotation.x = -Math.PI / 2;
      islGrass.scale.set(isl2.rx - 12, isl2.rz - 12, 1);
      islGrass.position.set(isl2.x, -0.008, isl2.z);
      islGrass.receiveShadow = true;
      scene.add(islGrass);
      var hideout = new THREE.Mesh(new THREE.BoxGeometry(17, 8, 12), new THREE.MeshLambertMaterial({ map: facadeTexture(999, 'warehouse') }));
      hideout.position.set(396, 4, 482); hideout.rotation.y = 0.4;
      hideout.castShadow = true; hideout.receiveShadow = true;
      scene.add(hideout);
      SH.World.colliders.push({ x: 396, z: 482, hx: 9, hz: 7 });
      var islVilla = new THREE.Mesh(new THREE.BoxGeometry(13, 6.5, 11), new THREE.MeshLambertMaterial({ map: facadeTexture(998, 'villa') }));
      islVilla.position.set(472, 3.25, 474); islVilla.rotation.y = -0.3;
      islVilla.castShadow = true; islVilla.receiveShadow = true;
      scene.add(islVilla);
      SH.World.colliders.push({ x: 472, z: 474, hx: 7, hz: 6 });

      // ---- Billboards in Pelita Heights (canvas sign textures, invented brands) ----
      var signs = [
        { text: 'SELATARA', sub: 'KOTA SELAT • PORT CITY', color: '#ff4fa3', x: -120, z: -308 },
        { text: 'KOPI SENJA', sub: 'KOPI PAGI • KOPI MALAM', color: '#ffd23f', x: 118, z: -188 },
        { text: 'HOTEL KENCANA', sub: 'PANTAI • BEACH', color: '#37e0ff', x: -238, z: 172 },
        { text: 'BENGKEL ARUS', sub: 'SERVIS • REPAIR 24 JAM', color: '#9fd8c0', x: 238, z: -68 },
        { text: 'PASAR MALAM', sub: 'NIGHT MARKET • RUKO SENJA', color: '#ff8c5a', x: -362, z: 58 },
        { text: 'FERI SELATARA', sub: 'FERRY • PELABUHAN', color: '#7dff8a', x: 62, z: 236 }
      ];
      for (pi = 0; pi < signs.length; pi++) {
        var s = signs[pi];
        var sc = document.createElement('canvas'); sc.width = 256; sc.height = 128;
        var sg = sc.getContext('2d');
        sg.fillStyle = '#14101e'; sg.fillRect(0, 0, 256, 128);
        sg.fillStyle = s.color; sg.font = 'bold 30px sans-serif'; sg.textAlign = 'center';
        sg.fillText(s.text, 128, 56);
        sg.fillStyle = '#e8e3d8'; sg.font = '15px sans-serif';
        sg.fillText(s.sub, 128, 88);
        var stex = new THREE.CanvasTexture(sc);
        if (THREE.sRGBEncoding) stex.encoding = THREE.sRGBEncoding;
        var sm = new THREE.Mesh(new THREE.PlaneGeometry(27, 13.5),
          new THREE.MeshBasicMaterial({ map: stex, side: THREE.DoubleSide }));
        sm.position.set(s.x, 18, s.z);
        sm.rotation.y = (pi % 2) ? Math.PI / 2 : 0;
        scene.add(sm);
        var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 12, 5), new THREE.MeshLambertMaterial({ color: 0x3a3f4a }));
        pole.position.set(s.x, 6, s.z);
        scene.add(pole);
      }

      // ---- Power poles + sagging wires along the old-town / downtown avenues ----
      var ppoles = [], parms = [], wirePts = [];
      for (var ei = 0; ei < gEdges.length; ei++) {
        if (!gEdges[ei].vertical) continue;
        var ea = gNodes[gEdges[ei].a], eb = gNodes[gEdges[ei].b];
        var emx = (ea.x + eb.x) / 2, emz = (ea.z + eb.z) / 2;
        var ed = SH.World.districtAt(emx, emz);
        if (!ed || (ed.id !== 'ruko' && ed.id !== 'pelita')) continue;
        var elen = Math.abs(eb.z - ea.z);
        var esteps = Math.max(2, Math.floor(elen / 38));
        var prevTop = null;
        for (var es = 0; es <= esteps; es++) {
          var et = es / esteps;
          var epx = ea.x + (cfg.roadHalf + 1.4), epz = ea.z + (eb.z - ea.z) * et;
          ppoles.push({ x: epx, y: 4.5, z: epz, sx: 0.34, sy: 9, sz: 0.34 });
          parms.push({ x: epx, y: 8.6, z: epz, sx: 2.6, sy: 0.22, sz: 0.22 });
          var top = { x: epx, y: 8.9, z: epz };
          if (prevTop) {
            var midx = (prevTop.x + top.x) / 2, midz = (prevTop.z + top.z) / 2;
            wirePts.push(prevTop.x, prevTop.y, prevTop.z, midx, 7.9, midz, midx, 7.9, midz, top.x, top.y, top.z);
          }
          prevTop = top;
        }
      }
      makeInstanced(new THREE.CylinderGeometry(0.5, 0.5, 1, 5), new THREE.MeshLambertMaterial({ color: 0x4a3a2e }), ppoles, scene, false);
      makeInstanced(box, new THREE.MeshLambertMaterial({ color: 0x4a3a2e }), parms, scene, false);
      var wireGeo = new THREE.BufferGeometry();
      wireGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wirePts), 3));
      var wires = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x14161c, transparent: true, opacity: 0.8 }));
      scene.add(wires);
    },

    setNightGlow: function (amount) {
      if (this.glowMaterial) this.glowMaterial.opacity = amount * 0.85;
      // Market after dark: tent canvas glows from inside, string bulbs
      // warm up and their glow sprites fade in.
      if (this.tentMaterial) this.tentMaterial.emissiveIntensity = amount * 0.5;
      if (this.bulbMaterial) this.bulbMaterial.color.copy(this.bulbOffColor).lerp(this.bulbOnColor, amount);
      if (this.bulbGlowMaterial) this.bulbGlowMaterial.opacity = amount * 0.55;
    }
  };

  SH.Buildings = Buildings;
})(window.SH = window.SH || {});
