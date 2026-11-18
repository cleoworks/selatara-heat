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
    c.fillStyle = '#241a12';                           // brows
    c.save(); c.translate(23, 47); c.rotate(-0.14); c.fillRect(-6, -1.6, 12, 3.2); c.restore();
    c.save(); c.translate(41, 47); c.rotate(0.14); c.fillRect(-6, -1.6, 12, 3.2); c.restore();
    ellipse(23, 58, 3.4, 4.8, '#1d1410');              // eyes
    ellipse(41, 58, 3.4, 4.8, '#1d1410');
    ellipse(24.2, 56.2, 1.1, 1.4, 'rgba(255,255,255,0.85)'); // glints
    ellipse(42.2, 56.2, 1.1, 1.4, 'rgba(255,255,255,0.85)');
    c.strokeStyle = 'rgba(60,30,15,0.45)'; c.lineWidth = 2;  // nose
    c.beginPath(); c.moveTo(32.5, 62); c.lineTo(31, 71); c.stroke();
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

    // Legs: pivot groups at hip height (0.92). Bottoms vary: long pants,
    // shorts over skin, or a skirt over skin legs. Shoes ground the figure.
    var bottom = opts.bottom || 'pants';
    function makeLeg(side) {
      var pivot = new THREE.Group();
      pivot.position.set(0.11 * side, 0.92, 0);
      g.add(pivot);
      if (bottom === 'shorts') {
        add(cyl(0.070, 0.058, 0.40, 7, pants), pivot, 0, -0.20, 0);
        add(cyl(0.050, 0.042, 0.44, 7, skin), pivot, 0, -0.62, 0);
      } else {
        add(cyl(0.068, 0.050, 0.84, 7, bottom === 'skirt' ? skin : pants), pivot, 0, -0.42, 0);
      }
      var shoe = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.07, 0.26), dark);
      add(shoe, pivot, 0, -0.885, 0.05);
      return pivot;
    }
    var legL = makeLeg(-1), legR = makeLeg(1);
    var pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.16, 0.19), bottom === 'skirt' ? shirt : pants);
    add(pelvis, g, 0, 0.97, 0);
    if (bottom === 'skirt') {
      var skirt = cyl(0.15, 0.26, 0.36, 9, pants);
      add(skirt, g, 0, 0.84, 0);
    }
    // Torso: an 8-sided tapered cylinder — shoulders ~0.40 m across,
    // waist ~0.30 m — flattened front-to-back. (A 4-sided version read
    // as a flat trapezoid board from the front; 8 sides keep the taper
    // but round the silhouette.)
    var torso = cyl(0.215, 0.16, 0.56, 8, shirt);
    torso.scale.z = 0.62;
    add(torso, g, 0, 1.26, 0);
    if (opts.jacket) {
      var placket = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.48, 0.02), dark);
      add(placket, g, 0, 1.25, 0.118);
      var collar = cyl(0.13, 0.16, 0.09, 8, dark);
      add(collar, g, 0, 1.55, 0);
    }
    // Arms: pivot groups at the shoulders; upper arm (sleeved or bare),
    // skin forearm, sphere hand.
    function makeArm(side) {
      var pivot = new THREE.Group();
      pivot.position.set(0.225 * side, 1.46, 0);
      pivot.rotation.z = -0.08 * side;
      g.add(pivot);
      add(cyl(0.052, 0.046, 0.32, 6, opts.sleeves === 'short' ? skin : shirt), pivot, 0, -0.16, 0);
      add(cyl(0.042, 0.037, 0.30, 6, skin), pivot, 0, -0.47, 0);
      var hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), skin);
      add(hand, pivot, 0, -0.66, 0);
      return pivot;
    }
    var armL = makeArm(-1), armR = makeArm(1);
    // Neck + head: sphere with the canvas face, ears, then hair or a hat.
    add(cyl(0.055, 0.058, 0.09, 6, skin), g, 0, 1.565, 0);
    var headGroup = new THREE.Group();
    headGroup.position.set(0, 1.60, 0);
    g.add(headGroup);
    var headMat = new THREE.MeshLambertMaterial({ map: faceTexture(skinColor, opts.face || 0), flatShading: true });
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.108, 10, 8), headMat);
    add(head, headGroup, 0, 0.085, 0);
    var earGeo = new THREE.SphereGeometry(0.032, 6, 5);
    add(new THREE.Mesh(earGeo, skin), headGroup, -0.105, 0.08, 0);
    add(new THREE.Mesh(earGeo, skin), headGroup, 0.105, 0.08, 0);
    var hairStyle = opts.hairStyle || 'cap';
    if (hairStyle === 'hat') {
      var hatMat = new THREE.MeshLambertMaterial({ color: opts.hatColor != null ? opts.hatColor : 0x22242c, flatShading: true });
      add(cyl(0.165, 0.165, 0.018, 10, hatMat), headGroup, 0, 0.175, 0);
      add(cyl(0.105, 0.115, 0.085, 10, hatMat), headGroup, 0, 0.215, 0);
    } else if (hairStyle !== 'bald') {
      var cap = new THREE.Mesh(new THREE.SphereGeometry(0.116, 10, 6, 0, Math.PI * 2, 0, 1.75), hairMat);
      add(cap, headGroup, 0, 0.095, -0.008);
      if (hairStyle === 'long') {
        var back = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.27, 0.045), hairMat);
        add(back, headGroup, 0, -0.03, -0.095);
      } else if (hairStyle === 'bun') {
        var bun = new THREE.Mesh(new THREE.SphereGeometry(0.052, 7, 6), hairMat);
        add(bun, headGroup, 0, 0.19, -0.075);
      } else if (hairStyle === 'mohawk') {
        var hawk = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.10, 0.24), hairMat);
        add(hawk, headGroup, 0, 0.20, 0);
      }
    }
    if (opts.glasses) {
      var shades = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.045, 0.015), dark);
      add(shades, headGroup, 0, 0.095, 0.102);
    }
    return { group: g, legL: legL, legR: legR, armL: armL, armR: armR, torso: torso, head: headGroup, shirtMat: shirt };
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
        ped.mesh.position.set(ped.x, 0, ped.z);
        ped.mesh.rotation.y = ped.heading;
      }
    }
  };

  SH.Pedestrians = Pedestrians;
})(window.SH = window.SH || {});
