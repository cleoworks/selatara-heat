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

  // ---- Road graph: intersections of avenues x streets, plus the ring highway ----
  var nodes = [];   // {x, z, edges: [edgeIndex]}
  var edges = [];   // {a, b, vertical}
  var nodeIndex = {};

  function addNode(x, z) {
    var key = x + ',' + z;
    if (nodeIndex[key] !== undefined) return nodeIndex[key];
    var id = nodes.length;
    nodes.push({ x: x, z: z, edges: [] });
    nodeIndex[key] = id;
    return id;
  }
  function addEdge(a, b, vertical) {
    var id = edges.length;
    edges.push({ a: a, b: b, vertical: vertical });
    nodes[a].edges.push(id);
    nodes[b].edges.push(id);
  }

  (function buildGraph() {
    var xs = cfg.avenuesX, zs = cfg.streetsZ, i, j;
    for (i = 0; i < xs.length; i++) for (j = 0; j < zs.length; j++) addNode(xs[i], zs[j]);
    for (i = 0; i < xs.length; i++) for (j = 0; j + 1 < zs.length; j++) addEdge(nodeIndex[xs[i] + ',' + zs[j]], nodeIndex[xs[i] + ',' + zs[j + 1]], true);
    for (j = 0; j < zs.length; j++) for (i = 0; i + 1 < xs.length; i++) addEdge(nodeIndex[xs[i] + ',' + zs[j]], nodeIndex[xs[i + 1] + ',' + zs[j]], false);
    // Ring highway rectangle.
    var rx = cfg.ringX, rz = cfg.ringZ;
    var c = [addNode(-rx, -rz), addNode(rx, -rz), addNode(rx, rz), addNode(-rx, rz)];
    addEdge(c[0], c[1], false); addEdge(c[1], c[2], true); addEdge(c[2], c[3], false); addEdge(c[3], c[0], true);
    // Connectors from grid corners to the ring.
    addEdge(nodeIndex['-480,-420'], c[0], true);
    addEdge(nodeIndex['480,-420'], c[1], true);
    addEdge(nodeIndex['480,228'], c[2], true);
    addEdge(nodeIndex['-480,228'], c[3], true);
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
    graph: { nodes: nodes, edges: edges },
    nearestNode: nearestNode,
    colliders: []  // filled by buildings.js: {x, z, hx, hz} AABBs
  };
})(window.SH = window.SH || {});
