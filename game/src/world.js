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
    // Nodes: the southern street row bends with beachRoadZ.
    for (i = 0; i < xs.length; i++) {
      for (j = 0; j < zs.length; j++) {
        addNode(xs[i], j === lastRow ? beachRoadZ(xs[i]) : zs[j]);
      }
    }
    function gridNode(i2, j2) {
      return nodeAt(xs[i2], j2 === lastRow ? beachRoadZ(xs[i2]) : zs[j2]);
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
          addEdge(gridNode(i, j), gridNode(i, j + 1), true);
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
        } else {
          addEdge(gridNode(i, j), gridNode(i + 1, j), false);
        }
      }
    }
    // Ruko Senja alleys: a lane along z=124 through the two market blocks,
    // threaded between the shophouse rows (front row ends z~112, back row
    // starts z~136, so the lane at 124 stays clear of every collider).
    var alleyNodes = [nodeAt(-480, 124), addNode(-420, 124), nodeAt(-360, 124), addNode(-300, 124), nodeAt(-240, 124)];
    for (i = 0; i + 1 < alleyNodes.length; i++) addEdge(alleyNodes[i], alleyNodes[i + 1], false, 'alley');

    // Rev 5C: diagonal pedestrian alleys cutting four Ruko blocks
    // corner-to-corner. Each crossed cell is marked in diagCells, so
    // buildings.js leaves it open as a plaza and the lane is genuinely
    // walkable; traffic never routes into 'alley' edges. Two of them
    // chain into a zig-zag lane through the old town.
    var alleyCuts = [
      { cell: '0,3', a: [-480, 60], b: [-360, -60] },
      { cell: '1,1', a: [-360, -180], b: [-240, -300] },
      { cell: '1,2', a: [-360, -60], b: [-240, -180] },
      { cell: '0,0', a: [-480, -300], b: [-360, -420] }
    ];
    for (i = 0; i < alleyCuts.length; i++) {
      addEdge(nodeAt(alleyCuts[i].a[0], alleyCuts[i].a[1]), nodeAt(alleyCuts[i].b[0], alleyCuts[i].b[1]), false, 'alley');
      diagCells[alleyCuts[i].cell] = true;
    }

    // Diagonal boulevard: corner-to-corner edges cutting eight blocks.
    // Each crossed cell is recorded so buildings.js leaves it a plaza.
    var diagPairs = [
      [[-480, -420], [-360, -300]], [[-360, -300], [-240, -180]],
      [[-240, -180], [-120, -60]], [[-120, -60], [0, 60]],
      [[0, 60], [120, 180]], [[120, 180], [240, beachRoadZ(240)]],
      [[480, -180], [360, -60]], [[360, 60], [480, 180]],
      [[240, -420], [360, -300]] // Rev 5C: angled contour lane in Bukit Mawar
    ];
    for (i = 0; i < diagPairs.length; i++) {
      var pa = diagPairs[i][0], pb = diagPairs[i][1];
      addEdge(nodeAt(pa[0], pa[1]), nodeAt(pb[0], pb[1]), false, 'diag');
      var ci = xs.indexOf(Math.min(pa[0], pb[0]));
      var zi = zs.indexOf(Math.min(pa[1], pb[1]));
      if (ci >= 0 && zi >= 0) diagCells[ci + ',' + zi] = true;
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
    addEdge(nodeAt(-480, -420), ring[12], true);
    addEdge(nodeAt(480, -420), ring[2], true);
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
    var pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
    var col = hasColor ? new Float32Array(total * 3) : null;
    var off = 0;
    for (i = 0; i < parts.length; i++) {
      g = parts[i];
      pos.set(g.attributes.position.array, off * 3);
      nor.set(g.attributes.normal.array, off * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, off * 2);
      if (col && g.attributes.color) col.set(g.attributes.color.array, off * 3);
      off += g.attributes.position.count;
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
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
    diagCells: diagCells,
    graph: { nodes: nodes, edges: edges },
    nearestNode: nearestNode,
    colliders: []  // filled by buildings.js: {x, z, hx, hz} AABBs
  };
})(window.SH = window.SH || {});
