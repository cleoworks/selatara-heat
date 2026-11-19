// SELATARA HEAT — characters/factory.js  (Character System, Stage A)
// The ONE factory every human in the game comes from:
//   SH.CharFactory.create(archetypeOrId, seed) -> character
// A character = one shared skeleton (CharRig) + smooth-skinned body +
// procedural canvas face + loft clothing layers + bone-attached
// accessories, in three LODs (full / plain / instanced silhouette).
// Seeded RNG: the same seed always builds the same person, and a crowd
// of 35 seeded pedestrians never repeats a face/outfit combination.
(function (SH) {
  'use strict';

  var Rig = SH.CharRig;

  // ---- seeded rng ---------------------------------------------------------
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }

  var SKIN_TONES = [0xf7d7b5, 0xf2c89b, 0xe8b184, 0xdb9a68, 0xc9824e, 0xa96638, 0x86502a, 0x6b3f22];
  var HAIR_COLORS = [0x17130f, 0x2b1d12, 0x4a2f1a, 0x6e4a26, 0x8a6a3c, 0xb8b0a4, 0xd8d3c8, 0x101010];

  function rgb(hex) {
    return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
  }
  function css(hex) { return '#' + ('000000' + hex.toString(16)).slice(-6); }

  // ---- materials (shared / cached) ---------------------------------------
  var matCache = {};
  function mat(color, rough, opts) {
    var key = color + '|' + rough + '|' + (opts && opts.key || '');
    if (matCache[key]) return matCache[key];
    var m = new THREE.MeshStandardMaterial({ color: color, roughness: rough, metalness: 0.0 });
    if (opts && opts.flat) m.flatShading = true;
    matCache[key] = m; return m;
  }
  var bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
  var darkMat = mat(0x14161c, 0.5);

  var patternCache = {};
  function patternMat(kind, c1, c2) {
    var key = kind + '|' + c1 + '|' + c2;
    if (patternCache[key]) return patternCache[key];
    var cv = document.createElement('canvas'); cv.width = cv.height = 128;
    var c = cv.getContext('2d');
    c.fillStyle = css(c1); c.fillRect(0, 0, 128, 128);
    c.fillStyle = css(c2);
    var i, j;
    if (kind === 'stripes') { for (i = 0; i < 128; i += 16) c.fillRect(i, 0, 6, 128); }
    else if (kind === 'checks') { for (i = 0; i < 128; i += 32) for (j = 0; j < 128; j += 32) if ((i + j) / 32 % 2) c.fillRect(i, j, 32, 32); }
    else if (kind === 'hawaii') {
      for (i = 0; i < 26; i++) {
        var x = (i * 47) % 128, y = (i * 31) % 128;
        c.beginPath(); c.arc(x, y, 4 + (i % 3), 0, 7); c.fill();
        c.fillRect(x - 1, y - 9, 2, 6);
      }
    } else if (kind === 'batik') {
      for (i = 0; i < 128; i += 32) for (j = 0; j < 128; j += 32) {
        c.beginPath(); c.arc(i + 16, j + 16, 9, 0, 7); c.stroke();
        c.beginPath(); c.arc(i + 16, j + 16, 3.5, 0, 7); c.fill();
      }
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
    var m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
    patternCache[key] = m; return m;
  }
  function clothMat(spec) {
    if (!spec) return mat(0x888888, 0.85);
    if (spec.pattern) return patternMat(spec.pattern, spec.color, spec.color2 || 0xffffff);
    return mat(spec.color, spec.rough != null ? spec.rough : 0.85);
  }

  // ---- procedural face -----------------------------------------------------
  // Canvas 256x256 wrapped on the head sphere; face centre at u=0.25
  // (x=64). Simple, friendly, stylised — shading only, no nose geometry.
  var faceCache = {};
  function faceTexture(f, skinHex) {
    var key = JSON.stringify(f) + '|' + skinHex;
    if (faceCache[key]) return faceCache[key];
    var cv = document.createElement('canvas'); cv.width = cv.height = 256;
    var c = cv.getContext('2d');
    c.fillStyle = css(skinHex); c.fillRect(0, 0, 256, 256);
    var glow = c.createRadialGradient(64, 122, 12, 64, 122, 120);
    glow.addColorStop(0, 'rgba(255,240,220,0.08)'); glow.addColorStop(1, 'rgba(40,16,0,0.07)');
    c.fillStyle = glow; c.fillRect(0, 0, 256, 256);
    var dark = 'rgba(38,20,12,1)', soft = 'rgba(60,32,18,0.55)';
    function eye(x, style) {
      c.fillStyle = '#ffffff';
      c.beginPath(); c.ellipse(x, 121, style === 'narrow' ? 6.4 : 7.4, style === 'sleepy' ? 3.4 : 5.2, 0, 0, 7); c.fill();
      c.fillStyle = '#241611';
      c.beginPath(); c.arc(x, 121.5, 3.1, 0, 7); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.beginPath(); c.arc(x - 1.1, 120.2, 1.05, 0, 7); c.fill();
      if (style === 'sleepy') { c.strokeStyle = soft; c.lineWidth = 1.6; c.beginPath(); c.moveTo(x - 6.5, 118.5); c.lineTo(x + 6.5, 118.5); c.stroke(); }
    }
    eye(50, f.eyes); eye(78, f.eyes);
    c.strokeStyle = dark; c.lineWidth = f.browThick ? 3.4 : 2.4; c.lineCap = 'round';
    var by = f.browHigh ? 106 : 109;
    c.beginPath(); c.moveTo(42.5, by + 2); c.quadraticCurveTo(50, by - 2.4, 57.5, by + 1); c.stroke();
    c.beginPath(); c.moveTo(70.5, by + 1); c.quadraticCurveTo(78, by - 2.4, 85.5, by + 2); c.stroke();
    // nose: soft shading only
    var ng = c.createLinearGradient(60, 0, 69, 0);
    ng.addColorStop(0, 'rgba(60,30,10,0)'); ng.addColorStop(0.5, 'rgba(60,30,10,0.16)'); ng.addColorStop(1, 'rgba(60,30,10,0)');
    c.fillStyle = ng; c.fillRect(59, 126, 10, 17);
    c.fillStyle = 'rgba(50,26,12,0.5)';
    c.beginPath(); c.arc(60.5, 144, 1.15, 0, 7); c.arc(67.5, 144, 1.15, 0, 7); c.fill();
    // mouth
    c.strokeStyle = 'rgba(96,36,26,0.9)'; c.lineWidth = 2.1;
    c.beginPath();
    if (f.mouth === 'grin') { c.arc(64, 152, 9.5, 0.25, Math.PI - 0.25); }
    else if (f.mouth === 'flat') { c.moveTo(57, 158); c.lineTo(71, 158); }
    else if (f.mouth === 'stern') { c.arc(64, 166, 8, Math.PI + 0.5, -0.5); }
    else { c.arc(64, 154, 7.5, 0.35, Math.PI - 0.35); }
    c.stroke();
    if (f.blush) {
      c.fillStyle = 'rgba(232,110,90,0.20)';
      c.beginPath(); c.ellipse(40, 140, 6.5, 4, 0, 0, 7); c.ellipse(88, 140, 6.5, 4, 0, 0, 7); c.fill();
    }
    if (f.mustache) {
      c.fillStyle = 'rgba(30,20,14,0.92)';
      c.beginPath(); c.ellipse(64, 151.5, 10.5, 3.1, 0, 0, 7); c.fill();
    }
    if (f.beard) {
      var bg = c.createLinearGradient(0, 150, 0, 205);
      bg.addColorStop(0, 'rgba(28,18,12,0)'); bg.addColorStop(0.35, 'rgba(28,18,12,0.75)'); bg.addColorStop(1, 'rgba(28,18,12,0.95)');
      c.fillStyle = bg; c.fillRect(38, 148, 52, 60);
    }
    if (f.wrinkles) {
      c.strokeStyle = 'rgba(70,40,20,0.35)'; c.lineWidth = 1.3;
      c.beginPath(); c.moveTo(46, 96); c.quadraticCurveTo(64, 92.5, 82, 96); c.stroke();
      c.beginPath(); c.moveTo(49, 89); c.quadraticCurveTo(64, 86, 79, 89); c.stroke();
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 2;
    faceCache[key] = tex; return tex;
  }

  // ---- clothing lofts -------------------------------------------------------
  function subStations(stations, from, to, addR, scaleR) {
    var out = [];
    for (var i = from; i <= to && i < stations.length; i++) {
      var s = stations[i];
      out.push(Rig.st(s.p[0], s.p[1], s.p[2], s.rx * (scaleR || 1) + addR, s.rz * (scaleR || 1) + addR, s.a, s.b, s.w));
    }
    return out;
  }
  // Clothing pieces sharing a material are merged into ONE skinned mesh
  // (draw-call discipline); parts are raw loft tubes collected per piece.
  function clothMesh(parts, boneIndex, material, capEnd) {
    var g = Rig.mergeParts(parts);
    g.computeVertexNormals();
    var m = new THREE.SkinnedMesh(g, material);
    m.frustumCulled = false;
    return m;
  }
  function tubePart(stations, boneIndex, capEnd) {
    return Rig.tube(stations, boneIndex, 10, false, !!capEnd);
  }

  function buildClothes(p, boneIndex, wear, skinRGB) {
    var S = Rig.bodyStations(p), j = S.joints, H = p.H;
    var meshes = [];
    var top = wear.top, bottom = wear.bottom;
    if (top && top.type !== 'none') {
      var off = top.type === 'jacket' || top.type === 'blazer' ? 0.020 : 0.013;
      var parts = [tubePart(subStations(S.torso, top.type === 'vest' ? 4 : 2, 8, off), boneIndex)];
      var sleeveTo = top.sleeve === 'long' ? 5 : top.sleeve === 'mid' ? 3 : top.type === 'vest' ? -1 : 1;
      if (sleeveTo >= 0) {
        parts.push(tubePart(subStations(S.armL, 0, sleeveTo, off), boneIndex));
        parts.push(tubePart(subStations(S.armR, 0, sleeveTo, off), boneIndex));
      }
      if (top.type === 'jacket' || top.type === 'blazer') { // collar
        var colSt = [Rig.st(0, j.neckY - 0.030 * H, 0, 0.030 * H, 0.030 * H, 'neck'),
                     Rig.st(0, j.neckY + 0.006 * H, 0, 0.027 * H, 0.027 * H, 'neck', 'head', 0.3)];
        parts.push(tubePart(colSt, boneIndex));
      }
      meshes.push(clothMesh(parts, boneIndex, clothMat(top)));
    }
    if (bottom && bottom.type === 'skirt') {
      var sk = [];
      for (var i = 0; i <= 4; i++) {
        var t = i / 4, y = j.pelvisY + 0.055 * H - t * 0.315 * H;
        sk.push(Rig.st(0, y, 0, (0.088 + 0.11 * t) * H * p.hips, (0.070 + 0.10 * t) * H, i < 2 ? 'pelvis' : 'thighL', i < 2 ? null : 'thighR', i < 2 ? 0 : 0.5));
      }
      meshes.push(clothMesh([tubePart(sk, boneIndex)], boneIndex, clothMat(bottom)));
      meshes.push(clothMesh([tubePart(subStations(S.legL, 4, 6, 0.004), boneIndex),
                             tubePart(subStations(S.legR, 4, 6, 0.004), boneIndex)], boneIndex, mat(0x333333, 0.8)));
    } else if (bottom && bottom.type !== 'none') {
      var legTo = bottom.type === 'shorts' ? 4 : 7;
      meshes.push(clothMesh([
        tubePart(subStations(S.torso, 0, 2, 0.012), boneIndex),
        tubePart(subStations(S.legL, 0, legTo, 0.011), boneIndex),
        tubePart(subStations(S.legR, 0, legTo, 0.011), boneIndex)], boneIndex, clothMat(bottom)));
    }
    // shoes: loft over the foot stations + one extra tapered station
    // past the toe so the shoe wraps the body's toe cap completely
    var shoeMat = mat(wear.shoes != null ? wear.shoes : 0x2a2c33, 0.55);
    function shoeStations(legStations, side) {
      var sts = subStations(legStations, 7, 9, 0.0055);
      var last = legStations[9];
      sts.push(Rig.st(last.p[0], last.p[1] + 0.002 * H, last.p[2] + 0.016 * H,
        last.rx * 0.62, last.rz * 0.55, 'toe' + side));
      return sts;
    }
    meshes.push(clothMesh([
      tubePart(shoeStations(S.legL, 'L'), boneIndex, true),
      tubePart(shoeStations(S.legR, 'R'), boneIndex, true)], boneIndex, shoeMat));
    return meshes;
  }

  // ---- accessories (bone-attached) ------------------------------------------
  function attach(bone, geo, material, x, y, z, rx, ry, rz) {
    var m = new THREE.Mesh(geo, material);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.frustumCulled = false;
    bone.add(m); return m;
  }
  function textPatch(text, fg, bg) {
    var cv = document.createElement('canvas'); cv.width = 128; cv.height = 32;
    var c = cv.getContext('2d');
    c.fillStyle = bg; c.fillRect(0, 0, 128, 32);
    c.fillStyle = fg; c.font = 'bold 21px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, 64, 17);
    var tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(0.105, 0.026),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
  }

  function buildAccessories(char, wear, r) {
    var b = char.bones, p = char.params, u = p.u, H = p.H, acc = wear.accessories || [];
    var headCY = u * 0.46, headR = u * 0.52 * p.headScale;
    function has(name) { return acc.indexOf(name) >= 0; }
    if (wear.hat === 'fedora') {
      attach(b.head, new THREE.CylinderGeometry(headR * 1.28, headR * 1.30, headR * 0.10, 14), clothMat({ color: wear.hatColor || 0xe8e0cc }), 0, headCY + headR * 0.62, 0);
      attach(b.head, new THREE.CylinderGeometry(headR * 0.78, headR * 0.84, headR * 0.62, 14), clothMat({ color: wear.hatColor || 0xe8e0cc }), 0, headCY + headR * 0.92, 0);
    } else if (wear.hat === 'officer') {
      attach(b.head, new THREE.CylinderGeometry(headR * 0.98, headR * 1.0, headR * 0.42, 14), mat(0x1d2f52, 0.6), 0, headCY + headR * 0.78, 0);
      attach(b.head, new THREE.BoxGeometry(headR * 0.95, headR * 0.07, headR * 0.55), darkMat, 0, headCY + headR * 0.60, headR * 0.85);
    } else if (wear.hat === 'helmet') {
      attach(b.head, new THREE.SphereGeometry(headR * 1.10, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(wear.hatColor || 0x22262e, 0.35), 0, headCY + headR * 0.12, 0);
    } else if (wear.hat === 'sunhat') {
      attach(b.head, new THREE.CylinderGeometry(headR * 1.75, headR * 1.85, headR * 0.08, 16), mat(0xe8d9a8, 0.9), 0, headCY + headR * 0.55, 0);
      attach(b.head, new THREE.SphereGeometry(headR * 0.85, 12, 8), mat(0xe8d9a8, 0.9), 0, headCY + headR * 0.55, 0);
    } else if (wear.hat === 'ojekhelmet') {
      attach(b.head, new THREE.SphereGeometry(headR * 1.12, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), mat(0xcc3322, 0.3), 0, headCY + headR * 0.10, 0);
    }
    if (has('glasses')) {
      var gm = mat(0x333a44, 0.3);
      attach(b.head, new THREE.BoxGeometry(headR * 0.34, headR * 0.30, headR * 0.05), gm, -headR * 0.36, headCY + headR * 0.06, headR * 0.86);
      attach(b.head, new THREE.BoxGeometry(headR * 0.34, headR * 0.30, headR * 0.05), gm, headR * 0.36, headCY + headR * 0.06, headR * 0.86);
      attach(b.head, new THREE.BoxGeometry(headR * 0.36, headR * 0.06, headR * 0.05), gm, 0, headCY + headR * 0.10, headR * 0.86);
    }
    if (has('sunglasses')) {
      attach(b.head, new THREE.BoxGeometry(headR * 1.24, headR * 0.30, headR * 0.06), darkMat, 0, headCY + headR * 0.06, headR * 0.84);
    }
    if (has('badge')) {
      attach(b.spine2, new THREE.BoxGeometry(0.020, 0.026, 0.006), mat(0xd8b84a, 0.35), -0.055 * H / 1.75, 0.035, 0.068 * H / 1.75);
    }
    if (has('policePatch')) {
      var patch = textPatch('POLISI', '#f2f4f8', '#1d2f52');
      patch.position.set(0, 0.045, 0.070 * H / 1.75); b.spine2.add(patch);
      var patch2 = textPatch('POLISI', '#f2f4f8', '#1d2f52');
      patch2.position.set(0, 0.045, -0.070 * H / 1.75); patch2.rotation.y = Math.PI; b.spine2.add(patch2);
    }
    if (has('radio')) {
      attach(b.spine2, new THREE.BoxGeometry(0.022, 0.052, 0.016), darkMat, -0.105 * H / 1.75, 0.085, 0.028);
      attach(b.spine2, new THREE.CylinderGeometry(0.0022, 0.0022, 0.07, 5), darkMat, -0.105 * H / 1.75, 0.14, 0.028);
    }
    if (has('bag')) {
      attach(b.pelvis, new THREE.BoxGeometry(0.085, 0.105, 0.045), clothMat({ color: pick(r, [0xb8563a, 0x3a6ab8, 0x58a84a, 0xd8b13c]) }), 0.105 * H / 1.75, -0.01, -0.02, 0, 0, 0.12);
    }
    if (has('backpack')) {
      attach(b.spine2, new THREE.BoxGeometry(0.115, 0.15, 0.06), clothMat({ color: pick(r, [0xd84a3a, 0x3a7ad8, 0xf2b13c, 0x4ab86a]) }), 0, 0.01, -0.085 * H / 1.75);
    }
    if (has('camera')) {
      attach(b.spine2, new THREE.BoxGeometry(0.052, 0.036, 0.026), darkMat, 0, -0.01, 0.075 * H / 1.75);
    }
    if (has('cane')) {
      attach(b.handR, new THREE.CylinderGeometry(0.006, 0.006, 0.78, 6), mat(0x6e4a26, 0.7), 0.01, -0.42, 0.02);
    }
    if (has('phone')) {
      attach(b.handL, new THREE.BoxGeometry(0.034, 0.062, 0.006), darkMat, 0, -0.055, 0.018, -0.5, 0, 0);
    }
    if (has('cigar')) {
      attach(b.handR, new THREE.CylinderGeometry(0.006, 0.007, 0.055, 6), mat(0x7a4a22, 0.8), 0, -0.045, 0.02, 1.2, 0, 0);
    }
    if (has('pistol')) {
      var pg = Rig.mergePlain([
        Rig.prim(new THREE.BoxGeometry(0.026, 0.045, 0.030), 0, -0.028, 0.004, 1, 1, 1, 0),
        Rig.prim(new THREE.BoxGeometry(0.020, 0.024, 0.115), 0, 0.004, 0.045, 1, 1, 1, 0)]);
      attach(b.handR, pg, darkMat, 0, -0.052, 0.012);
    }
    if (has('rifle')) {
      var rg = Rig.mergePlain([
        Rig.prim(new THREE.BoxGeometry(0.030, 0.055, 0.34), 0, -0.01, 0.10, 1, 1, 1, 0),
        Rig.prim(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6), 0, 0.012, 0.33, 1, 1, 1, 0),
        Rig.prim(new THREE.BoxGeometry(0.024, 0.075, 0.035), 0, -0.055, 0.10, 1, 1, 1, 0)]);
      // rotate barrel from z to forward: cylinder is Y-axis; tilt via rotation on attach
      var rm = attach(b.handR, rg, darkMat, 0, -0.05, 0.03);
      rm.rotation.x = 0; // barrel built along +Z already except cylinder; acceptable silhouette
    }
    if (has('mask')) {
      attach(b.head, new THREE.SphereGeometry(headR * 1.04, 12, 10), mat(0x181818, 0.85), 0, headCY, -headR * 0.03);
    }
    if (has('jewelry')) {
      attach(b.neck, new THREE.TorusGeometry(0.052 * H / 1.75, 0.0045, 6, 18), mat(0xe8c85a, 0.3), 0, 0.012, 0.012, 1.25, 0, 0);
    }
  }

  // ---- LOD2 silhouette --------------------------------------------------------
  var farGeo = null, farMesh = null, FAR_CAP = 64;
  function buildFar() {
    var cyl = new THREE.CylinderGeometry(0.16, 0.20, 1.52, 8);
    cyl.translate(0, 0.76, 0);
    var head = new THREE.SphereGeometry(0.115, 8, 6); head.translate(0, 1.66, 0);
    farGeo = Rig.mergePlain([cyl.index ? cyl.toNonIndexed() : cyl, head.index ? head.toNonIndexed() : head]);
    farMesh = new THREE.InstancedMesh(farGeo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), FAR_CAP);
    farMesh.frustumCulled = false; farMesh.count = 0;
    farMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  // ---- the factory -------------------------------------------------------------
  var active = [], pool = {};
  var dummy = null;

  function resolveWear(arch, r) {
    var w = arch.wear || {};
    function spec(s) {
      if (!s) return s;
      var out = {}; for (var k in s) out[k] = s[k];
      if (out.colors) out.color = pick(r, out.colors);
      if (out.colors2) out.color2 = pick(r, out.colors2);
      return out;
    }
    return {
      top: spec(w.top), bottom: spec(w.bottom),
      shoes: w.shoes != null ? (Array.isArray(w.shoes) ? pick(r, w.shoes) : w.shoes) : null,
      hat: w.hat || null, hatColor: w.hatColor,
      accessories: w.accessories || []
    };
  }

  function create(archOrId, seed) {
    var arch = typeof archOrId === 'string' ? (SH.Archetypes && SH.Archetypes[archOrId]) : archOrId;
    if (!arch) throw new Error('CharFactory: unknown archetype ' + archOrId);
    seed = seed == null ? 1 : seed;
    var key = (arch.id || 'custom') + '|' + seed;
    if (pool[key] && !pool[key].inUse) { pool[key].inUse = true; return pool[key]; }
    var r = rng(seed * 7919 + 17);
    var bp = arch.body || {};
    var p = Rig.baseParams({
      H: bp.H || (arch.heightRange ? arch.heightRange[0] + r() * (arch.heightRange[1] - arch.heightRange[0]) : 1.75),
      legFrac: bp.legFrac, shoulder: bp.shoulder, waist: bp.waist, hips: bp.hips,
      belly: bp.belly, thigh: bp.thigh, headScale: bp.headScale, handScale: bp.handScale || 1.02, neckR: bp.neckR
    });
    var skinHex = bp.skin != null ? SKIN_TONES[bp.skin % 8] : pick(r, SKIN_TONES);
    var skinRGB = rgb(skinHex);
    var sk = Rig.buildSkeleton(p);
    var group = new THREE.Group();
    group.add(sk.root);
    function bind(mesh) { mesh.bind(sk.skeleton); group.add(mesh); return mesh; }
    // LOD0
    var body0 = new THREE.SkinnedMesh(Rig.buildBody(p, sk.index, skinRGB, true), bodyMat);
    body0.frustumCulled = false; bind(body0);
    var faceSpec = Object.assign({ eyes: 'round', mouth: 'smile' }, arch.face || {});
    if (faceSpec.randomEyes) faceSpec.eyes = pick(r, ['round', 'narrow', 'sleepy']);
    var headMat = new THREE.MeshStandardMaterial({ map: faceTexture(faceSpec, skinHex), roughness: 0.58 });
    var head0 = new THREE.SkinnedMesh(Rig.buildHead(p, sk.index), headMat);
    head0.frustumCulled = false; bind(head0);
    var wear = resolveWear(arch, r);
    var clothes0 = buildClothes(p, sk.index, wear, skinRGB);
    for (var i = 0; i < clothes0.length; i++) { clothes0[i].bind(sk.skeleton); group.add(clothes0[i]); }
    var char = { group: group, bones: sk.bones, skeleton: sk.skeleton, params: p, archetype: arch, seed: seed, wear: wear, inUse: true, lod: 0, key: key };
    var hairStyle = (arch.hair && arch.hair.style) || 'short';
    if (arch.hair && arch.hair.styles) hairStyle = pick(r, arch.hair.styles);
    var hairColor = (arch.hair && arch.hair.color) || pick(r, HAIR_COLORS);
    var hairGeo = Rig.hairGeometry(hairStyle, p);
    if (hairGeo) {
      var hairMesh = new THREE.Mesh(hairGeo, hairStyle === 'hijab' ? clothMat({ color: (arch.hair && arch.hair.clothColor) || 0x7a4a8a }) : mat(hairColor, 0.82));
      hairMesh.frustumCulled = false; sk.bones.head.add(hairMesh); char.hairMesh = hairMesh;
    }
    buildAccessories(char, wear, r);
    // LOD1: no fingers, no small accessories (hair + clothes stay)
    var body1 = new THREE.SkinnedMesh(Rig.buildBody(p, sk.index, skinRGB, false), bodyMat);
    body1.frustumCulled = false; body1.bind(sk.skeleton); body1.visible = false; group.add(body1);
    var head1 = new THREE.SkinnedMesh(Rig.buildHead(p, sk.index), headMat);
    head1.frustumCulled = false; head1.bind(sk.skeleton); head1.visible = false; group.add(head1);
    var clothes1 = buildClothes(p, sk.index, wear, skinRGB);
    for (var q = 0; q < clothes1.length; q++) { clothes1[q].bind(sk.skeleton); clothes1[q].visible = false; group.add(clothes1[q]); }
    char.parts = { body0: body0, head0: head0, clothes0: clothes0, body1: body1, head1: head1, clothes1: clothes1 };
    char.farColor = new THREE.Color(wear.top && wear.top.color || 0x888888);
    char.setLOD = function (level) {
      if (char.lod === level) return; char.lod = level;
      var P = char.parts;
      P.body0.visible = P.head0.visible = level === 0;
      for (var a = 0; a < P.clothes0.length; a++) P.clothes0[a].visible = level === 0;
      P.body1.visible = P.head1.visible = level === 1;
      for (var b = 0; b < P.clothes1.length; b++) P.clothes1[b].visible = level === 1;
      char.group.visible = level < 2;
      // accessories hang on bones; hide them beyond LOD0:
      setDecoVisible(char, level === 0);
    };
    pool[key] = char; active.push(char);
    return char;
  }

  // Accessories/hair are bone children; toggling them per LOD walks the
  // bone subtrees once per switch (cheap, switches are rare).
  function setDecoVisible(char, vis) {
    var names = ['head', 'spine2', 'pelvis', 'neck', 'handL', 'handR'];
    for (var i = 0; i < names.length; i++) {
      var bone = char.bones[names[i]]; if (!bone) continue;
      for (var q = 0; q < bone.children.length; q++) {
        var ch = bone.children[q];
        if (ch.isMesh) ch.visible = vis;
      }
    }
    if (char.hairMesh) char.hairMesh.visible = vis;
  }

  var tmpM = null, tmpQ = null, tmpS = null, tmpP = null;
  function update(camera, scene) {
    if (!farMesh && scene) { buildFar(); scene.add(farMesh); }
    if (!tmpM) { tmpM = new THREE.Matrix4(); tmpQ = new THREE.Quaternion(); tmpS = new THREE.Vector3(); tmpP = new THREE.Vector3(); }
    var farCount = 0;
    for (var i = 0; i < active.length; i++) {
      var ch = active[i];
      if (!ch.inUse || !ch.group.parent) continue;
      var d = camera.position.distanceTo(ch.group.position);
      var level = d < 15 ? 0 : d < 40 ? 1 : 2;
      if (level === 2) {
        if (ch.lod !== 2) ch.setLOD(2);
        ch.group.updateMatrixWorld();
        tmpM.copy(ch.group.matrixWorld);
        var sc = ch.params.H / 1.75; tmpM.scale(tmpS.set(sc, sc, sc));
        farMesh.setMatrixAt(farCount, tmpM);
        farMesh.setColorAt(farCount, ch.farColor);
        farCount++;
      } else if (ch.lod !== level) ch.setLOD(level);
    }
    if (farMesh) {
      farMesh.count = farCount;
      farMesh.instanceMatrix.needsUpdate = true;
      if (farMesh.instanceColor) farMesh.instanceColor.needsUpdate = true;
    }
  }

  function release(char) {
    char.inUse = false;
    if (char.group.parent) char.group.parent.remove(char.group);
  }

  function triCount(char) {
    var total = 0;
    char.group.traverse(function (o) {
      if (o.isMesh && o.geometry) total += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    });
    return Math.round(total);
  }

  SH.CharFactory = {
    create: create, update: update, release: release, triCount: triCount,
    SKIN_TONES: SKIN_TONES, HAIR_COLORS: HAIR_COLORS, rng: rng, active: active
  };
})(window.SH = window.SH || {});
