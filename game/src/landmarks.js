// SELATARA HEAT — landmarks.js
// W1 world additions, all built from the shared city data in world.js
// (SH.World.waterData / SH.CityData): Danau Cermin + Kali Arus + the
// canal-mouth delta in Taman Arus, Kanal Ruko Senja, Mercusuar Pantai
// Kencana, Menara Pelita, the elevated monorail, the gull flock and
// the map-completion set. Statics merge per material family (water /
// dressing / timber), the water birds share one pooled vertex buffer,
// and nothing here adds a dynamic light.
// Public API: SH.Landmarks { build(scene), update(dt), setEnvMap(tex) }.
(function (SH) {
  'use strict';

  var W = null; // SH.World.waterData, bound in build()
  var anim = { t: 0, birds: [], birdGeo: null, birdTpl: null, boat: null, sampan: null, beam: null };
  var envTex = null;
  var mats = null;
  function makeMats() {
    return {
      water: new THREE.MeshPhongMaterial({ color: 0x45b8d0, specular: 0x9fd4e8, shininess: 110, emissive: 0x062a36, transparent: true, opacity: 0.92, side: THREE.DoubleSide }),
      dress: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }),
      timber: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true })
    };
  }
  // Linear-interpolated z of the Kanal Senja centreline at world x.
  function canalZAt(x) {
    var pts = W.ruko;
    if (x <= pts[0][0]) return pts[0][1];
    for (var i = 0; i < pts.length - 1; i++) {
      if (x <= pts[i + 1][0]) {
        var t = (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
        return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
      }
    }
    return pts[pts.length - 1][1];
  }
  // Polyline shifted sideways by off metres (perpendicular, averaged).
  function offsetLine(pts, off) {
    return pts.map(function (p, i) {
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      var dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
      return [p[0] - dz / L * off, p[1] + dx / L * off];
    });
  }

  // ---------- flat geometry helpers (XZ ribbons and fans) -------------
  function mkGeo(pos, col, upNormals) {
    var n = pos.length / 3, i;
    var nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    for (i = 0; i < n; i++) {
      nor[i * 3 + 1] = 1;
      uv[i * 2] = pos[i * 3] * 0.05; uv[i * 2 + 1] = pos[i * 3 + 2] * 0.05;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    if (upNormals) g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    if (!upNormals) g.computeVertexNormals();
    return g;
  }
  function pushTri(pos, col, a, b, c, ca, cb, cc) {
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    if (col) col.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
  }
  function colOf(color, x, z) {
    return typeof color === 'function' ? new THREE.Color(color(x, z)) : new THREE.Color(color);
  }
  // Triangle fan over a polygon loop (star-shaped loops only).
  function fanGeo(pts, y, color) {
    var cx = 0, cz = 0, i;
    for (i = 0; i < pts.length; i++) { cx += pts[i][0]; cz += pts[i][1]; }
    cx /= pts.length; cz /= pts.length;
    var pos = [], col = color != null ? [] : null;
    var cc = col ? colOf(color, cx, cz) : null;
    for (i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      pushTri(pos, col, [cx, y, cz], [a[0], y, a[1]], [b[0], y, b[1]],
        cc, col ? colOf(color, a[0], a[1]) : null, col ? colOf(color, b[0], b[1]) : null);
    }
    return mkGeo(pos, col, true);
  }
  // Open ribbon of half-width hw along a polyline.
  function stripGeo(pts, hw, y, color) {
    var pos = [], col = color != null ? [] : null, i;
    function side(p, q) {
      var dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1;
      return [-dz / L, dx / L];
    }
    for (i = 0; i < pts.length - 1; i++) {
      var p = pts[i], q = pts[i + 1];
      var s1 = side(p, q), s2 = side(p, q);
      var a = [p[0] + s1[0] * hw, y, p[1] + s1[1] * hw], b = [p[0] - s1[0] * hw, y, p[1] - s1[1] * hw];
      var c = [q[0] - s2[0] * hw, y, q[1] - s2[1] * hw], d = [q[0] + s2[0] * hw, y, q[1] + s2[1] * hw];
      var ca = col ? colOf(color, a[0], a[2]) : null, cb = col ? colOf(color, b[0], b[2]) : null;
      var cc2 = col ? colOf(color, c[0], c[2]) : null, cd = col ? colOf(color, d[0], d[2]) : null;
      pushTri(pos, col, a, b, c, ca, cb, cc2);
      pushTri(pos, col, a, c, d, ca, cc2, cd);
    }
    return mkGeo(pos, col, true);
  }
  // Closed ribbon between two loops of equal length (outer, inner).
  function ringGeo(outer, inner, y, color) {
    var pos = [], col = color != null ? [] : null;
    for (var i = 0; i < outer.length; i++) {
      var j = (i + 1) % outer.length;
      var a = [outer[i][0], y, outer[i][1]], b = [outer[j][0], y, outer[j][1]];
      var c = [inner[j][0], y, inner[j][1]], d = [inner[i][0], y, inner[i][1]];
      var ca = col ? colOf(color, a[0], a[2]) : null, cb = col ? colOf(color, b[0], b[2]) : null;
      var cc = col ? colOf(color, c[0], c[2]) : null, cd = col ? colOf(color, d[0], d[2]) : null;
      pushTri(pos, col, a, b, c, ca, cb, cc);
      pushTri(pos, col, a, c, d, ca, cc, cd);
    }
    return mkGeo(pos, col, true);
  }
  function scaledPts(pts, c, s) {
    return pts.map(function (p) { return [c[0] + (p[0] - c[0]) * s, c[1] + (p[1] - c[1]) * s]; });
  }
  function centroid(pts) {
    var x = 0, z = 0;
    for (var i = 0; i < pts.length; i++) { x += pts[i][0]; z += pts[i][1]; }
    return [x / pts.length, z / pts.length];
  }
  function ellipsePts(cx, cz, rx, rz, rot, n) {
    var pts = [], cr = Math.cos(rot), sr = Math.sin(rot);
    for (var i = 0; i < n; i++) {
      var a = i / n * Math.PI * 2, ex = Math.cos(a) * rx, ez = Math.sin(a) * rz;
      pts.push([cx + ex * cr - ez * sr, cz + ex * sr + ez * cr]);
    }
    return pts;
  }
  function lerpHex(a, b, t) {
    var ca = new THREE.Color(a), cb = new THREE.Color(b);
    ca.lerp(cb, t);
    return ca;
  }
  // Add a uniform vertex-colour attribute to a THREE geometry.
  function paint(geo, hex) {
    var c = new THREE.Color(hex), n = geo.attributes.position.count;
    var col = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  }
  function part(list, geo, hex, x, y, z, rx, ry, rz) {
    list.push(SH.World.xformGeo(paint(geo, hex), x, y, z, rx || 0, ry || 0, rz || 0));
  }
  function box(list, hex, x, y, z, sx, sy, sz, ry) {
    part(list, new THREE.BoxGeometry(sx, sy, sz), hex, x, y, z, 0, ry || 0, 0);
  }

  // Arched timber footbridge from (x1,z1) to (x2,z2): planks follow a
  // gentle arc, rails on both sides, posts down into the water.
  function footbridge(list, x1, z1, x2, z2, rise) {
    var dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz);
    var ry = Math.atan2(dx, dz), px = dz / L, pz = -dx / L;
    var n = Math.max(6, Math.round(L / 0.78)), i, t;
    function deckY(t) { return 0.16 + Math.sin(t * Math.PI) * rise; }
    for (i = 0; i < n; i++) {
      t = (i + 0.5) / n;
      box(list, i % 2 ? 0x8a6844 : 0x7d5f3c, x1 + dx * t, deckY(t), z1 + dz * t, 2.7, 0.09, L / n + 0.06, ry);
    }
    for (var s = -1; s <= 1; s += 2) {
      var posts = Math.max(3, Math.round(L / 4.4));
      var prev = null;
      for (i = 0; i <= posts; i++) {
        t = i / posts;
        var wx = x1 + dx * t + px * s * 1.28, wz = z1 + dz * t + pz * s * 1.28, wy = deckY(t);
        box(list, 0x6e5133, wx, wy + 0.42, wz, 0.11, 0.95, 0.11, ry);
        if (prev) {
          var mx = (wx + prev[0]) / 2, mz = (wz + prev[1]) / 2;
          box(list, 0x7d5f3c, mx, (wy + prev[2]) / 2 + 0.88, mz, 0.09, 0.09, Math.hypot(wx - prev[0], wz - prev[1]) + 0.12, ry);
        }
        prev = [wx, wz, wy];
      }
    }
    for (i = 1; i < 4; i++) {
      t = i / 4;
      for (s = -1; s <= 1; s += 2) {
        box(list, 0x6e5133, x1 + dx * t + px * s * 1.1, -0.25, z1 + dz * t + pz * s * 1.1, 0.16, 0.9, 0.16, ry);
      }
    }
  }

  // Simplified palm (island dressing): tilted trunk + two-tier frond
  // fans built as drooping strips, per the Art Bible palm grammar.
  function frondStrip(list, cx, cy, cz, ang, len, rise, fall, w0, hexA, hexB) {
    var pos = [], col = [];
    var dx = Math.sin(ang), dz = Math.cos(ang), px = dz, pz = -dx;
    var SEG = 5, prev = null;
    for (var k = 0; k <= SEG; k++) {
      var t = k / SEG;
      var c = [cx + dx * len * t, cy + rise * t - fall * t * t, cz + dz * len * t];
      var w = w0 * Math.sin(Math.PI * Math.min(1, t * 1.12)) * (1 - t * 0.5);
      var cc = lerpHex(hexA, hexB, t);
      var L = [c[0] + px * w, c[1], c[2] + pz * w], R = [c[0] - px * w, c[1], c[2] - pz * w];
      if (prev) {
        pushTri(pos, col, prev[0], L, R, prev[2], cc, cc);
        pushTri(pos, col, prev[0], R, prev[1], prev[2], cc, prev[2]);
      }
      prev = [L, R, cc];
    }
    list.push(mkGeo(pos, col, false));
  }
  function miniPalm(list, dress, x, z, s, leanAng) {
    var h = 4.6 * s, lean = 0.55 * s;
    var tx = x + Math.sin(leanAng) * lean, tz = z + Math.cos(leanAng) * lean;
    part(list, new THREE.CylinderGeometry(0.09 * s, 0.17 * s, h, 6), 0x8a6a4a,
      (x + tx) / 2, h / 2, (z + tz) / 2, Math.cos(leanAng) * 0.12, 0, -Math.sin(leanAng) * 0.12);
    for (var k = 0; k < 8; k++) {
      var a = k / 8 * Math.PI * 2 + x * 0.7;
      frondStrip(dress, tx, h + 0.1, tz, a, 2.3 * s, 0.55 * s, 1.0 * s, 0.3 * s, 0x3f7d33, 0x69a844);
    }
    part(list, new THREE.SphereGeometry(0.16 * s, 6, 5), 0x6e5133, tx, h - 0.05, tz, 0, 0, 0);
  }

  // ---------- Feature 1: Danau Cermin + Kali Arus + delta -------------
  function birdTemplate(kind) {
    var parts = [];
    if (kind === 'swan') {
      var body = new THREE.SphereGeometry(0.55, 7, 5); body.scale(1.3, 0.75, 0.85);
      parts.push(SH.World.xformGeo(paint(body, 0xf4f1ea), 0, 0.2, 0, 0, 0, 0));
      parts.push(SH.World.xformGeo(paint(new THREE.ConeGeometry(0.16, 0.5, 5), 0xe8e2d4), 0, 0.34, -0.62, -1.1, 0, 0));
      parts.push(SH.World.xformGeo(paint(new THREE.CylinderGeometry(0.085, 0.13, 0.62, 5), 0xf4f1ea), 0, 0.52, 0.4, 0.55, 0, 0));
      parts.push(SH.World.xformGeo(paint(new THREE.CylinderGeometry(0.07, 0.09, 0.4, 5), 0xf4f1ea), 0, 0.82, 0.52, -0.35, 0, 0));
      parts.push(SH.World.xformGeo(paint(new THREE.SphereGeometry(0.15, 6, 5), 0xf4f1ea), 0, 0.98, 0.6, 0, 0, 0));
      parts.push(SH.World.xformGeo(paint(new THREE.ConeGeometry(0.055, 0.24, 4), 0xe07b2a), 0, 0.96, 0.78, Math.PI / 2, 0, 0));
    } else {
      var db = new THREE.SphereGeometry(0.34, 7, 5); db.scale(1.25, 0.8, 0.9);
      parts.push(SH.World.xformGeo(paint(db, 0x9a8a76), 0, 0.15, 0, 0, 0, 0));
      parts.push(SH.World.xformGeo(paint(new THREE.ConeGeometry(0.11, 0.34, 5), 0x87765f), 0, 0.26, -0.4, -1.15, 0, 0));
      parts.push(SH.World.xformGeo(paint(new THREE.SphereGeometry(0.155, 6, 5), 0x2e7d46), 0, 0.38, 0.3, 0, 0, 0));
      parts.push(SH.World.xformGeo(paint(new THREE.BoxGeometry(0.17, 0.045, 0.13), 0xf2c230), 0, 0.35, 0.47, 0, 0, 0));
    }
    return SH.World.mergeGeos(parts);
  }

  function buildTaman(scene, shared) {
    var water = shared.water, dress = shared.dress, timber = shared.timber;
    var lake = W.lake, island = W.island;
    var lc = centroid(lake), ic = centroid(island);

    // Lakebed (depth gradient), surface, sand apron, jogging path.
    dress.push(fanGeo(scaledPts(lake, lc, 1.03), -0.06, function (x, z) {
      var d = Math.min(1, Math.hypot(x - lc[0], z - lc[1]) / 92);
      return lerpHex(0x175263, 0x77a88d, Math.pow(d, 0.65)).getHex();
    }));
    water.push(fanGeo(lake, 0.02));
    dress.push(ringGeo(scaledPts(lake, lc, 1.05), scaledPts(lake, lc, 1.005), -0.02, 0xc9b489));
    dress.push(ringGeo(scaledPts(lake, lc, 1.115), scaledPts(lake, lc, 1.05), -0.005, 0xb3a284));

    // The island: sand rim, grass top, gazebo, two palms.
    dress.push(fanGeo(scaledPts(island, ic, 1.22), 0.03, 0xd8c49a));
    dress.push(fanGeo(island, 0.07, function (x, z) {
      var d = Math.min(1, Math.hypot(x - ic[0], z - ic[1]) / 14);
      return lerpHex(0x5da24e, 0x7fb35e, d).getHex();
    }));
    part(timber, new THREE.CylinderGeometry(3.1, 3.3, 0.18, 10), 0x9a8f7c, ic[0], 0.16, ic[1], 0, 0, 0);
    for (var gi = 0; gi < 6; gi++) {
      var ga = gi / 6 * Math.PI * 2;
      part(timber, new THREE.CylinderGeometry(0.07, 0.07, 2.2, 5), 0x7d5f3c, ic[0] + Math.cos(ga) * 2.6, 1.3, ic[1] + Math.sin(ga) * 2.6, 0, 0, 0);
    }
    part(timber, new THREE.ConeGeometry(3.9, 1.6, 8), 0xb4552f, ic[0], 3.2, ic[1], 0, 0.4, 0);
    box(timber, 0x8a6844, ic[0] - 1.2, 0.55, ic[1] + 1.4, 2.2, 0.09, 0.45);
    box(timber, 0x8a6844, ic[0] + 1.3, 0.55, ic[1] - 1.2, 2.2, 0.09, 0.45);
    miniPalm(timber, dress, ic[0] - 9, ic[1] - 5, 1.05, 2.2);
    miniPalm(timber, dress, ic[0] + 8.5, ic[1] + 5.5, 0.9, 5.1);

    // Footbridges: to the island, over Kali Arus (jogging path), and
    // over the outflow where the path ring crosses it.
    footbridge(timber, -20.5, 103, -19, 39.5, 0.6);
    footbridge(timber, -56, 14.5, -38, 22.5, 0.32);
    footbridge(timber, 0, 116, 0, 100, 0.3);

    // Lake pier on the south shore + the moored rowboat beside it.
    box(timber, 0x8a6844, 6, 0.1, 96, 2.4, 0.12, 17);
    box(timber, 0x7d5f3c, 6, 0.12, 88.2, 3.6, 0.12, 3.6);
    [[4.9, 103], [7.1, 103], [4.9, 89], [7.1, 89]].forEach(function (pp) {
      part(timber, new THREE.CylinderGeometry(0.09, 0.09, 0.7, 5), 0x6e5133, pp[0], -0.2, pp[1], 0, 0, 0);
    });

    // Kali Arus: wet-earth banks under a calm teal ribbon, from the
    // culvert pool to the lake's west shore.
    var curve = new THREE.CatmullRomCurve3(W.river.map(function (p) { return new THREE.Vector3(p[0], 0, p[1]); }));
    var riverLine = curve.getPoints(26).map(function (v) { return [v.x, v.z]; });
    dress.push(stripGeo(riverLine, 7.6, -0.03, function (x, z) {
      return lerpHex(0x8a7a56, 0x6f7350, 0.5 + 0.5 * Math.sin(x * 0.35 + z * 0.21)).getHex();
    }));
    water.push(stripGeo(riverLine, W.riverHalfW, 0.0));
    water.push(fanGeo(ellipsePts(W.pool.x, W.pool.z, 7.5, 7.5, 0, 14), -0.005));

    // The canal-mouth delta: sand spits, wet flats, shallow braid
    // pools and mangrove clumps where the outflow meets the sea.
    dress.push(fanGeo(ellipsePts(-13, 316, 13, 6.5, 0.5, 12), -0.03, 0xd8c49a));
    dress.push(fanGeo(ellipsePts(12, 324, 11, 5.5, -0.4, 12), -0.032, 0xd8c49a));
    dress.push(fanGeo(ellipsePts(-2, 333, 8, 4.5, 0.2, 12), -0.028, 0xcfba92));
    dress.push(fanGeo(ellipsePts(-19, 304, 10, 5, 0.3, 12), -0.045, 0x6f7350));
    dress.push(fanGeo(ellipsePts(17, 308, 9, 4.5, -0.2, 12), -0.045, 0x6f7350));
    water.push(fanGeo(ellipsePts(-21, 323, 7, 3.6, 0.4, 12), -0.02));
    water.push(fanGeo(ellipsePts(19, 331, 6.5, 3.4, -0.3, 12), -0.02));
    [[-24, 312], [22, 318], [-16, 330], [15, 300], [-26, 326], [24, 336]].forEach(function (mp, mi) {
      part(timber, new THREE.CylinderGeometry(0.06, 0.1, 0.8, 5), 0x5f4630, mp[0], 0.3, mp[1], 0, 0, 0);
      part(dress, new THREE.IcosahedronGeometry(0.95 + (mi % 3) * 0.22, 0), 0x3d6b35, mp[0], 1.05, mp[1], 0, mi * 1.3, 0);
    });

    // The moored rowboat (animated gently in update()).
    var boatParts = [];
    box(boatParts, 0x7a4a30, 0, 0.16, 0, 2.4, 0.16, 1.05);
    box(boatParts, 0x8a5a38, 0, 0.34, 0.52, 2.4, 0.34, 0.09);
    box(boatParts, 0x8a5a38, 0, 0.34, -0.52, 2.4, 0.34, 0.09);
    box(boatParts, 0x8a5a38, 1.14, 0.32, 0, 0.12, 0.32, 0.9);
    box(boatParts, 0x8a5a38, -1.14, 0.32, 0, 0.12, 0.32, 0.9);
    box(boatParts, 0xa8794e, 0, 0.3, 0, 0.34, 0.06, 0.9);
    var boat = new THREE.Mesh(SH.World.mergeGeos(boatParts), mats.timber);
    boat.position.set(10.5, 0.04, 93);
    boat.rotation.y = 0.7;
    scene.add(boat);
    anim.boat = boat;

    // Ducks and swans: one pooled mesh, one rebuilt vertex buffer.
    var defs = [
      { kind: 'duck', r: [30, 21], sp: 0.055, ph: 0.5 },
      { kind: 'duck', r: [33, 23.5], sp: -0.048, ph: 2.4 },
      { kind: 'duck', r: [26, 18], sp: 0.07, ph: 4.2 },
      { kind: 'duck', r: [36, 25], sp: 0.042, ph: 1.2 },
      { kind: 'swan', r: [41, 29], sp: 0.03, ph: 0.1 },
      { kind: 'swan', r: [41, 29], sp: 0.03, ph: 0.55 },
      { kind: 'duck', r: [48, 34], sp: -0.036, ph: 3.3 }
    ];
    var tplGeos = [], total = 0;
    defs.forEach(function (d) {
      var g = birdTemplate(d.kind);
      var ni = g.index ? g.toNonIndexed() : g;
      d.start = total;
      d.count = ni.attributes.position.count;
      total += d.count;
      tplGeos.push(ni);
    });
    var birdGeo = SH.World.mergeGeos(tplGeos);
    anim.birdTpl = birdGeo.attributes.position.array.slice();
    anim.birdGeo = birdGeo;
    anim.birds = defs;
    var birdMesh = new THREE.Mesh(birdGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }));
    birdMesh.name = 'w1-birds';
    birdMesh.frustumCulled = false;
    scene.add(birdMesh);
  }

  // ---------- Feature 2: Kanal Ruko Senja ------------------------------
  function sampanGeo() {
    var parts = [];
    box(parts, 0x6e5133, 0, 0.18, 0, 4.6, 0.16, 1.15);
    box(parts, 0x7d5f3c, 0, 0.38, 0.55, 4.6, 0.3, 0.09);
    box(parts, 0x7d5f3c, 0, 0.38, -0.55, 4.6, 0.3, 0.09);
    box(parts, 0x7d5f3c, 2.25, 0.36, 0, 0.14, 0.34, 1.0);
    box(parts, 0x7d5f3c, -2.25, 0.36, 0, 0.14, 0.34, 1.0);
    [[-0.9, 0.38], [0.9, 0.38], [-0.9, -0.38], [0.9, -0.38]].forEach(function (pp) {
      box(parts, 0x5f4630, pp[0], 0.72, pp[1], 0.055, 0.8, 0.055);
    });
    part(parts, new THREE.BoxGeometry(2.3, 0.06, 0.66), 0xb4552f, 0, 1.3, 0.26, 0.42, 0, 0);
    part(parts, new THREE.BoxGeometry(2.3, 0.06, 0.66), 0xa34a2a, 0, 1.3, -0.26, -0.42, 0, 0);
    box(parts, 0xe07b2a, 1.55, 0.5, 0.15, 0.55, 0.4, 0.55);
    box(parts, 0x37b6e0, 1.5, 0.48, -0.28, 0.5, 0.36, 0.4);
    box(parts, 0x7ed957, -1.6, 0.45, 0, 0.6, 0.3, 0.7);
    return SH.World.mergeGeos(parts);
  }

  function buildRuko(scene, shared) {
    var water = shared.water, dress = shared.dress, timber = shared.timber, glow = shared.glow;
    var curve = new THREE.CatmullRomCurve3(W.ruko.map(function (p) { return new THREE.Vector3(p[0], 0, p[1]); }));
    var line = curve.getPoints(48).map(function (v) { return [v.x, v.z]; });

    // Stone-earth banks, the water ribbon, pale stone rims, end basins.
    dress.push(stripGeo(line, 5.6, -0.025, function (x, z) {
      return lerpHex(0x7a6a52, 0x66583f, 0.5 + 0.5 * Math.sin(x * 0.3 + z * 0.17)).getHex();
    }));
    water.push(stripGeo(line, W.rukoHalfW, -0.01));
    dress.push(stripGeo(offsetLine(line, 3.85), 0.5, 0.005, 0xb8ab90));
    dress.push(stripGeo(offsetLine(line, -3.85), 0.5, 0.005, 0xb8ab90));
    dress.push(fanGeo(ellipsePts(-489, 125.8, 7.5, 6.5, 0, 12), -0.028, 0x7a6a52));
    water.push(fanGeo(ellipsePts(-489, 125.8, 6.2, 5.2, 0, 12), -0.01));
    dress.push(fanGeo(ellipsePts(-251, 120.2, 7, 6, 0, 12), -0.028, 0x7a6a52));
    water.push(fanGeo(ellipsePts(-251, 120.2, 5.8, 4.8, 0, 12), -0.01));

    // Moored sampans (the floating market) + bank-side goods piles.
    var sg = sampanGeo();
    [[-438, -0.9, 0.12], [-316, 0.8, -0.09], [-264, -0.7, 0.2]].forEach(function (sp) {
      timber.push(SH.World.xformGeo(sg, sp[0], 0.0, canalZAt(sp[0]) + sp[1], 0, sp[2], 0));
    });
    [[-432, 5.6], [-310, -5.8], [-258, 5.4]].forEach(function (gp, gi) {
      var gz = canalZAt(gp[0]) + gp[1];
      box(timber, 0xe07b2a, gp[0], 0.3, gz, 0.8, 0.6, 0.8);
      box(timber, gi % 2 ? 0x37b6e0 : 0xe84a6f, gp[0] + 0.9, 0.22, gz + 0.3, 0.6, 0.44, 0.6);
      box(timber, 0x7ed957, gp[0] - 0.85, 0.18, gz - 0.2, 0.55, 0.36, 0.55);
    });
    // One working sampan ferries the canal (animated in update()).
    var ferry = new THREE.Mesh(sg, mats.timber);
    ferry.name = 'w1-sampan';
    scene.add(ferry);
    anim.sampan = ferry;

    // Stairs down to the water (south bank west, north bank east).
    [[-410, 1], [-292, -1]].forEach(function (st) {
      var zc = canalZAt(st[0]);
      for (var si = 0; si < 3; si++) {
        box(timber, 0x9a8f7c, st[0], 0.05 - si * 0.16, zc + st[1] * (5.1 - si * 0.62), 2.3, 0.15, 0.66);
      }
      box(timber, 0x8a6844, st[0], 0.03, zc + st[1] * 3.1, 2.7, 0.07, 1.5);
    });

    // Bridge rails where the avenues cross.
    [-480, -360].forEach(function (ax) {
      var zc = canalZAt(ax);
      [-7.35, 7.35].forEach(function (off) {
        box(timber, 0x6b5a48, ax + off, 0.5, zc, 0.14, 0.72, 25);
        box(timber, 0x7d6a52, ax + off, 0.92, zc, 0.2, 0.1, 25);
      });
    });

    // Laundry lines strung over the water, with bright washing.
    var clothCols = [0xe84a6f, 0x37b6e0, 0xffd23f, 0xf2ede2, 0x7ed957];
    [-452, -398, -336, -278].forEach(function (lx, li) {
      var zc = canalZAt(lx);
      box(timber, 0x4a3b28, lx + 1.2, 4.45, zc, 0.035, 0.035, 15.6, 0.158);
      for (var k = 0; k < 4; k++) {
        var t = 0.2 + k * 0.2;
        box(dress, clothCols[(li + k) % clothCols.length], lx + 1.2 + (t - 0.5) * 2.4, 3.95, zc - 7.8 + t * 15.6, 0.62, 0.82, 0.03, 0.158);
      }
    });

    // Lantern strings sagging across the canal (fake glow family:
    // basic material, no dynamic light).
    for (var sx = -476; sx <= -264; sx += 26.5) {
      var szc = canalZAt(sx);
      box(timber, 0x4a3b28, sx, 3.5, szc, 0.03, 0.03, 11.6);
      for (var sk = 0; sk < 5; sk++) {
        var st2 = 0.12 + sk * 0.19;
        part(glow, new THREE.SphereGeometry(0.11, 6, 5), sk % 2 ? 0xffb03a : 0xff5340,
          sx + (st2 - 0.5) * 1.4, 3.42 - Math.sin(st2 * Math.PI) * 0.5, szc - 5.6 + st2 * 11.2, 0, 0, 0);
      }
    }
  }

  // ---------- Feature 3: Mercusuar Pantai Kencana ----------------------
  function glowTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    var gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,240,200,1)');
    gr.addColorStop(0.35, 'rgba(255,200,110,0.55)');
    gr.addColorStop(1, 'rgba(255,160,60,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  function buildMercusuar(scene, shared) {
    var timber = shared.timber, glow = shared.glow;
    var X = 74, Z = 398;
    // Rock the tower stands on, just east of the pier end — clear of
    // the mission speedboat's berth at (60, 394).
    part(timber, new THREE.CylinderGeometry(8.5, 10, 1.8, 9), 0x5a5f66, X, -0.4, Z, 0, 0.5, 0);
    part(timber, new THREE.CylinderGeometry(5, 5.6, 0.9, 12), 0x9a8f7c, X, 0.45, Z, 0, 0, 0);
    // Five red/white bands, tapering as they climb.
    var bandCols = [0xd8402f, 0xf2ede2, 0xd8402f, 0xf2ede2, 0xd8402f];
    for (var bi = 0; bi < 5; bi++) {
      var rB = 2.7 - bi * 0.14, rT = 2.7 - (bi + 1) * 0.14;
      part(timber, new THREE.CylinderGeometry(rT, rB, 3.3, 14), bandCols[bi], X, 0.9 + bi * 3.3 + 1.65, Z, 0, 0, 0);
    }
    // Gallery, lamp room, cap.
    part(timber, new THREE.CylinderGeometry(2.75, 2.75, 0.45, 14), 0x333a42, X, 17.6, Z, 0, 0, 0);
    part(timber, new THREE.CylinderGeometry(1.45, 1.45, 2.1, 10), 0xbfd9de, X, 18.85, Z, 0, 0, 0);
    part(glow, new THREE.SphereGeometry(0.85, 8, 6), 0xffd9a0, X, 18.85, Z, 0, 0, 0);
    part(timber, new THREE.ConeGeometry(2.05, 1.6, 12), 0xd8402f, X, 20.7, Z, 0, 0, 0);
    part(glow, new THREE.SphereGeometry(0.22, 6, 5), 0xff5340, X, 21.7, Z, 0, 0, 0);
    SH.CityData.addDrum(X, Z, 5.5, 21);

    // The rotating beam: two additive cones + a glow sprite at the
    // lamp. Fake light only — no dynamic light is added.
    var beamGeo = new THREE.ConeGeometry(4.4, 37, 12, 1, true);
    beamGeo.rotateZ(Math.PI / 2);
    beamGeo.translate(18.5, 0, 0);
    var beamMat = new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    var beamGroup = new THREE.Group();
    var beam1 = new THREE.Mesh(beamGeo, beamMat);
    var beam2 = new THREE.Mesh(beamGeo, beamMat);
    beam2.rotation.y = Math.PI;
    beamGroup.add(beam1); beamGroup.add(beam2);
    var sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd9a0, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
    sprite.scale.set(8, 8, 1);
    beamGroup.add(sprite);
    beamGroup.position.set(X, 18.85, Z);
    scene.add(beamGroup);
    anim.beam = { group: beamGroup, mat: beamMat, sprite: sprite.material };
  }

  var Landmarks = {
    build: function (scene) {
      W = SH.World.waterData;
      mats = makeMats();
      var shared = { water: [], dress: [], timber: [], glow: [] };
      buildTaman(scene, shared);
      buildRuko(scene, shared);
      buildMercusuar(scene, shared);
      var waterMesh = new THREE.Mesh(SH.World.mergeGeos(shared.water), mats.water);
      waterMesh.name = 'w1-water';
      scene.add(waterMesh);
      var dressMesh = new THREE.Mesh(SH.World.mergeGeos(shared.dress), mats.dress);
      dressMesh.name = 'w1-dressing';
      scene.add(dressMesh);
      var timberMesh = new THREE.Mesh(SH.World.mergeGeos(shared.timber), mats.timber);
      timberMesh.name = 'w1-timber';
      scene.add(timberMesh);
      if (shared.glow.length) {
        var glowMesh = new THREE.Mesh(SH.World.mergeGeos(shared.glow), mats.glow);
        glowMesh.name = 'w1-glow';
        scene.add(glowMesh);
      }
    },

    setEnvMap: function (tex) { envTex = tex; },

    update: function (dt) {
      anim.t += dt;
      var t = anim.t;
      if (anim.boat) {
        anim.boat.rotation.z = Math.sin(t * 0.9) * 0.045;
        anim.boat.rotation.x = Math.sin(t * 0.7 + 1) * 0.03;
        anim.boat.position.y = 0.04 + Math.sin(t * 1.25) * 0.03;
      }
      if (anim.sampan) {
        var smx = -370 + Math.sin(t * 0.021 + 1.3) * 88;
        var smDir = Math.cos(t * 0.021 + 1.3) >= 0 ? 1 : -1;
        var smSlope = (canalZAt(smx + 3) - canalZAt(smx - 3)) / 6;
        anim.sampan.position.set(smx, 0.02 + Math.sin(t * 1.4) * 0.02, canalZAt(smx));
        anim.sampan.rotation.y = (smDir > 0 ? 0 : Math.PI) - Math.atan(smSlope) * smDir;
        anim.sampan.rotation.z = Math.sin(t * 1.1) * 0.02;
      }
      if (anim.beam) {
        anim.beam.group.rotation.y = t * 0.45;
        var bh = SH.State.hour;
        var bAmt = (bh >= 17.6 || bh <= 5.4) ? 1 : (bh > 16.6 && bh < 17.6 ? bh - 16.6 : (bh > 5.4 && bh < 6.4 ? 6.4 - bh : 0));
        anim.beam.mat.opacity = 0.14 * bAmt;
        anim.beam.sprite.opacity = 0.25 + 0.65 * bAmt;
      }
      if (anim.birdGeo && anim.birds.length) {
        var arr = anim.birdGeo.attributes.position.array, tpl = anim.birdTpl;
        for (var bi = 0; bi < anim.birds.length; bi++) {
          var b = anim.birds[bi];
          var a = b.ph + t * b.sp;
          var px = -18 + Math.cos(a) * b.r[0], pz = 28 + Math.sin(a) * b.r[1];
          var sgn = b.sp < 0 ? -1 : 1;
          var h = Math.atan2(-Math.sin(a) * b.r[0] * sgn, Math.cos(a) * b.r[1] * sgn);
          var ch = Math.cos(h), sh = Math.sin(h);
          var bob = Math.sin(t * 2.1 + b.ph * 3) * 0.03;
          for (var vi = b.start; vi < b.start + b.count; vi++) {
            var lx = tpl[vi * 3], ly = tpl[vi * 3 + 1], lz = tpl[vi * 3 + 2];
            arr[vi * 3] = px + lx * ch + lz * sh;
            arr[vi * 3 + 1] = ly + bob;
            arr[vi * 3 + 2] = pz - lx * sh + lz * ch;
          }
        }
        anim.birdGeo.attributes.position.needsUpdate = true;
        anim.birdGeo.computeVertexNormals();
      }
    }
  };

  SH.Landmarks = Landmarks;
})(window.SH = window.SH || {});
