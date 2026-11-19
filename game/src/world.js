// SELATARA HEAT — world.js
// Seeded PRNG, district lookup, and the shared road graph (nodes + lane edges)
// used by traffic AI, police pathing and the minimap. One data set, three users.
// Public API: SH.World { rng, districtAt(x,z), graph {nodes, edges}, nearestNode(x,z), colliders[] }.
(function (SH) {
  'use strict';

  // Deterministic PRNG (mulberry32) so the city and screenshots are reproducible.
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var cfg = SH.Config.world;
  var districts = SH.Config.districts;

  function districtAt(x, z) {
    for (var i = 0; i < districts.length; i++) {
      var d = districts[i];
      if (x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1) return d;
    }
    if (z >= cfg.beachZ) return districts[5];
    return null;
  }

  // ---- Organic coastline (Art Pass 3) ----
  // The waterline is a smooth curve, not the old straight z=waterZ rule:
  // three summed sines give small bays (water reaching north) and headlands
  // (land pushing south). Every shore consumer — sand/water ribbons in
  // roads.js, the shoreline clamps in player.js / vehicles.js, the map —
  // reads this one function so they can never disagree.
  function coastZ(x) {
    return cfg.waterZ
      + 24 * Math.sin(x * 0.0042 + 1.3)
      + 13 * Math.sin(x * 0.0107 + 0.5)
      + 6 * Math.sin(x * 0.023 + 2.1);
  }
  // The beachfront street (the southern grid row) also bends, following the
  // coast at a gentler amplitude so hotels keep a clear corridor.
  function beachRoadZ(x) {
    return 228 + 9 * Math.sin(x * 0.0034 + 0.8) + 4 * Math.sin(x * 0.009 + 0.2);
  }

  // ---- Road graph ----
  // Grid avenues x streets, bent beach row, a curved 14-node ring highway,
  // a diagonal boulevard, narrow Ruko Senja alleys, and the bridge to Pulau
  // Seberang. Edges carry a `kind` ('grid' | 'ring' | 'diag' | 'alley' |
  // 'bridge' | 'coast') so renderers and AI can treat each class properly;
  // `vertical` survives only as the traffic straight-ahead heuristic.
  var nodes = [];   // {x, z, edges: [edgeIndex], overWater?}
  var edges = [];   // {a, b, vertical, kind}
  var nodeIndex = {};
  var diagCells = {}; // "avenueIdx,streetIdx" cells the boulevard cuts through

  function addNode(x, z) {
    x = Math.round(x * 10) / 10; z = Math.round(z * 10) / 10;
    var key = x + ',' + z;
    if (nodeIndex[key] !== undefined) return nodeIndex[key];
    var id = nodes.length;
    nodes.push({ x: x, z: z, edges: [] });
    nodeIndex[key] = id;
    return id;
  }
  function nodeAt(x, z) {
    return nodeIndex[Math.round(x * 10) / 10 + ',' + Math.round(z * 10) / 10];
  }
  function addEdge(a, b, vertical, kind) {
    var id = edges.length;
    edges.push({ a: a, b: b, vertical: vertical, kind: kind || 'grid' });
    nodes[a].edges.push(id);
    nodes[b].edges.push(id);
    return id;
  }

  // Bridge segments (shore -> mid-pier node -> island), shared by the
  // land/water tests below.
  var bridgeSegs = [
    [404, 268, 418, 332],
    [418, 332, 430, 404]
  ];
  function distToSeg(px, pz, s) {
    var dx = s[2] - s[0], dz = s[3] - s[1];
    var len2 = dx * dx + dz * dz || 1;
    var t = Math.max(0, Math.min(1, ((px - s[0]) * dx + (pz - s[1]) * dz) / len2));
    var ex = s[0] + dx * t - px, ez = s[1] + dz * t - pz;
    return Math.hypot(ex, ez);
  }
  // Closest point on the bridge corridor + distance to it. The bridge has
  // rails, so player/vehicle shoreline logic uses this to hold anything
  // that strays sideways over the water back onto the deck.
  function bridgeClosest(x, z) {
    var best = null, bd = Infinity;
    for (var i = 0; i < bridgeSegs.length; i++) {
      var s = bridgeSegs[i];
      var dx = s[2] - s[0], dz = s[3] - s[1];
      var len2 = dx * dx + dz * dz || 1;
      var t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / len2));
      var cx = s[0] + dx * t, cz = s[1] + dz * t;
      var d = Math.hypot(x - cx, z - cz);
      if (d < bd) { bd = d; best = { x: cx, z: cz, dist: d }; }
    }
    return best;
  }
  var island = SH.Config.island;
  function onIsland(x, z, grow) {
    var ex = (x - island.x) / (island.rx + (grow || 0));
    var ez = (z - island.z) / (island.rz + (grow || 0));
    return ex * ex + ez * ez < 1;
  }
  // True where a person or car can be without swimming: mainland shore,
  // the pier, the bridge corridor, or the island.
  function isLand(x, z) {
    if (z <= coastZ(x) + 3) return true;
    if (x > 53 && x < 67 && z > 240 && z < 396) return true; // ferry pier
    if (onIsland(x, z, 2)) return true;
    for (var i = 0; i < bridgeSegs.length; i++) if (distToSeg(x, z, bridgeSegs[i]) < 8) return true;
    return false;
  }

  (function buildGraph() {
    var xs = cfg.avenuesX, zs = cfg.streetsZ, i, j;
    var lastRow = zs.length - 1;
    // District-character jitter (user order: the streets themselves
    // must stop being a lattice): every grid intersection shifts by a
    // seeded offset sized by its district — Ruko Senja's old town
    // leans hardest (varied skew angles, uneven blocks), Bukit Mawar
    // is gently irregular, Pelita's CBD only varies its block widths,
    // Karat's port grid stays near-true. The beach row (already a
    // spline), the ring, the alley spine and the island keep exact
    // coordinates. Buildings stay on the array cells; the jitter is
    // smaller than the building inset, so skewed roads read as varied
    // setbacks, never as overlaps (colprobe verifies).
    var jrng = makeRng(31337);
    var jitMag = { ruko: 10, mawar: 7, pelita: 4, karat: 3, taman: 4, kencana: 5 };
    var jit = {}; // "x,z" in array coords -> jittered [x, z]
    for (i = 0; i < xs.length; i++) {
      for (j = 0; j + 1 < zs.length; j++) {
        var mag = jitMag[districtAt(xs[i], zs[j])] || 4;
        jit[xs[i] + ',' + zs[j]] = [
          Math.round((xs[i] + (jrng() * 2 - 1) * mag) * 10) / 10,
          Math.round((zs[j] + (jrng() * 2 - 1) * mag) * 10) / 10
        ];
      }
    }
    function jPos(x, z) { return jit[x + ',' + z] || [x, z]; }
    // Nodes: the southern street row bends with beachRoadZ.
    for (i = 0; i < xs.length; i++) {
      for (j = 0; j < zs.length; j++) {
        if (j === lastRow) addNode(xs[i], beachRoadZ(xs[i]));
        else { var jp0 = jPos(xs[i], zs[j]); addNode(jp0[0], jp0[1]); }
      }
    }
    function gridNode(i2, j2) {
      if (j2 === lastRow) return nodeAt(xs[i2], beachRoadZ(xs[i2]));
      var jp2 = jPos(xs[i2], zs[j2]);
      return nodeAt(jp2[0], jp2[1]);
    }
    // Literal array coords -> the (possibly jittered) node id. Points
    // that are not grid intersections pass through unchanged.
    function gridNodeAt(x, z) {
      var jp3 = jPos(x, z);
      return nodeAt(jp3[0], jp3[1]);
    }
    // Rev 11 — bowed spans: selected interior streets/avenues are
    // resampled into two-bend polylines (the same short-chord trick
    // as the ring road and the beach road), so the NAVIGATION GRAPH
    // itself curves and traffic, police pathfinding and the map all
    // inherit the curve — no system keeps a straight-line shortcut.
    // Amplitudes stay inside the road corridor + building inset
    // (<= 5 m bow + 5.6 m road half < 11.8 m inset), so no building
    // collider is touched (colprobe verifies). Pelita's CBD grid and
    // the housing rows stay straight on purpose (planned city).
    var bowV = { // vertical avenue spans 'x,zStart' -> perpendicular amp
      '-360,-420': 5, '-360,-300': -5, '-360,-180': 5, // Ruko S-curves
      '-240,-300': -4, '-240,-180': 4,
      '360,-300': -4, '360,-180': 4, // Mawar gentle bows
      '360,60': 4.5 // Karat: one broad C on the warehouse access
    };
    var bowH = { // horizontal street spans 'z,xStart' -> perpendicular amp
      '-300,-480': 5, '-300,-360': -5, // Ruko S-curves
      '-180,-480': -5, '-180,-360': 5,
      '-180,240': 4, '-180,360': -4, // Mawar
      '-60,240': -4, '-60,360': 4,
      '60,-120': -5, '60,0': -5, // Taman: bow into the park edge
      '60,240': 4.5, '60,360': 4.5, // Karat access
      '180,-480': -3, '180,-360': -3.5, '180,-240': -3, '180,-120': -2.5, // Kencana:
      '180,0': -2.5, '180,120': -3, '180,240': -3.5, '180,360': -3 // contour bows (north)
    };
    function bowedEdge(a, b, vertical, amp) {
      var A = nodes[a], B = nodes[b];
      var dx = B.x - A.x, dz = B.z - A.z;
      var len = Math.hypot(dx, dz) || 1;
      var px = -dz / len, pz = dx / len; // unit perpendicular
      var prev = a;
      [1 / 3, 2 / 3].forEach(function (t) {
        var s = Math.sin(Math.PI * t) * amp;
        var mid = addNode(A.x + dx * t + px * s, A.z + dz * t + pz * s);
        addEdge(prev, mid, vertical, 'grid');
        prev = mid;
      });
      addEdge(prev, b, vertical, 'grid');
    }
    // Vertical avenue edges (with the Ruko alley split at z=124 on the
    // three western avenues, between the z=60 and z=180 streets).
    for (i = 0; i < xs.length; i++) {
      for (j = 0; j + 1 < zs.length; j++) {
        if ((xs[i] === -480 || xs[i] === -360 || xs[i] === -240) && zs[j] === 60) {
          var mid = addNode(xs[i], 124);
          addEdge(gridNode(i, j), mid, true);
          addEdge(mid, gridNode(i, j + 1), true);
        } else {
          var bv = bowV[xs[i] + ',' + zs[j]];
          if (bv) bowedEdge(gridNode(i, j), gridNode(i, j + 1), true, bv);
          else addEdge(gridNode(i, j), gridNode(i, j + 1), true);
        }
      }
    }
    // Horizontal street edges. The southern (beach) row is subdivided
    // into short chords that hug the beachRoadZ spline (Rev 5A): the
    // coast artery genuinely curves with the bays and headlands, and
    // the shore blocks read as wedges instead of rectangles. The
    // centreline is the same curve as before — only denser.
    for (j = 0; j < zs.length; j++) {
      for (i = 0; i + 1 < xs.length; i++) {
        if (j === lastRow) {
          var prevC = gridNode(i, j);
          for (var sub = 1; sub <= 3; sub++) {
            var subX = xs[i] + (xs[i + 1] - xs[i]) * sub / 4;
            var subN = addNode(subX, beachRoadZ(subX));
            addEdge(prevC, subN, false);
            prevC = subN;
          }
          addEdge(prevC, gridNode(i + 1, j), false);
        } else if (i === 0 && j === 3) {
          // Split the z=-60 street at x=-420: the steep Ruko alley
          // below lands mid-block here (varied angle, not 45 degrees).
          var splitN = addNode(-420, -60);
          addEdge(gridNode(i, j), splitN, false);
          addEdge(splitN, gridNode(i + 1, j), false);
        } else {
          var bh = bowH[zs[j] + ',' + xs[i]];
          if (bh) bowedEdge(gridNode(i, j), gridNode(i + 1, j), false, bh);
          else addEdge(gridNode(i, j), gridNode(i + 1, j), false);
        }
      }
    }
    // The z=124 lane is gone: Kanal Ruko Senja (W1) cuts the two market
    // blocks along the same corridor, threaded between the shophouse
    // rows (front row ends z~112, back row starts z~136, so the canal
    // stays clear of every collider). The avenue mid nodes at z=124
    // stay — their road planes are the canal's bridges.

    // Rev 5C: diagonal pedestrian alleys cutting four Ruko blocks
    // corner-to-corner. Each crossed cell is marked in diagCells, so
    // buildings.js leaves it open as a plaza and the lane is genuinely
    // walkable; traffic never routes into 'alley' edges. Two of them
    // chain into a zig-zag lane through the old town.
    var alleyCuts = [
      { cell: '0,3', a: [-480, 60], b: [-360, -60] },
      { cell: '1,1', a: [-360, -180], b: [-240, -300] },
      { cell: '1,2', a: [-360, -60], b: [-240, -180] },
      { cell: '0,0', a: [-480, -300], b: [-360, -420] },
      // District pass: a steep cut landing mid-block on the split
      // z=-60 street (60 wide, 120 deep — nothing like the 45-degree
      // cuts), and a zig-zag continuation east of the existing chain.
      { cell: '0,2', a: [-420, -60], b: [-360, -180] },
      { cell: '2,2', a: [-120, -60], b: [-240, -180] }
    ];
    for (i = 0; i < alleyCuts.length; i++) {
      addEdge(gridNodeAt(alleyCuts[i].a[0], alleyCuts[i].a[1]), gridNodeAt(alleyCuts[i].b[0], alleyCuts[i].b[1]), false, 'alley');
      diagCells[alleyCuts[i].cell] = true;
    }

    // Diagonal boulevard: corner-to-corner edges cutting eight blocks.
    // Each crossed cell is recorded so buildings.js leaves it a plaza.
    var diagPairs = [
      [[-480, -420], [-360, -300]], [[-360, -300], [-240, -180]],
      [[-240, -180], [-120, -60]], [[-120, -60], [0, 60]],
      [[0, 60], [120, 180]], [[120, 180], [240, beachRoadZ(240)]],
      [[480, -180], [360, -60]], [[360, 60], [480, 180]],
      [[240, -420], [360, -300]], // Rev 5C: angled contour lane in Bukit Mawar
      // District pass: two long interior connectors crossing district
      // seams — Ruko/Taman west (through the park's west block) and
      // Pelita/Karat (through the port's north blocks). Each spans two
      // cells; both crossed cells are registered underneath.
      [[-240, 180], [0, 60]],
      [[120, -60], [360, 60]]
    ];
    for (i = 0; i < diagPairs.length; i++) {
      var pa = diagPairs[i][0], pb = diagPairs[i][1];
      addEdge(gridNodeAt(pa[0], pa[1]), gridNodeAt(pb[0], pb[1]), false, 'diag');
      var ci = xs.indexOf(Math.min(pa[0], pb[0]));
      var zi = zs.indexOf(Math.min(pa[1], pb[1]));
      if (ci >= 0 && zi >= 0) diagCells[ci + ',' + zi] = true;
    }
    diagCells['3,4'] = true; // second cell crossed by the Taman connector
    diagCells['6,3'] = true; // second cell crossed by the Karat connector

    // Bukit Mawar crescents: two curved residential arcs — short
    // chained 'grid' segments bowing through their blocks (the cells
    // stay open green via diagCells). Semi-regular suburbia, but the
    // lattice is broken where people actually live.
    var crescents = [
      { cell: '7,1', pts: [[360, -180], [410, -210], [450, -250], [480, -300]] },
      { cell: '6,2', pts: [[240, -60], [290, -90], [330, -130], [360, -180]] }
    ];
    for (i = 0; i < crescents.length; i++) {
      var cps = crescents[i].pts, prevCn = gridNodeAt(cps[0][0], cps[0][1]);
      for (j = 1; j < cps.length; j++) {
        var cn = (j === cps.length - 1) ? gridNodeAt(cps[j][0], cps[j][1]) : addNode(cps[j][0], cps[j][1]);
        addEdge(prevCn, cn, false, 'grid');
        prevCn = cn;
      }
      diagCells[crescents[i].cell] = true;
    }

    // Rev 11: a teardrop loop in Bukit Mawar — a curved cul-de-sac
    // that leaves the z=-180 street, loops through the block and
    // rejoins it one lot east (no dead end, so traffic never has to
    // reverse out). The cell stays open green via diagCells, so from
    // the air the loop reads as a park-side crescent.
    var tearPts = [[240, -180], [262, -214], [292, -234], [322, -226], [344, -202], [360, -180]];
    var prevTn = gridNodeAt(tearPts[0][0], tearPts[0][1]);
    for (i = 1; i < tearPts.length; i++) {
      var tn = (i === tearPts.length - 1) ? gridNodeAt(tearPts[i][0], tearPts[i][1]) : addNode(tearPts[i][0], tearPts[i][1]);
      addEdge(prevTn, tn, false, 'grid');
      prevTn = tn;
    }
    diagCells['6,1'] = true;

    // Taman Arus curved collector: the lakeside drive along Danau
    // Cermin's south shore (W1 reroute — the lake fills the park's
    // north half, so the arc swung south to hug its shoreline) and
    // crossing the outflow canal on its way (the z=180 street sets
    // the precedent).
    var parkArc = [[-120, 60], [-98, 102], [-44, 126], [22, 140], [72, 158], [120, 180]];
    var prevPk = gridNodeAt(parkArc[0][0], parkArc[0][1]);
    for (i = 1; i < parkArc.length; i++) {
      var pkn = (i === parkArc.length - 1) ? gridNodeAt(parkArc[i][0], parkArc[i][1]) : addNode(parkArc[i][0], parkArc[i][1]);
      addEdge(prevPk, pkn, false, 'grid');
      prevPk = pkn;
    }

    // Ring highway: a curved loop — cut corners, bulged side midpoints, and
    // a south side that hugs the beach instead of the old rectangle.
    var ringPts = [
      [0, -478], [330, -462], [522, -370], [574, -110], [582, 120], [524, 252],
      [330, 250], [0, 284], [-330, 246], [-524, 246], [-582, 60], [-574, -160],
      [-522, -370], [-330, -462]
    ];
    var ring = [];
    for (i = 0; i < ringPts.length; i++) ring.push(addNode(ringPts[i][0], ringPts[i][1]));
    // Rev 5B: the loop is driven as a closed Catmull-Rom spline through
    // the 14 control points, sampled into short straight segments — the
    // graph stays node + segment (traffic, police BFS and missions run
    // on the same system), but the highway reads as a smooth curve both
    // on the road and on the map. The 14 control nodes keep their
    // indices, so the grid connectors below are untouched.
    function crPoint(p0, p1, p2, p3, t) {
      var t2 = t * t, t3 = t2 * t;
      return [
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      ];
    }
    var nRing = ringPts.length;
    for (i = 0; i < nRing; i++) {
      var rp0 = ringPts[(i + nRing - 1) % nRing], rp1 = ringPts[i], rp2 = ringPts[(i + 1) % nRing], rp3 = ringPts[(i + 2) % nRing];
      var prevR = ring[i];
      for (var rs = 1; rs <= 2; rs++) {
        var cp = crPoint(rp0, rp1, rp2, rp3, rs / 3);
        var midR = addNode(cp[0], cp[1]);
        addEdge(prevR, midR, false, 'ring');
        prevR = midR;
      }
      addEdge(prevR, ring[(i + 1) % nRing], false, 'ring');
    }
    // Connectors from the grid corners to the ring.
    addEdge(gridNodeAt(-480, -420), ring[12], true);
    addEdge(gridNodeAt(480, -420), ring[2], true);
    addEdge(gridNode(8, lastRow), ring[5], true);
    addEdge(gridNode(0, lastRow), ring[9], true);

    // Coast drive + bridge to Pulau Seberang.
    var shore = addNode(404, 268);
    addEdge(gridNode(7, lastRow), shore, false, 'coast');
    var b1 = addNode(418, 332); nodes[b1].overWater = true;
    var b2 = addNode(430, 404);
    addEdge(shore, b1, true, 'bridge');
    addEdge(b1, b2, true, 'bridge');
    // Island cross: north/east/south/west points around a centre node.
    var islN = b2, islC = addNode(430, 452), islE = addNode(486, 438), islS = addNode(430, 486), islW = addNode(374, 438);
    addEdge(islN, islC, true); addEdge(islC, islS, true);
    addEdge(islW, islC, false); addEdge(islC, islE, false);
    addEdge(islN, islE, false); addEdge(islE, islS, true);
    addEdge(islS, islW, false); addEdge(islW, islN, true);
  })();

  function nearestNode(x, z) {
    var best = 0, bd = Infinity;
    for (var i = 0; i < nodes.length; i++) {
      var dx = nodes[i].x - x, dz = nodes[i].z - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // ---- shared geometry merging (draw-call budget, Art Bible v2) --------
  // Merge a list of geometries into one BufferGeometry. Everything is
  // converted to non-indexed and position/normal/uv (+color when the
  // first part has it) are concatenated. Used to fuse the static trim of
  // each vehicle and the rigid parts of each figure into single meshes.
  function mergeGeos(list) {
    var parts = [], total = 0, i, g;
    for (i = 0; i < list.length; i++) {
      g = list[i].index ? list[i].toNonIndexed() : list[i];
      parts.push(g);
      total += g.attributes.position.count;
    }
    var hasColor = parts.length && parts[0].attributes.color != null;
    // Skinning attributes ride along when present (Rev 7 figures):
    // without them a merged SkinnedMesh has nothing to bind to.
    var hasSkin = parts.length && parts[0].attributes.skinIndex != null;
    var pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
    var col = hasColor ? new Float32Array(total * 3) : null;
    var ski = hasSkin ? new Uint16Array(total * 4) : null;
    var skw = hasSkin ? new Float32Array(total * 4) : null;
    var off = 0;
    for (i = 0; i < parts.length; i++) {
      g = parts[i];
      pos.set(g.attributes.position.array, off * 3);
      nor.set(g.attributes.normal.array, off * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, off * 2);
      if (col && g.attributes.color) col.set(g.attributes.color.array, off * 3);
      if (ski && g.attributes.skinIndex) ski.set(g.attributes.skinIndex.array, off * 4);
      if (skw && g.attributes.skinWeight) skw.set(g.attributes.skinWeight.array, off * 4);
      off += g.attributes.position.count;
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (ski) out.setAttribute('skinIndex', new THREE.BufferAttribute(ski, 4));
    if (skw) out.setAttribute('skinWeight', new THREE.BufferAttribute(skw, 4));
    return out;
  }

  // Clone a geometry with a position + Euler rotation baked in, so parts
  // can be merged in their placed pose.
  function xformGeo(geo, x, y, z, rx, ry, rz) {
    var m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
    m.setPosition(x, y, z);
    var out = geo.clone();
    out.applyMatrix4(m);
    return out;
  }

  // Rev 8 (elfensky pattern): the city as ONE data model. Every
  // building the generator places records its footprint polygon +
  // height here; the 3D builder consumes the same entries it records,
  // and the 2D map/minimap draw these polygons — never a second,
  // diverging description of the city.
  var CityData = { buildings: [] };
  CityData.addRect = function (x, z, sx, sz, h, rotY) {
    var c = Math.cos(rotY || 0), s = Math.sin(rotY || 0), pts = [];
    var cs = [[-sx / 2, -sz / 2], [sx / 2, -sz / 2], [sx / 2, sz / 2], [-sx / 2, sz / 2]];
    for (var i = 0; i < 4; i++) pts.push([x + cs[i][0] * c - cs[i][1] * s, z + cs[i][0] * s + cs[i][1] * c]);
    CityData.buildings.push({ pts: pts, h: h });
  };
  CityData.addPoly = function (pts, h) { CityData.buildings.push({ pts: pts, h: h }); };
  CityData.addDrum = function (x, z, r, h) {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var a = i / 10 * Math.PI * 2;
      pts.push([x + Math.cos(a) * r, z + Math.sin(a) * r]);
    }
    CityData.buildings.push({ pts: pts, h: h });
  };
  SH.CityData = CityData;

  // ---- W1 inland water: Danau Cermin, Kali Arus, the outflow canal ---
  // One water model for every consumer: landmarks.js renders these
  // shapes, minimap.js draws them from CityData.water, and the movement
  // blockers (inWater / waterPush, used by player.js and vehicles.js)
  // keep feet and wheels out of them — bridges exempt. The sea is NOT
  // here: the shoreline logic (coastZ / isLand) already owns it.
  function organicLoop(cx, cz, rx, rz, seed, wobble, minX, maxX, minZ, maxZ) {
    var pts = [], r = makeRng(seed), ph = [], i;
    for (i = 0; i < 4; i++) ph.push(r() * Math.PI * 2);
    for (i = 0; i < 28; i++) {
      var t = i / 28 * Math.PI * 2;
      var m = 1 + wobble * (0.55 * Math.sin(t * 2 + ph[0]) + 0.3 * Math.sin(t * 3 + ph[1]) + 0.25 * Math.sin(t * 5 + ph[2]) + 0.18 * Math.sin(t * 8 + ph[3]));
      var x = cx + Math.cos(t) * rx * m, z = cz + Math.sin(t) * rz * m;
      pts.push([Math.max(minX, Math.min(maxX, x)), Math.max(minZ, Math.min(maxZ, z))]);
    }
    return pts;
  }
  // Danau Cermin: District Pilot enlargement — the organic loop now
  // spans ~205 x ~152 m (was 189 x 126 m bbox / 19,342 m2, measured
  // from this polygon) centred in the spec's 180-240 m band, clamped
  // clear of the z=-60 street, the x=+-120 avenues and the rerouted
  // lakeside arc.
  var lakePoly = organicLoop(-6, 34, 100, 75, 77031, 0.13, -112, 110, -48, 110);
  var lakeIslandPoly = organicLoop(-16, 30, 17, 12, 77032, 0.12, -64, 28, -14, 68);
  // Kali Arus: rises at a culvert pool under the z=-60 street and
  // winds south into the lake's west shore.
  var riverPts = [[-34, -47], [-44, -16], [-36, 10], [-50, 26]];
  var riverHalfW = 5.5;
  var riverPool = { x: -34, z: -47, r: 6.5 };
  // The outflow: the park canal roads.js already renders, from the
  // lake's south shore to the sea at Pantai Kencana.
  var outflowPts = [[0, 94], [0, 200], [0, 336]];
  var outflowHalfW = 5;
  // Kanal Ruko Senja: a gently curved cut along the old z=124 lane,
  // splitting the old town between its shophouse rows.
  var rukoPts = [];
  for (var rki = 0; rki <= 20; rki++) {
    var rkx = -488 + rki * 11.8;
    rukoPts.push([rkx, 124 + 4.5 * Math.sin((rkx + 492) / 244 * Math.PI * 1.35 + 0.4)]);
  }
  var rukoHalfW = 3.3;
  // Crossings where water may be crossed: {seg, half-width}.
  var waterBridges = [
    { x1: 0, z1: 126, x2: 0, z2: 148, hw: 9.5 },     // lakeside arc over the outflow
    { x1: 0, z1: 169, x2: 0, z2: 191, hw: 9.5 },     // z=180 street over the outflow
    { x1: 0, z1: 224, x2: 0, z2: 246, hw: 9.5 },     // coast road over the outflow
    { x1: -21, z1: 99, x2: -19, z2: 37, hw: 2.8 },   // footbridge to the lake island
    { x1: -58, z1: 13, x2: -36, z2: 23, hw: 3.2 },   // footbridge over Kali Arus
    { x1: 0, z1: 99, x2: 0, z2: 117, hw: 4.2 },      // jogging path over the outflow
    { x1: 6, z1: 106, x2: 6, z2: 87, hw: 2.2 },      // the lake pier
    { x1: -480, z1: 112, x2: -480, z2: 140, hw: 9.5 }, // avenue bridges over Kanal Senja
    { x1: -360, z1: 111, x2: -360, z2: 139, hw: 9.5 },
    { x1: -34, z1: -55, x2: -34, z2: -39, hw: 8.5 }  // culvert mouth under the z=-60 street
  ];

  function pointInPoly(pts, x, z) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }
  function distSeg(px, pz, ax, az, bx, bz) {
    var dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    var t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)) : 0;
    var cx = ax + dx * t, cz = az + dz * t;
    return { d: Math.hypot(px - cx, pz - cz), x: cx, z: cz };
  }
  function distToLine(pts, x, z) {
    var best = null;
    for (var i = 0; i < pts.length - 1; i++) {
      var c = distSeg(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      if (!best || c.d < best.d) best = c;
    }
    var nx = 0, nz = 1;
    if (best.d > 0.001) { nx = (x - best.x) / best.d; nz = (z - best.z) / best.d; }
    return { d: best.d, x: best.x, z: best.z, nx: nx, nz: nz };
  }
  function inWater(x, z) {
    if (pointInPoly(lakePoly, x, z) && !pointInPoly(lakeIslandPoly, x, z)) return true;
    if (distToLine(riverPts, x, z).d < riverHalfW) return true;
    if (Math.hypot(x - riverPool.x, z - riverPool.z) < riverPool.r) return true;
    if (distToLine(outflowPts, x, z).d < outflowHalfW) return true;
    if (distToLine(rukoPts, x, z).d < rukoHalfW) return true;
    return false;
  }
  // Nearest dry point for a point in inland water, or null when the
  // point is dry or stands on a bridge corridor.
  function waterPush(x, z, radius) {
    if (!inWater(x, z)) return null;
    var i;
    for (i = 0; i < waterBridges.length; i++) {
      var s = waterBridges[i];
      if (distSeg(x, z, s.x1, s.z1, s.x2, s.z2).d < s.hw) return null;
    }
    var bx = 0, bz = 0, bt = Infinity;
    function offer(cx2, cz2) {
      var t = Math.hypot(cx2 - x, cz2 - z);
      if (t < bt) { bt = t; bx = cx2; bz = cz2; }
    }
    var polys = [lakePoly, lakeIslandPoly];
    for (var pi = 0; pi < polys.length; pi++) {
      var poly = polys[pi];
      for (i = 0; i < poly.length; i++) {
        var a = poly[i], b = poly[(i + 1) % poly.length];
        var c = distSeg(x, z, a[0], a[1], b[0], b[1]);
        var ux = c.x - x, uz = c.z - z, ul = Math.hypot(ux, uz) || 1;
        offer(c.x + ux / ul * (radius + 0.3), c.z + uz / ul * (radius + 0.3));
      }
    }
    var lines = [[riverPts, riverHalfW], [outflowPts, outflowHalfW], [rukoPts, rukoHalfW]];
    for (i = 0; i < lines.length; i++) {
      var cl = distToLine(lines[i][0], x, z);
      var need = lines[i][1] + radius + 0.3;
      if (cl.d < need + 4) offer(cl.x + cl.nx * need, cl.z + cl.nz * need);
    }
    var pdx = x - riverPool.x, pdz = z - riverPool.z, pdd = Math.hypot(pdx, pdz);
    if (pdd < riverPool.r + 4) {
      var pr = riverPool.r + radius + 0.3;
      offer(riverPool.x + pdx / (pdd || 1) * pr, riverPool.z + pdz / (pdd || 1) * pr);
    }
    return { x: bx, z: bz };
  }
  var WaterData = {
    lake: lakePoly, island: lakeIslandPoly,
    river: riverPts, riverHalfW: riverHalfW, pool: riverPool,
    outflow: outflowPts, outflowHalfW: outflowHalfW,
    ruko: rukoPts, rukoHalfW: rukoHalfW,
    seaObstacles: [{ x: 74, z: 398, r: 10.5 }], // Mercusuar rock (W1.3); boats push off these
    bridges: waterBridges
  };
  CityData.water = [
    { pts: lakePoly, island: lakeIslandPoly },
    { pts: riverPts, halfW: riverHalfW },
    { pts: outflowPts, halfW: outflowHalfW },
    { pts: rukoPts, halfW: rukoHalfW }
  ];

  SH.World = {
    rng: makeRng(20261124),
    makeRng: makeRng,
    mergeGeos: mergeGeos,
    xformGeo: xformGeo,
    districtAt: districtAt,
    coastZ: coastZ,
    beachRoadZ: beachRoadZ,
    isLand: isLand,
    onIsland: onIsland,
    bridgeClosest: bridgeClosest,
    inWater: inWater,
    waterPush: waterPush,
    waterData: WaterData,
    diagCells: diagCells,
    graph: { nodes: nodes, edges: edges },
    nearestNode: nearestNode,
    colliders: [],  // filled by buildings.js: {x, z, hx, hz} AABBs
    parkingCells: []  // filled by buildings.js (Rev 5E): open parking blocks {x, z, w, d} for the map
  };
})(window.SH = window.SH || {});
