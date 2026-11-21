// SELATARA HEAT — characters/rig.js  (Character System, Stage A)
// ONE procedural skeleton + lofted body geometry for EVERY human in the
// game (player, pedestrians, police, enemies, story cast). No external
// models: the body is a set of elliptical loft tubes built in bind-pose
// world space, smooth-skinned across two bones near every joint.
// Proportions: APPEAL PASS stylized, +-6 heads (see HEAD_RF). Elbow at
// waist height, wrist at crotch height, knee mid-leg.
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
      neckR: p.neckR || 1,
      // FX6 head & face upgrade: per-character head variation,
      // resolved by the factory from archetype + seed (never by
      // callers directly). headJit = [x,y,z] scale jitter around
      // the shared headDims factors (+-6%); jawF/jawBump/chinW =
      // jaw class (square / oval / taper). Defaults reproduce the
      // pre-FX6 head exactly.
      headJit: p.headJit || null,
      jawF: p.jawF != null ? p.jawF : null,
      jawBump: p.jawBump != null ? p.jawBump : null,
      chinW: p.chinW != null ? p.chinW : null
    };
  }

  // Joint heights (fractions of H), shared by skeleton + stations so the
  // geometry always matches the bones exactly.
  function joints(p) {
    var H = p.H, pelvisY = H * p.legFrac;
    return {
      pelvisY: pelvisY,
      // Iterasi 2 (user spec): the torso is LENGTHENED — spine
      // stations spread (spine1 0.085->0.100H, spine2 0.165->0.225H,
      // neck 0.272->0.335H rel pelvis) so shoulder->waist grows
      // from 0.30 m to ~0.41 m and, just as importantly, the crown
      // now actually reaches H: headY = pelvisY+0.346H puts the
      // displaced head's top (headY + 0.46u + 0.96*r0) at ~1.00H
      // instead of the old 0.94H (the "1.75 m" figure really stood
      // ~1.64 m). Elbow sits at waist height (spine1), wrist at
      // crotch height, as before.
      spine1Y: pelvisY + H * 0.100,
      spine2Y: pelvisY + H * 0.225,
      // Round 10: the neck segment is COMPRESSED toward the
      // references — neckY up 0.016H and headY down 0.014H, so the
      // visible collar->jaw column halves (~104 mm -> ~52 mm on
      // the H=1.75 figure, probe10-measured). The head now sits
      // LOW, close to the shoulder line, and the trapezius slope
      // (stations keyed to neckY) rises to meet it, as in both
      // reference figures. (Through round 9 the head perched on a
      // 0.041H neck segment — a straight column the a9 front shot
      // reads as a peg, however clean its seams were.)
      // APPEAL PASS: headY/neckY drop a further 0.010H — the head
      // grew (HEAD_RF 0.57 -> 0.65, ~6-head stylized proportions),
      // and the crown must still land at ~1.00H. The neck segment
      // keeps its round-10 compressed length (headY-neckY 0.011H).
      neckY: pelvisY + H * 0.325,
      headY: pelvisY + H * 0.336,
      shoulderY: pelvisY + H * 0.318,
      // Round 8: the arm PIVOT (glenohumeral joint) sits at ARMPIT
      // height, 0.050H BELOW the clavicle/shoulder line — as in the
      // reference mannequin, where the shoulder ball hangs at the
      // END of the trapezius slope instead of sitting on top of it.
      // (Rounds 4-7 pivoted the arm AT neck height: the capped
      // first arm station was a flat skin disc of r 0.040H at
      // neck-base height, and every cloth slope built over it was
      // pierced by that disc.)
      armY: pelvisY + H * 0.262,
      // Iterasi 2: shoulders a touch wider (0.102 -> 0.107H)
      shoulderX: 0.107 * H * p.shoulder,
      elbowY: pelvisY + H * 0.100,
      wristY: pelvisY - H * 0.025,
      // Iterasi 2: stance narrowed (0.052 -> 0.046H) — feet land
      // closer together, soles parallel, per the spec's idle stance
      hipX: 0.046 * H,
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
    var uArmL = bone('uArmL', clavL, sx - cx, j.armY - j.shoulderY, 0);
    // Round 10: elbow/wrist pushed outboard (1.10/1.05 -> 1.16/1.15
    // shoulderX) so the hanging arm takes the references' light
    // A-angle with clear air between upper arm and torso. Bone
    // offsets and the arm() stations move together — bind
    // geometry must sit exactly on the bones or skinning shears.
    bone('fArmL', uArmL, sx * 0.16, j.elbowY - j.armY, 0);
    var fL = bones.fArmL;
    bone('handL', fL, -sx * 0.01, j.wristY - j.elbowY, 0);
    var clavR = bone('clavR', spine2, -cx, j.shoulderY - j.spine2Y, 0);
    var uArmR = bone('uArmR', clavR, -(sx - cx), j.armY - j.shoulderY, 0);
    bone('fArmR', uArmR, -sx * 0.16, j.elbowY - j.armY, 0);
    var fR = bones.fArmR;
    bone('handR', fR, sx * 0.01, j.wristY - j.elbowY, 0);
    var hx = j.hipX;
    var thL = bone('thighL', pelvis, hx, -0.01 * p.H, 0);
    bone('shinL', thL, hx * 0.03, j.kneeY - j.pelvisY + 0.01 * p.H, 0);
    bone('footL', bones.shinL, hx * 0.02, j.ankleY - j.kneeY, 0.01 * p.H);
    bone('toeL', bones.footL, 0, -0.035 * p.H, 0.135 * p.H);
    var thR = bone('thighR', pelvis, -hx, -0.01 * p.H, 0);
    bone('shinR', thR, -hx * 0.03, j.kneeY - j.pelvisY + 0.01 * p.H, 0);
    bone('footR', bones.shinR, -hx * 0.02, j.ankleY - j.kneeY, 0.01 * p.H);
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
    // Round 10: chest->waist taper sharpened toward the
    // references (chest 0.104->0.108H wide, waist 0.084->0.080H,
    // depth contrast likewise) — the a9 torso read as a straight
    // tube between two similar rings.
    var chestRx = 0.108 * H * (0.55 + 0.45 * sw) * (0.7 + 0.3 * ww);
    var waistRx = 0.080 * H * ww, hipRx = 0.099 * H * hw;
    var torso = [
      st(0, j.pelvisY - 0.055 * H, 0, hipRx * 0.94, 0.072 * H * hw, 'pelvis'),
      st(0, j.pelvisY, 0, hipRx, 0.076 * H * hw, 'pelvis'),
      st(0, j.pelvisY + 0.045 * H, 0, hipRx * 0.96, 0.073 * H, 'pelvis', 'spine1', 0.45),
      st(0, j.spine1Y, 0, waistRx, (0.061 + 0.032 * bl) * H * ww, 'spine1'),
      st(0, j.spine1Y + 0.055 * H, 0, waistRx * 1.06, (0.064 + 0.028 * bl) * H, 'spine1', 'spine2', 0.45),
      st(0, j.spine2Y, 0, chestRx, 0.073 * H * (0.8 + 0.2 * ww), 'spine2'),
      st(0, j.spine2Y + 0.045 * H, 0, chestRx * 0.99, 0.069 * H, 'spine2'),
      // TRAPEZIUS SLOPE as real loft geometry: from the shoulder
      // line the rings climb INWARD and UP in even steps to the
      // neck base, so the front silhouette descends diagonally
      // from the neck to the shoulder point (0.030H of drop) and
      // no horizontal segment survives. (Up to round 4 the wide
      // shoulder ring sat AT neck height with a dip behind it —
      // the top envelope was flat from arm to arm and the head
      // perched on a peg: the pawn / coat-hanger read.)
      st(0, j.neckY - 0.046 * H, 0, 0.086 * H, 0.060 * H, 'spine2', 'neck', 0.20),
      st(0, j.neckY - 0.030 * H, 0, 0.068 * H, 0.052 * H, 'spine2', 'neck', 0.40),
      st(0, j.neckY - 0.019 * H, 0, 0.052 * H, 0.045 * H, 'spine2', 'neck', 0.60),
      // Round 10: the neck is a short thick FRUSTUM, not the
      // round-7 taper column — the slope stations climb closer
      // under the lowered head, and the four neck stations run
      // 0.036 -> 0.027H over just 0.024H of height (the whole
      // visible segment), widening steadily into the base so the
      // trapezius flows into the head instead of the head sitting
      // on a peg. Top rim (neckY+0.010H) lands almost exactly on
      // the head sphere's surface at that height; the funnel
      // seals the interior as before.
      st(0, j.neckY - 0.014 * H, 0, 0.036 * H * p.neckR, 0.036 * H * p.neckR, 'spine2', 'neck', 0.75),
      st(0, j.neckY - 0.004 * H, 0, 0.032 * H * p.neckR, 0.032 * H * p.neckR, 'neck'),
      st(0, j.neckY + 0.003 * H, 0, 0.029 * H * p.neckR, 0.029 * H * p.neckR, 'neck', 'head', 0.25),
      st(0, j.neckY + 0.010 * H, 0, 0.027 * H * p.neckR, 0.027 * H * p.neckR, 'neck', 'head', 0.4)
    ];
    function arm(side) { // side: +1 left, -1 right
      var s = side > 0 ? 'L' : 'R', sx = j.shoulderX * side;
      // Round 10: elbow 1.10 -> 1.16, wrist 1.05 -> 1.15 (matches
      // the skeleton offsets in buildSkeleton) — the light
      // A-angle hang of the references.
      var ex = sx * 1.16, wx = sx * 1.15;
      // Round 8 — the deltoid is rebuilt UNDER the trapezius line.
      // The straight line from the neck base (0.035H, neckY-0.010H)
      // to the shoulder tip (0.125H, neckY-0.052H) drops 0.467 per
      // unit of x. Every point of the arm's top surface must stay
      // BELOW that line:
      //  - station 0 sits at the lowered pivot (armY = neckY-0.051H)
      //    with radius cut 0.040H -> 0.032H, and its ring + cap fan
      //    are TILTED by the slope angle (0.42 rad), so the cap is a
      //    slanted disc lying ALONG the line: its inboard edge tucks
      //    just under the torso slope wall (they meet at x~0.070H)
      //    and its outboard edge drops to neckY-0.064H — the cap
      //    CONTINUES the trapezius slope instead of capping it with
      //    a horizontal shelf at neck height (the rounds 4-7 disc).
      //  - station 1 (deltoid belly, the widest arm ring) is a full
      //    0.036H below the pivot, entirely under the line.
      //  - the tube then descends along the torso's side at armpit
      //    height; it never re-enters the shoulder's top surface.
      var st0 = st(sx * 0.97, j.armY, 0, 0.032 * H, 0.032 * H, 'clav' + s, 'uArm' + s, 0.60);
      st0.tiltZ = -side * 0.42;
      // Round 9: dome the deltoid cap (see tube()'s capLift). The
      // dome peak stays ~8 mm BELOW the trapezius line at its x —
      // the slope silhouette the parent passed in round 8 is not
      // raised; only the flat-disc slice through the torso wall
      // becomes a convex ball emerging from it, which softens the
      // notch dents at the arm root.
      st0.capLift = 0.007 * H;
      var arr = [
        st0,
        st(sx * 1.05, j.armY - 0.036 * H, 0, 0.0365 * H, 0.0365 * H, 'uArm' + s),
        st(sx * 1.10, (j.armY + j.elbowY) / 2, 0, 0.030 * H, 0.030 * H, 'uArm' + s),
        st(ex, j.elbowY + 0.012 * H, 0, 0.0265 * H, 0.0265 * H, 'uArm' + s, 'fArm' + s, 0.4),
        st(ex, j.elbowY - 0.014 * H, 0, 0.0255 * H, 0.0255 * H, 'fArm' + s),
        st((ex + wx) / 2, (j.elbowY + j.wristY) / 2, 0, 0.0225 * H, 0.0225 * H, 'fArm' + s),
        st(wx, j.wristY + 0.010 * H, 0, 0.018 * H, 0.018 * H, 'fArm' + s, 'hand' + s, 0.45),
        // Iterasi 2: the palm is LENGTHENED (stations reach
        // wristY-0.048H) so wrist->mitten-tip measures ~0.17 m —
        // the spec's 0.18 m hand. The mitten itself is mittenPart.
        st(wx, j.wristY - 0.020 * H, 0.001 * H, 0.0265 * H * p.handScale, 0.0155 * H * p.handScale, 'hand' + s),
        st(wx, j.wristY - 0.048 * H, 0.002 * H, 0.0245 * H * p.handScale, 0.0145 * H * p.handScale, 'hand' + s)
      ];
      return arr;
    }
    function leg(side) {
      var s = side > 0 ? 'L' : 'R', hx = j.hipX * side;
      // Iterasi 2 (user spec, absolute ring radii): thigh 9-10 cm,
      // knee 7 cm with a soft forward bump, calf 6.5 cm with the
      // muscle pushed slightly BACK, ankle 4.5 cm. At H=1.75:
      // thigh 0.054H = 9.5 cm, knee 0.040H = 7.0, calf 0.037H =
      // 6.5, ankle 0.0257H = 4.5. The stance is near-vertical now
      // (x multipliers ~1.00-1.02, was 1.04-1.08): feet land under
      // the hips, close together, soles parallel.
      var tR = 0.054 * H * p.thigh;
      return [
        st(hx, j.pelvisY - 0.015 * H, 0, tR, tR * 1.05, 'pelvis', 'thigh' + s, 0.55),
        st(hx, j.pelvisY - 0.075 * H, 0, tR * 0.97, tR, 'thigh' + s),
        st(hx * 1.01, (j.pelvisY + j.kneeY) / 2, 0, tR * 0.82, tR * 0.86, 'thigh' + s),
        st(hx * 1.02, j.kneeY + 0.016 * H, 0.006 * H, 0.040 * H, 0.041 * H, 'thigh' + s, 'shin' + s, 0.4),
        st(hx * 1.02, j.kneeY - 0.018 * H, -0.010 * H, 0.037 * H, 0.038 * H, 'shin' + s),
        st(hx * 1.01, (j.kneeY + j.ankleY) / 2, -0.004 * H, 0.028 * H, 0.029 * H, 'shin' + s),
        st(hx * 1.00, j.ankleY + 0.012 * H, 0, 0.0257 * H, 0.026 * H, 'shin' + s, 'foot' + s, 0.45),
        st(hx * 1.00, j.ankleY, 0.012 * H, 0.025 * H, 0.021 * H, 'foot' + s),
        st(hx * 1.00, j.ankleY - 0.022 * H, 0.075 * H, 0.026 * H, 0.017 * H, 'foot' + s, 'toe' + s, 0.4),
        st(hx * 1.00, j.ankleY - 0.034 * H, 0.140 * H, 0.021 * H, 0.012 * H, 'toe' + s)
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
    var side = new V3(1, 0, 0), fwd = new V3(), prevFwd = null;
    for (i = 0; i < n; i++) {
      var s = stations[i];
      fwd.crossVectors(tans[i], side).normalize();
      if (fwd.lengthSq() < 0.1) fwd.set(0, 0, 1);
      // Frame continuity: where the centre path reverses direction
      // (the torso at the trapezius dip: up to the shoulder line,
      // down into the dip, back up the neck) the raw tangent flips
      // and fwd flips with it, mirroring the ring's angular
      // assignment. The band between the flipped rings then joins
      // front vertices to back vertices — a twisted web across the
      // tube instead of a wall. (This was the true source of both
      // the neck-base spike triangles and the skin slope showing
      // through the cloth from above; the ring vertex SETS are
      // identical either way, which is why vertex-level probes
      // looked healthy.) Negate fwd back so every ring of the tube
      // shares one angular frame.
      if (prevFwd && fwd.dot(prevFwd) < 0) fwd.negate();
      prevFwd = fwd.clone();
      var ia = boneIndex[s.a], ib = s.b ? boneIndex[s.b] : ia, w = s.b ? s.w : 0;
      for (k = 0; k <= radial; k++) {
        var th = (k / radial) * Math.PI * 2, co = Math.cos(th), si = Math.sin(th);
        var ox = side.x * co * s.rx + fwd.x * si * s.rz;
        var oy = side.y * co * s.rx + fwd.y * si * s.rz;
        var oz = side.z * co * s.rx + fwd.z * si * s.rz;
        if (s.tiltZ) {
          // Optional ring tilt around Z (all our paths run in the
          // z=0 plane, so plain rings are always horizontal). The
          // sleeve origin ring uses it to lie parallel to the
          // trapezius diagonal — outer edge down, inner edge up —
          // instead of capping the shoulder with a flat disc. The
          // cap fan reuses these ring vertices, so the cap tilts
          // with the ring. (The offset doubles as the authored
          // normal direction, so rotating it keeps normals right.)
          var ct = Math.cos(s.tiltZ), sn = Math.sin(s.tiltZ);
          var rxx = ox * ct - oy * sn, ryy = ox * sn + oy * ct;
          ox = rxx; oy = ryy;
        }
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
      // Optional dome: a station may carry capLift, pushing the
      // fan centre OUT of the tube along the tangent (flip already
      // points out of the tube at both ends). The flat fan then
      // becomes a shallow cone — used for the deltoid cap, whose
      // flat disc used to slice through the curved torso wall and
      // leave angular notch dents at the arm root (round 9).
      var lift = (s.capLift || 0) * flip;
      pos.push(s.p[0] + tans[ci].x * lift, s.p[1] + tans[ci].y * lift, s.p[2] + tans[ci].z * lift);
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

  // APPEAL PASS fake AO: like paintPart, but each loft RING is scaled
  // by factors[ring] (values < 1 darken). tube() emits ring-major
  // vertices (ringVerts per ring), then cap-centre vertices — caps
  // take the nearest end ring's factor. Used to bake soft occlusion
  // into armpits, elbow/knee creases, under-chin and under-collar
  // zones so forms read "expensive" without any shadow pass.
  function shadePart(part, rgb, factors, ringVerts) {
    var n = part.pos.length / 3, col = [];
    var rings = Math.floor(n / ringVerts);
    for (var i = 0; i < n; i++) {
      var ring = Math.min(Math.floor(i / ringVerts), factors.length - 1);
      if (i >= rings * ringVerts) ring = (i - rings * ringVerts) === 0 ? 0 : factors.length - 1;
      var f = factors[ring];
      col.push(rgb[0] * f, rgb[1] * f, rgb[2] * f);
    }
    part.col = col; return part;
  }

  // Mitten hand for one hand (LOD0): Iterasi 2 replaces the five
  // separate finger tubes with ONE tapered mitten (continuing the
  // palm stations of arm()) + a separate thumb — the spec's own
  // poly lever ("mitten dengan jempol terpisah cukup"). The mitten
  // tip lands at wristY-0.090H, so wrist->tip ~0.17 m at H=1.75.
  // Rigid to the hand bone, merged as one part, bind world space.
  function mittenPart(p, boneIndex, side) {
    var j = joints(p), H = p.H, s = side > 0 ? 'L' : 'R';
    var wx = j.shoulderX * 1.15 * side, wy = j.wristY; // round 10: matches the A-angled wrist station
    var hs = p.handScale, parts = [];
    var palm = [
      st(wx, wy - 0.048 * H, 0.002 * H, 0.0245 * H * hs, 0.0145 * H * hs, 'hand' + s),
      st(wx, wy - 0.070 * H, 0.003 * H, 0.0220 * H * hs, 0.0135 * H * hs, 'hand' + s),
      st(wx, wy - 0.090 * H, 0.004 * H, 0.0175 * H * hs, 0.0115 * H * hs, 'hand' + s)
    ];
    parts.push(tube(palm, boneIndex, 7, false, true));
    var tx = wx - side * 0.020 * H * hs;
    var tst = [
      st(tx, wy - 0.030 * H, 0.006 * H, 0.0080 * H * hs, 0.0072 * H * hs, 'hand' + s),
      st(tx - side * 0.010 * H * hs, wy - 0.048 * H, 0.012 * H, 0.0068 * H * hs, 0.0062 * H * hs, 'hand' + s),
      st(tx - side * 0.015 * H * hs, wy - 0.062 * H, 0.016 * H, 0.0054 * H * hs, 0.0050 * H * hs, 'hand' + s)
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
  function buildBody(p, boneIndex, skinRGB, withFingers, coarse) {
    p = baseParams(p);
    var S = bodyStations(p);
    // Stage D iteration 3: the LOD1 body drops ring resolution
    // (torso 12 -> 8, limbs 9 -> 7). Segment count only — station
    // radii and skin weights are untouched, so silhouettes and
    // cloth margins are unaffected.
    var radT = coarse ? 8 : 12, radL = coarse ? 7 : 9;
    // APPEAL PASS fake AO (ring factors, station order): torso
    // darkens into the neck/under-chin zone (stations 10-13) and a
    // touch at the pelvis underside; arms darkest at the armpit
    // root (0) with an elbow-crease dip (3-4); legs dip at the hip
    // crease (0) and knee (3-4). Subtle — 0.80 worst case.
    // PREMIUM PASS: the same zones deepened one notch (neck end
    // 0.88->0.81, arm root 0.80->0.75, hip crease 0.92->0.88) —
    // vertex-colour data only; stations, radii and skin weights
    // are untouched.
    var aoTorso = [0.94, 1, 1, 1, 1, 1, 1, 0.99, 0.97, 0.95, 0.91, 0.88, 0.85, 0.81];
    var aoArm = [0.75, 0.86, 0.96, 0.90, 0.94, 1, 1, 1, 1];
    var aoLeg = [0.88, 0.95, 1, 0.90, 0.94, 1, 1, 1, 1, 1];
    var parts = [
      // torso capped at BOTH ends: the top cap seals the neck tube
      // under the head's neck funnel, so no camera angle can see
      // through the annulus between the jaw and the neck ring
      shadePart(tube(S.torso, boneIndex, radT, true, true), skinRGB, aoTorso, radT + 1),
      // arm tubes capped at the shoulder: with the trapezius slope
      // the arm's open top ring sits exposed beside the slope for
      // sleeveless tops — the cap seals it as a deltoid top (it
      // stays hidden inside the torso/sleeve volume otherwise)
      // Iterasi 2 poly trim: arm/leg tubes radial 10 -> 9 (thin
      // parts; the silhouette is carried by the station radii)
      shadePart(tube(S.armL, boneIndex, radL, true, false), skinRGB, aoArm, radL + 1),
      shadePart(tube(S.armR, boneIndex, radL, true, false), skinRGB, aoArm, radL + 1),
      shadePart(tube(S.legL, boneIndex, radL, false, true), skinRGB, aoLeg, radL + 1),
      shadePart(tube(S.legR, boneIndex, radL, false, true), skinRGB, aoLeg, radL + 1)
    ];
    if (withFingers) {
      // CHARPOLISH two-tone skin: hands carry the same 1.09 lift
      // as the face — bare skin reads slightly lighter than the
      // covered arm above it.
      var skinHand = [Math.min(1, skinRGB[0] * 1.09), Math.min(1, skinRGB[1] * 1.09), Math.min(1, skinRGB[2] * 1.09)];
      parts.push(paintPart(mittenPart(p, boneIndex, 1), skinHand));
      parts.push(paintPart(mittenPart(p, boneIndex, -1), skinHand));
    }
    var g = mergeParts(parts);
    g.computeVertexNormals();
    return g;
  }

  // ---- neck funnel --------------------------------------------------------
  // ONE continuous skin loft from the jaw underside down into the
  // torso: the seam is tucked inside the head sphere (see below),
  // the loft pinches in at the throat, then runs DOWN as a narrow
  // column (radius close to the jaw's underside) and flares ONLY
  // at its base, merging into the trapezius slope inside the
  // torso wall. Below the throat it stays a clear 6+ mm inside
  // the torso tube — never hugging it (near-parallel shells
  // interleave in the depth buffer) — and its only transversal
  // crossing is the torso's top cap disc, which it pierces on the
  // way down from the sphere. The visible neck surface is the
  // torso loft's own top stations; the funnel backs the throat
  // and seals the jaw->collar interval. (Round 4's funnel flared
  // to 0.0305H immediately under the jaw — a short wide cup the
  // head sat in. This replaces the old joint — sphere bottom pole
  // floating above a separate open neck pipe — which left a
  // see-through annulus between chin and collar.)
  // Skin weights follow the same height curve geoPart uses, so the
  // funnel deforms together with the sphere above and neck below.
  function neckFunnel(p, boneIndex, cy, r) {
    var j = joints(p), H = p.H;
    var nR = p.neckR;
    function cross(ny, pad) { // HEAD PASS: cross-section of the DISPLACED head at polar ny (-1..0)
      var c = headCross(ny, headDims(p));
      return [c[0] + pad, c[1] + pad];
    }
    function wAt(y) { return THREE.MathUtils.clamp((y - (j.headY - 0.02 * H)) / (0.05 * H), 0, 1); }
    function ring(ny, pad) {
      var y = cy + ny * r * 1.06, c = cross(ny, pad);
      return st(0, y, 0, c[0], c[1], 'neck', 'head', wAt(y));
    }
    // The seam is TUCKED INSIDE the sphere: the first ring sits
    // ~4 mm INSIDE the sphere surface and the second emerges just
    // proud of it near the pole, so the funnel crosses the sphere
    // transversally in one clean circle. (The first version hugged
    // the sphere at +2.8 mm over three rings — two near-parallel
    // shells that interleaved per-triangle in the depth buffer and
    // rendered as a woven lattice of teeth under the jaw.)
    // Round 6: the two sphere rings sit exactly ON the head sphere's
    // own latitude rings (SphereGeometry(.,18,14): ny = cos(k*pi/14),
    // k=11 -> -0.782, k=12 -> -0.901). The emergence ring therefore
    // coincides with the sphere's own edge loop at the jaw underside
    // instead of crossing a facet band mid-way — the mid-band crossing
    // (old -0.92) tessellated against the sphere's facets and read as
    // a dark zigzag seam under the jaw. The column below is narrowed.
    // HEAD PASS: the sphere is now (20,16) — its underside latitude
    // rings are ny = cos(k*pi/16): k=13 -> -0.831, k=14 -> -0.924.
    // Round 10: the lower stations are keyed to headY, not
    // neckY — the neck segment compressed (headY-neckY now
    // 0.011H), so the old neckY+0.010H station would sit ABOVE
    // the throat pinch and invert the path. Same descent shape,
    // re-based: the funnel still ends deep inside the torso
    // (headY-0.078H = neckY-0.067H, wall ~0.10H there).
    var sts = [
      ring(-0.831, -0.0025 * H),
      ring(-0.924, 0.0015 * H),
      st(0, j.headY - 0.018 * H, 0, 0.0155 * H * nR, 0.0165 * H * nR, 'neck', 'head', wAt(j.headY - 0.018 * H)),
      st(0, j.headY - 0.028 * H, 0, 0.019 * H * nR, 0.020 * H * nR, 'neck', 'head', wAt(j.headY - 0.028 * H)),
      st(0, j.headY - 0.040 * H, 0, 0.023 * H * nR, 0.024 * H * nR, 'neck'),
      st(0, j.headY - 0.052 * H, 0, 0.030 * H * nR, 0.030 * H * nR, 'neck'),
      st(0, j.headY - 0.064 * H, 0, 0.045 * H * nR, 0.044 * H * nR, 'neck'),
      st(0, j.headY - 0.078 * H, 0, 0.060 * H * nR, 0.057 * H * nR, 'neck')
    ];
    // Radial 18 = the head sphere's own width segments, and the
    // first band is lengthened (pinch at headY-0.018H): at radial 12
    // the short emergence band faceted against the sphere's rhythm
    // and read as a dark zigzag fringe under the jaw (round 6).
    var part = tube(sts, boneIndex, 18, false, false);
    // pin every UV to a plain-skin point of the face canvas (the same
    // point the ears use) so the funnel shades as bare neck skin
    for (var i = 0; i < part.uv.length; i += 2) { part.uv[i] = 0.62; part.uv[i + 1] = 0.45; }
    return part;
  }

  // ---- head ---------------------------------------------------------------
  // HEAD PASS (user spec 2026-11-19): the head is a SphereGeometry
  // (r, 20, 16) DISPLACED per area — never a plain scaled sphere.
  // Cranium oval elongated backward, forehead slightly forward with
  // a soft brow ridge, wide cheekbones narrowing to a firm U jaw,
  // rounded chin pushed a touch forward. HEAD PASS ROUND 2
  // (simplify clause, parent verdict on round 1): the 3D nose and
  // the 3D face gear are GONE — the face is a flat, clean canvas
  // texture (drawn oval eyes / thick brows / soft nose shading),
  // and the displacement amplitude is RAISED until the silhouette
  // itself changes (round 1 measured jaw/cheek 0.90 = pure egg).
  // Every field is smooth (gaussians / smoothsteps); normals are
  // recomputed on the indexed sphere BEFORE the non-indexed merge,
  // so shading stays continuous.
  // Size: height ~0.262 m at H=1.75 (~1/7 body), height:width
  // ~1.25:1. UVs are the sphere's own: face centre at u = 0.25.
  // APPEAL PASS (user style lock 2026-11-19): proportions are now
  // STYLIZED +-6 HEADS (supersedes the 7.5-head Loomis canon of the
  // 12:27 spec). Head height = 2 * r0 * sy = 2 * 0.65u * 0.96 =
  // 1.248u -> H / headH = 7.5 / 1.248 = 6.01 heads. Bigger head,
  // hands and shoes carry the read at game-camera distance.
  var HEAD_RF = 0.65; // head radius factor (was 0.57 in the 7-head era)
  // HEAD PASS round 2: jaw taper STRENGTHENED (0.17 -> 0.26, ramp
  // starting right under the cheek line) — round 1 measured
  // jaw/cheek = 0.90 at the jaw-angle ring, a single smooth curve
  // with no cheek->jaw break (the bald sample read as a pure egg).
  // Target: jaw width 0.78-0.84x cheek width at the jaw angle.
  var JAWF = 0.26; // jaw taper depth (the 'oval' class centre)
  function headDims(p) {
    var r0 = p.u * HEAD_RF * p.headScale;
    // FX6: seed jitter scales the three head axes (+-6% each, so
    // no two seeded heads share an exact silhouette), and the jaw
    // class rides along in the dims so EVERY consumer of the head
    // cross-section (funnel, ears, hair shells) follows the same
    // jaw. r0 itself never jitters — hats/eyewear are placed from
    // r0 fractions and the face UV lives on the sphere, so the
    // drawn features cannot drift.
    var hj = p.headJit || [1, 1, 1];
    return {
      r0: r0, sx: 0.80 * hj[0], sy: 0.96 * hj[1], sz: 0.90 * hj[2], cy: p.u * 0.46,
      jawF: p.jawF != null ? p.jawF : JAWF,
      jawBump: p.jawBump != null ? p.jawBump : 0.012,
      chinW: p.chinW != null ? p.chinW : 1
    };
  }
  function ssF(e0, e1, x) { var t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  function gF(x, c, s) { var d = (x - c) / s; return Math.exp(-d * d); }
  function g2F(x, y, cx, cyy, s) { var dx = (x - cx) / s, dy = (y - cyy) / s; return Math.exp(-dx * dx - dy * dy); }
  // Jaw taper amount at polar height ny: 0 at the cheek line,
  // ramping to 1 at the chin (x radius factor 1 -> 1-JAWF).
  function jawT(ny) { return ny < 0 ? ssF(-0.10, -0.80, ny) : 0; }
  // Elliptical cross-section radii of the displaced head at polar
  // height ny — shared by the neck funnel (its seam must track the
  // real surface) and the hair shells (they must clear it).
  function headCross(ny, d) {
    var f = Math.sqrt(Math.max(0.0004, 1 - ny * ny));
    return [d.r0 * d.sx * (1 - (d.jawF != null ? d.jawF : JAWF) * jawT(ny)) * f, d.r0 * d.sz * f * 1.05];
  }

  function buildHead(p, boneIndex) {
    p = baseParams(p);
    var j = joints(p), H = p.H;
    var d = headDims(p), r0 = d.r0;
    var cy = j.headY + d.cy;
    var geo = new THREE.SphereGeometry(r0, 20, 16);
    var posA = geo.attributes.position;
    var v = new V3();
    var i;
    for (i = 0; i < posA.count; i++) {
      v.fromBufferAttribute(posA, i);
      var dx = v.x / r0, dy = v.y / r0, dz = v.z / r0, ny = dy;
      // cranium: the back half swells backward (less at the nape) —
      // round 2: 0.10 -> 0.14 so the elongation reads in profile
      var back = dz < 0 ? ssF(0.05, 0.85, -dz) : 0;
      var zs = d.sz * (1 + 0.14 * back * (ny > -0.55 ? 1 : 0.35));
      // round 2: a whisper of extra width right at the chin keeps
      // the stronger jaw taper reading as a U, not a V point.
      // FX6: the taper depth is the character's JAW CLASS now
      // (d.jawF) and the chin whisper scales with d.chinW (wide
      // square chins, narrower tapered ones). jawT() is 0 above
      // ny -0.10, so none of this touches the eye/brow band — the
      // face UV area cannot shift (Stage C eyewear lesson).
      var x = dx * r0 * d.sx * (1 - d.jawF * jawT(ny)) * (1 + 0.05 * d.chinW * gF(ny, -0.88, 0.12));
      var y = dy * r0 * d.sy;
      var z = dz * r0 * zs;
      // smooth radial relief, applied along the sphere normal
      var front = ssF(0.25, 0.75, dz);
      var rad = 0;
      rad += 0.016 * gF(ny, 0.44, 0.15) * front;                       // forehead
      rad += 0.020 * gF(ny, 0.21, 0.065) * front;                      // brow ridge
      // round 2: sockets nearly FLAT now (-0.040 -> -0.010) — the
      // face is a clean canvas texture again (simplify clause), a
      // deep pressed socket would warp the drawn eyes
      rad -= 0.010 * front * (g2F(dx, ny, 0.30, 0.075, 0.15) +
                              g2F(dx, ny, -0.30, 0.075, 0.15));        // eye sockets (shading only)
      rad += 0.034 * (g2F(dx, ny, 0.64, -0.02, 0.21) +
                      g2F(dx, ny, -0.64, -0.02, 0.21)) * ssF(-0.1, 0.35, dz); // cheekbones (round 2: stronger)
      // round 2: the soft BREAK between cheek and jaw — a shallow
      // hollow under each cheekbone, present on the sides too, so
      // the cheek->jaw transition is a plane change, not one curve
      rad -= 0.013 * (g2F(dx, ny, 0.60, -0.34, 0.17) +
                      g2F(dx, ny, -0.60, -0.34, 0.17)) * (0.45 + 0.55 * front);
      // round 2: jaw-angle corners — small bumps where the jaw
      // turns under, so the U reads from the front.
      // FX6: bump strength is the jaw class (square jaws turn
      // under HARD, tapered jaws barely) and the chin gaussian
      // widens/narrows with d.chinW.
      rad += d.jawBump * (g2F(dx, ny, 0.47, -0.60, 0.16) +
                      g2F(dx, ny, -0.47, -0.60, 0.16)) * (0.5 + 0.5 * front);
      rad += 0.024 * g2F(dx / d.chinW, ny, 0, -0.86, 0.20) * front;   // chin (broad, rounded — iter-2; CHARPOLISH: 0.020 -> 0.024, a firmer chin against the cone jaw)
      // CHARPOLISH: the nose is CONSTRUCTION again — a smooth
      // bridge ridge running down from the glabella into a round
      // tip ball with a slight alar flare at the base, all as
      // radial relief on this same displaced sphere (NOT a
      // bolted-on mesh: the round-1 doll verdict was against the
      // separate sphere nose, and the parent brief re-opens the
      // nose as integrated relief). Centred on the DRAWN nose —
      // canvas bridge y 125 -> ny +0.037, tip y 144 -> ny -0.196,
      // nostrils y 146.5 -> ny -0.222 under the sphere's own acos
      // UV law — so the texture shading and the geometry agree.
      // Peak ~10 mm proud of the sphere at the tip: enough to
      // break the smooth forehead->chin profile curve, far under
      // a clown nose. Front-weighted so the relief dies before
      // the cheeks; the eye band (dx +-0.30) is untouched
      // (bridge sigma x 0.10 -> e^-9 out there). Relief fields
      // are not part of headCross(), so the neck funnel and the
      // hair shells keep their designed clearances.
      rad += 0.032 * front * Math.exp(-Math.pow(dx / 0.10, 2) - Math.pow((ny + 0.02) / 0.17, 2)); // nose bridge ridge
      rad += 0.070 * front * g2F(dx, ny, 0, -0.185, 0.075);          // nose tip ball (amp/sigma tuned over two lab profile reads: a tighter ball breaks the silhouette instead of swelling it)
      rad += 0.018 * front * (g2F(dx, ny, 0.088, -0.228, 0.052) +
                              g2F(dx, ny, -0.088, -0.228, 0.052)); // alar (nostril) flare
      // iter-2 structure vs the iter-1 "egg": parietal width high
      // on the skull, a slight temple inset, a flatter crown
      rad += 0.016 * (g2F(dx, ny, 0.80, 0.35, 0.20) + g2F(dx, ny, -0.80, 0.35, 0.20));
      rad -= 0.014 * (g2F(dx, ny, 0.62, 0.30, 0.16) + g2F(dx, ny, -0.62, 0.30, 0.16)) * front;
      rad -= 0.018 * gF(ny, 0.92, 0.10);
      x += dx * rad * r0; y += dy * rad * r0; z += dz * rad * r0;
      // (round 2 deleted the separate 3D nose MESH under the
      // simplify clause; CHARPOLISH restores the nose as the
      // integrated displacement fields above — see the nose
      // bridge/tip/flare terms in the relief sum.)
      posA.setXYZ(i, x, cy + y, z);
    }
    geo.computeVertexNormals(); // indexed sphere -> smooth normals
    // CHARPOLISH two-tone skin: the head sphere + ears carry a
    // 1.09 vertex-colour lift (the factory's head material enables
    // vertexColors), so the face reads slightly LIGHTER than the
    // clothed body and the covered arms; the neck funnel keeps its
    // own gradient (below), so the jaw -> neck transition keeps a
    // soft shadow instead of a hard tone step.
    var parts = [paintPart(geoPart(geo, p, boneIndex, cy), [1.09, 1.09, 1.09])];
    // ears: small C shells (flattened torus arcs) on the head side,
    // centred between the brow line and the nose base
    function makeEar(side) {
      var g = new THREE.TorusGeometry(r0 * 0.185, r0 * 0.047, 4, 7, 4.1);
      g.rotateZ(2.2);                    // arc opening toward lower-front
      g.rotateY(side * Math.PI / 2);     // ring plane -> YZ, facing outward
      g.scale(0.55, 1, 1);               // flatten the tube thickness (x)
      return g;
    }
    var ec = headCross(-0.02, d);
    parts.push(paintPart(geoPart(makeEar(1), p, boneIndex, cy, [ec[0] - r0 * 0.008, cy, -r0 * 0.02], null, [0.62, 0.45]), [1.09, 1.09, 1.09]));
    parts.push(paintPart(geoPart(makeEar(-1), p, boneIndex, cy, [-ec[0] + r0 * 0.008, cy, -r0 * 0.02], null, [0.62, 0.45]), [1.09, 1.09, 1.09]));
    // continuous skin loft: jaw -> throat -> neck -> inside torso.
    // CHARPOLISH: ring-gradient vertex colour — near-face tone at
    // the tucked seam ring, dipping to 0.95 mid-neck (the soft
    // under-jaw shadow the brief asks for), recovering toward the
    // torso. Ring-major tube, radial 18 -> 19 verts per ring.
    parts.push(shadePart(neckFunnel(p, boneIndex, cy, r0), [1, 1, 1], [1.03, 1.0, 0.98, 0.96, 0.95, 0.95, 0.96, 0.98], 19));
    var g = mergeParts(parts);
    // normals come from the indexed sphere / torus (smooth); do NOT
    // computeVertexNormals on this non-indexed merge (flat bands)
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
  // `win` overrides the window box {z, x, top, bot} in units of r
  // (Stage D iteration 1: the drape reuses this with a chin-line cut).
  function cutFaceWindow(geo, r, cy, win) {
    win = win || { z: 0.52, x: 0.68, top: 0.52, bot: -0.85 };
    var g = geo.index ? geo.toNonIndexed() : geo;
    var pa = g.attributes.position, keep = [];
    for (var i = 0; i < pa.count; i += 3) {
      var cx = (pa.getX(i) + pa.getX(i + 1) + pa.getX(i + 2)) / 3;
      var cyy = (pa.getY(i) + pa.getY(i + 1) + pa.getY(i + 2)) / 3;
      var cz = (pa.getZ(i) + pa.getZ(i + 1) + pa.getZ(i + 2)) / 3;
      var inWindow = cz > r * win.z && Math.abs(cx) < r * win.x && cyy < cy + r * win.top && cyy > cy + r * win.bot;
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

  // Stage D iteration 3: drop the pointed cloth flaps that hang
  // beside the jaw on the hijab shell — triangles in the front-side
  // sector below the cheek line. The drape behind them still covers
  // the neck, so the cut opens no hole.
  function trimJawFlaps(geo, r, cy) {
    var g = geo.index ? geo.toNonIndexed() : geo;
    var pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv;
    var pos = [], nor = [], uvA = [], idx = [];
    for (var i = 0; i < pa.count; i += 3) {
      var cx = (pa.getX(i) + pa.getX(i + 1) + pa.getX(i + 2)) / 3;
      var cyy = (pa.getY(i) + pa.getY(i + 1) + pa.getY(i + 2)) / 3;
      var cz = (pa.getZ(i) + pa.getZ(i + 1) + pa.getZ(i + 2)) / 3;
      var flap = cz > r * 0.26 && Math.abs(cx) > r * 0.58 && cyy < cy - r * 0.50 && cyy > cy - r * 1.35;
      if (flap) continue;
      for (var k = 0; k < 3; k++) {
        var vi = i + k;
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

  // Break the perfect-dome silhouette of a hair cap: the rim is shaped
  // by azimuth — lifted at the front into a real hairline (with a slight
  // widow's peak), tapered over the ears at the sides, dropped at the
  // nape — plus deterministic micro-noise and a slightly flattened
  // crown, so hair never reads as a bowl / helmet again.
  function shapeHair(geo, r, cy, opt) {
    opt = opt || {};
    var front = opt.front != null ? opt.front : 0.38;
    var back = opt.back != null ? opt.back : -0.26;
    var side = opt.side != null ? opt.side : -0.05;
    var noise = opt.noise != null ? opt.noise : 0.028;
    var flat = opt.flat != null ? opt.flat : 0.95;
    var pa = geo.attributes.position;
    var v = new V3();
    for (var i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i);
      var h = (v.y - cy) / r;
      var w = THREE.MathUtils.clamp((0.72 - h) / 0.75, 0, 1);
      var phi = Math.atan2(v.x, v.z); // 0 = front (+Z)
      var cf = Math.cos(phi);
      var lift = cf > 0 ? front * Math.pow(cf, 1.4) : back * Math.pow(-cf, 1.3);
      lift += side * Math.pow(Math.abs(Math.sin(phi)), 2);
      if (cf > 0) lift -= 0.09 * Math.exp(-Math.pow(phi / 0.38, 2)); // widow's peak
      v.y += lift * r * w;
      var rad = Math.sqrt(v.x * v.x + v.z * v.z);
      if (rad > 0.001) {
        var ns = 1 + noise * Math.sin(phi * 5 + 1.7) * w + noise * 0.7 * Math.sin(phi * 3 - 0.6) * w;
        v.x *= ns; v.z *= ns;
      }
      if (h > 0.5) v.y = cy + (v.y - cy) * flat;
      pa.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    return geo;
  }

  // Chunky STEPPED hair shell (replaces the smooth dome): terraced
  // rings with flat facets, and a rim whose height steps by azimuth —
  // widow's-peak hairline in front, recessed temple steps, sides
  // dropped over the ear tops, back down to the nape. The silhouette
  // is deliberately NOT drawable as a smooth half-circle. Built in
  // head-bone local space, non-indexed (flat normals), open bottom.
  function hairShell(p, opt) {
    opt = opt || {};
    var hd = headDims(p), r = hd.r0, cy = hd.cy;
    var padA = (opt.padA != null ? opt.padA : 0.06) * r;
    var jit = opt.jit != null ? opt.jit : 0.035;
    var rimF = opt.rimF != null ? opt.rimF : 1.10;
    var levels = opt.levels || [[0.36, 1.07], [0.62, 0.96], [0.84, 0.78], [0.97, 0.52]];
    // HEAD PASS: cross-sections track the DISPLACED head (shared
    // headCross), so the shells clear the new cranium/jaw surface.
    function headRX(ny) { return headCross(ny, hd)[0]; }
    function headRZ(ny) { return headCross(ny, hd)[1]; }
    function rimRaw(phi) {
      var a = Math.abs(phi);
      if (a < 0.22) return opt.peak != null ? opt.peak : 0.32;   // widow's peak point (round 2: raised 0.24 -> 0.32 — the drawn brows must clear the hairline)
      if (a < 0.60) return opt.front != null ? opt.front : 0.36; // hairline (iter-3: raised so the 3D brows clear the shell overhang — proven occluded at 0.30 by a red-brow debug render)
      if (a < 1.10) return opt.temple != null ? opt.temple : 0.30; // recessed corners (lowered: the old 0.28 left a wing point at the temple step)
      if (a < 2.05) return opt.side != null ? opt.side : -0.10;  // over the ear tops
      return opt.back != null ? opt.back : -0.36;                // down to the nape
    }
    var seg = 14, rings = [], fac = [rimF], poleRi = -1;
    var rim = [], k, li;
    for (k = 0; k < seg; k++) {
      var th = (k / seg) * Math.PI * 2;
      var phi = Math.atan2(Math.cos(th), -Math.sin(th));
      var q = Math.round(rimRaw(phi) / 0.09) * 0.09; // quantised -> stepped edge
      rim.push(q + jit * Math.sin(k * 7.3 + 1.3));
    }
    // HEAD PASS iter-2: smooth the rim steps around the ring (two
    // 0.25/0.5/0.25 passes). The raw sector steps plunged ~0.26 of
    // height across ONE segment at the side->back boundary, which
    // tessellated as a long thin fin sticking out at the nape.
    for (var rp = 0; rp < 2; rp++) {
      var sm = rim.slice();
      for (k = 0; k < seg; k++) rim[k] = sm[(k + seg - 1) % seg] * 0.25 + sm[k] * 0.5 + sm[(k + 1) % seg] * 0.25;
    }
    rings.push(rim);
    // HEAD PASS round 2: IRREGULAR strand teeth per rim vertex —
    // round 1's uniform alternate teeth (±5 mm) smoothed into the
    // dome and the back still read as a plain helmet. Teeth now
    // vary in length by a deterministic hash (long/short mix), and
    // scale by sector: full at the back (the third-person camera's
    // main view), strong at the sides, slightly less on the fringe.
    function hash1(n) { var s = Math.sin(n * 127.1 + (opt.teethSeed || 0) * 311.7) * 43758.5453; return s - Math.floor(s); }
    var teethArr = [];
    for (k = 0; k < seg; k++) {
      var tPhi = Math.atan2(Math.cos((k / seg) * Math.PI * 2), -Math.sin((k / seg) * Math.PI * 2));
      var tA = Math.abs(tPhi);
      var secF = tA > 2.05 ? 1.0 : tA > 1.10 ? 0.9 : 0.45;
      teethArr.push((opt.teeth || 0) * secF * (k % 2 === 0 ? 0.30 : 0.55 + 0.35 * hash1(k * 3.7 + 1)));
    }
    for (li = 0; li < levels.length; li++) {
      var row = [];
      for (k = 0; k < seg; k++) row.push(levels[li][0]);
      rings.push(row); fac.push(levels[li][1]);
    }
    // Round 6: DOME finish. The levels end at ny 0.97 and the old
    // build fanned straight from that wide ring (0.28r) to one apex
    // point — a tall cone over an elliptical ring, which read as a
    // pointed front-back crest/fin on the crown. Always add a pole
    // ring at ny = 1.00 (radius clamped to the head cross-section +
    // pad by the vert() rule) so the loft steps 0.97 -> 1.00 -> apex
    // in two short terraces: a rounded dome cap, no ridge line.
    if (levels[levels.length - 1][0] < 0.99) {
      var prow = [];
      for (k = 0; k < seg; k++) prow.push(1.00);
      rings.push(prow); fac.push(0.30);
      poleRi = rings.length - 1;
    }
    function vert(kk, ri) {
      var th = (kk / seg) * Math.PI * 2, ny = rings[ri][kk], f = fac[ri];
      // The shell must stay OUTSIDE the head surface at every
      // height: a level factor below 1.0 converges faster than
      // the sphere does, and the scalp pokes through the crown
      // fan as a drippy-edged skin patch (visible from above).
      // Factors may only ADD volume over the head cross-section,
      // never subtract from it.
      var rx, rz;
      if (ri === poleRi) {
        // Round 7: the pole ring is an explicitly SMALL concentric
        // cap — both axes scaled by the same factor (0.17) off the
        // head's own proportions. The anti-poke clamp forced the
        // old pole ring to head cross-section + pad (0.21r), and
        // the wide ring feeding one apex point read as a pointed
        // crest/fin on the crown. The band below still clears the
        // sphere everywhere (checked against the sphere radii at
        // the band's heights).
        rx = r * 0.80 * 0.21 + padA * 0.5;
        rz = r * 0.90 * 0.21 + padA * 0.5;
      } else {
        rx = Math.max(headRX(ny) * f, headRX(ny)) + padA;
        rz = Math.max(headRZ(ny) * f, headRZ(ny)) + padA;
      }
      if (ri === 0) {
        // soften the temple "wing": where the rim steps down from
        // temple to side, the corner vertex used to jut sideways —
        // pull the rim ring in ~8% around that azimuth
        var phi = Math.atan2(Math.cos(th), -Math.sin(th)), a = Math.abs(phi);
        var d = (a - 1.18) / 0.30;
        var pinch = 1 - 0.08 * Math.exp(-d * d);
        rx *= pinch; rz *= pinch;
      }
      // HEAD PASS round 2: strand-clump lobes — the radius breathes
      // ±lobe around the ring (7 clumps), same phase on every ring
      // so clumps run vertically like combed strands. This is what
      // breaks the perfect-ellipse outline that read as a dome /
      // helmet from behind; the rim ring gets a gentler dose so
      // the hairline stays controlled.
      var lobeAmp = (opt.lobe != null ? opt.lobe : 0.022) * (ri === 0 ? 0.55 : 1);
      var lobeF = 1 + lobeAmp * Math.sin(th * 7 + 1.3);
      rx *= lobeF; rz *= lobeF;
      // HEAD PASS round 2 fix: back-bulge compensation — headCross
      // is a plain ellipse, but the displaced head's cranium swells
      // PAST it at the back (elongation field), and the wide chord
      // between the rim and the first level ring grazed the scalp
      // at the back equator (centroid probe: +0.1 mm; one skin
      // triangle visible in kA-back/kB-back). Push the back half
      // out by a gaussian band around ny 0.10.
      var sinTh = Math.sin(th);
      if (sinTh > 0) rz *= 1 + 0.09 * sinTh * Math.exp(-Math.pow((ny - 0.10) / 0.50, 2));
      var vy = cy + ny * r * hd.sy;
      // HEAD PASS round 2: jagged strand teeth on the rim — rim
      // vertices drop by irregular precomputed lengths, so the
      // hair edge cuts the silhouette as strands, never a brim.
      if (ri === 0 && opt.teeth) vy -= teethArr[kk] * r;
      return [Math.cos(th) * rx,
              vy,
              -Math.sin(th) * rz - r * 0.035];
    }
    var pos = [], uvP = [];
    // FX6: shells carry REAL uvs (azimuth x2 wraps, v = ring
    // fraction) — the hair material's fibre-noise normal map
    // needs uv variation to exist at all (the old all-zero uv
    // sampled one texel = a flat normal). uvOf takes kk UNWRAPPED
    // (kk+1 at the seam) so no quad stretches across the wrap.
    function uvOf(kk, ri) { return [(kk / seg) * 2, rings.length > 1 ? ri / (rings.length - 1) : 0]; }
    function tri(a, b, c, ua, ub, uc) {
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      uvP.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
    }
    for (var ri = 0; ri < rings.length - 1; ri++) {
      for (var kk = 0; kk < seg; kk++) {
        var kN = (kk + 1) % seg;
        var a0 = vert(kk, ri), a1 = vert(kN, ri), b0 = vert(kk, ri + 1), b1 = vert(kN, ri + 1);
        tri(a0, a1, b0, uvOf(kk, ri), uvOf(kk + 1, ri), uvOf(kk, ri + 1));
        tri(b0, a1, b1, uvOf(kk, ri + 1), uvOf(kk + 1, ri), uvOf(kk + 1, ri + 1)); // same winding as tube(): outward
      }
    }
    // Apex ABOVE the head pole (cy + 1.06r) plus pad: at 0.99 the
    // fan apex sat BELOW the pole and the fan plane sliced the
    // sphere cap — the other half of the crown patch. With the
    // round-6 pole ring the final fan spans only ~padA of height:
    // a shallow rounded cap instead of a cone.
    var topPt = [0, cy + r * hd.sy + padA * 0.2, -r * 0.035], lastRi = rings.length - 1;
    for (var kt = 0; kt < seg; kt++) tri(topPt, vert(kt, lastRi), vert((kt + 1) % seg, lastRi),
      [0.5, 1], uvOf(kt, lastRi), uvOf(kt + 1, lastRi));
    // HEAD PASS: optional azimuth crop — keep only triangles whose
    // centroid azimuth |atan2(x, z)| <= opt.phiMax (front sector).
    // Used for the separate fringe piece of layered styles.
    if (opt.phiMax != null) {
      var kept = [], keptUv = [];
      for (var ti = 0; ti < pos.length; ti += 9) {
        var ccx = (pos[ti] + pos[ti + 3] + pos[ti + 6]) / 3;
        var ccz = (pos[ti + 2] + pos[ti + 5] + pos[ti + 8]) / 3;
        if (Math.abs(Math.atan2(ccx, ccz)) <= opt.phiMax) {
          for (var tk = 0; tk < 9; tk++) kept.push(pos[ti + tk]);
          for (var tu = 0; tu < 6; tu++) keptUv.push(uvP[(ti / 9) * 6 + tu]);
        }
      }
      pos = kept; uvP = keptUv;
    }
    var uvA = uvP;
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
    geo.computeVertexNormals(); // non-indexed -> flat facets per face
    return geo;
  }

  // Hanging hair panel (head-bone local space): a curved grid that
  // follows the head cross-sections down past the jaw — long-hair
  // backs and sides. The bottom row has jagged strand teeth.
  // HEAD PASS round 2: hem teeth are IRREGULAR per column (hash
  // mix of short/long) — round 1's uniform alternate teeth read as
  // a zigzag hem on a single flat slab, not as strands.
  function panelGeo(p, opt) {
    var hd = headDims(p), r0 = hd.r0, cy = hd.cy;
    var cols = 6, rows = 4, pos = [], uvA = [], idx = [];
    function hashP(n) { var s = Math.sin(n * 141.3 + (opt.seed || 0) * 197.9) * 43758.5453; return s - Math.floor(s); }
    var ri, ci;
    for (ri = 0; ri <= rows; ri++) {
      var t = ri / rows;
      var ny = opt.rimNy - t * opt.len;
      var nyC = Math.max(-0.85, Math.min(1, ny));
      var c = headCross(nyC, hd);
      var shrink = ny < -0.85 ? 1 - 0.10 * (-0.85 - ny) : 1;
      var y = cy + ny * r0 * hd.sy;
      for (ci = 0; ci <= cols; ci++) {
        var phi = opt.phiC + (ci / cols - 0.5) * 2 * opt.phiW;
        var edge = Math.abs(ci / cols - 0.5) * 2;
        var rr = (1 + (opt.pad || 0.08)) * (1 - 0.05 * edge * t) * shrink;
        var yy = y;
        if (ri === rows) yy -= (ci % 2 === 0 ? 0.30 : 0.55 + 0.35 * hashP(ci * 7.1 + 1)) * (opt.teeth || 0.04) * r0; // jagged hem
        pos.push(Math.sin(phi) * c[0] * rr, yy, Math.cos(phi) * c[1] * rr);
        uvA.push(ci / cols, t);
      }
    }
    for (ri = 0; ri < rows; ri++) for (ci = 0; ci < cols; ci++) {
      var a = ri * (cols + 1) + ci, b = a + cols + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo.toNonIndexed();
  }

  // HEAD PASS hair: layered volume, never a flat cap. Every style =
  // stepped base shell + a shorter, puffier outer shell over the
  // crown/back (different pad + rim, so the two read as layers) +
  // style pieces (fringe crop with jagged teeth, hanging panels,
  // bun, tail...). Sides and back are covered FULLY — the game's
  // third-person camera mostly sees the back of the head.
  // HEAD PASS round 2: teeth amplitudes roughly doubled and made
  // irregular (see hairShell), layer-2's rim raised so the layer
  // STEP reads from behind, and long hair is built from SEPARATE
  // narrow strips with gaps + jagged hems instead of flat slabs.
  function hairGeometry(style, p) {
    p = baseParams(p);
    var hd = headDims(p), r = hd.r0, cy = hd.cy;
    var cap = hairShell(p, { teeth: 0.17, teethSeed: 1, lobe: 0.028 }); // APPEAL iter 2: deeper fringe teeth (iter-1 close-ups read the fringe as one straight helmet line); FX6: clumpier lobe; CHARPOLISH: teeth 0.14 -> 0.17 — longer irregular nape/side strands, the back rim must cut the silhouette as strands (the combat camera's main view)
    var layer2 = hairShell(p, { padA: 0.15, rimF: 1.08, peak: 0.34, front: 0.42, temple: 0.34,
      side: 0.16, back: 0.06, levels: [[0.55, 1.05], [0.80, 0.85], [0.97, 0.48]], teeth: 0.16, teethSeed: 2, jit: 0.045 }); // FX6: teeth 0.07->0.13 — the front hairline must break, not shelf; CHARPOLISH: 0.13 -> 0.16 so the layer STEP edge at the back steps as strands too
    var fringe = hairShell(p, { padA: 0.085, rimF: 1.06, peak: 0.26, front: 0.30, temple: 0.26,
      side: 0.24, back: 0.30, levels: [[0.34, 1.03], [0.48, 0.99], [0.62, 0.94], [0.78, 0.88]], teeth: 0.15, teethSeed: 3, phiMax: 1.05, jit: 0.02 }); // FX6: teeth 0.09->0.15
    var parts = [];
    switch (style) {
      case 'bald': return null;
      case 'short':
        // CHARPOLISH: 'short' gains the FRINGE BAND the layered
        // styles already wear — a front-sector shell (phiMax crop)
        // sitting ~7 mm proud of the cap, its own rim HIGHER than
        // the cap's edge (front 0.42 vs 0.36) with longer irregular
        // teeth, so the hairline reads as two staggered STRAND
        // rows over the forehead instead of one smooth shelf.
        // Teeth tips land at ny ~0.33-0.39: they graze the brow
        // arch's top edge at the deepest single column, never
        // cover the blades (the iter-3 brow-clearance rule).
        parts.push(cap, layer2, hairShell(p, { padA: 0.105, rimF: 1.05, peak: 0.38, front: 0.42, temple: 0.40,
          side: 0.32, back: 0.34, levels: [[0.48, 1.02], [0.66, 0.96], [0.84, 0.86]], teeth: 0.22, teethSeed: 11, phiMax: 1.02, jit: 0.018, lobe: 0.02 }));
        break;
      case 'quiff':
        parts.push(cap, layer2, fringe);
        // swept wedge, tilted forward and flattened — a plain
        // squashed sphere read as a shiny beret dome on the crown
        var qb = new THREE.SphereGeometry(r * 0.52, 10, 6);
        qb.rotateX(-0.30); qb.scale(1.05, 0.36, 0.90);
        parts.push(prim(qb, 0, cy + r * 0.74, r * 0.36, 1, 1, 1, 0));
        break;
      case 'long': // back strips are the swing part (hairSwing) — not merged here
        parts.push(cap, layer2, fringe);
        // round 2 fix: side strips sit AT/BEHIND the ear line
        // (offsets -0.05/+0.45 from the side axis) — the first
        // round-2 placement (front strip at 63 deg) hung in front
        // of the cheeks and read as thin dark cords from the front
        parts.push(panelGeo(p, { phiC: Math.PI / 2 - 0.05, phiW: 0.26, rimNy: -0.12, len: 0.78, pad: 0.08, teeth: 0.07, seed: 1 }));
        parts.push(panelGeo(p, { phiC: Math.PI / 2 + 0.45, phiW: 0.26, rimNy: -0.12, len: 0.92, pad: 0.08, teeth: 0.07, seed: 2 }));
        parts.push(panelGeo(p, { phiC: -Math.PI / 2 + 0.05, phiW: 0.26, rimNy: -0.12, len: 0.78, pad: 0.08, teeth: 0.07, seed: 3 }));
        parts.push(panelGeo(p, { phiC: -Math.PI / 2 - 0.45, phiW: 0.26, rimNy: -0.12, len: 0.92, pad: 0.08, teeth: 0.07, seed: 4 }));
        break;
      case 'ponytail': // tail is the swing part (hairSwing)
        parts.push(cap, layer2, fringe);
        break;
      case 'bun':
        parts.push(cap, layer2);
        parts.push(prim(new THREE.SphereGeometry(r * 0.42, 10, 8), 0, cy + r * 0.80, -r * 0.42, 1, 0.9, 1, 0));
        break;
      case 'afro': // stepped shells, bigger mass + stronger steps + teeth + clump lobes
        // APPEAL iter 2: back rim reaches LOWER (-0.30 / -0.16) —
        // iter-1's high nape line let skin slivers show between
        // the lobes at the back of the neck.
        parts.push(hairShell(p, { peak: 0.22, front: 0.32, temple: 0.30, side: 0.06, back: -0.30,
          padA: 0.10, jit: 0.05, rimF: 1.09, teeth: 0.11, teethSeed: 5, lobe: 0.045, levels: [[0.38, 1.14], [0.64, 1.03], [0.85, 0.84], [0.97, 0.46]] }));
        parts.push(hairShell(p, { peak: 0.28, front: 0.36, temple: 0.32, side: 0.18, back: -0.16,
          padA: 0.17, jit: 0.06, rimF: 1.14, teeth: 0.09, teethSeed: 6, lobe: 0.04, levels: [[0.50, 1.10], [0.80, 0.90], [0.97, 0.50]] }));
        break;
      case 'hijab': // cloth shell with a cut face window + neck drape
        // Stage D iteration 1: finer shell (28x20) so the window rim
        // stops stepping in spikes; window widened + lowered so nose
        // and mouth stay open; the drape gets its own front cut at
        // the chin line — it wraps the neck, never the lower face
        // (the full tube read as a niqab).
        var shell = prim(new THREE.SphereGeometry(r * 1.14, 28, 20), 0, cy + r * 0.05, -r * 0.06, 0.86, 1.03, 0.97);
        parts.push(trimJawFlaps(cutFaceWindow(shell, r, cy, { z: 0.50, x: 0.74, top: 0.56, bot: -1.06 }), r, cy));
        var drape = prim(new THREE.CylinderGeometry(r * 1.02, r * 1.24, r * 1.15, 16, 1, true), 0, cy - r * 0.70, -r * 0.05, 0.88, 1, 1, 0);
        parts.push(cutFaceWindow(drape, r, cy, { z: 0.42, x: 0.95, top: 0.60, bot: -1.04 }));
        break;
      case 'peci': // sits DOWN over the crown (top must clear the new head top 0.985r)
        parts.push(prim(new THREE.CylinderGeometry(r * 0.80, r * 0.88, r * 0.55, 14), 0, cy + r * 0.72, 0, 1, 1, 1, 0));
        break;
      case 'cap':
        parts.push(cap, layer2);
        parts.push(prim(new THREE.CylinderGeometry(r * 1.05, r * 1.05, r * 0.07, 14, 1, false, 0, Math.PI), 0, cy + r * 0.26, r * 0.50, 1, 1, 1.4, 0));
        break;
      // ---- FX6 styles: ASSEMBLED PIECES, not one helmet shell ----
      case 'buzz':
        // crew cut: ONE tight shell hugging the displaced head
        // (pad 0.045r — the floor set by the head's own relief
        // bumps, ~0.034r at the parietal/cheek fields; a tighter
        // pad lets scalp poke through, probe-verified), rim cut
        // high on sides/back. The read is
        // the hairline STEP + two-tone paint against the skin —
        // the silhouette stays close to the skull on purpose.
        parts.push(hairShell(p, { padA: 0.0520, rimF: 1.04, peak: 0.34, front: 0.35, temple: 0.30,
          side: 0.04, back: -0.10, levels: [[0.42, 1.03], [0.72, 0.97], [0.97, 0.50]],
          teeth: 0.15, teethSeed: 7, lobe: 0.012, jit: 0.02 }));
        break;
      case 'undercut':
        // short tight sides/back (same tight shell family as
        // buzz, rim a touch lower) + a SEPARATE top mass whose
        // rim ENDS HIGH — the visible step between the two shells
        // is the undercut line; the top keeps jagged front teeth.
        parts.push(hairShell(p, { padA: 0.0550, rimF: 1.04, peak: 0.36, front: 0.42, temple: 0.36,
          side: 0.10, back: -0.02, levels: [[0.45, 1.03], [0.75, 0.97], [0.97, 0.50]],
          teeth: 0.12, teethSeed: 8, lobe: 0.012, jit: 0.02 }));
        parts.push(hairShell(p, { padA: 0.13, rimF: 1.10, peak: 0.52, front: 0.55, temple: 0.50,
          side: 0.34, back: 0.22, levels: [[0.62, 1.05], [0.84, 0.86], [0.97, 0.50]],
          teeth: 0.14, teethSeed: 9, lobe: 0.020, jit: 0.03 }));
        break;
      case 'messy':
        parts.push(cap, layer2, fringe);
        // tufts: small flattened wedges at deterministic tilts
        // over the crown — their tips break the dome outline
        // from the back and side (the FX6 silhouette test).
        var tuftSeed = [[-0.40, 0.25, 0.16, 0.55], [0.32, 0.40, -0.12, -0.45], [0.03, 0.52, 0.30, 0.95],
                        [-0.14, 0.46, -0.36, 0.25], [0.46, 0.14, 0.36, -0.85], [-0.30, 0.05, -0.42, 0.65]];
        for (var tqi = 0; tqi < tuftSeed.length; tqi++) {
          var tq = tuftSeed[tqi];
          var tg = new THREE.BoxGeometry(r * 0.38, r * 0.17, r * 0.52);
          tg.rotateX(tq[3] * 0.45); tg.rotateZ(tq[3]);
          parts.push(prim(tg, r * tq[0], cy + r * (0.90 + tq[1] * 0.14), r * tq[2], 1, 1, 1, tq[3] * 0.7));
        }
        break;
      case 'slick':
        // combed back: hairline swept UP (rim high in front, no
        // fringe piece) + one elongated ridge mass flowing from
        // the crown toward the nape.
        parts.push(hairShell(p, { padA: 0.075, rimF: 1.08, peak: 0.40, front: 0.46, temple: 0.38,
          side: -0.02, back: -0.24, levels: [[0.40, 1.06], [0.68, 0.97], [0.97, 0.50]],
          teeth: 0.05, teethSeed: 10, lobe: 0.016, jit: 0.025 }));
        var sg = new THREE.SphereGeometry(r * 0.70, 10, 6);
        sg.rotateX(-0.30); sg.scale(0.62, 0.36, 1.18);
        parts.push(prim(sg, 0, cy + r * 0.78, -r * 0.10, 1, 1, 1, 0));
        break;
      case 'bob':
        parts.push(cap);
        // jaw-length panels with a nearly STRAIGHT hem (teeth
        // ~0 — a cut edge, not strands) on both sides + back,
        // plus a straight-across fringe piece.
        parts.push(panelGeo(p, { phiC: Math.PI / 2, phiW: 0.60, rimNy: -0.02, len: 1.00, pad: 0.09, teeth: 0.012, seed: 21 }));
        parts.push(panelGeo(p, { phiC: -Math.PI / 2, phiW: 0.60, rimNy: -0.02, len: 1.00, pad: 0.09, teeth: 0.012, seed: 22 }));
        parts.push(panelGeo(p, { phiC: Math.PI, phiW: 0.80, rimNy: -0.05, len: 1.06, pad: 0.09, teeth: 0.012, seed: 23 }));
        parts.push(hairShell(p, { padA: 0.085, rimF: 1.06, peak: 0.28, front: 0.32, temple: 0.28,
          side: 0.24, back: 0.30, levels: [[0.34, 1.03], [0.48, 0.99], [0.62, 0.94], [0.78, 0.88]],
          teeth: 0.02, teethSeed: 24, phiMax: 1.05, jit: 0.015 }));
        break;
      default: parts.push(cap, layer2);
    }
    return mergePlain(parts);
  }

  // Swinging hair parts (ponytail / long back panel), authored
  // relative to a pivot on the head so the factory can spring them.
  function hairSwing(style, p) {
    p = baseParams(p);
    var hd = headDims(p), r0 = hd.r0, cy = hd.cy;
    if (style === 'ponytail') {
      var parts = [];
      parts.push(prim(new THREE.SphereGeometry(r0 * 0.15, 8, 6), 0, -r0 * 0.03, 0, 1, 1, 1, 0)); // knot
      var tail = prim(new THREE.CapsuleGeometry(r0 * 0.125, r0 * 0.80, 3, 8), 0, -r0 * 0.52, -r0 * 0.06, 1, 1, 1, 0);
      tail.rotateX(0.16); // tip drifts back, around the pivot
      parts.push(tail);
      return { geo: mergePlain(parts), pivot: [0, cy + r0 * 0.36, -r0 * 0.82] };
    }
    if (style === 'long') {
      // HEAD PASS round 2: the back is FOUR separate strips with
      // small gaps and different lengths (outer pair shorter) —
      // round 1's single wide panel hung like a legion helmet
      // flap. The cap underneath shows through the gaps, which is
      // what makes the separation read as strands.
      var strips = [[-0.48, 1.00], [-0.16, 1.10], [0.16, 1.10], [0.48, 1.00]];
      var merged = [];
      for (var si = 0; si < strips.length; si++) {
        merged.push(panelGeo(p, { phiC: Math.PI + strips[si][0], phiW: 0.145, rimNy: -0.28, len: 1.05 * strips[si][1], pad: 0.10, teeth: 0.07, seed: 10 + si }));
      }
      var g = mergePlain(merged);
      var piv = [0, cy - r0 * 0.24, -r0 * 0.88];
      g.translate(-piv[0], -piv[1], -piv[2]);
      return { geo: g, pivot: piv };
    }
    return null;
  }

  // HEAD PASS round 2: rig.faceGear (3D eyeballs / iris caps / lid
  // rims / brow tori) is REMOVED — parent's verdict on round 1 was
  // that the gear read as doll bead-eyes, so the user's simplify
  // clause applies: the face is drawn in the factory's canvas
  // texture (oval eyes with white + iris + highlight, thick brows,
  // soft nose shading). Removing the gear also cuts ~600 tris.

  SH.CharRig = {
    baseParams: baseParams, joints: joints, BONE_NAMES: BONE_NAMES,
    buildSkeleton: buildSkeleton, bodyStations: bodyStations, st: st,
    tube: tube, mergeParts: mergeParts, paintPart: paintPart, shadePart: shadePart,
    buildBody: buildBody, buildHead: buildHead,
    hairGeometry: hairGeometry, hairSwing: hairSwing,
    headDims: headDims, headCross: headCross,
    prim: prim, mergePlain: mergePlain
  };
})(window.SH = window.SH || {});
