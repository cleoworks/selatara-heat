// SELATARA HEAT — pedestrians.js
// Sidewalk pedestrians: pooled low-poly walkers who stroll between corners,
// idle and chat, panic-flee from danger, and fall when hit by a fast vehicle.
// Public API: SH.Pedestrians { init(scene), update(dt), list, scare(x, z, radius) }.
(function (SH) {
  'use strict';

  var shirtColors = [0xff8c5a, 0x37e0ff, 0xffd23f, 0x9fd8c0, 0xff4fa3, 0xf2e3c6, 0x7ac94f, 0xe8e3d8];

  // ---- shared character builder (Art Pass 3, step 2) ----------------------
  // One figure builder for EVERY human in the game — pedestrians, Raka,
  // combat fighters, police officers, the mission courier — so the whole
  // cast shares one anatomy: ~1.80 m tall, sphere head with a canvas face
  // (eyes / brows / nose / mouth), trapezoid torso (shoulders wider than
  // the waist), cylinder limbs with hands and shoes, and outfit variants
  // (hair styles, hat, glasses, jacket, shorts, skirt). Returns the part
  // interface every animator already uses: { group, legL, legR, armL,
  // armR, torso, head, shirtMat } with limb pivots at hip/shoulder height.
  var faceCache = {};
  function faceTexture(skinColor, variant) {
    var key = skinColor + '_' + variant;
    if (faceCache[key]) return faceCache[key];
    var cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
    var c = cv.getContext('2d');
    var col = '#' + ('000000' + skinColor.toString(16)).slice(-6);
    c.fillStyle = col; c.fillRect(0, 0, 128, 128);
    // Soft side shading so the sphere reads round even unlit.
    var grad = c.createLinearGradient(0, 0, 128, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.18)');
    grad.addColorStop(0.25, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.18)');
    grad.addColorStop(0.75, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.18)');
    c.fillStyle = grad; c.fillRect(0, 0, 128, 128);
    // The face sits at u = 0.25 on a THREE sphere (the +z meridian), so
    // features are drawn around x = 32.
    function ellipse(x, y, rx, ry, fill) {
      c.fillStyle = fill; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill();
    }
    ellipse(18, 74, 7, 5, 'rgba(255,110,80,0.10)');   // cheeks
    ellipse(46, 74, 7, 5, 'rgba(255,110,80,0.10)');
    // Feature heights follow the bible's thirds: eyes ~1/3, nose ~1/2,
    // mouth ~2/3 of the head height.
    c.fillStyle = '#241a12';                           // brows
    c.save(); c.translate(23, 42); c.rotate(-0.14); c.fillRect(-6, -1.6, 12, 3.2); c.restore();
    c.save(); c.translate(41, 42); c.rotate(0.14); c.fillRect(-6, -1.6, 12, 3.2); c.restore();
    ellipse(23, 52, 3.4, 4.8, '#1d1410');              // eyes
    ellipse(41, 52, 3.4, 4.8, '#1d1410');
    ellipse(24.2, 50.2, 1.1, 1.4, 'rgba(255,255,255,0.85)'); // glints
    ellipse(42.2, 50.2, 1.1, 1.4, 'rgba(255,255,255,0.85)');
    c.strokeStyle = 'rgba(60,30,15,0.45)'; c.lineWidth = 2;  // nose
    c.beginPath(); c.moveTo(32.5, 58); c.lineTo(31, 68); c.stroke();
    ellipse(28.6, 73.5, 1.4, 1, 'rgba(40,20,10,0.4)');
    ellipse(35.4, 73.5, 1.4, 1, 'rgba(40,20,10,0.4)');
    c.strokeStyle = '#6e3524'; c.lineWidth = 2.4; c.lineCap = 'round';
    if (variant === 1) {                               // flat, serious
      c.beginPath(); c.moveTo(26, 83); c.lineTo(38, 83); c.stroke();
    } else if (variant === 2) {                        // grin
      c.fillStyle = '#5e2a1c'; c.beginPath(); c.ellipse(32, 82, 6.5, 4.6, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#f5ede2'; c.fillRect(26.5, 79, 11, 3.4);
    } else {                                           // easy smile
      c.beginPath(); c.arc(32, 79, 6, Math.PI * 0.2, Math.PI * 0.8); c.stroke();
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    faceCache[key] = tex;
    return tex;
  }

  function buildFigure(opts) {
    opts = opts || {};
    var skinColor = opts.skin != null ? opts.skin : 0xb87a4e;
    var skin = new THREE.MeshLambertMaterial({ color: skinColor, flatShading: true });
    var shirt = new THREE.MeshLambertMaterial({ color: opts.shirt != null ? opts.shirt : 0xff8c5a, flatShading: true });
    var pants = new THREE.MeshLambertMaterial({ color: opts.pants != null ? opts.pants : 0x2a3040, flatShading: true });
    var hairMat = new THREE.MeshLambertMaterial({ color: opts.hairColor != null ? opts.hairColor : 0x14100c, flatShading: true });
    var dark = new THREE.MeshLambertMaterial({ color: 0x22242c, flatShading: true });
    var g = new THREE.Group();
    function add(mesh, parent, x, y, z) {
      mesh.position.set(x, y, z); mesh.castShadow = true;
      (parent || g).add(mesh); return mesh;
    }
    function cyl(rt, rb, h, seg, mat) { return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); }
    function ball(r, mat) { return new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat); }

    // JOINTED construction (Art Bible v1+v2): no limb is a single
    // stick. Every limb is tapered segments OVERLAPPING at ball/disc
    // joints — deltoid cap + shoulder ball, elbow ball r 0.04, knee
    // ball r 0.05 — and swings from the joint pivot, with the knee/
    // elbow as a child pivot the animators bend. Proportions follow
    // the professional 6-head table (total 1.80 m): head 0.30, chest
    // centre y 1.32, waist 1.05, hip pivot 0.92, knee 0.50, shoulders
    // ≈ 2 head-widths, face features at 1/3 - 1/2 - 2/3 of head height.
    var bottom = opts.bottom || 'pants';
    var thighMat = bottom === 'skirt' ? skin : pants;
    var shinMat = bottom === 'pants' ? pants : skin;
    function makeLeg(side) {
      var hip = new THREE.Group();
      hip.position.set(0.105 * side, 0.92, 0);
      g.add(hip);
      add(cyl(0.075, 0.055, 0.42, 7, thighMat), hip, 0, -0.21, 0);       // thigh
      add(ball(0.05, thighMat), hip, 0, -0.42, 0);                        // knee ball
      var knee = new THREE.Group();
      knee.position.set(0, -0.42, 0);
      hip.add(knee);
      add(cyl(0.05, 0.035, 0.42, 7, shinMat), knee, 0, -0.21, 0);        // shin
      var calf = ball(0.048, shinMat);                                    // calf bulge
      calf.scale.set(0.75, 1.35, 0.75);
      add(calf, knee, 0, -0.11, -0.018);
      var shoe = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.07, 0.27), dark); // wedge shoe
      shoe.rotation.x = 0.08;
      add(shoe, knee, 0, -0.415, 0.055);
      return { hip: hip, knee: knee };
    }
    var legL = makeLeg(-1), legR = makeLeg(1);
    // Pelvis block + chest as TWO separate trapezoids with a belt line
    // between them — the waist reads, the figure is not one slab.
    var pelvis = cyl(0.175, 0.20, 0.20, 8, bottom === 'skirt' ? shirt : pants);
    pelvis.scale.z = 0.66;
    add(pelvis, g, 0, 1.00, 0);
    if (bottom === 'skirt') {
      var skirt = cyl(0.16, 0.27, 0.36, 9, pants);
      add(skirt, g, 0, 0.86, 0);
    }
    var belt = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.05, 0.185), dark);
    add(belt, g, 0, 1.12, 0);
    // Chest: ellipse-section (z-scale 0.66) tapering ~20% to the waist,
    // centred on the bible's y 1.32, plus a trapezius cone to the neck.
    var torso = cyl(0.24, 0.195, 0.36, 8, shirt);
    torso.scale.z = 0.66;
    add(torso, g, 0, 1.32, 0);
    var trap = cyl(0.09, 0.155, 0.10, 8, shirt);
    trap.scale.z = 0.66;
    add(trap, g, 0, 1.515, 0);
    if (opts.jacket) {
      var placket = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.32, 0.015), dark);
      add(placket, g, 0, 1.31, 0.115);
      var collar = cyl(0.12, 0.145, 0.08, 8, dark);
      add(collar, g, 0, 1.50, 0);
    }
    // Arms: deltoid cap over the shoulder joint, tapered upper arm in
    // a light A-pose (12° out), elbow ball, tapered forearm with a
    // slight natural bend, flat hand with a thumb nub.
    function makeArm(side) {
      var delt = ball(0.078, shirt);
      delt.scale.set(1.05, 0.8, 1.05);
      add(delt, g, 0.235 * side, 1.45, 0);
      var shoulder = new THREE.Group();
      shoulder.position.set(0.24 * side, 1.455, 0);
      shoulder.rotation.z = -0.21 * side;
      g.add(shoulder);
      var sleeveMat = opts.sleeves === 'short' ? skin : shirt;
      add(cyl(0.05, 0.04, 0.30, 7, sleeveMat), shoulder, 0, -0.15, 0);   // upper arm
      add(ball(0.04, skin), shoulder, 0, -0.30, 0);                      // elbow ball
      var elbow = new THREE.Group();
      elbow.position.set(0, -0.30, 0);
      elbow.rotation.x = -0.16;
      shoulder.add(elbow);
      add(cyl(0.04, 0.03, 0.28, 7, skin), elbow, 0, -0.14, 0);           // forearm
      var hand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.025), skin);
      add(hand, elbow, 0, -0.315, 0);
      var thumb = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.02), skin);
      add(thumb, elbow, -0.032 * side, -0.285, 0.012);
      return { shoulder: shoulder, elbow: elbow };
    }
    var armL = makeArm(-1), armR = makeArm(1);
    // Neck + head: faceted sphere (r 0.15 = the 0.30 head unit) with
    // the canvas face, ears, then a hair shell at 1.05x or a hat.
    add(cyl(0.055, 0.06, 0.08, 6, skin), g, 0, 1.545, 0);
    var headGroup = new THREE.Group();
    headGroup.position.set(0, 1.50, 0);
    g.add(headGroup);
    var headMat = new THREE.MeshLambertMaterial({ map: faceTexture(skinColor, opts.face || 0), flatShading: true });
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), headMat);
    head.scale.set(0.94, 1, 0.97);
    add(head, headGroup, 0, 0.15, 0);
    var earGeo = new THREE.SphereGeometry(0.038, 6, 5);
    add(new THREE.Mesh(earGeo, skin), headGroup, -0.135, 0.14, 0);
    add(new THREE.Mesh(earGeo, skin), headGroup, 0.135, 0.14, 0);
    var hairStyle = opts.hairStyle || 'cap';
    if (hairStyle === 'hat') {
      var hatMat = new THREE.MeshLambertMaterial({ color: opts.hatColor != null ? opts.hatColor : 0x22242c, flatShading: true });
      add(cyl(0.20, 0.20, 0.02, 10, hatMat), headGroup, 0, 0.235, 0);
      add(cyl(0.135, 0.145, 0.10, 10, hatMat), headGroup, 0, 0.275, 0);
    } else if (hairStyle !== 'bald') {
      var cap = new THREE.Mesh(new THREE.SphereGeometry(0.158, 10, 6, 0, Math.PI * 2, 0, 1.75), hairMat);
      add(cap, headGroup, 0, 0.16, -0.01);
      if (hairStyle === 'long') {
        var back = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.32, 0.05), hairMat);
        add(back, headGroup, 0, 0.0, -0.125);
      } else if (hairStyle === 'bun') {
        var bun = new THREE.Mesh(new THREE.SphereGeometry(0.065, 7, 6), hairMat);
        add(bun, headGroup, 0, 0.26, -0.09);
      } else if (hairStyle === 'mohawk') {
        var hawk = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.30), hairMat);
        add(hawk, headGroup, 0, 0.27, 0);
      }
    }
    if (opts.glasses) {
      var shades = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.055, 0.015), dark);
      add(shades, headGroup, 0, 0.15, 0.138);
    }
    return {
      group: g,
      legL: legL.hip, legR: legR.hip, shinL: legL.knee, shinR: legR.knee,
      armL: armL.shoulder, armR: armR.shoulder, foreL: armL.elbow, foreR: armR.elbow,
      torso: torso, head: headGroup, shirtMat: shirt
    };
  }

  var skinTones = [0x8a5a34, 0xa8763e, 0xb87a4e, 0xc98a5e, 0x7a4a28, 0xd9a06a];
  var hairColors = [0x14100c, 0x3a2415, 0x5e3a1e, 0x7a1f3d, 0xb8b0a4];
  var hairStyles = ['cap', 'cap', 'long', 'bun', 'mohawk', 'bald'];

  function buildPedMesh(rng) {
    var bottom = ['pants', 'pants', 'shorts', 'skirt'][(rng() * 4) | 0];
    return buildFigure({
      skin: skinTones[(rng() * skinTones.length) | 0],
      shirt: shirtColors[(rng() * shirtColors.length) | 0],
      pants: 0x2a3040 + ((rng() * 0x101018) | 0),
      hairColor: hairColors[(rng() * hairColors.length) | 0],
      hairStyle: hairStyles[(rng() * hairStyles.length) | 0],
      bottom: bottom,
      sleeves: (bottom === 'shorts' || bottom === 'skirt') ? 'short' : 'long',
      jacket: rng() < 0.25,
      glasses: rng() < 0.2,
      face: (rng() * 3) | 0
    });
  }

  var Pedestrians = {
    list: [],
    rng: SH.World.makeRng(31),
    buildFigure: buildFigure,

    init: function (scene) {
      var n = SH.Config.loop.pedCount;
      for (var i = 0; i < n; i++) {
        var built = buildPedMesh(this.rng);
        scene.add(built.group);
        var ped = {
          mesh: built.group, parts: built,
          x: 0, z: 0, heading: 0, speed: 0, cycle: this.rng() * 6,
          tx: 0, tz: 0, state: 'walk', timer: this.rng() * 3, panic: 0, down: 0
        };
        this.list.push(ped);
        this.respawn(ped, true);
      }
    },

    respawn: function (ped, anywhere) {
      var g = SH.World.graph;
      var focus = SH.State.player;
      for (var tries = 0; tries < 10; tries++) {
        var node = g.nodes[(this.rng() * g.nodes.length) | 0];
        if (node.overWater) continue; // never spawn a walker mid-bridge
        var x = node.x + (this.rng() - 0.5) * 16, z = node.z + (this.rng() - 0.5) * 16;
        var d = Math.hypot(x - focus.x, z - focus.z);
        if (!anywhere && (d < 50 || d > 300)) continue;
        if (anywhere && d < 25) continue;
        ped.x = x; ped.z = z; ped.down = 0; ped.state = 'walk';
        ped.mesh.rotation.x = 0;
        this.pickTarget(ped);
        ped.mesh.visible = true;
        return;
      }
      ped.mesh.visible = false;
    },

    pickTarget: function (ped) {
      // Walk to a point near another intersection, offset to a sidewalk.
      var g = SH.World.graph;
      var ni = SH.World.nearestNode(ped.x, ped.z);
      var node = g.nodes[ni];
      var ei = node.edges[(this.rng() * node.edges.length) | 0];
      var e = g.edges[ei];
      var other = g.nodes[e.a === ni ? e.b : e.a];
      var off = SH.Config.world.roadHalf + 1.6;
      ped.tx = other.x + (e.vertical ? off : (this.rng() - 0.5) * 4);
      ped.tz = other.z + (e.vertical ? (this.rng() - 0.5) * 4 : off);
    },

    scare: function (x, z, radius) {
      for (var i = 0; i < this.list.length; i++) {
        var ped = this.list[i];
        if (ped.down) continue;
        var d = Math.hypot(ped.x - x, ped.z - z);
        if (d < radius) {
          ped.state = 'panic'; ped.panic = 3 + this.rng() * 2;
          ped.tx = ped.x + (ped.x - x) / (d || 1) * 30;
          ped.tz = ped.z + (ped.z - z) / (d || 1) * 30;
        }
      }
    },

    update: function (dt) {
      var st = SH.State;
      var focus = st.driving ? st.vehiclePos : st.player;
      for (var i = 0; i < this.list.length; i++) {
        var ped = this.list[i];
        var distP = Math.hypot(ped.x - focus.x, ped.z - focus.z);
        if (distP > SH.Config.loop.despawnRadius) { if (st.mode === 'playing') this.respawn(ped, false); continue; }

        if (ped.down > 0) {
          ped.down -= dt;
          ped.mesh.rotation.x = Math.min(Math.PI / 2, ped.mesh.rotation.x + dt * 5);
          if (ped.down <= 0) this.respawn(ped, false);
          continue;
        }

        // Hit by the player's vehicle?
        if (st.driving && st.vehicle && Math.abs(st.vehicle.speed) > 3.5 && distP < 1.5) {
          ped.down = 6;
          if (SH.Police && SH.Police.witnessCrime) SH.Police.witnessCrime('hitPed', ped.x, ped.z);
          if (SH.HUD) SH.HUD.notify('You hit a pedestrian!');
          continue;
        }
        // Near a fast player car, jump aside in panic.
        if (st.driving && Math.abs(st.vehicle.speed) > 9 && distP < 6 && ped.state !== 'panic') {
          ped.state = 'panic'; ped.panic = 1.6;
          ped.tx = ped.x + (ped.x - focus.x) * 2; ped.tz = ped.z + (ped.z - focus.z) * 2;
        }

        var dx = ped.tx - ped.x, dz = ped.tz - ped.z;
        var dist = Math.hypot(dx, dz);
        var speed = ped.state === 'panic' ? 5.6 : 1.5;
        if (ped.state === 'idle') {
          ped.timer -= dt;
          speed = 0;
          if (ped.timer <= 0) { ped.state = 'walk'; this.pickTarget(ped); }
        } else if (dist < 1.6) {
          if (ped.state === 'panic') { ped.state = 'walk'; this.pickTarget(ped); }
          else if (this.rng() < 0.3) { ped.state = 'idle'; ped.timer = 2 + this.rng() * 4; }
          else this.pickTarget(ped);
        }
        if (ped.state === 'panic') { ped.panic -= dt; if (ped.panic <= 0) ped.state = 'walk'; }

        if (speed > 0 && dist > 0.1) {
          ped.heading = Math.atan2(dx / dist, dz / dist);
          ped.x += Math.sin(ped.heading) * speed * dt;
          ped.z += Math.cos(ped.heading) * speed * dt;
          ped.cycle += dt * speed * 2.6;
        }
        var s = Math.sin(ped.cycle * 2.2) * (speed > 0 ? 0.55 : 0.04);
        ped.parts.legL.rotation.x = s; ped.parts.legR.rotation.x = -s;
        ped.parts.armL.rotation.x = -s * 0.8; ped.parts.armR.rotation.x = s * 0.8;
        // Knees bend as each leg swings forward (Art Bible gait: the
        // swing comes from the hip joint, the knee folds behind it).
        if (ped.parts.shinL) {
          ped.parts.shinL.rotation.x = Math.max(0, -s) * 0.85;
          ped.parts.shinR.rotation.x = Math.max(0, s) * 0.85;
        }
        // Gait life (bible v2): hips yaw a few degrees against the
        // shoulders, the chest counter-rotates, and the body bobs
        // 2-3 cm at step frequency.
        var gait = speed > 0 ? 1 : 0;
        if (ped.parts.torso) ped.parts.torso.rotation.y = -Math.sin(ped.cycle * 2.2) * 0.07 * gait;
        ped.mesh.position.set(ped.x, Math.abs(Math.sin(ped.cycle * 2.2)) * 0.028 * gait, ped.z);
        ped.mesh.rotation.y = ped.heading + Math.sin(ped.cycle * 2.2) * 0.08 * gait;
      }
    }
  };

  SH.Pedestrians = Pedestrians;
})(window.SH = window.SH || {});
