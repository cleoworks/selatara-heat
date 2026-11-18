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

  var rimTex = null, rimMatShared = null;
  function getRimMat() {
    if (rimMatShared) return rimMatShared;
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var g2 = c.getContext('2d');
    g2.fillStyle = '#141519'; g2.fillRect(0, 0, 128, 128);
    g2.fillStyle = '#c8d0da';
    g2.beginPath(); g2.arc(64, 64, 54, 0, Math.PI * 2); g2.fill();
    g2.fillStyle = '#23252b';
    for (var k = 0; k < 5; k++) {
      var a = (k / 5) * Math.PI * 2;
      g2.save(); g2.translate(64, 64); g2.rotate(a);
      g2.beginPath();
      g2.moveTo(10, -7); g2.quadraticCurveTo(34, -13, 50, -4);
      g2.lineTo(50, 7); g2.quadraticCurveTo(32, 8, 10, 6);
      g2.closePath(); g2.fill();
      g2.restore();
    }
    g2.fillStyle = '#3a3f47';
    g2.beginPath(); g2.arc(64, 64, 12, 0, Math.PI * 2); g2.fill();
    g2.fillStyle = '#17181c';
    g2.beginPath(); g2.arc(64, 64, 4.5, 0, Math.PI * 2); g2.fill();
    rimTex = new THREE.CanvasTexture(c);
    rimTex.colorSpace = THREE.SRGBColorSpace;
    rimMatShared = new THREE.MeshLambertMaterial({ map: rimTex });
    return rimMatShared;
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
    var paint = new THREE.MeshPhongMaterial({ color: colorHex, shininess: 68, specular: 0x888888, flatShading: true });
    var dark = new THREE.MeshLambertMaterial({ color: 0x14151a, flatShading: true });
    var glass = new THREE.MeshPhongMaterial({ color: 0x2a4a5e, shininess: 90, specular: 0xaaddff, flatShading: true });
    var chromeMat = new THREE.MeshLambertMaterial({ color: 0xb9c1cc, flatShading: true });
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
    function wheel(x, z, r, width) {
      var wWidth = width || 0.3;
      var w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, wWidth, 14), dark);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, r, z);
      w.castShadow = true;
      g.add(w); wheels.push(w);
      // Spoked rim: a textured disc (5 turbine spokes) that spins with
      // the wheel — the bible's fix for the plain-hub toy look.
      var hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, wWidth + 0.02, 30), getRimMat()); // 30 = 5 spokes x 4 (bible rim rule)
      hub.rotation.z = Math.PI / 2;
      hub.position.set(x, r, z);
      g.add(hub); wheels.push(hub);
      return w;
    }

    var headMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
    var tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
    var brakeMat = new THREE.MeshBasicMaterial({ color: 0xff6060 });

    // ---- Art Pass 2: car bodies are EXTRUDED SIDE PROFILES, not stacked
    // boxes. One silhouette carries hood slope, beltline and trunk; a
    // narrower glasshouse extrusion sits on top with a paint roof panel,
    // so from any screenshot distance the car reads as a shaped body.
    // Points are [z as a fraction of length, height in metres].
    var SEDAN_BELT = [[-0.50, 0.30], [-0.50, 0.90], [-0.45, 0.99], [-0.20, 1.04], [0.26, 1.02], [0.44, 0.90], [0.50, 0.83], [0.50, 0.30]];
    var SEDAN_GLASS = [[-0.175, 1.01], [-0.055, 1.36], [0.125, 1.38], [0.27, 1.00]];
    var SPORT_BELT = [[-0.50, 0.28], [-0.50, 0.76], [-0.43, 0.85], [-0.18, 0.91], [0.24, 0.87], [0.43, 0.70], [0.50, 0.60], [0.50, 0.28]];
    var SPORT_GLASS = [[-0.16, 0.88], [-0.04, 1.13], [0.13, 1.14], [0.245, 0.85]];
    var TRUCK_CAB = [[-0.50, 0.30], [-0.50, 2.10], [-0.30, 2.18], [0.28, 1.50], [0.47, 0.95], [0.50, 0.85], [0.50, 0.30]];
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

    if (type === 'motor') {
      // Art Pass 3 rebuild: a slim extruded spine, a rounded tank, twin
      // fork legs, bars and a visible rider (posed seated by the figure
      // builder) who only appears while the bike is actually ridden.
      var MOTOR_BELT = [[-0.50, 0.30], [-0.50, 0.52], [-0.30, 0.60], [-0.05, 0.66], [0.18, 0.60], [0.38, 0.50], [0.50, 0.42], [0.50, 0.30]];
      profileMesh(MOTOR_BELT, 0.20, paint, L).userData.mergeKey = 'paint';
      var tankM = new THREE.Mesh(new THREE.SphereGeometry(0.145, 10, 8), paint);
      tankM.scale.set(0.85, 0.55, 1.6); tankM.position.set(0, 0.68, 0.10); tankM.castShadow = true; tankM.userData.mergeKey = 'paint'; g.add(tankM);
      box(0.30, 0.28, 0.52, dark, 0, 0.38, 0.02, 'dark');                       // engine block
      box(0.26, 0.07, 0.62, dark, 0, 0.67, -0.34, 'dark');                      // seat
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
      // Rider: a full figure from the shared builder, posed on the bike
      // (thighs forward, arms reaching the bars, slight forward lean).
      var rider = SH.Pedestrians.buildFigure({
        skin: 0xa8763e, shirt: 0x2c3444, pants: 0x22242c,
        hairStyle: 'hat', hatColor: 0xd8402e, sleeves: 'long', face: 1
      });
      rider.legL.rotation.x = -0.85; rider.legR.rotation.x = -0.85;
      rider.shinL.rotation.x = 0.95; rider.shinR.rotation.x = 0.95; // knees bent to the pegs
      rider.armL.rotation.x = -1.0; rider.armR.rotation.x = -1.0;
      rider.foreL.rotation.x = -0.35; rider.foreR.rotation.x = -0.35;
      rider.group.position.set(0, -0.22, -0.05);
      rider.group.rotation.x = 0.15;
      rider.group.visible = false;
      g.add(rider.group);
      g.userData.rider = rider.group;
    } else if (type === 'truck') {
      var cab = profileMesh(TRUCK_CAB, W * 0.92, paint, 2.0);   // sloped-windshield cab
      cab.position.z = L * 0.5 - 1.0;
      cab.userData.mergeKey = 'paint';
      var cabGlass = box(W * 0.76, 0.66, 0.07, glass, 0, 1.86, L * 0.5 - 0.28);
      cabGlass.rotation.x = -0.6;                                // laid onto the windshield slope
      box(W * 1.02, 0.3, 0.24, dark, 0, 0.32, L * 0.47, 'dark');   // front bumper
      box(0.09, 0.12, 0.2, dark, -W * 0.52, 1.7, L * 0.36, 'dark');        // mirrors
      box(0.09, 0.12, 0.2, dark, W * 0.52, 1.7, L * 0.36, 'dark');
      box(W, H - 0.7, L * 0.58, new THREE.MeshLambertMaterial({ color: 0xd8d3c8, flatShading: true }), 0, (H - 0.7) / 2 + 0.55, -L * 0.18); // cargo
      wheel(-W / 2, L * 0.3, 0.5); wheel(W / 2, L * 0.3, 0.5);
      wheel(-W / 2, -L * 0.32, 0.5); wheel(W / 2, -L * 0.32, 0.5);
    } else if (type === 'boat') {
      box(W, 0.7, L * 0.78, paint, 0, 0.45, -L * 0.08, 'paint');            // hull
      var bow = box(W * 0.72, 0.7, W * 0.72, paint, 0, 0.45, L * 0.38, 'paint'); bow.rotation.y = Math.PI / 4; // tapered bow
      box(W * 0.62, 0.42, 0.08, glass, 0, 1.02, L * 0.14);         // windscreen
      box(W * 0.5, 0.34, L * 0.3, dark, 0, 0.78, -L * 0.18, 'dark');       // bench seat
      box(0.5, 0.62, 0.3, dark, 0, 0.62, -L * 0.52, 'dark');               // outboard motor
    } else {
      // Cars (sedan / sport / taxi / police): extruded beltline shell +
      // a SEPARATE narrower glasshouse extrusion (Art Bible v2: the
      // ~0.09 m inset per side is the tumblehome — one full-width
      // extrusion reads as a toy).
      var isSport = type === 'sport';
      profileMesh(isSport ? SPORT_BELT : SEDAN_BELT, W * 0.94, paint, L).userData.mergeKey = 'paint';
      profileMesh(isSport ? SPORT_GLASS : SEDAN_GLASS, W * 0.84, glass, L);
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
      var sideX = W * 0.47 + 0.075;   // just proud of the bevelled flank
      for (var sd = -1; sd <= 1; sd += 2) {
        box(0.02, 0.42, 0.03, seamMat, sd * sideX, 0.64, L * 0.10, 'dark');
        box(0.02, 0.42, 0.03, seamMat, sd * sideX, 0.64, -L * 0.17, 'dark');
        box(0.02, 0.035, 0.15, seamMat, sd * sideX, 0.88, L * 0.05, 'dark');   // door handles
        box(0.02, 0.035, 0.15, seamMat, sd * sideX, 0.88, -L * 0.21, 'dark');
        for (var wz = -1; wz <= 1; wz += 2) {
          var arch = new THREE.Mesh(new THREE.CircleGeometry(wr * 1.24, 14), archMat);
          arch.position.set(sd * sideX, wr * 0.96, wz * L * 0.305);
          arch.rotation.y = sd * Math.PI / 2;
          arch.userData.mergeKey = 'dark';
          g.add(arch);
          var flare = new THREE.Mesh(new THREE.TorusGeometry(wr * 1.17, 0.048, 6, 10, Math.PI), paint);
          flare.position.set(sd * (W * 0.47 + 0.055), wr * 0.96, wz * L * 0.305);
          flare.rotation.y = Math.PI / 2;
          flare.castShadow = true;
          flare.userData.mergeKey = 'paint';
          g.add(flare);
        }
      }
      var plateMat = new THREE.MeshLambertMaterial({ color: 0xe8e6da, flatShading: true });
      box(0.36, 0.11, 0.015, plateMat, 0, 0.31, -L / 2 - 0.196);               // rear plate
      var exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.15, 8), chromeMat);
      exhaust.rotation.x = Math.PI / 2;
      exhaust.position.set(W * 0.28, 0.20, -L / 2 - 0.15);
      exhaust.userData.mergeKey = 'chrome';
      g.add(exhaust);
      var roofY = isSport ? 1.15 : 1.4;
      box(W * 0.78, 0.07, L * 0.32, paint, 0, roofY, -L * 0.03, 'paint');   // roof panel
      box(W * 0.83, 0.36, 0.07, paint, 0, roofY - 0.2, L * 0.045, 'paint'); // B-pillar band
      box(W * 1.01, 0.24, 0.28, dark, 0, 0.3, L / 2 + 0.05, 'dark');       // front bumper
      box(W * 1.01, 0.24, 0.28, dark, 0, 0.3, -L / 2 - 0.05, 'dark');      // rear bumper
      box(0.07, 0.07, 0.18, dark, -(W * 0.47 + 0.10), 1.02, L * 0.16, 'dark');       // mirrors
      box(0.07, 0.07, 0.18, dark, W * 0.47 + 0.10, 1.02, L * 0.16, 'dark');
      if (isSport) {
        box(0.09, 0.22, 0.09, dark, -W * 0.3, 0.92, -L * 0.47, 'dark');    // spoiler struts
        box(0.09, 0.22, 0.09, dark, W * 0.3, 0.92, -L * 0.47, 'dark');
        box(W * 0.96, 0.08, 0.42, dark, 0, 1.05, -L * 0.47, 'dark');       // rear wing
        box(0.08, 0.16, L * 0.66, dark, -W * 0.49, 0.2, 0, 'dark');       // side skirts
        box(0.08, 0.16, L * 0.66, dark, W * 0.49, 0.2, 0, 'dark');
      }
      if (type === 'taxi') {
        box(0.62, 0.16, 0.3, new THREE.MeshBasicMaterial({ color: 0xffd23f }), 0, roofY + 0.11, -L * 0.03); // roof sign
      }
      if (type === 'police') {
        // Contrast door panels over the white body + the lightbar.
        var doorMat = new THREE.MeshLambertMaterial({ color: 0x1c2f6e, flatShading: true });
        box(0.05, 0.36, L * 0.46, doorMat, -W * 0.485, 0.64, -L * 0.02);
        box(0.05, 0.36, L * 0.46, doorMat, W * 0.485, 0.64, -L * 0.02);
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
      var wx = W * 0.47 - 0.06;
      wheel(-wx, L * 0.305, wr); wheel(wx, L * 0.305, wr);
      wheel(-wx, -L * 0.305, wr); wheel(wx, -L * 0.305, wr);
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
    } else {
      var h1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), headMat); h1.position.set(-hw, H * 0.5, L / 2 + 0.05); h1.userData.mergeKey = 'head'; g.add(h1);
      var h2 = h1.clone(); h2.position.x = hw; g.add(h2);
      var t1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), tailMat); t1.position.set(-hw, H * 0.52, -L / 2 - 0.05); t1.userData.mergeKey = 'tail'; g.add(t1);
      var t2 = t1.clone(); t2.position.x = hw; g.add(t2);
      if (type === 'sedan' || type === 'sport' || type === 'taxi' || type === 'police') {
        h1.rotation.y = 0.38; h2.rotation.y = -0.38; // wedge lamps wrap the front corners
      }
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
      var paintMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 68, specular: 0x888888, flatShading: true });
      var trimMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      var types = ['sedan', 'sport', 'police', 'truck', 'motor', 'boat'];
      var out = {};
      for (var ti = 0; ti < types.length; ti++) {
        var type = types[ti];
        var built = buildMesh(type, 0xffffff);
        var paintGeos = [], trimGeos = [];
        var kids = built.group.children;
        for (var ci = 0; ci < kids.length; ci++) {
          var child = kids[ci];
          if (!child.isMesh) continue;
          if (child === built.group.userData.cone || child.userData.isBlob) continue;
          child.updateMatrix();
          var geo = child.geometry.clone().applyMatrix4(child.matrix);
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
        if (v.type === 'motor' && SH.Player.parts) {
          var pm = SH.Player.mesh;
          pm.visible = true;
          pm.rotation.order = 'YXZ';
          pm.position.set(v.x - Math.sin(v.heading) * 0.05, -0.22, v.z - Math.cos(v.heading) * 0.05);
          pm.rotation.y = v.heading;
          pm.rotation.x = 0.15;
          SH.Player.parts.legL.rotation.x = -0.85;
          SH.Player.parts.legR.rotation.x = -0.85;
          if (SH.Player.parts.shinL) {
            SH.Player.parts.shinL.rotation.x = 0.95;
            SH.Player.parts.shinR.rotation.x = 0.95;
            SH.Player.parts.foreL.rotation.x = -0.35;
            SH.Player.parts.foreR.rotation.x = -0.35;
          }
          SH.Player.parts.armL.rotation.x = -1.0;
          SH.Player.parts.armR.rotation.x = -1.0;
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
