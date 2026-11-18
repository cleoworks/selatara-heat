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
    // Horizontal street edges.
    for (j = 0; j < zs.length; j++) {
      for (i = 0; i + 1 < xs.length; i++) addEdge(gridNode(i, j), gridNode(i + 1, j), false);
    }
    // Ruko Senja alleys: a lane along z=124 through the two market blocks,
    // threaded between the shophouse rows (front row ends z~112, back row
    // starts z~136, so the lane at 124 stays clear of every collider).
    var alleyNodes = [nodeAt(-480, 124), addNode(-420, 124), nodeAt(-360, 124), addNode(-300, 124), nodeAt(-240, 124)];
    for (i = 0; i + 1 < alleyNodes.length; i++) addEdge(alleyNodes[i], alleyNodes[i + 1], false, 'alley');

    // Diagonal boulevard: corner-to-corner edges cutting eight blocks.
    // Each crossed cell is recorded so buildings.js leaves it a plaza.
    var diagPairs = [
      [[-480, -420], [-360, -300]], [[-360, -300], [-240, -180]],
      [[-240, -180], [-120, -60]], [[-120, -60], [0, 60]],
      [[0, 60], [120, 180]], [[120, 180], [240, beachRoadZ(240)]],
      [[480, -180], [360, -60]], [[360, 60], [480, 180]]
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
    for (i = 0; i < ring.length; i++) {
      addEdge(ring[i], ring[(i + 1) % ring.length], ringPts[i][0] === ringPts[(i + 1) % ring.length][0], 'ring');
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

  SH.World = {
    rng: makeRng(20261124),
    makeRng: makeRng,
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
