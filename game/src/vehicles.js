// SELATARA HEAT — vehicles.js
// Vehicle factory (sedan/sport/truck/motorcycle/boat/police), arcade bicycle
// physics, enter/exit + carjacking, lights, damage with smoke and explosion.
// Public API: SH.Vehicles { buildPool(scene), list, nearestUsable(), updateInteractions(dt), updatePlayerVehicle(dt), damage(veh, amount) }.
(function (SH) {
  'use strict';

  // Shared glow texture + materials for headlight cones and lamp glows.
  var glowTex = null;
  function getGlowTex() {
    if (glowTex) return glowTex;
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g2 = c.getContext('2d');
    var grad = g2.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.4, 'rgba(255,255,255,0.4)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g2.fillStyle = grad; g2.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
    return glowTex;
  }
  // Spoked rim texture (Art Bible): one shared canvas — a silver disc
  // with five dark turbine slots and a centre cap. A plain hub disc is
  // the single biggest "toy car" tell; spokes that spin sell the wheel.
  // Scratch objects for the per-frame LOD pass (no per-frame allocation).
  var _lodScratchM = new THREE.Matrix4();
  var _lodScratchOne = new THREE.Vector3(1, 1, 1);
  var _lodScratchCol = new THREE.Color();
  var _lodScratchZero = new THREE.Matrix4().makeScale(0, 0, 0);

  // (The textured hub disc was retired in Rev 9 — rims are geometry
  // now: a lathe dish + a 5-spoke star prism, see getStarGeo/wheel.)
  // Rev 9 (cars v3): the rear light BAND texture — a horizontal
  // luminance gradient (dim edges, hot centre) multiplied by the tail
  // material colour, so one wide box reads as a continuous LED strip
  // with falloff instead of two flat red squares. Brake brightening
  // still works because setBrakeLights only changes material colour.
  var tailBandTex = null;
  function getTailBandTex() {
    if (tailBandTex) return tailBandTex;
    var c = document.createElement('canvas'); c.width = 128; c.height = 16;
    var g2 = c.getContext('2d');
    var hg = g2.createLinearGradient(0, 0, 128, 0);
    hg.addColorStop(0, '#595959'); hg.addColorStop(0.22, '#c9c9c9');
    hg.addColorStop(0.5, '#ffffff'); hg.addColorStop(0.78, '#c9c9c9');
    hg.addColorStop(1, '#595959');
    g2.fillStyle = hg; g2.fillRect(0, 0, 128, 16);
    g2.globalCompositeOperation = 'multiply';
    var vg = g2.createLinearGradient(0, 0, 0, 16);
    vg.addColorStop(0, '#8a8a8a'); vg.addColorStop(0.35, '#ffffff');
    vg.addColorStop(0.65, '#ffffff'); vg.addColorStop(1, '#8a8a8a');
    g2.fillStyle = vg; g2.fillRect(0, 0, 128, 16);
    tailBandTex = new THREE.CanvasTexture(c);
    tailBandTex.colorSpace = THREE.SRGBColorSpace;
    return tailBandTex;
  }
  // Rev 9: a real 5-spoke star prism for the rim face — geometry spokes
  // that catch light from a rear 3/4 chase view, replacing the flat
  // textured hub disc. The star plate's negative spaces read as the
  // gaps between spokes. Cached per radius.
  var starGeoCache = {};
  function getStarGeo(r) {
    var key = r.toFixed(3);
    if (starGeoCache[key]) return starGeoCache[key];
    var shape = new THREE.Shape();
    for (var k = 0; k < 10; k++) {
      var ang = (k / 10) * Math.PI * 2 + Math.PI / 2;
      var rad = (k % 2 === 0) ? r * 0.58 : r * 0.22;
      var px = Math.cos(ang) * rad, py = Math.sin(ang) * rad;
      if (k === 0) shape.moveTo(px, py); else shape.lineTo(px, py);
    }
    shape.closePath();
    var geo = new THREE.ExtrudeGeometry(shape, { depth: 0.028, bevelEnabled: false });
    geo.translate(0, 0, -0.014);
    geo.rotateY(Math.PI / 2); // extrusion axis -> +X (the wheel axle)
    starGeoCache[key] = geo;
    return geo;
  }
  var coneMatShared = null, headGlowMatShared = null;
  function getConeMat() {
    if (!coneMatShared) coneMatShared = new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    return coneMatShared;
  }
  // Contact shadow: one shared radial-gradient blob texture + material,
  // stamped under every land vehicle so it sits ON the road instead of
  // floating over it (the real shadow map alone is too soft at noon).
  var blobMatShared = null;
  function getBlobMat() {
    if (blobMatShared) return blobMatShared;
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g2 = c.getContext('2d');
    var grad = g2.createRadialGradient(32, 32, 4, 32, 32, 31);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)'); grad.addColorStop(0.7, 'rgba(0,0,0,0.45)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g2.fillStyle = grad; g2.fillRect(0, 0, 64, 64);
    blobMatShared = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.4, depthWrite: false });
    return blobMatShared;
  }
  function getHeadGlowMat() {
    if (!headGlowMatShared) headGlowMatShared = new THREE.SpriteMaterial({ map: getGlowTex(), color: 0xffe9b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    return headGlowMatShared;
  }

  function buildMesh(type, colorHex) {
    var spec = SH.Config.vehicleTypes[type];
    var g = new THREE.Group();
    // Step 5 polish: real metallic paint (clearcoat physical material
    // fed by the procedural sky env), deep glass, true chrome. The far
    // LOD keeps its cheap Phong shell — only near cars pay for this.
    var paint = new THREE.MeshPhysicalMaterial({ color: colorHex, metalness: 0.72, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.28, envMapIntensity: 0.9, flatShading: true });
    var dark = new THREE.MeshLambertMaterial({ color: 0x14151a, flatShading: true });
    var tireMat = new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0, roughness: 0.94 });
    var glass = new THREE.MeshStandardMaterial({ color: 0x18242f, metalness: 0.9, roughness: 0.07, transparent: true, opacity: 0.74, envMapIntensity: 1.3, flatShading: true });
    var chromeMat = new THREE.MeshStandardMaterial({ color: 0xd6dde6, metalness: 1.0, roughness: 0.16, envMapIntensity: 1.3, flatShading: true });
    var L = spec.length, W = spec.width, H = spec.height;
    var wheels = [];

    // Parts tagged with a mergeKey are fused into one mesh per material
    // family at the end of the build (draw-call budget, Art Bible v2).
    function box(w, h, d, mat, x, y, z, key) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z); m.castShadow = true;
      if (key) m.userData.mergeKey = key;
      g.add(m); return m;
    }
    // Rev 9 wheel: a LATHE profile (tread band, curved sidewalls, a
    // recessed rim dish) instead of a plain cylinder, a metal rim
    // barrel inside the dish, and a geometric 5-spoke star on the outer
    // face. The whole wheel is one spinning group; the star sits on the
    // outboard side only (both sides on the centred motor wheels).
    var rimBarrelMat = new THREE.MeshStandardMaterial({ color: 0xb9c1c9, metalness: 1.0, roughness: 0.25, envMapIntensity: 1.25, flatShading: true });
    // The spoke star + lip ring get a brighter metal: at chase distance
    // the rim is the brightest part of a real wheel, and a near-white
    // ring is what keeps the wheel from reading as a black hole.
    var rimFaceMat = new THREE.MeshStandardMaterial({ color: 0xd7dde3, metalness: 0.9, roughness: 0.2, envMapIntensity: 1.4, flatShading: true, side: THREE.DoubleSide });
    function wheel(x, z, r, width) {
      var wWidth = width || 0.3;
      var grp = new THREE.Group();
      grp.position.set(x, r, z);
      var prof = [
        [0.03, -0.50], [0.34, -0.50], [0.58, -0.36], [1.00, -0.10],
        [1.00, 0.10], [0.93, 0.31], [0.60, 0.44], [0.30, 0.32], [0.03, 0.36]
      ];
      var pts = [];
      for (var pi = 0; pi < prof.length; pi++) pts.push(new THREE.Vector2(Math.max(0.02, prof[pi][0] * r), prof[pi][1] * wWidth));
      var tireGeo = new THREE.LatheGeometry(pts, 10);
      tireGeo.rotateZ(-Math.PI / 2); // lathe axis Y -> wheel axle X, dish facing +X
      var tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      grp.add(tire);
      var barrelGeo = new THREE.CylinderGeometry(r * 0.58, r * 0.58, wWidth * 0.66, 10, 1, true);
      barrelGeo.rotateZ(Math.PI / 2);
      var barrel = new THREE.Mesh(barrelGeo, rimBarrelMat);
      grp.add(barrel);
      var sides = (x === 0) ? [-1, 1] : [Math.sign(x)];
      for (var si = 0; si < sides.length; si++) {
        var star = new THREE.Mesh(getStarGeo(r), rimFaceMat);
        star.position.x = sides[si] * wWidth * 0.355;
        if (sides[si] < 0) star.rotation.y = Math.PI;
        grp.add(star);
        var lipGeo = new THREE.RingGeometry(r * 0.50, r * 0.615, 12);
        lipGeo.rotateY(sides[si] > 0 ? Math.PI / 2 : -Math.PI / 2);
        var lip = new THREE.Mesh(lipGeo, rimFaceMat);
        lip.position.x = sides[si] * wWidth * 0.37;
        grp.add(lip);
      }
      g.add(grp); wheels.push(grp);
      return grp;
    }

    var headMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
    var tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, map: getTailBandTex() });
    var brakeMat = new THREE.MeshBasicMaterial({ color: 0xff6060 });

    // ---- Art Pass 2: car bodies are EXTRUDED SIDE PROFILES, not stacked
    // boxes. One silhouette carries hood slope, beltline and trunk; a
    // narrower glasshouse extrusion sits on top with a paint roof panel,
    // so from any screenshot distance the car reads as a shaped body.
    // Points are [z as a fraction of length, height in metres].
    // (The v2 SEDAN_BELT / SPORT_BELT / TRUCK_CAB extrusion tables were
    // retired by the Rev 9 lofts below; profileMesh survives only as
    // the motorcycle spine builder.)
    function profileMesh(pts, width, mat, lenScale) {
      var shape = new THREE.Shape();
      for (var i = 0; i < pts.length; i++) {
        var px = pts[i][0] * lenScale, py = pts[i][1];
        if (i === 0) shape.moveTo(px, py); else shape.lineTo(px, py);
      }
      shape.lineTo(pts[0][0] * lenScale, pts[0][1]);
      // Art Bible v2: a real bevel (0.07 thick, 2 segments) rounds every
      // silhouette edge, so bodies catch a highlight line instead of
      // ending in a hard 90° cut — one un-bevelled extrusion reads toy.
      var geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.055, bevelSegments: 2 });
      geo.rotateY(-Math.PI / 2); // shape X (forward) -> world +Z, extrusion -> width
      geo.translate(width / 2, 0, 0);
      var m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      g.add(m);
      return m;
    }

    // ---- Rev 9 (cars v3): LOFTED SHELLS --------------------------------
    // The v2 bodies were straight side-profile extrusions: constant
    // width along the whole length, so every car read as a slab-sided
    // block with a bevel. A loft sweeps an 8-point cross-section
    // (rocker -> belt -> shoulder -> cambered roof) through stations
    // along the length, each station with its own half-width and deck
    // height: the nose can taper narrower than the cabin, the rear
    // shoulders can swell over the back wheels, and the roof is a
    // continuous arc instead of a flat lid. One builder serves body,
    // glasshouse, roof skin (topBand), truck cab/cargo and boat hull.
    // Station: {z, hw (half width at belt), yB (floor), yM (belt
    // height), hwT (half width at top edge), yT (top centre height),
    // cam (roof camber: top edge sits cam below the centre)}.
    function loftMesh(stations, mat, opts) {
      opts = opts || {};
      function ringOf(s) {
        return [
          [0, s.yB], [s.hw * 0.90, s.yB + 0.03], [s.hw, s.yM], [s.hwT, s.yT - s.cam],
          [0, s.yT], [-s.hwT, s.yT - s.cam], [-s.hw, s.yM], [-s.hw * 0.90, s.yB + 0.03]
        ];
      }
      var rings = [];
      for (var i = 0; i < stations.length; i++) rings.push(ringOf(stations[i]));
      var pos = [];
      function tri(a, b, c) { pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
      function P(ring, j, z) { return [ring[j][0], ring[j][1], z]; }
      var edges = opts.edges || [0, 1, 2, 3, 4, 5, 6, 7];
      for (var si = 0; si < stations.length - 1; si++) {
        var zA = stations[si].z, zB = stations[si + 1].z;
        for (var ei = 0; ei < edges.length; ei++) {
          var j = edges[ei], jn = (j + 1) % 8;
          var a = P(rings[si], j, zA), b = P(rings[si], jn, zA), c = P(rings[si + 1], jn, zB), d = P(rings[si + 1], j, zB);
          tri(a, b, c); tri(a, c, d);
        }
      }
      if (!opts.edges) {
        // End caps: fans around each end ring's centroid.
        var s0 = stations[0], sN = stations[stations.length - 1];
        var c0 = [0, (s0.yB + s0.yT) / 2, s0.z], cN = [0, (sN.yB + sN.yT) / 2, sN.z];
        for (var cj = 0; cj < 8; cj++) {
          var cn = (cj + 1) % 8;
          tri(c0, P(rings[0], cn, s0.z), P(rings[0], cj, s0.z));
          tri(cN, P(rings[rings.length - 1], cj, sN.z), P(rings[rings.length - 1], cn, sN.z));
        }
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2)); // merge-compatible
      geo.computeVertexNormals(); // non-indexed -> flat facets
      var mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    }
    // Fraction tables -> absolute stations for a given spec L/W.
    function loftStations(table, LL, WW) {
      var out = [];
      for (var i = 0; i < table.length; i++) {
        var t = table[i];
        out.push({ z: t[0] * LL, hw: t[1] * WW, yB: t[2], yM: t[3], hwT: t[4] * WW, yT: t[5], cam: t[6] });
      }
      return out;
    }
    // Sedan body: nose 0.385W vs cabin 0.489W (bold plan taper), rear
    // shoulder swells at the back wheel, deck heights from the v2 belt.
    var SEDAN_BODY = [
      [-0.500, 0.440, 0.37, 0.62, 0.407, 0.92, 0.10], [-0.466, 0.473, 0.27, 0.66, 0.440, 0.97, 0.10],
      [-0.305, 0.486, 0.26, 0.70, 0.456, 1.00, 0.09], [-0.136, 0.489, 0.26, 0.72, 0.462, 1.03, 0.09],
      [0.068, 0.486, 0.26, 0.72, 0.456, 1.02, 0.09], [0.305, 0.473, 0.26, 0.68, 0.429, 0.95, 0.10],
      [0.443, 0.429, 0.27, 0.62, 0.374, 0.86, 0.11], [0.500, 0.385, 0.30, 0.58, 0.330, 0.80, 0.12]
    ];
    var SEDAN_GLASS = [
      [-0.364, 0.319, 0.96, 1.04, 0.275, 1.14, 0.05], [-0.273, 0.360, 0.98, 1.20, 0.316, 1.365, 0.07],
      [-0.080, 0.371, 0.99, 1.23, 0.327, 1.415, 0.075], [0.114, 0.365, 0.99, 1.22, 0.321, 1.40, 0.07],
      [0.227, 0.346, 0.98, 1.15, 0.286, 1.30, 0.06], [0.323, 0.302, 0.96, 1.04, 0.236, 1.09, 0.05]
    ];
    var SPORT_BODY = [
      [-0.500, 0.436, 0.35, 0.56, 0.404, 0.80, 0.09], [-0.453, 0.471, 0.25, 0.60, 0.441, 0.86, 0.09],
      [-0.305, 0.487, 0.24, 0.64, 0.457, 0.885, 0.08], [-0.116, 0.479, 0.24, 0.65, 0.452, 0.90, 0.08],
      [0.093, 0.471, 0.24, 0.64, 0.441, 0.885, 0.08], [0.305, 0.460, 0.24, 0.60, 0.420, 0.83, 0.09],
      [0.442, 0.415, 0.25, 0.54, 0.362, 0.74, 0.10], [0.500, 0.372, 0.28, 0.50, 0.319, 0.68, 0.11]
    ];
    var SPORT_GLASS = [
      [-0.337, 0.319, 0.84, 0.92, 0.277, 0.99, 0.05], [-0.244, 0.362, 0.86, 1.02, 0.319, 1.125, 0.065],
      [-0.070, 0.372, 0.87, 1.05, 0.327, 1.15, 0.07], [0.105, 0.367, 0.87, 1.04, 0.322, 1.135, 0.065],
      [0.209, 0.346, 0.86, 0.99, 0.287, 1.06, 0.055], [0.302, 0.303, 0.84, 0.92, 0.239, 0.94, 0.05]
    ];

    if (type === 'motor') {
      // Art Pass 3 rebuild: a slim extruded spine, a rounded tank, twin
      // fork legs, bars and a visible rider (posed seated by the figure
      // builder) who only appears while the bike is actually ridden.
      // Rev 9: slimmer spine — the bottom edge kicks UP between the
      // wheels so the wheels read as wheels, not as bumps under a slab.
      var MOTOR_BELT = [[-0.50, 0.36], [-0.50, 0.56], [-0.32, 0.63], [-0.08, 0.60], [0.14, 0.65], [0.34, 0.57], [0.50, 0.47], [0.50, 0.38]];
      profileMesh(MOTOR_BELT, 0.16, paint, L).userData.mergeKey = 'paint';
      var tankM = new THREE.Mesh(new THREE.SphereGeometry(0.145, 10, 8), paint);
      tankM.scale.set(0.85, 0.55, 1.6); tankM.position.set(0, 0.68, 0.10); tankM.castShadow = true; tankM.userData.mergeKey = 'paint'; g.add(tankM);
      box(0.30, 0.28, 0.52, dark, 0, 0.38, 0.02, 'dark');                       // engine block
      box(0.26, 0.07, 0.62, dark, 0, 0.645, -0.34, 'dark');                     // seat
      box(0.20, 0.08, 0.30, paint, 0, 0.63, -0.82, 'paint');                     // tail cowl
      var forkL = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.88, 6), dark);
      forkL.position.set(-0.055, 0.56, 0.84); forkL.rotation.x = 0.38; forkL.castShadow = true; forkL.userData.mergeKey = 'dark'; g.add(forkL);
      var forkR = forkL.clone(); forkR.position.x = 0.055; g.add(forkR);
      var bars = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.52, 6), dark);
      bars.rotation.z = Math.PI / 2; bars.position.set(0, 0.99, 0.58); bars.userData.mergeKey = 'dark'; g.add(bars);
      var screen = box(0.34, 0.22, 0.03, glass, 0, 1.02, 0.64); screen.rotation.x = -0.35; // windscreen
      var exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.046, 0.72, 8), chromeMat);
      exhaust.rotation.x = Math.PI / 2; exhaust.position.set(0.15, 0.30, -0.32); exhaust.userData.mergeKey = 'chrome'; g.add(exhaust);
      wheel(0, 0.80, 0.34, 0.12); wheel(0, -0.80, 0.34, 0.12);
      // Rev 9: curved fender shells hugging both wheels (open cylinder
      // arcs centred over the tyre) — the bike stops reading as two
      // bare discs bolted to a spine.
      var fenderMat = new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.6, roughness: 0.35, flatShading: true, side: THREE.DoubleSide });
      var fenGeoF = new THREE.CylinderGeometry(0.375, 0.375, 0.15, 10, 1, true, Math.PI / 2 - 0.62, 1.24);
      fenGeoF.rotateZ(Math.PI / 2);
      var fenF = new THREE.Mesh(fenGeoF, fenderMat); fenF.position.set(0, 0.34, 0.80); g.add(fenF);
      var fenGeoR = new THREE.CylinderGeometry(0.375, 0.375, 0.14, 10, 1, true, Math.PI / 2 - 0.5, 1.0);
      fenGeoR.rotateZ(Math.PI / 2);
      var fenR = new THREE.Mesh(fenGeoR, fenderMat); fenR.position.set(0, 0.34, -0.80); g.add(fenR);
      // Rider: a full figure from the shared builder, posed on the bike
      // (thighs forward, arms reaching the bars, slight forward lean).
      var rider = SH.Pedestrians.buildFigure({
        skin: 0xa8763e, shirt: 0x2c3444, pants: 0x22242c,
        hairStyle: 'hat', hatColor: 0xd8402e, sleeves: 'long', face: 1
      });
      rider.applySeated(); // rig pose: thighs forward, knees to the pegs, hands to the bars
      rider.group.position.set(0, -0.22, -0.05);
      rider.group.rotation.x = 0.15;
      rider.group.visible = false;
      g.add(rider.group);
      g.userData.rider = rider.group;
    } else if (type === 'truck') {
      // Rev 9: the cab is a LOFT too (tapered nose, cambered cab roof,
      // windshield raked through the stations) and the cargo box became
      // a soft-tapered loft with rub rails and a centre door seam — the
      // truck keeps its boxy job but loses the toy-crate read.
      var cabLoft = loftMesh([
        { z: 1.00, hw: 1.02, yB: 0.30, yM: 0.62, hwT: 0.94, yT: 1.06, cam: 0.08 },
        { z: 0.72, hw: 1.12, yB: 0.28, yM: 0.82, hwT: 1.04, yT: 1.64, cam: 0.07 },
        { z: 0.32, hw: 1.14, yB: 0.28, yM: 0.95, hwT: 1.06, yT: 2.14, cam: 0.06 },
        { z: -0.60, hw: 1.14, yB: 0.28, yM: 1.00, hwT: 1.07, yT: 2.18, cam: 0.06 },
        { z: -1.00, hw: 1.10, yB: 0.30, yM: 1.00, hwT: 1.03, yT: 2.16, cam: 0.06 }
      ], paint);
      cabLoft.position.z = L * 0.5 - 1.0;
      cabLoft.userData.mergeKey = 'paint';
      var cabGlass = box(W * 0.78, 0.98, 0.05, glass, 0, 1.88, L * 0.5 - 0.48);
      cabGlass.rotation.x = -0.675;                              // laid onto the windshield slope
      box(0.04, 0.52, 0.85, glass, -1.13, 1.86, L * 0.5 - 0.85);   // side glass
      box(0.04, 0.52, 0.85, glass, 1.13, 1.86, L * 0.5 - 0.85);
      box(W * 0.70, 0.34, 0.05, dark, 0, 0.62, L / 2 + 0.02, 'dark');        // grille
      box(W * 0.66, 0.03, 0.02, chromeMat, 0, 0.62, L / 2 + 0.05, 'chrome'); // grille slat
      box(W * 1.0, 0.3, 0.22, dark, 0, 0.32, L * 0.47, 'dark');              // front bumper
      box(0.16, 0.03, 0.03, dark, -1.20, 1.98, L * 0.36, 'dark');            // mirror stalks + heads
      box(0.16, 0.03, 0.03, dark, 1.20, 1.98, L * 0.36, 'dark');
      box(0.05, 0.20, 0.12, dark, -1.29, 1.94, L * 0.36, 'dark');
      box(0.05, 0.20, 0.12, dark, 1.29, 1.94, L * 0.36, 'dark');
      var tankGeo = new THREE.CylinderGeometry(0.19, 0.19, 1.5, 10); tankGeo.rotateX(Math.PI / 2);
      var tankL = new THREE.Mesh(tankGeo, chromeMat); tankL.position.set(-0.95, 0.52, 0.9); tankL.userData.mergeKey = 'chrome'; g.add(tankL);
      var tankR = new THREE.Mesh(tankGeo, chromeMat); tankR.position.set(0.95, 0.52, 0.9); tankR.userData.mergeKey = 'chrome'; g.add(tankR);
      box(1.6, 0.3, 5.6, dark, 0, 0.42, -0.6, 'dark');                       // chassis rail
      var cargoMat = new THREE.MeshLambertMaterial({ color: 0xd8d3c8, flatShading: true });
      loftMesh([
        { z: -3.57, hw: 1.16, yB: 0.55, yM: 1.55, hwT: 1.10, yT: 2.90, cam: 0.05 },
        { z: -3.30, hw: 1.24, yB: 0.55, yM: 1.60, hwT: 1.18, yT: 2.95, cam: 0.05 },
        { z: 0.50, hw: 1.24, yB: 0.55, yM: 1.60, hwT: 1.18, yT: 2.95, cam: 0.05 },
        { z: 0.83, hw: 1.20, yB: 0.55, yM: 1.58, hwT: 1.13, yT: 2.92, cam: 0.05 }
      ], cargoMat);
      box(0.03, 0.06, 4.2, dark, -1.245, 1.1, -1.37, 'dark');                // rub rails
      box(0.03, 0.06, 4.2, dark, 1.245, 1.1, -1.37, 'dark');
      box(0.03, 0.06, 4.2, dark, -1.245, 2.2, -1.37, 'dark');
      box(0.03, 0.06, 4.2, dark, 1.245, 2.2, -1.37, 'dark');
      box(0.04, 2.3, 0.02, dark, 0, 1.72, -3.58, 'dark');                    // rear door seam
      box(0.4, 0.3, 0.04, dark, -1.04, 0.35, -L * 0.32 - 0.55, 'dark');      // mudflaps
      box(0.4, 0.3, 0.04, dark, 1.04, 0.35, -L * 0.32 - 0.55, 'dark');
      wheel(-1.04, L * 0.3, 0.5, 0.38); wheel(1.04, L * 0.3, 0.5, 0.38);
      wheel(-1.04, -L * 0.32, 0.5, 0.38); wheel(1.04, -L * 0.32, 0.5, 0.38);
    } else if (type === 'boat') {
      // Rev 9: lofted hull — a shallow V at the keel, flared topsides
      // and a bow that tapers to a near-point with a rising sheer,
      // replacing the box + rotated-box bow.
      var hull = loftMesh([
        { z: -3.20, hw: 1.02, yB: 0.16, yM: 0.66, hwT: 0.98, yT: 0.86, cam: 0.03 },
        { z: -1.50, hw: 1.13, yB: 0.12, yM: 0.68, hwT: 1.08, yT: 0.85, cam: 0.03 },
        { z: 0.80, hw: 1.10, yB: 0.12, yM: 0.68, hwT: 1.05, yT: 0.87, cam: 0.03 },
        { z: 2.20, hw: 0.80, yB: 0.20, yM: 0.70, hwT: 0.76, yT: 0.92, cam: 0.03 },
        { z: 3.00, hw: 0.36, yB: 0.32, yM: 0.74, hwT: 0.33, yT: 0.96, cam: 0.02 },
        { z: 3.20, hw: 0.05, yB: 0.42, yM: 0.78, hwT: 0.04, yT: 0.98, cam: 0.01 }
      ], paint);
      hull.userData.mergeKey = 'paint';
      box(W * 0.70, 0.06, L * 0.5, dark, 0, 0.84, -L * 0.10, 'dark');       // cockpit floor
      box(W * 0.62, 0.42, 0.08, glass, 0, 1.04, L * 0.14);         // windscreen
      box(W * 0.5, 0.34, L * 0.3, dark, 0, 0.80, -L * 0.18, 'dark');       // bench seat
      box(0.5, 0.62, 0.3, dark, 0, 0.62, -L * 0.52, 'dark');               // outboard motor
    } else {
      // Cars (sedan / sport / taxi / police): extruded beltline shell +
      // a SEPARATE narrower glasshouse extrusion (Art Bible v2: the
      // ~0.09 m inset per side is the tumblehome — one full-width
      // extrusion reads as a toy).
      var isSport = type === 'sport';
      // Rev 9: LOFTED body + glasshouse (see loftMesh). The glass band
      // wraps continuously — windshield and rear glass are the loft's
      // sloped top facets — and a thin roof skin rides 18 mm proud of
      // the glass crown, leaving body-colour (sedan) or gloss-black
      // (sport) pillars as the only breaks in the band.
      var bodyLoft = loftMesh(loftStations(isSport ? SPORT_BODY : SEDAN_BODY, L, W), paint);
      bodyLoft.userData.mergeKey = 'paint';
      var glassSt = loftStations(isSport ? SPORT_GLASS : SEDAN_GLASS, L, W);
      loftMesh(glassSt, glass);
      var roofSt = [];
      for (var ri = 1; ri <= 3; ri++) {
        var rs = glassSt[ri];
        roofSt.push({ z: rs.z, hw: rs.hw * 1.01, yB: rs.yB, yM: rs.yM + 0.01, hwT: rs.hwT * 1.06, yT: rs.yT + 0.018, cam: rs.cam });
      }
      var roofSkin;
      if (isSport) {
        var roofBlackMat = new THREE.MeshStandardMaterial({ color: 0x0b0c0f, metalness: 0.7, roughness: 0.24, envMapIntensity: 1.1, flatShading: true });
        roofSkin = loftMesh(roofSt, roofBlackMat, { edges: [3, 4] });
      } else {
        roofSkin = loftMesh(roofSt, paint, { edges: [3, 4] });
        roofSkin.userData.mergeKey = 'paint';
      }
      // Pillars: thin strips laid along the glass slopes (A/C in body
      // colour, B in black) so the band reads as framed glass, not a
      // glass box dropped onto the body.
      var pilY = isSport ? 1.0 : 1.19;
      for (var pd = -1; pd <= 1; pd += 2) {
        var pilA = box(0.05, 0.5, 0.07, paint, pd * W * 0.30, pilY, L * 0.27, 'paint');
        pilA.rotation.x = isSport ? -1.05 : -1.13;
        var pilC = box(0.06, 0.5, 0.09, paint, pd * W * 0.30, pilY, -L * 0.315, 'paint');
        pilC.rotation.x = 1.10;
        box(0.04, 0.36, 0.05, dark, pd * W * 0.368, isSport ? 1.02 : 1.21, -L * 0.01, 'dark');
      }
      // Panel details (Art Bible): split grille with slats, thin door
      // seams + handles, wheel-arch shadow discs with a paint fender
      // flare over each, a rear plate and an exhaust — the ~15% black
      // trim/void that separates a styled car from a coloured wedge.
      // Every static piece is merge-tagged into its material family.
      box(W * 0.54, 0.18, 0.05, dark, 0, 0.56, L / 2 + 0.045, 'dark');         // grille frame
      box(W * 0.50, 0.025, 0.02, chromeMat, 0, 0.515, L / 2 + 0.075, 'chrome'); // grille slats
      box(W * 0.50, 0.025, 0.02, chromeMat, 0, 0.60, L / 2 + 0.075, 'chrome');
      box(0.07, 0.18, 0.055, paint, 0, 0.56, L / 2 + 0.05, 'paint');           // grille centre bar
      box(W * 0.62, 0.09, 0.04, dark, 0, 0.20, L / 2 + 0.06, 'dark');          // lower intake
      var seamMat = new THREE.MeshLambertMaterial({ color: 0x0d0e12, flatShading: true });
      var archMat = new THREE.MeshLambertMaterial({ color: 0x0a0b0f, side: THREE.DoubleSide });
      var wr = isSport ? 0.34 : 0.33; // wheel radius: O 0.66-0.68 m (bible)
      var sideX = W * 0.489 + 0.015;   // just proud of the lofted flank (Rev 9)
      for (var sd = -1; sd <= 1; sd += 2) {
        box(0.02, 0.42, 0.03, seamMat, sd * sideX, 0.64, L * 0.10, 'dark');
        box(0.02, 0.42, 0.03, seamMat, sd * sideX, 0.64, -L * 0.17, 'dark');
        box(0.02, 0.035, 0.15, seamMat, sd * sideX, 0.88, L * 0.05, 'dark');   // door handles
        box(0.02, 0.035, 0.15, seamMat, sd * sideX, 0.88, -L * 0.21, 'dark');
        for (var wz = -1; wz <= 1; wz += 2) {
          var arch = new THREE.Mesh(new THREE.CircleGeometry(wr * 1.24, 8), archMat);
          arch.position.set(sd * sideX, wr * 0.96, wz * L * 0.305);
          arch.rotation.y = sd * Math.PI / 2;
          arch.userData.mergeKey = 'dark';
          g.add(arch);
          var flare = new THREE.Mesh(new THREE.TorusGeometry(wr * 1.17, 0.048, 5, 7, Math.PI), paint);
          flare.position.set(sd * (W * 0.489 + 0.005), wr * 0.96, wz * L * 0.305);
          flare.rotation.y = Math.PI / 2;
          flare.castShadow = true;
          flare.userData.mergeKey = 'paint';
          g.add(flare);
        }
      }
      var plateMat = new THREE.MeshLambertMaterial({ color: 0xe8e6da, flatShading: true });
      box(0.36, 0.11, 0.015, plateMat, 0, 0.52, -L / 2 - 0.03);               // rear plate (on the lofted tail face)
      // Rev 9: DUAL exhausts, one per side, tucked under the rear bumper.
      for (var ex = -1; ex <= 1; ex += 2) {
        var exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.038, 0.16, 8), chromeMat);
        exhaust.rotation.x = Math.PI / 2;
        exhaust.position.set(ex * W * 0.27, 0.21, -L / 2 - 0.06);
        exhaust.userData.mergeKey = 'chrome';
        g.add(exhaust);
      }
      box(W * 0.66, 0.018, 0.02, seamMat, 0, isSport ? 0.78 : 0.90, -L * 0.345, 'dark'); // trunk seam line
      var roofY = isSport ? 1.17 : 1.44;   // glass crown + roof skin (Rev 9)
      box(W * 1.01, 0.24, 0.28, dark, 0, 0.3, L / 2 + 0.05, 'dark');       // front bumper
      box(W * 1.01, 0.24, 0.28, dark, 0, 0.3, -L / 2 - 0.05, 'dark');      // rear bumper
      // Rev 9: dark side skirts / lower cladding on EVERY car (the
      // two-tone break at the rocker line) + mirrors on thin stalks.
      box(0.07, 0.15, L * 0.52, dark, -(W * 0.489 - 0.015), 0.235, 0, 'dark');
      box(0.07, 0.15, L * 0.52, dark, W * 0.489 - 0.015, 0.235, 0, 'dark');
      box(0.11, 0.022, 0.03, dark, -(W * 0.489 + 0.045), 1.03, L * 0.16, 'dark');  // mirror stalks
      box(0.11, 0.022, 0.03, dark, W * 0.489 + 0.045, 1.03, L * 0.16, 'dark');
      box(0.035, 0.075, 0.17, dark, -(W * 0.489 + 0.105), 1.05, L * 0.16, 'dark'); // mirror heads
      box(0.035, 0.075, 0.17, dark, W * 0.489 + 0.105, 1.05, L * 0.16, 'dark');
      if (isSport) {
        box(0.09, 0.22, 0.09, dark, -W * 0.3, 0.92, -L * 0.47, 'dark');    // spoiler struts
        box(0.09, 0.22, 0.09, dark, W * 0.3, 0.92, -L * 0.47, 'dark');
        box(W * 0.96, 0.08, 0.42, dark, 0, 1.05, -L * 0.47, 'dark');       // rear wing
      }
      if (type === 'taxi') {
        box(0.62, 0.16, 0.3, new THREE.MeshBasicMaterial({ color: 0xffd23f }), 0, roofY + 0.11, -L * 0.03); // roof sign
      }
      if (type === 'police') {
        // Contrast door panels over the white body + the lightbar.
        var doorMat = new THREE.MeshLambertMaterial({ color: 0x1c2f6e, flatShading: true });
        box(0.05, 0.36, L * 0.46, doorMat, -(W * 0.489 + 0.008), 0.64, -L * 0.02);
        box(0.05, 0.36, L * 0.46, doorMat, W * 0.489 + 0.008, 0.64, -L * 0.02);
        // Two-tone lightbar: red left, blue right, each with its own glow
        // sprite; materials are per-car so the flash phase can alternate.
        var barBase = box(W * 0.72, 0.1, 0.42, dark, 0, roofY + 0.05, -L * 0.03, 'dark');
        var redMat = new THREE.MeshBasicMaterial({ color: 0xff2a4a });
        var blueMat = new THREE.MeshBasicMaterial({ color: 0x2a6aff });
        var rb = new THREE.Mesh(new THREE.BoxGeometry(W * 0.34, 0.15, 0.4), redMat); rb.position.set(-W * 0.18, roofY + 0.17, -L * 0.03); g.add(rb);
        var bb = new THREE.Mesh(new THREE.BoxGeometry(W * 0.34, 0.15, 0.4), blueMat); bb.position.set(W * 0.18, roofY + 0.17, -L * 0.03); g.add(bb);
        var rg = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTex(), color: 0xff3a5a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
        rg.scale.set(3.4, 2.2, 1); rg.position.set(-W * 0.18, roofY + 0.2, -L * 0.03); g.add(rg);
        var bg = new THREE.Sprite(rg.material.clone()); bg.material.color = new THREE.Color(0x3a7aff);
        bg.scale.set(3.4, 2.2, 1); bg.position.set(W * 0.18, roofY + 0.2, -L * 0.03); g.add(bg);
        g.userData.lightbar = { redMat: redMat, blueMat: blueMat, redGlow: rg, blueGlow: bg };
      }
      // Wheels sit at the bible wheelbase (+/-0.305 L ≈ 2.68 m on the
      // sedan), tucked so the tyre face is flush with the bevelled flank.
      var wx = W * 0.489 - 0.125;   // Rev 9: wider track, tyre face tucked under the flare
      wheel(-wx, L * 0.305, wr, 0.30); wheel(wx, L * 0.305, wr, 0.30);
      wheel(-wx, -L * 0.305, wr, 0.30); wheel(wx, -L * 0.305, wr, 0.30);
    }
    // Contact blob shadow under every land vehicle (not the boat).
    if (type !== 'boat') {
      var blob = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.3 + 0.35, L * 1.05), getBlobMat());
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.02;
      blob.renderOrder = 1;
      blob.userData.isBlob = true; // excluded from the far-LOD bake
      g.add(blob);
    }
    // Lights: front = +z face of the model. The motor gets a single round
    // headlight + a slim tail light instead of the car pair.
    var hw = Math.max(0.3, W * 0.32);
    if (type === 'motor') {
      var mh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10), headMat);
      mh.rotation.x = Math.PI / 2; mh.position.set(0, 0.74, L / 2 - 0.06); mh.userData.mergeKey = 'head'; g.add(mh);
      var mt = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.05), tailMat);
      mt.position.set(0, 0.66, -L / 2 + 0.02); mt.userData.mergeKey = 'tail'; g.add(mt);
      var mhg = new THREE.Sprite(getHeadGlowMat()); mhg.scale.set(0.7, 0.55, 1); mhg.position.set(0, 0.74, L / 2 + 0.12); g.add(mhg);
    } else if (type === 'truck') {
      var th1 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), headMat); th1.position.set(-0.78, 0.80, L / 2 + 0.03); th1.userData.mergeKey = 'head'; g.add(th1);
      var th2 = th1.clone(); th2.position.x = 0.78; g.add(th2);
      var tband = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 0.05), tailMat); tband.position.set(0, 0.72, -L / 2 - 0.02); tband.userData.mergeKey = 'tail'; g.add(tband);
    } else if (type === 'boat') {
      var bh1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.05), headMat); bh1.position.set(-0.55, 0.82, L * 0.30); bh1.rotation.y = 0.3; bh1.userData.mergeKey = 'head'; g.add(bh1);
      var bh2 = bh1.clone(); bh2.position.x = 0.55; bh2.rotation.y = -0.3; g.add(bh2);
      var bt1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.04), tailMat); bt1.position.set(0, 0.80, -L / 2 - 0.02); bt1.userData.mergeKey = 'tail'; g.add(bt1);
    } else {
      var h1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), headMat); h1.position.set(-hw, H * 0.52, L / 2 + 0.05); h1.userData.mergeKey = 'head'; g.add(h1);
      var h2 = h1.clone(); h2.position.x = hw; g.add(h2);
      h1.rotation.y = 0.38; h2.rotation.y = -0.38; // wedge lamps wrap the front corners
      // Rev 9: DRL strips under the wedge lamps + the continuous rear
      // light BAND (gradient texture, brake-reactive via tailMat).
      var drl1 = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.032, 0.03), headMat); drl1.position.set(-hw, H * 0.44, L / 2 + 0.045); drl1.rotation.y = 0.38; drl1.userData.mergeKey = 'head'; g.add(drl1);
      var drl2 = drl1.clone(); drl2.position.x = hw; drl2.rotation.y = -0.38; g.add(drl2);
      var band = new THREE.Mesh(new THREE.BoxGeometry(W * 0.76, 0.085, 0.045), tailMat);
      band.position.set(0, type === 'sport' ? 0.64 : 0.74, -L / 2 - 0.025);
      band.userData.mergeKey = 'tail'; g.add(band);
    }
    // Headlight glow sprites + a fake light cone (opacity driven globally by
    // the time of day via Vehicles.setLightLevel). No cone on the motor.
    if (type !== 'boat' && type !== 'motor') {
      var hg1 = new THREE.Sprite(getHeadGlowMat()); hg1.scale.set(1.05, 0.75, 1); hg1.position.set(-hw, H * 0.5, L / 2 + 0.25); g.add(hg1);
      var hg2 = new THREE.Sprite(getHeadGlowMat()); hg2.scale.set(1.05, 0.75, 1); hg2.position.set(hw, H * 0.5, L / 2 + 0.25); g.add(hg2);
      var cone = new THREE.Mesh(new THREE.ConeGeometry(1.1, 5.5, 12, 1, true), getConeMat());
      cone.rotation.x = Math.PI / 2 + 0.06;
      cone.position.set(0, H * 0.42, L / 2 + 2.7);
      g.add(cone);
      g.userData.cone = cone;
    }

    // Draw-call diet (Art Bible v2 perf mandate): fuse every merge-tagged
    // static part into ONE mesh per material family. A dressed sedan
    // drops from ~40 meshes to ~19 (wheels, glass, glows and the light
    // cone stay separate because they spin, glow or switch material).
    (function mergeStatics() {
      var mats = { paint: paint, dark: dark, chrome: chromeMat, head: headMat, tail: tailMat };
      var buckets = {}, items = [];
      g.traverse(function (o) { if (o.userData && o.userData.mergeKey) items.push(o); });
      for (var i = 0; i < items.length; i++) {
        var o = items[i];
        o.updateMatrix();
        (buckets[o.userData.mergeKey] = buckets[o.userData.mergeKey] || []).push(o.geometry.clone().applyMatrix4(o.matrix));
        if (o.parent) o.parent.remove(o);
      }
      for (var key in buckets) {
        var merged = new THREE.Mesh(SH.World.mergeGeos(buckets[key]), mats[key]);
        merged.castShadow = key === 'paint';
        g.add(merged);
      }
    })();

    return { group: g, wheels: wheels, tailMat: tailMat, brakeMat: brakeMat, headMat: headMat, paintMat: paint };
  }

  var Vehicles = {
    list: [],
    parkedSpots: [
      // Hand-placed stealable cars near the spawn and around town (on road edges).
      { type: 'sedan', x: -352, z: 128, heading: Math.PI / 2 },
      { type: 'sport', x: -352, z: 30, heading: Math.PI / 2 },
      { type: 'motor', x: -368, z: 66, heading: -Math.PI / 2 },
      { type: 'sedan', x: 112, z: -188, heading: -Math.PI / 2 },
      { type: 'sport', x: 300, z: -68, heading: Math.PI },
      { type: 'truck', x: 330, z: 66, heading: 0 },
      { type: 'sedan', x: -128, z: 186, heading: 0 },
      { type: 'motor', x: 52, z: 234, heading: Math.PI / 2 },
      { type: 'sedan', x: -248, z: -308, heading: 0 },
      { type: 'sport', x: 420, z: -128, heading: Math.PI },
      // Kerbside parking along the main avenues (visual density + stealable).
      { type: 'sedan', x: -114.5, z: -160, heading: 0 },
      { type: 'sedan', x: -125.5, z: -96, heading: Math.PI },
      { type: 'sport', x: -114.5, z: -20, heading: 0 },
      { type: 'sedan', x: 5.5, z: -140, heading: Math.PI },
      { type: 'motor', x: -5.5, z: -80, heading: 0 },
      { type: 'sedan', x: 114.5, z: 20, heading: 0 },
      { type: 'sedan', x: -234.5, z: -240, heading: 0 },
      { type: 'sport', x: 245.5, z: -200, heading: Math.PI },
      { type: 'sedan', x: -365.5, z: -20, heading: Math.PI },
      { type: 'sedan', x: 354.5, z: 120, heading: 0 },
      { type: 'motor', x: -475.5, z: 120, heading: 0 },
      { type: 'sedan', x: -60, z: -54.5, heading: Math.PI / 2 },
      { type: 'sedan', x: 40, z: 65.5, heading: -Math.PI / 2 },
      { type: 'sport', x: -200, z: 174.5, heading: Math.PI / 2 },
      { type: 'sedan', x: 180, z: -174.5, heading: -Math.PI / 2 }
    ],

    spawnVehicle: function (scene, type, colorHex, x, z, heading) {
      var built = buildMesh(type, colorHex);
      built.group.position.set(x, 0, z);
      built.group.rotation.order = 'YXZ'; // heading first, then local roll/pitch
      built.group.rotation.y = heading;
      scene.add(built.group);
      var veh = {
        type: type, spec: SH.Config.vehicleTypes[type], mesh: built.group, wheels: built.wheels,
        tailMat: built.tailMat, brakeMat: built.brakeMat, headMat: built.headMat,
        x: x, z: z, y: 0, heading: heading, speed: 0, steer: 0, hp: 100,
        driver: 'parked', active: true, smokeTimer: 0, dead: false, color: colorHex
      };
      this.list.push(veh);
      return veh;
    },

    buildPool: function (scene) {
      this._scene = scene;
      var rng = SH.World.makeRng(99);
      for (var i = 0; i < this.parkedSpots.length; i++) {
        var s = this.parkedSpots[i];
        var colors = SH.Config.vehicleTypes[s.type].colors;
        this.spawnVehicle(scene, s.type, colors[(rng() * colors.length) | 0], s.x, s.z, s.heading);
      }
      // Player headlight (one real spotlight, only lit at night).
      this.headlight = new THREE.SpotLight(0xffe9b8, 0, 60, 0.62, 0.5, 1.2);
      scene.add(this.headlight);
      scene.add(this.headlight.target);
    },

    // ---- Far LOD (perf mandate) --------------------------------------
    // Beyond ~55 m from the camera a vehicle stops drawing its ~17
    // meshes and instead occupies ONE slot in two InstancedMeshes per
    // type: a paint shell (tinted per instance from the car's colour)
    // and a vertex-coloured trim shell (glass, tyres, lights, plate —
    // baked from a template build). Slots are rewritten from the live
    // vehicle list every frame, so police spawns/despawns can never
    // leave a ghost. Near vehicles are completely untouched.
    _lod: null,
    _buildLOD: function () {
      var scene = this._scene;
      // Lambert, not Phong: instanced Phong + scene environment
      // renders black in this three build (see buildings.js towers).
      var paintMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
      var trimMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      var types = ['sedan', 'sport', 'police', 'truck', 'motor', 'boat'];
      var out = {};
      for (var ti = 0; ti < types.length; ti++) {
        var type = types[ti];
        var built = buildMesh(type, 0xffffff);
        var paintGeos = [], trimGeos = [];
        // Rev 9: wheels are spinning GROUPS now, so the bake walks the
        // whole subtree (matrixWorld) instead of direct children — the
        // far shell keeps the v3 wheels and loft silhouette. The motor
        // rider subtree and the light cone are pruned.
        built.group.updateMatrixWorld(true);
        var kids = [];
        (function collect(node) {
          for (var ci = 0; ci < node.children.length; ci++) {
            var ch = node.children[ci];
            if (ch === built.group.userData.rider || ch === built.group.userData.cone) continue;
            if (ch.isMesh) kids.push(ch);
            collect(ch);
          }
        })(built.group);
        for (var ci = 0; ci < kids.length; ci++) {
          var child = kids[ci];
          if (child.userData.isBlob) continue;
          var geo = child.geometry.clone().applyMatrix4(child.matrixWorld);
          if (child.material === built.paintMat) { paintGeos.push(geo); continue; }
          var col = (child.material && child.material.map) ? new THREE.Color(0x777d85)
            : (child.material && child.material.color ? child.material.color : new THREE.Color(0x777d85));
          var n = geo.attributes.position.count;
          var arr = new Float32Array(n * 3);
          for (var vi = 0; vi < n; vi++) { arr[vi * 3] = col.r; arr[vi * 3 + 1] = col.g; arr[vi * 3 + 2] = col.b; }
          geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
          trimGeos.push(geo);
        }
        if (type === 'motor') {
          // A simple rider silhouette so a far bike is never a ghost:
          // dark torso leaning forward + the red helmet.
          var torsoG = new THREE.BoxGeometry(0.34, 0.52, 0.20);
          torsoG.rotateX(0.15); torsoG.translate(0, 1.04, -0.05);
          var headG = new THREE.SphereGeometry(0.115, 8, 6).translate(0, 1.42, 0.03);
          var sil = [[torsoG, new THREE.Color(0x2c3444)], [headG, new THREE.Color(0xd8402e)]];
          for (var si = 0; si < sil.length; si++) {
            var sg = sil[si][0], sc = sil[si][1];
            var sn = sg.attributes.position.count;
            var sarr = new Float32Array(sn * 3);
            for (var sj = 0; sj < sn; sj++) { sarr[sj * 3] = sc.r; sarr[sj * 3 + 1] = sc.g; sarr[sj * 3 + 2] = sc.b; }
            sg.setAttribute('color', new THREE.BufferAttribute(sarr, 3));
            trimGeos.push(sg);
          }
        }
        var count = 0;
        for (var li = 0; li < this.list.length; li++) if (this.list[li].type === type) count++;
        var cap = count + (type === 'police' ? 16 : 8);
        var paintIM = new THREE.InstancedMesh(SH.World.mergeGeos(paintGeos), paintMat, cap);
        var trimIM = new THREE.InstancedMesh(SH.World.mergeGeos(trimGeos), trimMat, cap);
        var zero = new THREE.Matrix4().makeScale(0, 0, 0);
        for (var zi = 0; zi < cap; zi++) { paintIM.setMatrixAt(zi, zero); trimIM.setMatrixAt(zi, zero); }
        paintIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        trimIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        paintIM.castShadow = true;
        paintIM.frustumCulled = false;
        trimIM.frustumCulled = false;
        scene.add(paintIM);
        scene.add(trimIM);
        out[type] = { paintIM: paintIM, trimIM: trimIM, cap: cap, cursor: 0, last: 0 };
      }
      this._lod = out;
    },

    updateLOD: function (camPos) {
      if (!this._scene) return;
      if (!this._lod) this._buildLOD();
      var types = this._lod, t;
      for (t in types) types[t].cursor = 0;
      var m = _lodScratchM, one = _lodScratchOne, col = _lodScratchCol;
      for (var i = 0; i < this.list.length; i++) {
        var v = this.list[i];
        var dx = v.x - camPos.x, dz = v.z - camPos.z;
        var d2 = dx * dx + dz * dz;
        var far = v._far ? d2 > 2500 : d2 > 3025; // out at 55 m, back at 50 m
        var rec = types[v.type];
        if (far && rec && rec.cursor < rec.cap) {
          m.compose(v.mesh.position, v.mesh.quaternion, one);
          rec.paintIM.setMatrixAt(rec.cursor, m);
          rec.trimIM.setMatrixAt(rec.cursor, m);
          rec.paintIM.setColorAt(rec.cursor, col.setHex(v.color));
          rec.cursor++;
          v._far = true;
          if (v.mesh.visible) v.mesh.visible = false;
        } else {
          v._far = false;
          if (!v.mesh.visible) v.mesh.visible = true;
        }
      }
      var zero = _lodScratchZero;
      for (t in types) {
        var r = types[t];
        for (var s = r.cursor; s < r.last; s++) {
          r.paintIM.setMatrixAt(s, zero);
          r.trimIM.setMatrixAt(s, zero);
        }
        r.last = r.cursor;
        r.paintIM.instanceMatrix.needsUpdate = true;
        r.trimIM.instanceMatrix.needsUpdate = true;
        if (r.paintIM.instanceColor) r.paintIM.instanceColor.needsUpdate = true;
      }
    },

    nearestUsable: function () {
      var p = SH.State.player, best = null, bd = 4.2;
      for (var i = 0; i < this.list.length; i++) {
        var v = this.list[i];
        if (!v.active || v.dead || v.driver === 'traffic' || v.driver === 'police' || v.driver === 'roadblock') continue;
        var d = Math.hypot(v.x - p.x, v.z - p.z);
        if (d < bd) { bd = d; best = v; }
      }
      return best;
    },

    enter: function (veh) {
      var st = SH.State;
      veh.driver = 'player';
      st.driving = true;
      st.vehicle = veh;
      SH.Player.onFoot = false;
      st.stats.carsStolen++;
      if (SH.Audio && SH.Audio.radio) SH.Audio.radio(true);
      if (SH.HUD) SH.HUD.notify('Driving: ' + veh.spec.label);
      if (SH.Police && SH.Police.witnessCrime) SH.Police.witnessCrime('steal', veh.x, veh.z);
    },

    exit: function () {
      var st = SH.State, veh = st.vehicle;
      if (!veh) return;
      veh.driver = 'parked';
      veh.speed = 0;
      st.driving = false;
      st.vehicle = null;
      SH.Player.onFoot = true;
      var side = veh.heading + Math.PI / 2;
      st.player.x = veh.x + Math.sin(side) * 2.4;
      st.player.z = veh.z + Math.cos(side) * 2.4;
      st.player.y = 0; st.player.vy = 0;
      SH.Audio.engine(0, false);
      if (SH.Audio && SH.Audio.radio) SH.Audio.radio(false);
    },

    updateInteractions: function (dt) {
      var st = SH.State, input = SH.Input;
      if (st.mode !== 'playing') return;
      if (!st.driving) {
        var near = this.nearestUsable();
        if (SH.HUD) SH.HUD.setPrompt(near ? 'F — Enter ' + near.spec.label : null);
        if (near && input.wasPressed('KeyF')) this.enter(near);
      } else if (input.wasPressed('KeyF')) {
        this.exit();
      }
    },

    collideWorld: function (v, dt) {
      var cols = SH.World.colliders;
      var radius = v.spec.length * 0.32;
      for (var i = 0; i < cols.length; i++) {
        var c = cols[i];
        var dx = v.x - c.x, dz = v.z - c.z;
        var px = c.hx + radius - Math.abs(dx), pz = c.hz + radius - Math.abs(dz);
        if (px > 0 && pz > 0) {
          var impact = Math.abs(v.speed);
          if (px < pz) v.x = c.x + (dx > 0 ? c.hx + radius : -c.hx - radius);
          else v.z = c.z + (dz > 0 ? c.hz + radius : -c.hz - radius);
          // Police units are armoured against scenery (they die to gunfire and
          // player rams, not to kerbs); traffic takes half building damage.
          if (impact > 6 && v.driver !== 'police' && v.driver !== 'roadblock') {
            this.damage(v, impact * (v.driver === 'player' ? 1.1 : 0.5));
            if (v.driver === 'player') SH.Effects.shake(0.25);
          }
          v.speed *= -0.25;
        }
      }
      var cfg = SH.Config.world;
      if (v.type === 'boat') {
        // Boats live on the water: free range across the bay, but the hull
        // grounds a couple of metres past the curved waterline, and Pulau
        // Seberang is solid — the island rim pushes a hull back out.
        v.x = Math.max(-cfg.halfX - 260, Math.min(cfg.halfX + 260, v.x));
        v.z = Math.max(SH.World.coastZ(v.x) + 2, Math.min(cfg.waterZ + 320, v.z));
        if (SH.World.onIsland(v.x, v.z, -4)) {
          var islB = SH.Config.island;
          var bx2 = v.x - islB.x, bz2 = v.z - islB.z;
          var bl = Math.hypot(bx2 / islB.rx, bz2 / islB.rz) || 1;
          v.x = islB.x + bx2 / bl;
          v.z = islB.z + bz2 / bl;
        }
        return;
      }
      v.x = Math.max(-cfg.halfX - 20, Math.min(cfg.halfX + 20, v.x));
      // Land vehicles stop at the curved shoreline — except on the pier,
      // the bridge corridor (rails hold them, like the player) and the
      // island, whose rim pulls them back instead of teleporting them.
      if (v.z > SH.World.coastZ(v.x) + 2 && !SH.World.isLand(v.x, v.z)) {
        var bcv = SH.World.bridgeClosest(v.x, v.z);
        if (bcv.dist < 30) {
          var pullv = Math.min(1, 6.8 / Math.max(bcv.dist, 0.001));
          v.x = bcv.x + (v.x - bcv.x) * pullv;
          v.z = bcv.z + (v.z - bcv.z) * pullv;
        } else if (v.z < 380) {
          v.z = SH.World.coastZ(v.x) + 2;
        } else {
          var islV = SH.Config.island;
          var exv = (v.x - islV.x) / (islV.rx + 6), ezv = (v.z - islV.z) / (islV.rz + 6);
          var eev = exv * exv + ezv * ezv;
          if (eev > 1) { var scv = 1 / Math.sqrt(eev); v.x = islV.x + (v.x - islV.x) * scv; v.z = islV.z + (v.z - islV.z) * scv; }
        }
      }
      v.z = Math.max(-cfg.halfZ - 20, v.z);
    },

    damage: function (v, amount) {
      if (v.dead) return;
      v.hp -= amount;
      if (v.hp <= 0) {
        v.hp = 0; v.dead = true;
        SH.Effects.explosion(v.x, 0.6, v.z);
        if (SH.Audio && SH.Audio.boom) SH.Audio.boom();
        if (SH.Police && SH.Police.witnessCrime && (v.driver === 'police' || v.driver === 'roadblock')) SH.Police.witnessCrime('killPolice', v.x, v.z);
        v.speed = 0;
        if (v.driver === 'player') {
          SH.State.player.health = Math.max(5, SH.State.player.health - 25);
          this.exit();
          SH.State.player.health = Math.max(5, SH.State.player.health);
        }
      }
    },

    updatePlayerVehicle: function (dt) {
      var st = SH.State, v = st.vehicle, input = SH.Input;
      if (!v) return;
      var spec = v.spec;
      var throttle = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
      var steerIn = (input.isDown('KeyA') ? 1 : 0) - (input.isDown('KeyD') ? 1 : 0);
      var handbrake = input.isDown('Space');

      if (throttle > 0) v.speed += spec.accel * dt * (1 - Math.max(0, v.speed) / spec.maxSpeed);
      else if (throttle < 0) v.speed -= (v.speed > 0.5 ? spec.brake : spec.accel * 0.6) * dt;
      else v.speed -= v.speed * 0.35 * dt; // engine braking / drag
      if (handbrake) v.speed -= v.speed * 2.2 * dt;
      // Screenshot staging (?shot=): hold a cruise speed with no input.
      if (st._shotCruise && throttle === 0 && !handbrake) {
        v.speed += Math.max(-10 * dt, Math.min(10 * dt, st._shotCruise.speed - v.speed));
      }
      v.speed = Math.max(-spec.maxSpeed * 0.32, Math.min(spec.maxSpeed, v.speed));

      v.steer += (steerIn * 0.55 - v.steer) * Math.min(1, dt * 8);
      var wetGrip = SH.Weather ? SH.Weather.gripFactor : 1;
      var grip = (handbrake ? spec.grip * 0.35 : spec.grip) * wetGrip;
      var yawRate = v.steer * spec.turn * (v.speed / (Math.abs(v.speed) + 6)) * (grip / spec.grip);
      v.heading += yawRate * dt * (v.speed >= 0 ? 1 : -1) * (Math.abs(v.speed) > 0.2 ? 1 : 0);

      v.x += Math.sin(v.heading) * v.speed * dt;
      v.z += Math.cos(v.heading) * v.speed * dt;
      this.collideWorld(v, dt);

      // Sync mesh + visuals. A boat rides the swell: bob + roll on the water
      // instead of sitting glued to y=0.
      var bobY = 0;
      if (v.type === 'boat') bobY = Math.sin(SH.State.time * 1.7 + v.x * 0.05) * 0.14 - 0.1;
      v.mesh.position.set(v.x, bobY, v.z);
      v.mesh.rotation.y = v.heading;
      v.mesh.rotation.z = -v.steer * Math.min(1, Math.abs(v.speed) / 20) * (v.type === 'boat' ? 0.16 : 0.06) + (v.type === 'boat' ? Math.sin(SH.State.time * 1.3) * 0.02 : 0);
      v.mesh.rotation.x = (throttle > 0 ? -0.012 : throttle < 0 ? 0.014 : 0) * Math.min(1, Math.abs(v.speed) / 12);
      for (var i = 0; i < v.wheels.length; i++) v.wheels[i].rotation.x += v.speed * dt / 0.4;
      // Rider visibility (Art Pass 3): inside a car the player mesh hides
      // in the cabin, but on a MOTOR he is the rider — keep his mesh
      // visible, seated (thighs forward, hands to the bars, slight lean),
      // tracking the bike exactly. Player.update never runs while driving,
      // so the pose lives here.
      if (SH.Player && SH.Player.mesh) {
        if (v.type === 'motor' && SH.Player.fig) {
          var pm = SH.Player.mesh;
          pm.visible = true;
          pm.rotation.order = 'YXZ';
          pm.position.set(v.x - Math.sin(v.heading) * 0.05, -0.22, v.z - Math.cos(v.heading) * 0.05);
          pm.rotation.y = v.heading;
          pm.rotation.x = 0.15;
          SH.Player.fig.applySeated();
        } else {
          SH.Player.mesh.visible = false;
        }
      }
      this.setBrakeLights(v, throttle < 0 || handbrake);

      st.vehiclePos.x = v.x; st.vehiclePos.z = v.z; st.vehiclePos.y = 0;
      st.speedKmh = Math.round(Math.abs(v.speed) * 3.6);
      // Camera eases behind the car (angle difference wrapped, or it swings
      // the long way around through a full turn).
      var targetYaw = v.heading + Math.PI;
      var dyaw = ((st.camYaw - targetYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      st.camYaw = targetYaw + dyaw * Math.pow(0.4, dt);
      if (input.locked) { /* mouse still free-looks via main step */ }
      var rpm = Math.min(1, Math.abs(v.speed) / spec.maxSpeed * 0.8 + (throttle > 0 ? 0.25 : 0.08));
      SH.Audio.engine(rpm, true);
      if (input.wasPressed('KeyH')) SH.Audio.horn();

      if (v.hp < 45 && !v.dead) {
        v.smokeTimer -= dt;
        if (v.smokeTimer <= 0) { SH.Effects.smoke(v.x, 1.1, v.z, v.hp < 22); v.smokeTimer = 0.09; }
      }
      // Headlight follows at night.
      if (this.headlight) {
        var night = (st.hour >= 18.6 || st.hour < 5.6);
        this.headlight.intensity = night ? 2.4 : 0;
        if (night) {
          this.headlight.position.set(v.x, 1.4, v.z);
          this.headlight.target.position.set(v.x + Math.sin(v.heading) * 18, 0, v.z + Math.cos(v.heading) * 18);
          this.headlight.target.updateMatrixWorld();
        }
      }
    },

    setBrakeLights: function (v, on) {
      v.braking = on;
      v.tailMat.color.setHex(on ? 0xff7070 : 0xff2a2a);
    },

    // Global dusk/night light level (0 day .. 1 night): drives headlight
    // cones + glows on every car at once through the shared materials.
    setLightLevel: function (level) {
      this._lightLevel = level;
      if (coneMatShared) coneMatShared.opacity = level * level * 0.045;
      if (this.playerConeMat) this.playerConeMat.opacity = level * level * 0.03;
      if (headGlowMatShared) headGlowMatShared.opacity = level * 0.38;
      if (this.headlight) this.headlight.intensity = level * 1.6;
    },

    // Police lightbar flash: alternate red/blue twice a second.
    updateVisuals: function () {
      var level = this._lightLevel || 0;
      var phase = (SH.State.time * 2.2) % 1;
      var redOn = phase < 0.5;
      if (!this.playerConeMat) {
        this.playerConeMat = getConeMat().clone();
        this.playerConeMat.opacity = 0;
      }
      for (var i = 0; i < this.list.length; i++) {
        var v = this.list[i];
        // The player's own headlight cone gets a much fainter material: from
        // the chase camera a full-strength cone reads as a solid wedge.
        var cone = v.mesh.userData.cone;
        if (cone) {
          var wantMat = v.driver === 'player' ? this.playerConeMat : coneMatShared;
          if (cone.material !== wantMat) cone.material = wantMat;
        }
        var lb = v.mesh.userData.lightbar;
        if (!lb) continue;
        var active = v.driver === 'police' || v.driver === 'roadblock' || v.driver === 'player';
        lb.redMat.color.setHex(redOn ? 0xff2a4a : 0x57101e);
        lb.blueMat.color.setHex(redOn ? 0x12275e : 0x2a6aff);
        lb.redGlow.material.opacity = active && redOn ? 0.55 + level * 0.3 : 0;
        lb.blueGlow.material.opacity = active && !redOn ? 0.55 + level * 0.3 : 0;
      }
    },

    // Traffic cars reuse this: integrate a vehicle along an explicit velocity.
    syncMesh: function (v) {
      v.mesh.position.set(v.x, 0, v.z);
      // Body roll (Art Pass 3): traffic steers by setting the heading
      // directly, so the roll is derived from the yaw rate since the last
      // sync and eased, the way the player car's steer-based roll feels.
      if (v._syncHeading == null) v._syncHeading = v.heading;
      var dyaw = ((v.heading - v._syncHeading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      v._syncHeading = v.heading;
      var targetRoll = Math.max(-0.085, Math.min(0.085, -dyaw * Math.abs(v.speed) * 0.45));
      v._roll = (v._roll || 0) + (targetRoll - (v._roll || 0)) * 0.25;
      v.mesh.rotation.y = v.heading;
      if (v.type !== 'boat') v.mesh.rotation.z = v._roll;
      // A traffic motor shows its rider; a parked one does not.
      var rider = v.mesh.userData.rider;
      if (rider) rider.visible = !!v.driver && v.driver !== 'parked';
      for (var i = 0; i < v.wheels.length; i++) v.wheels[i].rotation.x += v.speed * 0.016 / 0.4;
    }
  };

  SH.Vehicles = Vehicles;
})(window.SH = window.SH || {});
