// SELATARA HEAT — characters/rig.js  (Character System, Stage A)
// ONE procedural skeleton + lofted body geometry for EVERY human in the
// game (player, pedestrians, police, enemies, story cast). No external
// models: the body is a set of elliptical loft tubes built in bind-pose
// world space, smooth-skinned across two bones near every joint.
// Proportions: Loomis canon, 7.5 heads. Elbow at waist height, wrist at
// crotch height, knee mid-leg, hand as long as the face.
// Public API: SH.CharRig { buildSkeleton, bodyStations, tube, mergeParts,
//   buildBody, buildHead, hairGeometry, prim }
(function (SH) {
  'use strict';

  var V3 = THREE.Vector3;

  // ---- parameters -------------------------------------------------------
  // p: { H, legFrac, shoulder, waist, hips, belly, thigh, headScale,
  //      handScale, neckR } — multipliers around the Loomis base figure.
  function baseParams(p) {
    p = p || {};
    var H = p.H || 1.75;
    return {
      H: H, u: H / 7.5,
      legFrac: p.legFrac || 0.52,
      shoulder: p.shoulder || 1, waist: p.waist || 1, hips: p.hips || 1,
      belly: p.belly || 0, thigh: p.thigh || 1,
      headScale: p.headScale || 1, handScale: p.handScale || 1,
      neckR: p.neckR || 1
    };
  }

  // Joint heights (fractions of H), shared by skeleton + stations so the
  // geometry always matches the bones exactly.
  function joints(p) {
    var H = p.H, pelvisY = H * p.legFrac;
    return {
      pelvisY: pelvisY,
      spine1Y: pelvisY + H * 0.085,
      spine2Y: pelvisY + H * 0.165,
      neckY: pelvisY + H * 0.275,
      headY: pelvisY + H * 0.318,
      shoulderY: pelvisY + H * 0.255,
      shoulderX: 0.102 * H * p.shoulder,
      elbowY: pelvisY + H * 0.08,
      wristY: pelvisY - H * 0.025,
      hipX: 0.052 * H,
      kneeY: H * 0.295 * (p.legFrac / 0.52),
      ankleY: H * 0.062
    };
  }

  var BONE_NAMES = ['root', 'pelvis', 'spine1', 'spine2', 'neck', 'head',
    'clavL', 'uArmL', 'fArmL', 'handL', 'clavR', 'uArmR', 'fArmR', 'handR',
    'thighL', 'shinL', 'footL', 'toeL', 'thighR', 'shinR', 'footR', 'toeR'];

  function buildSkeleton(p) {
    p = baseParams(p);
    var j = joints(p), bones = {}, list = [];
    function bone(name, parent, x, y, z) {
      var b = new THREE.Bone(); b.name = name;
      b.position.set(x, y, z);
      if (parent) parent.add(b);
      bones[name] = b; list.push(b); return b;
    }
    var root = bone('root', null, 0, 0, 0);
    var pelvis = bone('pelvis', root, 0, j.pelvisY, 0);
    var spine1 = bone('spine1', pelvis, 0, j.spine1Y - j.pelvisY, 0);
    var spine2 = bone('spine2', spine1, 0, j.spine2Y - j.spine1Y, 0);
    var neck = bone('neck', spine2, 0, j.neckY - j.spine2Y, 0);
    bone('head', neck, 0, j.headY - j.neckY, 0);
    var sx = j.shoulderX, cx = sx * 0.45;
    var clavL = bone('clavL', spine2, cx, j.shoulderY - j.spine2Y, 0);
    var uArmL = bone('uArmL', clavL, sx - cx, 0, 0);
    bone('fArmL', uArmL, sx * 0.10, j.elbowY - j.shoulderY, 0);
    var fL = bones.fArmL;
    bone('handL', fL, -sx * 0.05, j.wristY - j.elbowY, 0);
    var clavR = bone('clavR', spine2, -cx, j.shoulderY - j.spine2Y, 0);
    var uArmR = bone('uArmR', clavR, -(sx - cx), 0, 0);
    bone('fArmR', uArmR, -sx * 0.10, j.elbowY - j.shoulderY, 0);
    var fR = bones.fArmR;
    bone('handR', fR, sx * 0.05, j.wristY - j.elbowY, 0);
    var hx = j.hipX;
    var thL = bone('thighL', pelvis, hx, -0.01 * p.H, 0);
    bone('shinL', thL, hx * 0.08, j.kneeY - j.pelvisY + 0.01 * p.H, 0);
    bone('footL', bones.shinL, hx * 0.04, j.ankleY - j.kneeY, 0.01 * p.H);
    bone('toeL', bones.footL, 0, -0.035 * p.H, 0.135 * p.H);
    var thR = bone('thighR', pelvis, -hx, -0.01 * p.H, 0);
    bone('shinR', thR, -hx * 0.08, j.kneeY - j.pelvisY + 0.01 * p.H, 0);
    bone('footR', bones.shinR, -hx * 0.04, j.ankleY - j.kneeY, 0.01 * p.H);
    bone('toeR', bones.footR, 0, -0.035 * p.H, 0.135 * p.H);
    root.updateMatrixWorld(true);
    var skeleton = new THREE.Skeleton(list);
    var index = {};
    for (var i = 0; i < list.length; i++) index[list[i].name] = i;
    return { root: root, bones: bones, list: list, skeleton: skeleton, index: index, joints: j, params: p };
  }

  // ---- loft stations ----------------------------------------------------
  // A station: { p:[x,y,z], rx, rz, a:'bone', b:'bone'|null, w:0..1 }
  // w = weight of bone b (a gets 1-w). Rings are built perpendicular to
  // the path tangent, side vector = world X (all our tubes run in the
  // sagittal plane), so rx spans X and rz spans the tangent-normal (Z for
  // vertical tubes, Y for the foot).
  function st(x, y, z, rx, rz, a, b, w) {
    return { p: [x, y, z], rx: rx, rz: rz, a: a, b: b || null, w: w || 0 };
  }

  function bodyStations(p) {
    p = baseParams(p);
    var j = joints(p), H = p.H;
    var sw = p.shoulder, ww = p.waist, hw = p.hips, bl = p.belly;
    var chestRx = 0.089 * H * (0.55 + 0.45 * sw) * (0.7 + 0.3 * ww);
    var waistRx = 0.072 * H * ww, hipRx = 0.086 * H * hw;
    var torso = [
      st(0, j.pelvisY - 0.055 * H, 0, hipRx * 0.94, 0.062 * H * hw, 'pelvis'),
      st(0, j.pelvisY, 0, hipRx, 0.066 * H * hw, 'pelvis'),
      st(0, j.pelvisY + 0.045 * H, 0, hipRx * 0.96, 0.064 * H, 'pelvis', 'spine1', 0.45),
      st(0, j.spine1Y, 0, waistRx, (0.056 + 0.030 * bl) * H * ww, 'spine1'),
      st(0, j.spine1Y + 0.040 * H, 0, waistRx * 1.06, (0.058 + 0.026 * bl) * H, 'spine1', 'spine2', 0.45),
      st(0, j.spine2Y, 0, chestRx, 0.062 * H * (0.8 + 0.2 * ww), 'spine2'),
      st(0, j.spine2Y + 0.045 * H, 0, chestRx * 0.99, 0.060 * H, 'spine2'),
      st(0, j.shoulderY, 0, chestRx * 0.82, 0.052 * H, 'spine2', 'neck', 0.35),
      st(0, j.neckY - 0.034 * H, 0, 0.041 * H, 0.037 * H, 'spine2', 'neck', 0.55),
      st(0, j.neckY - 0.012 * H, 0, 0.023 * H * p.neckR, 0.023 * H * p.neckR, 'neck'),
      st(0, j.headY - 0.010 * H, 0, 0.021 * H * p.neckR, 0.021 * H * p.neckR, 'neck', 'head', 0.4)
    ];
    function arm(side) { // side: +1 left, -1 right
      var s = side > 0 ? 'L' : 'R', sx = j.shoulderX * side;
      var ex = sx * 1.10, wx = sx * 1.05, dR = 0.034 * H;
      return [
        st(sx, j.shoulderY, 0, dR, dR, 'clav' + s, 'uArm' + s, 0.55),
        st(sx * 1.05, (j.shoulderY + j.elbowY) / 2, 0, 0.027 * H, 0.027 * H, 'uArm' + s),
        st(ex, j.elbowY + 0.012 * H, 0, 0.023 * H, 0.023 * H, 'uArm' + s, 'fArm' + s, 0.4),
        st(ex, j.elbowY - 0.014 * H, 0, 0.022 * H, 0.022 * H, 'fArm' + s),
        st((ex + wx) / 2, (j.elbowY + j.wristY) / 2, 0, 0.019 * H, 0.019 * H, 'fArm' + s),
        st(wx, j.wristY + 0.010 * H, 0, 0.0155 * H, 0.0155 * H, 'fArm' + s, 'hand' + s, 0.45),
        st(wx, j.wristY - 0.006 * H, 0, 0.0165 * H * p.handScale, 0.011 * H * p.handScale, 'hand' + s)
      ];
    }
    function leg(side) {
      var s = side > 0 ? 'L' : 'R', hx = j.hipX * side, tR = 0.053 * H * p.thigh;
      return [
        st(hx, j.pelvisY - 0.015 * H, 0, tR, tR * 1.05, 'pelvis', 'thigh' + s, 0.55),
        st(hx, j.pelvisY - 0.075 * H, 0, tR * 0.97, tR, 'thigh' + s),
        st(hx * 1.04, (j.pelvisY + j.kneeY) / 2, 0, tR * 0.82, tR * 0.86, 'thigh' + s),
        st(hx * 1.08, j.kneeY + 0.016 * H, 0, 0.036 * H, 0.037 * H, 'thigh' + s, 'shin' + s, 0.4),
        st(hx * 1.08, j.kneeY - 0.018 * H, 0, 0.039 * H, 0.040 * H, 'shin' + s),
        st(hx * 1.06, (j.kneeY + j.ankleY) / 2, 0, 0.027 * H, 0.028 * H, 'shin' + s),
        st(hx * 1.05, j.ankleY + 0.012 * H, 0, 0.020 * H, 0.021 * H, 'shin' + s, 'foot' + s, 0.45),
        st(hx * 1.05, j.ankleY, 0.012 * H, 0.023 * H, 0.020 * H, 'foot' + s),
        st(hx * 1.05, j.ankleY - 0.022 * H, 0.075 * H, 0.024 * H, 0.017 * H, 'foot' + s, 'toe' + s, 0.4),
        st(hx * 1.05, j.ankleY - 0.034 * H, 0.140 * H, 0.020 * H, 0.012 * H, 'toe' + s)
      ];
    }
    return { torso: torso, armL: arm(1), armR: arm(-1), legL: leg(1), legR: leg(-1), joints: j };
  }

  // ---- loft tube builder --------------------------------------------------
  // Builds one tube part from stations. Returns raw attribute arrays.
  function tube(stations, boneIndex, radial, capStart, capEnd) {
    radial = radial || 10;
    var pos = [], nor = [], uv = [], sIdx = [], sWgt = [], idx = [];
    var n = stations.length, i, k;
    var centers = [], tans = [];
    for (i = 0; i < n; i++) centers.push(new V3(stations[i].p[0], stations[i].p[1], stations[i].p[2]));
    for (i = 0; i < n; i++) {
      var a = centers[Math.max(0, i - 1)], b = centers[Math.min(n - 1, i + 1)];
      tans.push(new V3().subVectors(b, a).normalize());
    }
    var side = new V3(1, 0, 0), fwd = new V3();
    for (i = 0; i < n; i++) {
      var s = stations[i];
      fwd.crossVectors(tans[i], side).normalize();
      if (fwd.lengthSq() < 0.1) fwd.set(0, 0, 1);
      var ia = boneIndex[s.a], ib = s.b ? boneIndex[s.b] : ia, w = s.b ? s.w : 0;
      for (k = 0; k <= radial; k++) {
        var th = (k / radial) * Math.PI * 2, co = Math.cos(th), si = Math.sin(th);
        var ox = side.x * co * s.rx + fwd.x * si * s.rz;
        var oy = side.y * co * s.rx + fwd.y * si * s.rz;
        var oz = side.z * co * s.rx + fwd.z * si * s.rz;
        pos.push(centers[i].x + ox, centers[i].y + oy, centers[i].z + oz);
        var nl = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
        nor.push(ox / nl, oy / nl, oz / nl);
        uv.push(k / radial, i / (n - 1));
        sIdx.push(ia, ib, 0, 0); sWgt.push(1 - w, w, 0, 0);
      }
    }
    var ring = radial + 1;
    for (i = 0; i < n - 1; i++) {
      for (k = 0; k < radial; k++) {
        var r0 = i * ring + k, r1 = r0 + ring;
        idx.push(r0, r0 + 1, r1, r1, r0 + 1, r1 + 1);
      }
    }
    function cap(ci, flip) {
      var s = stations[ci], base = pos.length / 3;
      pos.push(s.p[0], s.p[1], s.p[2]);
      nor.push(tans[ci].x * flip, tans[ci].y * flip, tans[ci].z * flip);
      uv.push(0.5, ci / (n - 1));
      var ia = boneIndex[s.a], ib = s.b ? boneIndex[s.b] : ia, w = s.b ? s.w : 0;
      sIdx.push(ia, ib, 0, 0); sWgt.push(1 - w, w, 0, 0);
      var ringStart = ci * ring;
      for (k = 0; k < radial; k++) {
        if (flip < 0) idx.push(base, ringStart + k + 1, ringStart + k);
        else idx.push(base, ringStart + k, ringStart + k + 1);
      }
    }
    if (capStart) cap(0, -1);
    if (capEnd) cap(n - 1, 1);
    return { pos: pos, nor: nor, uv: uv, sIdx: sIdx, sWgt: sWgt, idx: idx };
  }

  // Merge raw parts (same attribute layout) into one BufferGeometry.
  function mergeParts(parts) {
    var pos = [], nor = [], uv = [], sIdx = [], sWgt = [], idx = [], col = [];
    var off = 0, i, q;
    for (q = 0; q < parts.length; q++) {
      var pt = parts[q];
      for (i = 0; i < pt.pos.length; i++) pos.push(pt.pos[i]);
      for (i = 0; i < pt.nor.length; i++) nor.push(pt.nor[i]);
      for (i = 0; i < pt.uv.length; i++) uv.push(pt.uv[i]);
      for (i = 0; i < pt.sIdx.length; i++) sIdx.push(pt.sIdx[i]);
      for (i = 0; i < pt.sWgt.length; i++) sWgt.push(pt.sWgt[i]);
      if (pt.col) for (i = 0; i < pt.col.length; i++) col.push(pt.col[i]);
      for (i = 0; i < pt.idx.length; i++) idx.push(pt.idx[i] + off);
      off += pt.pos.length / 3;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sIdx, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sWgt, 4));
    if (col.length === pos.length) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  }

  function paintPart(part, rgb) {
    var n = part.pos.length / 3, col = [];
    for (var i = 0; i < n; i++) col.push(rgb[0], rgb[1], rgb[2]);
    part.col = col; return part;
  }

  // Fingers for one hand (LOD0): 4 tapered fingers + thumb, rigid to the
  // hand bone, merged as one part. Built in bind world space.
  function fingersPart(p, boneIndex, side) {
    var j = joints(p), H = p.H, s = side > 0 ? 'L' : 'R';
    var wx = j.shoulderX * 1.05 * side, wy = j.wristY - 0.006 * H;
    var hs = p.handScale, parts = [];
    var spread = [-0.027, -0.009, 0.009, 0.027], lens = [0.052, 0.060, 0.056, 0.044];
    for (var f = 0; f < 4; f++) {
      var fx = wx + spread[f] * H * hs * 0.62, L = lens[f] * H * hs;
      var sts = [
        st(fx, wy - 0.028 * H * hs, 0.004 * H, 0.0075 * H * hs, 0.0068 * H * hs, 'hand' + s),
        st(fx, wy - 0.028 * H * hs - L * 0.55, 0.006 * H, 0.0066 * H * hs, 0.0060 * H * hs, 'hand' + s),
        st(fx, wy - 0.028 * H * hs - L, 0.007 * H, 0.0052 * H * hs, 0.0048 * H * hs, 'hand' + s)
      ];
      parts.push(tube(sts, boneIndex, 6, false, true));
    }
    var tx = wx - side * 0.020 * H * hs;
    var tst = [
      st(tx, wy - 0.016 * H * hs, 0.006 * H, 0.008 * H * hs, 0.0072 * H * hs, 'hand' + s),
      st(tx - side * 0.012 * H * hs, wy - 0.040 * H * hs, 0.012 * H, 0.0068 * H * hs, 0.0062 * H * hs, 'hand' + s),
      st(tx - side * 0.020 * H * hs, wy - 0.058 * H * hs, 0.016 * H, 0.0054 * H * hs, 0.0050 * H * hs, 'hand' + s)
    ];
    parts.push(tube(tst, boneIndex, 6, false, true));
    var merged = { pos: [], nor: [], uv: [], sIdx: [], sWgt: [], idx: [] };
    var off = 0;
    for (var q = 0; q < parts.length; q++) {
      var pt = parts[q];
      merged.pos = merged.pos.concat(pt.pos); merged.nor = merged.nor.concat(pt.nor);
      merged.uv = merged.uv.concat(pt.uv); merged.sIdx = merged.sIdx.concat(pt.sIdx);
      merged.sWgt = merged.sWgt.concat(pt.sWgt);
      for (var i = 0; i < pt.idx.length; i++) merged.idx.push(pt.idx[i] + off);
      off += pt.pos.length / 3;
    }
    return merged;
  }

  // ---- body ---------------------------------------------------------------
  function buildBody(p, boneIndex, skinRGB, withFingers) {
    p = baseParams(p);
    var S = bodyStations(p);
    var parts = [
      paintPart(tube(S.torso, boneIndex, 12, true, false), skinRGB),
      paintPart(tube(S.armL, boneIndex, 10, false, false), skinRGB),
      paintPart(tube(S.armR, boneIndex, 10, false, false), skinRGB),
      paintPart(tube(S.legL, boneIndex, 10, false, true), skinRGB),
      paintPart(tube(S.legR, boneIndex, 10, false, true), skinRGB)
    ];
    if (withFingers) {
      parts.push(paintPart(fingersPart(p, boneIndex, 1), skinRGB));
      parts.push(paintPart(fingersPart(p, boneIndex, -1), skinRGB));
    }
    var g = mergeParts(parts);
    g.computeVertexNormals();
    return g;
  }

  // ---- head ---------------------------------------------------------------
  // Scaled sphere: forehead a touch wide, jaw tapered in, small ears.
  // Built in bind world space; base verts blend neck->head. UVs are the
  // sphere's own: the face lives at u = 0.25 (the +Z meridian).
  function buildHead(p, boneIndex) {
    p = baseParams(p);
    var j = joints(p), H = p.H, u = p.u;
    var r = u * 0.52 * p.headScale;
    var cy = j.headY + u * 0.46;
    var geo = new THREE.SphereGeometry(r, 18, 14);
    var posA = geo.attributes.position;
    var v = new V3();
    var i;
    for (i = 0; i < posA.count; i++) {
      v.fromBufferAttribute(posA, i);
      var ny = v.y / r; // -1..1
      var xs = 0.84, zs = 0.92;
      if (ny < 0) { var t = -ny; xs *= 1 - 0.20 * t; zs *= 1 - 0.10 * t; }
      else if (ny > 0.25) xs *= 1 + 0.045 * (ny - 0.25);
      v.x *= xs; v.z *= zs;
      v.y = cy + v.y * 1.06;
      posA.setXYZ(i, v.x, v.y, v.z);
    }
    // ears: two small flattened spheres at eye level
    var earGeo = new THREE.SphereGeometry(r * 0.30, 8, 6);
    var parts = [geoPart(geo, p, boneIndex, cy)];
    parts.push(geoPart(earGeo, p, boneIndex, cy, [r * 0.86, cy + r * 0.02, 0], [0.38, 0.62, 0.20], [0.62, 0.45]));
    parts.push(geoPart(earGeo.clone(), p, boneIndex, cy, [-r * 0.86, cy + r * 0.02, 0], [0.38, 0.62, 0.20], [0.62, 0.45]));
    var g = mergeParts(parts);
    g.computeVertexNormals();
    return g;
  }

  // Convert a plain geometry (already in world/bind space, or placed via
  // offset+scale) into a skinned part weighted neck/head by height.
  function geoPart(geo, p, boneIndex, headCY, offset, scale, uvFixed) {
    var j = joints(p);
    var g = geo.index ? geo.toNonIndexed() : geo;
    var posA = g.attributes.position, norA = g.attributes.normal, uvA = g.attributes.uv;
    var part = { pos: [], nor: [], uv: [], sIdx: [], sWgt: [], idx: [] };
    var v = new V3();
    for (var i = 0; i < posA.count; i++) {
      v.fromBufferAttribute(posA, i);
      if (scale) v.set(v.x * scale[0], v.y * scale[1], v.z * scale[2]);
      if (offset) v.add(new V3(offset[0], offset[1], offset[2]));
      part.pos.push(v.x, v.y, v.z);
      var nrm = norA ? [norA.getX(i), norA.getY(i), norA.getZ(i)] : [0, 1, 0];
      part.nor.push(nrm[0], nrm[1], nrm[2]);
      if (uvFixed) part.uv.push(uvFixed[0], uvFixed[1]);
      else part.uv.push(uvA ? uvA.getX(i) : 0.25, uvA ? uvA.getY(i) : 0.5);
      var t = THREE.MathUtils.clamp((v.y - (j.headY - 0.02 * p.H)) / (0.05 * p.H), 0, 1);
      part.sIdx.push(boneIndex.neck, boneIndex.head, 0, 0);
      part.sWgt.push(1 - t, t, 0, 0);
      part.idx.push(i);
    }
    // rebuild triangles: toNonIndexed keeps order, so sequential triples
    part.idx = [];
    for (var q = 0; q < posA.count; q++) part.idx.push(q);
    return part;
  }

  // ---- hair (head-bone local space) ---------------------------------------
  // Primitives merged into one plain geometry; the mesh is parented to
  // the head bone, so geometry is authored around the head centre at
  // local origin (head bone sits at the neck joint; centre is +0.46u up).
  function prim(geo, x, y, z, sx, sy, sz, ry) {
    var m = new THREE.Matrix4();
    var q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry || 0, 0));
    m.compose(new V3(x, y, z), q, new V3(sx || 1, sy || 1, sz || 1));
    var g = geo.clone().applyMatrix4(m);
    return g.index ? g.toNonIndexed() : g;
  }
  function mergePlain(geos) {
    var pos = [], nor = [], uvA = [], idx = [], off = 0;
    for (var q = 0; q < geos.length; q++) {
      var g = geos[q], pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv;
      for (var i = 0; i < pa.count; i++) {
        pos.push(pa.getX(i), pa.getY(i), pa.getZ(i));
        nor.push(na ? na.getX(i) : 0, na ? na.getY(i) : 1, na ? na.getZ(i) : 0);
        uvA.push(ua ? ua.getX(i) : 0, ua ? ua.getY(i) : 0);
        idx.push(off + i);
      }
      off += pa.count;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
    geo.setIndex(idx);
    return geo;
  }

  // Drop triangles whose centroid falls inside the face window, so a
  // cloth shell (hijab) can wrap the head yet leave the face open.
  function cutFaceWindow(geo, r, cy) {
    var g = geo.index ? geo.toNonIndexed() : geo;
    var pa = g.attributes.position, keep = [];
    for (var i = 0; i < pa.count; i += 3) {
      var cx = (pa.getX(i) + pa.getX(i + 1) + pa.getX(i + 2)) / 3;
      var cyy = (pa.getY(i) + pa.getY(i + 1) + pa.getY(i + 2)) / 3;
      var cz = (pa.getZ(i) + pa.getZ(i + 1) + pa.getZ(i + 2)) / 3;
      var inWindow = cz > r * 0.52 && Math.abs(cx) < r * 0.68 && cyy < cy + r * 0.52 && cyy > cy - r * 0.85;
      if (!inWindow) keep.push(i);
    }
    var pos = [], nor = [], uvA = [], idx = [];
    var na = g.attributes.normal, ua = g.attributes.uv;
    for (var q = 0; q < keep.length; q++) {
      for (var k = 0; k < 3; k++) {
        var vi = keep[q] + k;
        pos.push(pa.getX(vi), pa.getY(vi), pa.getZ(vi));
        nor.push(na ? na.getX(vi) : 0, na ? na.getY(vi) : 1, na ? na.getZ(vi) : 0);
        uvA.push(ua ? ua.getX(vi) : 0, ua ? ua.getY(vi) : 0);
        idx.push(pos.length / 3 - 1);
      }
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
    out.setIndex(idx);
    return out;
  }

  function hairGeometry(style, p) {
    p = baseParams(p);
    var u = p.u, r = u * 0.52 * p.headScale, cy = u * 0.46;
    // Cap = open DOME (partial sphere), never a closed shell: a full
    // sphere would swallow the face. Rim sits just above the eye line.
    var dome = new THREE.SphereGeometry(r * 1.07, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.52);
    var cap = prim(dome, 0, cy + r * 0.16, -r * 0.05, 0.90, 0.96, 0.98);
    var parts = [];
    switch (style) {
      case 'bald': return null;
      case 'short': parts.push(cap); break;
      case 'quiff':
        parts.push(cap);
        parts.push(prim(new THREE.BoxGeometry(r * 0.9, r * 0.34, r * 0.7), 0, cy + r * 0.80, r * 0.40, 1, 1, 1, 0));
        break;
      case 'long':
        parts.push(cap);
        parts.push(prim(new THREE.BoxGeometry(r * 1.62, r * 1.5, r * 0.5), 0, cy - r * 0.45, -r * 0.80, 1, 1, 1, 0));
        parts.push(prim(new THREE.BoxGeometry(r * 0.34, r * 1.1, r * 0.9), r * 0.82, cy - r * 0.3, -r * 0.1, 1, 1, 1, 0));
        parts.push(prim(new THREE.BoxGeometry(r * 0.34, r * 1.1, r * 0.9), -r * 0.82, cy - r * 0.3, -r * 0.1, 1, 1, 1, 0));
        break;
      case 'ponytail':
        parts.push(cap);
        parts.push(prim(new THREE.CapsuleGeometry(r * 0.20, r * 0.9, 3, 8), 0, cy - r * 0.25, -r * 0.95, 1, 1, 1, 0));
        break;
      case 'bun':
        parts.push(cap);
        parts.push(prim(new THREE.SphereGeometry(r * 0.42, 10, 8), 0, cy + r * 0.86, -r * 0.38, 1, 0.9, 1, 0));
        break;
      case 'afro':
        parts.push(prim(new THREE.SphereGeometry(r * 1.20, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), 0, cy + r * 0.34, -r * 0.04, 1.0, 0.95, 1.0));
        break;
      case 'hijab': // cloth shell with a cut face window + neck drape
        var shell = prim(new THREE.SphereGeometry(r * 1.13, 16, 12), 0, cy + r * 0.06, -r * 0.09, 0.96, 1.04, 1.02);
        parts.push(cutFaceWindow(shell, r, cy));
        parts.push(prim(new THREE.CylinderGeometry(r * 1.04, r * 1.26, r * 1.10, 12, 1, true), 0, cy - r * 0.66, -r * 0.08, 1, 1, 1, 0));
        break;
      case 'peci':
        parts.push(prim(new THREE.CylinderGeometry(r * 0.86, r * 0.90, r * 0.52, 14), 0, cy + r * 0.62, 0, 1, 1, 1, 0));
        break;
      case 'cap':
        parts.push(cap);
        parts.push(prim(new THREE.CylinderGeometry(r * 1.05, r * 1.05, r * 0.07, 14, 1, false, 0, Math.PI), 0, cy + r * 0.34, r * 0.55, 1, 1, 1.4, 0));
        break;
      default: parts.push(cap);
    }
    return mergePlain(parts);
  }

  SH.CharRig = {
    baseParams: baseParams, joints: joints, BONE_NAMES: BONE_NAMES,
    buildSkeleton: buildSkeleton, bodyStations: bodyStations, st: st,
    tube: tube, mergeParts: mergeParts, paintPart: paintPart,
    buildBody: buildBody, buildHead: buildHead,
    hairGeometry: hairGeometry, prim: prim, mergePlain: mergePlain
  };
})(window.SH = window.SH || {});
