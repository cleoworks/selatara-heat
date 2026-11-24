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
  var anim = { t: 0, birds: [], birdGeo: null, birdTpl: null, boat: null, sampan: null, beam: null, ring: null, mono: null };
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
  // Anisotropic scale of a loop around a centre (District Pilot).
  function scaleXY(pts, c, sx, sz) {
    return pts.map(function (p) { return [c[0] + (p[0] - c[0]) * sx, c[1] + (p[1] - c[1]) * sz]; });
  }
  function clampLoop(pts, minX, maxX, minZ, maxZ) {
    return pts.map(function (p) { return [Math.max(minX, Math.min(maxX, p[0])), Math.max(minZ, Math.min(maxZ, p[1]))]; });
  }
  // Register a park zone in the shared city data: the 2D map draws
  // these and the fill audit counts them (District Pilot).
  function parkReg(zone) {
    var parks = SH.CityData.parks || (SH.CityData.parks = []);
    parks.push(zone);
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
    // District Pilot: the old jogging path becomes a proper running
    // circuit — a wide rust-red track ring with two pale lane lines,
    // registered in CityData.parks so the map draws it and the fill
    // audit counts it. The outer loop is clamped off the x=+-120
    // avenue corridors.
    var trackIn = scaleXY(lake, lc, 1.035, 1.05);
    var trackOut = clampLoop(scaleXY(lake, lc, 1.10, 1.14), -113, 113, -52, 118);
    dress.push(ringGeo(trackIn, scaledPts(lake, lc, 1.005), -0.018, 0xc9b489));
    dress.push(ringGeo(trackOut, trackIn, -0.005, 0x9e4f30));
    dress.push(ringGeo(scaleXY(lake, lc, 1.062, 1.082), scaleXY(lake, lc, 1.055, 1.074), -0.002, 0xe9dfc9));
    dress.push(ringGeo(scaleXY(lake, lc, 1.088, 1.112), scaleXY(lake, lc, 1.081, 1.104), -0.002, 0xe9dfc9));
    parkReg({ band: [trackOut, trackIn], kind: 'track' });
    // Benches on the track's outer edge, facing the water.
    for (var bi = 1; bi < 28; bi += 4) {
      var bp = trackOut[bi], bq = trackOut[(bi + 1) % 28];
      var bang = Math.atan2(bq[0] - bp[0], bq[1] - bp[1]);
      box(timber, 0x7d5f3c, bp[0], 0.28, bp[1], 1.9, 0.5, 0.55, bang);
    }

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
    footbridge(timber, -20.5, 110, -19, 39.5, 0.6);
    footbridge(timber, -56, 14.5, -38, 22.5, 0.32);
    footbridge(timber, 0, 116, 0, 100, 0.3);

    // Lake pier on the south shore + the moored rowboat beside it.
    // (Pilot: lengthened to still cross the enlarged lake's shore.)
    box(timber, 0x8a6844, 6, 0.1, 100, 2.4, 0.12, 26);
    box(timber, 0x7d5f3c, 6, 0.12, 89.5, 3.6, 0.12, 3.6);
    [[4.9, 110], [7.1, 110], [4.9, 92], [7.1, 92]].forEach(function (pp) {
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
    boat.position.set(10.5, 0.04, 99);
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

  // ---------- District Pilot: Taman Arus park furniture --------------
  // Everything the W2 list promised the park, placed in the dry
  // pockets the road graph leaves (the lakeside arc and the z=180
  // street are the bounds — the x=0 avenue and the SE diagonal
  // that once crossed the park were removed by the road audit): a
  // tiered fountain and an amphitheater in the south-west pocket,
  // flower beds, tree groves, a lookout deck on the east shore and
  // a small car park. All statics merge into the shared dress/timber/glow
  // lists (no new draw calls) and every zone registers in
  // CityData.parks so the map and the fill audit see the same park.
  function parkTree(dress, x, z, s) {
    var greens = [0x4da653, 0x57b85e, 0x439148];
    part(dress, new THREE.CylinderGeometry(0.13 * s, 0.2 * s, 1.7 * s, 5), 0x6e5133, x, 0.85 * s, z, 0, 0, 0);
    part(dress, new THREE.IcosahedronGeometry(1.55 * s, 0), greens[(x * 7 + z * 13) % 3 < 0 ? 0 : ((x * 7 + z * 13) | 0) % 3], x, 2.5 * s, z, 0, x, 0);
    part(dress, new THREE.IcosahedronGeometry(1.0 * s, 0), 0x57b85e, x + 0.7 * s, 3.1 * s, z + 0.4 * s, 0, z, 0);
  }
  function grove(shared, x0, z0, x1, z1, n, seed) {
    var r = SH.World.makeRng(seed);
    for (var i = 0; i < n; i++) parkTree(shared.dress, x0 + r() * (x1 - x0), z0 + r() * (z1 - z0), 0.9 + r() * 0.5);
    parkReg({ rect: [x0, z0, x1, z1], kind: 'garden' });
  }
  function flowerBed(shared, cx, cz, rx, rz, rot, cA, cB) {
    var outer = ellipsePts(cx, cz, rx, rz, rot, 16);
    shared.dress.push(fanGeo(outer, 0.012, 0x4d7d3a));
    shared.dress.push(fanGeo(scaledPts(outer, [cx, cz], 0.8), 0.02, cA));
    shared.dress.push(fanGeo(scaledPts(outer, [cx, cz], 0.48), 0.028, cB));
    parkReg({ poly: outer, kind: 'garden' });
  }

  function buildTamanPilot(shared) {
    var dress = shared.dress, timber = shared.timber, glow = shared.glow;

    // --- The big fountain, south-west pocket ---
    var FX = -80, FZ = 150;
    dress.push(fanGeo(ellipsePts(FX, FZ, 13.5, 13.5, 0, 24), 0.012, 0xbfb198));
    part(timber, new THREE.CylinderGeometry(10.2, 10.6, 0.55, 22), 0x9a8f7c, FX, 0.27, FZ, 0, 0, 0);
    dress.push(fanGeo(ellipsePts(FX, FZ, 9.6, 9.6, 0, 22), 0.56, 0x46a8cc));
    part(timber, new THREE.CylinderGeometry(0.85, 1.15, 1.5, 10), 0x8f8574, FX, 1.3, FZ, 0, 0, 0);
    part(timber, new THREE.CylinderGeometry(2.7, 1.9, 0.4, 12), 0x9a8f7c, FX, 2.2, FZ, 0, 0, 0);
    // Polish c2: the jet is a soft tiered plume now, not one opaque
    // spike — stacked cones in the DRESS family (white-based, so the
    // pale aqua vertex colours stay pale; the water material's deep
    // blue base multiplied them back into a solid blue cone in the
    // first two pw proofs), plus droplet points in the glow list
    // where the water falls back.
    part(dress, new THREE.ConeGeometry(2.2, 0.9, 10), 0xd6eef7, FX, 3.0, FZ, 0, 0, 0);
    part(dress, new THREE.ConeGeometry(1.45, 1.6, 10), 0xe2f3fa, FX, 3.7, FZ, 0, 0, 0);
    part(dress, new THREE.ConeGeometry(0.95, 1.5, 10), 0xeef8fc, FX, 4.45, FZ, 0, 0, 0);
    part(dress, new THREE.ConeGeometry(0.5, 1.3, 8), 0xf8fdff, FX, 5.1, FZ, 0, 0, 0);
    for (var fd = 0; fd < 10; fd++) {
      var fda = fd / 10 * Math.PI * 2;
      part(glow, new THREE.SphereGeometry(0.17, 6, 5), 0xdff4fc, FX + Math.cos(fda) * 2.3, 3.0 + (fd % 3) * 0.22, FZ + Math.sin(fda) * 2.3, 0, 0, 0);
    }
    for (var fd2 = 0; fd2 < 6; fd2++) {
      var fda2 = fd2 / 6 * Math.PI * 2 + 0.4;
      part(glow, new THREE.SphereGeometry(0.13, 6, 5), 0xeafaff, FX + Math.cos(fda2) * 1.25, 4.15 + (fd2 % 2) * 0.2, FZ + Math.sin(fda2) * 1.25, 0, 0, 0);
    }
    for (var fb = 0; fb < 4; fb++) {
      var ba = fb / 4 * Math.PI * 2 + 0.78;
      box(timber, 0x7d5f3c, FX + Math.sin(ba) * 12, 0.3, FZ + Math.cos(ba) * 12, 1.9, 0.5, 0.55, -ba);
    }
    SH.World.colliders.push({ x: FX, z: FZ, hx: 10.4, hz: 10.4 });
    parkReg({ circle: [FX, FZ, 13.5], kind: 'plaza' });

    // --- Amphitheater, same pocket, stage to the north ---
    var AX = -28, AZ = 142;
    dress.push(fanGeo(ellipsePts(AX, 152, 16, 15, 0, 22), 0.01, 0xb0a58c));
    box(timber, 0x6e5133, AX, 0.4, 139, 15, 0.8, 5);
    box(timber, 0x4a3826, AX - 6.8, 2.4, 136.8, 0.35, 4.8, 0.35);
    box(timber, 0x4a3826, AX + 6.8, 2.4, 136.8, 0.35, 4.8, 0.35);
    box(timber, 0x8a4a30, AX, 4.9, 138, 15.5, 0.3, 6.5);
    box(timber, 0x2c3136, AX - 8.6, 0.8, 141, 1.1, 1.6, 1.1);
    box(timber, 0x2c3136, AX + 8.6, 0.8, 141, 1.1, 1.6, 1.1);
    var seatR = [9.5, 12, 14.5];
    for (var sr = 0; sr < seatR.length; sr++) {
      for (var sa = -60; sa <= 60; sa += 15) {
        var ar = sa * Math.PI / 180, rr = seatR[sr];
        box(timber, sr % 2 ? 0xa89a80 : 0xbfb198, AX + Math.sin(ar) * rr, 0.18 + sr * 0.22, AZ + Math.cos(ar) * rr, 2.4, 0.36 + sr * 0.2, 1.0, -ar);
      }
    }
    SH.World.colliders.push({ x: AX, z: 139, hx: 8, hz: 3.5 });
    parkReg({ circle: [AX, 152, 16], kind: 'plaza' });

    // --- Car park at the pocket's south-west corner ---
    dress.push(fanGeo([[-112, 158], [-84, 158], [-84, 171], [-112, 171]], 0.008, 0x59544f));
    for (var pk = 0; pk < 6; pk++) box(timber, 0xd8d8d8, -109 + pk * 4.4, 0.03, 161, 0.25, 0.03, 3.4);
    parkReg({ rect: [-112, 158, -84, 171], kind: 'plaza' });

    // --- Flower beds (two-tone, from the same ellipse data) ---
    flowerBed(shared, -52, 164, 11, 5, -0.3, 0xe2543e, 0xffd23f);
    flowerBed(shared, 28, 166, 12, 5, 0.3, 0xff7a9e, 0xffe9f2);
    flowerBed(shared, 98, 128, 11, 5, -0.4, 0x9a6ac9, 0xffd23f);
    flowerBed(shared, -106, 138, 9, 4.5, 0.3, 0xff8c42, 0xfff3e0);
    flowerBed(shared, 88, -38, 10, 5, 0.2, 0xff7a9e, 0xffffff);

    // --- Tree groves: north-east meadow, east shore, south-east ---
    grove(shared, 76, -44, 104, -16, 6, 5150);
    grove(shared, 88, 84, 108, 106, 4, 5151);
    grove(shared, 74, 110, 96, 130, 4, 5152);
    parkTree(dress, -95, 138, 1.1); parkTree(dress, -64, 139, 0.95); parkTree(dress, -93, 165, 1.0);
    parkTree(dress, -45, 146, 1.05); parkTree(dress, -11, 147, 0.9); parkTree(dress, -28, 170, 1.1);

    // --- Lookout deck on the east shore ---
    dress.push(fanGeo(ellipsePts(95, 105, 7, 5.5, 0, 14), 0.03, 0x8a6844));
    for (var dp2 = 0; dp2 < 5; dp2++) {
      var da = dp2 / 5 * Math.PI * 2;
      part(timber, new THREE.CylinderGeometry(0.07, 0.07, 0.9, 5), 0x6e5133, 95 + Math.cos(da) * 6.2, 0.45, 105 + Math.sin(da) * 4.8, 0, 0, 0);
    }
    parkReg({ circle: [95, 105, 7], kind: 'plaza' });

    // --- Path spurs: track -> fountain, track -> amphitheater, and
    // the garden link between the two plazas ---
    dress.push(stripGeo([[-80, 110], [-80, 136]], 1.6, 0.006, 0xb3a284));
    dress.push(stripGeo([[-28, 119], [-28, 138]], 1.6, 0.006, 0xb3a284));
    dress.push(stripGeo([[-66, 152], [-44, 152]], 1.8, 0.006, 0xb3a284));
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

  // ---------- Feature 4: Menara Pelita ---------------------------------
  function towerFacadeTexture() {
    var c = document.createElement('canvas');
    c.width = 128; c.height = 256;
    var g = c.getContext('2d');
    g.fillStyle = '#31465e';
    g.fillRect(0, 0, 128, 256);
    var r = SH.World.makeRng(4451);
    for (var y = 0; y < 16; y++) {
      for (var x = 0; x < 8; x++) {
        var lit = r();
        g.fillStyle = lit < 0.22 ? '#ffca7a' : (lit < 0.55 ? '#7d99b5' : '#48637e');
        g.fillRect(6 + x * 15, 8 + y * 15, 10, 9);
      }
    }
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  function helipadTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#2e3138';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#f2ede2';
    g.lineWidth = 5;
    g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#f2ede2';
    g.font = 'bold 62px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('H', 64, 68);
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function buildMenara(scene, shared) {
    var timber = shared.timber, glow = shared.glow;
    var X = -180, Z = -120;
    // Plaza + podium (buildings.js leaves the plaza-rolled block at
    // (-180,-120) empty for this — see the note there).
    box(timber, 0x9a8f7c, X, 0.07, Z, 56, 0.14, 56);
    box(timber, 0x8f8a7c, X, 2.5, Z, 46, 5, 46);
    box(timber, 0x7d7666, X, 4.6, Z + 24.6, 12, 0.35, 4.6);
    [[-24, -24], [24, -24], [-24, 24], [24, 24]].forEach(function (pp) {
      box(timber, 0x7a4a38, X + pp[0], 0.5, Z + pp[1], 2.6, 0.9, 2.6);
      box(timber, 0x3f7d33, X + pp[0], 1.15, Z + pp[1], 2.9, 0.5, 2.9);
    });
    // The shaft: six terraced glass sections tapering 30 m -> 19.5 m,
    // 5 m podium + 90 m of glass = the tallest structure in Selatara.
    var shaftGeos = [];
    for (var si = 0; si < 6; si++) {
      var w = 30 - si * 2.1;
      shaftGeos.push(SH.World.xformGeo(new THREE.BoxGeometry(w, 15, w), X, 5 + si * 15 + 7.5, Z, 0, 0, 0));
      var hw = w / 2 + 0.06;
      [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]].forEach(function (cp) {
        part(glow, new THREE.BoxGeometry(0.17, 15, 0.17), 0x37e0ff, X + cp[0], 5 + si * 15 + 7.5, Z + cp[1], 0, 0, 0);
      });
    }
    var shaftMat = new THREE.MeshStandardMaterial({ map: towerFacadeTexture(), roughness: 0.38, metalness: 0.4, envMapIntensity: 0.55 });
    var shaft = new THREE.Mesh(SH.World.mergeGeos(shaftGeos), shaftMat);
    shaft.name = 'w1-menara';
    scene.add(shaft);
    mats.menara = shaftMat;
    // Crown terrace + helipad + mast with beacon.
    part(timber, new THREE.CylinderGeometry(12.5, 13.5, 1.6, 18), 0x333a42, X, 95.8, Z, 0, 0, 0);
    var pad = new THREE.Mesh(new THREE.CircleGeometry(9, 24), new THREE.MeshStandardMaterial({ map: helipadTexture(), roughness: 0.9, metalness: 0 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(X, 96.65, Z);
    scene.add(pad);
    part(timber, new THREE.CylinderGeometry(0.16, 0.26, 13, 6), 0x9aa0a8, X + 8.5, 102.5, Z, 0, 0, 0);
    part(glow, new THREE.SphereGeometry(0.32, 6, 5), 0xff4040, X + 8.5, 109.2, Z, 0, 0, 0);
    // The neon crown ring, hue cycling slowly (update() drives it).
    var ringMat = new THREE.MeshBasicMaterial({ color: 0xff4fa3, fog: false });
    var ring = new THREE.Mesh(new THREE.TorusGeometry(13.4, 0.32, 8, 44), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(X, 93.4, Z);
    scene.add(ring);
    anim.ring = ringMat;
    SH.World.colliders.push({ x: X, z: Z, hx: 24, hz: 24 });
    SH.CityData.addRect(X, Z, 46, 46, 96);
  }

  // ---- Feature 5: the elevated monorail --------------------------------
  // A closed Catmull-Rom loop at beam-top y=9.85 following the street
  // corridors (avenue 120 north-south, street -300 east-west, the
  // coast bend, avenue -360 back down). Beam + pillars + stations are
  // merged statics; pillars stand 8.6 m off the centreline (sidewalk
  // verge) and are skipped where they'd land in water, off land, or
  // within 8.2 m of any road-graph edge (junction mouths) — the beam
  // spans those gaps. Only pillar feet and station shafts collide;
  // the beam and platforms are 8+ m up, clear of all traffic.
  function distToGraph(x, z) {
    var g = SH.World.graph, best = 1e18;
    for (var ei = 0; ei < g.edges.length; ei++) {
      var e = g.edges[ei], a = g.nodes[e.a], b = g.nodes[e.b];
      var vx = b.x - a.x, vz = b.z - a.z, wx = x - a.x, wz = z - a.z;
      var tt = (vx * wx + vz * wz) / ((vx * vx + vz * vz) || 1);
      tt = tt < 0 ? 0 : (tt > 1 ? 1 : tt);
      var dx = wx - vx * tt, dz = wz - vz * tt, d2 = dx * dx + dz * dz;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  }

  function buildMonorel(scene, shared) {
    var timber = shared.timber, glow = shared.glow;
    var ctrl = [[120, -300], [120, -180], [120, -60], [120, 60], [120, 150], [120, 205], [84, 234], [30, 236], [-60, 238], [-150, 232], [-240, 224], [-320, 190], [-360, 110], [-360, -20], [-360, -160], [-360, -300], [-240, -300], [-120, -300], [0, -300]];
    var v3 = ctrl.map(function (p) { return new THREE.Vector3(p[0], 0, p[1]); });
    var curve = new THREE.CatmullRomCurve3(v3, true, 'catmullrom', 0.35);
    var total = curve.getLength();

    // Beam: plate + stem boxes per ~8 m of arc.
    var segs = Math.round(total / 8);
    var bp = curve.getSpacedPoints(segs);
    for (var s = 0; s < segs; s++) {
      var p0 = bp[s], p1 = bp[s + 1];
      var mx = (p0.x + p1.x) / 2, mz = (p0.z + p1.z) / 2;
      var dx = p1.x - p0.x, dz = p1.z - p0.z;
      var sl = Math.sqrt(dx * dx + dz * dz) + 0.4, ry = Math.atan2(dx, dz);
      part(timber, new THREE.BoxGeometry(2.3, 0.55, sl), 0xc9ccce, mx, 9.575, mz, 0, ry, 0);
      part(timber, new THREE.BoxGeometry(0.85, 1.5, sl), 0xb4b7ba, mx, 8.55, mz, 0, ry, 0);
    }
    // Pillars every ~24 m, offset to the verge.
    for (var pi = 0; pi < segs; pi += 3) {
      var P = bp[pi], Pn = bp[pi + 1], Pp = bp[(pi + segs - 1) % segs];
      var tx = Pn.x - Pp.x, tz = Pn.z - Pp.z, tl = Math.sqrt(tx * tx + tz * tz) || 1;
      var qx = -tz / tl, qz = tx / tl, placed = false;
      for (var sd = 0; sd < 2 && !placed; sd++) {
        var sgn = sd === 0 ? 1 : -1;
        var fx = P.x + qx * sgn * 8.6, fz = P.z + qz * sgn * 8.6;
        if (!SH.World.isLand(fx, fz) || SH.World.inWater(fx, fz)) continue;
        if (distToGraph(fx, fz) < 8.2) continue;
        box(timber, 0xbfc2c5, fx, 3.9, fz, 1.3, 7.8, 1.3);
        var amx = (fx + P.x) / 2, amz = (fz + P.z) / 2;
        part(timber, new THREE.BoxGeometry(0.9, 0.7, 8.9), 0xb4b7ba, amx, 8.15, amz, 0, Math.atan2(P.x - fx, P.z - fz), 0);
        SH.World.colliders.push({ x: fx, z: fz, hx: 0.75, hz: 0.75 });
        placed = true;
      }
    }
    // Stations: platform + canopy + ground access shaft.
    function station(cx, cz, side, name) {
      var px = cx + side * 5.9;
      // Ground access shaft (audit fix, 2026-11-19): the fixed
      // side*8.6 spot put all three shafts on a carriageway — the
      // Ruko shaft in avenue x=-360's east lane, the Pelita and
      // Taman shafts in the mouths of the z=-180 / z=60 streets.
      // Walk the offset out, then along the platform, then to the
      // other side, until the shaft's footprint clears every road
      // corridor by the same 8.4 m standard the pillars use.
      var sx2 = cx + side * 8.6, sz2 = cz, shaftDone = false;
      var offs = [8.6, 11.5, 14.5], slides = [0, 13, -13, 26, -26];
      for (var sd2 = 0; sd2 < 2 && !shaftDone; sd2++) {
        var sgn2 = sd2 === 0 ? side : -side;
        for (var oi = 0; oi < offs.length && !shaftDone; oi++) {
          for (var si3 = 0; si3 < slides.length && !shaftDone; si3++) {
            var tx2 = cx + sgn2 * offs[oi], tz2 = cz + slides[si3];
            if (!SH.World.isLand(tx2, tz2) || SH.World.inWater(tx2, tz2)) continue;
            if (distToGraph(tx2, tz2) < 8.4) continue;
            sx2 = tx2; sz2 = tz2; shaftDone = true;
          }
        }
      }
      box(timber, 0xd6d3cc, px, 9.0, cz, 4.6, 0.8, 20);
      box(glow, 0xffd76a, cx + side * 3.75, 9.43, cz, 0.3, 0.06, 20);
      box(timber, 0x3f6d7a, px, 12.6, cz, 5.4, 0.25, 20);
      var postOff = [[-2.2, -8.5], [2.2, -8.5], [-2.2, 8.5], [2.2, 8.5]];
      for (var po = 0; po < 4; po++) box(timber, 0x8f9296, px + postOff[po][0], 11.0, cz + postOff[po][1], 0.18, 3.2, 0.18);
      box(glow, 0x53e0d4, cx + side * 3.3, 11.9, cz, 0.15, 0.7, 6);
      box(timber, 0xcac7c0, sx2, 4.7, sz2, 3.2, 9.4, 3.2);
      box(timber, 0x2c3136, sx2 + (cx > sx2 ? 1.62 : -1.62), 1.1, sz2, 0.08, 2.2, 1.2);
      SH.World.colliders.push({ x: sx2, z: sz2, hx: 1.7, hz: 1.7 });
      return { x: cx, z: cz, name: name };
    }
    var stations = [station(120, -180, 1, 'Pelita'), station(120, 60, 1, 'Taman Arus'), station(-360, 60, 1, 'Ruko Senja')];

    // The train: three cars from one merged-geometry template.
    function carGeometry() {
      var geos = [];
      function cbox(sx, sy, sz, x, y, z, hex) {
        var g = new THREE.BoxGeometry(sx, sy, sz);
        g.translate(x, y, z);
        paint(g, hex);
        geos.push(g);
      }
      cbox(2.2, 0.5, 10.6, 0, 0.25, 0, 0x3a3f45);
      cbox(2.5, 1.9, 11.0, 0, 1.45, 0, 0xd8dde2);
      cbox(2.54, 0.8, 11.04, 0, 1.8, 0, 0x1d3a44);
      cbox(2.54, 0.34, 11.04, 0, 0.92, 0, 0x1f8a8a);
      cbox(2.2, 0.45, 10.2, 0, 2.62, 0, 0xb9bfc6);
      cbox(2.0, 0.5, 0.5, 0, 1.45, 5.5, 0x2b2f34);
      return SH.World.mergeGeos(geos);
    }
    var carGeo = carGeometry();
    var carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.35 });
    var cars = [];
    for (var ci = 0; ci < 3; ci++) {
      var car = new THREE.Mesh(carGeo, carMat);
      car.name = 'w1-monorail-car';
      scene.add(car);
      cars.push(car);
    }
    var headLamp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 0.1), new THREE.MeshBasicMaterial({ color: 0xffedb5 }));
    headLamp.position.set(0, 1.05, 5.78);
    cars[0].add(headLamp);
    var tailLamp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 0.1), new THREE.MeshBasicMaterial({ color: 0xff4a3a }));
    tailLamp.position.set(0, 1.05, -5.78);
    cars[2].add(tailLamp);

    var NS = 720;
    var samples = curve.getSpacedPoints(NS);
    samples.length = NS; // last point duplicates the first on a closed loop
    anim.mono = { samples: samples, n: NS, spacing: total / NS, total: total, head: 0, cars: cars, debug: -1 };
    var mapPts = [];
    for (var mi = 0; mi < NS; mi += 15) mapPts.push([Math.round(samples[mi].x), Math.round(samples[mi].z)]);
    SH.CityData.mono = { pts: mapPts, stations: stations };
  }

  // ---------- Polish c2: district fill rollout -----------------------
  // The District Pilot finished Taman Arus by filling its plain-grass
  // blocks with registered zones + merged geometry. This is the same
  // pattern rolled out to the three emptiest districts (measured on a
  // 1 m sample grid over the shared city data: Karat 65.1% plain
  // grass, Bukit Mawar 59.0%, Pantai Kencana 50.2%). Every placement
  // is tested against the SAME shared data the pilot audit used —
  // road graph distance, CityData.buildings polygons, colliders,
  // inland water — so nothing lands on a carriageway or inside a
  // footprint, and every filled area registers in CityData.parks so
  // the 2D map and the fill audit see the same city. All geometry
  // merges into the shared dress/timber/water lists: zero new draw
  // calls.
  function inPolyL(p, x, z) {
    var ins = false;
    for (var i = 0, j = p.length - 1; i < p.length; j = i++) {
      var xi = p[i][0], zi = p[i][1], xj = p[j][0], zj = p[j][1];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins;
    }
    return ins;
  }
  function bboxOf(p) {
    var x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (var i = 0; i < p.length; i++) { x0 = Math.min(x0, p[i][0]); x1 = Math.max(x1, p[i][0]); z0 = Math.min(z0, p[i][1]); z1 = Math.max(z1, p[i][1]); }
    return { x0: x0, x1: x1, z0: z0, z1: z1 };
  }
  function bldgClear(x, z, pad) {
    var bs = SH.CityData.buildings;
    for (var i = 0; i < bs.length; i++) {
      var bb = bboxOf(bs[i].pts);
      if (x > bb.x0 - pad && x < bb.x1 + pad && z > bb.z0 - pad && z < bb.z1 + pad) {
        if (inPolyL(bs[i].pts, x, z)) return false;
        var dx = Math.max(bb.x0 - x, 0, x - bb.x1), dz = Math.max(bb.z0 - z, 0, z - bb.z1);
        if (Math.hypot(dx, dz) < pad) return false;
      }
    }
    return true;
  }
  function colliderClear(x, z, pad) {
    var cs = SH.World.colliders;
    for (var i = 0; i < cs.length; i++) {
      if (Math.abs(x - cs[i].x) < cs[i].hx + pad && Math.abs(z - cs[i].z) < cs[i].hz + pad) return false;
    }
    return true;
  }
  // A free-standing spot: on land, dry, clear of roads, buildings,
  // colliders and already-registered park zones.
  function spotFree(x, z, roadMin, pad) {
    if (!SH.World.isLand(x, z) || SH.World.inWater(x, z)) return false;
    if (distToGraph(x, z) < roadMin) return false;
    if (!bldgClear(x, z, pad) || !colliderClear(x, z, pad)) return false;
    var P = SH.CityData.parks || [];
    for (var i = 0; i < P.length; i++) {
      var s = P[i];
      if (s.circle && Math.hypot(x - s.circle[0], z - s.circle[1]) < s.circle[2] + 1) return false;
      if (s.rect && x > s.rect[0] - 1 && x < s.rect[2] + 1 && z > s.rect[1] - 1 && z < s.rect[3] + 1) return false;
      if (s.poly && inPolyL(s.poly, x, z)) return false;
    }
    return true;
  }
  // A ground pad rect: corners + centre must be dry land, off the
  // carriageways and out of every footprint (pads may slide UNDER a
  // building's own footprint — that reads as its apron — so building
  // overlap is allowed, road/water overlap is not).
  function padFree(x0, z0, x1, z1, roadMin) {
    var pts = [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) / 2, (z0 + z1) / 2], [(x0 + x1) / 2, z0], [(x0 + x1) / 2, z1], [x0, (z0 + z1) / 2], [x1, (z0 + z1) / 2]];
    for (var i = 0; i < pts.length; i++) {
      if (!SH.World.isLand(pts[i][0], pts[i][1]) || SH.World.inWater(pts[i][0], pts[i][1])) return false;
      if (distToGraph(pts[i][0], pts[i][1]) < roadMin) return false;
    }
    return true;
  }
  function padRect(shared, x0, z0, x1, z1, y, colorFn, kind, mapColor, deferReg) {
    shared.dress.push(fanGeo([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], y, colorFn));
    if (deferReg) return { rect: [x0, z0, x1, z1], kind: kind, color: mapColor };
    var zone = { rect: [x0, z0, x1, z1], kind: kind };
    if (mapColor) zone.color = mapColor;
    parkReg(zone);
    return zone;
  }
  // District cells: consecutive avenue/street centrelines clipped to
  // the district rect (the same grid buildings.js builds on).
  function districtCells(d) {
    var cfgW = SH.Config.world;
    var xs = [d.x0].concat(cfgW.avenuesX.filter(function (v) { return v > d.x0 && v < d.x1; })).concat([d.x1]);
    var zs = [d.z0].concat(cfgW.streetsZ.filter(function (v) { return v > d.z0 && v < d.z1; })).concat([d.z1]);
    var cells = [];
    for (var i = 0; i + 1 < xs.length; i++) for (var j = 0; j + 1 < zs.length; j++) {
      cells.push({ x0: xs[i], x1: xs[i + 1], z0: zs[j], z1: zs[j + 1] });
    }
    return cells;
  }
  function districtById(id) {
    var ds = SH.Config.districts;
    for (var i = 0; i < ds.length; i++) if (ds[i].id === id) return ds[i];
    return null;
  }

  // Tile a cell interior with tested sub-rect pads. Whole-cell pads
  // fail wherever an alley, diagonal or crescent crosses the cell
  // (measured: most cells), so each ~25 m tile is tested on its own
  // 9 points against the graph at roadMin 8.6 (the widest carriageway
  // + sidewalk edge sits at 8.8; a tile edge may tuck 0.2 m under a
  // slab's vertical face, never over asphalt). Accepted tiles merge
  // into the dress list; their zones register immediately unless
  // deferReg collects them for later (garden furniture is tested
  // against pre-fill zones, like the pilot's ordering).
  function tilePads(shared, x0, z0, x1, z1, y, colorFn, kind, mapColor, deferReg, zonesOut) {
    var tile = 25, nx = Math.max(1, Math.round((x1 - x0) / tile)), nz = Math.max(1, Math.round((z1 - z0) / tile));
    var accepted = 0, tested = 0;
    for (var i = 0; i < nx; i++) for (var j = 0; j < nz; j++) {
      var sx0 = x0 + (x1 - x0) * i / nx, sx1 = x0 + (x1 - x0) * (i + 1) / nx;
      var sz0 = z0 + (z1 - z0) * j / nz, sz1 = z0 + (z1 - z0) * (j + 1) / nz;
      tested++;
      if (!padFree(sx0, sz0, sx1, sz1, 8.6)) continue;
      accepted++;
      shared.dress.push(fanGeo([[sx0, sz0], [sx1, sz0], [sx1, sz1], [sx0, sz1]], y, colorFn));
      var zone = { rect: [sx0, sz0, sx1, sz1], kind: kind };
      if (mapColor) zone.color = mapColor;
      if (deferReg) zonesOut.push(zone); else parkReg(zone);
    }
    return { accepted: accepted, tested: tested };
  }

  // --- Pelabuhan Karat: paved working yards -------------------------
  // Port land is yards, not lawn: cell interiors become gravel or
  // concrete pads (tone varies per cell, with darker wheel-polish
  // noise), and drum + crate clusters stand on the yards at tested
  // spots. Pads carry no colliders — port traffic and missions keep
  // their yards driveable, exactly like the pilot's car park.
  function fillKarat(shared, stats) {
    var d = districtById('karat'), cells = districtCells(d), rng = SH.World.makeRng(8801);
    cells.forEach(function (c, ci) {
      var inset = 10.5;
      var x0 = c.x0 + inset, x1 = c.x1 - inset, z0 = c.z0 + inset, z1 = c.z1 - inset;
      if (x1 - x0 < 24 || z1 - z0 < 24) return;
      var gravel = ci % 2 === 0;
      var base = gravel ? 0x8d8578 : 0x97928a, alt = gravel ? 0x7c7466 : 0x86817a;
      // Drum + crate clusters FIRST, while the pads are not yet
      // registered zones (spotFree would reject spots inside them).
      for (var k = 0; k < 3; k++) {
        var sx = x0 + 6 + rng() * (x1 - x0 - 12), sz = z0 + 6 + rng() * (z1 - z0 - 12);
        if (!spotFree(sx, sz, 10.5, 2.2)) continue;
        stats.karatClusters++;
        var drumCols = [0xa84a30, 0x4f7ac9, 0x777d84, 0xc97a3a];
        for (var dr = 0; dr < 4; dr++) {
          part(shared.timber, new THREE.CylinderGeometry(0.34, 0.34, 0.95, 8), drumCols[(rng() * 4) | 0], sx + (dr % 2) * 0.85, 0.48, sz + ((dr / 2) | 0) * 0.85, 0, 0, 0);
        }
        box(shared.timber, 0xa8763e, sx + 2.2, 0.4, sz + 0.4, 1.1, 0.8, 1.1, rng() * 0.6);
        box(shared.timber, 0x7d5a38, sx + 2.3, 1.15, sz + 0.3, 0.95, 0.7, 0.95, rng() * 0.6);
      }
      var t = tilePads(shared, x0, z0, x1, z1, 0.008, function (x, z) {
        var n = 0.5 + 0.5 * Math.sin(x * 0.31 + z * 0.47) * Math.sin(x * 0.11 - z * 0.23);
        return lerpHex(base, alt, n * 0.7).getHex();
      }, 'plaza', gravel ? 'rgba(150,140,120,0.85)' : 'rgba(168,164,152,0.85)');
      stats.karatTiles += t.accepted; stats.karatTilesTested += t.tested;
      // Painted container-slot lines across the middle of the cell —
      // only where the yard tile underneath actually landed (a line
      // floating on plain grass reads as a glitch, measured in the
      // pw-karat proof).
      if (ci % 2 === 0) {
        var lineLen = Math.min(30, z1 - z0 - 10);
        for (var lx = x0 + 8; lx < x1 - 6; lx += 13) {
          if (!padFree(lx - 0.5, (z0 + z1) / 2 - lineLen / 2, lx + 0.5, (z0 + z1) / 2 + lineLen / 2, 8.6)) continue;
          box(shared.timber, 0xd8d3c8, lx, 0.03, (z0 + z1) / 2, 0.28, 0.03, lineLen);
        }
      }
    });
  }

  // --- Bukit Mawar: tended villa gardens ----------------------------
  // The villas already stand in CityData; what read as empty grass
  // between them becomes tended garden: a mow-striped lawn fan over
  // each cell interior, hedgerow segments along its edges (gaps fall
  // where villas/driveways sit), flower beds, park trees, and a pool
  // deck on some cells.
  function fillMawar(shared, stats) {
    var d = districtById('mawar'), cells = districtCells(d), rng = SH.World.makeRng(8802);
    cells.forEach(function (c, ci) {
      var inset = 11.5;
      var x0 = c.x0 + inset, x1 = c.x1 - inset, z0 = c.z0 + inset, z1 = c.z1 - inset;
      if (x1 - x0 < 30 || z1 - z0 < 30) return;
      // Furniture FIRST (tested against pre-fill zones), the lawn
      // tiles register afterwards — same ordering as Karat.
      // Hedgerows: 12 m segments along the north and south edges,
      // each segment tested — a villa or driveway in the way leaves
      // a natural gap instead of a hedge through a wall.
      [z0 + 1.2, z1 - 1.2].forEach(function (hz) {
        for (var hx = x0 + 6; hx < x1 - 5; hx += 12.6) {
          if (!spotFree(hx, hz, 10, 1.6)) continue;
          stats.mawarHedges++;
          box(shared.dress, 0x2f6b2f, hx, 0.3, hz, 12, 0.6, 0.9, 0);
        }
      });
      // Flower beds + park trees at tested spots.
      for (var fb = 0; fb < 2; fb++) {
        var bx = x0 + 12 + rng() * (x1 - x0 - 24), bz = z0 + 12 + rng() * (z1 - z0 - 24);
        if (spotFree(bx, bz, 10.5, 6)) { flowerBed(shared, bx, bz, 7 + rng() * 3, 3.4, rng() * 1.2, fb ? 0xff7a9e : 0xe2543e, 0xffd23f); stats.mawarBeds++; }
      }
      for (var tr = 0; tr < 3; tr++) {
        var tx = x0 + 8 + rng() * (x1 - x0 - 16), tz = z0 + 8 + rng() * (z1 - z0 - 16);
        if (spotFree(tx, tz, 10.5, 3.4)) { parkTree(shared.dress, tx, tz, 0.95 + rng() * 0.4); stats.mawarTrees++; }
      }
      // Pool deck on some cells: stone fan + water ellipse + chairs.
      if (rng() < 0.6) {
        var px = x0 + 16 + rng() * Math.max(1, (x1 - x0 - 36)), pz = z0 + 14 + rng() * Math.max(1, (z1 - z0 - 30));
        if (spotFree(px, pz, 10.5, 6)) {
          stats.mawarPools++;
          shared.dress.push(fanGeo(ellipsePts(px, pz, 10.5, 7, 0, 18), 0.012, 0xcfc0a4));
          shared.water.push(fanGeo(ellipsePts(px, pz, 8.2, 4.9, 0, 18), 0.03));
          parkReg({ rect: [px - 10.5, pz - 7, px + 10.5, pz + 7], kind: 'plaza' });
          for (var ch = 0; ch < 3; ch++) box(shared.timber, 0xf2ede2, px - 6 + ch * 2.2, 0.25, pz + 5.6, 0.7, 0.5, 1.6, 0.2);
        }
      }
      // Mow-striped lawn tiles over the cell interior. Stripes phase
      // on ABSOLUTE x so neighbouring tiles read as one lawn.
      var lawnZones = [];
      var t = tilePads(shared, x0, z0, x1, z1, 0.008, function (x, z) {
        var stripe = (Math.floor(x / 6) % 2 === 0) ? 0x57a84f : 0x4c9a45;
        var n = 0.5 + 0.5 * Math.sin(x * 0.23 + z * 0.31);
        return lerpHex(stripe, 0x5da24e, n * 0.35).getHex();
      }, 'garden', null, true, lawnZones);
      stats.mawarTiles += t.accepted; stats.mawarTilesTested += t.tested;
      lawnZones.forEach(function (z) { parkReg(z); });
    });
  }

  // --- Pantai Kencana: hotel terraces + beach furniture -------------
  // Hotel drums recorded in CityData get a stone terrace on their sea
  // side; the sand gets working beach furniture — timber decks,
  // volleyball courts, lifeguard towers — at tested spots along the
  // shore curve (the same coastZ every shore consumer reads).
  function fillKencana(shared, stats) {
    var d = districtById('kencana');
    // Hotel terraces were measured impossible: the beachfront drums
    // stand exactly 26 m north of the coast-road centreline with
    // radius 11-17 m, leaving ~3 m of clear ground — no terrace fits
    // without painting the carriageway. The district's real open
    // ground is the SAND, so the fill works there instead:
    // promenade deck segments seaward of the boardwalk, a beach
    // soccer pitch, more courts, and a beach-club cluster.
    // Promenade decks: 22 m timber platforms on the sand. The first
    // placement (boardwalk sea side) was measured impossible along
    // most of the front — the ring road's southern arc runs at
    // z 246-284, right through that line — so the decks sit further
    // out on the sand at coastZ-38 and padFree keeps the ones the
    // shore geometry actually allows.
    for (var bx = -470; bx <= 470; bx += 30) {
      if (bx > 38 && bx < 82) continue;                    // ferry pier
      if (bx > -52 && bx < 30) continue;                   // outflow delta
      if (bx > -436 && bx < -388) continue;                // lighthouse apron
      var bz = SH.World.coastZ(bx) - 38;
      if (!padFree(bx - 11, bz - 2.6, bx + 11, bz + 2.6, 8.6)) continue;
      stats.kencanaDecks2++;
      for (var pp2 = 0; pp2 < 6; pp2++) {
        part(shared.timber, new THREE.CylinderGeometry(0.1, 0.1, 0.7, 5), 0x6e5133, bx - 9 + (pp2 % 3) * 9, 0.08, bz - 2 + ((pp2 / 3) | 0) * 4, 0, 0, 0);
      }
      box(shared.timber, 0xa87c50, bx, 0.47, bz, 22, 0.14, 5.2);
      parkReg({ rect: [bx - 11, bz - 2.6, bx + 11, bz + 2.6], kind: 'plaza', color: 'rgba(216,186,138,0.9)' });
    }
    // Beach soccer pitch: paler groomed sand + two goal frames.
    var sx2 = -120, sz2 = SH.World.coastZ(-120) - 26;
    if (SH.World.isLand(sx2, sz2) && colliderClear(sx2, sz2, 12)) {
      stats.kencanaPitch++;
      shared.dress.push(fanGeo([[sx2 - 18, sz2 - 11], [sx2 + 18, sz2 - 11], [sx2 + 18, sz2 + 11], [sx2 - 18, sz2 + 11]], 0.012, 0xf0deb2));
      [-17, 17].forEach(function (gx) {
        part(shared.timber, new THREE.CylinderGeometry(0.07, 0.07, 2.4, 5), 0xf2ede2, sx2 + gx, 1.2, sz2 - 3.6, 0, 0, 0);
        part(shared.timber, new THREE.CylinderGeometry(0.07, 0.07, 2.4, 5), 0xf2ede2, sx2 + gx, 1.2, sz2 + 3.6, 0, 0, 0);
        part(shared.timber, new THREE.CylinderGeometry(0.07, 0.07, 7.3, 5), 0xf2ede2, sx2 + gx, 2.4, sz2, Math.PI / 2, 0, 0);
      });
      parkReg({ rect: [sx2 - 18, sz2 - 11, sx2 + 18, sz2 + 11], kind: 'plaza', color: 'rgba(240,222,178,0.9)' });
    }
    // Beach club cluster west of the delta: deck + umbrellas + loungers.
    var cx2 = -260, cz2 = SH.World.coastZ(-260) - 34;
    if (SH.World.isLand(cx2, cz2) && colliderClear(cx2, cz2, 10)) {
      stats.kencanaClub++;
      box(shared.timber, 0xa87c50, cx2, 0.4, cz2, 20, 0.16, 9);
      var clubCols = [0xff4fa3, 0x37e0ff, 0xffd23f, 0xff8c5a, 0x9fd8c0];
      for (var cu = 0; cu < 5; cu++) {
        var ux = cx2 - 8 + cu * 4, uz = cz2 + (cu % 2) * 3 - 1.5;
        part(shared.dress, new THREE.ConeGeometry(2.1, 1.0, 8), clubCols[cu], ux, 2.5, uz, 0, 0, 0);
        part(shared.timber, new THREE.CylinderGeometry(0.05, 0.05, 2.0, 5), 0x6e5133, ux, 1.45, uz, 0, 0, 0);
        box(shared.timber, 0xf2ede2, ux + 0.9, 0.62, uz, 0.6, 0.22, 1.7, 0.15);
      }
      parkReg({ rect: [cx2 - 10, cz2 - 4.5, cx2 + 10, cz2 + 4.5], kind: 'plaza', color: 'rgba(216,186,138,0.9)' });
    }
    // The boardwalk itself: a built timber promenade rendered by
    // roads.js along beachRoadZ+17 — register its band so the map
    // and the fill audit see the surface that is actually there
    // (same class as the pilot registering the running track).
    var bwN = [], bwS = [];
    for (var wx = -480; wx <= 480; wx += 40) {
      bwN.push([wx, SH.World.beachRoadZ(wx) + 14.4]);
      bwS.push([wx, SH.World.beachRoadZ(wx) + 19.6]);
    }
    parkReg({ poly: bwN.concat(bwS.reverse()), kind: 'plaza', color: 'rgba(196,164,116,0.9)' });
    stats.kencanaBoardwalk = 1;
    // Timber beach decks on the sand.
    var deckCols = [0xff4fa3, 0xffd23f, 0x37e0ff, 0xff8c5a, 0x9fd8c0];
    [-420, -250, 150, 320, 460].forEach(function (dx, di) {
      var dz = SH.World.coastZ(dx) - 30;
      if (!SH.World.isLand(dx, dz) || !colliderClear(dx, dz, 8)) return;
      stats.kencanaDecks++;
      for (var pp = 0; pp < 6; pp++) {
        part(shared.timber, new THREE.CylinderGeometry(0.11, 0.11, 0.8, 5), 0x6e5133, dx - 6 + (pp % 3) * 6, 0.1, dz - 2.6 + ((pp / 3) | 0) * 5.2, 0, 0, 0);
      }
      box(shared.timber, 0xa87c50, dx, 0.52, dz, 15, 0.18, 7);
      for (var um = 0; um < 3; um++) {
        part(shared.dress, new THREE.ConeGeometry(2.3, 1.1, 8), deckCols[(di + um) % deckCols.length], dx - 4.5 + um * 4.5, 2.6, dz, 0, 0, 0);
        part(shared.timber, new THREE.CylinderGeometry(0.05, 0.05, 2.1, 5), 0x6e5133, dx - 4.5 + um * 4.5, 1.55, dz, 0, 0, 0);
      }
      parkReg({ rect: [dx - 7.5, dz - 3.5, dx + 7.5, dz + 3.5], kind: 'plaza', color: 'rgba(216,186,138,0.9)' });
    });
    // Volleyball courts: paler sand + posts + net.
    [-320, 90, 380, -180, 200, -40].forEach(function (vx) {
      var vz = SH.World.coastZ(vx) - 20;
      if (!SH.World.isLand(vx, vz)) return;
      stats.kencanaCourts++;
      shared.dress.push(fanGeo([[vx - 8, vz - 4.5], [vx + 8, vz - 4.5], [vx + 8, vz + 4.5], [vx - 8, vz + 4.5]], 0.012, 0xeed9a8));
      part(shared.timber, new THREE.CylinderGeometry(0.06, 0.06, 2.4, 5), 0x6e5133, vx - 4.5, 1.2, vz, 0, 0, 0);
      part(shared.timber, new THREE.CylinderGeometry(0.06, 0.06, 2.4, 5), 0x6e5133, vx + 4.5, 1.2, vz, 0, 0, 0);
      box(shared.dress, 0x2c3136, vx, 1.75, vz, 9, 1.0, 0.05, 0);
      parkReg({ rect: [vx - 8, vz - 4.5, vx + 8, vz + 4.5], kind: 'plaza', color: 'rgba(238,217,168,0.9)' });
    });
    // Lifeguard towers: legs, platform, walled cabin, cone roof.
    [-460, -60, 260].forEach(function (lx) {
      var lz = SH.World.coastZ(lx) - 16;
      if (!SH.World.isLand(lx, lz) || !colliderClear(lx, lz, 2)) return;
      stats.kencanaTowers++;
      [[-0.95, -0.95], [0.95, -0.95], [-0.95, 0.95], [0.95, 0.95]].forEach(function (lp) {
        box(shared.timber, 0x7d5a38, lx + lp[0], 1.6, lz + lp[1], 0.18, 3.2, 0.18, 0);
      });
      box(shared.timber, 0xa87c50, lx, 3.3, lz, 2.7, 0.16, 2.7, 0);
      box(shared.timber, 0xf2ede2, lx, 4.15, lz + 1.05, 2.4, 1.5, 0.18, 0);
      box(shared.timber, 0xf2ede2, lx - 1.11, 4.15, lz, 0.18, 1.5, 2.3, 0);
      box(shared.timber, 0xf2ede2, lx + 1.11, 4.15, lz, 0.18, 1.5, 2.3, 0);
      part(shared.timber, new THREE.ConeGeometry(2.1, 1.0, 8), 0xd8402f, lx, 5.4, lz, 0, 0, 0);
      for (var rg = 0; rg < 4; rg++) box(shared.timber, 0x6e5133, lx - 0.5 + rg * 0.33, 0.8 + rg * 0.62, lz - 1.6, 0.08, 0.08, 1.1, 0);
      SH.World.colliders.push({ x: lx, z: lz, hx: 1.4, hz: 1.4 });
      parkReg({ rect: [lx - 2.2, lz - 2.2, lx + 2.2, lz + 2.2], kind: 'plaza', color: 'rgba(216,186,138,0.9)' });
    });
  }

  // POLISH2B (item 4): grass TUFTS — small crossed-plane blade
  // clusters instanced over the open ground, so grass reads as
  // vegetation with height, not a flat green blur. Placement is
  // measured, not scattered blind: a point is kept only where
  // groundHeightAt returns the raw grass level (-0.08 — every
  // road, walk, plaza and pad is a registered surface ABOVE it),
  // on land, clear of building footprints and colliders.
  function buildGrassTufts(scene) {
    var rng = SH.World.makeRng(9177);
    var pts = [];
    var cols = SH.World.colliders || [];
    for (var tries = 0; tries < 26000 && pts.length < 900; tries++) {
      var x = -580 + rng() * 1160, z = -580 + rng() * 1160;
      if (SH.World.isLand && !SH.World.isLand(x, z)) continue;
      var g = SH.World.groundHeightAt(x, z);
      if (Math.abs(g + 0.08) > 0.001) continue;
      if (!bldgClear(x, z, 0.7)) continue;
      var inCol = false;
      for (var ci = 0; ci < cols.length; ci++) {
        var c = cols[ci];
        if (Math.abs(x - c.x) < c.hx + 0.5 && Math.abs(z - c.z) < c.hz + 0.5) { inCol = true; break; }
      }
      if (inCol) continue;
      pts.push({ x: x, z: z, r: rng() * Math.PI, s: 0.8 + rng() * 0.55 });
    }
    if (pts.length < 40) return;
    var tc = document.createElement('canvas'); tc.width = 64; tc.height = 64;
    var tg = tc.getContext('2d');
    tg.clearRect(0, 0, 64, 64);
    for (var b = 0; b < 9; b++) {
      var bx = 10 + b * 5.5 + (rng() - 0.5) * 3, lean = (rng() - 0.5) * 16, h = 34 + rng() * 26;
      var grad = tg.createLinearGradient(0, 64, 0, 64 - h);
      grad.addColorStop(0, '#274d18'); grad.addColorStop(1, '#8fbc58');
      tg.strokeStyle = grad; tg.lineWidth = 3.2; tg.lineCap = 'round';
      tg.beginPath(); tg.moveTo(bx, 64); tg.quadraticCurveTo(bx + lean * 0.4, 64 - h * 0.6, bx + lean, 64 - h); tg.stroke();
    }
    var tex = new THREE.CanvasTexture(tc);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    var pGeo = new THREE.PlaneGeometry(0.36, 0.27); pGeo.translate(0, 0.135, 0);
    var merged = SH.World.mergeGeos([pGeo, pGeo.clone().rotateY(Math.PI / 2)]);
    var mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.42, side: THREE.DoubleSide });
    var im = new THREE.InstancedMesh(merged, mat, pts.length);
    var dum = new THREE.Object3D();
    var cA = new THREE.Color(0x9db877), cB = new THREE.Color(0x5d8140), cT = new THREE.Color();
    for (var i = 0; i < pts.length; i++) {
      dum.position.set(pts[i].x, -0.08, pts[i].z);
      dum.rotation.set(0, pts[i].r, 0);
      dum.scale.setScalar(pts[i].s);
      dum.updateMatrix();
      im.setMatrixAt(i, dum.matrix);
      im.setColorAt(i, cT.copy(cA).lerp(cB, rng()));
    }
    im.name = 'grass-tufts';
    scene.add(im);
    SH.LandmarksTuftCount = pts.length;
  }

  function buildDistrictFill(shared) {
    var stats = {
      karatTiles: 0, karatTilesTested: 0, karatClusters: 0,
      mawarTiles: 0, mawarTilesTested: 0, mawarHedges: 0, mawarBeds: 0, mawarTrees: 0, mawarPools: 0,
      kencanaTerraces: 0, kencanaDecks: 0, kencanaCourts: 0, kencanaTowers: 0, kencanaDecks2: 0, kencanaPitch: 0, kencanaClub: 0
    };
    fillKarat(shared, stats);
    fillMawar(shared, stats);
    fillKencana(shared, stats);
    SH.LandmarksFillStats = stats;
  }

  // ---------- Polish c2: parked map add-ons --------------------------
  // The outer land and the bay get the features the map comparison
  // parked in November: a farm patchwork on the northern arc, a
  // second small islet with a stone causeway west of the bay, and
  // working piers jutting from the Karat shore. The mainland shallow
  // gradient already exists (roads.js shore ribbon grades pale ->
  // deep along coastZ, and the map strokes a shallow band); here it
  // is extended around the new islet and under the new piers.
  function buildMapAddons(shared) {
    var stats = { fields: 0, piers: 0, islet: 0, barn: 0 };
    var rng = SH.World.makeRng(8803);
    // --- Farm patchwork: two arcs of field rects north of the ring,
    // each tested against the land ellipse and the graph (the ring
    // runs along z -460..-478 up there). Crop tones alternate per
    // field; rows are drawn as stripes so the patchwork reads from
    // the air and on the 2D map (zones carry their own colour).
    var tones = [
      { c: 0xd9b84a, a: 0xc7a53e, map: 'rgba(217,184,74,0.85)' },
      { c: 0x77b255, a: 0x68a347, map: 'rgba(119,178,85,0.85)' },
      { c: 0x9c7248, a: 0x8a623e, map: 'rgba(156,114,72,0.85)' },
      { c: 0x5f9e4d, a: 0x529442, map: 'rgba(95,158,77,0.85)' },
      { c: 0xc2a15a, a: 0xb08e4c, map: 'rgba(194,161,90,0.85)' }
    ];
    var fieldRows = [[-514, -490], [-494, -470]];
    var barnField = null;
    fieldRows.forEach(function (row, ri) {
      for (var fx = -560; fx < 560; fx += 62) {
        var fcx = fx + 28, fcz = (row[0] + row[1]) / 2;
        if (!SH.World.isLand(fcx, fcz)) continue;
        if (!padFree(fx, row[0], fx + 56, row[1], 10.5)) continue;
        var tone = tones[(stats.fields + ri) % tones.length];
        stats.fields++;
        if (!barnField && fcx > 0 && fcx < 130) barnField = { x: fcx, z: fcz };
        (function (tone2, x0, z0) {
          shared.dress.push(fanGeo([[x0, z0], [x0 + 56, z0], [x0 + 56, z0 + (row[1] - row[0])], [x0, z0 + (row[1] - row[0])]], 0.006, function (x, z) {
            var stripe = (Math.floor((z - z0) / 3) % 2 === 0) ? tone2.c : tone2.a;
            var n = 0.5 + 0.5 * Math.sin(x * 0.4 + z * 0.9);
            return lerpHex(stripe, tone2.c, n * 0.2).getHex();
          }));
        })(tone, fx, row[0]);
        parkReg({ rect: [fx, row[0], fx + 56, row[1]], kind: 'farm', color: tone.map });
      }
    });
    // One farmstead on an accepted field: barn + silo + hay bales.
    if (barnField) {
      stats.barn = 1;
      var bx2 = barnField.x - 14, bz2 = barnField.z;
      box(shared.timber, 0x9c4a34, bx2, 2.5, bz2, 11, 5, 7.5);
      box(shared.timber, 0x6e3427, bx2, 5.6, bz2, 12, 1.1, 4.6, 0);
      box(shared.timber, 0xf2ede2, bx2, 1.6, bz2 + 3.78, 3.2, 3.2, 0.1, 0);
      part(shared.timber, new THREE.CylinderGeometry(2.1, 2.1, 9.5, 10), 0xb9bec4, bx2 + 10, 4.75, bz2 - 1, 0, 0, 0);
      part(shared.timber, new THREE.CylinderGeometry(0.2, 2.2, 1.6, 10), 0x8f959b, bx2 + 10, 10.3, bz2 - 1, 0, 0, 0);
      for (var hb = 0; hb < 3; hb++) {
        part(shared.timber, new THREE.CylinderGeometry(0.75, 0.75, 1.1, 9), 0xd9b84a, bx2 + 3 + hb * 2.4, 0.75, bz2 + 6.5, Math.PI / 2, 0, rng() * 1.2);
      }
      SH.World.colliders.push({ x: bx2, z: bz2, hx: 5.5, hz: 3.8 });
      SH.World.colliders.push({ x: bx2 + 10, z: bz2 - 1, hx: 2.1, hz: 2.1 });
    }
    // --- Pulau Karang Kecil: shallow apron, sand rim, grass heart,
    // foam ring, stone causeway to the Kencana shore, a hut and a
    // small jetty. Mirrors the Pulau Seberang treatment (buildings.js
    // discs) in the merged landmark lists.
    var isl = SH.Config.island2;
    if (isl) {
      stats.islet = 1;
      shared.water.push(fanGeo(ellipsePts(isl.x, isl.z, isl.rx + 26, isl.rz + 20, 0, 22), -0.3, function (x, z) {
        var dd = Math.hypot((x - isl.x) / (isl.rx + 26), (z - isl.z) / (isl.rz + 20));
        return lerpHex(0x9fd4d8, 0x3f8fb5, Math.min(1, dd * 1.15)).getHex();
      }));
      shared.dress.push(fanGeo(ellipsePts(isl.x, isl.z, isl.rx + 10, isl.rz + 10, 0, 22), -0.02, function (x, z) {
        var n = 0.5 + 0.5 * Math.sin(x * 0.33 + z * 0.51);
        return lerpHex(0xe3c491, 0xd9ba7f, n * 0.5).getHex();
      }));
      shared.dress.push(fanGeo(ellipsePts(isl.x, isl.z, isl.rx - 11, isl.rz - 11, 0, 22), -0.01, function (x, z) {
        var n = 0.5 + 0.5 * Math.sin(x * 0.21 - z * 0.37);
        return lerpHex(0x55a34f, 0x4c9a45, n * 0.5).getHex();
      }));
      shared.water.push(ringGeo(ellipsePts(isl.x, isl.z, isl.rx + 11.5, isl.rz + 11.5, 0, 22), ellipsePts(isl.x, isl.z, isl.rx + 8.5, isl.rz + 8.5, 0, 22), 0.004, 0xf4f1e4));
      // Causeway: a stone ribbon from the shore to the islet's north
      // edge, bollards along both sides.
      var cwZ0 = SH.World.coastZ(isl.x) - 2, cwZ1 = isl.z - isl.rz + 4;
      shared.dress.push(stripGeo([[isl.x, cwZ0], [isl.x, cwZ1]], 10, 0.06, function (x, z) {
        var n = 0.5 + 0.5 * Math.sin(x * 0.8 + z * 0.35);
        return lerpHex(0xa89a80, 0x978a70, n * 0.6).getHex();
      }));
      for (var cb = 0; cb < 8; cb++) {
        var cbz = cwZ0 + 6 + cb * ((cwZ1 - cwZ0 - 12) / 7);
        box(shared.timber, 0x6e5133, isl.x - 5.4, 0.55, cbz, 0.32, 1.1, 0.32, 0);
        box(shared.timber, 0x6e5133, isl.x + 5.4, 0.55, cbz, 0.32, 1.1, 0.32, 0);
      }
      // Hut + palms + jetty.
      box(shared.timber, 0xa8763e, isl.x + 12, 1.4, isl.z + 8, 5.4, 2.8, 4.4, 0.3);
      part(shared.timber, new THREE.ConeGeometry(4.4, 1.8, 4), 0x7d5a38, isl.x + 12, 3.7, isl.z + 8, 0, 0.3 + Math.PI / 4, 0);
      SH.World.colliders.push({ x: isl.x + 12, z: isl.z + 8, hx: 2.9, hz: 2.5 });
      miniPalm(shared.timber, shared.dress, isl.x - 18, isl.z - 6, 1.0, 0.7);
      miniPalm(shared.timber, shared.dress, isl.x - 30, isl.z + 12, 0.9, 2.4);
      miniPalm(shared.timber, shared.dress, isl.x + 26, isl.z - 12, 1.05, 4.4);
      box(shared.timber, 0xa87c50, isl.x, 0.5, isl.z + isl.rz + 6, 7, 0.25, 10);
      for (var jp = 0; jp < 4; jp++) {
        part(shared.timber, new THREE.CylinderGeometry(0.11, 0.11, 1.3, 5), 0x6e5133, isl.x - 3 + (jp % 2) * 6, 0.0, isl.z + isl.rz + 2.5 + ((jp / 2) | 0) * 7, 0, 0, 0);
      }
    }
    // --- Karat piers: three working piers jutting south from the
    // port shore into the bay, over a pale shallow apron. Registered
    // in CityData.piers so the 2D map draws the same geometry.
    SH.CityData.piers = [];
    [380, 470, 555].forEach(function (px) {
      var pz0 = SH.World.coastZ(px) - 4, pz1 = pz0 + 30, pzc = (pz0 + pz1) / 2;
      shared.water.push(fanGeo([[px - 9, pz0 - 5], [px + 9, pz0 - 5], [px + 9, pz1 + 7], [px - 9, pz1 + 7]], -0.28, function (x, z) {
        var dd = Math.abs(x - px) / 9;
        return lerpHex(0x8fc8d4, 0x3f8fb5, Math.min(1, dd * 1.1)).getHex();
      }));
      box(shared.timber, 0x8a6f4d, px, 0.95, pzc, 8, 0.35, 34);
      for (var pp3 = 0; pp3 < 8; pp3++) {
        part(shared.timber, new THREE.CylinderGeometry(0.15, 0.15, 1.9, 6), 0x6e5133, px - 3.6 + (pp3 % 2) * 7.2, 0.05, pz0 + 2 + ((pp3 / 2) | 0) * 9.5, 0, 0, 0);
      }
      box(shared.timber, 0xa8763e, px - 1.8, 1.55, pz1 - 3, 1.6, 0.85, 1.6, 0.4);
      box(shared.timber, 0x4f7ac9, px + 1.6, 1.5, pz1 - 4.5, 1.4, 0.75, 1.4, -0.3);
      for (var bo = 0; bo < 4; bo++) {
        part(shared.timber, new THREE.CylinderGeometry(0.16, 0.2, 0.55, 6), 0x3c4147, px - 3.4 + (bo % 2) * 6.8, 1.4, pz0 + 5 + ((bo / 2) | 0) * 16, 0, 0, 0);
      }
      SH.CityData.piers.push({ x: px, z0: pz0, z1: pz1, w: 8 });
      stats.piers++;
    });
    SH.MapAddonStats = stats;
  }

  var Landmarks = {
    build: function (scene) {
      W = SH.World.waterData;
      mats = makeMats();
      var shared = { water: [], dress: [], timber: [], glow: [] };
      buildTaman(scene, shared);
      buildTamanPilot(shared);
      buildRuko(scene, shared);
      buildMercusuar(scene, shared);
      buildMenara(scene, shared);
      buildMonorel(scene, shared);
      buildDistrictFill(shared);
      buildMapAddons(shared);
      buildGrassTufts(scene);
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

    // Shot staging: freeze the train with its head at the sample
    // nearest to (x, z).
    monoAt: function (x, z) {
      if (!anim.mono) return;
      var mo = anim.mono, bi = 0, bd = 1e18;
      for (var i = 0; i < mo.n; i++) {
        var dx = mo.samples[i].x - x, dz = mo.samples[i].z - z, d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; bi = i; }
      }
      mo.debug = bi * mo.spacing;
    },

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
      if (anim.ring) anim.ring.color.setHSL((t * 0.025) % 1, 0.85, 0.6);
      if (anim.mono) {
        var mo = anim.mono;
        mo.head = mo.debug >= 0 ? mo.debug : (mo.head + dt * 11) % mo.total;
        for (var mci = 0; mci < 3; mci++) {
          var md = mo.head - mci * 12.3;
          while (md < 0) md += mo.total;
          var mf = md / mo.spacing, mf0 = Math.floor(mf);
          var mi0 = mf0 % mo.n, mi1 = (mi0 + 1) % mo.n, mfr = mf - mf0;
          var mp0 = mo.samples[mi0], mp1 = mo.samples[mi1];
          mo.cars[mci].position.set(mp0.x + (mp1.x - mp0.x) * mfr, 9.85, mp0.z + (mp1.z - mp0.z) * mfr);
          mo.cars[mci].rotation.y = Math.atan2(mp1.x - mp0.x, mp1.z - mp0.z);
        }
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
